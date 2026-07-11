/**
 * Calculation standard: N.N. Basak — Surveying and Levelling
 * - No intermediate rounding
 * - Full floating point precision throughout
 * - Round only at final display layer
 * - Bearings: WCB 0-360° clockwise from North
 */

// METARDU Engine - Distance and Bearing calculations

import { Point2D, DistanceBearingResult } from './types';
import { toRadians, toDegrees, normalizeBearing, bearingToString, wcbToQuadrant, backBearing } from './angles';

export { backBearing } from './angles';

export function distanceBearing(
  from: Point2D,
  to: Point2D
): DistanceBearingResult {
  const deltaE = to.easting - from.easting;
  const deltaN = to.northing - from.northing;
  
  const distance = Math.sqrt(deltaE * deltaE + deltaN * deltaN);
  let bearing = toDegrees(Math.atan2(deltaE, deltaN));
  bearing = normalizeBearing(bearing);
  
  const back = backBearing(bearing);
  
  return {
    distance,
    bearing,
    bearingDMS: bearingToString(bearing),
    backBearing: back,
    backBearingDMS: bearingToString(back),
    quadrant: wcbToQuadrant(bearing),
    deltaE,
    deltaN
  };
}

export function slopeDistance(
  horizontalDistance: number,
  verticalAngle: number
): number {
  const rad = toRadians(verticalAngle);
  return horizontalDistance / Math.cos(rad);
}

export function horizontalDistance(
  slopeDistance: number,
  verticalAngle: number
): number {
  const rad = toRadians(verticalAngle);
  return slopeDistance * Math.cos(rad);
}

export function verticalDistance(
  slopeDistance: number,
  verticalAngle: number
): number {
  const rad = toRadians(verticalAngle);
  return slopeDistance * Math.sin(rad);
}

export function gradient(
  verticalDistance: number,
  horizontalDistance: number
): { percentage: number; degrees: number } {
  if (horizontalDistance === 0) {
    return { percentage: 0, degrees: 0 };
  }
  
  const percentage = (verticalDistance / horizontalDistance) * 100;
  const degrees = toDegrees(Math.atan(verticalDistance / horizontalDistance));
  
  return { percentage, degrees };
}

export function polarPoint(
  from: Point2D,
  bearing: number,
  distance: number
): Point2D {
  const rad = toRadians(bearing);
  return {
    easting: from.easting + distance * Math.sin(rad),
    northing: from.northing + distance * Math.cos(rad)
  };
}
