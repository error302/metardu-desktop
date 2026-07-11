/**
 * @module mutationVectorLayout
 *
 * Automated Mutation Form Vector Layout Engine
 *
 * Generates print-ready Mutation Form PDFs with:
 * - Parent parcel boundary drawing (vector)
 * - Subdivision boundaries overlaid
 * - North arrow pointing up (parallel to sheet sides)
 * - Scale bar at standard scales (1:1000, 1:2500, 1:5000)
 * - Area allocation schedule (text blocks, uppercase)
 * - Beacon schedule
 * - Surveyor signature block
 *
 * Per Survey of Kenya regulations:
 * - North must be vertical and parallel to sheet sides
 * - Drawing auto-scales to fit standard survey scales
 * - Area schedules in capital letters, upright open style
 */

import PDFDocument from 'pdfkit'
import {
  createSurveyDocument,
  drawLine,
  drawRect,
  drawText,
  drawCompanyLogo,
  drawMetarduWatermark,
  PAPER_SIZES,
  LINE_WEIGHTS,
  TEXT_SIZES,
} from '../pdf-engine'
import type { SurveyPoint } from '@/lib/map/turfHelpers'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MutationLayoutData {
  // Parent parcel
  parentParcelNumber: string
  parentTitleDeed: string
  parentAreaHectares: number
  parentVertices: SurveyPoint[]

  // Resulting parcels (subdivisions)
  resultingParcels: Array<{
    parcelNumber: string
    vertices: SurveyPoint[]
    areaHectares: number
  }>

  // Beacons
  beacons: Array<{
    beaconNumber: string
    coordinate: SurveyPoint
    description?: string
  }>

  // Surveyor
  surveyorName: string
  surveyorLicense: string
  surveyorFirm?: string
  registry: string
  county: string
  datePrepared: string

  // Scale
  scale?: 500 | 1000 | 2500 | 5000

  // Branding
  plan?: 'free' | 'pro' | 'team' | 'firm' | 'enterprise'
  companyLogo?: Buffer | null
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Calculate the bounding box of all vertices.
 */
function getBoundingBox(vertices: SurveyPoint[]): {
  minE: number; maxE: number; minN: number; maxN: number
  width: number; height: number
} {
  if (vertices.length === 0) {
    return { minE: 0, maxE: 0, minN: 0, maxN: 0, width: 0, height: 0 }
  }
  let minE = vertices[0].easting
  let maxE = vertices[0].easting
  let minN = vertices[0].northing
  let maxN = vertices[0].northing

  for (const v of vertices) {
    minE = Math.min(minE, v.easting)
    maxE = Math.max(maxE, v.easting)
    minN = Math.min(minN, v.northing)
    maxN = Math.max(maxN, v.northing)
  }

  return {
    minE, maxE, minN, maxN,
    width: maxE - minE,
    height: maxN - minN,
  }
}

/**
 * Auto-select the best standard scale to fit the drawing.
 */
function autoSelectScale(bboxWidth: number, bboxHeight: number, availableWidthMm: number, availableHeightMm: number): number {
  // Convert mm to meters at scale
  const scales = [500, 1000, 2500, 5000]
  for (const scale of scales) {
    const drawingWidthMm = (bboxWidth / scale) * 1000
    const drawingHeightMm = (bboxHeight / scale) * 1000
    if (drawingWidthMm <= availableWidthMm && drawingHeightMm <= availableHeightMm) {
      return scale
    }
  }
  // Default to largest if nothing fits
  return 5000
}

/**
 * Transform a survey coordinate to PDF page coordinates.
 */
function transformToPage(
  vertex: SurveyPoint,
  bbox: ReturnType<typeof getBoundingBox>,
  scale: number,
  originX: number,
  originY: number,
  pageHeight: number,
): [number, number] {
  // Scale: 1 mm on page = `scale` mm on ground = `scale / 1000` meters
  const scaleM = scale / 1000 // meters per mm

  const dxMm = (vertex.easting - bbox.minE) / scaleM
  const dyMm = (vertex.northing - bbox.minN) / scaleM

  // PDF coordinates: origin is bottom-left, Y increases upward
  const x = originX + dxMm
  const y = originY + dyMm

  return [x, y]
}

// ---------------------------------------------------------------------------
// North Arrow
// ---------------------------------------------------------------------------

function drawNorthArrow(doc: PDFKit.PDFDocument, x: number, y: number, size: number = 15) {
  // North arrow pointing up (parallel to sheet sides)
  const halfSize = size / 2

  // Arrow shaft
  drawLine(doc, x, y, x, y + size, LINE_WEIGHTS.parcelBoundary)

  // Arrowhead (triangle pointing up)
  doc.save()
  doc.moveTo(x - halfSize * 0.4, y + size * 0.6)
  doc.lineTo(x, y + size)
  doc.lineTo(x + halfSize * 0.4, y + size * 0.6)
  doc.closePath()
  doc.fillColor('black')
  doc.fill()
  doc.restore()

  // "N" label above arrow
  drawText(doc, 'N', x - 1.5, y + size + 1, TEXT_SIZES.gridLabel, { bold: true })
}

// ---------------------------------------------------------------------------
// Scale Bar
// ---------------------------------------------------------------------------

function drawScaleBar(doc: PDFKit.PDFDocument, x: number, y: number, scale: number, lengthM: number) {
  // Draw a scale bar showing `lengthM` meters at the given scale
  const lengthMm = (lengthM / scale) * 1000

  // Main bar
  drawRect(doc, x, y, lengthMm, 1.5, LINE_WEIGHTS.gridLine, 'black', '#000000')

  // Divisions (4 segments)
  const segWidth = lengthMm / 4
  for (let i = 0; i < 4; i++) {
    if (i % 2 === 1) {
      drawRect(doc, x + i * segWidth, y, segWidth, 1.5, 0, 'black', '#000000')
    }
  }

  // Tick marks and labels
  for (let i = 0; i <= 4; i++) {
    const tickX = x + i * segWidth
    drawLine(doc, tickX, y - 1, tickX, y + 2.5, LINE_WEIGHTS.gridLine)
    const label = `${(lengthM * i / 4).toFixed(0)}`
    drawText(doc, label, tickX - 2, y - 4, TEXT_SIZES.gridLabel)
  }

  // Scale text
  drawText(doc, `SCALE 1:${scale}`, x, y + 4, TEXT_SIZES.gridLabel, { bold: true })
}

// ---------------------------------------------------------------------------
// Main Generator
// ---------------------------------------------------------------------------

export async function generateMutationVectorLayout(data: MutationLayoutData): Promise<Buffer> {
  const scale = data.scale || 1000

  const doc = createSurveyDocument({
    paperSize: 'A3',
    orientation: 'landscape',
    scale,
    metadata: {
      title: `Mutation Form — ${data.parentParcelNumber}`,
      surveyorName: data.surveyorName,
      surveyorLicense: data.surveyorLicense,
      projectReference: data.parentParcelNumber,
      date: data.datePrepared,
    },
    plan: data.plan,
    companyLogo: data.companyLogo,
  })

  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const pdfPromise = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
  })

  const mmToPt = 2.8346
  const pageWidth = 420 // A3 landscape width in mm
  const pageHeight = 297
  const mx = 20 // left/right margin

  let y = 15

  // ─── Header ──────────────────────────────────────────────────
  drawText(doc, 'REPUBLIC OF KENYA', mx, y, 6, { align: 'center', bold: true })
  y += 7
  drawText(doc, 'THE SURVEY ACT (CAP 299)', mx, y, 3.5, { align: 'center', bold: true })
  y += 6
  drawText(doc, 'MUTATION FORM', mx, y, 7, { align: 'center', bold: true })
  y += 8
  drawText(doc, `${data.registry} — ${data.county}`, mx, y, 3, { align: 'center' })
  y += 8

  // Separator
  drawLine(doc, mx, y, pageWidth - mx, y, LINE_WEIGHTS.titleBorder)
  y += 5

  // ─── Drawing Area ────────────────────────────────────────────
  // Left side: vector drawing (60% of page)
  const drawingWidth = (pageWidth - 2 * mx) * 0.6
  const drawingHeight = pageHeight - y - 80 // leave room for schedules
  const drawingX = mx
  const drawingY = y

  // Drawing border
  drawRect(doc, drawingX, drawingY, drawingWidth, drawingHeight, LINE_WEIGHTS.parcelBoundary)

  // Collect all vertices (parent + subdivisions) for bounding box
  const allVertices = [
    ...data.parentVertices,
    ...data.resultingParcels.flatMap(p => p.vertices),
  ]

  const bbox = getBoundingBox(allVertices)

  // Auto-select scale if not specified
  const actualScale = data.scale || autoSelectScale(
    bbox.width, bbox.height,
    drawingWidth - 20, drawingHeight - 20,
  )

  // Draw parent parcel boundary
  if (data.parentVertices.length >= 2) {
    doc.save()
    doc.lineWidth(LINE_WEIGHTS.parcelBoundary)
    doc.strokeColor('black')

    const firstPt = transformToPage(
      data.parentVertices[0], bbox, actualScale,
      drawingX + 10, drawingY + 10, pageHeight,
    )
    doc.moveTo(firstPt[0], pageHeight - firstPt[1])

    for (let i = 1; i < data.parentVertices.length; i++) {
      const pt = transformToPage(
        data.parentVertices[i], bbox, actualScale,
        drawingX + 10, drawingY + 10, pageHeight,
      )
      doc.lineTo(pt[0], pageHeight - pt[1])
    }
    doc.closePath()
    doc.stroke()
    doc.restore()
  }

  // Draw subdivision boundaries
  for (const parcel of data.resultingParcels) {
    if (parcel.vertices.length < 2) continue

    // dashed line for subdivisions
    doc.save()
    doc.lineWidth(LINE_WEIGHTS.gridLine)
    doc.strokeColor('#333333')

    const firstPt = transformToPage(
      parcel.vertices[0], bbox, actualScale,
      drawingX + 10, drawingY + 10, pageHeight,
    )
    doc.moveTo(firstPt[0], pageHeight - firstPt[1])

    for (let i = 1; i < parcel.vertices.length; i++) {
      const pt = transformToPage(
        parcel.vertices[i], bbox, actualScale,
        drawingX + 10, drawingY + 10, pageHeight,
      )
      doc.lineTo(pt[0], pageHeight - pt[1])
    }
    doc.closePath()
    doc.stroke()
    doc.restore()

    // Label parcel number at centroid
    const centroid: SurveyPoint = parcel.vertices.reduce(
      (acc, v) => ({ easting: acc.easting + v.easting / parcel.vertices.length, northing: acc.northing + v.northing / parcel.vertices.length }),
      { easting: 0, northing: 0 },
    )
    const labelPt = transformToPage(
      centroid, bbox, actualScale,
      drawingX + 10, drawingY + 10, pageHeight,
    )
    drawText(doc, parcel.parcelNumber, labelPt[0] - 5, pageHeight - labelPt[1] - 1, TEXT_SIZES.small, { bold: true })
  }

  // Draw beacons
  for (const beacon of data.beacons) {
    const pt = transformToPage(
      beacon.coordinate, bbox, actualScale,
      drawingX + 10, drawingY + 10, pageHeight,
    )
    // Small cross marker
    doc.save()
    doc.lineWidth(0.2)
    doc.lineJoin('round')
    doc.circle(pt[0], pageHeight - pt[1], 0.8)
    doc.fillColor('black')
    doc.fill()
    doc.restore()

    // Beacon label
    drawText(doc, beacon.beaconNumber, pt[0] + 1, pageHeight - pt[1] - 1, TEXT_SIZES.small, )
  }

  // North arrow (top-right of drawing area, pointing up)
  drawNorthArrow(doc, drawingX + drawingWidth - 15, drawingY + 5, 12)

  // Scale bar (bottom-left of drawing area)
  drawScaleBar(doc, drawingX + 5, drawingY + drawingHeight - 10, actualScale, 50)

  // ─── Right side: Schedules ───────────────────────────────────
  const scheduleX = mx + drawingWidth + 10
  const scheduleWidth = pageWidth - mx - scheduleX
  let sy = drawingY

  // Area Allocation Schedule
  drawText(doc, 'AREA ALLOCATION SCHEDULE', scheduleX, sy, 4, { bold: true })
  sy += 6

  drawLine(doc, scheduleX, sy, scheduleX + scheduleWidth, sy, LINE_WEIGHTS.gridLine)
  sy += 3

  // Table header
  drawText(doc, 'PARCEL NO.', scheduleX, sy, 2.5, { bold: true })
  drawText(doc, 'AREA (HA)', scheduleX + scheduleWidth * 0.6, sy, 2.5, { bold: true, align: 'right' })
  sy += 4
  drawLine(doc, scheduleX, sy, scheduleX + scheduleWidth, sy, 0.1)
  sy += 3

  // Parent parcel
  drawText(doc, data.parentParcelNumber, scheduleX, sy, TEXT_SIZES.small)
  drawText(doc, data.parentAreaHectares.toFixed(4), scheduleX + scheduleWidth * 0.6, sy, TEXT_SIZES.small, { align: 'right' })
  sy += 4

  // Resulting parcels (uppercase per SoK standard)
  for (const parcel of data.resultingParcels) {
    drawText(doc, parcel.parcelNumber.toUpperCase(), scheduleX, sy, TEXT_SIZES.small)
    drawText(doc, parcel.areaHectares.toFixed(4), scheduleX + scheduleWidth * 0.6, sy, TEXT_SIZES.small, { align: 'right' })
    sy += 4
  }

  // Total
  drawLine(doc, scheduleX, sy, scheduleX + scheduleWidth, sy, 0.1)
  sy += 3
  const totalArea = data.resultingParcels.reduce((sum, p) => sum + p.areaHectares, 0)
  drawText(doc, 'TOTAL', scheduleX, sy, TEXT_SIZES.small, { bold: true })
  drawText(doc, totalArea.toFixed(4), scheduleX + scheduleWidth * 0.6, sy, TEXT_SIZES.small, { bold: true, align: 'right' })
  sy += 8

  // Beacon Schedule
  drawText(doc, 'BEACON SCHEDULE', scheduleX, sy, 4, { bold: true })
  sy += 6
  drawLine(doc, scheduleX, sy, scheduleX + scheduleWidth, sy, LINE_WEIGHTS.gridLine)
  sy += 3

  drawText(doc, 'BEACON', scheduleX, sy, 2.5, { bold: true })
  drawText(doc, 'EASTING', scheduleX + scheduleWidth * 0.3, sy, 2.5, { bold: true })
  drawText(doc, 'NORTHING', scheduleX + scheduleWidth * 0.65, sy, 2.5, { bold: true })
  sy += 4
  drawLine(doc, scheduleX, sy, scheduleX + scheduleWidth, sy, 0.1)
  sy += 3

  for (const beacon of data.beacons) {
    drawText(doc, beacon.beaconNumber, scheduleX, sy, TEXT_SIZES.small, )
    drawText(doc, beacon.coordinate.easting.toFixed(3), scheduleX + scheduleWidth * 0.3, sy, TEXT_SIZES.small, )
    drawText(doc, beacon.coordinate.northing.toFixed(3), scheduleX + scheduleWidth * 0.65, sy, TEXT_SIZES.small, )
    sy += 4
  }

  // ─── Footer: Surveyor details ────────────────────────────────
  let fy = pageHeight - 35
  drawLine(doc, mx, fy, pageWidth - mx, fy, LINE_WEIGHTS.titleBorder)
  fy += 4

  drawText(doc, `SURVEYOR: ${data.surveyorName.toUpperCase()}`, mx, fy, TEXT_SIZES.small, { bold: true })
  drawText(doc, `LICENSE: ${data.surveyorLicense}`, mx + 80, fy, TEXT_SIZES.small, { bold: true })
  drawText(doc, `DATE: ${data.datePrepared}`, pageWidth - mx - 40, fy, TEXT_SIZES.small, { align: 'right' })
  fy += 6

  // Signature lines
  drawLine(doc, mx, fy, mx + 50, fy, LINE_WEIGHTS.gridLine)
  drawLine(doc, pageWidth - mx - 50, fy, pageWidth - mx, fy, LINE_WEIGHTS.gridLine)
  drawText(doc, 'Surveyor Signature', mx, fy + 2, 2)
  drawText(doc, 'Director of Surveys', pageWidth - mx - 50, fy + 2, 2)

  // Watermark (free plan only)
  if (data.plan === 'free' || !data.plan) {
    drawMetarduWatermark(doc, pageWidth, pageHeight)
  } else if (data.companyLogo) {
    drawCompanyLogo(doc, data.companyLogo, pageWidth - mx - 30, 10, 25, 8)
  }

  doc.end()
  return pdfPromise
}
