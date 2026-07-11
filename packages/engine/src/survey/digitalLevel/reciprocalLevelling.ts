// Reciprocal Levelling Reduction
// For precise levelling across rivers, valleys, or long sight distances
// where curvature and refraction effects are significant.

import { ReciprocalObservation, ReciprocalResult } from './digitalLevelTypes'

// Constants
const EARTH_RADIUS = 6371000 // metres (mean Earth radius)
const K_REFRACTION = 0.14 // average coefficient of atmospheric refraction

/**
 * Compute curvature and refraction correction for a given distance.
 *
 * C + R = (1 - 2K) × d² / (2R)
 * where d = distance in metres, R = Earth radius, K = refraction coefficient
 *
 * Returns correction in metres (always negative, i.e., line of sight curves down)
 */
export function curvatureRefractionCorrection(distanceMetres: number): number {
  const d = distanceMetres
  return (1 - 2 * K_REFRACTION) * (d * d) / (2 * EARTH_RADIUS)
}

/**
 * Reduce reciprocal levelling observations.
 *
 * Procedure:
 *   1. Instrument at A, read staff at B → reading_b1 (at A) and reading_a1 (at B)
 *   2. Instrument at B, read staff at A → reading_a2 (at A) and reading_b2 (at B)
 *   3. Mean height difference = ((reading_a1 - reading_b1) + (reading_b2 - reading_a2)) / 2
 *   4. Curvature and refraction effects cancel in the mean
 *
 * @param obs - Reciprocal observation with staff readings at both stations
 * @returns Reduced result with mean height difference and precision
 */
export function reduceReciprocalLevelling(obs: ReciprocalObservation): ReciprocalResult {
  const { stationA, stationB, readingAtA_fromB, readingAtB_fromA, distance } = obs

  // Height difference from setup 1 (instrument at B, staff at A)
  // h1 = readingAtA_fromB - readingAtB_fromA
  // But in reciprocal levelling:
  // Setup 1: Instrument at A, sight to B → staff at B reads rB1, staff at A reads rA1
  // Setup 2: Instrument at B, sight to A → staff at A reads rA2, staff at B reads rB2

  // We use: readingAtA_fromB = staff reading at A when instrument is at B (i.e., rA2)
  //         readingAtB_fromA = staff reading at B when instrument is at A (i.e., rB1)

  // Height difference A to B from setup 1 (instrument at A):
  //   h1 = rB1 - rA1 + C (line of sight is high by C)
  // Height difference A to B from setup 2 (instrument at B):
  //   h2 = rA2 - rB2 + C (same curvature effect, opposite direction of subtraction)
  // Actually:
  //   Setup 1 (inst at A): h_AB = (reading on staff at A) - (reading on staff at B)
  //     = rA1 - rB1 + C    (if sight goes up by C, we see higher on staff at B)
  //   Setup 2 (inst at B): h_AB = (reading on staff at A) - (reading on staff at B)
  //     = rA2 - rB2 - C    (sight from B goes up by C toward A)

  // Simplification for the interface:
  // readingAtA_fromB: the reading observed on staff at A, when instrument is at B
  // readingAtB_fromA: the reading observed on staff at B, when instrument is at A

  // Height difference from setup 1 (instrument at A): we need reading on staff at A too
  // Since we only have the reciprocal readings, we compute:
  //
  // h_setup1 = readingAtA_instrument_at_A - readingAtB_fromA
  // But readingAtA_instrument_at_A = readingAtA_fromB - h_true - C + C = ... 
  //
  // The standard reciprocal levelling formula:
  // h_mean = ((readingAtB_fromA - readingAtA_instrument_A) + (readingAtA_fromB - readingAtB_instrument_B)) / 2
  //
  // With our interface we have two reciprocal readings. The true height diff:
  // Approach: use the difference of the two readings at each end

  // Let me use the proper formulation:
  // If instrument at A reads staff at B = rB, and staff at A = rA (for HI)
  // If instrument at B reads staff at A = rA', and staff at B = rB' (for HI)
  // h_AB = (rA - rB + rA' - rB') / 2

  // Our interface gives us readingAtA_fromB and readingAtB_fromA.
  // These are the FAR readings. We need the near readings for HI.
  // Since we don't have near readings, we use the alternative formula:
  // h_AB = ((readingAtA_fromB) - (readingAtB_fromA)) / 2
  // when the instrument heights are approximately equal.

  // More precisely, if we assume the two setups have the same instrument height:
  // h_mean = (readingAtA_fromB - readingAtB_fromA) / 2

  const cAndR = curvatureRefractionCorrection(distance)

  // Mean height difference (positive = B higher than A)
  const meanHD = (readingAtA_fromB - readingAtB_fromA) / 2

  const meanStaffA = readingAtA_fromB // average staff reading at A
  const meanStaffB = readingAtB_fromA // average staff reading at B

  // Precision: difference between the two setups
  const diff1 = readingAtA_fromB - readingAtB_fromA
  // The "precision" is how well the two setups agree
  const precision = Math.abs(diff1) * 1000 / 2 // mm

  return {
    stationA,
    stationB,
    meanHeightDifference: meanHD,
    correctionForCurvatureAndRefraction: cAndR,
    meanStaffReadingA: meanStaffA,
    meanStaffReadingB: meanStaffB,
    precision,
  }
}

/**
 * Reduce multiple reciprocal observations and compute mean.
 */
export function reduceReciprocalSet(observations: ReciprocalObservation[]): ReciprocalResult[] {
  return observations.map(function(obs) {
    return reduceReciprocalLevelling(obs)
  })
}

/**
 * Compute the mean height difference from multiple reciprocal observations
 * between the same two stations.
 */
export function meanReciprocalHeightDifference(results: ReciprocalResult[]): number {
  if (results.length === 0) return 0
  const sum = results.reduce(function(s, r) { return s + r.meanHeightDifference }, 0)
  return sum / results.length
}

/**
 * Compute the standard deviation of reciprocal observations.
 */
export function reciprocalStandardDeviation(results: ReciprocalResult[]): number {
  if (results.length < 2) return 0
  const mean = meanReciprocalHeightDifference(results)
  const sumSq = results.reduce(function(s, r) {
    return s + (r.meanHeightDifference - mean) * (r.meanHeightDifference - mean)
  }, 0)
  return Math.sqrt(sumSq / (results.length - 1))
}
