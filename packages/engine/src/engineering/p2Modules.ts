/**
 * Superelevation runout + Grade analysis + Bridge pier alignment + Pipeline as-built
 * Combined module for P2 engineering gaps.
 */

// ─── 1. SUPERELEVATION RUNOUT ───────────────────────────────────────────────

export interface SuperelevationRunoutResult {
  /** Tangent runout length (m) — from normal crown to zero cross-slope */
  tangentRunout: number
  /** Runout length (m) — from zero cross-slope to full superelevation */
  runoutLength: number
  /** Total transition length (m) = tangentRunout + runoutLength */
  totalTransition: number
  /** Cross-slope at each station along the transition */
  profile: Array<{ chainage: number; crossSlope: number; description: string }>
}

/**
 * Compute the superelevation runout profile for a horizontal curve.
 *
 * The transition from normal crown (2% cross-slope) to full superelevation
 * happens in two stages:
 *   1. Tangent runout: rotate outer lane from -2% to 0% (flat)
 *   2. Runout: rotate both lanes from 0% to full superelevation (e.g., 8%)
 *
 * @param designSpeed km/h
 * @param radius Curve radius (m)
 * @param laneWidth Lane width (m)
 * @param numLanes Number of lanes
 * @param normalCrossSlope Normal crown cross-slope (default 2%)
 * @param maxSuperelevation Maximum superelevation (default 8%)
 * @param rateOfChange Rate of change (% per m, default 1/244 per RDM 1.3)
 */
export function computeSuperelevationRunout(
  designSpeed: number,
  radius: number,
  laneWidth: number,
  numLanes: number,
  normalCrossSlope: number = 2,
  maxSuperelevation: number = 8,
  rateOfChange: number = 1 / 244,
): SuperelevationRunoutResult {
  const roadWidth = laneWidth * numLanes
  const fullSuperelevation = Math.min(maxSuperelevation, (designSpeed ** 2 / (127 * radius)) * 100)

  // Tangent runout: time to remove the normal crown from the outer half
  const tangentRunout = (normalCrossSlope / rateOfChange) / 2

  // Runout: from 0% to full superelevation
  const runoutLength = (fullSuperelevation / rateOfChange)

  const totalTransition = tangentRunout + runoutLength

  // Generate profile at 1m intervals
  const profile: Array<{ chainage: number; crossSlope: number; description: string }> = []

  // Tangent runout phase (0 to tangentRunout)
  for (let ch = 0; ch <= tangentRunout + 0.001; ch += 1) {
    const slope = -normalCrossSlope + (normalCrossSlope * ch / tangentRunout)
    profile.push({ chainage: ch, crossSlope: slope, description: 'Tangent runout' })
  }

  // Runout phase (tangentRunout to totalTransition)
  for (let ch = tangentRunout + 1; ch <= totalTransition + 0.001; ch += 1) {
    const slope = (fullSuperelevation * (ch - tangentRunout) / runoutLength)
    profile.push({ chainage: ch, crossSlope: slope, description: 'Runout' })
  }

  // Full superelevation
  profile.push({ chainage: totalTransition + 10, crossSlope: fullSuperelevation, description: 'Full superelevation' })

  return { tangentRunout, runoutLength, totalTransition, profile }
}

// ─── 2. GRADE ANALYSIS ──────────────────────────────────────────────────────

export interface GradeSegment {
  startChainage: number
  endChainage: number
  length: number
  grade: number // %
  isSustained: boolean // > 3% for > 200m
  isCritical: boolean // > 6% (Kenya rural road standard)
  needsClimbingLane: boolean // > 4% for > 1000m (AASHTO)
}

export interface GradeAnalysisResult {
  segments: GradeSegment[]
  maxGrade: number
  maxGradeLocation: number
  totalUphill: number
  totalDownhill: number
  sustainedGradeCount: number
  criticalGradeCount: number
  climbingLaneWarrants: number
  summary: string
}

/**
 * Analyze a vertical grade profile for sustained grades, critical grades,
 * and climbing lane warrants.
 *
 * @param profile Array of { chainage, elevation } points
 * @param thresholdSustained Grade % considered sustained (default 3%)
 * @param thresholdCritical Grade % considered critical (default 6%)
 * @param thresholdClimbingLane Grade % that warrants a climbing lane (default 4%)
 * @param minSustainedLength Min length for sustained grade (default 200m)
 * @param minClimbingLaneLength Min length for climbing lane warrant (default 1000m)
 */
export function analyzeGrades(
  profile: Array<{ chainage: number; elevation: number }>,
  thresholdSustained: number = 3,
  thresholdCritical: number = 6,
  thresholdClimbingLane: number = 4,
  minSustainedLength: number = 200,
  minClimbingLaneLength: number = 1000,
): GradeAnalysisResult {
  const segments: GradeSegment[] = []
  let maxGrade = 0
  let maxGradeLocation = 0
  let totalUphill = 0
  let totalDownhill = 0

  for (let i = 0; i < profile.length - 1; i++) {
    const p1 = profile[i]
    const p2 = profile[i + 1]
    const length = p2.chainage - p1.chainage
    if (length <= 0) continue

    const grade = ((p2.elevation - p1.elevation) / length) * 100
    const absGrade = Math.abs(grade)

    if (absGrade > maxGrade) {
      maxGrade = absGrade
      maxGradeLocation = p1.chainage
    }

    if (grade > 0) totalUphill += Math.abs(p2.elevation - p1.elevation)
    else totalDownhill += Math.abs(p2.elevation - p1.elevation)

    segments.push({
      startChainage: p1.chainage,
      endChainage: p2.chainage,
      length,
      grade,
      isSustained: absGrade >= thresholdSustained && length >= minSustainedLength,
      isCritical: absGrade >= thresholdCritical,
      needsClimbingLane: absGrade >= thresholdClimbingLane && length >= minClimbingLaneLength,
    })
  }

  const sustainedCount = segments.filter(s => s.isSustained).length
  const criticalCount = segments.filter(s => s.isCritical).length
  const climbingLaneCount = segments.filter(s => s.needsClimbingLane).length

  const summary = `Max grade ${maxGrade.toFixed(2)}% at KM ${(maxGradeLocation / 1000).toFixed(3)}. ` +
    `${sustainedCount} sustained grade(s), ${criticalCount} critical grade(s), ${climbingLaneCount} climbing lane warrant(s).`

  return {
    segments,
    maxGrade,
    maxGradeLocation,
    totalUphill,
    totalDownhill,
    sustainedGradeCount: sustainedCount,
    criticalGradeCount: criticalCount,
    climbingLaneWarrants: climbingLaneCount,
    summary,
  }
}

// ─── 3. BRIDGE PIER ALIGNMENT ───────────────────────────────────────────────

export interface PierStake {
  pierNumber: number
  pierChainage: number
  centerE: number
  centerN: number
  /** Perpendicular offsets (left and right of centerline) */
  offsets: Array<{ offset: number; easting: number; northing: number; label: string }>
}

/**
 * Compute bridge pier setting-out data.
 *
 * Given a bridge centerline (alignment) and pier chainages, computes
 * the coordinates of each pier center + perpendicular offsets for
 * pier edges/foundations.
 *
 * @param centerlineBearing Bearing of the bridge centerline (decimal degrees)
 * @param startE, startN Starting coordinates of the centerline
 * @param pierChainages Array of chainages for each pier (metres from start)
 * @param offsetDistances Array of perpendicular offsets to stake (e.g., [-5, 0, 5])
 */
export function computePierAlignment(
  centerlineBearing: number,
  startE: number,
  startN: number,
  pierChainages: number[],
  offsetDistances: number[] = [-5, 0, 5],
): PierStake[] {
  const bearingRad = (centerlineBearing * Math.PI) / 180
  const perpBearingRad = ((centerlineBearing + 90) * Math.PI) / 180

  return pierChainages.map((ch, i) => {
    // Pier center = start + chainage × (sin, cos) of bearing
    const centerE = startE + ch * Math.sin(bearingRad)
    const centerN = startN + ch * Math.cos(bearingRad)

    const offsets = offsetDistances.map(offset => ({
      offset,
      easting: centerE + offset * Math.sin(perpBearingRad),
      northing: centerN + offset * Math.cos(perpBearingRad),
      label: offset === 0 ? 'CL' : offset > 0 ? `R${offset}` : `L${Math.abs(offset)}`,
    }))

    return { pierNumber: i + 1, pierChainage: ch, centerE, centerN, offsets }
  })
}

// ─── 4. PIPELINE AS-BUILT ───────────────────────────────────────────────────

export interface PipelinePoint {
  chainage: number
  invertElevation: number // pipe invert (bottom inside)
  groundElevation: number // ground surface above pipe
  pipeDiameter: number // mm
  jointType?: string
  remarks?: string
}

export interface PipelineAnalysisResult {
  points: Array<{
    chainage: number
    invertElevation: number
    groundElevation: number
    coverDepth: number // ground - invert - diameter/2 (top of pipe to ground)
    coverAdequate: boolean // cover > 0.6m (Kenya standard for shallow pipes)
    grade: number // % grade to next point
    jointType?: string
    remarks?: string
  }>
  minCover: number
  minCoverLocation: number
  inadequateCoverCount: number
  maxGrade: number
  summary: string
}

/**
 * Analyze a pipeline as-built survey.
 *
 * Computes cover depth, grade between joints, and flags inadequate cover.
 *
 * @param points Pipeline survey points (chainage, invert, ground, diameter)
 * @param minCover Minimum cover depth in metres (default 0.6m)
 */
export function analyzePipelineAsBuilt(
  points: PipelinePoint[],
  minCover: number = 0.6,
): PipelineAnalysisResult {
  const analyzed = points.map((p, i) => {
    const topOfPipe = p.invertElevation + p.pipeDiameter / 1000
    const coverDepth = p.groundElevation - topOfPipe

    let grade = 0
    if (i < points.length - 1) {
      const next = points[i + 1]
      const dist = next.chainage - p.chainage
      if (dist > 0) {
        grade = ((next.invertElevation - p.invertElevation) / dist) * 100
      }
    }

    return {
      chainage: p.chainage,
      invertElevation: p.invertElevation,
      groundElevation: p.groundElevation,
      coverDepth: Math.max(0, coverDepth),
      coverAdequate: coverDepth >= minCover,
      grade,
      jointType: p.jointType,
      remarks: p.remarks,
    }
  })

  let minCoverVal = Infinity
  let minCoverLocation = 0
  let inadequateCount = 0
  let maxGrade = 0

  for (const p of analyzed) {
    if (p.coverDepth < minCoverVal) {
      minCoverVal = p.coverDepth
      minCoverLocation = p.chainage
    }
    if (!p.coverAdequate) inadequateCount++
    if (Math.abs(p.grade) > maxGrade) maxGrade = Math.abs(p.grade)
  }

  const summary = `${analyzed.length} pipe points. Min cover: ${minCoverVal.toFixed(3)}m at KM ${(minCoverLocation / 1000).toFixed(3)}. ` +
    `${inadequateCount} point(s) with cover < ${minCover}m. Max grade: ${maxGrade.toFixed(2)}%.`

  return {
    points: analyzed,
    minCover: minCoverVal === Infinity ? 0 : minCoverVal,
    minCoverLocation,
    inadequateCoverCount: inadequateCount,
    maxGrade,
    summary,
  }
}
