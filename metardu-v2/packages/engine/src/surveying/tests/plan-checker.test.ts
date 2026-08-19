/**
 * Tests for the automated Plan Compliance Checker.
 *
 * Kenya limits (from country-config, verified against Kenya Survey
 * Regulations 1994):
 *   - levelling_misclosure:   10√K mm            (K in km)
 *   - angular_misclosure:     3.0√N arcsec        (N stations)
 *   - linear_misclosure:      1:5000 (cadastral)  (ratio, higher = better)
 *   - horizontal_position:    0.010 m (urban) / 0.050 m (rural)
 */

import { describe, it, expect } from "vitest";
import {
  runPlanComplianceCheck,
  observationsFromCadastral,
  type PlanCheckObservations,
} from "../plan-checker.js";
import { KENYA, GERMANY, GHANA, UNITED_KINGDOM, UNITED_STATES, SOUTH_AFRICA, AUSTRALIA, UNITED_ARAB_EMIRATES } from "@metardu/country-config";

const KE = "KE" as const;

describe("runPlanComplianceCheck — Kenya cadastral horizontal_position", () => {
  it("passes when max semi-major axis is within the urban 10 mm limit", () => {
    const r = runPlanComplianceCheck(KE, "Cadastral", { maxSemiMajorM: 0.008 });
    const horiz = r.checks.filter((c) => c.toleranceType === "horizontal_position");
    expect(horiz.length).toBeGreaterThan(0);
    const urban = horiz.find((c) => c.allowable === 0.01);
    expect(urban?.withinTolerance).toBe(true);
    expect(r.pass).toBe(true);
  });

  it("fails when max semi-major axis exceeds the urban 10 mm limit", () => {
    const r = runPlanComplianceCheck(KE, "Cadastral", { maxSemiMajorM: 0.012 });
    const urban = r.checks.find((c) => c.toleranceType === "horizontal_position" && c.allowable === 0.01);
    expect(urban?.withinTolerance).toBe(false);
    expect(r.pass).toBe(false);
  });
});

describe("runPlanComplianceCheck — Kenya levelling", () => {
  it("passes an 8 mm misclosure on a 1 km loop (limit 10√1 = 10 mm)", () => {
    const obs: PlanCheckObservations = { levellingMisclosureMm: 8, loopLengthKm: 1 };
    const r = runPlanComplianceCheck(KE, "Levelling", obs);
    const c = r.checks.find((x) => x.toleranceType === "levelling_misclosure");
    expect(c?.allowable).toBe(10);
    expect(c?.withinTolerance).toBe(true);
  });

  it("fails a 12 mm misclosure on a 1 km loop", () => {
    const r = runPlanComplianceCheck(KE, "Levelling", { levellingMisclosureMm: 12, loopLengthKm: 1 });
    const c = r.checks.find((x) => x.toleranceType === "levelling_misclosure");
    expect(c?.withinTolerance).toBe(false);
  });

  it("scales the limit with √K (2 km loop limit = 10√2 ≈ 14.14 mm)", () => {
    const r = runPlanComplianceCheck(KE, "Levelling", { levellingMisclosureMm: 14, loopLengthKm: 2 });
    const c = r.checks.find((x) => x.toleranceType === "levelling_misclosure");
    expect(c?.allowable).toBeCloseTo(10 * Math.sqrt(2), 5);
    expect(c?.withinTolerance).toBe(true);
  });
});

describe("runPlanComplianceCheck — Kenya angular misclosure", () => {
  it("passes 5″ on 4 stations (limit 3√4 = 6″)", () => {
    const r = runPlanComplianceCheck(KE, "Cadastral", { angularMisclosureArcsec: 5, stationCount: 4 });
    const c = r.checks.find((x) => x.toleranceType === "angular_misclosure");
    expect(c?.allowable).toBeCloseTo(6, 5);
    expect(c?.withinTolerance).toBe(true);
  });

  it("fails 7″ on 4 stations", () => {
    const r = runPlanComplianceCheck(KE, "Cadastral", { angularMisclosureArcsec: 7, stationCount: 4 });
    const c = r.checks.find((x) => x.toleranceType === "angular_misclosure");
    expect(c?.withinTolerance).toBe(false);
  });
});

describe("runPlanComplianceCheck — Kenya linear misclosure", () => {
  it("passes a 5000 m traverse with 0.5 m misclosure (1:10000 ≥ 1:5000)", () => {
    const r = runPlanComplianceCheck(KE, "Cadastral", { traverseLengthM: 5000, linearMisclosureM: 0.5 });
    const c = r.checks.find((x) => x.toleranceType === "linear_misclosure");
    expect(c?.observed).toBeCloseTo(10000, 0);
    expect(c?.withinTolerance).toBe(true);
  });

  it("fails a 5000 m traverse with 1.1 m misclosure (1:4545 < 1:5000)", () => {
    const r = runPlanComplianceCheck(KE, "Cadastral", { traverseLengthM: 5000, linearMisclosureM: 1.1 });
    const c = r.checks.find((x) => x.toleranceType === "linear_misclosure");
    expect(c?.observed).toBeCloseTo(4545, 0);
    expect(c?.withinTolerance).toBe(false);
  });
});

describe("runPlanComplianceCheck — cross-country generality", () => {
  const countries = [
    ["KE", KENYA],
    ["DE", GERMANY],
    ["GH", GHANA],
    ["GB", UNITED_KINGDOM],
    ["US", UNITED_STATES],
    ["ZA", SOUTH_AFRICA],
    ["AU", AUSTRALIA],
    ["AE", UNITED_ARAB_EMIRATES],
  ] as const;

  it("runs without throwing for every implemented country and vacuously passes with no observations", () => {
    for (const [code] of countries) {
      const r = runPlanComplianceCheck(code, "Cadastral", {});
      expect(Array.isArray(r.checks)).toBe(true);
      // No observations supplied → nothing can fail.
      expect(r.pass).toBe(true);
    }
    // The reference country must carry a substantive cadastral tolerance set.
    expect(runPlanComplianceCheck("KE", "Cadastral", {}).checks.length).toBeGreaterThan(0);
  });

  it("flags a grossly out-of-tolerance horizontal position for every country that defines one", () => {
    let countriesWithHorizontal = 0;
    for (const [code] of countries) {
      const r = runPlanComplianceCheck(code, "Cadastral", { maxSemiMajorM: 100 });
      const horiz = r.checks.filter((c) => c.toleranceType === "horizontal_position");
      if (horiz.length === 0) continue; // e.g. GB general-boundaries regime
      countriesWithHorizontal++;
      const failed = horiz.some((c) => c.withinTolerance === false);
      expect(failed, `country ${code} should fail a 100 m semi-major axis`).toBe(true);
      expect(r.pass).toBe(false);
    }
    // Most countries define cadastral horizontal rules (some regimes, e.g.
    // GB general-boundaries, legitimately do not — a gap to flag for coverage).
    expect(countriesWithHorizontal).toBeGreaterThanOrEqual(6);
  });
});

describe("observationsFromCadastral", () => {
  it("extracts the largest adjusted semi-major axis", () => {
    const obs = observationsFromCadastral({
      uncertainty: {
        B1: { adjusted: false, semiMajorAxis: 0.5 },
        B2: { adjusted: true, semiMajorAxis: 0.009 },
        B3: { adjusted: true, semiMajorAxis: 0.014 },
      },
    });
    expect(obs.maxSemiMajorM).toBeCloseTo(0.014, 6);
  });

  it("returns undefined when no adjusted beacons exist", () => {
    const obs = observationsFromCadastral({ uncertainty: { B1: { adjusted: false } } });
    expect(obs.maxSemiMajorM).toBeUndefined();
  });
});
