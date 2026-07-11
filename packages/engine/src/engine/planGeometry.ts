import { Point2D, DistanceBearingResult } from './types'
import { distanceBearing } from './distance'
import { toRadians, toDegrees, normalizeBearing } from './angles'
import { coordinateArea } from './area'

export type AdjustedStation = {
  pointName: string
  originalEasting: number
  originalNorthing: number
  adjustedEasting: number
  adjustedNorthing: number
}

export interface PlanEdge {
  from: AdjustedStation
  to: AdjustedStation
  bearing: number
  bearingDMS: string
  distance: number
  distanceFormatted: string
}

export interface PlanGeometry {
  stations: AdjustedStation[]
  edges: PlanEdge[]
  areaHa: number
  perimeterM: number
  centroid: { easting: number; northing: number }
  extent: {
    minEasting: number
    maxEasting: number
    minNorthing: number
    maxNorthing: number
    width: number
    height: number
  }
  scale: number
}

function formatBearingDMS(bearing: number): string {
  const d = Math.floor(bearing)
  const minFloat = (bearing - d) * 60
  const m = Math.floor(minFloat)
  const s = (minFloat - m) * 60
  return `${String(d).padStart(3, '0')}°${String(m).padStart(2, '0')}'${String(Math.round(s)).padStart(2, '0')}"`
}

function formatDistanceM(distance: number): string {
  return distance.toFixed(3)
}

export function computePlanGeometry(stations: AdjustedStation[]): PlanGeometry | null {
  if (stations.length < 3) return null

  const points: Point2D[] = stations.map(s => ({
    easting: s.adjustedEasting,
    northing: s.adjustedNorthing
  }))

  const areaResult = coordinateArea(points)
  const areaHa = areaResult.areaHa

  let perimeter = 0
  for (let i = 0; i < stations.length; i++) {
    const from = stations[i]
    const to = stations[(i + 1) % stations.length]
    const result = distanceBearing(
      { easting: from.adjustedEasting, northing: from.adjustedNorthing },
      { easting: to.adjustedEasting, northing: to.adjustedNorthing }
    )
    perimeter += result.distance
  }

  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity
  let sumE = 0, sumN = 0
  stations.forEach(s => {
    minE = Math.min(minE, s.adjustedEasting)
    maxE = Math.max(maxE, s.adjustedEasting)
    minN = Math.min(minN, s.adjustedNorthing)
    maxN = Math.max(maxN, s.adjustedNorthing)
    sumE += s.adjustedEasting
    sumN += s.adjustedNorthing
  })
  const centroid = { easting: sumE / stations.length, northing: sumN / stations.length }

  const edges: PlanEdge[] = []
  for (let i = 0; i < stations.length; i++) {
    const from = stations[i]
    const to = stations[(i + 1) % stations.length]
    const result = distanceBearing(
      { easting: from.adjustedEasting, northing: from.adjustedNorthing },
      { easting: to.adjustedEasting, northing: to.adjustedNorthing }
    )
    edges.push({
      from,
      to,
      bearing: result.bearing,
      bearingDMS: result.bearingDMS,
      distance: result.distance,
      distanceFormatted: formatDistanceM(result.distance)
    })
  }

  const STANDARD_SCALES = [500, 1000, 2500, 5000, 10000, 25000]
  const marginFactor = 0.75
  const sheetWidthM = 0.42 * marginFactor
  const sheetHeightM = 0.297 * marginFactor
  let scale = 25000
  for (const s of STANDARD_SCALES) {
    const w = (maxE - minE) / s
    const h = (maxN - minN) / s
    if (w <= sheetWidthM && h <= sheetHeightM) {
      scale = s
      break
    }
  }

  return {
    stations,
    edges,
    areaHa,
    perimeterM: perimeter,
    centroid,
    extent: {
      minEasting: minE,
      maxEasting: maxE,
      minNorthing: minN,
      maxNorthing: maxN,
      width: maxE - minE,
      height: maxN - minN
    },
    scale
  }
}