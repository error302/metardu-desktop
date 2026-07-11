/**
 * COGO (Coordinate Geometry) Engine
 * 
 * Core coordinate geometry computations for cadastral surveying.
 * Handles bearing/distance computations, intersections, and subdivisions.
 * 
 * References:
 * - Anderson & Mikhail (1998) "Surveying: Theory and Practice"
 * - surveying mathematics textbooks
 */

// ─── Types ───────────────────────────────────────────────────────

export interface Point {
  easting: number;
  northing: number;
}

export interface BearingDistance {
  bearing: number;   // Decimal degrees (0-360)
  distance: number;  // Meters
}

export interface IntersectionResult {
  point: Point;
  exists: boolean;
  bearing1: number;
  distance1: number;
  bearing2: number;
  distance2: number;
}

// ─── Core COGO Functions ─────────────────────────────────────────

/**
 * Compute bearing and distance between two points.
 * 
 * Bearing measured clockwise from north (0-360°).
 * 
 * @param from - Start point
 * @param to - End point
 * @returns Bearing (degrees) and distance (meters)
 */
export function computeBearingAndDistance(from: Point, to: Point): BearingDistance {
  const dE = to.easting - from.easting;
  const dN = to.northing - from.northing;
  
  let bearing = Math.atan2(dE, dN) * 180 / Math.PI;
  if (bearing < 0) bearing += 360;
  
  const distance = Math.sqrt(dE * dE + dN * dN);
  
  return { bearing, distance };
}

/**
 * Compute a point from a starting point, bearing, and distance.
 * 
 * E_to = E_from + d × sin(θ)
 * N_to = N_from + d × cos(θ)
 * 
 * @param from - Start point
 * @param bearing - Bearing in decimal degrees
 * @param distance - Distance in meters
 * @returns Computed point
 */
export function computePoint(from: Point, bearing: number, distance: number): Point {
  const theta = bearing * Math.PI / 180;
  
  return {
    easting: from.easting + distance * Math.sin(theta),
    northing: from.northing + distance * Math.cos(theta),
  };
}

/**
 * Line-line intersection.
 * 
 * Given two lines defined by point + bearing, find their intersection.
 * Uses the parametric form of line equations.
 * 
 * Line 1: P = P1 + t × (sin θ₁, cos θ₁)
 * Line 2: Q = P2 + s × (sin θ₂, cos θ₂)
 * 
 * @param point1 - Point on line 1
 * @param bearing1 - Bearing of line 1 (degrees)
 * @param point2 - Point on line 2
 * @param bearing2 - Bearing of line 2 (degrees)
 * @returns Intersection point
 */
export function lineLineIntersection(
  point1: Point,
  bearing1: number,
  point2: Point,
  bearing2: number
): IntersectionResult {
  const theta1 = bearing1 * Math.PI / 180;
  const theta2 = bearing2 * Math.PI / 180;
  
  const sinT1 = Math.sin(theta1);
  const cosT1 = Math.cos(theta1);
  const sinT2 = Math.sin(theta2);
  const cosT2 = Math.cos(theta2);
  
  // Cross product of direction vectors
  const cross = sinT1 * cosT2 - cosT1 * sinT2;
  
  // Check if lines are parallel
  const exists = Math.abs(cross) > 1e-12;
  
  if (!exists) {
    return {
      point: { easting: 0, northing: 0 },
      exists: false,
      bearing1,
      distance1: 0,
      bearing2,
      distance2: 0,
    };
  }
  
  // Compute intersection
  const dE = point2.easting - point1.easting;
  const dN = point2.northing - point1.northing;
  
  const t = (dE * cosT2 - dN * sinT2) / cross;
  
  const intersectionPoint: Point = {
    easting: point1.easting + t * sinT1,
    northing: point1.northing + t * cosT1,
  };
  
  // Compute distances from each point to intersection
  const bd1 = computeBearingAndDistance(point1, intersectionPoint);
  const bd2 = computeBearingAndDistance(point2, intersectionPoint);
  
  return {
    point: intersectionPoint,
    exists: true,
    bearing1: bd1.bearing,
    distance1: bd1.distance,
    bearing2: bd2.bearing,
    distance2: bd2.distance,
  };
}

/**
 * Line-circle intersection.
 * 
 * Find intersection(s) of a line (defined by point + bearing)
 * and a circle (defined by center + radius).
 * 
 * @param linePoint - Point on the line
 * @param bearing - Bearing of line (degrees)
 * @param circleCenter - Center of circle
 * @param radius - Radius of circle (meters)
 * @returns Array of intersection points (0, 1, or 2)
 */
export function lineCircleIntersection(
  linePoint: Point,
  bearing: number,
  circleCenter: Point,
  radius: number
): Point[] {
  const theta = bearing * Math.PI / 180;
  const dE = circleCenter.easting - linePoint.easting;
  const dN = circleCenter.northing - linePoint.northing;
  
  // Project center onto line
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const t = dE * sinT + dN * cosT;
  
  // Perpendicular distance from center to line
  const perpDist = Math.abs(dE * cosT - dN * sinT);
  
  if (perpDist > radius) {
    return []; // No intersection
  }
  
  // Distance along line from perpendicular foot to intersection
  const halfChord = Math.sqrt(radius * radius - perpDist * perpDist);
  
  const results: Point[] = [];
  
  // First intersection
  const t1 = t - halfChord;
  results.push({
    easting: linePoint.easting + t1 * sinT,
    northing: linePoint.northing + t1 * cosT,
  });
  
  // Second intersection (if not tangent)
  if (Math.abs(halfChord) > 1e-10) {
    const t2 = t + halfChord;
    results.push({
      easting: linePoint.easting + t2 * sinT,
      northing: linePoint.northing + t2 * cosT,
    });
  }
  
  return results;
}

/**
 * Circle-circle intersection.
 * 
 * @param center1 - Center of first circle
 * @param radius1 - Radius of first circle
 * @param center2 - Center of second circle
 * @param radius2 - Radius of second circle
 * @returns Array of intersection points
 */
export function circleCircleIntersection(
  center1: Point,
  radius1: number,
  center2: Point,
  radius2: number
): Point[] {
  const dE = center2.easting - center1.easting;
  const dN = center2.northing - center1.northing;
  const dist = Math.sqrt(dE * dE + dN * dN);
  
  // Check for no intersection
  if (dist > radius1 + radius2) return [];  // Too far apart
  if (dist < Math.abs(radius1 - radius2)) return []; // One inside other
  if (dist < 1e-10) return []; // Concentric
  
  // Distance from center1 to the line joining the intersections
  const a = (radius1 * radius1 - radius2 * radius2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, radius1 * radius1 - a * a));
  
  // Unit vector from center1 to center2
  const ux = dE / dist;
  const uy = dN / dist;
  
  // Midpoint of intersection line
  const midX = center1.easting + a * ux;
  const midY = center1.northing + a * uy;
  
  const results: Point[] = [];
  
  results.push({
    easting: midX + h * uy,
    northing: midY - h * ux,
  });
  
  if (Math.abs(h) > 1e-10) {
    results.push({
      easting: midX - h * uy,
      northing: midY + h * ux,
    });
  }
  
  return results;
}

/**
 * Compute inverse (bearing and distance) from coordinates.
 * Alias for computeBearingAndDistance.
 */
export const inverse = computeBearingAndDistance;

/**
 * Compute forward (coordinates from bearing and distance).
 * Alias for computePoint.
 */
export const forward = computePoint;
