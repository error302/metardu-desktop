/**
 * ArduPilot / PX4 .waypoints mission export (QGC WPL 110 format).
 *
 * Generates a plain-text file with one waypoint per line. Compatible with
 * Mission Planner, QGroundControl, and any MAVLink-based autopilot.
 *
 * Format spec (QGC WPL 110):
 *   <index> <current> <coord_frame> <command> <param1> <param2> <param3> <param4> <latitude> <longitude> <altitude> <autocontinue>
 *
 * Where:
 *   - index: 0-based waypoint index
 *   - current: 0 (not the current waypoint) or 1 (this is the current waypoint)
 *   - coord_frame: 0 = absolute (MAV_FRAME_GLOBAL), 3 = relative (MAV_FRAME_GLOBAL_RELATIVE_ALT)
 *   - command: 16 = MAV_CMD_NAV_WAYPOINT, 21 = MAV_CMD_NAV_LAND, 22 = MAV_CMD_NAV_TAKEOFF
 *   - param1: hold time in seconds (for waypoints)
 *   - param2: acceptance radius in meters
 *   - param3: pass radius in meters (0 = pass through)
 *   - param4: desired yaw in degrees (0 = north, NaN = don't change)
 *   - latitude/longitude: decimal degrees
 *   - altitude: meters (meaning depends on coord_frame)
 *   - autocontinue: 1 = auto-continue to next waypoint
 *
 * Reference: https://mavlink.io/en/messages/common.html#MAV_CMD_NAV_WAYPOINT
 */

import type { Waypoint } from "../waypoints.js";

/**
 * Coordinate frame for MAVLink missions.
 *
 * @see https://mavlink.io/en/messages/common.html#MAV_FRAME
 */
export type MavFrame =
  | 0   // MAV_FRAME_GLOBAL (absolute WGS84 altitude)
  | 3   // MAV_FRAME_GLOBAL_RELATIVE_ALT (relative to takeoff/home)
  | 10; // MAV_FRAME_GLOBAL_TERRAIN_ALT (relative to terrain, requires DTM)

/**
 * Options for ArduPilot .waypoints export.
 */
export interface ArduPilotWaypointsOptions {
  /**
   * Coordinate frame for altitude.
   * - 0 (GLOBAL): altitude is absolute WGS84 (rarely used)
   * - 3 (GLOBAL_RELATIVE_ALT, default): altitude is relative to takeoff/home point
   * - 10 (GLOBAL_TERRAIN_ALT): altitude is relative to terrain (terrain-aware mode)
   */
  coordinateFrame?: MavFrame;
  /**
   * Hold time at each waypoint in seconds. For photogrammetry, this is the
   * time the drone stops to take a photo. Default: 0 (no stop, photo on the fly).
   * Some cameras require 1-2 seconds to stabilize before capture.
   */
  holdTimeSec?: number;
  /**
   * Acceptance radius in meters. The waypoint is considered "reached" when
   * the drone is within this radius. Default: 2.0m for photogrammetry.
   */
  acceptanceRadiusM?: number;
  /**
   * Pass radius in meters. 0 = pass through the waypoint (default).
   * Non-zero values create a curved path (useful for video but not for photogrammetry).
   */
  passRadiusM?: number;
  /**
   * Whether to add a takeoff command as the first waypoint.
   * Default: true (ArduPilot requires explicit takeoff for auto missions).
   */
  addTakeoffCommand?: boolean;
  /**
   * Takeoff altitude in meters (if addTakeoffCommand is true). Default: 30m.
   */
  takeoffAltitudeM?: number;
  /**
   * Whether to add a Return-to-Launch (RTL) command as the last waypoint.
   * Default: true (safe mission ending).
   */
  addRtlCommand?: boolean;
}

/**
 * Generate the ArduPilot .waypoints file content as a string.
 *
 * @param waypoints Array of waypoints
 * @param options Export options
 * @returns String content of the .waypoints file
 */
export function exportArduPilotWaypoints(
  waypoints: Waypoint[],
  options: ArduPilotWaypointsOptions = {}
): string {
  if (waypoints.length === 0) {
    throw new Error("Cannot export .waypoints: waypoints array is empty");
  }

  const coordinateFrame = options.coordinateFrame ?? 3;
  const holdTime = options.holdTimeSec ?? 0;
  const acceptanceRadius = options.acceptanceRadiusM ?? 2.0;
  const passRadius = options.passRadiusM ?? 0;
  const addTakeoff = options.addTakeoffCommand ?? true;
  const takeoffAlt = options.takeoffAltitudeM ?? 30;
  const addRtl = options.addRtlCommand ?? true;

  const lines: string[] = [];

  // QGC WPL 110 header line (required by Mission Planner / QGC)
  lines.push("QGC WPL 110");

  let idx = 0;
  const first = waypoints[0]!;

  // Optional: takeoff command (MAV_CMD_NAV_TAKEOFF = 22)
  if (addTakeoff) {
    // Takeoff uses the home position as reference, with a target altitude
    // Format: idx, current=0, frame=0, cmd=22, p1=0 (pitch), p2=0, p3=0, p4=NaN, lat=0, lng=0, alt=takeoffAlt, autocontinue=1
    lines.push(
      `${idx}\t0\t0\t22\t0.000000\t0.000000\t0.000000\tnan\t` +
      `${first.latitude.toFixed(8)}\t${first.longitude.toFixed(8)}\t` +
      `${takeoffAlt.toFixed(6)}\t1`
    );
    idx++;
  }

  // Waypoints (MAV_CMD_NAV_WAYPOINT = 16)
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i]!;
    const isCurrent = addTakeoff ? 0 : (i === 0 ? 1 : 0);
    const yaw = wp.headingDegrees ?? 0;

    lines.push(
      `${idx}\t${isCurrent}\t${coordinateFrame}\t16\t` +
      `${holdTime.toFixed(6)}\t${acceptanceRadius.toFixed(6)}\t` +
      `${passRadius.toFixed(6)}\t${yaw.toFixed(6)}\t` +
      `${wp.latitude.toFixed(8)}\t${wp.longitude.toFixed(8)}\t` +
      `${wp.altitudeMeters.toFixed(6)}\t1`
    );
    idx++;
  }

  // Optional: Return-to-Launch (MAV_CMD_NAV_RETURN_TO_LAUNCH = 21)
  if (addRtl) {
    // RTL has no parameters; the drone returns to the home position at the RTL altitude
    lines.push(`${idx}\t0\t0\t21\t0.000000\t0.000000\t0.000000\t0.000000\t0.00000000\t0.00000000\t0.000000\t1`);
    idx++;
  }

  return lines.join("\n") + "\n";
}
