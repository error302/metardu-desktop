/**
 * Generative Lot Subdivision Engine — v0.3
 *
 * Algorithmically subdivides a parent parcel into standard rectangular plots
 * with a road reserve spine. NOT Voronoi — produces regular plots that fit
 * Kenya's standard templates (50×100, 100×100, etc.).
 *
 * Algorithm:
 * 1. Compute the parent polygon's longest axis (or use user-specified road direction)
 * 2. Place the road spine along that axis, offset from one edge by road width
 * 3. Buffer the spine by road width → road reserve polygon
 * 4. Subtract road reserve from parent → developable area (two strips, one each side)
 * 5. Slice each strip into rows (depth = plot depth)
 * 6. Within each row, slice into plots (width = plot frontage)
 * 7. Output: child plot polygons + beacon coordinates + yield report
 *
 * Uses turf.js for area/buffer/intersect. The grid slicing is custom geometry.
 */

import * as turf from '@turf/turf'
import type { Feature, Polygon } from 'geojson'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SubdivisionInput {
  /** Parent parcel boundary as [easting, northing] UTM coordinates */
  parentBoundary: [number, number][]
  /** Target plot width (frontage) in metres — e.g., 15.24 for 50ft */
  plotWidth: number
  /** Target plot depth in metres — e.g., 30.48 for 100ft */
  plotDepth: number
  /** Road reserve width in metres (9m or 12m typical) */
  roadWidth: number
  /** Road placement: 'center' (spine through middle) or 'edge' (along one side) */
  roadPlacement?: 'center' | 'edge'
  /** Rotation of the grid in degrees (0 = auto-detect longest axis). If non-zero, forces this angle. */
  gridRotation?: number
}

export interface SubdividedPlot {
  id: string
  /** Plot label, e.g., "A1", "A2", "B1" */
  label: string
  /** Boundary coordinates [easting, northing][] (closed ring) */
  coordinates: [number, number][]
  /** Area in square metres */
  areaSqM: number
  /** Row letter (A, B, C...) */
  row: string
  /** Plot number within row (1, 2, 3...) */
  plotNumber: number
}

export interface BeaconCoordinate {
  id: string
  easting: number
  northing: number
  /** Which plots share this beacon */
  sharedBy: string[]
}

export interface SubdivisionResult {
  plots: SubdividedPlot[]
  roadReserve: {
    coordinates: [number, number][]
    areaSqM: number
  }
  beacons: BeaconCoordinate[]
  stats: {
    totalPlots: number
    totalPlotAreaSqM: number
    totalRoadAreaSqM: number
    parentAreaSqM: number
    efficiency: number // (plot area / parent area) × 100
    rowsCreated: number
  }
  warnings: string[]
}

// ─── Kenya standard plot presets ────────────────────────────────────────────

export const KENYA_PLOT_PRESETS = [
  { label: '50×100 ft (0.045 ha)', width: 15.24, depth: 30.48 },
  { label: '100×100 ft (0.092 ha)', width: 30.48, depth: 30.48 },
  { label: '50×50 ft (urban)', width: 15.24, depth: 15.24 },
  { label: '40×80 ft (0.030 ha)', width: 12.19, depth: 24.38 },
  { label: 'Custom', width: 0, depth: 0 },
] as const

export const KENYA_ROAD_PRESETS = [
  { label: '9m (residential access)', width: 9 },
  { label: '12m (commercial access)', width: 12 },
  { label: '15m (collector road)', width: 15 },
  { label: '20m (minor arterial)', width: 20 },
] as const

// ─── Main subdivision function ──────────────────────────────────────────────

export function generateSubdivision(input: SubdivisionInput): SubdivisionResult {
  const {
    parentBoundary,
    plotWidth,
    plotDepth,
    roadWidth,
    roadPlacement = 'center',
    gridRotation = 0,
  } = input

  const warnings: string[] = []

  // ─── 1. Build parent polygon ─────────────────────────────────────────────
  const closedBoundary = ensureClosedRing(parentBoundary)
  const parentPolygon = turf.polygon([closedBoundary]) as Feature<Polygon>
  const parentArea = turf.area(parentPolygon)

  // ─── 2. Determine grid rotation ──────────────────────────────────────────
  const rotation = gridRotation !== 0 ? gridRotation : detectLongestAxis(closedBoundary)

  // ─── 3. Compute parent bounding box (rotated) ────────────────────────────
  const bbox = computeRotatedBBox(closedBoundary, rotation)
  const totalWidth = bbox.maxAlong - bbox.minAlong // along road direction
  const totalDepth = bbox.maxPerp - bbox.minPerp   // perpendicular to road

  // ─── 4. Place road spine ─────────────────────────────────────────────────
  let roadStartAlong: number
  let strip1Depth: number // depth of strip on one side of road
  let strip2Depth: number // depth of strip on other side

  if (roadPlacement === 'center') {
    // Road through the middle — split remaining depth in half
    const availableDepth = totalDepth - roadWidth
    if (availableDepth <= 0) {
      return emptyResult(parentArea, ['Road width exceeds parcel depth — cannot place road.'])
    }
    strip1Depth = availableDepth / 2
    strip2Depth = availableDepth / 2
    roadStartAlong = bbox.minPerp + strip1Depth
  } else {
    // Road along one edge — all remaining depth on one side
    const availableDepth = totalDepth - roadWidth
    if (availableDepth <= 0) {
      return emptyResult(parentArea, ['Road width exceeds parcel depth — cannot place road.'])
    }
    strip1Depth = availableDepth
    strip2Depth = 0
    roadStartAlong = bbox.minPerp
  }

  // ─── 5. Generate grid for each strip ─────────────────────────────────────
  const plots: SubdividedPlot[] = []
  let currentLabelRow = 'A'

  // Strip 1 (before road)
  if (strip1Depth >= plotDepth) {
    const stripPlots = generateStripPlots({
      minAlong: bbox.minAlong,
      maxAlong: bbox.maxAlong,
      minPerp: bbox.minPerp,
      maxPerp: bbox.minPerp + strip1Depth,
      plotWidth,
      plotDepth,
      rotation,
      origin: bbox.origin,
      rowLabel: currentLabelRow,
    })
    plots.push(...stripPlots)
    currentLabelRow = String.fromCharCode(currentLabelRow.charCodeAt(0) + 1)
  } else if (strip1Depth > 0) {
    warnings.push(`Strip 1 depth (${strip1Depth.toFixed(1)}m) is less than plot depth (${plotDepth}m) — skipped.`)
  }

  // Strip 2 (after road)
  if (strip2Depth >= plotDepth) {
    const stripPlots = generateStripPlots({
      minAlong: bbox.minAlong,
      maxAlong: bbox.maxAlong,
      minPerp: roadStartAlong + roadWidth,
      maxPerp: bbox.maxPerp,
      plotWidth,
      plotDepth,
      rotation,
      origin: bbox.origin,
      rowLabel: currentLabelRow,
    })
    plots.push(...stripPlots)
  } else if (strip2Depth > 0) {
    warnings.push(`Strip 2 depth (${strip2Depth.toFixed(1)}m) is less than plot depth (${plotDepth}m) — skipped.`)
  }

  // ─── 6. Clip plots to parent polygon ─────────────────────────────────────
  const clippedPlots: SubdividedPlot[] = []
  for (const plot of plots) {
    try {
      const plotPolygon = turf.polygon([plot.coordinates]) as Feature<Polygon>
      const intersection = turf.intersect(turf.featureCollection([plotPolygon, parentPolygon]))
      if (intersection && intersection.geometry.type === 'Polygon') {
        const clippedCoords = (intersection.geometry as Polygon).coordinates[0] as [number, number][]
        const clippedArea = turf.area(intersection)
        if (clippedArea > 1) { // skip tiny slivers from clipping
          clippedPlots.push({
            ...plot,
            coordinates: clippedCoords,
            areaSqM: clippedArea,
          })
        }
      }
    } catch {
      // If intersection fails (geometry error), skip this plot
    }
  }

  // ─── 7. Compute road reserve polygon ─────────────────────────────────────
  const roadCoords = generateRoadPolygon(
    bbox.minAlong,
    bbox.maxAlong,
    roadStartAlong,
    roadStartAlong + roadWidth,
    rotation,
    bbox.origin,
  )
  let roadArea = 0
  try {
    const roadPolygon = turf.polygon([roadCoords]) as Feature<Polygon>
    const roadIntersection = turf.intersect(turf.featureCollection([roadPolygon, parentPolygon]))
    if (roadIntersection) {
      roadArea = turf.area(roadIntersection)
    }
  } catch {
    // ignore
  }

  // ─── 8. Extract unique beacons ───────────────────────────────────────────
  const beacons = extractBeacons(clippedPlots)

  // ─── 9. Compute stats ────────────────────────────────────────────────────
  const totalPlotArea = clippedPlots.reduce((sum, p) => sum + p.areaSqM, 0)

  return {
    plots: clippedPlots,
    roadReserve: {
      coordinates: roadCoords,
      areaSqM: roadArea,
    },
    beacons,
    stats: {
      totalPlots: clippedPlots.length,
      totalPlotAreaSqM: totalPlotArea,
      totalRoadAreaSqM: roadArea,
      parentAreaSqM: parentArea,
      efficiency: parentArea > 0 ? (totalPlotArea / parentArea) * 100 : 0,
      rowsCreated: new Set(clippedPlots.map(p => p.row)).size,
    },
    warnings,
  }
}

// ─── Helper functions ───────────────────────────────────────────────────────

function ensureClosedRing(coords: [number, number][]): [number, number][] {
  if (coords.length < 3) return coords
  const first = coords[0]
  const last = coords[coords.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) return coords
  return [...coords, first]
}

function emptyResult(parentArea: number, warnings: string[]): SubdivisionResult {
  return {
    plots: [],
    roadReserve: { coordinates: [], areaSqM: 0 },
    beacons: [],
    stats: {
      totalPlots: 0,
      totalPlotAreaSqM: 0,
      totalRoadAreaSqM: 0,
      parentAreaSqM: parentArea,
      efficiency: 0,
      rowsCreated: 0,
    },
    warnings,
  }
}

/**
 * Detect the longest axis of the polygon by finding the two vertices
 * that are farthest apart. Returns the angle in degrees.
 */
function detectLongestAxis(coords: [number, number][]): number {
  let maxDist = 0
  let bestAngle = 0

  for (let i = 0; i < coords.length - 1; i++) {
    for (let j = i + 1; j < coords.length; j++) {
      const [x1, y1] = coords[i]
      const [x2, y2] = coords[j]
      const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
      if (dist > maxDist) {
        maxDist = dist
        bestAngle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI)
      }
    }
  }

  return bestAngle
}

interface RotatedBBox {
  origin: [number, number]
  minAlong: number
  maxAlong: number
  minPerp: number
  maxPerp: number
}

/**
 * Compute bounding box in rotated coordinate system.
 * 'along' = direction of the road, 'perp' = perpendicular to road.
 */
function computeRotatedBBox(coords: [number, number][], rotationDeg: number): RotatedBBox {
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const origin = coords[0]

  let minAlong = Infinity, maxAlong = -Infinity
  let minPerp = Infinity, maxPerp = -Infinity

  for (const [x, y] of coords) {
    const dx = x - origin[0]
    const dy = y - origin[1]
    const along = dx * cos + dy * sin
    const perp = -dx * sin + dy * cos
    minAlong = Math.min(minAlong, along)
    maxAlong = Math.max(maxAlong, along)
    minPerp = Math.min(minPerp, perp)
    maxPerp = Math.max(maxPerp, perp)
  }

  return { origin, minAlong, maxAlong, minPerp, maxPerp }
}

/**
 * Convert from rotated (along, perp) coordinates back to UTM (easting, northing).
 */
function rotatedToUTM(
  along: number,
  perp: number,
  rotationDeg: number,
  origin: [number, number],
): [number, number] {
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = along * cos - perp * sin
  const dy = along * sin + perp * cos
  return [origin[0] + dx, origin[1] + dy]
}

/**
 * Generate plots for a single strip (one side of the road).
 * Slices the strip into rows (by depth) and then into plots (by width).
 */
function generateStripPlots(params: {
  minAlong: number
  maxAlong: number
  minPerp: number
  maxPerp: number
  plotWidth: number
  plotDepth: number
  rotation: number
  origin: [number, number]
  rowLabel: string
}): SubdividedPlot[] {
  const { minAlong, maxAlong, minPerp, maxPerp, plotWidth, plotDepth, rotation, origin, rowLabel } = params
  const plots: SubdividedPlot[] = []
  let plotNum = 1

  const stripDepth = maxPerp - minPerp
  const stripWidth = maxAlong - minAlong
  const rowCount = Math.floor(stripDepth / plotDepth)

  for (let row = 0; row < rowCount; row++) {
    const rowMinPerp = minPerp + row * plotDepth
    const rowMaxPerp = rowMinPerp + plotDepth
    const rowLabelChar = String.fromCharCode(rowLabel.charCodeAt(0) + row)

    const colCount = Math.floor(stripWidth / plotWidth)
    for (let col = 0; col < colCount; col++) {
      const colMinAlong = minAlong + col * plotWidth
      const colMaxAlong = colMinAlong + plotWidth

      // 4 corners in rotated space
      const corners: [number, number][] = [
        rotatedToUTM(colMinAlong, rowMinPerp, rotation, origin),
        rotatedToUTM(colMaxAlong, rowMinPerp, rotation, origin),
        rotatedToUTM(colMaxAlong, rowMaxPerp, rotation, origin),
        rotatedToUTM(colMinAlong, rowMaxPerp, rotation, origin),
        rotatedToUTM(colMinAlong, rowMinPerp, rotation, origin), // close ring
      ]

      plots.push({
        id: `${rowLabelChar}${plotNum}`,
        label: `${rowLabelChar}${plotNum}`,
        coordinates: corners,
        areaSqM: plotWidth * plotDepth,
        row: rowLabelChar,
        plotNumber: plotNum,
      })
      plotNum++
    }
    plotNum = 1 // reset per row
  }

  return plots
}

/**
 * Generate the road reserve polygon.
 */
function generateRoadPolygon(
  minAlong: number,
  maxAlong: number,
  minPerp: number,
  maxPerp: number,
  rotation: number,
  origin: [number, number],
): [number, number][] {
  return [
    rotatedToUTM(minAlong, minPerp, rotation, origin),
    rotatedToUTM(maxAlong, minPerp, rotation, origin),
    rotatedToUTM(maxAlong, maxPerp, rotation, origin),
    rotatedToUTM(minAlong, maxPerp, rotation, origin),
    rotatedToUTM(minAlong, minPerp, rotation, origin), // close
  ]
}

/**
 * Extract unique beacon coordinates from all plot corners.
 * Beacons shared by multiple plots are merged.
 */
function extractBeacons(plots: SubdividedPlot[]): BeaconCoordinate[] {
  const beaconMap = new Map<string, BeaconCoordinate>()
  const tolerance = 0.01 // 1cm tolerance for matching

  for (const plot of plots) {
    for (const coord of plot.coordinates) {
      // Check if this beacon already exists (within tolerance)
      let found = false
      for (const [key, beacon] of beaconMap) {
        const dist = Math.sqrt(
          (coord[0] - beacon.easting) ** 2 + (coord[1] - beacon.northing) ** 2,
        )
        if (dist < tolerance) {
          if (!beacon.sharedBy.includes(plot.label)) {
            beacon.sharedBy.push(plot.label)
          }
          found = true
          break
        }
      }

      if (!found) {
        const id = `B${beaconMap.size + 1}`
        beaconMap.set(id, {
          id,
          easting: coord[0],
          northing: coord[1],
          sharedBy: [plot.label],
        })
      }
    }
  }

  return Array.from(beaconMap.values())
}
