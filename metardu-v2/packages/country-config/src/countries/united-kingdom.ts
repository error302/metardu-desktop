/**
 * United Kingdom survey configuration.
 *
 * Per master plan §8.3, the UK does NOT operate a fixed-boundaries
 * cadastral system. HM Land Registry works on a "general boundaries"
 * rule (registered title plans show approximate, not legally
 * definitive, boundary lines). This changes what a "cadastral
 * module" means in the UK — it is closer to a boundary-identification
 * / measured-survey deliverable feeding conveyancing than a statutory
 * coordinate lodgment.
 *
 * Topographic and engineering/construction setting-out workflows
 * translate more directly. The cadastral workflow will be added when
 * RICS's current Measured Surveys specification is filed.
 *
 * # Sources
 *
 *   - EPSG::27700 — OSGB36 / British National Grid
 *   - EPSG::7405 — OSGB36 / British National Grid (7405)
 *   - OS Net CORS network (Ordnance Survey's GNSS infrastructure)
 *   - RICS Measured Surveys of Land, Buildings and Utilities, 3rd ed.
 *   - Land Registration Act 2002 (UK)
 *   - RICS Boundary Determination guidance note
 */

import type {
  CountrySurveyConfig,
  ProjectionZone,
  ToleranceRule,
} from "../types.js";

// ─── Geodetic framework ──────────────────────────────────────────

/** OSGB36 / British National Grid — the standard UK projected CRS. EPSG::27700. */
const BNG: ProjectionZone = {
  srid: 27700,
  name: "OSGB36 / British National Grid",
  method: "Transverse Mercator",
  central_meridian_deg: -2.0,
  latitude_of_origin_deg: 49.0,
  false_easting_m: 400_000.0,
  false_northing_m: -100_000.0,
  scale_factor: 0.999_601_271_7,
  ellipsoid: "Airy 1830",
};

/** ETRS89 — the European GNSS datum, realized in UK via OS Net CORS. EPSG::4258. */
// (Used as the GNSS-native datum; transformations to OSGB36 use the
// OSTN15 grid — a 1km-resolution grid of shifts.)
const ETRS89_SRID = 4258;

// ─── Tolerance table ─────────────────────────────────────────────

/** Topographic survey horizontal: 30mm + 50ppm (RICS Class A). */
const TOPOGRAPHIC_CLASS_A: ToleranceRule = {
  surveyType: "Topographic",
  toleranceType: "horizontal_position",
  formula: "30 mm + 50 ppm (RICS Class A urban)",
  compute: (input) => {
    // Approximation: 30mm + 50ppm of distance from control.
    // For a 1km baseline, 50ppm = 50mm; total ~80mm.
    const baseline_m = input.total_length_m ?? 1000;
    return 0.030 + 50e-6 * baseline_m;
  },
  unit: "m",
  source: "RICS Measured Surveys of Land, Buildings and Utilities, 3rd ed., Table 1",
};

/** Engineering survey horizontal: 5mm + 20ppm (RICS Class A engineering). */
const ENGINEERING_CLASS_A: ToleranceRule = {
  surveyType: "Engineering",
  toleranceType: "horizontal_position",
  formula: "5 mm + 20 ppm (RICS engineering Class A)",
  compute: (input) => {
    const baseline_m = input.total_length_m ?? 100;
    return 0.005 + 20e-6 * baseline_m;
  },
  unit: "m",
  source: "RICS Measured Surveys 3rd ed., Table 1 (engineering)",
};

/** Setting-out horizontal: 10mm (RICS setting-out guidance). */
const SETTING_OUT_HORIZONTAL: ToleranceRule = {
  surveyType: "Construction",
  toleranceType: "horizontal_position",
  formula: "10 mm (setting-out, structural)",
  compute: () => 0.010,
  unit: "m",
  source: "RICS Setting Out Guidance Note, 2nd ed.",
};

/** Levelling tolerance: 4mm × √K (UK Class II levelling, BS 7334). */
const LEVELLING_TOLERANCE: ToleranceRule = {
  surveyType: "Levelling",
  toleranceType: "levelling_misclosure",
  formula: "4 mm × √K (Class II)",
  compute: (input) => {
    const K = input.K_km ?? 0;
    return 4.0 * Math.sqrt(K);
  },
  unit: "mm",
  source: "BS 7334-2:1990 (UK Class II levelling); RICS Measured Surveys 3rd ed.",
};

/** Boundary determination: not a numeric tolerance — general boundaries rule. */
const BOUNDARY_GENERAL_RULE: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "boundary_determination",
  formula: "n/a — general boundaries rule (no coordinate-defined boundaries)",
  compute: () => Number.NaN,
  unit: "n/a",
  source: "Land Registration Act 2002 (UK), s. 60 — general boundaries rule",
};

// ─── Statutory documents ─────────────────────────────────────────

/** HM Land Registry Title Plan — the registered title plan showing the property's position. */
const TITLE_PLAN = {
  docType: "Title Plan",
  name: "HM Land Registry Title Plan",
  citation: "Land Registration Act 2002 (UK), s. 66 + Land Registration Rules 2003, r. 8",
  sourcePath: "docs/regulatory-sources/uk/title-plan-spec.pdf",
  pageSize: "A4",
  margins_mm: [10, 10, 10, 10] as [number, number, number, number],
  scaleConvention: "1:1250 (urban), 1:2500 (rural), 1:10000 (remote)",
  titleBlockFields: [
    "TITLE NUMBER",
    "PROPERTY ADDRESS",
    "ORDNANCE SURVEY MAP REFERENCE",
    "SCALE",
    "EDITION",
    "DATE",
  ],
  dxfLayers: [
    "BOUNDARY-GENERAL",
    "PROPERTY-OUTLINE",
    "TEXT-TITLE",
    "TEXT-ADDRESS",
    "NORTH-ARROW",
    "SCALE-BAR",
  ],
  // NOTE: UK title plans do NOT require a surveyor's seal — they're
  // produced by HM Land Registry, not by a private surveyor. The
  // underlying measured survey (if any) is a separate deliverable.
  requiresProfessionalSeal: false,
};

/** RICS Measured Survey Report — the surveyor's deliverable, not statutory. */
const MEASURED_SURVEY_REPORT = {
  docType: "Measured Survey Report",
  name: "RICS Measured Survey Report",
  citation: "RICS Measured Surveys of Land, Buildings and Utilities, 3rd ed.",
  sourcePath: "docs/regulatory-sources/uk/measured-surveys-rics.pdf",
  pageSize: "A4",
  margins_mm: [25, 25, 25, 25] as [number, number, number, number],
  scaleConvention: "variable (project-specific)",
  titleBlockFields: [
    "PROJECT NAME",
    "CLIENT",
    "SURVEYOR (RICS)",
    "RICS REG. NO.",
    "DATE OF SURVEY",
    "SURVEY CLASSIFICATION (A/B/C)",
  ],
  dxfLayers: [
    "TOPOGRAPHY",
    "BUILDING-OUTLINE",
    "UTILITIES",
    "TEXT-LABELS",
    "CONTROL",
    "TITLE-BLOCK",
  ],
  requiresProfessionalSeal: true,
};

// ─── The canonical config ────────────────────────────────────────

export const UNITED_KINGDOM: CountrySurveyConfig = {
  countryCode: "GB",
  countryName: "United Kingdom",
  regulatoryBody: [
    {
      name: "HM Land Registry",
      url: "https://www.gov.uk/government/organisations/hm-land-registry",
      scope: "national (England & Wales) — title registration",
    },
    {
      name: "Ordnance Survey (OS)",
      url: "https://www.ordnancesurvey.co.uk/",
      scope: "national — mapping + OS Net CORS network",
    },
    {
      name: "Registers of Scotland",
      url: "https://www.ros.gov.uk/",
      scope: "national (Scotland)",
    },
    {
      name: "Land & Property Services (Northern Ireland)",
      url: "https://www.finance-ni.gov.uk/land-property-services",
      scope: "national (Northern Ireland)",
    },
  ],
  geodeticFramework: {
    datum: "OSGB36 (mapping) / ETRS89 (GNSS)",
    primarySRID: 27700,
    heightSystem: "ODN (Ordnance Datum Newlyn, vertical datum at Newlyn tide gauge)",
    projectionZones: [BNG],
    legacyDatums: [
      {
        from: "ETRS89",
        to: "OSGB36",
        helmert: {
          // ETRS89 → OSGB36 is NOT a simple Helmert — it uses the
          // OSTN15 grid (1km-resolution shift grid). These Helmert
          // params are a coarse approximation for low-precision work;
          // for any survey-grade output, use the OSTN15 grid via
          // the sidecar's proj bindings (Phase 4B).
          tx: 446.448, ty: -125.157, tz: 542.060,
          rx_arcsec: 0.1500, ry_arcsec: 0.2470, rz_arcsec: 0.8421,
          scale_ppm: -20.489,
        },
        source: "Approximate 7-parameter (Helmert) ETRS89→OSGB36; for survey-grade use OSTN15 grid (EPSG::9704)",
      },
    ],
  },
  toleranceTable: [
    LEVELLING_TOLERANCE,
    TOPOGRAPHIC_CLASS_A,
    ENGINEERING_CLASS_A,
    SETTING_OUT_HORIZONTAL,
    BOUNDARY_GENERAL_RULE,
  ],
  statutoryDocuments: [TITLE_PLAN, MEASURED_SURVEY_REPORT],
  professionalBody: {
    name: "Royal Institution of Chartered Surveyors (RICS)",
    url: "https://www.rics.org/",
    registrationNumberField: "RICS MRICS/FRICS No.",
    // RICS membership numbers are 7-digit numeric with optional prefix.
    registrationPattern: "^\\d{7}$",
  },
  sectionalPropertyRegime: {
    legislation: "Commonhold and Leasehold Reform Act 2002 (UK)",
    planType: "Commonhold Plan",
    requiresParticipationQuotas: true,
    source: "Commonhold and Leasehold Reform Act 2002, s. 24 (commonhold plans)",
  },
  sourceDocsRequired: [
    "Land Registration Act 2002 (UK)",
    "Land Registration Rules 2003",
    "RICS Measured Surveys of Land, Buildings and Utilities, 3rd ed.",
    "RICS Boundary Determination guidance note (current edition)",
    "OSGN15 / OSTN15 transformation specification (Ordnance Survey)",
    "BS 7334 (surveying accuracy standards)",
  ],
  version: "0.1.0",
  lastReviewed: "2026-07-19",
};

// ETRS89 SRID exported as a constant for use by the GNSS module.
export const UK_ETRS89_SRID = ETRS89_SRID;
