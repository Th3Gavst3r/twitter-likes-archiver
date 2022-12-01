import { PrismaClient } from '@prisma/client';
import { Client } from 'twitter-api-sdk';
import logger from './logger';
import TwitterService from './service/TwitterService';
import { getEnvironmentVariableOrThrow } from './util/Validation';
import JobManager, { JobType } from './importer/JobManager';
import FileImporter from './importer/FileImporter';
import TwitterImporter from './importer/TwitterImporter';

const prisma = new PrismaClient();

const twitterClient = new Client(getEnvironmentVariableOrThrow('BEARER_TOKEN'));

const twitterService = new TwitterService(twitterClient);
const fileImporter = new FileImporter(prisma);
const twitterImporter = new TwitterImporter(prisma);
const jobManager = new JobManager(
  prisma,
  twitterService,
  fileImporter,
  twitterImporter
);

async function main() {
  const username = getEnvironmentVariableOrThrow('USERNAME');

  const user = await twitterService.findUserByUsername(username);

  // Finish incomplete jobs first
  const deferredDownloadJobs = await jobManager.getDeferredJobs(
    user,
    JobType.USER_LIKES_DOWNLOAD
  );
  for (const job of deferredDownloadJobs) {
    logger.info(
      `Resuming deferred ${job.type} job for user ${job.user_id}, which was created at ${job.created_at}`
    );
    await jobManager.downloadUserLikesJob(job);
  }

  // Download new likes
  logger.info(`Downloading new likes for user ${user.id}`);
  const freshJob = await jobManager.issueJob(user, JobType.USER_LIKES_DOWNLOAD);
  await jobManager.downloadUserLikesJob(freshJob);
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
