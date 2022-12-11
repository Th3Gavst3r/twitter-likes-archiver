import { PrismaClient } from '@prisma/client';
import { auth, Client } from 'twitter-api-sdk';
import logger from './logger';
import TwitterService from './service/TwitterService';
import { getEnvironmentVariableOrThrow } from './util/Validation';
import JobManager, { JobType } from './importer/JobManager';
import FileImporter from './importer/FileImporter';
import TwitterImporter from './importer/TwitterImporter';
import express from 'express';
import expressSession from 'express-session';
import { PrismaSessionStore } from '@quixo3/prisma-session-store';
import { randomUUID } from 'crypto';
import passport from 'passport';
import { getAuthClient, getTwitterStrategy } from './auth/TwitterOAuth2';
import { TokenError } from 'passport-oauth2';

declare global {
  namespace Express {
    interface User {
      id: string;
      accessToken: string;
      refreshToken: string;
    }
  }
}

const prisma = new PrismaClient();

// const authClient = getAuthClient({ scopes: ['like.read', 'offline.access'] });
// const twitterClient = new Client(authClient);

// const twitterService = new TwitterService(twitterClient);
// const fileImporter = new FileImporter(prisma);
// const twitterImporter = new TwitterImporter(prisma);
// const jobManager = new JobManager(
//   prisma,
//   twitterService,
//   fileImporter,
//   twitterImporter
// );

const app = express();

app.use(
  expressSession({
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // one week
    secret: getEnvironmentVariableOrThrow('SESSION_SECRET'),
    resave: true,
    saveUninitialized: true,
    store: new PrismaSessionStore(prisma, {
      checkPeriod: 1000 * 60 * 2, // 2 minutes
    }),
  })
);
app.use(passport.initialize());
app.use(passport.session());
app.use((req, res, next) => {
  const whiteList = ['/', '/login', '/auth/callback'];
  if (whiteList.includes(req.path)) {
    return next();
  }

  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
});

passport.serializeUser((user, done) => {
  done(null, JSON.stringify(user));
});

passport.deserializeUser((str: string, done) => {
  done(null, JSON.parse(str));
});

passport.use(getTwitterStrategy(prisma));

app.get('/', (req, res) => res.send('Hello, world!'));

app.get('/login', passport.authenticate('twitter'));

app.get(
  '/auth/callback',
  passport.authenticate('twitter', { failureRedirect: '/login' }),
  (req, res) => {
    res.redirect('/');
  }
);

app.post('/download', (req, res) => {
  res.sendStatus(201);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  logger.info(`Server is listening on port ${port}`);
});

// async function main() {
//   const username = getEnvironmentVariableOrThrow('USERNAME');

//   const user = await twitterService.findUserByUsername(username);

//   // Finish incomplete jobs first
//   const deferredDownloadJobs = await jobManager.getDeferredJobs(
//     user,
//     JobType.USER_LIKES_DOWNLOAD
//   );
//   for (const job of deferredDownloadJobs) {
//     logger.info(
//       `Resuming deferred ${job.type} job for user ${job.user_id}, which was created at ${job.created_at}`
//     );
//     await jobManager.downloadUserLikesJob(job);
//   }

//   // Download new likes
//   logger.info(`Downloading new likes for user ${user.id}`);
//   const freshJob = await jobManager.issueJob(user, JobType.USER_LIKES_DOWNLOAD);
//   await jobManager.downloadUserLikesJob(freshJob);
// }

// main()
//   .then(async () => {
//     await prisma.$disconnect();
//   })
//   .catch(async e => {
//     logger.error(e);
//     await prisma.$disconnect();
//     process.exit(1);
//   });

// TODO: Check what happens when file streams break (i.e. when disconnecting vpn)
// TODO: Use OAuth for user selection
