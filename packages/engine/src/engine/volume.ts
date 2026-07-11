/**
 * Calculation standard: N.N. Basak — Surveying and Levelling
 * - No intermediate rounding
 * - Full floating point precision throughout
 * - Round only at final display layer
 *
 * Volume computation (Basak Ch. 8 style):
 * - End Area method
 * - Prismoidal formula
 *
 * Notes:
 * - This module covers cross-section area vs chainage volumes (deterministic, offline-safe).
 * - Surface-to-surface cut/fill can be computed deterministically in TS (e.g., grid method).
 * - Advanced terrain modelling (full TIN/DEM ops, large datasets) can use the optional Python layer.
 */

export type VolumeMethod = 'end_area' | 'prismoidal'

export interface VolumeSection {
  chainage: number // metres
  area: number // m^2 (can be signed if representing cut/fill convention)
}

export interface VolumeSegment {
  from: number
  to: number
  L: number
  A1: number
  A2: number
  Am?: number
  volume: number // m^3 (signed if areas are signed)
}

export interface VolumeResult {
  method: VolumeMethod
  totalVolume: number
  segments: VolumeSegment[]
}

export interface CutFillVolumeResult {
  cutVolume: number
  fillVolume: number
  netVolume: number
  segments: VolumeSegment[]
}

export type SurfacePoint = {
  easting: number
  northing: number
  elevation: number
}

export interface SurfaceVolumeGridInput {
  existing: SurfacePoint[]
  design: SurfacePoint[]
  gridSpacing: number // metres
  /** IDW power, default 2 */
  power?: number
  /** Max influence radius (m). If not provided, uses 3×gridSpacing. */
  maxDistance?: number
}

export interface SurfaceVolumeGridResult {
  method: 'grid_idw'
  cutVolume: number
  fillVolume: number
  netVolume: number
  cellCount: number
  bbox: { minE: number; minN: number; maxE: number; maxN: number }
  warnings: string[]
}

function sortByChainage(sections: VolumeSection[]): VolumeSection[] {
  return [...sections].sort((a: any, b: any) => a.chainage - b.chainage)
}

export function endAreaVolume(sections: VolumeSection[]): VolumeResult {
  const sorted = sortByChainage(sections)
  const segments: VolumeSegment[] = []
  let total = 0

  for (let i = 1; i < sorted.length; i++) {
    const s1 = sorted[i - 1]
    const s2 = sorted[i]
    const L = s2.chainage - s1.chainage
    const v = (L / 2) * (s1.area + s2.area)
    segments.push({ from: s1.chainage, to: s2.chainage, L, A1: s1.area, A2: s2.area, volume: v })
    total += v
  }

  return { method: 'end_area', totalVolume: total, segments }
}

export function prismoidalVolume(sections: VolumeSection[]): VolumeResult {
  const sorted = sortByChainage(sections)
  const segments: VolumeSegment[] = []
  let total = 0

  // Uses triplets: A1, Am, A2 across equal spacing:
  // V = (L/6) * (A1 + 4Am + A2), where L = chainage2 - chainage0
  for (let i = 0; i + 2 < sorted.length; i += 2) {
    const s1 = sorted[i]
    const sm = sorted[i + 1]
    const s2 = sorted[i + 2]
    const L = s2.chainage - s1.chainage
    const v = (L / 6) * (s1.area + 4 * sm.area + s2.area)
    segments.push({ from: s1.chainage, to: s2.chainage, L, A1: s1.area, Am: sm.area, A2: s2.area, volume: v })
    total += v
  }

  return { method: 'prismoidal', totalVolume: total, segments }
}

export function volumeFromSections(sections: VolumeSection[], method: VolumeMethod): VolumeResult {
  if (method === 'end_area') return endAreaVolume(sections)
  return prismoidalVolume(sections)
}

/**
 * Cut/fill summarization from signed cross-section areas.
 * Convention: +area = cut, -area = fill.
 *
 * AUDIT FIX (M4, 2026-07-02):
 *   The previous implementation silently dropped segments where the
 *   signed area crossed zero (e.g., s1.area = +5, s2.area = -3),
 *   understating both cut and fill volumes. The fix splits such
 *   segments at the zero-crossing chainage (linear interpolation) and
 *   attributes the partial volumes to cut and fill respectively.
 *
 *   Zero-crossing chainage:
 *     ch_zero = ch1 + (0 - A1) / (A2 - A1) × L = ch1 - A1·L / (A2 - A1)
 *
 *   Partial volumes (trapezoidal):
 *     V_cut  = (L1 / 2) × |A1|     where L1 = ch_zero - ch1
 *     V_fill = (L2 / 2) × |A2|     where L2 = ch2 - ch_zero
 */
export function cutFillVolumeFromSignedSections(sections: VolumeSection[]): CutFillVolumeResult {
  const sorted = sortByChainage(sections)
  const segments: VolumeSegment[] = []
  let cutVolume = 0
  let fillVolume = 0

  for (let i = 1; i < sorted.length; i++) {
    const s1 = sorted[i - 1]
    const s2 = sorted[i]
    const L = s2.chainage - s1.chainage
    const A1 = s1.area
    const A2 = s2.area

    if (L <= 0) continue // skip duplicate/zero-length segments

    // Case 1: same sign (or one is zero) — single segment, no split needed
    if (A1 * A2 >= 0) {
      const v = (L / 2) * (A1 + A2)
      segments.push({ from: s1.chainage, to: s2.chainage, L, A1, A2, volume: v })
      if (v >= 0) cutVolume += v
      else fillVolume += Math.abs(v)
      continue
    }

    // Case 2: sign change — split at the zero-crossing
    // Linear interpolation: ch_zero = ch1 - A1·L / (A2 - A1)
    // Avoid divide-by-zero (already handled by A1·A2 >= 0 above, but defensive)
    const denom = A2 - A1
    if (Math.abs(denom) < 1e-12) continue
    const chZero = s1.chainage - (A1 * L) / denom
    const L1 = chZero - s1.chainage // length of first partial segment
    const L2 = s2.chainage - chZero // length of second partial segment

    // First partial segment: from (ch1, A1) to (chZero, 0)
    //   Trapezoid area = (A1 + 0) / 2 = A1 / 2
    //   Volume = L1 × A1 / 2 — sign matches A1
    const v1 = (L1 / 2) * A1
    if (v1 > 0) cutVolume += v1
    else if (v1 < 0) fillVolume += Math.abs(v1)
    segments.push({
      from: s1.chainage,
      to: chZero,
      L: L1,
      A1,
      A2: 0,
      volume: v1,
    })

    // Second partial segment: from (chZero, 0) to (ch2, A2)
    //   Trapezoid area = (0 + A2) / 2 = A2 / 2
    //   Volume = L2 × A2 / 2 — sign matches A2
    const v2 = (L2 / 2) * A2
    if (v2 > 0) cutVolume += v2
    else if (v2 < 0) fillVolume += Math.abs(v2)
    segments.push({
      from: chZero,
      to: s2.chainage,
      L: L2,
      A1: 0,
      A2,
      volume: v2,
    })
  }

  return { cutVolume, fillVolume, netVolume: cutVolume - fillVolume, segments }
}

function bboxOf(points: SurfacePoint[]) {
  let minE = Infinity
  let minN = Infinity
  let maxE = -Infinity
  let maxN = -Infinity
  for (const p of points) {
    if (p.easting < minE) minE = p.easting
    if (p.northing < minN) minN = p.northing
    if (p.easting > maxE) maxE = p.easting
    if (p.northing > maxN) maxN = p.northing
  }
  return { minE, minN, maxE, maxN }
}

function clampBboxIntersection(a: ReturnType<typeof bboxOf>, b: ReturnType<typeof bboxOf>) {
  const minE = Math.max(a.minE, b.minE)
  const minN = Math.max(a.minN, b.minN)
  const maxE = Math.min(a.maxE, b.maxE)
  const maxN = Math.min(a.maxN, b.maxN)
  return { minE, minN, maxE, maxN }
}

function idwZ(points: SurfacePoint[], x: number, y: number, power: number, maxDist: number): number | null {
  let wSum = 0
  let wzSum = 0
  let nearestD2 = Infinity
  let nearestZ = 0

  const maxD2 = maxDist * maxDist
  for (const p of points) {
    const dx = p.easting - x
    const dy = p.northing - y
    const d2 = dx * dx + dy * dy
    if (d2 === 0) return p.elevation
    if (d2 < nearestD2) {
      nearestD2 = d2
      nearestZ = p.elevation
    }
    if (d2 > maxD2) continue
    const d = Math.sqrt(d2)
    const w = 1 / Math.pow(d, power)
    wSum += w
    wzSum += w * p.elevation
  }

  if (wSum > 0) return wzSum / wSum
  if (nearestD2 < Infinity) return nearestZ
  return null
}

/**
 * Surface cut/fill by deterministic grid method:
 * - Interpolate both surfaces to grid cell centres (IDW)
 * - Integrate (existing - design) over area
 *
 * Convention:
 * - cut where existing > design
 * - fill where design > existing
 */
export function surfaceCutFillVolumeGrid(input: SurfaceVolumeGridInput): SurfaceVolumeGridResult {
  const warnings: string[] = []
  const spacing = input.gridSpacing
  if (!(spacing > 0)) {
    throw new Error('gridSpacing must be > 0')
  }
  if (input.existing.length < 3 || input.design.length < 3) {
    throw new Error('Both existing and design surfaces require at least 3 points.')
  }

  const power = input.power ?? 2
  const maxDist = input.maxDistance ?? spacing * 3
  const a = bboxOf(input.existing)
  const b = bboxOf(input.design)
  const bbox = clampBboxIntersection(a, b)

  if (!(bbox.maxE > bbox.minE) || !(bbox.maxN > bbox.minN)) {
    throw new Error('Surface extents do not overlap.')
  }

  // Snap to grid.
  const startE = Math.ceil(bbox.minE / spacing) * spacing
  const startN = Math.ceil(bbox.minN / spacing) * spacing
  const endE = Math.floor(bbox.maxE / spacing) * spacing
  const endN = Math.floor(bbox.maxN / spacing) * spacing

  const cellArea = spacing * spacing
  let cut = 0
  let fill = 0
  let cellCount = 0
  let missing = 0

  for (let e = startE; e <= endE; e += spacing) {
    for (let n = startN; n <= endN; n += spacing) {
      // Cell centre
      const x = e + spacing / 2
      const y = n + spacing / 2
      const zExisting = idwZ(input.existing, x, y, power, maxDist)
      const zDesign = idwZ(input.design, x, y, power, maxDist)
      if (zExisting === null || zDesign === null) {
        missing++
        continue
      }
      const diff = zExisting - zDesign
      if (diff > 0) cut += diff * cellArea
      else if (diff < 0) fill += -diff * cellArea
      cellCount++
    }
  }

  if (cellCount === 0) throw new Error('No grid cells could be evaluated for volume.')
  if (missing > 0) warnings.push(`Skipped ${missing} grid cell(s) due to missing interpolation support.`)

  return {
    method: 'grid_idw',
    cutVolume: cut,
    fillVolume: fill,
    netVolume: cut - fill,
    cellCount,
    bbox: { minE: bbox.minE, minN: bbox.minN, maxE: bbox.maxE, maxN: bbox.maxN },
    warnings,
  }
}
