/**
 * zod IPC schemas for the `parcel:*` namespace (Cadastral parcels).
 *
 * 5 handlers in v1.0:
 *   - parcel:create (create a new parcel)
 *   - parcel:list (list parcels in a project)
 *   - parcel:get (get a specific parcel)
 *   - parcel:update (update parcel metadata)
 *   - parcel:title.lookup (lookup title chain via ArdhiSasa)
 */

import { z } from "zod";

export const LatitudeSchema = z.number().min(-90).max(90);
export const LongitudeSchema = z.number().min(-180).max(180);

/** Kenya parcel reference number (LR number, e.g., "209/12345") */
export const LrNumberSchema = z.string()
  .min(1).max(50)
  .regex(/^[A-Z0-9\/\-]+$/, "LR number must contain only uppercase letters, digits, slashes, and hyphens");

/** Parcel ID (UUID) */
export const ParcelIdSchema = z.string().uuid();

/** Coordinate */
export const CoordinateSchema = z.object({
  lat: LatitudeSchema,
  lng: LongitudeSchema,
});

// ─── parcel:create ─────────────────────────────────────────────────

export const ParcelCreateInputSchema = z.object({
  projectId: z.string().uuid(),
  /** LR (Land Reference) number */
  lrNumber: LrNumberSchema,
  /** Parcel boundary polygon (closed) */
  boundary: z.object({
    coordinates: z.array(CoordinateSchema).min(4).max(10_000),
  }),
  /** Optional: parcel area in hectares (computed from boundary if omitted) */
  areaHectares: z.number().positive().max(100_000).optional(),
  /** Optional: parcel type */
  parcelType: z.enum([
    "residential",
    "commercial",
    "industrial",
    "agricultural",
    "institutional",
    "public_utility",
    "transport",
    "conservation",
    "mixed_use",
  ]).optional(),
  /** Optional: county (Kenya) */
  county: z.string().min(1).max(100).optional(),
  /** Optional: sub-county / constituency */
  subCounty: z.string().min(1).max(100).optional(),
  /** Optional: ward */
  ward: z.string().min(1).max(100).optional(),
}).strict();

// ─── parcel:list ───────────────────────────────────────────────────

export const ParcelListInputSchema = z.object({
  projectId: z.string().uuid(),
  /** Optional: filter by parcel type */
  parcelType: z.enum([
    "residential", "commercial", "industrial", "agricultural",
    "institutional", "public_utility", "transport", "conservation", "mixed_use",
  ]).optional(),
  /** Optional: filter by county */
  county: z.string().min(1).max(100).optional(),
}).strict();

// ─── parcel:get ────────────────────────────────────────────────────

export const ParcelGetInputSchema = z.object({
  parcelId: ParcelIdSchema,
}).strict();

// ─── parcel:update ─────────────────────────────────────────────────

export const ParcelUpdateInputSchema = z.object({
  parcelId: ParcelIdSchema,
  updates: z.object({
    lrNumber: LrNumberSchema.optional(),
    boundary: z.object({
      coordinates: z.array(CoordinateSchema).min(4).max(10_000),
    }).optional(),
    parcelType: z.enum([
      "residential", "commercial", "industrial", "agricultural",
      "institutional", "public_utility", "transport", "conservation", "mixed_use",
    ]).optional(),
    county: z.string().min(1).max(100).optional(),
    subCounty: z.string().min(1).max(100).optional(),
    ward: z.string().min(1).max(100).optional(),
  }).strict(),
}).strict().refine(
  (input) => Object.keys(input.updates).length > 0,
  { message: "At least one field must be provided in updates" }
);

// ─── parcel:title.lookup ───────────────────────────────────────────

export const ParcelTitleLookupInputSchema = z.object({
  /** LR number to lookup */
  lrNumber: LrNumberSchema,
  /** Optional: ArdhiSasa API credentials (if not using app-wide credentials) */
  credentials: z.object({
    apiKey: z.string().min(1).max(200),
    tenantId: z.string().min(1).max(100),
  }).optional(),
}).strict();

// ─── Registry ──────────────────────────────────────────────────────

export const PARCEL_SCHEMAS = {
  "parcel:create": ParcelCreateInputSchema,
  "parcel:list": ParcelListInputSchema,
  "parcel:get": ParcelGetInputSchema,
  "parcel:update": ParcelUpdateInputSchema,
  "parcel:title.lookup": ParcelTitleLookupInputSchema,
} as const;

export type ParcelSchemaName = keyof typeof PARCEL_SCHEMAS;
