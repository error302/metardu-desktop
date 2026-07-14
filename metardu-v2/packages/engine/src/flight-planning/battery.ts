/**
 * Battery and flight time estimation for drone survey missions.
 *
 * Computes:
 *   - Total flight time (straight-line distance / cruise speed + 10s per turn)
 *   - Number of batteries required (with safety margin)
 *   - Battery swap points (which waypoint triggers a return-to-home for battery swap)
 *   - Total mission time including battery swaps (10 min per swap)
 *
 * References:
 *   - DJI Mavic 3 Enterprise spec: 45 min max flight time (hover, no wind, sea level)
 *   - Real-world flight time is typically 70-80% of spec due to:
 *     - Wind resistance
 *     - Photo capture (drone slows or stops)
 *     - Ascent/descent
 *     - Battery health degradation
 *   - Safety margin: 20% (drone must return home with 20% battery remaining)
 *
 * The estimation uses the drone's published max flight time and applies
 * a configurable derating factor (default 0.75 for real-world conditions).
 */

import type { Waypoint } from "./waypoints.js";
import { haversineMeters } from "./waypoints.js";
import type { CameraSpec } from "./cameras.js";

/**
 * Options for battery and flight time estimation.
 */
export interface BatteryEstimationOptions {
  /** Camera spec (provides cruise speed, max flight time, battery capacity) */
  camera: CameraSpec;
  /**
   * Derating factor for real-world flight time.
   * 1.0 = use spec flight time as-is (ideal conditions).
   * 0.75 = use 75% of spec (realistic, default).
   * 0.6 = conservative (high wind, cold weather, aging battery).
   */
  flightTimeDerating?: number;
  /**
   * Safety margin: drone must return home with this fraction of battery remaining.
   * Default 0.20 (20% — standard for LiPo batteries to avoid deep discharge damage).
   */
  batterySafetyMargin?: number;
  /**
   * Time per turn in seconds. Default 10s (decelerate, rotate, accelerate).
   */
  turnTimeSec?: number;
  /**
   * Time per photo capture in seconds. Default 0 (most cameras trigger on the fly).
   * Set to 1-2 for cameras that require the drone to stop and stabilize.
   */
  photoTimeSec?: number;
  /**
   * Time per battery swap in minutes. Default 10 (land, swap, take off, climb to altitude).
   */
  batterySwapTimeMin?: number;
  /**
   * Return-to-home (RTH) time in minutes. Default 5 (descent + travel to home + landing).
   */
  rthTimeMin?: number;
  /**
   * Takeoff security height in meters (drone ascends to this height before flying to first waypoint).
   * Default 30m.
   */
  takeoffSecurityHeightM?: number;
  /**
   * Ascent/descent speed in meters per second. Default 5 m/s (typical for DJI Mavic class).
   */
  verticalSpeedMs?: number;
}

/**
 * Result of battery and flight time estimation.
 */
export interface BatteryEstimation {
  /** Total straight-line flight distance in meters (excluding RTH) */
  flightDistanceMeters: number;
  /** Total flight time in minutes (excluding RTH and battery swaps) */
  flightTimeMin: number;
  /** Time spent turning in minutes */
  turnTimeMin: number;
  /** Time spent on photo capture in minutes */
  photoTimeMin: number;
  /** Time spent on ascent (takeoff + post-swap climb) in minutes */
  ascentTimeMin: number;
  /** Number of turns (flight line count - 1) */
  turnCount: number;
  /** Number of photos in the mission */
  photoCount: number;
  /** Usable flight time per battery in minutes (after derating and safety margin) */
  usableFlightTimePerBatteryMin: number;
  /** Number of batteries required to complete the mission */
  batteryCount: number;
  /** Total mission time in minutes (flight + RTH + battery swaps) */
  totalMissionTimeMin: number;
  /** Return-to-home time in minutes */
  rthTimeMin: number;
  /** Battery swap time in minutes (total across all swaps) */
  batterySwapTimeMin: number;
  /** Waypoint indices where the drone must return home for a battery swap */
  batterySwapWaypoints: number[];
}

/**
 * Estimate battery count and flight time for a mission.
 *
 * @param waypoints Array of waypoints (typically from generateLawnmowerWaypoints)
 * @param options Estimation options
 */
export function estimateBatteryAndTime(
  waypoints: Waypoint[],
  options: BatteryEstimationOptions
): BatteryEstimation {
  if (waypoints.length === 0) {
    return {
      flightDistanceMeters: 0,
      flightTimeMin: 0,
      turnTimeMin: 0,
      photoTimeMin: 0,
      ascentTimeMin: 0,
      turnCount: 0,
      photoCount: 0,
      usableFlightTimePerBatteryMin: 0,
      batteryCount: 0,
      totalMissionTimeMin: 0,
      rthTimeMin: 0,
      batterySwapTimeMin: 0,
      batterySwapWaypoints: [],
    };
  }

  const {
    camera,
    flightTimeDerating = 0.75,
    batterySafetyMargin = 0.20,
    turnTimeSec = 10,
    photoTimeSec = 0,
    batterySwapTimeMin = 10,
    rthTimeMin = 5,
    takeoffSecurityHeightM = 30,
    verticalSpeedMs = 5,
  } = options;

  // Validate camera has the required fields
  const cruiseSpeed = camera.cruiseSpeedMs;
  const maxFlightTimeMin = camera.maxFlightTimeMin;
  if (!cruiseSpeed || !maxFlightTimeMin) {
    throw new Error(
      `Camera ${camera.id} missing cruiseSpeedMs or maxFlightTimeMin — required for battery estimation`
    );
  }

  // Compute usable flight time per battery (after derating and safety margin)
  const usableFlightTimePerBatteryMin = maxFlightTimeMin * flightTimeDerating * (1 - batterySafetyMargin);

  // Compute total flight distance (straight-line between consecutive waypoints)
  let flightDistance = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const prev = waypoints[i - 1]!;
    const curr = waypoints[i]!;
    flightDistance += haversineMeters(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
  }

  // Count turns (each flight line change is a turn)
  const flightLines = new Set(waypoints.map((w) => w.flightLine));
  const turnCount = flightLines.size - 1;

  // Count photos
  const photoCount = waypoints.filter((w) => w.isPhoto).length;

  // Compute time components
  const flightTimeSec = flightDistance / cruiseSpeed;
  const turnTimeTotalSec = turnCount * turnTimeSec;
  const photoTimeTotalSec = photoCount * photoTimeSec;
  const ascentTimeSec = (takeoffSecurityHeightM / verticalSpeedMs) * 60; // convert to seconds

  const flightTimeMin = flightTimeSec / 60;
  const turnTimeMin = turnTimeTotalSec / 60;
  const photoTimeMin = photoTimeTotalSec / 60;
  const ascentTimeMin = ascentTimeSec / 60;

  // Total active flight time (excluding RTH and swaps)
  const totalActiveFlightTimeMin = flightTimeMin + turnTimeMin + photoTimeMin + ascentTimeMin;

  // Determine battery swap points
  // Walk through waypoints, accumulating time. When accumulated time + RTH time
  // exceeds usable battery time, mark a swap point.
  const batterySwapWaypoints: number[] = [];
  let currentBatteryTimeMin = ascentTimeMin; // start with ascent
  let batteriesUsed = 1;

  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i]!;
    const next = waypoints[i + 1];

    // Add photo time at this waypoint
    if (wp.isPhoto) {
      currentBatteryTimeMin += photoTimeSec / 60;
    }

    // Add travel time to next waypoint
    if (next) {
      const dist = haversineMeters(wp.latitude, wp.longitude, next.latitude, next.longitude);
      currentBatteryTimeMin += (dist / cruiseSpeed) / 60;

      // Add turn time if flight line changes
      if (next.flightLine !== wp.flightLine) {
        currentBatteryTimeMin += turnTimeSec / 60;
      }
    }

    // Check if we need to swap battery before continuing
    // We need: current_time + RTH_time <= usable_battery_time
    if (currentBatteryTimeMin + rthTimeMin > usableFlightTimePerBatteryMin && next) {
      batterySwapWaypoints.push(wp.index);
      batteriesUsed++;
      currentBatteryTimeMin = ascentTimeMin; // reset for new battery (climb back to altitude)
    }
  }

  const batteryCount = batteriesUsed;
  const totalBatterySwapTimeMin = (batteryCount - 1) * batterySwapTimeMin;
  const totalMissionTimeMin = totalActiveFlightTimeMin + rthTimeMin + totalBatterySwapTimeMin;

  return {
    flightDistanceMeters: flightDistance,
    flightTimeMin,
    turnTimeMin,
    photoTimeMin,
    ascentTimeMin,
    turnCount,
    photoCount,
    usableFlightTimePerBatteryMin,
    batteryCount,
    totalMissionTimeMin,
    rthTimeMin,
    batterySwapTimeMin: totalBatterySwapTimeMin,
    batterySwapWaypoints,
  };
}
