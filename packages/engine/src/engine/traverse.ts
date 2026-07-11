/**
 * Calculation standard: N.N. Basak — Surveying and Levelling
 * Source: N.N. Basak, Surveying and Levelling, Chapters 10-11
 * Source: Ghilani & Wolf, Elementary Surveying 16th Ed., Chapters 10, 12
 * Source: Survey Regulations 1994, Cap 299, Regulation 97
 * - No intermediate rounding
 * - Full floating point precision throughout
 * - Round only at final display layer
 * - Bearings: WCB 0-360° clockwise from North
 */

// METARDU Engine - Traverse calculations

import { NamedPoint2D, TraverseResult, TraverseLeg } from './types';
import { toRadians, bearingToString } from './angles';

// Kenya Survey Regulations 1994 - Traverse precision standards
export const TRAVERSE_PRECISION_STANDARDS = {
  cadastral: 5000,      // 1:5000 minimum — Kenya Survey Regulations 1994
  engineering: 3000,    // 1:3000 minimum
  topographic: 1000,   // 1:1000 minimum
  geodetic: 10000,     // 1:10000 minimum
  mining: 5000,
  hydrographic: 1000,
  drone: 1000,
  deformation: 10000,
} as const;

export type SurveyTypeKey = keyof typeof TRAVERSE_PRECISION_STANDARDS;

/**
 * Angular misclosure tolerance in seconds of arc.
 * Kenya Survey Regulations 1994.
 * @param stationCount - Number of angles observed in the traverse
 */
export function angularClosureTolerance(stationCount: number): number {
  return 60 * Math.sqrt(stationCount); // seconds
}

/**
 * Evaluates whether a traverse meets the minimum precision for the given survey type.
 * @param linearMisclosure - Total linear misclosure in metres
 * @param perimeter - Total traverse perimeter in metres
 * @param surveyType - Must match one of the 8 locked survey types
 * @returns precision ratio (e.g. 5000 means 1:5000), and whether it meets the standard
 */
export function evaluateTraverseClosure(
  linearMisclosure: number,
  perimeter: number,
  surveyType: SurveyTypeKey
): { ratio: number; passes: boolean; minimum: number } {
  if (linearMisclosure === 0) {
    return { ratio: Infinity, passes: true, minimum: TRAVERSE_PRECISION_STANDARDS[surveyType] };
  }
  const ratio = perimeter / linearMisclosure;
  const minimum = TRAVERSE_PRECISION_STANDARDS[surveyType];
  return { ratio: Math.round(ratio), passes: ratio >= minimum, minimum };
}

export interface TraverseInput {
  points: NamedPoint2D[];
  distances: number[];
  bearings: number[];
  closingPoint?: { easting: number; northing: number };
}

export interface ForwardTraverseInput {
  start: NamedPoint2D;
  stations: string[]; // next stations (length = legs)
  distances: number[];
  bearings: number[]; // WCB degrees (length = legs)
}

export interface ForwardTraverseResult {
  legs: Array<{
    from: string;
    to: string;
    distance: number;
    bearing: number;
    bearingDMS: string;
    deltaE: number;
    deltaN: number;
    easting: number;
    northing: number;
  }>;
  totalDistance: number;
  end: NamedPoint2D;
}

/**
 * Classifies traverse precision based on the precision ratio.
 * ratio = perimeter / linearMisclosure (e.g. 5000 means 1:5000)
 * Source: Kenya Survey Regulations 1994, Regulation 97
 * Source: RDM 1.1 Kenya 2025, Table 2.4
 * FIXED: Previous version incorrectly compared ratio against 1/N (reciprocals),
 * causing ALL traverses to be graded 'excellent'. The ratio is already a large
 * number (e.g. 5000 for 1:5000), not a small fraction.
 */
function calculatePrecisionGrade(ratio: number): 'excellent' | 'good' | 'acceptable' | 'poor' {
  // ratio >= 1:10000 → excellent (geodetic/deformation quality)
  if (ratio >= 10000) return 'excellent';
  // ratio >= 1:5000 → good (cadastral/mining quality)
  if (ratio >= 5000) return 'good';
  // ratio >= 1:3000 → acceptable (engineering quality)
  if (ratio >= 3000) return 'acceptable';
  // ratio >= 1:1000 → poor but usable (topographic)
  if (ratio >= 1000) return 'poor';
  // Below 1:1000 → unacceptable
  return 'poor';
}

/**
 * Forward (unadjusted) traverse coordinate propagation.
 * Derived from standard traverse computation:
 *  ΔN = D·cos(WCB), ΔE = D·sin(WCB)
 */
export function forwardTraverse(input: ForwardTraverseInput): ForwardTraverseResult {
  const { start, stations, distances, bearings } = input
  const legs: ForwardTraverseResult['legs'] = []

  let totalDistance = 0
  let currentE = start.easting
  let currentN = start.northing

  const startName = start.name || 'START'

  for (let i = 0; i < bearings.length; i++) {
    const bearing = bearings[i]
    const distance = distances[i]
    const rad = toRadians(bearing)

    const deltaN = distance * Math.cos(rad)
    const deltaE = distance * Math.sin(rad)

    currentN += deltaN
    currentE += deltaE
    totalDistance += distance

    legs.push({
      from: i === 0 ? startName : stations[i - 1] || `P${i + 1}`,
      to: stations[i] || `P${i + 2}`,
      distance,
      bearing,
      bearingDMS: bearingToString(bearing),
      deltaE,
      deltaN,
      easting: currentE,
      northing: currentN,
    })
  }

  return {
    legs,
    totalDistance,
    end: { name: stations[stations.length - 1] || 'END', easting: currentE, northing: currentN },
  }
}

export function bowditchAdjustment(input: TraverseInput): TraverseResult {
  const { points, distances, bearings, closingPoint } = input;
  
  // Source: Basak, Chapter 11 — Bowditch (Compass) Rule: corrections proportional to leg distance
  // Source: Ghilani & Wolf, Chapter 12 — Bowditch adjustment formula
  let sumLat = 0;
  let sumDep = 0;
  let totalDistance = 0;
  
  const legs: TraverseLeg[] = [];
  
  for (let i = 0; i < bearings.length; i++) {
    const bearing = bearings[i];
    const distance = distances[i];
    const rad = toRadians(bearing);
    
    const deltaN = distance * Math.cos(rad);
    const deltaE = distance * Math.sin(rad);
    
    sumLat += deltaN;
    sumDep += deltaE;
    totalDistance += distance;
    
    // Raw deltas
    const rawDeltaN = deltaN;
    const rawDeltaE = deltaE;
    
    legs.push({
      from: points[i]?.name || (i === 0 ? points[0]?.name || 'P1' : `P${i + 1}`),
      to: points[i + 1]?.name || `P${i + 2}`,
      distance,
      bearing,
      bearingDMS: bearingToString(bearing),
      rawDeltaE: rawDeltaE,
      rawDeltaN,
      correctionE: 0,
      correctionN: 0,
      adjDeltaE: rawDeltaE,
      adjDeltaN: rawDeltaN,
      adjEasting: 0,
      adjNorthing: 0
    });
  }
  
  // Calculate closing error
  const start = points[0]
  const computedEndNorthing = start.northing + sumLat
  const computedEndEasting = start.easting + sumDep

  const closingErrorN = closingPoint
    ? (closingPoint.northing - computedEndNorthing)
    : -sumLat
  const closingErrorE = closingPoint
    ? (closingPoint.easting - computedEndEasting)
    : -sumDep
  const linearError = Math.sqrt(closingErrorN * closingErrorN + closingErrorE * closingErrorE);
  // precisionRatio = perimeter / linearMisclosure (large number, e.g. 5000 means 1:5000)
  const precisionRatio = totalDistance > 0 ? totalDistance / linearError : Infinity;
  
  // Apply Bowditch corrections
  let currentEasting = points[0].easting;
  let currentNorthing = points[0].northing;
  
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const correctionN = (leg.distance / totalDistance) * closingErrorN;
    const correctionE = (leg.distance / totalDistance) * closingErrorE;
    
    leg.correctionN = correctionN;
    leg.correctionE = correctionE;
    
    leg.adjDeltaN = leg.rawDeltaN + correctionN;
    leg.adjDeltaE = leg.rawDeltaE + correctionE;
    
    currentNorthing += leg.adjDeltaN;
    currentEasting += leg.adjDeltaE;
    
    leg.adjNorthing = currentNorthing;
    leg.adjEasting = currentEasting;
  }
  
  return {
    legs,
    closingErrorE,
    closingErrorN,
    linearError,
    precisionRatio,
    precisionGrade: calculatePrecisionGrade(precisionRatio),
    totalDistance,
    isClosed: precisionRatio >= 1000 // 1:1000 or better
  };
}

export function transitAdjustment(input: TraverseInput): TraverseResult {
  const { points, distances, bearings, closingPoint } = input;
  
  // Source: Basak, Chapter 11 — Transit Rule: corrections proportional to |Δ| of each leg
  // Source: Ghilani & Wolf, Chapter 12 — Transit adjustment
  let sumLat = 0;
  let sumDep = 0;
  let absSumLat = 0;
  let absSumDep = 0;
  let totalDistance = 0;
  
  const legs: TraverseLeg[] = [];
  
  for (let i = 0; i < bearings.length; i++) {
    const bearing = bearings[i];
    const distance = distances[i];
    const rad = toRadians(bearing);
    
    const deltaN = distance * Math.cos(rad);
    const deltaE = distance * Math.sin(rad);
    
    sumLat += deltaN;
    sumDep += deltaE;
    absSumLat += Math.abs(deltaN);
    absSumDep += Math.abs(deltaE);
    totalDistance += distance;
    
    legs.push({
      from: points[i]?.name || (i === 0 ? points[0]?.name || 'P1' : `P${i + 1}`),
      to: points[i + 1]?.name || `P${i + 2}`,
      distance,
      bearing,
      bearingDMS: bearingToString(bearing),
      rawDeltaE: deltaE,
      rawDeltaN: deltaN,
      correctionE: 0,
      correctionN: 0,
      adjDeltaE: deltaE,
      adjDeltaN: deltaN,
      adjEasting: 0,
      adjNorthing: 0
    });
  }
  
  // Closing error — support link traverse (closing to a different known point)
  // Source: Basak Ch.11, Ghilani & Wolf Ch.12
  const start = points[0]
  const computedEndNorthing = start.northing + sumLat
  const computedEndEasting = start.easting + sumDep

  const closingErrorN = closingPoint
    ? (closingPoint.northing - computedEndNorthing)
    : -sumLat
  const closingErrorE = closingPoint
    ? (closingPoint.easting - computedEndEasting)
    : -sumDep
  const linearError = Math.sqrt(closingErrorN * closingErrorN + closingErrorE * closingErrorE);
  // precisionRatio = perimeter / linearMisclosure (large number, e.g. 5000 means 1:5000)
  const precisionRatio = totalDistance > 0 ? totalDistance / linearError : Infinity;
  
  // Apply Transit rule corrections
  let currentEasting = points[0].easting;
  let currentNorthing = points[0].northing;
  
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    
    let correctionN = 0;
    let correctionE = 0;
    
    // FIXED: Removed spurious negative sign. Transit rule correction = (|Δ|/Σ|Δ|) × closingError.
    // The closingError already carries the correct sign.
    // Source: Basak Ch.11; Ghilani & Wolf Ch.12.
    if (absSumLat > 0) {
      correctionN = (Math.abs(leg.rawDeltaN) / absSumLat) * closingErrorN;
    }
    if (absSumDep > 0) {
      correctionE = (Math.abs(leg.rawDeltaE) / absSumDep) * closingErrorE;
    }
    
    leg.correctionN = correctionN;
    leg.correctionE = correctionE;
    
    leg.adjDeltaN = leg.rawDeltaN + correctionN;
    leg.adjDeltaE = leg.rawDeltaE + correctionE;
    
    currentNorthing += leg.adjDeltaN;
    currentEasting += leg.adjDeltaE;
    
    leg.adjNorthing = currentNorthing;
    leg.adjEasting = currentEasting;
  }
  
  return {
    legs,
    closingErrorE,
    closingErrorN,
    linearError,
    precisionRatio,
    precisionGrade: calculatePrecisionGrade(precisionRatio),
    totalDistance,
    isClosed: precisionRatio >= 1000 // 1:1000 or better
  };
}
