/**
 * @module massHaulOptimization
 *
 * Mass haul diagram optimization: free-haul, overhaul, borrow/spoil.
 *
 * Computes earthwork cost optimization from a mass haul diagram:
 *   - Free-haul limit: distance material can be moved without extra cost
 *   - Overhaul: material moved beyond free-haul, charged per m³·m
 *   - Borrow: additional material needed from outside the site
 *   - Spoil (waste): excess material that must be disposed of off-site
 *
 * References:
 *   - "Surveying" by B.C. Punmia, Chapter 11
 *   - "Route Surveying" by Meyer & Gibson, Chapter 9
 *   - Kenya Ministry of Roads: Standard Specifications for Road Works
 */

export interface MassHaulPoint {
  /** Chainage in metres */
  chainage: number
  /** Cumulative volume at this chainage (m³)
   *  Positive = cut (material available)
   *  Negative = fill (material needed) */
  cumulativeVolume: number
}

export interface HaulSegment {
  /** Start chainage */
  fromChainage: number
  /** End chainage */
  toChainage: number
  /** Volume moved (m³) */
  volume: number
  /** Average haul distance (m) */
  avgHaulDistance: number
  /** Free-haul distance (m) */
  freeHaul: number
  /** Overhaul distance (m) = avgHaulDistance - freeHaul (if > 0) */
  overhaul: number
  /** Overhaul volume (m³·m) — the cost unit */
  overhaulVolume: number
  /** Whether this segment is a borrow (material from outside) */
  isBorrow: boolean
  /** Whether this segment is spoil (material to waste) */
  isSpoil: boolean
}

export interface MassHaulResult {
  /** All haul segments */
  segments: HaulSegment[]
  /** Total free-haul volume (m³) */
  totalFreeHaulVolume: number
  /** Total overhaul (m³·m) */
  totalOverhaul: number
  /** Total borrow volume (m³) */
  totalBorrow: number
  /** Total spoil volume (m³) */
  totalSpoil: number
  /** Total haul cost (free-haul + overhaul × rate) */
  estimatedCost: number
  /** The balance line (average ordinate) for optimal haul */
  balanceLine: number
}

/**
 * Analyze a mass haul diagram for earthwork optimization.
 *
 * @param points Mass haul curve points (chainage, cumulative volume)
 * @param freeHaulLimit Free-haul distance in metres (default: 100m)
 * @param overhaulRate Cost per m³·m of overhaul (default: 5 KES)
 */
export function optimizeMassHaul(
  points: MassHaulPoint[],
  freeHaulLimit: number = 100,
  overhaulRate: number = 5,
): MassHaulResult {
  if (points.length < 2) {
    return {
      segments: [],
      totalFreeHaulVolume: 0,
      totalOverhaul: 0,
      totalBorrow: 0,
      totalSpoil: 0,
      estimatedCost: 0,
      balanceLine: 0,
    }
  }

  // ── Step 1: Compute the balance line ──
  // The balance line is the average ordinate of the mass haul curve.
  // Hauling is optimized when the balance line passes through the
  // midpoints of the rising and falling sections.
  const totalVolume = points.reduce((s, p) => s + p.cumulativeVolume, 0) / points.length

  // ── Step 2: Identify haul segments ──
  // A haul segment is a portion of the curve between consecutive
  // balance line crossings (where the curve crosses the balance line).
  const crossings: number[] = []

  for (let i = 0; i < points.length - 1; i++) {
    const v1 = points[i].cumulativeVolume - totalVolume
    const v2 = points[i + 1].cumulativeVolume - totalVolume

    if ((v1 < 0 && v2 >= 0) || (v1 >= 0 && v2 < 0)) {
      // Linear interpolation to find the crossing chainage
      const t = Math.abs(v1) / (Math.abs(v1) + Math.abs(v2))
      const crossingChain = points[i].chainage + t * (points[i + 1].chainage - points[i].chainage)
      crossings.push(crossingChain)
    }
  }

  // Add the start and end as crossings
  crossings.unshift(points[0].chainage)
  crossings.push(points[points.length - 1].chainage)

  // ── Step 3: Compute haul for each segment ──
  const segments: HaulSegment[] = []
  let totalFreeHaulVolume = 0
  let totalOverhaul = 0
  let totalBorrow = 0
  let totalSpoil = 0

  for (let i = 0; i < crossings.length - 1; i++) {
    const fromCh = crossings[i]
    const toCh = crossings[i + 1]
    const segLength = toCh - fromCh

    if (segLength < 0.001) continue

    // Find the volume in this segment (peak above/below balance line)
    let peakVolume = 0
    for (const p of points) {
      if (p.chainage >= fromCh && p.chainage <= toCh) {
        const dev = p.cumulativeVolume - totalVolume
        if (Math.abs(dev) > Math.abs(peakVolume)) {
          peakVolume = dev
        }
      }
    }

    const volume = Math.abs(peakVolume)
    const avgHaulDistance = segLength / 2 // simplified: average haul = half the segment length
    const overhaulDist = Math.max(0, avgHaulDistance - freeHaulLimit)
    const overhaulVol = overhaulDist * volume

    const isBorrow = peakVolume < 0 && i === 0
    const isSpoil = peakVolume > 0 && i === crossings.length - 2

    segments.push({
      fromChainage: fromCh,
      toChainage: toCh,
      volume,
      avgHaulDistance,
      freeHaul: freeHaulLimit,
      overhaul: overhaulDist,
      overhaulVolume: overhaulVol,
      isBorrow,
      isSpoil,
    })

    if (overhaulDist === 0) {
      totalFreeHaulVolume += volume
    } else {
      totalOverhaul += overhaulVol
    }

    if (isBorrow) totalBorrow += volume
    if (isSpoil) totalSpoil += volume
  }

  const estimatedCost = totalOverhaul * overhaulRate + totalBorrow * 200 + totalSpoil * 100

  return {
    segments,
    totalFreeHaulVolume,
    totalOverhaul,
    totalBorrow,
    totalSpoil,
    estimatedCost,
    balanceLine: totalVolume,
  }
}
