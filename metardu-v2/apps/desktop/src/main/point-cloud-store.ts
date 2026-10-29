import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface StagedPointCloudSource {
  stagingPath: string;
  fileName: string;
  sourceExtension: "las" | "laz";
  contentSha256: string;
  fileSizeBytes: string;
}

function fileExtension(filePath: string): "las" | "laz" {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  if (extension !== "las" && extension !== "laz") {
    throw new Error("Select a file with a .las or .laz extension.");
  }
  return extension;
}

function safeStorageKey(storageKey: string): boolean {
  return /^[a-f0-9]{64}\.(las|laz)$/.test(storageKey);
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

async function sha256File(filePath: string): Promise<{ digest: string; size: bigint }> {
  const hash = createHash("sha256");
  let size = 0n;
  for await (const chunk of createReadStream(filePath)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(bytes);
    size += BigInt(bytes.byteLength);
  }
  return { digest: hash.digest("hex"), size };
}

/** Copy a selected LAS/LAZ source into a private staging area while hashing it with constant memory. */
export async function stagePointCloudSource(
  sourcePath: string,
  userDataPath: string,
): Promise<StagedPointCloudSource> {
  if (!path.isAbsolute(sourcePath)) throw new Error("Selected point-cloud source path must be absolute.");
  const sourceExtension = fileExtension(sourcePath);
  const before = await fs.stat(sourcePath, { bigint: true });
  if (!before.isFile()) throw new Error("Selected point-cloud source is not a regular file.");
  if (before.size < 227n) throw new Error("Selected file is too small to contain a LAS header.");

  const stagingDirectory = path.join(userDataPath, "point-cloud-sources", "staging");
  await fs.mkdir(stagingDirectory, { recursive: true });
  const stagingPath = path.join(stagingDirectory, `${randomUUID()}.${sourceExtension}`);
  const hash = createHash("sha256");
  let copiedBytes = 0n;
  const hashingTransform = new Transform({
    transform(chunk: Buffer | string, encoding, callback) {
      try {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        hash.update(bytes);
        copiedBytes += BigInt(bytes.byteLength);
        callback(null, bytes);
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });

  try {
    await pipeline(
      createReadStream(sourcePath),
      hashingTransform,
      createWriteStream(stagingPath, { flags: "wx" }),
    );

    const after = await fs.stat(sourcePath, { bigint: true });
    if (
      copiedBytes !== before.size ||
      after.size !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    ) {
      throw new Error("Selected source changed while it was being copied; import it again from a stable file.");
    }

    const stagedHandle = await fs.open(stagingPath, "r+");
    try {
      await stagedHandle.sync();
    } finally {
      await stagedHandle.close();
    }

    return {
      stagingPath,
      fileName: path.basename(sourcePath),
      sourceExtension,
      contentSha256: hash.digest("hex"),
      fileSizeBytes: copiedBytes.toString(),
    };
  } catch (error) {
    await fs.rm(stagingPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Publish a staged file without replacing an existing object, verifying a deduplicated object first. */
export async function publishPointCloudObject(
  staged: StagedPointCloudSource,
  userDataPath: string,
): Promise<{ storageKey: string; objectPath: string }> {
  const storageKey = `${staged.contentSha256}.${staged.sourceExtension}`;
  if (!safeStorageKey(storageKey)) throw new Error("Staged point-cloud source has an invalid content key.");

  const stagingRoot = path.resolve(userDataPath, "point-cloud-sources", "staging");
  const stagedPath = path.resolve(staged.stagingPath);
  const relativeStagedPath = path.relative(stagingRoot, stagedPath);
  if (!relativeStagedPath || relativeStagedPath.startsWith("..") || path.isAbsolute(relativeStagedPath)) {
    throw new Error("Staged point-cloud source is outside the managed staging directory.");
  }

  const objectDirectory = path.join(userDataPath, "point-cloud-sources", "objects");
  const objectRoot = path.join(objectDirectory, storageKey);
  const objectPath = path.join(objectRoot, `source.${staged.sourceExtension}`);
  await fs.mkdir(objectRoot, { recursive: true });

  try {
    await fs.copyFile(stagedPath, objectPath, constants.COPYFILE_EXCL);
    const published = await sha256File(objectPath);
    if (published.digest !== staged.contentSha256 || published.size.toString() !== staged.fileSizeBytes) {
      throw new Error("Published point-cloud object failed its SHA-256 or size verification.");
    }
    const publishedHandle = await fs.open(objectPath, "r+");
    try {
      await publishedHandle.sync();
    } finally {
      await publishedHandle.close();
    }
  } catch (error) {
    const code = errorCode(error);
    if (code !== "EEXIST") throw error;

    try {
      const existing = await sha256File(objectPath);
      if (existing.digest !== staged.contentSha256 || existing.size.toString() !== staged.fileSizeBytes) {
        throw new Error("An existing point-cloud object does not match its content-addressed key.");
      }
    } catch (verificationError) {
      if (verificationError instanceof Error && verificationError.message.includes("does not match")) {
        throw verificationError;
      }
      throw new Error("An existing point-cloud object is incomplete or unreadable; it was left unchanged.");
    }
  }

  return { storageKey, objectPath };
}

/** Resolve only an app-generated hash key; never accept a renderer-supplied path. */
export function pointCloudObjectPath(userDataPath: string, storageKey: string): string {
  if (!safeStorageKey(storageKey)) throw new Error("Point-cloud storage key is invalid.");
  const extension = storageKey.slice(storageKey.lastIndexOf(".") + 1);
  return path.join(userDataPath, "point-cloud-sources", "objects", storageKey, `source.${extension}`);
}

export async function verifyPointCloudObject(
  userDataPath: string,
  storageKey: string,
  expectedSha256: string,
  expectedSizeBytes: string,
): Promise<{
  status: "verified" | "missing" | "sizeMismatch" | "hashMismatch" | "unreadable";
  actualSha256: string | null;
  actualSizeBytes: string | null;
}> {
  let storedPath: string;
  try {
    storedPath = pointCloudObjectPath(userDataPath, storageKey);
  } catch {
    return { status: "unreadable", actualSha256: null, actualSizeBytes: null };
  }

  try {
    const metadata = await fs.stat(storedPath, { bigint: true });
    if (!metadata.isFile()) return { status: "unreadable", actualSha256: null, actualSizeBytes: null };
    if (metadata.size.toString() !== expectedSizeBytes) {
      return { status: "sizeMismatch", actualSha256: null, actualSizeBytes: metadata.size.toString() };
    }
    const actual = await sha256File(storedPath);
    if (actual.digest !== expectedSha256 || actual.size.toString() !== expectedSizeBytes) {
      return {
        status: "hashMismatch",
        actualSha256: actual.digest,
        actualSizeBytes: actual.size.toString(),
      };
    }
    return {
      status: "verified",
      actualSha256: actual.digest,
      actualSizeBytes: actual.size.toString(),
    };
  } catch (error) {
    return {
      status: errorCode(error) === "ENOENT" ? "missing" : "unreadable",
      actualSha256: null,
      actualSizeBytes: null,
    };
  }
}

export async function removeStagedPointCloudSource(stagingPath: string): Promise<void> {
  await fs.rm(stagingPath, { force: true });
}
