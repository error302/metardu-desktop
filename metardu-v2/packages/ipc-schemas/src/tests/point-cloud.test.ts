import { describe, expect, it } from "vitest";
import {
  POINT_CLOUD_INSPECTION_JOB_ID_SCHEMA,
  POINT_CLOUD_PREVIEW_MAX_POINTS,
  POINT_CLOUD_PREVIEW_RESULT_SCHEMA,
  POINT_CLOUD_PREVIEW_START_INPUT_SCHEMA,
  POINT_CLOUD_SOURCE_ID_SCHEMA,
} from "../index.js";

describe("point-cloud IPC identifiers", () => {
  it("accepts UUID source and job identifiers", () => {
    const id = "9eac1ac4-4c7b-4df5-9e9e-5f9709ec1368";
    expect(POINT_CLOUD_SOURCE_ID_SCHEMA.safeParse(id).success).toBe(true);
    expect(POINT_CLOUD_INSPECTION_JOB_ID_SCHEMA.safeParse(id).success).toBe(true);
  });

  it("rejects paths and malformed identifiers", () => {
    for (const value of ["C:\\survey\\points.las", "../../outside", "not-a-uuid", null, 7]) {
      expect(POINT_CLOUD_SOURCE_ID_SCHEMA.safeParse(value).success).toBe(false);
      expect(POINT_CLOUD_INSPECTION_JOB_ID_SCHEMA.safeParse(value).success).toBe(false);
    }
  });
});

describe("point-cloud preview IPC schemas", () => {
  const sourceId = "9eac1ac4-4c7b-4df5-9e9e-5f9709ec1368";
  const preview = {
    sourceId,
    sourceFileName: "survey.las",
    sourceSha256: "a".repeat(64),
    format: "LAS",
    version: "1.4",
    pointFormatId: 6,
    declaredPointCount: "1",
    decodedPointCount: "1",
    samplingStride: "1",
    selectedPointCount: 1,
    renderedPointCount: 1,
    nonFiniteSamplePointCount: 0,
    samplingMethod: "systematic_source_index_stride",
    coordinateInterpretation: "LAS scale and offset applied to X/Y/Z; CRS, units, epoch and vertical reference are not interpreted.",
    points: [{ pointIndex: "0", x: 1, y: 2, z: 3, classification: 2 }],
    warnings: ["Visualization only."],
  };

  it("accepts only an opaque project source ID for preview start", () => {
    expect(POINT_CLOUD_PREVIEW_START_INPUT_SCHEMA.safeParse({ sourceId }).success).toBe(true);
    expect(POINT_CLOUD_PREVIEW_START_INPUT_SCHEMA.safeParse({ sourceId: "C:\\private\\survey.las" }).success).toBe(false);
  });

  it("accepts a bounded preview with explicit sampling and coordinate limits", () => {
    expect(POINT_CLOUD_PREVIEW_RESULT_SCHEMA.safeParse(preview).success).toBe(true);
    const oversized = { ...preview, points: Array.from({ length: POINT_CLOUD_PREVIEW_MAX_POINTS + 1 }, (_, index) => ({
      pointIndex: String(index), x: 1, y: 2, z: 3, classification: 2,
    })) };
    expect(POINT_CLOUD_PREVIEW_RESULT_SCHEMA.safeParse(oversized).success).toBe(false);
    expect(POINT_CLOUD_PREVIEW_RESULT_SCHEMA.safeParse({ ...preview, sourceSha256: "bad" }).success).toBe(false);
    expect(POINT_CLOUD_PREVIEW_RESULT_SCHEMA.safeParse({ ...preview, coordinateInterpretation: "WGS 84" }).success).toBe(false);
  });
});
