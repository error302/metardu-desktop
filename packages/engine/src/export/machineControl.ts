/**
 * Machine Control Export
 *
 * AUDIT FIX (2026-07-03): Generates files for machine control systems
 * (Leica, Trimble, Topcon) that need 3D surface models + alignment
 * definitions for automated grading/excavation.
 *
 * Outputs:
 *   1. 3D DXF TIN surface (3DFACE entities with Z) — for importing
 *      design surfaces into machine control displays
 *   2. LandXML alignment (horizontal + vertical) — for Leica iCON /
 *      Trimble Business Center / Topcon 3D-MC
 *   3. Stakeout CSV (chainage, offset, easting, northing, design RL)
 *      — for robotic total station stakeout
 *
 * References:
 *   - Leica iCON: supports DXF 3DFACE + LandXML 1.2
 *   - Trimble 3D-MC: supports DXF + LandXML + proprietary .ttm
 *   - Topcon 3D-MC: supports DXF + LandXML
 */

import type { SpotHeight, TINSurface } from '@/lib/engine/contours'

export interface AlignmentPoint {
  chainage: number
  easting: number
  northing: number
  elevation: number
}

export interface MachineControlExport {
  dxf3D: string
  landXML: string
  stakeoutCSV: string
}

/**
 * Generate a 3D DXF TIN surface using 3DFACE entities.
 * Each triangle becomes a 3DFACE with four points (the 4th = 3rd for a triangle).
 */
export function generate3DDXFFromTIN(surface: TINSurface, layerName: string = 'DESIGN_SURFACE'): string {
  const lines: string[] = []

  // DXF header
  lines.push('0', 'SECTION')
  lines.push('2', 'HEADER')
  lines.push('9', '$ACADVER', '1', 'AC1015')
  lines.push('0', 'ENDSEC')

  // Tables section
  lines.push('0', 'SECTION', '2', 'TABLES')
  lines.push('0', 'TABLE', '2', 'LAYER', '70', '1')
  lines.push('0', 'LAYER', '2', layerName, '70', '0', '62', '3')
  lines.push('0', 'ENDTAB', '0', 'ENDSEC')

  // Entities section
  lines.push('0', 'SECTION', '2', 'ENTITIES')

  for (const tri of surface.triangles) {
    const p1 = tri.p1
    const p2 = tri.p2
    const p3 = tri.p3

    lines.push(
      '0', '3DFACE',
      '8', layerName,
      '10', p1.easting.toFixed(3),
      '20', p1.northing.toFixed(3),
      '30', (p1.elevation || 0).toFixed(3),
      '11', p2.easting.toFixed(3),
      '21', p2.northing.toFixed(3),
      '31', (p2.elevation || 0).toFixed(3),
      '12', p3.easting.toFixed(3),
      '22', p3.northing.toFixed(3),
      '32', (p3.elevation || 0).toFixed(3),
      '13', p3.easting.toFixed(3),  // 4th point = 3rd (triangle)
      '23', p3.northing.toFixed(3),
      '33', (p3.elevation || 0).toFixed(3),
    )
  }

  lines.push('0', 'ENDSEC')
  lines.push('0', 'EOF')

  return lines.join('\n')
}

/**
 * Generate a LandXML alignment file with horizontal + vertical curves.
 * Compatible with Leica iCON, Trimble Business Center, Topcon 3D-MC.
 */
export function generateAlignmentLandXML(
  alignmentName: string,
  horizontalPoints: AlignmentPoint[],
  verticalPoints: AlignmentPoint[],
  projectName: string,
): string {
  const now = new Date().toISOString()
  const lines: string[] = []

  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push(`<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.landxml.org/schema/LandXML-1.2 http://www.landxml.org/schema/LandXML-1.2/LandXML-1.2.xsd" version="1.2" date="${now}" time="${now}" readOnly="false" language="English">`)

  // Project info
  lines.push('  <Units>', '    <Metric linearUnit="meter" areaUnit="squareMeter" volumeUnit="cubicMeter" directionUnit="decimalDegrees" temperatureUnit="celsius" pressureUnit="milliBar" diameterUnit="millimeter" angularUnit="decimalDegrees" latitudeUnit="decimalDegrees"/>', '  </Units>')
  lines.push(`  <Application name="METARDU" manufacturer="METARDU" version="1.0" manufacturerURL="https://metardu.duckdns.org" timeStamp="${now}"/>`)

  // Alignments
  lines.push('  <Alignments name="' + projectName + '">')
  lines.push(`    <Alignment name="${alignmentName}" length="${horizontalPoints[horizontalPoints.length - 1]?.chainage || 0}" staStart="${horizontalPoints[0]?.chainage || 0}">`)

  // Horizontal alignment
  lines.push('      <CoordGeom>')
  for (let i = 0; i < horizontalPoints.length - 1; i++) {
    const p1 = horizontalPoints[i]
    const p2 = horizontalPoints[i + 1]
    lines.push('        <Line>')
    lines.push(`          <Start>${p1.northing.toFixed(4)} ${p1.easting.toFixed(4)}</Start>`)
    lines.push(`          <End>${p2.northing.toFixed(4)} ${p2.easting.toFixed(4)}</End>`)
    lines.push('        </Line>')
  }
  lines.push('      </CoordGeom>')

  // Vertical alignment (profile)
  if (verticalPoints.length > 1) {
    lines.push('      <Profile>')
    lines.push(`        <ProfAlign name="${alignmentName}_Vertical">`)
    for (const p of verticalPoints) {
      lines.push(`          <PVI>${p.chainage.toFixed(3)} ${p.elevation.toFixed(4)}</PVI>`)
    }
    lines.push('        </ProfAlign>')
    lines.push('      </Profile>')
  }

  lines.push('    </Alignment>')
  lines.push('  </Alignments>')

  // Stakeout points as CgPoints
  if (horizontalPoints.length > 0) {
    lines.push('  <CgPoints>')
    for (const p of horizontalPoints) {
      lines.push(`    <CgPoints>`)
      lines.push(`      <CgPoint name="CH${p.chainage.toFixed(0)}">${p.northing.toFixed(4)} ${p.easting.toFixed(4)} ${p.elevation.toFixed(4)}</CgPoint>`)
      lines.push(`    </CgPoints>`)
    }
    lines.push('  </CgPoints>')
  }

  lines.push('</LandXML>')

  return lines.join('\n')
}

/**
 * Generate a stakeout CSV for robotic total stations.
 * Format: point_name, easting, northing, design_elevation, chainage, offset
 */
export function generateStakeoutCSV(
  alignmentPoints: AlignmentPoint[],
  offset: number = 0,
  interval: number = 20,
): string {
  const lines = ['point_name,easting,northing,design_elevation,chainage,offset']

  // Generate stakeout points at regular intervals
  let currentChainage = alignmentPoints[0]?.chainage || 0
  const endChainage = alignmentPoints[alignmentPoints.length - 1]?.chainage || 0

  while (currentChainage <= endChainage) {
    // Interpolate position at this chainage
    const point = interpolateAlignmentPoint(alignmentPoints, currentChainage)

    if (point) {
      // Apply offset (perpendicular to the alignment direction)
      let offsetE = point.easting
      let offsetN = point.northing

      if (offset !== 0) {
        // Find the bearing at this chainage
        const nextPoint = interpolateAlignmentPoint(alignmentPoints, currentChainage + 1)
        if (nextPoint) {
          const dE = nextPoint.easting - point.easting
          const dN = nextPoint.northing - point.northing
          const len = Math.sqrt(dE * dE + dN * dN)
          if (len > 0) {
            // Perpendicular direction (90° clockwise = right side)
            const perpE = dN / len
            const perpN = -dE / len
            offsetE = point.easting + perpE * offset
            offsetN = point.northing + perpN * offset
          }
        }
      }

      const name = `CH${String(Math.round(currentChainage)).padStart(4, '0')}${offset > 0 ? '_R' : offset < 0 ? '_L' : ''}`
      lines.push(`${name},${offsetE.toFixed(3)},${offsetN.toFixed(3)},${point.elevation.toFixed(3)},${currentChainage.toFixed(3)},${offset.toFixed(3)}`)
    }

    currentChainage += interval
  }

  return lines.join('\n')
}

/**
 * Interpolate a point on the alignment at a given chainage.
 */
function interpolateAlignmentPoint(points: AlignmentPoint[], chainage: number): AlignmentPoint | null {
  if (points.length === 0) return null
  if (chainage <= points[0].chainage) return points[0]
  if (chainage >= points[points.length - 1].chainage) return points[points.length - 1]

  for (let i = 0; i < points.length - 1; i++) {
    if (chainage >= points[i].chainage && chainage <= points[i + 1].chainage) {
      const t = (chainage - points[i].chainage) / (points[i + 1].chainage - points[i].chainage)
      return {
        chainage,
        easting: points[i].easting + t * (points[i + 1].easting - points[i].easting),
        northing: points[i].northing + t * (points[i + 1].northing - points[i].northing),
        elevation: points[i].elevation + t * (points[i + 1].elevation - points[i].elevation),
      }
    }
  }

  return null
}

/**
 * Generate all machine control export files in one call.
 */
export function generateMachineControlExport(
  surface: TINSurface,
  horizontalPoints: AlignmentPoint[],
  verticalPoints: AlignmentPoint[],
  projectName: string,
  alignmentName: string = 'MAIN',
  offset: number = 0,
  interval: number = 20,
): MachineControlExport {
  return {
    dxf3D: generate3DDXFFromTIN(surface),
    landXML: generateAlignmentLandXML(alignmentName, horizontalPoints, verticalPoints, projectName),
    stakeoutCSV: generateStakeoutCSV(horizontalPoints, offset, interval),
  }
}
