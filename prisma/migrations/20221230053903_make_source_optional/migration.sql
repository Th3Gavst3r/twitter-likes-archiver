-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TwitterTweet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,
    "author_id" TEXT NOT NULL,
    "source_id" INTEGER,
    "in_reply_to_user_id" TEXT,
    CONSTRAINT "TwitterTweet_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "TwitterUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TwitterTweet_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "TwitterTweetSource" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TwitterTweet_in_reply_to_user_id_fkey" FOREIGN KEY ("in_reply_to_user_id") REFERENCES "TwitterUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TwitterTweet" ("author_id", "created_at", "id", "in_reply_to_user_id", "source_id", "text") SELECT "author_id", "created_at", "id", "in_reply_to_user_id", "source_id", "text" FROM "TwitterTweet";
DROP TABLE "TwitterTweet";
ALTER TABLE "new_TwitterTweet" RENAME TO "TwitterTweet";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
