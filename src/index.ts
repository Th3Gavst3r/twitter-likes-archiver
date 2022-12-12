import { PrismaClient } from '@prisma/client';
import logger from './logger';
import { getEnvironmentVariableOrThrow } from './util/Validation';
import JobManager, { JobType } from './importer/JobManager';
import FileImporter from './importer/FileImporter';
import TwitterImporter from './importer/TwitterImporter';
import express from 'express';
import expressSession from 'express-session';
import { PrismaSessionStore } from '@quixo3/prisma-session-store';
import passport from 'passport';
import { getTwitterStrategy } from './auth/TwitterOAuth2';
import SessionManager from './importer/SessionManager';

declare global {
  namespace Express {
    interface User {
      id: string;
      token: {
        access_token: string;
        refresh_token: string;
        expires_at?: number;
      };
    }
  }
}

const prisma = new PrismaClient();
const fileImporter = new FileImporter(prisma);
const twitterImporter = new TwitterImporter(prisma);
const sessionManager = new SessionManager(prisma);

const jobManager = new JobManager(
  prisma,
  fileImporter,
  twitterImporter,
  sessionManager
);
jobManager.on('completed', job =>
  logger.info(`${job.type} job ${job.id} completed.`)
);
jobManager.on('failed', (job, error) =>
  logger.error(`${job.type} job ${job.id} failed: ${JSON.stringify(error)}`)
);
jobManager.initialize();

const app = express();

app.use(
  expressSession({
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // one week
    secret: getEnvironmentVariableOrThrow('SESSION_SECRET'),
    resave: true,
    saveUninitialized: true,
    store: new PrismaSessionStore(prisma, {
      checkPeriod: 1000 * 60 * 2, // 2 minutes
      dbRecordIdIsSessionId: true,
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
  return res.redirect('/login');
});

passport.serializeUser((user, done) => {
  done(null, JSON.stringify(user));
});

passport.deserializeUser((str: string, done) => {
  done(null, JSON.parse(str));
});

passport.use(getTwitterStrategy());

app.get('/', (req, res) => res.send('Hello, world!'));

app.get('/login', passport.authenticate('twitter'));

app.get(
  '/auth/callback',
  passport.authenticate('twitter', { failureRedirect: '/login' }),
  (req, res) => {
    return res.redirect('/');
  }
);

app.get('/download', async (req, res) => {
  if (!req.user) {
    return res.sendStatus(401);
  }

  const user = await prisma.twitterUser.findUnique({
    where: { id: req.user.id },
  });
  if (!user) {
    return res.redirect('/login');
  }

  await jobManager.add(JobType.USER_LIKES_DOWNLOAD, {
    user,
    sessionId: req.session.id,
  });
  return res.sendStatus(201);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  logger.info(`Server is listening on port ${port}`);
});
