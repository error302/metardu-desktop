/** Zod contracts for the COGO methods exposed through the Rust sidecar. */

import { z } from "zod";

const finite = z.number().finite();
const point = z.object({
  easting: finite,
  northing: finite,
}).strict();

export const COGO_SIDECAR_PARAMS = {
  "cogo.radiation": z.object({
    origin: point,
    bearing_deg: finite.min(0).max(360),
    distance_m: finite.nonnegative(),
  }).strict(),
  "cogo.bearing_bearing": z.object({
    p1: point,
    bearing1_deg: finite.min(0).max(360),
    p2: point,
    bearing2_deg: finite.min(0).max(360),
  }).strict(),
  "cogo.distance_distance": z.object({
    p1: point,
    r1_m: finite.nonnegative(),
    p2: point,
    r2_m: finite.nonnegative(),
  }).strict(),
  "cogo.midpoint_offset": z.object({
    start: point,
    end: point,
    offset_m: finite.nonnegative(),
    side: z.enum(["left", "right"]),
  }).strict(),
  "cogo.area": z.object({
    points: z.array(z.tuple([finite, finite])).min(3).max(5_000),
  }).strict(),
} as const;

export type CogoSidecarMethod = keyof typeof COGO_SIDECAR_PARAMS;

export type CogoSidecarValidation =
  | { success: true; data: unknown }
  | { success: false; error: string }
  | null;

/** Validate the untrusted renderer payload for a COGO RPC method. */
export function validateCogoSidecarParams(method: string, params: unknown): CogoSidecarValidation {
  const schema = COGO_SIDECAR_PARAMS[method as CogoSidecarMethod];
  if (!schema) return null;
  const result = schema.safeParse(params);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    error: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
  };
}
