import Drawing from 'dxf-writer'
import type { SubmissionPackage } from '../types'
import { initialiseSokDXFLayers, DXF_LAYERS, formatPlanDate } from '@/lib/drawing/dxfLayers'

// ─── Bearing Computation ──────────────────────────────────────────────────────

/**
 * Compute whole-circle bearing from North (clockwise) between two points.
 * Returns bearing in decimal degrees [0, 360).
 */
function computeBearing(e1: number, n1: number, e2: number, n2: number): number {
  const dE = e2 - e1
  const dN = n2 - n1
  let bearing = (Math.atan2(dE, dN) * 180) / Math.PI
  if (bearing < 0) bearing += 360
  return bearing
}

/**
 * Convert a whole-circle bearing (0–360°) to a quadrant bearing string
 * using standard surveying convention: N/S angle E/W.
 * Example: 45.504° → N 45°30'15" E
 */
function formatQuadrantBearing(wcb: number): string {
  const normalised = ((wcb % 360) + 360) % 360
  let quadrantAngle: number
  let prefix: string
  let suffix: string

  if (normalised <= 90) {
    prefix = 'N'
    suffix = 'E'
    quadrantAngle = normalised
  } else if (normalised <= 180) {
    prefix = 'S'
    suffix = 'E'
    quadrantAngle = 180 - normalised
  } else if (normalised <= 270) {
    prefix = 'S'
    suffix = 'W'
    quadrantAngle = normalised - 180
  } else {
    prefix = 'N'
    suffix = 'W'
    quadrantAngle = 360 - normalised
  }

  // Convert decimal degrees to DMS
  const totalSeconds = Math.round(quadrantAngle * 3600)
  const d = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60

  const dms = `${d}\u00B0${String(m).padStart(2, '0')}'${String(s).padStart(2, '0')}"`
  return `${prefix} ${dms} ${suffix}`
}

// ─── Data Extent Helpers ──────────────────────────────────────────────────────

interface Extent {
  minE: number
  maxE: number
  minN: number
  maxN: number
}

function computeExtent(points: { adjustedEasting: number; adjustedNorthing: number }[]): Extent {
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity
  for (const pt of points) {
    if (pt.adjustedEasting < minE) minE = pt.adjustedEasting
    if (pt.adjustedEasting > maxE) maxE = pt.adjustedEasting
    if (pt.adjustedNorthing < minN) minN = pt.adjustedNorthing
    if (pt.adjustedNorthing > maxN) maxN = pt.adjustedNorthing
  }
  return { minE, maxE, minN, maxN }
}

/**
 * Choose a "nice" round scale-bar length given the data extent width.
 * Returns a value like 10, 20, 50, 100, 200, 500, 1000 … metres.
 */
function chooseScaleBarLength(extentWidth: number): number {
  const targetFraction = 0.25 // scale bar should be ~25% of extent width
  const ideal = extentWidth * targetFraction
  const magnitude = Math.pow(10, Math.floor(Math.log10(ideal)))
  const candidates = [1, 2, 5, 10, 20, 50].map(m => m * magnitude)
  // Pick the candidate closest to the ideal
  let best = candidates[0]
  for (const c of candidates) {
    if (Math.abs(c - ideal) < Math.abs(best - ideal)) best = c
  }
  return Math.max(best, 1)
}

// ─── Main Generator ───────────────────────────────────────────────────────────

export function generateWorkingDiagramDXF(pkg: SubmissionPackage): string {
  const drawing = new Drawing()
  initialiseSokDXFLayers(drawing)

  const points = pkg.traverse.points
  if (points.length === 0) return drawing.toDxfString()

  const extent = computeExtent(points)
  const extentWidth = extent.maxE - extent.minE
  const extentHeight = extent.maxN - extent.minN

  // Padding around the traverse data for labels / decorations
  const pad = Math.max(extentWidth, extentHeight) * 0.12
  const padAbs = Math.max(pad, 5) // at least 5 m padding

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. BOUNDARY LINES connecting traverse points (WORKING layer)
  // ═══════════════════════════════════════════════════════════════════════════
  drawing.setActiveLayer(DXF_LAYERS.WORKING.name)

  for (let i = 0; i < points.length; i++) {
    const pt = points[i]
    const nextPt = points[(i + 1) % points.length]
    drawing.drawLine(
      pt.adjustedEasting,
      pt.adjustedNorthing,
      nextPt.adjustedEasting,
      nextPt.adjustedNorthing
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. BEACONS — circles and point-name labels (BEACONS layer)
  // ═══════════════════════════════════════════════════════════════════════════
  drawing.setActiveLayer(DXF_LAYERS.BEACONS.name)

  const beaconRadius = Math.max(padAbs * 0.04, 0.3)
  const labelHeight = Math.max(padAbs * 0.06, 0.5)
  const labelOffset = beaconRadius * 2.5

  for (const pt of points) {
    drawing.drawCircle(pt.adjustedEasting, pt.adjustedNorthing, beaconRadius)
    drawing.drawText(
      pt.adjustedEasting + labelOffset,
      pt.adjustedNorthing + labelOffset,
      labelHeight,
      0,
      pt.pointName
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. DISTANCE labels at midpoints of each leg (DIMENSIONS layer)
  // ═══════════════════════════════════════════════════════════════════════════
  drawing.setActiveLayer(DXF_LAYERS.DISTANCES.name)

  const distLabelHeight = Math.max(padAbs * 0.05, 0.4)

  for (let i = 0; i < points.length; i++) {
    const pt = points[i]
    const nextPt = points[(i + 1) % points.length]

    const midE = (pt.adjustedEasting + nextPt.adjustedEasting) / 2
    const midN = (pt.adjustedNorthing + nextPt.adjustedNorthing) / 2

    // Offset the distance label slightly below the midpoint
    const dE = nextPt.adjustedEasting - pt.adjustedEasting
    const dN = nextPt.adjustedNorthing - pt.adjustedNorthing
    const legLen = Math.sqrt(dE * dE + dN * dN)
    // Perpendicular direction (pointing "left" of travel)
    const perpE = legLen > 0 ? -dN / legLen : 0
    const perpN = legLen > 0 ? dE / legLen : 1
    const offsetDist = distLabelHeight * 2.5

    drawing.drawText(
      midE + perpE * offsetDist,
      midN + perpN * offsetDist,
      distLabelHeight,
      0,
      `${pt.observedDistance.toFixed(2)}m`
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. BEARING labels at midpoints of each leg (BEARINGS layer)
  // ═══════════════════════════════════════════════════════════════════════════
  drawing.setActiveLayer(DXF_LAYERS.BEARINGS.name)

  const bearingLabelHeight = Math.max(padAbs * 0.05, 0.4)

  for (let i = 0; i < points.length; i++) {
    const pt = points[i]
    const nextPt = points[(i + 1) % points.length]

    const midE = (pt.adjustedEasting + nextPt.adjustedEasting) / 2
    const midN = (pt.adjustedNorthing + nextPt.adjustedNorthing) / 2

    // Compute bearing from adjusted coordinates
    const wcb = computeBearing(
      pt.adjustedEasting,
      pt.adjustedNorthing,
      nextPt.adjustedEasting,
      nextPt.adjustedNorthing
    )
    const bearingStr = formatQuadrantBearing(wcb)

    // Offset the bearing label slightly above the midpoint (opposite side of distance)
    const dE = nextPt.adjustedEasting - pt.adjustedEasting
    const dN = nextPt.adjustedNorthing - pt.adjustedNorthing
    const legLen = Math.sqrt(dE * dE + dN * dN)
    const perpE = legLen > 0 ? -dN / legLen : 0
    const perpN = legLen > 0 ? dE / legLen : 1
    const offsetDist = bearingLabelHeight * 2.5

    drawing.drawText(
      midE - perpE * offsetDist,
      midN - perpN * offsetDist,
      bearingLabelHeight,
      0,
      bearingStr
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. NORTH ARROW (top-right area of drawing)
  // ═══════════════════════════════════════════════════════════════════════════
  drawing.setActiveLayer(DXF_LAYERS.NORTH_ARR.name)

  const arrowX = extent.maxE + padAbs * 2.5
  const arrowBaseN = extent.maxN + padAbs * 0.3
  const arrowLen = padAbs * 1.5
  const arrowTipN = arrowBaseN + arrowLen
  const arrowHeadSize = arrowLen * 0.2

  // Vertical line (shaft)
  drawing.drawLine(arrowX, arrowBaseN, arrowX, arrowTipN)
  // Arrowhead — two diagonal lines
  drawing.drawLine(arrowX, arrowTipN, arrowX - arrowHeadSize, arrowTipN - arrowHeadSize)
  drawing.drawLine(arrowX, arrowTipN, arrowX + arrowHeadSize, arrowTipN - arrowHeadSize)
  // "N" label
  drawing.drawText(arrowX, arrowTipN + arrowHeadSize * 1.5, labelHeight * 1.2, 0, 'N')

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. SCALE BAR (bottom-right area of drawing, above title block)
  // ═══════════════════════════════════════════════════════════════════════════
  drawing.setActiveLayer(DXF_LAYERS.SCL_BAR.name)

  const scaleBarLength = chooseScaleBarLength(extentWidth)
  const scaleBarX = extent.minE + padAbs
  const scaleBarY = extent.minN - padAbs * 2
  const scaleBarHeight = padAbs * 0.15

  // Main bar line
  drawing.drawLine(scaleBarX, scaleBarY, scaleBarX + scaleBarLength, scaleBarY)
  // End ticks
  drawing.drawLine(scaleBarX, scaleBarY - scaleBarHeight, scaleBarX, scaleBarY + scaleBarHeight)
  drawing.drawLine(
    scaleBarX + scaleBarLength,
    scaleBarY - scaleBarHeight,
    scaleBarX + scaleBarLength,
    scaleBarY + scaleBarHeight
  )
  // Mid tick
  const midScaleX = scaleBarX + scaleBarLength / 2
  drawing.drawLine(
    midScaleX,
    scaleBarY - scaleBarHeight * 0.7,
    midScaleX,
    scaleBarY + scaleBarHeight * 0.7
  )
  // Half-fill rectangle (alternating black/white segments)
  drawing.drawRect(scaleBarX, scaleBarY - scaleBarHeight * 0.5, midScaleX, scaleBarY + scaleBarHeight * 0.5)

  // Length labels
  drawing.drawText(scaleBarX, scaleBarY - scaleBarHeight * 3, distLabelHeight, 0, '0')
  drawing.drawText(midScaleX, scaleBarY - scaleBarHeight * 3, distLabelHeight, 0, `${scaleBarLength / 2}`)
  drawing.drawText(
    scaleBarX + scaleBarLength,
    scaleBarY - scaleBarHeight * 3,
    distLabelHeight,
    0,
    `${scaleBarLength}m`
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. TITLE BLOCK at the bottom of the drawing
  // ═══════════════════════════════════════════════════════════════════════════
  drawing.setActiveLayer(DXF_LAYERS.TITLE_BLK.name)

  const tbOriginX = extent.minE - padAbs
  const tbOriginY = extent.minN - padAbs * 5
  const tbWidth = extentWidth + padAbs * 3
  const titleHeight = labelHeight * 1.5
  const rowHeight = titleHeight * 2.2
  const smallText = labelHeight * 0.9

  // Title block outer rectangle
  drawing.drawRect(tbOriginX, tbOriginY, tbOriginX + tbWidth, tbOriginY + rowHeight * 10)

  // ── Header rows ────────────────────────────────────────────────────────────
  const headerRows: [number, string][] = [
    [rowHeight * 9, 'REPUBLIC OF KENYA'],
    [rowHeight * 8, 'SURVEY OF KENYA'],
    [rowHeight * 7, 'WORKING DIAGRAM'],
  ]

  for (const [yOff, text] of headerRows) {
    drawing.drawText(
      tbOriginX + tbWidth / 2,
      tbOriginY + yOff,
      titleHeight,
      0,
      text,
      'center'
    )
  }

  // Divider line below the header
  const dividerY = tbOriginY + rowHeight * 6.5
  drawing.drawLine(tbOriginX, dividerY, tbOriginX + tbWidth, dividerY)

  // ── Detail rows ────────────────────────────────────────────────────────────
  const areaHa = (pkg.parcel.areaM2 / 10000).toFixed(4)
  const surveyDate = formatPlanDate(pkg.generatedAt)

  const detailRows: [number, string][] = [
    [rowHeight * 6, `LR No: ${pkg.parcel.lrNumber}`],
    [rowHeight * 5, `Area: ${areaHa} Ha  |  Perimeter: ${pkg.traverse.perimeterM.toFixed(2)} m`],
    [rowHeight * 4, `Surveyor: ${pkg.surveyor.fullName}`],
    [rowHeight * 3, `ISK No: ${pkg.surveyor.iskNumber}  |  Reg: ${pkg.surveyor.registrationNumber}`],
    [rowHeight * 2, `Date: ${surveyDate}  |  Ref: ${pkg.submissionRef}  |  Rev: ${pkg.revision}`],
    [rowHeight * 1, `Survey Act Cap 299  |  ${pkg.subtype.replace(/_/g, ' ').toUpperCase()}`],
  ]

  for (const [yOff, text] of detailRows) {
    drawing.drawText(
      tbOriginX + tbWidth / 2,
      tbOriginY + yOff,
      smallText,
      0,
      text,
      'center'
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. ANNOTATIONS — submission reference & misc notes
  // ═══════════════════════════════════════════════════════════════════════════
  drawing.setActiveLayer(DXF_LAYERS.NOTES_TXT.name)

  // Traverse precision info near the top
  const noteX = extent.minE - padAbs
  const noteY = extent.maxN + padAbs
  drawing.drawText(noteX, noteY, smallText, 0, `Angular Misclosure: ${pkg.traverse.angularMisclosure.toFixed(4)}\u00B3`)
  drawing.drawText(noteX, noteY - smallText * 2.5, smallText, 0, `Linear Misclosure: ${pkg.traverse.linearMisclosure.toFixed(4)} m`)
  drawing.drawText(noteX, noteY - smallText * 5, smallText, 0, `Precision Ratio: 1 : ${pkg.traverse.precisionRatio}`)
  drawing.drawText(
    noteX,
    noteY - smallText * 7.5,
    smallText,
    0,
    `Adjustment: ${pkg.traverse.adjustmentMethod.charAt(0).toUpperCase() + pkg.traverse.adjustmentMethod.slice(1)}`
  )

  return drawing.toDxfString()
}
