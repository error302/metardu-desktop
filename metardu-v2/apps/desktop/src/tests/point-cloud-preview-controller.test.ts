import { describe, expect, it } from "vitest";
import {
  POINT_CLOUD_CHUNK_MAX_POINTS,
  POINT_CLOUD_PREVIEW_MAX_POINTS,
  type PointCloudChunkStreamMetadata,
  type PointCloudChunkStreamRead,
  type PointCloudPreviewStatus,
} from "@metardu/ipc-schemas";
import { PointCloudPreviewController } from "../main/point-cloud-preview.js";

const sourceId = "9eac1ac4-4c7b-4df5-9e9e-5f9709ec1368";
const streamId = "3fe8a234-fc65-4c03-bc3b-36a4ea7cc8c6";

function metadata(declaredPointCount: string): PointCloudChunkStreamMetadata {
  return {
    format: "LAS",
    version: "1.4",
    pointFormatId: 6,
    declaredPointCount,
    maxPointsPerChunk: POINT_CLOUD_CHUNK_MAX_POINTS,
    coordinateInterpretation: "LAS scale and offset applied to X/Y/Z; CRS, units, epoch and vertical reference are not interpreted.",
    supportedDimensions: ["pointIndex", "x", "y", "z", "classification"],
    optionalDimensionsPresent: { gpsTime: false, rgb: false, nir: false, extraBytes: false, waveformPackets: false },
    omittedDimensions: ["Extra Bytes payload values", "waveform packet data"],
  };
}

function point(index: number) {
  return {
    pointIndex: String(index),
    x: index,
    y: index * 2,
    z: index * 0.5,
    intensity: 0,
    classification: index % 3,
    returnNumber: 1,
    numberOfReturns: 1,
    scanAngleDegrees: 0,
    userData: 0,
    pointSourceId: 0,
    gpsTime: null,
    rgb: null,
    nir: null,
  };
}

class FakeChunkStream {
  readonly openedIds: string[] = [];
  cancelCalls: string[] = [];
  responses: PointCloudChunkStreamRead[] = [];
  private cancelHandler?: () => void;

  constructor(private readonly count: string) {}

  async open(rawId: unknown) {
    const id = String(rawId);
    this.openedIds.push(id);
    return {
      streamId,
      sourceId: id,
      sourceFileName: "survey.las",
      sourceSha256: "a".repeat(64),
      metadata: metadata(this.count),
    };
  }

  async readNext() {
    const next = this.responses.shift();
    if (next) return next;
    return new Promise<PointCloudChunkStreamRead>((resolve) => { this.cancelHandler = () => resolve({ status: "cancelled" }); });
  }

  async cancel(rawId: unknown) {
    const id = String(rawId);
    this.cancelCalls.push(id);
    this.cancelHandler?.();
    return { accepted: true };
  }
}

async function terminalStatus(controller: PointCloudPreviewController, jobId: string): Promise<PointCloudPreviewStatus> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const status = controller.status(jobId);
    if (status.status !== "running" && status.status !== "cancelling") return status;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Preview job did not reach a terminal status.");
}

describe("project-scoped sampled point-cloud preview", () => {
  it("scans the full stream and returns a deterministic bounded source-index sample", async () => {
    const declared = 50_001;
    const stream = new FakeChunkStream(String(declared));
    for (let start = 0; start < declared; start += POINT_CLOUD_CHUNK_MAX_POINTS) {
      const end = Math.min(declared, start + POINT_CLOUD_CHUNK_MAX_POINTS);
      stream.responses.push({
        status: "chunk",
        chunkIndex: String(stream.responses.length),
        firstPointIndex: String(start),
        decodedPointCount: String(end),
        declaredPointCount: String(declared),
        points: Array.from({ length: end - start }, (_, offset) => point(start + offset)),
      });
    }
    stream.responses.push({ status: "completed", decodedPointCount: String(declared), declaredPointCount: String(declared) });
    const controller = new PointCloudPreviewController({ streams: stream, newJobId: () => streamId });

    const started = await controller.start(sourceId);
    const status = await terminalStatus(controller, started.jobId);

    expect(stream.openedIds).toEqual([sourceId]);
    expect(status.status).toBe("completed");
    if (status.status !== "completed") throw new Error("Expected a completed preview.");
    expect(status.result.sourceFileName).toBe("survey.las");
    expect(status.result.sourceSha256).toBe("a".repeat(64));
    expect(status.result.decodedPointCount).toBe("50001");
    expect(status.result.samplingStride).toBe("3");
    expect(status.result.selectedPointCount).toBe(16_667);
    expect(status.result.renderedPointCount).toBe(16_667);
    expect(status.result.points[0]?.pointIndex).toBe("0");
    expect(status.result.points[1]?.pointIndex).toBe("3");
    expect(status.result.points.at(-1)?.pointIndex).toBe("49998");
    expect(status.result.points.length).toBeLessThanOrEqual(POINT_CLOUD_PREVIEW_MAX_POINTS);
    expect(status.result.warnings[0]).toContain("systematic sample");
  });

  it("discards the sample when the source stream fails integrity or count checks", async () => {
    const stream = new FakeChunkStream("2");
    stream.responses = [
      {
        status: "chunk",
        chunkIndex: "0",
        firstPointIndex: "0",
        decodedPointCount: "1",
        declaredPointCount: "2",
        points: [point(0)],
      },
      { status: "failed", message: "source integrity changed" },
    ];
    const controller = new PointCloudPreviewController({ streams: stream, newJobId: () => streamId });
    const started = await controller.start(sourceId);
    const status = await terminalStatus(controller, started.jobId);

    expect(status.status).toBe("failed");
    if (status.status !== "failed") throw new Error("Expected a failed preview.");
    expect(status.message).not.toContain("source integrity");
    expect(stream.cancelCalls).toEqual([streamId]);
  });

  it("cancels the backing stream and discards a partial sample", async () => {
    const stream = new FakeChunkStream("2");
    stream.responses = [{
      status: "chunk",
      chunkIndex: "0",
      firstPointIndex: "0",
      decodedPointCount: "1",
      declaredPointCount: "2",
      points: [point(0)],
    }];
    const controller = new PointCloudPreviewController({ streams: stream, newJobId: () => streamId });
    const started = await controller.start(sourceId);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await controller.cancel(started.jobId)).toEqual({ accepted: true });
    const status = await terminalStatus(controller, started.jobId);
    expect(status.status).toBe("cancelled");
    expect(stream.cancelCalls).toEqual([streamId]);
  });
});
