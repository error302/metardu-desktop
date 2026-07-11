/**
 * Cross-Section Volume Calculations — Volume between sequential cross-sections.
 *
 * Calculation standards:
 *   - N.N. Basak, Surveying and Levelling, Ch. 8 — End Area and Prismoidal methods
 *   - Ghilani & Wolf, Elementary Surveying, 16th Ed., §26.3 — Earthwork computation
 *   - RDM 1.1 Kenya 2025, §8 — Volume computation for road/earthwork design
 *
 * Conventions:
 *   - No intermediate rounding; full floating point throughout.
 *   - Positive volume = cut (existing above design).
 *   - Negative volume = fill (existing below design).
 *   - Prismoidal formula used when 3 consecutive sections available with ~equal spacing.
 *   - End-area formula used as fallback or when chainage spacing > 10 m.
 *
 * End-Area Method (Basak §8.2):
 *   V = (L / 2) × (A1 + A2)
 *   where L = distance between sections, A = cross-section area above/below design.
 *
 * Prismoidal Formula (Basak §8.3):
 *   V = (L / 6) × (A1 + 4×Am + A2)
 *   where Am = mid-section area, L = distance between end sections.
 */

// ─── TYPES ─────────────────────────────────────────────────────────────────────

export interface CrossSectionPoint {
  offset: number // horizontal offset from centreline (m)
  rl: number // reduced level (m)
}

export interface CrossSection {
  chainage: number // chainage along centreline (m)
  points: CrossSectionPoint[]
}

export interface SectionVolumeSegment {
  fromChainage: number
  toChainage: number
  distance: number // metres between sections
  endAreaFrom: number // m² (signed: +cut, -fill)
  endAreaTo: number // m² (signed: +cut, -fill)
  midArea?: number // m² (for prismoidal)
  cutVolumeM3: number // positive cut volume
  fillVolumeM3: number // positive fill volume
  netVolumeM3: number // cut − fill (signed)
  method: 'prismoidal' | 'end-area'
}

export interface SectionVolumeResult {
  totalCutVolumeM3: number
  totalFillVolumeM3: number
  netVolumeM3: number
  sections: SectionVolumeSegment[]
  totalLength: number
}

export interface CrossSectionAreaResult {
  chainage: number
  cutArea: number // m² above design
  fillArea: number // m² below design
  netArea: number // signed (+cut, -fill)
  groundLevelRange: { min: number; max: number }
}

// ─── CROSS-SECTION AREA COMPUTATION ───────────────────────────────────────────

/**
 * Compute the area between a cross-section profile and a design level.
 *
 * For each consecutive pair of points in the cross-section:
 *   - If both above design → area is trapezoidal (cut).
 *   - If both below design → area is trapezoidal (fill).
 *   - If one above and one below → split at the design intersection.
 *
 * The area is computed as the integral of the absolute difference between
 * the ground profile and the design level:
 *
 *   Area = Σ |ΔRL| × average_offset_step
 *
 * This uses the trapezoidal rule between consecutive section points.
 *
 * Ref: Ghilani & Wolf, Elementary Surveying, §26.3 — Earthwork cross-section areas.
 *
 * @param section - Cross-section with chainage and profile points
 * @param designLevel - Design formation RL
 * @returns CrossSectionAreaResult with cut, fill, and net areas
 */
export function computeSectionArea(
  section: CrossSection,
  designLevel: number
): CrossSectionAreaResult {
  const points = section.points
  if (points.length < 2) {
    return {
      chainage: section.chainage,
      cutArea: 0,
      fillArea: 0,
      netArea: 0,
      groundLevelRange: { min: designLevel, max: designLevel },
    }
  }

  // Sort by offset
  const sorted = [...points].sort((a, b) => a.offset - b.offset)

  let cutArea = 0
  let fillArea = 0
  let minRL = Infinity
  let maxRL = -Infinity

  for (let i = 0; i < sorted.length - 1; i++) {
    const p1 = sorted[i]
    const p2 = sorted[i + 1]
    const dOffset = p2.offset - p1.offset

    if (dOffset === 0) continue

    minRL = Math.min(minRL, p1.rl, p2.rl)
    maxRL = Math.max(maxRL, p1.rl, p2.rl)

    const h1 = p1.rl - designLevel // + above design, - below
    const h2 = p2.rl - designLevel

    if (h1 >= 0 && h2 >= 0) {
      // Both above design — cut area (trapezoid)
      cutArea += ((h1 + h2) / 2) * dOffset
    } else if (h1 <= 0 && h2 <= 0) {
      // Both below design — fill area (trapezoid)
      fillArea += ((Math.abs(h1) + Math.abs(h2)) / 2) * dOffset
    } else {
      // One above, one below — split at intersection
      // Intersection offset: linear interpolation to find where RL = designLevel
      const t = Math.abs(h1) / (Math.abs(h1) + Math.abs(h2))
      const splitOffset = p1.offset + t * dOffset

      if (h1 > 0 && h2 < 0) {
        // p1 above, p2 below
        cutArea += (h1 / 2) * (splitOffset - p1.offset)
        fillArea += (Math.abs(h2) / 2) * (p2.offset - splitOffset)
      } else {
        // p1 below, p2 above
        fillArea += (Math.abs(h1) / 2) * (splitOffset - p1.offset)
        cutArea += (h2 / 2) * (p2.offset - splitOffset)
      }
    }
  }

  return {
    chainage: section.chainage,
    cutArea,
    fillArea,
    netArea: cutArea - fillArea,
    groundLevelRange: { min: minRL, max: maxRL },
  }
}

// ─── CROSS-SECTION VOLUME COMPUTATION ─────────────────────────────────────────

/**
 * Compute volumes between sequential cross-sections.
 *
 * For each pair of consecutive sections:
 *   - If spacing > 10m OR no mid-section: use End-Area method.
 *     V = (L/2) × (A1 + A2)  — Basak §8.2
 *
 *   - If 3 sections available with roughly equal spacing (±30%): use Prismoidal.
 *     V = (L/6) × (A1 + 4×Am + A2)  — Basak §8.3
 *
 * Cut and fill are separated:
 *   - Cut volume from cut areas of both sections.
 *   - Fill volume from fill areas of both sections.
 *
 * Ref: RDM 1.1 Kenya 2025 §8 — "Volume computation shall use the prismoidal
 *      formula where possible, end-area as fallback."
 *
 * @param sections - Array of cross-sections sorted by chainage
 * @param designLevel - Design formation RL
 * @returns SectionVolumeResult with total and per-segment volumes
 */
export function computeCrossSectionVolumes(
  sections: CrossSection[],
  designLevel: number
): SectionVolumeResult {
  if (sections.length < 2) {
    throw new Error('At least 2 cross-sections required for volume computation.')
  }

  // Sort by chainage
  const sorted = [...sections].sort((a, b) => a.chainage - b.chainage)

  // Compute areas for all sections
  const areaResults = sorted.map(s => computeSectionArea(s, designLevel))

  const segments: SectionVolumeSegment[] = []
  let totalCut = 0
  let totalFill = 0

  let i = 0
  while (i < sorted.length - 1) {
    const s1 = areaResults[i]
    const s2 = areaResults[i + 1]
    const L = s2.chainage - s1.chainage

    if (L <= 0) {
      i++
      continue
    }

    // Check if we can use prismoidal (need a mid-section with ~equal spacing)
    let usePrismoidal = false
    let midResult: CrossSectionAreaResult | null = null
    let s3Result: CrossSectionAreaResult | null = null

    if (i + 2 < sorted.length) {
      const s3 = areaResults[i + 2]
      const L2 = s3.chainage - s2.chainage
      // Check if spacing is roughly equal (within 30%)
      if (Math.abs(L - L2) / Math.max(L, L2) < 0.3 && L <= 10) {
        usePrismoidal = true
        midResult = s2
        s3Result = s3
      }
    }

    let cutVol: number
    let fillVol: number

    if (usePrismoidal && midResult && s3Result) {
      // Prismoidal formula: V = (L_total / 6) × (A1 + 4×Am + A3)
      // s1 = from section, midResult = mid section, s3Result = end section
      const LTotal = s3Result.chainage - s1.chainage
      cutVol = (LTotal / 6) * (s1.cutArea + 4 * midResult.cutArea + s3Result.cutArea)
      fillVol = (LTotal / 6) * (s1.fillArea + 4 * midResult.fillArea + s3Result.fillArea)

      segments.push({
        fromChainage: s1.chainage,
        toChainage: s3Result.chainage,
        distance: LTotal,
        endAreaFrom: s1.netArea,
        endAreaTo: s3Result.netArea,
        midArea: midResult.netArea,
        cutVolumeM3: cutVol,
        fillVolumeM3: fillVol,
        netVolumeM3: cutVol - fillVol,
        method: 'prismoidal',
      })

      i += 2 // Skip the mid-section and end-section (both consumed)
    } else {
      // End-Area method: V = (L / 2) × (A1 + A2)
      cutVol = (L / 2) * (s1.cutArea + s2.cutArea)
      fillVol = (L / 2) * (s1.fillArea + s2.fillArea)

      segments.push({
        fromChainage: s1.chainage,
        toChainage: s2.chainage,
        distance: L,
        endAreaFrom: s1.netArea,
        endAreaTo: s2.netArea,
        cutVolumeM3: cutVol,
        fillVolumeM3: fillVol,
        netVolumeM3: cutVol - fillVol,
        method: 'end-area',
      })

      i += 1
    }

    totalCut += cutVol
    totalFill += fillVol
  }

  const totalLength = sorted[sorted.length - 1].chainage - sorted[0].chainage

  return {
    totalCutVolumeM3: totalCut,
    totalFillVolumeM3: totalFill,
    netVolumeM3: totalCut - totalFill,
    sections: segments,
    totalLength,
  }
}

// ─── CSV PARSING ───────────────────────────────────────────────────────────────

/**
 * Parse CSV text into CrossSection array.
 * Format: chainage,offset,rl (one row per point, grouped by chainage).
 */
export function parseCrossSectionCSV(csv: string): CrossSection[] {
  const lines = csv.trim().split(/\r?\n/)
  const sectionMap = new Map<number, CrossSectionPoint[]>()

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.toLowerCase().startsWith('chainage')) continue

    const parts = trimmed.split(/[,\t;]+/)
    if (parts.length >= 3) {
      const chainage = parseFloat(parts[0].trim())
      const offset = parseFloat(parts[1].trim())
      const rl = parseFloat(parts[2].trim())
      if (!isNaN(chainage) && !isNaN(offset) && !isNaN(rl)) {
        if (!sectionMap.has(chainage)) sectionMap.set(chainage, [])
        sectionMap.get(chainage)!.push({ offset, rl })
      }
    }
  }

  return Array.from(sectionMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([chainage, points]) => ({ chainage, points }))
}

/**
 * Export section volume results to CSV.
 */
export function sectionVolumesToCSV(result: SectionVolumeResult): string {
  const header = 'From (m),To (m),Distance (m),From Area (m²),To Area (m²),Cut (m³),Fill (m³),Net (m³),Method'
  const rows = result.sections.map(s =>
    `${s.fromChainage.toFixed(2)},${s.toChainage.toFixed(2)},${s.distance.toFixed(2)},${s.endAreaFrom.toFixed(3)},${s.endAreaTo.toFixed(3)},${s.cutVolumeM3.toFixed(3)},${s.fillVolumeM3.toFixed(3)},${s.netVolumeM3.toFixed(3)},${s.method}`
  )
  return [header, ...rows].join('\n')
}
