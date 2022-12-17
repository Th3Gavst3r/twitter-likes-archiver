import {
  Prisma,
  TwitterTweetHashtagEntity,
  TwitterTweetMentionEntity,
  TwitterTweetUrlEntity,
} from '@prisma/client';
import { is } from 'typia';

const isSelfLink = (tweetId: string, url: TwitterTweetUrlEntity): boolean => {
  return (
    url.expanded_url !== null &&
    url.expanded_url.match(
      new RegExp(`https?:\/\/twitter\\.com\\/\\S*\\/status\\/${tweetId}`)
    ) !== null
  );
};

export function linkEntities(
  text: string,
  entities: (
    | Prisma.TwitterTweetHashtagEntityGetPayload<{ include: { tag: true } }>
    | TwitterTweetMentionEntity
    | TwitterTweetUrlEntity
  )[],
  options?: {
    ignoreSelfLink?: {
      tweetId: string;
    };
  }
): string {
  // Spreading the string converts to UTF-16 code points. This means special characters
  // like emoji will be treated as one character instead of being cut along code units.
  // https://stackoverflow.com/questions/70302587/how-to-use-substring-with-special-unicode-characters
  let chars = [...text];

  const uniqueEntities = entities.filter((element, index, array) => {
    return array.findIndex(e => e.start === element.start) === index;
  });

  uniqueEntities.sort((a, b) => a.start - b.start).reverse();

  for (const entity of uniqueEntities) {
    let replacement = '';

    if (is<TwitterTweetHashtagEntity>(entity)) {
      replacement = `<a href="https://twitter.com/hashtag/${entity.tag.tag}">#${entity.tag.tag}</a>`;
    } else if (is<TwitterTweetMentionEntity>(entity)) {
      replacement = `<a href="https://twitter.com/${entity.username}">@${entity.username}</a>`;
    } else if (is<TwitterTweetUrlEntity>(entity)) {
      if (
        options?.ignoreSelfLink?.tweetId &&
        isSelfLink(options.ignoreSelfLink.tweetId, entity)
      ) {
        replacement = '';
      } else {
        replacement = `<a href="${entity.expanded_url || entity.url}">${
          entity.display_url || entity.url
        }</a>`;
      }
    }

    chars = [
      ...chars.slice(0, entity.start),
      ...replacement,
      ...chars.slice(entity.end),
    ];
  }

  return chars.join('');
}
