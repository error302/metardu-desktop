import { describe, expect, it } from "vitest";
import { parsePointCloudCoordinateContext } from "../main/point-cloud-coordinate-context.js";

describe("point-cloud coordinate declaration parsing", () => {
  const context = {
    schemaVersion: 1,
    horizontalCrsLabel: "EPSG:example",
    horizontalUnit: "metre",
    coordinateEpoch: null,
    verticalReference: null,
    evidenceStatus: "user_declared_unverified",
  } as const;

  it("keeps absent source declarations absent", () => {
    expect(parsePointCloudCoordinateContext(null)).toEqual({});
    expect(parsePointCloudCoordinateContext(undefined)).toEqual({});
  });

  it("returns only schema-valid declarations", () => {
    expect(parsePointCloudCoordinateContext(JSON.stringify(context))).toEqual({ coordinateContext: context });
  });

  it("marks malformed JSON and invalid shapes without exposing partial values", () => {
    const malformed = "{\"schemaVersion\":99,\"horizontalUnit\":\"metre\"}";
    expect(parsePointCloudCoordinateContext(malformed)).toEqual({ coordinateContextStatus: "invalid" });
    expect(parsePointCloudCoordinateContext("not-json")).toEqual({ coordinateContextStatus: "invalid" });
    expect(malformed).toBe("{\"schemaVersion\":99,\"horizontalUnit\":\"metre\"}");
  });
});
