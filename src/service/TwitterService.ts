import { Prisma, TwitterMedia, TwitterUser } from '@prisma/client';
import { Client, types } from 'twitter-api-sdk';
import {
  components,
  TwitterResponse,
  usersIdLikedTweets,
} from 'twitter-api-sdk/dist/types';
import {
  checkElementsForField,
  checkElementsForFields,
  checkField,
  checkFields,
  MakeRequired,
} from '../util/Validation';
import logger from '../logger';

type Media = Omit<TwitterMedia, 'tweet_id' | 'file_id'>;

type Tweet = Prisma.TwitterTweetGetPayload<{
  include: { author: true };
}> & { media: Media[] };

/**
 * Wrapper around the Twitter SDKto perform response validation and
 * convert raw API responses into more useful objects.
 */
export default class TwitterService {
  constructor(private readonly client: Client) {}

  /**
   * Look up a user's Twitter ID by their username.
   * @param username A username.
   * @returns A Twitter ID string.
   */
  public async findUserByUsername(username: string): Promise<TwitterUser> {
    logger.debug(`Finding Twitter user by username ${username}`);
    const usernameResult = await this.client.users.findUserByUsername(
      username,
      {
        'user.fields': ['created_at'],
      }
    );
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
   * @param userId A Twitter ID string.
   * @returns A pageable list of tweets.
   */
  public async usersIdLikeTweets(
    userId: string
  ): Promise<
    { tweets: Tweet[] } & Pick<
      components['schemas']['Get2UsersIdLikedTweetsResponse'],
      'meta'
    >
  > {
    logger.debug(`Finding liked tweets for user ${userId}`);
    const likesResult: TwitterResponse<usersIdLikedTweets> =
      await this.client.tweets.usersIdLikedTweets(userId, {
        expansions: ['author_id', 'attachments.media_keys'],
        'tweet.fields': ['id', 'text', 'created_at', 'author_id'],
        'user.fields': ['id', 'name', 'username', 'created_at'],
        'media.fields': ['media_key', 'type', 'url', 'variants'],
      });
    if (likesResult.errors && likesResult.errors.length > 0) {
      const message = likesResult.errors
        .map(e => e.title + (e.detail ? `: ${e.detail}` : ''))
        .join('\n');
      throw new Error(message);
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
        const author = this.mapAuthorToTweet(
          tweet,
          likesResult.includes.users || []
        );

        let media: Media[] = [];
        if (
          checkField(tweet, 'attachments') &&
          checkField(tweet.attachments, 'media_keys')
        ) {
          media = this.mapMediaToTweet(tweet, likesResult.includes.media || []);
        } else {
          logger.debug(
            `Tweet ${tweet.id} has no property attachments.media_keys`
          );
        }

        transformedTweets.push({
          ...tweet,
          author,
          media,
          created_at: new Date(tweet.created_at),
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
    return { tweets: transformedTweets, meta: likesResult.meta };
  }

  private mapAuthorToTweet(
    tweet: MakeRequired<
      components['schemas']['Tweet'],
      'author_id' | 'created_at'
    >,
    users: MakeRequired<components['schemas']['User'], 'created_at'>[]
  ): TwitterUser {
    const author = users.find(u => u.id === tweet.author_id);
    if (!author) {
      throw new Error(
        `Response for ${tweet.id} did not include a matching user with id ${tweet.author_id}`
      );
    }

    return {
      ...author,
      created_at: new Date(author.created_at),
    };
  }

  private mapMediaToTweet(
    tweet: MakeRequired<components['schemas']['Tweet'], 'attachments'>,
    media: components['schemas']['Media'][]
  ): Media[] {
    if (!tweet.attachments.media_keys) return [];

    const mediaItems: Media[] = [];
    const errors: Error[] = [];
    for (const key of tweet.attachments.media_keys) {
      try {
        const mediaItem = media.find(m => m.media_key === key);
        if (!mediaItem) {
          throw new Error(
            `Attachment for ${tweet.id} did not include a matching media item ${key}`
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
            ?.sort((a, b) => {
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
            `Tweet ${
              tweet.id
            } is missing the following required media keys: ${JSON.stringify(
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

    logger.debug(`Tweet ${tweet.id} has ${mediaItems.length} media items`);
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
}
