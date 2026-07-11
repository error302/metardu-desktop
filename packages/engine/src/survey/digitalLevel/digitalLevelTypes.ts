// Digital / Engineering Level Data Types
// For Metardu – Kenyan Surveyor Platform
// Supports Leica DNA03, Leica DiNi 12/22, Topcon DL series, and generic CSV

// ─── Reading Types ───────────────────────────────────────────────────────────

export interface LevelReading {
  stationId: string
  type: 'BS' | 'FS' | 'IS' // backsight, foresight, intermediate sight
  staffReading: number // metres on staff (invar barcode or E-staff)
  distance: number // metres to staff
  instrumentHeight: number // metres (height of instrument above ground)
  timestamp?: Date
  comment?: string
}

// ─── Observation (computed from a BS/FS pair) ───────────────────────────────

export interface LevelObservation {
  fromId: string
  toId: string
  heightDifference: number // metres (positive = rise)
  distance: number // metres
  weight: number // for LSQ (typically 1 / d² where d in km)
}

// ─── Known Control Point ─────────────────────────────────────────────────────

export interface LevelControlPoint {
  id: string
  rl: number // Reduced Level in metres
  isFixed: boolean
}

// ─── Network Topology ────────────────────────────────────────────────────────

export type NetworkType = 'loop' | 'spur' | 'network'

// ─── Adjustment Result ───────────────────────────────────────────────────────

export interface AdjustedLevel {
  id: string
  rl: number // Adjusted Reduced Level (m)
  sigmaRL: number // Standard deviation of adjusted RL (m)
}

export interface ResidualDetail {
  from: string
  to: string
  residual: number // metres
  standardized: number // residual / sigma
}

export interface LevelAdjustmentResult {
  adjustedLevels: AdjustedLevel[]
  residuals: ResidualDetail[]
  misclosure: number // mm
  allowableMisclosure: number // mm
  misclosurePerKm: number // mm/km
  totalDistance: number // km
  referenceVariance: number // σ₀²
  degreesOfFreedom: number
  passed: boolean
  order: string // 'first' | 'second' | 'third' | 'fourth'
}

// ─── Reciprocal Levelling ────────────────────────────────────────────────────

export interface ReciprocalObservation {
  stationA: string
  stationB: string
  readingAtA_fromB: number // staff reading at A, instrument at B
  readingAtB_fromA: number // staff reading at B, instrument at A
  distance: number // metres
}

export interface ReciprocalResult {
  stationA: string
  stationB: string
  meanHeightDifference: number // metres (positive = B higher than A)
  correctionForCurvatureAndRefraction: number // metres
  meanStaffReadingA: number // metres
  meanStaffReadingB: number // metres
  precision: number // mm
}

// ─── Import Metadata ─────────────────────────────────────────────────────────

export type LevelFormat =
  | 'dna03'
  | 'dini'
  | 'topcon-dl'
  | 'csv'
  | 'unknown'

export interface LevelImportResult {
  format: LevelFormat
  readings: LevelReading[]
  observations: LevelObservation[]
  metadata: {
    instrument?: string
    jobNumber?: string
    date?: string
    staffA?: string
    staffB?: string
    operator?: string
    rawLineCount: number
    parseErrors: string[]
  }
}

// ─── Kenya Survey Regulations – Allowable Misclosures ────────────────────────

export const LEVEL_ORDER_LIMITS: Record<string, { multiplier: number; label: string }> = {
  first: { multiplier: 4, label: 'First Order (4√L mm)' },
  second: { multiplier: 6, label: 'Second Order (6√L mm)' },
  third: { multiplier: 10, label: 'Third Order (10√L mm)' },
  fourth: { multiplier: 20, label: 'Fourth Order (20√L mm)' },
}

/**
 * Compute allowable misclosure per Kenya Survey Regulations.
 * L = total distance in km.
 * Returns misclosure in mm.
 */
export function allowableMisclosure(distanceKm: number, order: string): number {
  const limit = LEVEL_ORDER_LIMITS[order]
  if (!limit) return 20 * Math.sqrt(distanceKm) // default fourth order
  return limit.multiplier * Math.sqrt(distanceKm)
}
