-- CreateTable
CREATE TABLE "TwitterUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TwitterTweet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,
    "author_id" TEXT NOT NULL,
    CONSTRAINT "TwitterTweet_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "TwitterUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TwitterMedia" (
    "media_key" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "tweet_id" TEXT NOT NULL,
    "file_id" BLOB NOT NULL,
    CONSTRAINT "TwitterMedia_tweet_id_fkey" FOREIGN KEY ("tweet_id") REFERENCES "TwitterTweet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TwitterMedia_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "LocalFile" ("sha256") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LocalFile" (
    "sha256" BLOB NOT NULL PRIMARY KEY,
    "created_at" DATETIME NOT NULL,
    "size" INTEGER NOT NULL,
    "mime_id" INTEGER NOT NULL,
    CONSTRAINT "LocalFile_mime_id_fkey" FOREIGN KEY ("mime_id") REFERENCES "Mime" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Mime" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_Likes" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_Likes_A_fkey" FOREIGN KEY ("A") REFERENCES "TwitterTweet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_Likes_B_fkey" FOREIGN KEY ("B") REFERENCES "TwitterUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Mime_name_key" ON "Mime"("name");

-- CreateIndex
CREATE UNIQUE INDEX "_Likes_AB_unique" ON "_Likes"("A", "B");

-- CreateIndex
CREATE INDEX "_Likes_B_index" ON "_Likes"("B");
