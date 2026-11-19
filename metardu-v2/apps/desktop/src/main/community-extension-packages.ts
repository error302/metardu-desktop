import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Readable } from "node:stream";
import * as yauzl from "yauzl";
import {
  COMMUNITY_EXTENSION_MANIFEST_SCHEMA,
  COMMUNITY_EXTENSION_PACKAGE_SHA256_SCHEMA,
  type CommunityExtensionManifest,
  type CommunityExtensionPackageSummary,
} from "@metardu/ipc-schemas";

export const MAX_COMMUNITY_EXTENSION_PACKAGE_BYTES = 9 * 1024 * 1024;
export const MAX_COMMUNITY_EXTENSION_MODULE_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_LICENSE_BYTES = 64 * 1024;
const MAX_INSTALLED_PACKAGES = 1_000;
const PACKAGE_MEMBERS = new Set(["manifest.json", "module.wasm", "LICENSE.txt"]);

export interface CommunityExtensionPackageFiles {
  manifest: CommunityExtensionManifest;
  moduleBytes: Buffer;
  licenseText: string;
  packageSha256: string;
}

export interface CommunityExtensionPackageList {
  packages: CommunityExtensionPackageSummary[];
  issues: Array<{ packageSha256: string | null; message: string }>;
}

export interface CommunityExtensionPackageInstallResult {
  package: CommunityExtensionPackageSummary;
  alreadyInstalled: boolean;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function decodeUtf8(bytes: Buffer, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must be valid UTF-8.`);
  }
}

function memberLimit(name: string): number {
  if (name === "manifest.json") return MAX_MANIFEST_BYTES;
  if (name === "module.wasm") return MAX_COMMUNITY_EXTENSION_MODULE_BYTES;
  if (name === "LICENSE.txt") return MAX_LICENSE_BYTES;
  throw new Error("Package contains an unsupported member; only manifest.json, module.wasm, and LICENSE.txt are allowed.");
}

function isRegularZipFile(entry: yauzl.Entry): boolean {
  if ((entry.externalFileAttributes & 0x10) !== 0) return false;
  const hostSystem = entry.versionMadeBy >>> 8;
  if (hostSystem !== 3) return true;
  const unixMode = entry.externalFileAttributes >>> 16;
  const type = unixMode & 0o170000;
  return type === 0 || type === 0o100000;
}

async function readPackageMembers(archiveBytes: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    let zipfile: yauzl.ZipFile | null = null;
    let activeStream: Readable | null = null;
    let finished = false;
    const files = new Map<string, Buffer>();
    const seen = new Set<string>();

    const fail = (error: Error): void => {
      if (finished) return;
      finished = true;
      activeStream?.destroy(error);
      zipfile?.close();
      reject(error);
    };

    yauzl.fromBuffer(archiveBytes, {
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true,
    }, (openError, opened) => {
      if (openError || !opened) {
        reject(new Error(`Invalid .mdplug ZIP archive${openError ? `: ${openError.message}` : "."}`));
        return;
      }
      zipfile = opened;
      if (opened.fileSize > MAX_COMMUNITY_EXTENSION_PACKAGE_BYTES || opened.entryCount !== PACKAGE_MEMBERS.size) {
        fail(new Error("Package archive size or member count is outside the ABI v1 limits."));
        return;
      }

      opened.on("error", (error) => fail(new Error(`Could not read .mdplug ZIP archive: ${error.message}`)));
      opened.on("entry", (entry) => {
        if (finished) return;
        const name = entry.fileName;
        if (!PACKAGE_MEMBERS.has(name)) {
          fail(new Error("Package contains an unsupported or path-bearing member."));
          return;
        }
        if (seen.has(name)) {
          fail(new Error(`Package contains a duplicate ${name} member.`));
          return;
        }
        seen.add(name);
        if (!isRegularZipFile(entry)) {
          fail(new Error(`Package member ${name} is not a regular file.`));
          return;
        }
        if ((entry.generalPurposeBitFlag & 0x2041) !== 0) {
          fail(new Error("Encrypted ZIP members are not supported."));
          return;
        }
        if (entry.versionNeededToExtract >= 45 || entry.compressedSize === 0xffffffff || entry.uncompressedSize === 0xffffffff) {
          fail(new Error("ZIP64 package members are not supported by ABI v1."));
          return;
        }
        if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
          fail(new Error(`Package member ${name} uses an unsupported compression method.`));
          return;
        }
        if (entry.compressedSize > MAX_COMMUNITY_EXTENSION_PACKAGE_BYTES || entry.uncompressedSize > memberLimit(name)) {
          fail(new Error(`Package member ${name} exceeds its size limit.`));
          return;
        }

        opened.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            fail(new Error(`Could not read package member ${name}${streamError ? `: ${streamError.message}` : "."}`));
            return;
          }
          activeStream = stream;
          const chunks: Buffer[] = [];
          let actualBytes = 0;
          stream.on("data", (chunk: Buffer | Uint8Array) => {
            if (finished) return;
            const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            actualBytes += part.length;
            if (actualBytes > memberLimit(name)) {
              fail(new Error(`Package member ${name} expands beyond its size limit.`));
              return;
            }
            chunks.push(part);
          });
          stream.once("error", (error: Error) => fail(new Error(`Could not decompress package member ${name}: ${error.message}`)));
          stream.once("end", () => {
            if (finished) return;
            activeStream = null;
            if (actualBytes !== entry.uncompressedSize) {
              fail(new Error(`Package member ${name} does not match its declared uncompressed size.`));
              return;
            }
            files.set(name, Buffer.concat(chunks, actualBytes));
            opened.readEntry();
          });
        });
      });
      opened.once("end", () => {
        if (finished) return;
        finished = true;
        opened.close();
        if (files.size !== PACKAGE_MEMBERS.size || [...PACKAGE_MEMBERS].some((name) => !files.has(name))) {
          reject(new Error("Package must contain exactly manifest.json, module.wasm, and LICENSE.txt."));
          return;
        }
        resolve(files);
      });
      opened.readEntry();
    });
  });
}

export async function parseCommunityExtensionPackage(archiveBytes: Buffer): Promise<CommunityExtensionPackageFiles> {
  if (!Buffer.isBuffer(archiveBytes) || archiveBytes.length < 22 || archiveBytes.length > MAX_COMMUNITY_EXTENSION_PACKAGE_BYTES) {
    throw new Error(`Package must be a ZIP file no larger than ${MAX_COMMUNITY_EXTENSION_PACKAGE_BYTES} bytes.`);
  }

  const files = await readPackageMembers(archiveBytes);
  const manifestText = decodeUtf8(files.get("manifest.json")!, "Package manifest");
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(manifestText);
  } catch {
    throw new Error("Package manifest is not valid JSON.");
  }
  const parsedManifest = COMMUNITY_EXTENSION_MANIFEST_SCHEMA.safeParse(rawManifest);
  if (!parsedManifest.success) {
    throw new Error(`Package manifest is invalid: ${parsedManifest.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  // Requiring canonical schema-ordered JSON rejects duplicate keys and ambiguous encodings.
  if (JSON.stringify(parsedManifest.data) !== manifestText) {
    throw new Error("Package manifest must use the canonical ABI v1 JSON encoding.");
  }

  const moduleBytes = files.get("module.wasm")!;
  if (moduleBytes.length < 8 || moduleBytes.length > MAX_COMMUNITY_EXTENSION_MODULE_BYTES || moduleBytes.subarray(0, 4).toString("hex") !== "0061736d") {
    throw new Error("Package module must be a WebAssembly binary between 8 bytes and 8 MiB.");
  }
  const actualModuleSha256 = sha256(moduleBytes);
  if (actualModuleSha256 !== parsedManifest.data.moduleSha256) {
    throw new Error("Package module SHA-256 does not match its manifest.");
  }

  const licenseText = decodeUtf8(files.get("LICENSE.txt")!, "Package licence");
  if (!licenseText.trim()) throw new Error("Package LICENSE.txt must not be empty.");

  return {
    manifest: parsedManifest.data,
    moduleBytes,
    licenseText,
    packageSha256: sha256(archiveBytes),
  };
}

function packageSummary(pkg: CommunityExtensionPackageFiles): CommunityExtensionPackageSummary {
  return {
    packageSha256: pkg.packageSha256,
    moduleSha256: pkg.manifest.moduleSha256,
    id: pkg.manifest.id,
    version: pkg.manifest.version,
    name: pkg.manifest.name,
    description: pkg.manifest.description,
    publisherName: pkg.manifest.publisherName,
    licenseId: pkg.manifest.licenseId,
    abiVersion: 1,
    trustState: "community-draft",
  };
}

async function boundedReadFile(filePath: string): Promise<Buffer> {
  const file = await fs.open(filePath, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 22 || stat.size > MAX_COMMUNITY_EXTENSION_PACKAGE_BYTES) {
      throw new Error("Installed package is missing or exceeds the ABI v1 size limit.");
    }
    const output = Buffer.allocUnsafe(MAX_COMMUNITY_EXTENSION_PACKAGE_BYTES + 1);
    let readTotal = 0;
    while (readTotal < output.length) {
      const { bytesRead } = await file.read(output, readTotal, output.length - readTotal, readTotal);
      if (bytesRead === 0) break;
      readTotal += bytesRead;
    }
    if (readTotal > MAX_COMMUNITY_EXTENSION_PACKAGE_BYTES) {
      throw new Error("Installed package exceeds the ABI v1 size limit.");
    }
    return Buffer.from(output.subarray(0, readTotal));
  } finally {
    await file.close();
  }
}

async function ensureDirectory(parent: string, child: string): Promise<string> {
  const directory = path.join(parent, child);
  try {
    await fs.mkdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Community package storage must be a regular app-owned directory.");
  }
  return directory;
}

export class CommunityExtensionPackageStore {
  constructor(private readonly userDataPath: string) {}

  private async packageDirectory(): Promise<string> {
    const userData = await fs.realpath(path.resolve(this.userDataPath));
    const userDataStat = await fs.stat(userData);
    if (!userDataStat.isDirectory()) throw new Error("Desktop user-data storage is unavailable.");
    const extensionRoot = await ensureDirectory(userData, "community-extensions");
    return ensureDirectory(extensionRoot, "packages");
  }

  async install(archiveBytes: Buffer): Promise<CommunityExtensionPackageInstallResult> {
    const pkg = await parseCommunityExtensionPackage(archiveBytes);
    const directory = await this.packageDirectory();
    const packagePath = path.join(directory, `${pkg.packageSha256}.mdplug`);
    try {
      const existing = await boundedReadFile(packagePath);
      const existingDigest = sha256(existing);
      if (existingDigest !== pkg.packageSha256) {
        throw new Error("A different or corrupted package already occupies this content-addressed entry.");
      }
      const checked = await parseCommunityExtensionPackage(existing);
      return { package: packageSummary(checked), alreadyInstalled: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const temporaryPath = path.join(directory, `.install-${randomUUID()}.tmp`);
    const file = await fs.open(temporaryPath, "wx", 0o600);
    try {
      await file.writeFile(archiveBytes);
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await fs.rename(temporaryPath, packagePath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return this.install(archiveBytes);
      }
      throw error;
    }
    return { package: packageSummary(pkg), alreadyInstalled: false };
  }

  async list(): Promise<CommunityExtensionPackageList> {
    const directory = await this.packageDirectory();
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
    const packages: CommunityExtensionPackageSummary[] = [];
    const issues: CommunityExtensionPackageList["issues"] = [];
    if (entries.length > MAX_INSTALLED_PACKAGES) {
      issues.push({ packageSha256: null, message: `Package store exceeds the ${MAX_INSTALLED_PACKAGES}-entry limit.` });
      return { packages, issues };
    }
    for (const entry of entries) {
      const match = /^([0-9a-f]{64})\.mdplug$/.exec(entry.name);
      if (!match || !entry.isFile()) {
        issues.push({ packageSha256: null, message: "Package store contains an unrecognized or non-file entry." });
        continue;
      }
      const packageSha256 = match[1]!;
      try {
        const archiveBytes = await boundedReadFile(path.join(directory, entry.name));
        if (sha256(archiveBytes) !== packageSha256) throw new Error("Stored bytes do not match the content-addressed package digest.");
        const pkg = await parseCommunityExtensionPackage(archiveBytes);
        packages.push(packageSummary(pkg));
      } catch (error) {
        issues.push({
          packageSha256,
          message: error instanceof Error ? error.message.slice(0, 256) : "Stored package is unreadable or invalid.",
        });
      }
    }
    return { packages, issues };
  }

  async loadForRun(packageSha256Input: unknown): Promise<CommunityExtensionPackageFiles> {
    const parsed = COMMUNITY_EXTENSION_PACKAGE_SHA256_SCHEMA.safeParse(packageSha256Input);
    if (!parsed.success) throw new Error("Community extension package digest is invalid.");
    const directory = await this.packageDirectory();
    const archiveBytes = await boundedReadFile(path.join(directory, `${parsed.data}.mdplug`));
    if (sha256(archiveBytes) !== parsed.data) {
      throw new Error("Installed package integrity check failed; the module will not run.");
    }
    const pkg = await parseCommunityExtensionPackage(archiveBytes);
    if (pkg.packageSha256 !== parsed.data) {
      throw new Error("Installed package identity changed; the module will not run.");
    }
    return pkg;
  }
}
