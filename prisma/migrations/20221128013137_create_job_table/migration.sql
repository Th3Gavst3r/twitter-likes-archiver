-- CreateTable
CREATE TABLE "Job" (
    "twitter_user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "pagination_token" TEXT,

    PRIMARY KEY ("twitter_user_id", "type", "created_at"),
    CONSTRAINT "Job_twitter_user_id_fkey" FOREIGN KEY ("twitter_user_id") REFERENCES "TwitterUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
