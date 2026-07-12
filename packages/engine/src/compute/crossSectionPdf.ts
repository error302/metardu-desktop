// ============================================================
// METARDU — Cross-Section / Longitudinal Profile PDF Generator
// Professional A3 Landscape output for Kenya surveying
// Survey Act Cap 299, Survey Regulations L.N. 168/1994
//
// Generates longitudinal and cross-section profiles used in
// road design, canal construction, and terrain analysis.
//
// A3 Landscape (420 mm × 297 mm)
// No external charting library — uses jsPDF drawing primitives.
//
// Usage:
//   import { generateCrossSectionPdf, CrossSectionData } from './crossSectionPdf'
//   const pdf = generateCrossSectionPdf(data)
//   // pdf is a Uint8Array
// ============================================================

import jsPDF from 'jspdf'

// ============================================================
// EXPORTED INTERFACES
// ============================================================

export interface CrossSectionPoint {
  /** Distance along the alignment in metres */
  chainage: number
  /** Ground level in metres */
  elevation: number
  /** Design / formation level (for road profiles) */
  designLevel?: number
  /** Existing ground level (when different from elevation) */
  existingLevel?: number
}

export interface CrossSectionData {
  // ── Document metadata ──────────────────────────────────────
  documentNumber: string
  projectName: string
  projectNumber: string

  // ── Profile settings ──────────────────────────────────────
  profileType: 'LONGITUDINAL' | 'CROSS_SECTION'
  /** e.g. "Chainage 0+000 to 0+500 — Road A" */
  title: string

  // ── Scale ─────────────────────────────────────────────────
  /** e.g. 1:1000 */
  horizontalScale: number
  /** e.g. 1:100 */
  verticalScale: number
  /** computed as hScale / vScale, e.g. 10 */
  verticalExaggeration: number

  // ── Datum ─────────────────────────────────────────────────
  /** e.g. "MSL (Mean Sea Level)" */
  datum: string

  // ── Profile data ──────────────────────────────────────────
  points: CrossSectionPoint[]

  // ── Grid settings ─────────────────────────────────────────
  /** e.g. 50 (every 50 m) */
  majorGridInterval: number
  /** e.g. 10 */
  minorGridInterval: number
  /** 20m interval per RDM 1.1 Section 5.6.2 — set to 20 for road surveys */
  crossSectionInterval?: number

  // ── Surveyor info ─────────────────────────────────────────
  surveyorName: string
  iskNumber: string
  firmName: string
  surveyDate: string

  // ── Optional design parameters ────────────────────────────
  showDesignLevel?: boolean
  /** e.g. "Camber 2.5%, Super Elevation 3%" */
  designDescription?: string
  /** formation width in metres */
  formationWidth?: number

  // ── Notes ─────────────────────────────────────────────────
  notes?: string
}

// ============================================================
// INTERNAL TYPES & CONSTANTS
// ============================================================

type RGB = [number, number, number]

/** A3 landscape */
const PW = 420
const PH = 297

/** METARDU navy — matches CLA forms and other PDF generators */
const NAVY: RGB = [27, 58, 92]
const WHITE: RGB = [255, 255, 255]
const BLACK: RGB = [0, 0, 0]
const DKGRAY: RGB = [90, 90, 90]
const GRAY: RGB = [170, 170, 170]
const LTGRAY: RGB = [215, 215, 215]
const VLTGRAY: RGB = [240, 240, 240]

const GROUND_CLR: RGB = [0, 90, 30]
const DESIGN_CLR: RGB = [190, 15, 15]
const CUT_SHADE: RGB = [255, 205, 205]
const FILL_SHADE: RGB = [205, 222, 255]
const TBL_ALT: RGB = [243, 246, 250]
const BORDER: RGB = [195, 200, 208]

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/** Format a chainage in metres as "0+000" (km+m padded). */
function fmtChainage(metres: number): string {
  const sign = metres < 0 ? '-' : ''
  const abs = Math.abs(metres)
  const km = Math.floor(abs / 1000)
  const rem = Math.round(abs % 1000)
  return `${sign}${km}+${String(rem).padStart(3, '0')}`
}

/** Return a "nice" round interval for grid lines. */
function niceInterval(range: number, targetLines = 6): number {
  if (range <= 0) return 1
  const rough = range / targetLines
  const mag = Math.pow(10, Math.floor(Math.log10(rough)))
  const res = rough / mag
  const n = res <= 1.5 ? 1 : res <= 3.5 ? 2 : res <= 7.5 ? 5 : 10
  return n * mag
}

/** Grade (%) between two consecutive survey points. */
function gradeBetween(
  a: CrossSectionPoint,
  b: CrossSectionPoint,
): number {
  const d = b.chainage - a.chainage
  if (d === 0) return 0
  return ((b.elevation - a.elevation) / d) * 100
}

/** Decimal precision for elevation labels based on grid interval. */
function elevPrecision(interval: number): number {
  if (interval < 0.5) return 2
  if (interval < 5) return 1
  return 0
}

// ============================================================
// DRAWING AREA LAYOUT
// ============================================================

interface DrawingArea {
  /** Left edge (mm) — space for elevation labels */
  l: number
  /** Top edge (mm) */
  t: number
  /** Width (mm) */
  w: number
  /** Height (mm) */
  h: number
}

// ============================================================
// MAIN EXPORT
// ============================================================

export function generateCrossSectionPdf(
  data: CrossSectionData,
): Uint8Array {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a3',
  })

  // ── 1. Process & sort data ───────────────────────────────
  const pts = [...data.points].sort((a, b) => a.chainage - b.chainage)

  if (pts.length === 0) {
    doc.setFontSize(12)
    doc.setFont('helvetica', 'italic')
    doc.text(
      'No survey data provided.',
      PW / 2,
      PH / 2,
      { align: 'center' },
    )
    return doc.output('arraybuffer') as unknown as Uint8Array
  }

  const cMin = pts[0].chainage
  const cMax = pts[pts.length - 1].chainage
  const cRange = Math.max(cMax - cMin, 1)

  // Gather every elevation value (ground + design + existing) for range
  const allElevs = pts.flatMap(
    (p) =>
      [p.elevation, p.designLevel, p.existingLevel].filter(
        (v): v is number => v != null,
      ),
  )
  const eMin = Math.min(...allElevs)
  const eMax = Math.max(...allElevs)
  const eRange = Math.max(eMax - eMin, 0.1)

  // Add 12 % vertical padding
  const ePad = Math.max(eRange * 0.12, 0.5)
  const eEffMin = eMin - ePad
  const eEffMax = eMax + ePad
  const eEffRange = eEffMax - eEffMin

  // ── 2. Drawing area geometry ─────────────────────────────
  const DA: DrawingArea = { l: 38, t: 46, w: 335, h: 120 }
  const DA_B = DA.t + DA.h

  // ── 3. Coordinate mapping ────────────────────────────────
  const cToX = (c: number): number =>
    DA.l + ((c - cMin) / cRange) * DA.w
  const eToY = (e: number): number =>
    DA_B - ((e - eEffMin) / eEffRange) * DA.h

  // ── 4. Grid intervals ────────────────────────────────────
  const cMajor = data.majorGridInterval
  const cMinor = data.minorGridInterval
  const eMajInt = niceInterval(eEffRange, 6)
  const eMinInt = eMajInt / 5

  // ==========================================================
  // HEADER BLOCK
  // ==========================================================
  drawHeader(doc, data)

  // ==========================================================
  // MINOR GRID
  // ==========================================================
  drawMinorGrid(doc, DA, cToX, eToY, cMin, cMax, eEffMin, eEffMax, cMajor, cMinor, eMajInt, eMinInt)

  // ==========================================================
  // MAJOR GRID
  // ==========================================================
  drawMajorGrid(doc, DA, cToX, eToY, cMin, cMax, eEffMin, eEffMax, cMajor, cMinor, eMajInt, eMinInt)

  // ==========================================================
  // DRAWING AREA BORDER
  // ==========================================================
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.5)
  doc.rect(DA.l, DA.t, DA.w, DA.h)

  // ==========================================================
  // AXIS TITLES
  // ==========================================================
  drawAxisTitles(doc, DA)

  // ==========================================================
  // CUT / FILL SHADING (drawn BEFORE lines so lines sit on top)
  // ==========================================================
  if (data.showDesignLevel) {
    drawCutFillShading(doc, pts, cToX, eToY)
  }

  // ==========================================================
  // GROUND PROFILE LINE
  // ==========================================================
  drawGroundProfile(doc, pts, cToX, eToY)

  // ==========================================================
  // DESIGN LINE
  // ==========================================================
  if (data.showDesignLevel) {
    drawDesignLine(doc, pts, cToX, eToY)
  }

  // ==========================================================
  // SURVEY POINT MARKERS
  // ==========================================================
  drawSurveyMarkers(doc, pts, cToX, eToY)

  // ==========================================================
  // KEY ELEVATION LABELS
  // ==========================================================
  drawKeyLabels(doc, pts, cToX, eToY)

  // ==========================================================
  // LEGEND
  // ==========================================================
  if (data.showDesignLevel) {
    drawLegend(doc, DA)
  }

  // ==========================================================
  // LEVEL TABLE
  // ==========================================================
  const tblX = DA.l
  const tblW = DA.w
  const colW = tblW / 5
  const tblStartY = DA_B + 12
  const tblHeadH = 7
  const tblRowH = 5.2

  // How many rows fit on page 1 before summary / cert / footer?
  const fixedBlock = 42 // summary + cert + footer + gaps
  const maxRowsP1 = Math.max(
    1,
    Math.floor((PH - tblStartY - tblHeadH - fixedBlock) / tblRowH),
  )
  const showRowsP1 = Math.min(pts.length, maxRowsP1)
  const needMorePages = pts.length > showRowsP1

  drawTableHeader(doc, tblX, tblStartY, colW, tblHeadH)
  drawTableRows(
    doc,
    pts,
    data,
    tblX,
    tblStartY + tblHeadH,
    colW,
    tblRowH,
    0,
    showRowsP1,
  )
  drawTableBorder(
    doc,
    tblX,
    tblStartY,
    colW,
    tblHeadH,
    showRowsP1,
    tblRowH,
  )

  if (needMorePages) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(5.5)
    doc.setTextColor(...DKGRAY)
    doc.text(
      `\u2026 ${pts.length - showRowsP1} more row(s) on subsequent page(s)`,
      tblX + tblW,
      tblStartY + tblHeadH + showRowsP1 * tblRowH + 3,
      { align: 'right' },
    )
  }

  // ==========================================================
  // CONTINUATION PAGES (table only)
  // ==========================================================
  let contPageNum = 2
  let remIdx = showRowsP1
  while (remIdx < pts.length) {
    doc.addPage([PW, PH], 'landscape')
    const contHeaderY = 10

    // Mini header bar
    doc.setFillColor(...NAVY)
    doc.rect(0, 0, PW, 16, 'F')
    doc.setTextColor(...WHITE)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text(
      `${data.title} \u2014 Level Table (continued)`,
      PW / 2,
      7,
      { align: 'center' },
    )
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.text(`Page ${contPageNum}`, PW - 12, 7, { align: 'right' })

    const contTableY = 20
    const contMaxRows = Math.floor((PH - contTableY - 20) / tblRowH)
    const contRows = Math.min(contMaxRows, pts.length - remIdx)

    drawTableHeader(doc, tblX, contTableY, colW, tblHeadH)
    drawTableRows(
      doc,
      pts,
      data,
      tblX,
      contTableY + tblHeadH,
      colW,
      tblRowH,
      remIdx,
      contRows,
    )
    drawTableBorder(
      doc,
      tblX,
      contTableY,
      colW,
      tblHeadH,
      contRows,
      tblRowH,
    )

    // Footer on continuation page
    doc.setFontSize(5.5)
    doc.setTextColor(...GRAY)
    doc.setFont('helvetica', 'italic')
    doc.text(
      'Generated by METARDU',
      PW / 2,
      PH - 5,
      { align: 'center' },
    )

    remIdx += contRows
    contPageNum++
  }

  // ==========================================================
  // SUMMARY STATISTICS (on page 1)
  // ==========================================================
  doc.setPage(1)
  const sumY =
    tblStartY + tblHeadH + showRowsP1 * tblRowH + (needMorePages ? 6 : 3)
  drawSummary(doc, data, pts, sumY, tblX, tblW)

  // ==========================================================
  // CERTIFICATION BLOCK (on page 1)
  // ==========================================================
  const certY = sumY + 22
  drawCertification(doc, data, certY, tblX, tblW)

  // ==========================================================
  // NOTES (if provided)
  // ==========================================================
  if (data.notes) {
    const notesY = certY + 28
    if (notesY < PH - 12) {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(6)
      doc.setTextColor(...DKGRAY)
      doc.text(`Notes: ${data.notes}`, tblX + 3, notesY)
    }
  }

  // ==========================================================
  // FOOTER — page numbers + watermark on every page
  // ==========================================================
  const totalPages = doc.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)

    const fy = PH - 8

    // Separator line
    doc.setDrawColor(...GRAY)
    doc.setLineWidth(0.2)
    doc.line(10, fy - 1.5, PW - 10, fy - 1.5)

    // Watermark
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(6)
    doc.setTextColor(150, 150, 150)
    doc.text(
      'Generated by METARDU \u2014 Land Surveying Platform',
      PW / 2,
      fy + 1.5,
      { align: 'center' },
    )

    // Page number
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...DKGRAY)
    doc.text(`Page ${p} of ${totalPages}`, PW - 12, fy + 1.5, {
      align: 'right',
    })
  }

  // Reset state
  doc.setTextColor(0, 0, 0)

  return doc.output('arraybuffer') as unknown as Uint8Array
}

// ============================================================
// DRAWING SUB-ROUTINES
// ============================================================

// ────────────────────────────────────────────────────────────
// HEADER
// ────────────────────────────────────────────────────────────

function drawHeader(doc: jsPDF, data: CrossSectionData): void {
  // Navy background bar
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, PW, 40, 'F')

  // Title line
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...WHITE)
  doc.text(
    'REPUBLIC OF KENYA \u2014 MINISTRY OF LANDS, HOUSING & URBAN DEVELOPMENT',
    PW / 2,
    8,
    { align: 'center' },
  )

  // Thin rule
  doc.setDrawColor(...WHITE)
  doc.setLineWidth(0.25)
  doc.line(10, 11, PW - 10, 11)

  // Project info row 1
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'normal')
  doc.text(`Project: ${data.projectName}`, 12, 16)
  doc.text(`Doc#: ${data.documentNumber}`, PW - 12, 16, { align: 'right' })

  // Project info row 2
  doc.text(`Project No: ${data.projectNumber}`, 12, 21)
  doc.text(`Date: ${data.surveyDate}`, PW - 12, 21, { align: 'right' })

  // Profile title (centred, bold)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(data.title, PW / 2, 27, { align: 'center' })

  // Scale / datum line
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  const scaleLine = [
    `H: 1:${data.horizontalScale}`,
    `V: 1:${data.verticalScale}`,
    `V.Exag: ${data.verticalExaggeration}\u00d7`,
    `Datum: ${data.datum}`,
    `Type: ${data.profileType.replace('_', ' ')}`,
  ].join('    |    ')
  doc.text(scaleLine, PW / 2, 33, { align: 'center' })

  // Design description (if any)
  if (data.designDescription) {
    doc.setFontSize(6.5)
    doc.setFont('helvetica', 'italic')
    doc.text(`Design: ${data.designDescription}`, PW / 2, 37, {
      align: 'center',
    })
  }
}

// ────────────────────────────────────────────────────────────
// MINOR GRID (dashed, lighter)
// ────────────────────────────────────────────────────────────

function drawMinorGrid(
  doc: jsPDF,
  DA: DrawingArea,
  cToX: (c: number) => number,
  eToY: (e: number) => number,
  cMin: number,
  cMax: number,
  eEffMin: number,
  eEffMax: number,
  cMajor: number,
  cMinor: number,
  eMajInt: number,
  eMinInt: number,
): void {
  doc.setDrawColor(...LTGRAY)
  doc.setLineWidth(0.08)

  // Chainage minor grid (skip lines that coincide with major)
  let cStart = Math.ceil(cMin / cMinor) * cMinor
  for (let c = cStart; c <= cMax; c += cMinor) {
    if (cMajor > 0 && Math.abs(c % cMajor) < 0.001) continue
    const x = cToX(c)
    if (x < DA.l || x > DA.l + DA.w) continue
    doc.line(x, DA.t, x, DA.t + DA.h)
  }

  // Elevation minor grid
  let eStart = Math.ceil(eEffMin / eMinInt) * eMinInt
  for (let e = eStart; e <= eEffMax; e += eMinInt) {
    if (eMajInt > 0 && Math.abs(e % eMajInt) < 0.0001) continue
    const y = eToY(e)
    if (y < DA.t || y > DA.t + DA.h) continue
    doc.line(DA.l, y, DA.l + DA.w, y)
  }
}

// ────────────────────────────────────────────────────────────
// MAJOR GRID (solid, darker)
// ────────────────────────────────────────────────────────────

function drawMajorGrid(
  doc: jsPDF,
  DA: DrawingArea,
  cToX: (c: number) => number,
  eToY: (e: number) => number,
  cMin: number,
  cMax: number,
  eEffMin: number,
  eEffMax: number,
  cMajor: number,
  cMinor: number,
  eMajInt: number,
  eMinInt: number,
): void {
  doc.setDrawColor(...GRAY)
  doc.setLineWidth(0.2)

  const prec = elevPrecision(eMajInt)

  // Chainage major grid + labels
  let cStart = Math.ceil(cMin / cMajor) * cMajor
  for (let c = cStart; c <= cMax; c += cMajor) {
    const x = cToX(c)
    if (x < DA.l || x > DA.l + DA.w) continue
    doc.line(x, DA.t, x, DA.t + DA.h)

    // Tick mark below drawing area
    doc.setDrawColor(...BLACK)
    doc.setLineWidth(0.2)
    doc.line(x, DA.t + DA.h, x, DA.t + DA.h + 2)

    // Label
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(...DKGRAY)
    doc.text(fmtChainage(c), x, DA.t + DA.h + 4, { align: 'center' })

    // Minor ticks between major
    doc.setDrawColor(...LTGRAY)
    doc.setLineWidth(0.1)
    const minorCount = cMajor / cMinor
    for (let m = 1; m < minorCount; m++) {
      const mc = c + m * cMinor
      const mx = cToX(mc)
      if (mx >= DA.l && mx <= DA.l + DA.w) {
        doc.line(mx, DA.t + DA.h, mx, DA.t + DA.h + 1)
      }
    }
  }

  // Elevation major grid + labels
  doc.setDrawColor(...GRAY)
  doc.setLineWidth(0.2)
  let eStart = Math.ceil(eEffMin / eMajInt) * eMajInt
  for (let e = eStart; e <= eEffMax; e += eMajInt) {
    const y = eToY(e)
    if (y < DA.t || y > DA.t + DA.h) continue
    doc.line(DA.l, y, DA.l + DA.w, y)

    // Tick mark to the left of drawing area
    doc.setDrawColor(...BLACK)
    doc.setLineWidth(0.2)
    doc.line(DA.l - 2, y, DA.l, y)

    // Label
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(...DKGRAY)
    doc.text(e.toFixed(prec), DA.l - 3, y + 2, { align: 'right' })

    // Minor ticks
    doc.setDrawColor(...LTGRAY)
    doc.setLineWidth(0.1)
    for (let m = 1; m < 5; m++) {
      const me = e + m * eMinInt
      const my = eToY(me)
      if (my >= DA.t && my <= DA.t + DA.h) {
        doc.line(DA.l - 1, my, DA.l, my)
      }
    }
  }
}

// ────────────────────────────────────────────────────────────
// AXIS TITLES
// ────────────────────────────────────────────────────────────

function drawAxisTitles(doc: jsPDF, DA: DrawingArea): void {
  doc.setTextColor(...BLACK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)

  // X-axis title (chainage)
  doc.text('CHAINAGE (m)', DA.l + DA.w / 2, DA.t + DA.h + 9, {
    align: 'center',
  })

  // Y-axis title (elevation) — rotated
  doc.text('ELEVATION (m)', DA.l - 9, DA.t + DA.h / 2, {
    align: 'center',
    angle: 90,
  })
}

// ────────────────────────────────────────────────────────────
// CUT / FILL SHADING
// ────────────────────────────────────────────────────────────

function drawCutFillShading(
  doc: jsPDF,
  pts: CrossSectionPoint[],
  cToX: (c: number) => number,
  eToY: (e: number) => number,
): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i]
    const p2 = pts[i + 1]
    if (p1.designLevel == null || p2.designLevel == null) continue

    const x1 = cToX(p1.chainage)
    const x2 = cToX(p2.chainage)
    const yg1 = eToY(p1.elevation)
    const yg2 = eToY(p2.elevation)
    const yd1 = eToY(p1.designLevel!)
    const yd2 = eToY(p2.designLevel!)

    // Average cut/fill for this segment
    const avg =
      (p1.elevation - p1.designLevel! + p2.elevation - p2.designLevel!) / 2

    const color: RGB =
      avg > 0.005 ? CUT_SHADE : avg < -0.005 ? FILL_SHADE : VLTGRAY

    doc.setFillColor(...color)

    // Draw as two triangles (a quad split along one diagonal)
    doc.triangle(x1, yg1, x2, yg2, x2, yd2, 'F')
    doc.triangle(x1, yg1, x2, yd2, x1, yd1, 'F')
  }
}

// ────────────────────────────────────────────────────────────
// GROUND PROFILE LINE
// ────────────────────────────────────────────────────────────

function drawGroundProfile(
  doc: jsPDF,
  pts: CrossSectionPoint[],
  cToX: (c: number) => number,
  eToY: (e: number) => number,
): void {
  doc.setDrawColor(...GROUND_CLR)
  doc.setLineWidth(0.7)
  doc.setLineDashPattern([], 0)

  for (let i = 0; i < pts.length - 1; i++) {
    const x1 = cToX(pts[i].chainage)
    const y1 = eToY(pts[i].elevation)
    const x2 = cToX(pts[i + 1].chainage)
    const y2 = eToY(pts[i + 1].elevation)
    doc.line(x1, y1, x2, y2)
  }
}

// ────────────────────────────────────────────────────────────
// DESIGN LINE
// ────────────────────────────────────────────────────────────

function drawDesignLine(
  doc: jsPDF,
  pts: CrossSectionPoint[],
  cToX: (c: number) => number,
  eToY: (e: number) => number,
): void {
  const designPts = pts.filter((p) => p.designLevel != null)
  if (designPts.length < 2) return

  doc.setDrawColor(...DESIGN_CLR)
  doc.setLineWidth(0.5)
  doc.setLineDashPattern([3, 2], 0)

  for (let i = 0; i < designPts.length - 1; i++) {
    const x1 = cToX(designPts[i].chainage)
    const y1 = eToY(designPts[i].designLevel!)
    const x2 = cToX(designPts[i + 1].chainage)
    const y2 = eToY(designPts[i + 1].designLevel!)
    doc.line(x1, y1, x2, y2)
  }

  // Reset dash
  doc.setLineDashPattern([], 0)
}

// ────────────────────────────────────────────────────────────
// SURVEY POINT MARKERS
// ────────────────────────────────────────────────────────────

function drawSurveyMarkers(
  doc: jsPDF,
  pts: CrossSectionPoint[],
  cToX: (c: number) => number,
  eToY: (e: number) => number,
): void {
  pts.forEach((p) => {
    const x = cToX(p.chainage)
    const y = eToY(p.elevation)

    // Filled circle
    doc.setFillColor(...GROUND_CLR)
    doc.circle(x, y, 1.4, 'F')

    // Thin border
    doc.setDrawColor(...BLACK)
    doc.setLineWidth(0.12)
    doc.circle(x, y, 1.4, 'S')
  })
}

// ────────────────────────────────────────────────────────────
// KEY ELEVATION LABELS (highest, lowest, grade-change points)
// ────────────────────────────────────────────────────────────

function drawKeyLabels(
  doc: jsPDF,
  pts: CrossSectionPoint[],
  cToX: (c: number) => number,
  eToY: (e: number) => number,
): void {
  if (pts.length < 2) return

  const labelled = new Set<CrossSectionPoint>()

  // Highest and lowest
  const highest = pts.reduce((a, b) =>
    a.elevation > b.elevation ? a : b,
  )
  const lowest = pts.reduce((a, b) =>
    a.elevation < b.elevation ? a : b,
  )
  labelled.add(highest)
  labelled.add(lowest)

  // Points with significant grade change (> 1 % between neighbours)
  for (let i = 1; i < pts.length - 1; i++) {
    const g1 = gradeBetween(pts[i - 1], pts[i])
    const g2 = gradeBetween(pts[i], pts[i + 1])
    if (Math.abs(g2 - g1) > 1) labelled.add(pts[i])
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(5)

  labelled.forEach((p) => {
    const x = cToX(p.chainage)
    const y = eToY(p.elevation)
    const label = p.elevation.toFixed(2)
    const tw = doc.getTextWidth(label)

    // Background pill
    doc.setFillColor(255, 255, 255)
    doc.setDrawColor(200, 200, 200)
    doc.setLineWidth(0.12)
    doc.roundedRect(x - tw / 2 - 0.8, y - 8, tw + 1.6, 4.2, 0.6, 0.6, 'FD')

    // Text
    doc.setTextColor(...BLACK)
    doc.text(label, x, y - 5, { align: 'center' })
  })
}

// ────────────────────────────────────────────────────────────
// LEGEND (inside drawing area, top-right)
// ────────────────────────────────────────────────────────────

function drawLegend(doc: jsPDF, DA: DrawingArea): void {
  const lgX = DA.l + DA.w - 68
  const lgY = DA.t + 5
  const lgW = 63
  const lgH = 22

  // Background
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(...GRAY)
  doc.setLineWidth(0.2)
  doc.roundedRect(lgX, lgY, lgW, lgH, 1.5, 1.5, 'FD')

  doc.setFontSize(5.5)
  doc.setTextColor(...BLACK)

  // Ground line legend
  doc.setDrawColor(...GROUND_CLR)
  doc.setLineWidth(0.7)
  doc.line(lgX + 4, lgY + 5, lgX + 16, lgY + 5)
  doc.setFont('helvetica', 'normal')
  doc.text('Ground Level', lgX + 19, lgY + 6.5)

  // Design line legend
  doc.setDrawColor(...DESIGN_CLR)
  doc.setLineWidth(0.5)
  doc.setLineDashPattern([2, 1.5], 0)
  doc.line(lgX + 4, lgY + 10, lgX + 16, lgY + 10)
  doc.setLineDashPattern([], 0)
  doc.text('Design Level', lgX + 19, lgY + 11.5)

  // Cut / Fill swatches
  doc.setFillColor(...CUT_SHADE)
  doc.rect(lgX + 4, lgY + 14.5, 5, 3.5, 'F')
  doc.setDrawColor(...GRAY)
  doc.setLineWidth(0.1)
  doc.rect(lgX + 4, lgY + 14.5, 5, 3.5, 'S')

  doc.setFillColor(...FILL_SHADE)
  doc.rect(lgX + 12, lgY + 14.5, 5, 3.5, 'F')
  doc.rect(lgX + 12, lgY + 14.5, 5, 3.5, 'S')

  doc.text('Cut', lgX + 21, lgY + 17)
  doc.text('Fill', lgX + 30, lgY + 17)

  // Survey point marker
  doc.setFillColor(...GROUND_CLR)
  doc.circle(lgX + 42, lgY + 16, 1.4, 'F')
  doc.text('Survey Pt', lgX + 46, lgY + 17)
}

// ────────────────────────────────────────────────────────────
// TABLE HEADER
// ────────────────────────────────────────────────────────────

const TBL_HEADERS = [
  'Chainage',
  'Ground Level (m)',
  'Design Level (m)',
  'Cut / Fill (m)',
  'Grade (%)',
]

function drawTableHeader(
  doc: jsPDF,
  x: number,
  y: number,
  colW: number,
  h: number,
): void {
  doc.setFillColor(...NAVY)
  doc.rect(x, y, colW * 5, h, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  doc.setTextColor(...WHITE)

  TBL_HEADERS.forEach((th, i) => {
    doc.text(th, x + colW * i + colW / 2, y + h / 2 + 1.8, {
      align: 'center',
    })
  })
}

// ────────────────────────────────────────────────────────────
// TABLE ROWS
// ────────────────────────────────────────────────────────────

function drawTableRows(
  doc: jsPDF,
  pts: CrossSectionPoint[],
  data: CrossSectionData,
  x: number,
  startY: number,
  colW: number,
  rowH: number,
  startIdx: number,
  count: number,
): void {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)

  for (let j = 0; j < count; j++) {
    const i = startIdx + j
    const p = pts[i]
    const y = startY + j * rowH
    const midY = y + rowH / 2 + 1.5

    // Alternating row background
    if (j % 2 === 1) {
      doc.setFillColor(...TBL_ALT)
      doc.rect(x, y, colW * 5, rowH, 'F')
    }

    // Column 1 — Chainage
    doc.setTextColor(...BLACK)
    doc.text(fmtChainage(p.chainage), x + colW * 0 + colW / 2, midY, {
      align: 'center',
    })

    // Column 2 — Ground Level
    doc.text(
      p.elevation.toFixed(3),
      x + colW * 1 + colW / 2,
      midY,
      { align: 'center' },
    )

    // Column 3 — Design Level
    if (p.designLevel != null) {
      doc.text(
        p.designLevel.toFixed(3),
        x + colW * 2 + colW / 2,
        midY,
        { align: 'center' },
      )
    } else {
      doc.setTextColor(...GRAY)
      doc.text('\u2014', x + colW * 2 + colW / 2, midY, {
        align: 'center',
      })
    }

    // Column 4 — Cut / Fill
    if (p.designLevel != null) {
      const cf = p.elevation - p.designLevel
      if (cf > 0.001) {
        doc.setTextColor(170, 0, 0) // red for cut
        doc.text(`C ${cf.toFixed(3)}`, x + colW * 3 + colW / 2, midY, {
          align: 'center',
        })
      } else if (cf < -0.001) {
        doc.setTextColor(0, 0, 170) // blue for fill
        doc.text(
          `F ${Math.abs(cf).toFixed(3)}`,
          x + colW * 3 + colW / 2,
          midY,
          { align: 'center' },
        )
      } else {
        doc.setTextColor(...DKGRAY)
        doc.text('\u2014', x + colW * 3 + colW / 2, midY, {
          align: 'center',
        })
      }
    } else {
      doc.setTextColor(...GRAY)
      doc.text('\u2014', x + colW * 3 + colW / 2, midY, {
        align: 'center',
      })
    }

    // Column 5 — Grade
    if (i > 0) {
      const g = gradeBetween(pts[i - 1], p)
      if (g > 0.005) {
        doc.setTextColor(0, 120, 0) // green for rising
        doc.text(`+${g.toFixed(2)}`, x + colW * 4 + colW / 2, midY, {
          align: 'center',
        })
      } else if (g < -0.005) {
        doc.setTextColor(170, 0, 0) // red for falling
        doc.text(`${g.toFixed(2)}`, x + colW * 4 + colW / 2, midY, {
          align: 'center',
        })
      } else {
        doc.setTextColor(...DKGRAY)
        doc.text('0.00', x + colW * 4 + colW / 2, midY, {
          align: 'center',
        })
      }
    } else {
      doc.setTextColor(...GRAY)
      doc.text('\u2014', x + colW * 4 + colW / 2, midY, {
        align: 'center',
      })
    }
  }
}

// ────────────────────────────────────────────────────────────
// TABLE BORDER
// ────────────────────────────────────────────────────────────

function drawTableBorder(
  doc: jsPDF,
  x: number,
  y: number,
  colW: number,
  headH: number,
  rowCount: number,
  rowH: number,
): void {
  const totalW = colW * 5
  const totalH = headH + rowCount * rowH

  // Outer border
  doc.setDrawColor(...GRAY)
  doc.setLineWidth(0.25)
  doc.rect(x, y, totalW, totalH)

  // Vertical separators
  for (let c = 1; c < 5; c++) {
    doc.line(x + colW * c, y, x + colW * c, y + totalH)
  }

  // Header / body separator
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.3)
  doc.line(x, y + headH, x + totalW, y + headH)

  // Horizontal row separators
  doc.setDrawColor(...BORDER)
  doc.setLineWidth(0.08)
  for (let r = 1; r < rowCount; r++) {
    const ry = y + headH + r * rowH
    doc.line(x, ry, x + totalW, ry)
  }
}

// ────────────────────────────────────────────────────────────
// SUMMARY STATISTICS
// ────────────────────────────────────────────────────────────

function drawSummary(
  doc: jsPDF,
  data: CrossSectionData,
  pts: CrossSectionPoint[],
  y: number,
  x: number,
  w: number,
): void {
  // Background
  doc.setFillColor(248, 250, 254)
  doc.setDrawColor(...BORDER)
  doc.setLineWidth(0.2)
  doc.rect(x, y, w, 18, 'FD')

  // Section label
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...NAVY)
  doc.text('SUMMARY', x + 4, y + 4.5)

  // Statistics
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...BLACK)

  const totalLen = pts[pts.length - 1].chainage - pts[0].chainage
  const allElevs = pts.map((p) => p.elevation)
  const maxE = Math.max(...allElevs)
  const minE = Math.min(...allElevs)
  const avgGrade =
    totalLen > 0 ? ((pts[pts.length - 1].elevation - pts[0].elevation) / totalLen) * 100 : 0

  // Row 1
  const r1y = y + 9
  doc.text(`Total Length: ${totalLen.toFixed(1)} m`, x + 4, r1y)
  doc.text(`Max Elev: ${maxE.toFixed(3)} m`, x + 80, r1y)
  doc.text(`Min Elev: ${minE.toFixed(3)} m`, x + 160, r1y)
  doc.text(
    `Avg Grade: ${avgGrade >= 0 ? '+' : ''}${avgGrade.toFixed(2)}%`,
    x + 240,
    r1y,
  )

  // Row 2 — Cut / Fill volumes (if design levels provided)
  if (data.showDesignLevel) {
    let totalCut = 0
    let totalFill = 0
    const fw = data.formationWidth || 1

    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i]
      const p2 = pts[i + 1]
      if (p1.designLevel == null || p2.designLevel == null) continue

      const a1 = Math.abs(p1.elevation - p1.designLevel) * fw
      const a2 = Math.abs(p2.elevation - p2.designLevel) * fw
      const len = p2.chainage - p1.chainage
      const vol = ((a1 + a2) / 2) * len

      const avg = (p1.elevation - p1.designLevel + p2.elevation - p2.designLevel) / 2
      if (avg > 0) totalCut += vol
      else totalFill += vol
    }

    const r2y = y + 14.5
    doc.text(`Total Cut: ${totalCut.toFixed(1)} m\u00b3`, x + 4, r2y)
    doc.text(`Total Fill: ${totalFill.toFixed(1)} m\u00b3`, x + 80, r2y)
    const net = totalCut - totalFill
    doc.text(
      `Net: ${net >= 0 ? '+' : ''}${net.toFixed(1)} m\u00b3`,
      x + 160,
      r2y,
    )
    if (data.formationWidth) {
      doc.text(
        `Formation Width: ${data.formationWidth} m`,
        x + 240,
        r2y,
      )
    }
    if (data.crossSectionInterval) {
      doc.text(
        `Section Intvl: ${data.crossSectionInterval}m (RDM 1.1 \u00a75.6.2)`,
        x + 320,
        r2y,
      )
    }
  }
}

// ────────────────────────────────────────────────────────────
// CERTIFICATION BLOCK
// ────────────────────────────────────────────────────────────

function drawCertification(
  doc: jsPDF,
  data: CrossSectionData,
  y: number,
  x: number,
  w: number,
): void {
  // Border
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.3)
  doc.rect(x, y, w, 24, 'S')

  // Title
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...NAVY)
  doc.text('SURVEYOR CERTIFICATION', x + w / 2, y + 5, {
    align: 'center',
  })

  // Certification statement
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(6)
  doc.setTextColor(...DKGRAY)
  doc.text(
    'I hereby certify that this profile was prepared by me from actual field survey data and is true and correct to the best of my knowledge.',
    x + w / 2,
    y + 9.5,
    { align: 'center', maxWidth: w - 20 },
  )

  // Surveyor details
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...BLACK)

  doc.text(`Surveyor: ${data.surveyorName}`, x + 12, y + 14)
  doc.text(`ISK No: ${data.iskNumber}`, x + w / 2 + 12, y + 14)
  doc.text(`Firm: ${data.firmName}`, x + w - 12, y + 14, {
    align: 'right',
  })

  // Signature lines
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.15)
  doc.line(x + 12, y + 18.5, x + 85, y + 18.5)
  doc.line(x + w / 2 + 12, y + 18.5, x + w / 2 + 85, y + 18.5)
  doc.line(x + w - 120, y + 18.5, x + w - 12, y + 18.5)

  doc.setFont('helvetica', 'italic')
  doc.setFontSize(5.5)
  doc.setTextColor(...GRAY)
  doc.text('Signature', x + 38, y + 21, { align: 'center' })
  doc.text('Date', x + w / 2 + 38, y + 21, { align: 'center' })
  doc.text('Stamp', x + w - 66, y + 21, { align: 'center' })
}
