/**
 * Tests for lawnmower waypoint generation.
 *
 * Verifies:
 *   - Waypoint count matches expected values for known survey areas
 *   - Waypoints are within the survey area bounding box (with margin)
 *   - Flight lines alternate direction (lawnmower pattern)
 *   - Headings are computed correctly
 *   - Mission stats (distance, time) are reasonable
 *   - Property-based tests for invariants
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  generateLawnmowerWaypoints,
  computeBoundingBox,
  computeMissionStats,
  offsetToLatLng,
  bearingDegrees,
  haversineMeters,
  type SurveyArea,
  type LawnmowerOptions,
} from "../waypoints.js";
import { computeFlightPlanParameters } from "../footprint.js";
import { getCameraById } from "../cameras.js";

// Helper: Mavic 3 Enterprise at 75m AGL, 75% front / 65% side overlap
const MAVIC3_PARAMS = () =>
  computeFlightPlanParameters(getCameraById("dji-mavic-3-enterprise"), 75, 0.75, 0.65);

// Helper: 50-hectare square survey area (500m × 1000m) in Nairobi (-1.2864, 36.8172)
const NAIROBI_50HA: SurveyArea = {
  coordinates: [
    { lat: -1.2864, lng: 36.8172 }, // SW corner
    { lat: -1.2774, lng: 36.8172 }, // NW corner (≈ 1000m north)
    { lat: -1.2774, lng: 36.8227 }, // NE corner (≈ 500m east)
    { lat: -1.2864, lng: 36.8227 }, // SE corner
    { lat: -1.2864, lng: 36.8172 }, // close polygon
  ],
};

describe("computeBoundingBox", () => {
  it("should compute correct bbox for Nairobi 50ha area", () => {
    const bbox = computeBoundingBox(NAIROBI_50HA);
    expect(bbox.minLat).toBeCloseTo(-1.2864, 5);
    expect(bbox.maxLat).toBeCloseTo(-1.2774, 5);
    expect(bbox.minLng).toBeCloseTo(36.8172, 5);
    expect(bbox.maxLng).toBeCloseTo(36.8227, 5);
    expect(bbox.centerLat).toBeCloseTo(-1.2819, 5);
    expect(bbox.centerLng).toBeCloseTo(36.81995, 5);
    // Height: 0.009 degrees lat × 111,320 m/deg = 1,001.9 m
    expect(bbox.heightMeters).toBeCloseTo(1002, 0);
    // Width: 0.0055 degrees lng × 111,320 × cos(1.2819°) = 612.0 m
    // (The polygon spans 36.8172 to 36.8227 = 0.0055 degrees, not 500m)
    expect(bbox.widthMeters).toBeCloseTo(612, 0);
  });

  it("should throw for polygons with fewer than 4 points", () => {
    expect(() => computeBoundingBox({ coordinates: [] })).toThrow();
    expect(() => computeBoundingBox({ coordinates: [{ lat: 0, lng: 0 }] })).toThrow();
    expect(() => computeBoundingBox({
      coordinates: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, { lat: 0, lng: 0 }],
    })).toThrow();
  });
});

describe("offsetToLatLng", () => {
  it("should convert (0, 0) offset to the reference point itself", () => {
    const { lat, lng } = offsetToLatLng(-1.2864, 36.8172, 0, 0);
    expect(lat).toBeCloseTo(-1.2864, 8);
    expect(lng).toBeCloseTo(36.8172, 8);
  });

  it("moving 111.32 km north should increase latitude by ~1 degree", () => {
    const { lat } = offsetToLatLng(0, 0, 0, 111_320);
    expect(lat).toBeCloseTo(1.0, 4);
  });

  it("moving 111.32 km east at equator should increase longitude by ~1 degree", () => {
    const { lng } = offsetToLatLng(0, 0, 111_320, 0);
    expect(lng).toBeCloseTo(1.0, 4);
  });

  it("moving 111.32 km east at 60° latitude should increase longitude by ~2 degrees", () => {
    // cos(60°) = 0.5, so 1 degree of longitude = 111320 * 0.5 = 55660 m
    // To go 1 degree east at 60°N: 55660 * 1 = 55660 m
    // But we go 111320 m, so we should get ~2 degrees
    const { lng } = offsetToLatLng(60, 0, 111_320, 0);
    expect(lng).toBeCloseTo(2.0, 4);
  });
});

describe("bearingDegrees", () => {
  it("bearing from (0,0) to (1,0) should be 0 (due north)", () => {
    expect(bearingDegrees(0, 0, 1, 0)).toBeCloseTo(0, 1);
  });

  it("bearing from (0,0) to (0,1) should be 90 (due east)", () => {
    expect(bearingDegrees(0, 0, 0, 1)).toBeCloseTo(90, 1);
  });

  it("bearing from (0,0) to (-1,0) should be 180 (due south)", () => {
    expect(bearingDegrees(0, 0, -1, 0)).toBeCloseTo(180, 1);
  });

  it("bearing from (0,0) to (0,-1) should be 270 (due west)", () => {
    expect(bearingDegrees(0, 0, 0, -1)).toBeCloseTo(270, 1);
  });
});

describe("haversineMeters", () => {
  it("distance from (0,0) to (0,0) should be 0", () => {
    expect(haversineMeters(0, 0, 0, 0)).toBe(0);
  });

  it("distance from (0,0) to (1,0) should be ~111,195 m (1 degree latitude, Earth radius 6,371 km)", () => {
    // Using Earth's mean radius R = 6,371,000 m:
    //   circumference = 2πR = 40,030,231 m
    //   per degree = 40,030,231 / 360 = 111,194.9 m
    expect(haversineMeters(0, 0, 1, 0)).toBeCloseTo(111_195, -2);
  });

  it("distance from (0,0) to (0,1) should be ~111,195 m (1 degree longitude at equator)", () => {
    expect(haversineMeters(0, 0, 0, 1)).toBeCloseTo(111_195, -2);
  });
});

describe("generateLawnmowerWaypoints — basic generation", () => {
  it("should generate waypoints for Nairobi 50ha area with Mavic 3 at 75m", () => {
    const wps = generateLawnmowerWaypoints({
      params: MAVIC3_PARAMS(),
      area: NAIROBI_50HA,
    });

    // Should have a reasonable number of waypoints (not 0, not millions)
    expect(wps.length).toBeGreaterThan(50);
    expect(wps.length).toBeLessThan(2000);

    // All waypoints should have valid coordinates
    for (const wp of wps) {
      expect(wp.latitude).toBeGreaterThan(-1.30);
      expect(wp.latitude).toBeLessThan(-1.27);
      expect(wp.longitude).toBeGreaterThan(36.81);
      expect(wp.longitude).toBeLessThan(36.83);
      expect(wp.altitudeMeters).toBe(75);
      expect(wp.isPhoto).toBe(true);
      expect(wp.gimbalPitchDegrees).toBe(-90); // nadir
    }

    // First waypoint should have index 0
    expect(wps[0]!.index).toBe(0);
    // Indices should be sequential
    for (let i = 0; i < wps.length; i++) {
      expect(wps[i]!.index).toBe(i);
    }
  });

  it("should generate more waypoints for smaller photo spacing (higher overlap)", () => {
    const lowOverlap = computeFlightPlanParameters(
      getCameraById("dji-mavic-3-enterprise"), 75, 0.6, 0.5
    );
    const highOverlap = computeFlightPlanParameters(
      getCameraById("dji-mavic-3-enterprise"), 75, 0.85, 0.75
    );

    const wpsLow = generateLawnmowerWaypoints({ params: lowOverlap, area: NAIROBI_50HA });
    const wpsHigh = generateLawnmowerWaypoints({ params: highOverlap, area: NAIROBI_50HA });

    // Higher overlap → smaller spacing → more waypoints
    expect(wpsHigh.length).toBeGreaterThan(wpsLow.length);
  });

  it("flight lines should alternate direction (lawnmower pattern)", () => {
    const wps = generateLawnmowerWaypoints({
      params: MAVIC3_PARAMS(),
      area: NAIROBI_50HA,
    });

    // Group waypoints by flight line
    const lines = new Map<number, typeof wps>();
    for (const wp of wps) {
      if (!lines.has(wp.flightLine)) lines.set(wp.flightLine, []);
      lines.get(wp.flightLine)!.push(wp);
    }

    // Check that consecutive lines have opposite latitude direction
    const sortedLineIdxs = Array.from(lines.keys()).sort((a, b) => a - b);
    expect(sortedLineIdxs.length).toBeGreaterThan(1);

    for (let i = 1; i < sortedLineIdxs.length; i++) {
      const prevLine = lines.get(sortedLineIdxs[i - 1]!)!;
      const currLine = lines.get(sortedLineIdxs[i]!)!;

      // Previous line direction: last - first latitude
      const prevDir = prevLine[prevLine.length - 1]!.latitude - prevLine[0]!.latitude;
      // Current line direction: last - first latitude
      const currDir = currLine[currLine.length - 1]!.latitude - currLine[0]!.latitude;

      // Directions should have opposite signs (one north, one south)
      expect(Math.sign(prevDir)).not.toBe(Math.sign(currDir));
    }
  });

  it("should throw for invalid margin", () => {
    expect(() => generateLawnmowerWaypoints({
      params: MAVIC3_PARAMS(),
      area: NAIROBI_50HA,
      margin: -0.1,
    })).toThrow();
    expect(() => generateLawnmowerWaypoints({
      params: MAVIC3_PARAMS(),
      area: NAIROBI_50HA,
      margin: 1.5,
    })).toThrow();
  });
});

describe("generateLawnmowerWaypoints — flight line orientation", () => {
  it("should auto-select east-west flight for wide (landscape) areas", () => {
    // Wide area: 1000m × 500m (east-west wider)
    const wideArea: SurveyArea = {
      coordinates: [
        { lat: -1.2864, lng: 36.8172 },
        { lat: -1.2819, lng: 36.8172 }, // 500m north
        { lat: -1.2819, lng: 36.8263 }, // 1000m east
        { lat: -1.2864, lng: 36.8263 },
        { lat: -1.2864, lng: 36.8172 },
      ],
    };

    const wps = generateLawnmowerWaypoints({
      params: MAVIC3_PARAMS(),
      area: wideArea,
    });

    // For east-west flight, consecutive waypoints on the same line should
    // have similar latitudes and changing longitudes
    const firstLine = wps.filter((w) => w.flightLine === 0);
    expect(firstLine.length).toBeGreaterThan(2);

    // Latitude should be roughly constant on the first line
    const lats = firstLine.map((w) => w.latitude);
    const latSpread = Math.max(...lats) - Math.min(...lats);
    expect(latSpread).toBeLessThan(0.0001); // ~10m tolerance

    // Longitude should vary significantly
    const lngs = firstLine.map((w) => w.longitude);
    const lngSpread = Math.max(...lngs) - Math.min(...lngs);
    expect(lngSpread).toBeGreaterThan(0.005); // >500m
  });

  it("should auto-select north-south flight for tall (portrait) areas", () => {
    // Tall area: 500m × 1000m (north-south taller)
    const tallArea: SurveyArea = {
      coordinates: [
        { lat: -1.2864, lng: 36.8172 },
        { lat: -1.2774, lng: 36.8172 }, // 1000m north
        { lat: -1.2774, lng: 36.8222 }, // 500m east
        { lat: -1.2864, lng: 36.8222 },
        { lat: -1.2864, lng: 36.8172 },
      ],
    };

    const wps = generateLawnmowerWaypoints({
      params: MAVIC3_PARAMS(),
      area: tallArea,
    });

    // For north-south flight, consecutive waypoints on the same line should
    // have similar longitudes and changing latitudes
    const firstLine = wps.filter((w) => w.flightLine === 0);
    expect(firstLine.length).toBeGreaterThan(2);

    const lngs = firstLine.map((w) => w.longitude);
    const lngSpread = Math.max(...lngs) - Math.min(...lngs);
    expect(lngSpread).toBeLessThan(0.0001);

    const lats = firstLine.map((w) => w.latitude);
    const latSpread = Math.max(...lats) - Math.min(...lats);
    expect(latSpread).toBeGreaterThan(0.005); // >500m
  });
});

describe("computeMissionStats", () => {
  it("should compute reasonable stats for Nairobi 50ha mission", () => {
    const params = MAVIC3_PARAMS();
    const wps = generateLawnmowerWaypoints({ params, area: NAIROBI_50HA });
    const stats = computeMissionStats(wps, 15); // Mavic 3 cruise speed 15 m/s

    expect(stats.totalWaypoints).toBe(wps.length);
    expect(stats.totalPhotos).toBe(wps.length); // all waypoints are photos in our generator
    expect(stats.flightLineCount).toBeGreaterThan(5);
    expect(stats.flightLineCount).toBeLessThan(60);
    expect(stats.photosPerLine).toBeGreaterThan(5);
    expect(stats.totalDistanceMeters).toBeGreaterThan(10_000); // at least 10km
    expect(stats.totalDistanceMeters).toBeLessThan(100_000); // less than 100km
    expect(stats.estimatedFlightTimeMin).toBeGreaterThan(10); // at least 10 minutes
    expect(stats.estimatedFlightTimeMin).toBeLessThan(60); // less than 1 hour
  });

  it("should return zeros for empty waypoint list", () => {
    const stats = computeMissionStats([], 15);
    expect(stats.totalWaypoints).toBe(0);
    expect(stats.totalPhotos).toBe(0);
    expect(stats.flightLineCount).toBe(0);
    expect(stats.totalDistanceMeters).toBe(0);
    expect(stats.estimatedFlightTimeMin).toBe(0);
  });
});

// ─── Property-based tests ──────────────────────────────────────────
describe("property-based tests", () => {
  it("waypoint indices should always be 0, 1, 2, ... sequential", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 30, max: 150 }), // altitude
        fc.double({ min: 0.5, max: 0.9, noNaN: true }), // front overlap
        fc.double({ min: 0.4, max: 0.85, noNaN: true }), // side overlap
        (alt, front, side) => {
          const params = computeFlightPlanParameters(
            getCameraById("dji-mavic-3-enterprise"), alt, front, side
          );
          const wps = generateLawnmowerWaypoints({ params, area: NAIROBI_50HA });
          for (let i = 0; i < wps.length; i++) {
            if (wps[i]!.index !== i) return false;
          }
          return true;
        }
      ),
      { numRuns: 50 }
    );
  });

  it("all waypoints should be within the survey area bounding box (with generous tolerance)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 50, max: 200 }),
        (alt) => {
          const params = computeFlightPlanParameters(
            getCameraById("dji-mavic-3-enterprise"), alt, 0.75, 0.65
          );
          const wps = generateLawnmowerWaypoints({ params, area: NAIROBI_50HA, margin: 0.1 });

          // Waypoints can extend beyond the original bbox because of the 10% margin
          // AND because the last flight line/photo can land just past the effective area.
          // We allow up to 30% beyond the original bbox in each direction.
          const bbox = computeBoundingBox(NAIROBI_50HA);
          const latMargin = (bbox.maxLat - bbox.minLat) * 0.3;
          const lngMargin = (bbox.maxLng - bbox.minLng) * 0.3;

          for (const wp of wps) {
            if (wp.latitude < bbox.minLat - latMargin) return false;
            if (wp.latitude > bbox.maxLat + latMargin) return false;
            if (wp.longitude < bbox.minLng - lngMargin) return false;
            if (wp.longitude > bbox.maxLng + lngMargin) return false;
          }
          return true;
        }
      ),
      { numRuns: 30 }
    );
  });
});
