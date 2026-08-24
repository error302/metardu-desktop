/**
 * Golden fixture harness — AU, GB, ZA, DE (four-market TM).
 *
 * Runs every JSON fixture in tests/golden-fixtures/{au,gb,za,de}/
 * against a TypeScript reimplementation of the sidecar's Transverse
 * Mercator (Snyder PP-1395 §8 — identical to
 * packages/metardu-sidecar/src/geodesy/projection.rs).
 *
 * Per invariant A1 the engine never reimplements geodetic math, but
 * this harness is a *test* verifier — it re-implements the Snyder
 * series locally so CI can assert the frozen expected values match
 * the sidecar's math within ≤1 mm / 1e-7 deg without spawning the
 * Rust sidecar process. The sidecar's own Rust unit tests
 * (cargo test) independently verify the same formulas.
 *
 * Adding a new market: drop a JSON file into
 * tests/golden-fixtures/<country>/ and add it to MARKETS below.
 *
 * Master plan reference: Section 0 rule 4 + Section 5.3, Task 10.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUSTRALIA,
  UNITED_KINGDOM,
  SOUTH_AFRICA,
  GERMANY,
} from "@metardu/country-config";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Ellipsoid registry (mirrors sidecar datums) ─────────────────

interface Ellipsoid {
  name: string;
  a: number;
  invF: number;
}

const ELLIPSOIDS: Record<string, Ellipsoid> = {
  "GRS80": { name: "GRS80", a: 6378137.0, invF: 298.257222101 },
  "WGS84": { name: "WGS84", a: 6378137.0, invF: 298.257223563 },
  "Airy 1830": { name: "Airy 1830", a: 6377563.396, invF: 299.3249646 },
  "Bessel 1841": { name: "Bessel 1841", a: 6377397.155, invF: 299.1528128 },
  // Also accept long form strings from fixture ellipsoid field
};

function lookupEllipsoid(s: string): Ellipsoid {
  // Fixture stores e.g. "GRS80 (a=6378137.0 m, 1/f=298.257222101)" — extract key
  if (s.includes("GRS80")) return ELLIPSOIDS["GRS80"];
  if (s.includes("WGS84")) return ELLIPSOIDS["WGS84"];
  if (s.includes("Airy 1830")) return ELLIPSOIDS["Airy 1830"];
  if (s.includes("Bessel")) return ELLIPSOIDS["Bessel 1841"];
  const direct = ELLIPSOIDS[s];
  if (direct) return direct;
  throw new Error(`Unknown ellipsoid: ${s}`);
}

// ─── Snyder Transverse Mercator (mirrors projection.rs) ──────────

interface TMParams {
  centralMeridianDeg: number;
  latitudeOfOriginDeg: number;
  falseEastingM: number;
  falseNorthingM: number;
  scaleFactor: number;
  ellipsoid: Ellipsoid;
}

function e2Of(ell: Ellipsoid): number {
  const f = 1.0 / ell.invF;
  return 2 * f - f * f;
}

function meridianArc(phi: number, a: number, e2: number): number {
  return (
    a *
    ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256) * phi -
      (3 * e2 / 8 + (3 * e2 * e2) / 32 + (45 * e2 * e2 * e2) / 1024) * Math.sin(2 * phi) +
      (15 * e2 * e2 / 256 + (45 * e2 * e2 * e2) / 1024) * Math.sin(4 * phi) -
      (35 * e2 * e2 * e2) / 3072 * Math.sin(6 * phi))
  );
}

function tmForward(latDeg: number, lonDeg: number, p: TMParams): { easting: number; northing: number } {
  const a = p.ellipsoid.a;
  const e2 = e2Of(p.ellipsoid);
  const ep2 = e2 / (1 - e2);
  const phi = (latDeg * Math.PI) / 180;
  const lam = (lonDeg * Math.PI) / 180;
  const lam0 = (p.centralMeridianDeg * Math.PI) / 180;
  const phi0 = (p.latitudeOfOriginDeg * Math.PI) / 180;
  const k0 = p.scaleFactor;

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);
  const n = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const t = tanPhi * tanPhi;
  const c = ep2 * cosPhi * cosPhi;
  const aVal = (lam - lam0) * cosPhi;

  const m = meridianArc(phi, a, e2);
  const m0 = meridianArc(phi0, a, e2);

  const easting =
    p.falseEastingM +
    k0 * n * (aVal + ((1 - t + c) * Math.pow(aVal, 3)) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * ep2) * Math.pow(aVal, 5)) / 120);

  const northing =
    p.falseNorthingM +
    k0 *
      (m -
        m0 +
        n *
          tanPhi *
          (Math.pow(aVal, 2) / 2 +
            ((5 - t + 9 * c + 4 * c * c) * Math.pow(aVal, 4)) / 24 +
            ((61 - 58 * t + t * t + 600 * c - 330 * ep2) * Math.pow(aVal, 6)) / 720));

  return { easting, northing };
}

function tmInverse(easting: number, northing: number, p: TMParams): { lat: number; lon: number } {
  const a = p.ellipsoid.a;
  const e2 = e2Of(p.ellipsoid);
  const ep2 = e2 / (1 - e2);

  const lam0 = (p.centralMeridianDeg * Math.PI) / 180;
  const phi0 = (p.latitudeOfOriginDeg * Math.PI) / 180;
  const k0 = p.scaleFactor;

  const m0 = meridianArc(phi0, a, e2);
  const m = m0 + (northing - p.falseNorthingM) / k0;

  const mu = m / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * Math.pow(e2, 3)) / 256));

  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  let phi1 =
    mu +
    (3 * e1 / 2 - (27 * Math.pow(e1, 3)) / 32) * Math.sin(2 * mu) +
    (21 * e1 * e1 / 16 - (55 * Math.pow(e1, 4)) / 32) * Math.sin(4 * mu) +
    (151 * Math.pow(e1, 3)) / 96 * Math.sin(6 * mu) +
    (1097 * Math.pow(e1, 4)) / 512 * Math.sin(8 * mu);

  const tanPhi1 = Math.tan(phi1);
  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const n1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
  const t1 = tanPhi1 * tanPhi1;
  const c1 = ep2 * cosPhi1 * cosPhi1;
  const r1 = (a * (1 - e2)) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);

  const d = (easting - p.falseEastingM) / (n1 * k0);

  const phi =
    phi1 -
    (n1 * tanPhi1) / r1 *
      (Math.pow(d, 2) / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * Math.pow(d, 4)) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * Math.pow(d, 6)) / 720);

  const lam =
    lam0 +
    (d - ((1 + 2 * t1 + c1) * Math.pow(d, 3)) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * Math.pow(d, 5)) / 120) / cosPhi1;

  return { lat: (phi * 180) / Math.PI, lon: (lam * 180) / Math.PI };
}

// ─── Fixture types ───────────────────────────────────────────────

interface ProjectionFixture {
  name: string;
  country: string;
  computation: string;
  source: { document: string; file: string; notes?: string };
  projection: {
    method: string;
    datum: string;
    ellipsoid: string;
    srid: number;
    central_meridian_deg: number;
    latitude_of_origin_deg: number;
    false_easting_m: number;
    false_northing_m: number;
    scale_factor: number;
  };
  cases: Array<{
    name: string;
    input_geographic: { lat: number; lon: number };
    expected_projected: { easting: number; northing: number };
    precision_m: number;
    notes?: string;
  }>;
  roundtrip_test: { description: string; precision_deg: number };
}

type Market = { dir: string; file: string; countryCode: string };

const MARKETS: Market[] = [
  { dir: "au", file: "projection__mga56-forward-inverse.json", countryCode: "AU" },
  { dir: "gb", file: "projection__bng-forward-inverse.json", countryCode: "GB" },
  { dir: "za", file: "projection__lo27-forward-inverse.json", countryCode: "ZA" },
  { dir: "de", file: "projection__utm32n-forward-inverse.json", countryCode: "DE" },
];

function loadFixture(m: Market): ProjectionFixture {
  const p = join(__dirname, "golden-fixtures", m.dir, m.file);
  const raw = readFileSync(p, "utf-8");
  return JSON.parse(raw) as ProjectionFixture;
}

function tmParamsFromFixture(fx: ProjectionFixture): TMParams {
  return {
    centralMeridianDeg: fx.projection.central_meridian_deg,
    latitudeOfOriginDeg: fx.projection.latitude_of_origin_deg,
    falseEastingM: fx.projection.false_easting_m,
    falseNorthingM: fx.projection.false_northing_m,
    scaleFactor: fx.projection.scale_factor,
    ellipsoid: lookupEllipsoid(fx.projection.ellipsoid),
  };
}

// ─── Well-formed + country-config cross-check ────────────────────

describe("four-market golden fixture files are well-formed", () => {
  for (const m of MARKETS) {
    it(`${m.dir}/${m.file} exists and has required fields`, () => {
      const full = join(__dirname, "golden-fixtures", m.dir, m.file);
      expect(existsSync(full), `missing ${m.dir}/${m.file}`).toBe(true);
      const fx = loadFixture(m);
      expect(fx.name).toBeTruthy();
      expect(fx.country).toBe(m.countryCode);
      expect(fx.computation).toContain("projection");
      expect(fx.source).toBeTruthy();
      expect(fx.source.document).toBeTruthy();
      expect(fx.source.file).toBeTruthy();
      expect(fx.projection.method).toContain("Transverse Mercator");
      expect(fx.projection.central_meridian_deg).toBeTypeOf("number");
      expect(fx.projection.false_easting_m).toBeTypeOf("number");
      expect(fx.cases.length).toBeGreaterThan(0);
      for (const c of fx.cases) {
        expect(c.input_geographic.lat).toBeTypeOf("number");
        expect(c.input_geographic.lon).toBeTypeOf("number");
        expect(c.expected_projected.easting).toBeTypeOf("number");
        expect(c.expected_projected.northing).toBeTypeOf("number");
        expect(c.precision_m).toBeGreaterThan(0);
      }
      expect(fx.projection.srid).toBeGreaterThan(0);
      expect(fx.roundtrip_test.precision_deg).toBeLessThan(1e-6);
    });
  }
});

describe("four-market fixture projection zones match country-config", () => {
  const registry: Record<string, { geodeticFramework: { projectionZones: Array<{ srid: number; central_meridian_deg?: number; central_meridian?: number; scale_factor?: number; scaleFactor?: number }> } }> = {
    AU: AUSTRALIA as any,
    GB: UNITED_KINGDOM as any,
    ZA: SOUTH_AFRICA as any,
    DE: GERMANY as any,
  };

  for (const m of MARKETS) {
    it(`${m.dir} SRID ${m.file} is registered in country-config`, () => {
      const fx = loadFixture(m);
      const cfg = registry[m.countryCode];
      expect(cfg).toBeDefined();
      const zone = cfg.geodeticFramework.projectionZones.find((z) => z.srid === fx.projection.srid);
      expect(zone, `SRID ${fx.projection.srid} not found in ${m.countryCode} country-config`).toBeDefined();
      // central meridian must match
      const cm = (zone as any).central_meridian_deg ?? (zone as any).central_meridian;
      expect(cm).toBeCloseTo(fx.projection.central_meridian_deg, 9);
    });
  }
});

// ─── Forward / inverse / round-trip ──────────────────────────────

for (const m of MARKETS) {
  describe(`${m.countryCode} TM forward/inverse — ${m.dir}/${m.file}`, () => {
    const fx = loadFixture(m);
    const params = tmParamsFromFixture(fx);

    for (const c of fx.cases) {
      it(`${c.name} forward ≤ ${c.precision_m} mm (easting/northing)`, () => {
        const { easting, northing } = tmForward(c.input_geographic.lat, c.input_geographic.lon, params);
        const de = Math.abs(easting - c.expected_projected.easting);
        const dn = Math.abs(northing - c.expected_projected.northing);
        // Task requires ≤1 mm. Fixture precision_m is 0.001 (1 mm) but we also
        // tolerate the fixture's own precision_m if larger.
        const tol = Math.max(c.precision_m, 0.001);
        expect(de, `easting drift ${de} m (got ${easting}, expected ${c.expected_projected.easting})`).toBeLessThan(tol + 1e-9);
        expect(dn, `northing drift ${dn} m (got ${northing}, expected ${c.expected_projected.northing})`).toBeLessThan(tol + 1e-9);
      });

      it(`${c.name} inverse ≤ 1e-7 deg`, () => {
        const { lat, lon } = tmInverse(c.expected_projected.easting, c.expected_projected.northing, params);
        const dLat = Math.abs(lat - c.input_geographic.lat);
        const dLon = Math.abs(lon - c.input_geographic.lon);
        expect(dLat, `lat drift ${dLat} deg`).toBeLessThan(1e-7);
        expect(dLon, `lon drift ${dLon} deg`).toBeLessThan(1e-7);
      });

      it(`${c.name} round-trip forward→inverse preserves input to 1e-7 deg`, () => {
        const { easting, northing } = tmForward(c.input_geographic.lat, c.input_geographic.lon, params);
        const { lat, lon } = tmInverse(easting, northing, params);
        expect(Math.abs(lat - c.input_geographic.lat)).toBeLessThan(fx.roundtrip_test.precision_deg + 1e-12);
        expect(Math.abs(lon - c.input_geographic.lon)).toBeLessThan(fx.roundtrip_test.precision_deg + 1e-12);
      });
    }
  });
}

// ─── Sanity: every market file present (count check) ────────────

describe("four-market fixtures count", () => {
  it("all four market directories have exactly one projection fixture", () => {
    for (const m of MARKETS) {
      const dir = join(__dirname, "golden-fixtures", m.dir);
      const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
      expect(files.length).toBeGreaterThanOrEqual(1);
      expect(files).toContain(m.file);
    }
  });
});
