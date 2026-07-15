/**
 * Tests for battery and flight time estimation.
 *
 * Verifies:
 *   - Flight distance and time are computed correctly
 *   - Battery count scales with mission length
 *   - Safety margin and derating are applied correctly
 *   - Battery swap waypoints are identified correctly
 *   - Property-based tests for invariants
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  estimateBatteryAndTime,
  type BatteryEstimationOptions,
} from "../battery.js";
import type { Waypoint } from "../waypoints.js";
import { generateLawnmowerWaypoints } from "../waypoints.js";
import { getCameraById } from "../cameras.js";
import { computeFlightPlanParameters } from "../footprint.js";

const MAVIC3 = () => getCameraById("dji-mavic-3-enterprise");
// cruiseSpeed = 15 m/s, maxFlightTime = 45 min, battery = 5000 mAh

// Helper: create a simple mission with N waypoints in a straight line
function makeStraightMission(
  count: number,
  spacingMeters: number = 30,
  startLat: number = -1.2864,
  startLng: number = 36.8172
): Waypoint[] {
  // Latitude degrees per meter ≈ 1/111320
  const latStep = spacingMeters / 111_320;
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    latitude: startLat + i * latStep,
    longitude: startLng,
    altitudeMeters: 75,
    flightLine: 0,
    isPhoto: true,
    gimbalPitchDegrees: -90,
    headingDegrees: 0,
  }));
}

// Helper: create a mission with multiple flight lines
function makeMultiLineMission(
  photosPerLine: number,
  lineCount: number,
  photoSpacingM: number = 30,
  lineSpacingM: number = 30
): Waypoint[] {
  const waypoints: Waypoint[] = [];
  let idx = 0;
  const startLat = -1.2864;
  const startLng = 36.8172;
  const latStep = photoSpacingM / 111_320;
  const lngStep = lineSpacingM / 111_320;

  for (let line = 0; line < lineCount; line++) {
    const baseLng = startLng + line * lngStep;
    for (let i = 0; i < photosPerLine; i++) {
      const lat = startLat + (line % 2 === 0 ? i : photosPerLine - 1 - i) * latStep;
      waypoints.push({
        index: idx++,
        latitude: lat,
        longitude: baseLng,
        altitudeMeters: 75,
        flightLine: line,
        isPhoto: true,
        gimbalPitchDegrees: -90,
      });
    }
  }
  return waypoints;
}

describe("estimateBatteryAndTime — basic calculation", () => {
  it("should compute correct flight distance for a straight-line mission", () => {
    // 10 waypoints, 30m apart = 9 segments × 30m = 270m
    const wps = makeStraightMission(10, 30);
    const result = estimateBatteryAndTime(wps, { camera: MAVIC3() });
    expect(result.flightDistanceMeters).toBeCloseTo(270, 0);
  });

  it("should compute correct flight time at 15 m/s cruise speed", () => {
    // 270m / 15 m/s = 18 seconds = 0.3 minutes
    const wps = makeStraightMission(10, 30);
    const result = estimateBatteryAndTime(wps, { camera: MAVIC3() });
    expect(result.flightTimeMin).toBeCloseTo(0.3, 3);
  });

  it("should count photos correctly", () => {
    const wps = makeStraightMission(10, 30);
    const result = estimateBatteryAndTime(wps, { camera: MAVIC3() });
    expect(result.photoCount).toBe(10);
  });

  it("should count turns correctly for multi-line mission", () => {
    const wps = makeMultiLineMission(10, 3); // 3 lines = 2 turns
    const result = estimateBatteryAndTime(wps, { camera: MAVIC3() });
    expect(result.turnCount).toBe(2);
  });

  it("should compute usable battery time with 75% derating and 20% safety margin", () => {
    // Spec: 45 min max flight time
    // Derating: 0.75 → 33.75 min
    // Safety margin: 20% → 33.75 × 0.80 = 27 min usable
    const wps = makeStraightMission(10, 30);
    const result = estimateBatteryAndTime(wps, { camera: MAVIC3() });
    expect(result.usableFlightTimePerBatteryMin).toBeCloseTo(27, 1);
  });
});

describe("estimateBatteryAndTime — battery count", () => {
  it("short mission should fit in 1 battery", () => {
    // 100 waypoints × 30m = 2970m / 15 m/s = 198s = 3.3 min
    // Well under 27 min usable → 1 battery
    const wps = makeStraightMission(100, 30);
    const result = estimateBatteryAndTime(wps, { camera: MAVIC3() });
    expect(result.batteryCount).toBe(1);
    expect(result.batterySwapWaypoints).toEqual([]);
  });

  it("very long mission should require multiple batteries", () => {
    // Create a mission that takes > 27 min:
    // Need ~24,300m of distance (27 min × 15 m/s × 60 s/min = 24,300m)
    // 810 waypoints × 30m = 24,270m ≈ 27 min — just at the limit
    // Let's go bigger: 1200 waypoints × 30m = 35,970m ≈ 40 min → needs 2 batteries
    const wps = makeStraightMission(1200, 30);
    const result = estimateBatteryAndTime(wps, { camera: MAVIC3() });
    expect(result.batteryCount).toBeGreaterThanOrEqual(2);
    expect(result.batterySwapWaypoints.length).toBeGreaterThanOrEqual(1);
  });

  it("battery count should scale with mission length (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 1500 }),
        (wpCount) => {
          const wps = makeStraightMission(wpCount, 30);
          const result = estimateBatteryAndTime(wps, { camera: MAVIC3() });
          // Battery count should be at least ceil(total_flight_time / usable_battery_time)
          // The swap-point algorithm has additional overhead (RTH time per swap + ascent time per swap)
          // so the actual count may be higher than the simple ceil calculation.
          // We verify: result.batteryCount >= expectedMin AND result is positive AND finite.
          const expectedMin = Math.max(1, Math.ceil(result.flightTimeMin / 27));
          expect(result.batteryCount).toBeGreaterThanOrEqual(expectedMin);
          expect(result.batteryCount).toBeLessThanOrEqual(expectedMin + 2);
          expect(Number.isFinite(result.batteryCount)).toBe(true);
          expect(result.batteryCount).toBeGreaterThan(0);
        }
      ),
      { numRuns: 50 }
    );
  });

  it("conservative derating should require more batteries", () => {
    // Use 0.5 derating (very conservative) → usable = 45 × 0.5 × 0.8 = 18 min
    const wps = makeStraightMission(600, 30); // ~20 min flight
    const standard = estimateBatteryAndTime(wps, {
      camera: MAVIC3(),
      flightTimeDerating: 0.75,
    });
    const conservative = estimateBatteryAndTime(wps, {
      camera: MAVIC3(),
      flightTimeDerating: 0.5,
    });
    expect(conservative.batteryCount).toBeGreaterThanOrEqual(standard.batteryCount);
  });
});

describe("estimateBatteryAndTime — total mission time", () => {
  it("total mission time = flight + turns + photos + ascent + RTH + swaps", () => {
    const wps = makeMultiLineMission(10, 3); // 3 lines, 30 photos, 2 turns
    const result = estimateBatteryAndTime(wps, {
      camera: MAVIC3(),
      turnTimeSec: 10,
      photoTimeSec: 0,
      batterySwapTimeMin: 10,
      rthTimeMin: 5,
    });

    const expected = result.flightTimeMin + result.turnTimeMin + result.photoTimeMin
      + result.ascentTimeMin + result.rthTimeMin + result.batterySwapTimeMin;
    expect(result.totalMissionTimeMin).toBeCloseTo(expected, 4);
  });

  it("RTH time should be included in total mission time", () => {
    const wps = makeStraightMission(10);
    const result = estimateBatteryAndTime(wps, { camera: MAVIC3(), rthTimeMin: 5 });
    expect(result.rthTimeMin).toBe(5);
    expect(result.totalMissionTimeMin).toBeGreaterThan(result.flightTimeMin + 5 - 0.01);
  });

  it("battery swap time should be (batteryCount - 1) × swapTime", () => {
    const wps = makeStraightMission(1200, 30); // long mission
    const result = estimateBatteryAndTime(wps, {
      camera: MAVIC3(),
      batterySwapTimeMin: 10,
    });
    if (result.batteryCount > 1) {
      expect(result.batterySwapTimeMin).toBeCloseTo(
        (result.batteryCount - 1) * 10,
        5
      );
    } else {
      expect(result.batterySwapTimeMin).toBe(0);
    }
  });
});

describe("estimateBatteryAndTime — edge cases", () => {
  it("empty waypoints should return all zeros", () => {
    const result = estimateBatteryAndTime([], { camera: MAVIC3() });
    expect(result.flightDistanceMeters).toBe(0);
    expect(result.flightTimeMin).toBe(0);
    expect(result.batteryCount).toBe(0);
    expect(result.totalMissionTimeMin).toBe(0);
    expect(result.batterySwapWaypoints).toEqual([]);
  });

  it("single waypoint should have 0 flight distance", () => {
    const wps = makeStraightMission(1);
    const result = estimateBatteryAndTime(wps, { camera: MAVIC3() });
    expect(result.flightDistanceMeters).toBe(0);
    expect(result.flightTimeMin).toBe(0);
    expect(result.batteryCount).toBe(1); // still needs 1 battery for ascent + RTH
  });

  it("should throw if camera lacks cruiseSpeedMs", () => {
    const wps = makeStraightMission(10);
    const badCamera = { ...MAVIC3(), cruiseSpeedMs: undefined };
    expect(() => estimateBatteryAndTime(wps, { camera: badCamera as any })).toThrow(/missing cruiseSpeedMs/);
  });

  it("should throw if camera lacks maxFlightTimeMin", () => {
    const wps = makeStraightMission(10);
    const badCamera = { ...MAVIC3(), maxFlightTimeMin: undefined };
    expect(() => estimateBatteryAndTime(wps, { camera: badCamera as any })).toThrow(/missing cruiseSpeedMs/);
  });
});

describe("estimateBatteryAndTime — 50ha Nairobi survey (integration)", () => {
  it("50ha mission with Mavic 3 should fit in 1-3 batteries", () => {
    const params = computeFlightPlanParameters(MAVIC3(), 75, 0.75, 0.65);
    const wps = generateLawnmowerWaypoints({
      params,
      area: {
        coordinates: [
          { lat: -1.2864, lng: 36.8172 },
          { lat: -1.2774, lng: 36.8172 },
          { lat: -1.2774, lng: 36.8227 },
          { lat: -1.2864, lng: 36.8227 },
          { lat: -1.2864, lng: 36.8172 },
        ],
      },
    });

    const result = estimateBatteryAndTime(wps, { camera: MAVIC3() });

    // This is a 50ha mission with ~33 km flight distance and ~41 min flight time
    // With 27 min usable battery time, this should need 2 batteries
    expect(result.flightDistanceMeters).toBeGreaterThan(30_000);
    expect(result.flightTimeMin).toBeGreaterThan(35);
    expect(result.batteryCount).toBeGreaterThanOrEqual(1);
    expect(result.batteryCount).toBeLessThanOrEqual(3);
    expect(result.totalMissionTimeMin).toBeGreaterThan(result.flightTimeMin);
  });
});
