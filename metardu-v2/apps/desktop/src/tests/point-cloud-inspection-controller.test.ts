import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type BetterSqlite3 from "better-sqlite3";
import type {
  PointCloudHeaderDetails,
  PointCloudRecordInspection,
  PointCloudSourceSummary,
} from "../shared/point-cloud.js";
import {
  closeDatabase,
  configureDatabasePath,
  createPointCloudInspection,
  createPointCloudSource,
  createProjectInDb,
  getActiveProjectId,
  getDatabase,
  getProject,
  listProjectPointCloudSources,
  type StoredPointCloudSource,
  type StoredProject,
} from "../main/database.js";
import {
  PointCloudInspectionController,
  registerPointCloudInspectionIpcHandlers,
  type PointCloudInspectionInvokeHandler,
  type PointCloudInspectionStore,
} from "../main/point-cloud-inspection.js";
import {
  pointCloudObjectPath,
  publishPointCloudObject,
  removeStagedPointCloudSource,
  stagePointCloudSource,
} from "../main/point-cloud-store.js";

const roots: string[] = [];
let database: BetterSqlite3.Database;
let root: string;
let project: StoredProject;
let source: StoredPointCloudSource;

const sidecarJobId = "f7e7df4b-a927-4b30-909f-bb37e43f2277";

const report: Omit<PointCloudRecordInspection, "id" | "sourceSha256" | "inspectedAt"> = {
  format: "LAS",
  version: "1.4",
  pointFormatId: 6,
  readerVersion: "las-rs test fixture",
  headerDeclaredPointCount: "1",
  decodedPointCount: "1",
  headerCountMatchesDecoded: true,
  classificationCounts: [],
  returnCounts: [],
  numberOfReturnsCounts: [],
  headerReturnCountComparison: [],
  returnCountsMatchHeader: true,
  invalidReturnMetadataPointCount: "0",
  nonFiniteCoordinatePointCount: "0",
  decodedBounds: {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 0, y: 0, z: 0 },
  },
  headerBoundsContainDecodedPoints: true,
  coordinateInterpretation: "Source scale and offset only; CRS not interpreted.",
  warnings: [],
};

class FakePointCloudSidecar {
  running = true;
  state: Record<string, unknown> = {
    status: "running",
    decodedPointCount: "0",
    declaredPointCount: "1",
  };
  cancellationAccepted = true;
  cancellationTerminalState: "cancelled" | "completed" = "cancelled";
  beforeStatusResponse: (() => Promise<void>) | null = null;
  readonly calls: Array<{ method: string; params: unknown }> = [];

  isRunning(): boolean {
    return this.running;
  }

  async call<T>(method: string, params: unknown): Promise<T> {
    this.calls.push({ method, params });
    let result: unknown;
    if (method === "pointcloud.start_record_inspection") {
      result = { jobId: sidecarJobId };
    } else if (method === "pointcloud.cancel_record_inspection") {
      if (this.cancellationAccepted) this.state = { status: this.cancellationTerminalState };
      result = { accepted: this.cancellationAccepted };
    } else if (method === "pointcloud.record_inspection_status") {
      await this.beforeStatusResponse?.();
      result = this.state;
    } else {
      throw new Error(`Unexpected sidecar method: ${method}`);
    }
    return result as T;
  }
}

function createStore(): PointCloudInspectionStore {
  return {
    getActiveProject: () => {
      const activeProjectId = getActiveProjectId(database);
      return activeProjectId ? getProject(database, activeProjectId) : null;
    },
    getProject: (projectId) => getProject(database, projectId),
    getSource: (projectId, sourceId) => listProjectPointCloudSources(database, projectId)
      .find((candidate) => candidate.id === sourceId),
    createInspection: (input) => createPointCloudInspection(database, input),
  };
}

function sourceSummary(
  stored: StoredPointCloudSource,
  storageStatus: PointCloudSourceSummary["storageStatus"],
  recordInspection?: PointCloudRecordInspection | null,
): PointCloudSourceSummary {
  return {
    id: stored.id,
    fileName: stored.fileName,
    fileSizeBytes: stored.fileSizeBytes,
    contentSha256: stored.contentSha256,
    format: stored.format,
    importedAt: stored.importedAt,
    storageStatus,
    header: JSON.parse(stored.headerJson) as PointCloudHeaderDetails,
    recordInspection: recordInspection ?? null,
  };
}

function inspectionCount(): number {
  return (database.prepare("SELECT COUNT(*) AS count FROM point_cloud_inspections").get() as { count: number }).count;
}

async function createFixture(): Promise<void> {
  configureDatabasePath(":memory:");
  database = getDatabase();
  project = createProjectInDb(database, {
    name: "Inspection controller fixture",
    countryCode: "",
    surveyType: "topographic",
    sourceView: "PointCloudView",
  });

  root = await mkdtemp(path.join(os.tmpdir(), "metardu-pointcloud-controller-"));
  roots.push(root);
  const selectedSource = path.join(root, "source.las");
  await writeFile(selectedSource, Buffer.alloc(512, 0x37));
  const staged = await stagePointCloudSource(selectedSource, root);
  const published = await publishPointCloudObject(staged, root);
  source = createPointCloudSource(database, {
    projectId: project.id,
    fileName: staged.fileName,
    storageKey: published.storageKey,
    contentSha256: staged.contentSha256,
    fileSizeBytes: staged.fileSizeBytes,
    sourceExtension: staged.sourceExtension,
    format: "LAS",
    headerJson: JSON.stringify({
      format: "LAS",
      version: "1.4",
      headerDeclaredPointCount: "1",
    }),
  });
  await removeStagedPointCloudSource(staged.stagingPath);
}

function makeController(
  sidecar: FakePointCloudSidecar,
  store: PointCloudInspectionStore = createStore(),
): PointCloudInspectionController {
  return new PointCloudInspectionController({
    store,
    getSidecar: () => sidecar,
    getUserDataPath: () => root,
    summarizeSource: sourceSummary,
    newJobId: randomUUID,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, Math.min(milliseconds, 5))),
  });
}

beforeEach(async () => {
  await createFixture();
});

afterEach(async () => {
  closeDatabase();
  configureDatabasePath(":memory:");
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("project-scoped point-cloud inspection controller", () => {
  it("registers only the dedicated start, status, and cancel handlers", async () => {
    const sidecar = new FakePointCloudSidecar();
    const handlers = new Map<string, PointCloudInspectionInvokeHandler>();
    registerPointCloudInspectionIpcHandlers((channel, handler) => {
      handlers.set(channel, handler);
    }, makeController(sidecar));

    expect([...handlers.keys()]).toEqual([
      "metardu:pointcloud:startActiveProjectRecordInspection",
      "metardu:pointcloud:activeProjectRecordInspectionStatus",
      "metardu:pointcloud:cancelActiveProjectRecordInspection",
    ]);
    const start = handlers.get("metardu:pointcloud:startActiveProjectRecordInspection");
    expect(start).toBeDefined();
    await expect(start?.({}, source.id)).resolves.toMatchObject({ declaredPointCount: "1" });
  });

  it("rejects a source outside the active project before contacting the sidecar", async () => {
    const sidecar = new FakePointCloudSidecar();
    const controller = makeController(sidecar);
    const otherProject = createProjectInDb(database, {
      name: "Other project",
      countryCode: "",
      surveyType: "topographic",
      sourceView: "PointCloudView",
    });
    expect(otherProject.id).not.toBe(project.id);

    await expect(controller.start(source.id)).rejects.toThrow("not attached to the active project");
    expect(sidecar.calls).toEqual([]);
  });

  it("reverifies source bytes before starting a sidecar job", async () => {
    const sidecar = new FakePointCloudSidecar();
    const controller = makeController(sidecar);
    await writeFile(pointCloudObjectPath(root, source.storageKey), Buffer.alloc(512, 0x38));

    await expect(controller.start(source.id)).rejects.toThrow(/stored source is hashMismatch/);
    expect(sidecar.calls).toEqual([]);
  });

  it("checks project membership again after the asynchronous source hash completes", async () => {
    const sidecar = new FakePointCloudSidecar();
    const store = createStore();
    let sourceLookups = 0;
    const controller = makeController(sidecar, {
      ...store,
      getSource: (projectId, sourceId) => {
        sourceLookups += 1;
        return sourceLookups === 1 ? store.getSource(projectId, sourceId) : undefined;
      },
    });

    await expect(controller.start(source.id)).rejects.toThrow(/source membership changed/);
    expect(sidecar.calls).toEqual([]);
  });

  it("passes only the managed object path to the sidecar and persists a verified report once", async () => {
    const sidecar = new FakePointCloudSidecar();
    const controller = makeController(sidecar);
    const started = await controller.start(source.id);
    const startCall = sidecar.calls.find((call) => call.method === "pointcloud.start_record_inspection");
    expect(startCall).toEqual({
      method: "pointcloud.start_record_inspection",
      params: { path: pointCloudObjectPath(root, source.storageKey) },
    });
    expect(started.declaredPointCount).toBe("1");

    sidecar.state = { status: "running", decodedPointCount: "1", declaredPointCount: "1" };
    await expect(controller.status(started.jobId)).resolves.toMatchObject({ status: "running", decodedPointCount: "1" });

    sidecar.state = { status: "completed", report };
    const completed = await controller.status(started.jobId);
    expect(completed).toMatchObject({ status: "completed", source: { storageStatus: "verified" } });
    expect(inspectionCount()).toBe(1);
    await expect(controller.status(started.jobId)).resolves.toEqual(completed);
    expect(inspectionCount()).toBe(1);
  });

  it("discards a completed scan if retained source bytes change before the final hash check", async () => {
    const sidecar = new FakePointCloudSidecar();
    const controller = makeController(sidecar);
    const started = await controller.start(source.id);
    const storedPath = pointCloudObjectPath(root, source.storageKey);
    sidecar.state = { status: "completed", report };
    sidecar.beforeStatusResponse = async () => {
      sidecar.beforeStatusResponse = null;
      await writeFile(storedPath, Buffer.from("changed source bytes"));
    };

    const status = await controller.status(started.jobId);
    expect(status).toMatchObject({ status: "failed", message: expect.stringContaining("digest") });
    expect(inspectionCount()).toBe(0);
  });

  it("does not save a report when accepted cancellation races with sidecar completion", async () => {
    const sidecar = new FakePointCloudSidecar();
    const controller = makeController(sidecar);
    const started = await controller.start(source.id);
    sidecar.cancellationTerminalState = "completed";
    sidecar.state = { status: "completed", report };

    await expect(controller.cancel(started.jobId)).resolves.toEqual({ accepted: true });
    await expect(controller.status(started.jobId)).resolves.toMatchObject({ status: "cancelled" });
    expect(inspectionCount()).toBe(0);
  });

  it("cancels an inspection when the active project changes and saves no report", async () => {
    const sidecar = new FakePointCloudSidecar();
    const controller = makeController(sidecar);
    const started = await controller.start(source.id);
    sidecar.state = { status: "completed", report };
    createProjectInDb(database, {
      name: "Switched project",
      countryCode: "",
      surveyType: "topographic",
      sourceView: "PointCloudView",
    });

    const status = await controller.status(started.jobId);
    expect(status).toMatchObject({ status: "cancelled" });
    expect(sidecar.calls.some((call) => call.method === "pointcloud.cancel_record_inspection")).toBe(true);
    expect(inspectionCount()).toBe(0);
  });

  it("rejects malformed source and job IDs before sidecar use", async () => {
    const sidecar = new FakePointCloudSidecar();
    const controller = makeController(sidecar);
    await expect(controller.start("../../outside.las")).rejects.toThrow("source identifier is invalid");
    await expect(controller.status("../../outside.las")).rejects.toThrow("job identifier is invalid");
    expect(sidecar.calls).toEqual([]);
  });
});
