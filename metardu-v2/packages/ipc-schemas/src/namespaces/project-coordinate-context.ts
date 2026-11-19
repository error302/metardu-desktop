import { z } from "zod";

export const PROJECT_HORIZONTAL_UNIT_SCHEMA = z.enum([
  "metre",
  "international_foot",
  "us_survey_foot",
  "degree",
  "unknown",
]);

export const PROJECT_VERTICAL_REFERENCE_SCHEMA = z.object({
  kind: z.enum(["ellipsoidal", "orthometric", "local", "other"]),
  name: z.string().trim().min(1).max(200),
  unit: z.enum(["metre", "international_foot", "us_survey_foot", "unknown"]),
}).strict();

/**
 * User-entered project context only. This metadata does not validate a CRS,
 * establish a vertical datum, or authorize a coordinate transformation.
 */
export const PROJECT_COORDINATE_CONTEXT_SCHEMA = z.object({
  schemaVersion: z.literal(1),
  horizontalUnit: PROJECT_HORIZONTAL_UNIT_SCHEMA,
  coordinateEpoch: z.number().finite().positive().nullable(),
  verticalReference: PROJECT_VERTICAL_REFERENCE_SCHEMA.nullable(),
  evidenceStatus: z.literal("user_declared_unverified"),
}).strict();

export type ProjectHorizontalUnit = z.infer<typeof PROJECT_HORIZONTAL_UNIT_SCHEMA>;
export type ProjectVerticalReference = z.infer<typeof PROJECT_VERTICAL_REFERENCE_SCHEMA>;
export type ProjectCoordinateContext = z.infer<typeof PROJECT_COORDINATE_CONTEXT_SCHEMA>;
