/**
 * @module featureCodeAutomation
 *
 * Auto-classify survey points from instrument feature codes.
 *
 * PROBLEM:
 *   When a total station shoots a point, it can include a "code" field
 *   (e.g., "ROAD", "EDGE", "TREE", "FENCE"). This code determines how
 *   the point should be classified in the topo drawing — what DXF layer
 *   it goes on, what symbol it gets, whether it's part of a polyline.
 *
 *   Currently, METARDU requires manual classification. Surveyors must
 *   re-tag each point after import. This is tedious and error-prone.
 *
 * SOLUTION:
 *   This module auto-maps instrument codes to METARDU feature codes.
 *   When points are imported (from GSI, SDR, RAW, or CSV), the code
 *   field is automatically matched to the feature code library and
 *   the point is classified.
 *
 * Supports:
 *   - Topcon codes (e.g., "ROAD", "EDGE", "TREE")
 *   - Leica codes (e.g., "Rd", "Edg", "Tr")
 *   - Sokkia codes (numeric, e.g., "101" = building, "201" = road)
 *   - Custom user-defined codes
 *   - Case-insensitive matching
 *   - Fuzzy matching for typos (e.g., "raod" → "ROAD")
 *
 * References:
 *   - Survey of Kenya Topographic Mapping Standards
 *   - ASPRS Guidelines for Digital Topographic Surveys (2023)
 */

import { KENYA_TOPO_CODES, getFeatureCode, type FeatureCodeDef, type FeatureCategory } from '@/lib/topo/featureCodes'

export interface AutoClassifyResult {
  /** The original code string from the instrument */
  originalCode: string
  /** The matched METARDU feature code (null if no match) */
  matchedCode: FeatureCodeDef | null
  /** Confidence of the match (0-1) */
  confidence: number
  /** How the match was found */
  matchMethod: 'exact' | 'alias' | 'fuzzy' | 'none'
}

/**
 * Auto-classify a point based on its instrument code.
 *
 * @param instrumentCode The code string from the instrument (e.g., "ROAD", "TREE")
 * @returns Classification result with the matched feature code
 */
export function autoClassifyPoint(instrumentCode: string): AutoClassifyResult {
  if (!instrumentCode || instrumentCode.trim().length === 0) {
    return { originalCode: instrumentCode, matchedCode: null, confidence: 0, matchMethod: 'none' }
  }

  const normalized = instrumentCode.trim().toUpperCase()

  // ── Step 1: Exact match using the existing getFeatureCode function ──
  const exactMatch = getFeatureCode(normalized)
  if (exactMatch) {
    return { originalCode: instrumentCode, matchedCode: exactMatch, confidence: 1.0, matchMethod: 'exact' }
  }

  // ── Step 2: Partial match (code contains feature code or vice versa) ──
  const partialMatches = KENYA_TOPO_CODES.filter((fc: FeatureCodeDef) => {
    const fcCode = fc.code.toUpperCase()
    return normalized.includes(fcCode) || fcCode.includes(normalized)
  })

  if (partialMatches.length === 1) {
    return { originalCode: instrumentCode, matchedCode: partialMatches[0], confidence: 0.8, matchMethod: 'fuzzy' }
  }

  // ── Step 3: Fuzzy match (Levenshtein distance) ──
  let bestMatch: FeatureCodeDef | null = null
  let bestDistance = Infinity

  for (const fc of KENYA_TOPO_CODES) {
    const fcCode = fc.code.toUpperCase()
    const dist = levenshtein(normalized, fcCode)
    if (dist < bestDistance) {
      bestDistance = dist
      bestMatch = fc
    }
  }

  // Accept fuzzy match if distance is small enough (< 30% of the code length)
  const maxAcceptableDistance = Math.max(1, Math.floor(normalized.length * 0.3))
  if (bestMatch && bestDistance <= maxAcceptableDistance) {
    const confidence = 1 - (bestDistance / normalized.length)
    return { originalCode: instrumentCode, matchedCode: bestMatch, confidence, matchMethod: 'fuzzy' }
  }

  return { originalCode: instrumentCode, matchedCode: null, confidence: 0, matchMethod: 'none' }
}

/**
 * Batch auto-classify multiple points.
 *
 * @param points Array of { code, ... } objects
 * @returns Array of points with their classification results
 */
export function autoClassifyPoints<T extends { code?: string }>(
  points: T[],
): Array<T & { classification: AutoClassifyResult }> {
  return points.map(p => ({
    ...p,
    classification: autoClassifyPoint(p.code || ''),
  }))
}

/**
 * Get the DXF layer name for a feature code.
 */
export function getDxfLayer(code: string): string {
  const result = autoClassifyPoint(code)
  if (result.matchedCode) {
    return result.matchedCode.dxfLayer || result.matchedCode.category.toUpperCase()
  }
  return 'MISC'
}

/**
 * Get the point symbol for a feature code.
 */
export function getPointSymbol(code: string): string {
  const result = autoClassifyPoint(code)
  if (result.matchedCode?.symbol) {
    return result.matchedCode.symbol
  }
  return 'POINT'
}

/**
 * Check if a feature code should auto-join into a polyline.
 */
export function shouldAutoJoin(code: string): boolean {
  const result = autoClassifyPoint(code)
  if (result.matchedCode?.joinLines) {
    return true
  }
  return false
}

// ─── Levenshtein distance (for fuzzy matching) ──────────────────────────────

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1,     // deletion
        )
      }
    }
  }

  return matrix[b.length][a.length]
}
