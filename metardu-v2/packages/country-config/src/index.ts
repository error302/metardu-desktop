/**
 * @metardu/country-config — public API.
 *
 * This package is the canonical source of country-specific survey
 * configuration. Workflow modules, document renderers, and the UI all
 * read tolerances, SRIDs, and statutory document specs through this
 * layer — never from local constants.
 *
 * # Adding a new country
 *
 * 1. Create `src/countries/<country>.ts` implementing `CountrySurveyConfig`.
 * 2. Cite every value's source (regulation + page/clause).
 * 3. File the source PDFs under `docs/regulatory-sources/<country>/`.
 * 4. Add golden fixtures under `tests/golden-fixtures/<country>/`.
 * 5. Re-export from this index.
 *
 * Per ADR-0004, Kenya is the reference implementation. The first new
 * country (Phase 8+) will prove the abstraction scales.
 */

export type {
  CountryCode,
  CountrySurveyConfig,
  GeodeticFramework,
  LegacyDatumTransform,
  ProfessionalBodyRef,
  ProjectionZone,
  RegulatoryBodyRef,
  SectionalTitleConfig,
  StatutoryDocSpec,
  ToleranceInput,
  ToleranceRule,
} from "./types.js";

export {
  KENYA,
  angularMisclosureToleranceArcsec,
  getProjectionZone,
  getStatutoryDoc,
  getTolerance,
  levellingToleranceMm,
  linearMisclosureRatio,
} from "./countries/kenya.js";

// ─── Registry of all country configs ─────────────────────────────
//
// Phase 8+ will add AUSTRALIA, UNITED_KINGDOM, SOUTH_AFRICA,
// UNITED_ARAB_EMIRATES. Until then, the registry contains only Kenya.

import { KENYA } from "./countries/kenya.js";
import type { CountryCode, CountrySurveyConfig } from "./types.js";

/**
 * Map of all country configs by ISO code.
 *
 * Looking up a country by code returns its config (or undefined).
 * Workflow code that needs to switch behavior by country should use
 * this registry.
 */
export const COUNTRY_REGISTRY: Record<CountryCode, CountrySurveyConfig | undefined> = {
  KE: KENYA,
  AU: undefined, // Phase 8 — pick one state first (NSW or VIC) per master plan §8.2
  GB: undefined, // Phase 8+ — RICS framework
  ZA: undefined, // Phase 8+ — Hartebeesthoek94/Lo
  AE: undefined, // Phase 8+ — Dubai-only first per master plan §8.5
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
