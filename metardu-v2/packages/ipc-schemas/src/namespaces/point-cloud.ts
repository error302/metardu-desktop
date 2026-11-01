import { z } from "zod";

/** Opaque project source identifiers accepted by point-cloud IPC routes. */
export const POINT_CLOUD_SOURCE_ID_SCHEMA = z.string().uuid();

/** Host-issued job identifiers accepted by point-cloud status/cancel routes. */
export const POINT_CLOUD_INSPECTION_JOB_ID_SCHEMA = z.string().uuid();

/** Main/sidecar UUID for a private, read-only chunk stream. */
export const POINT_CLOUD_CHUNK_STREAM_ID_SCHEMA = z.string().uuid();

/** Host-issued job ID for a bounded, read-only point-cloud viewport sample. */
export const POINT_CLOUD_PREVIEW_JOB_ID_SCHEMA = z.string().uuid();

export const POINT_CLOUD_CHUNK_MAX_POINTS = 2_048;
export const POINT_CLOUD_PREVIEW_MAX_POINTS = 25_000;

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

export const POINT_CLOUD_PREVIEW_POINT_SCHEMA = z.object({
  pointIndex: decimalCount,
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
  classification: z.number().int().min(0).max(255),
}).strict();

export const POINT_CLOUD_PREVIEW_RESULT_SCHEMA = z.object({
  sourceId: POINT_CLOUD_SOURCE_ID_SCHEMA,
  sourceFileName: z.string().min(1).max(255),
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  format: z.enum(["LAS", "LAZ"]),
  version: z.string().regex(/^1\.[0-4]$/),
  pointFormatId: z.number().int().min(0).max(10),
  declaredPointCount: decimalCount,
  decodedPointCount: decimalCount,
  samplingStride: decimalCount,
  selectedPointCount: z.number().int().min(0).max(POINT_CLOUD_PREVIEW_MAX_POINTS),
  renderedPointCount: z.number().int().min(0).max(POINT_CLOUD_PREVIEW_MAX_POINTS),
  nonFiniteSamplePointCount: z.number().int().min(0).max(POINT_CLOUD_PREVIEW_MAX_POINTS),
  samplingMethod: z.literal("systematic_source_index_stride"),
  coordinateInterpretation: z.literal(
    "LAS scale and offset applied to X/Y/Z; CRS, units, epoch and vertical reference are not interpreted.",
  ),
  points: z.array(POINT_CLOUD_PREVIEW_POINT_SCHEMA).max(POINT_CLOUD_PREVIEW_MAX_POINTS),
  warnings: z.array(z.string().min(1).max(500)).max(16),
}).strict().superRefine((result, context) => {
  const declared = BigInt(result.declaredPointCount);
  const decoded = BigInt(result.decodedPointCount);
  const stride = BigInt(result.samplingStride);
  const expectedSelected = stride > 0n && declared > 0n ? (declared + stride - 1n) / stride : 0n;
  if (decoded !== declared) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["decodedPointCount"], message: "A completed preview must decode the complete declared point range." });
  }
  if (stride === 0n) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["samplingStride"], message: "Sampling stride must be positive." });
  }
  if (BigInt(result.selectedPointCount) !== expectedSelected) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["selectedPointCount"], message: "Selected count does not match the declared source-index stride." });
  }
  if (result.renderedPointCount !== result.points.length
    || result.renderedPointCount + result.nonFiniteSamplePointCount !== result.selectedPointCount) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["points"], message: "Rendered and non-finite sample counts are inconsistent." });
  }
  let previousIndex = -1n;
  for (const [position, point] of result.points.entries()) {
    const index = BigInt(point.pointIndex);
    if (index <= previousIndex || index >= declared || index % stride !== 0n) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["points", position, "pointIndex"], message: "Sample indices must be strictly ordered, in range, and on the declared stride." });
      break;
    }
    previousIndex = index;
  }
});

export const POINT_CLOUD_PREVIEW_START_INPUT_SCHEMA = z.object({
  sourceId: POINT_CLOUD_SOURCE_ID_SCHEMA,
}).strict();

export const POINT_CLOUD_PREVIEW_START_RESULT_SCHEMA = z.object({
  jobId: POINT_CLOUD_PREVIEW_JOB_ID_SCHEMA,
  declaredPointCount: decimalCount,
  maxPreviewPoints: z.literal(POINT_CLOUD_PREVIEW_MAX_POINTS),
}).strict();

export const POINT_CLOUD_PREVIEW_STATUS_SCHEMA = z.discriminatedUnion("status", [
  z.object({
    jobId: POINT_CLOUD_PREVIEW_JOB_ID_SCHEMA,
    status: z.enum(["running", "cancelling"]),
    decodedPointCount: decimalCount,
    declaredPointCount: decimalCount,
    selectedPointCount: z.number().int().min(0).max(POINT_CLOUD_PREVIEW_MAX_POINTS),
    maxPreviewPoints: z.literal(POINT_CLOUD_PREVIEW_MAX_POINTS),
  }).strict(),
  z.object({
    jobId: POINT_CLOUD_PREVIEW_JOB_ID_SCHEMA,
    status: z.literal("completed"),
    result: POINT_CLOUD_PREVIEW_RESULT_SCHEMA,
  }).strict(),
  z.object({ jobId: POINT_CLOUD_PREVIEW_JOB_ID_SCHEMA, status: z.literal("cancelled") }).strict(),
  z.object({
    jobId: POINT_CLOUD_PREVIEW_JOB_ID_SCHEMA,
    status: z.literal("failed"),
    message: z.string().min(1).max(2_000),
  }).strict(),
]);

export type PointCloudChunkPoint = z.infer<typeof POINT_CLOUD_CHUNK_POINT_SCHEMA>;
export type PointCloudChunkStreamMetadata = z.infer<typeof POINT_CLOUD_CHUNK_STREAM_METADATA_SCHEMA>;
export type PointCloudChunkStreamStart = z.infer<typeof POINT_CLOUD_CHUNK_STREAM_START_SCHEMA>;
export type PointCloudChunkStreamRead = z.infer<typeof POINT_CLOUD_CHUNK_STREAM_READ_SCHEMA>;
export type PointCloudChunkStreamStatus = z.infer<typeof POINT_CLOUD_CHUNK_STREAM_STATUS_SCHEMA>;
export type PointCloudPreviewPoint = z.infer<typeof POINT_CLOUD_PREVIEW_POINT_SCHEMA>;
export type PointCloudPreviewResult = z.infer<typeof POINT_CLOUD_PREVIEW_RESULT_SCHEMA>;
export type PointCloudPreviewStartResult = z.infer<typeof POINT_CLOUD_PREVIEW_START_RESULT_SCHEMA>;
export type PointCloudPreviewStatus = z.infer<typeof POINT_CLOUD_PREVIEW_STATUS_SCHEMA>;
