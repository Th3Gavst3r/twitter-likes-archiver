import { PrismaClient, TwitterMedia } from '@prisma/client';
import { Client } from 'twitter-api-sdk';
import logger from './logger';
import TwitterService from './service/TwitterService';
import FileImporter from './importer/FileImporter';
import TwitterImporter from './importer/TwitterImporter';
import { getEnvironmentVariableOrThrow } from './util/Validation';

const prisma = new PrismaClient();

const twitterClient = new Client(getEnvironmentVariableOrThrow('BEARER_TOKEN'));

const twitterService = new TwitterService(twitterClient);
const fileImporter = new FileImporter(prisma);
const twitterImporter = new TwitterImporter(prisma, fileImporter);

async function main() {
  const username = getEnvironmentVariableOrThrow('USERNAME');

  const user = await twitterService.findUserByUsername(username);

  for await (const page of twitterService.usersIdLikeTweets(user.id)) {
    for (const tweet of page.tweets) {
      logger.info(`Importing tweet ${tweet.id}`);
      const localTweet = await twitterImporter.importTweet(tweet);
      await twitterImporter.createLike(localTweet, user);
    }
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
