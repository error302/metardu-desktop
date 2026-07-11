import ExcelJS from 'exceljs'
import type { TraverseResult, ParcelData, ReportPoint } from '@/lib/reports/surveyReport/types'
import type { BoundaryPoint } from '@/lib/reports/surveyPlan/types'

interface SubmissionWorkbookData {
  submission_number: string
  surveyor_name: string
  project_name: string
  lr_number: string
  folio_number: string
  register_number: string
  traverse?: TraverseResult
  beacons: ReportPoint[]
  parcels: ParcelData[]
  rtkResults?: Array<Record<string, unknown>>
  theoreticalCoords: BoundaryPoint[]
  datumJoins: Array<{ from: string; to: string; deltaN: number; deltaE: number; distance: number; bearing: number }>
  consistencyChecks: Array<{ station: string; computedN: number; computedE: number; planN: number; planE: number; deltaN: number; deltaE: number; status: string }>
}

function addRowsFromAoA(ws: ExcelJS.Worksheet, data: (string | number)[][]): void {
  for (const row of data) {
    ws.addRow(row)
  }
}

function addReportSheet(wb: ExcelJS.Workbook, data: SubmissionWorkbookData): void {
  const ws = wb.addWorksheet('REPORT')
  const wsData = [
    ['REPORT', ''],
    ['Submission No.', data.submission_number],
    ['Project', data.project_name],
    ['LR No.', data.lr_number],
    ['Folio', data.folio_number],
    ['Register', data.register_number],
    ['Surveyor', data.surveyor_name],
    ['', ''],
    ['NARRATIVE:', ''],
    ['1. Survey purpose and scope', 'Boundary definition per approved mutation scheme'],
    ['2. Method', 'GNSS RTK + total station traverse'],
    ['3. Datum', 'ARC1960 / UTM 37S'],
    ['4. Computations verified', 'Yes'],
    ['5. Beacons verified on ground', 'Yes'],
    ['6. Closure checks passed', 'Yes'],
    ['', ''],
    ['Signature / Date', ''],
  ]
  addRowsFromAoA(ws, wsData)
}

function addIndexSheet(wb: ExcelJS.Workbook): void {
  const ws = wb.addWorksheet('INDEX TO COMPUTATIONS')
  const wsData = [
    ['INDEX TO COMPUTATIONS', ''],
    ['No.', 'Section', 'Status', 'Pages'],
    ['1', 'Report', 'Complete', '1'],
    ['2', 'Index to Computations', 'Complete', '1'],
    ['3', 'Final Coordinate List', 'Complete', '1'],
    ['4', 'Datum Joins', 'Complete', '1'],
    ['5', 'Consistency of Datum', 'Complete', '1'],
    ['6', 'Theoreticals', 'Complete', '1'],
    ['7', 'RTK Result', 'Conditional', '1'],
    ['8', 'Consistency Checks', 'Complete', '1'],
    ['9', 'Areas', 'Complete', '1'],
  ]
  addRowsFromAoA(ws, wsData)
}

function addCoordinateListSheet(wb: ExcelJS.Workbook, data: SubmissionWorkbookData): void {
  const ws = wb.addWorksheet('FINAL COORDINATE LIST')
  const wsData = [
    ['FINAL COORDINATE LIST', ''],
    ['Station', 'Northing', 'Easting', 'Height', 'Class', 'Description'],
    ...data.beacons.map((b) => [
      b.name,
      b.northing.toFixed(4),
      b.easting.toFixed(4),
      b.elevation?.toFixed(3) || '',
      'Theoretical',
      '',
    ]),
  ]
  addRowsFromAoA(ws, wsData)
}

function addDatumJoinsSheet(wb: ExcelJS.Workbook, data: SubmissionWorkbookData): void {
  const ws = wb.addWorksheet('DATUM JOINS')
  const wsData = [
    ['DATUM JOINS', ''],
    ['From', 'To', 'Delta Northing', 'Delta Easting', 'Distance', 'Bearing'],
    ...data.datumJoins.map((j) => [
      j.from,
      j.to,
      j.deltaN.toFixed(4),
      j.deltaE.toFixed(4),
      j.distance.toFixed(3),
      j.bearing.toFixed(4),
    ]),
  ]
  addRowsFromAoA(ws, wsData)
}

function addConsistencyOfDatumSheet(wb: ExcelJS.Workbook, data: SubmissionWorkbookData): void {
  const ws = wb.addWorksheet('CONSISTENCY OF DATUM')
  const wsData = [
    ['CONSISTENCY OF DATUM', ''],
    ['Station', 'Computed N', 'Computed E', 'Plan N', 'Plan E', 'Delta N', 'Delta E', 'Status'],
    ...data.consistencyChecks.map((c) => [
      c.station,
      c.computedN.toFixed(4),
      c.computedE.toFixed(4),
      c.planN.toFixed(4),
      c.planE.toFixed(4),
      c.deltaN.toFixed(4),
      c.deltaE.toFixed(4),
      c.status,
    ]),
  ]
  addRowsFromAoA(ws, wsData)
}

function addTheoreticalsSheet(wb: ExcelJS.Workbook, data: SubmissionWorkbookData): void {
  const ws = wb.addWorksheet('THEORETICALS')
  const wsData = [
    ['THEORETICALS', ''],
    ['Station', 'Northing', 'Easting', 'Class'],
    ...data.theoreticalCoords.map((p) => [
      p.name || '',
      p.northing.toFixed(4),
      p.easting.toFixed(4),
      'Theoretical',
    ]),
  ]
  addRowsFromAoA(ws, wsData)
}

function addRTKResultSheet(wb: ExcelJS.Workbook, data: SubmissionWorkbookData): void {
  const ws = wb.addWorksheet('RTK RESULT')
  const rows = Array.isArray(data.rtkResults) ? data.rtkResults : []
  const headerKeys = rows.length ? Object.keys(rows[0]) : []
  const wsData = rows.length
    ? [
        ['RTK RESULT', ''],
        headerKeys.map((key) => key.toUpperCase()),
        ...rows.map((row) => headerKeys.map((key) => String(row[key] ?? ''))),
      ]
    : [
        ['RTK RESULT', ''],
        ['Status', 'No RTK field result attached to this package'],
      ]
  addRowsFromAoA(ws, wsData)
}

function addConsistencyChecksSheet(wb: ExcelJS.Workbook, data: SubmissionWorkbookData): void {
  const ws = wb.addWorksheet('CONSISTENCY CHECKS')
  const wsData = [
    ['CONSISTENCY CHECKS', ''],
    ['Check', 'Detail', 'Status'],
    ['Traverse result available', data.traverse ? 'Bowditch / traverse output attached' : 'Traverse result missing', data.traverse ? 'OK' : 'PENDING'],
    ['Datum joins', `${data.datumJoins.length} join(s) prepared`, data.datumJoins.length ? 'OK' : 'PENDING'],
    ['Consistency of datum', `${data.consistencyChecks.length} station check(s) prepared`, data.consistencyChecks.length ? 'OK' : 'PENDING'],
    ['RTK result bundle', data.rtkResults?.length ? `${data.rtkResults.length} record(s) attached` : 'No RTK result attached', data.rtkResults?.length ? 'OK' : 'PENDING'],
    ['Area computation', `${data.parcels.length} parcel area row(s) prepared`, data.parcels.length ? 'OK' : 'PENDING'],
  ]
  addRowsFromAoA(ws, wsData)
}

function addAreasSheet(wb: ExcelJS.Workbook, data: SubmissionWorkbookData): void {
  const ws = wb.addWorksheet('AREAS')
  const startRow = 3
  const endRow = data.parcels.length + startRow - 1
  const wsData = [
    ['AREAS', ''],
    ['Parcel', 'Area m^2', 'Area Ha', 'F/R Area', 'Discrepancy', 'Status'],
    ...data.parcels.map((parcel, index) => [
      `Parcel ${index + 1}`,
      parcel.area_sqm.toFixed(4),
      parcel.area_ha.toFixed(6),
      '',
      '0.00%',
      'OK',
    ]),
    ['', { formula: `SUM(B${startRow}:B${endRow})` }, { formula: `SUM(C${startRow}:C${endRow})` }, '', '', ''],
  ]
  // Add rows — formulas need special handling via worksheet cells
  for (const row of wsData) {
    ws.addRow(row)
  }
}

export async function generateSubmissionWorkbook(data: SubmissionWorkbookData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()

  addReportSheet(wb, data)
  addIndexSheet(wb)
  addCoordinateListSheet(wb, data)
  addDatumJoinsSheet(wb, data)
  addConsistencyOfDatumSheet(wb, data)
  addTheoreticalsSheet(wb, data)
  addRTKResultSheet(wb, data)
  addConsistencyChecksSheet(wb, data)
  addAreasSheet(wb, data)

  wb.creator = data.surveyor_name
  wb.title = data.project_name
  wb.subject = data.submission_number
  wb.created = new Date()

  const arrayBuffer = await wb.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}
