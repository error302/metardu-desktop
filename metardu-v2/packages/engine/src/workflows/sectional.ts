/**
 * Sectional Properties workflow — sectional title / strata / condominium plans.
 *
 * Master plan Section 6.5. This is a genuinely distinct legal and
 * geometric problem from cadastral boundary surveying — it deals with
 * unit boundaries WITHIN a building (floor levels, participation
 * quotas, common property) rather than ground boundaries.
 *
 * Every target country handles it differently:
 *   - Kenya: Sectional Properties Act 2020
 *   - Australia (NSW): Strata Schemes Development Act 2015
 *   - UK: Commonhold and Leasehold Reform Act 2002
 *   - South Africa: Sectional Titles Act 95 of 1986
 *   - UAE (Dubai): Law No. 6 of 2019 (Jointly Owned Property)
 *
 * # Pipeline
 *
 *   1. Accept the building footprint + floor plans (one per level)
 *   2. Compute unit boundaries per floor
 *   3. Compute participation quotas (per unit, based on area)
 *   4. Identify common property (corridors, stairwells, lift shafts)
 *   5. Generate sectional plan PDF (per country's statutory doc spec)
 *
 * # Invariant B1 gate
 *
 * Per master plan §6.5, the sectional title regime is country-specific.
 * The actual statutory document renderer requires the source regulation
 * to be filed in docs/regulatory-sources/<country>/sectional/. Until
 * then, this workflow produces a DRAFT plan with a watermark.
 *
 * # References
 *
 *   - Master plan Section 6.5
 *   - Sectional Properties Act 2020 (Kenya)
 *   - Strata Schemes Development Act 2015 (NSW)
 *   - Sectional Titles Act 95 of 1986 (South Africa)
 */

import type { CountrySurveyConfig } from "@metardu/country-config";
import type { PointUncertainty } from "../survey-types.js";

// ─── Types ───────────────────────────────────────────────────────

/** A 2D polygon (closed) — used for unit boundaries, building footprint, etc. */
export interface Polygon {
  /** Vertices in order (closed implicitly). */
  vertices: { easting: number; northing: number }[];
}

/** A building level (floor). */
export interface BuildingLevel {
  /** Level number (0 = ground, 1 = first floor, -1 = basement, etc.). */
  level: number;
  /** Level name (e.g. "Ground Floor", "Basement 1", "Roof"). */
  name: string;
  /** Building footprint at this level (may differ per floor for stepped buildings). */
  footprint: Polygon;
  /** Units on this level. */
  units: SectionalUnit[];
  /** Common property areas on this level (corridors, stairwells, lift shafts). */
  commonProperty: Polygon[];
}

/** A sectional unit (apartment, office, shop, etc.). */
export interface SectionalUnit {
  /** Unit number (e.g. "A1", "101"). */
  number: string;
  /** Unit type. */
  type: "residential" | "commercial" | "parking" | "storage";
  /** Unit boundary polygon. */
  boundary: Polygon;
  /** Unit area in square metres (computed if not provided). */
  area?: number;
}

/** Input to the sectional properties workflow. */
export interface SectionalWorkflowInput {
  /** Building metadata. */
  building: {
    name: string;
    /** Physical address. */
    address: string;
    /** Parent parcel identifier (e.g. "LR No. 12345"). */
    parentParcel: string;
    /** Number of levels (including basement + ground + upper floors). */
    levels: BuildingLevel[];
  };
  /** Active country config. */
  country: CountrySurveyConfig;
  /** Surveyor info. */
  surveyor: {
    name: string;
    regNo: string;
    dateOfSurvey: string;
  };
}

/** Output of the sectional properties workflow. */
export interface SectionalWorkflowOutput {
  /** Per-level results. */
  levels: {
    level: number;
    name: string;
    /** Total floor area (m²). */
    totalArea: number;
    /** Sum of unit areas (m²). */
    unitArea: number;
    /** Common property area (m²). */
    commonArea: number;
    /** Per-unit results. */
    units: {
      number: string;
      type: string;
      area: number;
      /** Participation quota (percentage of total). */
      participationQuota: number;
    }[];
  }[];
  /** Total building area (sum of all levels, m²). */
  totalBuildingArea: number;
  /** Total unit area (sum of all units, m²). */
  totalUnitArea: number;
  /** Total common property area (m²). */
  totalCommonArea: number;
  /** True if the building area = unit area + common area (sanity check). */
  areaBalanceOk: boolean;
  /**
   * Per-point uncertainty. Sectional properties deals with unit areas
   * and participation quotas, not surveyed points — so this is empty
   * by default. When a future task brief ties sectional unit boundaries
   * to surveyed coordinates, this field gets the real ellipses.
   */
  pointUncertainty: Record<string, PointUncertainty>;
  /** Sectional property regime from the country config. */
  regime: {
    legislation: string;
    planType: string;
    requiresParticipationQuotas: boolean;
  };
  /** True if the source regulation is filed (otherwise DRAFT output). */
  sourceFiled: boolean;
}

// ─── Main entry point ────────────────────────────────────────────

export function runSectionalWorkflow(input: SectionalWorkflowInput): SectionalWorkflowOutput {
  if (input.building.levels.length === 0) {
    throw new Error("Sectional workflow requires at least 1 building level.");
  }

  // First pass: compute areas per level + per unit.
  const levelAreas: { total: number; units: number; common: number }[] = [];
  const allUnits: { area: number; level: number; number: string; type: string }[] = [];

  for (const lvl of input.building.levels) {
    const totalArea = polygonArea(lvl.footprint);
    let unitArea = 0;
    const unitResults: { number: string; type: string; area: number }[] = [];

    for (const unit of lvl.units) {
      const area = unit.area ?? polygonArea(unit.boundary);
      unitArea += area;
      unitResults.push({ number: unit.number, type: unit.type, area });
      allUnits.push({ area, level: lvl.level, number: unit.number, type: unit.type });
    }

    const commonArea = lvl.commonProperty.reduce((s, p) => s + polygonArea(p), 0);
    levelAreas.push({ total: totalArea, units: unitArea, common: commonArea });

    void unitResults; // (used in the second pass below)
  }

  // Total unit area across the whole building (used for participation quota).
  const totalUnitArea = allUnits.reduce((s, u) => s + u.area, 0);
  const totalBuildingArea = levelAreas.reduce((s, l) => s + l.total, 0);
  const totalCommonArea = levelAreas.reduce((s, l) => s + l.common, 0);

  // Second pass: build the output with participation quotas.
  const levelsOutput = input.building.levels.map((lvl, idx) => {
    const la = levelAreas[idx]!;
    const units = lvl.units.map((unit) => {
      const area = unit.area ?? polygonArea(unit.boundary);
      const pq = totalUnitArea > 0 ? (area / totalUnitArea) * 100 : 0;
      return {
        number: unit.number,
        type: unit.type,
        area,
        participationQuota: pq,
      };
    });
    return {
      level: lvl.level,
      name: lvl.name,
      totalArea: la.total,
      unitArea: la.units,
      commonArea: la.common,
      units,
    };
  });

  // Area balance check: total building area should equal sum of unit
  // areas + common property areas (within 1% tolerance for rounding).
  const expectedTotal = totalUnitArea + totalCommonArea;
  const areaBalanceOk = Math.abs(expectedTotal - totalBuildingArea) / totalBuildingArea < 0.01;

  // Check if the source regulation is filed.
  // (Per invariant B1, the sectional property regime in country-config
  // cites the legislation, but the actual PDF must be filed in
  // docs/regulatory-sources/<country>/sectional/. We can't check that
  // at runtime without a filesystem read — so we always mark
  // sourceFiled = false for now, which forces DRAFT output.)
  const sourceFiled = false;

  // Get the sectional regime from the country config.
  const regime = input.country.sectionalPropertyRegime ?? {
    legislation: "n/a (no sectional regime configured for this country)",
    planType: "n/a",
    requiresParticipationQuotas: false,
  };

  return {
    levels: levelsOutput,
    totalBuildingArea,
    totalUnitArea,
    totalCommonArea,
    areaBalanceOk,
    pointUncertainty: {},
    regime,
    sourceFiled,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

/** Shoelace formula for the area of a 2D polygon. */
function polygonArea(p: Polygon): number {
  if (p.vertices.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < p.vertices.length; i++) {
    const j = (i + 1) % p.vertices.length;
    sum += p.vertices[i]!.easting * p.vertices[j]!.northing - p.vertices[j]!.easting * p.vertices[i]!.northing;
  }
  return Math.abs(sum) / 2;
}
