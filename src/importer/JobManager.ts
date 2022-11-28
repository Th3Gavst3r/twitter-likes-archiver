import {
  Prisma,
  PrismaClient,
  PrismaPromise,
  TwitterMedia,
  TwitterUser,
} from '@prisma/client';
import TwitterService from '../service/TwitterService';
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
        twitter_user_id: user.id,
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
    for await (const page of this.twitterService.usersIdLikeTweets(
      job.twitter_user_id,
      job.pagination_token || undefined
    )) {
      // Construct media relations outside of primary transaction due to
      // timeout limitations of Prisma's interactive transactions
      const tweetIdToMediaMap = new Map<string, TwitterMedia[]>();
      for (const tweet of page.tweets) {
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

      // Use a transaction so that the pagination token will resume correctly
      const transaction: PrismaPromise<any>[] = [];

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
      transaction.push(
        this.twitterImporter.createLikes(job.user, likedTweetIds)
      );

      // Save this job's progress in case the next page is interrupted
      transaction.push(
        this.prisma.job.update({
          where: {
            twitter_user_id_type_created_at: {
              twitter_user_id: job.twitter_user_id,
              type: job.type,
              created_at: job.created_at,
            },
          },
          data: {
            pagination_token: page.meta?.next_token,
          },
        })
      );

      // Execute all Tweet inserts and the following Job update
      await this.prisma.$transaction(transaction);
    }

    // Work is complete, delete the job
    await this.prisma.job.delete({
      where: {
        twitter_user_id_type_created_at: {
          twitter_user_id: job.twitter_user_id,
          type: job.type,
          created_at: job.created_at,
        },
      },
    });
  }
}
