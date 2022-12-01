import {
  Job,
  Prisma,
  PrismaClient,
  PrismaPromise,
  TwitterLike,
  TwitterLikeStaging,
  TwitterMedia,
  TwitterTweet,
  TwitterUser,
} from '@prisma/client';
import logger from '../logger';

export default class TwitterImporter {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Creates a TwitterTweet in the client database.
   * @param tweet The tweet to import.
   * @returns The resulting database record.
   */
  public createTweet(
    tweet: TwitterTweet,
    author: TwitterUser,
    media: TwitterMedia[]
  ): PrismaPromise<TwitterTweet> {
    return this.prisma.twitterTweet.upsert({
      where: { id: tweet.id },
      create: {
        id: tweet.id,
        text: tweet.text,
        created_at: tweet.created_at,
        author: {
          connectOrCreate: {
            where: { id: author.id },
            create: author,
          },
        },
        media: {
          connectOrCreate: media.map(
            (m): Prisma.TwitterMediaCreateOrConnectWithoutTweetInput => {
              return {
                where: { media_key: m.media_key },
                create: {
                  media_key: m.media_key,
                  type: m.type,
                  url: m.url,
                  file_id: m.file_id,
                },
              };
            }
          ),
        },
      },
      update: {},
    });
  }

  /**
   * Creates a TwitterMedia in the client database.
   * @param media The media to import.
   * @returns The resulting database record.
   */
  public createMedia(media: TwitterMedia): PrismaPromise<TwitterMedia> {
    return this.prisma.twitterMedia.upsert({
      where: { media_key: media.media_key },
      create: media,
      update: media,
    });
  }

  /**
   * Stages a set of TwitterLikes imported during a particular Job.
   * Jobs will import tweets starting from from newest to oldest, so we will
   * stage the results and later flip the end product into the primary
   * TwitterLike table. After doing this, the likes will be recorded in
   * historically ascending order.
   * @param job The Job which is importing these likes.
   * @param tweetIds The IDs of the tweets which were liked in order from
   * newest to oldest.
   * @returns The resulting TwitterLikeStaging records.
   */
  public stageLikes(
    job: Job,
    tweetIds: string[]
  ): PrismaPromise<TwitterLikeStaging>[] {
    logger.debug(
      `Staging likes between user ${job.user_id} and ${tweetIds.length} tweets`
    );

    return tweetIds.map(tweetId =>
      this.prisma.twitterLikeStaging.upsert({
        where: {
          user_id_tweet_id_job_user_id_job_type_job_created_at: {
            user_id: job.user_id,
            tweet_id: tweetId,
            job_user_id: job.user_id,
            job_type: job.type,
            job_created_at: job.created_at,
          },
        },
        create: {
          user_id: job.user_id,
          tweet_id: tweetId,
          job_user_id: job.user_id,
          job_type: job.type,
          job_created_at: job.created_at,
        },
        update: {},
      })
    );
  }

  /**
   * Finds all TwitterLikeStaging records associated with a given Job.
   * @param job The Job whose staged likes will be found.
   * @returns The list of all staged likes for the given Job.
   */
  public getStagedLikes(job: Job): PrismaPromise<TwitterLikeStaging[]> {
    return this.prisma.twitterLikeStaging.findMany({
      where: {
        job: {
          user_id: job.user_id,
          type: job.type,
          created_at: job.created_at,
        },
      },
      orderBy: {
        index: 'desc',
      },
    });
  }

  /**
   * Deletes a list of TwitterLikeStaging records.
   * @param stagedLikes The staged likes to be deleted.
   * @returns A BatchPayload containing the number of deleted records.
   */
  public deleteStagedLikes(
    stagedLikes: TwitterLikeStaging[]
  ): PrismaPromise<Prisma.BatchPayload> {
    return this.prisma.twitterLikeStaging.deleteMany({
      where: {
        index: {
          in: stagedLikes.map(like => like.index),
        },
      },
    });
  }

  /**
   * Moves a Job's staged likes from the TwitterLikeStaging table to the
   * primary TwitterLike table.
   * While moving, the likes' indices are inverted to be historically
   * ascending.
   * @param stagedLikes The staged likes to be committed.
   * @returns The resulting TwitterLike records.
   */
  public createLikes(
    stagedLikes: TwitterLikeStaging[]
  ): PrismaPromise<TwitterLike>[] {
    logger.debug(`Committing ${stagedLikes.length} staged likes`);

    // Job will import the the newest like first, so we'll reverse the order
    const sorted = stagedLikes.slice().sort((a, b) => b.index - a.index);

    return sorted.map(like => {
      return this.prisma.twitterLike.upsert({
        where: {
          user_id_tweet_id: { user_id: like.user_id, tweet_id: like.tweet_id },
        },
        create: { user_id: like.user_id, tweet_id: like.tweet_id },
        update: {},
      });
    });
  }
}
