// Leica DiNi 12/22 Digital Level – RAW/DAT Format Parser
// Parses measurement files exported from Leica DiNi digital levels.

import { LevelReading, LevelObservation, LevelImportResult } from './digitalLevelTypes'

/**
 * Parse Leica DiNi RAW/DAT format into level readings and observations.
 *
 * Expected format (DiNi RAW):
 *   Start-No.|  1
 *   End-No.: |99999
 *   Staff1:  |  10001
 *   Staff2:  |  10002
 *   1|BM1          |  1.65432|  25.432|BM
 *   2|TP1          |  0.87654|  30.121|
 *
 * Or DAT format (simpler):
 *   BM1,1.65432,25.432,BS
 *   TP1,0.87654,30.121,FS
 */
export function parseDiNi(content: string, filename?: string): LevelImportResult {
  const lines = content.split(/\r?\n/)
  const parseErrors: string[] = []
  const readings: LevelReading[] = []

  const metadata: LevelImportResult['metadata'] = {
    rawLineCount: lines.length,
    parseErrors: [],
  }

  let instrument = 'DiNi'
  let jobNumber = ''
  let dateStr = ''
  let staffA = ''
  let staffB = ''
  let instrumentHeight = 1.6

  // Detect format: pipe-delimited (RAW) vs comma-delimited (DAT)
  const firstDataLine = lines.find(l => {
    const t = l.trim()
    return t.length > 0 && !t.startsWith('Start') && !t.startsWith('End') &&
           !t.startsWith('Staff') && !t.startsWith('Inst') && !t.startsWith('Job') &&
           !t.startsWith('Date') && !t.startsWith('Operator') && !t.startsWith('---')
  })

  const isRawFormat = firstDataLine ? firstDataLine.includes('|') : false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('---')) continue

    // ── Metadata ────────────────────────────────────────────────
    const instMatch = trimmed.match(/Inst[^:]*:\s*\|?\s*(.+)/i)
    if (instMatch) {
      instrument = instMatch[1].replace('|', '').trim() || instrument
      metadata.instrument = instrument
      continue
    }

    const jobMatch = trimmed.match(/Job[^:]*:\s*\|?\s*(.+)/i)
    if (jobMatch) {
      jobNumber = jobMatch[1].replace('|', '').trim()
      metadata.jobNumber = jobNumber
      continue
    }

    const dateMatch = trimmed.match(/Date[^:]*:\s*\|?\s*(.+)/i)
    if (dateMatch) {
      dateStr = dateMatch[1].replace('|', '').trim()
      metadata.date = dateStr
      continue
    }

    const staff1Match = trimmed.match(/Staff\s*1[^:]*:\s*\|?\s*(.+)/i)
    if (staff1Match) {
      staffA = staff1Match[1].replace('|', '').trim()
      metadata.staffA = staffA
      continue
    }

    const staff2Match = trimmed.match(/Staff\s*2[^:]*:\s*\|?\s*(.+)/i)
    if (staff2Match) {
      staffB = staff2Match[1].replace('|', '').trim()
      metadata.staffB = staffB
      continue
    }

    const opMatch = trimmed.match(/Operator[^:]*:\s*\|?\s*(.+)/i)
    if (opMatch) {
      metadata.operator = opMatch[1].replace('|', '').trim()
      continue
    }

    // Skip header keywords
    if (/^(Start|End|Adr|Code|PtID|Rem)/i.test(trimmed)) continue

    // ── Data rows ───────────────────────────────────────────────
    if (isRawFormat) {
      const reading = parseDiNiRawRow(trimmed, instrumentHeight, i + 1)
      if (reading) {
        readings.push(reading)
      } else if (trimmed.length > 2 && !trimmed.includes(':')) {
        parseErrors.push(`Line ${i + 1}: Could not parse DiNi RAW row: "${trimmed.substring(0, 60)}"`)
      }
    } else {
      const reading = parseDiNiDatRow(trimmed, instrumentHeight, i + 1)
      if (reading) {
        readings.push(reading)
      } else if (trimmed.includes(',') && trimmed.length > 3) {
        parseErrors.push(`Line ${i + 1}: Could not parse DiNi DAT row: "${trimmed.substring(0, 60)}"`)
      }
    }
  }

  metadata.parseErrors = parseErrors

  const observations = buildDiNiObservations(readings)

  return {
    format: 'dini',
    readings,
    observations,
    metadata,
  }
}

/**
 * Parse DiNi RAW format row.
 * Format: No|Station|StaffReading|Distance|Remark
 * Example: 1|BM1          |  1.65432|  25.432|BM
 */
function parseDiNiRawRow(
  line: string,
  instrumentHeight: number,
  lineNo: number
): LevelReading | null {
  const parts = line.split('|').map(s => s.trim()).filter(s => s.length > 0)
  if (parts.length < 3) return null

  // parts[0] = number, parts[1] = station, parts[2] = reading, [3] = distance, [4] = remark
  const stationId = parts[1]
  const staffReading = parseFloat(parts[2])
  if (isNaN(staffReading)) return null

  const distance = parts.length >= 4 ? parseFloat(parts[3]) : 30
  const remark = parts.length >= 5 ? parts[4] : undefined

  let type: 'BS' | 'FS' | 'IS' = 'BS'
  if (remark) {
    const lower = remark.toLowerCase()
    if (lower.includes('fs') || lower.includes('foresight')) type = 'FS'
    else if (lower.includes('is') || lower.includes('intermediate')) type = 'IS'
  }

  return {
    stationId,
    type,
    staffReading,
    distance: isNaN(distance) ? 30 : distance,
    instrumentHeight,
    comment: remark,
  }
}

/**
 * Parse DiNi DAT format row (CSV-like).
 * Format: Station,Reading,Distance,Type
 * Example: BM1,1.65432,25.432,BS
 */
function parseDiNiDatRow(
  line: string,
  instrumentHeight: number,
  lineNo: number
): LevelReading | null {
  const parts = line.split(',').map(s => s.trim()).filter(s => s.length > 0)
  if (parts.length < 2) return null

  const stationId = parts[0]
  const staffReading = parseFloat(parts[1])
  if (isNaN(staffReading)) return null

  const distance = parts.length >= 3 ? parseFloat(parts[2]) : 30
  const typeStr = parts.length >= 4 ? parts[3].toUpperCase() : 'BS'

  let type: 'BS' | 'FS' | 'IS' = 'BS'
  if (typeStr.includes('FS') || typeStr.includes('FORESIGHT')) type = 'FS'
  else if (typeStr.includes('IS') || typeStr.includes('INTERMEDIATE')) type = 'IS'

  return {
    stationId,
    type,
    staffReading,
    distance: isNaN(distance) ? 30 : distance,
    instrumentHeight,
  }
}

/**
 * Build observations from DiNi readings (BS/FS pairs).
 */
function buildDiNiObservations(readings: LevelReading[]): LevelObservation[] {
  const observations: LevelObservation[] = []
  let bsReading: LevelReading | null = null

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
