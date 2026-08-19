/**
 * Germany survey configuration.
 *
 * Germany is a federal republic — each Bundesland (federal state) runs its
 * own cadastral authority (Katasteramt / Vermessungsverwaltung), but the
 * geodetic reference framework is national (ETRS89 / UTM, introduced
 * officially in 2001 via AdV). This makes Germany a first-class market
 * for the desktop app: high subscription willingness, high precision
 * standards, and a strong private surveyor (ÖbVI) profession.
 *
 * # Sources
 *
 *   - EPSG::25832 — ETRS89 / UTM zone 32N (most of Germany)
 *   - EPSG::25833 — ETRS89 / UTM zone 33N (eastern Germany)
 *   - EPSG::31467 — DHDN / 3-degree Gauss-Krüger zone 3 (legacy)
 *   - AdV (Arbeitsgemeinschaft der Vermessungsverwaltungen der Länder)
 *     — the joint body of state survey authorities
 *   - Vermessungs- und Katastergesetze der Länder (state cadastral acts)
 *   - DVW (Deutscher Verein für Vermessungswesen) — professional body
 *   - Wohnungseigentumsgesetz (WEG) — sectional property regime
 *
 * # Caution
 *
 * State-specific cadastral acts vary; the values below use the national
 * ETRS89 framework + widely documented tolerance practice. Per-state
 * document templates must be sourced from the respective Katasteramt
 * before statutory output is generated.
 */

import type {
  CountrySurveyConfig,
  ProjectionZone,
  ToleranceRule,
} from "../types.js";

// ─── Geodetic framework ──────────────────────────────────────────

/** ETRS89 / UTM zone 32N — most of Germany. EPSG::25832. */
const UTM_ZONE_32N: ProjectionZone = {
  srid: 25832,
  name: "ETRS89 / UTM zone 32N",
  method: "Transverse Mercator",
  central_meridian_deg: 9.0,
  latitude_of_origin_deg: 0.0,
  false_easting_m: 500_000.0,
  false_northing_m: 0.0,
  scale_factor: 0.9996,
  ellipsoid: "GRS80",
};

/** ETRS89 / UTM zone 33N — eastern Germany. EPSG::25833. */
const UTM_ZONE_33N: ProjectionZone = {
  srid: 25833,
  name: "ETRS89 / UTM zone 33N",
  method: "Transverse Mercator",
  central_meridian_deg: 15.0,
  latitude_of_origin_deg: 0.0,
  false_easting_m: 500_000.0,
  false_northing_m: 0.0,
  scale_factor: 0.9996,
  ellipsoid: "GRS80",
};

/** DHDN / 3-degree Gauss-Krüger zone 3 — legacy cadastral coordinate system. EPSG::31467. */
const GK_ZONE_3: ProjectionZone = {
  srid: 31467,
  name: "DHDN / 3-degree Gauss-Krüger zone 3",
  method: "Transverse Mercator",
  central_meridian_deg: 9.0,
  latitude_of_origin_deg: 0.0,
  false_easting_m: 3_500_000.0,
  false_northing_m: 0.0,
  scale_factor: 1.0,
  ellipsoid: "Bessel 1841",
};

// ─── Tolerance table ─────────────────────────────────────────────
//
// German cadastral accuracy practice is governed by the "Genauigkeits-
// stufen" (accuracy classes) of the Vermessungsverwaltung. Urban parcels
// use the tightest class; rural parcels are more relaxed.

/** Urban cadastral horizontal: 15mm (Genauigkeitsstufe A practice). */
const URBAN_CADASTRAL_HORIZONTAL: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "horizontal_position",
  formula: "15 mm (urban, Genauigkeitsstufe A practice)",
  compute: () => 0.015,
  unit: "m",
  source: "AdV accuracy-class practice; state Vermessungsgesetze",
};

/** Rural cadastral horizontal: 50mm. */
const RURAL_CADASTRAL_HORIZONTAL: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "horizontal_position",
  formula: "50 mm (rural, Genauigkeitsstufe B practice)",
  compute: () => 0.050,
  unit: "m",
  source: "AdV accuracy-class practice; state Vermessungsgesetze",
};

/** Engineering horizontal: 5mm (precise). */
const ENGINEERING_PRECISE_HORIZONTAL: ToleranceRule = {
  surveyType: "Engineering",
  toleranceType: "horizontal_position",
  formula: "5 mm (engineering precise)",
  compute: () => 0.005,
  unit: "m",
  source: "DVW engineering survey practice",
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
  source: "DVW levelling practice; German levelling standards",
};

/** Angular misclosure: 10″ × √N. */
const ANGULAR_MISCLOSURE: ToleranceRule = {
  surveyType: "Cadastral",
  toleranceType: "angular_misclosure",
  formula: "10″ × √N",
  compute: (input) => {
    const N = input.N_stations ?? 0;
    return 10.0 * Math.sqrt(N);
  },
  unit: "arcsec",
  source: "German traverse practice; AdV control survey specifications",
};

/** Linear misclosure for cadastral: 1:10000. */
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
  source: "German cadastral traverse practice; AdV specifications",
};

// ─── Statutory documents ─────────────────────────────────────────

/** Niederschrift über die Grenzfeststellung — boundary determination record. */
const GRENZFESTSTELLUNG = {
  docType: "Grenzfeststellung",
  name: "Niederschrift über die Grenzfeststellung (boundary determination record)",
  citation: "State Vermessungsgesetze — Grenzfeststellung provisions",
  sourcePath: "docs/regulatory-sources/de/grenzfeststellung-niederschrift.pdf",
  pageSize: "A4",
  margins_mm: [25, 25, 25, 25] as [number, number, number, number],
  scaleConvention: "1:250, 1:500, 1:1000 (boundary sketches)",
  titleBlockFields: [
    "GEMARKUNG",
    "FLURSTÜCK-NR.",
    "GEMEINDE",
    "LANDKREIS",
    "BUNDESLAND",
    "SURVEYOR'S NAME",
    "SURVEYOR'S REG. NO. (ÖbVI)",
    "DATE",
  ],
  dxfLayers: [
    "BOUNDARY",
    "BEACON",
    "TEXT-COORDS",
    "TEXT-AREA",
    "TITLE-BLOCK",
    "NORTH-ARROW",
    "SCALE-BAR",
  ],
  requiresProfessionalSeal: true,
};

/** Abmarkungsprotokoll — beacon/marker placement protocol. */
const ABMARKUNGSPROTOKOLL = {
  docType: "Abmarkungsprotokoll",
  name: "Abmarkungsprotokoll (marker placement protocol)",
  citation: "State Vermessungsgesetze — Abmarkung provisions",
  sourcePath: "docs/regulatory-sources/de/abmarkungsprotokoll.pdf",
  pageSize: "A4",
  margins_mm: [25, 25, 25, 25] as [number, number, number, number],
  scaleConvention: "1:250, 1:500 (marker sketches)",
  titleBlockFields: [
    "FLURSTÜCK-NR.",
    "GEMARKUNG",
    "BEACON TYPE",
    "BEACON COORDINATES",
    "SURVEYOR'S NAME",
    "SURVEYOR'S REG. NO.",
    "DATE",
  ],
  dxfLayers: ["BEACON", "TEXT-COORDS", "TITLE-BLOCK"],
  requiresProfessionalSeal: true,
};

/** Amtliche Liegenschaftskarte — official cadastral map extract. */
const ALKIS_EXTRACT = {
  docType: "ALKIS Extract",
  name: "Amtliche Liegenschaftskarte (official cadastral map extract)",
  citation: "AdV ALKIS specifications",
  sourcePath: "docs/regulatory-sources/de/alkis-extract-spec.pdf",
  pageSize: "A3",
  margins_mm: [20, 20, 20, 20] as [number, number, number, number],
  scaleConvention: "1:1000, 1:2500 (cadastral map scales)",
  titleBlockFields: [
    "GEMARKUNG",
    "FLUR",
    "FLURSTÜCK-NR.",
    "SCALE",
    "KATASTERAMT",
    "DATE",
  ],
  dxfLayers: ["BOUNDARY", "TEXT-FLURSTUECK", "TITLE-BLOCK", "NORTH-ARROW", "SCALE-BAR"],
  requiresProfessionalSeal: false, // Katasteramt-issued, not surveyor-sealed
};

// ─── The canonical config ────────────────────────────────────────

export const GERMANY: CountrySurveyConfig = {
  countryCode: "DE",
  countryName: "Germany",
  regulatoryBody: [
    {
      name: "AdV (Arbeitsgemeinschaft der Vermessungsverwaltungen der Länder)",
      url: "https://www.adv-online.de/",
      scope: "national — joint state survey authorities (geodesy, ALKIS)",
    },
    {
      name: "DVW (Deutscher Verein für Vermessungswesen)",
      url: "https://www.dvw.de/",
      scope: "national — professional society & continuing education",
    },
  ],
  geodeticFramework: {
    datum: "ETRS89",
    primarySRID: 25832,
    heightSystem: "DHHN2016 (Deutsches Haupthöhennetz 2016)",
    projectionZones: [UTM_ZONE_32N, UTM_ZONE_33N, GK_ZONE_3],
    legacyDatums: [
      {
        from: "DHDN (Deutsches Hauptdreiecksnetz, Bessel 1841)",
        to: "ETRS89",
        helmert: {
          // DHDN → ETRS89: regional 7-parameter (varies by Bundesland).
          // Values approximate the widely published DHDN→WGS84
          // (ETRS89 ≈ WGS84 at sub-metre). For survey-grade work use
          // the official NTV2 grid transformation from AdV.
          tx: 598.1, ty: 73.7, tz: 418.2,
          rx_arcsec: 0.202, ry_arcsec: 0.045, rz_arcsec: -2.455,
          scale_ppm: 6.7,
        },
        // TODO: verify rotation-sign convention against the sidecar's
        // Position Vector convention (helmert.rs) before any real
        // transform consumes this config — EPSG::1777 is sometimes
        // quoted with inverted rotation signs.
        source: "DHDN → ETRS89 (regional approximation); AdV NTV2 grid for survey-grade",
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
  statutoryDocuments: [GRENZFESTSTELLUNG, ABMARKUNGSPROTOKOLL, ALKIS_EXTRACT],
  professionalBody: {
    name: "DVW (Deutscher Verein für Vermessungswesen) / ÖbVI registers",
    url: "https://www.dvw.de/",
    registrationNumberField: "ÖbVI Reg. No.",
    registrationPattern: "^\\d{4,6}$",
  },
  sectionalPropertyRegime: {
    legislation: "Wohnungseigentumsgesetz (WEG)",
    planType: "Aufteilungsplan (division plan)",
    requiresParticipationQuotas: true,
    source: "WEG, § 7 — Aufteilungsplan with Miteigentumsanteile (co-ownership shares)",
  },
  sourceDocsRequired: [
    "AdV Geodateninfrastruktur specifications (ETRS89/UTM adoption)",
    "State Vermessungsgesetze (per Bundesland)",
    "Wohnungseigentumsgesetz (WEG)",
    "DVW professional practice guidelines",
  ],
  planSheet: {
    defaultSheetSize: "a4",
    defaultOrientation: "portrait",
    titleBlockLabel: "BUNDESREPUBLIK DEUTSCHLAND — AMTLICHES VERMESSUNGSWESEN",
    planTypeLabel: "AMTLICHER LAGEPLAN / LIEGENSCHAFTSKARTE",
    footerNote:
      "Prepared under the Vermessungs- und Katastergesetze (AdV framework). " +
      "Coordinates in ETRS89 / UTM (EPSG:25832 ff.).",
    titleBlockLayout: {
      // Amtlicher Lageplan title block — ALKIS cadastral identifiers
      // (Gemarkung/Flur/Flurstück, ALKIS extract fields) + ÖbVI seal.
      variant: "standard",
      fieldRows: [
        { label: "GEMARKUNG" },
        { label: "FLUR" },
        { label: "FLURSTÜCK-NR." },
        { label: "GEMEINDE" },
        { label: "LANDKREIS" },
        { label: "BUNDESLAND" },
        { label: "MASSSTAB", value: "{{scale}}" },
        { label: "DATUM", value: "{{date}}" },
      ],
      certification: {
        heading: "BESCHEINIGUNG",
        lines: [
          "Hiermit wird bescheinigt, dass dieser Amtliche Lageplan nach den",
          "Vorschriften der Vermessungs- und Katastergesetze und des ALKIS",
          "Datenmodells (AdV) erstellt wurde.",
        ],
      },
      seal: {
        position: "bottom-right",
        caption: "ÖFFENTLICH BESTELLTER VERMESSUNGSINGENIEUR (ÖBVI)",
      },
      statutoryFooterLines: [
        "Dieser Plan ist nach den Vermessungs- und Katastergesetzen der Länder",
        "(AdV) erstellt und nur für den bezeichneten Zweck verwertbar. Die",
        "unbefugte Vervielfältigung ist unzulässig. Koordinaten in ETRS89 / UTM",
        "(EPSG:25832 ff.).",
      ],
    },
  },
  version: "0.1.3",
  lastReviewed: "2026-08-01",
};
