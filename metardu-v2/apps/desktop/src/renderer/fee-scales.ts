/**
 * fee-scales.ts — Multi-country statutory surveyor fee scales.
 *
 * Each country config defines:
 *   - Currency code + symbol
 *   - VAT/sales tax rate
 *   - Base lodgement fee
 *   - Area fee per hectare
 *   - Beacon fee per beacon
 *   - Traverse fee per km
 *   - Terrain multipliers
 *   - Hourly professional rate
 *   - Regulatory body reference
 *
 * Fee data is based on published statutory scales:
 *   - Kenya: LSB Scale of Fees (Survey Act Cap. 299)
 *   - Australia: Average surveyor fees (AICPS/SAIA guidelines)
 *   - UK: RICS scale of professional charges
 *   - South Africa: SACNASP / PLATO fee guidelines
 *   - UAE: Dubai Municipality survey fee schedule
 *   - Germany: HOAI (Honorarordnung für Architekten und Ingenieure)
 *   - US: ALTA/NSPS customary professional fees
 *   - Ghana: GhIS / SMD fee schedule
 */

export type CountryFeeCode = "KE" | "AU" | "GB" | "ZA" | "AE" | "DE" | "US" | "GH";

export interface TerrainMultiplier {
  label: string;
  multiplier: number;
}

export interface FeeScale {
  /** ISO 4217 currency code. */
  currency: string;
  /** Currency symbol for display. */
  symbol: string;
  /** Locale code for formatting (e.g. "en-KE", "en-GB"). */
  locale: string;
  /** VAT / sales tax rate as decimal (e.g. 0.16 for 16%). */
  vatRate: number;
  /** VAT label (e.g. "VAT", "GST", "MwVAT"). */
  vatLabel: string;
  /** Base lodgement / plan fee. */
  baseFee: number;
  /** Fee per hectare of parcel area. */
  areaFeePerHa: number;
  /** Fee per beacon placed/checked. */
  beaconFee: number;
  /** Fee per km of control traverse. */
  traverseFeePerKm: number;
  /** Terrain difficulty multipliers. */
  terrainMultipliers: TerrainMultiplier[];
  /** Hourly professional rate (for time-based billing). */
  hourlyRate: number;
  /** Regulatory reference. */
  regulatoryRef: string;
  /** Professional body name. */
  professionalBody: string;
  /** Minimum fee floor (some countries mandate minimums). */
  minimumFee?: number;
}

// ─── Kenya (KES) ────────────────────────────────────────────────

const KENYA_FEES: FeeScale = {
  currency: "KES",
  symbol: "KSh",
  locale: "en-KE",
  vatRate: 0.16,
  vatLabel: "VAT (16%)",
  baseFee: 45_000,
  areaFeePerHa: 12_000,
  beaconFee: 3_500,
  traverseFeePerKm: 15_000,
  terrainMultipliers: [
    { label: "Flat / Open Country", multiplier: 1.0 },
    { label: "Undulating / Light Bush", multiplier: 1.2 },
    { label: "Steep / Dense Forest", multiplier: 1.5 },
  ],
  hourlyRate: 5_000,
  regulatoryRef: "Survey Act Cap. 299, LSB Scale of Fees",
  professionalBody: "Institution of Surveyors of Kenya (ISK)",
  minimumFee: 50_000,
};

// ─── Australia (AUD) ────────────────────────────────────────────

const AUSTRALIA_FEES: FeeScale = {
  currency: "AUD",
  symbol: "A$",
  locale: "en-AU",
  vatRate: 0.10,
  vatLabel: "GST (10%)",
  baseFee: 2_800,
  areaFeePerHa: 1_500,
  beaconFee: 450,
  traverseFeePerKm: 3_200,
  terrainMultipliers: [
    { label: "Flat / Open", multiplier: 1.0 },
    { label: "Undulating / Light Scrub", multiplier: 1.15 },
    { label: "Mountainous / Dense Bush", multiplier: 1.4 },
  ],
  hourlyRate: 220,
  regulatoryRef: "AICPS Scale of Fees; Surveying and Spatial Science Institute (SSSI)",
  professionalBody: "Australian Institute of Surveyors (AICPS)",
  minimumFee: 1_500,
};

// ─── United Kingdom (GBP) ───────────────────────────────────────

const UK_FEES: FeeScale = {
  currency: "GBP",
  symbol: "£",
  locale: "en-GB",
  vatRate: 0.20,
  vatLabel: "VAT (20%)",
  baseFee: 1_800,
  areaFeePerHa: 950,
  beaconFee: 350,
  traverseFeePerKm: 2_500,
  terrainMultipliers: [
    { label: "Open / Flat", multiplier: 1.0 },
    { label: "Moderate / Partial Obstruction", multiplier: 1.15 },
    { label: "Difficult / Dense Vegetation", multiplier: 1.35 },
  ],
  hourlyRate: 175,
  regulatoryRef: "RICS Scale of Professional Charges; Land Registration Act 2002",
  professionalBody: "Royal Institution of Chartered Surveyors (RICS)",
  minimumFee: 800,
};

// ─── South Africa (ZAR) ─────────────────────────────────────────

const SA_FEES: FeeScale = {
  currency: "ZAR",
  symbol: "R",
  locale: "en-ZA",
  vatRate: 0.15,
  vatLabel: "VAT (15%)",
  baseFee: 28_000,
  areaFeePerHa: 8_500,
  beaconFee: 2_800,
  traverseFeePerKm: 12_000,
  terrainMultipliers: [
    { label: "Flat / Open", multiplier: 1.0 },
    { label: "Undulating / Light Bushveld", multiplier: 1.2 },
    { label: "Mountainous / Dense", multiplier: 1.5 },
  ],
  hourlyRate: 3_500,
  regulatoryRef: "SACNASP Act (Act 28 of 2013); PLATO fee guidelines",
  professionalBody: "South African Council for Natural Scientific Professions (SACNASP)",
  minimumFee: 35_000,
};

// ─── UAE (AED) ──────────────────────────────────────────────────

const UAE_FEES: FeeScale = {
  currency: "AED",
  symbol: "د.إ",
  locale: "ar-AE",
  vatRate: 0.05,
  vatLabel: "VAT (5%)",
  baseFee: 8_000,
  areaFeePerHa: 4_200,
  beaconFee: 1_200,
  traverseFeePerKm: 6_500,
  terrainMultipliers: [
    { label: "Urban / Flat", multiplier: 1.0 },
    { label: "Suburban / Light Terrain", multiplier: 1.1 },
    { label: "Desert / Difficult Access", multiplier: 1.3 },
  ],
  hourlyRate: 600,
  regulatoryRef: "Dubai Municipality Survey Fee Schedule; RERA guidelines",
  professionalBody: "Dubai Municipality — Survey Department",
  minimumFee: 5_000,
};

// ─── Germany (EUR) ──────────────────────────────────────────────

const GERMANY_FEES: FeeScale = {
  currency: "EUR",
  symbol: "€",
  locale: "de-DE",
  vatRate: 0.19,
  vatLabel: "MwSt. (19%)",
  baseFee: 2_200,
  areaFeePerHa: 1_100,
  beaconFee: 380,
  traverseFeePerKm: 2_800,
  terrainMultipliers: [
    { label: "Einfach / Flach", multiplier: 1.0 },
    { label: "Mittel / Hügelig", multiplier: 1.15 },
    { label: "Schwierig / Bergig", multiplier: 1.35 },
  ],
  hourlyRate: 185,
  regulatoryRef: "HOAI (Honorarordnung für Architekten und Ingenieure), Honorartafel 9",
  professionalBody: "Bundesingenieurkammer (bfiK); Deutsche Gesellschaft für Vermessung (DVW)",
  minimumFee: 1_200,
};

// ─── United States (USD) ────────────────────────────────────────

const US_FEES: FeeScale = {
  currency: "USD",
  symbol: "$",
  locale: "en-US",
  vatRate: 0.0,
  vatLabel: "Sales Tax (varies by state)",
  baseFee: 3_500,
  areaFeePerHa: 1_800,
  beaconFee: 500,
  traverseFeePerKm: 4_000,
  terrainMultipliers: [
    { label: "Flat / Urban", multiplier: 1.0 },
    { label: "Rolling / Suburban", multiplier: 1.15 },
    { label: "Mountainous / Remote", multiplier: 1.4 },
  ],
  hourlyRate: 200,
  regulatoryRef: "ALTA/NSPS Land Title Survey Standards; state licensing boards",
  professionalBody: "National Society of Professional Surveyors (NSPS)",
  minimumFee: 2_000,
};

// ─── Ghana (GHS) ────────────────────────────────────────────────

const GHANA_FEES: FeeScale = {
  currency: "GHS",
  symbol: "GH₵",
  locale: "en-GH",
  vatRate: 0.15,
  vatLabel: "VAT (15%)",
  baseFee: 18_000,
  areaFeePerHa: 6_000,
  beaconFee: 2_000,
  traverseFeePerKm: 8_000,
  terrainMultipliers: [
    { label: "Flat / Open", multiplier: 1.0 },
    { label: "Undulating / Light Bush", multiplier: 1.2 },
    { label: "Steep / Dense Forest", multiplier: 1.5 },
  ],
  hourlyRate: 2_500,
  regulatoryRef: "Land Act 2020 (Act 1036); GhIS fee schedule",
  professionalBody: "Ghana Institution of Surveyors (GhIS)",
  minimumFee: 20_000,
};

// ─── Registry ───────────────────────────────────────────────────

const FEE_REGISTRY: Record<CountryFeeCode, FeeScale> = {
  KE: KENYA_FEES,
  AU: AUSTRALIA_FEES,
  GB: UK_FEES,
  ZA: SA_FEES,
  AE: UAE_FEES,
  DE: GERMANY_FEES,
  US: US_FEES,
  GH: GHANA_FEES,
};

/** Get the fee scale for a country code. */
export function getFeeScale(code: CountryFeeCode): FeeScale {
  return FEE_REGISTRY[code];
}

/** All supported country fee codes. */
export function allFeeCodes(): CountryFeeCode[] {
  return Object.keys(FEE_REGISTRY) as CountryFeeCode[];
}

/** Format a number as currency. */
export function formatCurrency(amount: number, code: CountryFeeCode): string {
  const scale = FEE_REGISTRY[code];
  return new Intl.NumberFormat(scale.locale, {
    style: "currency",
    currency: scale.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// ─── Fee Computation ────────────────────────────────────────────

export interface FeeInput {
  areaHa: number;
  beaconCount: number;
  traverseKm: number;
  terrainIndex: number;
}

export interface FeeBreakdown {
  baseFee: number;
  areaFee: number;
  beaconFee: number;
  traverseFee: number;
  subtotalBeforeTerrain: number;
  terrainMultiplier: number;
  subtotalAfterTerrain: number;
  vat: number;
  total: number;
  currency: string;
  symbol: string;
  vatLabel: string;
  hourlyRate: number;
  /** Minimum fee floor applied. */
  minimumApplied: boolean;
}

/** Compute the full fee breakdown for a country. */
export function computeFeeBreakdown(
  code: CountryFeeCode,
  input: FeeInput,
): FeeBreakdown {
  const scale = FEE_REGISTRY[code];

  const baseFee = scale.baseFee;
  const areaFee = input.areaHa * scale.areaFeePerHa;
  const beaconFee = input.beaconCount * scale.beaconFee;
  const traverseFee = input.traverseKm * scale.traverseFeePerKm;

  const subtotalBeforeTerrain = baseFee + areaFee + beaconFee + traverseFee;

  const terrainIdx = Math.min(input.terrainIndex, scale.terrainMultipliers.length - 1);
  const terrainMultiplier = scale.terrainMultipliers[terrainIdx]?.multiplier ?? 1.0;

  let subtotalAfterTerrain = subtotalBeforeTerrain * terrainMultiplier;
  let minimumApplied = false;

  if (scale.minimumFee && subtotalAfterTerrain < scale.minimumFee) {
    subtotalAfterTerrain = scale.minimumFee;
    minimumApplied = true;
  }

  const vat = subtotalAfterTerrain * scale.vatRate;
  const total = subtotalAfterTerrain + vat;

  return {
    baseFee,
    areaFee,
    beaconFee,
    traverseFee,
    subtotalBeforeTerrain,
    terrainMultiplier,
    subtotalAfterTerrain,
    vat,
    total,
    currency: scale.currency,
    symbol: scale.symbol,
    vatLabel: scale.vatLabel,
    hourlyRate: scale.hourlyRate,
    minimumApplied,
  };
}
