import { LocalFile, PrismaClient, PrismaPromise } from '@prisma/client';
import fetch from 'node-fetch';
import { createHash } from 'crypto';
import { PassThrough } from 'stream';
import { temporaryFile } from 'tempy';
import { createWriteStream } from 'fs';
import { copyFile, mkdir, rename, stat, unlink } from 'fs/promises';
import path from 'path';
import { fileTypeFromBuffer } from 'file-type';
import logger from '../util/logger';
import pLimit, { LimitFunction } from 'p-limit';

export default class FileImporter {
  private readonly MAX_DOWNLOADS: number = 10;
  private downloadLimiter: LimitFunction;

  constructor(private readonly prisma: PrismaClient) {
    this.downloadLimiter = pLimit(this.MAX_DOWNLOADS);
  }

  /**
   * Downloads content from a given URL and saves it to disk, using the SHA256
   * hash of the content for the filename.
   * @param url URL to download.
   * @returns A database record for the created file.
   */
  public async download(url: string): Promise<PrismaPromise<LocalFile>> {
    // If we've already downloaded this url before, return the existing file
    const existingMedia = await this.prisma.twitterMedia.findFirst({
      where: { url },
    });
    if (existingMedia) {
      logger.debug(`Media record already exists for ${url}`);

      const localFile = await this.prisma.localFile.findUnique({
        where: { sha256: existingMedia.file_id },
      });

      if (localFile) {
        return localFile;
      } else {
        logger.warn(
          `Media record exists for ${url}, but there is no associated file. Downloading again`
        );
      }
    }

    // Begin the download
    logger.info(`Downloading content from ${url}`);
    const response = await this.downloadLimiter(() => fetch(url));
    if (!response.body) {
      throw new Error(`Response for ${url} did not contain a body`);
    }
    const body = response.body;

    // Calculate the SHA256 hash of the response stream
    const hashPromise = new Promise<Buffer>((resolve, reject) => {
      const hasher = createHash('sha256');

      const hashStream = new PassThrough();
      hashStream.on('end', () => {
        hasher.end();
        const hash = hasher.read();
        logger.debug(
          `Calculated hash for content at ${url} is ${hash.toString('hex')}`
        );
        resolve(hash);
      });
      hashStream.on('error', reject);

      hashStream.pipe(hasher);
      body.pipe(hashStream);
    });

    // Save the data to a temporary location while the hash is calculated
    const filePromise = new Promise<string>((resolve, reject) => {
      const tempPath = temporaryFile();

      const fileStream = createWriteStream(tempPath);
      fileStream.on('finish', () => {
        logger.debug(
          `Response from ${url} has been saved to temporary file: ${tempPath}`
        );
        resolve(tempPath);
      });
      fileStream.on('error', reject);

      body.pipe(fileStream);
    });

    // Determine the file type of the content
    const fileTypePromise = response.arrayBuffer().then(fileTypeFromBuffer);

    logger.debug(`Awaiting completion of content processing steps for ${url}`);
    const tempFile = await filePromise;
    const hash = await hashPromise;
    const fileType = (await fileTypePromise) || {
      ext: 'bin',
      mime: 'application/octet-stream',
    };
    const stats = await stat(tempFile);

    // Move the file out of temporary storage
    const clientFilesDir = path.resolve('db', 'files');
    const file = path.resolve(
      clientFilesDir,
      `${hash.toString('hex')}.${fileType.ext}`
    );

    logger.debug(
      `Transferring temporary file ${tempFile} to permanent storage at ${file}`
    );
    await mkdir(clientFilesDir, { recursive: true });
    try {
      await rename(tempFile, file);
    } catch (e) {
      logger.debug(`File rename failed, falling back to copy. Cause: ${e}`);
      await copyFile(tempFile, file);
      await unlink(tempFile);
    }

    // Save the file metadata
    logger.debug(
      `Saving database record for ${hash.toString('hex')}.${fileType.ext}`
    );
    return this.prisma.localFile.upsert({
      where: { sha256: hash },
      update: {
        created_at: stats.ctime,
        size: stats.size,
        file_extension: {
          connectOrCreate: {
            where: { ext: fileType.ext },
            create: { ext: fileType.ext },
          },
        },
        mime: {
          connectOrCreate: {
            where: { name: fileType.mime },
            create: { name: fileType.mime },
          },
        },
      },
      create: {
        sha256: hash,
        created_at: stats.ctime,
        size: stats.size,
        file_extension: {
          connectOrCreate: {
            where: { ext: fileType.ext },
            create: { ext: fileType.ext },
          },
        },
        mime: {
          connectOrCreate: {
            where: { name: fileType.mime },
            create: { name: fileType.mime },
          },
        },
      },
    });
  }
}
