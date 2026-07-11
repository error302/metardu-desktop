// METARDU As-Built Survey Module
// Source: RDM 1.3 Section 8 (Quality Assurance & Tolerances)
// Source: RDM 1.1 Detail Tolerances
// Source: KeNHA Construction Supervision Manual

// ─── TYPES ─────────────────────────────────────────────────────────────────────

export interface DesignPoint {
  chainage: number
  designLevel: number
  designEasting?: number
  designNorthing?: number
}

export interface AsBuiltPoint {
  chainage: number
  surveyedLevel: number
  surveyedEasting?: number
  surveyedNorthing?: number
  timestamp?: string
  surveyor?: string
}

export interface ToleranceBand {
  level: number     // mm — vertical tolerance (±)
  horizontal: number // mm — horizontal tolerance (±)
}

export interface AsBuiltComparisonRow {
  chainage: number
  designLevel: number
  asBuiltLevel: number
  deviation: number      // mm — positive = built higher
  tolerance: number      // mm
  pass: boolean
  designEasting?: number
  designNorthing?: number
  asBuiltEasting?: number
  asBuiltNorthing?: number
  horizontalDeviation?: number
  horizontalPass?: boolean
}

export interface AsBuiltSummary {
  totalPoints: number
  passCount: number
  failCount: number
  passRate: number
  maxLevelDeviation: number
  maxHorizontalDeviation: number
  meanLevelDeviation: number
  standardDeviation: number
  rmsError: number
  isCompliant: boolean   // KeNHA requires >= 95% pass rate
  certificationReady: boolean
  issues: string[]
}

export interface AsBuiltSurveyResult {
  comparisons: AsBuiltComparisonRow[]
  summary: AsBuiltSummary
  toleranceBand: ToleranceBand
}

// ─── TOLERANCE BANDS (RDM 1.1 Table 5.1, RDM 1.3 Section 8) ───────────────────

export const TOLERANCE_BANDS: Record<string, ToleranceBand> = {
  paved: { level: 25, horizontal: 50 },
  gravel: { level: 50, horizontal: 100 },
  earth: { level: 100, horizontal: 150 },
  bridge: { level: 10, horizontal: 25 },
}

export const DEFAULT_TOLERANCE = TOLERANCE_BANDS.paved

// ─── STATISTICS ────────────────────────────────────────────────────────────────

export interface Statistics {
  mean: number
  stdDev: number
  rms: number
  max: number
  min: number
}

export function computeStatistics(deviations: number[]): Statistics {
  if (deviations.length === 0) {
    return { mean: 0, stdDev: 0, rms: 0, max: 0, min: 0 }
  }

  const n = deviations.length
  const mean = deviations.reduce((s, d) => s + d, 0) / n
  const variance = deviations.reduce((s, d) => s + (d - mean) ** 2, 0) / n
  const stdDev = Math.sqrt(variance)
  const rms = Math.sqrt(deviations.reduce((s, d) => s + d ** 2, 0) / n)

  return {
    mean,
    stdDev,
    rms,
    max: Math.max(...deviations),
    min: Math.min(...deviations),
  }
}

// ─── INTERPOLATION ─────────────────────────────────────────────────────────────

function interpolateLevel(points: Array<{ chainage: number; level: number }>, targetChainage: number): number | null {
  if (points.length === 0) return null
  if (points.length === 1) return points[0].level

  // Sort by chainage
  const sorted = [...points].sort((a, b) => a.chainage - b.chainage)

  // Exact match
  for (const p of sorted) {
    if (Math.abs(p.chainage - targetChainage) < 0.001) return p.level
  }

  // Bracket
  if (targetChainage <= sorted[0].chainage || targetChainage >= sorted[sorted.length - 1].chainage) {
    return null // outside range
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    if (targetChainage >= sorted[i].chainage && targetChainage <= sorted[i + 1].chainage) {
      const t = (targetChainage - sorted[i].chainage) / (sorted[i + 1].chainage - sorted[i].chainage)
      return sorted[i].level + t * (sorted[i + 1].level - sorted[i].level)
    }
  }
  return null
}

function interpolateCoord(points: Array<{ chainage: number; easting: number; northing: number }>, targetChainage: number): { easting: number; northing: number } | null {
  if (points.length === 0) return null
  if (points.length === 1) return { easting: points[0].easting, northing: points[0].northing }

  const sorted = [...points].sort((a, b) => a.chainage - b.chainage)

  if (targetChainage <= sorted[0].chainage || targetChainage >= sorted[sorted.length - 1].chainage) {
    return null
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    if (targetChainage >= sorted[i].chainage && targetChainage <= sorted[i + 1].chainage) {
      const t = (targetChainage - sorted[i].chainage) / (sorted[i + 1].chainage - sorted[i].chainage)
      return {
        easting: sorted[i].easting + t * (sorted[i + 1].easting - sorted[i].easting),
        northing: sorted[i].northing + t * (sorted[i + 1].northing - sorted[i].northing),
      }
    }
  }
  return null
}

// ─── MAIN COMPARISON ──────────────────────────────────────────────────────────

export function compareDesignVsAsBuilt(
  design: DesignPoint[],
  asBuilt: AsBuiltPoint[],
  tolerance: ToleranceBand = DEFAULT_TOLERANCE
): AsBuiltSurveyResult {
  const comparisons: AsBuiltComparisonRow[] = []
  const issues: string[] = []

  if (asBuilt.length === 0) {
    return {
      comparisons: [],
      summary: {
        totalPoints: 0, passCount: 0, failCount: 0, passRate: 0,
        maxLevelDeviation: 0, maxHorizontalDeviation: 0,
        meanLevelDeviation: 0, standardDeviation: 0, rmsError: 0,
        isCompliant: false, certificationReady: false, issues: ['No as-built survey data provided'],
      },
      toleranceBand: tolerance,
    }
  }

  // Prepare design point arrays for interpolation
  const designLevels = design.map(d => ({ chainage: d.chainage, level: d.designLevel }))
  const designCoords = design.filter(d => d.designEasting && d.designNorthing).map(d => ({
    chainage: d.chainage, easting: d.designEasting!, northing: d.designNorthing!,
  }))

  for (const ab of asBuilt) {
    const designLevel = interpolateLevel(designLevels, ab.chainage)
    if (designLevel === null) {
      // No design data at this chainage — skip or warn
      continue
    }

    const levelDeviation = (ab.surveyedLevel - designLevel) * 1000 // convert m to mm
    const levelPass = Math.abs(levelDeviation) <= tolerance.level

    // Horizontal comparison
    let horizontalDeviation: number | undefined
    let horizontalPass: boolean | undefined

    // Interpolate design coordinates at this chainage
    const designCoord = designCoords.length > 0
      ? interpolateCoord(designCoords, ab.chainage)
      : null

    if (ab.surveyedEasting && ab.surveyedNorthing && designCoord) {
      const dE = ab.surveyedEasting - designCoord.easting
      const dN = ab.surveyedNorthing - designCoord.northing
      horizontalDeviation = Math.sqrt(dE * dE + dN * dN) * 1000 // m to mm
      horizontalPass = horizontalDeviation <= tolerance.horizontal
    }

    comparisons.push({
      chainage: ab.chainage,
      designLevel,
      asBuiltLevel: ab.surveyedLevel,
      deviation: Math.round(levelDeviation * 10) / 10,
      tolerance: tolerance.level,
      pass: levelPass,
      designEasting: designCoord?.easting,
      designNorthing: designCoord?.northing,
      asBuiltEasting: ab.surveyedEasting,
      asBuiltNorthing: ab.surveyedNorthing,
      horizontalDeviation: horizontalDeviation !== undefined ? Math.round(horizontalDeviation * 10) / 10 : undefined,
      horizontalPass,
    })
  }

  // Compute statistics
  const levelDeviations = comparisons.map(c => Math.abs(c.deviation))
  const stats = computeStatistics(levelDeviations)

  const passCount = comparisons.filter(c => c.pass).length
  const failCount = comparisons.length - passCount
  const passRate = comparisons.length > 0 ? (passCount / comparisons.length) * 100 : 0

  // KeNHA requires >= 95% pass rate for certification
  const isCompliant = passRate >= 95

  // Max horizontal deviation
  const horizDevs = comparisons.filter(c => c.horizontalDeviation !== undefined).map(c => c.horizontalDeviation!)
  const maxHorizontalDeviation = horizDevs.length > 0 ? Math.max(...horizDevs) : 0

  // Generate issues
  if (passRate < 95) {
    issues.push(`Pass rate ${passRate.toFixed(1)}% is below the KeNHA threshold of 95%`)
  }
  if (stats.max > tolerance.level * 2) {
    issues.push(`Maximum deviation (${stats.max.toFixed(1)}mm) exceeds 2x tolerance (${tolerance.level * 2}mm)`)
  }
  if (stats.mean > tolerance.level * 0.5) {
    issues.push(`Mean deviation (${stats.mean.toFixed(1)}mm) indicates systematic error`)
  }
  if (comparisons.length < 20) {
    issues.push(`Insufficient survey points (${comparisons.length}). Minimum recommended: 20`)
  }

  return {
    comparisons,
    summary: {
      totalPoints: comparisons.length,
      passCount,
      failCount,
      passRate: Math.round(passRate * 10) / 10,
      maxLevelDeviation: stats.max,
      maxHorizontalDeviation,
      meanLevelDeviation: Math.round(stats.mean * 10) / 10,
      standardDeviation: Math.round(stats.stdDev * 10) / 10,
      rmsError: Math.round(stats.rms * 10) / 10,
      isCompliant,
      certificationReady: isCompliant && comparisons.length >= 20,
      issues,
    },
    toleranceBand: tolerance,
  }
}

// ─── CERTIFICATE DATA ──────────────────────────────────────────────────────────

export interface AsBuiltCertificate {
  certificateNumber: string
  issueDate: string
  projectName: string
  roadName: string
  roadClass: string
  chainageStart: number
  chainageEnd: number
  surveyorName: string
  surveyorLicense: string
  result: AsBuiltSummary
}

export function generateAsBuiltCertificate(data: {
  projectName: string
  roadName: string
  roadClass: string
  chainageStart: number
  chainageEnd: number
  surveyorName: string
  surveyorLicense: string
  date: string
  result: AsBuiltSurveyResult
}): AsBuiltCertificate {
  return {
    certificateNumber: `ABC-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 999) + 1).padStart(3, '0')}`,
    issueDate: data.date,
    projectName: data.projectName,
    roadName: data.roadName,
    roadClass: data.roadClass,
    chainageStart: data.chainageStart,
    chainageEnd: data.chainageEnd,
    surveyorName: data.surveyorName,
    surveyorLicense: data.surveyorLicense,
    result: data.result.summary,
  }
}

// ─── CSV PARSING ───────────────────────────────────────────────────────────────

export function parseAsBuiltCSV(csv: string): AsBuiltPoint[] {
  const lines = csv.trim().split('\n')
  if (lines.length < 2) return []

  const points: AsBuiltPoint[] = []
  // Skip header row
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim())
    if (cols.length < 2) continue

    const chainage = parseFloat(cols[0])
    const level = parseFloat(cols[1])
    if (isNaN(chainage) || isNaN(level)) continue

    points.push({
      chainage,
      surveyedLevel: level,
      surveyedEasting: cols[2] ? parseFloat(cols[2]) : undefined,
      surveyedNorthing: cols[3] ? parseFloat(cols[3]) : undefined,
    })
  }

  return points
}
