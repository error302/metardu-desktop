/**
 * National Topo Sheet Data — Derived from National Survey XLS corner coordinates
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * Loads the 264-sheet corner coordinate data from national_sheet_corners.json,
 * converts each sheet's 4 corners into CommonPoint[] format, computes Helmert
 * 4-params via computeHelmert4Params(), and estimates accuracy.
 *
 * Sheets with null Cassini coordinates (UTM-only) are skipped.
 * Sheets with all-zero or identical corners are skipped.
 *
 * Source: Survey of Kenya "UTM_Cassini_Cassini_UTM national.xls"
 * Extracted: 2026-06-02
 */

// ponytail: moved to data/cassini/ to keep src/ lean (was 388k LOC of JSON in src/lib/geo/)
import nationalSheetCornersData from '../../../data/cassini/national_sheet_corners.json'
import type { TopoSheetParams, CommonPoint } from './cassini'
import { computeHelmert4Params, estimateSheetAccuracy, computeABCoefficients } from './cassini'

// ─── Type Definitions for the JSON structure ──────────────────────────────

interface SheetCorner {
  id: string
  utmE: number
  utmN: number
  cassE: number | null
  cassN: number | null
}

interface SheetData {
  corners: SheetCorner[]
}

interface NationalSheetCornersJSON {
  metadata: {
    source: string
    description: string
    sheet_count: number
    subsheet_count: number
    utm_to_cassini_sheet_count: number
    empty_placeholder_sheets: string[]
    extracted_date: string
    corner_order: string
    units: {
      cassE: string
      cassN: string
      utmE: string
      utmN: string
    }
    notes: string[]
  }
  sheets: Record<string, SheetData>
}

// ─── Helper Functions ────────────────────────────────────────────────────

/**
 * Check if a sheet has valid Cassini coordinates on all 4 corners.
 * Sheets with any null, zero, or suspicious cassE/cassN are rejected.
 */
function hasValidCassiniCoords(sheet: SheetData): boolean {
  if (!sheet.corners || sheet.corners.length !== 4) return false
  return sheet.corners.every(
    (c) =>
      c.cassE !== null &&
      c.cassN !== null &&
      isFinite(c.cassE) &&
      isFinite(c.cassN) &&
      !(c.cassE === 0 && c.cassN === 0),
  )
}

/**
 * Check if corners contain duplicates (all 4 corners identical or nearly so).
 * This catches placeholder/empty sheets in the XLS.
 */
function hasDuplicateCorners(sheet: SheetData): boolean {
  const corners = sheet.corners
  if (corners.length < 4) return true

  // Compare first corner with the rest — if all are within 1 unit, it's a duplicate
  const ref = corners[0]
  return corners.every(
    (c) =>
      Math.abs(c.utmE - ref.utmE) < 1 &&
      Math.abs(c.utmN - ref.utmN) < 1 &&
      Math.abs(c.cassE! - ref.cassE!) < 1 &&
      Math.abs(c.cassN! - ref.cassN!) < 1,
  )
}

/**
 * Convert sheet corners to CommonPoint[] format for the Helmert solver.
 *
 * The JSON stores corners as NW, NE, SE, SW (clockwise from top-left).
 * We label them C1-C4 in that order.
 */
function cornersToCommonPoints(sheet: SheetData): CommonPoint[] {
  const labels = ['C1', 'C2', 'C3', 'C4']
  return sheet.corners.map((c, i) => ({
    station: labels[i],
    cassN: c.cassN!,
    cassE: c.cassE!,
    utmN: c.utmN,
    utmE: c.utmE,
  }))
}

/**
 * Normalize a sheet ID: the XLS uses "/" (e.g., "102/1") which is our canonical format.
 * No normalization needed currently, but this is a hook for future changes.
 */
function normalizeSheetId(id: string): string {
  return id
}

// ─── Build the NATIONAL_SHEETS array ──────────────────────────────────────

const raw = nationalSheetCornersData as unknown as NationalSheetCornersJSON
const emptyPlaceholders = new Set(raw.metadata.empty_placeholder_sheets)

const _NATIONAL_SHEETS: TopoSheetParams[] = []

const sheetEntries = Object.entries(raw.sheets)

for (const [sheetId, sheetData] of sheetEntries) {
  // Skip known empty placeholders
  if (emptyPlaceholders.has(sheetId)) continue

  // Skip UTM-only sheets (no Cassini coordinates)
  if (!hasValidCassiniCoords(sheetData)) continue

  // Skip sheets with degenerate corners
  if (hasDuplicateCorners(sheetData)) continue

  const commonPoints = cornersToCommonPoints(sheetData)
  const id = normalizeSheetId(sheetId)

  try {
    // Compute Helmert 4 params from the 4 corner common points
    const helmert = computeHelmert4Params(commonPoints)

    const params: TopoSheetParams = {
      id,
      name: `Sheet ${id}`,
      description: `Kenya national topo sheet ${id}. Helmert 4-param from 4 sheet corners (National XLS).`,
      P: helmert.P,
      Q: helmert.Q,
      Cx: helmert.Cx,
      Cy: helmert.Cy,
      commonPoints,
    }

    // Compute A/B polynomial coefficients from corner residuals
    const ab = computeABCoefficients(params)
    if (ab !== null) {
      params.A = ab.A
      params.B = ab.B
    }

    _NATIONAL_SHEETS.push(params)
  } catch (err) {
    // Singular matrix or other computation error — skip this sheet
    // This can happen for sheets with collinear control points
    console.warn(
      `[national_sheets] Skipping sheet ${id}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * All national topographic sheet parameters derived from the National XLS corner data.
 * Sorted by sheet ID for easy lookup.
 */
export const NATIONAL_SHEETS: TopoSheetParams[] = _NATIONAL_SHEETS.sort((a, b) =>
  a.id.localeCompare(b.id, undefined, { numeric: true }),
)

/**
 * Map of sheet ID → params for O(1) lookup.
 */
const NATIONAL_SHEETS_MAP = new Map<string, TopoSheetParams>(
  NATIONAL_SHEETS.map((s) => [s.id, s]),
)

/**
 * Look up a national sheet by its ID (e.g., "102/1").
 * Returns undefined if the sheet is not found or was skipped (UTM-only).
 */
export function getNationalSheet(id: string): TopoSheetParams | undefined {
  return NATIONAL_SHEETS_MAP.get(normalizeSheetId(id))
}

/**
 * Get the total count of sheets in the national dataset (including skipped ones).
 */
export function getNationalSheetCount(): number {
  return Object.keys(raw.sheets).length
}

/**
 * Get statistics about the national sheet processing.
 */
export function getNationalSheetStats(): {
  totalInXLS: number
  emptyPlaceholders: number
  utmOnlySkipped: number
  degenerateSkipped: number
  computeErrors: number
  successfullyProcessed: number
} {
  const totalInXLS = Object.keys(raw.sheets).length
  const emptyCount = emptyPlaceholders.size
  let utmOnlyCount = 0
  let degenerateCount = 0
  let errorCount = 0

  for (const [sheetId, sheetData] of sheetEntries) {
    if (emptyPlaceholders.has(sheetId)) continue
    if (!hasValidCassiniCoords(sheetData)) {
      utmOnlyCount++
      continue
    }
    if (hasDuplicateCorners(sheetData)) {
      degenerateCount++
      continue
    }
    try {
      computeHelmert4Params(cornersToCommonPoints(sheetData))
    } catch {
      errorCount++
    }
  }

  return {
    totalInXLS,
    emptyPlaceholders: emptyCount,
    utmOnlySkipped: utmOnlyCount,
    degenerateSkipped: degenerateCount,
    computeErrors: errorCount,
    successfullyProcessed: NATIONAL_SHEETS.length,
  }
}
