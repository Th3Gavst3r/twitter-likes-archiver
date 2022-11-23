import { Prisma, PrismaClient, TwitterMedia } from '@prisma/client';
import { Client } from 'twitter-api-sdk';
import logger from './logger';
import TwitterService from './service/TwitterService';
import FileImportService from './service/FileImportService';
import { getEnvironmentVariableOrThrow } from './util/Validation';

const prisma = new PrismaClient();

const client = new Client(getEnvironmentVariableOrThrow('BEARER_TOKEN'));

const twitterService = new TwitterService(client);
const fileImportService = new FileImportService(prisma);

async function main() {
  const username = getEnvironmentVariableOrThrow('USERNAME');

  const user = await twitterService.findUserByUsername(username);

  const likedTweetsResponse = await twitterService.usersIdLikeTweets(user.id);

  for (const tweet of likedTweetsResponse.tweets) {
    if (await prisma.twitterTweet.findUnique({ where: { id: tweet.id } })) {
      logger.info(`Tweet ${tweet.id} already exists`);
      continue;
    }

    logger.info(`Importing tweet ${tweet.id}`);

    const media: TwitterMedia[] = [];
    for (const mediaItem of tweet.media) {
      const file = await fileImportService.download(mediaItem.url);
      media.push({
        ...mediaItem,
        url: mediaItem.url,
        tweet_id: tweet.id,
        file_id: file.sha256,
      });
    }

    logger.debug(`Creating database record for tweet ${tweet.id}`);
    const localTweet = await prisma.twitterTweet.create({
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
        liking_users: {
          connectOrCreate: { where: { id: user.id }, create: user },
        },
      },
    });

    logger.info(`Created tweet: ${JSON.stringify(localTweet)}`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async e => {
    logger.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
