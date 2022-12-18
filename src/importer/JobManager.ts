import { Job, PrismaClient, PrismaPromise, TwitterUser } from '@prisma/client';
import TwitterService, { Tweet } from '../service/TwitterService';
import logger from '../util/logger';
import FileImporter from '../importer/FileImporter';
import TwitterImporter from '../importer/TwitterImporter';
import { TypedEmitter } from 'tiny-typed-emitter';
import { getAuthClient } from '../auth/TwitterOAuth2';
import { assert } from 'typia';
import SessionManager from './SessionManager';

export enum JobType {
  USER_LIKES_DOWNLOAD = 'USER_LIKES_DOWNLOAD',
}

export interface JobArgs {
  [JobType.USER_LIKES_DOWNLOAD]: {
    user: TwitterUser;
    sessionId: string;
    paginationToken?: string;
  };
}

export interface JobManagerEvents {
  completed: (job: Job) => void;
  failed: (job: Job, error: unknown) => void;
}

/**
 * Issues and executes units of long-running background work.
 */
export default class JobManager extends TypedEmitter<JobManagerEvents> {
  private queue: Job[];
  private currentJobs: Job[];

  constructor(
    private prisma: PrismaClient,
    private fileImporter: FileImporter,
    private twitterImporter: TwitterImporter,
    private sessionManager: SessionManager
  ) {
    super();
    this.queue = [];
    this.currentJobs = [];
  }

  /**
   * Resumes all incomplete jobs on app startup.
   */
  public async initialize(): Promise<void> {
    const deferredJobs = await this.getDeferredJobs();
    for (const job of deferredJobs) {
      this._add(job);
    }
  }

  /**
   * Creates a Job and adds it to the current work queue.
   * @param type The type of job which will be run.
   * @param args The arguments required for the given job `type`.
   * @returns The resulting Job record.
   */
  public async add<T extends JobType, V extends JobArgs[T]>(
    type: T,
    args: V
  ): Promise<Job> {
    const job = await this.prisma.job.create({
      data: {
        type,
        args: JSON.stringify(args),
      },
    });

    this._add(job);

    return job;
  }

  /**
   * Searches all active and queued jobs to find if any job matches the
   * criteria provided in the `predicate` function.
   * @param predicate Calls the predicate for each available `Job` until the
   * criteria matches.
   * @returns The first `Job` which matches the `predicate`, or `undefined` if
   * no `Job` matches.
   */
  public some(predicate: (job: Job) => boolean): boolean {
    return [...this.currentJobs, ...this.queue].some(predicate);
  }

  /**
   * Adds a job to the work queue. If the queue is not already running, it is
   * automatically started.
   * @param job A fully initialized Job.
   */
  private _add(job: Job): void {
    this.queue.push(job);

    if (this.queue.length === 1) {
      // Queue was empty; start it again
      this.run();
    }
  }

  /**
   * Begins working through all jobs present in the queue. New items can be
   * pushed even while work is still running.
   */
  private async run(): Promise<void> {
    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) continue;

      this.currentJobs.push(job);

      try {
        let jobPromise: Promise<void>;
        switch (job.type) {
          case JobType.USER_LIKES_DOWNLOAD:
            const args = JSON.parse(job.args);
            args.user.created_at = new Date(args.user.created_at);
            assert<JobArgs[JobType.USER_LIKES_DOWNLOAD]>(args);

            jobPromise = this.downloadUserLikesJob(job, args);
            break;

          default:
            throw new Error(`Invalid job type: ${job.type}`);
        }

        await jobPromise
          .then(() =>
            this.prisma.job.delete({
              where: { id: job.id },
            })
          )
          .then(() => this.emit('completed', job));
      } catch (error) {
        this.emit('failed', job, error);
      }

      this.currentJobs = this.currentJobs.filter(j => j !== job);
    }
  }

  /**
   * Finds all existing Jobs which have not yet been completed and deleted.
   * @param type The type of Job to look for. When undefined, finds jobs of
   * all types.
   * @returns A list of existing Job records with the given `type`.
   */
  private getDeferredJobs(type?: JobType): PrismaPromise<Job[]> {
    return this.prisma.job.findMany({
      where: {
        type,
      },
      orderBy: {
        created_at: 'asc',
      },
    });
  }

  /**
   * Downloads the complete history of a Twitter user's likes and saves them to
   * disk.
   * @param job The database record tracking this Job's progress.
   * @param args The arguments required to complete the Job.
   */
  private async downloadUserLikesJob(
    job: Job,
    args: JobArgs[JobType.USER_LIKES_DOWNLOAD]
  ) {
    let session = await this.sessionManager.findSession(args.sessionId);
    let sessionData = this.sessionManager.getSessionData(session);

    const twitterService = new TwitterService(
      getAuthClient({
        scopes: ['like.read', 'offline.access'],
        token: sessionData.passport.user.token,
      }),
      async token => {
        session = await this.sessionManager.updateSessionToken(session, token);
        sessionData = this.sessionManager.getSessionData(session);
      }
    );

    const user = await this.prisma.twitterUser.upsert({
      where: { id: args.user.id },
      create: {
        id: args.user.id,
        name: args.user.name,
        username: args.user.username,
        created_at: args.user.created_at,
      },
      update: {},
    });

    for await (const page of twitterService.usersIdLikedTweets(
      args.user.id,
      args.paginationToken || undefined
    )) {
      const numExisting = await this.prisma.twitterLike.count({
        where: {
          user_id: args.user.id,
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
      const mediaKeyToFileIdMap = await this.downloadMedia(page.tweets);

      // Construct like relationships
      const likedTweetIds: string[] = [];
      for (const tweet of page.tweets) {
        // Create tweet, associating it with an author and some media
        transaction.push(
          this.twitterImporter.createTweet(tweet, mediaKeyToFileIdMap)
        );

        likedTweetIds.push(tweet.id);
      }
      transaction.push(
        ...this.twitterImporter.stageLikes(job, user, likedTweetIds)
      );

      // Save this job's progress in case the next page is interrupted
      args.paginationToken = page.meta?.next_token;

      transaction.push(
        this.prisma.job.update({
          where: {
            id: job.id,
          },
          data: {
            args: JSON.stringify(args),
          },
        })
      );

      // Execute all Tweet inserts and the subsequent Job update
      await this.prisma.$transaction(transaction);
    }

    // Work is complete; import the job's staged likes and delete the job
    logger.info(`Committing staged likes from job ${job.id}`);
    const stagedLikes = await this.twitterImporter.getStagedLikes(job);
    await this.prisma.$transaction([
      ...this.twitterImporter.createLikes(stagedLikes),
      this.twitterImporter.deleteStagedLikes(stagedLikes),
    ]);
  }

  /**
   * Downloads files for a tweet's attached media.
   * Only creates LocalFile records in the client database,
   * not TwitterTweets or TwitterMedia.
   * @param tweets List of tweets whose media we should download.
   * @returns A map from tweet ID to insertable media records for the
   * downloaded files.
   */
  private async downloadMedia(tweets: Tweet[]): Promise<Map<string, Buffer>> {
    const mediaKeyToFileIdMap = new Map<string, Buffer>();

    // Sort from newest to oldest
    const sortedTweets = tweets
      .slice()
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    for (const tweet of sortedTweets) {
      logger.debug(`Downloading media for tweet ${tweet.id}`);

      for (const mediaItem of tweet.attachments.media) {
        const localFile = await this.fileImporter.download(mediaItem.url);
        mediaKeyToFileIdMap.set(mediaItem.media_key, localFile.sha256);
      }
    }

    return mediaKeyToFileIdMap;
  }
}
