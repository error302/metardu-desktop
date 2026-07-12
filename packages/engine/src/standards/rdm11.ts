/**
 * RDM 1.1 (Kenya Roads Design Manual) — Centralized Standards
 *
 * AUDIT FIX (M8, 2026-07-02): Previously this file was a stub with only
 * 3 small tables. The RDM 1.1 references were scattered across multiple
 * files (traverseEngine, settingOutEngine, clothoidTransition, auditTrail,
 * leveling, asBuiltSurvey). This file now centralizes all RDM 1.1 tables
 * and provides a conformance checker.
 *
 * Sources:
 *   - Kenya Roads Design Manual Part 1 (RDM 1.1), 2025 edition
 *   - Survey Act Cap 299, Laws of Kenya
 *   - Survey Regulations 1994
 *   - Kenya Roads Board Act
 */

// ─── Table 5.1: Control Survey Accuracy Standards ──────────────────────────

export interface TraverseAccuracyStandard {
  order: string
  ratio: string  // e.g., "1:100,000"
  ratioNumeric: number  // e.g., 100000
  application: string
  angularClosurePerStation: string  // e.g., "≤ 1.0″"
  angularClosurePerStationSec: number
}

export const RDM_TRAVERSE_ACCURACY: TraverseAccuracyStandard[] = [
  {
    order: 'First Order Class I',
    ratio: '1:100,000',
    ratioNumeric: 100000,
    application: 'Primary geodetic control, national framework',
    angularClosurePerStation: '≤ 1.0″',
    angularClosurePerStationSec: 1.0,
  },
  {
    order: 'First Order Class II',
    ratio: '1:50,000',
    ratioNumeric: 50000,
    application: 'Secondary geodetic control, deformation monitoring',
    angularClosurePerStation: '≤ 1.5″',
    angularClosurePerStationSec: 1.5,
  },
  {
    order: 'Second Order Class I',
    ratio: '1:20,000',
    ratioNumeric: 20000,
    application: 'Tertiary control, major engineering projects',
    angularClosurePerStation: '≤ 2.0″',
    angularClosurePerStationSec: 2.0,
  },
  {
    order: 'Second Order Class II',
    ratio: '1:10,000',
    ratioNumeric: 10000,
    application: 'Cadastral control (minimum for title surveys)',
    angularClosurePerStation: '≤ 3.0″',
    angularClosurePerStationSec: 3.0,
  },
  {
    order: 'Third Order',
    ratio: '1:5,000',
    ratioNumeric: 5000,
    application: 'Engineering setting out, topographic control',
    angularClosurePerStation: '≤ 5.0″',
    angularClosurePerStationSec: 5.0,
  },
  {
    order: 'Fourth Order',
    ratio: '1:1,000',
    ratioNumeric: 1000,
    application: 'Low-order topographic, sketch surveys',
    angularClosurePerStation: '≤ 10.0″',
    angularClosurePerStationSec: 10.0,
  },
]

// ─── Table 5.1: Levelling Accuracy Standards ───────────────────────────────

export interface LevelingAccuracyStandard {
  order: string
  closureFormula: string  // e.g., "4√K mm"
  coefficient: number  // e.g., 4
  application: string
}

export const RDM_LEVELING_ACCURACY: LevelingAccuracyStandard[] = [
  { order: 'First Order', closureFormula: '4√K mm', coefficient: 4, application: 'Primary height control, deformation monitoring' },
  { order: 'Second Order', closureFormula: '8√K mm', coefficient: 8, application: 'Secondary height control, major engineering' },
  { order: 'Third Order', closureFormula: '10√K mm', coefficient: 10, application: 'Tertiary height control, cadastral (RDM 1.1 minimum)' },
  { order: 'Fourth Order', closureFormula: '12√K mm', coefficient: 12, application: 'Engineering setting out, topographic' },
  { order: 'Fifth Order', closureFormula: '20√K mm', coefficient: 20, application: 'Low-order topographic, sketch levelling' },
]

// ─── Table 5.2: Detail Pickup Tolerances ───────────────────────────────────

export interface DetailTolerance {
  feature: string
  xy: string
  z: string
  fieldUse: string
}

export const RDM_DETAIL_TOLERANCES: DetailTolerance[] = [
  {
    feature: 'Structures, buildings, paved roads',
    xy: '+/-0.025 m',
    z: '+/-0.015 m',
    fieldUse: 'Building corners, kerbs, paved carriageway edges, drainage structures',
  },
  {
    feature: 'Gravel pavements',
    xy: '+/-0.050 m',
    z: '+/-0.025 m',
    fieldUse: 'Gravel shoulders, unpaved access roads, compacted formation surfaces',
  },
  {
    feature: 'All other areas',
    xy: '+/-0.100 m',
    z: '+/-0.050 m',
    fieldUse: 'Open ground, vegetation breaks, general topographic spot levels',
  },
]

// ─── Table 5.4: Survey Report Required Sections ────────────────────────────

export const RDM_REPORT_SECTIONS = [
  'Title Page',
  'Summary of Survey',
  'Project Description',
  'Scope of Work',
  'Methodology',
  'Control Survey',
  'Field Procedures',
  'Computations and Adjustments',
  'Results and Analysis',
  'Quality Control',
  'Equipment Used',
  'Personnel',
  'Problems Encountered',
  'Conclusions and Recommendations',
  'Appendices (Field Notes, Computation Sheets, Plans)',
] as const

// ─── Mobilisation Sections ─────────────────────────────────────────────────

export const MOBILISATION_SECTIONS = [
  'Introduction',
  'Health and safety considerations',
  'Personnel',
  'Equipment',
  'Calibration',
  'Field forms',
  'Miscellaneous',
]

// ─── Control Mark Register Columns ─────────────────────────────────────────

export const CONTROL_MARK_REGISTER_COLUMNS = [
  'Mark ID',
  'Type',
  'Order',
  'Easting (m)',
  'Northing (m)',
  'Elevation (m)',
  'Description',
  'Condition',
  'Photo / Sketch Ref',
  'Witness / Recovery Notes',
]

// ─── Maximum Courses Without Azimuth Check ─────────────────────────────────

export const RDM_MAX_COURSES_WITHOUT_CHECK = 15

// ─── Minimum Tangent Length Between Curves ─────────────────────────────────

export const RDM_MIN_TANGENT_BETWEEN_CURVES = 30 // metres

// ─── Conformance Checker ───────────────────────────────────────────────────

export interface RDMConformanceResult {
  passed: boolean
  checks: RDMConformanceCheck[]
  overallGrade: string | null
}

export interface RDMConformanceCheck {
  rule: string
  table: string  // e.g., "Table 5.1"
  value: string
  limit: string
  passed: boolean
  message: string
}

/**
 * Check traverse precision against RDM 1.1 Table 5.1.
 *
 * @param linearError  Linear misclosure (metres)
 * @param totalDistance  Total traverse perimeter (metres)
 * @param angularErrorSec  Angular misclosure per station (arc-seconds)
 * @param numStations  Number of traverse stations
 * @param requiredOrder  Minimum required order (e.g., "Second Order Class II" for cadastral)
 */
export function checkTraverseConformance(
  linearError: number,
  totalDistance: number,
  angularErrorSec: number,
  numStations: number,
  requiredOrder?: string
): RDMConformanceResult {
  const checks: RDMConformanceCheck[] = []

  // Compute precision ratio
  const ratio = totalDistance / Math.max(linearError, 1e-12)

  // Find the achieved order
  let achievedOrder: string | null = null
  for (const std of RDM_TRAVERSE_ACCURACY) {
    if (ratio >= std.ratioNumeric) {
      achievedOrder = std.order
      break
    }
  }

  // Check linear precision
  for (const std of RDM_TRAVERSE_ACCURACY) {
    if (ratio >= std.ratioNumeric) {
      checks.push({
        rule: 'Linear precision ratio',
        table: 'Table 5.1',
        value: `1:${Math.round(ratio).toLocaleString()}`,
        limit: `≥ ${std.ratio}`,
        passed: true,
        message: `Achieved ${std.order} (${std.ratio})`,
      })
      break
    }
  }
  if (checks.length === 0) {
    checks.push({
      rule: 'Linear precision ratio',
      table: 'Table 5.1',
      value: `1:${Math.round(ratio).toLocaleString()}`,
      limit: '≥ 1:1,000',
      passed: false,
      message: `Below Fourth Order minimum (1:1,000)`,
    })
  }

  // Check angular closure
  const angularStd = RDM_TRAVERSE_ACCURACY.find(s => angularErrorSec <= s.angularClosurePerStationSec)
  checks.push({
    rule: 'Angular closure per station',
    table: 'Table 5.1',
    value: `${angularErrorSec.toFixed(2)}″/station`,
    limit: angularStd ? `≤ ${angularStd.angularClosurePerStation}` : `≤ 10.0″`,
    passed: angularErrorSec <= 10.0,
    message: angularStd ? `Achieved ${angularStd.order}` : 'Exceeds Fourth Order limit',
  })

  // Check courses without azimuth check
  checks.push({
    rule: 'Courses without azimuth check',
    table: 'Table 5.1',
    value: `${numStations} courses`,
    limit: `≤ ${RDM_MAX_COURSES_WITHOUT_CHECK}`,
    passed: numStations <= RDM_MAX_COURSES_WITHOUT_CHECK,
    message: numStations > RDM_MAX_COURSES_WITHOUT_CHECK
      ? `Exceeds ${RDM_MAX_COURSES_WITHOUT_CHECK} courses — intermediate azimuth check required`
      : 'Within limit',
  })

  // Check required order if specified
  if (requiredOrder) {
    const requiredStd = RDM_TRAVERSE_ACCURACY.find(s => s.order === requiredOrder)
    if (requiredStd) {
      const meetsRequired = ratio >= requiredStd.ratioNumeric
      checks.push({
        rule: `Required order: ${requiredOrder}`,
        table: 'Table 5.1',
        value: achievedOrder ?? 'Below minimum',
        limit: `≥ ${requiredOrder} (${requiredStd.ratio})`,
        passed: meetsRequired,
        message: meetsRequired ? 'Meets required order' : `Does not meet ${requiredOrder}`,
      })
    }
  }

  const allPassed = checks.every(c => c.passed)
  return { passed: allPassed, checks, overallGrade: achievedOrder }
}

/**
 * Check levelling closure against RDM 1.1 Table 5.1.
 *
 * @param misclosure  Levelling misclosure (mm)
 * @param distance  Total levelling distance (km)
 * @param requiredOrder  Minimum required order (e.g., "Third Order")
 */
export function checkLevelingConformance(
  misclosure: number,
  distance: number,
  requiredOrder?: string
): RDMConformanceResult {
  const checks: RDMConformanceCheck[] = []

  // Compute allowable closure for each order
  let achievedOrder: string | null = null
  for (const std of RDM_LEVELING_ACCURACY) {
    const allowable = std.coefficient * Math.sqrt(Math.max(distance, 0.001))
    if (Math.abs(misclosure) <= allowable) {
      achievedOrder = std.order
      checks.push({
        rule: 'Levelling closure',
        table: 'Table 5.1',
        value: `${misclosure.toFixed(2)} mm over ${distance.toFixed(3)} km`,
        limit: `≤ ${std.closureFormula} = ${allowable.toFixed(2)} mm`,
        passed: true,
        message: `Achieved ${std.order}`,
      })
      break
    }
  }

  if (checks.length === 0) {
    const worstStd = RDM_LEVELING_ACCURACY[RDM_LEVELING_ACCURACY.length - 1]
    const allowable = worstStd.coefficient * Math.sqrt(Math.max(distance, 0.001))
    checks.push({
      rule: 'Levelling closure',
      table: 'Table 5.1',
      value: `${misclosure.toFixed(2)} mm over ${distance.toFixed(3)} km`,
      limit: `≤ ${worstStd.closureFormula} = ${allowable.toFixed(2)} mm`,
      passed: false,
      message: `Exceeds ${worstStd.order} limit`,
    })
  }

  if (requiredOrder) {
    const requiredStd = RDM_LEVELING_ACCURACY.find(s => s.order === requiredOrder)
    if (requiredStd) {
      const allowable = requiredStd.coefficient * Math.sqrt(Math.max(distance, 0.001))
      const meetsRequired = Math.abs(misclosure) <= allowable
      checks.push({
        rule: `Required order: ${requiredOrder}`,
        table: 'Table 5.1',
        value: achievedOrder ?? 'Below minimum',
        limit: `≤ ${requiredStd.closureFormula} = ${allowable.toFixed(2)} mm`,
        passed: meetsRequired,
        message: meetsRequired ? 'Meets required order' : `Does not meet ${requiredOrder}`,
      })
    }
  }

  const allPassed = checks.every(c => c.passed)
  return { passed: allPassed, checks, overallGrade: achievedOrder }
}

// ─── Re-exports for backward compatibility ─────────────────────────────────
// (Code that imported the old stub exports still works — the exports
// above are already `export const`, so no re-export needed.)
