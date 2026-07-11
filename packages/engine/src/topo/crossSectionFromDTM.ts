/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Cross-Section from Topo DTM
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Generates ground profile cross-sections from a TIN surface at specified
 * chainage intervals along a centerline. Used for:
 * - Road corridor surveys (cross-sections every 20m)
 * - Pipeline route surveys
 * - River cross-sections
 *
 * The surveyor defines:
 * 1. A centerline (start point + end point, or series of points)
 * 2. Chainage interval (e.g. 20m)
 * 3. Cross-section width (e.g. 30m left + 30m right)
 *
 * METARDU samples the TIN surface at each cross-section point and
 * generates the profile. No manual level booking needed.
 */

import { type SpotHeight, type TINSurface, buildTINSurface, interpolateElevation } from '@/lib/engine/contours'

export interface CenterlinePoint {
  easting: number
  northing: number
  chainage: number  // meters from start
}

export interface CrossSectionPoint {
  chainage: number        // along centerline
  offset: number          // left (-) or right (+) from centerline
  easting: number
  northing: number
  elevation: number | null  // null = outside TIN
}

export interface CrossSectionProfile {
  chainage: number
  points: CrossSectionPoint[]
  minElevation: number | null
  maxElevation: number | null
}

export interface CrossSectionResult {
  centerline: CenterlinePoint[]
  sections: CrossSectionProfile[]
  interval: number
  halfWidth: number
  pointSpacing: number
}

/**
 * Build a centerline from a series of points with chainage.
 * If chainage is not provided, it's computed from distances.
 */
export function buildCenterline(points: Array<{ easting: number; northing: number }>): CenterlinePoint[] {
  const result: CenterlinePoint[] = []
  let cumChainage = 0

  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const dx = points[i].easting - points[i - 1].easting
      const dy = points[i].northing - points[i - 1].northing
      cumChainage += Math.sqrt(dx * dx + dy * dy)
    }
    result.push({
      easting: points[i].easting,
      northing: points[i].northing,
      chainage: cumChainage,
    })
  }

  return result
}

/**
 * Get a point on the centerline at a specific chainage.
 * Linear interpolation between known centerline points.
 */
export function pointAtChainage(centerline: CenterlinePoint[], chainage: number): { easting: number; northing: number; bearing: number } {
  if (centerline.length === 0) return { easting: 0, northing: 0, bearing: 0 }
  if (centerline.length === 1) return { easting: centerline[0].easting, northing: centerline[0].northing, bearing: 0 }

  // Find the segment containing this chainage
  for (let i = 0; i < centerline.length - 1; i++) {
    const a = centerline[i]
    const b = centerline[i + 1]

    if (chainage >= a.chainage && chainage <= b.chainage) {
      const t = (chainage - a.chainage) / (b.chainage - a.chainage || 1)
      const easting = a.easting + t * (b.easting - a.easting)
      const northing = a.northing + t * (b.northing - a.northing)
      const bearing = Math.atan2(b.easting - a.easting, b.northing - a.northing)
      return { easting, northing, bearing }
    }
  }

  // Beyond the end — extrapolate
  const last = centerline[centerline.length - 1]
  return { easting: last.easting, northing: last.northing, bearing: 0 }
}

/**
 * Generate cross-sections from a TIN surface along a centerline.
 *
 * @param spotHeights  - The surveyed points that form the TIN
 * @param centerline   - The centerline points (with chainage)
 * @param interval     - Chainage interval between sections (meters)
 * @param halfWidth    - Half-width of each cross-section (meters left + right)
 * @param pointSpacing - Distance between points along each cross-section (meters)
 */
export function generateCrossSectionsFromDTM(
  spotHeights: SpotHeight[],
  centerline: CenterlinePoint[],
  interval: number,
  halfWidth: number,
  pointSpacing: number,
): CrossSectionResult {
  // Build TIN surface
  const surface = buildTINSurface(spotHeights)

  // Generate chainage positions
  const totalLength = centerline[centerline.length - 1]?.chainage ?? 0
  const sections: CrossSectionProfile[] = []

  for (let chainage = 0; chainage <= totalLength + 0.01; chainage += interval) {
    const { easting: clE, northing: clN, bearing } = pointAtChainage(centerline, chainage)
    const points: CrossSectionPoint[] = []

    // Perpendicular direction (cross-section direction)
    const perpBearing = bearing + Math.PI / 2

    // Sample points from -halfWidth to +halfWidth
    for (let offset = -halfWidth; offset <= halfWidth + 0.01; offset += pointSpacing) {
      const e = clE + offset * Math.sin(perpBearing)
      const n = clN + offset * Math.cos(perpBearing)
      const elevation = interpolateElevation(surface, e, n)

      points.push({ chainage, offset, easting: e, northing: n, elevation })
    }

    const elevations = points.map(p => p.elevation).filter((z): z is number => z !== null)
    sections.push({
      chainage,
      points,
      minElevation: elevations.length > 0 ? Math.min(...elevations) : null,
      maxElevation: elevations.length > 0 ? Math.max(...elevations) : null,
    })
  }

  return {
    centerline,
    sections,
    interval,
    halfWidth,
    pointSpacing,
  }
}

/**
 * Export cross-sections as CSV for import into road design software.
 */
export function crossSectionsToCSV(result: CrossSectionResult): string {
  const lines: string[] = []
  lines.push('Chainage,Offset,Easting,Northing,Elevation')

  for (const section of result.sections) {
    for (const p of section.points) {
      lines.push([
        p.chainage.toFixed(3),
        p.offset.toFixed(3),
        p.easting.toFixed(3),
        p.northing.toFixed(3),
        p.elevation !== null ? p.elevation.toFixed(3) : '',
      ].join(','))
    }
  }

  return lines.join('\n')
}

/**
 * Export cross-sections as DXF polylines.
 * Each cross-section is a separate polyline on layer "CROSS_SECTIONS".
 */
export function crossSectionsToDXF(result: CrossSectionResult): string {
  const lines: string[] = []
  lines.push('0', 'SECTION', '2', 'ENTITIES')

  for (const section of result.sections) {
    lines.push('0', 'POLYLINE', '8', 'CROSS_SECTIONS', '66', '1', '70', '0')

    for (const p of section.points) {
      lines.push('0', 'VERTEX', '8', 'CROSS_SECTIONS')
      lines.push('10', p.easting.toFixed(3))
      lines.push('20', p.northing.toFixed(3))
      lines.push('30', (p.elevation ?? 0).toFixed(3))
    }

    lines.push('0', 'SEQEND')

    // Chainage label
    const cl = section.points.find(p => p.offset === 0) ?? section.points[0]
    if (cl) {
      lines.push('0', 'TEXT', '8', 'CROSS_SECTION_LABELS')
      lines.push('10', cl.easting.toFixed(3), '20', cl.northing.toFixed(3), '30', '0')
      lines.push('40', '1.0')
      lines.push('1', `CH ${section.chainage.toFixed(0)}`)
    }
  }

  lines.push('0', 'ENDSEC', '0', 'EOF')
  return lines.join('\n')
}
