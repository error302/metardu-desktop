/**
 * Calculation standard: N.N. Basak — Surveying and Levelling
 * - No intermediate rounding
 * - Full floating point precision throughout
 * - Round only at final display layer
 * - Bearings: WCB 0-360° clockwise from North
 */

// METARDU Engine - COGO (Coordinate Geometry)

import { Point2D, COGOIntersection, COGORadiation, COOResection } from './types';
import { toRadians, toDegrees } from './angles';
import { distanceBearing } from './distance';

export function bearingIntersection(
  stationA: Point2D,
  bearingA: number,
  stationB: Point2D,
  bearingB: number
): COGOIntersection | null {
  // Intersection of two rays defined by station + bearing (WCB from North)
  // A + t*vA = B + u*vB
  const radA = toRadians(bearingA);
  const radB = toRadians(bearingB);

  const vAx = Math.sin(radA);
  const vAy = Math.cos(radA);
  const vBx = Math.sin(radB);
  const vBy = Math.cos(radB);

  const dx = stationB.easting - stationA.easting;
  const dy = stationB.northing - stationA.northing;

  const det = vAx * (-vBy) - vAy * (-vBx); // = vAy*vBx - vAx*vBy
  if (Math.abs(det) < 1e-12) return null; // parallel / nearly parallel

  // Solve:
  // t*vAx - u*vBx = dx
  // t*vAy - u*vBy = dy
  const t = (dx * (-vBy) - dy * (-vBx)) / det;
  const u = (vAx * dy - vAy * dx) / det;

  const point: Point2D = {
    easting: stationA.easting + t * vAx,
    northing: stationA.northing + t * vAy,
  };
  
  return {
    point,
    distanceFromA: t,
    distanceFromB: u
  };
}

export function distanceIntersection(
  stationA: Point2D,
  distanceA: number,
  stationB: Point2D,
  distanceB: number
): [Point2D, Point2D] | null {
  // Circle-circle intersection
  const dx = stationB.easting - stationA.easting;
  const dy = stationB.northing - stationA.northing;
  const distAB = Math.sqrt(dx * dx + dy * dy);
  
  // Check if circles intersect
  if (distAB > distanceA + distanceB || distAB < Math.abs(distanceA - distanceB) || distAB === 0) {
    return null;
  }
  
  const a = (distanceA * distanceA - distanceB * distanceB + distAB * distAB) / (2 * distAB);
  const h = Math.sqrt(distanceA * distanceA - a * a);
  
  const cx = stationA.easting + a * dx / distAB;
  const cy = stationA.northing + a * dy / distAB;
  
  const point1: Point2D = {
    easting: cx + h * dy / distAB,
    northing: cy - h * dx / distAB
  };
  
  const point2: Point2D = {
    easting: cx - h * dy / distAB,
    northing: cy + h * dx / distAB
  };
  
  return [point1, point2];
}

export function tienstraResection(
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  angle12: number,  // Angle at unknown station between rays to P1 and P2 (degrees)
  angle23: number   // Angle at unknown station between rays to P2 and P3 (degrees)
): COOResection | null {
  // Tienstra's method for three-point resection (planimetric)
  // Assumption for inputs:
  // - angle12 = angle between lines P->P1 and P->P2
  // - angle23 = angle between lines P->P2 and P->P3
  // Then angle31 = 360° - (angle12 + angle23)

  const angle31 = 360 - (angle12 + angle23)
  if (angle12 <= 0 || angle23 <= 0 || angle31 <= 0) return null

  // Triangle angles at control points A=p1, B=p2, C=p3
  const a = distanceBearing(p2, p3).distance // side a opposite p1
  const b = distanceBearing(p3, p1).distance // side b opposite p2
  const c = distanceBearing(p1, p2).distance // side c opposite p3

  const clamp = (x: number) => Math.max(-1, Math.min(1, x))

  const A = Math.acos(clamp((b * b + c * c - a * a) / (2 * b * c))) // at p1
  const B = Math.acos(clamp((a * a + c * c - b * b) / (2 * a * c))) // at p2
  const C = Math.acos(clamp((a * a + b * b - c * c) / (2 * a * b))) // at p3

  // Map observed angles at unknown station P to α, β, γ:
  // α = ∠(P2 P P3) = angle23 (opposite p1)
  // γ = ∠(P1 P P2) = angle12 (opposite p3)
  // β = ∠(P3 P P1) = angle31 (opposite p2)
  const alpha = toRadians(angle23)
  const beta = toRadians(angle31)
  const gamma = toRadians(angle12)

  const cot = (r: number) => 1 / Math.tan(r)

  const aW = 1 / (cot(alpha) - cot(A))
  const bW = 1 / (cot(beta) - cot(B))
  const cW = 1 / (cot(gamma) - cot(C))

  const sum = aW + bW + cW
  if (!isFinite(sum) || Math.abs(sum) < 1e-12) return null

  const point: Point2D = {
    easting: (aW * p1.easting + bW * p2.easting + cW * p3.easting) / sum,
    northing: (aW * p1.northing + bW * p2.northing + cW * p3.northing) / sum,
  }

  const d1 = distanceBearing(point, p1).distance
  const d2 = distanceBearing(point, p2).distance
  const d3 = distanceBearing(point, p3).distance

  return { point, distanceToP1: d1, distanceToP2: d2, distanceToP3: d3 }
}

export function radiation(
  from: Point2D,
  bearing: number,
  distance: number
): COGORadiation {
  const rad = toRadians(bearing);
  const point: Point2D = {
    easting: from.easting + distance * Math.sin(rad),
    northing: from.northing + distance * Math.cos(rad)
  };
  
  return {
    point,
    distance,
    bearing
  };
}

export function offsetPoint(
  point: Point2D,
  bearing: number,
  offset: number
): Point2D {
  const rad = toRadians(bearing);
  return {
    easting: point.easting + offset * Math.sin(rad),
    northing: point.northing + offset * Math.cos(rad)
  };
}
