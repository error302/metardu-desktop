/**
 * METARDU — Field Data Import
 *
 * Auto-detects and parses survey field data from total stations:
 *   - Leica GSI (.gsi)  — Leica TPS/TS series
 *   - Topcon SDR (.txt/.id/.sdr) — Topcon/Sokkia/South series
 *
 * Supports both fixed-width (SDR33) and CSV (TopSurv) exports.
 *
 * Usage:
 *   const parsed = parseFieldData(content)         // just parsing
 *   const reduced = reduceObservations(parsed)     // needs backsight bearing
 *   const input = buildTraverseInput(parsed, config) // ready for computeTraverse
 */

import { parseGSI } from './gsiParser'
import { parseSDR } from './topconSDRParser'

export type FieldDataFormat = 'GSI-8' | 'GSI-16' | 'SDR33_FIXED' | 'TOPSURV_CSV' | 'UNKNOWN'

export interface TraverseReadyObservation {
  station: string
  bs: string
  fs: string
  hclDeg: string; hclMin: string; hclSec: string
  hcrDeg: string; hcrMin: string; hcrSec: string
  slopeDist: string
  vaDeg: string; vaMin: string; vaSec: string
  ih: string; th: string
}

export interface FieldDataParseResult {
  format: FieldDataFormat
  instrument: string
  totalStations: number
  totalObservations: number
  errors: string[]
  rawObservations: unknown[]
  /** File extension used for display purposes */
  fileExtension: string
}

function detectFormat(content: string): FieldDataFormat {
  const first = content.split(/\r?\n/).find(l => l.trim().length > 0) || ''
  if (!first) return 'UNKNOWN'
  if (first.includes('*') && /^\d/.test(first.trim())) return 'GSI-8'
  if (first.includes('*')) return 'GSI-16'
  if (first.trim().startsWith('#')) return 'TOPSURV_CSV'
  if (/^[Mm][0-6]/.test(first.trim())) return 'SDR33_FIXED'
  if (first.includes('\t') && first.split('\t').length >= 4) return 'TOPSURV_CSV'
  return 'UNKNOWN'
}

export function parseFieldData(
  content: string,
  fileExtension: string = ''
): FieldDataParseResult {
  const errors: string[] = []
  const format = detectFormat(content)

  if (format === 'GSI-8' || format === 'GSI-16') {
    const result = parseGSI(content)
    errors.push(...result.errors)
    return {
      format,
      instrument: result.instrument,
      totalStations: result.totalStations,
      totalObservations: result.totalObservations,
      errors,
      rawObservations: result.rawRecords,
      fileExtension,
    }
  }

  if (format === 'SDR33_FIXED' || format === 'TOPSURV_CSV') {
    const result = parseSDR(content)
    errors.push(...result.errors)
    return {
      format,
      instrument: result.instrument,
      totalStations: result.totalStations,
      totalObservations: result.totalObservations,
      errors,
      rawObservations: result.records,
      fileExtension,
    }
  }

  return {
    format: 'UNKNOWN',
    instrument: 'Unknown',
    totalStations: 0,
    totalObservations: 0,
    errors: [`Could not detect field data format${fileExtension ? ` (file: ${fileExtension})` : ''}`],
    rawObservations: [],
    fileExtension,
  }
}

export interface BacksightBearing {
  degrees: number
  minutes: number
  seconds: number
}

export interface TraverseInput {
  openingEasting: number
  openingNorthing: number
  openingRL?: number
  openingStation: string
  closingEasting?: number
  closingNorthing?: number
  closingStation?: string
  backsightBearingDeg: number
  backsightBearingMin: number
  backsightBearingSec: number
  observations: TraverseReadyObservation[]
}

export function buildTraverseInput(
  parseResult: FieldDataParseResult,
  backsightBearing: BacksightBearing,
  config: {
    openingEasting: number
    openingNorthing: number
    openingRL?: number
    openingStation: string
    closingEasting?: number
    closingNorthing?: number
    closingStation?: string
  }
): TraverseInput {
  const rawObservations = parseResult.rawObservations as Array<{
    station: string
    bs: string
    fs: string
    hclDeg: string; hclMin: string; hclSec: string
    hcrDeg: string; hcrMin: string; hcrSec: string
    slopeDist: string
    vaDeg: string; vaMin: string; vaSec: string
    ih: string; th: string
  }>

  const reduced: TraverseReadyObservation[] = rawObservations.map((o) => ({
    station: o.station || '',
    bs: o.bs || '',
    fs: o.fs || '',
    hclDeg: o.hclDeg || '0',
    hclMin: o.hclMin || '0',
    hclSec: o.hclSec || '0.0',
    hcrDeg: o.hcrDeg || '0',
    hcrMin: o.hcrMin || '0',
    hcrSec: o.hcrSec || '0.0',
    slopeDist: o.slopeDist || '0.000',
    vaDeg: o.vaDeg || '0',
    vaMin: o.vaMin || '0',
    vaSec: o.vaSec || '0.0',
    ih: o.ih || '1.600',
    th: o.th || '1.400',
  }))

  return {
    ...config,
    backsightBearingDeg: backsightBearing.degrees,
    backsightBearingMin: backsightBearing.minutes,
    backsightBearingSec: backsightBearing.seconds,
    observations: reduced,
  }
}