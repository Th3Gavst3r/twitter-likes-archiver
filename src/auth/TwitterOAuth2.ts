import { PrismaClient } from '@prisma/client';
import OAuth2Strategy, {
  InternalOAuthError,
  VerifyCallback,
} from 'passport-oauth2';
import { auth } from 'twitter-api-sdk';
import { findMyUser, TwitterResponse } from 'twitter-api-sdk/dist/types';
import logger from '../util/logger';
import { getEnvironmentVariableOrThrow } from '../util/Validation';

/**
 * Creates an OAuth2 client which can access Twitter's OAuth2 API using the
 * input credentials.
 * @param options The configuration used to generate the OAuth2 client.
 * @returns An OAuth2 client configured with the input credentials.
 */
export function getAuthClient(options: {
  scopes?: auth.OAuth2Scopes[];
  token?: {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
  };
}): auth.OAuth2User {
  return new auth.OAuth2User({
    client_id: getEnvironmentVariableOrThrow('CLIENT_ID'),
    client_secret: getEnvironmentVariableOrThrow('CLIENT_SECRET'),
    callback: `${getEnvironmentVariableOrThrow('BASE_URL')}/auth/callback`,
    scopes: options.scopes || [],
    token: options.token,
  });
}

export type TwitterStrategyOptions = Omit<
  OAuth2Strategy.StrategyOptions,
  'authorizationURL' | 'tokenURL' | 'state'
> & {
  authorizationURL?: string;
  tokenURL?: string;
  clientType?: 'private' | 'public';
  skipExtendedProfile?: boolean;
  scope?: auth.OAuth2Scopes[];
  state?: boolean;
};

/**
 * An implementation of passport.js's generic OAuth2Strategy which integrates
 * with Twitter's OAuth2 API.
 */
export class TwitterStrategy extends OAuth2Strategy {
  public name = 'twitter';
  public profileUrl = 'https://api.twitter.com/2/users/me';

  constructor(
    private options: TwitterStrategyOptions,
    private verify: (
      access_token: string,
      refresh_token: string,
      profile: TwitterResponse<findMyUser>['data'],
      verified: VerifyCallback
    ) => void
  ) {
    // Private clients send requests using "Authorization" header as per docs:
    // https://developer.twitter.com/en/docs/authentication/oauth-2-0/user-access-token
    options.customHeaders = {
      ...(options.clientType === 'private'
        ? {
            Authorization:
              'Basic ' +
              Buffer.from(
                `${options.clientID}:${options.clientSecret}`
              ).toString('base64'),
          }
        : {}),
      ...(options.customHeaders || {}),
    };

    options.clientType = options.clientType || 'public';
    options.authorizationURL =
      options.authorizationURL || 'https://twitter.com/i/oauth2/authorize';
    options.tokenURL =
      options.tokenURL || 'https://api.twitter.com/2/oauth2/token';
    options.pkce = options.pkce || true;
    options.state = options.state || true;
    options.scope = options.scope || [
      'tweet.read',
      'offline.access', // required for refresh tokens to be issued
      'users.read',
    ];
    options.skipExtendedProfile = options.skipExtendedProfile || false;
    if (
      !options.skipExtendedProfile &&
      options.scope.indexOf('users.read') === -1
    ) {
      options.skipExtendedProfile = true;
    }

    super(
      {
        ...options,
        authorizationURL: options.authorizationURL,
        tokenURL: options.tokenURL,
      },
      verify
    );
  }

  /**
   * Overrides the default profile generation with a Twitter-specific
   * implementation.
   * @param accessToken The access token provided by the OAuth2 callback.
   * @param done The callback which accepts the user's profile.
   */
  public userProfile(
    accessToken: string,
    done: (
      err?: Error | null,
      profile?: TwitterResponse<findMyUser>['data']
    ) => void
  ): void {
    this._oauth2.useAuthorizationHeaderforGET(true);
    let url = this.profileUrl;
    if (!this.options.skipExtendedProfile) {
      url =
        url +
        '?user.fields=created_at,description,entities,id,location,name,pinned_tweet_id,profile_image_url,protected,public_metrics,url,username,verified,withheld';
    }

    this._oauth2.get(
      url,
      accessToken,
      function (
        err: { statusCode: number; data?: any },
        body?: string | Buffer
      ): void {
        if (err) {
          return done(
            new InternalOAuthError('failed to fetch user profile', err)
          );
        }

        let profile: TwitterResponse<findMyUser>['data'];

        if (body) {
          try {
            const parsedBody = JSON.parse(body.toString()).data;

            profile = {
              provider: 'twitter',
              _response: parsedBody,
              _raw: body,
              ...parsedBody,
            };
          } catch (e) {
            return done(
              new InternalOAuthError('failed to parse profile response', e)
            );
          }
        }

        return done(null, profile);
      }.bind(this)
    );
  }
}

/**
 * Creates a Twitter authentication strategy tailored to this app's
 * requirements.
 * @returns The autoconfigured passport strategy.
 */
export function getTwitterStrategy(prisma: PrismaClient): TwitterStrategy {
  return new TwitterStrategy(
    {
      clientType: 'private',
      clientID: getEnvironmentVariableOrThrow('CLIENT_ID'),
      clientSecret: getEnvironmentVariableOrThrow('CLIENT_SECRET'),
      scope: ['tweet.read', 'users.read', 'like.read', 'offline.access'],
      callbackURL: `${getEnvironmentVariableOrThrow('BASE_URL')}/auth/callback`,
    },
    async (
      access_token: string,
      refresh_token: string,
      profile: TwitterResponse<findMyUser>['data'],
      done: VerifyCallback
    ) => {
      if (!profile) {
        return done(null, undefined);
      }

      if (!profile.created_at) {
        logger.warn(`User ${profile.id} does not have a created_at property.`);
        profile.created_at = '0';
      }

      const user = await prisma.twitterUser.upsert({
        where: { id: profile.id },
        create: {
          id: profile.id,
          name: profile.name,
          username: profile.username,
          created_at: profile.created_at,
        },
        update: { name: profile.name, username: profile.username },
      });

      return done(null, {
        id: user.id,
        token: { access_token, refresh_token },
      });
    }
  );
}
