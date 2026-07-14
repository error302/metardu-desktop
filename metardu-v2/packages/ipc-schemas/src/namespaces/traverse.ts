/**
 * zod IPC schemas for the `traverse:*` namespace.
 *
 * 4 handlers in v1.0:
 *   - traverse:bowditch (Bowditch/Compass adjustment)
 *   - traverse:transit (Transit adjustment)
 *   - traverse:lsa (Least Squares Adjustment)
 *   - traverse:crandall (Crandall adjustment)
 *
 * Each takes a traverse with legs (bearing + distance) and returns
 * adjusted coordinates with precision statistics.
 */

import { z } from "zod";

// ─── Common types ──────────────────────────────────────────────────

/** Bearing in decimal degrees (0-360) */
export const BearingSchema = z.number().min(0).max(360);

/** Distance in meters */
export const DistanceSchema = z.number().positive().max(100_000);

/** Standard deviation of an observation (meters for distance, arcsec for angle) */
export const StdDevSchema = z.number().positive().max(1000);

/** Station ID (alphanumeric) */
export const StationIdSchema = z.string().min(1).max(50).regex(
  /^[A-Za-z0-9_\-]+$/,
  "Station ID must contain only letters, digits, underscores, and hyphens"
);

/** Coordinate (local grid or WGS84) */
export const CoordinateSchema = z.object({
  x: z.number(), // easting
  y: z.number(), // northing
  z: z.number().optional(), // elevation (optional for 2D traverses)
});

// ─── Traverse leg ──────────────────────────────────────────────────

/** A single traverse leg: from station, bearing, distance, to station */
export const TraverseLegSchema = z.object({
  /** Starting station ID */
  fromStation: StationIdSchema,
  /** Ending station ID */
  toStation: StationIdSchema,
  /** Measured bearing in decimal degrees */
  bearing: BearingSchema,
  /** Measured horizontal distance in meters */
  distance: DistanceSchema,
  /** Optional: standard deviation of bearing in arcseconds */
  bearingStdDev: StdDevSchema.optional(),
  /** Optional: standard deviation of distance in meters */
  distanceStdDev: StdDevSchema.optional(),
});

// ─── Traverse input (common to all 4 adjustment methods) ───────────

export const TraverseInputSchema = z.object({
  /** Known control points (starting and ending, or just starting for open traverse) */
  controlPoints: z.object({
    start: z.object({
      stationId: StationIdSchema,
      coordinate: CoordinateSchema,
      /** Reference bearing for the starting leg (decimal degrees) */
      referenceBearing: BearingSchema,
    }),
    end: z.object({
      stationId: StationIdSchema,
      coordinate: CoordinateSchema,
      /** Reference bearing for the ending leg (decimal degrees) */
      referenceBearing: BearingSchema,
    }).optional(), // optional = open traverse; required = closed traverse
  }),
  /** Traverse legs (at least 1) */
  legs: z.array(TraverseLegSchema).min(1).max(500),
  /** Optional: survey type (affects precision standards) */
  surveyType: z.enum(["cadastral_urban", "cadastral_rural", "engineering", "topographic", "control"]).optional(),
}).strict().refine(
  (input) => {
    // Verify leg connectivity: each leg's fromStation must be the previous leg's toStation
    // (or the start control point for the first leg)
    for (let i = 1; i < input.legs.length; i++) {
      if (input.legs[i]!.fromStation !== input.legs[i - 1]!.toStation) {
        return false;
      }
    }
    return true;
  },
  { message: "Traverse legs must be connected: each leg's fromStation must equal the previous leg's toStation" }
);

// ─── traverse:bowditch ─────────────────────────────────────────────

export const TraverseBowditchInputSchema = TraverseInputSchema;

// ─── traverse:transit ──────────────────────────────────────────────

export const TraverseTransitInputSchema = TraverseInputSchema;

// ─── traverse:lsa ──────────────────────────────────────────────────
// LSA needs the same shape as TraverseInputSchema plus convergence options.
// We can't use .extend() because TraverseInputSchema has .refine() (ZodEffects),
// so we define LSA as a fresh schema with the same shape + extra fields.

export const TraverseLsaInputSchema = z.object({
  controlPoints: z.object({
    start: z.object({
      stationId: StationIdSchema,
      coordinate: CoordinateSchema,
      referenceBearing: BearingSchema,
    }),
    end: z.object({
      stationId: StationIdSchema,
      coordinate: CoordinateSchema,
      referenceBearing: BearingSchema,
    }).optional(),
  }),
  legs: z.array(TraverseLegSchema).min(1).max(500),
  surveyType: z.enum(["cadastral_urban", "cadastral_rural", "engineering", "topographic", "control"]).optional(),
  /** Convergence tolerance for the iterative adjustment (default 1e-6) */
  convergenceTolerance: z.number().positive().max(0.1).optional(),
  /** Maximum iterations (default 50) */
  maxIterations: z.number().int().positive().max(500).optional(),
  /** Confidence level for error ellipses (default 0.95) */
  confidenceLevel: z.number().min(0.5).max(0.9999).optional(),
}).strict().refine(
  (input) => {
    for (let i = 1; i < input.legs.length; i++) {
      if (input.legs[i]!.fromStation !== input.legs[i - 1]!.toStation) {
        return false;
      }
    }
    return true;
  },
  { message: "Traverse legs must be connected: each leg's fromStation must equal the previous leg's toStation" }
);

// ─── traverse:crandall ─────────────────────────────────────────────

export const TraverseCrandallInputSchema = TraverseInputSchema;

// ─── Registry ──────────────────────────────────────────────────────

export const TRAVERSE_SCHEMAS = {
  "traverse:bowditch": TraverseBowditchInputSchema,
  "traverse:transit": TraverseTransitInputSchema,
  "traverse:lsa": TraverseLsaInputSchema,
  "traverse:crandall": TraverseCrandallInputSchema,
} as const;

export type TraverseSchemaName = keyof typeof TRAVERSE_SCHEMAS;
