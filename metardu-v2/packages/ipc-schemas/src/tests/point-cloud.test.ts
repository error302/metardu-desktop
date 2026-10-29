import { describe, expect, it } from "vitest";
import {
  POINT_CLOUD_INSPECTION_JOB_ID_SCHEMA,
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
