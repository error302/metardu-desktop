/**
 * Topological Validator — v0.3
 *
 * Pre-flights cadastral boundary geometry before submission to NLIMS / ArdhiSasa.
 * Catches the common rejection reasons:
 *   1. Self-intersecting boundary (line crosses itself)
 *   2. Sliver polygons (tiny area from coordinate snap errors)
 *   3. Adjoiner overlaps (new boundary overlaps existing cadastral fabric)
 *   4. Unclosed rings (first point != last point)
 *   5. Insufficient vertices (need at least 3 for a polygon)
 *   6. Area below statutory minimum (configurable per land use)
 *
 * Uses turf.js for geometry operations — runs entirely client-side, no API call.
 * This is the "ArdhiSasa pre-flight" — if it fails here, it would fail at the registry.
 */

import * as turf from '@turf/turf'
import type { Feature, Polygon } from 'geojson'

// ─── Types ──────────────────────────────────────────────────────────────────

export type ValidationSeverity = 'error' | 'warning'

export interface ValidationIssue {
  id: string
  severity: ValidationSeverity
  rule: string
  message: string
  /** GeoJSON coordinates of the issue location, if applicable */
  location?: [number, number]
  /** Additional context (area, distance, etc.) */
  detail?: string
}

export interface ValidationResult {
  isValid: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  /** Summary stats about the validated geometry */
  stats: {
    areaSqM: number
    perimeterM: number
    vertexCount: number
    isClosed: boolean
  }
}

export interface ValidationOptions {
  /** Minimum parcel area in m² (default: 100 = 0.01 ha, urban plot minimum) */
  minAreaSqM?: number
  /** Maximum sliver area in m² — polygons smaller than this are flagged (default: 5) */
  sliverThresholdSqM?: number
  /** Maximum sliver ratio (area / perimeter²) — thin slivers flagged (default: 0.01) */
  sliverRatioThreshold?: number
  /** Adjoiner polygons to check for overlaps (existing cadastral fabric) */
  adjoiners?: Array<{ id: string; coordinates: [number, number][] }>
  /** Minimum vertices for a valid polygon (default: 4 = triangle + closing point) */
  minVertices?: number
}

// ─── Main validation function ───────────────────────────────────────────────

/**
 * Validate a cadastral boundary polygon.
 *
 * @param coordinates Array of [easting, northing] vertices (UTM coordinates)
 * @param options Validation options
 * @returns ValidationResult with errors (blocking) and warnings (non-blocking)
 */
export function validateCadastralBoundary(
  coordinates: [number, number][],
  options: ValidationOptions = {},
): ValidationResult {
  const {
    minAreaSqM = 100,
    sliverThresholdSqM = 5,
    sliverRatioThreshold = 0.01,
    adjoiners = [],
    minVertices = 4,
  } = options

  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  // ─── Check 1: Sufficient vertices ──────────────────────────────────────
  if (coordinates.length < minVertices) {
    errors.push({
      id: 'insufficient-vertices',
      severity: 'error',
      rule: 'MIN_VERTICES',
      message: `Boundary has ${coordinates.length} vertices — minimum ${minVertices} required (3 distinct points + closing point).`,
      detail: `A valid polygon needs at least 3 distinct corners. Add more boundary points.`,
    })
    return {
      isValid: false,
      errors,
      warnings,
      stats: { areaSqM: 0, perimeterM: 0, vertexCount: coordinates.length, isClosed: false },
    }
  }

  // ─── Check 2: Ring is closed (first point == last point) ───────────────
  const first = coordinates[0]
  const last = coordinates[coordinates.length - 1]
  const isClosed = first[0] === last[0] && first[1] === last[1]

  let workingCoords = coordinates
  if (!isClosed) {
    // Auto-close for turf (turf requires closed rings)
    workingCoords = [...coordinates, first]
    warnings.push({
      id: 'unclosed-ring',
      severity: 'warning',
      rule: 'RING_NOT_CLOSED',
      message: 'Boundary ring was not explicitly closed (first point ≠ last point). Auto-closed for validation.',
      detail: 'NLIMS requires closed rings. The export will close this automatically, but verify the last vertex is correct.',
    })
  }

  // ─── Build turf polygon ─────────────────────────────────────────────────
  let polygon: Feature<Polygon>
  try {
    polygon = turf.polygon([workingCoords]) as Feature<Polygon>
  } catch {
    errors.push({
      id: 'invalid-geometry',
      severity: 'error',
      rule: 'INVALID_GEOMETRY',
      message: 'Boundary coordinates do not form a valid polygon.',
      detail: 'Check for duplicate consecutive points or NaN values in coordinates.',
    })
    return {
      isValid: false,
      errors,
      warnings,
      stats: { areaSqM: 0, perimeterM: 0, vertexCount: coordinates.length, isClosed },
    }
  }

  // ─── Check 3: Self-intersection (kinks) ─────────────────────────────────
  const kinks = turf.kinks(polygon)
  if (kinks.features.length > 0) {
    const firstKink = kinks.features[0].geometry.coordinates as [number, number]
    errors.push({
      id: 'self-intersection',
      severity: 'error',
      rule: 'SELF_INTERSECT',
      message: `Boundary self-intersects at ${kinks.features.length} location${kinks.features.length > 1 ? 's' : ''}.`,
      location: firstKink,
      detail: `Self-intersecting boundaries are invalid and will be rejected by NLIMS. The boundary line crosses itself at [${firstKink[0].toFixed(3)}, ${firstKink[1].toFixed(3)}]. Fix the bearing/distance of the offending leg.`,
    })
  }

  // ─── Compute area and perimeter ─────────────────────────────────────────
  const areaSqM = turf.area(polygon)
  const perimeterM = turf.length(turf.lineString(workingCoords), { units: 'meters' })

  // ─── Check 4: Minimum statutory area ────────────────────────────────────
  if (areaSqM < minAreaSqM) {
    errors.push({
      id: 'area-too-small',
      severity: 'error',
      rule: 'MIN_AREA',
      message: `Parcel area is ${areaSqM.toFixed(2)} m² — below the ${minAreaSqM} m² minimum.`,
      detail: `Minimum plot size varies by zone: 100m² (urban), 250m² (residential), 500m² (agricultural). Check the local zoning by-laws for this parcel.`,
    })
  }

  // ─── Check 5: Sliver polygon detection ──────────────────────────────────
  // Sliver = very thin polygon (small area relative to perimeter)
  // Ratio: area / perimeter² — for a square this is 1/16 = 0.0625
  // Slivers have ratio < 0.01 (very thin)
  const sliverRatio = perimeterM > 0 ? areaSqM / (perimeterM * perimeterM) : 0

  if (areaSqM < sliverThresholdSqM) {
    errors.push({
      id: 'sliver-area',
      severity: 'error',
      rule: 'SLIVER_POLYGON',
      message: `Parcel area is only ${areaSqM.toFixed(4)} m² — this is a sliver polygon.`,
      detail: `Slivers below ${sliverThresholdSqM} m² are typically coordinate errors (snap to wrong point, bearing typo). NLIMS will reject this.`,
    })
  } else if (sliverRatio < sliverRatioThreshold && areaSqM < 1000) {
    warnings.push({
      id: 'sliver-shape',
      severity: 'warning',
      rule: 'SLIVER_SHAPE',
      message: `Parcel is unusually thin (area-to-perimeter ratio: ${sliverRatio.toFixed(4)}).`,
      detail: `This may be intentional (road reserve, access strip) but verify the boundary is correct. Ratio < ${sliverRatioThreshold} suggests a very narrow shape.`,
    })
  }

  // ─── Check 6: Duplicate consecutive vertices ────────────────────────────
  for (let i = 1; i < coordinates.length; i++) {
    const prev = coordinates[i - 1]
    const curr = coordinates[i]
    if (prev[0] === curr[0] && prev[1] === curr[1]) {
      warnings.push({
        id: `duplicate-vertex-${i}`,
        severity: 'warning',
        rule: 'DUPLICATE_VERTEX',
        message: `Duplicate consecutive vertex at position ${i}: [${curr[0].toFixed(3)}, ${curr[1].toFixed(3)}].`,
        location: curr,
        detail: 'Duplicate points create zero-length legs. Remove the duplicate before submission.',
      })
    }
  }

  // ─── Check 7: Adjoiner overlap detection ────────────────────────────────
  for (const adjoiner of adjoiners) {
    try {
      const adjoinerCoords = adjoiner.coordinates
      const adjoinerFirst = adjoinerCoords[0]
      const adjoinerLast = adjoinerCoords[adjoinerCoords.length - 1]
      const adjoinerClosed =
        adjoinerFirst[0] === adjoinerLast[0] && adjoinerFirst[1] === adjoinerLast[1]
          ? adjoinerCoords
          : [...adjoinerCoords, adjoinerFirst]

      const adjoinerPolygon = turf.polygon([adjoinerClosed])
      const overlap = turf.intersect(turf.featureCollection([polygon, adjoinerPolygon]))

      if (overlap) {
        const overlapArea = turf.area(overlap)
        if (overlapArea > 0.01) {
          errors.push({
            id: `adjoiner-overlap-${adjoiner.id}`,
            severity: 'error',
            rule: 'ADJOINER_OVERLAP',
            message: `Boundary overlaps adjoiner "${adjoiner.id}" by ${overlapArea.toFixed(2)} m².`,
            detail: `Overlapping boundaries create title disputes. Adjust the shared boundary line so the overlap is zero. NLIMS will reject overlapping parcels.`,
          })
        }
      }
    } catch {
      // If adjoiner geometry is invalid, skip it (don't block validation)
    }
  }

  // ─── Check 8: Winding order (clockwise vs counter-clockwise) ────────────
  // NLIMS / GeoJSON spec requires counter-clockwise exterior rings
  const winding = computeWindingOrder(workingCoords)
  if (winding === 'clockwise') {
    warnings.push({
      id: 'winding-order',
      severity: 'warning',
      rule: 'WINDING_ORDER',
      message: 'Boundary ring is clockwise — GeoJSON spec requires counter-clockwise for exterior rings.',
      detail: 'The export will flip the winding order automatically, but some older GIS tools may display this incorrectly.',
    })
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    stats: {
      areaSqM,
      perimeterM,
      vertexCount: coordinates.length,
      isClosed,
    },
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute winding order of a polygon ring.
 * Uses the signed area method (shoelace formula).
 * Positive = counter-clockwise, negative = clockwise.
 */
function computeWindingOrder(coords: [number, number][]): 'clockwise' | 'counter-clockwise' {
  let sum = 0
  for (let i = 0; i < coords.length - 1; i++) {
    const [x1, y1] = coords[i]
    const [x2, y2] = coords[i + 1]
    sum += (x2 - x1) * (y2 + y1)
  }
  // In standard math coordinates (Y up), positive sum = clockwise
  // In surveying coordinates (Northing up), this is the same
  return sum > 0 ? 'clockwise' : 'counter-clockwise'
}

/**
 * Quick check: is a coordinate array a valid closed polygon with no self-intersections?
 * Lightweight version of validateCadastralBoundary for real-time UI feedback.
 */
export function isBoundaryValidQuick(coordinates: [number, number][]): boolean {
  if (coordinates.length < 4) return false
  try {
    const first = coordinates[0]
    const last = coordinates[coordinates.length - 1]
    const closed = first[0] === last[0] && first[1] === last[1] ? coordinates : [...coordinates, first]
    const polygon = turf.polygon([closed])
    const kinks = turf.kinks(polygon)
    return kinks.features.length === 0
  } catch {
    return false
  }
}
