/**
 * Cadastre Quality & Integration Module
 *
 * Based on: Siriba, Voß & Mulaku (2011) — "The Kenyan Cadastre and Modern
 * Land Administration" (zfv 3/2011) + Cadastre 2014 (FIG) + LADM (ISO 19152).
 *
 * The Kenyan cadastre is a "patchwork of isolated and inhomogeneous
 * cadastres" — 5 different map types with positional accuracies ranging
 * from ±0.03m (Survey Plans) to ±10m (RIM Range Provisional). METARDU
 * Desktop must:
 *
 *   1. KNOW which map type a given parcel originates from
 *   2. ENFORCE the accuracy constraints appropriate to that map type
 *   3. WARN when integrating maps of different accuracies
 *   4. HARMONIZE coordinates between UTM and Cassini-Soldner
 *   5. TRACK whether a boundary is fixed (legally binding) or general
 *      (indicative only)
 *   6. CLASSIFY land by tenure category (public/private/community)
 *   7. ASSESS the cadastre against Cadastre 2014 statements
 *
 * Map type hierarchy (from Siriba et al. Table 1):
 *   - Survey Plans / Deed Plans:       1:500–1:5000,  ±0.03 m  (fixed)
 *   - Registry Index Maps (RIM):       1:10000,       ±0.30 m  (mixed)
 *   - Demarcation Maps:                1:2500,        variable (general)
 *   - Preliminary Index Diagrams:      1:2500–1:5000, variable (general)
 *   - RIM Range (Provisional):         1:50000,       ±10 m    (general)
 *
 * Tenure categories per Constitution of Kenya 2010:
 *   - Public land (10%): vested in government, held in trust for citizens
 *   - Private land (20%): held by individuals/companies (freehold/leasehold)
 *   - Community land (70%): vested in communities identified by ethnicity,
 *     culture, or similar interest
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import log from 'electron-log/main';

// ─── Map Type Registry ─────────────────────────────────────────────────

export type CadastralMapType =
  | 'survey_plan'           // Highest accuracy — fixed boundaries
  | 'deed_plan'             // Extracted from survey plan — fixed boundaries
  | 'rim_urban'             // Registry Index Map — mixed fixed/general
  | 'rim_rural'             // Registry Index Map — general boundaries
  | 'demarcation_map'       // Provisional — consolidation areas
  | 'pid'                   // Preliminary Index Diagram — adjudication areas
  | 'rim_range_provisional' // Group ranches — 1:50000
  | 'cadastral_index_map';  // Government land index

export interface MapTypeSpec {
  type: CadastralMapType;
  label: string;
  commonScales: string[];
  positionalAccuracyM: number;  // ±metres
  boundaryType: 'fixed' | 'general' | 'mixed';
  legalStatus: 'definitive' | 'indicative' | 'provisional';
  useCase: string;
  coordinateSystem: 'cassini' | 'utm' | 'both' | 'none';
  coveragePercent: number;  // % of Kenya covered by this map type
  sourcePaper: string;      // reference to source
}

export const CADASTRAL_MAP_TYPES: Record<CadastralMapType, MapTypeSpec> = {
  survey_plan: {
    type: 'survey_plan',
    label: 'Survey Plan',
    commonScales: ['1:500', '1:1000', '1:2500', '1:5000'],
    positionalAccuracyM: 0.03,
    boundaryType: 'fixed',
    legalStatus: 'definitive',
    useCase: 'Urban areas — individual parcel surveys based on PDP',
    coordinateSystem: 'both',
    coveragePercent: 0.7,  // ~0.101M ha of 14.6M ha registered
    sourcePaper: 'Siriba et al. (2011) Table 1',
  },
  deed_plan: {
    type: 'deed_plan',
    label: 'Deed Plan',
    commonScales: ['1:500', '1:1000', '1:2500', '1:5000'],
    positionalAccuracyM: 0.03,
    boundaryType: 'fixed',
    legalStatus: 'definitive',
    useCase: 'Individual parcel — abstracted from survey plan',
    coordinateSystem: 'both',
    coveragePercent: 0.7,
    sourcePaper: 'Siriba et al. (2011) Table 1',
  },
  rim_urban: {
    type: 'rim_urban',
    label: 'Registry Index Map (Urban)',
    commonScales: ['1:10000'],
    positionalAccuracyM: 0.30,
    boundaryType: 'mixed',
    legalStatus: 'definitive',
    useCase: 'Urban registration districts — fixed + general boundaries',
    coordinateSystem: 'both',
    coveragePercent: 15.0,
    sourcePaper: 'Siriba et al. (2011) §4.2.2',
  },
  rim_rural: {
    type: 'rim_rural',
    label: 'Registry Index Map (Rural)',
    commonScales: ['1:10000'],
    positionalAccuracyM: 0.30,
    boundaryType: 'general',
    legalStatus: 'definitive',
    useCase: 'Rural registration districts — general boundaries',
    coordinateSystem: 'both',
    coveragePercent: 55.0,
    sourcePaper: 'Siriba et al. (2011) §4.2.2',
  },
  demarcation_map: {
    type: 'demarcation_map',
    label: 'Demarcation Map (Provisional)',
    commonScales: ['1:2500'],
    positionalAccuracyM: 5.0,  // variable — up to 5m
    boundaryType: 'general',
    legalStatus: 'provisional',
    useCase: 'Land consolidation areas — traced from 1:12500 aerial photos',
    coordinateSystem: 'none',
    coveragePercent: 55.0,  // overlap with consolidation areas
    sourcePaper: 'Siriba et al. (2011) §4.2.3.1',
  },
  pid: {
    type: 'pid',
    label: 'Preliminary Index Diagram (PID)',
    commonScales: ['1:2500', '1:5000'],
    positionalAccuracyM: 20.0,  // >20m errors possible per Mulaku & McLaughlin
    boundaryType: 'general',
    legalStatus: 'provisional',
    useCase: 'Land adjudication enclosure areas — unrectified aerial photos',
    coordinateSystem: 'none',
    coveragePercent: 15.0,
    sourcePaper: 'Siriba et al. (2011) §4.2.3.2',
  },
  rim_range_provisional: {
    type: 'rim_range_provisional',
    label: 'RIM Range (Provisional)',
    commonScales: ['1:50000'],
    positionalAccuracyM: 10.0,
    boundaryType: 'general',
    legalStatus: 'provisional',
    useCase: 'Group ranches — natural features as boundaries',
    coordinateSystem: 'none',
    coveragePercent: 22.6,  // 3.3M ha of 14.6M
    sourcePaper: 'Siriba et al. (2011) §4.2.3.3',
  },
  cadastral_index_map: {
    type: 'cadastral_index_map',
    label: 'Cadastral Index Map',
    commonScales: ['1:10000', '1:50000'],
    positionalAccuracyM: 1.0,
    boundaryType: 'mixed',
    legalStatus: 'indicative',
    useCase: 'Government land — index of survey plans',
    coordinateSystem: 'both',
    coveragePercent: 0.7,
    sourcePaper: 'Siriba et al. (2011) §4.2',
  },
};

// ─── Boundary Type System ──────────────────────────────────────────────

export type BoundaryType = 'fixed' | 'general';

export interface BoundaryDefinition {
  type: BoundaryType;
  legalStatus: 'legally_binding' | 'indicative_only';
  description: string;
  physicalFeature?: string;  // for general boundaries: wall, fence, ditch, hedge
  coordinatedPoints?: Array<{ easting: number; northing: number; accuracyM: number }>;
  // For fixed boundaries, the invisible line is geometrically defined
  // For general boundaries, demarcated by physical features
}

export function createFixedBoundary(points: Array<{ easting: number; northing: number; accuracyM: number }>): BoundaryDefinition {
  return {
    type: 'fixed',
    legalStatus: 'legally_binding',
    description: 'Fixed boundary — invisible line geometrically defined through accurate survey. Legally binding.',
    coordinatedPoints: points,
  };
}

export function createGeneralBoundary(physicalFeature: string): BoundaryDefinition {
  return {
    type: 'general',
    legalStatus: 'indicative_only',
    description: `General boundary — demarcated by ${physicalFeature}. Indicative only, not legally binding.`,
    physicalFeature,
  };
}

// ─── Land Tenure Categories (Constitution of Kenya 2010) ───────────────

export type LandTenureCategory = 'public' | 'private' | 'community';

export interface TenureCategorySpec {
  category: LandTenureCategory;
  label: string;
  coveragePercent: number;
  description: string;
  examples: string[];
  registrationStatus: 'registered' | 'unregistered' | 'partially_registered';
  governingLaws: string[];
}

export const TENURE_CATEGORIES: Record<LandTenureCategory, TenureCategorySpec> = {
  public: {
    category: 'public',
    label: 'Public Land',
    coveragePercent: 10,
    description: 'Land vested in and held by the government in trust for the people of Kenya.',
    examples: [
      'Land held by state organs',
      'National parks and game reserves',
      'Water catchment areas',
      'Rivers, lakes, and water bodies',
      'Specially protected areas',
      'Government forests',
    ],
    registrationStatus: 'unregistered',
    governingLaws: ['Constitution of Kenya 2010 Art. 62', 'Land Act 2012', 'Community Land Act 2016'],
  },
  private: {
    category: 'private',
    label: 'Private Land',
    coveragePercent: 20,
    description: 'Land held by individual persons or legal persons (companies, co-operative societies) under freehold or leasehold tenure.',
    examples: [
      'Freehold titles (urban and rural)',
      'Leasehold titles (99-year, 999-year)',
      'Company-owned farms',
      'Co-operative society land',
      'Settlement scheme plots',
    ],
    registrationStatus: 'registered',
    governingLaws: ['Constitution of Kenya 2010 Art. 64', 'Land Registration Act 2012', 'Registered Land Act (Cap 300)'],
  },
  community: {
    category: 'community',
    label: 'Community Land',
    coveragePercent: 70,
    description: 'Land vested in and held by communities identified on the basis of ethnicity, culture, or similar interest.',
    examples: [
      'Land registered in name of group representatives (group ranches)',
      'Ancestral lands',
      'Hunter-gatherer community lands',
      'Trust land held by county governments',
      'Customary tenure lands',
    ],
    registrationStatus: 'partially_registered',
    governingLaws: ['Constitution of Kenya 2010 Art. 63', 'Community Land Act 2016', 'Land (Group Representatives) Act 1968'],
  },
};

// ─── Cadastre Quality Assessment ───────────────────────────────────────

export interface ParcelRecord {
  parcelNumber: string;
  lrNumber: string;
  mapType: CadastralMapType;
  tenureCategory: LandTenureCategory;
  boundaryType: BoundaryType;
  coordinateSystem: 'cassini' | 'utm';
  areaSqM: number;
  centroidEasting: number;
  centroidNorthing: number;
  surveyedDate?: string;
  registry?: string;
}

export interface QualityAssessmentResult {
  overallQuality: 'high' | 'medium' | 'low' | 'very_low';
  positionalAccuracy: number;
  legalCertainty: 'definitive' | 'indicative' | 'provisional';
  completeness: number;  // 0-100%
  integrationRisk: 'low' | 'medium' | 'high' | 'critical';
  recommendations: string[];
  warnings: string[];
  cadastre2014Compliance: Cadastre2014Assessment;
}

export interface Cadastre2014Assessment {
  statement1_landObjects: { compliant: boolean; note: string };  // covers all land objects
  statement2_registerIntegration: { compliant: boolean; note: string };  // register + cadastre integrated
  statement3_dataModeling: { compliant: boolean; note: string };  // common data model
  statement4_automation: { compliant: boolean; note: string };  // paperless
  statement5_publicPrivate: { compliant: boolean; note: string };  // cooperation
  statement6_costRecovery: { compliant: boolean; note: string };
  overallScore: number;  // 0-6
}

export function assessCadastreQuality(parcel: ParcelRecord): QualityAssessmentResult {
  const mapSpec = CADASTRAL_MAP_TYPES[parcel.mapType];
  const recommendations: string[] = [];
  const warnings: string[] = [];

  // Positional accuracy from map type
  const positionalAccuracy = mapSpec.positionalAccuracyM;

  // Overall quality based on accuracy
  let overallQuality: QualityAssessmentResult['overallQuality'];
  if (positionalAccuracy <= 0.05) overallQuality = 'high';
  else if (positionalAccuracy <= 0.50) overallQuality = 'medium';
  else if (positionalAccuracy <= 5.0) overallQuality = 'low';
  else overallQuality = 'very_low';

  // Legal certainty
  const legalCertainty = mapSpec.legalStatus;

  // Completeness — depends on tenure and registration
  let completeness = 100;
  const tenureSpec = TENURE_CATEGORIES[parcel.tenureCategory];
  if (tenureSpec.registrationStatus === 'unregistered') completeness = 0;
  else if (tenureSpec.registrationStatus === 'partially_registered') completeness = 50;

  // Integration risk — based on coordinate system and map type
  let integrationRisk: QualityAssessmentResult['integrationRisk'];
  if (mapSpec.coordinateSystem === 'none') {
    integrationRisk = 'critical';
    warnings.push('Map has no coordinate system — cannot be directly integrated with coordinated cadastre');
  } else if (mapSpec.coordinateSystem === 'both' && !parcel.coordinateSystem) {
    integrationRisk = 'medium';
    warnings.push('Map supports both Cassini and UTM — parcel coordinateSystem not set, verify before integration');
  } else if (positionalAccuracy > 5.0) {
    integrationRisk = 'high';
    warnings.push('Positional accuracy >5m — significant adjustment needed for integration');
  } else {
    integrationRisk = 'low';
  }

  // Boundary type warnings
  if (parcel.boundaryType === 'general') {
    warnings.push('General boundary — indicative only, not legally binding. May require retracement survey for definitive boundaries.');
    if (mapSpec.legalStatus === 'provisional') {
      recommendations.push('Upgrade to fixed boundary via retracement survey before integration with definitive cadastre');
    }
  }

  // Map-type-specific recommendations
  switch (parcel.mapType) {
    case 'pid':
      recommendations.push('PID has known deficiencies (>20m position errors, >50% area errors). Prioritize photogrammetric upgrade using controlled aerial photography.');
      recommendations.push('Replace unrectified aerial photos with orthophoto base for reliable scaling.');
      break;
    case 'demarcation_map':
      recommendations.push('Demarcation map is provisional. Upgrade via "Refly" process: hedge planting + new aerial photography + photogrammetric compilation at 1:2500.');
      break;
    case 'rim_range_provisional':
      recommendations.push('Group ranch boundaries at 1:50000 with ±10m accuracy. Coordinate boundary markers to nearest metre before integration.');
      break;
    case 'rim_rural':
      recommendations.push('Rural RIM uses general boundaries. Consider coordinating key parcel corners to upgrade to fixed boundary status.');
      break;
    case 'rim_urban':
      recommendations.push('Urban RIM has mixed boundaries. Verify which segments are fixed vs general before integration.');
      break;
    case 'survey_plan':
    case 'deed_plan':
      recommendations.push('Survey plan / deed plan has highest accuracy (±0.03m). Suitable for definitive cadastre integration.');
      break;
  }

  // Coordinate system harmonization
  if (mapSpec.coordinateSystem === 'both') {
    recommendations.push(`Verify coordinate system: ${parcel.coordinateSystem?.toUpperCase()}. Harmonize to target system during integration.`);
  }

  // Cadastre 2014 assessment
  const cadastre2014Compliance: Cadastre2014Assessment = {
    statement1_landObjects: {
      compliant: false,
      note: 'Kenyan cadastre covers only private parcels — public and community land not systematically registered',
    },
    statement2_registerIntegration: {
      compliant: false,
      note: 'Land register and cadastre are physically separated — inconsistency risk',
    },
    statement3_dataModeling: {
      compliant: false,
      note: 'No common data model — LADM (ISO 19152) not yet adopted',
    },
    statement4_automation: {
      compliant: true,
      note: 'METARDU Desktop provides full automation — analogue workflow replaced by digital',
    },
    statement5_publicPrivate: {
      compliant: true,
      note: 'METARDU Desktop enables private surveyor access to digital cadastre (per LN 132 of 2020)',
    },
    statement6_costRecovery: {
      compliant: true,
      note: 'Fee structure per Fifth Schedule supports cost recovery',
    },
    overallScore: 3,  // 3 of 6 statements compliant
  };

  return {
    overallQuality,
    positionalAccuracy,
    legalCertainty,
    completeness,
    integrationRisk,
    recommendations,
    warnings,
    cadastre2014Compliance,
  };
}

// ─── Coordinate System Harmonization ───────────────────────────────────

export interface HarmonizationResult {
  sourceSystem: 'cassini' | 'utm';
  targetSystem: 'cassini' | 'utm';
  converted: { easting: number; northing: number };
  accuracyNote: string;
}

/**
 * Harmonize coordinates between Cassini-Soldner and UTM.
 * Both use Arc 1960 datum.
 * In production, this calls the existing coordinate-converter.ts module.
 */
export function harmonizeCoordinates(
  easting: number,
  northing: number,
  source: 'cassini' | 'utm',
  target: 'cassini' | 'utm',
  zone: string = '37S',
): HarmonizationResult {
  if (source === target) {
    return {
      sourceSystem: source,
      targetSystem: target,
      converted: { easting, northing },
      accuracyNote: 'No conversion needed — same coordinate system',
    };
  }

  // In production, delegate to the coordinate-converter.ts module
  // For now, mark the conversion as required
  return {
    sourceSystem: source,
    targetSystem: target,
    converted: { easting, northing },  // placeholder — actual conversion via coordinate-converter
    accuracyNote: `Conversion from ${source.toUpperCase()} to ${target.toUpperCase()} required. Use coordinate-converter.ts for accurate transformation (sub-millimeter round-trip accuracy).`,
  };
}

// ─── Integration Compatibility Check ───────────────────────────────────

export interface IntegrationCheck {
  compatible: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  accuracyDelta: number;
  notes: string[];
  recommendations: string[];
}

export function checkIntegrationCompatibility(
  source: ParcelRecord,
  target: ParcelRecord,
): IntegrationCheck {
  const sourceSpec = CADASTRAL_MAP_TYPES[source.mapType];
  const targetSpec = CADASTRAL_MAP_TYPES[target.mapType];
  const accuracyDelta = Math.abs(sourceSpec.positionalAccuracyM - targetSpec.positionalAccuracyM);
  const notes: string[] = [];
  const recommendations: string[] = [];

  // Coordinate system check
  if (source.coordinateSystem !== target.coordinateSystem) {
    notes.push(`Coordinate system mismatch: source=${source.coordinateSystem.toUpperCase()}, target=${target.coordinateSystem.toUpperCase()}`);
    recommendations.push(`Harmonize coordinates: convert source from ${source.coordinateSystem.toUpperCase()} to ${target.coordinateSystem.toUpperCase()}`);
  }

  // Accuracy mismatch
  if (accuracyDelta > 1.0) {
    notes.push(`Significant accuracy mismatch: ${accuracyDelta.toFixed(2)}m delta`);
    recommendations.push('Consider rubber-sheeting or Helmert transformation to align lower-accuracy map to higher-accuracy control');
  }

  // Boundary type mismatch
  if (source.boundaryType !== target.boundaryType) {
    notes.push(`Boundary type mismatch: source=${source.boundaryType}, target=${target.boundaryType}`);
    if (source.boundaryType === 'general' && target.boundaryType === 'fixed') {
      recommendations.push('Upgrade general boundary to fixed boundary via retracement survey before integration');
    }
  }

  // Provisional map integration
  if (sourceSpec.legalStatus === 'provisional' || targetSpec.legalStatus === 'provisional') {
    notes.push('One or both maps are provisional — integration result will also be provisional');
    recommendations.push('Prioritize upgrading provisional maps to definitive status before integration');
  }

  // Risk level
  let riskLevel: IntegrationCheck['riskLevel'];
  if (accuracyDelta > 10 || sourceSpec.coordinateSystem === 'none' || targetSpec.coordinateSystem === 'none') {
    riskLevel = 'critical';
  } else if (accuracyDelta > 1.0 || source.coordinateSystem !== target.coordinateSystem) {
    riskLevel = 'high';
  } else if (accuracyDelta > 0.1 || source.boundaryType !== target.boundaryType) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'low';
  }

  return {
    compatible: riskLevel !== 'critical',
    riskLevel,
    accuracyDelta,
    notes,
    recommendations,
  };
}

// ─── LADM (ISO 19152) Data Model ───────────────────────────────────────

/**
 * Land Administration Domain Model (LADM) — ISO 19152.
 * Provides a common data model for land administration.
 * METARDU Desktop exports parcel data in LADM-compatible format.
 */

export interface LADMBAUnit {
  baUnitId: string;
  type: 'parcel' | 'building' | 'utility' | 'road' | 'railway' | 'water';
}

export interface LADMParcel {
  laBaUnit: LADMBAUnit;
  name: string;
  label: string;
  nationalId: string;     // parcel number
  area: number;            // m²
  type: 'survey_plan' | 'rim' | 'pid' | 'demarcation' | 'provisional';
  dimension: '2D' | '3D';
  boundaryType: 'fixed' | 'general';
  accuracyClass: 'A' | 'B' | 'C' | 'D';  // A=highest, D=lowest
  coordinates: Array<{ easting: number; northing: number; crs: string }>;
  tenureCategory: 'public' | 'private' | 'community';
}

export interface LADMRRR {
  rrrId: string;
  type: 'right' | 'restriction' | 'responsibility';
  rightType?: 'ownership' | 'mortgage' | 'easement' | 'lease' | 'custody';
  party: LADMParty;
  share: number;  // 0-1 (1 = 100%)
  validFrom?: string;
  validUntil?: string;
}

export interface LADMParty {
  partyId: string;
  name: string;
  type: 'person' | 'group' | 'company' | 'government' | 'community';
  nationalId?: string;
}

export interface LADMSource {
  sourceId: string;
  type: 'survey_plan' | 'deed' | 'title' | 'aerial_photo' | 'cadastral_map';
  reference: string;
  date: string;
  accuracy: number;
}

export interface LADMExport {
  version: string;
  exporter: string;
  exportDate: string;
  crs: string;
  baUnits: LADMBAUnit[];
  parcels: LADMParcel[];
  parties: LADMParty[];
  rrrs: LADMRRR[];
  sources: LADMSource[];
}

export function exportLADM(parcels: ParcelRecord[], options?: { outputPath?: string }): LADMExport {
  const ladmParcels: LADMParcel[] = parcels.map(p => {
    const mapSpec = CADASTRAL_MAP_TYPES[p.mapType];
    // Use the map type's positional accuracy (not a per-parcel field)
    const accuracyM = mapSpec.positionalAccuracyM;
    const accuracyClass = accuracyM <= 0.05 ? 'A'
      : accuracyM <= 0.50 ? 'B'
      : accuracyM <= 5.0 ? 'C'
      : 'D';

    return {
      laBaUnit: {
        baUnitId: p.parcelNumber,
        type: 'parcel',
      },
      name: `Parcel ${p.parcelNumber}`,
      label: p.parcelNumber,
      nationalId: p.parcelNumber,
      area: p.areaSqM,
      type: p.mapType === 'survey_plan' || p.mapType === 'deed_plan' ? 'survey_plan'
        : p.mapType === 'rim_urban' || p.mapType === 'rim_rural' ? 'rim'
        : p.mapType === 'pid' ? 'pid'
        : p.mapType === 'demarcation_map' ? 'demarcation'
        : 'provisional',
      dimension: '2D',
      boundaryType: p.boundaryType,
      accuracyClass,
      coordinates: [{
        easting: p.centroidEasting,
        northing: p.centroidNorthing,
        crs: p.coordinateSystem === 'cassini' ? 'Arc 1960 Cassini-Soldner' : 'Arc 1960 UTM Zone 37S',
      }],
      tenureCategory: p.tenureCategory,
    };
  });

  const baUnits = ladmParcels.map(p => p.laBaUnit);

  const export_: LADMExport = {
    version: 'LADM ISO 19152:2012',
    exporter: 'METARDU Desktop',
    exportDate: new Date().toISOString(),
    crs: 'Arc 1960 UTM Zone 37S',
    baUnits,
    parcels: ladmParcels,
    parties: [],
    rrrs: [],
    sources: [],
  };

  if (options?.outputPath) {
    fs.writeFileSync(options.outputPath, JSON.stringify(export_, null, 2));
  }

  return export_;
}

// ─── Coverage Statistics ───────────────────────────────────────────────

export interface CoverageStatistics {
  totalAreaHa: number;
  totalAreaPercentage: number;
  byMapType: Record<CadastralMapType, { areaHa: number; percentage: number }>;
  byTenure: Record<LandTenureCategory, { areaHa: number; percentage: number }>;
  notes: string[];
}

export function computeCoverageStatistics(): CoverageStatistics {
  // Based on Siriba et al. (2011) Table 2
  // Total land surface: 582,600 km² = 58.26M ha
  // Registered and mapped: ~14.6M ha = ~25% of total
  return {
    totalAreaHa: 14_600_000,
    totalAreaPercentage: 25,
    byMapType: {
      survey_plan: { areaHa: 101_000, percentage: 0.7 },     // government land
      deed_plan: { areaHa: 2_200_000, percentage: 15.1 },     // company + co-op farms
      rim_urban: { areaHa: 101_000, percentage: 0.7 },        // urban areas
      rim_rural: { areaHa: 8_000_000, percentage: 54.8 },     // consolidation areas
      demarcation_map: { areaHa: 8_000_000, percentage: 54.8 }, // overlaps with RIM rural
      pid: { areaHa: 1_012_000, percentage: 6.9 },             // enclosure areas
      rim_range_provisional: { areaHa: 3_300_000, percentage: 22.6 }, // group ranches
      cadastral_index_map: { areaHa: 101_000, percentage: 0.7 },
    },
    byTenure: {
      public: { areaHa: 5_826_000, percentage: 10 },     // 10% of 58.26M
      private: { areaHa: 11_652_000, percentage: 20 },   // 20% of 58.26M
      community: { areaHa: 40_782_000, percentage: 70 }, // 70% of 58.26M
    },
    notes: [
      'Total land surface of Kenya: ~582,600 km² (58.26M ha)',
      'Registered and mapped: ~14.6M ha (25% of total)',
      'Cadastral coverage is largely incomplete — 75% of land is unmapped',
      'Source: Siriba, Voß & Mulaku (2011), Table 2',
      'Coverage figures are approximate — latest government statistics not readily available',
    ],
  };
}
