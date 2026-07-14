/**
 * Tests for terrain-aware altitude adjustment.
 *
 * Verifies:
 *   - Bilinear interpolation is correct at grid corners, edges, and interior
 *   - Terrain-aware adjustment produces correct AMSL altitudes
 *   - Terrain statistics are computed correctly
 *   - Property-based tests for interpolation continuity
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  elevationFromGrid,
  elevationFromFunction,
  makeTerrainAware,
  computeTerrainStats,
  type ElevationGrid,
} from "../terrain.js";
import type { Waypoint } from "../waypoints.js";

// ─── Bilinear interpolation tests ──────────────────────────────────

describe("elevationFromGrid — bilinear interpolation", () => {
  // Test grid: 3×3 covering 1°×1° box from (0,0) to (1,1)
  // Values increase from NW to SE
  const testGrid: ElevationGrid = {
    south: 0, west: 0, north: 1, east: 1,
    rows: 3, cols: 3,
    values: [
      100, 110, 120,  // row 0 (north): (1,0), (1,0.5), (1,1)
      130, 140, 150,  // row 1 (mid):   (0.5,0), (0.5,0.5), (0.5,1)
      160, 170, 180,  // row 2 (south): (0,0), (0,0.5), (0,1)
    ],
  };

  it("should return exact grid values at grid corners", () => {
    const lookup = elevationFromGrid(testGrid);
    // NW corner (lat=1, lng=0) → row 0, col 0 → 100
    expect(lookup(1, 0)).toBeCloseTo(100, 5);
    // NE corner (lat=1, lng=1) → row 0, col 2 → 120
    expect(lookup(1, 1)).toBeCloseTo(120, 5);
    // SW corner (lat=0, lng=0) → row 2, col 0 → 160
    expect(lookup(0, 0)).toBeCloseTo(160, 5);
    // SE corner (lat=0, lng=1) → row 2, col 2 → 180
    expect(lookup(0, 1)).toBeCloseTo(180, 5);
  });

  it("should return exact grid values at grid midpoints", () => {
    const lookup = elevationFromGrid(testGrid);
    // Center (lat=0.5, lng=0.5) → row 1, col 1 → 140
    expect(lookup(0.5, 0.5)).toBeCloseTo(140, 5);
    // North edge midpoint (lat=1, lng=0.5) → row 0, col 1 → 110
    expect(lookup(1, 0.5)).toBeCloseTo(110, 5);
  });

  it("should interpolate linearly along latitude (holding longitude constant)", () => {
    const lookup = elevationFromGrid(testGrid);
    // At lng=0, elevations go 100 (lat=1) → 130 (lat=0.5) → 160 (lat=0)
    // At lat=0.75 (midway between 1 and 0.5), expected = (100+130)/2 = 115
    expect(lookup(0.75, 0)).toBeCloseTo(115, 5);
    // At lat=0.25 (midway between 0.5 and 0), expected = (130+160)/2 = 145
    expect(lookup(0.25, 0)).toBeCloseTo(145, 5);
  });

  it("should interpolate linearly along longitude (holding latitude constant)", () => {
    const lookup = elevationFromGrid(testGrid);
    // At lat=1, elevations go 100 (lng=0) → 110 (lng=0.5) → 120 (lng=1)
    // At lng=0.25 (midway between 0 and 0.5), expected = (100+110)/2 = 105
    expect(lookup(1, 0.25)).toBeCloseTo(105, 5);
  });

  it("should interpolate bilinearly at interior points", () => {
    const lookup = elevationFromGrid(testGrid);
    // At (lat=0.75, lng=0.75):
    // Cell is bounded by row 0 (lat=1) and row 1 (lat=0.5), col 1 (lng=0.5) and col 2 (lng=1)
    // f00 = values[0*3+1] = 110 (NW of cell)
    // f10 = values[0*3+2] = 120 (NE of cell)
    // f01 = values[1*3+1] = 140 (SW of cell)
    // f11 = values[1*3+2] = 150 (SE of cell)
    // dy = (1 - 0.75) / 0.5 = 0.5  (rowFrac = (1-0.75)/0.5 = 0.5, row0=0, dy=0.5)
    // dx = (0.75 - 0.5) / 0.5 = 0.5  (colFrac = (0.75-0)/0.5 = 1.5, col0=1, dx=0.5)
    // f = (1-0.5)(1-0.5)*110 + 0.5*(1-0.5)*120 + (1-0.5)*0.5*140 + 0.5*0.5*150
    //   = 0.25*110 + 0.25*120 + 0.25*140 + 0.25*150
    //   = 27.5 + 30 + 35 + 37.5 = 130
    expect(lookup(0.75, 0.75)).toBeCloseTo(130, 5);
  });

  it("should throw for points outside the grid bounds", () => {
    const lookup = elevationFromGrid(testGrid);
    expect(() => lookup(2, 0)).toThrow(/outside grid bounds/);
    expect(() => lookup(-1, 0)).toThrow(/outside grid bounds/);
    expect(() => lookup(0.5, 2)).toThrow(/outside grid bounds/);
    expect(() => lookup(0.5, -1)).toThrow(/outside grid bounds/);
  });

  it("should handle edge points exactly on the boundary", () => {
    const lookup = elevationFromGrid(testGrid);
    // Points exactly on the east/north boundary should not throw
    expect(() => lookup(1, 1)).not.toThrow();
    expect(() => lookup(0, 1)).not.toThrow();
    expect(() => lookup(1, 0)).not.toThrow();
  });

  it("should throw for grids smaller than 2×2", () => {
    expect(() => elevationFromGrid({
      south: 0, west: 0, north: 1, east: 1,
      rows: 1, cols: 1, values: [100],
    })).toThrow(/at least 2/);
  });

  it("should throw if values length doesn't match rows×cols", () => {
    expect(() => elevationFromGrid({
      south: 0, west: 0, north: 1, east: 1,
      rows: 3, cols: 3, values: [100, 110, 120], // only 3 values, expected 9
    })).toThrow(/does not match/);
  });
});

// ─── Flat terrain (elevation = constant) ───────────────────────────

describe("elevationFromFunction", () => {
  it("should wrap a closure correctly", () => {
    const lookup = elevationFromFunction((lat, lng) => lat * 1000 + lng);
    expect(lookup(1, 2)).toBe(1002);
    expect(lookup(0.5, 0.5)).toBe(500.5);
  });
});

// ─── makeTerrainAware ──────────────────────────────────────────────

describe("makeTerrainAware", () => {
  const flatWaypoints: Waypoint[] = [
    { index: 0, latitude: -1.2864, longitude: 36.8172, altitudeMeters: 75, flightLine: 0, isPhoto: true, gimbalPitchDegrees: -90 },
    { index: 1, latitude: -1.2854, longitude: 36.8172, altitudeMeters: 75, flightLine: 0, isPhoto: true, gimbalPitchDegrees: -90 },
    { index: 2, latitude: -1.2844, longitude: 36.8172, altitudeMeters: 75, flightLine: 0, isPhoto: true, gimbalPitchDegrees: -90 },
  ];

  it("with flat terrain (constant elevation), AMSL altitude should be elevation + AGL", () => {
    const flatElevation = elevationFromFunction(() => 1700); // Nairobi plateau ~1700m AMSL
    const adjusted = makeTerrainAware(flatWaypoints, flatElevation);

    for (const wp of adjusted) {
      expect(wp.altitudeMeters).toBeCloseTo(1700 + 75, 5); // 1775m AMSL
      expect(wp.latitude).toBeCloseTo(wp.latitude, 5);
      expect(wp.longitude).toBeCloseTo(wp.longitude, 5);
    }
  });

  it("with rolling terrain, AMSL altitude should vary to maintain constant AGL", () => {
    // Simulate a hill: elevation increases linearly with latitude
    const hillElevation = elevationFromFunction((lat) => 1700 + (lat + 1.29) * 1000);
    // At lat=-1.2864: elev = 1700 + 3.6 = 1703.6
    // At lat=-1.2854: elev = 1700 + 4.6 = 1704.6
    // At lat=-1.2844: elev = 1700 + 5.6 = 1705.6

    const adjusted = makeTerrainAware(flatWaypoints, hillElevation);

    expect(adjusted[0]!.altitudeMeters).toBeCloseTo(1703.6 + 75, 2);
    expect(adjusted[1]!.altitudeMeters).toBeCloseTo(1704.6 + 75, 2);
    expect(adjusted[2]!.altitudeMeters).toBeCloseTo(1705.6 + 75, 2);

    // All should maintain the same 75m AGL (the delta between AMSL and ground)
    const aGL0 = adjusted[0]!.altitudeMeters - hillElevation(adjusted[0]!.latitude, adjusted[0]!.longitude);
    const aGL1 = adjusted[1]!.altitudeMeters - hillElevation(adjusted[1]!.latitude, adjusted[1]!.longitude);
    const aGL2 = adjusted[2]!.altitudeMeters - hillElevation(adjusted[2]!.latitude, adjusted[2]!.longitude);
    expect(aGL0).toBeCloseTo(75, 5);
    expect(aGL1).toBeCloseTo(75, 5);
    expect(aGL2).toBeCloseTo(75, 5);
  });

  it("should not mutate the input array", () => {
    const originalAltitude = flatWaypoints[0]!.altitudeMeters;
    const flatElevation = elevationFromFunction(() => 1700);
    makeTerrainAware(flatWaypoints, flatElevation);
    expect(flatWaypoints[0]!.altitudeMeters).toBe(originalAltitude);
  });

  it("should handle empty waypoint arrays", () => {
    const flatElevation = elevationFromFunction(() => 1700);
    const adjusted = makeTerrainAware([], flatElevation);
    expect(adjusted).toEqual([]);
  });
});

// ─── computeTerrainStats ───────────────────────────────────────────

describe("computeTerrainStats", () => {
  it("should compute correct stats for flat terrain", () => {
    const waypoints: Waypoint[] = [
      { index: 0, latitude: 0, longitude: 0, altitudeMeters: 1075, flightLine: 0, isPhoto: true },
      { index: 1, latitude: 0.001, longitude: 0, altitudeMeters: 1075, flightLine: 0, isPhoto: true },
    ];
    const flatElevation = elevationFromFunction(() => 1000);
    const stats = computeTerrainStats(waypoints, flatElevation);

    expect(stats.minElevationM).toBeCloseTo(1000, 5);
    expect(stats.maxElevationM).toBeCloseTo(1000, 5);
    expect(stats.meanElevationM).toBeCloseTo(1000, 5);
    expect(stats.elevationRangeM).toBeCloseTo(0, 5);
    expect(stats.elevationStdDevM).toBeCloseTo(0, 5);
    expect(stats.minAltitudeAMSLM).toBeCloseTo(1075, 5);
    expect(stats.maxAltitudeAMSLM).toBeCloseTo(1075, 5);
  });

  it("should compute correct stats for rolling terrain", () => {
    // Three waypoints at different elevations: 1000, 1100, 1200
    const waypoints: Waypoint[] = [
      { index: 0, latitude: 0, longitude: 0, altitudeMeters: 1075, flightLine: 0, isPhoto: true },
      { index: 1, latitude: 0.001, longitude: 0, altitudeMeters: 1175, flightLine: 0, isPhoto: true },
      { index: 2, latitude: 0.002, longitude: 0, altitudeMeters: 1275, flightLine: 0, isPhoto: true },
    ];
    const rollingElevation = elevationFromFunction((lat) => 1000 + lat * 100_000);
    // At lat=0: elev=1000, At lat=0.001: elev=1100, At lat=0.002: elev=1200
    const stats = computeTerrainStats(waypoints, rollingElevation);

    expect(stats.minElevationM).toBeCloseTo(1000, 1);
    expect(stats.maxElevationM).toBeCloseTo(1200, 1);
    expect(stats.meanElevationM).toBeCloseTo(1100, 1);
    expect(stats.elevationRangeM).toBeCloseTo(200, 1);
    expect(stats.elevationStdDevM).toBeCloseTo(81.65, 1); // std of [1000,1100,1200] = sqrt(20000/3) ≈ 81.65
    expect(stats.minAltitudeAMSLM).toBeCloseTo(1075, 1);
    expect(stats.maxAltitudeAMSLM).toBeCloseTo(1275, 1);
  });

  it("should return zeros for empty waypoint arrays", () => {
    const elevation = elevationFromFunction(() => 1000);
    const stats = computeTerrainStats([], elevation);
    expect(stats).toEqual({
      minElevationM: 0,
      maxElevationM: 0,
      meanElevationM: 0,
      elevationRangeM: 0,
      elevationStdDevM: 0,
      minAltitudeAMSLM: 0,
      maxAltitudeAMSLM: 0,
    });
  });
});

// ─── Property-based tests ──────────────────────────────────────────

describe("property-based tests", () => {
  it("bilinear interpolation should be continuous (no jumps at grid cell boundaries)", () => {
    // Create a 3×3 grid with random values
    const grid: ElevationGrid = {
      south: 0, west: 0, north: 1, east: 1,
      rows: 3, cols: 3,
      values: [100, 150, 200, 130, 180, 230, 160, 210, 260],
    };
    const lookup = elevationFromGrid(grid);

    fc.assert(
      fc.property(
        fc.double({ min: 0.05, max: 0.95, noNaN: true }),
        fc.double({ min: 0.05, max: 0.95, noNaN: true }),
        fc.double({ min: 0.001, max: 0.01, noNaN: true }),
        (lat, lng, delta) => {
          // Elevation at (lat, lng) should be close to elevation at (lat+delta, lng)
          const e1 = lookup(lat, lng);
          const e2 = lookup(lat + delta, lng);
          // For a small delta, the change should be small (Lipschitz continuity)
          // Maximum slope in our grid is 100 per 0.5 = 200 per unit
          const maxExpectedChange = delta * 200 * 2; // generous bound
          return Math.abs(e2 - e1) <= maxExpectedChange;
        }
      ),
      { numRuns: 200 }
    );
  });

  it("flat terrain should produce uniform AMSL altitudes", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1600, max: 2000 }),
        (elev) => {
          const waypoints: Waypoint[] = Array.from({ length: 10 }, (_, i) => ({
            index: i,
            latitude: -1.2864 + i * 0.0001,
            longitude: 36.8172,
            altitudeMeters: 75,
            flightLine: 0,
            isPhoto: true,
          }));
          const flatElevation = elevationFromFunction(() => elev);
          const adjusted = makeTerrainAware(waypoints, flatElevation);
          // All altitudes should be elev + 75
          return adjusted.every((wp) => Math.abs(wp.altitudeMeters - (elev + 75)) < 0.001);
        }
      ),
      { numRuns: 50 }
    );
  });
});
