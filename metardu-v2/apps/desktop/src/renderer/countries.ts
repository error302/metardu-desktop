/**
 * Shared country selection helper for the renderer.
 *
 * Derives the country dropdown options from the canonical
 * @metardu/country-config registry (`implementedCountries()` +
 * `getCountryConfig()`), so the UI can never drift from the set of
 * implemented countries. Add a new country config → it appears here.
 */

import {
  getCountryConfig,
  crsLabelForCountry,
  implementedCountries,
  type CountryCode,
  type CountrySurveyConfig,
  type TitleBlockLayout,
} from "@metardu/country-config";

export interface CountryOption {
  code: CountryCode;
  name: string;
  config: CountrySurveyConfig;
}

/** All implemented countries, ordered by registry order. */
export const COUNTRY_OPTIONS: CountryOption[] = implementedCountries().map((code) => ({
  code,
  name: getCountryConfig(code).countryName,
  config: getCountryConfig(code),
}));

/** Convenience: code → config lookup for the views. */
export function getCountryOption(code: string): CountryOption {
  const option = COUNTRY_OPTIONS.find((o) => o.code === code);
  if (!option) {
    throw new Error(`Country '${code}' is not implemented. Available: ${COUNTRY_OPTIONS.map((o) => o.code).join(", ")}`);
  }
  return option;
}

/**
 * Full CRS name for the plan's title strip / {{crs}} token — shared
 * datum-deduped source of truth (crsLabelForCountry in country-config),
 * so the US SPCS ZONE field never double-prints the datum. Mirrors the
 * main process's resolveCrsLabel exactly; unknown codes return undefined.
 */
export function crsLabelFor(code?: string): string | undefined {
  if (!code) return undefined;
  try {
    return crsLabelForCountry(code as CountryCode);
  } catch {
    return undefined;
  }
}

/** The renderer's slice of the per-country statutory plan-sheet profile. */
export interface RendererPlanSheet {
  defaultSheetSize: string;
  defaultOrientation: "landscape" | "portrait";
  titleBlockLabel?: string;
  planTypeLabel?: string;
  footerNote?: string;
  /** Per-market statutory title block (field grid, certification, seal). */
  titleBlockLayout?: TitleBlockLayout;
}

/** Fallback when a country has no planSheet profile (shouldn't happen — all 8 define one). */
export const DEFAULT_PLAN_SHEET: RendererPlanSheet = {
  defaultSheetSize: "a4",
  defaultOrientation: "landscape",
};

/**
 * Per-country statutory plan-sheet defaults for the print-preview panel
 * and ExportPanel. Mirrors the main process's resolvePlanSheet.
 */
export function getPlanSheet(code?: string): RendererPlanSheet {
  if (!code) return DEFAULT_PLAN_SHEET;
  try {
    const ps = getCountryOption(code).config.planSheet;
    if (!ps) return DEFAULT_PLAN_SHEET;
    return {
      defaultSheetSize: ps.defaultSheetSize,
      defaultOrientation: ps.defaultOrientation,
      titleBlockLabel: ps.titleBlockLabel,
      planTypeLabel: ps.planTypeLabel,
      footerNote: ps.footerNote,
      titleBlockLayout: ps.titleBlockLayout,
    };
  } catch {
    return DEFAULT_PLAN_SHEET;
  }
}
