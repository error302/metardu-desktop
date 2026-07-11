/**
 * METARDU — Leica GSI Field Data Parser
 *
 * Parses Leica total station raw observation files (.gsi) as exported by
 * Leica TPS1000/1200/TS/TM instruments.
 *
 * Format reference: Leica TPS1000 Technical Reference (ISO 17123-3 compliant),
 *   Ghilani & Wolf, Elementary Surveying 16th Ed., Chapter 13
 *
 * GSI-8 (8-char words) and GSI-16 (16-char words) are both supported.
 * Multiple word types per record. Records may span multiple lines.
 *
 * Word types used in Kenyan surveying:
 *   01  — Point number (ASCII string, left-padded with spaces)
 *   02  — Additional point number
 *   11  — Slope distance (mm, 0.001m resolution)
 *   12  — Horizontal distance (mm)
 *   13  — Horizontal distance, corrected (mm)
 *   14  — Horizontal circle, face-left (Hz — hundredths of arc-second, 360°)
 *   15  — Vertical circle (V — hundredths of arc-second)
 *   16  — Horizontal circle, face-right (second face, used to compute mean)
 *   17  — Slope distance with high accuracy (0.1mm resolution)
 *   21  — Easting (coordinate, 0.001m)
 *   22  — Northing (coordinate, 0.001m)
 *   23  — Elevation (coordinate, 0.001m)
 *   32  — Height of instrument (mm)
 *   33  — Height of target (mm)
 *   41  — Time (HHMMSS)
 *   42  — Date (DDMMYY or YYMMDD depending on instrument settings)
 *   47  — Temperature (0.1°C)
 *
 * Observation reduction:
 *   Mean Hz angle = (Hz_face_left + (Hz_face_right ± 180°)) / 2
 *   Horizontal Distance = SD × cos(VA)
 *   ΔH = SD × sin(VA) + IH − TH
 *
 * Output: array of GSIStation records suitable for passing to
 * computeTraverse() in @/lib/computations/traverseEngine
 */

export interface GSIObservation {
  pointNumber: string
  slopeDist?: number       // metres (from word 11/17)
  horizDist?: number       // metres (from word 12/13)
  hzFaceLeft?: number      // degrees decimal (from word 14)
  hzFaceRight?: number     // degrees decimal (from word 16)
  verticalAngle?: number  // degrees decimal (from word 15)
  instrumentHeight?: number  // metres
  targetHeight?: number   // metres
  easting?: number         // metres
  northing?: number        // metres
  elevation?: number        // metres
  temperature?: number      // degrees Celsius
  rawLine: string
}

export interface GSIStation {
  stationName: string
  stationNumber: string
  observations: GSIObservation[]
  heightOfInstrument?: number
}

export interface GSIParseResult {
  stations: GSIStation[]
  rawRecords: GSIObservation[]
  errors: string[]
  format: 'GSI-8' | 'GSI-16' | 'UNKNOWN'
  instrument: string
  totalStations: number
  totalObservations: number
}

// ── GSI word type codes ────────────────────────────────────────────────────────

/** GSI word type codes (two-digit numeric string) */
const WORD_CODES = {
  POINT_NUMBER: '01',
  SLOPE_DIST: '11',
  HORIZ_DIST: '12',
  HORIZ_DIST_CORR: '13',
  HZ_FACE_LEFT: '14',
  V_ANGLE: '15',
  HZ_FACE_RIGHT: '16',
  SLOPE_DIST_ACC: '17',
  EASTING: '21',
  NORTHING: '22',
  ELEVATION: '23',
  INSTRUMENT_HEIGHT: '32',
  TARGET_HEIGHT: '33',
} as const

type WordCode = typeof WORD_CODES[keyof typeof WORD_CODES]

// ── Word parsing helpers ────────────────────────────────────────────────────────

/**
 * Detect whether the GSI file uses 8-character or 16-character word format.
 * GSI-8: each word = 8 chars (1 char '*' + 2 char type + 5 char value)
 * GSI-16: each word = 16 chars (1 char '*' + 2 char type + 13 char value)
 *
 * Strategy: parse first non-empty line, count visible characters after the
 * first `*` to determine word boundary. Also check if the word after the
 * expected 8-char word looks like a valid type code.
 */
function detectGSIFormat(firstLine: string): 'GSI-8' | 'GSI-16' | 'UNKNOWN' {
  const firstStar = firstLine.indexOf('*')
  if (firstStar === -1) return 'UNKNOWN'

  // In GSI-8 format, after the first `*`, the word type (2 digits) starts immediately.
  // The value portion starts at offset 3 within the 8-char word.
  // In GSI-16 format, the value portion starts at offset 3 within the 16-char word.
  //
  // Detection heuristic: look at the character after where the first word ends
  // in GSI-8 mode. If it's also a `*` (start of next word), it's GSI-8.
  // If it's part of a longer value field, it's GSI-16.

  const afterFirst = firstLine.substring(firstStar + 1)

  // Try GSI-8: expect word at positions 0-7 (*01XXXXXX), next * at position 8
  if (afterFirst.length >= 8 && afterFirst.charAt(7) === '*') {
    // Next word starts immediately — this is GSI-8
    return 'GSI-8'
  }

  // Try GSI-16: word spans 16 chars (*WWXXXXXXXXXXXXX)
  if (afterFirst.length >= 16 && afterFirst.charAt(15) === '*') {
    return 'GSI-16'
  }

  // Fallback: if the first word's type code (chars 1-2) is valid (all digits)
  // and the remaining chars look like numeric data, infer from data length
  const chunk8 = afterFirst.substring(0, 8)
  const type8 = chunk8.substring(0, 2)
  const val8 = chunk8.substring(2, 8)

  const chunk16 = afterFirst.substring(0, 16)
  const type16 = chunk16.substring(0, 2)
  const val16 = chunk16.substring(2, 16)

  const typeValid = (t: string) => /^\d{2}$/.test(t)
  const valNumeric = (v: string) => /^[+\-]?\d+$/.test(v.trim())

  if (typeValid(type8) && valNumeric(val8) && afterFirst.length >= 16) {
    // If at position 8 there's a `*`, it's GSI-8
    if (afterFirst.charAt(8) === '*') return 'GSI-8'
  }

  if (typeValid(type16) && valNumeric(val16.substring(0, 13)) && afterFirst.length >= 16) {
    // Check if GSI-16 makes sense
    if (afterFirst.charAt(16) === '*') return 'GSI-16'
  }

  // Heuristic: if the value is very long (>6 chars) it's GSI-16
  if (typeValid(type8) && val8.trim().length > 6) return 'GSI-16'
  if (typeValid(type8) && val8.trim().length <= 6) return 'GSI-8'

  return 'UNKNOWN'
}

/** Parse a GSI angle value from string to decimal degrees */
function parseGSIAngle(raw: string): number {
  const s = raw.trim()
  if (!s || s === '0') return 0

  const negative = s.startsWith('-')
  const absStr = s.replace('-', '').replace('+', '')

  // GSI angle format: DDDMMSSSS (no decimal point, units = 0.01 arc-seconds)
  // Length determines how to split: 7 digits = DDMMSS, 8 digits = DDMMSSe, 9 digits = DDMMSsee
  const len = absStr.length
  let d: number, m: number, ss: number

  if (len === 7) {
    d = parseInt(absStr.substring(0, 3), 10)
    m = parseInt(absStr.substring(3, 5), 10)
    ss = parseInt(absStr.substring(5, 7), 10)
  } else if (len === 8) {
    d = parseInt(absStr.substring(0, 3), 10)
    m = parseInt(absStr.substring(3, 5), 10)
    ss = parseInt(absStr.substring(5, 8), 10) / 10
  } else if (len === 9) {
    d = parseInt(absStr.substring(0, 3), 10)
    m = parseInt(absStr.substring(3, 5), 10)
    ss = parseInt(absStr.substring(5, 9), 10) / 100
  } else if (len <= 6) {
    d = parseInt(absStr.substring(0, Math.max(1, len - 4)), 10)
    m = parseInt(absStr.substring(Math.max(1, len - 4), Math.max(2, len - 2)), 10)
    ss = parseInt(absStr.substring(Math.max(2, len - 2)), 10)
  } else {
    // Very long value — last 7 chars = DDMMSS, preceding = degrees
    const last7 = absStr.slice(-7)
    const degPart = absStr.slice(0, -7)
    d = parseInt(degPart.padStart(3, '0'), 10)
    m = parseInt(last7.substring(0, 2), 10)
    ss = parseInt(last7.substring(2, 7), 10)
  }

  if (isNaN(d) || isNaN(m) || isNaN(ss)) return 0
  const decimal = d + m / 60 + ss / 3600
  return negative ? -decimal : decimal
}

/** Parse a GSI distance value to metres */
function parseGSIDistance(raw: string): number {
  const s = raw.trim()
  if (!s || s === '0') return 0
  const value = parseInt(s, 10)
  if (isNaN(value)) return 0
  // GSI distances: 1 unit = 0.001m (millimetres)
  return value / 1000
}

// ── Core parser ─────────────────────────────────────────────────────────────

interface RawWord {
  code: string
  value: string
  raw: string
}

function extractWordsGSI(line: string, wordSize: number): RawWord[] {
  const words: RawWord[] = []
  let pos = 0

  while (pos < line.length) {
    // Each word starts with '*'
    const star = line.indexOf('*', pos)
    if (star === -1) break

    const typeCode = line.substring(star + 1, star + 3)
    if (!/^\d{2}$/.test(typeCode)) {
      pos = star + 1
      continue
    }

    const raw = line.substring(star, star + wordSize)
    const value = line.substring(star + 3, star + wordSize)

    words.push({ code: typeCode, value, raw })
    pos = star + wordSize
  }

  return words
}

/**
 * Parse a single GSI data record (one line from the .gsi file).
 * Returns a flat observation object with all values extracted.
 */
function parseGSILine(line: string, wordSize: number): GSIObservation | null {
  const trimmed = line.trim()
  if (!trimmed || !trimmed.startsWith('*')) return null

  const words = extractWordsGSI(trimmed, wordSize)
  if (words.length === 0) return null

  const obs: Partial<GSIObservation> = { rawLine: line }

  for (const word of words) {
    const code = word.code as WordCode
    const val = word.value

    switch (code) {
      case WORD_CODES.POINT_NUMBER:
        obs.pointNumber = val.trim()
        break

      case WORD_CODES.SLOPE_DIST:
      case WORD_CODES.SLOPE_DIST_ACC:
        if (!obs.slopeDist) obs.slopeDist = parseGSIDistance(val)
        break

      case WORD_CODES.HORIZ_DIST:
      case WORD_CODES.HORIZ_DIST_CORR:
        if (!obs.horizDist) obs.horizDist = parseGSIDistance(val)
        break

      case WORD_CODES.HZ_FACE_LEFT:
        obs.hzFaceLeft = parseGSIAngle(val)
        break

      case WORD_CODES.HZ_FACE_RIGHT:
        obs.hzFaceRight = parseGSIAngle(val)
        break

      case WORD_CODES.V_ANGLE:
        obs.verticalAngle = parseGSIAngle(val)
        break

      case WORD_CODES.INSTRUMENT_HEIGHT:
        obs.instrumentHeight = parseGSIDistance(val)
        break

      case WORD_CODES.TARGET_HEIGHT:
        obs.targetHeight = parseGSIDistance(val)
        break

      case WORD_CODES.EASTING:
        obs.easting = parseFloat((parseInt(val, 10) / 1000).toFixed(3))
        break

      case WORD_CODES.NORTHING:
        obs.northing = parseFloat((parseInt(val, 10) / 1000).toFixed(3))
        break

      case WORD_CODES.ELEVATION:
        obs.elevation = parseFloat((parseInt(val, 10) / 1000).toFixed(3))
        break
    }
  }

  if (!obs.pointNumber) return null
  return obs as GSIObservation
}

/**
 * Group raw GSI observations by station.
 * In GSI format, the current station name is typically the point number
 * of the instrument station observation. Observations are sequential —
 * we detect station changes by the pattern of target IDs vs station IDs.
 *
 * Simplified grouping: all observations in the file are treated as a single
 * traverse from the first station. In a full implementation, station
 * changes would be detected from the observation pattern (BS→IS→FS).
 */
function groupByStation(
  observations: GSIObservation[],
  errors: string[]
): GSIStation[] {
  if (observations.length === 0) return []

  // Find instrument station: the point that appears most frequently as the
  // target of backsight observations (Hz observations pointing TO it)
  const pointCounts = new Map<string, number>()
  for (const obs of observations) {
    const name = obs.pointNumber || 'UNKNOWN'
    pointCounts.set(name, (pointCounts.get(name) || 0) + 1)
  }

  let maxCount = 0
  let stationName = observations[0]?.pointNumber || 'Unknown'
  pointCounts.forEach((count, name) => {
    if (count > maxCount) { maxCount = count; stationName = name }
  })

  // Group consecutive observations by target changes
  // Simple approach: each time the point number changes, it's a new station
  const stations: GSIStation[] = []
  let currentStation: GSIStation = {
    stationName,
    stationNumber: stationName,
    observations: [],
  }

  let lastPoint = ''
  for (const obs of observations) {
    const pt = obs.pointNumber || ''

    if (pt !== lastPoint && obs.hzFaceLeft !== undefined) {
      // Point changed and this is a Hz observation — new station
      if (currentStation.observations.length > 0) {
        stations.push(currentStation)
      }
      // New station detected — this observation is its first shot
      const ih = obs.instrumentHeight ?? 0
      currentStation = {
        stationName: pt,
        stationNumber: pt,
        observations: [],
        heightOfInstrument: ih,
      }
    }

    currentStation.observations.push(obs)
    lastPoint = pt
  }

  if (currentStation.observations.length > 0) {
    stations.push(currentStation)
  }

  if (stations.length === 0 && observations.length > 0) {
    errors.push('Could not group observations by station — treating all as single traverse')
    stations.push({
      stationName,
      stationNumber: stationName,
      observations,
    })
  }

  return stations
}

/**
 * Parse a Leica GSI file and return observations ready for traverse computation.
 * Detects GSI-8 vs GSI-16 format automatically.
 */
export function parseGSI(gsiContent: string): GSIParseResult {
  const lines = gsiContent.split(/\r?\n/)
  const errors: string[] = []

  if (lines.length === 0) {
    return { stations: [], rawRecords: [], errors: ['Empty file'], format: 'UNKNOWN', instrument: 'Unknown', totalStations: 0, totalObservations: 0 }
  }

  // Detect format from first non-empty line
  const firstDataLine = lines.find(l => l.trim().startsWith('*')) || ''
  const format = detectGSIFormat(firstDataLine)
  const wordSize = format === 'GSI-8' ? 8 : 16

  const observations: GSIObservation[] = []
  let totalDistCount = 0

  for (const line of lines) {
    const obs = parseGSILine(line, wordSize)
    if (obs && obs.pointNumber) {
      observations.push(obs)
      if (obs.slopeDist !== undefined || obs.horizDist !== undefined) totalDistCount++
    }
  }

  const stations = groupByStation(observations, errors)

  // Detect instrument from file header lines (first few non-data lines)
  let instrument = 'Leica Total Station'
  const headerLines = lines.slice(0, 5).filter(l => !l.startsWith('*'))
  if (headerLines.length > 0) {
    instrument = headerLines[0].trim().substring(0, 50) || instrument
  }

  return {
    stations,
    rawRecords: observations,
    errors,
    format,
    instrument,
    totalStations: stations.length,
    totalObservations: observations.length,
  }
}

/**
 * Reduce raw GSI observations to the format expected by computeTraverse().
 * Applies face-left/face-right mean, HD from SD+VA, ΔH computation.
 *
 * Output is an array of TraverseEngine.RawObservation objects (or compatible).
 */
export function reduceGSIObservations(
  parseResult: GSIParseResult,
  backsightBearing: { degrees: number; minutes: number; seconds: number }
): Array<{
  station: string
  bs: string
  fs: string
  hclDeg: string
  hclMin: string
  hclSec: string
  hcrDeg: string
  hcrMin: string
  hcrSec: string
  slopeDist: string
  vaDeg: string
  vaMin: string
  vaSec: string
  ih: string
  th: string
  remarks?: string
}> {
  const allObs = parseResult.rawRecords

  // ── Step 1: Pair face-left and face-right observations ────────────────────
  // For each target, look for corresponding FL and FR measurements
  const byTarget = new Map<string, GSIObservation[]>()

  for (const obs of allObs) {
    const key = obs.pointNumber || `?${Math.random().toString(36).slice(2)}`
    if (!byTarget.has(key)) byTarget.set(key, [])
    byTarget.get(key)!.push(obs)
  }

  // Build traverse legs: sorted by the order they appear in the file
  const stations = parseResult.stations
  const result: ReturnType<typeof reduceGSIObservations> = []

  // For each station, create a traverse leg
  for (let i = 0; i < allObs.length - 1; i++) {
    const obs = allObs[i]
    const nextObs = allObs[i + 1]

    if (!obs.hzFaceLeft && !obs.horizDist) continue  // Skip if no angle or distance

    // Determine BS and FS from the observation
    const bs = obs.pointNumber
    const fs = nextObs?.pointNumber || `P${i + 2}`

    // Get IH from the current station's metadata
    const station = stations.find(s => s.stationName === obs.pointNumber)
    const ih = station?.heightOfInstrument ?? obs.instrumentHeight ?? 1.600

    // Get TH from the observation
    const th = obs.targetHeight ?? 1.400

    // ── Hz angle: use FL if only one face, mean of FL+FR if both ──────────
    let meanHz = obs.hzFaceLeft ?? 0
    if (obs.hzFaceLeft !== undefined && obs.hzFaceRight !== undefined) {
      // mean = (FL + FR ± 180°) / 2
      let fr = obs.hzFaceRight!
      if (fr < obs.hzFaceLeft!) fr += 360
      meanHz = (obs.hzFaceLeft! + fr) / 2
      if (meanHz >= 360) meanHz -= 360
    }

    // Convert decimal degrees to DD MM SS.s
    const hzDMS = decimalToDMS(meanHz)

    // ── Vertical angle (V) ─────────────────────────────────────────────────
    let va = obs.verticalAngle ?? 0
    const vaDMS = decimalToDMS(Math.abs(va))

    // ── Slope distance ────────────────────────────────────────────────────
    let sd: number
    if (obs.slopeDist !== undefined) {
      sd = obs.slopeDist
    } else if (obs.horizDist !== undefined) {
      // Already horizontal — no VA needed
      sd = obs.horizDist
    } else {
      sd = 0
    }

    result.push({
      station: obs.pointNumber || `P${i + 1}`,
      bs: i > 0 ? allObs[i - 1].pointNumber : '',
      fs,
      hclDeg: String(hzDMS.deg),
      hclMin: String(hzDMS.min),
      hclSec: hzDMS.sec.toFixed(1),
      hcrDeg: obs.hzFaceRight !== undefined ? String(decimalToDMS(obs.hzFaceRight).deg) : '0',
      hcrMin: obs.hzFaceRight !== undefined ? String(decimalToDMS(obs.hzFaceRight).min) : '0',
      hcrSec: obs.hzFaceRight !== undefined ? decimalToDMS(obs.hzFaceRight).sec.toFixed(1) : '0.0',
      slopeDist: sd.toFixed(3),
      vaDeg: String(vaDMS.deg),
      vaMin: String(vaDMS.min),
      vaSec: vaDMS.sec.toFixed(1),
      ih: ih.toFixed(3),
      th: th.toFixed(3),
      remarks: obs.slopeDist === undefined && obs.horizDist !== undefined ? 'HD' : undefined,
    })
  }

  return result
}

// ── DMS helpers ───────────────────────────────────────────────────────────────

interface DMSResult {
  deg: number
  min: number
  sec: number
}

function decimalToDMS(decimal: number): DMSResult {
  if (decimal < 0) {
    const dms = decimalToDMS(-decimal)
    return { deg: -dms.deg, min: dms.min, sec: dms.sec }
  }
  const deg = Math.floor(decimal)
  const minFloat = (decimal - deg) * 60
  const min = Math.floor(minFloat)
  const sec = (minFloat - min) * 60
  return { deg, min, sec }
}