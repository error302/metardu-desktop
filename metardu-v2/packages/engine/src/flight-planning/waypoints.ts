/**
 * Lawnmower waypoint generation for drone survey missions.
 *
 * Given a survey area polygon and flight parameters, generates a sequence
 * of waypoints that cover the area in a lawnmower (boustrophedon) pattern.
 *
 * The algorithm:
 *   1. Compute the bounding box of the survey area
 *   2. Orient flight lines along the longest dimension of the bounding box
 *      (to minimize the number of turns, which are battery-expensive)
 *   3. Generate flight lines at `lineSpacing` intervals perpendicular to the
 *      flight direction
 *   4. For each flight line, generate photo trigger points at `photoSpacing`
 *      intervals along the line
 *   5. Alternate direction (lawnmower pattern) to minimize turns
 *   6. Add a margin (default 10%) to ensure edge coverage
 *
 * Waypoints are in WGS84 (latitude/longitude) for direct use in mission files.
 * Conversion from local meters to lat/lng uses the equirectangular approximation
 * which is accurate enough for typical survey areas (< 10 km).
 */

import type { FlightPlanParameters } from "./footprint.js";

/**
 * A single waypoint in a drone mission.
 *
 * Coordinates are in WGS84 (EPSG:4326).
 * Altitude is meters above ground level (AGL) unless terrain-aware mode is used,
 * in which case it's meters above mean sea level (AMSL) per the DTM.
 */
export interface Waypoint {
  /** Waypoint index (0-based, sequential) */
  index: number;
  /** Latitude in decimal degrees, WGS84 */
  latitude: number;
  /** Longitude in decimal degrees, WGS84 */
  longitude: number;
  /**
   * Altitude in meters.
   * - In flat-terrain mode: altitude AGL (above ground level at takeoff point)
   * - In terrain-aware mode: altitude AMSL (above mean sea level)
   */
  altitudeMeters: number;
  /** Flight line index (0-based). Waypoints on the same line have the same value. */
  flightLine: number;
  /** Whether this waypoint triggers a photo capture (true) or is a turn waypoint (false) */
  isPhoto: boolean;
  /** Heading in degrees (0-360, 0=north, clockwise). Auto-computed from previous waypoint. */
  headingDegrees?: number;
  /** Optional: speed override for this waypoint (m/s). If undefined, use cruise speed. */
  speedMs?: number;
  /** Optional: gimbal pitch in degrees (0=horizontal, -90=nadir/straight down) */
  gimbalPitchDegrees?: number;
}

/**
 * A survey area polygon in WGS84.
 *
 * The polygon must be closed (first point = last point) and have at least 4 points
 * (3 unique vertices + closing point).
 */
export interface SurveyArea {
  /** Polygon vertices in WGS84. Must be closed (first === last). */
  coordinates: Array<{ lat: number; lng: number }>;
}

/**
 * Options for lawnmower waypoint generation.
 */
export interface LawnmowerOptions {
  /** Camera flight plan parameters (GSD, footprint, spacing) */
  params: FlightPlanParameters;
  /** Survey area polygon */
  area: SurveyArea;
  /**
   * Margin to extend beyond the survey area bounding box, as a fraction of the
   * bounding box dimensions. Default 0.1 (10%).
   * This ensures complete edge coverage given GPS uncertainty.
   */
  margin?: number;
  /**
   * Flight line angle in degrees (0 = north-south, 90 = east-west).
   * If undefined, auto-selects the longest dimension of the bounding box.
   */
  flightLineAngle?: number;
  /**
   * Takeoff point (used to compute relative altitude if needed).
   * If undefined, uses the first polygon vertex's ground elevation.
   */
  takeoffPoint?: { lat: number; lng: number; altitudeAMSL?: number };
}

/**
 * Bounding box in WGS84 coordinates.
 */
export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  centerLat: number;
  centerLng: number;
  widthMeters: number;   // East-west dimension
  heightMeters: number;  // North-south dimension
}

/**
 * Compute the bounding box of a survey area.
 *
 * Also computes the width and height in meters using the equirectangular
 * approximation (accurate enough for areas < 10 km).
 *
 * @param area Survey area polygon
 */
export function computeBoundingBox(area: SurveyArea): BoundingBox {
  if (area.coordinates.length < 4) {
    throw new Error("Survey area must have at least 4 coordinates (closed polygon)");
  }

  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;

  for (const pt of area.coordinates) {
    if (pt.lat < minLat) minLat = pt.lat;
    if (pt.lat > maxLat) maxLat = pt.lat;
    if (pt.lng < minLng) minLng = pt.lng;
    if (pt.lng > maxLng) maxLng = pt.lng;
  }

  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;

  // Convert degrees to meters using equirectangular approximation:
  //   1 degree latitude ≈ 111,320 meters (everywhere on Earth)
  //   1 degree longitude ≈ 111,320 * cos(latitude) meters
  const latMetersPerDegree = 111_320;
  const lngMetersPerDegree = 111_320 * Math.cos(centerLat * Math.PI / 180);

  const widthMeters = (maxLng - minLng) * lngMetersPerDegree;
  const heightMeters = (maxLat - minLat) * latMetersPerDegree;

  return {
    minLat, maxLat, minLng, maxLng,
    centerLat, centerLng,
    widthMeters, heightMeters,
  };
}

/**
 * Convert a local offset (in meters, east/north from a reference point) to WGS84.
 *
 * Uses the equirectangular approximation.
 *
 * @param refLat Reference latitude in degrees
 * @param refLng Reference longitude in degrees
 * @param eastMeters East offset in meters (positive = east)
 * @param northMeters North offset in meters (positive = north)
 */
export function offsetToLatLng(
  refLat: number,
  refLng: number,
  eastMeters: number,
  northMeters: number
): { lat: number; lng: number } {
  const latMetersPerDegree = 111_320;
  const lngMetersPerDegree = 111_320 * Math.cos(refLat * Math.PI / 180);

  const lat = refLat + (northMeters / latMetersPerDegree);
  const lng = refLng + (eastMeters / lngMetersPerDegree);

  return { lat, lng };
}

/**
 * Generate lawnmower waypoints for a survey area.
 *
 * @param options Generation options
 * @returns Array of waypoints (sequential, 0-indexed)
 */
export function generateLawnmowerWaypoints(options: LawnmowerOptions): Waypoint[] {
  const { params, area } = options;
  const margin = options.margin ?? 0.1;

  if (margin < 0 || margin > 1) {
    throw new Error(`Margin must be in [0, 1], got ${margin}`);
  }

  const bbox = computeBoundingBox(area);

  // Determine flight line orientation.
  // Default: fly along the longest dimension of the bounding box to minimize turns.
  // If widthMeters > heightMeters, fly east-west (angle = 90).
  // Otherwise, fly north-south (angle = 0).
  const flightLineAngle = options.flightLineAngle ??
    (bbox.widthMeters >= bbox.heightMeters ? 90 : 0);

  // Compute the effective survey dimensions (with margin)
  const effectiveWidth = bbox.widthMeters * (1 + 2 * margin);
  const effectiveHeight = bbox.heightMeters * (1 + 2 * margin);

  // Determine along-track and cross-track dimensions based on flight angle
  // For angle = 0 (north-south flight lines):
  //   along-track = height (north-south distance)
  //   cross-track = width (east-west distance, perpendicular to flight)
  // For angle = 90 (east-west flight lines):
  //   along-track = width
  //   cross-track = height
  const isNorthSouth = flightLineAngle === 0;
  const alongTrackMeters = isNorthSouth ? effectiveHeight : effectiveWidth;
  const crossTrackMeters = isNorthSouth ? effectiveWidth : effectiveHeight;

  // Number of flight lines: cross_track / line_spacing + 1
  const lineCount = Math.ceil(crossTrackMeters / params.lineSpacingM) + 1;
  // Number of photos per line: along_track / photo_spacing + 1
  const photosPerLine = Math.ceil(alongTrackMeters / params.photoSpacingM) + 1;

  // Compute the starting corner of the survey pattern (south-west corner of effective bbox)
  // In local meters relative to the bbox center
  const startEast = -effectiveWidth / 2;
  const startNorth = -effectiveHeight / 2;

  const waypoints: Waypoint[] = [];
  let wpIndex = 0;

  for (let lineIdx = 0; lineIdx < lineCount; lineIdx++) {
    // Cross-track position of this flight line
    const crossTrackPos = lineIdx * params.lineSpacingM;

    // For lawnmower pattern: alternate direction on each line
    const isForward = lineIdx % 2 === 0;

    for (let photoIdx = 0; photoIdx < photosPerLine; photoIdx++) {
      // Along-track position
      const alongTrackPos = photoIdx * params.photoSpacingM;

      // Convert (along, cross) to (east, north) based on flight angle
      let eastMeters: number;
      let northMeters: number;

      if (isNorthSouth) {
        // Flight line runs north-south. Cross-track is east-west.
        eastMeters = startEast + crossTrackPos;
        northMeters = isForward
          ? startNorth + alongTrackPos
          : startNorth + (alongTrackMeters - alongTrackPos);
      } else {
        // Flight line runs east-west. Cross-track is north-south.
        eastMeters = isForward
          ? startEast + alongTrackPos
          : startEast + (alongTrackMeters - alongTrackPos);
        northMeters = startNorth + crossTrackPos;
      }

      // Convert local meters to WGS84
      const { lat, lng } = offsetToLatLng(bbox.centerLat, bbox.centerLng, eastMeters, northMeters);

      // Compute heading: direction of travel from this waypoint
      // (We'll fill this in after all waypoints are generated)
      waypoints.push({
        index: wpIndex++,
        latitude: lat,
        longitude: lng,
        altitudeMeters: params.altitudeM,
        flightLine: lineIdx,
        isPhoto: true,
        gimbalPitchDegrees: -90, // nadir (straight down) for photogrammetry
      });
    }
  }

  // Compute heading for each waypoint (direction to the next waypoint)
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i]!;
    const next = waypoints[i + 1];
    if (next && next.flightLine === wp.flightLine) {
      // Same flight line: heading is direction to next waypoint
      wp.headingDegrees = bearingDegrees(wp.latitude, wp.longitude, next.latitude, next.longitude);
    } else {
      // Last waypoint on a line, or no next waypoint: keep previous heading
      wp.headingDegrees = waypoints[i - 1]?.headingDegrees ?? 0;
    }
  }

  return waypoints;
}

/**
 * Compute the bearing (heading) from point A to point B in degrees.
 *
 * @returns Bearing in degrees (0-360, 0=north, clockwise)
 */
export function bearingDegrees(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  const bearing = Math.atan2(y, x) * 180 / Math.PI;
  return (bearing + 360) % 360;
}

/**
 * Statistics about a generated mission.
 */
export interface MissionStats {
  totalWaypoints: number;
  totalPhotos: number;
  flightLineCount: number;
  photosPerLine: number;
  /** Estimated flight distance in meters (sum of straight-line distances between waypoints) */
  totalDistanceMeters: number;
  /** Estimated flight time in minutes (at cruise speed, including 10s per turn) */
  estimatedFlightTimeMin: number;
}

/**
 * Compute statistics for a generated mission.
 *
 * @param waypoints Array of waypoints from generateLawnmowerWaypoints
 * @param cruiseSpeedMs Cruise speed in meters per second
 */
export function computeMissionStats(
  waypoints: Waypoint[],
  cruiseSpeedMs: number
): MissionStats {
  if (waypoints.length === 0) {
    return {
      totalWaypoints: 0,
      totalPhotos: 0,
      flightLineCount: 0,
      photosPerLine: 0,
      totalDistanceMeters: 0,
      estimatedFlightTimeMin: 0,
    };
  }

  const flightLines = new Set(waypoints.map((w) => w.flightLine));
  const totalPhotos = waypoints.filter((w) => w.isPhoto).length;
  const photosPerLine = totalPhotos / flightLines.size;

  // Compute total distance
  let totalDistance = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const prev = waypoints[i - 1]!;
    const curr = waypoints[i]!;
    totalDistance += haversineMeters(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
  }

  // Estimate flight time:
  //   - Straight-line distance / cruise speed
  //   - + 10 seconds per turn (count turns = flight line count - 1)
  const turnCount = flightLines.size - 1;
  const straightLineTimeSec = totalDistance / cruiseSpeedMs;
  const turnTimeSec = turnCount * 10;
  const totalFlightTimeSec = straightLineTimeSec + turnTimeSec;

  return {
    totalWaypoints: waypoints.length,
    totalPhotos,
    flightLineCount: flightLines.size,
    photosPerLine: Math.round(photosPerLine),
    totalDistanceMeters: totalDistance,
    estimatedFlightTimeMin: totalFlightTimeSec / 60,
  };
}

/**
 * Haversine distance between two WGS84 points in meters.
 *
 * Used for mission stats (not for waypoint generation, which uses the
 * equirectangular approximation).
 */
export function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6_371_000; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
