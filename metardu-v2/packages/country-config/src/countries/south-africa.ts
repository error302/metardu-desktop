/**
 * South Africa survey configuration.
 *
 * Per master plan §8.4, South Africa uses the Lo coordinate system
 * (Gauss Conform / Transverse Mercator projection in 2°-longitude
 * belts). Historical Cape/Lo zones (EPSG:22275-22293) and modern
 * Hartebeesthoek94/Lo zones (EPSG:2050-2058) coexist — South Africa
 * is a first-class use case for legacy-to-modern re-establishment
 * tooling alongside Kenya's Cassini-to-UTM work.
 *
 * # Sources
 *
 *   - EPSG::2051 — Hartebeesthoek94 / Lo29 (Cape Town)
 *   - EPSG::2053 — Hartebeesthoek94 / Lo27 (Johannesburg / Pretoria)
 *   - Land Survey Act 8 of 1997 (South Africa)
 *   - South African Geomatics Council (SAGC) regulations
 *   - Chief Surveyor-General directives (drafting of SG Diagrams)
 *   - SANS 2814 — South African National Standard for survey accuracy
 */

import type {
  CountrySurveyConfig,
  ProjectionZone,
  ToleranceRule,
} from "../types.js";

// ─── Geodetic framework ──────────────────────────────────────────

/** Hartebeesthoek94 / Lo29 — Cape Town and Western Cape. EPSG::2051. */
const LO_29: ProjectionZone = {
  srid: 2051,
  name: "Hartebeesthoek94 / Lo29",
  method: "Transverse Mercator",
  central_meridian_deg: 29.0,
  latitude_of_origin_deg: 0.0,
  false_easting_m: 0.0,  // Lo system uses 0 false easting (origins on the CM)
  false_northing_m: 0.0,
  scale_factor: 1.0,
  ellipsoid: "WGS84",
};

/** Hartebeesthoek94 / Lo27 — Johannesburg / Pretoria / Gauteng. EPSG::2053. */
const LO_27: ProjectionZone = {
  srid: 2053,
  name: "Hartebeesthoek94 / Lo27",
  method: "Transverse Mercator",
  central_meridian_deg: 27.0,
  latitude_of_origin_deg: 0.0,
  false_easting_m: 0.0,
  false_northing_m: 0.0,
  scale_factor: 1.0,
  ellipsoid: "WGS84",
};

/** Hartebeesthoek94 / Lo31 — Durban / KwaZulu-Natal. EPSG::2055. */
const LO_31: ProjectionZone = {
  srid: 2055,
  name: "Hartebeesthoek94 / Lo31",
  method: "Transverse Mercator",
  central_meridian_deg: 31.0,
  latitude_of_origin_deg: 0.0,
  false_easting_m: 0.0,
  false_northing_m: 0.0,
  scale_factor: 1.0,
  ellipsoid: "WGS84",
};

// ─── Tolerance table ─────────────────────────────────────────────

/** Cadastral urban horizontal: 15mm (SANS 2814 Class A). */
const URBAN_CADASTRAL_HORIZONTAL: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "horizontal_position",
  formula: "15 mm (urban, SANS 2814 Class A)",
  compute: () => 0.015,
  unit: "m",
  source: "SANS 2814 Class A; Land Survey Act 8 of 1997, Regulation 9",
};

/** Cadastral rural horizontal: 60mm. */
const RURAL_CADASTRAL_HORIZONTAL: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "horizontal_position",
  formula: "60 mm (rural, SANS 2814 Class B)",
  compute: () => 0.060,
  unit: "m",
  source: "SANS 2814 Class B; Land Survey Act 8 of 1997, Regulation 9",
};

/** Engineering horizontal: 5mm (precise). */
const ENGINEERING_PRECISE_HORIZONTAL: ToleranceRule = {
  surveyType: "Engineering",
  toleranceType: "horizontal_position",
  formula: "5 mm (engineering precise, SANS 2814 Class AA)",
  compute: () => 0.005,
  unit: "m",
  source: "SANS 2814 Class AA",
};

/** Levelling tolerance: 4mm × √K (South African Class B). */
const LEVELLING_TOLERANCE: ToleranceRule = {
  surveyType: "Levelling",
  toleranceType: "levelling_misclosure",
  formula: "4 mm × √K (Class B)",
  compute: (input) => {
    const K = input.K_km ?? 0;
    return 4.0 * Math.sqrt(K);
  },
  unit: "mm",
  source: "SANS 2814 Class B (levelling); Land Survey Act 8 of 1997, Regulation 16",
};

/** Angular misclosure: 6″ × √N (SG directive). */
const ANGULAR_MISCLOSURE: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "angular_misclosure",
  formula: "6″ × √N",
  compute: (input) => {
    const N = input.N_stations ?? 0;
    return 6.0 * Math.sqrt(N);
  },
  unit: "arcsec",
  source: "Chief Surveyor-General directive on traverse closure; SANS 2814",
};

/** Linear misclosure for cadastral: 1:8000 (SG practice). */
const LINEAR_MISCLOSURE_CADASTRAL: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "linear_misclosure",
  formula: "1:8000 (cadastral traverse)",
  compute: (input) => {
    const length = input.total_length_m ?? 0;
    const misc = input.misclosure_m ?? 0;
    if (misc <= 0) return Number.POSITIVE_INFINITY;
    return length / misc;
  },
  unit: "ratio",
  source: "Chief Surveyor-General directive; Land Survey Act 8 of 1997, Regulation 9",
};

// ─── Statutory documents ─────────────────────────────────────────

/** SG Diagram — the primary cadastral survey output, bound with the deed. */
const SG_DIAGRAM = {
  docType: "SG Diagram",
  name: "Surveyor-General Diagram",
  citation: "Land Survey Act 8 of 1997, s. 1 (definition of 'diagram'); Regulation 7",
  sourcePath: "docs/regulatory-sources/za/sg-diagram-directive.pdf",
  pageSize: "A4",
  margins_mm: [25, 25, 25, 25] as [number, number, number, number],
  scaleConvention: "1:500, 1:1000, 1:2500, 1:5000 (per parcel size)",
  titleBlockFields: [
    "SG DIAGRAM NO.",
    "PROPERTY NAME / FARM NAME",
    "REGISTRATION DIVISION",
    "PROVINCE",
    "DISTRICT",
    "AREA (ha)",
    "SCALE",
    "SURVEYOR'S NAME",
    "SURVEYOR'S REG. NO. (PLATO)",
    "DATE OF SURVEY",
    "APPROVED (SG signature)",
  ],
  dxfLayers: [
    "BOUNDARY",
    "BEACON",
    "TEXT-SG",
    "TEXT-COORDS",
    "TEXT-AREA",
    "TITLE-BLOCK",
    "NORTH-ARROW",
    "SCALE-BAR",
  ],
  requiresProfessionalSeal: true,
};

/** General Plan — for un-individually-surveyed older stands within a township. */
const GENERAL_PLAN = {
  docType: "General Plan",
  name: "General Plan (township layout)",
  citation: "Land Survey Act 8 of 1997, s. 9; Regulation 7",
  sourcePath: "docs/regulatory-sources/za/general-plan-directive.pdf",
  pageSize: "A1",
  margins_mm: [20, 20, 20, 20] as [number, number, number, number],
  scaleConvention: "1:1000, 1:2000, 1:5000 (township scale)",
  titleBlockFields: [
    "GP NO.",
    "TOWNSHIP NAME",
    "REGISTRATION DIVISION",
    "PROVINCE",
    "PROCLAIMED DATE",
    "SCALE",
    "SURVEYOR'S NAME",
    "SURVEYOR'S REG. NO.",
    "DATE",
    "APPROVED (SG)",
  ],
  dxfLayers: [
    "STANDS-BOUNDARY",
    "STREETS",
    "BEACONS",
    "TEXT-STAND-NOS",
    "TEXT-STREET-NAMES",
    "TITLE-BLOCK",
    "NORTH-ARROW",
    "SCALE-BAR",
  ],
  requiresProfessionalSeal: true,
};

/** Sectional Title Plan — for sectional title schemes (units in a building). */
const SECTIONAL_TITLE_PLAN = {
  docType: "Sectional Plan",
  name: "Sectional Title Plan",
  citation: "Sectional Titles Act 95 of 1986 (as amended), s. 11",
  sourcePath: "docs/regulatory-sources/za/sectional-titles-act-1986.pdf",
  pageSize: "A3",
  margins_mm: [25, 25, 25, 25] as [number, number, number, number],
  scaleConvention: "1:100, 1:200 (floor plans); 1:1000 (site plan)",
  titleBlockFields: [
    "SECTIONAL PLAN NO.",
    "SCHEME NAME",
    "PROPERTY DESCRIPTION",
    "LOCAL AUTHORITY",
    "PROVINCE",
    "PARTICIPATION QUOTAS (per unit)",
    "SURVEYOR'S NAME",
    "SURVEYOR'S REG. NO.",
    "DATE",
    "APPROVED (SG)",
  ],
  dxfLayers: [
    "UNIT-BOUNDARY",
    "COMMON-PROPERTY",
    "TEXT-UNIT-NOS",
    "TEXT-PQ",
    "FLOOR-PLAN",
    "SITE-PLAN",
    "TITLE-BLOCK",
  ],
  requiresProfessionalSeal: true,
};

// ─── The canonical config ────────────────────────────────────────

export const SOUTH_AFRICA: CountrySurveyConfig = {
  countryCode: "ZA",
  countryName: "South Africa",
  regulatoryBody: [
    {
      name: "Chief Surveyor-General (South Africa)",
      url: "https://csg.dalrrd.gov.za/",
      scope: "national — cadastral survey examination & approval",
    },
    {
      name: "South African Geomatics Council (SAGC)",
      url: "https://www.sagc.org.za/",
      scope: "national — professional registration (PLATO)",
    },
  ],
  geodeticFramework: {
    datum: "Hartebeesthoek94",
    primarySRID: 2053,
    heightSystem: "SAVD (South African Vertical Datum, based on Land Levelling Survey)",
    projectionZones: [LO_27, LO_29, LO_31],
    legacyDatums: [
      {
        from: "Cape Datum",
        to: "Hartebeesthoek94",
        helmert: {
          // Cape → Hartebeesthoek94: average 7-parameter for SA (varies by region)
          // For survey-grade work, use the regional grid transformation
          // published by the Chief Surveyor-General.
          tx: -134.748, ty: -110.232, tz: -292.528,
          rx_arcsec: 0.0, ry_arcsec: 0.0, rz_arcsec: 0.463,
          scale_ppm: -1.043,
        },
        source: "Hartebeesthoek94 → Cape Datum (regional); Chief Surveyor-General publication 1999",
      },
      {
        from: "WGS84",
        to: "Hartebeesthoek94",
        helmert: {
          // Hartebeesthoek94 is essentially identical to WGS84 at the
          // sub-metre level; no Helmert required for survey-grade work.
          tx: 0.0, ty: 0.0, tz: 0.0,
          rx_arcsec: 0.0, ry_arcsec: 0.0, rz_arcsec: 0.0,
          scale_ppm: 0.0,
        },
        source: "Hartebeesthoek94 = WGS84 realization (sub-metre agreement)",
      },
    ],
  },
  toleranceTable: [
    LEVELLING_TOLERANCE,
    ANGULAR_MISCLOSURE,
    LINEAR_MISCLOSURE_CADASTRAL,
    URBAN_CADASTRAL_HORIZONTAL,
    RURAL_CADASTRAL_HORIZONTAL,
    ENGINEERING_PRECISE_HORIZONTAL,
  ],
  statutoryDocuments: [SG_DIAGRAM, GENERAL_PLAN, SECTIONAL_TITLE_PLAN],
  professionalBody: {
    name: "South African Geomatics Council (SAGC, formerly PLATO)",
    url: "https://www.sagc.org.za/",
    registrationNumberField: "PLATO Reg. No.",
    registrationPattern: "^PLATO/\\d{4,5}$",
  },
  sectionalPropertyRegime: {
    legislation: "Sectional Titles Act 95 of 1986 (as amended)",
    planType: "Sectional Title Plan",
    requiresParticipationQuotas: true,
    source: "Sectional Titles Act 95 of 1986, s. 11 (sectional plans) + s. 32 (participation quotas)",
  },
  sourceDocsRequired: [
    "Land Survey Act 8 of 1997 (South Africa)",
    "Land Survey Act Regulations (Government Notice R. 1088 of 1997)",
    "Chief Surveyor-General directive on SG Diagram drafting",
    "SANS 2814 (South African National Standard for survey accuracy)",
    "Sectional Titles Act 95 of 1986 (as amended)",
    "Sectional Titles Schemes Management Act 8 of 2011",
  ],
  version: "0.1.0",
  lastReviewed: "2026-07-19",
};
