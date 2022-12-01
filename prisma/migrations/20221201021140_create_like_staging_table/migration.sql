/*
  Warnings:

  - The primary key for the `TwitterLike` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Job` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `twitter_user_id` on the `Job` table. All the data in the column will be lost.
  - Added the required column `index` to the `TwitterLike` table without a default value. This is not possible if the table is not empty.
  - Added the required column `user_id` to the `Job` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "TwitterLikeStaging" (
    "index" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL,
    "tweet_id" TEXT NOT NULL,
    "job_user_id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "job_created_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TwitterLikeStaging_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "TwitterUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TwitterLikeStaging_tweet_id_fkey" FOREIGN KEY ("tweet_id") REFERENCES "TwitterTweet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TwitterLikeStaging_job_user_id_job_type_job_created_at_fkey" FOREIGN KEY ("job_user_id", "job_type", "job_created_at") REFERENCES "Job" ("user_id", "type", "created_at") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TwitterLike" (
    "index" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL,
    "tweet_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TwitterLike_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "TwitterUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TwitterLike_tweet_id_fkey" FOREIGN KEY ("tweet_id") REFERENCES "TwitterTweet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TwitterLike" ("created_at", "tweet_id", "user_id") SELECT "created_at", "tweet_id", "user_id" FROM "TwitterLike";
DROP TABLE "TwitterLike";
ALTER TABLE "new_TwitterLike" RENAME TO "TwitterLike";
CREATE UNIQUE INDEX "TwitterLike_user_id_tweet_id_key" ON "TwitterLike"("user_id", "tweet_id");
CREATE TABLE "new_Job" (
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "pagination_token" TEXT,

    PRIMARY KEY ("user_id", "type", "created_at"),
    CONSTRAINT "Job_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "TwitterUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("created_at", "pagination_token", "type", "updated_at") SELECT "created_at", "pagination_token", "type", "updated_at" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;

-- CreateIndex
CREATE UNIQUE INDEX "TwitterLikeStaging_user_id_tweet_id_job_user_id_job_type_job_created_at_key" ON "TwitterLikeStaging"("user_id", "tweet_id", "job_user_id", "job_type", "job_created_at");
