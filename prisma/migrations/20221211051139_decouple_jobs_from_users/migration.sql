/*
  Warnings:

  - You are about to drop the column `job_created_at` on the `TwitterLikeStaging` table. All the data in the column will be lost.
  - You are about to drop the column `job_type` on the `TwitterLikeStaging` table. All the data in the column will be lost.
  - You are about to drop the column `job_user_id` on the `TwitterLikeStaging` table. All the data in the column will be lost.
  - The primary key for the `Job` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `pagination_token` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `Job` table. All the data in the column will be lost.
  - Added the required column `job_id` to the `TwitterLikeStaging` table without a default value. This is not possible if the table is not empty.
  - Added the required column `args` to the `Job` table without a default value. This is not possible if the table is not empty.
  - Added the required column `id` to the `Job` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TwitterLikeStaging" (
    "index" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL,
    "tweet_id" TEXT NOT NULL,
    "job_id" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TwitterLikeStaging_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "TwitterUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TwitterLikeStaging_tweet_id_fkey" FOREIGN KEY ("tweet_id") REFERENCES "TwitterTweet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TwitterLikeStaging_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "Job" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TwitterLikeStaging" ("created_at", "index", "tweet_id", "user_id") SELECT "created_at", "index", "tweet_id", "user_id" FROM "TwitterLikeStaging";
DROP TABLE "TwitterLikeStaging";
ALTER TABLE "new_TwitterLikeStaging" RENAME TO "TwitterLikeStaging";
CREATE UNIQUE INDEX "TwitterLikeStaging_user_id_tweet_id_job_id_key" ON "TwitterLikeStaging"("user_id", "tweet_id", "job_id");
CREATE TABLE "new_Job" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "args" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_Job" ("created_at", "type", "updated_at") SELECT "created_at", "type", "updated_at" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
