/**
 * Kenya survey configuration — the reference implementation per ADR-0004.
 *
 * Every value in this file is the canonical source for that constant in
 * the entire codebase. Other packages (engine, sidecar, UI) MUST read
 * Kenya-specific values from here, never from a local constant.
 *
 * # Sources (per master plan Section 8.1)
 *
 *   - Survey Act Cap. 299 (Laws of Kenya)
 *   - Kenya Survey Regulations 1994
 *   - RDM 1.1 (Kenya Roads Design Manual, 2025)
 *   - ISK / LSB framework
 *   - Sectional Properties Act 2020
 *   - EPSG::21037 (Arc 1960 / UTM zone 37S)
 *   - EPSG::1122 (Arc 1960 to WGS 84 (1))
 *
 * The corresponding PDFs MUST be filed under
 * docs/regulatory-sources/kenya/ before any statutory document
 * renderer is built (invariant B1).
 *
 * # What lives here vs. what lives elsewhere
 *
 *   - Datums, projections, SRIDs, tolerances, statutory doc specs,
 *     professional body, sectional title regime → HERE.
 *   - CRS database (lookup by EPSG code) → packages/engine/src/geodesy/
 *     crs-database.ts. This is general-purpose reference data covering
 *     11 countries, not Kenya-specific logic.
 *   - Helmert transform math (the actual algorithm) → sidecar
 *     packages/metardu-sidecar/src/geodesy/helmert.rs.
 *
 * Workflow code reads tolerances/SRIDs ONLY through this config layer
 * (invariant A2). A literal "21037" anywhere outside this file, the
 * CRS database, or test fixtures is a failing review.
 */

import type {
  CountrySurveyConfig,
  ProjectionZone,
  ToleranceRule,
} from "../types.js";

// ─── Geodetic framework ──────────────────────────────────────────

/** Arc 1960 / UTM zone 37S — Kenya's primary cadastral CRS. EPSG::21037. */
const UTM_37S: ProjectionZone = {
  srid: 21037,
  name: "Arc 1960 / UTM zone 37S",
  method: "Transverse Mercator",
  central_meridian_deg: 39.0,
  latitude_of_origin_deg: 0.0,
  false_easting_m: 500_000.0,
  false_northing_m: 10_000_000.0,
  scale_factor: 0.9996,
  ellipsoid: "Clarke 1866",
};

/** Arc 1960 / UTM zone 37N — used for northern Kenya (rare). EPSG::21037 is the southern form. */
const UTM_37N: ProjectionZone = {
  srid: 21036,
  name: "Arc 1960 / UTM zone 36S",
  method: "Transverse Mercator",
  central_meridian_deg: 33.0,
  latitude_of_origin_deg: 0.0,
  false_easting_m: 500_000.0,
  false_northing_m: 10_000_000.0,
  scale_factor: 0.9996,
  ellipsoid: "Clarke 1866",
};

/**
 * Cassini-Soldner (Kenya colony) — the legacy projection used in
 * pre-1960 deeds. Boundary re-establishment work often requires
 * Cassini → UTM transformation via the Arc 1960 datum.
 *
 * This is a placeholder zone definition; the full Cassini parameter
 * set (per-colony origin) is documented in
 * docs/regulatory-sources/kenya/cadastral/survey-regulations-1994.pdf
 * §3.2.
 */
const CASSINI_NAIROBI: ProjectionZone = {
  srid: 21097, // EPSG assigned SRID for Nairobi Cassini (illustrative)
  name: "Arc 1960 / Cassini-Soldner (Nairobi)",
  method: "Cassini-Soldner",
  central_meridian_deg: 36.78,
  latitude_of_origin_deg: -1.28,
  false_easting_m: 30_000.0,
  false_northing_m: 30_000.0,
  scale_factor: 1.0,
  ellipsoid: "Clarke 1866",
};

// ─── Tolerance table ─────────────────────────────────────────────
//
// Every tolerance rule cites the specific regulation + clause it derives
// from. Per invariant C1, every number that reaches a statutory document
// must be traceable to an adjustment output with a stated uncertainty —
// these tolerances are the gate that decides whether a survey passes.

/** Levelling tolerance: 10 × √K mm where K is line length in km.
 *  Source: Kenya Survey Regulations 1994, Table 5.1.
 *  Also restated in RDM 1.1 (2025) §5.3. */
const LEVELLING_TOLERANCE: ToleranceRule = {
  surveyType: "Levelling",
  toleranceType: "levelling_misclosure",
  formula: "10 × √K mm  (K in km)",
  compute: (input) => {
    const K = input.K_km ?? 0;
    return 10.0 * Math.sqrt(K);
  },
  unit: "mm",
  source: "Kenya Survey Regulations 1994, Table 5.1; RDM 1.1 (2025) §5.3",
};

/** Angular misclosure: 3.0″ × √N where N is the number of stations.
 *  Source: Kenya Survey Regulations 1994, §4.3.
 *  The 15-course azimuth check is separately enforced. */
const ANGULAR_MISCLOSURE: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "angular_misclosure",
  formula: "3.0″ × √N  (N = station count)",
  compute: (input) => {
    const N = input.N_stations ?? 0;
    return 3.0 * Math.sqrt(N);
  },
  unit: "arcsec",
  source: "Kenya Survey Regulations 1994, §4.3",
};

/** Linear misclosure ratio for cadastral surveys: 1:5000.
 *  Source: Kenya Survey Regulations 1994, §4.4. */
const LINEAR_MISCLOSURE_CADASTRAL: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "linear_misclosure",
  formula: "1:5000  (ratio of misclosure to total traverse length)",
  compute: (input) => {
    const length = input.total_length_m ?? 0;
    const misc = input.misclosure_m ?? 0;
    // Returns the ratio (e.g. 5000 means the survey passes 1:5000).
    if (misc <= 0) return Number.POSITIVE_INFINITY;
    return length / misc;
  },
  unit: "ratio",
  source: "Kenya Survey Regulations 1994, §4.4",
};

/** Control survey linear misclosure: 1:10000 (tighter than cadastral).
 *  Source: Kenya Survey Regulations 1994, §4.4 (control). */
const LINEAR_MISCLOSURE_CONTROL: ToleranceRule = {
  surveyType: "Geodetic",
  toleranceType: "linear_misclosure",
  formula: "1:10000  (control surveys)",
  compute: (input) => {
    const length = input.total_length_m ?? 0;
    const misc = input.misclosure_m ?? 0;
    if (misc <= 0) return Number.POSITIVE_INFINITY;
    return length / misc;
  },
  unit: "ratio",
  source: "Kenya Survey Regulations 1994, §4.4 (control)",
};

/** Cadastral urban horizontal tolerance: 10 mm.
 *  Source: RDM 1.1 (2025) §7; Kenya Survey Regulations 1994 §7. */
const CADASTRAL_URBAN_HORIZONTAL: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "horizontal_position",
  formula: "10 mm  (urban cadastral)",
  compute: () => 0.010,
  unit: "m",
  source: "RDM 1.1 (2025) §7; Kenya Survey Regulations 1994 §7",
};

/** Cadastral rural horizontal tolerance: 50 mm. */
const CADASTRAL_RURAL_HORIZONTAL: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "horizontal_position",
  formula: "50 mm  (rural cadastral)",
  compute: () => 0.050,
  unit: "m",
  source: "RDM 1.1 (2025) §7; Kenya Survey Regulations 1994 §7",
};

/** Engineering precise horizontal tolerance: 5 mm. */
const ENGINEERING_PRECISE_HORIZONTAL: ToleranceRule = {
  surveyType: "Engineering",
  toleranceType: "horizontal_position",
  formula: "5 mm  (engineering precise)",
  compute: () => 0.005,
  unit: "m",
  source: "RDM 1.1 (2025) §7; Kenya Survey Regulations 1994 §7",
};

/** Engineering standard horizontal tolerance: 20 mm. */
const ENGINEERING_STANDARD_HORIZONTAL: ToleranceRule = {
  surveyType: "Engineering",
  toleranceType: "horizontal_position",
  formula: "20 mm  (engineering standard)",
  compute: () => 0.020,
  unit: "m",
  source: "RDM 1.1 (2025) §7; Kenya Survey Regulations 1994 §7",
};

// ─── Statutory documents ─────────────────────────────────────────
//
// Per invariant B1/B2/B3, no statutory document renderer may be built
// until its source document exists at the cited sourcePath AND every
// layout decision in the renderer cites a specific page/clause.

/** Form No. 3 — Deed Plan. The primary statutory output of a cadastral survey in Kenya.
 *  Source: Survey Act Cap. 299, Form No. 3. */
const FORM_3 = {
  docType: "Form 3",
  name: "Deed Plan (Form No. 3)",
  citation: "Survey Act Cap. 299, Form No. 3",
  sourcePath: "docs/regulatory-sources/kenya/cadastral/survey-act-cap-299-form-3.pdf",
  pageSize: "A4",
  margins_mm: [25, 20, 25, 20] as [number, number, number, number],
  scaleConvention: "1:500, 1:1000, 1:2500 (cadastral); 1:5000 (large parcels)",
  titleBlockFields: [
    "DEED PLAN NO.",
    "SURVEY NO.",
    "DISTRICT",
    "LOCATION",
    "AREA (ha)",
    "SCALE",
    "SURVEYOR'S NAME",
    "SURVEYOR'S REG. NO. (ISK)",
    "DATE OF SURVEY",
    "SEAL",
  ],
  dxfLayers: [
    "BOUNDARY",
    "BEACON",
    "TEXT-DEEDPLAN",
    "TEXT-COORDS",
    "TEXT-AREA",
    "TITLE-BLOCK",
    "NORTH-ARROW",
    "SCALE-BAR",
  ],
  requiresProfessionalSeal: true,
};

/** Form No. 4 — Mutation Plan. Used for subdivisions. */
const FORM_4 = {
  docType: "Form 4",
  name: "Mutation Plan (Form No. 4)",
  citation: "Survey Act Cap. 299, Form No. 4",
  sourcePath: "docs/regulatory-sources/kenya/cadastral/survey-act-cap-299-form-4.pdf",
  pageSize: "A4",
  margins_mm: [25, 20, 25, 20] as [number, number, number, number],
  scaleConvention: "1:500, 1:1000, 1:2500 (cadastral)",
  titleBlockFields: [
    "MUTATION NO.",
    "PARENT PARCEL NO.",
    "NEW PARCEL NOS.",
    "DISTRICT",
    "LOCATION",
    "AREA (ha) — OLD/NEW",
    "SCALE",
    "SURVEYOR'S NAME",
    "SURVEYOR'S REG. NO. (ISK)",
    "DATE OF SURVEY",
    "SEAL",
  ],
  dxfLayers: [
    "BOUNDARY-OLD",
    "BOUNDARY-NEW",
    "BEACON-EXISTING",
    "BEACON-NEW",
    "TEXT-MUTATION",
    "TEXT-COORDS",
    "TEXT-AREA",
    "TITLE-BLOCK",
    "NORTH-ARROW",
    "SCALE-BAR",
  ],
  requiresProfessionalSeal: true,
};

/** Beacon Certificate — issued for each new beacon placed. */
const BEACON_CERTIFICATE = {
  docType: "Beacon Certificate",
  name: "Beacon Certificate",
  citation: "Kenya Survey Regulations 1994, Regulation 12",
  sourcePath: "docs/regulatory-sources/kenya/cadastral/survey-regulations-1994.pdf",
  pageSize: "A5",
  margins_mm: [20, 20, 20, 20] as [number, number, number, number],
  scaleConvention: "n/a (text-only certificate)",
  titleBlockFields: [
    "BEACON REFERENCE NO.",
    "PARCEL NO.",
    "BEACON TYPE (concrete/iron/stone)",
    "COORDINATES (E, N)",
    "SRID",
    "DATE PLACED",
    "WITNESSES",
    "SURVEYOR'S REG. NO. (ISK)",
    "SEAL",
  ],
  dxfLayers: [],
  requiresProfessionalSeal: true,
};

// ─── The canonical config ────────────────────────────────────────

/**
 * KENYA — the reference CountrySurveyConfig.
 *
 * This is the ONLY place Kenya-specific constants may live. Workflow
 * modules import from here; never from a local hardcoded value.
 */
export const KENYA: CountrySurveyConfig = {
  countryCode: "KE",
  countryName: "Kenya",
  regulatoryBody: [
    {
      name: "Survey of Kenya (SoK)",
      url: "https://www.survey.go.ke/",
      scope: "national",
    },
    {
      name: "Land Surveyors Board (Kenya)",
      url: "https://www.survey.go.ke/",
      scope: "national — professional registration",
    },
    {
      name: "National Land Information System (NLIS)",
      url: "https://ardhisasa.go.ke/",
      scope: "national — electronic cadastre (per Survey (Electronic Cadastre Transactions) Regulations 2020)",
    },
  ],
  geodeticFramework: {
    datum: "Arc 1960",
    primarySRID: 21037,
    heightSystem: "KEN_GEOID (referenced; EGM2008 approximation used until KEN_GEOID grid is bundled)",
    projectionZones: [UTM_37S, UTM_37N, CASSINI_NAIROBI],
    legacyDatums: [
      {
        from: "Cassini-Soldner (Kenya colony)",
        to: "Arc 1960 / UTM zone 37S",
        helmert: {
          tx: 0, ty: 0, tz: 0,
          rx_arcsec: 0, ry_arcsec: 0, rz_arcsec: 0,
          scale_ppm: 0,
        },
        source: "Cassini→UTM transformation uses the published Cassini parameters + Arc 1960 datum; no separate Helmert required (same ellipsoid, Clarke 1866).",
      },
    ],
  },
  toleranceTable: [
    LEVELLING_TOLERANCE,
    ANGULAR_MISCLOSURE,
    LINEAR_MISCLOSURE_CADASTRAL,
    LINEAR_MISCLOSURE_CONTROL,
    CADASTRAL_URBAN_HORIZONTAL,
    CADASTRAL_RURAL_HORIZONTAL,
    ENGINEERING_PRECISE_HORIZONTAL,
    ENGINEERING_STANDARD_HORIZONTAL,
  ],
  statutoryDocuments: [FORM_3, FORM_4, BEACON_CERTIFICATE],
  professionalBody: {
    name: "Institution of Surveyors of Kenya (ISK)",
    url: "https://isk.or.ke/",
    registrationNumberField: "ISK Reg. No.",
    // ISK registration numbers are typically numeric, prefixed by a
    // discipline code (LS for Land Surveyor). Format: "LS/####".
    registrationPattern: "^LS/\\d{3,5}$",
  },
  sectionalPropertyRegime: {
    legislation: "Sectional Properties Act 2020 (Kenya)",
    planType: "Sectional Plan",
    requiresParticipationQuotas: true,
    source: "Sectional Properties Act 2020, §14 (participation quotas); §18 (sectional plans)",
  },
  sourceDocsRequired: [
    "Survey Act Cap. 299 (Laws of Kenya)",
    "Kenya Survey Regulations 1994 (Kenya Gazette No. 26, 27 May 1994)",
    "Survey (Electronic Cadastre Transactions) Regulations 2020 (Legal Notice 132 of 2020)",
    "RDM 1.1 (2025) — Kenya Roads Design Manual",
    "Sectional Properties Act 2020",
    "LSB Topographical Survey Guidelines",
    "ISK Code of Ethics",
  ],
  version: "0.2.0",
  lastReviewed: "2026-07-20",
};

// ─── Convenience helpers (read-only, derive from KENYA) ──────────

/**
 * Look up a tolerance rule by survey type + tolerance type.
 * Returns the FIRST matching rule. Throws if none found.
 */
export function getTolerance(
  config: CountrySurveyConfig,
  surveyType: ToleranceRule["surveyType"],
  toleranceType: string,
): ToleranceRule {
  const rule = config.toleranceTable.find(
    (r) => r.surveyType === surveyType && r.toleranceType === toleranceType,
  );
  if (!rule) {
    throw new Error(
      `No tolerance rule found for surveyType=${surveyType}, toleranceType=${toleranceType} in ${config.countryCode} config`,
    );
  }
  return rule;
}

/**
 * Compute the levelling tolerance for a given line length.
 * Convenience wrapper around getTolerance + compute.
 */
export function levellingToleranceMm(config: CountrySurveyConfig, K_km: number): number {
  return getTolerance(config, "Levelling", "levelling_misclosure").compute({ K_km });
}

/**
 * Compute the angular misclosure tolerance for a given station count.
 */
export function angularMisclosureToleranceArcsec(config: CountrySurveyConfig, N_stations: number): number {
  return getTolerance(config, "Cadastral", "angular_misclosure").compute({ N_stations });
}

/**
 * Compute the linear misclosure ratio for a cadastral traverse.
 * Returns the ratio (e.g. 5000 means the survey passes 1:5000).
 */
export function linearMisclosureRatio(
  config: CountrySurveyConfig,
  total_length_m: number,
  misclosure_m: number,
  surveyType: "Cadastral" | "Geodetic" = "Cadastral",
): number {
  return getTolerance(config, surveyType, "linear_misclosure").compute({
    total_length_m,
    misclosure_m,
  });
}

/**
 * Look up a statutory document spec by doc type.
 */
export function getStatutoryDoc(
  config: CountrySurveyConfig,
  docType: string,
): import("../types.js").StatutoryDocSpec {
  const doc = config.statutoryDocuments.find((d) => d.docType === docType);
  if (!doc) {
    throw new Error(
      `No statutory document type '${docType}' in ${config.countryCode} config`,
    );
  }
  return doc;
}

/**
 * Look up a projection zone by SRID.
 */
export function getProjectionZone(
  config: CountrySurveyConfig,
  srid: number,
): ProjectionZone {
  const zone = config.geodeticFramework.projectionZones.find((z) => z.srid === srid);
  if (!zone) {
    throw new Error(
      `SRID ${srid} not found in ${config.countryCode} projection zones`,
    );
  }
  return zone;
}
