/*
  Warnings:

  - You are about to drop the `_Likes` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "_Likes";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "TwitterLike" (
    "user_id" TEXT NOT NULL,
    "tweet_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("user_id", "tweet_id"),
    CONSTRAINT "TwitterLike_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "TwitterUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TwitterLike_tweet_id_fkey" FOREIGN KEY ("tweet_id") REFERENCES "TwitterTweet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
