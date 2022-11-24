import {
  Prisma,
  PrismaClient,
  TwitterMedia,
  TwitterTweet,
  TwitterUser,
} from '@prisma/client';
import logger from '../logger';
import { Tweet } from '../service/TwitterService';
import FileImportService from './FileImporter';

export default class TwitterImporter {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly fileImportService: FileImportService
  ) {}

  /**
   * Imports a tweet to the client database, simultaneously downloading the
   * tweet's attached media to the client filesystem.
   * @param tweet The tweet to import
   * @returns The resulting database record
   */
  public async importTweet(tweet: Tweet): Promise<TwitterTweet> {
    const existingTweet = await this.prisma.twitterTweet.findUnique({
      where: { id: tweet.id },
    });
    if (existingTweet) {
      logger.info(`Tweet ${tweet.id} already exists`);
      return existingTweet;
    }

    // Download the media attachments for this tweet
    const media: TwitterMedia[] = [];
    for (const mediaItem of tweet.media) {
      const file = await this.fileImportService.download(mediaItem.url);
      media.push({
        ...mediaItem,
        url: mediaItem.url,
        tweet_id: tweet.id,
        file_id: file.sha256,
      });
    }

    logger.debug(`Creating record for tweet ${tweet.id}`);
    return this.prisma.twitterTweet.create({
      data: {
        id: tweet.id,
        text: tweet.text,
        created_at: tweet.created_at,
        author: {
          connectOrCreate: {
            where: { id: tweet.author.id },
            create: tweet.author,
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
                  file: {
                    connect: { sha256: m.file_id },
                  },
                },
              };
            }
          ),
        },
      },
    });
  }

  /**
   * Creates a like relationship in the client database.
   * @param tweet Tweet which was liked.
   * @param user The user who liked this tweet.
   */
  public async createLike(
    tweet: TwitterTweet,
    user: TwitterUser
  ): Promise<void> {
    logger.debug(
      `Creating a like record between user ${user.id} and tweet ${tweet.id}`
    );
    await this.prisma.twitterTweet.update({
      where: {
        id: tweet.id,
      },
      data: {
        liking_users: {
          connectOrCreate: { where: { id: user.id }, create: user },
        },
      },
    });
  }
}
