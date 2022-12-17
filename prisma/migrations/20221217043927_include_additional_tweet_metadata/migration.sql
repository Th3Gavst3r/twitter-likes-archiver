/*
  Warnings:

  - Added the required column `source_id` to the `TwitterTweet` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "TwitterTweetSource" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "TwitterHashtag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tag" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "TwitterTweetHashtagEntity" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tweet_id" TEXT NOT NULL,
    "start" INTEGER NOT NULL,
    "end" INTEGER NOT NULL,
    "tag_id" INTEGER NOT NULL,
    CONSTRAINT "TwitterTweetHashtagEntity_tweet_id_fkey" FOREIGN KEY ("tweet_id") REFERENCES "TwitterTweet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TwitterTweetHashtagEntity_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "TwitterHashtag" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TwitterTweetMentionEntity" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tweet_id" TEXT NOT NULL,
    "start" INTEGER NOT NULL,
    "end" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    CONSTRAINT "TwitterTweetMentionEntity_tweet_id_fkey" FOREIGN KEY ("tweet_id") REFERENCES "TwitterTweet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TwitterTweetUrlEntity" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tweet_id" TEXT NOT NULL,
    "start" INTEGER NOT NULL,
    "end" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "expanded_url" TEXT,
    "display_url" TEXT,
    CONSTRAINT "TwitterTweetUrlEntity_tweet_id_fkey" FOREIGN KEY ("tweet_id") REFERENCES "TwitterTweet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TwitterTweet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,
    "author_id" TEXT NOT NULL,
    "source_id" INTEGER NOT NULL,
    "in_reply_to_user_id" TEXT,
    CONSTRAINT "TwitterTweet_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "TwitterUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TwitterTweet_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "TwitterTweetSource" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TwitterTweet_in_reply_to_user_id_fkey" FOREIGN KEY ("in_reply_to_user_id") REFERENCES "TwitterUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TwitterTweet" ("author_id", "created_at", "id", "text") SELECT "author_id", "created_at", "id", "text" FROM "TwitterTweet";
DROP TABLE "TwitterTweet";
ALTER TABLE "new_TwitterTweet" RENAME TO "TwitterTweet";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;

-- CreateIndex
CREATE UNIQUE INDEX "TwitterTweetSource_name_key" ON "TwitterTweetSource"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TwitterHashtag_tag_key" ON "TwitterHashtag"("tag");

-- CreateIndex
CREATE UNIQUE INDEX "TwitterTweetHashtagEntity_tweet_id_start_end_key" ON "TwitterTweetHashtagEntity"("tweet_id", "start", "end");

-- CreateIndex
CREATE UNIQUE INDEX "TwitterTweetMentionEntity_tweet_id_start_end_key" ON "TwitterTweetMentionEntity"("tweet_id", "start", "end");

-- CreateIndex
CREATE UNIQUE INDEX "TwitterTweetUrlEntity_tweet_id_start_end_key" ON "TwitterTweetUrlEntity"("tweet_id", "start", "end");
