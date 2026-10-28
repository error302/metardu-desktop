import { describe, expect, it } from "vitest";
import { validateCogoSidecarParams } from "../namespaces/cogo.js";

describe("Rust COGO sidecar parameter schemas", () => {
  it("accepts finite metre coordinates and decimal bearings", () => {
    expect(validateCogoSidecarParams("cogo.radiation", {
      origin: { easting: 500_000, northing: 9_500_000 },
      bearing_deg: 360,
      distance_m: 25,
    })).toEqual({
      success: true,
      data: {
        origin: { easting: 500_000, northing: 9_500_000 },
        bearing_deg: 360,
        distance_m: 25,
      },
    });
  });

  it("rejects blank, non-finite, out-of-range, and unknown input values", () => {
    expect(validateCogoSidecarParams("cogo.radiation", {
      origin: { easting: "", northing: 0 },
      bearing_deg: 361,
      distance_m: -1,
      countryCode: "KE",
    })?.success).toBe(false);
  });

  it("requires at least three finite vertices and rejects unknown area context", () => {
    expect(validateCogoSidecarParams("cogo.area", { points: [[0, 0], [1, 0]] })?.success).toBe(false);
    expect(validateCogoSidecarParams("cogo.area", {
      points: [[0, 0], [1, 0], [0, 1]],
      ellipsoidal: { mean_latitude_deg: 0 },
    })?.success).toBe(false);
  });

  it("caps polygon vertices to bound quadratic self-intersection work", () => {
    const points = Array.from({ length: 5_001 }, (_, index) => [index, index] as [number, number]);
    expect(validateCogoSidecarParams("cogo.area", { points })?.success).toBe(false);
  });

  it("leaves unrelated sidecar methods to their own allowlist contract", () => {
    expect(validateCogoSidecarParams("ping", null)).toBeNull();
  });
});
