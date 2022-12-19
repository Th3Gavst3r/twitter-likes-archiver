import { Prisma, PrismaClient, TwitterLike } from '@prisma/client';
import logger from './util/logger';
import { getEnvironmentVariableOrThrow } from './util/Validation';
import JobManager, { JobType } from './importer/JobManager';
import FileImporter from './importer/FileImporter';
import TwitterImporter from './importer/TwitterImporter';
import express from 'express';
import expressSession from 'express-session';
import { PrismaSessionStore } from '@quixo3/prisma-session-store';
import passport from 'passport';
import { getAuthClient, getTwitterStrategy } from './auth/TwitterOAuth2';
import SessionManager from './importer/SessionManager';
import path from 'path';
import { linkEntities } from './util/conversion';

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

const prisma = new PrismaClient({
  datasources: {
    db: {
      // Prisma's SQLite driver will fail on concurent queries due to database locks.
      // Limiting to one connection will prevent concurrency issues, but will still fail
      // if another client (such as an external database tool) has an active connection.
      // https://github.com/prisma/prisma/issues?q=is%3Aissue+label%3A%22topic%3A+Timed+out+during+query+execution%22+
      // See also for some info about write-ahead logging (which still doesn't seem to help):
      // https://github.com/prisma/prisma/issues/3303
      url: `file:../db/main.db?connection_limit=1`,
    },
  },
});
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
jobManager.on('failed', (job, error) => {
  // Check message because TwitterResponseErrors do not correctly extend Error
  if (error instanceof Error && error.message) {
    logger.error(
      `${job.type} job ${job.id} failed: ${error.stack || error.message}`
    );
  } else {
    logger.error(`${job.type} job ${job.id} failed: ${JSON.stringify(error)}`);
  }
});
jobManager.initialize();

const app = express();

// Static files
app.set('view engine', 'ejs');
app.set('views', path.resolve('src', 'views'));
app.use(express.static(path.resolve('db', 'files')));
app.use(express.static(path.resolve('src', 'public')));

// express-session configuration
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

// passport.js configuration
app.use(passport.initialize());
app.use(passport.session());
passport.serializeUser((user, done) => {
  done(null, JSON.stringify(user));
});
passport.deserializeUser((str: string, done) => {
  done(null, JSON.parse(str));
});
passport.use(getTwitterStrategy(prisma));

// Auth flow
app.use((req, res, next) => {
  const whiteList = ['/login', '/auth/callback'];
  if (whiteList.includes(req.path)) {
    return next();
  }

  if (req.isAuthenticated()) {
    return next();
  }
  return res.redirect('/login');
});
app.get('/login', passport.authenticate('twitter'));
app.get(
  '/auth/callback',
  passport.authenticate('twitter', { failureRedirect: '/login' }),
  (req, res) => {
    return res.redirect('/');
  }
);

app.get('/', async (req, res, next) => {
  try {
    const PAGE_SIZE = 24;

    let page = 1;
    if (req.query.page) {
      try {
        page = Math.max(1, Number(req.query.page));
      } catch (e) {
        return res.sendStatus(400);
      }
    }

    const user = await prisma.twitterUser.findUnique({
      where: { id: req.user?.id },
    });
    if (!user) return res.redirect('/login');

    const totalStagedLikes = await prisma.twitterLikeStaging.count({
      where: { user_id: user.id },
    });
    const totalLikes = await prisma.twitterLike.count({
      where: { user_id: user.id },
    });
    const lastPage = Math.ceil((totalLikes + totalStagedLikes) / PAGE_SIZE);

    const stagedLikes = await prisma.twitterLikeStaging.findMany({
      where: { user_id: user.id },
      include: {
        tweet: {
          include: {
            author: true,
            hashtags: {
              include: { tag: true },
            },
            mentions: true,
            urls: true,
            media: {
              include: { file: { include: { file_extension: true } } },
            },
          },
        },
      },
      orderBy: { index: 'asc' },
      take: PAGE_SIZE,
      skip: PAGE_SIZE * (page - 1),
    });

    const committedLikes = await prisma.twitterLike.findMany({
      where: { user_id: user.id },
      include: {
        tweet: {
          include: {
            author: true,
            hashtags: {
              include: { tag: true },
            },
            mentions: true,
            urls: true,
            media: {
              include: { file: { include: { file_extension: true } } },
            },
          },
        },
      },
      orderBy: { index: 'desc' },
      take: PAGE_SIZE - stagedLikes.length,
      skip: Math.max(0, PAGE_SIZE * (page - 1 - totalStagedLikes / PAGE_SIZE)),
    });

    const likes = [...stagedLikes, ...committedLikes];

    for (const like of likes) {
      like.tweet.text = linkEntities(
        like.tweet.text,
        [...like.tweet.hashtags, ...like.tweet.mentions, ...like.tweet.urls],
        { ignoreSelfLink: { tweetId: like.tweet.id } }
      );
    }

    const isDownloadInProgress = jobManager.some(j => {
      const args = JSON.parse(j.args);
      return (
        j.type === JobType.USER_LIKES_DOWNLOAD && args.user.id === req.user?.id
      );
    });

    return res.render('pages/index', {
      navigation: {
        currentPage: page,
        lastPage,
      },
      user,
      likes,
      isDownloadInProgress,
    });
  } catch (e) {
    return next(e);
  }
});

app.post('/download', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.redirect('/login');
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
    return res.redirect('/');
  } catch (e) {
    return next(e);
  }
});

app.post('/logout', async (req, res, next) => {
  try {
    // Revoke stored OAuth tokens
    await getAuthClient({
      token: {
        access_token: req.user?.token?.access_token,
      },
    }).revokeAccessToken();

    await getAuthClient({
      token: {
        refresh_token: req.user?.token?.refresh_token,
      },
    }).revokeAccessToken();

    // Delete session
    req.logout(async error => {
      if (error) {
        return next(error);
      }

      return res.redirect('/');
    });
  } catch (e) {
    return next(e);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  logger.info(`Server is listening on port ${port}`);
});
