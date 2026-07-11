/**
 * Coordinate Transformation Module
 * 
 * Handles transformations between Arc 1960 (Kenya national datum)
 * and WGS84, plus projection handling for UTM and Cassini-Soldner.
 * 
 * Arc 1960 uses the Clarke 1880 (modified) ellipsoid:
 *   a = 6378249.145 m
 *   1/f = 293.465
 * 
 * Kenya national transformation parameters (Arc 1960 → WGS84):
 *   ΔX = -157 m
 *   ΔY = -2 m
 *   ΔZ = -291 m
 * 
 * Reference:
 * - Kenya Survey Department datum transformation specifications
 * - NIMA TR8350.2 "Department of Defense World Geodetic System 1984"
 */

// ─── Ellipsoid Parameters ────────────────────────────────────────

export const CLARKE_1880_MODIFIED = {
  name: 'Clarke 1880 (Modified)',
  a: 6378249.145,
  rf: 293.465,
  get f() { return 1 / this.rf; },
  get b() { return this.a * (1 - this.f); },
  get e2() { return 2 * this.f - this.f * this.f; },
  get ePrime2() { return this.e2 / (1 - this.e2); },
};

export const WGS84 = {
  name: 'WGS84',
  a: 6378137.0,
  rf: 298.257223563,
  get f() { return 1 / this.rf; },
  get b() { return this.a * (1 - this.f); },
  get e2() { return 2 * this.f - this.f * this.f; },
  get ePrime2() { return this.e2 / (1 - this.e2); },
};

// ─── Transformation Parameters ───────────────────────────────────

/** Kenya national 3-parameter transformation (Arc 1960 → WGS84) */
export const ARC1960_TO_WGS84_3PARAM = {
  dX: -157,
  dY: -2,
  dZ: -291,
};

/** Kenya national 7-parameter transformation (Arc 1960 → WGS84) */
export const ARC1960_TO_WGS84_7PARAM = {
  dX: -157.0,
  dY: -2.0,
  dZ: -291.0,
  rX: 0.0,    // arc-seconds
  rY: 0.0,    // arc-seconds
  rZ: 0.0,    // arc-seconds
  dS: 0.0,    // ppm
};

// ─── Types ───────────────────────────────────────────────────────

export interface GeodeticCoords {
  /** Latitude in decimal degrees (positive = North) */
  latitude: number;
  /** Longitude in decimal degrees (positive = East) */
  longitude: number;
  /** Ellipsoidal height in meters */
  height?: number;
}

export interface CartesianCoords {
  /** X component in meters */
  X: number;
  /** Y component in meters */
  Y: number;
  /** Z component in meters */
  Z: number;
}

export interface Helmert7Param {
  dX: number;
  dY: number;
  dZ: number;
  rX: number; // arc-seconds
  rY: number; // arc-seconds
  rZ: number; // arc-seconds
  dS: number; // ppm
}

export interface UTMCoords {
  zone: number;
  hemisphere: 'N' | 'S';
  easting: number;
  northing: number;
}

// ─── Core Functions ──────────────────────────────────────────────

/**
 * Convert geodetic coordinates (lat, lon, h) to Cartesian (X, Y, Z).
 * 
 * X = (ν + h) × cos(φ) × cos(λ)
 * Y = (ν + h) × cos(φ) × sin(λ)
 * Z = (ρ(1-e²) + h) × sin(φ)
 * 
 * Where:
 *   ν = a / √(1 - e² × sin²(φ))
 *   ρ = a(1-e²) / (1 - e² × sin²(φ))^(3/2)
 */
export function geodeticToCartesian(
  coords: GeodeticCoords,
  ellipsoid = CLARKE_1880_MODIFIED
): CartesianCoords {
  const phi = coords.latitude * Math.PI / 180;
  const lambda = coords.longitude * Math.PI / 180;
  const h = coords.height ?? 0;
  
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinLambda = Math.sin(lambda);
  const cosLambda = Math.cos(lambda);
  
  const e2 = ellipsoid.e2;
  const nu = ellipsoid.a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  
  const X = (nu + h) * cosPhi * cosLambda;
  const Y = (nu + h) * cosPhi * sinLambda;
  const Z = (nu * (1 - e2) + h) * sinPhi;
  
  return { X, Y, Z };
}

/**
 * Convert Cartesian coordinates (X, Y, Z) to geodetic (lat, lon, h).
 * Uses Bowring's iterative method (converges in 2-3 iterations).
 */
export function cartesianToGeodetic(
  coords: CartesianCoords,
  ellipsoid = CLARKE_1880_MODIFIED
): GeodeticCoords {
  const { X, Y, Z } = coords;
  const a = ellipsoid.a;
  const e2 = ellipsoid.e2;
  const b = ellipsoid.b;
  const ePrime2 = ellipsoid.ePrime2;
  
  // Longitude
  const longitude = Math.atan2(Y, X) * 180 / Math.PI;
  
  // Bowring's method for latitude
  const p = Math.sqrt(X * X + Y * Y);
  const theta = Math.atan2(Z * a, p * b);
  
  let phi = Math.atan2(
    Z + ePrime2 * b * Math.pow(Math.sin(theta), 3),
    p - e2 * a * Math.pow(Math.cos(theta), 3)
  );
  
  // Iterate (usually converges in 2 iterations)
  for (let i = 0; i < 3; i++) {
    const sinPhi = Math.sin(phi);
    const nu = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
    phi = Math.atan2(Z + e2 * nu * sinPhi, p);
  }
  
  const latitude = phi * 180 / Math.PI;
  
  // Height
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const nu = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const height = p / cosPhi - nu;
  
  return { latitude, longitude, height };
}

/**
 * Apply Helmert 7-parameter transformation.
 * 
 * [X']   [dX]         [1  -rZ  rY] [X]
 * [Y'] = [dY] + dS × [rZ   1  -rX] [Y]
 * [Z']   [dZ]         [-rY  rX  1] [Z]
 * 
 * Where rotations are in arc-seconds and dS is in ppm.
 * 
 * @param coords - Cartesian coordinates
 * @param params - 7-parameter transformation
 * @param reverse - If true, apply inverse transformation
 */
export function applyHelmert7(
  coords: CartesianCoords,
  params: Helmert7Param,
  reverse: boolean = false
): CartesianCoords {
  // Convert arc-seconds to radians, ppm to scale factor
  const arcSecToRad = Math.PI / (180 * 3600);
  const rX = params.rX * arcSecToRad;
  const rY = params.rY * arcSecToRad;
  const rZ = params.rZ * arcSecToRad;
  const dS = params.dS * 1e-6;
  
  let dX = params.dX;
  let dY = params.dY;
  let dZ = params.dZ;
  let scale = 1 + dS;
  let rx = rX, ry = rY, rz = rZ;
  
  if (reverse) {
    dX = -dX;
    dY = -dY;
    dZ = -dZ;
    scale = 1 / scale;
    rx = -rX;
    ry = -rY;
    rz = -rZ;
  }
  
  const { X, Y, Z } = coords;
  
  const X2 = dX + scale * (X - rz * Y + ry * Z);
  const Y2 = dY + scale * (rz * X + Y - rx * Z);
  const Z2 = dZ + scale * (-ry * X + rx * Y + Z);
  
  return { X: X2, Y: Y2, Z: Z2 };
}

/**
 * Transform Arc 1960 geodetic coordinates to WGS84.
 * 
 * Pipeline: Arc1960 → Cartesian → Helmert → Cartesian → WGS84
 * 
 * @param coords - Arc 1960 coordinates
 * @returns WGS84 coordinates
 */
export function arc1960ToWGS84(coords: GeodeticCoords): GeodeticCoords {
  // Step 1: Arc 1960 geodetic → Cartesian (on Clarke 1880)
  const cartesianArc = geodeticToCartesian(coords, CLARKE_1880_MODIFIED);
  
  // Step 2: Apply Helmert transformation
  const cartesianWGS = applyHelmert7(cartesianArc, ARC1960_TO_WGS84_7PARAM);
  
  // Step 3: Cartesian → WGS84 geodetic
  return cartesianToGeodetic(cartesianWGS, WGS84);
}

/**
 * Transform WGS84 geodetic coordinates to Arc 1960.
 * 
 * Pipeline: WGS84 → Cartesian → Helmert (inverse) → Cartesian → Arc1960
 * 
 * @param coords - WGS84 coordinates
 * @returns Arc 1960 coordinates
 */
export function wgs84ToArc1960(coords: GeodeticCoords): GeodeticCoords {
  // Step 1: WGS84 geodetic → Cartesian
  const cartesianWGS = geodeticToCartesian(coords, WGS84);
  
  // Step 2: Apply inverse Helmert transformation
  const cartesianArc = applyHelmert7(cartesianWGS, ARC1960_TO_WGS84_7PARAM, true);
  
  // Step 3: Cartesian → Arc 1960 geodetic (on Clarke 1880)
  return cartesianToGeodetic(cartesianArc, CLARKE_1880_MODIFIED);
}

/**
 * Compute UTM zone from longitude.
 * 
 * Zone = floor((longitude + 180) / 6) + 1
 */
export function computeUTMZone(longitude: number): number {
  return Math.floor((longitude + 180) / 6) + 1;
}

/**
 * Convert geodetic coordinates to UTM.
 * Uses the standard transverse Mercator projection formulas.
 */
export function geodeticToUTM(
  coords: GeodeticCoords,
  ellipsoid = CLARKE_1880_MODIFIED,
  zone?: number
): UTMCoords {
  const phi = coords.latitude * Math.PI / 180;
  const lambda = coords.longitude * Math.PI / 180;
  
  const computedZone = zone ?? computeUTMZone(coords.longitude);
  const lambda0 = ((computedZone - 1) * 6 - 180 + 3) * Math.PI / 180;
  
  const a = ellipsoid.a;
  const e2 = ellipsoid.e2;
  const ePrime2 = ellipsoid.ePrime2;
  const k0 = 0.9996;
  
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);
  const T = tanPhi * tanPhi;
  const C = ePrime2 * cosPhi * cosPhi;
  const nu = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const A = (lambda - lambda0) * cosPhi;
  
  // Meridional arc
  const M = computeMeridionalArc(coords.latitude, ellipsoid);
  const M0 = 0; // Arc from equator (since latitude of origin is 0)
  
  const A2 = A * A;
  const A3 = A2 * A;
  const A4 = A3 * A;
  const A5 = A4 * A;
  const A6 = A5 * A;
  
  const easting = k0 * nu * (
    A + 
    (1 - T + C) * A3 / 6 +
    (5 - 18 * T + T * T + 72 * C - 58 * ePrime2) * A5 / 120
  ) + 500000;
  
  const northing = k0 * (
    (M - M0) +
    nu * tanPhi * (
      A2 / 2 +
      (5 - T + 9 * C + 4 * C * C) * A4 / 24 +
      (61 - 58 * T + T * T + 600 * C - 330 * ePrime2) * A6 / 720
    )
  );
  
  const hemisphere = coords.latitude >= 0 ? 'N' : 'S';
  const finalNorthing = hemisphere === 'S' ? northing + 10000000 : northing;
  
  return {
    zone: computedZone,
    hemisphere,
    easting,
    northing: finalNorthing,
  };
}

/**
 * Compute meridional arc from equator to given latitude.
 */
function computeMeridionalArc(latitude: number, ellipsoid = CLARKE_1880_MODIFIED): number {
  const phi = latitude * Math.PI / 180;
  const a = ellipsoid.a;
  const e2 = ellipsoid.e2;
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  
  return a * (
    (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi -
    (3 * e2 / 8 + 3 * e4 / 16 + 45 * e6 / 1024) * Math.sin(2 * phi) +
    (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi) -
    (35 * e6 / 3072) * Math.sin(6 * phi)
  );
}
