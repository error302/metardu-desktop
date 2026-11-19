import { randomUUID } from "node:crypto";
import {
  POINT_CLOUD_PREVIEW_JOB_ID_SCHEMA,
  POINT_CLOUD_PREVIEW_MAX_POINTS,
  POINT_CLOUD_SOURCE_ID_SCHEMA,
  type PointCloudChunkStreamRead,
  type PointCloudPreviewPoint,
  type PointCloudPreviewResult,
  type PointCloudPreviewStartResult,
  type PointCloudPreviewStatus,
} from "@metardu/ipc-schemas";
import type { PointCloudChunkStreamController } from "./point-cloud-chunks.js";

const MAX_PREVIEW_JOBS = 4;
const PREVIEW_JOB_TTL_MS = 15 * 60 * 1000;
const CANCEL_POLL_INTERVAL_MS = 40;

type PreviewStreamController = Pick<PointCloudChunkStreamController, "open" | "readNext" | "cancel">;

type PreviewState = "running" | "cancelling" | "completed" | "cancelled" | "failed";

interface PreviewJob {
  id: string;
  streamId: string;
  sourceId: string;
  sourceFileName: string;
  sourceSha256: string;
  format: "LAS" | "LAZ";
  version: string;
  pointFormatId: number;
  declaredPointCount: bigint;
  decodedPointCount: bigint;
  samplingStride: bigint;
  selectedPointCount: number;
  nonFiniteSamplePointCount: number;
  points: PointCloudPreviewPoint[];
  state: PreviewState;
  createdAt: number;
  result?: PointCloudPreviewResult;
}

export interface PointCloudPreviewDependencies {
  streams: PreviewStreamController;
  newJobId?: () => string;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}

function terminal(state: PreviewState): boolean {
  return state === "completed" || state === "cancelled" || state === "failed";
}

function parseSourceId(value: unknown): string {
  const parsed = POINT_CLOUD_SOURCE_ID_SCHEMA.safeParse(value);
  if (!parsed.success) throw new Error("Point-cloud source identifier is invalid.");
  return parsed.data.toLowerCase();
}

function parseJobId(value: unknown): string {
  const parsed = POINT_CLOUD_PREVIEW_JOB_ID_SCHEMA.safeParse(value);
  if (!parsed.success) throw new Error("Point-cloud preview job identifier is invalid.");
  return parsed.data.toLowerCase();
}

function toStatus(job: PreviewJob): PointCloudPreviewStatus {
  if (job.state === "completed" && job.result) {
    return { jobId: job.id, status: "completed", result: job.result };
  }
  if (job.state === "cancelled") return { jobId: job.id, status: "cancelled" };
  if (job.state === "failed") {
    return {
      jobId: job.id,
      status: "failed",
      message: "Point-cloud preview failed. No preview was published; verify the stored source and try again.",
    };
  }
  return {
    jobId: job.id,
    status: job.state === "cancelling" ? "cancelling" : "running",
    decodedPointCount: job.decodedPointCount.toString(),
    declaredPointCount: job.declaredPointCount.toString(),
    selectedPointCount: job.selectedPointCount,
    maxPreviewPoints: POINT_CLOUD_PREVIEW_MAX_POINTS,
  };
}

/**
 * Builds a bounded viewport sample from a fully decoded, project-scoped source.
 * The renderer receives no path or storage key, and no partial sample survives
 * cancellation, a point-count mismatch, a project change, or a hash failure.
 */
export class PointCloudPreviewController {
  private readonly jobs = new Map<string, PreviewJob>();
  private readonly newId: () => string;
  private readonly now: () => number;
  private readonly wait: (milliseconds: number) => Promise<void>;

  constructor(private readonly dependencies: PointCloudPreviewDependencies) {
    this.newId = dependencies.newJobId ?? randomUUID;
    this.now = dependencies.now ?? Date.now;
    this.wait = dependencies.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  private prune(): void {
    const now = this.now();
    for (const [id, job] of this.jobs) {
      if (terminal(job.state) && now - job.createdAt >= PREVIEW_JOB_TTL_MS) this.jobs.delete(id);
    }
    while (this.jobs.size >= MAX_PREVIEW_JOBS) {
      const oldestTerminal = [...this.jobs.values()]
        .filter((job) => terminal(job.state))
        .sort((left, right) => left.createdAt - right.createdAt)[0];
      if (!oldestTerminal) throw new Error("A point-cloud preview is already running.");
      this.jobs.delete(oldestTerminal.id);
    }
  }

  async start(rawSourceId: unknown): Promise<PointCloudPreviewStartResult> {
    const sourceId = parseSourceId(rawSourceId);
    if ([...this.jobs.values()].some((job) => !terminal(job.state))) {
      throw new Error("A point-cloud preview is already running.");
    }
    this.prune();

    // Opening verifies active-project membership and the full managed-source
    // digest before the sidecar starts decoding any records.
    const opened = await this.dependencies.streams.open(sourceId);
    const declaredPointCount = BigInt(opened.metadata.declaredPointCount);
    const samplingStride = declaredPointCount === 0n
      ? 1n
      : (declaredPointCount + BigInt(POINT_CLOUD_PREVIEW_MAX_POINTS) - 1n)
        / BigInt(POINT_CLOUD_PREVIEW_MAX_POINTS);
    const id = this.newId().toLowerCase();
    if (!POINT_CLOUD_PREVIEW_JOB_ID_SCHEMA.safeParse(id).success || this.jobs.has(id)) {
      await this.dependencies.streams.cancel(opened.streamId).catch(() => ({ accepted: false }));
      throw new Error("Point-cloud preview job identifier could not be safely registered.");
    }
    const job: PreviewJob = {
      id,
      streamId: opened.streamId,
      sourceId: opened.sourceId,
      sourceFileName: opened.sourceFileName,
      sourceSha256: opened.sourceSha256,
      format: opened.metadata.format,
      version: opened.metadata.version,
      pointFormatId: opened.metadata.pointFormatId,
      declaredPointCount,
      decodedPointCount: 0n,
      samplingStride,
      selectedPointCount: 0,
      nonFiniteSamplePointCount: 0,
      points: [],
      state: "running",
      createdAt: this.now(),
    };
    this.jobs.set(id, job);
    void this.consume(job);
    return {
      jobId: id,
      declaredPointCount: declaredPointCount.toString(),
      maxPreviewPoints: POINT_CLOUD_PREVIEW_MAX_POINTS,
    };
  }

  private collectChunk(job: PreviewJob, chunk: Extract<PointCloudChunkStreamRead, { status: "chunk" }>): void {
    const expectedFirstIndex = job.decodedPointCount;
    const reportedFirstIndex = BigInt(chunk.firstPointIndex);
    const reportedDecodedCount = BigInt(chunk.decodedPointCount);
    const chunkLength = BigInt(chunk.points.length);
    if (reportedFirstIndex !== expectedFirstIndex
      || reportedDecodedCount !== expectedFirstIndex + chunkLength
      || BigInt(chunk.declaredPointCount) !== job.declaredPointCount) {
      throw new Error("Point-cloud preview chunk counts are inconsistent.");
    }

    for (let index = 0; index < chunk.points.length; index++) {
      const point = chunk.points[index]!;
      const expectedIndex = expectedFirstIndex + BigInt(index);
      if (BigInt(point.pointIndex) !== expectedIndex) {
        throw new Error("Point-cloud preview source indices are inconsistent.");
      }
      if (expectedIndex % job.samplingStride !== 0n) continue;
      if (job.selectedPointCount >= POINT_CLOUD_PREVIEW_MAX_POINTS) {
        throw new Error("Point-cloud preview exceeded its bounded sample size.");
      }
      job.selectedPointCount++;
      if (point.x === null || point.y === null || point.z === null) {
        job.nonFiniteSamplePointCount++;
        continue;
      }
      job.points.push({
        pointIndex: point.pointIndex,
        x: point.x,
        y: point.y,
        z: point.z,
        classification: point.classification,
      });
    }

    job.decodedPointCount = reportedDecodedCount;
  }

  private async consume(job: PreviewJob): Promise<void> {
    try {
      while (true) {
        const read = await this.dependencies.streams.readNext(job.streamId);
        if (read.status === "chunk") {
          this.collectChunk(job, read);
          continue;
        }
        if (read.status === "cancelling") {
          job.state = "cancelling";
          await this.wait(CANCEL_POLL_INTERVAL_MS);
          continue;
        }
        if (read.status === "cancelled") {
          job.state = "cancelled";
          job.points = [];
          return;
        }
        if (read.status === "failed") throw new Error(read.message);

        const decodedPointCount = BigInt(read.decodedPointCount);
        if (decodedPointCount !== job.declaredPointCount
          || decodedPointCount !== job.decodedPointCount
          || BigInt(read.declaredPointCount) !== job.declaredPointCount) {
          throw new Error("Point-cloud preview ended before the complete declared point range was decoded.");
        }
        const warnings = [
          "This is a systematic sample of source point order; spatially ordered sources can produce a visually biased sample.",
          "METARDU assigns colors to distinguish class codes; this does not change source colors or validate classification correctness.",
          job.points.length === 0
            ? "No finite XYZ coordinates were available in the selected sample."
            : "Visualization only. Do not use this sampled viewport for measurement or survey deliverables.",
        ];
        job.result = {
          sourceId: job.sourceId,
          sourceFileName: job.sourceFileName,
          sourceSha256: job.sourceSha256,
          format: job.format,
          version: job.version,
          pointFormatId: job.pointFormatId,
          declaredPointCount: job.declaredPointCount.toString(),
          decodedPointCount: decodedPointCount.toString(),
          samplingStride: job.samplingStride.toString(),
          selectedPointCount: job.selectedPointCount,
          renderedPointCount: job.points.length,
          nonFiniteSamplePointCount: job.nonFiniteSamplePointCount,
          samplingMethod: "systematic_source_index_stride",
          coordinateInterpretation: "LAS scale and offset applied to X/Y/Z; CRS, units, epoch and vertical reference are not interpreted.",
          points: job.points,
          warnings,
        };
        job.state = "completed";
        job.points = [];
        return;
      }
    } catch {
      job.state = "failed";
      job.points = [];
      job.result = undefined;
      await this.dependencies.streams.cancel(job.streamId).catch(() => ({ accepted: false }));
    }
  }

  status(rawJobId: unknown): PointCloudPreviewStatus {
    const id = parseJobId(rawJobId);
    const job = this.jobs.get(id);
    if (!job) throw new Error("Point-cloud preview job is unknown or expired.");
    return toStatus(job);
  }

  async cancel(rawJobId: unknown): Promise<{ accepted: boolean }> {
    const id = parseJobId(rawJobId);
    const job = this.jobs.get(id);
    if (!job) throw new Error("Point-cloud preview job is unknown or expired.");
    if (terminal(job.state)) return { accepted: false };
    const result = await this.dependencies.streams.cancel(job.streamId);
    if (result.accepted && !terminal(job.state)) job.state = "cancelling";
    return result;
  }

  async cancelActive(): Promise<void> {
    const active = [...this.jobs.values()].filter((job) => !terminal(job.state));
    await Promise.all(active.map(async (job) => {
      await this.cancel(job.id).catch(() => undefined);
    }));
  }
}
