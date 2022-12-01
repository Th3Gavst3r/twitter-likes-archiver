import {
  Prisma,
  PrismaClient,
  PrismaPromise,
  TwitterMedia,
  TwitterUser,
} from '@prisma/client';
import TwitterService, { Tweet } from '../service/TwitterService';
import logger from '../logger';
import FileImporter from '../importer/FileImporter';
import TwitterImporter from '../importer/TwitterImporter';

const jobWithUser = Prisma.validator<Prisma.JobArgs>()({
  include: { user: true },
});
type JobWithUser = Prisma.JobGetPayload<typeof jobWithUser>;

export enum JobType {
  USER_LIKES_DOWNLOAD = 'user_likes_download',
}

/**
 * Issues and executes units of resumable work.
 */
export default class JobManager {
  constructor(
    private prisma: PrismaClient,
    private twitterService: TwitterService,
    private fileImporter: FileImporter,
    private twitterImporter: TwitterImporter
  ) {}

  /**
   * Creates a Job record in the client database.
   * @param user The user who initiated this Job.
   * @param type The type of Job which will run.
   * @returns The resulting Job.
   */
  public issueJob(
    user: TwitterUser,
    type: JobType
  ): PrismaPromise<JobWithUser> {
    return this.prisma.job.create({
      data: {
        user: {
          connectOrCreate: {
            where: { id: user.id },
            create: user,
          },
        },
        type,
      },
      include: {
        user: true,
      },
    });
  }

  /**
   * Finds all existing Jobs which have not yet been completed and deleted.
   * @param user User whose Jobs will be found.
   * @param type The type of Job to look for.
   * @returns A list of existing Job records with the given User and Type.
   */
  public getDeferredJobs(
    user: TwitterUser,
    type: JobType
  ): PrismaPromise<JobWithUser[]> {
    return this.prisma.job.findMany({
      where: {
        user_id: user.id,
        type,
      },
      orderBy: {
        created_at: 'asc',
      },
      include: {
        user: true,
      },
    });
  }

  /**
   * Downloads the complete history of a Twitter user's likes and saves them to
   * disk.
   * @param job The database record tracking this Job's progress.
   */
  public async downloadUserLikesJob(job: JobWithUser) {
    for await (const page of this.twitterService.usersIdLikedTweets(
      job.user_id,
      job.pagination_token || undefined
    )) {
      const numExisting = await this.prisma.twitterLike.count({
        where: {
          user_id: job.user_id,
          tweet_id: {
            in: page.tweets.map(t => t.id),
          },
        },
      });
      if (numExisting === page.tweets.length) {
        logger.info(
          `All likes have been seen. Ending downloads early because we're caught up.`
        );
        break;
      }

      // Roll back this page if the job is interrupted
      const transaction: PrismaPromise<any>[] = [];

      // Download files first since we cannot do async work in a transaction
      const tweetIdToMediaMap = await this.downloadMedia(page.tweets);

      // Construct like relationships
      const likedTweetIds: string[] = [];
      for (const tweet of page.tweets) {
        // Create tweet, associating it with an author and some media
        transaction.push(
          this.twitterImporter.createTweet(
            tweet,
            tweet.author,
            tweetIdToMediaMap.get(tweet.id) || []
          )
        );

        likedTweetIds.push(tweet.id);
      }
      transaction.push(...this.twitterImporter.stageLikes(job, likedTweetIds));

      // Save this job's progress in case the next page is interrupted
      transaction.push(
        this.prisma.job.update({
          where: {
            user_id_type_created_at: {
              user_id: job.user_id,
              type: job.type,
              created_at: job.created_at,
            },
          },
          data: {
            pagination_token: page.meta?.next_token,
          },
        })
      );

      // Execute all Tweet inserts and the subsequent Job update
      await this.prisma.$transaction(transaction);
    }

    // Work is complete; import the job's staged likes and delete the job
    const stagedLikes = await this.twitterImporter.getStagedLikes(job);
    await this.prisma.$transaction([
      ...this.twitterImporter.createLikes(stagedLikes),
      this.twitterImporter.deleteStagedLikes(stagedLikes),
      this.prisma.job.delete({
        where: {
          user_id_type_created_at: {
            user_id: job.user_id,
            type: job.type,
            created_at: job.created_at,
          },
        },
      }),
    ]);
  }

  /**
   * Downloads files for a tweet's attached media.
   * Only creates LocalFile records in the client database,
   * not TwitterTweets or TwitterMedia
   * @param tweets List of tweets whose media we should download.
   * @returns A map from tweet ID to insertable media records for the
   * downloaded files.
   */
  private async downloadMedia(
    tweets: Tweet[]
  ): Promise<Map<string, TwitterMedia[]>> {
    const tweetIdToMediaMap = new Map<string, TwitterMedia[]>();

    // Sort from newest to oldest
    const sortedTweets = tweets
      .slice()
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    for (const tweet of sortedTweets) {
      logger.debug(`Downloading media for tweet ${tweet.id}`);

      const media: TwitterMedia[] = [];
      for (const mediaItem of tweet.media) {
        const localFile = await this.fileImporter.download(mediaItem.url);
        media.push({
          ...mediaItem,
          file_id: localFile.sha256,
          tweet_id: tweet.id,
        });
      }

      tweetIdToMediaMap.set(tweet.id, media);
    }

    return tweetIdToMediaMap;
  }
}
