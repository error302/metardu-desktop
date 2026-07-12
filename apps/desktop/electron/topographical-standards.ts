/**
 * Topographical Standards Module — Survey of Kenya + NMAS + SoK Practice Notes
 *
 * Centralizes topographical surveying standards so that every project
 * produces maps that meet Kenyan and international accuracy requirements.
 *
 * Standards covered:
 *   - Survey of Kenya Topographical Map Standards
 *   - SoK Drafting Manual 2020
 *   - Topographical Survey Guidelines for Kenya (scribd/SoK practice notes)
 *   - National Map Accuracy Standards (NMAS) — US standard widely adopted
 *   - ASPRS Positional Accuracy Standards (2014)
 *   - ISO 19157 Geographic Information — Data Quality
 *
 * Key rules enforced:
 *   - RMS error better than 1/3 of contour interval (per Kenya topo guidelines)
 *   - 90% of well-defined points within 0.5mm of map scale (NMAS)
 *   - Contour intervals standardized per scale
 *   - Control survey classification (Zero/1st/2nd/3rd order)
 *   - Feature coding library (70 codes, 10 categories)
 *   - Spot height density per scale
 */

// ─── Topographical Map Scales & Standards ──────────────────────────────

export interface TopoMapStandard {
  scale: string;
  scaleDenominator: number;
  contourInterval: number;          // metres
  indexContourInterval: number;     // every Nth contour is index
  spotHeightDensity: number;        // points per hectare
  positionalAccuracyM: number;      // ±metres (NMAS: 0.5mm at scale)
  verticalAccuracyM: number;        // ±metres (1/3 contour interval)
  minFeatureSizeM: number;          // smallest feature to capture
  controlSurveyOrder: ControlSurveyOrder;
  typicalUseCase: string;
  sourceStandard: string;
}

export const TOPO_MAP_STANDARDS: TopoMapStandard[] = [
  {
    scale: '1:250',
    scaleDenominator: 250,
    contourInterval: 0.25,
    indexContourInterval: 5,
    spotHeightDensity: 50,
    positionalAccuracyM: 0.125,
    verticalAccuracyM: 0.083,
    minFeatureSizeM: 0.05,
    controlSurveyOrder: 'first',
    typicalUseCase: 'Detailed site survey — building footprints, structural detail',
    sourceStandard: 'SoK Practice Notes 2020',
  },
  {
    scale: '1:500',
    scaleDenominator: 500,
    contourInterval: 0.5,
    indexContourInterval: 5,
    spotHeightDensity: 30,
    positionalAccuracyM: 0.25,
    verticalAccuracyM: 0.167,
    minFeatureSizeM: 0.1,
    controlSurveyOrder: 'first',
    typicalUseCase: 'Detailed engineering design — road, bridge, building site',
    sourceStandard: 'SoK Practice Notes 2020',
  },
  {
    scale: '1:1000',
    scaleDenominator: 1000,
    contourInterval: 0.5,
    indexContourInterval: 5,
    spotHeightDensity: 20,
    positionalAccuracyM: 0.5,
    verticalAccuracyM: 0.167,
    minFeatureSizeM: 0.2,
    controlSurveyOrder: 'first',
    typicalUseCase: 'Site planning — residential/commercial development',
    sourceStandard: 'SoK Practice Notes 2020',
  },
  {
    scale: '1:2500',
    scaleDenominator: 2500,
    contourInterval: 1.0,
    indexContourInterval: 5,
    spotHeightDensity: 10,
    positionalAccuracyM: 1.25,
    verticalAccuracyM: 0.333,
    minFeatureSizeM: 0.5,
    controlSurveyOrder: 'second',
    typicalUseCase: 'KETRACO transmission line corridor survey (Annex 6)',
    sourceStandard: 'KETRACO Annex 6 + SoK Practice Notes',
  },
  {
    scale: '1:5000',
    scaleDenominator: 5000,
    contourInterval: 2.0,
    indexContourInterval: 5,
    spotHeightDensity: 5,
    positionalAccuracyM: 2.5,
    verticalAccuracyM: 0.667,
    minFeatureSizeM: 1.0,
    controlSurveyOrder: 'second',
    typicalUseCase: 'Master planning — township, industrial area',
    sourceStandard: 'SoK Practice Notes 2020',
  },
  {
    scale: '1:10000',
    scaleDenominator: 10000,
    contourInterval: 5.0,
    indexContourInterval: 5,
    spotHeightDensity: 2,
    positionalAccuracyM: 5.0,
    verticalAccuracyM: 1.667,
    minFeatureSizeM: 2.0,
    controlSurveyOrder: 'second',
    typicalUseCase: 'Regional planning — district, sub-county',
    sourceStandard: 'SoK Topographical Map Standards',
  },
  {
    scale: '1:25000',
    scaleDenominator: 25000,
    contourInterval: 10.0,
    indexContourInterval: 5,
    spotHeightDensity: 0.5,
    positionalAccuracyM: 12.5,
    verticalAccuracyM: 3.333,
    minFeatureSizeM: 5.0,
    controlSurveyOrder: 'third',
    typicalUseCase: 'National mapping — SoK topographical series',
    sourceStandard: 'SoK Topographical Map Standards',
  },
  {
    scale: '1:50000',
    scaleDenominator: 50000,
    contourInterval: 20.0,
    indexContourInterval: 5,
    spotHeightDensity: 0.2,
    positionalAccuracyM: 25.0,
    verticalAccuracyM: 6.667,
    minFeatureSizeM: 10.0,
    controlSurveyOrder: 'third',
    typicalUseCase: 'National topographical series (Kenya Y717 series)',
    sourceStandard: 'SoK Topographical Map Standards',
  },
  {
    scale: '1:100000',
    scaleDenominator: 100000,
    contourInterval: 50.0,
    indexContourInterval: 5,
    spotHeightDensity: 0.05,
    positionalAccuracyM: 50.0,
    verticalAccuracyM: 16.667,
    minFeatureSizeM: 20.0,
    controlSurveyOrder: 'third',
    typicalUseCase: 'National overview maps',
    sourceStandard: 'SoK Topographical Map Standards',
  },
];

// ─── Control Survey Classification ─────────────────────────────────────

export type ControlSurveyOrder = 'zero' | 'first' | 'second' | 'third';

export interface ControlSurveySpec {
  order: ControlSurveyOrder;
  label: string;
  horizontalAccuracy: number;       // ±mm + ppm
  verticalAccuracy: number;         // ±mm + ppm
  relativeAccuracy: string;         // e.g., "1:1,000,000"
  method: string;
  equipment: string[];
  typicalSpacingKm: number;         // distance between control points
  applications: string[];
  governingStandard: string;
}

export const CONTROL_SURVEY_CLASSES: Record<ControlSurveyOrder, ControlSurveySpec> = {
  zero: {
    order: 'zero',
    label: 'Zero Order (Geodetic)',
    horizontalAccuracy: 3,   // mm
    verticalAccuracy: 6,
    relativeAccuracy: '1:1,000,000',
    method: 'Continuous GNSS (CORS) — 24+ hour observation sessions',
    equipment: ['GNSS CORS receiver', 'Choke ring antenna', 'Atomic clock'],
    typicalSpacingKm: 100,
    applications: ['National geodetic network', 'Tectonic monitoring', 'CORS network'],
    governingStandard: 'IERS Conventions + SoK Geodetic Standards',
  },
  first: {
    order: 'first',
    label: 'First Order (Primary)',
    horizontalAccuracy: 5,   // mm + 1 ppm
    verticalAccuracy: 10,
    relativeAccuracy: '1:100,000',
    method: 'Static GNSS — 2 to 6 hour observation sessions; precise leveling',
    equipment: ['Dual-frequency GNSS receiver', 'Geodetic antenna', 'Precise level + invar staff'],
    typicalSpacingKm: 10,
    applications: ['Engineering projects (roads, dams, bridges)', 'Cadastral control', 'Major construction'],
    governingStandard: 'SoK Survey Regulations 1994 + RDM 1.1',
  },
  second: {
    order: 'second',
    label: 'Second Order (Secondary)',
    horizontalAccuracy: 10,  // mm + 2 ppm
    verticalAccuracy: 20,
    relativeAccuracy: '1:20,000',
    method: 'Static GNSS — 30 min to 2 hour sessions; trig leveling',
    equipment: ['Dual-frequency GNSS', 'Total station', 'Automatic level'],
    typicalSpacingKm: 2,
    applications: ['Topographical survey control', 'Subdivision layout', 'Route survey'],
    governingStandard: 'SoK Survey Regulations 1994',
  },
  third: {
    order: 'third',
    label: 'Third Order (Tertiary)',
    horizontalAccuracy: 25,  // mm + 5 ppm
    verticalAccuracy: 50,
    relativeAccuracy: '1:5,000',
    method: 'RTK-GNSS or total station traversing',
    equipment: ['RTK-GNSS rover', 'Total station', 'Automatic level'],
    typicalSpacingKm: 0.5,
    applications: ['Detail survey', 'Setting out', 'Photo control'],
    governingStandard: 'SoK Survey Regulations 1994',
  },
};

// ─── Topographical Accuracy Assessment ─────────────────────────────────

export interface TopoAccuracyAssessment {
  mapScale: string;
  contourInterval: number;
  expectedPositionalAccuracyM: number;
  expectedVerticalAccuracyM: number;
  actualRMSHorizontal: number;
  actualRMSVertical: number;
  passesPositional: boolean;
  passesVertical: boolean;
  nmasCompliant: boolean;       // 90% of points within 0.5mm at scale
  oneThirdRuleCompliant: boolean;  // RMS < 1/3 contour interval
  overallCompliance: 'compliant' | 'marginal' | 'non_compliant';
  recommendations: string[];
}

/**
 * Assess topographical survey accuracy against:
 *   - National Map Accuracy Standards (NMAS): 90% of points within 0.5mm at map scale
 *   - Kenya Topo Guidelines: RMS error < 1/3 of contour interval
 */
export function assessTopoAccuracy(
  mapScale: string,
  checkPoints: Array<{ surveyedEasting: number; surveyedNorthing: number; surveyedElevation: number; referenceEasting: number; referenceNorthing: number; referenceElevation: number }>,
): TopoAccuracyAssessment {
  const standard = TOPO_MAP_STANDARDS.find(s => s.scale === mapScale)
    ?? TOPO_MAP_STANDARDS.find(s => s.scale === '1:1000')!;

  const residuals = checkPoints.map(p => ({
    e: p.surveyedEasting - p.referenceEasting,
    n: p.surveyedNorthing - p.referenceNorthing,
    z: p.surveyedElevation - p.referenceElevation,
    horizontal: Math.sqrt(
      Math.pow(p.surveyedEasting - p.referenceEasting, 2) +
      Math.pow(p.surveyedNorthing - p.referenceNorthing, 2)
    ),
  }));

  const actualRMSHorizontal = Math.sqrt(
    residuals.reduce((s, r) => s + r.horizontal * r.horizontal, 0) / residuals.length
  );
  const actualRMSVertical = Math.sqrt(
    residuals.reduce((s, r) => s + r.z * r.z, 0) / residuals.length
  );

  // NMAS: 90% of points within 0.5mm at map scale
  const nmasThreshold = standard.scaleDenominator * 0.0005;  // 0.5mm in metres
  const nmasPassCount = residuals.filter(r => r.horizontal <= nmasThreshold).length;
  const nmasPassRate = nmasPassCount / residuals.length;
  const nmasCompliant = nmasPassRate >= 0.90;

  // 1/3 contour interval rule (Kenya Topo Guidelines)
  const oneThirdThreshold = standard.contourInterval / 3;
  const oneThirdRuleCompliant = actualRMSVertical < oneThirdThreshold;

  // Positional accuracy check (vs expected)
  const passesPositional = actualRMSHorizontal <= standard.positionalAccuracyM;
  const passesVertical = actualRMSVertical <= standard.verticalAccuracyM;

  let overallCompliance: TopoAccuracyAssessment['overallCompliance'];
  if (nmasCompliant && oneThirdRuleCompliant && passesPositional && passesVertical) {
    overallCompliance = 'compliant';
  } else if (nmasPassRate >= 0.80 && actualRMSVertical < oneThirdThreshold * 1.5) {
    overallCompliance = 'marginal';
  } else {
    overallCompliance = 'non_compliant';
  }

  const recommendations: string[] = [];
  if (!nmasCompliant) {
    recommendations.push(`NMAS: only ${(nmasPassRate * 100).toFixed(1)}% of points within ${nmasThreshold.toFixed(3)}m — standard requires 90%`);
  }
  if (!oneThirdRuleCompliant) {
    recommendations.push(`1/3 rule: RMS vertical ${actualRMSVertical.toFixed(3)}m exceeds ${oneThirdThreshold.toFixed(3)}m (1/3 of ${standard.contourInterval}m contour interval)`);
  }
  if (!passesPositional) {
    recommendations.push(`Positional: RMS ${actualRMSHorizontal.toFixed(3)}m exceeds expected ${standard.positionalAccuracyM}m for ${mapScale}`);
  }
  if (!passesVertical) {
    recommendations.push(`Vertical: RMS ${actualRMSVertical.toFixed(3)}m exceeds expected ${standard.verticalAccuracyM}m for ${mapScale}`);
  }
  if (overallCompliance === 'compliant') {
    recommendations.push('All accuracy standards met — survey is compliant');
  }

  return {
    mapScale,
    contourInterval: standard.contourInterval,
    expectedPositionalAccuracyM: standard.positionalAccuracyM,
    expectedVerticalAccuracyM: standard.verticalAccuracyM,
    actualRMSHorizontal,
    actualRMSVertical,
    passesPositional,
    passesVertical,
    nmasCompliant,
    oneThirdRuleCompliant,
    overallCompliance,
    recommendations,
  };
}

// ─── Feature Coding Library (SoK Standard) ─────────────────────────────

export interface FeatureCode {
  code: string;
  description: string;
  category: FeatureCategory;
  layer: string;            // DXF layer name
  symbol?: string;          // symbol identifier
  isPoint: boolean;         // point vs line feature
  isBreakline: boolean;     // affects TIN generation
}

export type FeatureCategory =
  | 'control'
  | 'buildings'
  | 'roads'
  | 'water'
  | 'vegetation'
  | 'utilities'
  | 'boundaries'
  | 'relief'
  | 'structures'
  | 'miscellaneous';

export const FEATURE_CODES: FeatureCode[] = [
  // Control
  { code: 'CTRL', description: 'Control point — surveyed', category: 'control', layer: 'CONTROL', symbol: 'triangle', isPoint: true, isBreakline: false },
  { code: 'BM', description: 'Bench mark', category: 'control', layer: 'BENCHMARK', symbol: 'bm', isPoint: true, isBreakline: false },
  { code: 'TS', description: 'Triangulation station', category: 'control', layer: 'TRIANGULATION', symbol: 'triangle', isPoint: true, isBreakline: false },
  { code: 'PROM', description: 'Prominent point', category: 'control', layer: 'PROMINENT', isPoint: true, isBreakline: false },

  // Buildings
  { code: 'BLD', description: 'Building outline', category: 'buildings', layer: 'BUILDING', isPoint: false, isBreakline: true },
  { code: 'BLDC', description: 'Commercial building', category: 'buildings', layer: 'BUILDING_COMMERCIAL', isPoint: false, isBreakline: true },
  { code: 'BLDR', description: 'Residential building', category: 'buildings', layer: 'BUILDING_RESIDENTIAL', isPoint: false, isBreakline: true },
  { code: 'BLDI', description: 'Industrial building', category: 'buildings', layer: 'BUILDING_INDUSTRIAL', isPoint: false, isBreakline: true },
  { code: 'SCHL', description: 'School', category: 'buildings', layer: 'SCHOOL', isPoint: false, isBreakline: true },
  { code: 'CHRC', description: 'Church', category: 'buildings', layer: 'CHURCH', isPoint: false, isBreakline: true },
  { code: 'MOSQ', description: 'Mosque', category: 'buildings', layer: 'MOSQUE', isPoint: false, isBreakline: true },
  { code: 'HOSP', description: 'Hospital', category: 'buildings', layer: 'HOSPITAL', isPoint: false, isBreakline: true },

  // Roads
  { code: 'EDGE', description: 'Road edge', category: 'roads', layer: 'ROAD_EDGE', isPoint: false, isBreakline: true },
  { code: 'CL', description: 'Road centerline', category: 'roads', layer: 'ROAD_CENTERLINE', isPoint: false, isBreakline: false },
  { code: 'SHLD', description: 'Road shoulder', category: 'roads', layer: 'ROAD_SHOULDER', isPoint: false, isBreakline: true },
  { code: 'PATH', description: 'Footpath', category: 'roads', layer: 'FOOTPATH', isPoint: false, isBreakline: false },
  { code: 'TRACK', description: 'Track (unpaved road)', category: 'roads', layer: 'TRACK', isPoint: false, isBreakline: false },
  { code: 'PKNG', description: 'Parking area', category: 'roads', layer: 'PARKING', isPoint: false, isBreakline: false },
  { code: 'ROUND', description: 'Roundabout', category: 'roads', layer: 'ROUNDABOUT', isPoint: false, isBreakline: false },

  // Water
  { code: 'RIV', description: 'River (perennial)', category: 'water', layer: 'RIVER_PERENNIAL', isPoint: false, isBreakline: true },
  { code: 'RIVS', description: 'River (seasonal)', category: 'water', layer: 'RIVER_SEASONAL', isPoint: false, isBreakline: true },
  { code: 'STRM', description: 'Stream', category: 'water', layer: 'STREAM', isPoint: false, isBreakline: true },
  { code: 'LAKE', description: 'Lake shore', category: 'water', layer: 'LAKE', isPoint: false, isBreakline: true },
  { code: 'POND', description: 'Pond', category: 'water', layer: 'POND', isPoint: false, isBreakline: true },
  { code: 'SWMP', description: 'Swamp', category: 'water', layer: 'SWAMP', isPoint: false, isBreakline: false },
  { code: 'SPRG', description: 'Spring', category: 'water', layer: 'SPRING', symbol: 'spring', isPoint: true, isBreakline: false },
  { code: 'WELL', description: 'Well', category: 'water', layer: 'WELL', symbol: 'well', isPoint: true, isBreakline: false },
  { code: 'DAM', description: 'Dam wall', category: 'water', layer: 'DAM', isPoint: false, isBreakline: true },

  // Vegetation
  { code: 'TREE', description: 'Isolated tree', category: 'vegetation', layer: 'TREE', symbol: 'tree', isPoint: true, isBreakline: false },
  { code: 'WOOD', description: 'Woodland', category: 'vegetation', layer: 'WOODLAND', isPoint: false, isBreakline: false },
  { code: 'FOREST', description: 'Forest', category: 'vegetation', layer: 'FOREST', isPoint: false, isBreakline: false },
  { code: 'SCRUB', description: 'Scrub', category: 'vegetation', layer: 'SCRUB', isPoint: false, isBreakline: false },
  { code: 'GRASS', description: 'Grassland', category: 'vegetation', layer: 'GRASSLAND', isPoint: false, isBreakline: false },
  { code: 'CULT', description: 'Cultivated land', category: 'vegetation', layer: 'CULTIVATED', isPoint: false, isBreakline: false },
  { code: 'ORCH', description: 'Orchard', category: 'vegetation', layer: 'ORCHARD', isPoint: false, isBreakline: false },
  { code: 'HEDGE', description: 'Hedge', category: 'vegetation', layer: 'HEDGE', isPoint: false, isBreakline: true },

  // Utilities
  { code: 'POWER', description: 'Power line', category: 'utilities', layer: 'POWER_LINE', isPoint: false, isBreakline: false },
  { code: 'PYLN', description: 'Power line pylon', category: 'utilities', layer: 'POWER_PYLON', symbol: 'pylon', isPoint: true, isBreakline: false },
  { code: 'POLE', description: 'Utility pole', category: 'utilities', layer: 'UTILITY_POLE', symbol: 'pole', isPoint: true, isBreakline: false },
  { code: 'WPIPE', description: 'Water pipe', category: 'utilities', layer: 'WATER_PIPE', isPoint: false, isBreakline: false },
  { code: 'SEWER', description: 'Sewer line', category: 'utilities', layer: 'SEWER', isPoint: false, isBreakline: false },
  { code: 'GAS', description: 'Gas pipeline', category: 'utilities', layer: 'GAS_PIPE', isPoint: false, isBreakline: false },
  { code: 'TEL', description: 'Telephone line', category: 'utilities', layer: 'TELEPHONE', isPoint: false, isBreakline: false },
  { code: 'FH', description: 'Fire hydrant', category: 'utilities', layer: 'FIRE_HYDRANT', symbol: 'fh', isPoint: true, isBreakline: false },
  { code: 'MH', description: 'Manhole', category: 'utilities', layer: 'MANHOLE', symbol: 'mh', isPoint: true, isBreakline: false },

  // Boundaries
  { code: 'PLB', description: 'Parcel boundary', category: 'boundaries', layer: 'PARCEL_BDY', isPoint: false, isBreakline: false },
  { code: 'ADMB', description: 'Administrative boundary', category: 'boundaries', layer: 'ADMIN_BDY', isPoint: false, isBreakline: false },
  { code: 'RDB', description: 'Road reserve boundary', category: 'boundaries', layer: 'ROAD_RESERVE_BDY', isPoint: false, isBreakline: false },
  { code: 'RIVB', description: 'River reserve boundary', category: 'boundaries', layer: 'RIVER_RESERVE_BDY', isPoint: false, isBreakline: false },
  { code: 'FENCE', description: 'Fence', category: 'boundaries', layer: 'FENCE', isPoint: false, isBreakline: true },

  // Relief
  { code: 'SPOT', description: 'Spot height', category: 'relief', layer: 'SPOT_HEIGHT', isPoint: true, isBreakline: false },
  { code: 'BRK', description: 'Breakline', category: 'relief', layer: 'BREAKLINE', isPoint: false, isBreakline: true },
  { code: 'CLIFF', description: 'Cliff', category: 'relief', layer: 'CLIFF', isPoint: false, isBreakline: true },
  { code: 'DEPR', description: 'Depression', category: 'relief', layer: 'DEPRESSION', isPoint: false, isBreakline: true },
  { code: 'RIDGE', description: 'Ridge line', category: 'relief', layer: 'RIDGE', isPoint: false, isBreakline: true },
  { code: 'VALLEY', description: 'Valley line', category: 'relief', layer: 'VALLEY', isPoint: false, isBreakline: true },

  // Structures
  { code: 'WALL', description: 'Retaining wall', category: 'structures', layer: 'RETAINING_WALL', isPoint: false, isBreakline: true },
  { code: 'BRG', description: 'Bridge', category: 'structures', layer: 'BRIDGE', isPoint: false, isBreakline: true },
  { code: 'CULV', description: 'Culvert', category: 'structures', layer: 'CULVERT', isPoint: false, isBreakline: false },
  { code: 'TANK', description: 'Water tank', category: 'structures', layer: 'WATER_TANK', symbol: 'tank', isPoint: true, isBreakline: false },
  { code: 'TOWER', description: 'Tower', category: 'structures', layer: 'TOWER', symbol: 'tower', isPoint: true, isBreakline: false },
  { code: 'MAST', description: 'Mast', category: 'structures', layer: 'MAST', symbol: 'mast', isPoint: true, isBreakline: false },

  // Miscellaneous
  { code: 'POST', description: 'Post/pillar', category: 'miscellaneous', layer: 'POST', symbol: 'post', isPoint: true, isBreakline: false },
  { code: 'GATE', description: 'Gate', category: 'miscellaneous', layer: 'GATE', isPoint: false, isBreakline: false },
  { code: 'SIGN', description: 'Sign post', category: 'miscellaneous', layer: 'SIGN', symbol: 'sign', isPoint: true, isBreakline: false },
  { code: 'DUMP', description: 'Dump site', category: 'miscellaneous', layer: 'DUMP', isPoint: false, isBreakline: false },
  { code: 'GRAVE', description: 'Grave', category: 'miscellaneous', layer: 'GRAVE', symbol: 'grave', isPoint: true, isBreakline: false },
  { code: 'MISC', description: 'Miscellaneous feature', category: 'miscellaneous', layer: 'MISC', isPoint: false, isBreakline: false },
  { code: 'PIT', description: 'Pit / excavation', category: 'miscellaneous', layer: 'PIT', isPoint: false, isBreakline: true },
  { code: 'CAIRN', description: 'Cairn (stone marker)', category: 'miscellaneous', layer: 'CAIRN', symbol: 'cairn', isPoint: true, isBreakline: false },
];

export function getFeatureCodesByCategory(category: FeatureCategory): FeatureCode[] {
  return FEATURE_CODES.filter(fc => fc.category === category);
}

export function lookupFeatureCode(code: string): FeatureCode | undefined {
  return FEATURE_CODES.find(fc => fc.code === code.toUpperCase());
}

// ─── Topo Map QA Checklist ─────────────────────────────────────────────

export interface TopoQAChecklistItem {
  id: string;
  category: string;
  description: string;
  standard: string;
  required: boolean;
  status: 'pending' | 'verified' | 'failed' | 'not_applicable';
}

export function getTopoQAChecklist(mapScale: string): TopoQAChecklistItem[] {
  const standard = TOPO_MAP_STANDARDS.find(s => s.scale === mapScale)
    ?? TOPO_MAP_STANDARDS.find(s => s.scale === '1:1000')!;

  return [
    // Control
    {
      id: 'control-established',
      category: 'Control',
      description: `Control network established to ${CONTROL_SURVEY_CLASSES[standard.controlSurveyOrder].label} (${CONTROL_SURVEY_CLASSES[standard.controlSurveyOrder].horizontalAccuracy}mm + 1ppm)`,
      standard: CONTROL_SURVEY_CLASSES[standard.controlSurveyOrder].governingStandard,
      required: true,
      status: 'pending',
    },
    {
      id: 'control-verified',
      category: 'Control',
      description: 'Control points verified before survey commenced; residuals within tolerance',
      standard: 'SoK Practice Notes 2020',
      required: true,
      status: 'pending',
    },
    // Detail survey
    {
      id: 'detail-density',
      category: 'Detail Survey',
      description: `Detail point density: ≥${standard.spotHeightDensity} points/ha for spot heights`,
      standard: 'SoK Practice Notes 2020',
      required: true,
      status: 'pending',
    },
    {
      id: 'breaklines-captured',
      category: 'Detail Survey',
      description: 'All breaklines captured (top of slope, bottom of slope, road edges, building footprints)',
      standard: 'SoK Practice Notes 2020',
      required: true,
      status: 'pending',
    },
    {
      id: 'feature-codes',
      category: 'Detail Survey',
      description: 'All features coded with standard SoK feature codes (70 codes, 10 categories)',
      standard: 'SoK Feature Coding Library',
      required: true,
      status: 'pending',
    },
    // Contours
    {
      id: 'contour-interval',
      category: 'Contours',
      description: `Contour interval: ${standard.contourInterval}m; index contour every ${standard.indexContourInterval}th`,
      standard: 'SoK Topographical Map Standards',
      required: true,
      status: 'pending',
    },
    {
      id: 'contour-accuracy',
      category: 'Contours',
      description: `Contour vertical accuracy: RMS < 1/3 of contour interval (< ${(standard.contourInterval / 3).toFixed(3)}m)`,
      standard: 'Kenya Topographical Survey Guidelines',
      required: true,
      status: 'pending',
    },
    {
      id: 'contour-labeling',
      category: 'Contours',
      description: 'Contour labeling follows standard cartographic procedures; index contours labeled',
      standard: 'SoK Drafting Manual 2020',
      required: true,
      status: 'pending',
    },
    // Accuracy
    {
      id: 'nmas-positional',
      category: 'Accuracy',
      description: `NMAS positional: 90% of points within 0.5mm at scale (${standard.positionalAccuracyM}m)`,
      standard: 'National Map Accuracy Standards',
      required: true,
      status: 'pending',
    },
    {
      id: 'nmas-vertical',
      category: 'Accuracy',
      description: `NMAS vertical: 90% of elevations within 1/2 contour interval (${standard.contourInterval / 2}m)`,
      standard: 'National Map Accuracy Standards',
      required: true,
      status: 'pending',
    },
    // Deliverables
    {
      id: 'tin-quality',
      category: 'Deliverables',
      description: 'TIN generated from breakline-aware constrained Delaunay triangulation',
      standard: 'SoK Practice Notes 2020',
      required: true,
      status: 'pending',
    },
    {
      id: 'dem-resolution',
      category: 'Deliverables',
      description: `DEM grid resolution: ≤${(standard.scaleDenominator * 0.0005).toFixed(2)}m (0.5mm at map scale)`,
      standard: 'ASPRS Positional Accuracy Standards',
      required: true,
      status: 'pending',
    },
    {
      id: 'dxf-layers',
      category: 'Deliverables',
      description: 'DXF export with 61-layer SoK registry (proper colors, linetypes, text styles)',
      standard: 'SoK DXF Layer Registry',
      required: true,
      status: 'pending',
    },
    {
      id: 'gis-export',
      category: 'Deliverables',
      description: 'GIS export: GeoJSON, Shapefile (with attribute table)',
      standard: 'OGC Standards',
      required: true,
      status: 'pending',
    },
    // Metadata
    {
      id: 'metadata-complete',
      category: 'Metadata',
      description: 'Survey metadata: CRS, datum, projection, equipment, calibration, surveyor, date',
      standard: 'ISO 19157 Geographic Information — Data Quality',
      required: true,
      status: 'pending',
    },
    {
      id: 'qa-report',
      category: 'Metadata',
      description: 'GIS QA Report generated (PASS/CONDITIONAL/FAIL)',
      standard: 'SoK Practice Notes 2020',
      required: true,
      status: 'pending',
    },
  ];
}

// ─── Map Scale Recommendation ──────────────────────────────────────────

export interface ScaleRecommendation {
  recommendedScale: string;
  reason: string;
  alternatives: string[];
}

export function recommendMapScale(
  projectType: 'detailed_engineering' | 'site_planning' | 'route_survey' | 'master_planning' | 'regional_planning' | 'national_mapping',
  approximateArea?: number,  // hectares
): ScaleRecommendation {
  switch (projectType) {
    case 'detailed_engineering':
      return {
        recommendedScale: '1:500',
        reason: 'Detailed engineering design requires 0.5m contours and 0.25m positional accuracy',
        alternatives: ['1:250 (very detailed)', '1:1000 (less detailed)'],
      };
    case 'site_planning':
      return {
        recommendedScale: '1:1000',
        reason: 'Site planning for residential/commercial development — 0.5m contours, 0.5m positional accuracy',
        alternatives: ['1:500 (more detailed)', '1:2500 (less detailed)'],
      };
    case 'route_survey':
      return {
        recommendedScale: '1:2500',
        reason: 'Route survey per KETRACO Annex 6 — 2km wide corridor, 1m contours',
        alternatives: ['1:1000 (more detailed)', '1:5000 (less detailed)'],
      };
    case 'master_planning':
      return {
        recommendedScale: '1:5000',
        reason: 'Master planning for township/industrial area — 2m contours, 2.5m positional accuracy',
        alternatives: ['1:2500 (more detailed)', '1:10000 (less detailed)'],
      };
    case 'regional_planning':
      return {
        recommendedScale: '1:10000',
        reason: 'Regional planning for district/sub-county — 5m contours, 5m positional accuracy',
        alternatives: ['1:5000 (more detailed)', '1:25000 (less detailed)'],
      };
    case 'national_mapping':
      return {
        recommendedScale: '1:50000',
        reason: 'National topographical series (Kenya Y717) — 20m contours, 25m positional accuracy',
        alternatives: ['1:25000 (more detailed)', '1:100000 (less detailed)'],
      };
  }
}
