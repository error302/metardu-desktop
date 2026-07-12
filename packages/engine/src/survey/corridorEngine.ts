/**
 * Chainage-Offset Transformation Engine — corridor coordinate system
 *
 * PROBLEM
 * -------
 * On a road corridor (KeNHA), surveyors work in (chainage, offset) space:
 *   - Chainage = distance along the centerline from the start (e.g., 12+450 = 12450m)
 *   - Offset = perpendicular distance from the centerline (left = negative, right = positive)
 *
 * But total stations and GNSS output easting/northing. This module converts
 * between the two coordinate systems along an alignment defined by PI points
 * (Points of Intersection).
 *
 * WHAT IT DOES
 * ------------
 * 1. ENtoChainageOffset(easting, northing) → { chainage, offset, onCurve }
 *    Given an EN coordinate, find which chainage station it's nearest to and
 *    how far left/right of the centerline it is.
 *
 * 2. chainageOffsetToEN(chainage, offset) → { easting, northing }
 *    Given a chainage and offset, compute the EN coordinate.
 *
 * 3. organizeShotsByChainage(shots, alignment, interval) → CrossSectionGroup[]
 *    Takes a batch of field shots (EN + RL) and automatically groups them
 *    into cross-sections at chainage intervals, computing each shot's offset.
 *
 * USAGE
 * -----
 *   import { buildAlignment, enToChainageOffset, organizeShotsByChainage } from
 *     '@/lib/survey/corridorEngine'
 *
 *   const alignment = buildAlignment(piPoints)
 *   const { chainage, offset } = enToChainageOffset(alignment, 264100, 9861100)
 *   // chainage = 12450.0, offset = -3.2 (3.2m left of CL)
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PIPoint {
  /** Point ID (e.g., 'PI1') */
  id: string
  /** Easting (meters) */
  e: number
  /** Northing (meters) */
  n: number
  /** Chainage at this PI (meters) — optional, computed if not given */
  chainage?: number
}

export interface AlignmentSegment {
  /** From PI */
  fromPI: string
  /** To PI */
  toPI: string
  /** Bearing of this segment (degrees) */
  bearing: number
  /** Length of this segment (meters) */
  length: number
  /** Cumulative chainage at the start of this segment */
  startChainage: number
  /** Cumulative chainage at the end of this segment */
  endChainage: number
  /** Start EN */
  startE: number
  startN: number
  /** End EN */
  endE: number
  endN: number
}

export interface Alignment {
  /** PI points in order */
  pis: PIPoint[]
  /** Computed segments */
  segments: AlignmentSegment[]
  /** Total length (meters) */
  totalLength: number
}

export interface ChainageOffsetResult {
  /** Chainage along the alignment (meters) */
  chainage: number
  /** Perpendicular offset from CL (meters, left = negative) */
  offset: number
  /** Which segment the point falls on */
  segmentIndex: number
  /** Whether the point is on a curve (always false for straight alignment) */
  onCurve: boolean
  /** The foot of the perpendicular (EN on the centerline) */
  footE: number
  footN: number
}

export interface FieldShot {
  /** Easting (meters) */
  e: number
  /** Northing (meters) */
  n: number
  /** Reduced level (meters) */
  rl: number
  /** Point name/ID */
  name?: string
  /** Point code (e.g., 'CL', 'LE', 'RE', 'DG') */
  code?: string
}

export interface CrossSectionShot {
  /** Original field shot */
  shot: FieldShot
  /** Computed chainage (meters) */
  chainage: number
  /** Computed offset (meters, left = negative) */
  offset: number
  /** Which cross-section group this belongs to */
  chainageStation: number
}

export interface CrossSectionGroup {
  /** Chainage station (rounded to interval) */
  chainage: number
  /** Chainage label (e.g., '12+450') */
  label: string
  /** All shots in this cross-section, sorted by offset (left to right) */
  shots: CrossSectionShot[]
  /** Leftmost offset */
  leftOffset: number
  /** Rightmost offset */
  rightOffset: number
  /** Centerline RL (shot nearest to offset=0) */
  centrelineRL: number | null
}

// ─── Build Alignment from PI Points ─────────────────────────────────────────

/**
 * Build an alignment from a sequence of PI (Point of Intersection) points.
 *
 * Computes bearings, segment lengths, and cumulative chainages.
 *
 * @param pis - PI points in order (start → end)
 * @param startChainage - Chainage at the first PI (default: 0)
 * @returns Alignment with computed segments
 */
export function buildAlignment(pis: PIPoint[], startChainage: number = 0): Alignment {
  if (pis.length < 2) {
    throw new Error('Alignment requires at least 2 PI points')
  }

  const segments: AlignmentSegment[] = []
  let cumulativeChainage = startChainage

  for (let i = 0; i < pis.length - 1; i++) {
    const from = pis[i]
    const to = pis[i + 1]
    const dE = to.e - from.e
    const dN = to.n - from.n
    const length = Math.sqrt(dE * dE + dN * dN)
    const bearing = (Math.atan2(dE, dN) * 180 / Math.PI + 360) % 360

    const segChainage = cumulativeChainage
    cumulativeChainage += length

    segments.push({
      fromPI: from.id,
      toPI: to.id,
      bearing,
      length,
      startChainage: segChainage,
      endChainage: cumulativeChainage,
      startE: from.e,
      startN: from.n,
      endE: to.e,
      endN: to.n,
    })
  }

  return {
    pis,
    segments,
    totalLength: cumulativeChainage - startChainage,
  }
}

// ─── EN → Chainage/Offset ───────────────────────────────────────────────────

/**
 * Convert an easting/northing coordinate to chainage/offset along an alignment.
 *
 * Finds the nearest point on the alignment (foot of perpendicular) and
 * computes the chainage at that point plus the perpendicular offset.
 *
 * Left of the centerline (looking in the direction of increasing chainage)
 * is negative offset; right is positive.
 *
 * @param alignment - The alignment (from buildAlignment)
 * @param easting - Easting of the point (meters)
 * @param northing - Northing of the point (meters)
 * @returns ChainageOffsetResult
 */
export function enToChainageOffset(
  alignment: Alignment,
  easting: number,
  northing: number,
): ChainageOffsetResult {
  let bestSegment = 0
  let bestDist = Infinity
  let bestFootE = 0
  let bestFootN = 0
  let bestT = 0 // parameter along segment (0=start, 1=end)

  for (let i = 0; i < alignment.segments.length; i++) {
    const seg = alignment.segments[i]
    const dE = seg.endE - seg.startE
    const dN = seg.endN - seg.startN
    const segLen2 = dE * dE + dN * dN

    if (segLen2 < 1e-12) continue

    // Project point onto segment
    const t = ((easting - seg.startE) * dE + (northing - seg.startN) * dN) / segLen2
    const tClamped = Math.max(0, Math.min(1, t))
    const footE = seg.startE + tClamped * dE
    const footN = seg.startN + tClamped * dN
    const dist = Math.sqrt((easting - footE) ** 2 + (northing - footN) ** 2)

    if (dist < bestDist) {
      bestDist = dist
      bestSegment = i
      bestFootE = footE
      bestFootN = footN
      bestT = tClamped
    }
  }

  const seg = alignment.segments[bestSegment]
  const chainage = seg.startChainage + bestT * seg.length

  // Compute offset sign: cross product to determine left/right
  // Direction vector of segment
  const dirE = seg.endE - seg.startE
  const dirN = seg.endN - seg.startN
  // Vector from foot to point
  const toPointE = easting - bestFootE
  const toPointN = northing - bestFootN
  // Cross product (2D z-component): dir × toPoint
  // In a standard EN coordinate system (x=east, y=north):
  //   positive cross → point is to the LEFT of travel direction
  //   negative cross → point is to the RIGHT
  const cross = dirE * toPointN - dirN * toPointE
  const offset = cross >= 0 ? -bestDist : bestDist

  return {
    chainage,
    offset,
    segmentIndex: bestSegment,
    onCurve: false,
    footE: bestFootE,
    footN: bestFootN,
  }
}

// ─── Chainage/Offset → EN ───────────────────────────────────────────────────

/**
 * Convert a chainage/offset coordinate to easting/northing.
 *
 * @param alignment - The alignment
 * @param chainage - Chainage along the alignment (meters)
 * @param offset - Perpendicular offset (meters, left = negative)
 * @returns { easting, northing }
 */
export function chainageOffsetToEN(
  alignment: Alignment,
  chainage: number,
  offset: number,
): { easting: number; northing: number } {
  // Find the segment containing this chainage
  let seg: AlignmentSegment | null = null
  for (const s of alignment.segments) {
    if (chainage >= s.startChainage && chainage <= s.endChainage) {
      seg = s
      break
    }
  }

  if (!seg) {
    // Clamp to the nearest end
    if (chainage < alignment.segments[0].startChainage) {
      seg = alignment.segments[0]
    } else {
      seg = alignment.segments[alignment.segments.length - 1]
    }
  }

  // Position along the segment
  const t = seg.length > 0
    ? (chainage - seg.startChainage) / seg.length
    : 0
  const clampedT = Math.max(0, Math.min(1, t))

  // Point on centerline
  const clE = seg.startE + clampedT * (seg.endE - seg.startE)
  const clN = seg.startN + clampedT * (seg.endN - seg.startN)

  // Perpendicular direction (rotate bearing by 90°)
  // Right perpendicular: bearing + 90°
  const perpBearing = (seg.bearing + 90) * Math.PI / 180
  const perpE = Math.sin(perpBearing)
  const perpN = Math.cos(perpBearing)

  // Apply offset
  const easting = clE + offset * perpE
  const northing = clN + offset * perpN

  return { easting, northing }
}

// ─── Organize Field Shots by Chainage ───────────────────────────────────────

/**
 * Organize a batch of field shots into cross-section groups by chainage.
 *
 * This is the core function for corridor survey: the surveyor captures shots
 * at cross-section intervals along a road, and this function automatically:
 *   1. Converts each shot's EN to (chainage, offset)
 *   2. Rounds the chainage to the nearest interval (e.g., 20m stations)
 *   3. Groups shots by station
 *   4. Sorts within each group by offset (left to right)
 *   5. Identifies the centerline shot (nearest to offset=0)
 *
 * @param shots - Array of field shots (EN + RL)
 * @param alignment - The alignment
 * @param interval - Cross-section interval in meters (default: 20)
 * @returns CrossSectionGroup[] sorted by chainage
 */
export function organizeShotsByChainage(
  shots: FieldShot[],
  alignment: Alignment,
  interval: number = 20,
): CrossSectionGroup[] {
  // Convert each shot to chainage/offset
  const crossSectionShots: CrossSectionShot[] = shots.map(shot => {
    const result = enToChainageOffset(alignment, shot.e, shot.n)
    const chainageStation = Math.round(result.chainage / interval) * interval
    return {
      shot,
      chainage: result.chainage,
      offset: result.offset,
      chainageStation,
    }
  })

  // Group by chainage station
  const groups = new Map<number, CrossSectionShot[]>()
  for (const css of crossSectionShots) {
    if (!groups.has(css.chainageStation)) {
      groups.set(css.chainageStation, [])
    }
    groups.get(css.chainageStation)!.push(css)
  }

  // Build CrossSectionGroup for each station
  const result: CrossSectionGroup[] = []
  for (const [chainage, groupShots] of groups) {
    // Sort by offset (left to right)
    groupShots.sort((a, b) => a.offset - b.offset)

    // Find centerline shot (nearest to offset=0)
    let clShot: CrossSectionShot | null = null
    let clDist = Infinity
    for (const cs of groupShots) {
      if (Math.abs(cs.offset) < clDist) {
        clDist = Math.abs(cs.offset)
        clShot = cs
      }
    }

    result.push({
      chainage,
      label: formatChainage(chainage),
      shots: groupShots,
      leftOffset: groupShots[0].offset,
      rightOffset: groupShots[groupShots.length - 1].offset,
      centrelineRL: clShot ? clShot.shot.rl : null,
    })
  }

  // Sort by chainage
  result.sort((a, b) => a.chainage - b.chainage)

  return result
}

// ─── Chainage Formatting ────────────────────────────────────────────────────

/**
 * Format a chainage in meters as a km+m string.
 * e.g., 12450 → '12+450'
 */
export function formatChainage(chainage: number): string {
  const km = Math.floor(chainage / 1000)
  const m = chainage % 1000
  return `${km}+${m.toFixed(0).padStart(3, '0')}`
}

/**
 * Parse a km+m chainage string to meters.
 * e.g., '12+450' → 12450
 */
export function parseChainage(str: string): number {
  const match = str.trim().match(/^(\d+)\+(\d+(?:\.\d+)?)$/)
  if (match) {
    return parseInt(match[1], 10) * 1000 + parseFloat(match[2])
  }
  return parseFloat(str) || 0
}
