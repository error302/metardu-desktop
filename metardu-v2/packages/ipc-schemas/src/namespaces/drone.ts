/**
 * zod IPC schemas for the `drone:*` namespace.
 *
 * The drone namespace has 14 handlers in v1.0, covering:
 *   - drone:imagery.import (ODM, Pix4D, Agisoft project import)
 *   - drone:imagery.list (list imported datasets)
 *   - drone:imagery.get (get a specific dataset)
 *   - drone:imagery.delete (delete a dataset)
 *   - drone:volume.stockpile (compute stockpile volume from DSM)
 *   - drone:volume.cutFill (compute cut/fill between two DSMs)
 *   - drone:contours.generate (generate contours from DSM)
 *   - drone:features.extract (extract building/road footprints)
 *   - drone:mission.plan (generate a flight plan)
 *   - drone:mission.export (export mission to KMZ/waypoints/etc.)
 *   - drone:mission.import (import a mission file)
 *   - drone:gcp.distribution (assess GCP distribution)
 *   - drone:gcp.export (export GCP file)
 *   - drone:gcp.verify (verify GCP residuals)
 *
 * Each schema defines the input shape that the renderer must send.
 * The privileged main process validates against this schema before
 * any business logic runs.
 */

import { z } from "zod";

// ─── Common types ──────────────────────────────────────────────────

/** WGS84 latitude in decimal degrees (-90 to 90) */
export const LatitudeSchema = z.number().min(-90).max(90);
/** WGS84 longitude in decimal degrees (-180 to 180) */
export const LongitudeSchema = z.number().min(-180).max(180);
/** Altitude in meters (above ground or sea level, depending on context) */
export const AltitudeSchema = z.number().positive().max(10_000);
/** Fraction 0-1 (used for overlaps) */
export const FractionSchema = z.number().min(0).max(1);
/** Positive distance in meters */
export const DistanceMetersSchema = z.number().positive().max(100_000);
/** Camera ID (must match an entry in the camera database) */
export const CameraIdSchema = z.string().min(1).max(100);
/** Survey dataset ID (UUID or similar) */
export const DatasetIdSchema = z.string().uuid();
/** File path (validated on the privileged side against an allowlist) */
export const FilePathSchema = z.string().min(1).max(1024);

/** WGS84 coordinate */
export const CoordinateSchema = z.object({
  lat: LatitudeSchema,
  lng: LongitudeSchema,
});

/** Survey area polygon (closed: first point === last point, ≥4 vertices) */
export const SurveyAreaSchema = z.object({
  coordinates: z.array(CoordinateSchema).min(4).max(10_000),
}).refine(
  (area) => {
    const coords = area.coordinates;
    const first = coords[0];
    const last = coords[coords.length - 1];
    return first && last && first.lat === last.lat && first.lng === last.lng;
  },
  { message: "Survey area polygon must be closed (first point must equal last point)" }
);

/** Supported drone mission export formats */
export const MissionExportFormatSchema = z.enum([
  "dji-kmz",
  "ardupilot-waypoints",
  "litchi-csv",
  "sensefly-xml",
  "kml",
]);

/** Supported drone mission import formats */
export const MissionImportFormatSchema = z.enum([
  "dji-kmz",
  "ardupilot-waypoints",
  "litchi-csv",
  "sensefly-xml",
  "kml",
]);

// ─── drone:imagery.import ──────────────────────────────────────────

export const DroneImageryImportInputSchema = z.object({
  /** Path to the ODM/Pix4D/Agisoft project directory or quality report */
  projectPath: FilePathSchema,
  /** Source tool that produced the project */
  source: z.enum(["odm", "pix4d", "agisoft", "drone deploy"]),
  /** Optional: user-friendly name for the dataset */
  name: z.string().min(1).max(200).optional(),
});

// ─── drone:imagery.list ────────────────────────────────────────────

export const DroneImageryListInputSchema = z.object({
  /** Optional: filter by source tool */
  source: z.enum(["odm", "pix4d", "agisoft", "drone deploy"]).optional(),
  /** Optional: pagination limit (default 50, max 500) */
  limit: z.number().int().positive().max(500).optional(),
  /** Optional: pagination offset */
  offset: z.number().int().nonnegative().optional(),
}).strict();

// ─── drone:imagery.get ─────────────────────────────────────────────

export const DroneImageryGetInputSchema = z.object({
  datasetId: DatasetIdSchema,
}).strict();

// ─── drone:imagery.delete ──────────────────────────────────────────

export const DroneImageryDeleteInputSchema = z.object({
  datasetId: DatasetIdSchema,
  /** Confirmation flag to prevent accidental deletion */
  confirm: z.literal(true),
}).strict();

// ─── drone:volume.stockpile ────────────────────────────────────────

export const DroneVolumeStockpileInputSchema = z.object({
  /** DSM points as a flat array [x1, y1, z1, x2, y2, z2, ...] */
  dsmPoints: z.array(z.number()).min(9), // at least 3 points
  /** Boundary polygon defining the stockpile base */
  boundary: z.array(CoordinateSchema).min(3).max(1000),
  /** Reference plane method for volume calculation */
  referencePlaneMethod: z.enum([
    "lowest_point",
    "average_boundary",
    "user_specified",
    "tin_base",
  ]),
  /** Optional: user-specified reference elevation (for "user_specified" method) */
  userSpecifiedElevation: z.number().optional(),
}).strict().refine(
  (input) => input.dsmPoints.length % 3 === 0,
  { message: "dsmPoints must be a flat array of [x, y, z] triplets (length divisible by 3)" }
);

// ─── drone:volume.cutFill ──────────────────────────────────────────

export const DroneVolumeCutFillInputSchema = z.object({
  /** Existing surface DSM points */
  existingDsm: z.array(z.number()).min(9),
  /** Proposed surface DSM points */
  proposedDsm: z.array(z.number()).min(9),
}).strict().refine(
  (input) => input.existingDsm.length % 3 === 0 && input.proposedDsm.length % 3 === 0,
  { message: "DSM arrays must be flat arrays of [x, y, z] triplets" }
);

// ─── drone:contours.generate ───────────────────────────────────────

export const DroneContoursGenerateInputSchema = z.object({
  /** Path to the DSM GeoTIFF file */
  dsmPath: FilePathSchema,
  /** Contour interval in meters (e.g., 0.5 for 50cm contours) */
  interval: z.number().positive().max(100),
  /** Optional: minimum contour length to include (filters out tiny artifacts) */
  minLength: z.number().nonnegative().max(1000).optional(),
  /** Optional: smoothing factor (0 = no smoothing, 1 = max smoothing) */
  smoothing: FractionSchema.optional(),
}).strict();

// ─── drone:features.extract ────────────────────────────────────────

export const DroneFeaturesExtractInputSchema = z.object({
  /** Path to the orthophoto GeoTIFF */
  orthophotoPath: FilePathSchema,
  /** Feature type to extract */
  featureType: z.enum(["buildings", "roads", "vehicles", "changes"]),
  /** Optional: model to use (defaults to bundled model) */
  modelId: z.string().min(1).max(100).optional(),
  /** Optional: confidence threshold (0-1, default 0.5) */
  confidenceThreshold: FractionSchema.optional(),
  /** Optional: for "changes" feature type, the previous orthophoto path */
  previousOrthophotoPath: FilePathSchema.optional(),
}).strict().refine(
  (input) => input.featureType !== "changes" || input.previousOrthophotoPath !== undefined,
  { message: "previousOrthophotoPath is required when featureType is 'changes'" }
);

// ─── drone:mission.plan ────────────────────────────────────────────

export const DroneMissionPlanInputSchema = z.object({
  /** Camera to use for the mission */
  cameraId: CameraIdSchema,
  /** Target altitude above ground level (meters) */
  altitudeM: AltitudeSchema,
  /** Front overlap fraction (0-1, e.g., 0.75 for 75%) */
  frontOverlap: FractionSchema,
  /** Side overlap fraction (0-1, e.g., 0.65 for 65%) */
  sideOverlap: FractionSchema,
  /** Survey area polygon */
  area: SurveyAreaSchema,
  /** Optional: margin to extend beyond the survey area (default 0.1 = 10%) */
  margin: FractionSchema.optional(),
  /** Optional: flight line angle in degrees (0 = auto) */
  flightLineAngle: z.number().min(0).max(360).optional(),
}).strict();

// ─── drone:mission.export ──────────────────────────────────────────

export const DroneMissionExportInputSchema = z.object({
  /** Waypoints to export (must have at least 1) */
  waypoints: z.array(z.object({
    index: z.number().int().nonnegative(),
    latitude: LatitudeSchema,
    longitude: LongitudeSchema,
    altitudeMeters: AltitudeSchema,
    flightLine: z.number().int().nonnegative(),
    isPhoto: z.boolean(),
    headingDegrees: z.number().min(0).max(360).optional(),
    speedMs: z.number().positive().max(100).optional(),
    gimbalPitchDegrees: z.number().min(-90).max(90).optional(),
  })).min(1).max(10_000),
  /** Export format */
  format: MissionExportFormatSchema,
  /** Optional: format-specific options */
  options: z.record(z.string(), z.unknown()).optional(),
}).strict();

// ─── drone:mission.import ──────────────────────────────────────────

export const DroneMissionImportInputSchema = z.object({
  /** Import format */
  format: MissionImportFormatSchema,
  /** File content as text (for text formats) or base64 (for binary KMZ) */
  content: z.string().min(1).max(50_000_000), // 50 MB max
  /** True if content is base64-encoded (for KMZ binary) */
  isBase64: z.boolean().optional(),
}).strict();

// ─── drone:gcp.distribution ───────────────────────────────────────

export const DroneGcpDistributionInputSchema = z.object({
  /** GCP coordinates */
  gcps: z.array(z.object({
    coordinate: CoordinateSchema,
    isCheckPoint: z.boolean().optional(),
  })).min(3).max(500),
  /** Survey area polygon */
  area: SurveyAreaSchema,
}).strict();

// ─── drone:gcp.export ──────────────────────────────────────────────

export const DroneGcpExportInputSchema = z.object({
  /** GCPs to export */
  gcps: z.array(z.object({
    coordinate: CoordinateSchema,
    label: z.string().min(1).max(50).optional(),
    isCheckPoint: z.boolean().optional(),
  })).min(1).max(500),
  /** Export format */
  format: z.enum(["odm", "pix4d", "agisoft", "csv", "geojson"]),
  /** Optional: target CRS (default WGS84) */
  targetCrs: z.string().min(1).max(50).optional(),
}).strict();

// ─── drone:gcp.verify ──────────────────────────────────────────────

export const DroneGcpVerifyInputSchema = z.object({
  /** GCP residuals (observed - computed) */
  residuals: z.array(z.object({
    label: z.string().min(1).max(50),
    deltaX: z.number(), // meters
    deltaY: z.number(),
    deltaZ: z.number(),
    isCheckPoint: z.boolean(),
  })).min(3).max(500),
  /** Target GSD in cm/px (used for threshold: horizontal ≤ 2×GSD, vertical ≤ 3×GSD) */
  gsdCmPx: z.number().positive().max(100),
}).strict();

// ─── Export all schemas as a registry ──────────────────────────────

export const DRONE_SCHEMAS = {
  "drone:imagery.import": DroneImageryImportInputSchema,
  "drone:imagery.list": DroneImageryListInputSchema,
  "drone:imagery.get": DroneImageryGetInputSchema,
  "drone:imagery.delete": DroneImageryDeleteInputSchema,
  "drone:volume.stockpile": DroneVolumeStockpileInputSchema,
  "drone:volume.cutFill": DroneVolumeCutFillInputSchema,
  "drone:contours.generate": DroneContoursGenerateInputSchema,
  "drone:features.extract": DroneFeaturesExtractInputSchema,
  "drone:mission.plan": DroneMissionPlanInputSchema,
  "drone:mission.export": DroneMissionExportInputSchema,
  "drone:mission.import": DroneMissionImportInputSchema,
  "drone:gcp.distribution": DroneGcpDistributionInputSchema,
  "drone:gcp.export": DroneGcpExportInputSchema,
  "drone:gcp.verify": DroneGcpVerifyInputSchema,
} as const;

export type DroneSchemaName = keyof typeof DRONE_SCHEMAS;
