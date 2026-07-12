/**
 * Country Survey Standards Registry
 * Maps countries to their national survey regulations.
 * Each entry contains: datum, UTM zones, traverse orders, area rules,
 * slope correction rules, beacon standards, and regulation citations.
 *
 * Data sourced from:
 * - Kenya: Survey Regulations (Legal Notice 168 of 1994, Revised 2024)
 * - Bahrain: Cadastral Survey Standards Guidelines Manual (2nd Ed, 2024)
 * - KETRACO: Annex 6 Cadastral Survey for Transmission Lines
 * - NZ: LINZ Survey Regulations / Surveyor-General rules
 * - US: USACE EM 1110-1-1005 (Control and Topographic Surveying, 2007)
 * - US: ASPRS Accuracy Standards for Large Scale Maps (1989)
 * - US: ALTA/ACSM Minimum Standard Detail Requirements for Land Title Surveys
 * - US: FGDC Geospatial Positioning Accuracy Standard / NSSDA
 * - BIVA: SPC Topographic Survey Report (Kiribati, 2015)
 */

export type SurveyingCountry =
  | 'kenya' | 'uganda' | 'tanzania' | 'rwanda' | 'burundi' | 'south_sudan'
  | 'nigeria' | 'ghana' | 'south_africa' | 'zambia'
  | 'bahrain' | 'saudi_arabia' | 'oman' | 'uae'
  | 'new_zealand' | 'uk' | 'us' | 'australia' | 'india'
  | 'indonesia' | 'brazil' | 'other'

export interface TraverseOrderSpec {
  order: string
  minPrecision: number      // ratio e.g. 20000 = 1:20,000
  description: string
  regulation: string
}

export interface AreaPrecisionRule {
  maxHa: number
  decimalPlaces: number
  unit: 'ha' | 'm2' | 'acres'
  regulation: string
}

export interface CountrySurveyStandard {
  country: SurveyingCountry
  name: string
  isoCode: string
  currency: string
  datum: string
  ellipsoid: string
  utmZones: number[]
  utmHemisphere: 'N' | 'S' | 'both'
  traverseOrders: TraverseOrderSpec[]
  defaultTraverseOrder: string
  areaPrecision: AreaPrecisionRule[]
  slopeCorrection: {
    required: boolean
    maxSlopeSingleFace: number   // degrees — beyond this needs both faces
    tempCorrection: boolean       // steel tape temperature correction
    pressureCorrection: boolean   // EDM atmospheric correction
    sagCorrection: boolean       // tape sag correction
    regulation: string
  }
  curvilinearBoundary: {
    maxTacheometricDistance: number   // metres
    maxOffsetSmall: number             // metres (<10ha)
    maxOffsetLarge: number             // metres (≥10ha)
    regulation: string
  }
  beacon: {
    mustReferenceUnderground: boolean
    verifyWithKnownPoints: boolean
    verifyMethod?: 'traverse' | '3_distances' | 'polar'
    regulation: string
  }
  fieldNoteRules: {
    noErasures: boolean
    correctionsMethod: 'single_line' | 'overwrite' | 'any'
    regulation: string
  }
  surveyorReport: {
    required: boolean
    mustInclude: string[]
    counterSignRequired: boolean
    regulation: string
  }
  parcelMinArea?: {
    sqMetres: number
    regulation: string
  }
  curvilinearPlottingScale?: number
  coordinatePrecision?: number
  governmentLand?: {
    foreshoreReservationM: number
    tidalRiverReservationM: number
    lakeReservationM: number
    swampExclusionWidthM: number
    regulation: string
  }
  deedPlanRules?: {
    waterproofInk: boolean
    materialSpecifiedByDirector: boolean
    maxCorrections: number
    correctionsInitialedBy: 'director' | 'surveyor'
    duplicateCopies: number
    noErasures: boolean
    regulation: string
  }
  beaconMaterials?: {
    primary: string
    underground: string
    referenceMarkRequired: boolean
  }
  lineBeacon?: {
    maxSegmentLengthM: number
    regulation: string
  }
  generalNotes: string[]
}

const KENYA_STD: CountrySurveyStandard = {
  country: 'kenya',
  name: 'Kenya',
  isoCode: 'KE',
  currency: 'KES',
  datum: 'Arc 1960',
  ellipsoid: 'Clarke 1880 (modified)',
  utmZones: [36, 37],
  utmHemisphere: 'N',
  traverseOrders: [
    {
      order: '3rd_order_urban',
      minPrecision: 20_000,
      description: 'Built-up/urban areas — double-chained traverses',
      regulation: 'Kenya Survey Reg 60',
    },
    {
      order: '4th_order_other',
      minPrecision: 10_000,
      description: 'Non-built-up/rural areas',
      regulation: 'Kenya Survey Reg 60',
    },
    {
      order: 'loop_forbidden',
      minPrecision: 0,
      description: 'Loop traverses NOT permitted when two fixed stations are available',
      regulation: 'Kenya Survey Reg 60',
    },
  ],
  defaultTraverseOrder: '4th_order_other',
  areaPrecision: [
    { maxHa: 1,    decimalPlaces: 4, unit: 'ha',    regulation: 'Kenya Survey Reg 84' },
    { maxHa: 10,   decimalPlaces: 3, unit: 'ha',    regulation: 'Kenya Survey Reg 84' },
    { maxHa: 1000, decimalPlaces: 2, unit: 'ha',    regulation: 'Kenya Survey Reg 84' },
    { maxHa: Infinity, decimalPlaces: 1, unit: 'ha', regulation: 'Kenya Survey Reg 84' },
  ],
  slopeCorrection: {
    required: true,
    maxSlopeSingleFace: 10,
    tempCorrection: true,
    pressureCorrection: true,
    sagCorrection: true,
    regulation: 'Kenya Survey Reg 62 — reduce to horizontal; correct for temp & sag; >10° requires both faces',
  },
  curvilinearBoundary: {
    maxTacheometricDistance: 200,
    maxOffsetSmall: 50,
    maxOffsetLarge: 75,
    regulation: 'Kenya Survey Reg 63 — tacheometry ≤200m; offsets >75m (>10ha) or >50m (<10ha) set out instrumentally',
  },
  beacon: {
    mustReferenceUnderground: true,
    verifyWithKnownPoints: true,
    verifyMethod: 'traverse',
    regulation: 'Kenya Survey Reg 39-50 — all beacons must be referenced; missing beacons need explanatory report',
  },
  fieldNoteRules: {
    noErasures: true,
    correctionsMethod: 'single_line',
    regulation: 'Kenya Survey Reg 74 — NO erasures; corrections by single line strike-through, initialed',
  },
  surveyorReport: {
    required: true,
    mustInclude: [
      'Method of survey',
      'Control points used',
      'Traverse accuracy achieved',
      'Any difficulties or anomalies',
      'Boundary decisions and reasons',
    ],
    counterSignRequired: true,
    regulation: 'Kenya Survey Act — report required for all boundary surveys',
  },
  parcelMinArea: {
    sqMetres: 200,
    regulation: 'Kenya Survey Reg — deed plan parcels minimum ≥200 m²',
  },
  curvilinearPlottingScale: 5000,
  coordinatePrecision: 0.01,
  governmentLand: {
    foreshoreReservationM: 60,
    tidalRiverReservationM: 30,
    lakeReservationM: 30,
    swampExclusionWidthM: 150,
    regulation: 'Kenya Survey Reg 110-114 — coast ≥60m above MHWST; tidal rivers ≥30m; lakes ≥30m; swamps ≥150m excluded with straight-line boundary',
  },
  deedPlanRules: {
    waterproofInk: true,
    materialSpecifiedByDirector: true,
    maxCorrections: 3,
    correctionsInitialedBy: 'director',
    duplicateCopies: 2,
    noErasures: true,
    regulation: 'Kenya Survey Reg 99-109 — waterproof ink; ≤3 corrections initialed by Director; duplicate copies; Director authentication required',
  },
  beaconMaterials: {
    primary: 'Angle-iron set in concrete with stone cairn or earth mound',
    underground: 'Iron pin set in concrete',
    referenceMarkRequired: true,
  },
  lineBeacon: {
    maxSegmentLengthM: 30,
    regulation: 'Kenya Survey Reg 40, 64 — ≤30m straight segments at road/railway reserves; river beacons above flood level',
  },
  generalNotes: [
    'Cassini-Soldner for 1°-wide local grids: Clarke 1858 (a=6,378,351m, 1/f=294.26)',
    'UTM Zone 36: CM 33°E, Zone 37: CM 39°E',
    'Clarke 1880 modified for UTM: a=6,378,249m, 1/f=293.465',
  ],
}

const BAHRAIN_STD: CountrySurveyStandard = {
  country: 'bahrain',
  name: 'Bahrain',
  isoCode: 'BH',
  currency: 'BHD',
  datum: 'Ain Al-Abd 1970',
  ellipsoid: 'Clarke 1880 (International 1924)',
  utmZones: [39],
  utmHemisphere: 'N',
  traverseOrders: [
    {
      order: 'geodetic',
      minPrecision: 50_000,
      description: 'Geodetic control — 1:50,000 closure, 0.01m absolute, CM Scale Factor 0.9996',
      regulation: 'Bahrain CSD Cadastral Survey Standards Guidelines Manual 2nd Ed 2024 §F',
    },
    {
      order: 'cadastral_control',
      minPrecision: 20_000,
      description: 'Cadastral control — min(0.0015/Lm, 1:20,000) closure, 0.02m point accuracy',
      regulation: 'Bahrain CSD 2nd Ed 2024 §F — Traverse closure: smaller of 0.0015/Lm or 1:20,000',
    },
    {
      order: 'detail_survey',
      minPrecision: 5_000,
      description: 'Detail and topographic surveys — 0.15% relative accuracy, 0.3m absolute RMSE',
      regulation: 'Bahrain CSD 2nd Ed 2024 §F',
    },
  ],
  defaultTraverseOrder: 'cadastral_control',
  areaPrecision: [
    { maxHa: Infinity, decimalPlaces: 4, unit: 'm2', regulation: 'Bahrain CSD — coordinate precision to 0.0001m' },
  ],
  slopeCorrection: {
    required: true,
    maxSlopeSingleFace: 10,
    tempCorrection: true,
    pressureCorrection: true,
    sagCorrection: false,
    regulation: 'Bahrain CSD 2nd Ed 2024 — raw observables required; EDM ppm correction mandatory; no manual ppm entry',
  },
  curvilinearBoundary: {
    maxTacheometricDistance: 200,
    maxOffsetSmall: 50,
    maxOffsetLarge: 50,
    regulation: 'Bahrain CSD 2nd Ed 2024 — arc-to-chord <0.2m (developed) / <0.3m (undeveloped)',
  },
  beacon: {
    mustReferenceUnderground: false,
    verifyWithKnownPoints: true,
    verifyMethod: '3_distances',
    regulation: 'Bahrain CSD 2nd Ed 2024 §3.11 — beacon verified by 3 taped distances from known coordinated points',
  },
  fieldNoteRules: {
    noErasures: true,
    correctionsMethod: 'single_line',
    regulation: 'Bahrain CSD 2nd Ed 2024 — erasures prohibited; corrections crossed through with correct value written above',
  },
  surveyorReport: {
    required: true,
    mustInclude: [
      'Nature of parcel (rural/urban, open/built-up)',
      'Verbal boundary description',
      'Fixed points / hard detail used',
      'Method of location and survey',
      'Accuracies and residuals',
      'Field checks applied and results',
      'Computed area and method',
      'Difficulties encountered',
      'Discrepancies (encroachments, shortfalls, service clashes)',
      'Certificate of compliance',
      'Raw observables recorded (not instrument-reduced values)',
      'Private Sector Office level (1/2/3) and authorising surveyor',
    ],
    counterSignRequired: true,
    regulation: 'Bahrain CSD Appendix 6 / CSD Guidelines Manual 2nd Ed 2024',
  },
  parcelMinArea: {
    sqMetres: 10,
    regulation: 'Bahrain CSD — parcels <10m² may not be registerable; deed plan parcels typically ≥200m²',
  },
  generalNotes: [
    'UTM Zone 39 North, CM Scale Factor 0.9996, origin: 0°N 51°E, False Northing 0m, False Easting 500000m',
    'PRN: 8 GNSS reference stations covering all Bahrain (Diyar Al Muharraq, King Fahd Causeway, Scout Camp, Durrat, Jauu, Budaiya, Hawar, Umm Al Hassam)',
    'RTK GPS: Max 3D Quality ≤0.05m; coordinate std dev ≤20mm; min 6 satellites, PDOP <6',
    'Traverse field rounds: T2 <30" angular, T16 <1 min angular; spread <10" (T2) / <40" (T16)',
    'EDM repeatability: <0.02m to hard detail or survey mark',
    'Tape repeatability: <100m <0.01m; 100-200m <0.02m',
    'Coordinate residuals: <5cm acceptable; >10cm requires re-observation and supervisor endorsement',
    'Setting-out: max distance 200m without specific authority; stakes ≤20m (straight), ≤10m (curves)',
    'Parcel numbering: DD-SS-nnnn (District-Subdistrict-Serial)',
    'Topo RMSE: 0.3m absolute; hard detail relative accuracy 0.15%',
    'Parcel boundary marks: 0.05m; dimensions on title 0.1m; dimensions on LC/CoS 0.01m',
    'Leica GPS 1200 system — coordinate system: Bahrain CSCS v1',
    'CIM accuracy: 95% parcel corners within 1m (urban) / 5m (rural)',
    'Line Points: must be verified by observation to BOTH terminal control points',
    'Level 1/2/3 private sector cadastral office accreditation required (Bahrain CSD 2nd Ed 2024 §2)',
  ],
}

const KETRACO_STD: CountrySurveyStandard = {
  country: 'kenya',
  name: 'Kenya (KETRACO Transmission Lines)',
  isoCode: 'KE',
  currency: 'KES',
  datum: 'Arc 1960',
  ellipsoid: 'Clarke 1880',
  utmZones: [36, 37],
  utmHemisphere: 'N',
  traverseOrders: [
    {
      order: 'transmission_control',
      minPrecision: 10_000,
      description: 'Cadastral control for transmission line corridor surveys',
      regulation: 'KETRACO Annex 6 — minimum 1:10,000 control precision',
    },
  ],
  defaultTraverseOrder: 'transmission_control',
  areaPrecision: KENYA_STD.areaPrecision,
  slopeCorrection: KENYA_STD.slopeCorrection,
  curvilinearBoundary: {
    maxTacheometricDistance: 200,
    maxOffsetSmall: 50,
    maxOffsetLarge: 75,
    regulation: 'KETRACO Annex 6',
  },
  beacon: {
    mustReferenceUnderground: true,
    verifyWithKnownPoints: true,
    verifyMethod: 'traverse',
    regulation: 'KETRACO Annex 6 — beacon referencing required',
  },
  fieldNoteRules: KENYA_STD.fieldNoteRules,
  surveyorReport: {
    required: true,
    mustInclude: [
      'Control survey precision achieved',
      'Aerial mapping specifications (GSD, corridor width)',
      'Deliverables: AutoCAD DXF + ESRI GIS formats',
      'PAP (Project Affected Persons) database in Excel',
      'Cadastral maps for all parcels in corridor',
      'Land Information Schedule',
    ],
    counterSignRequired: true,
    regulation: 'KETRACO Annex 6 — deliverable requirements',
  },
  generalNotes: [
    'Aerial mapping: 30cm GSD, 2km corridor width',
    'Lidar: ≥2cm precision',
    'Topographic maps: Scale 1:2500, contour interval 2.0m',
    'Cadastral maps for all parcels in TL corridor required',
  ],
}

const NZ_STD: CountrySurveyStandard = {
  country: 'new_zealand',
  name: 'New Zealand',
  isoCode: 'NZ',
  currency: 'NZD',
  datum: 'NZGD2000',
  ellipsoid: 'GRS80',
  utmZones: [58, 59, 60, 61],
  utmHemisphere: 'S',
  traverseOrders: [
    {
      order: '1st_order',
      minPrecision: 100_000,
      description: 'Geodetic surveys',
      regulation: 'LINZ Survey Regulations',
    },
    {
      order: '2nd_order',
      minPrecision: 50_000,
      description: 'Primary control',
      regulation: 'LINZ Survey Regulations',
    },
    {
      order: 'cadastral',
      minPrecision: 10_000,
      description: 'Cadastral surveys',
      regulation: 'LINZ Rule 8.2',
    },
  ],
  defaultTraverseOrder: 'cadastral',
  areaPrecision: [
    { maxHa: Infinity, decimalPlaces: 4, unit: 'm2', regulation: 'LINZ Survey Regulations — coordinate precision 0.0001m' },
  ],
  slopeCorrection: {
    required: true,
    maxSlopeSingleFace: 10,
    tempCorrection: true,
    pressureCorrection: true,
    sagCorrection: true,
    regulation: 'LINZ Survey Regulations — slope reduction required',
  },
  curvilinearBoundary: {
    maxTacheometricDistance: 200,
    maxOffsetSmall: 50,
    maxOffsetLarge: 50,
    regulation: 'LINZ Survey Regulations — curvilinear boundaries by chords',
  },
  beacon: {
    mustReferenceUnderground: false,
    verifyWithKnownPoints: true,
    verifyMethod: 'traverse',
    regulation: 'LINZ Survey Regulations',
  },
  fieldNoteRules: {
    noErasures: true,
    correctionsMethod: 'single_line',
    regulation: 'LINZ Survey Regulations — field notes must not contain erasures',
  },
  surveyorReport: {
    required: true,
    mustInclude: [
      'What was done — description of survey methods',
      'How it was done — technical procedures',
      'Why decisions were made — reasoning for every boundary decision',
      'What information was considered — sources of authority',
      '"All boundaries defined by survey" alone is INSUFFICIENT',
    ],
    counterSignRequired: false,
    regulation: 'LINZ Rule 8.2(a)(ix) — Surveyor Report mandatory; must explain WHY for every boundary decision',
  },
  parcelMinArea: {
    sqMetres: 1,
    regulation: 'LINZ — minimum parcel size per district plan',
  },
  generalNotes: [
    'Pre-validation required per LINZS70000 lodgement standard',
    'Templates exist: Word/PDF and automated versions available from LINZ',
    'LINZS70000 lodgement standard governs digital submission format',
  ],
}

const RWANDA_STD: CountrySurveyStandard = {
  country: 'rwanda',
  name: 'Rwanda',
  isoCode: 'RW',
  currency: 'RWF',
  datum: 'WGS84 / Arc 1960',
  ellipsoid: 'GRS80 / Clarke 1880',
  utmZones: [35, 36],
  utmHemisphere: 'S',
  traverseOrders: [
    {
      order: 'geodetic',
      minPrecision: 50_000,
      description: 'Geodetic control — EAC harmonized standard',
      regulation: 'EAC Survey Harmonization Framework / RNRA (Rwanda Natural Resources Authority)',
    },
    {
      order: 'cadastral',
      minPrecision: 10_000,
      description: 'Cadastral surveys — EAC standard (aligned with Kenya Reg 60)',
      regulation: 'EAC Survey Harmonization / Rwanda Land Law No. 27/2012',
    },
  ],
  defaultTraverseOrder: 'cadastral',
  areaPrecision: [
    { maxHa: 1,    decimalPlaces: 4, unit: 'ha',  regulation: 'EAC harmonized — ≤1ha: 4dp' },
    { maxHa: 10,   decimalPlaces: 3, unit: 'ha',  regulation: 'EAC harmonized — 1-10ha: 3dp' },
    { maxHa: 100,  decimalPlaces: 2, unit: 'ha',  regulation: 'EAC harmonized — 10-100ha: 2dp' },
    { maxHa: Infinity, decimalPlaces: 1, unit: 'ha', regulation: 'EAC harmonized — >100ha: 1dp' },
  ],
  slopeCorrection: { required: true, maxSlopeSingleFace: 10, tempCorrection: true, pressureCorrection: true, sagCorrection: true, regulation: 'EAC / RNRA survey standards' },
  curvilinearBoundary: { maxTacheometricDistance: 200, maxOffsetSmall: 50, maxOffsetLarge: 75, regulation: 'EAC standard (Kenya Reg framework)' },
  beacon: { mustReferenceUnderground: true, verifyWithKnownPoints: true, verifyMethod: 'traverse', regulation: 'Rwanda Land Law / EAC cadastral standards' },
  fieldNoteRules: { noErasures: true, correctionsMethod: 'single_line', regulation: 'RNRA — field note rules aligned with Commonwealth practice' },
  surveyorReport: { required: true, mustInclude: ['Parcel identification', 'Method of survey', 'Control used', 'Boundary decisions with reasoning', 'Accuracies achieved', 'Field checks'], counterSignRequired: false, regulation: 'EAC cadastral framework / Rwanda Land Law' },
  parcelMinArea: { sqMetres: 1, regulation: 'Rwanda Land Law / RNRA' },
  generalNotes: [
    'EAC member state — harmonized cadastral standards with Kenya, Uganda, Tanzania',
    'Arc 1960 (Clarke 1880) used historically; modern surveys reference WGS84 via GNSS',
    'Cadastral surveys governed by Land Law No. 27/2012 and implementing regulations',
    'RNRA: Rwanda Natural Resources Authority — surveying authority',
    'EAC surveyor mobility: Kenyan licensed surveyors recognized under mutual recognition agreement',
    'Coordinate precision: 0.0001m (4 decimal places) for registered parcels',
  ],
}

const BURUNDI_STD: CountrySurveyStandard = {
  country: 'burundi',
  name: 'Burundi',
  isoCode: 'BI',
  currency: 'BIF',
  datum: 'Arc 1960',
  ellipsoid: 'Clarke 1880',
  utmZones: [35, 36],
  utmHemisphere: 'S',
  traverseOrders: [
    {
      order: 'geodetic',
      minPrecision: 50_000,
      description: 'Geodetic control — EAC harmonized standard',
      regulation: 'EAC Survey Harmonization Framework',
    },
    {
      order: 'cadastral',
      minPrecision: 10_000,
      description: 'Cadastral surveys — EAC standard (aligned with Kenya Reg 60)',
      regulation: 'EAC Survey Harmonization / Burundi land law',
    },
  ],
  defaultTraverseOrder: 'cadastral',
  areaPrecision: [
    { maxHa: 1,    decimalPlaces: 4, unit: 'ha',  regulation: 'EAC harmonized — ≤1ha: 4dp' },
    { maxHa: 10,   decimalPlaces: 3, unit: 'ha',  regulation: 'EAC harmonized — 1-10ha: 3dp' },
    { maxHa: 100,  decimalPlaces: 2, unit: 'ha',  regulation: 'EAC harmonized — 10-100ha: 2dp' },
    { maxHa: Infinity, decimalPlaces: 1, unit: 'ha', regulation: 'EAC harmonized — >100ha: 1dp' },
  ],
  slopeCorrection: { required: true, maxSlopeSingleFace: 10, tempCorrection: true, pressureCorrection: true, sagCorrection: true, regulation: 'EAC survey standards' },
  curvilinearBoundary: { maxTacheometricDistance: 200, maxOffsetSmall: 50, maxOffsetLarge: 75, regulation: 'EAC standard' },
  beacon: { mustReferenceUnderground: true, verifyWithKnownPoints: true, verifyMethod: 'traverse', regulation: 'Burundi cadastre / EAC standards' },
  fieldNoteRules: { noErasures: true, correctionsMethod: 'single_line', regulation: 'Burundi national cadastre authority' },
  surveyorReport: { required: true, mustInclude: ['Parcel identification', 'Method of survey', 'Control used', 'Accuracies achieved', 'Field checks'], counterSignRequired: false, regulation: 'EAC cadastral framework' },
  parcelMinArea: { sqMetres: 1, regulation: 'Burundi land law' },
  generalNotes: [
    'EAC member state — Arc 1960 datum',
    'Cadastral system being modernized under EAC framework',
    'EAC surveyor mobility applies — Kenyan licensed surveyors recognized',
    'Reference to WGS84 for modern GNSS surveys',
  ],
}

const SOUTH_SUDAN_STD: CountrySurveyStandard = {
  country: 'south_sudan',
  name: 'South Sudan',
  isoCode: 'SS',
  currency: 'SSP',
  datum: 'WGS84',
  ellipsoid: 'WGS84',
  utmZones: [35, 36],
  utmHemisphere: 'N',
  traverseOrders: [
    {
      order: 'geodetic',
      minPrecision: 50_000,
      description: 'Geodetic control — EAC harmonized standard',
      regulation: 'EAC Survey Harmonization Framework / Ministry of Land',
    },
    {
      order: 'cadastral',
      minPrecision: 10_000,
      description: 'Cadastral surveys — EAC standard (aligned with Kenya Reg 60)',
      regulation: 'EAC Survey Harmonization / South Sudan Land Policy',
    },
  ],
  defaultTraverseOrder: 'cadastral',
  areaPrecision: [
    { maxHa: 1,    decimalPlaces: 4, unit: 'ha',  regulation: 'EAC harmonized — ≤1ha: 4dp' },
    { maxHa: 10,   decimalPlaces: 3, unit: 'ha',  regulation: 'EAC harmonized — 1-10ha: 3dp' },
    { maxHa: 100,  decimalPlaces: 2, unit: 'ha',  regulation: 'EAC harmonized — 10-100ha: 2dp' },
    { maxHa: Infinity, decimalPlaces: 1, unit: 'ha', regulation: 'EAC harmonized — >100ha: 1dp' },
  ],
  slopeCorrection: { required: true, maxSlopeSingleFace: 10, tempCorrection: true, pressureCorrection: true, sagCorrection: true, regulation: 'EAC survey standards / South Sudan Ministry of Land' },
  curvilinearBoundary: { maxTacheometricDistance: 200, maxOffsetSmall: 50, maxOffsetLarge: 75, regulation: 'EAC standard' },
  beacon: { mustReferenceUnderground: true, verifyWithKnownPoints: true, verifyMethod: 'traverse', regulation: 'South Sudan cadastre / EAC standards' },
  fieldNoteRules: { noErasures: true, correctionsMethod: 'single_line', regulation: 'South Sudan Land Commission' },
  surveyorReport: { required: true, mustInclude: ['Parcel identification', 'Method of survey', 'Control used', 'Accuracies achieved', 'Field checks'], counterSignRequired: false, regulation: 'EAC cadastral framework' },
  parcelMinArea: { sqMetres: 1, regulation: 'South Sudan Land Policy' },
  generalNotes: [
    'EAC member state — datum transitioning to WGS84 for GNSS surveys',
    'Cadastral system developing under EAC harmonization',
    'EAC surveyor mobility: Kenyan licensed surveyors recognized',
    'Ministry of Housing and Physical Planning — surveying authority',
  ],
}

const ZAMBIA_STD: CountrySurveyStandard = {
  country: 'zambia',
  name: 'Zambia',
  isoCode: 'ZM',
  currency: 'ZMW',
  datum: 'Arc 1960',
  ellipsoid: 'Clarke 1880',
  utmZones: [33, 34, 35, 36],
  utmHemisphere: 'S',
  traverseOrders: [
    {
      order: 'primary_control',
      minPrecision: 50_000,
      description: 'Primary geodetic control',
      regulation: 'Survey Act Cap 299 / Surveyors Registration Act',
    },
    {
      order: 'cadastral',
      minPrecision: 10_000,
      description: 'Cadastral surveys — Commonwealth standard (British framework)',
      regulation: 'Survey Act Cap 299 / Surveyors Registration Board of Zambia (SRBZ)',
    },
  ],
  defaultTraverseOrder: 'cadastral',
  areaPrecision: [
    { maxHa: 1,    decimalPlaces: 4, unit: 'ha',  regulation: 'Survey Act Cap 299 — ≤1ha: 4dp' },
    { maxHa: 10,   decimalPlaces: 3, unit: 'ha',  regulation: 'Survey Act Cap 299 — 1-10ha: 3dp' },
    { maxHa: 100,  decimalPlaces: 2, unit: 'ha',  regulation: 'Survey Act Cap 299 — 10-100ha: 2dp' },
    { maxHa: Infinity, decimalPlaces: 1, unit: 'ha', regulation: 'Survey Act Cap 299 — >100ha: 1dp' },
  ],
  slopeCorrection: { required: true, maxSlopeSingleFace: 10, tempCorrection: true, pressureCorrection: true, sagCorrection: true, regulation: 'Survey Act Cap 299 / SRBZ standards' },
  curvilinearBoundary: { maxTacheometricDistance: 200, maxOffsetSmall: 50, maxOffsetLarge: 75, regulation: 'Survey Act / Commonwealth cadastral practice' },
  beacon: { mustReferenceUnderground: true, verifyWithKnownPoints: true, verifyMethod: 'traverse', regulation: 'Survey Act Cap 299 / SRBZ' },
  fieldNoteRules: { noErasures: true, correctionsMethod: 'single_line', regulation: 'SRBZ — Commonwealth field note standards' },
  surveyorReport: { required: true, mustInclude: ['Parcel identification', 'Method of survey', 'Control used', 'Accuracies achieved', 'Field checks'], counterSignRequired: false, regulation: 'Survey Act Cap 299 / SRBZ' },
  parcelMinArea: { sqMetres: 1, regulation: 'Survey Act Cap 299 / Land Act' },
  generalNotes: [
    'Survey Act Cap 299 — primary surveying legislation',
    'Surveyors Registration Board of Zambia (SRBZ) — professional licensing authority',
    'Arc 1960 datum (Clarke 1880) — same as Kenya/Uganda/Tanzania',
    'Commonwealth system — British-based training aligns with Kenyan surveyors',
    'Local registration with SRBZ required — mutual recognition with ISK (Kenya)',
    'Cadastral surveys follow Commonwealth cadastral best practice',
    'UTM zones 33-36 covering Zambia territory',
  ],
}

const SOUTH_AFRICA_STD: CountrySurveyStandard = {
  country: 'south_africa',
  name: 'South Africa',
  isoCode: 'ZA',
  currency: 'ZAR',
  datum: 'Hartebeesthoek94',
  ellipsoid: 'GRS80',
  utmZones: [33, 34, 35, 36],
  utmHemisphere: 'S',
  traverseOrders: [
    {
      order: '1st_order',
      minPrecision: 100_000,
      description: 'Geodetic',
      regulation: 'PLATO / SABS ISO 17123',
    },
    {
      order: '2nd_order',
      minPrecision: 50_000,
      description: 'Primary control',
      regulation: 'PLATO / SABS ISO 17123',
    },
    {
      order: 'cadastral',
      minPrecision: 10_000,
      description: 'Cadastral surveys — 10mm+15ppm closure',
      regulation: 'PLATO / SABS ISO 17123',
    },
  ],
  defaultTraverseOrder: 'cadastral',
  areaPrecision: [
    { maxHa: Infinity, decimalPlaces: 4, unit: 'm2', regulation: 'Deeds Office requirements' },
  ],
  slopeCorrection: {
    required: true,
    maxSlopeSingleFace: 10,
    tempCorrection: true,
    pressureCorrection: true,
    sagCorrection: true,
    regulation: 'PLATO standards',
  },
  curvilinearBoundary: {
    maxTacheometricDistance: 200,
    maxOffsetSmall: 50,
    maxOffsetLarge: 75,
    regulation: 'PLATO cadastral standards',
  },
  beacon: {
    mustReferenceUnderground: false,
    verifyWithKnownPoints: true,
    verifyMethod: 'traverse',
    regulation: 'PLATO — SG diagram requirements',
  },
  fieldNoteRules: {
    noErasures: true,
    correctionsMethod: 'single_line',
    regulation: 'PLATO — field notes requirements',
  },
  surveyorReport: {
    required: true,
    mustInclude: ['Survey record', 'Field notes', 'Computation', 'Diagram'],
    counterSignRequired: false,
    regulation: 'PLATO — Survey record required; SACPLAN registration mandatory',
  },
  parcelMinArea: {
    sqMetres: 1,
    regulation: 'Deeds Office / municipal by-laws',
  },
  generalNotes: [
    'SACPLAN registration mandatory for all survey work',
    'Survey record lodgement to Chief Surveyor-General',
    'ISO 4463 setout tolerances for engineering surveys',
    'ECSA registration for professional engineers',
    'Mine surveys: DMR monthly submission, Mine Health and Safety Act',
  ],
}

const UGANDA_STD: CountrySurveyStandard = {
  country: 'uganda',
  name: 'Uganda',
  isoCode: 'UG',
  currency: 'UGX',
  datum: 'Arc 1960',
  ellipsoid: 'Clarke 1880',
  utmZones: [35, 36],
  utmHemisphere: 'N',
  traverseOrders: [
    {
      order: 'cadastral',
      minPrecision: 10_000,
      description: 'Cadastral control — tie to CORS at start and end',
      regulation: 'UNBS survey standards',
    },
  ],
  defaultTraverseOrder: 'cadastral',
  areaPrecision: [
    { maxHa: 1,    decimalPlaces: 4, unit: 'ha',  regulation: 'Ministry of Lands — area to 0.0001ha for <1ha' },
    { maxHa: 10,   decimalPlaces: 3, unit: 'ha',  regulation: 'Ministry of Lands' },
    { maxHa: 100,  decimalPlaces: 2, unit: 'ha',  regulation: 'Ministry of Lands' },
    { maxHa: Infinity, decimalPlaces: 1, unit: 'ha', regulation: 'Ministry of Lands' },
  ],
  slopeCorrection: { required: true, maxSlopeSingleFace: 10, tempCorrection: true, pressureCorrection: true, sagCorrection: true, regulation: 'UNBS standards' },
  curvilinearBoundary: { maxTacheometricDistance: 200, maxOffsetSmall: 50, maxOffsetLarge: 75, regulation: 'UNBS standards' },
  beacon: { mustReferenceUnderground: false, verifyWithKnownPoints: true, verifyMethod: 'traverse', regulation: 'Ministry of Lands' },
  fieldNoteRules: { noErasures: true, correctionsMethod: 'single_line', regulation: 'UNBS — field note standards' },
  surveyorReport: { required: true, mustInclude: ['Survey plan', 'Field notes', 'Computation', 'Area certificate'], counterSignRequired: true, regulation: 'Ministry of Lands — file within 60 days' },
  parcelMinArea: { sqMetres: 1, regulation: 'Ministry of Lands' },
  generalNotes: ['Tie to CORS network at commencement and close of survey'],
}

const TANZANIA_STD: CountrySurveyStandard = {
  country: 'tanzania',
  name: 'Tanzania',
  isoCode: 'TZ',
  currency: 'TZS',
  datum: 'Arc 1960',
  ellipsoid: 'Clarke 1880',
  utmZones: [36, 37],
  utmHemisphere: 'S',
  traverseOrders: [
    { order: 'cadastral', minPrecision: 7_500, description: 'Cadastral surveys', regulation: 'COSTECH survey standards' },
  ],
  defaultTraverseOrder: 'cadastral',
  areaPrecision: [
    { maxHa: 1,    decimalPlaces: 4, unit: 'ha',  regulation: 'Ministry of Lands — 4dp for <1ha' },
    { maxHa: Infinity, decimalPlaces: 3, unit: 'ha', regulation: 'Ministry of Lands' },
  ],
  slopeCorrection: { required: true, maxSlopeSingleFace: 10, tempCorrection: true, pressureCorrection: true, sagCorrection: true, regulation: 'COSTECH standards' },
  curvilinearBoundary: { maxTacheometricDistance: 200, maxOffsetSmall: 50, maxOffsetLarge: 75, regulation: 'COSTECH standards' },
  beacon: { mustReferenceUnderground: false, verifyWithKnownPoints: true, verifyMethod: 'traverse', regulation: 'Ministry of Lands' },
  fieldNoteRules: { noErasures: true, correctionsMethod: 'single_line', regulation: 'COSTECH — field note standards' },
  surveyorReport: { required: true, mustInclude: ['Survey plan', 'Field notes', 'Certificate'], counterSignRequired: true, regulation: 'Ministry of Lands' },
  parcelMinArea: { sqMetres: 1, regulation: 'Ministry of Lands' },
  generalNotes: ['WGS84 / UTM Zone 36-37S', 'Ministry of Lands Housing and Human Settlements approval required', 'File plot area certificate'],
}

const NIGERIA_STD: CountrySurveyStandard = {
  country: 'nigeria',
  name: 'Nigeria',
  isoCode: 'NG',
  currency: 'NGN',
  datum: 'Minna',
  ellipsoid: 'Clarke 1880',
  utmZones: [31, 32, 33],
  utmHemisphere: 'N',
  traverseOrders: [
    { order: 'cadastral', minPrecision: 3_000, description: 'Cadastral — OSGOF 1:3000 minimum', regulation: 'OSGOF standards' },
  ],
  defaultTraverseOrder: 'cadastral',
  areaPrecision: [
    { maxHa: Infinity, decimalPlaces: 4, unit: 'm2', regulation: 'OSGOF — coordinate precision 0.0001m' },
  ],
  slopeCorrection: { required: true, maxSlopeSingleFace: 10, tempCorrection: true, pressureCorrection: true, sagCorrection: true, regulation: 'OSGOF standards' },
  curvilinearBoundary: { maxTacheometricDistance: 200, maxOffsetSmall: 50, maxOffsetLarge: 75, regulation: 'OSGOF standards' },
  beacon: { mustReferenceUnderground: false, verifyWithKnownPoints: true, verifyMethod: 'traverse', regulation: 'OSGOF' },
  fieldNoteRules: { noErasures: true, correctionsMethod: 'single_line', regulation: 'OSGOF — field note standards' },
  surveyorReport: { required: true, mustInclude: ['Survey plan', 'Area certificate', 'Title document'], counterSignRequired: true, regulation: 'OSGOF — stamped plan required' },
  parcelMinArea: { sqMetres: 1, regulation: 'State land authority' },
  generalNotes: ['Minna Datum / UTM Zone 31-33N', 'OSGOF = Office of the Surveyor-General of the Federation', 'State land authority approval required', 'Stamped plan mandatory'],
}

const GHANA_STD: CountrySurveyStandard = {
  country: 'ghana',
  name: 'Ghana',
  isoCode: 'GH',
  currency: 'GHS',
  datum: 'Accra',
  ellipsoid: 'Clarke 1880',
  utmZones: [30],
  utmHemisphere: 'N',
  traverseOrders: [
    { order: 'cadastral', minPrecision: 7_500, description: 'Cadastral surveys — Survey Department Ghana', regulation: 'Lands Commission Act' },
  ],
  defaultTraverseOrder: 'cadastral',
  areaPrecision: [
    { maxHa: Infinity, decimalPlaces: 4, unit: 'm2', regulation: 'Lands Commission — coordinate precision' },
  ],
  slopeCorrection: { required: true, maxSlopeSingleFace: 10, tempCorrection: true, pressureCorrection: true, sagCorrection: true, regulation: 'Survey Department Ghana' },
  curvilinearBoundary: { maxTacheometricDistance: 200, maxOffsetSmall: 50, maxOffsetLarge: 75, regulation: 'Survey Department Ghana' },
  beacon: { mustReferenceUnderground: false, verifyWithKnownPoints: true, verifyMethod: 'traverse', regulation: 'Lands Commission' },
  fieldNoteRules: { noErasures: true, correctionsMethod: 'single_line', regulation: 'Survey Department Ghana' },
  surveyorReport: { required: true, mustInclude: ['Survey plan', 'Site plan'], counterSignRequired: true, regulation: 'Lands Commission — file within 30 days' },
  parcelMinArea: { sqMetres: 1, regulation: 'Lands Commission' },
  generalNotes: ['Accra Datum / UTM Zone 30N', 'WGS84/UTM', 'Lands Commission approval required'],
}

const US_STD: CountrySurveyStandard = {
  country: 'us',
  name: 'United States',
  isoCode: 'US',
  currency: 'USD',
  datum: 'NAD83(2011)',
  ellipsoid: 'GRS80',
  utmZones: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
  utmHemisphere: 'N',
  traverseOrders: [
    {
      order: 'first_order',
      minPrecision: 100_000,
      description: 'First Order — Geodetic control (FGDC standards, NGS adjustment)',
      regulation: 'USACE EM 1110-1-1005 Table 4-1 / FGCC Geodetic Control',
    },
    {
      order: '2nd_order_class_i',
      minPrecision: 50_000,
      description: 'Second Order Class I — Primary control (3·√N angle, FGCC standards)',
      regulation: 'USACE EM 1110-1-1005 Table 4-1',
    },
    {
      order: '2nd_order_class_ii',
      minPrecision: 20_000,
      description: 'Second Order Class II — Cadastral control (5·√N angle)',
      regulation: 'USACE EM 1110-1-1005 Table 4-1',
    },
    {
      order: '3rd_order_class_i',
      minPrecision: 10_000,
      description: 'Third Order Class I — Engineering control (10·√N angle)',
      regulation: 'USACE EM 1110-1-1005 Table 4-1',
    },
    {
      order: '3rd_order_class_ii',
      minPrecision: 5_000,
      description: 'Third Order Class II — Detail surveys (20·√N angle)',
      regulation: 'USACE EM 1110-1-1005 Table 4-1',
    },
    {
      order: 'construction',
      minPrecision: 2_500,
      description: 'Fourth Order / Construction Layout — (60·√N angle)',
      regulation: 'USACE EM 1110-1-1005 Table 4-1',
    },
    {
      order: 'alta_acsm',
      minPrecision: 15_000,
      description: 'ALTA/ACSM Land Title Survey — Positional Tolerance 20mm + 50ppm (0.07ft)',
      regulation: 'ALTA/ACSM Minimum Standard Detail Requirements (1999)',
    },
  ],
  defaultTraverseOrder: '3rd_order_class_i',
  areaPrecision: [
    { maxHa: Infinity, decimalPlaces: 4, unit: 'm2', regulation: 'ALTA/ACSM — coordinate precision 0.0001m' },
  ],
  slopeCorrection: { required: true, maxSlopeSingleFace: 10, tempCorrection: true, pressureCorrection: true, sagCorrection: true, regulation: 'USACE EM 1110-1-1005 §3-5 — meteorological correction mandatory for EDM ≥500m' },
  curvilinearBoundary: { maxTacheometricDistance: 200, maxOffsetSmall: 50, maxOffsetLarge: 75, regulation: 'USACE EM 1110-1-1005 — standard practice' },
  beacon: { mustReferenceUnderground: false, verifyWithKnownPoints: true, verifyMethod: 'traverse', regulation: 'State board minimum standards / ALTA requirements' },
  fieldNoteRules: { noErasures: true, correctionsMethod: 'single_line', regulation: 'USACE EM 1110-1-1005 — cross out erroneous readings; never erase' },
  surveyorReport: {
    required: true,
    mustInclude: [
      'Control monument descriptions (DA Form 1959)',
      'Traverse computation sheet',
      'Level line computation sheet',
      'Coordinate listing',
      'As-built / record drawing',
      'NSSDA compliance statement',
      'Data dictionary / metadata',
    ],
    counterSignRequired: true,
    regulation: 'USACE EM 1110-1-1005 — survey report required for all project surveys; professional surveyor seal',
  },
  parcelMinArea: { sqMetres: 1, regulation: 'State-specific / local ordinance' },
  generalNotes: [
    'NAD83(2011) / WGS84 (IGS08 epoch) — tie to NSRS via CORS or OPUS',
    'State Plane Coordinate System (SPCS) — US survey foot vs international foot distinction critical',
    'NGVD29 → NAVD88 vertical datum transition — USEPA/USGS guidelines',
    'NSSDA: Radial Accuracy = 2.447 × RMSE; 95% confidence level',
    'ASPRS Class 1: RMSE = 1/3 × contour interval for well-defined points',
    'Positional Tolerance ALTA: 0.07ft + 50ppm (20mm + 50ppm)',
    'EDM accuracy typical: ±(5mm + 5ppm); temp 1°C → 0.8ppm; pressure 3mmHg → 0.9ppm',
    'Two-peg test: level collimation check every 90 days',
    'C-factor: max 0.004 (K=1/100), 0.007 (K=1/200), 0.010 (K=1/333)',
    'Construction grade: 0.01ft (1/8") standard; 0.1ft (1-1/4") for rough grading',
    'OPUS (NGS): static GPS ≥2hrs, 3 baselines, submitted to NGS for adjustment',
    'FM 3-34.331: Army topographic surveying field manual',
  ],
}

const UK_STD: CountrySurveyStandard = {
  country: 'uk',
  name: 'United Kingdom',
  isoCode: 'GB',
  currency: 'GBP',
  datum: 'OSGB36',
  ellipsoid: 'Airy 1830',
  utmZones: [29, 30, 31],
  utmHemisphere: 'N',
  traverseOrders: [
    { order: 'os_network', minPrecision: 50_000, description: 'OS National Network — RICS standards', regulation: 'Ordnance Survey / RICS' },
    { order: 'cadastral', minPrecision: 10_000, description: 'Cadastral surveys — Land Registration Rules', regulation: 'HMLR Land Registration Act 2002' },
    { order: 'engineering', minPrecision: 5_000, description: 'Engineering construction surveys', regulation: 'BS 7335 / RICS' },
  ],
  defaultTraverseOrder: 'cadastral',
  areaPrecision: [
    { maxHa: Infinity, decimalPlaces: 4, unit: 'm2', regulation: 'HMLR — coordinate precision 0.0001m' },
  ],
  slopeCorrection: { required: true, maxSlopeSingleFace: 10, tempCorrection: true, pressureCorrection: true, sagCorrection: true, regulation: 'RICS standards' },
  curvilinearBoundary: { maxTacheometricDistance: 200, maxOffsetSmall: 50, maxOffsetLarge: 75, regulation: 'RICS guidance' },
  beacon: { mustReferenceUnderground: false, verifyWithKnownPoints: true, verifyMethod: 'traverse', regulation: 'HMLR / RICS' },
  fieldNoteRules: { noErasures: true, correctionsMethod: 'single_line', regulation: 'RICS — record keeping standards' },
  surveyorReport: { required: true, mustInclude: ['Method statement', 'Control descriptions', 'Computations', 'Land Registry compliant plan'], counterSignRequired: false, regulation: 'HMLR — AP2 requirement for first registration' },
  parcelMinArea: { sqMetres: 1, regulation: 'Land Registry / local authority' },
  generalNotes: ['OSGB36 / Airy 1830 ellipsoid', 'OSTN15 transformation for OS Net', 'Easting 0–700,000m for OS grid', 'British National Grid reference system', 'RICS qualification mandatory for official surveys'],
}

const AUSTRALIA_STD: CountrySurveyStandard = {
  country: 'australia',
  name: 'Australia',
  isoCode: 'AU',
  currency: 'AUD',
  datum: 'GDA2020',
  ellipsoid: 'GRS80',
  utmZones: [49, 50, 51, 52, 53, 54, 55, 56, 57, 58],
  utmHemisphere: 'S',
  traverseOrders: [
    { order: 'geodetic', minPrecision: 100_000, description: 'Geodetic — ICSM standards', regulation: 'ICSM Standards and Practices 2021' },
    { order: 'cadastral', minPrecision: 10_000, description: 'Cadastral surveys — state-based', regulation: 'State Survey Regulations / LRS Act' },
    { order: 'engineering', minPrecision: 5_000, description: 'Engineering surveys — AS5488', regulation: 'AS5488-2013 / Spatial Datasets' },
  ],
  defaultTraverseOrder: 'cadastral',
  areaPrecision: [
    { maxHa: Infinity, decimalPlaces: 4, unit: 'm2', regulation: 'Jurisdictional registrar requirements' },
  ],
  slopeCorrection: { required: true, maxSlopeSingleFace: 10, tempCorrection: true, pressureCorrection: true, sagCorrection: true, regulation: 'ICSM standards' },
  curvilinearBoundary: { maxTacheometricDistance: 200, maxOffsetSmall: 50, maxOffsetLarge: 75, regulation: 'ICSM / state standards' },
  beacon: { mustReferenceUnderground: true, verifyWithKnownPoints: true, verifyMethod: 'traverse', regulation: 'State LRS regulations' },
  fieldNoteRules: { noErasures: true, correctionsMethod: 'single_line', regulation: 'ICSM — field book standards' },
  surveyorReport: { required: true, mustInclude: ['Survey methodology', 'Control descriptions', 'Coordinate schedule', 'Plan'], counterSignRequired: false, regulation: 'State Surveyor-General / LRS' },
  parcelMinArea: { sqMetres: 1, regulation: 'State planning / LRS' },
  generalNotes: ['GDA2020 / MGA2020 zones', 'Geoid: AGG2014 or AUSGeoid2020', 'ICSM = Intergovernmental Committee on Surveying and Mapping', 'SCIMS = State Centralized Land Information System'],
}

const DEFAULT_STD: CountrySurveyStandard = {
  country: 'other',
  name: 'International / Other',
  isoCode: 'XX',
  currency: 'USD',
  datum: 'WGS84',
  ellipsoid: 'WGS84',
  utmZones: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60],
  utmHemisphere: 'both',
  traverseOrders: [
    { order: 'standard', minPrecision: 5_000, description: 'Default cadastral standard', regulation: 'Apply applicable national standard' },
  ],
  defaultTraverseOrder: 'standard',
  areaPrecision: [
    { maxHa: 1,    decimalPlaces: 4, unit: 'ha',  regulation: 'Apply national standard' },
    { maxHa: Infinity, decimalPlaces: 2, unit: 'ha', regulation: 'Apply national standard' },
  ],
  slopeCorrection: { required: true, maxSlopeSingleFace: 10, tempCorrection: true, pressureCorrection: true, sagCorrection: true, regulation: 'Applicable national standard' },
  curvilinearBoundary: { maxTacheometricDistance: 200, maxOffsetSmall: 50, maxOffsetLarge: 75, regulation: 'Applicable national standard' },
  beacon: { mustReferenceUnderground: false, verifyWithKnownPoints: true, verifyMethod: 'traverse', regulation: 'Applicable national standard' },
  fieldNoteRules: { noErasures: true, correctionsMethod: 'single_line', regulation: 'Applicable national standard — retain field notes 5 years minimum' },
  surveyorReport: { required: true, mustInclude: ['Method', 'Control used', 'Accuracies achieved', 'Any anomalies'], counterSignRequired: false, regulation: 'Applicable national standard' },
  generalNotes: ['Apply the relevant national survey regulations for the jurisdiction'],
}

const SAUDI_ARABIA_STD: CountrySurveyStandard = {
  country: 'saudi_arabia',
  name: 'Saudi Arabia',
  isoCode: 'SA',
  currency: 'SAR',
  datum: 'IGM 1969 / GCS 1924',
  ellipsoid: 'Clarke 1880 / GRS80 (modern)',
  utmZones: [37, 38, 39],
  utmHemisphere: 'N',
  traverseOrders: [
    { order: 'primary_control', minPrecision: 50_000, description: 'Primary geodetic control', regulation: 'GCS / USGS guidelines; GACAD alignment' },
    { order: 'cadastral', minPrecision: 20_000, description: 'Cadastral surveys — min(0.0015/Lm, 1:20,000)', regulation: 'GCC cadastral best practice (Bahrain CSD §F framework)' },
    { order: 'detail', minPrecision: 5_000, description: 'Detail and topographic surveys', regulation: 'GCC standard practice' },
  ],
  defaultTraverseOrder: 'cadastral',
  areaPrecision: [
    { maxHa: Infinity, decimalPlaces: 4, unit: 'm2', regulation: 'Coordinate precision 0.0001m' },
  ],
  slopeCorrection: { required: true, maxSlopeSingleFace: 10, tempCorrection: true, pressureCorrection: true, sagCorrection: false, regulation: 'GCC cadastral best practice / USACE EM 1110-1-1005 §3-5' },
  curvilinearBoundary: { maxTacheometricDistance: 200, maxOffsetSmall: 50, maxOffsetLarge: 50, regulation: 'GCC standard — arc-to-chord <0.2m (developed) / <0.3m (undeveloped)' },
  beacon: { mustReferenceUnderground: false, verifyWithKnownPoints: true, verifyMethod: '3_distances', regulation: 'GCC cadastral best practice (Bahrain CSD §3.11 framework)' },
  fieldNoteRules: { noErasures: true, correctionsMethod: 'single_line', regulation: 'GCC standard — erasures prohibited' },
  surveyorReport: { required: true, mustInclude: ['Parcel identification', 'Method of survey', 'Control used', 'Accuracies achieved', 'Field checks', 'Any anomalies or discrepancies'], counterSignRequired: false, regulation: 'GACAD / national survey authority' },
  parcelMinArea: { sqMetres: 10, regulation: 'GACAD / national survey authority' },
  generalNotes: [
    'UTM Zone 37/38/39 North — select zone based on project location',
    'IGM 1969 datum: Clarke 1880 ellipsoid, similar framework to Ain Al-Abd 1970',
    'Modern surveys reference WGS84/ITRF via GNSS',
    'GACAD (GCC Aerial Photography & Cadastral Database) alignment',
    'EDM spec: ±(5mm + 5ppm) — atmospheric correction mandatory',
    'RTK GPS: ≤50mm 3D quality for cadastral work',
    'Traverse: min(0.0015/Lm, 1:20,000) — same as Bahrain CSD §F',
    'Reference: Saudi Arabia GCS, USGS regional alignment',
  ],
}

const OMAN_STD: CountrySurveyStandard = {
  country: 'oman',
  name: 'Oman',
  isoCode: 'OM',
  currency: 'OMR',
  datum: 'Oman Transverse Mercator (OTM)',
  ellipsoid: 'GRS80 / WGS84',
  utmZones: [39, 40],
  utmHemisphere: 'N',
  traverseOrders: [
    { order: 'geodetic', minPrecision: 50_000, description: 'Geodetic control networks', regulation: 'GCC geodetic best practice' },
    { order: 'cadastral', minPrecision: 20_000, description: 'Cadastral surveys — min(0.0015/Lm, 1:20,000)', regulation: 'GCC cadastral best practice (Bahrain CSD §F framework)' },
    { order: 'detail', minPrecision: 5_000, description: 'Detail and topographic surveys', regulation: 'GCC standard practice' },
  ],
  defaultTraverseOrder: 'cadastral',
  areaPrecision: [
    { maxHa: Infinity, decimalPlaces: 4, unit: 'm2', regulation: 'Coordinate precision 0.0001m' },
  ],
  slopeCorrection: { required: true, maxSlopeSingleFace: 10, tempCorrection: true, pressureCorrection: true, sagCorrection: false, regulation: 'GCC cadastral best practice / USACE EM 1110-1-1005 §3-5' },
  curvilinearBoundary: { maxTacheometricDistance: 200, maxOffsetSmall: 50, maxOffsetLarge: 50, regulation: 'GCC standard — arc-to-chord <0.2m (developed) / <0.3m (undeveloped)' },
  beacon: { mustReferenceUnderground: false, verifyWithKnownPoints: true, verifyMethod: '3_distances', regulation: 'GCC cadastral best practice' },
  fieldNoteRules: { noErasures: true, correctionsMethod: 'single_line', regulation: 'GCC standard — erasures prohibited' },
  surveyorReport: { required: true, mustInclude: ['Parcel identification', 'Method of survey', 'Control used', 'Accuracies achieved', 'Field checks', 'Any anomalies'], counterSignRequired: false, regulation: 'Oman Survey Authority' },
  parcelMinArea: { sqMetres: 10, regulation: 'Oman Survey Authority' },
  generalNotes: [
    'UTM Zone 39/40 North — Oman Transverse Mercator (OTM) also used',
    'GRS80 ellipsoid, WGS84-aligned for modern GNSS surveys',
    'EDM spec: ±(5mm + 5ppm)',
    'RTK GPS: ≤50mm 3D quality for cadastral work',
    'Traverse: min(0.0015/Lm, 1:20,000) — GCC standard',
    'Reference: Oman National Survey Framework / GCC geomatics alignment',
  ],
}

const UAE_STD: CountrySurveyStandard = {
  country: 'uae',
  name: 'United Arab Emirates',
  isoCode: 'AE',
  currency: 'AED',
  datum: 'WGS84 / NAD83(CSRS)',
  ellipsoid: 'GRS80 / WGS84',
  utmZones: [39, 40, 41],
  utmHemisphere: 'N',
  traverseOrders: [
    { order: 'geodetic', minPrecision: 50_000, description: 'Geodetic control networks', regulation: 'UAE Spatial Surveying Authority / international best practice' },
    { order: 'cadastral', minPrecision: 20_000, description: 'Cadastral surveys — min(0.0015/Lm, 1:20,000)', regulation: 'GCC cadastral best practice (Bahrain CSD §F framework)' },
    { order: 'detail', minPrecision: 5_000, description: 'Detail and topographic surveys', regulation: 'UAE standard practice' },
  ],
  defaultTraverseOrder: 'cadastral',
  areaPrecision: [
    { maxHa: Infinity, decimalPlaces: 4, unit: 'm2', regulation: 'Coordinate precision 0.0001m' },
  ],
  slopeCorrection: { required: true, maxSlopeSingleFace: 10, tempCorrection: true, pressureCorrection: true, sagCorrection: false, regulation: 'GCC cadastral best practice / USACE EM 1110-1-1005 §3-5' },
  curvilinearBoundary: { maxTacheometricDistance: 200, maxOffsetSmall: 50, maxOffsetLarge: 50, regulation: 'GCC standard — arc-to-chord <0.2m (developed) / <0.3m (undeveloped)' },
  beacon: { mustReferenceUnderground: false, verifyWithKnownPoints: true, verifyMethod: '3_distances', regulation: 'GCC cadastral best practice' },
  fieldNoteRules: { noErasures: true, correctionsMethod: 'single_line', regulation: 'UAE Survey Authority — erasures prohibited' },
  surveyorReport: { required: true, mustInclude: ['Parcel identification', 'Method of survey', 'Control used', 'Accuracies achieved', 'Field checks', 'Any anomalies'], counterSignRequired: false, regulation: 'UAE Spatial Surveying Authority' },
  parcelMinArea: { sqMetres: 10, regulation: 'UAE Municipal / Survey Authority' },
  generalNotes: [
    'UTM Zone 39/40/41 North — select zone based on project location',
    'WGS84 primary datum for all modern GNSS surveys',
    'NAD83(CSRS) used for geodetic reference network',
    'EDM spec: ±(5mm + 5ppm)',
    'RTK GPS: ≤50mm 3D quality for cadastral work',
    'Traverse: min(0.0015/Lm, 1:20,000) — GCC standard',
    'Reference: UAE Spatial Surveying Authority / international alignment (UK, US, Australia)',
  ],
}

const COUNTRY_REGISTRY: Record<SurveyingCountry, CountrySurveyStandard> = {
  kenya:        KENYA_STD,
  uganda:       UGANDA_STD,
  tanzania:     TANZANIA_STD,
  rwanda:       RWANDA_STD,
  burundi:      BURUNDI_STD,
  south_sudan:  SOUTH_SUDAN_STD,
  nigeria:      NIGERIA_STD,
  ghana:        GHANA_STD,
  south_africa: SOUTH_AFRICA_STD,
  zambia:       ZAMBIA_STD,
  bahrain:      BAHRAIN_STD,
  saudi_arabia: SAUDI_ARABIA_STD,
  oman:         OMAN_STD,
  uae:          UAE_STD,
  new_zealand:  NZ_STD,
  uk:           UK_STD,
  us:           US_STD,
  australia:    AUSTRALIA_STD,
  india:        DEFAULT_STD,
  indonesia:    DEFAULT_STD,
  brazil:       DEFAULT_STD,
  other:        DEFAULT_STD,
}

export const ALL_COUNTRIES: { id: SurveyingCountry; name: string; isoCode: string; flag: string }[] = [
  { id: 'kenya',        name: 'Kenya',         isoCode: 'KE', flag: 'KE' },
  { id: 'uganda',       name: 'Uganda',        isoCode: 'UG', flag: 'UG' },
  { id: 'tanzania',     name: 'Tanzania',      isoCode: 'TZ', flag: 'TZ' },
  { id: 'rwanda',       name: 'Rwanda',        isoCode: 'RW', flag: 'RW' },
  { id: 'burundi',      name: 'Burundi',       isoCode: 'BI', flag: 'BI' },
  { id: 'south_sudan',  name: 'South Sudan',   isoCode: 'SS', flag: 'SS' },
  { id: 'nigeria',      name: 'Nigeria',       isoCode: 'NG', flag: 'NG' },
  { id: 'ghana',        name: 'Ghana',         isoCode: 'GH', flag: 'GH' },
  { id: 'south_africa', name: 'South Africa',  isoCode: 'ZA', flag: 'ZA' },
  { id: 'zambia',       name: 'Zambia',       isoCode: 'ZM', flag: '' },
  { id: 'bahrain',      name: 'Bahrain',         isoCode: 'BH', flag: '' },
  { id: 'saudi_arabia', name: 'Saudi Arabia',   isoCode: 'SA', flag: '' },
  { id: 'oman',         name: 'Oman',           isoCode: 'OM', flag: '' },
  { id: 'uae',          name: 'UAE',             isoCode: 'AE', flag: '' },
  { id: 'new_zealand',  name: 'New Zealand',    isoCode: 'NZ', flag: '' },
  { id: 'uk',           name: 'United Kingdom',isoCode: 'GB', flag: 'UK' },
  { id: 'us',           name: 'United States', isoCode: 'US', flag: 'US' },
  { id: 'australia',    name: 'Australia',     isoCode: 'AU', flag: '' },
  { id: 'india',        name: 'India',         isoCode: 'IN', flag: 'IN' },
  { id: 'indonesia',    name: 'Indonesia',     isoCode: 'ID', flag: '' },
  { id: 'brazil',       name: 'Brazil',        isoCode: 'BR', flag: '' },
  { id: 'other',        name: 'Other',          isoCode: 'XX', flag: '' },
]

export function getCountryStandard(country: SurveyingCountry): CountrySurveyStandard {
  return COUNTRY_REGISTRY[country] ?? DEFAULT_STD
}

export function getCountryByISO(isoCode: string): CountrySurveyStandard | undefined {
  return Object.values(COUNTRY_REGISTRY).find((c) => c.isoCode === isoCode.toUpperCase())
}

export type SurveyEnvironment =
  | 'urban' | 'rural' | 'transmission_line' | 'detail' | 'default'
  | 'first_order' | 'geodetic'
  | 'second_order_i' | 'second_order_ii' | 'third_order_i' | 'third_order_ii' | 'construction' | 'alta_acsm'

export function getTraverseOrderForEnvironment(
  country: SurveyingCountry,
  environment: SurveyEnvironment
): TraverseOrderSpec | undefined {
  const std = getCountryStandard(country)
  const orders = std.traverseOrders

  if (country === 'kenya') {
    if (environment === 'urban') return orders.find((o) => o.order === '3rd_order_urban')
    if (environment === 'transmission_line') return orders.find((o) => o.order === '4th_order_other')
    return orders.find((o) => o.order === '4th_order_other')
  }

  if (country === 'bahrain') {
    if (environment === 'geodetic') return orders.find((o) => o.order === 'geodetic')
    if (environment === 'detail') return orders.find((o) => o.order === 'detail_survey' || o.order === 'detail')
    return orders.find((o) => o.order === 'cadastral_control') ?? orders.find((o) => o.order === 'geodetic')
  }

  if (country === 'new_zealand') {
    return orders.find((o) => o.order === 'cadastral')
  }

  if (country === 'south_africa') {
    if (environment === 'detail') return orders.find((o) => o.order === 'cadastral')
    return orders.find((o) => o.order === 'cadastral')
  }

  if (country === 'rwanda' || country === 'burundi' || country === 'south_sudan' || country === 'zambia') {
    if (environment === 'first_order' || environment === 'geodetic') return orders.find((o) => o.order === 'geodetic' || o.order === 'primary_control')
    return orders.find((o) => o.order === 'cadastral') ?? orders[0]
  }

  if (country === 'us') {
    const usMap: Record<string, string> = {
      first_order: '1st_order',
      second_order_i: '2nd_order_class_i',
      second_order_ii: '2nd_order_class_ii',
      third_order_i: '3rd_order_class_i',
      third_order_ii: '3rd_order_class_ii',
      construction: 'construction',
      alta_acsm: 'alta_acsm',
      detail: '3rd_order_class_ii',
      urban: '3rd_order_class_i',
      rural: '3rd_order_class_ii',
      transmission_line: '3rd_order_class_ii',
      default: '3rd_order_class_i',
    }
    const orderId = usMap[environment] ?? '3rd_order_class_i'
    return orders.find((o) => o.order === orderId) ?? orders.find((o) => o.order === '3rd_order_class_i')
  }

  if (country === 'uk') {
    const ukMap: Record<string, string> = {
      first_order: 'os_network',
      engineering: 'engineering',
      alta_acsm: 'cadastral',
      detail: 'engineering',
      urban: 'cadastral',
      rural: 'os_network',
      transmission_line: 'engineering',
      default: 'cadastral',
    }
    const orderId = ukMap[environment] ?? 'cadastral'
    return orders.find((o) => o.order === orderId) ?? orders.find((o) => o.order === 'cadastral')
  }

  if (country === 'saudi_arabia' || country === 'oman' || country === 'uae') {
    if (environment === 'geodetic') return orders.find((o) => o.order === 'geodetic')
    if (environment === 'detail') return orders.find((o) => o.order === 'detail')
    return orders.find((o) => o.order === 'cadastral') ?? orders.find((o) => o.order === 'geodetic')
  }

  if (country === 'australia') {
    const auMap: Record<string, string> = {
      first_order: 'geodetic',
      second_order_i: 'geodetic',
      cadastral: 'cadastral',
      engineering: 'engineering',
      detail: 'cadastral',
      urban: 'cadastral',
      rural: 'geodetic',
      transmission_line: 'engineering',
      default: 'cadastral',
    }
    const orderId = auMap[environment] ?? 'cadastral'
    return orders.find((o) => o.order === orderId) ?? orders.find((o) => o.order === 'cadastral')
  }

  return orders.find((o) => o.order === std.defaultTraverseOrder) ?? orders[0]
}

export function getAreaDecimalPlaces(country: SurveyingCountry, sqMetres: number): AreaPrecisionRule {
  const std = getCountryStandard(country)
  const ha = sqMetres / 10_000
  const rule = std.areaPrecision.find((r) => ha <= r.maxHa)
  return rule ?? { maxHa: Infinity, decimalPlaces: 2, unit: 'm2', regulation: std.country }
}

export function getSlopeRule(country: SurveyingCountry) {
  return getCountryStandard(country).slopeCorrection
}

export function getBeaconRule(country: SurveyingCountry) {
  return getCountryStandard(country).beacon
}

export function getFieldNoteRule(country: SurveyingCountry) {
  return getCountryStandard(country).fieldNoteRules
}

export function getSurveyorReportRequirement(country: SurveyingCountry) {
  return getCountryStandard(country).surveyorReport
}

export interface ScaleGridInterval {
  scale: number
  intervalMetres: number
  intervalFeet: number | null
  regulation: string
}

const KENYA_SCALE_GRID: ScaleGridInterval[] = [
  { scale: 250,    intervalMetres: 25,   intervalFeet: 100,  regulation: 'Kenya Survey Reg 89' },
  { scale: 500,    intervalMetres: 50,   intervalFeet: 200,  regulation: 'Kenya Survey Reg 89' },
  { scale: 1_000,  intervalMetres: 100,  intervalFeet: 500,  regulation: 'Kenya Survey Reg 89' },
  { scale: 2_500,  intervalMetres: 250,  intervalFeet: 1_000, regulation: 'Kenya Survey Reg 89' },
  { scale: 5_000,  intervalMetres: 500,  intervalFeet: 2_000, regulation: 'Kenya Survey Reg 89' },
  { scale: 10_000, intervalMetres: 1_000, intervalFeet: 5_000, regulation: 'Kenya Survey Reg 89' },
  { scale: 25_000, intervalMetres: 2_500, intervalFeet: 10_000, regulation: 'Kenya Survey Reg 89' },
  { scale: 50_000, intervalMetres: 5_000, intervalFeet: 20_000, regulation: 'Kenya Survey Reg 89' },
  { scale: 100_000, intervalMetres: 10_000, intervalFeet: 50_000, regulation: 'Kenya Survey Reg 89' },
  { scale: 250_000, intervalMetres: 25_000, intervalFeet: 100_000, regulation: 'Kenya Survey Reg 89' },
]

export function getScaleGridInterval(scale: number): ScaleGridInterval | null {
  return KENYA_SCALE_GRID.find((g) => g.scale === scale) ?? null
}

export function getDefaultGridInterval(scale: number, unit: 'metres' | 'feet' = 'metres'): number {
  const grid = getScaleGridInterval(scale)
  if (!grid) return scale / 100
  return unit === 'metres' ? grid.intervalMetres : (grid.intervalFeet ?? grid.intervalMetres)
}
