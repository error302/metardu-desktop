/**
 * Instrument Format Writers — export stakeout lists to total station formats
 *
 * PROBLEM
 * -------
 * The existing codebase has PARSERS for GSI, SDR, Topcon, JobXML, and South
 * formats (src/lib/import/totalStation/adapters/). But there are no WRITERS
 * — surveyors can import from instruments but can't export stakeout lists
 * back to them. This module provides the writers.
 *
 * SUPPORTED FORMATS
 * -----------------
 *   - GSI  (Leica total stations) — GSI-8 and GSI-16
 *   - SDR  (Topcon/Sokkia) — SDR v20/v33
 *   - CSV  (universal) — point_id,easting,northing,RL,description
 *   - JobXML (modern total stations) — XML-based
 *
 * USAGE
 * -----
 *   import { exportStakeoutToGSI, exportStakeoutToSDR, exportStakeoutToCSV } from
 *     '@/lib/survey/instrumentWriters'
 *
 *   const gsiContent = exportStakeoutToGSI(settingOutResult, {
 *     format: 'GSI-8',
 *     includeFaces: false,
 *   })
 *
 *   // Then: new Blob([gsiContent], { type: 'text/plain' })
 */

import type { SettingOutResult, SettingOutRow } from '@/lib/computations/settingOutEngine'

// ─── Types ──────────────────────────────────────────────────────────────────

export type InstrumentFormat = 'GSI-8' | 'GSI-16' | 'SDR' | 'CSV' | 'JobXML'

export interface ExportOptions {
  /** GSI word length: 8 (compact) or 16 (extended). Default: GSI-8 */
  format?: InstrumentFormat
  /** Include both face-left and face-right positions. Default: false */
  includeFaces?: boolean
  /** Station name for the instrument setup. Default: 'STN1' */
  stationName?: string
  /** Backsight point name. Default: 'BS1' */
  backsightName?: string
}

export interface ExportResult {
  content: string
  filename: string
  mimeType: string
  format: InstrumentFormat
  pointCount: number
}

// ─── GSI Writer (Leica) ─────────────────────────────────────────────────────

/**
 * GSI format reference: Leica GSI Online Documentation
 *
 * GSI-8: Word indices are 2 digits (e.g., 21 = Hz angle)
 * GSI-16: Word indices are 6 digits (e.g., 21 = Hz angle, with leading zeros)
 *
 * Key word indices:
 *   11  = Point number
 *   21  = Horizontal angle (Hz) — right of face
 *   22  = Vertical angle (V)
 *   31  = Slope distance (SD)
 *   32  = Horizontal distance (HD)
 *   81  = Easting (E)
 *   82  = Northing (N)
 *   83  = Height (H)
 *   84  = Reflector height (TH)
 *   85  = Instrument height (IH)
 *   87  = Point code/description
 */
export function exportStakeoutToGSI(
  result: SettingOutResult,
  options: ExportOptions = {},
): ExportResult {
  const format = options.format === 'GSI-16' ? 'GSI-16' : 'GSI-8'
  const stationName = options.stationName || 'STN1'
  const lines: string[] = []

  // Helper: format a GSI word
  function gsiWord(wi: number, value: string, format: 'GSI-8' | 'GSI-16'): string {
    const wiStr = format === 'GSI-16' ? String(wi).padStart(6, '0') : String(wi).padStart(2, '0')
    return `*${wiStr}${value}`
  }

  // Format angle in centesimal (gons) — Leica default
  // Actually GSI stores in decimicro-radians or centesimal depending on config.
  // We'll use decimal degrees with 6 decimal places (common Leica setting).
  function formatAngle(deg: number): string {
    // Convert to centesimal (gons): 360° = 400 gon
    const gon = deg * 400 / 360
    return gon.toFixed(6).padStart(16, '0').replace('.', '')
  }

  // Format distance in mm with 1 decimal
  function formatDistance(m: number): string {
    return (m * 1000).toFixed(1).padStart(16, '0').replace('.', '')
  }

  // Format coordinate in mm with 1 decimal
  function formatCoord(m: number): string {
    return (m * 1000).toFixed(1).padStart(16, '0').replace('.', '')
  }

  // Station setup line
  const ih = result.instrumentStation.ih * 1000 // mm
  lines.push([
    gsiWord(11, stationName.padStart(16, '0'), format),
    gsiWord(84, ih.toFixed(0).padStart(16, '0'), format),
    gsiWord(81, formatCoord(result.instrumentStation.e), format),
    gsiWord(82, formatCoord(result.instrumentStation.n), format),
    gsiWord(83, formatCoord(result.instrumentStation.rl), format),
  ].join(''))

  // Backsight line (orientation)
  const bsName = options.backsightName || 'BS1'
  lines.push([
    gsiWord(11, bsName.padStart(16, '0'), format),
    gsiWord(21, formatAngle(result.bsBearingDecimal), format),
    gsiWord(81, formatCoord(result.backsight.e), format),
    gsiWord(82, formatCoord(result.backsight.n), format),
  ].join(''))

  // Stakeout points
  for (const row of result.rows) {
    const pointNum = row.id.padStart(16, '0')
    const parts = [
      gsiWord(11, pointNum, format),
      gsiWord(21, formatAngle(row.HzDecimal), format),
      gsiWord(31, formatDistance(row.SD), format),
      gsiWord(84, (row.TH * 1000).toFixed(0).padStart(16, '0'), format),
      gsiWord(81, formatCoord(row.designE), format),
      gsiWord(82, formatCoord(row.designN), format),
      gsiWord(83, formatCoord(row.designRL), format),
    ]

    if (options.includeFaces) {
      // Face right: Hz + 180°
      const hzFr = (row.HzDecimal + 180) % 360
      parts.push(gsiWord(22, formatAngle(hzFr), format))
    }

    lines.push(parts.join(''))
  }

  return {
    content: lines.join('\n') + '\n',
    filename: `stakeout_${stationName}.gsi`,
    mimeType: 'text/plain',
    format,
    pointCount: result.rows.length,
  }
}

// ─── SDR Writer (Topcon/Sokkia) ─────────────────────────────────────────────

/**
 * SDR v20/v33 format — used by Topcon and Sokkia instruments.
 *
 * Key record types:
 *   00MP  = Memory point (point ID + coordinates)
 *   01NM  = Station setup
 *   02BS  = Backsight
 *   03CO  = Coordinate record
 *   08ST  = Stakeout point
 */
export function exportStakeoutToSDR(
  result: SettingOutResult,
  options: ExportOptions = {},
): ExportResult {
  const stationName = options.stationName || 'STN1'
  const lines: string[] = []

  // SDR header
  lines.push('00NMETARDU STAKEOUT EXPORT')
  lines.push(`01NM${stationName},${result.instrumentStation.e.toFixed(4)},${result.instrumentStation.n.toFixed(4)},${result.instrumentStation.rl.toFixed(4)},${result.instrumentStation.ih.toFixed(3)}`)

  // Backsight
  const bsName = options.backsightName || 'BS1'
  lines.push(`02BS${bsName},${result.backsight.e.toFixed(4)},${result.backsight.n.toFixed(4)}`)

  // Stakeout points
  for (const row of result.rows) {
    // Coordinate record (for the instrument to navigate to)
    lines.push(`03CO${row.id},${row.designE.toFixed(4)},${row.designN.toFixed(4)},${row.designRL.toFixed(4)}`)
    // Stakeout instruction
    lines.push(`08ST${row.id},${row.HzDecimal.toFixed(6)},${row.SD.toFixed(4)},${row.TH.toFixed(3)}`)
  }

  // SDR footer
  lines.push('99END')

  return {
    content: lines.join('\r\n') + '\r\n',
    filename: `stakeout_${stationName}.sdr`,
    mimeType: 'text/plain',
    format: 'SDR',
    pointCount: result.rows.length,
  }
}

// ─── CSV Writer (universal) ─────────────────────────────────────────────────

/**
 * Universal CSV format — readable by virtually all instruments and software.
 * Columns: point_id, easting, northing, RL, target_height, Hz_angle, HD, SD, description
 */
export function exportStakeoutToCSV(
  result: SettingOutResult,
  _options: ExportOptions = {},
): ExportResult {
  const lines: string[] = []

  // Header
  lines.push('point_id,easting,northing,RL,target_height,Hz_angle_deg,HD_m,SD_m,description')

  // Station info as comments
  lines.push(`# Station: ${result.instrumentStation.e.toFixed(4)},${result.instrumentStation.n.toFixed(4)},${result.instrumentStation.rl.toFixed(4)} (IH=${result.instrumentStation.ih})`)
  lines.push(`# Backsight: ${result.backsight.e.toFixed(4)},${result.backsight.n.toFixed(4)} (bearing=${result.bsBearing})`)

  // Points
  for (const row of result.rows) {
    lines.push([
      row.id,
      row.designE.toFixed(4),
      row.designN.toFixed(4),
      row.designRL.toFixed(4),
      row.TH.toFixed(3),
      row.HzDecimal.toFixed(6),
      row.HD.toFixed(4),
      row.SD.toFixed(4),
      `"${row.id}"`, // description = id for now
    ].join(','))
  }

  return {
    content: lines.join('\n') + '\n',
    filename: 'stakeout.csv',
    mimeType: 'text/csv',
    format: 'CSV',
    pointCount: result.rows.length,
  }
}

// ─── JobXML Writer ──────────────────────────────────────────────────────────

/**
 * JobXML format — XML-based, used by modern total stations and data collectors.
 * Based on the Trimble JobXML 2.1 specification.
 */
export function exportStakeoutToJobXML(
  result: SettingOutResult,
  options: ExportOptions = {},
): ExportResult {
  const stationName = options.stationName || 'STN1'
  const bsName = options.backsightName || 'BS1'

  const pointXml = result.rows.map((row, i) => {
    return `      <Point name="${row.id}" code="STAKEOUT">
        <Coordinates north="${row.designN.toFixed(4)}" east="${row.designE.toFixed(4)}" elev="${row.designRL.toFixed(4)}"/>
        <StakeoutData horizontalAngle="${row.HzDecimal.toFixed(6)}" slopeDistance="${row.SD.toFixed(4)}" targetHeight="${row.TH.toFixed(3)}"/>
      </Point>`
  }).join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<JobXML version="2.1" xmlns="http://www.trimble.com/schemas/JobXML">
  <Job name="METARDU Stakeout" createdBy="METARDU" createdAt="${new Date().toISOString()}">
    <StationSetup name="${stationName}">
      <Station>
        <Coordinates north="${result.instrumentStation.n.toFixed(4)}" east="${result.instrumentStation.e.toFixed(4)}" elev="${result.instrumentStation.rl.toFixed(4)}"/>
        <InstrumentHeight>${result.instrumentStation.ih.toFixed(3)}</InstrumentHeight>
      </Station>
      <Backsight name="${bsName}">
        <Coordinates north="${result.backsight.n.toFixed(4)}" east="${result.backsight.e.toFixed(4)}"/>
        <Bearing>${result.bsBearing}</Bearing>
      </Backsight>
    </StationSetup>
    <Points>
${pointXml}
    </Points>
  </Job>
</JobXML>`

  return {
    content: xml,
    filename: `stakeout_${stationName}.jxl`,
    mimeType: 'application/xml',
    format: 'JobXML',
    pointCount: result.rows.length,
  }
}

// ─── Unified Export Function ────────────────────────────────────────────────

/**
 * Export a stakeout result to the specified instrument format.
 *
 * @example
 *   const result = exportStakeout(result, 'GSI-8')
 *   const blob = new Blob([result.content], { type: result.mimeType })
 *   // Download blob as result.filename
 */
export function exportStakeout(
  result: SettingOutResult,
  format: InstrumentFormat,
  options: ExportOptions = {},
): ExportResult {
  switch (format) {
    case 'GSI-8':
      return exportStakeoutToGSI(result, { ...options, format: 'GSI-8' })
    case 'GSI-16':
      return exportStakeoutToGSI(result, { ...options, format: 'GSI-16' })
    case 'SDR':
      return exportStakeoutToSDR(result, options)
    case 'CSV':
      return exportStakeoutToCSV(result, options)
    case 'JobXML':
      return exportStakeoutToJobXML(result, options)
    default:
      return exportStakeoutToCSV(result, options)
  }
}

/**
 * Get the available export formats with descriptions for the UI.
 */
export function getAvailableFormats(): Array<{ value: InstrumentFormat; label: string; description: string }> {
  return [
    { value: 'CSV', label: 'CSV', description: 'Universal format — works with all instruments and software' },
    { value: 'GSI-8', label: 'GSI-8 (Leica)', description: 'Leica total stations, compact format' },
    { value: 'GSI-16', label: 'GSI-16 (Leica)', description: 'Leica total stations, extended format' },
    { value: 'SDR', label: 'SDR (Topcon/Sokkia)', description: 'Topcon and Sokkia data collectors' },
    { value: 'JobXML', label: 'JobXML', description: 'Trimble and modern data collectors' },
  ]
}
