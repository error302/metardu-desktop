/**
 * Vertical Curve Designer — multi-VIP alignment engine with SSD/K compliance.
 *
 * Extends the single-curve math in `./vertical.ts` to:
 *   - chain multiple VIPs into a single vertical alignment
 *   - check each parabolic curve against AASHTO / KeNHA design-speed K-factors
 *   - compute Stopping Sight Distance (SSD) per AASHTO Green Book (2011/2018)
 *   - flag crest curves that fail passing-sight-distance criteria
 *   - flag sag curves that fail headlight-sight-distance criteria
 *   - expose station interpolation across the whole alignment
 *
 * Roadmap reference: docs/ROADMAP.md → Tier 2 → "Parabolic vertical curve
 * profile designer" — implemented as `/tools/vertical-curve-designer`.
 *
 * References:
 *   - AASHTO Green Book (2018), Chapter 3 — Sight Distance
 *   - AASHTO Green Book (2018), Chapter 9 — Vertical Alignment
 *   - KeNHA Road Design Manual, Part 5 — Vertical Curves
 *   - Schofield, W. (2001) "Engineering Surveying", Chapter 13
 *
 * Formulas:
 *   SSD          = 0.278·V·t + V² / (254·(f ± G))     (AASHTO, metric)
 *   K_crest_min  = SSD² / (200·(√h1 + √h2)²)          (h1=1.08m, h2=0.60m)
 *   K_sag_min    = SSD² / (200·(h3 + SSD·tan φ))       (h3=0.60m, φ=1°)
 *   Parabola     = y_PVC + (g1/100)·x + (A/(200·L))·x²
 */

import {
  computeVerticalCurve,
  type VerticalCurveInput,
  type VerticalCurveResult,
  type VerticalCurveStationResult,
} from './vertical'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VIPInput {
  /** Stable id used by UI keys and station references. */
  id: string
  /** Chainage (stationing) in metres along the alignment. */
  chainage: number
  /** Reduced level (elevation) at the VIP, in metres. */
  reducedLevel: number
  /**
   * Optional user-specified K value. If omitted, the engine computes
   * the curve length from the design-speed minimum K (with a comfort
   * factor). If provided, length = K · |A|.
   */
  kOverride?: number
  /**
   * Optional explicit curve length in metres. Wins over kOverride.
   * Useful when surveyors set out a pre-designed curve.
   */
  lengthOverride?: number
}

export interface AlignmentCurve {
  /** Index of the VIP this curve sits on (0-based into the VIPs array). */
  vipIndex: number
  /** Underlying parabolic-curve result (PVC/PVT/A/K/turning point). */
  curve: VerticalCurveResult
  /** Approaching grade g1 (percent, +uphill). */
  g1: number
  /** Departing grade g2 (percent, +uphill). */
  g2: number
  /** Algebraic grade difference A = g2 - g1 (percent). */
  A: number
  /** Curve length used (metres). */
  length: number
  /** 'crest' | 'sag' classification. */
  curveType: 'crest' | 'sag'
  /** Compliance check against design-speed K-factors. */
  compliance: CurveCompliance
}

export interface CurveCompliance {
  /** True when the curve's K ≥ K_required for the design speed. */
  passes: boolean
  /** Severity of failure, if any. */
  severity: 'ok' | 'warn' | 'fail'
  /** Minimum required K for the design speed and curve type. */
  kRequired: number
  /** Actual K of the curve (L / |A|). */
  kActual: number
  /** Stopping sight distance used (metres). */
  ssd: number
  /** Available sight distance on this curve (metres). */
  availableSightDistance: number
  /** Human-readable explanation for UI display. */
  message: string
}

export interface VerticalAlignmentResult {
  /** Original VIPs (echoed back). */
  vips: VIPInput[]
  /** Design speed (km/h) used for compliance checks. */
  designSpeed: number
  /** One curve per interior VIP (n-1 curves for n VIPs). */
  curves: AlignmentCurve[]
  /** Chainage of the first PVC (alignment start). */
  startChainage: number
  /** Chainage of the last PVT (alignment end). */
  endChainage: number
  /** Highest elevation along the alignment (metres). */
  maxElevation: number
  /** Lowest elevation along the alignment (metres). */
  minElevation: number
  /** True if every curve passes compliance. */
  allPass: boolean
  /** Alignment-wide warnings (e.g., short tangents between curves). */
  warnings: string[]
}

export interface AlignmentStationResult extends VerticalCurveStationResult {
  /** VIP index whose curve this station falls on, or -1 if on a tangent. */
  vipIndex: number
  /** Whether the station lies inside a curve or on a tangent. */
  segment: 'curve' | 'tangent' | 'outside'
}

// ─── Design-Speed Tables (AASHTO Green Book 2018, metric) ───────────────────

export interface DesignSpeedEntry {
  speed: number
  ssd: number
  kCrestMin: number
  kSagMin: number
}

/**
 * AASHTO Green Book 2018 — Exhibit 3-2 (SSD) and Exhibits 9-31 / 9-34 (K values).
 * Crest K uses h1=1.08 m, h2=0.60 m. Sag K uses h3=0.60 m, φ=1°.
 */
export const DESIGN_SPEED_TABLE: DesignSpeedEntry[] = [
  { speed: 20,  ssd: 20,  kCrestMin: 1,   kSagMin: 2 },
  { speed: 30,  ssd: 35,  kCrestMin: 2,   kSagMin: 2 },
  { speed: 40,  ssd: 50,  kCrestMin: 4,   kSagMin: 3 },
  { speed: 50,  ssd: 65,  kCrestMin: 7,   kSagMin: 5 },
  { speed: 60,  ssd: 85,  kCrestMin: 11,  kSagMin: 8 },
  { speed: 70,  ssd: 105, kCrestMin: 17,  kSagMin: 11 },
  { speed: 80,  ssd: 130, kCrestMin: 26,  kSagMin: 16 },
  { speed: 90,  ssd: 160, kCrestMin: 39,  kSagMin: 22 },
  { speed: 100, ssd: 185, kCrestMin: 52,  kSagMin: 29 },
  { speed: 110, ssd: 220, kCrestMin: 74,  kSagMin: 38 },
  { speed: 120, ssd: 250, kCrestMin: 95,  kSagMin: 49 },
  { speed: 130, ssd: 285, kCrestMin: 124, kSagMin: 61 },
]

/** Comfort factor applied to the minimum K when no override is given. */
const DEFAULT_COMFORT_FACTOR = 1.4

/** Minimum tangent length between two successive curves (metres). */
const MIN_TANGENT_BETWEEN_CURVES = 30

/** Default stationing interval for table generation (metres). */
export const DEFAULT_STATION_INTERVAL = 20

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Look up the design-speed entry; falls back to the nearest lower speed. */
export function getDesignSpeedEntry(speed: number): DesignSpeedEntry {
  let entry = DESIGN_SPEED_TABLE[0]
  for (const row of DESIGN_SPEED_TABLE) {
    if (row.speed <= speed) entry = row
  }
  return entry
}

/**
 * Compute Stopping Sight Distance for a given speed and grade.
 *
 * SSD = 0.278·V·t + V² / (254·(f ± G))
 *
 * Default constants (AASHTO):
 *   t = 2.5 s (reaction time)
 *   f = 0.35 (coefficient of longitudinal friction, wet pavement)
 *
 * Grade G is supplied as a percentage (e.g., +6 for 6% uphill).
 * Uphill shortens SSD, downhill lengthens it.
 */
export function computeSSD(
  speedKmh: number,
  gradePercent: number = 0,
  options: { reactionTime?: number; friction?: number } = {}
): number {
  const t = options.reactionTime ?? 2.5
  const f = options.friction ?? 0.35
  const G = gradePercent / 100
  const denom = Math.max(0.05, f + G) // prevent divide-by-zero on steep downhill
  const ssd = 0.278 * speedKmh * t + (speedKmh * speedKmh) / (254 * denom)
  return Math.round(ssd * 10) / 10
}

/**
 * Compute available sight distance on a crest curve, given K.
 *
 * For a crest curve of length L and algebraic grade difference A,
 * the sight distance inside the curve is:
 *
 *   When S < L:  S = √(200 · L · (√h1 + √h2)² / A)  =  √(658 · L / A · A)  =  √(658 · K · |A|)
 *   When S > L:  S = L/2 + 658/A · (1/2)
 *
 * Simplified: available_sight = √(658 · K)  for the S<L case (most common).
 */
export function availableSightDistanceOnCrest(K: number, L: number, A: number): number {
  const absA = Math.abs(A)
  if (absA < 1e-9) return Infinity
  // S < L case (most common for compliant curves)
  const sInside = Math.sqrt(658 * K * absA)
  if (sInside < L) {
    return sInside
  }
  // S > L case
  return L / 2 + 658 / absA / 2
}

/**
 * Compute available sight distance on a sag curve using headlight criteria.
 *
 *   When S < L:  S = √(200 · L · (h3 + S·tan φ)) / √1  →  solved as quadratic
 *   When S > L:  S = L/2 + (h3 + S·tan φ) · 200 / A · 1
 *
 * Simplified for the common S < L case:
 *   S² = 200·L·(h3 + S·tan φ)
 *   S² - 200·L·tan φ·S - 200·L·h3 = 0
 *   S = [200·L·tan φ + √((200·L·tan φ)² + 800·L·h3)] / 2
 */
export function availableSightDistanceOnSag(K: number, L: number, A: number): number {
  const absA = Math.abs(A)
  if (absA < 1e-9) return Infinity
  const h3 = 0.60
  const tanPhi = Math.tan((1 * Math.PI) / 180) // 1° beam divergence
  // S<L: solve quadratic
  const sInside =
    (200 * L * tanPhi + Math.sqrt(Math.pow(200 * L * tanPhi, 2) + 800 * L * h3)) / 2
  if (sInside < L) {
    return sInside
  }
  // S>L
  return L / 2 + (200 * (h3 + sInside * tanPhi)) / absA / 2
}

// ─── Compliance Check ───────────────────────────────────────────────────────

/**
 * Check a single vertical curve against the design-speed K-factor.
 *
 * Returns pass/warn/fail plus the required and actual K, the SSD used,
 * and the available sight distance on the curve.
 */
export function checkCurveCompliance(
  curve: VerticalCurveResult,
  designSpeed: number
): CurveCompliance {
  const entry = getDesignSpeedEntry(designSpeed)
  const ssd = entry.ssd
  const kRequired = curve.curveType === 'crest' ? entry.kCrestMin : entry.kSagMin
  const kActual = curve.K

  let availableSight: number
  if (curve.curveType === 'crest') {
    availableSight = availableSightDistanceOnCrest(kActual, curve.length, curve.A)
  } else {
    availableSight = availableSightDistanceOnSag(kActual, curve.length, curve.A)
  }

  // Three-tier verdict: ok (K ≥ 1.0 × required), warn (0.75–1.0 ×), fail (<0.75 ×)
  let severity: 'ok' | 'warn' | 'fail'
  let message: string

  if (kActual >= kRequired) {
    severity = 'ok'
    message = `Passes — K=${kActual.toFixed(1)} ≥ ${kRequired} required (SSD ${ssd} m, available ${Math.round(availableSight)} m).`
  } else if (kActual >= 0.75 * kRequired) {
    severity = 'warn'
    message = `Marginal — K=${kActual.toFixed(1)} < ${kRequired} required (SSD ${ssd} m, available ${Math.round(availableSight)} m). Sight distance sub-standard.`
  } else {
    severity = 'fail'
    message = `Fails — K=${kActual.toFixed(1)} ≪ ${kRequired} required (SSD ${ssd} m, available ${Math.round(availableSight)} m). Redesign recommended.`
  }

  return {
    passes: severity === 'ok',
    severity,
    kRequired,
    kActual,
    ssd,
    availableSightDistance: Math.round(availableSight),
    message,
  }
}

// ─── Alignment Engine ───────────────────────────────────────────────────────

/**
 * Compute a full vertical alignment from a chain of VIPs.
 *
 * For each interior VIP i (1 ≤ i < n-1):
 *   - g1 = (VIP[i].rl - VIP[i-1].rl) / (VIP[i].ch - VIP[i-1].ch) × 100
 *   - g2 = (VIP[i+1].rl - VIP[i].rl) / (VIP[i+1].ch - VIP[i].ch) × 100
 *   - L  = lengthOverride ?? kOverride × |A| ?? (K_min × comfort) × |A|
 *   - PVC = VIP[i].ch - L/2, PVT = VIP[i].ch + L/2
 *
 * Curves must not overlap; if they would, the engine clips the second curve
 * and emits a warning. Adjacent curves should have ≥30 m of tangent between
 * them per AASHTO guidance.
 */
export function computeVerticalAlignment(
  vips: VIPInput[],
  designSpeed: number,
  options: { comfortFactor?: number } = {}
): VerticalAlignmentResult {
  if (vips.length < 2) {
    return {
      vips,
      designSpeed,
      curves: [],
      startChainage: vips[0]?.chainage ?? 0,
      endChainage: vips[vips.length - 1]?.chainage ?? 0,
      maxElevation: vips[0]?.reducedLevel ?? 0,
      minElevation: vips[0]?.reducedLevel ?? 0,
      allPass: true,
      warnings: ['Need at least 2 VIPs to define an alignment.'],
    }
  }

  const comfortFactor = options.comfortFactor ?? DEFAULT_COMFORT_FACTOR
  const entry = getDesignSpeedEntry(designSpeed)
  const warnings: string[] = []

  // Sort VIPs by chainage (defensive — UI should already do this)
  const sorted = [...vips].sort((a, b) => a.chainage - b.chainage)

  // Compute grades between consecutive VIPs
  const grades: number[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const dCh = sorted[i + 1].chainage - sorted[i].chainage
    const dRl = sorted[i + 1].reducedLevel - sorted[i].reducedLevel
    if (Math.abs(dCh) < 1e-3) {
      warnings.push(`VIPs ${sorted[i].id} and ${sorted[i + 1].id} share the same chainage — grade is undefined.`)
      grades.push(0)
    } else {
      grades.push((dRl / dCh) * 100)
    }
  }

  // Build a curve at each interior VIP (1 ≤ i ≤ n-2)
  const curves: AlignmentCurve[] = []
  let prevPvtChainage = -Infinity
  let maxElev = -Infinity
  let minElev = Infinity
  for (const v of sorted) {
    if (v.reducedLevel > maxElev) maxElev = v.reducedLevel
    if (v.reducedLevel < minElev) minElev = v.reducedLevel
  }

  for (let i = 1; i < sorted.length - 1; i++) {
    const vip = sorted[i]
    const g1 = grades[i - 1]
    const g2 = grades[i]
    const A = g2 - g1

    if (Math.abs(A) < 1e-9) {
      warnings.push(`VIP ${vip.id} has no grade change (A=0). Skipping curve.`)
      continue
    }

    const curveType: 'crest' | 'sag' = A < 0 ? 'crest' : 'sag'
    const kMin = curveType === 'crest' ? entry.kCrestMin : entry.kSagMin

    // Determine curve length
    let L: number
    if (vip.lengthOverride && vip.lengthOverride > 0) {
      L = vip.lengthOverride
    } else if (vip.kOverride && vip.kOverride > 0) {
      L = vip.kOverride * Math.abs(A)
    } else {
      L = kMin * comfortFactor * Math.abs(A)
    }

    // Clip length so curves don't overlap with the previous one
    const pvcChainage = vip.chainage - L / 2
    if (pvcChainage < prevPvtChainage) {
      const maxL = 2 * (vip.chainage - prevPvtChainage - 1) // 1 m tangent reserve
      if (maxL <= 0) {
        warnings.push(`VIP ${vip.id} overlaps the previous curve with no room — skipped.`)
        continue
      }
      warnings.push(
        `VIP ${vip.id} curve clipped from ${L.toFixed(1)} m to ${maxL.toFixed(1)} m to avoid overlap with previous curve.`
      )
      L = maxL
    }

    // PVC elevation = VIP.rl - g1·(L/2)/100
    const pvcElevation = vip.reducedLevel - (g1 * (L / 2)) / 100
    const pvcCh = vip.chainage - L / 2

    const input: VerticalCurveInput = {
      g1,
      g2,
      length: L,
      pvcElevation,
      pvcChainage: pvcCh,
    }
    const curve = computeVerticalCurve(input)
    const compliance = checkCurveCompliance(curve, designSpeed)

    curves.push({
      vipIndex: i,
      curve,
      g1,
      g2,
      A,
      length: L,
      curveType,
      compliance,
    })

    // Track turning points for global min/max elevation
    if (curve.turningPointElevation > maxElev) maxElev = curve.turningPointElevation
    if (curve.turningPointElevation < minElev) minElev = curve.turningPointElevation

    prevPvtChainage = curve.pvtChainage
  }

  // Check tangent lengths between successive curves
  for (let i = 1; i < curves.length; i++) {
    const tangent = curves[i].curve.pvcChainage - curves[i - 1].curve.pvtChainage
    if (tangent < MIN_TANGENT_BETWEEN_CURVES) {
      warnings.push(
        `Tangent between VIP ${sorted[curves[i - 1].vipIndex].id} and VIP ${sorted[curves[i].vipIndex].id} is ${tangent.toFixed(1)} m (< ${MIN_TANGENT_BETWEEN_CURVES} m recommended).`
      )
    }
  }

  const allPass = curves.every(c => c.compliance.passes)

  return {
    vips: sorted,
    designSpeed,
    curves,
    startChainage: sorted[0].chainage,
    endChainage: sorted[sorted.length - 1].chainage,
    maxElevation: maxElev,
    minElevation: minElev,
    allPass,
    warnings,
  }
}

// ─── Station Interpolation ──────────────────────────────────────────────────

/**
 * Sample elevations at a fixed interval across the whole alignment.
 *
 * Tangent segments use linear interpolation between VIPs.
 * Curve segments use the parabolic equation from `vertical.ts`.
 */
export function stationAlignment(
  alignment: VerticalAlignmentResult,
  interval: number = DEFAULT_STATION_INTERVAL
): AlignmentStationResult[] {
  const stations: AlignmentStationResult[] = []
  if (alignment.vips.length < 2) return stations

  const start = alignment.startChainage
  const end = alignment.endChainage
  const n = Math.floor((end - start) / interval)

  for (let i = 0; i <= n; i++) {
    const ch = start + i * interval
    const s = stationAtChainage(alignment, ch)
    if (s) stations.push(s)
  }

  // Ensure the final chainage is present
  const last = stations[stations.length - 1]
  if (!last || Math.abs(last.chainage - end) > 0.01) {
    const s = stationAtChainage(alignment, end)
    if (s) stations.push(s)
  }

  return stations
}

/**
 * Compute the elevation and grade at any chainage along the alignment.
 *
 * Returns null for chainages outside [start, end].
 */
export function stationAtChainage(
  alignment: VerticalAlignmentResult,
  chainage: number
): AlignmentStationResult | null {
  if (chainage < alignment.startChainage - 0.01 || chainage > alignment.endChainage + 0.01) {
    return null
  }

  // Find the curve that contains this chainage
  for (const c of alignment.curves) {
    const { curve } = c
    if (chainage >= curve.pvcChainage - 0.01 && chainage <= curve.pvtChainage + 0.01) {
      const x = chainage - curve.pvcChainage
      const elev =
        curve.pvcElevation +
        (curve.g1 / 100) * x +
        (curve.A / (200 * curve.length)) * x * x
      const grade = curve.g1 + (curve.A / curve.length) * x
      const tangentElev = curve.pvcElevation + (curve.g1 / 100) * x
      return {
        chainage: Math.round(chainage * 1000) / 1000,
        distanceFromPVC: Math.round(x * 1000) / 1000,
        elevation: Math.round(elev * 1000) / 1000,
        grade: Math.round(grade * 10000) / 10000,
        tangentOffset: Math.round((elev - tangentElev) * 1000) / 1000,
        vipIndex: c.vipIndex,
        segment: 'curve',
      }
    }
  }

  // Otherwise: linear interpolation between adjacent VIPs
  const vips = alignment.vips
  for (let i = 0; i < vips.length - 1; i++) {
    const a = vips[i]
    const b = vips[i + 1]
    if (chainage >= a.chainage - 0.01 && chainage <= b.chainage + 0.01) {
      const t = (chainage - a.chainage) / (b.chainage - a.chainage || 1)
      const elev = a.reducedLevel + t * (b.reducedLevel - a.reducedLevel)
      const grade = ((b.reducedLevel - a.reducedLevel) / (b.chainage - a.chainage)) * 100
      return {
        chainage: Math.round(chainage * 1000) / 1000,
        distanceFromPVC: 0,
        elevation: Math.round(elev * 1000) / 1000,
        grade: Math.round(grade * 10000) / 10000,
        tangentOffset: 0,
        vipIndex: -1,
        segment: 'tangent',
      }
    }
  }

  return null
}

// ─── CSV Export ─────────────────────────────────────────────────────────────

/**
 * Build a CSV string of the alignment station table for download.
 */
export function alignmentToCSV(stations: AlignmentStationResult[]): string {
  const header = 'Chainage_m,Distance_from_PVC_m,Elevation_m,Grade_pct,Tangent_Offset_m,Segment,VIP_Index'
  const rows = stations.map(s =>
    [
      s.chainage.toFixed(3),
      s.distanceFromPVC.toFixed(3),
      s.elevation.toFixed(3),
      s.grade.toFixed(4),
      s.tangentOffset.toFixed(3),
      s.segment,
      s.vipIndex,
    ].join(',')
  )
  return [header, ...rows].join('\n')
}

/**
 * Build a CSV string of the per-curve compliance summary.
 */
export function complianceToCSV(alignment: VerticalAlignmentResult): string {
  const header =
    'VIP_Index,VIP_ID,Curve_Type,g1_pct,g2_pct,A_pct,Length_m,K_Actual,K_Required,SSD_m,Available_Sight_m,Passes,Severity'
  const rows = alignment.curves.map(c => {
    const vip = alignment.vips[c.vipIndex]
    return [
      c.vipIndex,
      vip.id,
      c.curveType,
      c.g1.toFixed(3),
      c.g2.toFixed(3),
      c.A.toFixed(3),
      c.length.toFixed(3),
      c.compliance.kActual.toFixed(2),
      c.compliance.kRequired,
      c.compliance.ssd,
      c.compliance.availableSightDistance,
      c.compliance.passes ? 'YES' : 'NO',
      c.compliance.severity,
    ].join(',')
  })
  return [header, ...rows].join('\n')
}
