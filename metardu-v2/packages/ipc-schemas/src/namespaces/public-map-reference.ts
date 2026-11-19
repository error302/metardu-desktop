import { z } from "zod";

const finiteNumber = z.number().finite();

export const PUBLIC_MAP_LINZ_KEY_SCHEMA = z.string()
  .trim()
  .min(16)
  .max(512)
  .regex(/^[A-Za-z0-9._~-]+$/, "LINZ API keys may contain only URL-safe characters.");

export const PUBLIC_MAP_PDOK_TILE_INPUT_SCHEMA = z.object({
  bbox3857: z.tuple([finiteNumber, finiteNumber, finiteNumber, finiteNumber])
    .refine(([minX, minY, maxX, maxY]) => minX < maxX && minY < maxY)
    .refine(([minX, minY, maxX, maxY]) =>
      [minX, minY, maxX, maxY].every((value) => Math.abs(value) <= 20_037_509),
    ),
  width: z.number().int().min(64).max(1024),
  height: z.number().int().min(64).max(1024),
}).strict();

export const PUBLIC_MAP_LINZ_PARCEL_INPUT_SCHEMA = z.object({
  // Order is west, south, east, north, all in decimal degrees.
  bbox4326: z.tuple([finiteNumber, finiteNumber, finiteNumber, finiteNumber])
    .refine(([west, south, east, north]) => west < east && south < north)
    .refine(([west, south, east, north]) =>
      west >= 165 && east <= 180 && south >= -53 && north <= -29,
      "The LINZ parcel reference is available only within its New Zealand coverage area.",
    )
    .refine(([west, south, east, north]) => east - west <= 0.5 && north - south <= 0.5,
      "Zoom in to a smaller area before requesting LINZ parcel data.",
    ),
}).strict();

export const PUBLIC_MAP_LINZ_CREDENTIAL_STATUS_SCHEMA = z.object({
  configured: z.boolean(),
  secureStorageAvailable: z.boolean(),
}).strict();

const publicPolygonGeometrySchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.unknown(),
}).strict();
const publicMultiPolygonGeometrySchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.unknown(),
}).strict();

export const PUBLIC_MAP_LINZ_FEATURE_COLLECTION_SCHEMA = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.object({
    type: z.literal("Feature"),
    id: z.union([z.string(), finiteNumber]).optional(),
    properties: z.record(z.unknown()),
    geometry: z.discriminatedUnion("type", [publicPolygonGeometrySchema, publicMultiPolygonGeometrySchema]),
  }).strict()).max(1_000),
  truncated: z.boolean(),
}).strict();

export interface PublicMapReferenceFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id?: string | number;
    properties: Record<string, unknown>;
    geometry: {
      type: "Polygon" | "MultiPolygon";
      coordinates: unknown;
    };
  }>;
  truncated: boolean;
}
