import { randomUUID } from "node:crypto";
import {
  POINT_CLOUD_INSPECTION_JOB_ID_SCHEMA,
  POINT_CLOUD_SOURCE_ID_SCHEMA,
} from "@metardu/ipc-schemas";
import type {
  CreatePointCloudInspectionInput,
  StoredPointCloudInspection,
  StoredPointCloudSource,
  StoredProject,
} from "./database.js";
import { pointCloudObjectPath, verifyPointCloudObject } from "./point-cloud-store.js";
import type {
  PointCloudRecordInspection,
  PointCloudRecordInspectionJobStart,
  PointCloudRecordInspectionJobStatus,
  PointCloudSourceSummary,
} from "../shared/point-cloud.js";

const MAX_POINT_CLOUD_INSPECTION_JOBS = 16;
const POINT_CLOUD_INSPECTION_JOB_TTL_MS = 30 * 60 * 1000;

type PointCloudSidecar = {
  isRunning(): boolean;
  call<T = unknown>(method: string, params: unknown, options?: { timeoutMs?: number }): Promise<T>;
};

export interface PointCloudInspectionStore {
  getActiveProject(): StoredProject | null;
  getProject(projectId: string): StoredProject | null;
  getSource(projectId: string, sourceId: string): StoredPointCloudSource | undefined;
  createInspection(input: CreatePointCloudInspectionInput): StoredPointCloudInspection;
}

export interface PointCloudInspectionDependencies {
  store: PointCloudInspectionStore;
  getSidecar(): PointCloudSidecar | null;
  getUserDataPath(): string;
  summarizeSource(
    source: StoredPointCloudSource,
    storageStatus: PointCloudSourceSummary["storageStatus"],
    recordInspection?: PointCloudRecordInspection | null,
  ): PointCloudSourceSummary;
  newJobId?: () => string;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}

type JobState = "running" | "cancelling" | "finalizing" | "completed" | "cancelled" | "failed";

interface InspectionJob {
  id: string;
  sidecarJobId: string;
  projectId: string;
  sourceId: string;
  state: JobState;
  decodedPointCount: string;
  declaredPointCount: string;
  createdAt: number;
  source?: PointCloudSourceSummary;
  message?: string;
}

function terminal(state: JobState): boolean {
  return state === "completed" || state === "cancelled" || state === "failed";
}

function sourceId(value: unknown): string {
  const parsed = POINT_CLOUD_SOURCE_ID_SCHEMA.safeParse(value);
  if (!parsed.success) throw new Error("Point-cloud source identifier is invalid.");
  return parsed.data.toLowerCase();
}

function jobId(value: unknown): string {
  const parsed = POINT_CLOUD_INSPECTION_JOB_ID_SCHEMA.safeParse(value);
  if (!parsed.success) throw new Error("Point-cloud inspection job identifier is invalid.");
  return parsed.data.toLowerCase();
}

function asStatus(job: InspectionJob): PointCloudRecordInspectionJobStatus {
  if (job.state === "completed" && job.source) return { jobId: job.id, status: "completed", source: job.source };
  if (job.state === "cancelled") return { jobId: job.id, status: "cancelled" };
  if (job.state === "failed") {
    return {
      jobId: job.id,
      status: "failed",
      message: job.message ?? "Point-cloud inspection failed. No report was saved.",
    };
  }
  return {
    jobId: job.id,
    status: job.state === "cancelling" ? "cancelling" : "running",
    decodedPointCount: job.decodedPointCount,
    declaredPointCount: job.declaredPointCount,
  };
}

/** Main-process controller for project-scoped, hash-bound LAS/LAZ record scans. */
export class PointCloudInspectionController {
  private readonly jobs = new Map<string, InspectionJob>();
  private startInFlight = false;
  private readonly newId: () => string;
  private readonly now: () => number;
  private readonly wait: (milliseconds: number) => Promise<void>;

  constructor(private readonly dependencies: PointCloudInspectionDependencies) {
    this.newId = dependencies.newJobId ?? randomUUID;
    this.now = dependencies.now ?? Date.now;
    this.wait = dependencies.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  private prune(): void {
    const now = this.now();
    for (const [id, job] of this.jobs) {
      if (terminal(job.state) && now - job.createdAt >= POINT_CLOUD_INSPECTION_JOB_TTL_MS) this.jobs.delete(id);
    }
    while (this.jobs.size >= MAX_POINT_CLOUD_INSPECTION_JOBS) {
      const oldestTerminal = [...this.jobs.values()]
        .filter((job) => terminal(job.state))
        .sort((left, right) => left.createdAt - right.createdAt)[0];
      if (!oldestTerminal) return;
      this.jobs.delete(oldestTerminal.id);
    }
  }

  private fail(job: InspectionJob, message: string): PointCloudRecordInspectionJobStatus {
    job.state = "failed";
    job.message = message;
    return asStatus(job);
  }

  private monitorCancellation(job: InspectionJob): void {
    void (async () => {
      while (job.state === "cancelling") {
        await this.wait(250);
        if (job.state !== "cancelling") return;
        const sidecar = this.dependencies.getSidecar();
        if (!sidecar || !sidecar.isRunning()) {
          this.fail(job, "The point-cloud inspection stopped because the Rust sidecar is unavailable. No report was saved.");
          return;
        }
        try {
          const state = await sidecar.call<{ status: string }>(
            "pointcloud.record_inspection_status",
            { jobId: job.sidecarJobId },
          );
          if (job.state !== "cancelling") return;
          if (state.status === "cancelled" || state.status === "completed") {
            // An accepted cancellation wins the completion-boundary race.
            job.state = "cancelled";
            return;
          }
          if (state.status === "failed") {
            this.fail(job, "Point-cloud inspection failed while stopping. No report was saved.");
            return;
          }
          if (state.status !== "running" && state.status !== "cancelling") {
            this.fail(job, "The point-cloud inspection returned an invalid cancellation state. No report was saved.");
            return;
          }
        } catch {
          this.fail(job, "The point-cloud inspection status could not be recovered. No report was saved.");
          return;
        }
      }
    })();
  }

  async start(rawSourceId: unknown): Promise<PointCloudRecordInspectionJobStart> {
    const validatedSourceId = sourceId(rawSourceId);
    const project = this.dependencies.store.getActiveProject();
    const source = project ? this.dependencies.store.getSource(project.id, validatedSourceId) : undefined;
    if (!project || !source) throw new Error("Point-cloud source is not attached to the active project.");
    const sidecar = this.dependencies.getSidecar();
    if (!sidecar || !sidecar.isRunning()) {
      throw new Error("Rust sidecar is not running; point-record inspection is unavailable.");
    }

    this.prune();
    const hasActiveJob = [...this.jobs.values()].some((job) =>
      job.state === "running" || job.state === "cancelling" || job.state === "finalizing");
    if (this.startInFlight || hasActiveJob) throw new Error("A point-cloud record inspection is already running.");

    this.startInFlight = true;
    try {
      const userDataPath = this.dependencies.getUserDataPath();
      const integrity = await verifyPointCloudObject(
        userDataPath,
        source.storageKey,
        source.contentSha256,
        source.fileSizeBytes,
      );
      if (integrity.status !== "verified") {
        throw new Error(`Point-record inspection stopped because the stored source is ${integrity.status}.`);
      }
      const sourceBeforeStart = this.dependencies.store.getSource(project.id, validatedSourceId);
      if (!sourceBeforeStart
        || sourceBeforeStart.storageKey !== source.storageKey
        || sourceBeforeStart.contentSha256 !== source.contentSha256
        || sourceBeforeStart.fileSizeBytes !== source.fileSizeBytes) {
        throw new Error("Point-cloud source membership changed before inspection started.");
      }
      if (this.dependencies.store.getActiveProject()?.id !== project.id) {
        throw new Error("The active project changed before point-record inspection started.");
      }

      const sidecarStart = await sidecar.call<{ jobId: string }>("pointcloud.start_record_inspection", {
        path: pointCloudObjectPath(userDataPath, source.storageKey),
      });
      let validatedSidecarJobId: string;
      try {
        validatedSidecarJobId = jobId(sidecarStart.jobId);
      } catch (error) {
        if (typeof sidecarStart.jobId === "string") {
          await sidecar.call("pointcloud.cancel_record_inspection", { jobId: sidecarStart.jobId }).catch(() => undefined);
        }
        throw error;
      }
      const sourceAfterStart = this.dependencies.store.getSource(project.id, validatedSourceId);
      if (this.dependencies.store.getActiveProject()?.id !== project.id
        || !sourceAfterStart
        || sourceAfterStart.storageKey !== source.storageKey
        || sourceAfterStart.contentSha256 !== source.contentSha256
        || sourceAfterStart.fileSizeBytes !== source.fileSizeBytes) {
        await sidecar.call("pointcloud.cancel_record_inspection", { jobId: validatedSidecarJobId }).catch(() => undefined);
        throw new Error("The active project or point-cloud source changed before inspection started.");
      }

      const job: InspectionJob = {
        id: this.newId().toLowerCase(),
        sidecarJobId: validatedSidecarJobId,
        projectId: project.id,
        sourceId: source.id,
        state: "running",
        decodedPointCount: "0",
        declaredPointCount: this.dependencies.summarizeSource(sourceAfterStart, "notChecked").header.headerDeclaredPointCount,
        createdAt: this.now(),
      };
      if (!POINT_CLOUD_INSPECTION_JOB_ID_SCHEMA.safeParse(job.id).success) {
        await sidecar.call("pointcloud.cancel_record_inspection", { jobId: validatedSidecarJobId }).catch(() => undefined);
        throw new Error("Point-cloud inspection job identifier generator returned an invalid identifier.");
      }
      if (this.jobs.has(job.id)) {
        await sidecar.call("pointcloud.cancel_record_inspection", { jobId: validatedSidecarJobId }).catch(() => undefined);
        throw new Error("Point-cloud inspection job identifier collision; inspection was cancelled.");
      }
      this.prune();
      this.jobs.set(job.id, job);
      return { jobId: job.id, declaredPointCount: job.declaredPointCount };
    } finally {
      this.startInFlight = false;
    }
  }

  async status(rawJobId: unknown): Promise<PointCloudRecordInspectionJobStatus> {
    const validatedJobId = jobId(rawJobId);
    const job = this.jobs.get(validatedJobId);
    if (!job) throw new Error("Point-cloud inspection job is unknown or expired.");
    if (terminal(job.state)) return asStatus(job);
    const sidecar = this.dependencies.getSidecar();
    if (!sidecar || !sidecar.isRunning()) {
      return this.fail(job, "The point-cloud inspection stopped because the Rust sidecar is unavailable. No report was saved.");
    }

    if (this.dependencies.store.getActiveProject()?.id !== job.projectId && job.state === "running") {
      try {
        const cancellation = await sidecar.call<{ accepted: boolean }>("pointcloud.cancel_record_inspection", {
          jobId: job.sidecarJobId,
        });
        if (cancellation.accepted) {
          job.state = "cancelling";
          this.monitorCancellation(job);
        }
      } catch {
        return this.fail(job, "The point-cloud inspection stopped after the active project changed. No report was saved.");
      }
    }

    let sidecarState: {
      status: string;
      decodedPointCount?: string;
      declaredPointCount?: string;
      report?: Omit<PointCloudRecordInspection, "id" | "sourceSha256" | "inspectedAt">;
      message?: string;
    };
    try {
      sidecarState = await sidecar.call("pointcloud.record_inspection_status", { jobId: job.sidecarJobId });
    } catch {
      return this.fail(job, "The point-cloud inspection status could not be recovered. No report was saved.");
    }
    if (job.state === "finalizing" || terminal(job.state)) return asStatus(job);
    if (job.state === "cancelling" && sidecarState.status !== "running" && sidecarState.status !== "cancelling") {
      if (sidecarState.status === "failed") return this.fail(job, "Point-cloud inspection failed while stopping. No report was saved.");
      if (sidecarState.status === "cancelled" || sidecarState.status === "completed") {
        job.state = "cancelled";
        return asStatus(job);
      }
      return this.fail(job, "The point-cloud inspection returned an invalid cancellation state. No report was saved.");
    }

    if (sidecarState.status === "running" || sidecarState.status === "cancelling") {
      if (sidecarState.status === "cancelling" && job.state !== "cancelling") {
        job.state = "cancelling";
        this.monitorCancellation(job);
      } else if (job.state !== "cancelling") {
        job.state = "running";
      }
      if (typeof sidecarState.decodedPointCount === "string") job.decodedPointCount = sidecarState.decodedPointCount;
      if (typeof sidecarState.declaredPointCount === "string" && sidecarState.declaredPointCount !== "0") {
        job.declaredPointCount = sidecarState.declaredPointCount;
      }
      return asStatus(job);
    }
    if (sidecarState.status === "cancelled") {
      job.state = "cancelled";
      return asStatus(job);
    }
    if (sidecarState.status === "failed") {
      return this.fail(job, sidecarState.message ?? "Point-cloud inspection failed. No report was saved.");
    }
    if (sidecarState.status !== "completed" || !sidecarState.report) {
      return this.fail(job, "The point-cloud inspection returned an invalid job state. No report was saved.");
    }

    job.state = "finalizing";
    try {
      const databaseProject = this.dependencies.store.getProject(job.projectId);
      if (this.dependencies.store.getActiveProject()?.id !== job.projectId || !databaseProject) {
        throw new Error("The active project changed during point-record inspection.");
      }
      const retainedSource = this.dependencies.store.getSource(job.projectId, job.sourceId);
      if (!retainedSource) throw new Error("The inspected source is no longer attached to its project.");
      const integrity = await verifyPointCloudObject(
        this.dependencies.getUserDataPath(),
        retainedSource.storageKey,
        retainedSource.contentSha256,
        retainedSource.fileSizeBytes,
      );
      if (integrity.status !== "verified") throw new Error("The retained source digest no longer matches its project record.");
      if (this.dependencies.store.getActiveProject()?.id !== job.projectId) {
        throw new Error("The active project changed while the retained source was being rechecked.");
      }
      if (typeof sidecarState.report.readerVersion !== "string"
        || typeof sidecarState.report.decodedPointCount !== "string") {
        throw new Error("The sidecar inspection report is incomplete.");
      }

      const storedInspection: StoredPointCloudInspection = this.dependencies.store.createInspection({
        sourceId: retainedSource.id,
        sourceSha256: retainedSource.contentSha256,
        readerVersion: sidecarState.report.readerVersion,
        inspectionJson: JSON.stringify(sidecarState.report),
      });
      const refreshedSource = this.dependencies.store.getSource(job.projectId, retainedSource.id);
      if (!refreshedSource) throw new Error("The inspected source is no longer attached to its project.");
      const recordInspection: PointCloudRecordInspection = {
        ...sidecarState.report,
        id: storedInspection.id,
        sourceSha256: storedInspection.sourceSha256,
        inspectedAt: storedInspection.inspectedAt,
      };
      job.source = this.dependencies.summarizeSource(refreshedSource, "verified", recordInspection);
      job.state = "completed";
    } catch (error) {
      return this.fail(job, `${error instanceof Error ? error.message : String(error)} No report was saved.`);
    }
    return asStatus(job);
  }

  async cancel(rawJobId: unknown): Promise<{ accepted: boolean }> {
    const validatedJobId = jobId(rawJobId);
    const job = this.jobs.get(validatedJobId);
    if (!job) throw new Error("Point-cloud inspection job is unknown or expired.");
    if (job.state === "cancelling") return { accepted: true };
    if (job.state !== "running") return { accepted: false };
    const sidecar = this.dependencies.getSidecar();
    if (!sidecar || !sidecar.isRunning()) {
      this.fail(job, "The point-cloud inspection stopped because the Rust sidecar is unavailable. No report was saved.");
      return { accepted: false };
    }
    try {
      const result = await sidecar.call<{ accepted: boolean }>("pointcloud.cancel_record_inspection", {
        jobId: job.sidecarJobId,
      });
      if (result.accepted) {
        job.state = "cancelling";
        this.monitorCancellation(job);
      }
      return { accepted: result.accepted };
    } catch {
      this.fail(job, "The point-cloud inspection could not be cancelled because the sidecar is unavailable. No report was saved.");
      return { accepted: false };
    }
  }
}

export type PointCloudInspectionInvokeHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

/** Keep inspection routes as three dedicated Electron IPC channels. */
export function registerPointCloudInspectionIpcHandlers(
  register: (channel: string, handler: PointCloudInspectionInvokeHandler) => void,
  controller: PointCloudInspectionController,
): void {
  register("metardu:pointcloud:startActiveProjectRecordInspection", (_event, sourceId) => controller.start(sourceId));
  register("metardu:pointcloud:activeProjectRecordInspectionStatus", (_event, jobId) => controller.status(jobId));
  register("metardu:pointcloud:cancelActiveProjectRecordInspection", (_event, jobId) => controller.cancel(jobId));
}
