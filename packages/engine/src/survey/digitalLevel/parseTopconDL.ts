// Topcon DL Digital Level – Format Parser
// Parses measurement files exported from Topcon DL-101/102/103 digital levels.

import { LevelReading, LevelObservation, LevelImportResult } from './digitalLevelTypes'

/**
 * Parse Topcon DL format into level readings and observations.
 *
 * Topcon DL exports typically have:
 *   Job header lines with instrument/model info
 *   Data lines:  PtID  BM/TP flag  Reading  Distance  Comment
 *
 * Format variants:
 *   Space-separated: "BM1  BM  1.65432  25.4  BS"
 *   Or fixed-width columns from DL-102/DL-103
 */
export function parseTopconDL(content: string, filename?: string): LevelImportResult {
  const lines = content.split(/\r?\n/)
  const parseErrors: string[] = []
  const readings: LevelReading[] = []

  const metadata: LevelImportResult['metadata'] = {
    rawLineCount: lines.length,
    parseErrors: [],
  }

  let instrument = 'Topcon-DL'
  let jobNumber = ''
  let dateStr = ''
  let instrumentHeight = 1.6

  let inDataSection = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('---')) continue

    // ── Header detection ────────────────────────────────────────
    if (trimmed.match(/topcon/i) && trimmed.match(/dl/i)) {
      metadata.instrument = trimmed.split(/\s+/)[0] || 'Topcon-DL'
      instrument = metadata.instrument
      continue
    }

    // Model line like "DL-102" or "DL103"
    if (trimmed.match(/^DL-\d{2,3}$/) || trimmed.match(/^DL\d{2,3}$/)) {
      instrument = trimmed
      metadata.instrument = instrument
      continue
    }

    // ── Metadata fields ─────────────────────────────────────────
    const jobMatch = trimmed.match(/job\s*[^:]*:\s*(.+)/i)
    if (jobMatch) {
      jobNumber = jobMatch[1].trim()
      metadata.jobNumber = jobNumber
      continue
    }

    const dateMatch = trimmed.match(/date\s*[^:]*:\s*(.+)/i)
    if (dateMatch) {
      dateStr = dateMatch[1].trim()
      metadata.date = dateStr
      continue
    }

    const opMatch = trimmed.match(/operator\s*[^:]*:\s*(.+)/i)
    if (opMatch) {
      metadata.operator = opMatch[1].trim()
      continue
    }

    // ── Column header detection ─────────────────────────────────
    if (trimmed.match(/(point|station|ptid|reading|dist)/i) && !trimmed.match(/^\d/)) {
      inDataSection = true
      continue
    }

    // ── Data rows ───────────────────────────────────────────────
    // Topcon DL data: starts with station ID (non-numeric or numeric+letter combo)
    if (trimmed.match(/^[\w-]+\s/) || trimmed.match(/^[\w-]+\t/)) {
      inDataSection = true
    }

    if (inDataSection) {
      const reading = parseTopconDataRow(trimmed, instrumentHeight, i + 1)
      if (reading) {
        readings.push(reading)
      } else if (trimmed.length > 2 && !trimmed.includes(':')) {
        // Maybe it's a data row with different format
        const altReading = parseTopconAltRow(trimmed, instrumentHeight, i + 1)
        if (altReading) {
          readings.push(altReading)
        } else {
          parseErrors.push(`Line ${i + 1}: Could not parse Topcon DL row: "${trimmed.substring(0, 60)}"`)
        }
      }
    } else if (trimmed.includes(';')) {
      // Semicolon-separated data may appear without column header
      const altReading = parseTopconAltRow(trimmed, instrumentHeight, i + 1)
      if (altReading) {
        inDataSection = true
        readings.push(altReading)
      }
    }
  }

  metadata.parseErrors = parseErrors

  const observations = buildTopconObservations(readings)

  return {
    format: 'topcon-dl',
    readings,
    observations,
    metadata,
  }
}

/**
 * Parse a Topcon DL data row.
 * Format: Station  [BM/TP flag]  Reading  Distance  [Type]
 * Example: "BM1  BM  1.65432  25.4  BS"
 */
function parseTopconDataRow(
  line: string,
  instrumentHeight: number,
  lineNo: number
): LevelReading | null {
  const parts = line.split(/[\s\t]+/).filter(s => s.length > 0)
  if (parts.length < 2) return null

  // First token is station ID
  const stationId = parts[0]

  // Find numeric tokens for reading and distance
  const numericTokens: number[] = []
  const nonNumericTokens: string[] = []

  for (let j = 1; j < parts.length; j++) {
    const val = parseFloat(parts[j])
    if (!isNaN(val)) {
      numericTokens.push(val)
    } else {
      nonNumericTokens.push(parts[j].toUpperCase())
    }
  }

  if (numericTokens.length === 0) return null

  const staffReading = numericTokens[0]
  const distance = numericTokens.length >= 2 ? numericTokens[1] : 30

  // Determine type from non-numeric tokens
  let type: 'BS' | 'FS' | 'IS' = 'BS'
  for (const token of nonNumericTokens) {
    if (token.includes('FS') || token === 'FORESIGHT') { type = 'FS'; break }
    if (token.includes('IS') || token === 'INTERMEDIATE') { type = 'IS'; break }
  }

  // If station starts with TP and there's no explicit type, assume FS
  if (stationId.toUpperCase().startsWith('TP') && nonNumericTokens.length === 0) {
    // Keep as BS – type determination requires sequential context
  }

  return {
    stationId,
    type,
    staffReading,
    distance: isNaN(distance) ? 30 : distance,
    instrumentHeight,
  }
}

/**
 * Alternative Topcon DL format: tab-separated or semicolon-separated.
 */
function parseTopconAltRow(
  line: string,
  instrumentHeight: number,
  lineNo: number
): LevelReading | null {
  // Try semicolon separator (some Topcon exports)
  if (line.includes(';')) {
    const parts = line.split(';').map(s => s.trim()).filter(s => s.length > 0)
    if (parts.length >= 2) {
      const stationId = parts[0]
      const staffReading = parseFloat(parts[1])
      if (isNaN(staffReading)) return null
      const distance = parts.length >= 3 ? parseFloat(parts[2]) : 30
      const typeStr = parts.length >= 4 ? parts[3].toUpperCase() : 'BS'

      let type: 'BS' | 'FS' | 'IS' = 'BS'
      if (typeStr.includes('FS')) type = 'FS'
      else if (typeStr.includes('IS')) type = 'IS'

      return {
        stationId,
        type,
        staffReading,
        distance: isNaN(distance) ? 30 : distance,
        instrumentHeight,
      }
    }
  }

  return null
}

/**
 * Build observations from Topcon readings (BS/FS pairs).
 */
function buildTopconObservations(readings: LevelReading[]): LevelObservation[] {
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
