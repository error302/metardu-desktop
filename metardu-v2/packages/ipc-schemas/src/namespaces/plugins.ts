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

export const PLUGIN_RUN_INPUT_SCHEMA = z.object({
  moduleToken: z.string().regex(moduleToken),
  pluginId: z.string().regex(claimedPluginId).max(511),
  version: z.string().regex(version),
  input: z.unknown().refine(isBoundedJsonValue, "Input must be bounded JSON (maximum 4 MiB, 64 levels, and 100,000 values)."),
}).strict();

export type PluginRunInput = z.infer<typeof PLUGIN_RUN_INPUT_SCHEMA>;
