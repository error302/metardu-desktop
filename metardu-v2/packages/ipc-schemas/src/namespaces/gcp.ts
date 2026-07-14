/**
 * zod IPC schemas for the `gcp:*` namespace (Ground Control Points).
 *
 * 10 handlers in v1.0:
 *   - gcp:create (create a new GCP)
 *   - gcp:list (list GCPs in a project)
 *   - gcp:get (get a specific GCP)
 *   - gcp:update (update GCP coordinates or metadata)
 *   - gcp:delete (delete a GCP)
 *   - gcp:distribution (assess GCP distribution)
 *   - gcp:export (export GCP file in 4 formats)
 *   - gcp:verify (verify residuals against thresholds)
 *   - gcp:target.recommend (recommend target size for a given GSD)
 *   - gcp:residuals.report (generate a residuals report)
 */

import { z } from "zod";

// Re-use common types
export const LatitudeSchema = z.number().min(-90).max(90);
export const LongitudeSchema = z.number().min(-180).max(180);
export const CoordinateSchema = z.object({
  lat: LatitudeSchema,
  lng: LongitudeSchema,
});
export const DatasetIdSchema = z.string().uuid();
export const GcpIdSchema = z.string().uuid();

// ─── gcp:create ────────────────────────────────────────────────────

export const GcpCreateInputSchema = z.object({
  /** Project ID this GCP belongs to */
  projectId: z.string().uuid(),
  /** WGS84 coordinate of the GCP */
  coordinate: CoordinateSchema,
  /** Elevation in meters (AMSL) */
  elevationM: z.number(),
  /** Optional: label for the GCP (e.g., "GCP1") */
  label: z.string().min(1).max(50).optional(),
  /** Optional: is this a check point (independent accuracy verification)? */
  isCheckPoint: z.boolean().optional(),
  /** Optional: target type (physical marker on the ground) */
  targetType: z.enum(["30cm", "60cm", "100cm", "150cm", "custom"]).optional(),
  /** Optional: custom target size in cm (required if targetType is "custom") */
  customTargetSizeCm: z.number().positive().max(500).optional(),
}).strict().refine(
  (input) => input.targetType !== "custom" || input.customTargetSizeCm !== undefined,
  { message: "customTargetSizeCm is required when targetType is 'custom'" }
);

// ─── gcp:list ──────────────────────────────────────────────────────

export const GcpListInputSchema = z.object({
  projectId: z.string().uuid(),
  /** Optional: filter to only check points or only GCPs */
  isCheckPoint: z.boolean().optional(),
}).strict();

// ─── gcp:get ───────────────────────────────────────────────────────

export const GcpGetInputSchema = z.object({
  gcpId: GcpIdSchema,
}).strict();

// ─── gcp:update ────────────────────────────────────────────────────

export const GcpUpdateInputSchema = z.object({
  gcpId: GcpIdSchema,
  /** Fields to update (all optional) */
  updates: z.object({
    coordinate: CoordinateSchema.optional(),
    elevationM: z.number().optional(),
    label: z.string().min(1).max(50).optional(),
    isCheckPoint: z.boolean().optional(),
    targetType: z.enum(["30cm", "60cm", "100cm", "150cm", "custom"]).optional(),
    customTargetSizeCm: z.number().positive().max(500).optional(),
  }).strict(),
}).strict().refine(
  (input) => Object.keys(input.updates).length > 0,
  { message: "At least one field must be provided in updates" }
);

// ─── gcp:delete ────────────────────────────────────────────────────

export const GcpDeleteInputSchema = z.object({
  gcpId: GcpIdSchema,
  confirm: z.literal(true),
}).strict();

// ─── gcp:distribution ──────────────────────────────────────────────

export const GcpDistributionInputSchema = z.object({
  gcps: z.array(z.object({
    coordinate: CoordinateSchema,
    isCheckPoint: z.boolean().optional(),
  })).min(3).max(500),
  /** Survey area polygon */
  area: z.object({
    coordinates: z.array(CoordinateSchema).min(4).max(10_000),
  }),
}).strict();

// ─── gcp:export ────────────────────────────────────────────────────

export const GcpExportInputSchema = z.object({
  gcps: z.array(z.object({
    coordinate: CoordinateSchema,
    elevationM: z.number(),
    label: z.string().min(1).max(50).optional(),
    isCheckPoint: z.boolean().optional(),
  })).min(1).max(500),
  format: z.enum(["odm", "pix4d", "agisoft", "csv", "geojson"]),
  targetCrs: z.string().min(1).max(50).optional(),
}).strict();

// ─── gcp:verify ────────────────────────────────────────────────────

export const GcpVerifyInputSchema = z.object({
  residuals: z.array(z.object({
    label: z.string().min(1).max(50),
    deltaX: z.number(),
    deltaY: z.number(),
    deltaZ: z.number(),
    isCheckPoint: z.boolean(),
  })).min(3).max(500),
  gsdCmPx: z.number().positive().max(100),
}).strict();

// ─── gcp:target.recommend ──────────────────────────────────────────

export const GcpTargetRecommendInputSchema = z.object({
  gsdCmPx: z.number().positive().max(100),
}).strict();

// ─── gcp:residuals.report ──────────────────────────────────────────

export const GcpResidualsReportInputSchema = z.object({
  residuals: z.array(z.object({
    label: z.string().min(1).max(50),
    deltaX: z.number(),
    deltaY: z.number(),
    deltaZ: z.number(),
    isCheckPoint: z.boolean(),
  })).min(3).max(500),
  gsdCmPx: z.number().positive().max(100),
  /** Optional: project name for the report header */
  projectName: z.string().min(1).max(200).optional(),
  /** Optional: surveyor name for the report */
  surveyorName: z.string().min(1).max(200).optional(),
}).strict();

// ─── Registry ──────────────────────────────────────────────────────

export const GCP_SCHEMAS = {
  "gcp:create": GcpCreateInputSchema,
  "gcp:list": GcpListInputSchema,
  "gcp:get": GcpGetInputSchema,
  "gcp:update": GcpUpdateInputSchema,
  "gcp:delete": GcpDeleteInputSchema,
  "gcp:distribution": GcpDistributionInputSchema,
  "gcp:export": GcpExportInputSchema,
  "gcp:verify": GcpVerifyInputSchema,
  "gcp:target.recommend": GcpTargetRecommendInputSchema,
  "gcp:residuals.report": GcpResidualsReportInputSchema,
} as const;

export type GcpSchemaName = keyof typeof GCP_SCHEMAS;
