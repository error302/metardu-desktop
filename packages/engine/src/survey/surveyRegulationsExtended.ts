/**
 * Survey Regulations 1994 — Additional Regulatory Encodings
 *
 * Implements the remaining regulations from the Survey Regulations 1994 PDF:
 *   - Reg 55(2): Approved instruments
 *   - Reg 69-75: Field note format requirements
 *   - Reg 89: Standard plotting scales
 *   - Reg 92(4): Area display format
 *   - Reg 97-98: Certificate and authentication
 *
 * Also includes the 4 elective survey types from the License Application
 * Guidelines (Sectional, Perimeter, Earth Observation, Setting Out).
 */

// ════════════════════════════════════════════════════════════════════════════
// REG 55(2): APPROVED INSTRUMENTS
// ════════════════════════════════════════════════════════════════════════════

export interface ApprovedInstrument {
  brand: string
  model: string
  type: 'theodolite' | 'total_station' | 'gnss_receiver' | 'level' | 'edm'
  minAccuracy: string  // e.g., "1\" angular, 2mm+2ppm distance"
  order: string[]  // which accuracy orders it's approved for
  notes: string
}

/**
 * Registry of instruments approved by the Director of Surveys per Reg 55(2).
 * The Director may refuse to authenticate any survey made with inappropriate
 * or defective measuring equipment (Reg 25(4)).
 */
export const APPROVED_INSTRUMENTS: ApprovedInstrument[] = [
  // Total Stations
  { brand: 'Leica', model: 'TS16', type: 'total_station', minAccuracy: '1" angular, 1mm+1.5ppm distance', order: ['First Order Class II', 'Second Order Class I', 'Second Order Class II', 'Third Order'], notes: 'Common in Kenyan consultancies' },
  { brand: 'Leica', model: 'TS06', type: 'total_station', minAccuracy: '2" angular, 2mm+2ppm distance', order: ['Second Order Class II', 'Third Order', 'Fourth Order'], notes: 'Entry-level, suitable for cadastral' },
  { brand: 'Leica', model: 'TCRA1201', type: 'total_station', minAccuracy: '1" angular, 1mm+1.5ppm distance', order: ['First Order Class I', 'First Order Class II', 'Second Order Class I'], notes: 'High-precision, monitoring grade' },
  { brand: 'Topcon', model: 'GTS-900', type: 'total_station', minAccuracy: '1" angular, 2mm+2ppm distance', order: ['First Order Class II', 'Second Order Class I'], notes: '' },
  { brand: 'Topcon', model: 'GTS-230', type: 'total_station', minAccuracy: '2" angular, 2mm+2ppm distance', order: ['Second Order Class II', 'Third Order'], notes: '' },
  { brand: 'Sokkia', model: 'CX-105', type: 'total_station', minAccuracy: '5" angular, 2mm+2ppm distance', order: ['Third Order', 'Fourth Order'], notes: 'Common in Kenya' },
  { brand: 'Sokkia', model: 'FX-105', type: 'total_station', minAccuracy: '5" angular, 2mm+2ppm distance', order: ['Third Order', 'Fourth Order'], notes: '' },
  { brand: 'South', model: 'NTS-362R', type: 'total_station', minAccuracy: '2" angular, 2mm+2ppm distance', order: ['Second Order Class II', 'Third Order'], notes: 'Budget option, widely used in Kenya' },

  // GNSS Receivers
  { brand: 'Leica', model: 'GS18T', type: 'gnss_receiver', minAccuracy: '8mm+0.5ppm (static)', order: ['First Order Class I', 'First Order Class II'], notes: 'RTK roving + tilt compensation' },
  { brand: 'Trimble', model: 'R10', type: 'gnss_receiver', minAccuracy: '8mm+0.5ppm (static)', order: ['First Order Class I', 'First Order Class II'], notes: '' },
  { brand: 'Topcon', model: 'HiPer HR', type: 'gnss_receiver', minAccuracy: '3mm+0.5ppm (static)', order: ['First Order Class I', 'First Order Class II'], notes: '' },
  { brand: 'South', model: 'Galaxy G6', type: 'gnss_receiver', minAccuracy: '10mm+1ppm (static)', order: ['Second Order Class I', 'Second Order Class II'], notes: 'Budget GNSS, common in Kenya' },

  // Levels
  { brand: 'Leica', model: 'DNA03', type: 'level', minAccuracy: '0.3mm/km (double run)', order: ['First Order', 'Second Order'], notes: 'Digital level' },
  { brand: 'Sokkia', model: 'SDL30', type: 'level', minAccuracy: '0.6mm/km', order: ['Second Order', 'Third Order'], notes: 'Digital level' },
  { brand: 'Topcon', model: 'DL-101', type: 'level', minAccuracy: '0.4mm/km', order: ['First Order', 'Second Order'], notes: 'Digital level' },
]

/**
 * Check if an instrument is approved for a given accuracy order.
 */
export function checkInstrumentApproval(
  brand: string,
  model: string,
  requiredOrder: string,
): { approved: boolean; instrument?: ApprovedInstrument; message: string } {
  const instrument = APPROVED_INSTRUMENTS.find(
    i => i.brand.toLowerCase() === brand.toLowerCase() &&
         i.model.toLowerCase() === model.toLowerCase()
  )

  if (!instrument) {
    return {
      approved: false,
      message: `Instrument ${brand} ${model} is not in the approved registry. The Director may refuse to authenticate the survey (Reg 25(4)). Register the instrument with the Survey Department or use an approved model.`,
    }
  }

  const approved = instrument.order.includes(requiredOrder)
  return {
    approved,
    instrument,
    message: approved
      ? `${brand} ${model} is approved for ${requiredOrder} surveys.`
      : `${brand} ${model} is approved but only for ${instrument.order.join(', ')} — NOT for ${requiredOrder}. Use a higher-precision instrument.`,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REG 69-75: FIELD NOTE FORMAT REQUIREMENTS
// ════════════════════════════════════════════════════════════════════════════

export interface FieldNoteCheck {
  regulation: string
  requirement: string
  status: 'pass' | 'fail' | 'warning'
  details: string
}

/**
 * Check field notes against Regulations 69-75.
 *
 * Reg 69: Field notes on special forms
 * Reg 70: Triangulation observations recorded in sequence
 * Reg 71: Traverse observations recorded in sequence (station, BS, FS, angle, dist)
 * Reg 72: Topographical features recorded
 * Reg 73: Method of entering field notes (no erasures — corrections by crossing out)
 * Reg 74: Erasures and corrections — no erasures permitted
 * Reg 75: Nomenclature — beacons identified by letters/numbers, pages numbered + indexed
 */
export function checkFieldNoteCompliance(input: {
  observations: Array<{ station: string; bs?: string; fs?: string; angle?: string; distance?: string; erased?: boolean; corrected?: boolean }>
  hasPageNumbers?: boolean
  hasIndex?: boolean
  beaconNomenclature?: boolean
  topographicFeatures?: boolean
}): FieldNoteCheck[] {
  const checks: FieldNoteCheck[] = []

  // Reg 71: Traverse observations in sequence
  const hasAllFields = input.observations.every(o => o.station && o.bs && o.fs && o.angle && o.distance)
  checks.push({
    regulation: 'Reg 71',
    requirement: 'All traverse observations and measurements shall be recorded in the field notes in the sequence in which they are made.',
    status: hasAllFields ? 'pass' : 'warning',
    details: hasAllFields
      ? 'All observations have station, BS, FS, angle, and distance fields.'
      : 'Some observations are missing required fields (station, BS, FS, angle, distance).',
  })

  // Reg 73/74: No erasures — corrections by crossing out only
  const hasErasures = input.observations.some(o => o.erased)
  checks.push({
    regulation: 'Reg 73/74',
    requirement: 'No erasures shall be made in field notes. Corrections shall be made by crossing out the original entry and writing the correction above it.',
    status: hasErasures ? 'fail' : 'pass',
    details: hasErasures
      ? 'Erasures detected in field notes. This is a regulatory violation — the Director may refuse authentication.'
      : 'No erasures detected. Corrections by crossing out are permitted.',
  })

  // Reg 75: Page numbering and index
  checks.push({
    regulation: 'Reg 75',
    requirement: 'The pages of field notes shall be numbered, and an index in alphabetical and numerical order of all beacons and marks shall be provided.',
    status: input.hasPageNumbers && input.hasIndex ? 'pass' : 'warning',
    details: input.hasPageNumbers && input.hasIndex
      ? 'Field notes are page-numbered with an index.'
      : `Missing: ${!input.hasPageNumbers ? 'page numbers' : ''} ${!input.hasIndex ? 'index' : ''}.`,
  })

  // Reg 75: Beacon nomenclature
  checks.push({
    regulation: 'Reg 75(1)',
    requirement: 'Beacons shall be identified by letters, names, or numerals in field notes.',
    status: input.beaconNomenclature ? 'pass' : 'warning',
    details: input.beaconNomenclature
      ? 'All beacons properly identified.'
      : 'Ensure all beacons have unique identifiers (letters/numbers).',
  })

  // Reg 72: Topographical features
  checks.push({
    regulation: 'Reg 72',
    requirement: 'Topographical features shall be recorded in the field notes.',
    status: input.topographicFeatures ? 'pass' : 'not_applicable' as any,
    details: input.topographicFeatures
      ? 'Topographic features recorded.'
      : 'Not applicable for this survey type.',
  })

  return checks
}

// ════════════════════════════════════════════════════════════════════════════
// REG 89: STANDARD PLOTTING SCALES
// ════════════════════════════════════════════════════════════════════════════

export interface StandardScale {
  scale: number  // denominator, e.g., 500 for 1:500
  label: string  // "1:500"
  maxAreaHa: number  // maximum area suitable for this scale
  useCase: string
}

/**
 * Standard plotting scales per Regulation 89.
 * The Director expects plans at one of these standard scales.
 */
export const STANDARD_SCALES: StandardScale[] = [
  { scale: 250, label: '1:250', maxAreaHa: 0.1, useCase: 'Small plots, building foundations' },
  { scale: 500, label: '1:500', maxAreaHa: 0.5, useCase: 'Residential plots, sectional properties' },
  { scale: 1000, label: '1:1000', maxAreaHa: 2, useCase: 'Commercial plots, small schemes' },
  { scale: 1250, label: '1:1250', maxAreaHa: 4, useCase: 'Cadastral surveys, standard deed plans' },
  { scale: 2500, label: '1:2500', maxAreaHa: 20, useCase: 'Large schemes, farm surveys' },
  { scale: 5000, label: '1:5000', maxAreaHa: 100, useCase: 'Perimeter surveys, large farms' },
]

/**
 * Auto-select the best standard scale for a given area.
 * Per Reg 89, plans must be at one of the standard scales.
 */
export function selectStandardScale(areaHa: number): StandardScale {
  for (const s of STANDARD_SCALES) {
    if (areaHa <= s.maxAreaHa) return s
  }
  return STANDARD_SCALES[STANDARD_SCALES.length - 1]  // 1:5000 for very large areas
}

// ════════════════════════════════════════════════════════════════════════════
// REG 92(4): AREA DISPLAY FORMAT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Determine the required decimal places for area display per Regulation 84/92(4).
 *
 * From Reg 84:
 *   < 0.4 ha → 4 decimal places (e.g., 0.1234 ha)
 *   0.4 – 4 ha → 3 decimal places
 *   4 – 40 ha → 2 decimal places
 *   40 – 400 ha → 1 decimal place
 *   ≥ 400 ha → 0 decimal places
 */
export function getAreaPrecision(areaHa: number): { decimals: number; formatted: string } {
  let decimals: number
  if (areaHa < 0.4) decimals = 4
  else if (areaHa < 4) decimals = 3
  else if (areaHa < 40) decimals = 2
  else if (areaHa < 400) decimals = 1
  else decimals = 0

  return {
    decimals,
    formatted: areaHa.toFixed(decimals),
  }
}

/**
 * Format an area for display on a deed plan per Reg 92(4).
 * Shows the total area + each subdivision separately.
 */
export function formatAreaForPlan(totalAreaHa: number, subdivisions: Array<{ name: string; areaHa: number }>): string {
  const total = getAreaPrecision(totalAreaHa)
  const lines: string[] = [`Total: ${total.formatted} ha`]
  for (const sub of subdivisions) {
    const subFmt = getAreaPrecision(sub.areaHa)
    lines.push(`  ${sub.name}: ${subFmt.formatted} ha`)
  }
  return lines.join('\n')
}

// ════════════════════════════════════════════════════════════════════════════
// REG 97-98: CERTIFICATE AND AUTHENTICATION
// ════════════════════════════════════════════════════════════════════════════

export interface SurveyorCertificate {
  surveyorName: string
  surveyorLicense: string
  surveyDate: string
  surveyType: string
  locality: string
  areaHa: number
  scale: string
}

/**
 * Generate the certificate text for a survey plan per Regulation 97.
 *
 * Reg 97(1): "The certificate on every plan form shall be signed and dated
 * by the surveyor who has made the survey."
 *
 * Reg 98: "Authentication by the Director" — the Director signs to authenticate.
 */
export function generateSurveyorCertificate(cert: SurveyorCertificate): string {
  const areaFmt = getAreaPrecision(cert.areaHa)
  return `CERTIFICATE OF SURVEY

I, ${cert.surveyorName}, being a licensed land surveyor holding License No. ${cert.surveyorLicense},
do hereby certify that the survey of the ${cert.surveyType} shown on this plan
was carried out by me (or under my direct supervision) on ${cert.surveyDate}
at ${cert.locality}, and that the survey was conducted in accordance with the
Survey Act (Cap. 299) and the Survey Regulations 1994.

The area of the parcel shown on this plan is ${areaFmt.formatted} hectares.
The plan is drawn at a scale of ${cert.scale}.

All measurements are in international metres and decimals of a metre.
All angular measurements are in degrees, minutes and seconds of arc.
The co-ordinate system used is the Universal Transverse Mercator Projection,
Clarke 1880 (modified) figure, Arc 1960 datum.

Signed: ___________________________
Name: ${cert.surveyorName}
License No: ${cert.surveyorLicense}
Date: ${new Date().toISOString().split('T')[0]}

───────────────────────────────────────────────────────────
FOR OFFICIAL USE ONLY — DIRECTOR OF SURVEYS

Authenticated: ___________________________
Date: _________________
Reference No: _________________`
}

// ════════════════════════════════════════════════════════════════════════════
// LICENSE ELECTIVE SURVEY TYPES
// ════════════════════════════════════════════════════════════════════════════

export interface ElectiveSurveyType {
  id: string
  name: string
  category: string
  minimumRequirement: string
  description: string
  deliverables: string[]
  regulations: string[]
}

/**
 * The 4 elective survey types from the License Application Guidelines.
 * A candidate must complete at least one.
 */
export const ELECTIVE_SURVEY_TYPES: ElectiveSurveyType[] = [
  {
    id: 'sectional',
    name: 'Sectional Property Survey',
    category: 'Elective 4a',
    minimumRequirement: '≥ 30 units',
    description: 'Survey of a sectional property development with at least 30 units. Each unit must be separately surveyed and numbered per the Sectional Properties Act.',
    deliverables: [
      'Sectional plan showing all units with exclusive-use areas',
      'Common property boundaries',
      'Unit schedule (unit number, area, exclusive-use area)',
      'Beacon certificate for each unit corner',
      'Coordinate list for all unit boundaries',
    ],
    regulations: [
      'Sectional Properties Act, 2020',
      'Survey Regulations 1994, Reg 92 (coordinates on plan)',
      'Survey Regulations 1994, Reg 97 (certificate)',
    ],
  },
  {
    id: 'perimeter',
    name: 'Perimeter (Farm) Survey',
    category: 'Elective 4b',
    minimumRequirement: '≥ 4 ha (production) / ≥ 5 ha (supervised), georeferenced',
    description: 'Establishment of new perimeter survey beacons for a new parcel of land. Must be georeferenced to the existing datum (Arc 1960 / UTM).',
    deliverables: [
      'Perimeter plan at standard scale (1:2500 or 1:5000)',
      'Beacon certificate for each perimeter beacon',
      'Coordinate list (Arc 1960 / UTM)',
      'Area computation per Reg 84',
      'Surveyor certificate per Reg 97',
      'Connection to existing control per Reg 66',
    ],
    regulations: [
      'Survey Regulations 1994, Reg 37 (survey marks design)',
      'Survey Regulations 1994, Reg 39 (beacon referencing)',
      'Survey Regulations 1994, Reg 60 (traverse accuracy)',
      'Survey Regulations 1994, Reg 89 (standard scales)',
    ],
  },
  {
    id: 'earth_observation',
    name: 'Earth Observation & Remote Sensing',
    category: 'Elective 4c',
    minimumRequirement: '≥ 20 ha coverage',
    description: 'Earth observation data collection and processing using satellite remote sensing, aerial photography, UAV, LiDAR, or GIS. Minimum 20 ha area covered.',
    deliverables: [
      'Orthorectified imagery / point cloud',
      'Digital terrain model (DTM)',
      'Contour map at appropriate interval',
      'Feature extraction (buildings, roads, drainage)',
      'Georeferencing report (datum, projection, accuracy)',
      'Quality assessment report',
    ],
    regulations: [
      'Survey Regulations 1994, Reg 24 (coordinate systems)',
      'Survey Regulations 1994, Reg 68 (air survey)',
    ],
  },
  {
    id: 'setting_out',
    name: 'Setting Out Works',
    category: 'Elective 4d',
    minimumRequirement: '≥ 1km linear infrastructure OR ≥ 0.1 ha buildings',
    description: 'Setting out of engineering works — either linear infrastructure (roads, pipelines, railways) ≥1km, or buildings ≥0.1 ha. Includes as-built verification.',
    deliverables: [
      'Setting out schedule (design coordinates, bearings, distances)',
      'Stakeout list exported to instrument format',
      'As-built comparison report (design vs as-built, per-point offsets)',
      'Tolerance check per RDM 1.1 Table 5.2 (±25mm H, ±15mm V)',
      'Coordinate list for all set-out points',
      'Instrument calibration certificate',
    ],
    regulations: [
      'RDM 1.1 Table 5.2 (construction tolerances)',
      'Survey Regulations 1994, Reg 60 (traverse accuracy)',
      'Survey Regulations 1994, Reg 66 (verify datum)',
    ],
  },
]

/**
 * Get the elective survey type by ID.
 */
export function getElectiveSurveyType(id: string): ElectiveSurveyType | undefined {
  return ELECTIVE_SURVEY_TYPES.find(e => e.id === id)
}

/**
 * Check if a project meets the minimum requirements for an elective.
 */
export function checkElectiveRequirement(
  electiveId: string,
  projectData: { areaHa?: number; unitCount?: number; linearLengthKm?: number },
): { met: boolean; details: string } {
  switch (electiveId) {
    case 'sectional':
      const units = projectData.unitCount || 0
      return {
        met: units >= 30,
        details: `${units} units (required ≥ 30)`,
      }
    case 'perimeter':
      const area = projectData.areaHa || 0
      return {
        met: area >= 4,
        details: `${area.toFixed(2)} ha (required ≥ 4 ha, georeferenced)`,
      }
    case 'earth_observation':
      const eoArea = projectData.areaHa || 0
      return {
        met: eoArea >= 20,
        details: `${eoArea.toFixed(2)} ha (required ≥ 20 ha)`,
      }
    case 'setting_out':
      const linear = projectData.linearLengthKm || 0
      const bldgArea = projectData.areaHa || 0
      const met = linear >= 1 || bldgArea >= 0.1
      return {
        met,
        details: met
          ? `${linear >= 1 ? `${linear.toFixed(2)} km linear` : `${bldgArea.toFixed(2)} ha buildings`}`
          : `${linear.toFixed(2)} km linear / ${bldgArea.toFixed(2)} ha (required ≥ 1km OR ≥ 0.1 ha)`,
      }
    default:
      return { met: false, details: 'Unknown elective type' }
  }
}
