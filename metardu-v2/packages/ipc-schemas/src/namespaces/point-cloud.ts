import { z } from "zod";

/** Opaque project source identifiers accepted by point-cloud IPC routes. */
export const POINT_CLOUD_SOURCE_ID_SCHEMA = z.string().uuid();

/** Host-issued job identifiers accepted by point-cloud status/cancel routes. */
export const POINT_CLOUD_INSPECTION_JOB_ID_SCHEMA = z.string().uuid();

/** Main/sidecar UUID for a private, read-only chunk stream. */
export const POINT_CLOUD_CHUNK_STREAM_ID_SCHEMA = z.string().uuid();

export const POINT_CLOUD_CHUNK_MAX_POINTS = 2_048;

const decimalCount = z.string().regex(/^(0|[1-9]\d*)$/);
const optionalU16 = z.number().int().min(0).max(65_535).nullable();

export const POINT_CLOUD_CHUNK_STREAM_METADATA_SCHEMA = z.object({
  format: z.enum(["LAS", "LAZ"]),
  version: z.string().regex(/^1\.[0-4]$/),
  pointFormatId: z.number().int().min(0).max(10),
  declaredPointCount: decimalCount,
  maxPointsPerChunk: z.literal(POINT_CLOUD_CHUNK_MAX_POINTS),
  coordinateInterpretation: z.literal(
    "LAS scale and offset applied to X/Y/Z; CRS, units, epoch and vertical reference are not interpreted.",
  ),
  supportedDimensions: z.array(z.string()).max(32),
  optionalDimensionsPresent: z.object({
    gpsTime: z.boolean(),
    rgb: z.boolean(),
    nir: z.boolean(),
    extraBytes: z.boolean(),
    waveformPackets: z.boolean(),
  }).strict(),
  omittedDimensions: z.array(z.string()).max(32),
}).strict();

export const POINT_CLOUD_CHUNK_POINT_SCHEMA = z.object({
  pointIndex: decimalCount,
  x: z.number().finite().nullable(),
  y: z.number().finite().nullable(),
  z: z.number().finite().nullable(),
  intensity: z.number().int().min(0).max(65_535),
  classification: z.number().int().min(0).max(255),
  returnNumber: z.number().int().min(0).max(15),
  numberOfReturns: z.number().int().min(0).max(15),
  scanAngleDegrees: z.number().finite(),
  userData: z.number().int().min(0).max(255),
  pointSourceId: z.number().int().min(0).max(65_535),
  gpsTime: z.number().finite().nullable(),
  rgb: z.object({
    red: z.number().int().min(0).max(65_535),
    green: z.number().int().min(0).max(65_535),
    blue: z.number().int().min(0).max(65_535),
  }).strict().nullable(),
  nir: optionalU16,
}).strict();

export const POINT_CLOUD_CHUNK_STREAM_START_SCHEMA = z.object({
  streamId: POINT_CLOUD_CHUNK_STREAM_ID_SCHEMA,
  status: z.literal("running"),
  metadata: POINT_CLOUD_CHUNK_STREAM_METADATA_SCHEMA,
}).strict();

export const POINT_CLOUD_CHUNK_STREAM_READ_SCHEMA = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("chunk"),
    chunkIndex: decimalCount,
    firstPointIndex: decimalCount,
    decodedPointCount: decimalCount,
    declaredPointCount: decimalCount,
    points: z.array(POINT_CLOUD_CHUNK_POINT_SCHEMA)
      .min(1)
      .max(POINT_CLOUD_CHUNK_MAX_POINTS),
  }).strict(),
  z.object({
    status: z.literal("completed"),
    decodedPointCount: decimalCount,
    declaredPointCount: decimalCount,
  }).strict(),
  z.object({ status: z.literal("cancelling") }).strict(),
  z.object({ status: z.literal("cancelled") }).strict(),
  z.object({ status: z.literal("failed"), message: z.string().min(1).max(2_000) }).strict(),
]);

export const POINT_CLOUD_CHUNK_STREAM_STATUS_SCHEMA = z.discriminatedUnion("status", [
  z.object({ status: z.literal("opening") }).strict(),
  z.object({
    status: z.literal("running"),
    decodedPointCount: decimalCount,
    declaredPointCount: decimalCount,
  }).strict(),
  z.object({
    status: z.literal("cancelling"),
    decodedPointCount: decimalCount,
    declaredPointCount: decimalCount,
  }).strict(),
  z.object({
    status: z.literal("completed"),
    decodedPointCount: decimalCount,
    declaredPointCount: decimalCount,
  }).strict(),
  z.object({ status: z.literal("cancelled") }).strict(),
  z.object({ status: z.literal("failed"), message: z.string().min(1).max(2_000) }).strict(),
]);

export type PointCloudChunkPoint = z.infer<typeof POINT_CLOUD_CHUNK_POINT_SCHEMA>;
export type PointCloudChunkStreamMetadata = z.infer<typeof POINT_CLOUD_CHUNK_STREAM_METADATA_SCHEMA>;
export type PointCloudChunkStreamStart = z.infer<typeof POINT_CLOUD_CHUNK_STREAM_START_SCHEMA>;
export type PointCloudChunkStreamRead = z.infer<typeof POINT_CLOUD_CHUNK_STREAM_READ_SCHEMA>;
export type PointCloudChunkStreamStatus = z.infer<typeof POINT_CLOUD_CHUNK_STREAM_STATUS_SCHEMA>;
