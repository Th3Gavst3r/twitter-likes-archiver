import { TwitterUser } from '@prisma/client';
import { Client, types } from 'twitter-api-sdk';
import {
  components,
  findTweetById,
  findUserById,
  TwitterResponse,
} from 'twitter-api-sdk/dist/types';
import {
  checkElementsForField,
  checkElementsForFields,
  checkField,
  checkFields,
  MakeRequired,
} from '../util/Validation';
import logger from '../util/logger';
import { OAuth2User } from 'twitter-api-sdk/dist/OAuth2User';

export type User = MakeRequired<
  TwitterResponse<findUserById>,
  'data'
>['data'] & { created_at: string };

export type Media = MakeRequired<
  MakeRequired<TwitterResponse<findTweetById>, 'includes'>['includes'],
  'media'
>['media'][0] & { media_key: string; url: string };

export type Tweet = TwitterResponse<findTweetById>['data'] & {
  source?: string;
  author: User;
  created_at: string;
  in_reply_to_user?: User;
  attachments: {
    media: Media[];
  };
};

export interface Token {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
}

/**
 * Wrapper around the Twitter SDK which performs response validation and
 * converts raw API responses into more useful local objects.
 */
export default class TwitterService {
  private readonly MAX_RETRIES = 3;
  private token?: Token;
  private client: Client;

  constructor(
    private readonly authClient: OAuth2User,
    private tokenCallback: (token: Token | undefined) => Promise<void>
  ) {
    this.token = authClient.token;
    this.client = new Client(authClient);
  }

  /**
   * Look up a user's Twitter ID by their username.
   * @param username A username.
   * @returns The corresponding TwitterUser.
   */
  public async findUserByUsername(username: string): Promise<TwitterUser> {
    logger.debug(`Finding Twitter user by username ${username}`);

    const usernameResult = await this.client.users.findUserByUsername(
      username,
      {
        'user.fields': ['created_at'],
      },
      {
        max_retries: this.MAX_RETRIES,
      }
    );
    await this.checkForUpdatedToken();

    if (usernameResult.errors && usernameResult.errors.length > 0) {
      const message = usernameResult.errors
        .map(e => e.title + (e.detail ? `: ${e.detail}` : ''))
        .join('\n');
      throw new Error(message);
    }

    if (!usernameResult.data) {
      throw new Error(`Username ${username} not found`);
    }

    if (!usernameResult.data.created_at) {
      throw new Error(
        `Username ${username} does not have a created_at timestamp`
      );
    }

    return {
      ...usernameResult.data,
      created_at: new Date(usernameResult.data.created_at),
    };
  }

  /**
   * Gets information about a user's liked tweets.
   * @param userId A Twitter user ID.
   * @returns A pageable list of tweets.
   */
  public async *usersIdLikedTweets(
    userId: string,
    pagination_token?: string
  ): AsyncGenerator<
    { tweets: Tweet[] } & Pick<
      components['schemas']['Get2UsersIdLikedTweetsResponse'],
      'meta'
    >
  > {
    logger.debug(`Finding liked tweets for user ${userId}`);

    for await (const likesResult of this.client.tweets.usersIdLikedTweets(
      userId,
      {
        expansions: [
          'author_id',
          'attachments.media_keys',
          'in_reply_to_user_id',
        ],
        'tweet.fields': [
          'id',
          'text',
          'created_at',
          'author_id',
          'entities',
          'in_reply_to_user_id',
          'source',
        ],
        'user.fields': ['id', 'name', 'username', 'created_at'],
        'media.fields': ['media_key', 'type', 'url', 'variants'],
        pagination_token,
      },
      { max_retries: this.MAX_RETRIES }
    )) {
      await this.checkForUpdatedToken();

      if (likesResult.meta?.result_count === 0) {
        return [];
      }

      /* Validate that optional fields have been populated correctly */
      const requiredResultKeys = ['data', 'includes', 'meta'] as const;
      if (!checkFields(likesResult, ...requiredResultKeys)) {
        const missingKeys = requiredResultKeys.filter(k => !likesResult[k]);
        throw new Error(
          `Likes result for ${userId} is missing the following required keys: ${JSON.stringify(
            missingKeys
          )}`
        );
      }

      const requiredTweetKeys = ['author_id', 'created_at'] as const;
      if (!checkElementsForFields(likesResult.data, ...requiredTweetKeys)) {
        const malformedTweets = likesResult.data.filter(
          e => !checkFields(e, ...requiredTweetKeys)
        );
        throw new Error(
          `Likes result for ${userId} contains the following malformed tweets: ${JSON.stringify(
            malformedTweets
          )}`
        );
      }

      const requiredIncludesKeys = ['users'] as const;
      if (!checkFields(likesResult.includes, ...requiredIncludesKeys)) {
        const missingKeys = requiredIncludesKeys.filter(
          k => !likesResult.includes[k]
        );
        throw new Error(
          `Likes result for ${userId} is missing the following required keys: ${JSON.stringify(
            missingKeys
          )}`
        );
      }

      const requiredUserKeys = ['created_at'] as const;
      if (
        !checkElementsForField(likesResult.includes.users, ...requiredUserKeys)
      ) {
        const malformedUsers = likesResult.includes.users.filter(
          e => !checkFields(e, ...requiredUserKeys)
        );
        throw new Error(
          `Likes result for ${userId} contains the following malformed users: ${JSON.stringify(
            malformedUsers
          )}`
        );
      }

      /* Transform raw API response into our local model */
      const transformedTweets: Tweet[] = [];
      const errors: Error[] = [];
      for (const tweet of likesResult.data) {
        try {
          // Pull data out of the `includes` section
          const author = likesResult.includes.users.find(
            u => u.id === tweet.author_id
          );
          if (!author) {
            throw new Error(
              `Could not find an author with ID ${tweet.author_id} in tweet ${tweet.id}`
            );
          }

          let inReplyToUser;
          if (tweet.in_reply_to_user_id) {
            inReplyToUser = likesResult.includes.users.find(
              u => u.id === tweet.in_reply_to_user_id
            );
            if (!author) {
              throw new Error(
                `Could not find in_reply_to_user with ID ${tweet.in_reply_to_user_id} in tweet ${tweet.id}`
              );
            }
          }

          let media: Media[] = [];
          if (
            checkField(tweet, 'attachments') &&
            checkField(tweet.attachments, 'media_keys')
          ) {
            media = this.findIncludedMedia(
              tweet.attachments.media_keys,
              likesResult.includes.media || []
            );
          } else {
            logger.debug(
              `Tweet ${tweet.id} has no property attachments.media_keys`
            );
          }
          logger.debug(`Tweet ${tweet.id} has ${media.length} media items`);

          // Merge tweet with data from the `includes` section
          transformedTweets.push({
            ...tweet,
            author,
            in_reply_to_user: inReplyToUser,
            attachments: {
              media,
            },
          });
        } catch (e) {
          if (e instanceof Error) {
            errors.push(e);
          } else {
            errors.push(new Error(JSON.stringify(e)));
          }
        }
      }

      if (errors.length > 0) {
        throw new Error(
          `Tweet response contained the following errors:\n${errors
            .map(e => e.message)
            .join('\n')}`
        );
      }

      logger.debug(
        `Located ${transformedTweets.length} liked tweets for user ${userId}`
      );
      yield { tweets: transformedTweets, meta: likesResult.meta };
    }
  }

  /**
   * Pulls expanded media information out of an API response's `include`
   * section.
   * @param tweet The tweet whose media attachments will be expanded.
   * @param media The list of expanded media from the API's `include` section.
   * @returns A list of media items which are attached to the given tweet.
   */
  private findIncludedMedia(
    media_keys: string[],
    media: components['schemas']['Media'][]
  ): Media[] {
    if (!media_keys) return [];

    const mediaItems: Media[] = [];
    const errors: Error[] = [];
    for (const key of media_keys) {
      try {
        const mediaItem = media.find(m => m.media_key === key);
        if (!mediaItem) {
          throw new Error(
            `Could not find an included media item with media_key ${key}`
          );
        }

        let url: string | undefined;
        if (this.instanceOfPhoto(mediaItem)) {
          url = mediaItem.url;
        } else if (
          this.instanceOfVideo(mediaItem) ||
          this.instanceOfAnimatedGif(mediaItem)
        ) {
          // Select the variant with the highest bitrate
          url = mediaItem.variants
            ?.slice()
            .sort((a, b) => {
              const ap = a.bit_rate;
              const bp = b.bit_rate;
              return !(ap || bp) ? 0 : !ap ? -1 : !bp ? 1 : ap - bp;
            })
            .at(-1)?.url;
        } else {
          logger.warn(
            `Media item ${key} has unrecognized type: ${mediaItem.type}`
          );
        }

        if (!url) {
          logger.warn(`No download url was found for media item ${key}`);
          continue;
        }

        const requiredMediaKeys = ['media_key'] as const;
        if (!checkFields(mediaItem, ...requiredMediaKeys)) {
          const missingKeys = requiredMediaKeys.filter(k => !mediaItem[k]);
          throw new Error(
            `Media item is missing the following required keys: ${JSON.stringify(
              missingKeys
            )}`
          );
        }

        mediaItems.push({
          ...mediaItem,
          url,
        });
      } catch (e) {
        if (e instanceof Error) {
          errors.push(e);
        } else {
          errors.push(new Error(JSON.stringify(e)));
        }
      }
    }

    return mediaItems;
  }

  private instanceOfAnimatedGif(
    media: types.components['schemas']['Media']
  ): media is types.components['schemas']['AnimatedGif'] {
    return media.type === 'animated_gif';
  }

  private instanceOfPhoto(
    media: types.components['schemas']['Media']
  ): media is types.components['schemas']['Photo'] {
    return media.type === 'photo';
  }

  private instanceOfVideo(
    media: types.components['schemas']['Media']
  ): media is types.components['schemas']['Video'] {
    return media.type === 'video';
  }

  private async checkForUpdatedToken(): Promise<void> {
    if (this.authClient.token !== this.token) {
      this.token = this.authClient.token;
      await this.tokenCallback(this.token);
    }
  }
}
