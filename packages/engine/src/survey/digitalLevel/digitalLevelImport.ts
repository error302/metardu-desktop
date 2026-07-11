// Digital Level Unified Import – Auto-detect Format + Parse
// Supports: Leica DNA03, Leica DiNi 12/22, Topcon DL, Generic CSV

import { LevelFormat, LevelImportResult, LevelObservation } from './digitalLevelTypes'
import { parseDNA03 } from './parseDNA03'
import { parseDiNi } from './parseDiNi'
import { parseTopconDL } from './parseTopconDL'

/**
 * Detect the digital level file format from content and filename.
 */
export function detectLevelFormat(content: string, filename: string): LevelFormat {
  const ext = filename.toLowerCase().split('.').pop() || ''
  const firstLine = content.trim().split(/\r?\n/)[0]?.trim() || ''
  const firstThreeLines = content.trim().split(/\r?\n/).slice(0, 3).join('\n')

  // ── Extension-based detection ─────────────────────────────────
  if (ext === 'rdt' || ext === 'dna') return 'dna03'
  if (ext === 'raw' || ext === 'dat') {
    // Could be DiNi or Topcon – check content
    if (firstThreeLines.includes('DiNi') || content.includes('Staff1:')) return 'dini'
    if (firstThreeLines.match(/topcon/i) || firstThreeLines.match(/dl/i)) return 'topcon-dl'
  }
  if (ext === 'csv' || ext === 'txt') {
    // CSV is the fallback
  }

  // ── Content-based detection ───────────────────────────────────
  // DNA03: header with "DNA03" and "Digital Level"
  if (firstLine.includes('DNA03') && firstLine.includes('Digital Level')) return 'dna03'
  if (firstLine.includes(' DNA03')) return 'dna03'
  if (firstLine.match(/Inst-No:/)) return 'dna03'

  // DiNi: pipe-delimited data, Staff1/Staff2 headers
  if (content.includes('Staff1:') || content.includes('Staff2:')) return 'dini'
  if (firstLine.includes('DiNi')) return 'dini'
  // DiNi RAW: pipe-separated data rows
  if (firstLine.match(/^\d+\|/)) return 'dini'

  // Topcon DL: model identifier
  if (firstLine.match(/topcon/i) && firstLine.match(/dl/i)) return 'topcon-dl'
  if (firstLine.match(/^DL[-]?\d{2,3}/)) return 'topcon-dl'

  // ── CSV detection ─────────────────────────────────────────────
  // Check for CSV header keywords
  const lowerFirst = firstLine.toLowerCase()
  if (
    lowerFirst.includes('station') &&
    (lowerFirst.includes('backsight') || lowerFirst.includes('foresight') || lowerFirst.includes('reading'))
  ) {
    return 'csv'
  }

  // Check if first line has comma-separated values with numeric data
  const csvParts = firstLine.split(',').map(s => s.trim())
  if (csvParts.length >= 3 && csvParts.some(p => !isNaN(parseFloat(p)) && p.length > 0)) {
    return 'csv'
  }

  return 'unknown'
}

/**
 * Parse generic CSV level data.
 *
 * Supported column headers (case-insensitive):
 *   Station, Backsight, Foresight, Distance, InstrumentHeight, StaffHeight, Type, Comment
 *
 * Rows can be:
 *   BM1,,1.65432,0.025,1.600,,BS
 *   BM1,1.65432,0.87654,0.030,1.600,,FS
 *
 * Or simplified:
 *   Station,Reading,Distance,Type
 */
function parseGenericCSV(content: string): LevelImportResult {
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0)
  const parseErrors: string[] = []
  const readings: LevelImportResult['readings'] = []

  const metadata: LevelImportResult['metadata'] = {
    rawLineCount: lines.length,
    parseErrors: [],
  }

  if (lines.length === 0) {
    return { format: 'csv', readings: [], observations: [], metadata }
  }

  // Parse header
  const header = lines[0].split(',').map(s => s.trim().toLowerCase())
  const dataLines = lines.slice(1)

  // Find column indices
  const stationIdx = header.findIndex(h =>
    h === 'station' || h === 'point' || h === 'ptid' || h === 'name' || h === 'stationid'
  )
  const bsIdx = header.findIndex(h =>
    h === 'backsight' || h === 'bs' || h === 'bsreading'
  )
  const fsIdx = header.findIndex(h =>
    h === 'foresight' || h === 'fs' || h === 'fsreading'
  )
  const readingIdx = header.findIndex(h =>
    h === 'reading' || h === 'staffreading' || h === 'staff' || h === 'staffreading'
  )
  const distIdx = header.findIndex(h =>
    h === 'distance' || h === 'dist' || h === 'sightdistance'
  )
  const ihIdx = header.findIndex(h =>
    h === 'instrumentheight' || h === 'hi' || h === 'heightofinstrument'
  )
  const typeIdx = header.findIndex(h =>
    h === 'type' || h === 'sighttype'
  )
  const commentIdx = header.findIndex(h =>
    h === 'comment' || h === 'remarks' || h === 'note'
  )

  // We need either station+reading+type, or station+bs+fs columns
  const hasSimpleFormat = stationIdx >= 0 && readingIdx >= 0
  const hasBSFSFormat = stationIdx >= 0 && (bsIdx >= 0 || fsIdx >= 0)

  if (!hasSimpleFormat && !hasBSFSFormat) {
    parseErrors.push('Could not find required columns (Station + Reading or Station + BS/FS)')
    metadata.parseErrors = parseErrors
    return { format: 'csv', readings: [], observations: [], metadata }
  }

  for (let i = 0; i < dataLines.length; i++) {
    const parts = dataLines[i].split(',').map(s => s.trim())
    if (parts.length < 2 || !parts[stationIdx]) continue

    const stationId = parts[stationIdx]

    if (hasSimpleFormat) {
      const staffReading = parseFloat(parts[readingIdx])
      if (isNaN(staffReading)) {
        parseErrors.push(`Line ${i + 2}: Invalid reading at station ${stationId}`)
        continue
      }

      const distance = distIdx >= 0 ? parseFloat(parts[distIdx]) : 30
      const instrumentHeight = ihIdx >= 0 ? parseFloat(parts[ihIdx]) : 1.6
      const typeStr = typeIdx >= 0 ? (parts[typeIdx] || '').toUpperCase() : 'BS'
      const comment = commentIdx >= 0 ? parts[commentIdx] : undefined

      let type: 'BS' | 'FS' | 'IS' = 'BS'
      if (typeStr.includes('FS') || typeStr === 'FORESIGHT') type = 'FS'
      else if (typeStr.includes('IS') || typeStr === 'INTERMEDIATE') type = 'IS'

      readings.push({
        stationId,
        type,
        staffReading,
        distance: isNaN(distance) ? 30 : distance,
        instrumentHeight: isNaN(instrumentHeight) ? 1.6 : instrumentHeight,
        comment,
      })
    } else if (hasBSFSFormat) {
      // BS/FS format: each row has station, BS, FS
      const bs = bsIdx >= 0 ? parseFloat(parts[bsIdx]) : NaN
      const fs = fsIdx >= 0 ? parseFloat(parts[fsIdx]) : NaN
      const distance = distIdx >= 0 ? parseFloat(parts[distIdx]) : 30
      const instrumentHeight = ihIdx >= 0 ? parseFloat(parts[ihIdx]) : 1.6
      const comment = commentIdx >= 0 ? parts[commentIdx] : undefined

      if (!isNaN(bs)) {
        readings.push({
          stationId,
          type: 'BS',
          staffReading: bs,
          distance: isNaN(distance) ? 30 : distance,
          instrumentHeight: isNaN(instrumentHeight) ? 1.6 : instrumentHeight,
          comment,
        })
      }
      if (!isNaN(fs)) {
        readings.push({
          stationId,
          type: 'FS',
          staffReading: fs,
          distance: isNaN(distance) ? 30 : distance,
          instrumentHeight: isNaN(instrumentHeight) ? 1.6 : instrumentHeight,
          comment,
        })
      }
    }
  }

  metadata.parseErrors = parseErrors

  // Build observations from BS/FS pairs
  const observations = buildCSVObservations(readings)

  return { format: 'csv', readings, observations, metadata }
}

/**
 * Build observations from CSV readings (BS/FS pairs).
 */
function buildCSVObservations(readings: LevelImportResult['readings']): LevelImportResult['observations'] {
  const observations: LevelObservation[] = []
  let bsReading: any = null

  for (const r of readings) {
    if (r.type === 'BS') {
      bsReading = r
    } else if (r.type === 'FS' && bsReading) {
      const heightDifference = bsReading.staffReading - r.staffReading
      const distance = (bsReading.distance + r.distance) / 2
      const distKm = distance / 1000
      const weight = distKm > 0 ? 1 / (distKm * distKm) : 1000

      observations.push({
        fromId: bsReading.stationId,
        toId: r.stationId,
        heightDifference,
        distance,
        weight,
      })
      bsReading = null
    }
  }

  return observations
}

/**
 * Unified import: auto-detect format and parse.
 */
export function importDigitalLevel(content: string, filename: string): LevelImportResult {
  const format = detectLevelFormat(content, filename)

  switch (format) {
    case 'dna03':
      return parseDNA03(content, filename)
    case 'dini':
      return parseDiNi(content, filename)
    case 'topcon-dl':
      return parseTopconDL(content, filename)
    case 'csv':
      return parseGenericCSV(content)
    default:
      // Try CSV as last resort
      return parseGenericCSV(content)
  }
}

export { parseGenericCSV }
