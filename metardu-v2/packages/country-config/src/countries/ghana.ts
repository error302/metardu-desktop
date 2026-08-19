/**
 * Ghana survey configuration.
 *
 * Ghana's cadastral system is run by the Survey and Mapping Division
 * (SMD) of the Lands Commission. Cadastral survey plans ("survey plans")
 * are lodged with the Lands Commission for land registration under the
 * Land Act 2020 (Act 1036). Plans are commonly produced on large-format
 * sheets (A1/A0) for scheme/subdivision lodgment.
 *
 * # Sources
 *
 *   - EPSG::25000 — Leigon / Ghana Metre Grid (modern national grid,
 *     metres; replaced the Accra grid in 1978)
 *   - EPSG::2136 — Accra / Ghana National Grid (legacy, Gold Coast feet,
 *     War Office ellipsoid)
 *   - Ghana Geodetic Reference Network (GGRN) — ITRF2008 realization
 *     used for GNSS work; aligned to WGS84
 *   - Land Act 2020 (Act 1036) — land registration framework
 *   - Lands Commission Act 2008 (Act 767) — establishes the Lands
 *     Commission, of which the SMD is the survey arm
 *   - Ghana Institution of Surveyors (GhIS) — professional body
 *
 * # What's NOT yet filed
 *
 * The SMD cadastral survey standards document (technical standards for
 * cadastral plans) is NOT yet in docs/regulatory-sources/ghana/. Until
 * it's filed, the statutory document renderer for Ghana cannot be fully
 * built (invariant B1). The plan-sheet profile here is grounded in the
 * Lands Commission lodgment practice above.
 */

import type {
  CountrySurveyConfig,
  ProjectionZone,
  ToleranceRule,
} from "../types.js";

// ─── Geodetic framework ──────────────────────────────────────────

/**
 * Leigon / Ghana Metre Grid — the modern national projected CRS.
 * EPSG::25000. Transverse Mercator, central meridian 1°W, origin at
 * 4°40'N, scale factor 0.99975, false easting 274,319.51 m.
 */
const GHANA_METRE_GRID: ProjectionZone = {
  srid: 25000,
  name: "Leigon / Ghana Metre Grid",
  method: "Transverse Mercator",
  central_meridian_deg: -1.0,
  latitude_of_origin_deg: 4.66666666666667, // 4°40'N
  false_easting_m: 274_319.51,
  false_northing_m: 0.0,
  scale_factor: 0.99975,
  ellipsoid: "Clarke 1880 (RGS)",
};

/**
 * Accra / Ghana National Grid — legacy national grid in Gold Coast feet.
 * EPSG::2136. Same TM parameters but on the War Office ellipsoid with
 * 900,000 ftGC false easting (≈274,319.74 m). Needed for boundary
 * re-establishment from colonial-era plans.
 */
const ACCRA_NATIONAL_GRID: ProjectionZone = {
  srid: 2136,
  name: "Accra / Ghana National Grid",
  method: "Transverse Mercator",
  central_meridian_deg: -1.0,
  latitude_of_origin_deg: 4.66666666666667, // 4°40'N
  false_easting_m: 274_319.74, // 900,000 Gold Coast feet ≈ 274,319.74 m
  false_northing_m: 0.0,
  scale_factor: 0.99975,
  ellipsoid: "War Office",
};

/** WGS84 / UTM zone 30N — western Ghana (CM 3°W). EPSG::32630. */
const UTM_30N: ProjectionZone = {
  srid: 32630,
  name: "WGS84 / UTM zone 30N",
  method: "Transverse Mercator",
  central_meridian_deg: -3.0,
  latitude_of_origin_deg: 0.0,
  false_easting_m: 500_000.0,
  false_northing_m: 0.0,
  scale_factor: 0.9996,
  ellipsoid: "WGS84",
};

/** WGS84 / UTM zone 31N — eastern Ghana (CM 3°E). EPSG::32631. */
const UTM_31N: ProjectionZone = {
  srid: 32631,
  name: "WGS84 / UTM zone 31N",
  method: "Transverse Mercator",
  central_meridian_deg: 3.0,
  latitude_of_origin_deg: 0.0,
  false_easting_m: 500_000.0,
  false_northing_m: 0.0,
  scale_factor: 0.9996,
  ellipsoid: "WGS84",
};

// ─── Tolerance table ─────────────────────────────────────────────
//
// Ghana's SMD publishes technical standards for cadastral surveys.
// The values below reflect the standard cadastral classes; the source
// PDF must be filed before the statutory renderer is built (B1).

/** Cadastral urban horizontal: 30 mm (SMD Class A). */
const URBAN_CADASTRAL_HORIZONTAL: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "horizontal_position",
  formula: "30 mm (urban cadastral, SMD Class A)",
  compute: () => 0.030,
  unit: "m",
  source: "Ghana SMD cadastral survey standards (Class A) — pending filing per invariant B1",
};

/** Cadastral rural horizontal: 100 mm. */
const RURAL_CADASTRAL_HORIZONTAL: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "horizontal_position",
  formula: "100 mm (rural cadastral)",
  compute: () => 0.100,
  unit: "m",
  source: "Ghana SMD cadastral survey standards (rural) — pending filing per invariant B1",
};

/** Levelling tolerance: 12 mm × √K (SMD Class B levelling). */
const LEVELLING_TOLERANCE: ToleranceRule = {
  surveyType: "Levelling",
  toleranceType: "levelling_misclosure",
  formula: "12 mm × √K (Class B)",
  compute: (input) => {
    const K = input.K_km ?? 0;
    return 12.0 * Math.sqrt(K);
  },
  unit: "mm",
  source: "Ghana SMD cadastral survey standards (Class B levelling) — pending filing per invariant B1",
};

/** Angular misclosure: 15″ × √N (cadastral traverse). */
const ANGULAR_MISCLOSURE: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "angular_misclosure",
  formula: "15″ × √N",
  compute: (input) => {
    const N = input.N_stations ?? 0;
    return 15.0 * Math.sqrt(N);
  },
  unit: "arcsec",
  source: "Ghana SMD cadastral survey standards (angular) — pending filing per invariant B1",
};

/** Linear misclosure for cadastral: 1:6000. */
const LINEAR_MISCLOSURE_CADASTRAL: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "linear_misclosure",
  formula: "1:6000 (cadastral traverse)",
  compute: (input) => {
    const length = input.total_length_m ?? 0;
    const misc = input.misclosure_m ?? 0;
    if (misc <= 0) return Number.POSITIVE_INFINITY;
    return length / misc;
  },
  unit: "ratio",
  source: "Ghana SMD cadastral survey standards (traverse closure) — pending filing per invariant B1",
};

/** Engineering horizontal: 10 mm (construction set-out). */
const ENGINEERING_HORIZONTAL: ToleranceRule = {
  surveyType: "Engineering",
  toleranceType: "horizontal_position",
  formula: "10 mm (engineering)",
  compute: () => 0.010,
  unit: "m",
  source: "Ghana SMD cadastral survey standards (engineering) — pending filing per invariant B1",
};

// ─── Statutory documents ─────────────────────────────────────────

/**
 * Survey Plan — the cadastral plan lodged with the Lands Commission for
 * first registration / subdivision. Primary statutory output in Ghana.
 */
const SURVEY_PLAN = {
  docType: "Survey Plan",
  name: "Cadastral Survey Plan (Lands Commission)",
  citation: "Land Act 2020 (Act 1036), s. 42; Lands Commission Act 2008 (Act 767)",
  sourcePath: "docs/regulatory-sources/ghana/survey-plan-spec.pdf",
  pageSize: "A1",
  margins_mm: [20, 20, 20, 20] as [number, number, number, number],
  scaleConvention: "1:500, 1:1000, 1:2000, 1:4000 (cadastral)",
  titleBlockFields: [
    "PLAN NO.",
    "L.R. NO. (LAND REGISTRY)",
    "REGION",
    "DISTRICT",
    "TOWN / LOCALITY",
    "AREA (ha)",
    "SCALE",
    "SURVEYOR'S NAME",
    "SURVEYOR'S REG. NO. (GhIS)",
    "DATE OF SURVEY",
    "SEAL",
  ],
  dxfLayers: [
    "BOUNDARY",
    "BEACON",
    "TEXT-PLAN",
    "TEXT-COORDS",
    "TEXT-AREA",
    "TITLE-BLOCK",
    "NORTH-ARROW",
    "SCALE-BAR",
  ],
  requiresProfessionalSeal: true,
};

/** Site Plan — for building permits / minor transactions. */
const SITE_PLAN = {
  docType: "Site Plan",
  name: "Site Plan (building permit / transaction)",
  citation: "Land Act 2020 (Act 1036); local assembly building regulations",
  sourcePath: "docs/regulatory-sources/ghana/site-plan-spec.pdf",
  pageSize: "A4",
  margins_mm: [20, 20, 20, 20] as [number, number, number, number],
  scaleConvention: "1:500, 1:1000 (site)",
  titleBlockFields: [
    "SITE PLAN NO.",
    "PARCEL / L.R. NO.",
    "REGION",
    "DISTRICT",
    "TOWN / LOCALITY",
    "AREA (ha)",
    "SCALE",
    "SURVEYOR'S NAME",
    "DATE",
  ],
  dxfLayers: ["BOUNDARY", "BUILDING-OUTLINE", "TEXT-SITE", "TITLE-BLOCK", "NORTH-ARROW", "SCALE-BAR"],
  requiresProfessionalSeal: true,
};

// ─── The canonical config ────────────────────────────────────────

export const GHANA: CountrySurveyConfig = {
  countryCode: "GH",
  countryName: "Ghana",
  regulatoryBody: [
    {
      name: "Lands Commission — Survey and Mapping Division (SMD)",
      url: "https://www.lc.gov.gh/",
      scope: "national — cadastral surveys + plan examination",
    },
    {
      name: "Ghana Institution of Surveyors (GhIS)",
      url: "https://www.ghisonline.org/",
      scope: "national — professional registration",
    },
  ],
  geodeticFramework: {
    datum: "GGRN (Ghana Geodetic Reference Network, ITRF2008) / Leigon",
    primarySRID: 25000,
    heightSystem: "GGRN ellipsoidal heights (ITRF2008); national geoid model referenced (EGM2008 approximation used until the GGRN geoid grid is bundled)",
    projectionZones: [GHANA_METRE_GRID, ACCRA_NATIONAL_GRID, UTM_30N, UTM_31N],
    legacyDatums: [
      {
        from: "Accra (Ghana National Grid)",
        to: "Leigon / Ghana Metre Grid",
        helmert: {
          // Accra → WGS84 TOWGS84 (EPSG:2136 page): the Leigon grid sits on
          // GGRN/ITRF2008 ≈ WGS84, so the Accra→WGS84 translation is the
          // traceable step for re-establishment from colonial-era plans.
          tx: -170, ty: 33, tz: 326,
          rx_arcsec: 0.0, ry_arcsec: 0.0, rz_arcsec: 0.0,
          scale_ppm: 0.0,
        },
        source: "EPSG TOWGS84 for the Accra datum (Accra to WGS 84 (4), EPSG:2136); colonial-era plan re-establishment",
      },
    ],
  },
  toleranceTable: [
    LEVELLING_TOLERANCE,
    ANGULAR_MISCLOSURE,
    LINEAR_MISCLOSURE_CADASTRAL,
    URBAN_CADASTRAL_HORIZONTAL,
    RURAL_CADASTRAL_HORIZONTAL,
    ENGINEERING_HORIZONTAL,
  ],
  statutoryDocuments: [SURVEY_PLAN, SITE_PLAN],
  professionalBody: {
    name: "Ghana Institution of Surveyors (GhIS)",
    url: "https://www.ghisonline.org/",
    registrationNumberField: "GhIS Reg. No.",
    // GhIS registration numbers are typically the member number, often
    // prefixed by a discipline code (e.g. GHIS/####).
    registrationPattern: "^GHIS/\\d{3,5}$",
  },
  sourceDocsRequired: [
    "Land Act 2020 (Act 1036) — Republic of Ghana",
    "Lands Commission Act 2008 (Act 767)",
    "Ghana SMD cadastral survey technical standards",
    "Ghana Geodetic Reference Network (GGRN) realization report",
    "Ghana Institution of Surveyors (GhIS) registration rules",
  ],
  planSheet: {
    // Ghana survey plans are commonly lodged on large-format sheets —
    // A0/A1 for scheme and subdivision lodgments with the Lands
    // Commission (invariant B1: source PDFs pending filing).
    defaultSheetSize: "a0",
    defaultOrientation: "landscape",
    titleBlockLabel: "REPUBLIC OF GHANA — LANDS COMMISSION",
    planTypeLabel: "SURVEY PLAN (CADASTRAL)",
    footerNote:
      "Prepared under the Land Act 2020 (Act 1036) and the Lands Commission Act 2008 (Act 767). " +
      "Coordinates in Leigon / Ghana Metre Grid (EPSG:25000).",
    titleBlockLayout: {
      // Field grid mirrors SURVEY_PLAN.titleBlockFields — the Lands
      // Commission survey-plan lodgment block (Land Act 2020, s. 42):
      // plan number, land registry reference, region/district/locality,
      // area, scale, surveyor + seal.
      variant: "standard",
      fieldRows: [
        { label: "PLAN NO." },
        { label: "L.R. NO. (LAND REGISTRY)" },
        { label: "REGION" },
        { label: "DISTRICT" },
        { label: "TOWN / LOCALITY" },
        { label: "AREA (ha)" },
        { label: "SCALE", value: "{{scale}}" },
        { label: "DATE OF SURVEY", value: "{{date}}" },
        { label: "SURVEYOR", value: "{{surveyor}}" },
      ],
      certification: {
        heading: "SURVEYOR'S CERTIFICATE",
        lines: [
          "I certify that this survey plan has been prepared in accordance with the",
          "standards of the Survey and Mapping Division of the Lands Commission and",
          "is correct for the purpose of registration under the Land Act 2020.",
        ],
      },
      seal: {
        position: "bottom-right",
        caption: "REGISTERED SURVEYOR — GhIS REG. NO.",
      },
      statutoryFooterLines: [
        "This survey plan is prepared for lodgment with the Lands Commission of Ghana",
        "and remains the property of the Commission until registered under the Land",
        "Act 2020 (Act 1036). Reproduction without the Commission's authority is",
        "prohibited. Coordinates in Leigon / Ghana Metre Grid (EPSG:25000).",
      ],
    },
  },
  version: "0.1.0",
  lastReviewed: "2026-08-01",
};
