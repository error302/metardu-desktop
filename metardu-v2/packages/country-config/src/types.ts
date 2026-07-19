/**
 * CountrySurveyConfig — the contract every country config implements.
 *
 * Master plan Section 4.1, ADR-0004. This is the abstraction that lets
 * us add a sixth country later without touching workflow code — new
 * agent brief becomes "implement country-config/<country>.ts against
 * the attached regulations," not "rebuild the cadastral module."
 *
 * The interface is deliberately a plain data shape (no methods). Each
 * country's config is a single const object that can be statically
 * verified against the source regulatory documents.
 */

/** ISO 3166-1 alpha-2 country code. */
export type CountryCode = "KE" | "AU" | "GB" | "ZA" | "AE";

/** Reference to a regulatory body (may be multiple for federal countries). */
export interface RegulatoryBodyRef {
  /** Short name, e.g. "Survey of Kenya" or "ICSM (Australia)". */
  name: string;
  /** URL of the official site. */
  url: string;
  /** Documented scope: "national" or "state: NSW" etc. */
  scope: string;
}

/** Geodetic framework for a country. */
export interface GeodeticFramework {
  /** Datum name, e.g. "Arc 1960", "GDA2020", "Hartebeesthoek94". */
  datum: string;
  /** Primary EPSG SRID. NEVER hardcode this anywhere else. */
  primarySRID: number;
  /** Height system, e.g. "KEN_GEOID", "AHD", "ODN", "LVD/SAVD". */
  heightSystem: string;
  /** Projection zones (e.g. UTM 37S + 38S for Kenya, MGA 49-56 for AU). */
  projectionZones: ProjectionZone[];
  /** Legacy datums for boundary re-establishment, with Helmert params. */
  legacyDatums?: LegacyDatumTransform[];
}

/** A single projection zone definition. */
export interface ProjectionZone {
  /** EPSG SRID for this zone, e.g. 21037 for Arc 1960 / UTM zone 37S. */
  srid: number;
  /** Human-readable zone name, e.g. "UTM zone 37S". */
  name: string;
  /** Projection method, e.g. "Transverse Mercator". */
  method: "Transverse Mercator" | "Cassini-Soldner" | "Lambert Conformal Conic" | string;
  /** Central meridian in decimal degrees. */
  central_meridian_deg: number;
  /** Latitude of origin in decimal degrees. */
  latitude_of_origin_deg: number;
  /** False easting in metres. */
  false_easting_m: number;
  /** False northing in metres. */
  false_northing_m: number;
  /** Scale factor on the central meridian. */
  scale_factor: number;
  /** Ellipsoid name, e.g. "Clarke 1866". */
  ellipsoid: string;
}

/** Legacy-to-modern datum transform (e.g. Cassini → UTM for Kenya). */
export interface LegacyDatumTransform {
  /** Legacy datum name, e.g. "Cassini-Soldner (Kenya colony)". */
  from: string;
  /** Modern datum name, e.g. "Arc 1960". */
  to: string;
  /** Helmert 7-parameter (Position Vector convention, EPSG::9606). */
  helmert: {
    tx: number; ty: number; tz: number;
    rx_arcsec: number; ry_arcsec: number; rz_arcsec: number;
    scale_ppm: number;
  };
  /** Source citation (EPSG transform ID or local regulation). */
  source: string;
}

/** Tolerance rule for a specific survey type. */
export interface ToleranceRule {
  /** Survey type the rule applies to. */
  surveyType: "Cadastral" | "Topographic" | "Engineering" | "Geodetic" | "Levelling" | "Hydrographic" | "Construction" | "Monitoring";
  /** Specific tolerance type, e.g. "levelling_misclosure", "angular_misclosure". */
  toleranceType: string;
  /** Human-readable formula, e.g. "10 × √K mm" or "3.0″ × √N". */
  formula: string;
  /** Functional form: takes the input (K in km, N in stations, etc.) and returns the tolerance in the documented unit. */
  compute: (input: ToleranceInput) => number;
  /** Unit of the returned value, e.g. "mm", "arcsec", "ratio". */
  unit: string;
  /** Source citation (regulation + page/clause). */
  source: string;
}

/** Input to a tolerance computation. */
export interface ToleranceInput {
  /** Line length in kilometres (levelling, linear misclosure). */
  K_km?: number;
  /** Number of stations (angular misclosure). */
  N_stations?: number;
  /** Total traverse length in metres (linear misclosure ratio). */
  total_length_m?: number;
  /** Observed misclosure in metres (for ratio checks). */
  misclosure_m?: number;
}

/** Specification of a statutory document type the country requires. */
export interface StatutoryDocSpec {
  /** Document type identifier, e.g. "Form 3", "SG Diagram", "Beacon Certificate". */
  docType: string;
  /** Human-readable name. */
  name: string;
  /** Regulatory citation, e.g. "Survey Act Cap. 299, Form No. 3". */
  citation: string;
  /** Path to the source PDF in docs/regulatory-sources/<country>/<doc-type>/. */
  sourcePath: string;
  /** Page size, e.g. "A4", "A3", "ANSI B". */
  pageSize: string;
  /** Required margins in mm: [top, right, bottom, left]. */
  margins_mm: [number, number, number, number];
  /** Required scale convention, e.g. "1:500, 1:1000, 1:2500 (cadastral)". */
  scaleConvention: string;
  /** Title block fields the form must contain. */
  titleBlockFields: string[];
  /** Layer name conventions for DXF export. */
  dxfLayers: string[];
  /** True if the form must be signed/sealed by a registered surveyor. */
  requiresProfessionalSeal: boolean;
}

/** Reference to the professional body that registers surveyors. */
export interface ProfessionalBodyRef {
  /** Body name, e.g. "Institution of Surveyors of Kenya (ISK)". */
  name: string;
  /** URL. */
  url: string;
  /** Field name on the registration number, e.g. "PRC No." or "ISK Reg. No.". */
  registrationNumberField: string;
  /** Regex pattern for valid registration numbers (or undefined if no formal format). */
  registrationPattern?: string;
}

/** Sectional property regime (strata title / sectional title) config. */
export interface SectionalTitleConfig {
  /** Enabling legislation, e.g. "Sectional Properties Act 2020 (Kenya)". */
  legislation: string;
  /** Document type for sectional plans, e.g. "Sectional Plan". */
  planType: string;
  /** True if participation quotas must be computed and shown on the plan. */
  requiresParticipationQuotas: boolean;
  /** Source citation. */
  source: string;
}

/** The full country config. */
export interface CountrySurveyConfig {
  /** ISO 3166-1 alpha-2. */
  countryCode: CountryCode;
  /** Human-readable name. */
  countryName: string;
  /** Regulatory body (may be multiple for federal countries). */
  regulatoryBody: RegulatoryBodyRef[];
  /** Geodetic framework. */
  geodeticFramework: GeodeticFramework;
  /** Tolerance rules per survey type. */
  toleranceTable: ToleranceRule[];
  /** Statutory documents the country requires. */
  statutoryDocuments: StatutoryDocSpec[];
  /** Professional body that registers surveyors. */
  professionalBody: ProfessionalBodyRef;
  /** Sectional title regime (null if not applicable). */
  sectionalPropertyRegime?: SectionalTitleConfig;
  /** Source documents that MUST be in docs/regulatory-sources/<country>/ before any renderer is built. */
  sourceDocsRequired: string[];
  /** Config version — bumped when any value changes. */
  version: string;
  /** Date this config was last reviewed (ISO 8601). */
  lastReviewed: string;
}
