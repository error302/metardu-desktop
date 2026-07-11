/**
 * Traverse to Least Squares Adjustment Bridge
 *
 * Converts observations from the unified total station import pipeline
 * (UnifiedObservation) into the format required by adjustNetwork()
 * for least squares network adjustment.
 *
 * Also provides functions to convert traverse data from the COGO/traverse
 * module into LSQ observations.
 */

import { adjustNetwork, LSAdjustmentInput, Observation } from '../engine/leastSquares'

// ─── Import types from unified total station system ─────────────────────────

export interface TraverseStation {
  name: string
  easting?: number
  northing?: number
  rl?: number
  isFixed?: boolean
}

export interface TraverseObservation {
  from: string
  to: string
  distance?: number
  bearing?: number
  angle?: number
  slopeDistance?: number
  zenithAngle?: number
  heightDiff?: number
  distanceSigma?: number
  bearingSigmaArcSec?: number
  angleSigmaArcSec?: number
  occupied?: string
  backsight?: string
  foresight?: string
  slopeDistanceSigma?: number
  zenithAngleSigmaArcSec?: number
  heightDiffSigma?: number
}

export interface TraverseToLSQResult {
  input: LSAdjustmentInput
  result: ReturnType<typeof adjustNetwork>
}

/**
 * Convert traverse station/observation data into LSAdjustmentInput
 * and run adjustNetwork().
 *
 * @param stations - Traverse stations with coordinates and fixed/free status
 * @param observations - Traverse observations (distances, bearings, angles)
 * @param dimension - '2D' (default) or '3D'
 * @param options - Optional adjustment parameters
 */
export function traverseToLSQ(
  stations: TraverseStation[],
  observations: TraverseObservation[],
  dimension: '2D' | '3D' = '2D',
  options?: {
    maxIterations?: number
    convergenceMm?: number
    standardizedResidualLimit?: number
    globalTestAlpha?: number
  }
): TraverseToLSQResult {
  // Separate fixed and adjustable points
  const fixedPoints = stations
    .filter(function(s) { return s.isFixed && s.easting !== undefined && s.northing !== undefined })
    .map(function(s) {
      let pt: any = {
        name: s.name,
        easting: s.easting,
        northing: s.northing,
      }
      if (dimension === '3D' && s.rl !== undefined) pt.rl = s.rl
      return pt
    })

  const adjustablePoints = stations
    .filter(function(s) {
      return !s.isFixed && s.easting !== undefined && s.northing !== undefined
    })
    .map(function(s) {
      let pt: any = {
        name: s.name,
        easting: s.easting,
        northing: s.northing,
      }
      if (dimension === '3D' && s.rl !== undefined) pt.rl = s.rl
      return pt
    })

  // Convert traverse observations to LSQ Observation format
  const lsqObservations: Observation[] = observations.map(function(obs) {
    let lsqObs: any = {
      from: obs.from,
      to: obs.to,
    }

    // Assign observation type
    if (obs.angle !== undefined && obs.occupied && obs.backsight && obs.foresight) {
      lsqObs.type = 'angle'
      lsqObs.occupied = obs.occupied
      lsqObs.backsight = obs.backsight
      lsqObs.foresight = obs.foresight
      lsqObs.angle = obs.angle
      if (obs.angleSigmaArcSec !== undefined) lsqObs.angleSigmaArcSec = obs.angleSigmaArcSec
    } else if (obs.slopeDistance !== undefined) {
      lsqObs.type = 'slope_distance'
      lsqObs.slopeDistance = obs.slopeDistance
      if (obs.slopeDistanceSigma !== undefined) lsqObs.slopeDistanceSigma = obs.slopeDistanceSigma
    } else if (obs.zenithAngle !== undefined) {
      lsqObs.type = 'zenith_angle'
      lsqObs.zenithAngle = obs.zenithAngle
      if (obs.zenithAngleSigmaArcSec !== undefined) lsqObs.zenithAngleSigmaArcSec = obs.zenithAngleSigmaArcSec
    } else if (obs.heightDiff !== undefined) {
      lsqObs.type = 'height_difference'
      lsqObs.heightDifference = obs.heightDiff
      if (obs.heightDiffSigma !== undefined) lsqObs.heightDiffSigma = obs.heightDiffSigma
    } else {
      // Legacy: distance and/or bearing
      if (obs.distance !== undefined) {
        lsqObs.distance = obs.distance
        if (obs.distanceSigma !== undefined) lsqObs.distanceSigma = obs.distanceSigma
      }
      if (obs.bearing !== undefined) {
        lsqObs.bearing = obs.bearing
        if (obs.bearingSigmaArcSec !== undefined) lsqObs.bearingSigmaArcSec = obs.bearingSigmaArcSec
      }
    }

    return lsqObs
  })

  const input: LSAdjustmentInput = {
    fixedPoints,
    adjustablePoints,
    observations: lsqObservations,
    dimension,
    maxIterations: options?.maxIterations,
    convergenceMm: options?.convergenceMm,
    standardizedResidualLimit: options?.standardizedResidualLimit,
    globalTestAlpha: options?.globalTestAlpha,
  }

  const result = adjustNetwork(input)

  return { input, result }
}

/**
 * Convert a list of traverse observations (from GSI/SDR/South import)
 * into LSQ observations for network adjustment.
 *
 * This is a convenience function that takes the raw observation format
 * from the unified import pipeline and converts it.
 */
export function observationsToLSQ(
  observations: Array<{
    from: string
    to: string
    horizontalDistance?: number
    bearing?: number
    horizontalAngle?: number
    slopeDistance?: number
    zenithAngle?: number
    heightDiff?: number
    distanceSigma?: number
    bearingSigma?: number
    angleSigma?: number
    occupiedStation?: string
    backsightStation?: string
    foresightStation?: string
  }>
): Observation[] {
  return observations.map(function(obs) {
    let lsqObs: any = {
      from: obs.from,
      to: obs.to,
    }

    if (obs.horizontalAngle !== undefined && obs.occupiedStation && obs.backsightStation && obs.foresightStation) {
      lsqObs.type = 'angle'
      lsqObs.occupied = obs.occupiedStation
      lsqObs.backsight = obs.backsightStation
      lsqObs.foresight = obs.foresightStation
      lsqObs.angle = obs.horizontalAngle
      if (obs.angleSigma !== undefined) lsqObs.angleSigmaArcSec = obs.angleSigma
    } else if (obs.slopeDistance !== undefined) {
      lsqObs.type = 'slope_distance'
      lsqObs.slopeDistance = obs.slopeDistance
      if (obs.distanceSigma !== undefined) lsqObs.slopeDistanceSigma = obs.distanceSigma
    } else if (obs.zenithAngle !== undefined) {
      lsqObs.type = 'zenith_angle'
      lsqObs.zenithAngle = obs.zenithAngle
      if (obs.angleSigma !== undefined) lsqObs.zenithAngleSigmaArcSec = obs.angleSigma
    } else if (obs.heightDiff !== undefined) {
      lsqObs.type = 'height_difference'
      lsqObs.heightDifference = obs.heightDiff
      if (obs.distanceSigma !== undefined) lsqObs.heightDiffSigma = obs.distanceSigma
    }

    if (obs.horizontalDistance !== undefined) {
      lsqObs.distance = obs.horizontalDistance
      if (obs.distanceSigma !== undefined) lsqObs.distanceSigma = obs.distanceSigma
    }
    if (obs.bearing !== undefined) {
      lsqObs.bearing = obs.bearing
      if (obs.bearingSigma !== undefined) lsqObs.bearingSigmaArcSec = obs.bearingSigma
    }

    return lsqObs
  })
}
