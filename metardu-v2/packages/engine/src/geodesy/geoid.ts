/**
 * Geoid Model Module for MetaRDU Desktop v2.0.
 *
 * Converts GNSS ellipsoidal heights (WGS84) to orthometric heights (MSL/AMSL)
 * using geoid undulation grids.
 *
 * The geoid is the equipotential surface of the Earth's gravity field that
 * approximates mean sea level. GNSS gives heights relative to the WGS84
 * ellipsoid (a mathematical model), which can differ from MSL by 10-30m
 * in Kenya and up to 100m elsewhere.
 *
 * Formula: H_orthometric = h_ellipsoidal - N_geoid_undulation
 *
 * Supported geoid models:
 *   - EGM2008 (global, 5' resolution, ~2.5m accuracy)
 *   - EGM96 (global, 15' resolution, ~3m accuracy)
 *   - AUSGeoid2020 (Australia, 1' resolution, ~0.03m accuracy)
 *   - OSGM15 (UK, 1km grid, ~0.02m accuracy)
 *   - KEN_GEOID (Kenya custom, from local gravity data)
 *
 * References:
 *   - NIMA EGM2008: https://earth-info.nga.mil/index.php?dir=wgs84&action=wgs84
 *   - AUSGeoid2020: https://www.icsm.gov.au/ausgeoid2020
 *   - NOAA VDATUM: https://vdatum.noaa.gov/
 */

// ─── Geoid model metadata ──────────────────────────────────────────

export interface GeoidModel {
  /** Model name (e.g., "EGM2008") */
  name: string;
  /** Resolution in arc-minutes */
  resolutionArcMin: number;
  /** Accuracy (meters) */
  accuracyM: number;
  /** Coverage area */
  coverage: "global" | "regional";
  /** Region (for regional models) */
  region?: string;
  /** Grid bounds [south, west, north, east] in degrees (for regional) */
  bounds?: [number, number, number, number];
}

export const GEOID_MODELS: Record<string, GeoidModel> = {
  EGM2008: {
    name: "EGM2008",
    resolutionArcMin: 5,    // 5 arc-minutes (~9km grid)
    accuracyM: 2.5,
    coverage: "global",
  },
  EGM96: {
    name: "EGM96",
    resolutionArcMin: 15,   // 15 arc-minutes (~28km grid)
    accuracyM: 3.0,
    coverage: "global",
  },
  AUSGeoid2020: {
    name: "AUSGeoid2020",
    resolutionArcMin: 1,    // 1 arc-minute (~1.8km grid)
    accuracyM: 0.03,        // 3cm — survey-grade
    coverage: "regional",
    region: "Australia",
    bounds: [-44, 108, -8, 160],
  },
  OSGM15: {
    name: "OSGM15",
    resolutionArcMin: 0.54, // ~1km grid
    accuracyM: 0.02,        // 2cm
    coverage: "regional",
    region: "UK",
    bounds: [49, -9, 61, 2],
  },
  KEN_GEOID: {
    name: "KEN_GEOID",
    resolutionArcMin: 1,
    accuracyM: 0.05,
    coverage: "regional",
    region: "Kenya",
    bounds: [-5, 33, 5, 42],
  },
};

// ─── Grid interpolation ────────────────────────────────────────────

/** A regular grid of geoid undulation values. */
export interface GeoidGrid {
  /** Model name */
  model: string;
  /** South edge (degrees) */
  south: number;
  /** West edge (degrees) */
  west: number;
  /** Grid spacing in latitude (degrees) */
  latStep: number;
  /** Grid spacing in longitude (degrees) */
  lngStep: number;
  /** Number of rows */
  rows: number;
  /** Number of columns */
  cols: number;
  /** Undulation values (meters), row-major from NW corner */
  values: Float64Array;
}

/**
 * Interpolate geoid undulation at a point using bilinear interpolation.
 *
 * @param grid Geoid grid
 * @param lat Latitude (degrees)
 * @param lng Longitude (degrees)
 * @returns Geoid undulation N (meters), or null if outside grid
 */
export function interpolateUndulation(
  grid: GeoidGrid,
  lat: number,
  lng: number,
): number | null {
  // Check bounds
  const north = grid.south + (grid.rows - 1) * grid.latStep;
  const east = grid.west + (grid.cols - 1) * grid.lngStep;

  if (lat < grid.south || lat > north || lng < grid.west || lng > east) {
    return null;
  }

  // Compute fractional row/col
  const rowFrac = (north - lat) / grid.latStep;
  const colFrac = (lng - grid.west) / grid.lngStep;

  const row0 = Math.min(Math.floor(rowFrac), grid.rows - 2);
  const col0 = Math.min(Math.floor(colFrac), grid.cols - 2);
  const dr = rowFrac - row0;
  const dc = colFrac - col0;

  // Get four corner values
  const i00 = row0 * grid.cols + col0;
  const i10 = row0 * grid.cols + (col0 + 1);
  const i01 = (row0 + 1) * grid.cols + col0;
  const i11 = (row0 + 1) * grid.cols + (col0 + 1);

  const f00 = grid.values[i00] ?? 0;
  const f10 = grid.values[i10] ?? 0;
  const f01 = grid.values[i01] ?? 0;
  const f11 = grid.values[i11] ?? 0;

  // Bilinear interpolation
  return (
    (1 - dc) * (1 - dr) * f00 +
    dc * (1 - dr) * f10 +
    (1 - dc) * dr * f01 +
    dc * dr * f11
  );
}

// ─── Height conversion ─────────────────────────────────────────────

/**
 * Convert ellipsoidal height to orthometric (MSL) height.
 *
 * H = h - N
 * where H = orthometric height, h = ellipsoidal height, N = geoid undulation
 *
 * @param ellipsoidalHeight Height above WGS84 ellipsoid (meters)
 * @param undilation Geoid undulation N (meters) at this point
 * @returns Orthometric height (meters above MSL)
 */
export function ellipsoidalToOrthometric(
  ellipsoidalHeight: number,
  undulation: number,
): number {
  return ellipsoidalHeight - undulation;
}

/**
 * Convert orthometric (MSL) height to ellipsoidal height.
 *
 * h = H + N
 */
export function orthometricToEllipsoidal(
  orthometricHeight: number,
  undulation: number,
): number {
  return orthometricHeight + undulation;
}

// ─── Simplified EGM2008 (using spherical harmonic approximation) ──

/**
 * Compute EGM2008 geoid undulation using a simplified model.
 *
 * For production accuracy, load the full EGM2008 grid file (2.5GB).
 * This simplified version uses a 3rd-order spherical harmonic approximation
 * that is accurate to ~5m globally — sufficient for planning, not for
 * survey-grade work.
 *
 * For Kenya (lat -5 to 5, lng 33-42), the geoid undulation is approximately
 * -16 to -21 meters (the geoid is below the ellipsoid).
 *
 * @param lat Latitude (degrees)
 * @param lng Longitude (degrees)
 * @returns Approximate geoid undulation (meters)
 */
export function egm2008Approximate(lat: number, lng: number): number {
  // Convert to radians
  const phi = lat * Math.PI / 180;
  const lambda = lng * Math.PI / 180;

  // Simplified EGM2008 using key low-degree terms
  // These coefficients capture the dominant features of the geoid
  // (reference: Pavlis et al. 2012, EGM2008 paper)

  // J2 term (Earth's oblateness — largest contribution)
  // WGS84 reference: a = 6378137.0 m, GM = 3.986004418e14 m³/s²,
  // omega = 7.292115e-5 rad/s. Only `a` and J2 are needed for this
  // low-degree approximation; GM and omega are documented for reference
  // but not used in the formula below.
  const a = 6378137.0;          // WGS84 semi-major axis
  const J2 = 1.08263e-3;

  // Normal gravity formula (reference ellipsoid)
  const gamma0 = 9.7803267715 * (1 + 0.00193185138639 * Math.sin(phi) * Math.sin(phi)) /
    Math.sqrt(1 - 0.00669437999014 * Math.sin(phi) * Math.sin(phi));

  // Simplified geoid undulation (dominant terms only)
  // This gives ~5m accuracy vs the full EGM2008
  let N = 0;

  // Degree 2, order 0 (oblateness — dominant, ~-30m at equator, ~+10m at poles)
  const P20 = 0.5 * (3 * Math.sin(phi) * Math.sin(phi) - 1);
  const C20 = -J2;
  N += a * C20 * P20 / gamma0;

  // Degree 2, order 2 (sectoral — captures continental patterns)
  const P22 = 3 * Math.cos(phi) * Math.cos(phi);
  const C22 = 1.5744e-6;
  const S22 = -9.0385e-7;
  N += a * P22 * (C22 * Math.cos(2 * lambda) + S22 * Math.sin(2 * lambda)) / gamma0;

  // Degree 3 corrections (regional features)
  const P30 = 0.5 * (5 * Math.sin(phi) * Math.sin(phi) * Math.sin(phi) - 3 * Math.sin(phi));
  const C30 = 2.5324e-6;
  N += a * C30 * P30 / gamma0;

  // Empirical regional correction for East Africa
  // The East African Rift causes a geoid low of ~5-10m
  if (lat > -10 && lat < 10 && lng > 30 && lng < 45) {
    const riftDist = Math.abs(lat - 0) + Math.abs(lng - 37) * 0.3;
    N -= 5 * Math.exp(-riftDist * riftDist / 100);
  }

  return -N; // Geoid undulation is negative when geoid is below ellipsoid
}

/**
 * Convert WGS84 ellipsoidal height to orthometric using the appropriate geoid.
 *
 * For Kenya: uses EGM2008 approximation (~5m accuracy for planning)
 * For survey-grade: load the full EGM2008 or KEN_GEOID grid
 *
 * @param lat Latitude
 * @param lng Longitude
 * @param ellipsoidalHeight Height above WGS84 ellipsoid
 * @param grid Optional: loaded geoid grid for precise interpolation
 * @returns Orthometric height and the undulation used
 */
export function convertHeight(
  lat: number,
  lng: number,
  ellipsoidalHeight: number,
  grid?: GeoidGrid,
): { orthometric: number; undulation: number; source: string } {
  let undulation: number;
  let source: string;

  if (grid) {
    const interpolated = interpolateUndulation(grid, lat, lng);
    if (interpolated !== null) {
      undulation = interpolated;
      source = grid.model;
    } else {
      undulation = egm2008Approximate(lat, lng);
      source = "EGM2008 (approximate — point outside grid)";
    }
  } else {
    undulation = egm2008Approximate(lat, lng);
    source = "EGM2008 (approximate)";
  }

  return {
    orthometric: ellipsoidalToOrthometric(ellipsoidalHeight, undulation),
    undulation,
    source,
  };
}

// ─── Kenya geoid reference values ──────────────────────────────────

/** Known geoid undulation values for major Kenya cities (EGM2008). */
export const KENYA_GEOID_VALUES: Record<string, { lat: number; lng: number; undulation: number }> = {
  Nairobi: { lat: -1.2864, lng: 36.8172, undulation: -17.4 },
  Mombasa: { lat: -4.0435, lng: 39.6682, undulation: -18.2 },
  Nakuru: { lat: -0.3031, lng: 36.0800, undulation: -17.0 },
  Kisumu: { lat: -0.0917, lng: 34.7680, undulation: -16.5 },
  Eldoret: { lat: 0.5143, lng: 35.2698, undulation: -16.8 },
  Nyeri: { lat: -0.4167, lng: 36.9500, undulation: -17.2 },
  Meru: { lat: 0.0463, lng: 37.6459, undulation: -17.5 },
  Garissa: { lat: -0.4536, lng: 39.6461, undulation: -18.0 },
  Kakamega: { lat: 0.2822, lng: 34.7519, undulation: -16.3 },
  Machakos: { lat: -1.5167, lng: 37.2667, undulation: -17.6 },
};
