/**
 * MetaRDU IPC Schemas — unified zod validation for all IPC channels.
 *
 * This package closes the security gap identified in ADR-012: all 118 IPC
 * handlers in v1.0 accept `input: any`, which allows malformed payloads
 * from the renderer to crash the privileged main process or execute
 * unintended file system operations.
 *
 * Usage in the Electron main process:
 *
 * ```typescript
 * import { validateIpcInput, DRONE_SCHEMAS } from "@metardu/ipc-schemas";
 *
 * ipcMain.handle("drone:mission.plan", async (event, input) => {
 *   const validation = validateIpcInput("drone:mission.plan", input);
 *   if (!validation.success) {
 *     return { success: false, error: validation.error };
 *   }
 *   // validation.data is now typed as the correct zod inference
 *   return doMissionPlan(validation.data);
 * });
 * ```
 *
 * Usage in the renderer (preload.ts auto-generates typed wrappers):
 *
 * ```typescript
 * // preload.ts
 * import type { droneMissionPlanInput } from "@metardu/ipc-schemas";
 * contextBridge.exposeInMainWorld("metardu", {
 *   drone: {
 *     missionPlan: (input: droneMissionPlanInput) => ipcRenderer.invoke("drone:mission.plan", input),
 *   },
 * });
 * ```
 */

import { z } from "zod";
import { DRONE_SCHEMAS, type DroneSchemaName } from "./namespaces/drone.js";
import { GCP_SCHEMAS, type GcpSchemaName } from "./namespaces/gcp.js";
import { PIPELINE_SCHEMAS, type PipelineSchemaName } from "./namespaces/pipeline.js";
import { PARCEL_SCHEMAS, type ParcelSchemaName } from "./namespaces/parcel.js";
import { TRAVERSE_SCHEMAS, type TraverseSchemaName } from "./namespaces/traverse.js";

// ─── Aggregate registry ────────────────────────────────────────────

/**
 * All registered IPC schemas, keyed by channel name.
 *
 * Channel names follow the pattern `<namespace>:<action>` (e.g., "drone:mission.plan").
 * The namespace is used to organize the schemas and to dispatch to the
 * correct schema registry.
 */
export const IPC_SCHEMAS = {
  ...DRONE_SCHEMAS,
  ...GCP_SCHEMAS,
  ...PIPELINE_SCHEMAS,
  ...PARCEL_SCHEMAS,
  ...TRAVERSE_SCHEMAS,
} as const;

export type IpcChannelName =
  | DroneSchemaName
  | GcpSchemaName
  | PipelineSchemaName
  | ParcelSchemaName
  | TraverseSchemaName;

// ─── Validation function ───────────────────────────────────────────

/**
 * Result of validating an IPC input.
 *
 * On success: `{ success: true, data: <validated input> }`
 * On failure: `{ success: false, error: { code, message, details } }`
 */
export type ValidationResult =
  | { success: true; data: unknown }
  | {
      success: false;
      error: {
        code: string;
        message: string;
        details: Array<{ path: string; message: string }>;
      };
    };

/**
 * Validate an IPC input against the schema for the given channel.
 *
 * @param channel IPC channel name (e.g., "drone:mission.plan")
 * @param input The untrusted input from the renderer
 * @returns ValidationResult with either validated data or error details
 */
export function validateIpcInput(
  channel: string,
  input: unknown
): ValidationResult {
  const schema = (IPC_SCHEMAS as Record<string, z.ZodType>)[channel];

  if (!schema) {
    return {
      success: false,
      error: {
        code: "CHANNEL_NOT_REGISTERED",
        message: `No schema registered for IPC channel "${channel}"`,
        details: [],
      },
    };
  }

  const result = schema.safeParse(input);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    error: {
      code: "VALIDATION_FAILED",
      message: `Input validation failed for channel "${channel}"`,
      details: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
  };
}

// ─── List all registered channels (for debugging) ──────────────────

/**
 * List all registered IPC channel names.
 */
export function listRegisteredChannels(): string[] {
  return Object.keys(IPC_SCHEMAS).sort();
}

/**
 * Get the schema for a specific channel (for renderer-side type inference).
 */
export function getSchema(channel: string): z.ZodType | undefined {
  return (IPC_SCHEMAS as Record<string, z.ZodType>)[channel];
}

// ─── Re-export namespaces for advanced use ─────────────────────────

export * as Drone from "./namespaces/drone.js";
export * as Gcp from "./namespaces/gcp.js";
export * as Pipeline from "./namespaces/pipeline.js";
export * as Parcel from "./namespaces/parcel.js";
export * as Traverse from "./namespaces/traverse.js";

// Re-export common types
export {
  DRONE_SCHEMAS,
  GCP_SCHEMAS,
  PIPELINE_SCHEMAS,
  PARCEL_SCHEMAS,
  TRAVERSE_SCHEMAS,
};

// Re-export schema names
export type {
  DroneSchemaName,
  GcpSchemaName,
  PipelineSchemaName,
  ParcelSchemaName,
  TraverseSchemaName,
};
