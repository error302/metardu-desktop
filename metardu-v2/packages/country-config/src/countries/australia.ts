/**
 * Australia survey configuration — New South Wales (NSW) focus.
 *
 * Per master plan §8.2, Australia is genuinely state-fragmented — each
 * state runs its own Surveying/Cadastral Act, plan-lodgment authority,
 * and plan template. We pick NSW as the first state (largest survey
 * market, Sydney-based customers most likely first).
 *
 * Adding VIC/QLD/WA/SA/TAS/NT/ACT later is a separate config file per
 * state, NOT a modification to this one.
 *
 * # Sources
 *
 *   - EPSG::7856 — GDA2020 / MGA zone 56 (Sydney)
 *   - ICSM "Standard for the Australian Survey Control Network" (SP1)
 *     v2.2 — the cross-state control survey standard
 *   - Surveying and Spatial Information Act 2002 (NSW)
 *   - Surveying and Spatial Information Regulation 2017 (NSW)
 *   - NSW LRS Plan of Survey template
 *   - SSSI (Surveying & Spatial Sciences Institute) — professional body
 *
 * # What's NOT yet filed
 *
 * The actual NSW LRS Plan of Survey template PDF is NOT yet in
 * docs/regulatory-sources/australia/. Until it's filed, the
 * statutory document renderer for NSW cannot be built (invariant B1).
 */

import type {
  CountrySurveyConfig,
  ProjectionZone,
  ToleranceRule,
} from "../types.js";

// ─── Geodetic framework ──────────────────────────────────────────

/** GDA2020 / MGA zone 56 — Sydney and most of NSW. EPSG::7856. */
const MGA_ZONE_56: ProjectionZone = {
  srid: 7856,
  name: "GDA2020 / MGA zone 56",
  method: "Transverse Mercator",
  central_meridian_deg: 153.0,
  latitude_of_origin_deg: 0.0,
  false_easting_m: 500_000.0,
  false_northing_m: 10_000_000.0,
  scale_factor: 0.9996,
  ellipsoid: "GRS80",
};

/** GDA2020 / MGA zone 55 — western NSW + Melbourne. EPSG::7855. */
const MGA_ZONE_55: ProjectionZone = {
  srid: 7855,
  name: "GDA2020 / MGA zone 55",
  method: "Transverse Mercator",
  central_meridian_deg: 147.0,
  latitude_of_origin_deg: 0.0,
  false_easting_m: 500_000.0,
  false_northing_m: 10_000_000.0,
  scale_factor: 0.9996,
  ellipsoid: "GRS80",
};

// ─── Tolerance table ─────────────────────────────────────────────
//
// ICSM SP1 v2.2 is the cross-state control survey standard. Tolerances
// are expressed in terms of Positional Uncertainty (PU) and Local
// Uncertainty (LU) under GDA2020 — not the older Class/Order system
// used under GDA94.

/** Urban cadastral horizontal: 30mm PU (NSW LRS practice). */
const URBAN_CADASTRAL_HORIZONTAL: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "horizontal_position",
  formula: "30 mm PU (urban)",
  compute: () => 0.030,
  unit: "m",
  source: "ICSM SP1 v2.2 §3.4; NSW LRS practice for urban deposited plans",
};

/** Rural cadastral horizontal: 100mm PU. */
const RURAL_CADASTRAL_HORIZONTAL: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "horizontal_position",
  formula: "100 mm PU (rural)",
  compute: () => 0.100,
  unit: "m",
  source: "ICSM SP1 v2.2 §3.4; NSW LRS practice for rural deposited plans",
};

/** Engineering horizontal: 5mm LU (precise). */
const ENGINEERING_PRECISE_HORIZONTAL: ToleranceRule = {
  surveyType: "Engineering",
  toleranceType: "horizontal_position",
  formula: "5 mm LU (engineering precise)",
  compute: () => 0.005,
  unit: "m",
  source: "ICSM SP1 v2.2 §3.3 (Class A)",
};

/** Engineering standard horizontal: 15mm LU. */
const ENGINEERING_STANDARD_HORIZONTAL: ToleranceRule = {
  surveyType: "Engineering",
  toleranceType: "horizontal_position",
  formula: "15 mm LU (engineering standard)",
  compute: () => 0.015,
  unit: "m",
  source: "ICSM SP1 v2.2 §3.3 (Class B)",
};

/** Levelling tolerance: 4mm × √K (NSW LRS practice, Class LB). */
const LEVELLING_TOLERANCE: ToleranceRule = {
  surveyType: "Levelling",
  toleranceType: "levelling_misclosure",
  formula: "4 mm × √K (Class LB)",
  compute: (input) => {
    const K = input.K_km ?? 0;
    return 4.0 * Math.sqrt(K);
  },
  unit: "mm",
  source: "ICSM SP1 v2.2 §3.2 (Class LB levelling); NSW LRS deposited plan requirements",
};

/** Angular misclosure: 6″ × √N (SP1 §3.5). */
const ANGULAR_MISCLOSURE: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "angular_misclosure",
  formula: "6″ × √N",
  compute: (input) => {
    const N = input.N_stations ?? 0;
    return 6.0 * Math.sqrt(N);
  },
  unit: "arcsec",
  source: "ICSM SP1 v2.2 §3.5 (angular observation tolerance)",
};

/** Linear misclosure for cadastral: 1:12000 (NSW LRS). */
const LINEAR_MISCLOSURE_CADASTRAL: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "linear_misclosure",
  formula: "1:12000 (deposited plan traverse)",
  compute: (input) => {
    const length = input.total_length_m ?? 0;
    const misc = input.misclosure_m ?? 0;
    if (misc <= 0) return Number.POSITIVE_INFINITY;
    return length / misc;
  },
  unit: "ratio",
  source: "NSW LRS Deposited Plan Requirements (traverse closure)",
};

// ─── Statutory documents ─────────────────────────────────────────

/** Plan of Survey — NSW LRS deposited plan template. */
const PLAN_OF_SURVEY = {
  docType: "Plan of Survey",
  name: "NSW LRS Plan of Survey (Deposited Plan)",
  citation: "Surveying and Spatial Information Act 2002 (NSW), s. 21",
  sourcePath: "docs/regulatory-sources/australia/nsw/plan-of-survey-template.pdf",
  pageSize: "A3",
  margins_mm: [20, 20, 20, 20] as [number, number, number, number],
  scaleConvention: "1:500, 1:1000, 1:2000, 1:4000 (NSW LRS scale rules)",
  titleBlockFields: [
    "PLAN NUMBER",
    "EDITION",
    "COUNCIL",
    "SUBURB/LOCALITY",
    "PARISH",
    "COUNTY",
    "LOCAL GOVERNMENT AREA",
    "SURVEYOR'S NAME",
    "SURVEYOR'S CERT. NO.",
    "DATE OF SURVEY",
  ],
  dxfLayers: [
    "BOUNDARY",
    "MARK",
    "TEXT-PLAN",
    "TEXT-COORDS",
    "TEXT-AREA",
    "TITLE-BLOCK",
    "NORTH-ARROW",
    "SCALE-BAR",
  ],
  requiresProfessionalSeal: true,
};

/** Section 88B Instrument — easement/covenant details accompanying a DP. */
const SECTION_88B_INSTRUMENT = {
  docType: "Section 88B Instrument",
  name: "Section 88B Instrument (easements and restrictions)",
  citation: "Conveyancing Act 1919 (NSW), s. 88B",
  sourcePath: "docs/regulatory-sources/australia/nsw/section-88b-template.pdf",
  pageSize: "A4",
  margins_mm: [25, 25, 25, 25] as [number, number, number, number],
  scaleConvention: "n/a (text + schedule)",
  titleBlockFields: [
    "DEPOSITED PLAN NO.",
    "EASEMENT SCHEDULE",
    "RESTRICTION SCHEDULE",
    "SERVIENT TENEMENT",
    "DOMINANT TENEMENT",
  ],
  dxfLayers: [],
  requiresProfessionalSeal: true,
};

// ─── The canonical config ────────────────────────────────────────

export const AUSTRALIA: CountrySurveyConfig = {
  countryCode: "AU",
  countryName: "Australia (New South Wales)",
  regulatoryBody: [
    {
      name: "ICSM (Intergovernmental Committee on Surveying and Mapping)",
      url: "https://www.icsm.gov.au/",
      scope: "national — control survey standards (SP1)",
    },
    {
      name: "NSW Land Registry Services (NSW LRS)",
      url: "https://www.nswlrs.com.au/",
      scope: "state: NSW — plan lodgment",
    },
    {
      name: "Surveyor-General NSW (DCS Spatial Services)",
      url: "https://www.spatial.nsw.gov.au/",
      scope: "state: NSW — survey control network",
    },
  ],
  geodeticFramework: {
    datum: "GDA2020",
    primarySRID: 7856,
    heightSystem: "AHD71 (Australian Height Datum); AVWS (Australian Vertical Working Surface) for GDA2020",
    projectionZones: [MGA_ZONE_56, MGA_ZONE_55],
    legacyDatums: [
      {
        from: "GDA94",
        to: "GDA2020",
        helmert: {
          // GDA94 → GDA2020: 7-parameter conformal transformation (EPSG::8048)
          tx: -0.06155, ty: 0.01087, tz: -0.04019,
          rx_arcsec: -0.0394924, ry_arcsec: -0.0327221, rz_arcsec: -0.0328979,
          scale_ppm: -0.009994,
        },
        source: "EPSG::8048 — GDA94 to GDA2020 (2, conformal)",
      },
      {
        from: "AGD66 / AGD84",
        to: "GDA94 (then GDA2020 via above)",
        helmert: {
          // AGD84 → GDA94: EPSG::1280 (national conformal)
          tx: -117.763, ty: -51.510, tz: 137.178,
          rx_arcsec: -0.292, ry_arcsec: -0.443, rz_arcsec: -0.277,
          scale_ppm: -0.191,
        },
        source: "EPSG::1280 — Australian Geodetic Datum 1984 to GDA94 (1, conformal)",
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
    ENGINEERING_STANDARD_HORIZONTAL,
  ],
  statutoryDocuments: [PLAN_OF_SURVEY, SECTION_88B_INSTRUMENT],
  professionalBody: {
    name: "Surveying & Spatial Sciences Institute (SSSI)",
    url: "https://www.sssi.org.au/",
    registrationNumberField: "CSPS Reg. No.",
    // Certified Surveying and Spatial Sciences Professional (CSPS)
    registrationPattern: "^CSPS/\\d{4,5}$",
  },
  sectionalPropertyRegime: {
    legislation: "Strata Schemes Development Act 2015 (NSW)",
    planType: "Strata Plan",
    requiresParticipationQuotas: true,
    source: "Strata Schemes Development Act 2015 (NSW), s. 26 (unit entitlements)",
  },
  sourceDocsRequired: [
    "Surveying and Spatial Information Act 2002 (NSW)",
    "Surveying and Spatial Information Regulation 2017 (NSW)",
    "ICSM SP1 v2.2 (Australian Survey Control Network standard)",
    "NSW LRS Deposited Plan Requirements",
    "NSW LRS Plan of Survey template (A3)",
    "Strata Schemes Development Act 2015 (NSW)",
  ],
  version: "0.1.0",
  lastReviewed: "2026-07-19",
};
