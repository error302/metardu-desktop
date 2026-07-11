/**
 * Grid Scale Factor Module
 * 
 * Computes the point scale factor for UTM and Cassini-Soldner projections.
 * This is the BIGGEST accuracy gap in most surveying software.
 * 
 * At Nairobi (UTM Zone 37S, ~180km from central meridian):
 *   Scale factor ≈ 1.0004
 *   That's 400 ppm — 400mm per kilometer of uncorrected distance.
 * 
 * For cadastral work requiring 1:10,000 closure, this alone can
 * blow the misclosure on traverses longer than ~250m per line.
 * 
 * References:
 * - Snyder, J.P. (1987) "Map Projections — A Working Manual" (USGS PP 1395)
 * - Kenya Survey Department technical specifications
 */

import { WGS84_A, WGS84_E2 } from './curvature-refraction';

// ─── Types ───────────────────────────────────────────────────────

export type ProjectionType = 'UTM36S' | 'UTM37S' | 'CASSINI_SOLDNER';

export interface UTMZone {
  /** Zone number (36 or 37 for Kenya) */
  zone: number;
  /** Hemisphere: 'S' for southern */
  hemisphere: 'N' | 'S';
  /** Central meridian in degrees */
  centralMeridian: number;
  /** Central scale factor (0.9996 for UTM) */
  k0: number;
  /** False easting (500000 for UTM) */
  falseEasting: number;
  /** False northing (0 for N, 10000000 for S) */
  falseNorthing: number;
}

export interface PointScaleFactorResult {
  /** Point scale factor (dimensionless) */
  scaleFactor: number;
  /** Deviation from unity in ppm */
  ppmFromUnity: number;
  /** Easting from central meridian (meters) */
  eastingFromCM: number;
  /** Meridional radius of curvature (meters) */
  rho: number;
  /** Radius of curvature in prime vertical (meters) */
  nu: number;
  /** Mean radius of curvature (meters) */
  Rm: number;
  /** Grid convergence at point (decimal degrees) */
  convergence: number;
  /** Latitude of point (decimal degrees) */
  latitude: number;
  /** Projection used */
  projection: ProjectionType;
}

export interface LineScaleFactorResult {
  /** Line scale factor (Simpson's rule average) */
  lineScaleFactor: number;
  /** Scale factor at start point */
  startScaleFactor: number;
  /** Scale factor at midpoint */
  midScaleFactor: number;
  /** Scale factor at end point */
  endScaleFactor: number;
  /** Grid distance (meters) */
  gridDistance: number;
  /** Ellipsoidal distance (meters) */
  ellipsoidalDistance: number;
  /** Correction in ppm */
  ppmCorrection: number;
}

// ─── Pre-defined UTM Zones for Kenya ────────────────────────────

export const UTM_ZONES: Record<string, UTMZone> = {
  UTM36S: {
    zone: 36,
    hemisphere: 'S',
    centralMeridian: 33,
    k0: 0.9996,
    falseEasting: 500000,
    falseNorthing: 10000000,
  },
  UTM37S: {
    zone: 37,
    hemisphere: 'S',
    centralMeridian: 39,
    k0: 0.9996,
    falseEasting: 500000,
    falseNorthing: 10000000,
  },
};

// Cassini-Soldner parameters (varies by local system in Kenya)
export interface CassiniSoldnerParams {
  /** Origin latitude (decimal degrees) */
  originLatitude: number;
  /** Origin longitude (decimal degrees) */
  originLongitude: number;
  /** False easting (meters) */
  falseEasting: number;
  /** False northing (meters) */
  falseNorthing: number;
  /** Ellipsoid semi-major axis */
  a: number;
  /** Ellipsoid flattening reciprocal */
  rf: number;
}

// ─── Core Functions ──────────────────────────────────────────────

/**
 * Compute meridional radius of curvature ρ.
 * ρ = a(1 - e²) / (1 - e² × sin²(φ))^(3/2)
 */
function computeMeridionalRadius(latitude: number, a: number = WGS84_A, e2: number = WGS84_E2): number {
  const phi = latitude * Math.PI / 180;
  const sinPhi = Math.sin(phi);
  const denom = Math.pow(1 - e2 * sinPhi * sinPhi, 1.5);
  return a * (1 - e2) / denom;
}

/**
 * Compute radius of curvature in the prime vertical ν.
 * ν = a / √(1 - e² × sin²(φ))
 */
function computePrimeVerticalRadius(latitude: number, a: number = WGS84_A, e2: number = WGS84_E2): number {
  const phi = latitude * Math.PI / 180;
  const sinPhi = Math.sin(phi);
  return a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
}

/**
 * Compute grid convergence at a point.
 * 
 * For UTM:
 * γ = (λ - λ₀) × sin(φ) × [1 + (λ - λ₀)² × cos²(φ) / 3 + ...]
 * 
 * @param latitude - Latitude in decimal degrees
 * @param longitude - Longitude in decimal degrees
 * @param centralMeridian - Central meridian in decimal degrees
 * @returns Grid convergence in decimal degrees
 */
export function computeGridConvergence(
  latitude: number,
  longitude: number,
  centralMeridian: number
): number {
  const phi = latitude * Math.PI / 180;
  const dLambda = (longitude - centralMeridian) * Math.PI / 180;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  
  // First-order convergence
  let gamma = dLambda * sinPhi;
  
  // Higher-order terms for better accuracy
  const dLambda2 = dLambda * dLambda;
  gamma += (dLambda2 * dLambda / 3) * sinPhi * cosPhi * cosPhi;
  
  // Convert back to degrees
  return gamma * 180 / Math.PI;
}

/**
 * Compute point scale factor for UTM projection.
 * 
 * k = k₀ × [1 + (E'²)/(2Rm²) × (1 + e'²cos²φ) + (E'⁴)/(24Rm⁴)]
 * 
 * Where E' = easting from central meridian = E - 500,000
 * 
 * Simplified (sufficient for 2nd order accuracy):
 * k = k₀ × (1 + E'² / (2 × Rm²))
 * 
 * @param easting - UTM easting in meters
 * @param northing - UTM northing in meters
 * @param projection - UTM zone identifier
 * @returns Point scale factor result
 */
export function computeUTMPointScaleFactor(
  easting: number,
  northing: number,
  projection: 'UTM36S' | 'UTM37S'
): PointScaleFactorResult {
  const zone = UTM_ZONES[projection];
  if (!zone) {
    throw new Error(`Unknown UTM zone: ${projection}`);
  }
  
  // Easting from central meridian
  const Eprime = easting - zone.falseEasting;
  
  // Estimate latitude from northing (for computing radii of curvature)
  // This uses the approximate footpoint latitude formula
  const latitude = estimateLatitudeFromNorthing(northing, zone);
  
  // Compute radii of curvature
  const rho = computeMeridionalRadius(latitude);
  const nu = computePrimeVerticalRadius(latitude);
  const Rm = Math.sqrt(rho * nu);
  
  // Second eccentricity squared
  const ePrime2 = WGS84_E2 / (1 - WGS84_E2);
  const cosPhi = Math.cos(latitude * Math.PI / 180);
  const cosPhi2 = cosPhi * cosPhi;
  
  // Point scale factor (full formula for 2nd order accuracy)
  const Eprime2 = Eprime * Eprime;
  const Eprime4 = Eprime2 * Eprime2;
  const Rm2 = Rm * Rm;
  const Rm4 = Rm2 * Rm2;
  
  const k = zone.k0 * (
    1 + 
    (Eprime2 / (2 * Rm2)) * (1 + ePrime2 * cosPhi2) +
    (Eprime4 / (24 * Rm4))
  );
  
  // Grid convergence
  const longitude = estimateLongitudeFromEasting(easting, zone, latitude);
  const convergence = computeGridConvergence(latitude, longitude, zone.centralMeridian);
  
  return {
    scaleFactor: k,
    ppmFromUnity: Math.round((k - 1) * 1e6 * 100) / 100,
    eastingFromCM: Eprime,
    rho,
    nu,
    Rm,
    convergence,
    latitude,
    projection,
  };
}

/**
 * Compute line scale factor using Simpson's rule.
 * 
 * k_line = (k_A + 4×k_M + k_B) / 6
 * 
 * Where k_A, k_M, k_B are point scale factors at start, mid, and end.
 * This gives much better accuracy than simple averaging, especially
 * for lines that cross significant latitude or easting changes.
 * 
 * @param startEasting - Start point easting (meters)
 * @param startNorthing - Start point northing (meters)
 * @param endEasting - End point easting (meters)
 * @param endNorthing - End point northing (meters)
 * @param projection - UTM zone
 * @returns Line scale factor result
 */
export function computeLineScaleFactor(
  startEasting: number,
  startNorthing: number,
  endEasting: number,
  endNorthing: number,
  projection: 'UTM36S' | 'UTM37S'
): LineScaleFactorResult {
  // Midpoint coordinates
  const midEasting = (startEasting + endEasting) / 2;
  const midNorthing = (startNorthing + endNorthing) / 2;
  
  // Point scale factors
  const sfStart = computeUTMPointScaleFactor(startEasting, startNorthing, projection);
  const sfMid = computeUTMPointScaleFactor(midEasting, midNorthing, projection);
  const sfEnd = computeUTMPointScaleFactor(endEasting, endNorthing, projection);
  
  // Simpson's rule line scale factor
  const lineScaleFactor = (sfStart.scaleFactor + 4 * sfMid.scaleFactor + sfEnd.scaleFactor) / 6;
  
  // Compute distances
  const dE = endEasting - startEasting;
  const dN = endNorthing - startNorthing;
  const gridDistance = Math.sqrt(dE * dE + dN * dN);
  const ellipsoidalDistance = gridDistance / lineScaleFactor;
  
  const ppmCorrection = (lineScaleFactor - 1) * 1e6;
  
  return {
    lineScaleFactor,
    startScaleFactor: sfStart.scaleFactor,
    midScaleFactor: sfMid.scaleFactor,
    endScaleFactor: sfEnd.scaleFactor,
    gridDistance,
    ellipsoidalDistance,
    ppmCorrection: Math.round(ppmCorrection * 100) / 100,
  };
}

/**
 * Apply grid scale factor to convert ellipsoidal distance to grid distance.
 * 
 * Grid distance = Ellipsoidal distance × Line scale factor
 * 
 * @param ellipsoidalDistance - Distance reduced to the ellipsoid (meters)
 * @param startEasting - Start point easting
 * @param startNorthing - Start point northing
 * @param endEasting - End point easting
 * @param endNorthing - End point northing
 * @param projection - UTM zone
 * @returns Grid distance in meters
 */
export function applyGridScaleFactor(
  ellipsoidalDistance: number,
  startEasting: number,
  startNorthing: number,
  endEasting: number,
  endNorthing: number,
  projection: 'UTM36S' | 'UTM37S'
): { gridDistance: number; lineScaleFactor: number; ppm: number } {
  const result = computeLineScaleFactor(
    startEasting, startNorthing,
    endEasting, endNorthing,
    projection
  );
  
  return {
    gridDistance: ellipsoidalDistance * result.lineScaleFactor,
    lineScaleFactor: result.lineScaleFactor,
    ppm: result.ppmCorrection,
  };
}

// ─── Helper Functions ────────────────────────────────────────────

/**
 * Estimate latitude from UTM northing (footpoint latitude).
 * Uses the series expansion of the inverse meridional arc formula.
 */
function estimateLatitudeFromNorthing(northing: number, zone: UTMZone): number {
  const a = WGS84_A;
  const e2 = WGS84_E2;
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  
  // Adjusted northing
  const N = northing - zone.falseNorthing;
  
  // Meridional arc
  const M = N / zone.k0;
  
  // Footpoint latitude (series expansion)
  const mu = M / (a * (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256));
  
  const ePrime2 = e2 / (1 - e2);
  
  const phi1 = mu + 
    (3 * ePrime2 / 2 - 27 * ePrime2 * ePrime2 / 32) * Math.sin(2 * mu) +
    (21 * ePrime2 * ePrime2 / 16 - 55 * ePrime2 * ePrime2 * ePrime2 / 32) * Math.sin(4 * mu) +
    (151 * ePrime2 * ePrime2 * ePrime2 / 96) * Math.sin(6 * mu);
  
  return phi1 * 180 / Math.PI;
}

/**
 * Estimate longitude from UTM easting and known latitude.
 */
function estimateLongitudeFromEasting(easting: number, zone: UTMZone, latitude: number): number {
  const phi = latitude * Math.PI / 180;
  const ePrime2 = WGS84_E2 / (1 - WGS84_E2);
  const nu = computePrimeVerticalRadius(latitude);
  const rho = computeMeridionalRadius(latitude);
  const T = Math.tan(phi) * Math.tan(phi);
  const C = ePrime2 * Math.cos(phi) * Math.cos(phi);
  const N = nu;
  const R = rho;
  const D = (easting - zone.falseEasting) / (zone.k0 * N);
  
  let lon = zone.centralMeridian * Math.PI / 180 + 
    (D - (1 + 2 * T + C) * D * D * D / 6 + 
     (5 - 2 * C + 28 * T - 3 * C * C + 8 * ePrime2 + 24 * T * T) * 
     D * D * D * D * D / 120) / Math.cos(phi);
  
  return lon * 180 / Math.PI;
}
