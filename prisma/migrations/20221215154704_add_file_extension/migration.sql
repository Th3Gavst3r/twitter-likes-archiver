/*
  Warnings:

  - Added the required column `file_extension_id` to the `LocalFile` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "FileExtension" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ext" TEXT NOT NULL
);

-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LocalFile" (
    "sha256" BLOB NOT NULL PRIMARY KEY,
    "created_at" DATETIME NOT NULL,
    "size" INTEGER NOT NULL,
    "file_extension_id" INTEGER NOT NULL,
    "mime_id" INTEGER NOT NULL,
    CONSTRAINT "LocalFile_file_extension_id_fkey" FOREIGN KEY ("file_extension_id") REFERENCES "FileExtension" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LocalFile_mime_id_fkey" FOREIGN KEY ("mime_id") REFERENCES "Mime" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_LocalFile" ("created_at", "mime_id", "sha256", "size") SELECT "created_at", "mime_id", "sha256", "size" FROM "LocalFile";
DROP TABLE "LocalFile";
ALTER TABLE "new_LocalFile" RENAME TO "LocalFile";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;

-- CreateIndex
CREATE UNIQUE INDEX "FileExtension_ext_key" ON "FileExtension"("ext");
