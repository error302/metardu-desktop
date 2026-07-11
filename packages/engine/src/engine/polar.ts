/**
 * Calculation standard: N.N. Basak — Surveying and Levelling
 * - No intermediate rounding
 * - Full floating point precision throughout
 * - Round only at final display layer
 * - Bearings: WCB 0-360° clockwise from North
 *
 * Polar coordinate computations used in control/mining/hydro field notes.
 * Textbook basis: standard polar/radiation method (Ghilani/Wolf).
 */

import type { NamedPoint3D, Point2D, Point3D } from './types'
import { toRadians } from './angles'

export interface Polar2DInput {
  station: Point2D
  bearing: number // WCB degrees
  horizontalDistance: number
}

export interface Polar3DInput {
  station: Point3D
  bearing: number // WCB degrees
  slopeDistance: number
  verticalAngle: number // degrees from horizontal (+up)
}

export interface Polar3DWithHeightsInput extends Polar3DInput {
  instrumentHeight: number // meters
  targetHeight: number // meters
}

export function polar2D(input: Polar2DInput): Point2D {
  const rad = toRadians(input.bearing)
  const deltaN = input.horizontalDistance * Math.cos(rad)
  const deltaE = input.horizontalDistance * Math.sin(rad)
  return {
    easting: input.station.easting + deltaE,
    northing: input.station.northing + deltaN,
  }
}

export function polar3D(input: Polar3DInput): Point3D {
  const vRad = toRadians(input.verticalAngle)
  const horizontalDistance = input.slopeDistance * Math.cos(vRad)
  const deltaZ = input.slopeDistance * Math.sin(vRad)
  const p2d = polar2D({ station: input.station, bearing: input.bearing, horizontalDistance })
  return { ...p2d, elevation: input.station.elevation + deltaZ }
}

export function polar3DWithHeights(input: Polar3DWithHeightsInput): Point3D {
  const raw = polar3D(input)
  return {
    easting: raw.easting,
    northing: raw.northing,
    elevation: input.station.elevation + input.instrumentHeight + (raw.elevation - input.station.elevation) - input.targetHeight,
  }
}

export function polar3DNamed(
  station: NamedPoint3D,
  targetName: string,
  bearing: number,
  slopeDistance: number,
  verticalAngle: number
): NamedPoint3D {
  const p = polar3D({ station, bearing, slopeDistance, verticalAngle })
  return { name: targetName, easting: p.easting, northing: p.northing, elevation: p.elevation }
}
