import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type BetterSqlite3 from "better-sqlite3";
import {
  POINT_CLOUD_CHUNK_MAX_POINTS,
  type PointCloudChunkStreamMetadata,
  type PointCloudChunkStreamRead,
  type PointCloudChunkStreamStatus,
} from "@metardu/ipc-schemas";
import {
  closeDatabase,
  configureDatabasePath,
  createPointCloudSource,
  createProjectInDb,
  getActiveProjectId,
  getDatabase,
  getProject,
  listProjectPointCloudSources,
  type StoredPointCloudSource,
  type StoredProject,
} from "../main/database.js";
import { PointCloudChunkStreamController } from "../main/point-cloud-chunks.js";
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

const sidecarStreamId = "f7e7df4b-a927-4b30-909f-bb37e43f2277";
const streamMetadata: PointCloudChunkStreamMetadata = {
  format: "LAS",
  version: "1.4",
  pointFormatId: 3,
  declaredPointCount: "3",
  maxPointsPerChunk: POINT_CLOUD_CHUNK_MAX_POINTS,
  coordinateInterpretation: "LAS scale and offset applied to X/Y/Z; CRS, units, epoch and vertical reference are not interpreted.",
  supportedDimensions: [
    "pointIndex", "x", "y", "z", "intensity", "classification", "returnNumber",
    "numberOfReturns", "scanAngleDegrees", "userData", "pointSourceId", "gpsTime", "rgb", "nir",
  ],
  optionalDimensionsPresent: {
    gpsTime: true,
    rgb: true,
    nir: false,
    extraBytes: false,
    waveformPackets: false,
  },
  omittedDimensions: ["LAS point-format flags", "Extra Bytes payload values", "waveform packet data"],
};

const points = [0, 1, 2].map((index) => ({
  pointIndex: String(index),
  x: 500_000 + index,
  y: 6_000_000 + index,
  z: 100 + index,
  intensity: 200 + index,
  classification: 2,
  returnNumber: 1,
  numberOfReturns: 1,
  scanAngleDegrees: 0,
  userData: 0,
  pointSourceId: 1,
  gpsTime: index,
  rgb: { red: 100, green: 200, blue: 300 },
  nir: null,
}));

const chunks: PointCloudChunkStreamRead[] = [
  {
    status: "chunk",
    chunkIndex: "0",
    firstPointIndex: "0",
    decodedPointCount: "2",
    declaredPointCount: "3",
    points: [points[0]!, points[1]!],
  },
  {
    status: "chunk",
    chunkIndex: "1",
    firstPointIndex: "2",
    decodedPointCount: "3",
    declaredPointCount: "3",
    points: [points[2]!],
  },
  { status: "completed", decodedPointCount: "3", declaredPointCount: "3" },
];

class FakePointCloudChunkSidecar {
  running = true;
  cancellationAccepted = true;
  streamStatus: PointCloudChunkStreamStatus = {
    status: "running",
    decodedPointCount: "0",
    declaredPointCount: "3",
  };
  readonly calls: Array<{ method: string; params: unknown }> = [];
  responses: PointCloudChunkStreamRead[] = [...chunks];

  isRunning(): boolean {
    return this.running;
  }

  async call<T>(method: string, params: unknown): Promise<T> {
    this.calls.push({ method, params });
    let result: unknown;
    if (method === "pointcloud.start_chunk_stream") {
      result = { streamId: sidecarStreamId, status: "running", metadata: streamMetadata };
    } else if (method === "pointcloud.read_chunk") {
      result = this.responses.shift() ?? chunks[chunks.length - 1];
    } else if (method === "pointcloud.cancel_chunk_stream") {
      result = { accepted: this.cancellationAccepted };
    } else if (method === "pointcloud.chunk_stream_status") {
      result = this.streamStatus;
    } else {
      throw new Error(`Unexpected sidecar method: ${method}`);
    }
    return result as T;
  }
}

async function createFixture(): Promise<void> {
  configureDatabasePath(":memory:");
  database = getDatabase();
  project = createProjectInDb(database, {
    name: "Chunk stream fixture",
    countryCode: "",
    surveyType: "topographic",
    sourceView: "PointCloudView",
  });
  root = await mkdtemp(path.join(os.tmpdir(), "metardu-pointcloud-chunk-stream-"));
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
    headerJson: JSON.stringify({ format: "LAS", headerDeclaredPointCount: "3" }),
  });
  await removeStagedPointCloudSource(staged.stagingPath);
}

function makeController(sidecar: FakePointCloudChunkSidecar, now?: () => number): PointCloudChunkStreamController {
  return new PointCloudChunkStreamController({
    store: {
      getActiveProject: () => {
        const activeProjectId = getActiveProjectId(database);
        return activeProjectId ? getProject(database, activeProjectId) : null;
      },
      getSource: (projectId, sourceId) => listProjectPointCloudSources(database, projectId)
        .find((candidate) => candidate.id === sourceId),
    },
    getSidecar: () => sidecar,
    getUserDataPath: () => root,
    newStreamId: randomUUID,
    now,
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

describe("trusted project-scoped point-cloud chunk stream", () => {
  it("hash-binds chunks, enforces source indices, and verifies the source again at completion", async () => {
    const sidecar = new FakePointCloudChunkSidecar();
    const controller = makeController(sidecar);
    const opened = await controller.open(source.id);

    expect(opened.sourceSha256).toBe(source.contentSha256);
    expect(opened.metadata).toEqual(streamMetadata);
    const objectPath = pointCloudObjectPath(root, source.storageKey);
    expect(sidecar.calls[0]).toEqual({
      method: "pointcloud.start_chunk_stream",
      params: { path: objectPath },
    });

    const first = await controller.readNext(opened.streamId);
    expect(first.status).toBe("chunk");
    if (first.status !== "chunk") throw new Error("Expected the first bounded point chunk.");
    expect(first.points.map((point) => point.pointIndex)).toEqual(["0", "1"]);

    const second = await controller.readNext(opened.streamId);
    expect(second.status).toBe("chunk");
    if (second.status !== "chunk") throw new Error("Expected the second bounded point chunk.");
    expect(second.points.map((point) => point.pointIndex)).toEqual(["2"]);

    const complete = await controller.readNext(opened.streamId);
    expect(complete).toEqual({ status: "completed", decodedPointCount: "3", declaredPointCount: "3" });
    expect((await controller.status(opened.streamId)).status).toBe("completed");
  });

  it("fails before streaming when the retained object hash changed", async () => {
    const sidecar = new FakePointCloudChunkSidecar();
    const controller = makeController(sidecar);
    await writeFile(pointCloudObjectPath(root, source.storageKey), Buffer.alloc(512, 0x42));

    await expect(controller.open(source.id)).rejects.toThrow("hashMismatch");
    expect(sidecar.calls.some((call) => call.method === "pointcloud.start_chunk_stream")).toBe(false);
  });

  it("discards stream completion when the source bytes change after chunks were read", async () => {
    const sidecar = new FakePointCloudChunkSidecar();
    const controller = makeController(sidecar);
    const opened = await controller.open(source.id);
    expect((await controller.readNext(opened.streamId)).status).toBe("chunk");
    expect((await controller.readNext(opened.streamId)).status).toBe("chunk");
    await writeFile(pointCloudObjectPath(root, source.storageKey), Buffer.alloc(512, 0x42));

    const completion = await controller.readNext(opened.streamId);
    expect(completion.status).toBe("failed");
    if (completion.status === "failed") expect(completion.message).toContain("integrity");
  });

  it("cancels and discards a stream if the active project changes", async () => {
    const sidecar = new FakePointCloudChunkSidecar();
    const controller = makeController(sidecar);
    const opened = await controller.open(source.id);
    createProjectInDb(database, {
      name: "Different active project",
      countryCode: "",
      surveyType: "topographic",
      sourceView: "PointCloudView",
    });

    const result = await controller.readNext(opened.streamId);
    expect(result.status).toBe("failed");
    expect(sidecar.calls.some((call) => call.method === "pointcloud.cancel_chunk_stream")).toBe(true);
  });

  it("keeps cancellation pending until the sidecar confirms it stopped", async () => {
    const sidecar = new FakePointCloudChunkSidecar();
    const controller = makeController(sidecar);
    const opened = await controller.open(source.id);

    expect(await controller.cancel(opened.streamId)).toEqual({ accepted: true });
    expect((await controller.status(opened.streamId)).status).toBe("cancelling");

    sidecar.streamStatus = { status: "cancelled" };
    expect((await controller.status(opened.streamId)).status).toBe("cancelled");
  });

  it("expires abandoned streams and records sidecar loss as failure", async () => {
    const sidecar = new FakePointCloudChunkSidecar();
    let now = 10_000;
    const controller = makeController(sidecar, () => now);
    const opened = await controller.open(source.id);

    now += 30 * 60 * 1000;
    sidecar.streamStatus = { status: "cancelled" };
    expect((await controller.status(opened.streamId)).status).toBe("cancelled");
    expect(sidecar.calls.some((call) => call.method === "pointcloud.cancel_chunk_stream")).toBe(true);

    const next = await controller.open(source.id);
    sidecar.running = false;
    expect((await controller.readNext(next.streamId)).status).toBe("failed");
    expect((await controller.status(next.streamId)).status).toBe("failed");
  });

  it("rejects malformed IDs, concurrent streams, and invalid sidecar chunks", async () => {
    const sidecar = new FakePointCloudChunkSidecar();
    const controller = makeController(sidecar);
    await expect(controller.readNext("../../outside.las")).rejects.toThrow("identifier is invalid");

    const opened = await controller.open(source.id);
    await expect(controller.open(source.id)).rejects.toThrow("already active");
    sidecar.responses = [{
      status: "chunk",
      chunkIndex: "0",
      firstPointIndex: "9",
      decodedPointCount: "10",
      declaredPointCount: "3",
      points: [points[0]!],
    }];
    const invalid = await controller.readNext(opened.streamId);
    expect(invalid.status).toBe("failed");
    expect(sidecar.calls.some((call) => call.method === "pointcloud.cancel_chunk_stream")).toBe(true);
  });
});
