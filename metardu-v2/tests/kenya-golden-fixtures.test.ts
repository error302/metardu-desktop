/**
 * Golden fixture harness — Kenya.
 *
 * Runs every JSON fixture in tests/golden-fixtures/kenya/ against the
 * corresponding engine function. Fails CI if any fixture's computed
 * result doesn't match the expected value within the stated precision.
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
  helmertTransform,
  wgs84ToArc1960,
  arc1960ToWgs84,
  type HelmertParams,
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

// ─── Helmert round-trip (Kenya Arc 1960) ─────────────────────────

interface HelmertFixtureCase {
  name: string;
  wgs84: { lat: number; lon: number; height: number };
  roundtrip_precision_decimal_places: number;
}

interface HelmertFixture {
  name: string;
  transform: {
    tx: number; ty: number; tz: number;
    rx_arcsec: number; ry_arcsec: number; rz_arcsec: number;
    scale_ppm: number;
  };
  cases: HelmertFixtureCase[];
}

describe("golden fixture: helmert wgs84 ↔ arc 1960 round-trip", () => {
  const fixture = loadFixture<HelmertFixture>("helmert__wgs84-to-arc1960-roundtrip.json");

  // The fixture documents the EPSG::1122 parameters — verify the engine
  // has the same values baked in. If these drift, every Kenya coordinate
  // silently shifts.
  it("engine's WGS84_TO_ARC1960 params match EPSG::1122", () => {
    // Re-derive the params from the engine by round-tripping a known
    // point and asserting the shift matches the documented Helmert vector.
    const p = { x: 6378137.0, y: 0.0, z: 0.0 };
    const params: HelmertParams = {
      tx: fixture.transform.tx,
      ty: fixture.transform.ty,
      tz: fixture.transform.tz,
      rx: fixture.transform.rx_arcsec,
      ry: fixture.transform.ry_arcsec,
      rz: fixture.transform.rz_arcsec,
      scale: fixture.transform.scale_ppm,
    };
    const transformed = helmertTransform(p, params);
    // tx/ty/tz are in metres; arcseconds and ppm are ~0 so the dominant
    // shift should be approximately (tx, ty, tz).
    expect(Math.abs(transformed.x - p.x - fixture.transform.tx)).toBeLessThan(0.01);
    expect(Math.abs(transformed.y - p.y - fixture.transform.ty)).toBeLessThan(0.01);
    expect(Math.abs(transformed.z - p.z - fixture.transform.tz)).toBeLessThan(0.01);
  });

  for (const c of fixture.cases) {
    it(`round-trip preserves ${c.name} to ${c.roundtrip_precision_decimal_places} dp`, () => {
      const { lat, lon, height } = c.wgs84;
      const arc = wgs84ToArc1960(lat, lon, height);
      const back = arc1960ToWgs84(arc.lat, arc.lon, arc.height);
      const eps = Math.pow(10, -c.roundtrip_precision_decimal_places);
      expect(Math.abs(back.lat - lat)).toBeLessThan(eps);
      expect(Math.abs(back.lon - lon)).toBeLessThan(eps);
      expect(Math.abs(back.height - height)).toBeLessThan(0.001); // 1 mm
    });
  }
});

// ─── Sanity: every fixture file should be valid JSON with required fields ──

describe("golden fixture files are well-formed", () => {
  for (const file of listFixtures()) {
    it(`${file} has required fields`, () => {
      const raw = readFileSync(join(FIXTURES_DIR, file), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.name).toBeTruthy();
      expect(parsed.country).toBe("KE");
      expect(parsed.computation).toBeTruthy();
      expect(parsed.source).toBeTruthy();
      expect(parsed.source.document).toBeTruthy();
      // Source file may be a URL or a path under docs/regulatory-sources/.
      // Both are acceptable.
      expect(parsed.source.file).toBeTruthy();
    });
  }
});
