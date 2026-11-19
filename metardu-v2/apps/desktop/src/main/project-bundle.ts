import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { createReadStream, createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  PROJECT_BUNDLE_MAX_MANIFEST_BYTES,
  PROJECT_BUNDLE_SNAPSHOT_SCHEMA,
  type ProjectBundleProgress,
  type ProjectBundleSnapshot,
} from "@metardu/ipc-schemas";
import type { StagedPointCloudSource } from "./point-cloud-store.js";
import type { PointCloudHeaderDetails } from "../shared/point-cloud.js";

const MANIFEST_NAME = "manifest.json";
const MANIFEST_HASH_NAME = "manifest.sha256";
const SOURCES_DIRECTORY = "sources";

export interface ProjectBundleIoOptions {
  operationId: string;
  signal: AbortSignal;
  onProgress: (progress: ProjectBundleProgress) => void;
}

export interface ExportProjectBundleOptions extends ProjectBundleIoOptions {
  destinationParent: string;
  snapshot: ProjectBundleSnapshot;
  getCurrentSnapshot: () => ProjectBundleSnapshot;
  resolveSourcePath: (storageKey: string) => string;
  inspectHeader: (sourcePath: string) => Promise<PointCloudHeaderDetails>;
}

export interface ExportProjectBundleResult {
  bundlePath: string;
  projectName: string;
  sourceCount: number;
  totalBytes: string;
}

export interface StageProjectBundleOptions extends ProjectBundleIoOptions {
  bundlePath: string;
  userDataPath: string;
  inspectHeader: (sourcePath: string) => Promise<PointCloudHeaderDetails>;
}

export interface StagedProjectBundle {
  snapshot: ProjectBundleSnapshot;
  stagingDirectory: string;
  stagedSources: StagedPointCloudSource[];
  totalBytes: string;
}

function ensureNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const error = new Error("Project bundle operation was cancelled.");
    error.name = "AbortError";
    throw error;
  }
}

function sourceTotalBytes(snapshot: ProjectBundleSnapshot): bigint {
  return snapshot.pointCloudSources.reduce((sum, source) => sum + BigInt(source.fileSizeBytes), 0n);
}

function stableSnapshotKey(snapshot: ProjectBundleSnapshot): string {
  return JSON.stringify({
    project: snapshot.project,
    pointCloudSources: snapshot.pointCloudSources,
    communityExtensionArtifacts: snapshot.communityExtensionArtifacts ?? [],
  });
}

function verifyCommunityExtensionArtifactDigests(snapshot: ProjectBundleSnapshot): void {
  for (const artifact of snapshot.communityExtensionArtifacts ?? []) {
    const inputDigest = createHash("sha256").update(artifact.inputJson, "utf8").digest("hex");
    const outputDigest = createHash("sha256").update(artifact.outputJson, "utf8").digest("hex");
    if (inputDigest !== artifact.inputSha256 || outputDigest !== artifact.outputSha256) {
      throw new Error("Project bundle community artifact failed its input or output SHA-256 check.");
    }
  }
}

function emitProgress(
  options: ProjectBundleIoOptions,
  operation: "export" | "import",
  phase: ProjectBundleProgress["phase"],
  completedBytes: bigint,
  totalBytes: bigint,
  completedFiles: number,
  totalFiles: number,
): void {
  options.onProgress({
    operationId: options.operationId,
    operation,
    phase,
    completedBytes: completedBytes.toString(),
    totalBytes: totalBytes.toString(),
    completedFiles,
    totalFiles,
  });
}

function safeProjectFolderName(name: string): string {
  const normalized = name
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 64);
  if (!normalized || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(normalized)) return "survey-project";
  return normalized;
}

function assertRegularDirectory(info: Awaited<ReturnType<typeof fs.lstat>>, label: string): void {
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} must be a regular directory, not a symbolic link.`);
}

function assertRegularFile(info: Awaited<ReturnType<typeof fs.lstat>>, label: string): void {
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file, not a symbolic link.`);
}

async function ensureManagedStagingRoot(userDataPath: string): Promise<string> {
  const userDataRoot = path.resolve(userDataPath);
  await fs.mkdir(userDataRoot, { recursive: true });
  assertRegularDirectory(await fs.lstat(userDataRoot), "Application data directory");
  const managedRoot = path.join(userDataRoot, "point-cloud-sources");
  const stagingRoot = path.join(managedRoot, "staging");
  for (const directory of [managedRoot, stagingRoot]) {
    try {
      await fs.mkdir(directory, { recursive: false });
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
    }
    assertRegularDirectory(await fs.lstat(directory), "Managed point-cloud staging directory");
  }
  return stagingRoot;
}

async function syncFile(filePath: string): Promise<void> {
  const handle = await fs.open(filePath, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function copyAndVerify(
  sourcePath: string,
  destinationPath: string,
  expectedSha256: string,
  expectedSizeBytes: string,
  signal: AbortSignal,
  onBytes: (byteCount: number) => void,
): Promise<void> {
  ensureNotAborted(signal);
  const before = await fs.lstat(sourcePath, { bigint: true });
  assertRegularFile(before, "Point-cloud source");
  if (before.size.toString() !== expectedSizeBytes) {
    throw new Error("Point-cloud source size differs from its saved project record.");
  }

  const digest = createHash("sha256");
  let copiedBytes = 0n;
  const hashingTransform = new Transform({
    transform(chunk: Buffer | string, encoding, callback) {
      try {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        digest.update(bytes);
        copiedBytes += BigInt(bytes.byteLength);
        onBytes(bytes.byteLength);
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
      createWriteStream(destinationPath, { flags: "wx" }),
      { signal },
    );
  } catch (error) {
    await fs.rm(destinationPath, { force: true }).catch(() => undefined);
    throw error;
  }

  const after = await fs.lstat(sourcePath, { bigint: true });
  if (
    !after.isFile() || after.isSymbolicLink() ||
    after.size !== before.size || after.dev !== before.dev || after.ino !== before.ino ||
    after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs
  ) {
    throw new Error("Point-cloud source changed while it was being copied.");
  }
  if (copiedBytes.toString() !== expectedSizeBytes || digest.digest("hex") !== expectedSha256) {
    throw new Error("Point-cloud source failed SHA-256 or size verification.");
  }
  await syncFile(destinationPath);
}

async function writeManifest(directory: string, snapshot: ProjectBundleSnapshot): Promise<void> {
  const manifestBytes = Buffer.from(JSON.stringify(snapshot), "utf8");
  if (manifestBytes.byteLength > PROJECT_BUNDLE_MAX_MANIFEST_BYTES) {
    throw new Error("Project data is too large for the v1 bundle manifest.");
  }
  const manifestPath = path.join(directory, MANIFEST_NAME);
  await fs.writeFile(manifestPath, manifestBytes, { flag: "wx" });
  await syncFile(manifestPath);
  const hashPath = path.join(directory, MANIFEST_HASH_NAME);
  await fs.writeFile(hashPath, `${createHash("sha256").update(manifestBytes).digest("hex")}\n`, { flag: "wx" });
  await syncFile(hashPath);
}

async function readDirectoryEntriesBounded(
  directory: string,
  maximumEntries: number,
): Promise<Dirent[]> {
  const entries: Dirent[] = [];
  for await (const entry of await fs.opendir(directory)) {
    if (entries.length >= maximumEntries) throw new Error("Project bundle contains more entries than its v1 manifest allows.");
    entries.push(entry);
  }
  return entries;
}

export async function exportProjectBundleDirectory(
  untrustedOptions: ExportProjectBundleOptions,
): Promise<ExportProjectBundleResult> {
  const options = untrustedOptions;
  const snapshot = PROJECT_BUNDLE_SNAPSHOT_SCHEMA.parse(options.snapshot);
  verifyCommunityExtensionArtifactDigests(snapshot);
  ensureNotAborted(options.signal);

  const parentPath = path.resolve(options.destinationParent);
  const parentInfo = await fs.lstat(parentPath);
  assertRegularDirectory(parentInfo, "Bundle destination");
  const operationTag = randomUUID();
  const dateTag = new Date().toISOString().replace(/[-:.]/g, "").replace(/Z$/, "Z");
  const folderName = `${safeProjectFolderName(snapshot.project.name)}-${dateTag}-${operationTag.slice(0, 8)}.mdp`;
  const bundlePath = path.join(parentPath, folderName);
  const stagingDirectory = path.join(parentPath, `.metardu-project-${operationTag}.partial`);
  await fs.mkdir(stagingDirectory, { recursive: false });

  const totalBytes = sourceTotalBytes(snapshot);
  const totalFiles = snapshot.pointCloudSources.length;
  let completedBytes = 0n;
  let completedFiles = 0;
  emitProgress(options, "export", "preparing", 0n, totalBytes, 0, totalFiles);

  try {
    const sourceDirectory = path.join(stagingDirectory, SOURCES_DIRECTORY);
    await fs.mkdir(sourceDirectory, { recursive: false });
    const bundledSources = [];
    for (const source of snapshot.pointCloudSources) {
      ensureNotAborted(options.signal);
      const sourcePath = options.resolveSourcePath(source.storageKey);
      emitProgress(options, "export", "verifying", completedBytes, totalBytes, completedFiles, totalFiles);
      const header = await options.inspectHeader(sourcePath);
      ensureNotAborted(options.signal);
      bundledSources.push({
        ...source,
        format: header.format,
        headerJson: JSON.stringify(header),
      });
      const destinationPath = path.join(sourceDirectory, source.storageKey);
      emitProgress(options, "export", "copying", completedBytes, totalBytes, completedFiles, totalFiles);
      await copyAndVerify(
        sourcePath,
        destinationPath,
        source.contentSha256,
        source.fileSizeBytes,
        options.signal,
        (byteCount) => {
          completedBytes += BigInt(byteCount);
          emitProgress(options, "export", "copying", completedBytes, totalBytes, completedFiles, totalFiles);
        },
      );
      completedFiles += 1;
      emitProgress(options, "export", "copying", completedBytes, totalBytes, completedFiles, totalFiles);
    }

    ensureNotAborted(options.signal);
    const currentSnapshot = PROJECT_BUNDLE_SNAPSHOT_SCHEMA.parse(options.getCurrentSnapshot());
    if (stableSnapshotKey(currentSnapshot) !== stableSnapshotKey(snapshot)) {
      throw new Error("Project data changed during bundle export; no bundle was published. Export again from a stable project.");
    }

    const outputSnapshot = PROJECT_BUNDLE_SNAPSHOT_SCHEMA.parse({
      ...snapshot,
      exportedAt: new Date().toISOString(),
      pointCloudSources: bundledSources,
    });
    emitProgress(options, "export", "verifying", completedBytes, totalBytes, completedFiles, totalFiles);
    await writeManifest(stagingDirectory, outputSnapshot);
    ensureNotAborted(options.signal);
    await fs.rename(stagingDirectory, bundlePath);
    emitProgress(options, "export", "complete", totalBytes, totalBytes, totalFiles, totalFiles);
    return {
      bundlePath,
      projectName: snapshot.project.name,
      sourceCount: totalFiles,
      totalBytes: totalBytes.toString(),
    };
  } catch (error) {
    await fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function fatalUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Project bundle manifest is not valid UTF-8.");
  }
}

async function readAndValidateBundle(bundlePath: string): Promise<ProjectBundleSnapshot> {
  const bundleInfo = await fs.lstat(bundlePath);
  assertRegularDirectory(bundleInfo, "Selected project bundle");
  const rootEntries = await readDirectoryEntriesBounded(bundlePath, 3);
  const rootNames = rootEntries.map((entry) => entry.name).sort();
  const expectedRootNames = [MANIFEST_HASH_NAME, MANIFEST_NAME, SOURCES_DIRECTORY].sort();
  if (JSON.stringify(rootNames) !== JSON.stringify(expectedRootNames)) {
    throw new Error("Project bundle contains missing or unexpected top-level entries.");
  }
  for (const entry of rootEntries) {
    if (entry.isSymbolicLink()) throw new Error("Project bundle must not contain symbolic links.");
  }

  const manifestPath = path.join(bundlePath, MANIFEST_NAME);
  const hashPath = path.join(bundlePath, MANIFEST_HASH_NAME);
  const sourceDirectory = path.join(bundlePath, SOURCES_DIRECTORY);
  assertRegularFile(await fs.lstat(manifestPath), "Project bundle manifest");
  assertRegularFile(await fs.lstat(hashPath), "Project bundle manifest digest");
  assertRegularDirectory(await fs.lstat(sourceDirectory), "Project bundle source directory");

  const manifestInfo = await fs.lstat(manifestPath, { bigint: true });
  if (manifestInfo.size <= 0n || manifestInfo.size > BigInt(PROJECT_BUNDLE_MAX_MANIFEST_BYTES)) {
    throw new Error("Project bundle manifest is empty or exceeds the v1 size limit.");
  }
  const hashInfo = await fs.lstat(hashPath, { bigint: true });
  if (hashInfo.size !== 65n) throw new Error("Project bundle manifest digest has an invalid size.");
  const [manifestBytes, expectedHashText] = await Promise.all([
    fs.readFile(manifestPath),
    fs.readFile(hashPath, "utf8"),
  ]);
  if (!/^[a-f0-9]{64}\n$/.test(expectedHashText)) {
    throw new Error("Project bundle manifest digest is malformed.");
  }
  const actualHash = createHash("sha256").update(manifestBytes).digest("hex");
  if (actualHash !== expectedHashText.trimEnd()) throw new Error("Project bundle manifest failed SHA-256 verification.");

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(fatalUtf8(manifestBytes)) as unknown;
  } catch (error) {
    if (error instanceof Error && error.message.includes("UTF-8")) throw error;
    throw new Error("Project bundle manifest is not valid JSON.");
  }
  const parsedSnapshot = PROJECT_BUNDLE_SNAPSHOT_SCHEMA.safeParse(parsedJson);
  if (!parsedSnapshot.success) {
    throw new Error(`Project bundle manifest is invalid: ${parsedSnapshot.error.issues.slice(0, 4).map((issue) => issue.message).join("; ")}`);
  }
  verifyCommunityExtensionArtifactDigests(parsedSnapshot.data);

  const expectedSourceNames = parsedSnapshot.data.pointCloudSources.map((source) => source.storageKey).sort();
  const sourceEntries = await readDirectoryEntriesBounded(sourceDirectory, expectedSourceNames.length);
  const actualSourceNames = sourceEntries.map((entry) => entry.name).sort();
  if (JSON.stringify(actualSourceNames) !== JSON.stringify(expectedSourceNames)) {
    throw new Error("Project bundle source files do not exactly match its manifest.");
  }
  for (const entry of sourceEntries) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error("Project bundle sources must be regular files without nested paths or symbolic links.");
    }
  }
  return parsedSnapshot.data;
}

export async function stageProjectBundleDirectory(
  untrustedOptions: StageProjectBundleOptions,
): Promise<StagedProjectBundle> {
  const options = untrustedOptions;
  ensureNotAborted(options.signal);
  const resolvedBundlePath = path.resolve(options.bundlePath);
  if (!path.basename(resolvedBundlePath).toLowerCase().endsWith(".mdp")) {
    throw new Error("Select a .mdp project bundle directory.");
  }
  const snapshot = await readAndValidateBundle(resolvedBundlePath);
  const totalSourceBytes = sourceTotalBytes(snapshot);
  const totalWorkBytes = totalSourceBytes * 2n;
  const totalFiles = snapshot.pointCloudSources.length;
  let completedWorkBytes = 0n;
  let completedFiles = 0;
  const stagingRoot = await ensureManagedStagingRoot(options.userDataPath);
  const stagingDirectory = path.join(stagingRoot, `bundle-${randomUUID()}`);
  await fs.mkdir(stagingDirectory, { recursive: false });
  const stagedSources: StagedPointCloudSource[] = [];

  try {
    emitProgress(options, "import", "verifying", 0n, totalWorkBytes, 0, totalFiles);
    const bundledSourceDirectory = path.join(resolvedBundlePath, SOURCES_DIRECTORY);
    for (const source of snapshot.pointCloudSources) {
      ensureNotAborted(options.signal);
      const inputPath = path.join(bundledSourceDirectory, source.storageKey);
      const stagingPath = path.join(stagingDirectory, source.storageKey);
      emitProgress(options, "import", "copying", completedWorkBytes, totalWorkBytes, completedFiles, totalFiles);
      await copyAndVerify(
        inputPath,
        stagingPath,
        source.contentSha256,
        source.fileSizeBytes,
        options.signal,
        (byteCount) => {
          completedWorkBytes += BigInt(byteCount);
          emitProgress(options, "import", "copying", completedWorkBytes, totalWorkBytes, completedFiles, totalFiles);
        },
      );
      const header = await options.inspectHeader(stagingPath);
      ensureNotAborted(options.signal);
      source.headerJson = JSON.stringify(header);
      source.format = header.format;
      stagedSources.push({
        stagingPath,
        fileName: source.fileName,
        sourceExtension: source.sourceExtension,
        contentSha256: source.contentSha256,
        fileSizeBytes: source.fileSizeBytes,
      });
      completedFiles += 1;
      completedWorkBytes += BigInt(source.fileSizeBytes);
      emitProgress(options, "import", "verifying", completedWorkBytes, totalWorkBytes, completedFiles, totalFiles);
    }

    const restoredSnapshot = PROJECT_BUNDLE_SNAPSHOT_SCHEMA.parse(snapshot);
    return {
      snapshot: restoredSnapshot,
      stagingDirectory,
      stagedSources,
      totalBytes: totalSourceBytes.toString(),
    };
  } catch (error) {
    await fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function removeProjectBundleStaging(stagingDirectory: string, userDataPath: string): Promise<void> {
  const root = path.resolve(stagingDirectory);
  const stagingRoot = path.resolve(userDataPath, "point-cloud-sources", "staging");
  const relative = path.relative(stagingRoot, root);
  if (
    !path.isAbsolute(root) ||
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    path.dirname(root) !== stagingRoot ||
    !/^bundle-[0-9a-f-]{36}$/i.test(path.basename(root))
  ) {
    throw new Error("Refusing to remove an invalid project bundle staging path.");
  }
  await fs.rm(root, { recursive: true, force: true });
}

export async function removeProjectBundleExportStaging(stagingDirectory: string, parentDirectory: string): Promise<void> {
  const root = path.resolve(stagingDirectory);
  const parent = path.resolve(parentDirectory);
  if (path.dirname(root) !== parent || !path.basename(root).startsWith(".metardu-project-")) {
    throw new Error("Refusing to remove a project bundle path outside its export staging directory.");
  }
  await fs.rm(root, { recursive: true, force: true });
}
