/**
 * Coordinate Converter — Cassini-Soldner ↔ UTM for Kenya
 *
 * P0 math improvement: Every Kenyan surveyor converts between Cassini-Soldner
 * (cadastral) and UTM (topographic/engineering) daily. This makes it instant.
 *
 * Also includes grid-to-ground distance correction (required by Cap 299).
 */

import log from 'electron-log/main';

export interface CoordinateConverterInput {
  easting: number;
  northing: number;
  sourceCrs: 'cassini' | 'utm';
  targetCrs: 'cassini' | 'utm';
  // For Cassini: need the sheet/origin
  cassiniSheet?: string;  // e.g. "SA-37-III" — Kenya Cassini sheet name
  cassiniOriginLat?: number;  // degrees — if sheet not known
  cassiniOriginLon?: number;  // degrees
  // For UTM: need the zone
  utmZone?: number;  // 35-37 for Kenya
  hemisphere?: 'N' | 'S';
  // Arc 1960 ellipsoid parameters (Kenya's datum)
  // a = 6378249.145, 1/f = 293.4663077
}

export interface CoordinateConverterResult {
  inputEasting: number;
  inputNorthing: number;
  inputCrs: string;
  outputEasting: number;
  outputNorthing: number;
  outputCrs: string;
  // Intermediate values
  latitude: number;
  longitude: number;
  scaleFactor: number;     // at the converted point
  gridConvergence: number; // degrees (0 = grid north = true north)
  // Ground distance correction
  groundToGridFactor: number;  // multiply ground distance by this to get grid distance
  gridToGroundFactor: number;  // multiply grid distance by this to get ground distance
}

// Arc 1960 ellipsoid (Kenya's datum)
const ARC_1960_A = 6378249.145;        // semi-major axis (metres)
const ARC_1960_F = 1 / 293.4663077;    // flattening
const ARC_1960_B = ARC_1960_A * (1 - ARC_1960_F);  // semi-minor axis
const ARC_1960_E2 = 2 * ARC_1960_F - ARC_1960_F * ARC_1960_F;  // eccentricity²

// UTM parameters
const UTM_K0 = 0.9996;  // central meridian scale factor
const UTM_FE = 500000;  // false easting

// Cassini-Soldner parameters (per sheet)
// Kenya Cassini sheet origins are defined in geo/cassini/sheets.ts
// For a generic conversion, the surveyor provides the sheet origin

/**
 * Convert between Cassini-Soldner and UTM coordinates.
 *
 * The conversion goes through geographic (lat/lon) as an intermediate:
 *   Cassini → geographic → UTM  (or vice versa)
 *
 * Uses the Arc 1960 ellipsoid (Kenya's datum).
 */
export function convertCoordinates(input: CoordinateConverterInput): CoordinateConverterResult {
  let lat: number, lon: number;

  // Step 1: Convert source to geographic (lat/lon)
  if (input.sourceCrs === 'cassini') {
    const result = cassiniToGeographic(
      input.easting, input.northing,
      input.cassiniOriginLat ?? 0,
      input.cassiniOriginLon ?? 37,  // Kenya default: 37°E
    );
    lat = result.lat;
    lon = result.lon;
  } else {
    // UTM to geographic
    const zone = input.utmZone ?? 37;
    const hemi = input.hemisphere ?? 'S';
    const result = utmToGeographic(input.easting, input.northing, zone, hemi);
    lat = result.lat;
    lon = result.lon;
  }

  // Step 2: Compute scale factor and grid convergence at this point
  const scaleFactor = computeScaleFactor(lat, lon, input.sourceCrs, input);
  const gridConvergence = computeGridConvergence(lat, lon, input.sourceCrs, input);

  // Step 3: Convert geographic to target
  let outputEasting: number, outputNorthing: number;
  let outputCrs: string;

  if (input.targetCrs === 'utm') {
    const zone = input.utmZone ?? 37;
    const hemi = input.hemisphere ?? 'S';
    const result = geographicToUtm(lat, lon, zone, hemi);
    outputEasting = result.easting;
    outputNorthing = result.northing;
    outputCrs = `UTM Zone ${zone}${hemi}`;
  } else {
    const result = geographicToCassini(
      lat, lon,
      input.cassiniOriginLat ?? 0,
      input.cassiniOriginLon ?? 37,
    );
    outputEasting = result.easting;
    outputNorthing = result.northing;
    outputCrs = `Cassini-Soldner (origin: ${input.cassiniOriginLat ?? 0}°, ${input.cassiniOriginLon ?? 37}°)`;
  }

  // Step 4: Grid-to-ground correction
  // Ground distance = Grid distance / scale factor
  // (At the central meridian, scale factor = 1.000, so ground = grid)
  const gridToGroundFactor = 1 / scaleFactor;
  const groundToGridFactor = scaleFactor;

  return {
    inputEasting: input.easting,
    inputNorthing: input.northing,
    inputCrs: input.sourceCrs === 'cassini' ? 'Cassini-Soldner' : `UTM Zone ${input.utmZone ?? 37}${input.hemisphere ?? 'S'}`,
    outputEasting,
    outputNorthing,
    outputCrs,
    latitude: lat,
    longitude: lon,
    scaleFactor,
    gridConvergence,
    groundToGridFactor,
    gridToGroundFactor,
  };
}

/**
 * Cassini-Soldner → Geographic (lat/lon)
 * Inverse Cassini-Soldner projection (Snyder, p. 94)
 */
function cassiniToGeographic(E: number, N: number, originLat: number, originLon: number): { lat: number; lon: number } {
  const a = ARC_1960_A;
  const e2 = ARC_1960_E2;
  const lat0 = originLat * Math.PI / 180;
  const lon0 = originLon * Math.PI / 180;

  const M0 = meridionalArc(lat0, a, e2);

  // Step 1: Compute footpoint latitude from northing
  const M1 = M0 + N;
  const mu = M1 / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  const phi1 = mu + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu)
    + (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);

  const T1 = tanPhi1 * tanPhi1;
  const C1 = e2 * cosPhi1 * cosPhi1 / (1 - e2);
  const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
  const D = E / N1;

  // Step 2: Inverse Cassini (Snyder, p. 94)
  // lat = phi1 - (N1 * tan(phi1) / R1) * [D²/2 + (1 + 3*T1)*D⁴/24]
  // lon = lon0 + [D - T1*D³/3 + (1 + 3*T1)*T1*D⁵/15] / cos(phi1)

  const lat = phi1 - (N1 * tanPhi1 / R1) * (D * D / 2 + (1 + 3 * T1) * Math.pow(D, 4) / 24);

  const lon = lon0 + (D - T1 * Math.pow(D, 3) / 3 + (1 + 3 * T1) * T1 * Math.pow(D, 5) / 15) / cosPhi1;

  return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI };
}

/**
 * Geographic → Cassini-Soldner
 * Cassini-Soldner is NOT Transverse Mercator. The formulas are different.
 * Reference: Snyder, "Map Projections - A Working Manual", pp. 90-95
 *
 * Cassini forward:
 *   x = N * (λ - λ0) * cos(φ) - N * tan(φ) * (λ - λ0)³ * cos³(φ) / 6 + ...
 *   y = M(φ) - M(φ0) + N * tan(φ) * (λ - λ0)² * cos²(φ) / 2 - ...
 *
 * Note: Cassini x is the EASTING, y is the NORTHING (different from TM!)
 */
function geographicToCassini(lat: number, lon: number, originLat: number, originLon: number): { easting: number; northing: number } {
  const a = ARC_1960_A;
  const e2 = ARC_1960_E2;
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;
  const lat0 = originLat * Math.PI / 180;
  const lon0 = originLon * Math.PI / 180;

  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const tanLat = Math.tan(latRad);

  const A = (lonRad - lon0) * cosLat;  // longitude difference * cos(lat)
  const T = tanLat * tanLat;
  const C = e2 * cosLat * cosLat / (1 - e2);
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const R = a * (1 - e2) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const M = meridionalArc(latRad, a, e2);
  const M0 = meridionalArc(lat0, a, e2);

  // Cassini-Soldner forward projection (Snyder, p. 93)
  // x (easting) = N * [A - T*A³/6 - (8 - T + 8*C)*A⁵/120]
  // y (northing) = (M - M0) + N * tan(lat) * [A²/2 + (5 - T + 6*C)*A⁴/24]

  const easting = N * (A - T * Math.pow(A, 3) / 6 - (8 - T + 8 * C) * Math.pow(A, 5) / 120);

  const northing = (M - M0) + N * tanLat * (A * A / 2 + (5 - T + 6 * C) * Math.pow(A, 4) / 24);

  return { easting, northing };
}

/**
 * Geographic → UTM (Universal Transverse Mercator)
 * Uses the Arc 1960 ellipsoid.
 */
function geographicToUtm(lat: number, lon: number, zone: number, hemisphere: 'N' | 'S'): { easting: number; northing: number } {
  const a = ARC_1960_A;
  const e2 = ARC_1960_E2;
  const k0 = UTM_K0;
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;
  const lon0 = (zone * 6 - 183);  // UTM central meridian: zone 37 → 39°E
  const lon0Rad = lon0 * Math.PI / 180;

  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const tanLat = Math.tan(latRad);

  const T = tanLat * tanLat;
  const C = e2 * cosLat * cosLat / (1 - e2);
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const M = meridionalArc(latRad, a, e2);
  const M0 = 0;  // equator (meridional arc at latitude 0 = 0)

  const A = (lonRad - lon0Rad) * cosLat;

  const easting = UTM_FE + k0 * N * (A
    + (1 - T + C) * Math.pow(A, 3) / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * e2) * Math.pow(A, 5) / 120);

  let northing = k0 * (M - M0 + N * tanLat * (A * A / 2
    + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * e2) * Math.pow(A, 6) / 720));

  if (hemisphere === 'S') {
    northing += 10000000;  // southern hemisphere false northing
  }

  return { easting, northing };
}

/**
 * UTM → Geographic
 */
function utmToGeographic(E: number, N: number, zone: number, hemisphere: 'N' | 'S'): { lat: number; lon: number } {
  const a = ARC_1960_A;
  const e2 = ARC_1960_E2;
  const k0 = UTM_K0;
  const lon0 = zone * 6 - 183;  // UTM central meridian
  const lon0Rad = lon0 * Math.PI / 180;

  const x = E - UTM_FE;
  let y = N;
  if (hemisphere === 'S') y -= 10000000;

  const M = y / k0;  // meridional arc from equator (M0 = 0 at equator)
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  const phi1 = mu + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu)
    + (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);

  const T1 = tanPhi1 * tanPhi1;
  const C1 = e2 * cosPhi1 * cosPhi1 / (1 - e2);
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
  const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
  const D = x / (N1 * k0);

  const lat = phi1 - (N1 * tanPhi1 / R1) * (D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * e2) * Math.pow(D, 4) / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * e2 - 3 * C1 * C1) * Math.pow(D, 6) / 720);

  const lon = lon0Rad + (D
    - (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * e2 + 24 * T1 * T1) * Math.pow(D, 5) / 120) / cosPhi1;

  return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI };
}

/**
 * Compute the scale factor at a point for a given projection.
 * For UTM: k = k0 * (1 + x² / (2 * R * N) + ...)
 * For Cassini: k = 1 + E² / (2 * R²) + ...
 */
function computeScaleFactor(lat: number, lon: number, crs: 'cassini' | 'utm', input: CoordinateConverterInput): number {
  const a = ARC_1960_A;
  const e2 = ARC_1960_E2;
  const latRad = lat * Math.PI / 180;
  const sinLat = Math.sin(latRad);
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const R = a * (1 - e2) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);

  if (crs === 'utm') {
    const zone = input.utmZone ?? 37;
    const lon0 = (zone - 1) * 6 - 180 + 3;
    const lonRad = lon * Math.PI / 180;
    const lon0Rad = lon0 * Math.PI / 180;
    const x = (lonRad - lon0Rad) * Math.cos(latRad);
    return UTM_K0 * (1 + x * x / 2 * (N / R) + Math.pow(x, 4) / 24 * (N / R) * (N / R) * (5 - 4 * x * x));
  } else {
    // Cassini scale factor ≈ 1 + E² / (2 * R²)
    return 1 + (input.easting * input.easting) / (2 * R * R);
  }
}

/**
 * Compute grid convergence (angle between grid north and true north).
 * Positive = grid north is east of true north.
 */
function computeGridConvergence(lat: number, lon: number, crs: 'cassini' | 'utm', input: CoordinateConverterInput): number {
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;

  if (crs === 'utm') {
    const zone = input.utmZone ?? 37;
    const lon0 = (zone - 1) * 6 - 180 + 3;
    const lon0Rad = lon0 * Math.PI / 180;
    const dLon = lonRad - lon0Rad;
    // Convergence = -sin(lat) * dLon + correction terms
    const conv = -Math.sin(latRad) * dLon + Math.sin(latRad) * Math.pow(dLon, 3) / 6 * (2 * Math.cos(latRad) * Math.cos(latRad) - 1);
    return conv * 180 / Math.PI;
  } else {
    // Cassini convergence
    const lon0 = input.cassiniOriginLon ?? 37;
    const lon0Rad = lon0 * Math.PI / 180;
    const dLon = lonRad - lon0Rad;
    const conv = Math.sin(latRad) * dLon;
    return conv * 180 / Math.PI;
  }
}

/**
 * Meridional arc from equator to latitude phi.
 * Uses the series expansion on the Arc 1960 ellipsoid.
 */
function meridionalArc(phi: number, a: number, e2: number): number {
  // Standard series expansion for meridional arc on an ellipsoid
  // Reference: Snyder, "Map Projections - A Working Manual", p. 25
  const M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * phi
    - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * phi)
    + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * phi)
    - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * phi));
  return M;
}

/**
 * Batch convert a list of coordinates.
 */
export function batchConvert(
  coordinates: Array<{ easting: number; northing: number; description?: string }>,
  input: Omit<CoordinateConverterInput, 'easting' | 'northing'>,
): Array<CoordinateConverterResult & { description?: string }> {
  return coordinates.map((coord) => {
    const result = convertCoordinates({ ...input, easting: coord.easting, northing: coord.northing });
    return { ...result, description: coord.description };
  });
}
