/**
 * United States survey configuration.
 *
 * The US is genuinely state-fragmented for cadastral work (each state
 * licenses surveyors and runs its own recording system), but three
 * things are national:
 *   1. The geodetic framework — NAD83 / State Plane Coordinate System
 *      (SPCS), with NAVD88 vertical datum.
 *   2. The Federal Geodetic Control Committee (FGCS) accuracy standards
 *      (Order/Class system).
 *   3. The ALTA/NSPS Land Title Survey standard — the highest-value
 *      commercial product and the most subscription-willing segment.
 *
 * We model the national framework + the SPCS zones for the largest
 * markets (Texas, California, Florida, New York). Per-state plan
 * templates (Certificate of Survey, ALTA/NSPS Table A) vary by state
 * but ALTA/NSPS is a national standard used everywhere.
 *
 * # Sources
 *
 *   - EPSG::6360 — NAD83(2011) / Texas South Central (metres; ftUS variant is 6589)
 *   - EPSG::6335 — NAD83(2011) / California zone 5
 *   - EPSG::6344 — NAD83(2011) / Florida East
 *   - EPSG::6539 — NAD83(2011) / New York Long Island
 *   - FGCS "Geospatial Positioning Accuracy Standards" (1998)
 *   - ALTA/NSPS Land Title Survey requirements (2021)
 *   - BLM Manual of Surveying Instructions (2009)
 *   - NSPS (National Society of Professional Surveyors)
 *
 * # Caution
 *
 * State licensing boards govern registration numbers — patterns vary.
 * The registrationPattern below is a permissive fallback; states should
 * add their own regex as config entries are refined.
 */

import type {
  CountrySurveyConfig,
  ProjectionZone,
  ToleranceRule,
} from "../types.js";

// ─── Geodetic framework ──────────────────────────────────────────

/**
 * NAD83(2011) / Texas South Central (metres). EPSG::6360.
 *
 * The ftUS variant (EPSG::6589) has the same defining parameters but
 * US-survey-foot false easting/northing (600000 ftUS ≈ 182,880 m). We
 * use the metre CRS so the sidecar's LCC (which works in metres) is
 * consistent with `false_easting_m` / `false_northing_m` — see
 * docs/STATUTORY-RENDERER-READINESS.md §10 and scripts/verify_lcc.py.
 */
const TEXAS_SOUTH_CENTRAL: ProjectionZone = {
  srid: 6360,
  name: "NAD83(2011) / Texas South Central",
  method: "Lambert Conformal Conic",
  central_meridian_deg: -99.0,
  latitude_of_origin_deg: 27.8333333333,
  false_easting_m: 600_000.0,
  false_northing_m: 4_000_000.0,
  scale_factor: 0.9999,
  ellipsoid: "GRS80",
  // Standard parallels: 27°50'N / 31°53'N (EPSG 2SP definition).
  standard_parallel_1_deg: 27.8333333333,
  standard_parallel_2_deg: 31.8833333333,
};

/** NAD83(2011) / California zone 5. EPSG::6335. */
const CALIFORNIA_ZONE_5: ProjectionZone = {
  srid: 6335,
  name: "NAD83(2011) / California zone 5",
  method: "Lambert Conformal Conic",
  central_meridian_deg: -118.0,
  latitude_of_origin_deg: 33.5,
  false_easting_m: 2_000_000.0,
  false_northing_m: 500_000.0,
  scale_factor: 1.0,
  ellipsoid: "GRS80",
  // Standard parallels: 34°02'N / 35°28'N (EPSG 2SP definition).
  standard_parallel_1_deg: 34.0333333333,
  standard_parallel_2_deg: 35.4666666667,
};

/** NAD83(2011) / Florida East. EPSG::6344. */
const FLORIDA_EAST: ProjectionZone = {
  srid: 6344,
  name: "NAD83(2011) / Florida East",
  method: "Transverse Mercator",
  central_meridian_deg: -81.0,
  latitude_of_origin_deg: 24.3333333333,
  false_easting_m: 200_000.0,
  false_northing_m: 0.0,
  scale_factor: 0.999941177,
  ellipsoid: "GRS80",
};

/** NAD83(2011) / New York Long Island. EPSG::6539. */
const NEW_YORK_LONG_ISLAND: ProjectionZone = {
  srid: 6539,
  name: "NAD83(2011) / New York Long Island",
  method: "Lambert Conformal Conic",
  central_meridian_deg: -74.0,
  latitude_of_origin_deg: 40.1666666667,
  false_easting_m: 300_000.0,
  false_northing_m: 0.0,
  scale_factor: 1.0,
  ellipsoid: "GRS80",
  // Standard parallels: 40°40'N / 41°02'N (EPSG 2SP definition).
  standard_parallel_1_deg: 40.6666666667,
  standard_parallel_2_deg: 41.0333333333,
};

/**
 * NAD83(2011) / UTM zones — fallback for the engine's WGS84
 * reprojection path (`outputWgs84` via `geodesy.utm_inverse`) and for
 * the generic dispatch when a zone's SRID is requested by its UTM
 * equivalent. The desktop main process dispatches by zone.method —
 * LCC zones go to geodesy.lcc_inverse, TM zones to geodesy.tm_inverse
 * (or utm_inverse for UTM-named zones).
 */

/** NAD83(2011) / UTM zone 18N — eastern CONUS (FL, NY). EPSG::6322. */
const UTM_ZONE_18N: ProjectionZone = {
  srid: 6322,
  name: "NAD83(2011) / UTM zone 18N",
  method: "Transverse Mercator",
  central_meridian_deg: -75.0,
  latitude_of_origin_deg: 0.0,
  false_easting_m: 500_000.0,
  false_northing_m: 0.0,
  scale_factor: 0.9996,
  ellipsoid: "GRS80",
};

/** NAD83(2011) / UTM zone 17N — central CONUS (TX west, LA). EPSG::6321. */
const UTM_ZONE_17N: ProjectionZone = {
  srid: 6321,
  name: "NAD83(2011) / UTM zone 17N",
  method: "Transverse Mercator",
  central_meridian_deg: -81.0,
  latitude_of_origin_deg: 0.0,
  false_easting_m: 500_000.0,
  false_northing_m: 0.0,
  scale_factor: 0.9996,
  ellipsoid: "GRS80",
};

/** NAD83(2011) / UTM zone 16N — California. EPSG::6320. */
const UTM_ZONE_16N: ProjectionZone = {
  srid: 6320,
  name: "NAD83(2011) / UTM zone 16N",
  method: "Transverse Mercator",
  central_meridian_deg: -87.0,
  latitude_of_origin_deg: 0.0,
  false_easting_m: 500_000.0,
  false_northing_m: 0.0,
  scale_factor: 0.9996,
  ellipsoid: "GRS80",
};

// ─── Tolerance table ─────────────────────────────────────────────
//
// US cadastral accuracy is governed by the FGCS Order/Class system for
// control and the ALTA/NSPS Land Title Survey standards for boundary
// surveys (relative positional accuracy, RPA).

/** ALTA/NSPS urban relative positional accuracy: 2cm + 50ppm. */
const ALTA_URBAN_RPA: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "relative_positional_accuracy",
  formula: "2 cm + 50 ppm (ALTA/NSPS urban)",
  compute: () => 0.020,
  unit: "m",
  source: "ALTA/NSPS Land Title Survey 2021 — Table A relative positional accuracy",
};

/** ALTA/NSPS rural RPA: 5cm + 50ppm. */
const ALTA_RURAL_RPA: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "relative_positional_accuracy",
  formula: "5 cm + 50 ppm (ALTA/NSPS rural)",
  compute: () => 0.050,
  unit: "m",
  source: "ALTA/NSPS Land Title Survey 2021 — Table A (rural)",
};

/** FGCS second-order Class I control: 1:50,000. */
const FGCS_SECOND_ORDER_I: ToleranceRule = {
  surveyType: "Geodetic",
  toleranceType: "linear_misclosure",
  formula: "1:50000 (FGCS Second-Order, Class I)",
  compute: (input) => {
    const length = input.total_length_m ?? 0;
    const misc = input.misclosure_m ?? 0;
    if (misc <= 0) return Number.POSITIVE_INFINITY;
    return length / misc;
  },
  unit: "ratio",
  source: "FGCS Geospatial Positioning Accuracy Standards (1998), Table 1",
};

/** Engineering horizontal: 5mm (construction layout). */
const ENGINEERING_HORIZONTAL: ToleranceRule = {
  surveyType: "Engineering",
  toleranceType: "horizontal_position",
  formula: "5 mm (construction layout)",
  compute: () => 0.005,
  unit: "m",
  source: "FGCS standards; construction surveying practice",
};

/** Levelling tolerance: 4mm × √K. */
const LEVELLING_TOLERANCE: ToleranceRule = {
  surveyType: "Levelling",
  toleranceType: "levelling_misclosure",
  formula: "4 mm × √K",
  compute: (input) => {
    const K = input.K_km ?? 0;
    return 4.0 * Math.sqrt(K);
  },
  unit: "mm",
  source: "FGCS Geospatial Positioning Accuracy Standards (1998) — vertical control",
};

/** Angular misclosure: 6″ × √N. */
const ANGULAR_MISCLOSURE: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "angular_misclosure",
  formula: "6″ × √N",
  compute: (input) => {
    const N = input.N_stations ?? 0;
    return 6.0 * Math.sqrt(N);
  },
  unit: "arcsec",
  source: "US boundary survey practice; state standards (e.g. ALTA/NSPS)",
};

// ─── Statutory documents ─────────────────────────────────────────

/** ALTA/NSPS Land Title Survey — the premium commercial product. */
const ALTA_NSPS_SURVEY = {
  docType: "ALTA/NSPS Land Title Survey",
  name: "ALTA/NSPS Land Title Survey",
  citation: "ALTA/NSPS Minimum Standard Detail Requirements for ALTA/NSPS Land Title Surveys (2021)",
  sourcePath: "docs/regulatory-sources/us/alta-nsps-2021.pdf",
  pageSize: "ANSI B (11×17)",
  margins_mm: [12.7, 12.7, 12.7, 12.7] as [number, number, number, number],
  scaleConvention: "1:1200 (1\" = 100') typical; varies by parcel size",
  titleBlockFields: [
    "ALTA/NSPS SURVEY NO.",
    "PROPERTY ADDRESS",
    "LEGAL DESCRIPTION",
    "CLIENT",
    "LENDER",
    "SURVEYOR'S NAME",
    "SURVEYOR'S STATE REG. NO.",
    "DATE OF FIELD WORK",
    "DATE OF SURVEY",
    "TABLE A OPTIONS",
  ],
  dxfLayers: [
    "BOUNDARY",
    "EASEMENT",
    "IMPROVEMENT",
    "TEXT-LEGAL",
    "TEXT-COORDS",
    "TITLE-BLOCK",
    "NORTH-ARROW",
    "SCALE-BAR",
  ],
  requiresProfessionalSeal: true,
};

/** Certificate of Survey — state-level boundary survey product. */
const CERTIFICATE_OF_SURVEY = {
  docType: "Certificate of Survey",
  name: "Certificate of Survey",
  citation: "State surveying statutes (varies by state); NSPS model law",
  sourcePath: "docs/regulatory-sources/us/certificate-of-survey-model.pdf",
  pageSize: "ANSI B (11×17)",
  margins_mm: [12.7, 12.7, 12.7, 12.7] as [number, number, number, number],
  scaleConvention: "1:1200 (1\" = 100') typical",
  titleBlockFields: [
    "CERT. NO.",
    "PROPERTY DESCRIPTION",
    "SURVEYOR'S NAME",
    "SURVEYOR'S STATE REG. NO.",
    "STATE",
    "DATE",
  ],
  dxfLayers: [
    "BOUNDARY",
    "MARK",
    "TEXT-LEGAL",
    "TEXT-COORDS",
    "TITLE-BLOCK",
    "NORTH-ARROW",
    "SCALE-BAR",
  ],
  requiresProfessionalSeal: true,
};

/** BLM Cadastral Survey Plat — federal public lands survey output. */
const BLM_PLAT = {
  docType: "BLM Cadastral Plat",
  name: "BLM Cadastral Survey Plat (public lands)",
  citation: "BLM Manual of Surveying Instructions (2009)",
  sourcePath: "docs/regulatory-sources/us/blm-surveying-instructions-2009.pdf",
  pageSize: "ANSI B (11×17)",
  margins_mm: [12.7, 12.7, 12.7, 12.7] as [number, number, number, number],
  scaleConvention: "1:2400 (1\" = 200') typical for GLO sections",
  titleBlockFields: [
    "PLAT NO.",
    "TOWNSHIP/RANGE",
    "SECTION",
    "MERIDIAN",
    "STATE",
    "SURVEYOR'S NAME",
    "DATE",
    "APPROVED (BLM)",
  ],
  dxfLayers: [
    "GLO-BOUNDARY",
    "SECTION-LINES",
    "BEACON",
    "TEXT-SECTION",
    "TITLE-BLOCK",
    "NORTH-ARROW",
    "SCALE-BAR",
  ],
  requiresProfessionalSeal: true,
};

// ─── The canonical config ────────────────────────────────────────

export const UNITED_STATES: CountrySurveyConfig = {
  countryCode: "US",
  countryName: "United States",
  regulatoryBody: [
    {
      name: "Federal Geodetic Control Committee (FGCS / NGS)",
      url: "https://www.ngs.noaa.gov/",
      scope: "national — geodetic control standards & NAD83/NAVD88",
    },
    {
      name: "Bureau of Land Management (BLM)",
      url: "https://www.blm.gov/",
      scope: "federal — public lands cadastral surveys (GLO)",
    },
    {
      name: "National Society of Professional Surveyors (NSPS)",
      url: "https://www.nsps.us.com/",
      scope: "national — professional standards & ALTA/NSPS",
    },
  ],
  geodeticFramework: {
    datum: "NAD83(2011)",
    primarySRID: 6360, // NAD83(2011) / Texas South Central (metres)
    heightSystem: "NAVD88 (North American Vertical Datum of 1988)",
    projectionZones: [
      // NOTE: the first four are SPCS zones. The three LCC zones (TX, CA,
      // NY) are computed by the sidecar's geodesy.lcc_forward/lcc_inverse
      // (Lambert Conformal Conic 2SP, EPSG GN7-2 §1.3.2.1) using their
      // standard parallels; FL East is Transverse Mercator via
      // geodesy.tm_inverse. The UTM zones below serve the generic
      // outputWgs84 path (geodesy.utm_inverse) as a fallback. The desktop
      // main process dispatches by zone.method — see
      // apps/desktop/src/main/index.ts.
      TEXAS_SOUTH_CENTRAL, CALIFORNIA_ZONE_5, FLORIDA_EAST, NEW_YORK_LONG_ISLAND,
      UTM_ZONE_16N, UTM_ZONE_17N, UTM_ZONE_18N,
    ],
    legacyDatums: [
      {
        from: "NAD27",
        to: "NAD83",
        helmert: {
          // NAD27 → NAD83: national 5-parameter similarity (varies by
          // region; CONUS average). Survey-grade work uses NADCON grid.
          tx: -8.0, ty: 160.0, tz: 176.0,
          rx_arcsec: 0.0, ry_arcsec: 0.0, rz_arcsec: 0.0,
          scale_ppm: 0.0,
        },
        source: "NAD27 → NAD83 (CONUS average); NADCON grid for survey-grade",
      },
    ],
  },
  toleranceTable: [
    LEVELLING_TOLERANCE,
    ANGULAR_MISCLOSURE,
    FGCS_SECOND_ORDER_I,
    ALTA_URBAN_RPA,
    ALTA_RURAL_RPA,
    ENGINEERING_HORIZONTAL,
  ],
  statutoryDocuments: [ALTA_NSPS_SURVEY, CERTIFICATE_OF_SURVEY, BLM_PLAT],
  professionalBody: {
    name: "National Society of Professional Surveyors (NSPS) / state licensing boards",
    url: "https://www.nsps.us.com/",
    registrationNumberField: "State Reg. No.",
    // State boards vary; permissive fallback (e.g. "TX-12345" or "LS12345").
    registrationPattern: "^[A-Z]{2}?-?\\d{4,6}$",
  },
  sectionalPropertyRegime: {
    legislation: "State condominium statutes (varies by state)",
    planType: "Condominium Plat",
    requiresParticipationQuotas: true,
    source: "State condominium acts (e.g. Florida Condominium Act 718, California Davis-Stirling Act)",
  },
  sourceDocsRequired: [
    "FGCS Geospatial Positioning Accuracy Standards (1998)",
    "ALTA/NSPS Land Title Survey requirements (2021)",
    "BLM Manual of Surveying Instructions (2009)",
    "State surveying statutes & licensing board rules",
  ],
  planSheet: {
    defaultSheetSize: "letter",
    defaultOrientation: "portrait",
    titleBlockLabel: "UNITED STATES — SPCS / PLSS",
    planTypeLabel: "ALTA/NSPS LAND TITLE SURVEY",
    footerNote:
      "Prepared to ALTA/NSPS Land Title Survey Standards and FGCS guidelines. " +
      "Coordinates in NAD83(2011) / State Plane (SPCS) zones.",
    titleBlockLayout: {
      // ALTA/NSPS plat lettering — SPCS zone + datum line and the PLSS
      // designation are statutory fields on the plat (ALTA/NSPS 2021
      // Minimum Standard Detail Requirements). Field grid mirrors
      // ALTA_NSPS_SURVEY.titleBlockFields.
      variant: "us-alta",
      fieldRows: [
        { label: "ALTA/NSPS SURVEY NO." },
        { label: "PROPERTY ADDRESS" },
        { label: "LEGAL DESCRIPTION" },
        { label: "SPCS ZONE", value: "{{crs}}" },
        { label: "PLSS DESIGNATION" },
        { label: "STATE" },
        { label: "SCALE", value: "{{scale}}" },
        { label: "DATE OF SURVEY", value: "{{date}}" },
        { label: "SURVEYOR", value: "{{surveyor}}" },
      ],
      certification: {
        heading: "CERTIFICATION OF SURVEYOR",
        lines: [
          "I hereby certify that this survey was performed by me or under my",
          "direct supervision in accordance with the current ALTA/NSPS Minimum",
          "Standard Detail Requirements for ALTA/NSPS Land Title Surveys and",
          "the standards of the state in which the property is located, and",
          "that the relative positional accuracy meets or exceeds the applicable",
          "FGCS accuracy standards.",
        ],
      },
      seal: {
        position: "bottom-right",
        caption: "PROFESSIONAL LAND SURVEYOR — STATE REG. NO.",
      },
      statutoryFooterLines: [
        "This plat conforms to the ALTA/NSPS Minimum Standard Detail Requirements",
        "for Land Title Surveys and the Minimum Standards of the licensing state.",
        "Unauthorized reproduction or reuse of this plat is prohibited.",
        "Coordinates in NAD83(2011) / SPCS (EPSG:6360 ff.), PLSS per BLM manual.",
      ],
    },
  },
  version: "0.1.3",
  lastReviewed: "2026-08-01",
};
