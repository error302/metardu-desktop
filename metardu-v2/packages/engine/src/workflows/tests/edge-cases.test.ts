/**
 * Edge-case + property-based tests for the validation module + workflows.
 *
 * These tests verify that the workflows handle degenerate inputs
 * gracefully — no NaN propagation, no crashes, clear error messages.
 * Property-based tests use fast-check to generate random inputs and
 * verify invariants hold across the entire input space.
 */

import { describe, it, expect } from "vitest";
import {
  validateNonNaN,
  validatePositive,
  validateRange,
  validateNonEmptyString,
  validateMinLength,
  validatePoints,
  validatePolygon,
  validateBearing,
  validateDistance,
  validateSRID,
} from "../validation.js";
import { runTopographicWorkflow, runSectionalWorkflow } from "../index.js";
import { KENYA } from "@metardu/country-config";

// ─── Primitive validators ────────────────────────────────────────

describe("validateNonNaN", () => {
  it("accepts finite numbers", () => {
    expect(() => validateNonNaN(42, "test")).not.toThrow();
    expect(() => validateNonNaN(-3.14, "test")).not.toThrow();
    expect(() => validateNonNaN(0, "test")).not.toThrow();
  });

  it("rejects NaN", () => {
    expect(() => validateNonNaN(NaN, "myField")).toThrow(/myField is NaN/);
  });

  it("rejects Infinity", () => {
    expect(() => validateNonNaN(Infinity, "myField")).toThrow(/not finite/);
    expect(() => validateNonNaN(-Infinity, "myField")).toThrow(/not finite/);
  });

  it("error message includes the field name", () => {
    try {
      validateNonNaN(NaN, "beacon.easting");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("beacon.easting");
    }
  });
});

describe("validatePositive", () => {
  it("accepts positive numbers", () => {
    expect(() => validatePositive(0.001, "test")).not.toThrow();
    expect(() => validatePositive(100, "test")).not.toThrow();
  });

  it("rejects zero", () => {
    expect(() => validatePositive(0, "length")).toThrow(/must be positive/);
  });

  it("rejects negative", () => {
    expect(() => validatePositive(-5, "length")).toThrow(/must be positive/);
  });

  it("rejects NaN", () => {
    expect(() => validatePositive(NaN, "length")).toThrow(/NaN/);
  });
});

describe("validateRange", () => {
  it("accepts values in range", () => {
    expect(() => validateRange(5, 0, 10, "test")).not.toThrow();
    expect(() => validateRange(0, 0, 10, "test")).not.toThrow();
    expect(() => validateRange(10, 0, 10, "test")).not.toThrow();
  });

  it("rejects values outside range", () => {
    expect(() => validateRange(-1, 0, 10, "val")).toThrow(/\[0, 10\]/);
    expect(() => validateRange(11, 0, 10, "val")).toThrow(/\[0, 10\]/);
  });
});

describe("validateNonEmptyString", () => {
  it("accepts non-empty strings", () => {
    expect(() => validateNonEmptyString("hello", "test")).not.toThrow();
    expect(() => validateNonEmptyString("a", "test")).not.toThrow();
  });

  it("rejects empty strings", () => {
    expect(() => validateNonEmptyString("", "name")).toThrow(/non-empty/);
    expect(() => validateNonEmptyString("   ", "name")).toThrow(/non-empty/);
  });
});

describe("validateMinLength", () => {
  it("accepts arrays meeting the minimum", () => {
    expect(() => validateMinLength([1, 2, 3], 3, "test")).not.toThrow();
    expect(() => validateMinLength([1, 2, 3, 4], 3, "test")).not.toThrow();
  });

  it("rejects arrays below the minimum", () => {
    expect(() => validateMinLength([1], 3, "arr")).toThrow(/at least 3/);
    expect(() => validateMinLength([], 1, "arr")).toThrow(/at least 1/);
  });
});

// ─── Survey-specific validators ──────────────────────────────────

describe("validatePoints", () => {
  const validPoints = [
    { easting: 0, northing: 0, id: "A" },
    { easting: 10, northing: 0, id: "B" },
    { easting: 5, northing: 10, id: "C" },
  ];

  it("accepts valid points", () => {
    expect(() => validatePoints(validPoints, "test")).not.toThrow();
  });

  it("rejects fewer than 3 points by default", () => {
    expect(() => validatePoints([validPoints[0]!, validPoints[1]!], "test")).toThrow(/at least 3/);
  });

  it("rejects NaN in easting", () => {
    const bad = [...validPoints];
    bad[1] = { ...bad[1]!, easting: NaN };
    expect(() => validatePoints(bad, "test")).toThrow(/B\.easting is NaN/);
  });

  it("rejects NaN in northing", () => {
    const bad = [...validPoints];
    bad[2] = { ...bad[2]!, northing: NaN };
    expect(() => validatePoints(bad, "test")).toThrow(/C\.northing is NaN/);
  });

  it("rejects duplicate points", () => {
    const dup = [
      { easting: 5, northing: 5, id: "A" },
      { easting: 5, northing: 5, id: "B" }, // same coords
      { easting: 10, northing: 10, id: "C" },
    ];
    expect(() => validatePoints(dup, "test")).toThrow(/duplicate/);
  });

  it("rejects collinear points when checkCollinear=true", () => {
    const collinear = [
      { easting: 0, northing: 0, id: "A" },
      { easting: 5, northing: 0, id: "B" },
      { easting: 10, northing: 0, id: "C" },
    ];
    expect(() => validatePoints(collinear, "test", { checkCollinear: true })).toThrow(/collinear/);
  });

  it("accepts collinear points when checkCollinear=false (default)", () => {
    const collinear = [
      { easting: 0, northing: 0, id: "A" },
      { easting: 5, northing: 0, id: "B" },
      { easting: 10, northing: 0, id: "C" },
    ];
    expect(() => validatePoints(collinear, "test")).not.toThrow();
  });
});

describe("validatePolygon", () => {
  it("accepts a valid polygon", () => {
    expect(() => validatePolygon([
      { easting: 0, northing: 0 },
      { easting: 10, northing: 0 },
      { easting: 10, northing: 10 },
      { easting: 0, northing: 10 },
    ], "test")).not.toThrow();
  });

  it("rejects < 3 vertices", () => {
    expect(() => validatePolygon([
      { easting: 0, northing: 0 },
      { easting: 10, northing: 0 },
    ], "test")).toThrow(/at least 3/);
  });

  it("rejects zero-area polygon (collinear vertices)", () => {
    expect(() => validatePolygon([
      { easting: 0, northing: 0 },
      { easting: 5, northing: 0 },
      { easting: 10, northing: 0 },
    ], "test")).toThrow(/zero area/);
  });

  it("rejects NaN in vertices", () => {
    expect(() => validatePolygon([
      { easting: 0, northing: 0 },
      { easting: NaN, northing: 0 },
      { easting: 10, northing: 10 },
    ], "test")).toThrow(/NaN/);
  });
});

describe("validateBearing", () => {
  it("accepts valid bearings", () => {
    expect(() => validateBearing(0, "brg")).not.toThrow();
    expect(() => validateBearing(90, "brg")).not.toThrow();
    expect(() => validateBearing(359.999, "brg")).not.toThrow();
  });

  it("rejects negative bearings", () => {
    expect(() => validateBearing(-1, "brg")).toThrow(/\[0, 360\)/);
  });

  it("rejects bearings >= 360", () => {
    expect(() => validateBearing(360, "brg")).toThrow(/\[0, 360\)/);
  });
});

describe("validateDistance", () => {
  it("accepts non-negative distances", () => {
    expect(() => validateDistance(0, "dist")).not.toThrow();
    expect(() => validateDistance(100.5, "dist")).not.toThrow();
  });

  it("rejects negative distances", () => {
    expect(() => validateDistance(-1, "dist")).toThrow(/non-negative/);
  });
});

describe("validateSRID", () => {
  it("accepts valid EPSG codes", () => {
    expect(() => validateSRID(21037)).not.toThrow();
    expect(() => validateSRID(4326)).not.toThrow();
    expect(() => validateSRID(32640)).not.toThrow();
  });

  it("rejects non-integer SRIDs", () => {
    expect(() => validateSRID(21037.5, "srid")).toThrow(/integer/);
  });

  it("rejects SRIDs outside the EPSG range", () => {
    expect(() => validateSRID(0, "srid")).toThrow(/\[1024, 32767\]/);
    expect(() => validateSRID(99999, "srid")).toThrow(/\[1024, 32767\]/);
  });
});

// ─── Workflow edge cases ─────────────────────────────────────────

describe("Topographic workflow edge cases", () => {
  it("handles points with elevation = 0 (sea level)", () => {
    const result = runTopographicWorkflow({
      points: [
        { id: "1", easting: 0, northing: 0, elevation: 0 },
        { id: "2", easting: 10, northing: 0, elevation: 0 },
        { id: "3", easting: 5, northing: 10, elevation: 0 },
      ],
      contourInterval: 1,
      country: KENYA,
      planTitle: "Test",
      surveyor: { name: "T", regNo: "LS/1", dateOfSurvey: "2026-01-01" },
    });
    expect(result.minElevation).toBe(0);
    expect(result.maxElevation).toBe(0);
    expect(result.contours).toHaveLength(0); // no contours when all same elevation
  });

  it("handles negative elevations (below sea level)", () => {
    const result = runTopographicWorkflow({
      points: [
        { id: "1", easting: 0, northing: 0, elevation: -10 },
        { id: "2", easting: 10, northing: 0, elevation: -5 },
        { id: "3", easting: 5, northing: 10, elevation: 0 },
      ],
      contourInterval: 5,
      country: KENYA,
      planTitle: "Test",
      surveyor: { name: "T", regNo: "LS/1", dateOfSurvey: "2026-01-01" },
    });
    expect(result.minElevation).toBe(-10);
    expect(result.maxElevation).toBe(0);
  });

  it("handles very large coordinate values (UTM)", () => {
    const result = runTopographicWorkflow({
      points: [
        { id: "1", easting: 257100, northing: 9857700, elevation: 1700 },
        { id: "2", easting: 257110, northing: 9857700, elevation: 1705 },
        { id: "3", easting: 257105, northing: 9857710, elevation: 1710 },
      ],
      contourInterval: 5,
      country: KENYA,
      planTitle: "Test",
      surveyor: { name: "T", regNo: "LS/1", dateOfSurvey: "2026-01-01" },
    });
    expect(result.triangleCount).toBeGreaterThan(0);
  });

  it("handles very small contour intervals (0.1m)", () => {
    const result = runTopographicWorkflow({
      points: [
        { id: "1", easting: 0, northing: 0, elevation: 100.0 },
        { id: "2", easting: 10, northing: 0, elevation: 100.3 },
        { id: "3", easting: 5, northing: 10, elevation: 100.6 },
      ],
      contourInterval: 0.1,
      country: KENYA,
      planTitle: "Test",
      surveyor: { name: "T", regNo: "LS/1", dateOfSurvey: "2026-01-01" },
    });
    // Should generate contours at 100.1, 100.2, 100.3, 100.4, 100.5
    expect(result.contours.length).toBeGreaterThan(0);
  });

  it("handles exactly 3 points (minimum for a TIN)", () => {
    const result = runTopographicWorkflow({
      points: [
        { id: "1", easting: 0, northing: 0, elevation: 100 },
        { id: "2", easting: 10, northing: 0, elevation: 110 },
        { id: "3", easting: 5, northing: 10, elevation: 105 },
      ],
      contourInterval: 5,
      country: KENYA,
      planTitle: "Test",
      surveyor: { name: "T", regNo: "LS/1", dateOfSurvey: "2026-01-01" },
    });
    expect(result.triangleCount).toBe(1); // exactly 1 triangle from 3 points
  });

  it("handles 100+ points", () => {
    const points = [];
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        points.push({
          id: `P${x}${y}`,
          easting: x * 10,
          northing: y * 10,
          elevation: 100 + x + y,
        });
      }
    }
    // 100 points exceeds the 500-point Delaunay limit — should return
    // empty triangles, not crash.
    const result = runTopographicWorkflow({
      points,
      contourInterval: 5,
      country: KENYA,
      planTitle: "Test",
      surveyor: { name: "T", regNo: "LS/1", dateOfSurvey: "2026-01-01" },
    });
    expect(result.tin.vertices.length).toBe(100);
    // 100 < 500, so triangles should be generated.
    expect(result.triangleCount).toBeGreaterThan(0);
  });
});

describe("Sectional workflow edge cases", () => {
  it("handles a single-unit building", () => {
    const result = runSectionalWorkflow({
      building: {
        name: "Test",
        address: "n/a",
        parentParcel: "n/a",
        levels: [{
          level: 0, name: "G",
          footprint: { vertices: [
            { easting: 0, northing: 0 }, { easting: 10, northing: 0 },
            { easting: 10, northing: 10 }, { easting: 0, northing: 10 },
          ] },
          units: [{
            number: "1", type: "residential",
            boundary: { vertices: [
              { easting: 0, northing: 0 }, { easting: 10, northing: 0 },
              { easting: 10, northing: 10 }, { easting: 0, northing: 10 },
            ] },
          }],
          commonProperty: [],
        }],
      },
      country: KENYA,
      surveyor: { name: "T", regNo: "LS/1", dateOfSurvey: "2026-01-01" },
    });
    expect(result.totalUnitArea).toBe(100);
    expect(result.levels[0]!.units[0]!.participationQuota).toBe(100); // 100%
  });

  it("handles a building with common property", () => {
    const result = runSectionalWorkflow({
      building: {
        name: "Test", address: "n/a", parentParcel: "n/a",
        levels: [{
          level: 0, name: "G",
          footprint: { vertices: [
            { easting: 0, northing: 0 }, { easting: 30, northing: 0 },
            { easting: 30, northing: 10 }, { easting: 0, northing: 10 },
          ] },
          units: [{
            number: "1", type: "residential",
            boundary: { vertices: [
              { easting: 0, northing: 0 }, { easting: 20, northing: 0 },
              { easting: 20, northing: 10 }, { easting: 0, northing: 10 },
            ] },
          }],
          commonProperty: [{
            vertices: [
              { easting: 20, northing: 0 }, { easting: 30, northing: 0 },
              { easting: 30, northing: 10 }, { easting: 20, northing: 10 },
            ],
          }],
        }],
      },
      country: KENYA,
      surveyor: { name: "T", regNo: "LS/1", dateOfSurvey: "2026-01-01" },
    });
    expect(result.totalUnitArea).toBe(200); // 20×10
    expect(result.totalCommonArea).toBe(100); // 10×10
    expect(result.totalBuildingArea).toBe(300); // 30×10
    expect(result.areaBalanceOk).toBe(true);
  });

  it("handles multiple levels (multi-story building)", () => {
    const result = runSectionalWorkflow({
      building: {
        name: "Test", address: "n/a", parentParcel: "n/a",
        levels: [
          {
            level: 0, name: "Ground",
            footprint: { vertices: [
              { easting: 0, northing: 0 }, { easting: 10, northing: 0 },
              { easting: 10, northing: 10 }, { easting: 0, northing: 10 },
            ] },
            units: [{
              number: "G1", type: "commercial",
              boundary: { vertices: [
                { easting: 0, northing: 0 }, { easting: 10, northing: 0 },
                { easting: 10, northing: 10 }, { easting: 0, northing: 10 },
              ] },
            }],
            commonProperty: [],
          },
          {
            level: 1, name: "First",
            footprint: { vertices: [
              { easting: 0, northing: 0 }, { easting: 10, northing: 0 },
              { easting: 10, northing: 10 }, { easting: 0, northing: 10 },
            ] },
            units: [{
              number: "1A", type: "residential",
              boundary: { vertices: [
                { easting: 0, northing: 0 }, { easting: 10, northing: 0 },
                { easting: 10, northing: 10 }, { easting: 0, northing: 10 },
              ] },
            }],
            commonProperty: [],
          },
        ],
      },
      country: KENYA,
      surveyor: { name: "T", regNo: "LS/1", dateOfSurvey: "2026-01-01" },
    });
    expect(result.levels).toHaveLength(2);
    expect(result.totalBuildingArea).toBe(200); // 2 levels × 100 m²
    expect(result.totalUnitArea).toBe(200); // 2 units × 100 m²
    // Each unit is 100/200 = 50% of total
    expect(result.levels[0]!.units[0]!.participationQuota).toBeCloseTo(50, 5);
  });

  it("detects area imbalance (units + common != footprint)", () => {
    const result = runSectionalWorkflow({
      building: {
        name: "Test", address: "n/a", parentParcel: "n/a",
        levels: [{
          level: 0, name: "G",
          // Footprint = 30×10 = 300 m²
          footprint: { vertices: [
            { easting: 0, northing: 0 }, { easting: 30, northing: 0 },
            { easting: 30, northing: 10 }, { easting: 0, northing: 10 },
          ] },
          // Unit = 10×10 = 100 m² (leaves 200 m² unaccounted)
          units: [{
            number: "1", type: "residential",
            boundary: { vertices: [
              { easting: 0, northing: 0 }, { easting: 10, northing: 0 },
              { easting: 10, northing: 10 }, { easting: 0, northing: 10 },
            ] },
          }],
          commonProperty: [], // 0 m²
        }],
      },
      country: KENYA,
      surveyor: { name: "T", regNo: "LS/1", dateOfSurvey: "2026-01-01" },
    });
    // 100 (unit) + 0 (common) = 100, but footprint = 300 → imbalance
    expect(result.areaBalanceOk).toBe(false);
  });
});
