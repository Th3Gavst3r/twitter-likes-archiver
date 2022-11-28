import {
  Prisma,
  PrismaClient,
  PrismaPromise,
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
   * Creates a set of Like relationship in the client database.
   * @param user The user who liked this tweet.
   * @param tweetIds The tweets which were liked.
   * @returns The resulting TwitterUser record.
   */
  public createLikes(
    user: TwitterUser,
    tweetIds: string[]
  ): PrismaPromise<TwitterUser> {
    logger.debug(
      `Creating like records between user ${user.id} and ${tweetIds.length} tweets`
    );
    return this.prisma.twitterUser.update({
      where: {
        id: user.id,
      },
      data: {
        liked_tweets: {
          connect: tweetIds.map(id => {
            return {
              id,
            };
          }),
        },
      },
    });
  }
}
