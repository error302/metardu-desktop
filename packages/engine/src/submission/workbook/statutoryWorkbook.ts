/**
 * statutoryWorkbook.ts
 * Generates the 9-sheet statutory computation workbook for Metardu submissions.
 * Compliant with Kenya Survey Regulations 1994 and RDM 1.1 (2025).
 */

import ExcelJS from 'exceljs'
import { formatBearingDMS, formatDistanceM } from '@/lib/drawing/dxfLayers'

type SurveyTypeKey = 'cadastral' | 'engineering' | 'topographic' | 'leveling' | 'control' | 'mining' | 'hydrographic' | 'drone' | 'gnss'

export interface WorkbookInput {
  project: {
    name: string
    lrNumber: string
    parcelNumber: string
    county: string
    division: string
    district: string
    locality: string
    surveyType: SurveyTypeKey
    surveyDate: string
    scaleDenominator: number
  }
  surveyor: {
    name: string
    iskNumber: string
    firmName: string
  }
  submission: {
    referenceNumber: string
    revision: number
    status: string
  }
  fieldObservations: Array<{
    stationFrom: string
    stationTo: string
    observedBearingDeg?: number
    observedDistanceM?: number
    reducedLevelM?: number
    remarks?: string
  }>
  traverse: {
    method: 'bowditch' | 'transit'
    stations: Array<{
      label: string
      observedBearing: number
      observedDistance: number
      departureRaw: number
      latitudeRaw: number
      departureCorrected: number
      latitudeCorrected: number
      easting: number
      northing: number
    }>
    angularMisclosureSec: number
    angularToleranceSec: number
    angularPassesQA: boolean
    linearMisclosureM: number
    perimeterM: number
    precisionRatio: number
    precisionMinimum: number
    linearPassesQA: boolean
  }
  adjustedStations: Array<{
    label: string
    easting: number
    northing: number
    elevation?: number
  }>
  levelling: Array<{
    stationId: string
    backsight?: number
    intermediate?: number
    foresight?: number
    rise?: number
    fall?: number
    reducedLevel: number
    distance?: number
    remarks?: string
  }> | null
  levellingClosureMM?: number
  levellingToleranceMM?: number
  levellingDistanceKm?: number
  areaComputation: {
    stations: Array<{ label: string; easting: number; northing: number }>
    areaM2: number
    areaHa: number
    perimeterM: number
  }
  legs: Array<{
    fromLabel: string
    toLabel: string
    bearing: number
    distance: number
  }>
  cogoResults: Array<{
    type: string
    description: string
    inputs: Record<string, number | string>
    outputs: Record<string, number | string>
  }> | null
}

const STYLE = {
  headerFill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A5C' } } as ExcelJS.Fill,
  headerFont: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' } as ExcelJS.Font,
  titleFont: { bold: true, size: 14, name: 'Calibri' } as ExcelJS.Font,
  subFont: { bold: true, size: 11, name: 'Calibri' } as ExcelJS.Font,
  bodyFont: { size: 10, name: 'Calibri' } as ExcelJS.Font,
  passFont: { bold: true, color: { argb: 'FF006400' }, size: 10, name: 'Calibri' } as ExcelJS.Font,
  failFont: { bold: true, color: { argb: 'FFCC0000' }, size: 10, name: 'Calibri' } as ExcelJS.Font,
  border: {
    top: { style: 'thin' }, left: { style: 'thin' },
    bottom: { style: 'thin' }, right: { style: 'thin' },
  } as ExcelJS.Borders,
  altRowFill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4F8' } } as ExcelJS.Fill,
}

function applyHeaderRow(row: ExcelJS.Row, columnCount: number): void {
  row.height = 20
  for (let c = 1; c <= columnCount; c++) {
    const cell = row.getCell(c)
    cell.fill = STYLE.headerFill
    cell.font = STYLE.headerFont
    cell.border = STYLE.border
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  }
}

function applyDataRow(row: ExcelJS.Row, columnCount: number, rowIndex: number): void {
  row.height = 16
  for (let c = 1; c <= columnCount; c++) {
    const cell = row.getCell(c)
    cell.font = STYLE.bodyFont
    cell.border = STYLE.border
    if (rowIndex % 2 === 0) cell.fill = STYLE.altRowFill
  }
}

function sheetTitle(sheet: ExcelJS.Worksheet, title: string, subtitle: string): void {
  sheet.mergeCells('A1:H1')
  const titleCell = sheet.getCell('A1')
  titleCell.value = title
  titleCell.font = STYLE.titleFont
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
  sheet.getRow(1).height = 28

  sheet.mergeCells('A2:H2')
  const subCell = sheet.getCell('A2')
  subCell.value = subtitle
  subCell.font = STYLE.subFont
  subCell.alignment = { horizontal: 'center' }
  sheet.getRow(2).height = 20
}

function buildSheet1_ProjectDetails(wb: ExcelJS.Workbook, input: WorkbookInput): void {
  const ws = wb.addWorksheet('1. Project Details')
  ws.columns = [{ width: 28 }, { width: 40 }, { width: 28 }, { width: 40 }]

  sheetTitle(ws, 'METARDU COMPUTATION WORKBOOK', 'Sheet 1 of 9 — Project Details')
  ws.addRow([])

  const fields: [string, string, string, string][] = [
    ['Project Name', input.project.name, 'Reference No.', input.submission.referenceNumber],
    ['LR Number', input.project.lrNumber, 'Parcel Number', input.project.parcelNumber],
    ['County', input.project.county, 'Division', input.project.division],
    ['District', input.project.district, 'Locality', input.project.locality],
    ['Survey Type', input.project.surveyType.toUpperCase(), 'Survey Date', new Date(input.project.surveyDate).toLocaleDateString('en-GB')],
    ['Plan Scale', `1:${input.project.scaleDenominator}`, 'Revision', `R${String(input.submission.revision).padStart(2, '0')}`],
    ['', '', '', ''],
    ['Surveyor Name', input.surveyor.name, 'ISK Number', input.surveyor.iskNumber],
    ['Firm / Company', input.surveyor.firmName, 'Submission Status', input.submission.status.toUpperCase()],
  ]

  fields.forEach((row) => {
    const wsRow = ws.addRow(row)
    wsRow.height = 18
    ;[1, 3].forEach((col) => {
      wsRow.getCell(col).font = { bold: true, size: 10, name: 'Calibri' }
      wsRow.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF2' } }
    })
    wsRow.eachCell((cell) => { cell.border = STYLE.border })
  })

  ws.addRow([])
  ws.addRow(['CERTIFICATION'])
  const certRow = ws.lastRow!
  certRow.getCell(1).font = STYLE.subFont
  ws.addRow(['I certify that the computations in this workbook are correct and comply with the Kenya Survey Regulations 1994.'])
  ws.mergeCells(`A${ws.lastRow!.number}:H${ws.lastRow!.number}`)
  ws.addRow([])
  ws.addRow(['Signature: ___________________________', '', 'Date: _______________', ''])
  ws.addRow([`${input.surveyor.name} — ${input.surveyor.iskNumber}`, '', '', ''])
}

function buildSheet2_FieldAbstract(wb: ExcelJS.Workbook, input: WorkbookInput): void {
  const ws = wb.addWorksheet('2. Field Abstract')
  ws.columns = [
    { key: 'from', width: 16 },
    { key: 'to', width: 16 },
    { key: 'bearing', width: 20 },
    { key: 'distance', width: 18 },
    { key: 'rl', width: 18 },
    { key: 'remarks', width: 30 },
  ]

  sheetTitle(ws, 'METARDU COMPUTATION WORKBOOK', 'Sheet 2 of 9 — Field Abstract (Raw Observations)')
  ws.addRow([])

  const headers = ['Station From', 'Station To', 'Observed Bearing', 'Observed Distance (m)', 'Reduced Level (m)', 'Remarks']
  const hRow = ws.addRow(headers)
  applyHeaderRow(hRow, headers.length)

  if (input.fieldObservations.length === 0) {
    const r = ws.addRow(['Not applicable for this survey type'])
    ws.mergeCells(`A${r.number}:F${r.number}`)
    r.getCell(1).font = { ...STYLE.bodyFont, italic: true }
    return
  }

  input.fieldObservations.forEach((obs, i) => {
    const r = ws.addRow([
      obs.stationFrom,
      obs.stationTo,
      obs.observedBearingDeg !== undefined ? formatBearingDMS(obs.observedBearingDeg) : '',
      obs.observedDistanceM !== undefined ? formatDistanceM(obs.observedDistanceM) : '',
      obs.reducedLevelM !== undefined ? obs.reducedLevelM.toFixed(3) : '',
      obs.remarks ?? '',
    ])
    applyDataRow(r, headers.length, i)
  })
}

function buildSheet3_TraverseComputation(wb: ExcelJS.Workbook, input: WorkbookInput): void {
  const ws = wb.addWorksheet('3. Traverse Computation')
  ws.columns = [
    { width: 12 },
    { width: 18 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
  ]

  sheetTitle(ws, 'METARDU COMPUTATION WORKBOOK', `Sheet 3 of 9 — Traverse Computation (${input.traverse.method === 'transit' ? 'Transit' : 'Bowditch'} Method)`)
  ws.addRow([])
  ws.addRow(['ANGULAR MISCLOSURE CHECK'])
  ws.lastRow!.getCell(1).font = STYLE.subFont
  ws.addRow([
    'Misclosure:', `${input.traverse.angularMisclosureSec.toFixed(1)}"`,
    'Tolerance:', `${input.traverse.angularToleranceSec.toFixed(1)}"`,
    'Station Count:', input.traverse.stations.length,
    'Result:', input.traverse.angularPassesQA ? 'PASS ' : 'FAIL [x]',
  ])
  const angRow = ws.lastRow!
  angRow.getCell(8).font = input.traverse.angularPassesQA ? STYLE.passFont : STYLE.failFont
  ws.addRow([])

  const headers = ['Station', 'Observed Bearing', 'Distance (m)', 'Dep. Raw (m)', 'Lat. Raw (m)', 'Dep. Corr. (m)', 'Lat. Corr. (m)', 'Dep. Adj. (m)', 'Lat. Adj. (m)']
  const hRow = ws.addRow(headers)
  applyHeaderRow(hRow, headers.length)

  let sumDepRaw = 0, sumLatRaw = 0, sumDepCorr = 0, sumLatCorr = 0

  input.traverse.stations.forEach((st, i) => {
    const r = ws.addRow([
      st.label,
      formatBearingDMS(st.observedBearing),
      formatDistanceM(st.observedDistance),
      st.departureRaw.toFixed(4),
      st.latitudeRaw.toFixed(4),
      (st.departureCorrected - st.departureRaw).toFixed(4),
      (st.latitudeCorrected - st.latitudeRaw).toFixed(4),
      st.departureCorrected.toFixed(4),
      st.latitudeCorrected.toFixed(4),
    ])
    applyDataRow(r, headers.length, i)
    sumDepRaw += st.departureRaw
    sumLatRaw += st.latitudeRaw
    sumDepCorr += st.departureCorrected
    sumLatCorr += st.latitudeCorrected
  })

  const totRow = ws.addRow([
    'TOTALS', '', formatDistanceM(input.traverse.perimeterM),
    sumDepRaw.toFixed(4), sumLatRaw.toFixed(4),
    '', '',
    sumDepCorr.toFixed(4), sumLatCorr.toFixed(4),
  ])
  totRow.eachCell((c) => { c.font = { bold: true, size: 10, name: 'Calibri' }; c.border = STYLE.border })

  ws.addRow([])
  ws.addRow(['LINEAR MISCLOSURE CHECK'])
  ws.lastRow!.getCell(1).font = STYLE.subFont
  ws.addRow([
    'Linear Misclosure:', `${input.traverse.linearMisclosureM.toFixed(4)} m`,
    'Perimeter:', `${formatDistanceM(input.traverse.perimeterM)} m`,
    'Precision:', `1:${input.traverse.precisionRatio.toLocaleString()}`,
    'Minimum:', `1:${input.traverse.precisionMinimum.toLocaleString()}`,
    'Result:', input.traverse.linearPassesQA ? 'PASS ' : 'FAIL [x]',
  ])
  const linRow = ws.lastRow!
  linRow.getCell(10).font = input.traverse.linearPassesQA ? STYLE.passFont : STYLE.failFont
}

function buildSheet4_Coordinates(wb: ExcelJS.Workbook, input: WorkbookInput): void {
  const ws = wb.addWorksheet('4. Coordinates')
  ws.columns = [{ width: 14 }, { width: 22 }, { width: 22 }, { width: 18 }]

  sheetTitle(ws, 'METARDU COMPUTATION WORKBOOK', 'Sheet 4 of 9 — Adjusted Coordinates (SRID 21037 — Arc 1960 / UTM Zone 37S)')
  ws.addRow([])
  ws.addRow(['Coordinate Reference System: Arc 1960 / UTM Zone 37S  |  EPSG: 21037  |  Units: Metres'])
  ws.mergeCells(`A${ws.lastRow!.number}:D${ws.lastRow!.number}`)
  ws.lastRow!.getCell(1).font = { italic: true, size: 9, name: 'Calibri' }
  ws.addRow([])

  const headers = ['Beacon / Station', 'Easting (m)', 'Northing (m)', 'Elevation (m)']
  const hRow = ws.addRow(headers)
  applyHeaderRow(hRow, headers.length)

  input.adjustedStations.forEach((st, i) => {
    const r = ws.addRow([
      st.label,
      st.easting.toFixed(3),
      st.northing.toFixed(3),
      st.elevation !== undefined ? st.elevation.toFixed(3) : '—',
    ])
    applyDataRow(r, headers.length, i)
    ;[2, 3, 4].forEach((c) => { r.getCell(c).alignment = { horizontal: 'right' } })
  })
}

function buildSheet5_Levelling(wb: ExcelJS.Workbook, input: WorkbookInput): void {
  const ws = wb.addWorksheet('5. Levelling')
  ws.columns = [
    { width: 16 }, { width: 12 }, { width: 12 }, { width: 12 },
    { width: 12 }, { width: 12 }, { width: 16 }, { width: 14 }, { width: 24 },
  ]

  sheetTitle(ws, 'METARDU COMPUTATION WORKBOOK', 'Sheet 5 of 9 — Levelling (Rise & Fall Method)')

  if (!input.levelling || input.levelling.length === 0) {
    ws.addRow([])
    const r = ws.addRow(['Not applicable for this survey type'])
    ws.mergeCells(`A${r.number}:I${r.number}`)
    r.getCell(1).font = { ...STYLE.bodyFont, italic: true }
    return
  }

  ws.addRow([])
  ws.addRow([
    'Distance (K):', `${input.levellingDistanceKm?.toFixed(3) ?? '—'} km`,
    'Tolerance (10√K):', `${input.levellingToleranceMM?.toFixed(1) ?? '—'} mm`,
    'Closure:', `${input.levellingClosureMM?.toFixed(1) ?? '—'} mm`,
    'Result:',
    Math.abs(input.levellingClosureMM ?? 0) <= (input.levellingToleranceMM ?? 0) ? 'PASS ' : 'FAIL [x]',
  ])
  ws.addRow([])

  const headers = ['Station', 'BS', 'IS', 'FS', 'Rise', 'Fall', 'RL (m)', 'Distance (m)', 'Remarks']
  const hRow = ws.addRow(headers)
  applyHeaderRow(hRow, headers.length)

  input.levelling.forEach((lv, i) => {
    const r = ws.addRow([
      lv.stationId,
      lv.backsight?.toFixed(3) ?? '',
      lv.intermediate?.toFixed(3) ?? '',
      lv.foresight?.toFixed(3) ?? '',
      lv.rise?.toFixed(3) ?? '',
      lv.fall?.toFixed(3) ?? '',
      lv.reducedLevel.toFixed(3),
      lv.distance?.toFixed(3) ?? '',
      lv.remarks ?? '',
    ])
    applyDataRow(r, headers.length, i)
  })
}

function buildSheet6_AreaComputation(wb: ExcelJS.Workbook, input: WorkbookInput): void {
  const ws = wb.addWorksheet('6. Area Computation')
  ws.columns = [{ width: 14 }, { width: 20 }, { width: 20 }, { width: 24 }, { width: 24 }]

  sheetTitle(ws, 'METARDU COMPUTATION WORKBOOK', 'Sheet 6 of 9 — Area Computation (Coordinate / Shoelace Method)')
  ws.addRow([])
  ws.addRow(['Method: Coordinate (Shoelace) Method  |  2A = |Σ(Ei × Ni+1) - Σ(Ni × Ei+1)|'])
  ws.mergeCells(`A${ws.lastRow!.number}:E${ws.lastRow!.number}`)
  ws.lastRow!.getCell(1).font = { italic: true, size: 9, name: 'Calibri' }
  ws.addRow([])

  const headers = ['Station', 'Easting (m)', 'Northing (m)', 'E × N(i+1)', 'N × E(i+1)']
  const hRow = ws.addRow(headers)
  applyHeaderRow(hRow, headers.length)

  const pts = input.areaComputation.stations
  const n = pts.length
  let sumENextN = 0, sumNNextE = 0

  pts.forEach((pt, i) => {
    const next = pts[(i + 1) % n]
    const eNextN = pt.easting * next.northing
    const nNextE = pt.northing * next.easting
    sumENextN += eNextN
    sumNNextE += nNextE
    const r = ws.addRow([pt.label, pt.easting.toFixed(3), pt.northing.toFixed(3), eNextN.toFixed(3), nNextE.toFixed(3)])
    applyDataRow(r, headers.length, i)
  })

  ws.addRow(['TOTALS', '', '', sumENextN.toFixed(3), sumNNextE.toFixed(3)])
    .eachCell((c) => { c.font = { bold: true, size: 10, name: 'Calibri' }; c.border = STYLE.border })

  ws.addRow([])
  ws.addRow(['2A =', `|${sumENextN.toFixed(3)} - ${sumNNextE.toFixed(3)}|`, '=', `${(Math.abs(sumENextN - sumNNextE)).toFixed(3)} m²`])
  ws.addRow(['Area =', `${input.areaComputation.areaM2.toFixed(3)} m²`])
  ws.addRow(['Area =', `${input.areaComputation.areaHa.toFixed(4)} Ha`])
  ws.addRow(['Perimeter =', `${formatDistanceM(input.areaComputation.perimeterM)} m`])
}

function buildSheet7_BearingsDistances(wb: ExcelJS.Workbook, input: WorkbookInput): void {
  const ws = wb.addWorksheet('7. Bearings & Distances')
  ws.columns = [{ width: 16 }, { width: 16 }, { width: 22 }, { width: 20 }]

  sheetTitle(ws, 'METARDU COMPUTATION WORKBOOK', 'Sheet 7 of 9 — Bearing & Distance Schedule')
  ws.addRow([])

  const headers = ['From Beacon', 'To Beacon', 'Bearing (DDD°MM\'SS")', 'Distance (m)']
  const hRow = ws.addRow(headers)
  applyHeaderRow(hRow, headers.length)

  input.legs.forEach((leg, i) => {
    const r = ws.addRow([leg.fromLabel, leg.toLabel, formatBearingDMS(leg.bearing), formatDistanceM(leg.distance)])
    applyDataRow(r, headers.length, i)
  })
}

function buildSheet8_COGO(wb: ExcelJS.Workbook, input: WorkbookInput): void {
  const ws = wb.addWorksheet('8. COGO & Setting Out')
  ws.columns = [{ width: 22 }, { width: 30 }, { width: 28 }, { width: 28 }]

  sheetTitle(ws, 'METARDU COMPUTATION WORKBOOK', 'Sheet 8 of 9 — COGO & Setting Out Computations')

  if (!input.cogoResults || input.cogoResults.length === 0) {
    ws.addRow([])
    const r = ws.addRow(['No COGO or setting-out computations recorded for this project.'])
    ws.mergeCells(`A${r.number}:D${r.number}`)
    r.getCell(1).font = { ...STYLE.bodyFont, italic: true }
    return
  }

  ws.addRow([])
  const headers = ['Computation Type', 'Description', 'Inputs', 'Outputs']
  const hRow = ws.addRow(headers)
  applyHeaderRow(hRow, headers.length)

  input.cogoResults.forEach((result, i) => {
    const r = ws.addRow([
      result.type.replace(/_/g, ' ').toUpperCase(),
      result.description,
      Object.entries(result.inputs).map(([k, v]) => `${k}: ${v}`).join('\n'),
      Object.entries(result.outputs).map(([k, v]) => `${k}: ${v}`).join('\n'),
    ])
    applyDataRow(r, headers.length, i)
  })
}

function buildSheet9_QASummary(wb: ExcelJS.Workbook, input: WorkbookInput): void {
  const ws = wb.addWorksheet('9. QA Summary')
  ws.columns = [{ width: 32 }, { width: 22 }, { width: 22 }, { width: 14 }]

  sheetTitle(ws, 'METARDU COMPUTATION WORKBOOK', 'Sheet 9 of 9 — Quality Assurance Summary')
  ws.addRow([])

  const headers = ['Quality Check', 'Computed Value', 'Standard / Tolerance', 'Result']
  const hRow = ws.addRow(headers)
  applyHeaderRow(hRow, headers.length)

  const checks: [string, string, string, boolean | null][] = [
    ['Angular Misclosure', `${input.traverse.angularMisclosureSec.toFixed(1)}"`, `≤ ${input.traverse.angularToleranceSec.toFixed(1)}" (60√n)`, input.traverse.angularPassesQA],
    ['Linear Misclosure Precision', `1:${input.traverse.precisionRatio.toLocaleString()}`, `≥ 1:${input.traverse.precisionMinimum.toLocaleString()} (Kenya Survey Regs 1994)`, input.traverse.linearPassesQA],
    ['Levelling Closure', input.levellingClosureMM !== undefined ? `${input.levellingClosureMM.toFixed(1)} mm` : 'N/A', input.levellingToleranceMM !== undefined ? `≤ ${input.levellingToleranceMM.toFixed(1)} mm (10√K, RDM 1.1)` : 'N/A', input.levellingClosureMM !== undefined && input.levellingToleranceMM !== undefined ? Math.abs(input.levellingClosureMM) <= input.levellingToleranceMM : null],
    ['Adjusted Departure Sum (ΣDep)', `${input.traverse.stations.reduce((s, st) => s + st.departureCorrected, 0).toFixed(4)} m`, '≈ 0.0000 m', Math.abs(input.traverse.stations.reduce((s, st) => s + st.departureCorrected, 0)) < 0.001],
    ['Adjusted Latitude Sum (ΣLat)', `${input.traverse.stations.reduce((s, st) => s + st.latitudeCorrected, 0).toFixed(4)} m`, '≈ 0.0000 m', Math.abs(input.traverse.stations.reduce((s, st) => s + st.latitudeCorrected, 0)) < 0.001],
    ['Coordinate Reference System', 'SRID 21037 — Arc 1960 / UTM Zone 37S', 'SRID 21037 required', true],
    ['Adjustment Method', input.traverse.method === 'transit' ? 'Transit' : 'Bowditch', 'Bowditch or Transit', true],
  ]

  checks.forEach((check, i) => {
    const [label, value, standard, passes] = check
    const r = ws.addRow([label, value, standard, passes === null ? 'N/A' : passes ? 'PASS ' : 'FAIL [x]'])
    applyDataRow(r, headers.length, i)
    if (passes !== null) r.getCell(4).font = passes ? STYLE.passFont : STYLE.failFont
  })

  const allPass = checks.every(([,,,p]) => p === null || p === true)
  ws.addRow([])
  const overallRow = ws.addRow(['OVERALL QA RESULT', '', '', allPass ? 'ALL CHECKS PASS ' : 'ONE OR MORE CHECKS FAIL [x]'])
  overallRow.height = 22
  overallRow.getCell(1).font = { bold: true, size: 12, name: 'Calibri' }
  overallRow.getCell(4).font = { bold: true, size: 12, name: 'Calibri', color: { argb: allPass ? 'FF006400' : 'FFCC0000' } }
  ws.mergeCells(`A${overallRow.number}:C${overallRow.number}`)

  ws.addRow([])
  ws.addRow(['SURVEYOR CERTIFICATION'])
  ws.lastRow!.getCell(1).font = STYLE.subFont
  ws.addRow([`I, ${input.surveyor.name} (${input.surveyor.iskNumber}), certify that the computations in this workbook are correct.`])
  ws.mergeCells(`A${ws.lastRow!.number}:D${ws.lastRow!.number}`)
  ws.addRow([])
  ws.addRow(['Signature: _________________________', '', `Date: ${new Date().toLocaleDateString('en-GB')}`, ''])
}

export async function generateStatutoryWorkbook(input: WorkbookInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Metardu Platform'
  wb.created = new Date()
  wb.modified = new Date()

  buildSheet1_ProjectDetails(wb, input)
  buildSheet2_FieldAbstract(wb, input)
  buildSheet3_TraverseComputation(wb, input)
  buildSheet4_Coordinates(wb, input)
  buildSheet5_Levelling(wb, input)
  buildSheet6_AreaComputation(wb, input)
  buildSheet7_BearingsDistances(wb, input)
  buildSheet8_COGO(wb, input)
  buildSheet9_QASummary(wb, input)

  const buffer = await wb.xlsx.writeBuffer()
  return Buffer.from(buffer)
}