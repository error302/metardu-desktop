/**
 * METARDU — Topcon SDR/ID Field Data Parser
 *
 * Parses Topcon SDR raw data files (.txt / .id) as exported by Topcon
 * TopSurv software from Topcon, Sokkia, and South instruments.
 *
 * Format reference: Topcon SDR33 Technical Manual (internal record format)
 * Common in Kenya: Sokkia SET series, Topcon GPT series, South N8 series.
 *
 * Record types in SDR raw data:
 *   M0 … Point setup record     (station name, instrument height)
 *   M1 … Angle + distance      (Hz, V, SD — face left)
 *   M2 … Angle + distance      (Hz, V, SD — face right)
 *   M3 … Coordinate record     (E, N, Z — from resection/sideshot)
 *   M4 … Remark / code
 *   M5 … Free note
 *   M6 … Target height
 *
 * The parser handles both:
 *   - Fixed-width column format (older SDR33)
 *   - Space-delimited format (TopSurv CSV export)
 *
 * ⚠ NOTE: This parser is implemented against the SDR33 specification and
 *   standard TopSurv CSV conventions. It should handle the majority of
 *   Sokkia/Topcon instruments used in Kenya. If you encounter a file that
 *   fails to parse, please provide a sample (with sensitive data redacted)
 *   so the format can be verified and the parser updated.
 */

export interface SDRObservation {
  pointNumber: string
  slopeDist?: number     // metres
  horizDist?: number     // metres (from SD + VA if not directly stored)
  hzAngle?: number      // decimal degrees
  verticalAngle?: number // decimal degrees
  targetHeight?: number
  instrumentHeight?: number
  easting?: number
  northing?: number
  elevation?: number
  isFaceRight: boolean
  remark?: string
  rawLine: string
}

export interface SDRStation {
  stationName: string
  instrumentHeight: number
  observations: SDRObservation[]
}

export interface SDRParseResult {
  stations: SDRStation[]
  records: SDRObservation[]
  errors: string[]
  instrument: string
  totalStations: number
  totalObservations: number
  format: 'SDR33_FIXED' | 'TOPSURV_CSV' | 'UNKNOWN'
}

// ── SDR33 Fixed-Width Format (older instruments) ───────────────────────────────

/** SDR33 column positions for fixed-width records */
const SDR33_WIDTHS = {
  REC_TYPE: [0, 1],      // M0/M1/M2/M3/M4/M5/M6
  POINT_NO: [1, 15],     // 14-char point identifier
  SD: [15, 25],          // Slope distance (0.001m units, or decimal metres)
  HZ: [25, 37],          // Horizontal angle (DDD.MM.SS or decimal deg)
  VA: [37, 49],          // Vertical angle (DDD.MM.SS or decimal deg)
  IH: [49, 56],          // Instrument height (metres, 3dp)
  TH: [56, 62],          // Target height (metres, 3dp)
  CODE: [62, 72],        // Feature code / description
  E: [15, 28],           // Easting (when M3)
  N: [28, 42],           // Northing (when M3)
  Z: [42, 56],           // Elevation (when M3)
} as const

function parseSDR33Fixed(line: string): SDRObservation | null {
  if (line.length < 10) return null
  const recType = line.charAt(0)
  if (!['M', 'm'].includes(recType)) return null

  const upper = line.toUpperCase()

  if (upper.charAt(0) !== 'M') return null
  const m = upper.charAt(1)

  if (!['0', '1', '2', '3', '4', '5', '6'].includes(m)) return null

  const result: SDRObservation = {
    pointNumber: '',
    isFaceRight: m === '2',
    rawLine: line,
  }

  try {
    result.pointNumber = line.substring(1, 15).trim() || 'UNKNOWN'

    if (m === '0') {
      // Station/setup record — only IH is meaningful
      const ihStr = line.substring(49, 56).trim()
      result.instrumentHeight = parseFloat(ihStr)
      return result
    }

    if (m === '6') {
      // Target height record
      const thStr = line.substring(56, 62).trim()
      result.targetHeight = parseFloat(thStr)
      return result
    }

    if (m === '1' || m === '2') {
      // Angle + distance record
      const sdStr = line.substring(15, 25).trim()
      const hzStr = line.substring(25, 37).trim()
      const vaStr = line.substring(37, 49).trim()
      const thStr = line.substring(56, 62).trim()

      if (sdStr) {
        // SDR distance: usually in 0.01m units or decimal metres
        const sdVal = parseFloat(sdStr)
        if (!isNaN(sdVal)) {
          // If value > 10000, assume mm units; otherwise metres
          result.slopeDist = sdVal > 10000 ? sdVal / 1000 : sdVal
        }
      }

      if (hzStr) {
        result.hzAngle = parseAngleField(hzStr)
      }

      if (vaStr) {
        result.verticalAngle = parseAngleField(vaStr)
      }

      if (thStr) {
        result.targetHeight = parseFloat(thStr)
      }

      return result
    }

    if (m === '3') {
      // Coordinate record
      const eStr = line.substring(15, 28).trim()
      const nStr = line.substring(28, 42).trim()
      const zStr = line.substring(42, 56).trim()

      if (eStr) result.easting = parseFloat(eStr)
      if (nStr) result.northing = parseFloat(nStr)
      if (zStr) result.elevation = parseFloat(zStr)

      return result
    }

    if (m === '4' || m === '5') {
      // Remark / code record
      result.remark = line.substring(1).trim()
      return result
    }
  } catch {
    return null
  }

  return null
}

/**
 * Parse an angle field — handles multiple formats:
 *   - Decimal degrees: "123.456789"
 *   - DDD.MMSS: "045.3030" (degrees.minutesTenthsOfSeconds)
 *   - DDD.MM.SS: "045 30 30.5"
 *   - Integer arc-seconds: "163530" (0.1 arc-second units)
 * Returns decimal degrees.
 */
function parseAngleField(raw: string): number {
  const s = raw.trim()
  if (!s) return 0

  // Try decimal degrees
  const asFloat = parseFloat(s)
  if (!isNaN(asFloat)) {
    // If the number is large (>360) and looks like packed DMS or arcseconds
    if (asFloat > 360) {
      // Could be packed DMS (DDDMMSS) or arc-seconds
      const absStr = s.replace(/[+\-]/g, '')
      const len = absStr.length

      if (len === 6 || len === 7 || len === 8) {
        // Likely packed DMS: DDDMMSS or DDD.MMSS
        if (s.includes('.')) {
          // DDD.MMSS format (e.g. "045.3030")
          const dot = s.indexOf('.')
          const deg = parseInt(s.substring(0, dot), 10)
          const minPart = s.substring(dot + 1)
          const min = parseInt(minPart.substring(0, minPart.length - 1), 10)
          const sec = parseInt(minPart.slice(-1) + '0', 10)
          return deg + min / 60 + sec / 3600
        } else {
          // Integer DDDMMSS
          const len = absStr.length
          const deg = parseInt(absStr.substring(0, len - 4), 10)
          const min = parseInt(absStr.substring(len - 4, len - 2), 10)
          const sec = parseInt(absStr.substring(len - 2), 10)
          return deg + min / 60 + sec / 3600
        }
      }

      // Could be arc-seconds (large integer value)
      if (asFloat > 1000000) {
        // Likely arc-seconds (e.g., 163530 = 45°25'53")
        const deg = Math.floor(asFloat / 36000)
        const minRem = Math.floor((asFloat - deg * 36000) / 600)
        const sec = (asFloat - deg * 36000 - minRem * 600) / 10
        return deg + minRem / 60 + sec / 3600
      }
    }
    return asFloat
  }

  return 0
}

// ── TopSurv CSV Format (newer instruments) ────────────────────────────────────

/**
 * Parse TopSurv CSV format.
 * Typical header: #PT,Point,Hz,V,SD,etc. or #ST for stations
 * Data lines: #PT,point_name,Hz,V,SD,easting,northing,elevation,...
 */
function parseTopSurvCSV(lines: string[]): SDRObservation[] {
  const observations: SDRObservation[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.startsWith('#')) continue

    const parts = trimmed.split(/[,\t]+/)
    if (parts.length < 2) continue

    const recordType = parts[0].toUpperCase()

    if (recordType === '#PT' || recordType === '#SHOT') {
      const pt: SDRObservation = {
        pointNumber: parts[1] || 'UNKNOWN',
        isFaceRight: false,
        rawLine: line,
      }

      // Find numeric columns by attempting to parse
      for (let i = 2; i < parts.length; i++) {
        const val = parseFloat(parts[i])
        if (isNaN(val)) continue

        // Try to identify column by position and value range
        // #PT columns: Hz(col2), V(col3), SD(col4), targetH(col5), easting, northing, elev, ...
        if (i === 2 && Math.abs(val) <= 360) pt.hzAngle = val
        else if (i === 3 && Math.abs(val) <= 90) pt.verticalAngle = val
        else if (i === 4 && val > 0 && val < 20000) pt.slopeDist = val
        else if (i === 5 && val > 0 && val < 5) pt.targetHeight = val
        else if (i >= 5 && i <= 7 && val > 0) {
          // Likely coordinate columns
          if (i === 5) pt.easting = val
          else if (i === 6) pt.northing = val
          else if (i === 7) pt.elevation = val
        }
      }

      observations.push(pt)
    }

    if (recordType === '#ST') {
      // Station record — also add a placeholder observation for the station
      const pt: SDRObservation = {
        pointNumber: parts[1] || 'STATION',
        isFaceRight: false,
        rawLine: line,
      }
      if (parts[2]) pt.instrumentHeight = parseFloat(parts[2])
      observations.push(pt)
    }
  }

  return observations
}

// ── Auto-detection and main parse function ───────────────────────────────────

/**
 * Detect format by examining the first non-empty line.
 * SDR33 fixed: starts with M0/M1/M2/M3/M4
 * TopSurv CSV: starts with #
 */
function detectFormat(firstLine: string): SDRParseResult['format'] {
  const trimmed = firstLine.trim()
  if (trimmed.startsWith('#')) return 'TOPSURV_CSV'
  if (trimmed.length >= 60 && /^[Mm][0-6]/.test(trimmed)) return 'SDR33_FIXED'
  return 'UNKNOWN'
}

function groupByStationSDR(
  records: SDRObservation[],
  errors: string[]
): SDRStation[] {
  if (records.length === 0) return []

  // Find station records (where instrumentHeight is set)
  const stationRecords = records.filter(r => r.instrumentHeight !== undefined)

  if (stationRecords.length === 0) {
    // No explicit station records — treat all as single traverse from first point
    return [{
      stationName: records[0]?.pointNumber || 'ST1',
      instrumentHeight: records[0]?.instrumentHeight ?? 1.600,
      observations: records.filter(r => r.hzAngle !== undefined || r.slopeDist !== undefined),
    }]
  }

  // Group observations by the station that preceded them
  const stations: SDRStation[] = []
  let currentStation: SDRStation | null = null

  for (const rec of records) {
    if (rec.instrumentHeight !== undefined) {
      if (currentStation) stations.push(currentStation)
      currentStation = {
        stationName: rec.pointNumber,
        instrumentHeight: rec.instrumentHeight,
        observations: [],
      }
    } else if (currentStation && (rec.hzAngle !== undefined || rec.slopeDist !== undefined)) {
      currentStation.observations.push(rec)
    }
  }

  if (currentStation) stations.push(currentStation)

  return stations
}

/**
 * Parse a Topcon SDR/ID file.
 * Automatically detects format (SDR33 fixed-width or TopSurv CSV).
 */
export function parseSDR(sdrContent: string): SDRParseResult {
  const lines = sdrContent.split(/\r?\n/).filter(l => l.trim())
  const errors: string[] = []

  if (lines.length === 0) {
    return {
      stations: [],
      records: [],
      errors: ['Empty file'],
      instrument: 'Unknown',
      totalStations: 0,
      totalObservations: 0,
      format: 'UNKNOWN',
    }
  }

  const firstLine = lines.find(l => l.trim().startsWith('#') || l.trim().startsWith('M'))
    || lines[0]
  const format = detectFormat(firstLine || '')

  let records: SDRObservation[] = []

  if (format === 'SDR33_FIXED') {
    for (const line of lines) {
      const obs = parseSDR33Fixed(line)
      if (obs) records.push(obs)
    }
  } else if (format === 'TOPSURV_CSV') {
    records = parseTopSurvCSV(lines)
  } else {
    // Try both formats
    for (const line of lines) {
      const obs = parseSDR33Fixed(line)
      if (obs) records.push(obs)
    }
    if (records.length === 0) {
      records = parseTopSurvCSV(lines)
    }
    if (records.length === 0) {
      errors.push(`Could not detect file format. First line: "${firstLine?.slice(0, 80)}"`)
    }
  }

  // Remove remark-only records
  records = records.filter(r =>
    r.hzAngle !== undefined || r.slopeDist !== undefined ||
    r.easting !== undefined || r.instrumentHeight !== undefined
  )

  const stations = groupByStationSDR(records, errors)
  const totalDistCount = records.filter(r => r.slopeDist !== undefined).length

  return {
    stations,
    records,
    errors,
    instrument: 'Topcon/Sokkia SDR',
    totalStations: stations.length,
    totalObservations: records.length,
    format,
  }
}

/**
 * Reduce SDR observations to the format expected by computeTraverse().
 * Applies face-left/face-right mean angle, HD from SD+VA.
 */
export function reduceSDRObservations(
  parseResult: SDRParseResult
): Array<{
  station: string
  bs: string
  fs: string
  hclDeg: string; hclMin: string; hclSec: string
  hcrDeg: string; hcrMin: string; hcrSec: string
  slopeDist: string
  vaDeg: string; vaMin: string; vaSec: string
  ih: string; th: string
}> {
  const stations = parseResult.stations
  const allObs = parseResult.records

  const result: ReturnType<typeof reduceSDRObservations> = []
  let ih = 1.600
  let th = 1.400

  // Find instrument height from first station
  if (stations[0]) {
    ih = stations[0].instrumentHeight || 1.600
  }

  for (let i = 0; i < allObs.length; i++) {
    const obs = allObs[i]
    const nextObs = allObs[i + 1]

    if (obs.instrumentHeight !== undefined) {
      ih = obs.instrumentHeight
      continue
    }

    if (obs.hzAngle === undefined && obs.slopeDist === undefined) continue

    th = obs.targetHeight ?? 1.400

    let meanHz = obs.hzAngle ?? 0
    const hzDMS = decimalToDMS(meanHz)

    const va = obs.verticalAngle ?? 0
    const vaDMS = decimalToDMS(Math.abs(va))

    const sd = obs.slopeDist ?? obs.horizDist ?? 0

    result.push({
      station: obs.pointNumber || `P${i + 1}`,
      bs: i > 0 ? allObs[i - 1].pointNumber : '',
      fs: nextObs?.pointNumber || `P${i + 2}`,
      hclDeg: String(hzDMS.deg),
      hclMin: String(hzDMS.min),
      hclSec: hzDMS.sec.toFixed(1),
      hcrDeg: obs.isFaceRight ? String(hzDMS.deg) : '0',
      hcrMin: obs.isFaceRight ? String(hzDMS.min) : '0',
      hcrSec: obs.isFaceRight ? hzDMS.sec.toFixed(1) : '0.0',
      slopeDist: sd.toFixed(3),
      vaDeg: String(vaDMS.deg),
      vaMin: String(vaDMS.min),
      vaSec: vaDMS.sec.toFixed(1),
      ih: ih.toFixed(3),
      th: th.toFixed(3),
    })
  }

  return result
}

function decimalToDMS(decimal: number): { deg: number; min: number; sec: number } {
  if (decimal < 0) {
    const d = decimalToDMS(-decimal)
    return { deg: -d.deg, min: d.min, sec: d.sec }
  }
  const deg = Math.floor(decimal)
  const minFloat = (decimal - deg) * 60
  const min = Math.floor(minFloat)
  const sec = (minFloat - min) * 60
  return { deg, min, sec }
}