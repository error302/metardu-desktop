/**
 * Golden fixture harness — United States (Lambert Conformal Conic).
 *
 * The Kenya harness (kenya-golden-fixtures.test.ts) verifies helmert
 * numbers because that math runs in the TypeScript engine. LCC projection
 * math lives in the Rust sidecar (invariant A1 — the engine never
 * reimplements geodetic math), so the numeric verification for the US
 * fixtures happens in:
 *
 *   1. packages/metardu-sidecar/src/geodesy/projection.rs
 *      (test_lcc_epsg_gn72_worked_example + per-zone tests), and
 *   2. scripts/verify_lcc.py — an independent Python implementation
 *      validated against the EPSG GN7-2 §1.3.2.1 worked example.
 *
 * This file asserts the fixtures themselves are well-formed and that the
 * zone parameters the sidecar consumes (standard parallels, false
 * origin, central meridian) match the country-config registry — so a
 * drift in either direction fails CI.
 *
 * Master plan reference: Section 0 rule 4 + Section 5.3.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { UNITED_STATES } from "@metardu/country-config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "golden-fixtures", "us");

function listFixtures(): string[] {
  return readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));
}

interface LccFixture {
  name: string;
  country: string;
  computation: string;
  /** Synthetic edge-case fixtures (not real country-config zones) skip the registry cross-check. */
  synthetic?: boolean;
  source: { document: string; file: string };
  projection: {
    method: string;
    standard_parallel_1_deg: number;
    standard_parallel_2_deg: number;
    latitude_of_origin_deg: number;
    central_meridian_deg: number;
    false_easting_m: number;
    false_northing_m: number;
  };
  cases: Array<{
    name: string;
    /** Per-case zone override (used by synthetic edge-case fixtures). */
    zone?: {
      standard_parallel_1_deg: number;
      standard_parallel_2_deg: number;
      latitude_of_origin_deg: number;
      central_meridian_deg: number;
      false_easting_m: number;
      false_northing_m: number;
    };
    input_geographic: { lat: number; lon: number };
    expected_projected: { easting: number; northing: number };
    precision_m: number;
  }>;
}

describe("US golden fixture files are well-formed", () => {
  const fixtures = listFixtures();
  expect(fixtures.length).toBeGreaterThanOrEqual(4); // TX, CA, NY, edge cases

  for (const file of fixtures) {
    it(`${file} has required fields`, () => {
      const raw = readFileSync(join(FIXTURES_DIR, file), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.name).toBeTruthy();
      // Real US SPCS zones are country "US". Synthetic edge-case probes
      // (southern-hemisphere / equatorial zones) honestly declare
      // country "SYNTHETIC" — the registry cross-check skips them.
      if (!parsed.synthetic) {
        expect(parsed.country).toBe("US");
      } else {
        expect(parsed.country).toBe("SYNTHETIC");
      }
      expect(parsed.computation).toContain("lcc");
      expect(parsed.source).toBeTruthy();
      expect(parsed.source.document).toBeTruthy();
      expect(parsed.source.file).toBeTruthy();
      expect(parsed.projection.standard_parallel_1_deg).toBeTypeOf("number");
      expect(parsed.projection.standard_parallel_2_deg).toBeTypeOf("number");
      expect(parsed.cases.length).toBeGreaterThan(0);
    });
  }
});

describe("US LCC fixture zone parameters match country-config registry", () => {
  const fixtures = listFixtures();

  for (const file of fixtures) {
    it(`${file} zone definition matches UNITED_STATES.geodeticFramework`, () => {
      const fixture = JSON.parse(
        readFileSync(join(FIXTURES_DIR, file), "utf-8"),
      ) as LccFixture;

      // Synthetic edge-case fixtures use zones that don't exist in the
      // registry (southern-hemisphere probes, equatorial straddles).
      // Their numeric verification lives in the sidecar Rust tests and
      // scripts/verify_lcc.py; here we only assert their shape.
      if (fixture.synthetic) {
        expect(fixture.cases.every((c) => c.zone !== undefined)).toBe(true);
        return;
      }

      const zone = UNITED_STATES.geodeticFramework.projectionZones.find(
        (z) => z.method === "Lambert Conformal Conic" &&
          Math.abs(z.standard_parallel_1_deg! - fixture.projection.standard_parallel_1_deg) < 1e-9 &&
          Math.abs(z.standard_parallel_2_deg! - fixture.projection.standard_parallel_2_deg) < 1e-9,
      );

      expect(zone).toBeDefined();
      expect(zone!.method).toBe("Lambert Conformal Conic");
      expect(zone!.latitude_of_origin_deg).toBeCloseTo(
        fixture.projection.latitude_of_origin_deg, 9,
      );
      expect(zone!.central_meridian_deg).toBeCloseTo(
        fixture.projection.central_meridian_deg, 9,
      );
      expect(zone!.false_easting_m).toBeCloseTo(
        fixture.projection.false_easting_m, 3,
      );
      expect(zone!.false_northing_m).toBeCloseTo(
        fixture.projection.false_northing_m, 3,
      );
    });
  }
});

describe("US LCC edge-case fixture zones are well-formed", () => {
  const fixtures = listFixtures().filter((f) => {
    const parsed = JSON.parse(readFileSync(join(FIXTURES_DIR, f), "utf-8")) as LccFixture;
    return parsed.synthetic === true;
  });

  for (const file of fixtures) {
    it(`${file} has a complete per-case zone definition`, () => {
      const fixture = JSON.parse(
        readFileSync(join(FIXTURES_DIR, file), "utf-8"),
      ) as LccFixture;

      // At least the two negative-n cases and the two degenerate
      // single-parallel branches (both hemispheres) must be present.
      expect(fixture.cases.length).toBeGreaterThanOrEqual(4);
      for (const c of fixture.cases) {
        expect(c.zone).toBeDefined();
        expect(c.zone!.standard_parallel_1_deg).toBeTypeOf("number");
        expect(c.zone!.standard_parallel_2_deg).toBeTypeOf("number");
        expect(c.zone!.latitude_of_origin_deg).toBeTypeOf("number");
        expect(c.zone!.central_meridian_deg).toBeTypeOf("number");
        expect(c.zone!.false_easting_m).toBeTypeOf("number");
        expect(c.zone!.false_northing_m).toBeTypeOf("number");
        expect(c.expected_projected.easting).toBeTypeOf("number");
        expect(c.expected_projected.northing).toBeTypeOf("number");
        expect(c.precision_m).toBeGreaterThan(0);
      }

      // At least one case must exercise n < 0 (southern 2SP or southern
      // single-parallel) and one must hit the φ₁=φ₂ degenerate branch.
      const degenerate = fixture.cases.filter(
        (c) => Math.abs(c.zone!.standard_parallel_1_deg - c.zone!.standard_parallel_2_deg) < 1e-9,
      );
      expect(degenerate.length).toBeGreaterThanOrEqual(2);
      const negativeN = fixture.cases.filter(
        (c) => c.zone!.standard_parallel_1_deg < 0 && c.zone!.standard_parallel_2_deg < 0,
      );
      expect(negativeN.length).toBeGreaterThanOrEqual(2);
    });
  }
});
