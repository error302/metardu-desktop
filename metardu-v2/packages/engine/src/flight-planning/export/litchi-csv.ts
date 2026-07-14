/**
 * Litchi CSV mission export.
 *
 * Generates a CSV file compatible with Litchi (flylitchi.com) mission import.
 * Litchi is a popular alternative to DJI Pilot for Mavic / Phantom / Mini drones.
 *
 * Format spec:
 *   https://flylitchi.com/help/how-to-create-and-edit-missions
 *
 * The CSV has a header row followed by one row per waypoint.
 * Required columns: latitude, longitude, altitude(m), heading(deg), curvesize(%),
 *   rotationdir, gimbalpitch, altitudeMode, speed(m/s), actions
 *
 * Notes:
 *   - altitudeMode: 0 = above ground (AGL), 1 = above sea level (AMSL)
 *   - For photogrammetry, we use altitudeMode=0 (AGL) by default
 *   - curvesize: 0 = sharp turn (stop at waypoint), 1 = smooth curve through
 *   - For photogrammetry, we use curvesize=0 (stop for photo)
 *   - actions: semicolon-separated list of actions, e.g., "0(2)" means "take photo, wait 2s"
 */

import type { Waypoint } from "../waypoints.js";

export interface LitchiCsvOptions {
  /**
   * Altitude mode:
   * - 0 (default): above ground level (AGL)
   * - 1: above mean sea level (AMSL)
   */
  altitudeMode?: 0 | 1;
  /**
   * Default speed in m/s if waypoint doesn't specify. Default: 15.
   */
  defaultSpeedMs?: number;
  /**
   * Whether to include a "take photo" action at each waypoint.
   * Default: true (photogrammetry mode).
   */
  includePhotoAction?: boolean;
  /**
   * Wait time after photo in seconds. Default: 0.
   */
  photoWaitSec?: number;
}

/**
 * Generate Litchi CSV content as a string.
 */
export function exportLitchiCsv(
  waypoints: Waypoint[],
  options: LitchiCsvOptions = {}
): string {
  if (waypoints.length === 0) {
    throw new Error("Cannot export Litchi CSV: waypoints array is empty");
  }

  const altitudeMode = options.altitudeMode ?? 0;
  const defaultSpeed = options.defaultSpeedMs ?? 15;
  const includePhoto = options.includePhotoAction ?? true;
  const photoWait = options.photoWaitSec ?? 0;

  // Litchi CSV header (exact column order matters!)
  const header =
    "latitude,longitude,altitude(m),heading(deg),curvesize(%),rotationdir," +
    "gimbalpitch,altitudemode,speed(m/s),actions";

  const rows = waypoints.map((wp) => {
    const speed = wp.speedMs ?? defaultSpeed;
    const gimbalPitch = wp.gimbalPitchDegrees ?? -90;
    const heading = wp.headingDegrees ?? 0;
    const actions = includePhoto ? `0(${photoWait})` : "";

    return [
      wp.latitude.toFixed(8),
      wp.longitude.toFixed(8),
      wp.altitudeMeters.toFixed(2),
      heading.toFixed(2),
      "0",             // curvesize: 0 = sharp turn
      "0",             // rotationdir: 0 = clockwise
      gimbalPitch.toFixed(0),
      altitudeMode.toString(),
      speed.toFixed(2),
      actions,
    ].join(",");
  });

  return [header, ...rows].join("\n") + "\n";
}
