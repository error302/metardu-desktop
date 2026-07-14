/**
 * Terrain-aware altitude adjustment for drone flight planning.
 *
 * When a Digital Terrain Model (DTM) is available, the drone's altitude
 * above ground level (AGL) must be adjusted at each waypoint to maintain
 * a constant GSD over rolling terrain. This is critical for photogrammetry
 * because:
 *
 *   - If the drone flies at a fixed AMSL altitude over a hill, the AGL
 *     decreases, the GSD decreases (better resolution but smaller footprint),
 *     and the overlap increases (wasted photos).
 *   - If the drone flies at a fixed AMSL altitude over a valley, the AGL
 *     increases, the GSD increases (worse resolution), and the overlap
 *     decreases (gaps in coverage).
 *
 * Solution: at each waypoint, look up the terrain elevation from the DTM
 * and compute the required AMSL altitude as: AMSL = ground_elevation + AGL_target.
 *
 * Two DTM input formats are supported:
 *   1. A raster grid (GeoTIFF or equivalent) sampled at a regular interval
 *   2. A function `(lat, lng) => elevation_meters` for procedural terrain
 *      or for testing
 *
 * For Phase 1, we do NOT include GeoTIFF reading (that requires GDAL bindings,
 * which land in Month 2). Instead, we accept an elevation function or a
 * pre-sampled grid. The GeoTIFF integration will wrap this same interface.
 */

import type { Waypoint } from "./waypoints.js";

/**
 * A Digital Terrain Model (DTM) elevation lookup.
 *
 * Returns the terrain elevation in meters above mean sea level (AMSL) for
 * a given WGS84 coordinate.
 *
 * Implementations:
 *   - `elevationFromGrid(grid)` — bilinear interpolation from a regular grid
 *   - `elevationFromFunction(fn)` — wrap a closure (useful for testing
 *     and for procedural terrain)
 *   - (Phase 1 Month 2) `elevationFromGeoTIFF(path)` — GDAL-backed raster reader
 */
export type ElevationLookup = (lat: number, lng: number) => number;

/**
 * A regular grid of elevation samples.
 *
 * The grid covers a bounding box from (south, west) to (north, east),
 * sampled at `rows` × `cols` points. The grid is stored in row-major order,
 * with row 0 at the north edge and row `rows-1` at the south edge.
 */
export interface ElevationGrid {
  south: number; // min latitude
  west: number;  // min longitude
  north: number; // max latitude
  east: number;  // max longitude
  rows: number;
  cols: number;
  /** Row-major elevation values in meters AMSL. Length = rows × cols. */
  values: number[];
}

/**
 * Create an elevation lookup function from a regular grid using bilinear
 * interpolation.
 *
 * Bilinear interpolation: given a query point (lat, lng), find the four
 * nearest grid cells and interpolate using the formula:
 *
 *   f(x, y) = (1-dx)(1-dy)·f00 + dx(1-dy)·f10 + (1-dx)dy·f01 + dx·dy·f11
 *
 * where (dx, dy) is the fractional position within the cell, and f00, f10,
 * f01, f11 are the four corner values.
 *
 * @throws if the query point is outside the grid bounds
 */
export function elevationFromGrid(grid: ElevationGrid): ElevationLookup {
  const { south, west, north, east, rows, cols, values } = grid;

  if (rows < 2 || cols < 2) {
    throw new Error(`Grid must have at least 2 rows and 2 cols, got ${rows}×${cols}`);
  }
  if (values.length !== rows * cols) {
    throw new Error(`Grid values length ${values.length} does not match rows×cols = ${rows * cols}`);
  }
  if (north <= south || east <= west) {
    throw new Error("Grid bounds invalid: north must be > south, east must be > west");
  }

  const latStep = (north - south) / (rows - 1);
  const lngStep = (east - west) / (cols - 1);

  return (lat: number, lng: number): number => {
    if (lat < south || lat > north || lng < west || lng > east) {
      throw new Error(
        `Point (${lat.toFixed(6)}, ${lng.toFixed(6)}) is outside grid bounds ` +
        `[${south.toFixed(6)}, ${north.toFixed(6)}] × [${west.toFixed(6)}, ${east.toFixed(6)}]`
      );
    }

    // Compute fractional row/col indices
    const rowFrac = (north - lat) / latStep;
    const colFrac = (lng - west) / lngStep;

    // Clamp to valid range (handles edge points exactly on the boundary)
    const row0 = Math.min(Math.floor(rowFrac), rows - 2);
    const col0 = Math.min(Math.floor(colFrac), cols - 2);
    const dy = rowFrac - row0;
    const dx = colFrac - col0;

    // Get the four corner values
    const i00 = row0 * cols + col0;           // NW corner (row0, col0)
    const i10 = row0 * cols + (col0 + 1);     // NE corner (row0, col0+1)
    const i01 = (row0 + 1) * cols + col0;     // SW corner (row0+1, col0)
    const i11 = (row0 + 1) * cols + (col0 + 1); // SE corner (row0+1, col0+1)

    const f00 = values[i00]!;
    const f10 = values[i10]!;
    const f01 = values[i01]!;
    const f11 = values[i11]!;

    // Bilinear interpolation
    return (
      (1 - dx) * (1 - dy) * f00 +
      dx * (1 - dy) * f10 +
      (1 - dx) * dy * f01 +
      dx * dy * f11
    );
  };
}

/**
 * Wrap a closure as an ElevationLookup. Useful for testing and for
 * procedural terrain (e.g., a sine-wave hill for benchmarks).
 */
export function elevationFromFunction(fn: (lat: number, lng: number) => number): ElevationLookup {
  return fn;
}

/**
 * Adjust waypoint altitudes to be terrain-aware.
 *
 * For each waypoint, looks up the ground elevation at its (lat, lng) and
 * sets the altitude to `groundElevation + targetAGL`. The waypoint's
 * `altitudeMeters` field is updated in place to be AMSL (above mean sea level)
 * rather than AGL.
 *
 * The return value is a new array of waypoints (the input is not mutated).
 *
 * @param waypoints Waypoints with AGL altitudes (flat-terrain assumption)
 * @param elevation Terrain elevation lookup function
 * @param targetAGLMeters Target altitude above ground level in meters
 */
export function makeTerrainAware(
  waypoints: Waypoint[],
  elevation: ElevationLookup
): Waypoint[] {
  return waypoints.map((wp) => {
    const groundElevation = elevation(wp.latitude, wp.longitude);
    return {
      ...wp,
      altitudeMeters: groundElevation + wp.altitudeMeters,
    };
  });
}

/**
 * Statistics about terrain variation across a set of waypoints.
 *
 * Useful for the UI to show the surveyor how much the terrain varies
 * across the survey area, which affects flight time and battery life.
 */
export interface TerrainStats {
  /** Minimum ground elevation in meters AMSL */
  minElevationM: number;
  /** Maximum ground elevation in meters AMSL */
  maxElevationM: number;
  /** Mean ground elevation in meters AMSL */
  meanElevationM: number;
  /** Elevation range (max - min) in meters */
  elevationRangeM: number;
  /** Standard deviation of elevation in meters */
  elevationStdDevM: number;
  /** Minimum AMSL altitude the drone will fly at */
  minAltitudeAMSLM: number;
  /** Maximum AMSL altitude the drone will fly at */
  maxAltitudeAMSLM: number;
}

/**
 * Compute terrain statistics for a set of waypoints.
 *
 * @param waypoints Waypoints (with terrain-aware AMSL altitudes)
 * @param elevation Terrain elevation lookup function
 */
export function computeTerrainStats(
  waypoints: Waypoint[],
  elevation: ElevationLookup
): TerrainStats {
  if (waypoints.length === 0) {
    return {
      minElevationM: 0,
      maxElevationM: 0,
      meanElevationM: 0,
      elevationRangeM: 0,
      elevationStdDevM: 0,
      minAltitudeAMSLM: 0,
      maxAltitudeAMSLM: 0,
    };
  }

  const elevations = waypoints.map((wp) => elevation(wp.latitude, wp.longitude));
  const altitudes = waypoints.map((wp) => wp.altitudeMeters);

  const minEl = Math.min(...elevations);
  const maxEl = Math.max(...elevations);
  const meanEl = elevations.reduce((s, e) => s + e, 0) / elevations.length;
  const variance = elevations.reduce((s, e) => s + (e - meanEl) ** 2, 0) / elevations.length;
  const stdDev = Math.sqrt(variance);

  return {
    minElevationM: minEl,
    maxElevationM: maxEl,
    meanElevationM: meanEl,
    elevationRangeM: maxEl - minEl,
    elevationStdDevM: stdDev,
    minAltitudeAMSLM: Math.min(...altitudes),
    maxAltitudeAMSLM: Math.max(...altitudes),
  };
}
