/**
 * @module massHaulDiagram
 *
 * Mass Haul Diagram Engine for road construction
 *
 * Computes cumulative earthwork volumes along a road alignment:
 * 1. Takes station-by-station cut/fill volumes
 * 2. Applies shrinkage (cut → fill) and bulking (cut → loose) factors
 * 3. Computes cumulative volume curve
 * 4. Identifies balance points, free haul limits, borrow/waste points
 *
 * The mass haul diagram tells engineers:
 * - Where cut material should go (to fill areas or waste sites)
 * - Where fill material must come from (cut areas or borrow pits)
 * - The optimum haul distance (free haul limit)
 * - Total earthwork cost impact
 *
 * Reference: "Construction Surveying" by Augelli & Pence, Chapter 9
 *            "Earthwork" — KeNHA Specification Section 5
 */

export interface StationVolume {
  station: number      // chainage in meters (e.g., 0+000 = 0, 1+250 = 1250)
  cutVolume: number    // m³ (material to remove)
  fillVolume: number   // m³ (material to add)
  adjustedCut: number  // after shrinkage/bulking
  adjustedFill: number // after compaction
  cumulativeVolume: number // running total (positive = surplus, negative = deficit)
}

export interface MassHaulPoint {
  station: number
  cumulativeVolume: number
  isBalancePoint: boolean  // where curve crosses zero
  isBorrowPoint: boolean   // where material must be brought in
  isWastePoint: boolean    // where excess material must be removed
  isFreeHaulLimit: boolean // at free haul boundary
}

export interface MassHaulResult {
  stations: StationVolume[]
  curve: MassHaulPoint[]
  totalCut: number
  totalFill: number
  totalAdjustedCut: number
  totalAdjustedFill: number
  netVolume: number
  borrowVolume: number   // m³ that must be imported
  wasteVolume: number    // m³ that must be exported
  freeHaulDistance: number  // meters
  averageHaulDistance: number  // meters
  balancePoints: MassHaulPoint[]
  borrowPoints: MassHaulPoint[]
  wastePoints: MassHaulPoint[]
}

export interface MassHaulOptions {
  /** Shrinkage factor: cut material volume reduces when compacted as fill.
   *  Typical: 0.85-0.90 (1m³ cut → 0.85m³ fill) */
  shrinkageFactor?: number
  /** Bulking factor: cut material expands when loosened.
   *  Typical: 1.15-1.25 (1m³ cut → 1.20m³ loose) */
  bulkingFactor?: number
  /** Free haul distance: material can be moved this distance at no extra cost (meters).
   *  Typical: 150-300m */
  freeHaulDistance?: number
}

/**
 * Compute mass haul diagram from station volumes.
 *
 * @param rawStations - Array of { station, cutVolume, fillVolume }
 * @param options - Shrinkage, bulking, free haul parameters
 */
export function computeMassHaul(
  rawStations: Array<{ station: number; cutVolume: number; fillVolume: number }>,
  options: MassHaulOptions = {},
): MassHaulResult {
  const {
    shrinkageFactor = 0.87,  // 13% shrinkage
    bulkingFactor = 1.20,    // 20% bulking
    freeHaulDistance = 200,  // 200m free haul
  } = options

  if (rawStations.length === 0) {
    return {
      stations: [],
      curve: [],
      totalCut: 0, totalFill: 0,
      totalAdjustedCut: 0, totalAdjustedFill: 0,
      netVolume: 0, borrowVolume: 0, wasteVolume: 0,
      freeHaulDistance, averageHaulDistance: 0,
      balancePoints: [], borrowPoints: [], wastePoints: [],
    }
  }

  // Sort by station
  const sorted = [...rawStations].sort((a, b) => a.station - b.station)

  // Apply factors and compute cumulative
  const stations: StationVolume[] = []
  let cumulative = 0
  let totalCut = 0
  let totalFill = 0
  let totalAdjustedCut = 0
  let totalAdjustedFill = 0

  for (const raw of sorted) {
    // Adjusted cut: account for bulking (loose volume > bank volume)
    const adjustedCut = raw.cutVolume * bulkingFactor
    // Adjusted fill: account for shrinkage (need more cut to fill same volume)
    const adjustedFill = raw.fillVolume / shrinkageFactor

    // Cumulative: positive = surplus cut, negative = deficit (need fill)
    cumulative += adjustedCut - adjustedFill

    stations.push({
      station: raw.station,
      cutVolume: raw.cutVolume,
      fillVolume: raw.fillVolume,
      adjustedCut,
      adjustedFill,
      cumulativeVolume: cumulative,
    })

    totalCut += raw.cutVolume
    totalFill += raw.fillVolume
    totalAdjustedCut += adjustedCut
    totalAdjustedFill += adjustedFill
  }

  // Build mass haul curve points
  const curve: MassHaulPoint[] = stations.map((s, i) => {
    const prev = i > 0 ? stations[i - 1] : s
    const isBalancePoint = (prev.cumulativeVolume > 0 && s.cumulativeVolume <= 0) ||
                           (prev.cumulativeVolume < 0 && s.cumulativeVolume >= 0) ||
                           (i === 0 && s.cumulativeVolume === 0)

    return {
      station: s.station,
      cumulativeVolume: s.cumulativeVolume,
      isBalancePoint,
      isBorrowPoint: false, // determined after full curve analysis
      isWastePoint: false,
      isFreeHaulLimit: false,
    }
  })

  // Identify balance points (curve crosses zero)
  const balancePoints = curve.filter(p => p.isBalancePoint)

  // Identify borrow and waste points
  // Borrow: curve goes negative (need to import material)
  // Waste: curve goes positive (need to export material)
  const borrowPoints: MassHaulPoint[] = []
  const wastePoints: MassHaulPoint[] = []

  for (let i = 0; i < curve.length; i++) {
    const point = curve[i]
    const prev = i > 0 ? curve[i - 1] : point

    // Transition from positive to negative = start of borrow
    if (prev.cumulativeVolume > 0 && point.cumulativeVolume < 0) {
      borrowPoints.push({ ...point, isBorrowPoint: true })
    }

    // Transition from negative to positive = start of waste
    if (prev.cumulativeVolume < 0 && point.cumulativeVolume > 0) {
      wastePoints.push({ ...point, isWastePoint: true })
    }
  }

  // Calculate borrow and waste volumes
  const minCumulative = Math.min(...stations.map(s => s.cumulativeVolume))
  const maxCumulative = Math.max(...stations.map(s => s.cumulativeVolume))
  const borrowVolume = minCumulative < 0 ? Math.abs(minCumulative) : 0
  const wasteVolume = maxCumulative > 0 ? maxCumulative : 0

  // Average haul distance (simplified: total haul area / total volume)
  let haulArea = 0
  for (let i = 1; i < stations.length; i++) {
    const dx = stations[i].station - stations[i - 1].station
    const avgVol = (stations[i].cumulativeVolume + stations[i - 1].cumulativeVolume) / 2
    haulArea += Math.abs(avgVol * dx)
  }
  const totalVol = totalAdjustedCut + totalAdjustedFill
  const averageHaulDistance = totalVol > 0 ? haulArea / totalVol : 0

  return {
    stations,
    curve,
    totalCut,
    totalFill,
    totalAdjustedCut,
    totalAdjustedFill,
    netVolume: totalAdjustedCut - totalAdjustedFill,
    borrowVolume,
    wasteVolume,
    freeHaulDistance,
    averageHaulDistance,
    balancePoints,
    borrowPoints,
    wastePoints,
  }
}

/**
 * Generate a mass haul report.
 */
export function generateMassHaulReport(result: MassHaulResult): string {
  let report = 'MASS HAUL DIAGRAM REPORT\n'
  report += '═══════════════════════\n\n'

  report += `Stations: ${result.stations.length}\n`
  report += `Total Cut (raw): ${result.totalCut.toFixed(1)} m³\n`
  report += `Total Fill (raw): ${result.totalFill.toFixed(1)} m³\n`
  report += `Total Cut (adjusted, +20% bulking): ${result.totalAdjustedCut.toFixed(1)} m³\n`
  report += `Total Fill (adjusted, /0.87 shrinkage): ${result.totalAdjustedFill.toFixed(1)} m³\n`
  report += `Net Volume: ${result.netVolume.toFixed(1)} m³`
  report += ` (${result.netVolume > 0 ? 'SURPLUS — waste' : 'DEFICIT — borrow'})\n\n`

  report += `Borrow Required: ${result.borrowVolume.toFixed(1)} m³\n`
  report += `Waste Required: ${result.wasteVolume.toFixed(1)} m³\n`
  report += `Free Haul Distance: ${result.freeHaulDistance} m\n`
  report += `Average Haul Distance: ${result.averageHaulDistance.toFixed(1)} m\n\n`

  report += `Balance Points: ${result.balancePoints.length}\n`
  for (const bp of result.balancePoints) {
    report += `  Station ${bp.station.toFixed(0)}: ${bp.cumulativeVolume.toFixed(1)} m³\n`
  }

  report += `\nBorrow Points: ${result.borrowPoints.length}\n`
  for (const bp of result.borrowPoints) {
    report += `  Station ${bp.station.toFixed(0)}: ${bp.cumulativeVolume.toFixed(1)} m³\n`
  }

  report += `\nWaste Points: ${result.wastePoints.length}\n`
  for (const wp of result.wastePoints) {
    report += `  Station ${wp.station.toFixed(0)}: ${wp.cumulativeVolume.toFixed(1)} m³\n`
  }

  return report
}
