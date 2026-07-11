/**
 * Area Computation Module
 * 
 * Computes areas using the Shoelace (coordinate) method
 * and the radial (bearing/distance) method.
 * 
 * References:
 * - Anderson & Mikhail (1998) "Surveying: Theory and Practice"
 */

import type { Point } from '../cogo/engine';

// ─── Types ───────────────────────────────────────────────────────

export interface AreaResult {
  /** Area in square meters */
  areaSqM: number;
  /** Area in hectares */
  areaHa: number;
  /** Area in acres */
  areaAcres: number;
  /** Number of vertices */
  vertexCount: number;
  /** Perimeter in meters */
  perimeter: number;
  /** Method used */
  method: 'shoelace' | 'radial' | 'double_meridian';
}

// ─── Core Functions ──────────────────────────────────────────────

/**
 * Compute area using the Shoelace (coordinate) formula.
 * 
 * A = 0.5 × |Σ(xᵢ × yᵢ₊₁ - xᵢ₊₁ × yᵢ)|
 * 
 * This is the standard method for computing areas from coordinates.
 * Positive result = clockwise traverse, negative = counter-clockwise.
 * 
 * @param points - Ordered list of boundary points (closed or open polygon)
 * @returns Area result with conversions
 */
export function computeAreaByShoelace(points: Point[]): AreaResult {
  const n = points.length;
  if (n < 3) {
    throw new Error('Need at least 3 points to compute area');
  }
  
  // Shoelace formula
  let doubleArea = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    doubleArea += points[i].easting * points[j].northing;
    doubleArea -= points[j].easting * points[i].northing;
  }
  
  const areaSqM = Math.abs(doubleArea) / 2;
  
  // Compute perimeter
  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dE = points[j].easting - points[i].easting;
    const dN = points[j].northing - points[i].northing;
    perimeter += Math.sqrt(dE * dE + dN * dN);
  }
  
  return {
    areaSqM,
    areaHa: areaSqM / 10000,
    areaAcres: areaSqM / 4046.8564224,
    vertexCount: n,
    perimeter,
    method: 'shoelace',
  };
}

/**
 * Compute area using the Double Meridian Distance (DMD) method.
 * 
 * This is the traditional surveying method for computing areas
 * from traverse data (bearings and distances).
 * 
 * DMD of a course = DMD of previous course + Departure of previous course + Departure of current course
 * 
 * Double Area = Σ(Latitude × DMD)
 * Area = |Double Area| / 2
 * 
 * @param bearings - Array of bearings in decimal degrees
 * @param distances - Array of distances in meters
 * @returns Area result
 */
export function computeAreaByDMD(
  bearings: number[],
  distances: number[]
): AreaResult {
  const n = bearings.length;
  if (n !== distances.length) {
    throw new Error('Bearings and distances arrays must be same length');
  }
  if (n < 3) {
    throw new Error('Need at least 3 courses to compute area');
  }
  
  // Compute departures (dE) and latitudes (dN)
  const departures: number[] = [];
  const latitudes: number[] = [];
  
  for (let i = 0; i < n; i++) {
    const theta = bearings[i] * Math.PI / 180;
    departures.push(distances[i] * Math.sin(theta));
    latitudes.push(distances[i] * Math.cos(theta));
  }
  
  // Compute DMD for each course
  const dmds: number[] = [];
  dmds[0] = departures[0]; // First DMD = first departure
  
  for (let i = 1; i < n; i++) {
    dmds[i] = dmds[i - 1] + departures[i - 1] + departures[i];
  }
  
  // Compute double area
  let doubleArea = 0;
  for (let i = 0; i < n; i++) {
    doubleArea += latitudes[i] * dmds[i];
  }
  
  const areaSqM = Math.abs(doubleArea) / 2;
  
  // Compute perimeter
  const perimeter = distances.reduce((sum, d) => sum + d, 0);
  
  return {
    areaSqM,
    areaHa: areaSqM / 10000,
    areaAcres: areaSqM / 4046.8564224,
    vertexCount: n,
    perimeter,
    method: 'double_meridian',
  };
}

/**
 * Compute area using radial method (from a central point).
 * Useful for irregular plots where a central point is available.
 * 
 * A = 0.5 × |Σ(dᵢ × dᵢ₊₁ × sin(θᵢ₊₁ - θᵢ))|
 * 
 * @param radialDistances - Distances from central point to each vertex
 * @param radialBearings - Bearings from central point to each vertex
 * @returns Area result
 */
export function computeAreaByRadial(
  radialDistances: number[],
  radialBearings: number[]
): AreaResult {
  const n = radialDistances.length;
  if (n !== radialBearings.length) {
    throw new Error('Distances and bearings arrays must be same length');
  }
  if (n < 3) {
    throw new Error('Need at least 3 radial lines');
  }
  
  let doubleArea = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const angleDiff = (radialBearings[j] - radialBearings[i]) * Math.PI / 180;
    doubleArea += radialDistances[i] * radialDistances[j] * Math.sin(angleDiff);
  }
  
  const areaSqM = Math.abs(doubleArea) / 2;
  
  return {
    areaSqM,
    areaHa: areaSqM / 10000,
    areaAcres: areaSqM / 4046.8564224,
    vertexCount: n,
    perimeter: 0, // Would need to compute between vertices
    method: 'radial',
  };
}

/**
 * Convert area between units.
 */
export function convertArea(
  areaSqM: number,
  fromUnit: 'sqm' | 'ha' | 'acre' | 'sqft',
  toUnit: 'sqm' | 'ha' | 'acre' | 'sqft'
): number {
  // First convert to square meters
  const toSqm: Record<string, number> = {
    sqm: 1,
    ha: 10000,
    acre: 4046.8564224,
    sqft: 0.09290304,
  };
  
  const inSqm = areaSqM * toSqm[fromUnit];
  return inSqm / toSqm[toUnit];
}
