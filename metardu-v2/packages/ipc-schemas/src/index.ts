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
import {
  COGO_SIDECAR_PARAMS,
  TOPOGRAPHIC_SIDECAR_PARAMS,
  SIDECAR_PARAMS,
  type CogoSidecarMethod,
  type TopographicSidecarMethod,
  type SidecarMethod,
  validateCogoSidecarParams,
  validateSidecarParams,
} from "./namespaces/cogo.js";
export {
  MAX_COMMUNITY_PLUGIN_INPUT_BYTES,
  COMMUNITY_EXTENSION_MANIFEST_SCHEMA,
  COMMUNITY_EXTENSION_PACKAGE_SHA256_SCHEMA,
  COMMUNITY_EXTENSION_PACKAGE_SUMMARY_SCHEMA,
  COMMUNITY_EXTENSION_PACKAGE_INSTALL_RESULT_SCHEMA,
  COMMUNITY_EXTENSION_PACKAGE_LIST_SCHEMA,
  COMMUNITY_EXTENSION_PACKAGE_RUN_INPUT_SCHEMA,
  PLUGIN_RUN_INPUT_SCHEMA,
} from "./namespaces/plugins.js";
export type {
  PluginRunInput,
  CommunityExtensionManifest,
  CommunityExtensionPackageSummary,
  CommunityExtensionPackageInstallResult,
  CommunityExtensionPackageList,
  CommunityExtensionPackageRunInput,
} from "./namespaces/plugins.js";
export {
  PROJECT_COORDINATE_CONTEXT_SCHEMA,
  PROJECT_HORIZONTAL_UNIT_SCHEMA,
  PROJECT_VERTICAL_REFERENCE_SCHEMA,
} from "./namespaces/project-coordinate-context.js";
export type {
  ProjectCoordinateContext,
  ProjectHorizontalUnit,
  ProjectVerticalReference,
} from "./namespaces/project-coordinate-context.js";
export {
  POINT_CLOUD_COORDINATE_CONTEXT_SCHEMA,
  POINT_CLOUD_CHUNK_MAX_POINTS,
  POINT_CLOUD_CHUNK_POINT_SCHEMA,
  POINT_CLOUD_CHUNK_STREAM_ID_SCHEMA,
  POINT_CLOUD_CHUNK_STREAM_METADATA_SCHEMA,
  POINT_CLOUD_CHUNK_STREAM_READ_SCHEMA,
  POINT_CLOUD_CHUNK_STREAM_START_SCHEMA,
  POINT_CLOUD_CHUNK_STREAM_STATUS_SCHEMA,
  POINT_CLOUD_INSPECTION_JOB_ID_SCHEMA,
  POINT_CLOUD_PREVIEW_JOB_ID_SCHEMA,
  POINT_CLOUD_PREVIEW_MAX_POINTS,
  POINT_CLOUD_PREVIEW_POINT_SCHEMA,
  POINT_CLOUD_PREVIEW_RESULT_SCHEMA,
  POINT_CLOUD_PREVIEW_START_INPUT_SCHEMA,
  POINT_CLOUD_PREVIEW_START_RESULT_SCHEMA,
  POINT_CLOUD_PREVIEW_STATUS_SCHEMA,
  POINT_CLOUD_SOURCE_ID_SCHEMA,
  POINT_CLOUD_SET_SOURCE_COORDINATE_CONTEXT_INPUT_SCHEMA,
  POINT_CLOUD_SET_SOURCE_COORDINATE_CONTEXT_RESULT_SCHEMA,
} from "./namespaces/point-cloud.js";
export type {
  PointCloudCoordinateContext,
  PointCloudChunkPoint,
  PointCloudChunkStreamMetadata,
  PointCloudChunkStreamRead,
  PointCloudChunkStreamStart,
  PointCloudChunkStreamStatus,
  PointCloudPreviewPoint,
  PointCloudPreviewResult,
  PointCloudPreviewStartResult,
  PointCloudPreviewStatus,
  PointCloudSetSourceCoordinateContextInput,
  PointCloudSetSourceCoordinateContextResult,
} from "./namespaces/point-cloud.js";
export {
  PROJECT_BUNDLE_CANCEL_INPUT_SCHEMA,
  PROJECT_BUNDLE_CANCEL_RESULT_SCHEMA,
  PROJECT_BUNDLE_EXPORT_INPUT_SCHEMA,
  PROJECT_BUNDLE_EXPORT_RESULT_SCHEMA,
  PROJECT_BUNDLE_IMPORT_INPUT_SCHEMA,
  PROJECT_BUNDLE_IMPORT_RESULT_SCHEMA,
  PROJECT_BUNDLE_MAX_MANIFEST_BYTES,
  PROJECT_BUNDLE_OPERATION_ID_SCHEMA,
  PROJECT_BUNDLE_PROGRESS_SCHEMA,
  PROJECT_BUNDLE_SNAPSHOT_SCHEMA,
} from "./namespaces/project-bundle.js";
export type {
  ProjectBundleCancelInput,
  ProjectBundleCancelResult,
  ProjectBundleExportInput,
  ProjectBundleExportResult,
  ProjectBundleImportInput,
  ProjectBundleImportResult,
  ProjectBundleProgress,
  ProjectBundleSnapshot,
} from "./namespaces/project-bundle.js";

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

export {
  COGO_SIDECAR_PARAMS,
  TOPOGRAPHIC_SIDECAR_PARAMS,
  SIDECAR_PARAMS,
  validateCogoSidecarParams,
  validateSidecarParams,
};
export type { CogoSidecarMethod, TopographicSidecarMethod, SidecarMethod };
