/**
 * Calculation standard: N.N. Basak — Surveying and Levelling
 * Source: N.N. Basak, Surveying and Levelling, Chapter 4
 * Source: Ghilani & Wolf, Elementary Surveying 16th Ed., Chapter 12
 * - No intermediate rounding
 * - Full floating point precision throughout
 * - Round only at final display layer
 * - Bearings: WCB 0-360° clockwise from North
 */

// METARDU Engine - Area calculations

import { Point2D, AreaResult } from './types';

export function coordinateArea(points: Point2D[]): AreaResult {
  if (points.length < 3) {
    return {
      areaSqm: 0,
      areaHa: 0,
      areaAcres: 0,
      perimeter: 0,
      centroid: { easting: 0, northing: 0 },
      method: 'Coordinate Method (Shoelace)'
    };
  }
  
  // Close the polygon if not already closed
  const closed = [...points];
  if (closed[0].easting !== closed[closed.length - 1].easting ||
      closed[0].northing !== closed[closed.length - 1].northing) {
    closed.push(points[0]);
  }
  
  // Shoelace formula (Source: Basak, Chapter 4 / Ghilani & Wolf, Eq. 12.5)
  // 2A = |Σ(E_n × N_{n+1}) - Σ(N_n × E_{n+1})|
  let doubleArea = 0;
  for (let i = 0; i < closed.length - 1; i++) {
    doubleArea += closed[i].easting * closed[i + 1].northing;
    doubleArea -= closed[i + 1].easting * closed[i].northing;
  }
  
  const signedArea = doubleArea / 2;
  const areaSqm = Math.abs(signedArea);
  
  // Calculate perimeter
  let perimeter = 0;
  for (let i = 0; i < closed.length - 1; i++) {
    const dx = closed[i + 1].easting - closed[i].easting;
    const dy = closed[i + 1].northing - closed[i].northing;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  
  // Calculate centroid (uses signed area)
  let centroidX = 0;
  let centroidY = 0;
  for (let i = 0; i < closed.length - 1; i++) {
    const cross = (closed[i].easting * closed[i + 1].northing) -
                  (closed[i + 1].easting * closed[i].northing);
    centroidX += (closed[i].easting + closed[i + 1].easting) * cross;
    centroidY += (closed[i].northing + closed[i + 1].northing) * cross;
  }

  if (doubleArea !== 0) {
    centroidX = centroidX / (3 * doubleArea);
    centroidY = centroidY / (3 * doubleArea);
  } else {
    // Degenerate polygon: fall back to average of vertices
    const unique = closed.slice(0, -1);
    centroidX = unique.reduce((sum, p) => sum + p.easting, 0) / unique.length;
    centroidY = unique.reduce((sum, p) => sum + p.northing, 0) / unique.length;
  }
  
  return {
    areaSqm,
    areaHa: areaSqm / 10000,
    areaAcres: areaSqm * 0.000247105,
    perimeter,
    centroid: { easting: centroidX, northing: centroidY },
    method: 'Coordinate Method (Shoelace)'
  };
}

export function trapezoidalArea(ordinates: number[], interval: number): AreaResult {
  // Trapezoidal Rule: A = d × [(O0 + On)/2 + O1 + O2 + ... + O(n-1)]
  if (ordinates.length < 2) {
    return { areaSqm: 0, areaHa: 0, areaAcres: 0, perimeter: 0, centroid: { easting: 0, northing: 0 }, method: 'Trapezoidal Rule' };
  }
  
  let area = interval * ((ordinates[0] + ordinates[ordinates.length - 1]) / 2);
  for (let i = 1; i < ordinates.length - 1; i++) {
    area += interval * ordinates[i];
  }
  
  return {
    areaSqm: area,
    areaHa: area / 10000,
    areaAcres: area * 0.000247105,
    perimeter: 0,
    centroid: { easting: 0, northing: 0 },
    method: 'Trapezoidal Rule'
  };
}

export function simpsonsArea(ordinates: number[], interval: number): AreaResult {
  // Simpson's Rule: A = (d/3) × [(O0 + On) + 4(O1 + O3 + ...) + 2(O2 + O4 + ...)]
  // Requires odd number of intervals (even number of ordinates)
  if (ordinates.length < 3 || ordinates.length % 2 === 0) {
    // Fall back to trapezoidal for even number of ordinates
    return trapezoidalArea(ordinates, interval);
  }
  
  let area = ordinates[0] + ordinates[ordinates.length - 1];
  
  for (let i = 1; i < ordinates.length - 1; i++) {
    if (i % 2 === 1) {
      area += 4 * ordinates[i];
    } else {
      area += 2 * ordinates[i];
    }
  }
  
  area = (interval / 3) * area;
  
  return {
    areaSqm: area,
    areaHa: area / 10000,
    areaAcres: area * 0.000247105,
    perimeter: 0,
    centroid: { easting: 0, northing: 0 },
    method: "Simpson's Rule"
  };
}

export function midOrdinateArea(ordinates: number[], interval: number): AreaResult {
  // Mid-Ordinate Rule: A = d × (O1 + O2 + ... + On)
  if (ordinates.length < 1) {
    return { areaSqm: 0, areaHa: 0, areaAcres: 0, perimeter: 0, centroid: { easting: 0, northing: 0 }, method: 'Mid-Ordinate Rule' };
  }
  
  const sum = ordinates.reduce((a, b) => a + b, 0);
  const area = interval * sum;
  
  return {
    areaSqm: area,
    areaHa: area / 10000,
    areaAcres: area * 0.000247105,
    perimeter: 0,
    centroid: { easting: 0, northing: 0 },
    method: 'Mid-Ordinate Rule'
  };
}

export function averageOrdinateArea(ordinates: number[], totalLength: number): AreaResult {
  // Average-Ordinate Rule: A = L/(n+1) × (O0 + O1 + ... + On)
  if (ordinates.length < 1) {
    return { areaSqm: 0, areaHa: 0, areaAcres: 0, perimeter: 0, centroid: { easting: 0, northing: 0 }, method: 'Average-Ordinate Rule' };
  }
  
  const sum = ordinates.reduce((a, b) => a + b, 0);
  const area = (totalLength / (ordinates.length + 1)) * sum;
  
  return {
    areaSqm: area,
    areaHa: area / 10000,
    areaAcres: area * 0.000247105,
    perimeter: 0,
    centroid: { easting: 0, northing: 0 },
    method: 'Average-Ordinate Rule'
  };
}

/**
 * Simple shoelace polygon area — returns just the number (m²).
 *
 * This is the canonical implementation. Previously duplicated in 7+
 * files across the codebase (statutoryGate, overlapDetection,
 * statutoryGateLoader, deedPlanRenderer, etc.). All local copies
 * should import from here.
 *
 * @param vertices Array of {easting, northing} points (minimum 3)
 * @returns Area in square metres (always positive)
 */
export function shoelaceArea(
  vertices: Array<{ easting: number; northing: number }>
): number {
  if (vertices.length < 3) return 0
  let sum = 0
  const n = vertices.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    sum += vertices[i].easting * vertices[j].northing
    sum -= vertices[j].easting * vertices[i].northing
  }
  return Math.abs(sum) / 2
}
