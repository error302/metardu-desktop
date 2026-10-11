/**
 * Golden fixture harness — Kenya.
 *
 * Runs the cross-package Kenya datum-operation checks and validates the
 * separate computation-fixture and document-QA evidence schemas.
 *
 * Adding a new fixture: drop a JSON file into
 * tests/golden-fixtures/kenya/ and add a test case below. CI picks
 * it up automatically (vitest globs the directory).
 *
 * Master plan reference: Section 0 rule 4 + Section 5.3.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  wgs84ToArc1960,
  arc1960ToWgs84,
} from "@metardu/engine-flight-planning";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "golden-fixtures", "kenya");

function loadFixture<T>(name: string): T {
  const raw = readFileSync(join(FIXTURES_DIR, name), "utf-8");
  return JSON.parse(raw) as T;
}

function listFixtures(): string[] {
  return readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));
}

// ─── EPSG:1122 operation status (Kenya Arc 1960) ─────────────────

interface DatumOperationFixture {
  name: string;
  transform: {
    epsg_code: number;
    source_crs: string;
    target_crs: string;
    tx_m: number; ty_m: number; tz_m: number;
    accuracy_m: number;
    survey_grade_enabled: boolean;
  };
}

describe("golden fixture: EPSG:1122 Arc 1960 ↔ WGS 84 is blocked", () => {
  const fixture = loadFixture<DatumOperationFixture>("datum-operation__epsg1122-arc1960-wgs84-block.json");

  it("records the published operation and blocks both conversion directions", () => {
    expect(fixture.transform).toMatchObject({
      epsg_code: 1122,
      source_crs: "EPSG:4210",
      target_crs: "EPSG:4326",
      tx_m: -160,
      ty_m: -6,
      tz_m: -302,
      accuracy_m: 35,
      survey_grade_enabled: false,
    });
    expect(() => wgs84ToArc1960(-1.286389, 36.817222, 1713.5)).toThrow(/35 m.*disabled for survey-grade output/);
    expect(() => arc1960ToWgs84(-1.286389, 36.817222, 1713.5)).toThrow(/35 m.*disabled for survey-grade output/);
  });
});

// ─── Sanity: every fixture file should be valid JSON with required fields ──

describe("golden fixture files are well-formed", () => {
  for (const file of listFixtures()) {
    it(`${file} has required fields`, () => {
      const raw = readFileSync(join(FIXTURES_DIR, file), "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed.computation) {
        expect(parsed.name).toBeTruthy();
        expect(parsed.country).toBe("KE");
        expect(parsed.source).toBeTruthy();
        expect(parsed.source.document).toBeTruthy();
        // Source file may be a URL or a path under docs/regulatory-sources/.
        // Both are acceptable.
        expect(parsed.source.file).toBeTruthy();
      } else {
        // Document QA snapshots use their own evidence schema.
        expect(parsed.document).toBeTruthy();
        expect(parsed.title).toBeTruthy();
        expect(parsed.sourceSpec).toBeTruthy();
        expect(parsed.generatedBy).toBeTruthy();
        expect(parsed.verification).toBeTruthy();
      }
    });
  }
});
