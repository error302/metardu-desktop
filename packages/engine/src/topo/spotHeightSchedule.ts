/**
 * Spot Height Schedule — ExcelJS export for Kenyan county submissions
 *
 * Many Kenyan county approval processes and NEMA EIA submissions require a
 * Spot Height Schedule alongside the topographic plan — not just the drawing.
 * This module generates an Excel workbook with the spot heights formatted
 * per Kenya survey conventions.
 *
 * USAGE
 * -----
 *   import { generateSpotHeightSchedule } from '@/lib/topo/spotHeightSchedule'
 *
 *   const buffer = await generateSpotHeightSchedule(points, {
 *     projectName: 'Nairobi Topo Survey',
 *     surveyorName: 'John Doe',
 *     surveyorLicense: 'ISK/1234',
 *   })
 *   // Save buffer as .xlsx
 */

import ExcelJS from 'exceljs'

export interface SpotHeightPoint {
  /** Point number */
  pointNumber: string
  /** Easting (meters) */
  easting: number
  /** Northing (meters) */
  northing: number
  /** Reduced level (meters) */
  rl: number
  /** Feature code (e.g., 'SH', 'DG', 'RD') */
  code?: string
  /** Feature description */
  description?: string
}

export interface SpotHeightScheduleOptions {
  projectName: string
  surveyorName: string
  surveyorLicense?: string
  datum?: string
  utmZone?: number
  benchmark?: string
  benchmarkRL?: number
}

/**
 * Generate a Spot Height Schedule as an Excel workbook buffer.
 *
 * Format follows Kenya Survey Department conventions:
 *   - Header with project name, surveyor, datum, benchmark
 *   - Columns: Pt No, Easting, Northing, RL, Code, Description
 *   - Summary row with count and RL range
 *   - Formatted with borders, headers, and appropriate precision
 */
export async function generateSpotHeightSchedule(
  points: SpotHeightPoint[],
  options: SpotHeightScheduleOptions,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'METARDU Survey Platform'
  wb.created = new Date()
  wb.modified = new Date()

  const ws = wb.addWorksheet('Spot Height Schedule', {
    properties: { defaultColWidth: 15 },
    pageSetup: { orientation: 'landscape', fitToPage: true },
  })

  // ─── Title Block ───
  ws.mergeCells('A1:F1')
  ws.getCell('A1').value = 'SPOT HEIGHT SCHEDULE'
  ws.getCell('A1').font = { bold: true, size: 14 }
  ws.getCell('A1').alignment = { horizontal: 'center' }

  ws.mergeCells('A2:F2')
  ws.getCell('A2').value = options.projectName
  ws.getCell('A2').font = { bold: true, size: 12 }
  ws.getCell('A2').alignment = { horizontal: 'center' }

  // ─── Metadata Block ───
  ws.getCell('A4').value = 'Surveyor:'
  ws.getCell('B4').value = options.surveyorName
  ws.getCell('A5').value = 'License:'
  ws.getCell('B5').value = options.surveyorLicense || '—'
  ws.getCell('A6').value = 'Datum:'
  ws.getCell('B6').value = options.datum || 'Arc 1960'
  ws.getCell('A7').value = 'UTM Zone:'
  ws.getCell('B7').value = `${options.utmZone || 37}S`
  ws.getCell('A8').value = 'Benchmark:'
  ws.getCell('B8').value = options.benchmark || '—'
  ws.getCell('C8').value = 'BM RL:'
  ws.getCell('D8').value = options.benchmarkRL || '—'

  for (let row = 4; row <= 8; row++) {
    ws.getCell(`A${row}`).font = { bold: true }
  }

  // ─── Header Row ───
  const headerRow = 10
  const headers = ['Pt No', 'Easting (m)', 'Northing (m)', 'RL (m)', 'Code', 'Description']
  for (let col = 0; col < headers.length; col++) {
    const cell = ws.getCell(headerRow, col + 1)
    cell.value = headers[col]
    cell.font = { bold: true, color: { argb: 'FFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1B3A5C' } }
    cell.alignment = { horizontal: 'center' }
    cell.border = {
      top: { style: 'thin' }, bottom: { style: 'thin' },
      left: { style: 'thin' }, right: { style: 'thin' },
    }
  }

  // ─── Data Rows ───
  const sortedPoints = [...points].sort((a, b) => {
    // Sort by easting then northing (standard Kenya convention)
    if (Math.abs(a.easting - b.easting) > 0.001) return a.easting - b.easting
    return a.northing - b.northing
  })

  for (let i = 0; i < sortedPoints.length; i++) {
    const row = headerRow + 1 + i
    const p = sortedPoints[i]
    ws.getCell(row, 1).value = p.pointNumber
    ws.getCell(row, 2).value = p.easting
    ws.getCell(row, 3).value = p.northing
    ws.getCell(row, 4).value = p.rl
    ws.getCell(row, 5).value = p.code || ''
    ws.getCell(row, 6).value = p.description || ''

    // Precision: 3dp for EN, 3dp for RL
    ws.getCell(row, 2).numFmt = '0.000'
    ws.getCell(row, 3).numFmt = '0.000'
    ws.getCell(row, 4).numFmt = '0.000'

    // Borders
    for (let col = 1; col <= 6; col++) {
      ws.getCell(row, col).border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      }
    }
  }

  // ─── Summary Row ───
  const summaryRow = headerRow + 1 + sortedPoints.length + 1
  ws.getCell(summaryRow, 1).value = 'TOTAL'
  ws.getCell(summaryRow, 1).font = { bold: true }
  ws.getCell(summaryRow, 2).value = sortedPoints.length
  ws.getCell(summaryRow, 2).font = { bold: true }

  if (sortedPoints.length > 0) {
    const rls = sortedPoints.map(p => p.rl)
    const minRL = Math.min(...rls)
    const maxRL = Math.max(...rls)
    ws.getCell(summaryRow, 4).value = `Min: ${minRL.toFixed(3)} / Max: ${maxRL.toFixed(3)} / Range: ${(maxRL - minRL).toFixed(3)}`
    ws.getCell(summaryRow, 4).font = { bold: true }
  }

  // ─── Footer ───
  const footerRow = summaryRow + 2
  ws.getCell(footerRow, 1).value = `Generated by METARDU Survey Platform on ${new Date().toISOString().split('T')[0]}`
  ws.getCell(footerRow, 1).font = { italic: true, size: 9, color: { argb: '888888' } }

  // Column widths
  ws.getColumn(1).width = 12
  ws.getColumn(2).width = 15
  ws.getColumn(3).width = 15
  ws.getColumn(4).width = 12
  ws.getColumn(5).width = 8
  ws.getColumn(6).width = 30

  const buffer = await wb.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
