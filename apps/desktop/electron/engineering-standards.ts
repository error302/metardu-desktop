/**
 * Engineering Standards Module — KeNHA / KeRRA / KURA / RDM 1.1 / ISO 4463
 *
 * Centralizes Kenyan engineering surveying standards so that every project
 * enforces the right tolerances and produces the right deliverables.
 *
 * Standards covered:
 *   - Road Design Manual (RDM) 1.1 (2025) — KeNHA/KeRRA/KURA
 *   - Specification for Road and Bridge Construction (Section 1800: Setting Out)
 *   - ISO 4463-1: Building setting out — measurement methods and tolerances
 *   - BS 5964: Building setting out (UK standard adopted in Kenya)
 *   - KeNHA Standard Specifications for Road and Bridge Works
 *   - Bridge Maintenance Management Guideline (roads.go.ke, 2025)
 *
 * Authority jurisdictions:
 *   - KeNHA: Class A, B, C roads (trunk roads)
 *   - KeRRA: Class D, E roads (rural roads)
 *   - KURA: Urban roads (Nairobi, Mombasa, Kisumu, etc.)
 *   - KWS: Roads in national parks and reserves
 *   - Private: Private access roads (industrial, residential)
 *
 * Each road class has its own design speed, design life, and survey tolerances.
 */

// ─── Road Authority & Classification ───────────────────────────────────

export type RoadAuthority = 'kenha' | 'kerra' | 'kura' | 'kws' | 'private';

export interface RoadAuthoritySpec {
  authority: RoadAuthority;
  label: string;
  fullName: string;
  jurisdiction: string;
  roadClasses: string[];
  governingDocument: string;
}

export const ROAD_AUTHORITIES: Record<RoadAuthority, RoadAuthoritySpec> = {
  kenha: {
    authority: 'kenha',
    label: 'KeNHA',
    fullName: 'Kenya National Highways Authority',
    jurisdiction: 'Trunk roads (Class A, B, C) — national network',
    roadClasses: ['A', 'B', 'C'],
    governingDocument: 'RDM 1.1 (2025) + Standard Specifications for Road and Bridge Works',
  },
  kerra: {
    authority: 'kerra',
    label: 'KeRRA',
    fullName: 'Kenya Rural Roads Authority',
    jurisdiction: 'Rural roads (Class D, E) — county and rural network',
    roadClasses: ['D', 'E'],
    governingDocument: 'RDM 1.1 (2025) + KeRRA Standard Specifications',
  },
  kura: {
    authority: 'kura',
    label: 'KURA',
    fullName: 'Kenya Urban Roads Authority',
    jurisdiction: 'Urban roads in cities and municipalities',
    roadClasses: ['A', 'B', 'C', 'D', 'E'],
    governingDocument: 'RDM 1.1 (2025) + KURA Standard Specifications',
  },
  kws: {
    authority: 'kws',
    label: 'KWS',
    fullName: 'Kenya Wildlife Service',
    jurisdiction: 'Roads within national parks and reserves',
    roadClasses: ['D', 'E'],
    governingDocument: 'KWS Internal Road Standards + RDM 1.1',
  },
  private: {
    authority: 'private',
    label: 'Private',
    fullName: 'Private Developer',
    jurisdiction: 'Private access roads (industrial, residential, agricultural)',
    roadClasses: ['E', 'F'],
    governingDocument: 'RDM 1.1 (2025) — adapted per developer requirements',
  },
};

// ─── Road Class & Design Standards ─────────────────────────────────────

export interface RoadClassSpec {
  roadClass: string;
  label: string;
  designSpeedKmH: number;
  designLifeYears: number;
  carriagewayWidth: number;        // metres
  shoulderWidth: number;            // metres
  minRadiusHorizontal: number;      // metres
  maxGradient: number;              // percent
  minStoppingSightDistance: number; // metres
  surveyTolerance: {
    horizontal: number;             // mm — staking tolerance
    vertical: number;               // mm — level tolerance
    crossfall: number;              // percent — pavement crossfall
  };
  examples: string[];
}

export const ROAD_CLASSES: Record<string, RoadClassSpec> = {
  A: {
    roadClass: 'A',
    label: 'Class A — Trunk Road',
    designSpeedKmH: 120,
    designLifeYears: 20,
    carriagewayWidth: 7.0,
    shoulderWidth: 2.5,
    minRadiusHorizontal: 580,
    maxGradient: 4,
    minStoppingSightDistance: 250,
    surveyTolerance: { horizontal: 10, vertical: 5, crossfall: 0.5 },
    examples: ['Nairobi–Mombasa Road (A8)', 'Nairobi–Thika Superhighway (A2)'],
  },
  B: {
    roadClass: 'B',
    label: 'Class B — Primary Trunk',
    designSpeedKmH: 100,
    designLifeYears: 20,
    carriagewayWidth: 7.0,
    shoulderWidth: 2.0,
    minRadiusHorizontal: 400,
    maxGradient: 5,
    minStoppingSightDistance: 200,
    surveyTolerance: { horizontal: 12, vertical: 5, crossfall: 0.5 },
    examples: ['Nakuru–Kisumu Road (B1)', 'Eldoret–Kitale Road (B2)'],
  },
  C: {
    roadClass: 'C',
    label: 'Class C — Secondary',
    designSpeedKmH: 80,
    designLifeYears: 15,
    carriagewayWidth: 6.5,
    shoulderWidth: 1.5,
    minRadiusHorizontal: 250,
    maxGradient: 6,
    minStoppingSightDistance: 140,
    surveyTolerance: { horizontal: 15, vertical: 8, crossfall: 0.5 },
    examples: ['Various county roads'],
  },
  D: {
    roadClass: 'D',
    label: 'Class D — Tertiary (Rural)',
    designSpeedKmH: 60,
    designLifeYears: 15,
    carriagewayWidth: 5.5,
    shoulderWidth: 1.0,
    minRadiusHorizontal: 130,
    maxGradient: 8,
    minStoppingSightDistance: 90,
    surveyTolerance: { horizontal: 20, vertical: 10, crossfall: 1.0 },
    examples: ['Rural feeder roads'],
  },
  E: {
    roadClass: 'E',
    label: 'Class E — Local (Rural)',
    designSpeedKmH: 50,
    designLifeYears: 10,
    carriagewayWidth: 5.0,
    shoulderWidth: 0.5,
    minRadiusHorizontal: 80,
    maxGradient: 10,
    minStoppingSightDistance: 65,
    surveyTolerance: { horizontal: 25, vertical: 10, crossfall: 1.0 },
    examples: ['Rural access roads'],
  },
  F: {
    roadClass: 'F',
    label: 'Class F — Track',
    designSpeedKmH: 30,
    designLifeYears: 10,
    carriagewayWidth: 4.0,
    shoulderWidth: 0.0,
    minRadiusHorizontal: 30,
    maxGradient: 12,
    minStoppingSightDistance: 35,
    surveyTolerance: { horizontal: 30, vertical: 15, crossfall: 2.0 },
    examples: ['Private access tracks'],
  },
};

// ─── Setting Out Tolerances (Section 1800 + ISO 4463) ──────────────────

export type StructureType =
  | 'road_pavement'
  | 'road_subgrade'
  | 'bridge_pier'
  | 'bridge_abutment'
  | 'bridge_deck'
  | 'culvert'
  | 'retaining_wall'
  | 'building_column'
  | 'building_wall'
  | 'foundation'
  | 'pile'
  | 'tunnel'
  | 'pipeline'
  | 'dam_spillway'
  | 'dam_embankment';

export interface ToleranceSpec {
  structure: StructureType;
  standard: 'RDM_1.1' | 'ISO_4463_1' | 'BS_5964' | 'KeNHA_Bridge';
  horizontalTolerance: number;     // mm
  verticalTolerance: number;       // mm
  angularTolerance: number;        // seconds
  measurementMethod: string;
  verificationFrequency: string;
  notes: string;
}

export const SETTING_OUT_TOLERANCES: Record<StructureType, ToleranceSpec> = {
  road_pavement: {
    structure: 'road_pavement',
    standard: 'RDM_1.1',
    horizontalTolerance: 10,
    verticalTolerance: 5,
    angularTolerance: 20,
    measurementMethod: 'Total station from control point; check by resection',
    verificationFrequency: 'Every 20m chainage + at all changes of cross-section',
    notes: 'Final pavement surface tolerance — most stringent. Check against string line for crossfall.',
  },
  road_subgrade: {
    structure: 'road_subgrade',
    standard: 'RDM_1.1',
    horizontalTolerance: 20,
    verticalTolerance: 10,
    angularTolerance: 30,
    measurementMethod: 'Total station or RTK-GNSS',
    verificationFrequency: 'Every 20m chainage',
    notes: 'Subgrade preparation tolerance — less stringent than pavement.',
  },
  bridge_pier: {
    structure: 'bridge_pier',
    standard: 'KeNHA_Bridge',
    horizontalTolerance: 5,
    verticalTolerance: 3,
    angularTolerance: 10,
    measurementMethod: 'Total station from 2 independent control points; cross-check',
    verificationFrequency: 'Each pier location + after concrete pour',
    notes: 'Bridge pier location tolerance per Section 1800. Critical for superstructure alignment.',
  },
  bridge_abutment: {
    structure: 'bridge_abutment',
    standard: 'KeNHA_Bridge',
    horizontalTolerance: 5,
    verticalTolerance: 3,
    angularTolerance: 10,
    measurementMethod: 'Total station from control points; verify bearing face orientation',
    verificationFrequency: 'Each abutment + after concrete pour',
    notes: 'Abutment position determines span length — must match design within ±5mm.',
  },
  bridge_deck: {
    structure: 'bridge_deck',
    standard: 'KeNHA_Bridge',
    horizontalTolerance: 8,
    verticalTolerance: 5,
    angularTolerance: 15,
    measurementMethod: 'Total station + level; check soffit level at each segment',
    verificationFrequency: 'Each deck segment',
    notes: 'Deck elevation critical for camber. Pre-camber per design to account for deflection.',
  },
  culvert: {
    structure: 'culvert',
    standard: 'RDM_1.1',
    horizontalTolerance: 15,
    verticalTolerance: 10,
    angularTolerance: 30,
    measurementMethod: 'Total station from chainage control',
    verificationFrequency: 'Each culvert location',
    notes: 'Culvert invert level critical for drainage. Check upstream/downstream grade.',
  },
  retaining_wall: {
    structure: 'retaining_wall',
    standard: 'RDM_1.1',
    horizontalTolerance: 15,
    verticalTolerance: 10,
    angularTolerance: 20,
    measurementMethod: 'Total station from control points',
    verificationFrequency: 'Every 10m of wall + at corners',
    notes: 'Wall face alignment and batter angle per design.',
  },
  building_column: {
    structure: 'building_column',
    standard: 'ISO_4463_1',
    horizontalTolerance: 5,
    verticalTolerance: 5,
    angularTolerance: 15,
    measurementMethod: 'Total station from building grid; plumb check with auto-plumb',
    verificationFrequency: 'Each column at every floor level',
    notes: 'Column centre must be within ±5mm of grid intersection per ISO 4463-1.',
  },
  building_wall: {
    structure: 'building_wall',
    standard: 'ISO_4463_1',
    horizontalTolerance: 10,
    verticalTolerance: 10,
    angularTolerance: 20,
    measurementMethod: 'Total station + string line',
    verificationFrequency: 'Every 5m of wall',
    notes: 'Wall straightness and plumb per BS 5964.',
  },
  foundation: {
    structure: 'foundation',
    standard: 'ISO_4463_1',
    horizontalTolerance: 15,
    verticalTolerance: 5,
    angularTolerance: 30,
    measurementMethod: 'Total station + precise level',
    verificationFrequency: 'Each foundation pad',
    notes: 'Foundation level critical — affects entire structure height.',
  },
  pile: {
    structure: 'pile',
    standard: 'ISO_4463_1',
    horizontalTolerance: 50,   // piles have larger tolerance
    verticalTolerance: 25,
    angularTolerance: 60,
    measurementMethod: 'Total station; verify pile position before and after driving',
    verificationFrequency: 'Each pile',
    notes: 'Pile position tolerance per ISO 4463-1 Table 2. Larger tolerance due to installation method.',
  },
  tunnel: {
    structure: 'tunnel',
    standard: 'ISO_4463_1',
    horizontalTolerance: 25,
    verticalTolerance: 15,
    angularTolerance: 10,
    measurementMethod: 'Total station from tunnel control network; laser scanning for profile',
    verificationFrequency: 'Every 5m advance',
    notes: 'Tunnel alignment critical — deviation affects clearance and ventilation.',
  },
  pipeline: {
    structure: 'pipeline',
    standard: 'RDM_1.1',
    horizontalTolerance: 50,
    verticalTolerance: 25,
    angularTolerance: 60,
    measurementMethod: 'RTK-GNSS + total station at bends',
    verificationFrequency: 'Every 50m + at all fittings',
    notes: 'Pipeline grade critical for gravity flow. Invert level ±25mm.',
  },
  dam_spillway: {
    structure: 'dam_spillway',
    standard: 'ISO_4463_1',
    horizontalTolerance: 10,
    verticalTolerance: 5,
    angularTolerance: 10,
    measurementMethod: 'Total station + precise level from dam axis control',
    verificationFrequency: 'Each spillway section',
    notes: 'Spillway crest level determines dam operation. Most critical dam component.',
  },
  dam_embankment: {
    structure: 'dam_embankment',
    standard: 'ISO_4463_1',
    horizontalTolerance: 50,
    verticalTolerance: 25,
    angularTolerance: 30,
    measurementMethod: 'RTK-GNSS + total station at corners',
    verificationFrequency: 'Every 10m grid + each lift',
    notes: 'Embankment dimensions and lift thickness per design.',
  },
};

// ─── As-Built Comparison (Design vs Actual) ────────────────────────────

export interface DesignPoint {
  pointId: string;
  designEasting: number;
  designNorthing: number;
  designElevation: number;
  structureType: StructureType;
  description?: string;
}

export interface AsBuiltPoint {
  pointId: string;
  measuredEasting: number;
  measuredNorthing: number;
  measuredElevation: number;
  measuredAt: string;  // ISO timestamp
  instrument?: string;
}

export interface ComparisonResult {
  pointId: string;
  design: DesignPoint;
  asBuilt: AsBuiltPoint;
  deltaE: number;           // mm
  deltaN: number;           // mm
  deltaZ: number;           // mm
  horizontalDelta: number;  // mm (sqrt(deltaE² + deltaN²))
  tolerance: ToleranceSpec;
  passes: boolean;          // within tolerance
  conformance: 'pass' | 'marginal' | 'fail';
  notes: string[];
}

export interface AsBuiltReport {
  project: string;
  surveyDate: string;
  surveyor: string;
  instrument: string;
  results: ComparisonResult[];
  summary: {
    totalPoints: number;
    passCount: number;
    marginalCount: number;
    failCount: number;
    passRate: number;       // percentage
    maxHorizontalDelta: number;
    maxVerticalDelta: number;
    rmsHorizontal: number;
    rmsVertical: number;
  };
  conformance: 'accepted' | 'accepted_with_conditions' | 'rejected';
  recommendations: string[];
}

export function compareDesignToAsBuilt(
  design: DesignPoint[],
  asBuilt: AsBuiltPoint[],
  defaultToleranceStructure: StructureType = 'road_pavement',
): AsBuiltReport {
  const results: ComparisonResult[] = [];
  const designMap = new Map(design.map(d => [d.pointId, d]));

  for (const ab of asBuilt) {
    const dp = designMap.get(ab.pointId);
    if (!dp) continue;

    const tolerance = SETTING_OUT_TOLERANCES[dp.structureType] ?? SETTING_OUT_TOLERANCES[defaultToleranceStructure];
    const deltaE = (ab.measuredEasting - dp.designEasting) * 1000;   // m → mm
    const deltaN = (ab.measuredNorthing - dp.designNorthing) * 1000;
    const deltaZ = (ab.measuredElevation - dp.designElevation) * 1000;
    const horizontalDelta = Math.sqrt(deltaE * deltaE + deltaN * deltaN);

    const passes = horizontalDelta <= tolerance.horizontalTolerance
      && Math.abs(deltaZ) <= tolerance.verticalTolerance;

    const conformance: ComparisonResult['conformance'] = passes
      ? (horizontalDelta > tolerance.horizontalTolerance * 0.8 ? 'marginal' : 'pass')
      : 'fail';

    const notes: string[] = [];
    if (conformance === 'fail') {
      notes.push(`Exceeds ${tolerance.standard} tolerance: H=${horizontalDelta.toFixed(1)}mm > ${tolerance.horizontalTolerance}mm`);
      if (Math.abs(deltaZ) > tolerance.verticalTolerance) {
        notes.push(`Vertical deviation: ${Math.abs(deltaZ).toFixed(1)}mm > ${tolerance.verticalTolerance}mm`);
      }
    } else if (conformance === 'marginal') {
      notes.push(`Within tolerance but >80% of limit — monitor`);
    }

    results.push({
      pointId: ab.pointId,
      design: dp,
      asBuilt: ab,
      deltaE,
      deltaN,
      deltaZ,
      horizontalDelta,
      tolerance,
      passes: conformance !== 'fail',
      conformance,
      notes,
    });
  }

  const passCount = results.filter(r => r.conformance === 'pass').length;
  const marginalCount = results.filter(r => r.conformance === 'marginal').length;
  const failCount = results.filter(r => r.conformance === 'fail').length;
  const maxH = Math.max(...results.map(r => r.horizontalDelta), 0);
  const maxV = Math.max(...results.map(r => Math.abs(r.deltaZ)), 0);
  const rmsH = Math.sqrt(results.reduce((s, r) => s + r.horizontalDelta * r.horizontalDelta, 0) / results.length);
  const rmsV = Math.sqrt(results.reduce((s, r) => s + r.deltaZ * r.deltaZ, 0) / results.length);

  const passRate = results.length > 0 ? (passCount / results.length) * 100 : 0;
  const conformance: AsBuiltReport['conformance'] = failCount === 0
    ? 'accepted'
    : (failCount <= results.length * 0.05 ? 'accepted_with_conditions' : 'rejected');

  const recommendations: string[] = [];
  if (failCount > 0) {
    recommendations.push(`${failCount} point(s) exceed tolerance — investigate and re-stake`);
  }
  if (marginalCount > results.length * 0.2) {
    recommendations.push(`${marginalCount} point(s) are marginal (>80% of limit) — increase monitoring frequency`);
  }
  if (rmsH > 5) {
    recommendations.push(`Horizontal RMS = ${rmsH.toFixed(2)}mm — check instrument calibration and setup`);
  }
  if (conformance === 'rejected') {
    recommendations.push('As-built rejected — re-stake failed points and re-survey');
  }

  return {
    project: 'As-Built Survey',
    surveyDate: new Date().toISOString(),
    surveyor: '',
    instrument: '',
    results,
    summary: {
      totalPoints: results.length,
      passCount,
      marginalCount,
      failCount,
      passRate,
      maxHorizontalDelta: maxH,
      maxVerticalDelta: maxV,
      rmsHorizontal: rmsH,
      rmsVertical: rmsV,
    },
    conformance,
    recommendations,
  };
}

// ─── Machine Control Validation ────────────────────────────────────────

export type MachineControlFormat = 'landxml' | 'dxf' | 'trimble' | 'leica' | 'topcon' | 'generic';

export interface MachineControlValidationResult {
  format: MachineControlFormat;
  totalPoints: number;
  validatedPoints: number;
  errors: string[];
  warnings: string[];
  passes: boolean;
  validationChecks: Array<{
    check: string;
    passed: boolean;
    details: string;
  }>;
}

/**
 * Validate machine control data before deployment to construction equipment.
 * Checks:
 *   - All design points have valid coordinates (not null, not 0)
 *   - Chainage sequence is monotonically increasing
 *   - Offsets are within road reserve boundary
 *   - Design levels are within ±50m of existing ground (sanity check)
 *   - All curve elements have valid radius (> 0)
 *   - Crossfall is within design limits (max 7%)
 *   - No duplicate chainages
 */
export function validateMachineControlData(
  alignment: {
    points: Array<{ chainage: number; easting: number; northing: number; elevation: number; offset?: number; crossfall?: number }>;
    curves?: Array<{ startChainage: number; endChainage: number; radius: number }>;
    roadReserveWidth?: number;
  },
  format: MachineControlFormat = 'landxml',
  existingGroundLevels?: Map<number, number>,
): MachineControlValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: MachineControlValidationResult['validationChecks'] = [];

  // Check 1: All points have valid coordinates
  const nullCoords = alignment.points.filter(p => p.easting === 0 || p.northing === 0 || isNaN(p.easting) || isNaN(p.northing));
  checks.push({
    check: 'All points have valid coordinates',
    passed: nullCoords.length === 0,
    details: nullCoords.length === 0 ? `${alignment.points.length} points OK` : `${nullCoords.length} points with null/zero coordinates`,
  });
  if (nullCoords.length > 0) errors.push(`${nullCoords.length} points have invalid coordinates`);

  // Check 2: Chainage monotonicity
  let chainageOk = true;
  const duplicateChainages: number[] = [];
  for (let i = 1; i < alignment.points.length; i++) {
    if (alignment.points[i].chainage <= alignment.points[i - 1].chainage) {
      chainageOk = false;
      if (alignment.points[i].chainage === alignment.points[i - 1].chainage) {
        duplicateChainages.push(alignment.points[i].chainage);
      }
    }
  }
  checks.push({
    check: 'Chainage sequence is monotonically increasing',
    passed: chainageOk,
    details: chainageOk ? 'OK' : 'Non-monotonic chainage detected',
  });
  if (!chainageOk) errors.push('Chainage sequence is not monotonic');

  // Check 3: No duplicate chainages
  checks.push({
    check: 'No duplicate chainages',
    passed: duplicateChainages.length === 0,
    details: duplicateChainages.length === 0 ? 'OK' : `${duplicateChainages.length} duplicate chainages`,
  });
  if (duplicateChainages.length > 0) warnings.push(`Duplicate chainages: ${duplicateChainages.slice(0, 5).join(', ')}`);

  // Check 4: Curve radii valid
  let curvesOk = true;
  if (alignment.curves) {
    for (const c of alignment.curves) {
      if (c.radius <= 0) {
        curvesOk = false;
        errors.push(`Curve at CH ${c.startChainage} has radius ${c.radius}`);
      }
    }
  }
  checks.push({
    check: 'All curves have valid radius',
    passed: curvesOk,
    details: curvesOk ? `${alignment.curves?.length ?? 0} curves OK` : 'Invalid curve radius detected',
  });

  // Check 5: Crossfall within limits
  const maxCrossfall = 7;  // percent
  const badCrossfall = alignment.points.filter(p => p.crossfall != null && Math.abs(p.crossfall) > maxCrossfall);
  checks.push({
    check: `Crossfall within ±${maxCrossfall}%`,
    passed: badCrossfall.length === 0,
    details: badCrossfall.length === 0 ? 'OK' : `${badCrossfall.length} points exceed ${maxCrossfall}% crossfall`,
  });
  if (badCrossfall.length > 0) warnings.push(`${badCrossfall.length} points exceed ${maxCrossfall}% crossfall — superelevation check needed`);

  // Check 6: Design levels sanity (vs existing ground)
  let levelCheckPassed = true;
  let levelCheckDetails = 'Skipped — no existing ground data';
  if (existingGroundLevels && existingGroundLevels.size > 0) {
    const bigDeviations: number[] = [];
    for (const p of alignment.points) {
      const eg = existingGroundLevels.get(p.chainage);
      if (eg != null && Math.abs(p.elevation - eg) > 50) {
        bigDeviations.push(p.chainage);
      }
    }
    levelCheckPassed = bigDeviations.length === 0;
    levelCheckDetails = bigDeviations.length === 0 ? 'All design levels within 50m of existing' : `${bigDeviations.length} points deviate >50m from existing ground`;
    if (bigDeviations.length > 0) warnings.push(`${bigDeviations.length} design levels deviate >50m from existing ground — verify`);
  }
  checks.push({
    check: 'Design levels within ±50m of existing ground (sanity)',
    passed: levelCheckPassed,
    details: levelCheckDetails,
  });

  // Check 7: Offsets within road reserve
  let offsetCheckPassed = true;
  let offsetCheckDetails = 'Skipped — no road reserve width';
  if (alignment.roadReserveWidth) {
    const halfWidth = alignment.roadReserveWidth / 2;
    const badOffsets = alignment.points.filter(p => p.offset != null && Math.abs(p.offset) > halfWidth);
    offsetCheckPassed = badOffsets.length === 0;
    offsetCheckDetails = badOffsets.length === 0 ? 'All offsets within reserve' : `${badOffsets.length} points outside road reserve`;
    if (badOffsets.length > 0) warnings.push(`${badOffsets.length} points are outside the ${alignment.roadReserveWidth}m road reserve`);
  }
  checks.push({
    check: 'All offsets within road reserve',
    passed: offsetCheckPassed,
    details: offsetCheckDetails,
  });

  const passes = errors.length === 0;

  return {
    format,
    totalPoints: alignment.points.length,
    validatedPoints: alignment.points.length,
    errors,
    warnings,
    passes,
    validationChecks: checks,
  };
}

// ─── Engineering QA Checklist ──────────────────────────────────────────

export interface QAChecklistItem {
  id: string;
  category: string;
  description: string;
  standard: string;
  required: boolean;
  status: 'pending' | 'verified' | 'failed' | 'not_applicable';
  notes?: string;
}

export function getEngineeringQAChecklist(projectType: 'road' | 'bridge' | 'building' | 'dam' | 'pipeline'): QAChecklistItem[] {
  const common: QAChecklistItem[] = [
    {
      id: 'control-network',
      category: 'Control',
      description: 'Control network established with minimum 3 points, verified before each session',
      standard: 'ISO 4463-1',
      required: true,
      status: 'pending',
    },
    {
      id: 'instrument-calibration',
      category: 'Equipment',
      description: 'Total station calibrated within 12 months; collimation error < 5"',
      standard: 'RDM 1.1',
      required: true,
      status: 'pending',
    },
    {
      id: 'backsight-check',
      category: 'Setup',
      description: 'Backsight check before each station setup; residual < 5mm',
      standard: 'RDM 1.1',
      required: true,
      status: 'pending',
    },
  ];

  const projectSpecific: Record<string, QAChecklistItem[]> = {
    road: [
      {
        id: 'alignment-design',
        category: 'Design',
        description: 'Horizontal alignment design with curves per design speed; min radius verified',
        standard: 'RDM 1.1 Part 1',
        required: true,
        status: 'pending',
      },
      {
        id: 'staking-table',
        category: 'Setting Out',
        description: 'Staking table generated: 10m tangents, 5m curves',
        standard: 'RDM 1.1',
        required: true,
        status: 'pending',
      },
      {
        id: 'cross-sections',
        category: 'Survey',
        description: 'Cross-sections at 20m intervals (50m in flat terrain)',
        standard: 'RDM 1.1',
        required: true,
        status: 'pending',
      },
      {
        id: 'earthworks',
        category: 'Computation',
        description: 'Earthworks computed by prismoidal method; < 5% error',
        standard: 'RDM 1.1',
        required: true,
        status: 'pending',
      },
      {
        id: 'machine-control',
        category: 'Export',
        description: 'Machine control data exported (7 formats) and validated',
        standard: 'RDM 1.1',
        required: true,
        status: 'pending',
      },
      {
        id: 'as-built',
        category: 'Completion',
        description: 'As-built survey: ±10mm H, ±5mm V tolerance',
        standard: 'RDM 1.1',
        required: true,
        status: 'pending',
      },
    ],
    bridge: [
      {
        id: 'pier-locations',
        category: 'Setting Out',
        description: 'Bridge pier locations set out within ±5mm; verified from 2 control points',
        standard: 'KeNHA Bridge Specs §1800',
        required: true,
        status: 'pending',
      },
      {
        id: 'abutment-bearings',
        category: 'Setting Out',
        description: 'Abutment bearing face orientation verified; span length within ±5mm of design',
        standard: 'KeNHA Bridge Specs §1800',
        required: true,
        status: 'pending',
      },
      {
        id: 'deck-camber',
        category: 'Construction',
        description: 'Deck camber set per design to account for deflection',
        standard: 'KeNHA Bridge Specs',
        required: true,
        status: 'pending',
      },
      {
        id: 'pile-positions',
        category: 'Setting Out',
        description: 'Pile positions verified before and after driving; within ±50mm',
        standard: 'ISO 4463-1',
        required: true,
        status: 'pending',
      },
    ],
    building: [
      {
        id: 'building-grid',
        category: 'Setting Out',
        description: 'Building grid established; column centres within ±5mm of grid intersection',
        standard: 'ISO 4463-1',
        required: true,
        status: 'pending',
      },
      {
        id: 'column-plumb',
        category: 'Construction',
        description: 'Column plumb verified at each floor level; within ±5mm per 3m height',
        standard: 'BS 5964',
        required: true,
        status: 'pending',
      },
      {
        id: 'floor-level',
        category: 'Construction',
        description: 'Floor level within ±5mm of design; checked with precise level',
        standard: 'ISO 4463-1',
        required: true,
        status: 'pending',
      },
    ],
    dam: [
      {
        id: 'dam-axis',
        category: 'Setting Out',
        description: 'Dam axis established with 1st-order GNSS; verified against national control',
        standard: 'ISO 4463-1',
        required: true,
        status: 'pending',
      },
      {
        id: 'spillway-crest',
        category: 'Setting Out',
        description: 'Spillway crest level set within ±5mm; most critical dam component',
        standard: 'ISO 4463-1',
        required: true,
        status: 'pending',
      },
      {
        id: 'embankment-lifts',
        category: 'Construction',
        description: 'Embankment lift thickness verified per spec (typically 300mm)',
        standard: 'Dam Design Spec',
        required: true,
        status: 'pending',
      },
    ],
    pipeline: [
      {
        id: 'pipeline-grade',
        category: 'Setting Out',
        description: 'Pipeline grade verified every 50m; invert level within ±25mm',
        standard: 'RDM 1.1',
        required: true,
        status: 'pending',
      },
      {
        id: 'trench-alignment',
        category: 'Construction',
        description: 'Trench alignment within ±50mm horizontal',
        standard: 'RDM 1.1',
        required: true,
        status: 'pending',
      },
    ],
  };

  return [...common, ...(projectSpecific[projectType] ?? [])];
}
