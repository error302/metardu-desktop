// Leica DNA03 / DNA03-2 Digital Level – RDT Format Parser
// Parses raw measurement files exported from Leica DNA03 digital levels.

import { LevelReading, LevelObservation, LevelImportResult } from './digitalLevelTypes'

/**
 * Parse Leica DNA03 RDT format into level readings and observations.
 *
 * Expected format:
 *   Header line: starts with " DNA03" or contains "Digital Level"
 *   Instrument/Job/Staff metadata lines
 *   Measurement header: RNo Sta  RNo Sta   Ht.m  Diff.m  Comments
 *   Data rows:   1  BM1  2  TP1    1.65432  1.23456  BS to TP1
 */
export function parseDNA03(content: string, filename?: string): LevelImportResult {
  const lines = content.split(/\r?\n/)
  const parseErrors: string[] = []
  const readings: LevelReading[] = []

  const metadata: LevelImportResult['metadata'] = {
    rawLineCount: lines.length,
    parseErrors: [],
  }

  let instrument = ''
  let jobNumber = ''
  let dateStr = ''
  let staffA = ''
  let staffB = ''
  let currentInstrumentHeight = 1.6 // default

  let inDataSection = false
  let bsBuffer: LevelReading | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('---')) continue

    // ── Header detection ────────────────────────────────────────
    if (trimmed.includes('DNA03') && trimmed.includes('Digital Level')) {
      // Extract instrument info from header
      const parts = trimmed.split(/\s+/)
      if (parts.length >= 1) {
        instrument = parts[0] || 'DNA03'
      }
      // Date is typically DD.MM.YYYY
      const dateMatch = trimmed.match(/(\d{2}\.\d{2}\.\d{4})/)
      if (dateMatch) dateStr = dateMatch[1]
      continue
    }

    // ── Metadata fields ─────────────────────────────────────────
    if (trimmed.toLowerCase().startsWith('inst-no:')) {
      instrument = trimmed.split(':')[1]?.trim() || instrument
      metadata.instrument = instrument
      continue
    }
    if (trimmed.toLowerCase().startsWith('job-no:')) {
      jobNumber = trimmed.split(':')[1]?.trim() || ''
      metadata.jobNumber = jobNumber
      continue
    }
    if (trimmed.toLowerCase().startsWith('staff:')) {
      const staffParts = trimmed.split(/\s+/).filter(s => s)
      if (staffParts.length >= 2) staffA = staffParts[1] || ''
      if (staffParts.length >= 3) staffB = staffParts[2] || ''
      metadata.staffA = staffA
      metadata.staffB = staffB
      continue
    }
    if (trimmed.toLowerCase().startsWith('operator:')) {
      metadata.operator = trimmed.split(':')[1]?.trim()
      continue
    }

    // ── Date line ───────────────────────────────────────────────
    if (!dateStr) {
      const dateMatch = trimmed.match(/(\d{2}\.\d{2}\.\d{4})/)
      if (dateMatch) dateStr = dateMatch[1]
    }

    // ── Data section header ─────────────────────────────────────
    if (trimmed.includes('RNo') && trimmed.includes('Sta') && (trimmed.includes('Ht') || trimmed.includes('Diff'))) {
      inDataSection = true
      continue
    }

    // ── Measurement data rows ───────────────────────────────────
    if (inDataSection) {
      const reading = parseDNAMeasurementRow(trimmed, currentInstrumentHeight, i + 1)
      if (reading) {
        readings.push(reading)
      } else if (trimmed.length > 0) {
        // Try alternative format: numeric fields
        const altReading = parseDNAAltRow(trimmed, currentInstrumentHeight, i + 1)
        if (altReading) {
          readings.push(altReading)
        } else {
          parseErrors.push(`Line ${i + 1}: Could not parse measurement: "${trimmed.substring(0, 60)}"`)
        }
      }
    }
  }

  metadata.date = dateStr
  metadata.parseErrors = parseErrors

  // Build observations from consecutive BS/FS pairs
  const observations = buildObservationsFromReadings(readings)

  return {
    format: 'dna03',
    readings,
    observations,
    metadata,
  }
}

/**
 * Parse a DNA03 measurement row.
 * Format: RNo1 Sta1 RNo2 Sta2 Ht.m Diff.m Comments
 */
function parseDNAMeasurementRow(
  line: string,
  instrumentHeight: number,
  lineNo: number
): LevelReading | null {
  // Match pattern: number station number station number number comment
  // e.g., "1  BM1  2  TP1    1.65432     1.23456     BS to TP1"
  const match = line.match(
    /^(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s*(.*)?$/
  )
  if (!match) return null

  const staffReading = parseFloat(match[5])
  const stationId = match[4]
  const rNo1 = parseInt(match[1], 10)
  const comment = (match[7] || '').trim()

  // Determine reading type from context
  let type: 'BS' | 'FS' | 'IS' = 'BS'
  if (comment.toLowerCase().includes('fs') || comment.toLowerCase().includes('foresight')) {
    type = 'FS'
  } else if (comment.toLowerCase().includes('is') || comment.toLowerCase().includes('intermediate')) {
    type = 'IS'
  }

  // Estimate distance from staff reading magnitude (DNA03 stores dist internally)
  // In real data, distance may be embedded; here we derive from staff or use a default
  const distance = estimateDistanceFromStaffReading(staffReading)

  // Parse timestamp from comment if present
  let timestamp: Date | undefined
  const timeMatch = comment.match(/(\d{2}:\d{2}:\d{2})/)
  if (timeMatch) {
    timestamp = new Date(`1970-01-01T${timeMatch[1]}`)
  }

  return {
    stationId,
    type,
    staffReading,
    distance,
    instrumentHeight,
    timestamp,
    comment: comment || undefined,
  }
}

/**
 * Parse alternative DNA03 row format (simpler numeric columns).
 * Format: StaId  Reading  Distance  [Comment]
 */
function parseDNAAltRow(
  line: string,
  instrumentHeight: number,
  lineNo: number
): LevelReading | null {
  const parts = line.split(/\s+/).filter(s => s.length > 0)
  if (parts.length < 2) return null

  const stationId = parts[0]
  const staffReading = parseFloat(parts[1])
  if (isNaN(staffReading)) return null

  const distance = parts.length >= 3 ? parseFloat(parts[2]) : estimateDistanceFromStaffReading(staffReading)
  const comment = parts.length >= 4 ? parts.slice(3).join(' ') : undefined

  let type: 'BS' | 'FS' | 'IS' = 'BS'
  if (comment) {
    const lower = comment.toLowerCase()
    if (lower.includes('fs') || lower.includes('foresight')) type = 'FS'
    else if (lower.includes('is') || lower.includes('intermediate')) type = 'IS'
  }

  return {
    stationId,
    type,
    staffReading,
    distance: isNaN(distance) ? 30 : distance,
    instrumentHeight,
    comment,
  }
}

/**
 * Estimate distance based on staff reading magnitude.
 * Digital levels read invar barcode staff – typical sight distances 20-60 m.
 * This is a fallback when distance is not explicitly recorded.
 */
function estimateDistanceFromStaffReading(staffReading: number): number {
  // Typical range 0.3 – 3.0 m on staff
  // Return a reasonable default distance
  if (staffReading < 0.5 || staffReading > 4.0) return 30 // unusual reading
  return 30 // default 30 m sight distance
}

/**
 * Build LevelObservation array from a sequence of LevelReadings.
 * Consecutive BS/FS pairs become height difference observations.
 */
function buildObservationsFromReadings(readings: LevelReading[]): LevelObservation[] {
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
    // IS readings don't form observations directly
  }

  return observations
}
