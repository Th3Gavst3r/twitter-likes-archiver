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
import { Tweet } from '../service/TwitterService';
import logger from '../util/logger';

export default class TwitterImporter {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Creates a TwitterTweet in the client database.
   * @param tweet The tweet to import.
   * @param mediaKeyToFileIdMap A map which is used to connect `TwitterMedia`
   * records to their `LocalFile`s
   * @returns The resulting database record.
   */
  public createTweet(
    tweet: Tweet,
    mediaKeyToFileIdMap: Map<string, Buffer>
  ): PrismaPromise<TwitterTweet> {
    let source;
    if (tweet.source) {
      source = {
        connectOrCreate: {
          where: { name: tweet.source },
          create: { name: tweet.source },
        },
      };
    }

    return this.prisma.twitterTweet.upsert({
      where: { id: tweet.id },
      create: {
        id: tweet.id,
        text: tweet.text,
        source,
        in_reply_to_user: {
          connectOrCreate: tweet.in_reply_to_user && {
            where: { id: tweet.in_reply_to_user.id },
            create: {
              id: tweet.in_reply_to_user.id,
              name: tweet.in_reply_to_user.name,
              username: tweet.in_reply_to_user.username,
              created_at: new Date(tweet.in_reply_to_user.created_at),
            },
          },
        },
        created_at: tweet.created_at,
        author: {
          connectOrCreate: {
            where: { id: tweet.author.id },
            create: {
              id: tweet.author.id,
              name: tweet.author.name,
              username: tweet.author.username,
              created_at: new Date(tweet.author.created_at),
            },
          },
        },
        media: {
          connectOrCreate: tweet.attachments.media.map(m => {
            const fileId = mediaKeyToFileIdMap.get(m.media_key);
            if (!fileId) {
              throw new Error(
                `Media item ${m.media_key} for tweet ${tweet.id} is missing a LocalFile ID`
              );
            }
            return {
              where: { media_key: m.media_key },
              create: {
                media_key: m.media_key,
                type: m.type,
                url: m.url,
                file: {
                  connect: {
                    sha256: fileId,
                  },
                },
              },
            };
          }),
        },
        hashtags: {
          connectOrCreate: tweet.entities?.hashtags?.map(h => {
            return {
              where: {
                tweet_id_start_end: {
                  tweet_id: tweet.id,
                  start: h.start,
                  end: h.end,
                },
              },
              create: {
                start: h.start,
                end: h.end,
                tag: {
                  connectOrCreate: {
                    where: {
                      tag: h.tag,
                    },
                    create: {
                      tag: h.tag,
                    },
                  },
                },
              },
            };
          }),
        },
        mentions: {
          connectOrCreate: tweet.entities?.mentions?.map(m => {
            return {
              where: {
                tweet_id_start_end: {
                  tweet_id: tweet.id,
                  start: m.start,
                  end: m.end,
                },
              },
              create: {
                start: m.start,
                end: m.end,
                username: m.username,
              },
            };
          }),
        },
        urls: {
          connectOrCreate: tweet.entities?.urls?.map(u => {
            return {
              where: {
                tweet_id_start_end: {
                  tweet_id: tweet.id,
                  start: u.start,
                  end: u.end,
                },
              },
              create: {
                start: u.start,
                end: u.end,
                url: u.url,
                expanded_url: u.expanded_url,
                display_url: u.display_url,
              },
            };
          }),
        },
      },
      update: { source },
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
   * @param user The TwitterUser who owns these likes.
   * @param tweetIds The IDs of the tweets which were liked. Must be in order
   * from newest to oldest.
   * @returns The resulting TwitterLikeStaging records.
   */
  public stageLikes(
    job: Job,
    user: TwitterUser,
    tweetIds: string[]
  ): PrismaPromise<TwitterLikeStaging>[] {
    logger.debug(
      `Staging likes between user ${user.id} and ${tweetIds.length} tweets`
    );

    return tweetIds.map(tweetId =>
      this.prisma.twitterLikeStaging.upsert({
        where: {
          user_id_tweet_id_job_id: {
            user_id: user.id,
            tweet_id: tweetId,
            job_id: job.id,
          },
        },
        create: {
          user_id: user.id,
          tweet_id: tweetId,
          job_id: job.id,
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
          id: job.id,
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
