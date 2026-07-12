// ============================================================
// METARDU — Beacon Description PDF Generator
// Official beacon description documents for Kenya's cadastral
// system under the Survey Act (Cap 299) and Survey
// Regulations L.N. 168/1994.
//
// A4 Portrait, 12 mm margins, navy government styling.
// No external table library required — manual jsPDF drawing.
//
// Usage:
//   import { generateBeaconDescriptionPdf } from './beaconDescriptionPdf'
//   const pdf = generateBeaconDescriptionPdf(data)
//   // pdf is a Uint8Array — send as response, save to disk, etc.
// ============================================================

import jsPDF from 'jspdf'

// ── Public interface ───────────────────────────────────────────

export interface BeaconDescriptionData {
  // Document metadata
  documentNumber: string        // e.g. "BD/2026/042"
  documentType: string          // e.g. "Beacon Description" or "Beacon Schedule"

  // Survey/Plan details
  planNumber: string            // e.g. "DP 123456"
  surveyDate: string
  surveyorName: string
  iskNumber: string             // ISK registration number
  firmName: string

  // Location
  county: string
  area: string                  // e.g. "Machakos Municipality"
  registrySection: string       // e.g. "Section II"
  parcelNumber: string          // e.g. "LR 123/456"

  // Datum/Projection
  datum: string                 // e.g. "Arc 1960"
  projection: string            // e.g. "UTM Zone 37S"

  // Beacons
  beacons: Array<{
    beaconNumber: string        // e.g. "A123" or "BM 1"
    description: string         // e.g. "Concrete pillar 0.3m x 0.3m at ground level"
    easting: number
    northing: number
    elevation?: number
    mark: string                // e.g. "CSM" (copper spike in mortar), "IP" (iron pipe)
    foundStatus: 'ORIGINAL' | 'FOUND' | 'NOT FOUND' | 'REPLACED' | 'NEW'
    Remarks: string
  }>

  // Certification
  checkedByName?: string
  checkedByTitle?: string
  checkedByDate?: string
}

// ── Page constants ─────────────────────────────────────────────

const PAGE_W = 210
const PAGE_H = 297
const MARGIN_L = 12
const MARGIN_R = 12
const MARGIN_T = 12
const MARGIN_B = 12
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R  // 186 mm

// Colour palette
const NAVY: [number, number, number] = [27, 58, 92]
const LIGHT_GREY: [number, number, number] = [240, 242, 245]
const WHITE: [number, number, number] = [255, 255, 255]
const BLACK: [number, number, number] = [0, 0, 0]
const BORDER_GREY: [number, number, number] = [190, 195, 200]

// Status colour map (fill behind the status cell)
const STATUS_COLOURS: Record<string, [number, number, number]> = {
  ORIGINAL:   [200, 230, 201],   // green tint
  FOUND:      [187, 222, 251],   // blue tint
  'NOT FOUND': [255, 205, 210],  // red tint
  REPLACED:   [255, 224, 178],   // orange tint
  NEW:        [225, 190, 231],   // purple tint
}

// Beacon schedule column widths (sum = CONTENT_W = 186 mm)
const COL = {
  no:         8,
  beaconNo:   22,
  desc:       42,
  easting:    22,
  northing:   22,
  elevation:  16,
  mark:       14,
  status:     18,
  remarks:    22,
} as const
const COL_KEYS = Object.keys(COL) as (keyof typeof COL)[]
const COL_WIDTHS = COL_KEYS.map(k => COL[k])
const TOTAL_COL_W = COL_WIDTHS.reduce((a, b) => a + b, 0) // 186

// ── Main export ────────────────────────────────────────────────

export function generateBeaconDescriptionPdf(
  data: BeaconDescriptionData,
): Uint8Array {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  })

  let y = 0

  // ── Helper: page footer ────────────────────────────────────
  function addFooter(pageNum: number, totalPages: number): void {
    const fy = PAGE_H - 7
    // Watermark
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(6.5)
    doc.setTextColor(140, 140, 140)
    doc.text(
      'BEACON DESCRIPTION \u2014 METARDU Generated',
      PAGE_W / 2,
      fy,
      { align: 'center' },
    )
    // Page number
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(100, 100, 100)
    doc.text(
      `Page ${pageNum} of ${totalPages}`,
      PAGE_W - MARGIN_R,
      fy,
      { align: 'right' },
    )
    doc.setTextColor(0, 0, 0)
  }

  // ── Helper: navy section header bar ────────────────────────
  function sectionBar(title: string): void {
    if (y > PAGE_H - MARGIN_B - 50) {
      doc.addPage()
      y = MARGIN_T + 4
    }
    doc.setFillColor(...NAVY)
    doc.rect(MARGIN_L, y, CONTENT_W, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...WHITE)
    doc.text(title, MARGIN_L + 3, y + 5)
    doc.setTextColor(0, 0, 0)
    y += 10
  }

  // ── Helper: full-width horizontal rule ─────────────────────
  function rule(lineW = 0.3): void {
    doc.setDrawColor(...NAVY)
    doc.setLineWidth(lineW)
    doc.line(MARGIN_L, y, PAGE_W - MARGIN_R, y)
    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(0.2)
  }

  // ── Helper: 2-column label-value row ───────────────────────
  function kvRow(
    l1: string, v1: string,
    l2?: string, v2?: string,
  ): void {
    if (y > PAGE_H - MARGIN_B - 20) {
      doc.addPage()
      y = MARGIN_T + 4
    }
    const rowH = 7
    const colW = CONTENT_W / 2
    const labelW = colW * 0.42

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)

    // Left column
    doc.setFillColor(...LIGHT_GREY)
    doc.rect(MARGIN_L, y, labelW, rowH, 'F')
    doc.rect(MARGIN_L + labelW, y, colW - labelW, rowH, 'F')
    doc.text(l1, MARGIN_L + 2, y + 5)
    doc.setFont('helvetica', 'normal')
    doc.text(v1 || '\u2014', MARGIN_L + labelW + 2, y + 5)

    // Right column
    if (l2 !== undefined) {
      doc.setFillColor(...LIGHT_GREY)
      doc.rect(MARGIN_L + colW, y, labelW, rowH, 'F')
      doc.rect(MARGIN_L + colW + labelW, y, colW - labelW, rowH, 'F')
      doc.setFont('helvetica', 'bold')
      doc.text(l2, MARGIN_L + colW + 2, y + 5)
      doc.setFont('helvetica', 'normal')
      doc.text(v2 || '\u2014', MARGIN_L + colW + labelW + 2, y + 5)
    }

    // Borders
    doc.setDrawColor(...BORDER_GREY)
    doc.setLineWidth(0.15)
    doc.rect(MARGIN_L, y, CONTENT_W, rowH, 'S')
    doc.line(MARGIN_L + colW, y, MARGIN_L + colW, y + rowH)
    doc.line(MARGIN_L + labelW, y, MARGIN_L + labelW, y + rowH)
    if (l2 !== undefined) {
      doc.line(MARGIN_L + colW + labelW, y, MARGIN_L + colW + labelW, y + rowH)
    }
    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(0.2)

    y += rowH
  }

  // ════════════════════════════════════════════════════════════
  // 1. GOVERNMENT HEADER
  // ════════════════════════════════════════════════════════════

  y = MARGIN_T + 4

  // Coat of arms placeholder box
  const armsW = 18
  const armsH = 18
  const armsX = PAGE_W / 2 - armsW / 2
  doc.setDrawColor(...NAVY)
  doc.setLineWidth(0.35)
  doc.rect(armsX, y, armsW, armsH, 'S')
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(5.5)
  doc.setTextColor(120, 120, 120)
  doc.text('COAT OF ARMS', PAGE_W / 2, y + armsH / 2 + 2, { align: 'center' })
  doc.setTextColor(0, 0, 0)
  y += armsH + 4

  // Government text
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('REPUBLIC OF KENYA', PAGE_W / 2, y, { align: 'center' })
  y += 6.5

  doc.setFontSize(10.5)
  doc.text('MINISTRY OF LANDS AND PHYSICAL PLANNING', PAGE_W / 2, y, { align: 'center' })
  y += 6

  doc.setFontSize(10)
  doc.text('SURVEY OF KENYA', PAGE_W / 2, y, { align: 'center' })
  y += 7

  rule(0.5)
  y += 5

  // Document title bar
  const titleText = data.documentType.toUpperCase()
  doc.setFillColor(...NAVY)
  doc.rect(MARGIN_L, y, CONTENT_W, 11, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...WHITE)
  doc.text(titleText, PAGE_W / 2, y + 8, { align: 'center' })
  doc.setTextColor(0, 0, 0)
  y += 14

  // Document reference line
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text(`Document No: ${data.documentNumber}`, MARGIN_L, y)
  doc.text(`Date: ${data.surveyDate}`, PAGE_W - MARGIN_R, y, { align: 'right' })
  y += 7

  rule(0.25)
  y += 5

  // ════════════════════════════════════════════════════════════
  // 2. PLAN / LOCATION DETAILS TABLE
  // ════════════════════════════════════════════════════════════

  sectionBar('PLAN AND LOCATION DETAILS')

  kvRow('Plan Number:', data.planNumber, 'Survey Date:', data.surveyDate)
  kvRow('Surveyor:', data.surveyorName, 'ISK Number:', data.iskNumber)
  kvRow('Firm:', data.firmName, 'County:', data.county)
  kvRow('Area:', data.area, 'Registry Section:', data.registrySection)
  kvRow('Parcel No:', data.parcelNumber, 'Datum:', data.datum)
  kvRow('Projection:', data.projection)

  y += 4

  // ════════════════════════════════════════════════════════════
  // 3. BEACON SCHEDULE TABLE
  // ════════════════════════════════════════════════════════════

  sectionBar('BEACON SCHEDULE')

  // Table dimensions
  const headerH = 7.5
  const rowH = 7
  const tableX = MARGIN_L
  const footerSpace = 52 // space reserved for summary + certification + page footer

  // Ensure we have room for at least the header + a few rows
  const minSpaceNeeded = headerH + rowH * 3 + footerSpace
  if (y + minSpaceNeeded > PAGE_H - MARGIN_B) {
    doc.addPage()
    y = MARGIN_T + 4
  }

  // ── Draw table header ─────────────────────────────────────
  doc.setFillColor(...NAVY)
  doc.rect(tableX, y, TOTAL_COL_W, headerH, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  doc.setTextColor(...WHITE)

  const headers = ['No.', 'Beacon No.', 'Description', 'Easting', 'Northing', 'Elev.', 'Mark', 'Status', 'Remarks']
  let cx = tableX
  headers.forEach((h, i) => {
    doc.text(h, cx + 1.5, y + headerH - 2)
    cx += COL_WIDTHS[i]
  })
  doc.setTextColor(0, 0, 0)

  // Border around header
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.25)
  doc.rect(tableX, y, TOTAL_COL_W, headerH, 'S')
  // Vertical lines in header
  cx = tableX
  for (let i = 0; i < COL_WIDTHS.length - 1; i++) {
    cx += COL_WIDTHS[i]
    doc.line(cx, y, cx, y + headerH)
  }
  y += headerH

  // ── Draw body rows with auto-page-break ───────────────────
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)

  data.beacons.forEach((beacon, idx) => {
    const num = String(idx + 1)
    const east = beacon.easting.toFixed(3)
    const north = beacon.northing.toFixed(3)
    const elev = beacon.elevation !== undefined ? beacon.elevation.toFixed(3) : '\u2014'

    // Truncate long description to fit cell (roughly 28 chars at 6.5pt in 42mm)
    const descText = beacon.description.length > 32
      ? beacon.description.substring(0, 30) + '..'
      : beacon.description

    const remarkText = beacon.Remarks.length > 18
      ? beacon.Remarks.substring(0, 16) + '..'
      : beacon.Remarks

    const cells = [
      num,
      beacon.beaconNumber,
      descText,
      east,
      north,
      elev,
      beacon.mark,
      beacon.foundStatus,
      remarkText,
    ]

    // Check if we need a new page
    if (y + rowH + footerSpace > PAGE_H - MARGIN_B) {
      // Bottom border of current page table fragment
      doc.setDrawColor(0, 0, 0)
      doc.setLineWidth(0.25)
      doc.line(tableX, y, tableX + TOTAL_COL_W, y)

      doc.addPage()
      y = MARGIN_T + 4

      // Redraw header on new page
      doc.setFillColor(...NAVY)
      doc.rect(tableX, y, TOTAL_COL_W, headerH, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      doc.setTextColor(...WHITE)
      cx = tableX
      headers.forEach((h, i) => {
        doc.text(h, cx + 1.5, y + headerH - 2)
        cx += COL_WIDTHS[i]
      })
      doc.setTextColor(0, 0, 0)
      doc.setDrawColor(0, 0, 0)
      doc.setLineWidth(0.25)
      doc.rect(tableX, y, TOTAL_COL_W, headerH, 'S')
      cx = tableX
      for (let i = 0; i < COL_WIDTHS.length - 1; i++) {
        cx += COL_WIDTHS[i]
        doc.line(cx, y, cx, y + headerH)
      }
      y += headerH

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
    }

    const isAlternate = idx % 2 === 1

    // Alternating row background
    if (isAlternate) {
      doc.setFillColor(...LIGHT_GREY)
      doc.rect(tableX, y, TOTAL_COL_W, rowH, 'F')
    }

    // Status colour highlight
    const statusColour = STATUS_COLOURS[beacon.foundStatus]
    if (statusColour) {
      let statusX = tableX
      for (let c = 0; c < 7; c++) {
        statusX += COL_WIDTHS[c]
      }
      doc.setFillColor(...statusColour)
      doc.rect(statusX, y, COL.status, rowH, 'F')
    }

    // Cell text
    cx = tableX
    cells.forEach((cell, ci) => {
      const w = COL_WIDTHS[ci]
      // Right-align numeric columns
      if (ci === 3 || ci === 4 || ci === 5) {
        doc.text(cell, cx + w - 1.5, y + rowH - 2, { align: 'right' })
      } else if (ci === 0) {
        doc.text(cell, cx + w / 2, y + rowH - 2, { align: 'center' })
      } else {
        doc.text(cell, cx + 1.5, y + rowH - 2)
      }
      cx += w
    })

    // Row bottom line
    doc.setDrawColor(...BORDER_GREY)
    doc.setLineWidth(0.12)
    doc.line(tableX, y + rowH, tableX + TOTAL_COL_W, y + rowH)

    // Vertical lines
    cx = tableX
    for (let i = 0; i < COL_WIDTHS.length - 1; i++) {
      cx += COL_WIDTHS[i]
      doc.line(cx, y, cx, y + rowH)
    }
    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(0.2)

    y += rowH
  })

  // Final table border
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.3)
  const tableH = headerH + data.beacons.length * rowH
  // We draw border around the entire table from the header start.
  // Since we track `y` incrementally, we capture the header start:
  // The header was drawn at y_before_header. Let's use a simpler approach:
  // Draw bottom border at current y, and left/right sides.
  doc.line(tableX, y, tableX + TOTAL_COL_W, y)  // bottom line
  doc.setLineWidth(0.2)

  // ════════════════════════════════════════════════════════════
  // 4. AREA SUMMARY
  // ════════════════════════════════════════════════════════════

  y += 6
  if (y + 28 > PAGE_H - MARGIN_B) {
    doc.addPage()
    y = MARGIN_T + 4
  }

  sectionBar('SUMMARY')

  // Count statuses
  const statusCounts: Record<string, number> = {}
  data.beacons.forEach(b => {
    const key = b.foundStatus
    statusCounts[key] = (statusCounts[key] || 0) + 1
  })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)

  const summaryLine1 = `Total Beacons: ${data.beacons.length}`
  doc.setFont('helvetica', 'bold')
  doc.text(summaryLine1, MARGIN_L + 2, y)
  y += 6

  // Status breakdown in two columns
  doc.setFont('helvetica', 'normal')
  const statuses = Object.entries(statusCounts)
  const half = Math.ceil(statuses.length / 2)
  let col1Y = y
  let col2Y = y

  statuses.forEach(([status, count], i) => {
    const col = i < half ? 0 : 1
    const colour = STATUS_COLOURS[status]
    const xPos = col === 0 ? MARGIN_L + 2 : MARGIN_L + CONTENT_W / 2 + 2
    const yPos = col === 0 ? col1Y : col2Y

    // Small colour swatch
    if (colour) {
      doc.setFillColor(...colour)
      doc.rect(xPos, yPos - 2.5, 3, 3, 'F')
    }
    doc.text(`${status}: ${count}`, xPos + 5, yPos)
    if (col === 0) col1Y += 5
    else col2Y += 5
  })

  y = Math.max(col1Y, col2Y) + 6

  // ════════════════════════════════════════════════════════════
  // 5. CERTIFICATION BLOCK
  // ════════════════════════════════════════════════════════════

  if (y + 42 > PAGE_H - MARGIN_B) {
    doc.addPage()
    y = MARGIN_T + 4
  }

  sectionBar('CERTIFICATION')

  // Certification text
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  const certLines = [
    'I certify that the above beacon descriptions are accurate and have been',
    'prepared in accordance with the Survey Act (Cap 299) and the Survey',
    'Regulations L.N. 168/1994. The coordinates are based on the datum and',
    'projection stated herein.',
  ]
  certLines.forEach((line: string) => {
    doc.text(line, MARGIN_L + 2, y)
    y += 4.5
  })
  y += 6

  // Surveyor signature block
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text('Licensed Surveyor:', MARGIN_L + 2, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text(data.surveyorName || '________________________', MARGIN_L + 36, y)

  doc.setFont('helvetica', 'bold')
  doc.text('ISK No:', MARGIN_L + 100, y)
  doc.setFont('helvetica', 'normal')
  doc.text(data.iskNumber || '________________________', MARGIN_L + 118, y)
  y += 5

  // Signature line
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.15)
  doc.line(MARGIN_L + 36, y + 1, MARGIN_L + 92, y + 1)
  doc.line(MARGIN_L + 118, y + 1, PAGE_W - MARGIN_R, y + 1)
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(6)
  doc.text('Signature', MARGIN_L + 56, y + 3, { align: 'center' })
  y += 8

  // Checked by block (if provided)
  if (data.checkedByName) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.text('Checked By:', MARGIN_L + 2, y)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text(data.checkedByName, MARGIN_L + 30, y)

    if (data.checkedByTitle) {
      doc.setFont('helvetica', 'bold')
      doc.text('Title:', MARGIN_L + 100, y)
      doc.setFont('helvetica', 'normal')
      doc.text(data.checkedByTitle, MARGIN_L + 114, y)
    }
    y += 5

    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(0.15)
    doc.line(MARGIN_L + 30, y + 1, MARGIN_L + 92, y + 1)
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(6)
    doc.text('Signature', MARGIN_L + 56, y + 3, { align: 'center' })

    if (data.checkedByDate) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      doc.text('Date:', MARGIN_L + 100, y)
      doc.setFont('helvetica', 'normal')
      doc.text(data.checkedByDate, MARGIN_L + 114, y)
    }
    y += 10
  }

  // ════════════════════════════════════════════════════════════
  // 6. FOOTER — Page numbers + watermark on all pages
  // ════════════════════════════════════════════════════════════

  const totalPages = doc.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    addFooter(p, totalPages)
  }

  return doc.output('arraybuffer') as unknown as Uint8Array
}
