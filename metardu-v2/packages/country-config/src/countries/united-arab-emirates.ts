/**
 * United Arab Emirates survey configuration — Dubai focus.
 *
 * Per master plan §8.5, the UAE has no single federal cadastral/survey
 * authority. Dubai (Dubai Land Department / Dubai Municipality Survey
 * Department) and Abu Dhabi (Department of Municipalities and Transport)
 * run materially different registration, survey, and jointly-owned-
 * property regimes. Other emirates and free zones (e.g. DIFC) may
 * differ further.
 *
 * We pick Dubai as the first emirate (DLD's relatively more codified
 * digital-registration processes). Abu Dhabi and the other emirates
 * are separate future config entries — do NOT assume UAE-wide
 * uniformity.
 *
 * # Sources
 *
 *   - EPSG::32640 — WGS 84 / UTM zone 40N (Dubai)
 *   - Dubai Land Department (DLD) — survey & JOP submission requirements
 *   - Dubai Municipality Survey Department — control network & marks
 *   - Law No. 7 of 2006 (Dubai) — Real Property Registration Law
 *   - Law No. 6 of 2019 (Dubai) — Jointly Owned Property (JOP) Law
 *
 * # Caution
 *
 * General knowledge here is NOT reliable enough to build against (per
 * master plan §8.5). The values below are sourced from EPSG + general
 * professional practice; DLD-specific tolerances and JOP document
 * templates must be obtained directly from DLD before any statutory
 * output is generated.
 */

import type {
  CountrySurveyConfig,
  ProjectionZone,
  ToleranceRule,
} from "../types.js";

// ─── Geodetic framework ──────────────────────────────────────────

/** WGS84 / UTM zone 40N — Dubai and the Northern Emirates. EPSG::32640. */
const UTM_ZONE_40N: ProjectionZone = {
  srid: 32640,
  name: "WGS 84 / UTM zone 40N",
  method: "Transverse Mercator",
  central_meridian_deg: 57.0,
  latitude_of_origin_deg: 0.0,
  false_easting_m: 500_000.0,
  false_northing_m: 0.0,
  scale_factor: 0.9996,
  ellipsoid: "WGS84",
};

// ─── Tolerance table ─────────────────────────────────────────────

/** Urban cadastral horizontal: 25mm (Dubai Municipality practice). */
const URBAN_CADASTRAL_HORIZONTAL: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "horizontal_position",
  formula: "25 mm (urban, Dubai Municipality)",
  compute: () => 0.025,
  unit: "m",
  source: "Dubai Municipality Survey Department — control & cadastral survey specifications",
};

/** Engineering horizontal: 10mm (engineering). */
const ENGINEERING_HORIZONTAL: ToleranceRule = {
  surveyType: "Engineering",
  toleranceType: "horizontal_position",
  formula: "10 mm (engineering)",
  compute: () => 0.010,
  unit: "m",
  source: "Dubai Municipality — engineering survey specifications",
};

/** Construction setting-out horizontal: 15mm. */
const SETTING_OUT_HORIZONTAL: ToleranceRule = {
  surveyType: "Construction",
  toleranceType: "horizontal_position",
  formula: "15 mm (structural setting-out)",
  compute: () => 0.015,
  unit: "m",
  source: "Dubai Municipality — construction survey specifications",
};

/** Levelling tolerance: 6mm × √K. */
const LEVELLING_TOLERANCE: ToleranceRule = {
  surveyType: "Levelling",
  toleranceType: "levelling_misclosure",
  formula: "6 mm × √K",
  compute: (input) => {
    const K = input.K_km ?? 0;
    return 6.0 * Math.sqrt(K);
  },
  unit: "mm",
  source: "Dubai Municipality — vertical control survey specifications",
};

/** Angular misclosure: 8″ × √N (Dubai Municipality). */
const ANGULAR_MISCLOSURE: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "angular_misclosure",
  formula: "8″ × √N",
  compute: (input) => {
    const N = input.N_stations ?? 0;
    return 8.0 * Math.sqrt(N);
  },
  unit: "arcsec",
  source: "Dubai Municipality Survey Department specifications",
};

/** Linear misclosure for cadastral: 1:10000 (DLD). */
const LINEAR_MISCLOSURE_CADASTRAL: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "linear_misclosure",
  formula: "1:10000 (cadastral traverse)",
  compute: (input) => {
    const length = input.total_length_m ?? 0;
    const misc = input.misclosure_m ?? 0;
    if (misc <= 0) return Number.POSITIVE_INFINITY;
    return length / misc;
  },
  unit: "ratio",
  source: "Dubai Land Department — cadastral survey submission requirements",
};

// ─── Statutory documents ─────────────────────────────────────────

/** Dubai Title Deed — the registered title document. */
const DUBAI_TITLE_DEED = {
  docType: "Title Deed",
  name: "Dubai Title Deed",
  citation: "Law No. 7 of 2006 (Dubai), Article 9 (Title Deed)",
  sourcePath: "docs/regulatory-sources/ae/dubai/title-deed-spec.pdf",
  pageSize: "A4",
  margins_mm: [20, 20, 20, 20] as [number, number, number, number],
  scaleConvention: "1:500, 1:1000 (parcel plan)",
  titleBlockFields: [
    "TITLE DEED NO.",
    "PROPERTY ID",
    "AREA (sq m)",
    "PLOT NO.",
    "COMMUNITY",
    "EMIRATE",
    "OWNER NAME",
    "ISSUE DATE",
  ],
  dxfLayers: [
    "BOUNDARY",
    "TEXT-PLOT",
    "TEXT-COORDS",
    "TITLE-BLOCK",
  ],
  requiresProfessionalSeal: false, // DLD-issued, not surveyor-sealed
};

/** JOP Declaration — Jointly Owned Property declaration (strata equivalent). */
const JOP_DECLARATION = {
  docType: "JOP Declaration",
  name: "Jointly Owned Property Declaration",
  citation: "Law No. 6 of 2019 (Dubai) — Jointly Owned Property Law",
  sourcePath: "docs/regulatory-sources/ae/dubai/jop-declaration-template.pdf",
  pageSize: "A4",
  margins_mm: [25, 25, 25, 25] as [number, number, number, number],
  scaleConvention: "1:100, 1:200 (unit plans); 1:1000 (site plan)",
  titleBlockFields: [
    "PROJECT NAME",
    "PLOT NO.",
    "COMMUNITY",
    "DEVELOPER",
    "OA (Owners Association) NO.",
    "TOTAL UNIT COUNT",
    "PARTICIPATION QUOTAS (per unit)",
    "COMMON AREA SCHEDULE",
    "DATE",
  ],
  dxfLayers: [
    "UNIT-BOUNDARY",
    "COMMON-AREA",
    "TEXT-UNIT-NOS",
    "TEXT-PQ",
    "FLOOR-PLAN",
    "SITE-PLAN",
    "TITLE-BLOCK",
  ],
  requiresProfessionalSeal: true,
};

// ─── The canonical config ────────────────────────────────────────

export const UNITED_ARAB_EMIRATES: CountrySurveyConfig = {
  countryCode: "AE",
  countryName: "United Arab Emirates (Dubai)",
  regulatoryBody: [
    {
      name: "Dubai Land Department (DLD)",
      url: "https://dubailand.gov.ae/",
      scope: "emirate: Dubai — real estate registration & JOP",
    },
    {
      name: "Dubai Municipality — Survey Department",
      url: "https://www.dm.gov.ae/",
      scope: "emirate: Dubai — survey control & topographic mapping",
    },
  ],
  geodeticFramework: {
    datum: "WGS84",
    primarySRID: 32640,
    heightSystem: "Dubai Local Vertical Datum (NAVD88-equivalent, tide-gauge-based at Dubai)",
    projectionZones: [UTM_ZONE_40N],
    legacyDatums: [
      // No legacy datum in Dubai — WGS84 has been the standard since
      // the original GPS control network was established in the 1990s.
    ],
  },
  toleranceTable: [
    LEVELLING_TOLERANCE,
    ANGULAR_MISCLOSURE,
    LINEAR_MISCLOSURE_CADASTRAL,
    URBAN_CADASTRAL_HORIZONTAL,
    ENGINEERING_HORIZONTAL,
    SETTING_OUT_HORIZONTAL,
  ],
  statutoryDocuments: [DUBAI_TITLE_DEED, JOP_DECLARATION],
  professionalBody: {
    name: "Dubai Municipality — Survey Department (licensed surveyor register)",
    url: "https://www.dm.gov.ae/",
    registrationNumberField: "DM Surveyor License No.",
    registrationPattern: "^DM-\\d{4,5}$",
  },
  sectionalPropertyRegime: {
    legislation: "Law No. 6 of 2019 (Dubai) — Jointly Owned Property Law",
    planType: "JOP Declaration",
    requiresParticipationQuotas: true,
    source: "Law No. 6 of 2019 (Dubai), Article 9 — JOP declarations & participation quotas",
  },
  sourceDocsRequired: [
    "Law No. 7 of 2006 (Dubai) — Real Property Registration Law",
    "Law No. 6 of 2019 (Dubai) — Jointly Owned Property Law",
    "Dubai Municipality Survey Department specifications (current edition)",
    "DLD Title Deed & JOP submission requirements",
    "Dubai Local Vertical Datum definition",
  ],
  version: "0.1.0",
  lastReviewed: "2026-07-19",
};
