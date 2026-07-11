/**
 * Calculation standard: N.N. Basak — Surveying and Levelling
 * - No intermediate rounding
 * - Full floating point precision throughout
 * - Round only at final display layer
 * - Bearings: WCB 0-360° clockwise from North
 */

// METARDU Engine - Geometry utilities

import { Point2D, SurveyResult } from './types';
import { toRadians, toDegrees, normalizeBearing } from './angles';
import { distanceBearing } from './distance';

export interface AngularMisclosureResult {
  sumObservedAngles: number;
  theoreticalSum: number;
  misclosure: number;
  correctionPerStation: number;
  correctedAngles: number[];
}

export interface LineIntersectionResult {
  point: Point2D;
  tA: number;
  tB: number;
  withinSegmentA: boolean;
  withinSegmentB: boolean;
}

export function midpoint(a: Point2D, b: Point2D): Point2D {
  return {
    easting: (a.easting + b.easting) / 2,
    northing: (a.northing + b.northing) / 2,
  };
}

// Source: Basak, Chapter 10 — Angular misclosure for n-sided polygon: (n-2)×180°
// Source: Ghilani & Wolf, Chapter 10 — Correction per angle = -misclosure/n
export function angularMisclosureFromAngles(observedAngles: number[]): SurveyResult<AngularMisclosureResult> {
  const n = observedAngles.length;
  if (n < 3) return { ok: false, error: 'Need at least 3 angles.' };
  const sumObserved = observedAngles.reduce((s, a) => s + a, 0);
  const theoretical = (n - 2) * 180;
  const misclosure = sumObserved - theoretical;
  const corrPerStation = misclosure / n;
  return {
    ok: true,
    value: {
      sumObservedAngles: sumObserved,
      theoreticalSum: theoretical,
      misclosure,
      correctionPerStation: corrPerStation,
      correctedAngles: observedAngles.map((a: any) => a - corrPerStation),
    }
  };
}

// Source: Basak/Ghilani & Wolf — Point-in-polygon by ray casting (Jordan curve theorem)
export function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  const { easting: px, northing: py } = point;
  const n = polygon.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].easting, yi = polygon[i].northing;
    const xj = polygon[j].easting, yj = polygon[j].northing;
    const intersects = yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// Source: Basak — Line intersection by simultaneous equations (determinant method)
export function lineIntersection(
  a1: Point2D, a2: Point2D,
  b1: Point2D, b2: Point2D
): SurveyResult<LineIntersectionResult> {
  const dAe = a2.easting - a1.easting;
  const dAn = a2.northing - a1.northing;
  const dBe = b2.easting - b1.easting;
  const dBn = b2.northing - b1.northing;
  const denom = dAe * dBn - dAn * dBe;
  if (Math.abs(denom) < 1e-10) return { ok: false, error: 'Lines are parallel.' };
  const dx = b1.easting - a1.easting;
  const dy = b1.northing - a1.northing;
  const tA = (dx * dBn - dy * dBe) / denom;
  const tB = (dx * dAn - dy * dAe) / denom;
  return {
    ok: true,
    value: {
      point: { easting: a1.easting + tA * dAe, northing: a1.northing + tA * dAn },
      tA, tB,
      withinSegmentA: tA >= 0 && tA <= 1,
      withinSegmentB: tB >= 0 && tB <= 1,
    }
  };
}

export function circularBuffer(centre: Point2D, radius: number, segments = 64): SurveyResult<Point2D[]> {
  if (radius <= 0) return { ok: false, error: 'Radius must be positive.' };
  const points: Point2D[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (2 * Math.PI * i) / segments;
    points.push({
      easting: centre.easting + radius * Math.sin(angle),
      northing: centre.northing + radius * Math.cos(angle),
    });
  }
  return { ok: true, value: points };
}
