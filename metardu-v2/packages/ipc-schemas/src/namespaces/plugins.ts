import { z } from "zod";

export const MAX_COMMUNITY_PLUGIN_INPUT_BYTES = 4 * 1024 * 1024;

function isBoundedJsonValue(root: unknown): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  const visited = new WeakSet<object>();
  let nodes = 0;

  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > 100_000 || current.depth > 64) return false;

    const value = current.value;
    if (value === null || typeof value === "string" || typeof value === "boolean") continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return false;
      continue;
    }
    if (typeof value !== "object") return false;
    if (visited.has(value)) return false;
    visited.add(value);

    if (Array.isArray(value)) {
      for (const child of value) pending.push({ value: child, depth: current.depth + 1 });
      continue;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const child of Object.values(value as Record<string, unknown>)) {
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }

  try {
    const serialized = JSON.stringify(root);
    return serialized !== undefined && new TextEncoder().encode(serialized).byteLength <= MAX_COMMUNITY_PLUGIN_INPUT_BYTES;
  } catch {
    return false;
  }
}

const claimedPluginId = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?){1,7}$/;
const version = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/;
const moduleToken = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha256 = /^[0-9a-f]{64}$/;

/** Manifest claims are descriptive only; ABI v1 does not authenticate publishers. */
export const COMMUNITY_EXTENSION_MANIFEST_SCHEMA = z.object({
  format: z.literal("metardu-extension"),
  formatVersion: z.literal(1),
  abiVersion: z.literal(1),
  id: z.string().regex(claimedPluginId).max(511),
  version: z.string().regex(version),
  name: z.string().trim().min(1).max(128),
  description: z.string().trim().min(1).max(2_048),
  publisherName: z.string().trim().min(1).max(128),
  licenseId: z.string().trim().min(1).max(64),
  moduleSha256: z.string().regex(sha256),
}).strict();

export const COMMUNITY_EXTENSION_PACKAGE_SHA256_SCHEMA = z.string().regex(sha256);

export const COMMUNITY_EXTENSION_PACKAGE_SUMMARY_SCHEMA = z.object({
  packageSha256: COMMUNITY_EXTENSION_PACKAGE_SHA256_SCHEMA,
  moduleSha256: z.string().regex(sha256),
  id: z.string().regex(claimedPluginId).max(511),
  version: z.string().regex(version),
  name: z.string().min(1).max(128),
  description: z.string().min(1).max(2_048),
  publisherName: z.string().min(1).max(128),
  licenseId: z.string().min(1).max(64),
  abiVersion: z.literal(1),
  trustState: z.literal("community-draft"),
}).strict();

export const COMMUNITY_EXTENSION_PACKAGE_INSTALL_RESULT_SCHEMA = z.discriminatedUnion("canceled", [
  z.object({ canceled: z.literal(true) }).strict(),
  z.object({
    canceled: z.literal(false),
    alreadyInstalled: z.boolean(),
    package: COMMUNITY_EXTENSION_PACKAGE_SUMMARY_SCHEMA,
  }).strict(),
]);

export const COMMUNITY_EXTENSION_PACKAGE_LIST_SCHEMA = z.object({
  packages: z.array(COMMUNITY_EXTENSION_PACKAGE_SUMMARY_SCHEMA).max(1_000),
  issues: z.array(z.object({
    packageSha256: COMMUNITY_EXTENSION_PACKAGE_SHA256_SCHEMA.nullable(),
    message: z.string().min(1).max(256),
  }).strict()).max(1_000),
}).strict();

export const COMMUNITY_EXTENSION_PACKAGE_RUN_INPUT_SCHEMA = z.object({
  packageSha256: COMMUNITY_EXTENSION_PACKAGE_SHA256_SCHEMA,
  input: z.unknown().refine(isBoundedJsonValue, "Input must be bounded JSON (maximum 4 MiB, 64 levels, and 100,000 values)."),
}).strict();

export const PLUGIN_RUN_INPUT_SCHEMA = z.object({
  moduleToken: z.string().regex(moduleToken),
  pluginId: z.string().regex(claimedPluginId).max(511),
  version: z.string().regex(version),
  input: z.unknown().refine(isBoundedJsonValue, "Input must be bounded JSON (maximum 4 MiB, 64 levels, and 100,000 values)."),
}).strict();

export type PluginRunInput = z.infer<typeof PLUGIN_RUN_INPUT_SCHEMA>;
export type CommunityExtensionManifest = z.infer<typeof COMMUNITY_EXTENSION_MANIFEST_SCHEMA>;
export type CommunityExtensionPackageSummary = z.infer<typeof COMMUNITY_EXTENSION_PACKAGE_SUMMARY_SCHEMA>;
export type CommunityExtensionPackageInstallResult = z.infer<typeof COMMUNITY_EXTENSION_PACKAGE_INSTALL_RESULT_SCHEMA>;
export type CommunityExtensionPackageList = z.infer<typeof COMMUNITY_EXTENSION_PACKAGE_LIST_SCHEMA>;
export type CommunityExtensionPackageRunInput = z.infer<typeof COMMUNITY_EXTENSION_PACKAGE_RUN_INPUT_SCHEMA>;
