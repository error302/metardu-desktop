/**
 * @metardu/country-config — public API.
 *
 * This package is the canonical source of country-specific survey
 * configuration. Workflow modules, document renderers, and the UI all
 * read tolerances, SRIDs, and statutory document specs through this
 * layer — never from local constants.
 *
 * # Implemented countries
 *
 *   - KE  Kenya         (Phase 5 — reference implementation per ADR-0004)
 *   - AU  Australia     (Phase 8 — NSW first; other states are separate future configs)
 *   - GB  United Kingdom (Phase 8 — general boundaries rule; RICS framework)
 *   - ZA  South Africa  (Phase 8 — Hartebeesthoek94/Lo zones, SG Diagrams)
 *   - AE  UAE           (Phase 8 — Dubai first; other emirates are separate future configs)
 *   - DE  Germany       (ETRS89/UTM; AdV framework — high-value subscription market)
 *   - US  United States (NAD83/SPCS + ALTA-NSPS; FGCS standards)
 *   - GH  Ghana         (GGRN/Leigon Ghana Metre Grid; Lands Commission cadastral plans)
 *
 * Per invariant B1, statutory document renderers can only be built for
 * countries whose source documents are filed in
 * docs/regulatory-sources/<country>/. Check each config's
 * sourceDocsRequired field for the outstanding-documents list.
 */

export type {
  CertificationBlock,
  CountryCode,
  CountrySurveyConfig,
  GeodeticFramework,
  LegacyDatumTransform,
  PlanSheetProfile,
  ProfessionalBodyRef,
  ProjectionZone,
  RegulatoryBodyRef,
  SealPlacement,
  SectionalTitleConfig,
  StatutoryDocSpec,
  TitleBlockFieldRow,
  TitleBlockLayout,
  TitleBlockVariant,
  ToleranceInput,
  ToleranceRule,
} from "./types.js";

// Kenya (reference implementation)
export {
  KENYA,
  angularMisclosureToleranceArcsec,
  getProjectionZone,
  getStatutoryDoc,
  getTolerance,
  levellingToleranceMm,
  linearMisclosureRatio,
} from "./countries/kenya.js";

// Australia (NSW first)
export { AUSTRALIA } from "./countries/australia.js";

// United Kingdom
export { UNITED_KINGDOM, UK_ETRS89_SRID } from "./countries/united-kingdom.js";

// South Africa
export { SOUTH_AFRICA } from "./countries/south-africa.js";

// United Arab Emirates (Dubai first)
export { UNITED_ARAB_EMIRATES } from "./countries/united-arab-emirates.js";

// Germany
export { GERMANY } from "./countries/germany.js";

// United States
export { UNITED_STATES } from "./countries/united-states.js";

// Ghana
export { GHANA } from "./countries/ghana.js";

// ─── Registry of all country configs ─────────────────────────────

import { KENYA } from "./countries/kenya.js";
import { AUSTRALIA } from "./countries/australia.js";
import { UNITED_KINGDOM } from "./countries/united-kingdom.js";
import { SOUTH_AFRICA } from "./countries/south-africa.js";
import { UNITED_ARAB_EMIRATES } from "./countries/united-arab-emirates.js";
import { GERMANY } from "./countries/germany.js";
import { UNITED_STATES } from "./countries/united-states.js";
import { GHANA } from "./countries/ghana.js";
import type { CountryCode, CountrySurveyConfig } from "./types.js";

/**
 * Map of all country configs by ISO code.
 *
 * Looking up a country by code returns its config (or undefined if not
 * yet implemented).
 */
export const COUNTRY_REGISTRY: Record<CountryCode, CountrySurveyConfig | undefined> = {
  KE: KENYA,
  AU: AUSTRALIA,
  GB: UNITED_KINGDOM,
  ZA: SOUTH_AFRICA,
  AE: UNITED_ARAB_EMIRATES,
  DE: GERMANY,
  US: UNITED_STATES,
  GH: GHANA,
};

/**
 * Get a country config by code. Throws if the country isn't implemented yet.
 */
export function getCountryConfig(code: CountryCode): CountrySurveyConfig {
  const config = COUNTRY_REGISTRY[code];
  if (!config) {
    throw new Error(
      `Country '${code}' is not yet implemented. Per the master plan, ` +
        `adding a country requires its source regulatory documents to be filed in ` +
        `docs/regulatory-sources/${code.toLowerCase()}/ first (invariant B1).`,
    );
  }
  return config;
}

/**
 * List of currently-implemented country codes (configs that are not undefined).
 */
export function implementedCountries(): CountryCode[] {
  return (Object.keys(COUNTRY_REGISTRY) as CountryCode[]).filter(
    (c) => COUNTRY_REGISTRY[c] !== undefined,
  );
}

/**
 * Full CRS name for a country's primary projection zone — the string
 * printed on statutory plan title strips and the {{crs}} token in the
 * title block (e.g. the US "SPCS ZONE" field on ALTA/NSPS plats).
 *
 * Zone names already embed the datum ("NAD83(2011) / Texas South
 * Central", "Arc 1960 / UTM zone 37S", "Hartebeesthoek94 / Lo27"), so
 * this never double-prints it — a naive `datum + " / " + zone.name`
 * produced "NAD83(2011) / NAD83(2011) / Texas South Central" on US
 * plans and "Arc 1960 / Arc 1960 / UTM zone 37S" on Kenyan ones.
 *
 * Rule: a compound zone name (contains "/", i.e. already a full
 * "datum / projection" EPSG name) is used as-is; a bare zone name
 * ("UTM zone 37S") gets the datum prefix. Falls back to the datum
 * label when the primary zone isn't defined.
 */
export function crsLabelForCountry(code: CountryCode): string {
  const cfg = getCountryConfig(code);
  const zone = cfg.geodeticFramework.projectionZones.find(
    (z) => z.srid === cfg.geodeticFramework.primarySRID,
  );
  if (!zone) return cfg.geodeticFramework.datum;
  return zone.name.includes("/")
    ? zone.name
    : `${cfg.geodeticFramework.datum} / ${zone.name}`;
}
