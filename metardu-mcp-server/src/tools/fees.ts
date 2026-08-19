import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ─── Fee data (inline, no external dependency) ──────────────────

type CountryCode = "KE" | "AU" | "GB" | "ZA" | "AE" | "DE" | "US" | "GH";

interface FeeScale {
  currency: string;
  symbol: string;
  locale: string;
  vatRate: number;
  vatLabel: string;
  baseFee: number;
  areaFeePerHa: number;
  beaconFee: number;
  traverseFeePerKm: number;
  terrainMultipliers: { label: string; multiplier: number }[];
  hourlyRate: number;
  regulatoryRef: string;
  professionalBody: string;
  minimumFee?: number;
}

const FEES: Record<CountryCode, FeeScale> = {
  KE: { currency: "KES", symbol: "KSh", locale: "en-KE", vatRate: 0.16, vatLabel: "VAT (16%)", baseFee: 45_000, areaFeePerHa: 12_000, beaconFee: 3_500, traverseFeePerKm: 15_000, terrainMultipliers: [{ label: "Flat", multiplier: 1.0 }, { label: "Undulating", multiplier: 1.2 }, { label: "Steep", multiplier: 1.5 }], hourlyRate: 5_000, regulatoryRef: "Survey Act Cap. 299", professionalBody: "ISK", minimumFee: 50_000 },
  AU: { currency: "AUD", symbol: "A$", locale: "en-AU", vatRate: 0.10, vatLabel: "GST (10%)", baseFee: 2_800, areaFeePerHa: 1_500, beaconFee: 450, traverseFeePerKm: 3_200, terrainMultipliers: [{ label: "Flat", multiplier: 1.0 }, { label: "Undulating", multiplier: 1.15 }, { label: "Mountainous", multiplier: 1.4 }], hourlyRate: 220, regulatoryRef: "AICPS Scale of Fees", professionalBody: "AICPS", minimumFee: 1_500 },
  GB: { currency: "GBP", symbol: "£", locale: "en-GB", vatRate: 0.20, vatLabel: "VAT (20%)", baseFee: 1_800, areaFeePerHa: 950, beaconFee: 350, traverseFeePerKm: 2_500, terrainMultipliers: [{ label: "Open", multiplier: 1.0 }, { label: "Moderate", multiplier: 1.15 }, { label: "Difficult", multiplier: 1.35 }], hourlyRate: 175, regulatoryRef: "RICS Scale of Charges", professionalBody: "RICS", minimumFee: 800 },
  ZA: { currency: "ZAR", symbol: "R", locale: "en-ZA", vatRate: 0.15, vatLabel: "VAT (15%)", baseFee: 28_000, areaFeePerHa: 8_500, beaconFee: 2_800, traverseFeePerKm: 12_000, terrainMultipliers: [{ label: "Flat", multiplier: 1.0 }, { label: "Undulating", multiplier: 1.2 }, { label: "Mountainous", multiplier: 1.5 }], hourlyRate: 3_500, regulatoryRef: "SACNASP Act", professionalBody: "SACNASP", minimumFee: 35_000 },
  AE: { currency: "AED", symbol: "د.إ", locale: "ar-AE", vatRate: 0.05, vatLabel: "VAT (5%)", baseFee: 8_000, areaFeePerHa: 4_200, beaconFee: 1_200, traverseFeePerKm: 6_500, terrainMultipliers: [{ label: "Urban", multiplier: 1.0 }, { label: "Suburban", multiplier: 1.1 }, { label: "Desert", multiplier: 1.3 }], hourlyRate: 600, regulatoryRef: "Dubai Municipality Survey Fee Schedule", professionalBody: "Dubai Municipality", minimumFee: 5_000 },
  DE: { currency: "EUR", symbol: "€", locale: "de-DE", vatRate: 0.19, vatLabel: "MwSt. (19%)", baseFee: 2_200, areaFeePerHa: 1_100, beaconFee: 380, traverseFeePerKm: 2_800, terrainMultipliers: [{ label: "Einfach", multiplier: 1.0 }, { label: "Mittel", multiplier: 1.15 }, { label: "Schwierig", multiplier: 1.35 }], hourlyRate: 185, regulatoryRef: "HOAI Honorartafel 9", professionalBody: "DVW", minimumFee: 1_200 },
  US: { currency: "USD", symbol: "$", locale: "en-US", vatRate: 0.0, vatLabel: "Sales Tax (varies)", baseFee: 3_500, areaFeePerHa: 1_800, beaconFee: 500, traverseFeePerKm: 4_000, terrainMultipliers: [{ label: "Flat", multiplier: 1.0 }, { label: "Rolling", multiplier: 1.15 }, { label: "Mountainous", multiplier: 1.4 }], hourlyRate: 200, regulatoryRef: "ALTA/NSPS Standards", professionalBody: "NSPS", minimumFee: 2_000 },
  GH: { currency: "GHS", symbol: "GH₵", locale: "en-GH", vatRate: 0.15, vatLabel: "VAT (15%)", baseFee: 18_000, areaFeePerHa: 6_000, beaconFee: 2_000, traverseFeePerKm: 8_000, terrainMultipliers: [{ label: "Flat", multiplier: 1.0 }, { label: "Undulating", multiplier: 1.2 }, { label: "Steep", multiplier: 1.5 }], hourlyRate: 2_500, regulatoryRef: "Land Act 2020 (Act 1036)", professionalBody: "GhIS", minimumFee: 20_000 },
};

function formatCurrency(amount: number, code: CountryCode): string {
  const s = FEES[code];
  return new Intl.NumberFormat(s.locale, { style: "currency", currency: s.currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}

export function registerFeeTools(server: McpServer): void {
  server.registerTool(
    "metardu_fee_estimate",
    {
      title: "Survey Fee Estimation",
      description:
        "Compute statutory surveyor fees for a country. Returns a full breakdown: base fee, area fee, beacon fee, traverse fee, terrain adjustment, VAT, and total. " +
        "Supported countries: KE (Kenya), AU (Australia), GB (UK), ZA (South Africa), AE (UAE), DE (Germany), US (USA), GH (Ghana).",
      inputSchema: {
        country: z.enum(["KE", "AU", "GB", "ZA", "AE", "DE", "US", "GH"]).describe("ISO 3166-1 alpha-2 country code"),
        area_hectares: z.number().min(0).describe("Parcel area in hectares"),
        beacon_count: z.number().int().min(0).describe("Number of beacons placed/checked"),
        traverse_km: z.number().min(0).describe("Control traverse length in km"),
        terrain: z
          .enum(["flat", "undulating", "steep"])
          .default("flat")
          .describe("Terrain difficulty: flat (1.0×), undulating (1.2×), steep (1.5×)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ country, area_hectares, beacon_count, traverse_km, terrain }) => {
      const scale = FEES[country];
      const terrainIdx = terrain === "flat" ? 0 : terrain === "undulating" ? 1 : 2;
      const terrainMultiplier = scale.terrainMultipliers[terrainIdx]!.multiplier;

      const baseFee = scale.baseFee;
      const areaFee = area_hectares * scale.areaFeePerHa;
      const beaconFee = beacon_count * scale.beaconFee;
      const traverseFee = traverse_km * scale.traverseFeePerKm;
      const subtotalBeforeTerrain = baseFee + areaFee + beaconFee + traverseFee;
      let subtotalAfterTerrain = subtotalBeforeTerrain * terrainMultiplier;
      let minimumApplied = false;

      if (scale.minimumFee && subtotalAfterTerrain < scale.minimumFee) {
        subtotalAfterTerrain = scale.minimumFee;
        minimumApplied = true;
      }

      const vat = subtotalAfterTerrain * scale.vatRate;
      const total = subtotalAfterTerrain + vat;

      const breakdown = {
        country,
        currency: scale.currency,
        symbol: scale.symbol,
        base_fee: baseFee,
        area_fee: areaFee,
        beacon_fee: beaconFee,
        traverse_fee: traverseFee,
        subtotal_before_terrain: subtotalBeforeTerrain,
        terrain_label: scale.terrainMultipliers[terrainIdx]!.label,
        terrain_multiplier: terrainMultiplier,
        subtotal_after_terrain: round2(subtotalAfterTerrain),
        vat_label: scale.vatLabel,
        vat_rate: scale.vatRate,
        vat: round2(vat),
        total: round2(total),
        total_formatted: formatCurrency(total, country),
        hourly_rate: scale.hourlyRate,
        minimum_applied: minimumApplied,
        regulatory_ref: scale.regulatoryRef,
        professional_body: scale.professionalBody,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(breakdown, null, 2) }],
      };
    },
  );

  server.registerTool(
    "metardu_fee_list_countries",
    {
      title: "List Fee Scale Countries",
      description: "List all countries with available statutory fee scales.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const countries = (Object.keys(FEES) as CountryCode[]).map((code) => {
        const s = FEES[code];
        return {
          code,
          currency: s.currency,
          symbol: s.symbol,
          professional_body: s.professionalBody,
          regulatory_ref: s.regulatoryRef,
          terrain_options: s.terrainMultipliers.map((t) => t.label),
        };
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(countries, null, 2) }],
      };
    },
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
