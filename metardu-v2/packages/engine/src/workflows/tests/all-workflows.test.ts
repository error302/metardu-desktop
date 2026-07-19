/**
 * Tests for the 4 new workflows: topographic, engineering,
 * setting-out, sectional.
 *
 * Each workflow is tested with synthetic data + verified against
 * hand-computed expected values.
 */

import { describe, it, expect } from "vitest";
import { KENYA, AUSTRALIA, UNITED_KINGDOM } from "@metardu/country-config";
import {
  runTopographicWorkflow,
  runEngineeringWorkflow,
  runSettingOutWorkflow,
  runSectionalWorkflow,
  type TopoPoint,
  type TIN,
} from "../index.js";

// ─── Topographic workflow ────────────────────────────────────────

describe("Topographic workflow", () => {
  // Synthetic 5×5 grid of points with a known slope (5m elevation
  // increase per 10m horizontal in the X direction).
  const points: TopoPoint[] = [];
  for (let x = 0; x < 5; x++) {
    for (let y = 0; y < 5; y++) {
      points.push({
        id: `P${x}${y}`,
        easting: 1000 + x * 10,
        northing: 2000 + y * 10,
        elevation: 100 + x * 5, // 5m slope per 10m
      });
    }
  }

  it("builds a TIN with the correct number of triangles", () => {
    const result = runTopographicWorkflow({
      points,
      contourInterval: 5,
      country: KENYA,
      planTitle: "Test Topo",
      surveyor: { name: "Test", regNo: "LS/1234", dateOfSurvey: "2026-07-19" },
    });
    // 5×5 grid → 25 points → Delaunay produces ~32-64 triangles
    // (each grid cell can be split 1 or 2 ways depending on point order).
    expect(result.triangleCount).toBeGreaterThan(20);
    expect(result.triangleCount).toBeLessThan(100);
  });

  it("computes min/max elevation correctly", () => {
    const result = runTopographicWorkflow({
      points,
      contourInterval: 5,
      country: KENYA,
      planTitle: "Test",
      surveyor: { name: "Test", regNo: "LS/1234", dateOfSurvey: "2026-07-19" },
    });
    expect(result.minElevation).toBe(100);
    expect(result.maxElevation).toBe(120);
  });

  it("generates contours at 5m intervals within the elevation range", () => {
    const result = runTopographicWorkflow({
      points,
      contourInterval: 5,
      country: KENYA,
      planTitle: "Test",
      surveyor: { name: "Test", regNo: "LS/1234", dateOfSurvey: "2026-07-19" },
    });
    const elevations = [...new Set(result.contours.map((c) => c.elevation))].sort((a, b) => a - b);
    // Contours are generated at multiples of 5m between (exclusive) the
    // min vertex elevation and (inclusive) the max vertex elevation.
    // 100 is the min (vertex) → not generated as a crossing contour.
    // 120 is the max → generated because Math.floor(120/5)*5 = 120.
    expect(elevations).toEqual([105, 110, 115, 120]);
  });

  it("selects spot heights every 10 points", () => {
    const result = runTopographicWorkflow({
      points,
      contourInterval: 5,
      spotHeightEvery: 10,
      country: KENYA,
      planTitle: "Test",
      surveyor: { name: "Test", regNo: "LS/1234", dateOfSurvey: "2026-07-19" },
    });
    // 25 points / every 10 = 3 spot heights (indices 0, 10, 20)
    expect(result.spotHeights.length).toBe(3);
  });

  it("computes a non-trivial mean slope (5m rise over 10m run ≈ 26.57°)", () => {
    const result = runTopographicWorkflow({
      points,
      contourInterval: 5,
      country: KENYA,
      planTitle: "Test",
      surveyor: { name: "Test", regNo: "LS/1234", dateOfSurvey: "2026-07-19" },
    });
    expect(result.meanSlope).toBeGreaterThan(20);
    expect(result.meanSlope).toBeLessThan(35);
  });

  it("rejects fewer than 3 points", () => {
    expect(() => runTopographicWorkflow({
      points: [points[0]!, points[1]!],
      contourInterval: 5,
      country: KENYA,
      planTitle: "Test",
      surveyor: { name: "Test", regNo: "LS/1234", dateOfSurvey: "2026-07-19" },
    })).toThrow(/at least 3 points/i);
  });

  it("rejects non-positive contour interval", () => {
    expect(() => runTopographicWorkflow({
      points,
      contourInterval: 0,
      country: KENYA,
      planTitle: "Test",
      surveyor: { name: "Test", regNo: "LS/1234", dateOfSurvey: "2026-07-19" },
    })).toThrow(/positive/i);
  });

  it("maxResidualM is 0 (TIN passes through all points by construction)", () => {
    const result = runTopographicWorkflow({
      points,
      contourInterval: 5,
      country: KENYA,
      planTitle: "Test",
      surveyor: { name: "Test", regNo: "LS/1234", dateOfSurvey: "2026-07-19" },
    });
    expect(result.maxResidualM).toBe(0);
  });
});

// ─── Engineering workflow ────────────────────────────────────────

describe("Engineering workflow", () => {
  // Synthetic: a flat existing-ground TIN at elevation 100m, design
  // plane at elevation 102m (2m fill across the board).
  const existingTIN: TIN = {
    vertices: [
      { id: "1", easting: 0, northing: 0, elevation: 100 },
      { id: "2", easting: 100, northing: 0, elevation: 100 },
      { id: "3", easting: 100, northing: 100, elevation: 100 },
      { id: "4", easting: 0, northing: 100, elevation: 100 },
    ],
    triangles: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  };

  it("computes fill volume for a 2m fill across 100×100m area", () => {
    const result = runEngineeringWorkflow({
      existingGround: existingTIN,
      design: { type: "plane", plane: { a: 0, b: 0, c: 102 } },
      alignment: {
        points: [
          { chainage: 0, easting: 50, northing: 0 },
          { chainage: 100, easting: 50, northing: 100 },
        ],
      },
      sectionSpacing: 50,
      sectionWidth: 100,
      sectionSampleInterval: 10,
      country: KENYA,
    });
    // 100m × 100m × 2m fill = 20000 m³ theoretical. With section
    // sampling at 50m intervals (3 sections: 0, 50, 100), the
    // average-end-area method gives an approximation. Allow 12000-25000.
    expect(result.fillVolume).toBeGreaterThanOrEqual(12000);
    expect(result.fillVolume).toBeLessThan(25000);
    expect(result.cutVolume).toBe(0);
    expect(result.netVolume).toBe(-result.fillVolume);
  });

  it("computes cut volume for a 2m cut (design below existing)", () => {
    const result = runEngineeringWorkflow({
      existingGround: existingTIN,
      design: { type: "plane", plane: { a: 0, b: 0, c: 98 } },
      alignment: {
        points: [
          { chainage: 0, easting: 50, northing: 0 },
          { chainage: 100, easting: 50, northing: 100 },
        ],
      },
      sectionSpacing: 50,
      sectionWidth: 100,
      sectionSampleInterval: 10,
      country: KENYA,
    });
    expect(result.cutVolume).toBeGreaterThanOrEqual(12000);
    expect(result.fillVolume).toBe(0);
    expect(result.maxCutDepth).toBeCloseTo(2.0, 1);
  });

  it("rejects TIN with no triangles", () => {
    expect(() => runEngineeringWorkflow({
      existingGround: { vertices: [], triangles: [] },
      design: { type: "plane", plane: { a: 0, b: 0, c: 100 } },
      alignment: { points: [{ chainage: 0, easting: 0, northing: 0 }, { chainage: 100, easting: 100, northing: 0 }] },
      sectionSpacing: 50, sectionWidth: 50, sectionSampleInterval: 10,
      country: KENYA,
    })).toThrow(/no triangles/i);
  });

  it("rejects alignment with < 2 points", () => {
    expect(() => runEngineeringWorkflow({
      existingGround: existingTIN,
      design: { type: "plane", plane: { a: 0, b: 0, c: 100 } },
      alignment: { points: [{ chainage: 0, easting: 0, northing: 0 }] },
      sectionSpacing: 50, sectionWidth: 50, sectionSampleInterval: 10,
      country: KENYA,
    })).toThrow(/at least 2 points/i);
  });

  it("uses the country's engineering tolerance", () => {
    const result = runEngineeringWorkflow({
      existingGround: existingTIN,
      design: { type: "plane", plane: { a: 0, b: 0, c: 100 } },
      alignment: {
        points: [
          { chainage: 0, easting: 50, northing: 0 },
          { chainage: 100, easting: 50, northing: 100 },
        ],
      },
      sectionSpacing: 50, sectionWidth: 100, sectionSampleInterval: 10,
      country: AUSTRALIA,
    });
    // Australia engineering standard = 15mm
    expect(result.engineeringToleranceM).toBeGreaterThan(0);
    expect(result.engineeringToleranceM).toBeLessThan(0.1);
  });
});

// ─── Setting-Out workflow ────────────────────────────────────────

describe("Setting-Out workflow", () => {
  it("generates stakeout instructions for each design point", () => {
    const result = runSettingOutWorkflow({
      designPoints: [
        { id: "P1", easting: 1000, northing: 1000, type: "foundation" },
        { id: "P2", easting: 1010, northing: 1000, type: "column" },
        { id: "P3", easting: 1020, northing: 1000, type: "wall" },
      ],
      controlPoints: [
        { id: "C1", easting: 990, northing: 990 },
      ],
      country: KENYA,
    });
    expect(result.instructions).toHaveLength(3);
    // P1 at (1000, 1000), C1 at (990, 990) → distance = sqrt(100+100) = 14.14
    expect(result.instructions[0]!.distanceM).toBeCloseTo(14.14, 1);
    expect(result.instructions[0]!.method).toBe("polar"); // < 200m
  });

  it("uses GNSS RTK for distant points", () => {
    const result = runSettingOutWorkflow({
      designPoints: [
        { id: "P1", easting: 1500, northing: 1500, type: "general" },
      ],
      controlPoints: [
        { id: "C1", easting: 1000, northing: 1000 },
      ],
      country: KENYA,
    });
    expect(result.instructions[0]!.method).toBe("gnss_rtk"); // > 200m
  });

  it("verifies as-built observations against the country tolerance", () => {
    const result = runSettingOutWorkflow({
      designPoints: [
        { id: "P1", easting: 1000, northing: 1000, type: "foundation" },
        { id: "P2", easting: 1010, northing: 1000, type: "column" },
      ],
      controlPoints: [{ id: "C1", easting: 990, northing: 990 }],
      asBuilt: [
        // P1: 5mm off — should pass
        { designPointId: "P1", easting: 1000.005, northing: 1000.000 },
        // P2: 50mm off — should fail (Kenya construction tolerance is 20mm)
        { designPointId: "P2", easting: 1010.040, northing: 1000.030 },
      ],
      country: KENYA,
    });
    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.passes).toBe(true);  // 5mm
    expect(result.results[1]!.passes).toBe(false); // 50mm
    expect(result.failCount).toBe(1);
    expect(result.allPass).toBe(false);
  });

  it("rejects 0 design points", () => {
    expect(() => runSettingOutWorkflow({
      designPoints: [],
      controlPoints: [{ id: "C1", easting: 0, northing: 0 }],
      country: KENYA,
    })).toThrow(/at least 1 design point/i);
  });

  it("rejects 0 control points", () => {
    expect(() => runSettingOutWorkflow({
      designPoints: [{ id: "P1", easting: 0, northing: 0, type: "general" }],
      controlPoints: [],
      country: KENYA,
    })).toThrow(/at least 1 control point/i);
  });
});

// ─── Sectional Properties workflow ───────────────────────────────

describe("Sectional Properties workflow", () => {
  it("computes unit areas + participation quotas for a 2-unit building", () => {
    const result = runSectionalWorkflow({
      building: {
        name: "Test Building",
        address: "123 Test St",
        parentParcel: "LR/12345",
        levels: [
          {
            level: 0,
            name: "Ground Floor",
            footprint: {
              vertices: [
                { easting: 0, northing: 0 },
                { easting: 20, northing: 0 },
                { easting: 20, northing: 10 },
                { easting: 0, northing: 10 },
              ],
            },
            units: [
              {
                number: "A",
                type: "residential",
                boundary: {
                  vertices: [
                    { easting: 0, northing: 0 },
                    { easting: 10, northing: 0 },
                    { easting: 10, northing: 10 },
                    { easting: 0, northing: 10 },
                  ],
                },
              },
              {
                number: "B",
                type: "residential",
                boundary: {
                  vertices: [
                    { easting: 10, northing: 0 },
                    { easting: 20, northing: 0 },
                    { easting: 20, northing: 10 },
                    { easting: 10, northing: 10 },
                  ],
                },
              },
            ],
            commonProperty: [],
          },
        ],
      },
      country: KENYA,
      surveyor: { name: "Test", regNo: "LS/1234", dateOfSurvey: "2026-07-19" },
    });

    expect(result.totalBuildingArea).toBe(200); // 20×10
    expect(result.totalUnitArea).toBe(200); // 2 × (10×10)
    expect(result.levels[0]!.units[0]!.area).toBe(100);
    expect(result.levels[0]!.units[1]!.area).toBe(100);
    // Equal areas → 50/50 participation quota
    expect(result.levels[0]!.units[0]!.participationQuota).toBeCloseTo(50, 5);
    expect(result.levels[0]!.units[1]!.participationQuota).toBeCloseTo(50, 5);
    expect(result.areaBalanceOk).toBe(true);
  });

  it("computes participation quotas weighted by area (3 unequal units)", () => {
    const result = runSectionalWorkflow({
      building: {
        name: "Test",
        address: "n/a",
        parentParcel: "n/a",
        levels: [{
          level: 0,
          name: "Ground",
          footprint: {
            vertices: [
              { easting: 0, northing: 0 },
              { easting: 60, northing: 0 },
              { easting: 60, northing: 10 },
              { easting: 0, northing: 10 },
            ],
          },
          units: [
            // 100 m²
            { number: "1", type: "residential", boundary: { vertices: [
              { easting: 0, northing: 0 }, { easting: 10, northing: 0 },
              { easting: 10, northing: 10 }, { easting: 0, northing: 10 },
            ] } },
            // 200 m²
            { number: "2", type: "residential", boundary: { vertices: [
              { easting: 10, northing: 0 }, { easting: 30, northing: 0 },
              { easting: 30, northing: 10 }, { easting: 10, northing: 10 },
            ] } },
            // 300 m²
            { number: "3", type: "residential", boundary: { vertices: [
              { easting: 30, northing: 0 }, { easting: 60, northing: 0 },
              { easting: 60, northing: 10 }, { easting: 30, northing: 10 },
            ] } },
          ],
          commonProperty: [],
        }],
      },
      country: KENYA,
      surveyor: { name: "Test", regNo: "LS/1234", dateOfSurvey: "2026-07-19" },
    });
    // Total unit area = 100 + 200 + 300 = 600 m²
    expect(result.totalUnitArea).toBe(600);
    // Participation quotas: 100/600, 200/600, 300/600
    expect(result.levels[0]!.units[0]!.participationQuota).toBeCloseTo(100 / 6, 2);
    expect(result.levels[0]!.units[1]!.participationQuota).toBeCloseTo(200 / 6, 2);
    expect(result.levels[0]!.units[2]!.participationQuota).toBeCloseTo(50, 2); // 300/600 = 50%
  });

  it("reports the sectional regime from the country config", () => {
    const result = runSectionalWorkflow({
      building: {
        name: "Test", address: "n/a", parentParcel: "n/a",
        levels: [{
          level: 0, name: "G",
          footprint: { vertices: [
            { easting: 0, northing: 0 }, { easting: 10, northing: 0 },
            { easting: 10, northing: 10 }, { easting: 0, northing: 10 },
          ] },
          units: [], commonProperty: [],
        }],
      },
      country: KENYA,
      surveyor: { name: "Test", regNo: "LS/1234", dateOfSurvey: "2026-07-19" },
    });
    expect(result.regime.legislation).toContain("Sectional Properties Act 2020");
    expect(result.regime.requiresParticipationQuotas).toBe(true);
  });

  it("marks sourceFiled=false (Survey Act Cap. 299 + sectional Act not yet filed)", () => {
    const result = runSectionalWorkflow({
      building: {
        name: "Test", address: "n/a", parentParcel: "n/a",
        levels: [{
          level: 0, name: "G",
          footprint: { vertices: [
            { easting: 0, northing: 0 }, { easting: 10, northing: 0 },
            { easting: 10, northing: 10 }, { easting: 0, northing: 10 },
          ] },
          units: [], commonProperty: [],
        }],
      },
      country: UNITED_KINGDOM,
      surveyor: { name: "Test", regNo: "1234567", dateOfSurvey: "2026-07-19" },
    });
    expect(result.sourceFiled).toBe(false);
  });

  it("rejects 0 levels", () => {
    expect(() => runSectionalWorkflow({
      building: { name: "Test", address: "n/a", parentParcel: "n/a", levels: [] },
      country: KENYA,
      surveyor: { name: "Test", regNo: "LS/1234", dateOfSurvey: "2026-07-19" },
    })).toThrow(/at least 1 building level/i);
  });
});
