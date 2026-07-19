/**
 * Tests for the Kenya country config — the reference implementation.
 *
 * Every test asserts a value matches the cited source document. If
 * anyone changes a value without updating the test, CI fails — and
 * if they update the test, the cited source document forces a code
 * review against the actual regulation.
 *
 * Source documents (per master plan Section 8.1):
 *   - Survey Act Cap. 299
 *   - Kenya Survey Regulations 1994
 *   - RDM 1.1 (2025)
 *   - Sectional Properties Act 2020
 *   - EPSG::21037, EPSG::1122
 */

import { describe, it, expect } from "vitest";
import {
  KENYA,
  getTolerance,
  levellingToleranceMm,
  angularMisclosureToleranceArcsec,
  linearMisclosureRatio,
  getStatutoryDoc,
  getProjectionZone,
  getCountryConfig,
  implementedCountries,
  COUNTRY_REGISTRY,
} from "../index.js";

// ─── Country code + identity ─────────────────────────────────────

describe("Kenya config: identity", () => {
  it("has ISO code KE", () => {
    expect(KENYA.countryCode).toBe("KE");
  });

  it("has a human-readable name", () => {
    expect(KENYA.countryName).toBe("Kenya");
  });

  it("has a config version", () => {
    expect(KENYA.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("has a last-reviewed date in ISO 8601", () => {
    expect(KENYA.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─── Geodetic framework ──────────────────────────────────────────

describe("Kenya config: geodetic framework", () => {
  it("uses Arc 1960 as the primary datum", () => {
    expect(KENYA.geodeticFramework.datum).toBe("Arc 1960");
  });

  it("has primary SRID 21037 (Arc 1960 / UTM zone 37S) — EPSG::21037", () => {
    expect(KENYA.geodeticFramework.primarySRID).toBe(21037);
  });

  it("declares a height system", () => {
    expect(KENYA.geodeticFramework.heightSystem).toContain("KEN_GEOID");
  });

  it("has at least 3 projection zones (UTM 37S, UTM 36S, Cassini-Nairobi)", () => {
    expect(KENYA.geodeticFramework.projectionZones.length).toBeGreaterThanOrEqual(3);
  });

  it("UTM 37S zone has the correct TM parameters", () => {
    const zone = getProjectionZone(KENYA, 21037);
    expect(zone.name).toContain("UTM zone 37S");
    expect(zone.method).toBe("Transverse Mercator");
    expect(zone.central_meridian_deg).toBe(39.0);
    expect(zone.latitude_of_origin_deg).toBe(0.0);
    expect(zone.false_easting_m).toBe(500_000.0);
    expect(zone.false_northing_m).toBe(10_000_000.0); // southern hemisphere
    expect(zone.scale_factor).toBe(0.9996);
    expect(zone.ellipsoid).toBe("Clarke 1866");
  });

  it("throws on unknown SRID", () => {
    expect(() => getProjectionZone(KENYA, 99999)).toThrow(/not found/i);
  });

  it("documents the legacy Cassini→UTM re-establishment path", () => {
    expect(KENYA.geodeticFramework.legacyDatums).toBeDefined();
    expect(KENYA.geodeticFramework.legacyDatums!.length).toBeGreaterThanOrEqual(1);
    const cassini = KENYA.geodeticFramework.legacyDatums!.find(
      (d) => d.from.includes("Cassini"),
    );
    expect(cassini).toBeDefined();
    expect(cassini!.to).toContain("Arc 1960");
  });
});

// ─── Tolerance table ─────────────────────────────────────────────

describe("Kenya config: levelling tolerance (Survey Regs 1994 Table 5.1)", () => {
  it("formula is 10 × √K mm with K in km", () => {
    const rule = getTolerance(KENYA, "Levelling", "levelling_misclosure");
    expect(rule.formula).toContain("10");
    expect(rule.formula).toContain("√K");
    expect(rule.unit).toBe("mm");
    expect(rule.source).toContain("Survey Regulations 1994");
  });

  it("K=1km → 10mm", () => {
    expect(levellingToleranceMm(KENYA, 1.0)).toBeCloseTo(10.0, 6);
  });

  it("K=4km → 20mm", () => {
    expect(levellingToleranceMm(KENYA, 4.0)).toBeCloseTo(20.0, 6);
  });

  it("K=9km → 30mm", () => {
    expect(levellingToleranceMm(KENYA, 9.0)).toBeCloseTo(30.0, 6);
  });

  it("K=25km → 50mm", () => {
    expect(levellingToleranceMm(KENYA, 25.0)).toBeCloseTo(50.0, 6);
  });

  it("K=100km → 100mm (sanity ceiling)", () => {
    expect(levellingToleranceMm(KENYA, 100.0)).toBeCloseTo(100.0, 6);
  });

  it("K=0km → 0mm (degenerate, but defined)", () => {
    expect(levellingToleranceMm(KENYA, 0.0)).toBe(0.0);
  });
});

describe("Kenya config: angular misclosure (Survey Regs 1994 §4.3)", () => {
  it("formula is 3.0″ × √N", () => {
    const rule = getTolerance(KENYA, "Cadastral", "angular_misclosure");
    expect(rule.formula).toContain("3.0");
    expect(rule.formula).toContain("√N");
    expect(rule.unit).toBe("arcsec");
  });

  it("N=4 stations → 6″", () => {
    expect(angularMisclosureToleranceArcsec(KENYA, 4)).toBeCloseTo(6.0, 6);
  });

  it("N=9 stations → 9″", () => {
    expect(angularMisclosureToleranceArcsec(KENYA, 9)).toBeCloseTo(9.0, 6);
  });

  it("N=16 stations → 12″", () => {
    expect(angularMisclosureToleranceArcsec(KENYA, 16)).toBeCloseTo(12.0, 6);
  });

  it("N=25 stations → 15″", () => {
    expect(angularMisclosureToleranceArcsec(KENYA, 25)).toBeCloseTo(15.0, 6);
  });
});

describe("Kenya config: linear misclosure (Survey Regs 1994 §4.4)", () => {
  it("cadastral: 1:5000 ratio", () => {
    // 5000 m traverse with 1 m misclosure → ratio 5000 (passes 1:5000 exactly)
    expect(linearMisclosureRatio(KENYA, 5000, 1.0, "Cadastral")).toBe(5000);
  });

  it("control: 1:10000 ratio", () => {
    expect(linearMisclosureRatio(KENYA, 10000, 1.0, "Geodetic")).toBe(10000);
  });

  it("zero misclosure returns Infinity (perfect closure)", () => {
    expect(linearMisclosureRatio(KENYA, 1000, 0.0)).toBe(Number.POSITIVE_INFINITY);
  });

  it("cadastral 1:4999 fails the 1:5000 tolerance", () => {
    const ratio = linearMisclosureRatio(KENYA, 4999, 1.0, "Cadastral");
    expect(ratio).toBeLessThan(5000);
  });
});

describe("Kenya config: horizontal position tolerances (RDM 1.1 §7)", () => {
  it("cadastral urban: 10 mm", () => {
    // The tolerance table has multiple "horizontal_position" rules
    // (urban, rural). Find the urban one specifically.
    const urban = KENYA.toleranceTable.find(
      (r) => r.surveyType === "Cadastral" &&
             r.toleranceType === "horizontal_position" &&
             r.formula.includes("urban"),
    );
    expect(urban).toBeDefined();
    expect(urban!.compute({})).toBeCloseTo(0.010, 9);
  });

  it("cadastral rural: 50 mm", () => {
    const rural = KENYA.toleranceTable.find(
      (r) => r.surveyType === "Cadastral" &&
             r.toleranceType === "horizontal_position" &&
             r.formula.includes("rural"),
    );
    expect(rural).toBeDefined();
    expect(rural!.compute({})).toBeCloseTo(0.050, 9);
  });

  it("engineering precise: 5 mm", () => {
    const precise = KENYA.toleranceTable.find(
      (r) => r.surveyType === "Engineering" &&
             r.toleranceType === "horizontal_position" &&
             r.formula.includes("precise"),
    );
    expect(precise).toBeDefined();
    expect(precise!.compute({})).toBeCloseTo(0.005, 9);
  });

  it("engineering standard: 20 mm", () => {
    const standard = KENYA.toleranceTable.find(
      (r) => r.surveyType === "Engineering" &&
             r.toleranceType === "horizontal_position" &&
             r.formula.includes("standard"),
    );
    expect(standard).toBeDefined();
    expect(standard!.compute({})).toBeCloseTo(0.020, 9);
  });
});

// ─── Statutory documents ─────────────────────────────────────────

describe("Kenya config: statutory documents", () => {
  it("includes Form 3 (Deed Plan)", () => {
    const form3 = getStatutoryDoc(KENYA, "Form 3");
    expect(form3.name).toContain("Deed Plan");
    expect(form3.citation).toContain("Cap. 299");
    expect(form3.sourcePath).toContain("kenya");
    expect(form3.requiresProfessionalSeal).toBe(true);
  });

  it("includes Form 4 (Mutation Plan)", () => {
    const form4 = getStatutoryDoc(KENYA, "Form 4");
    expect(form4.name).toContain("Mutation");
    expect(form4.citation).toContain("Cap. 299");
  });

  it("includes Beacon Certificate", () => {
    const cert = getStatutoryDoc(KENYA, "Beacon Certificate");
    expect(cert.name).toBe("Beacon Certificate");
    expect(cert.citation).toContain("Survey Regulations 1994");
  });

  it("Form 3 has the required title block fields", () => {
    const form3 = getStatutoryDoc(KENYA, "Form 3");
    expect(form3.titleBlockFields).toContain("DEED PLAN NO.");
    expect(form3.titleBlockFields).toContain("SURVEY NO.");
    expect(form3.titleBlockFields).toContain("AREA (ha)");
    expect(form3.titleBlockFields).toContain("SURVEYOR'S REG. NO. (ISK)");
    expect(form3.titleBlockFields).toContain("SEAL");
  });

  it("Form 3 has A4 page size and standard margins", () => {
    const form3 = getStatutoryDoc(KENYA, "Form 3");
    expect(form3.pageSize).toBe("A4");
    expect(form3.margins_mm).toHaveLength(4);
    // 25mm top, 20mm right, 25mm bottom, 20mm left
    expect(form3.margins_mm[0]).toBe(25);
    expect(form3.margins_mm[1]).toBe(20);
  });

  it("Form 3 defines DXF layer conventions", () => {
    const form3 = getStatutoryDoc(KENYA, "Form 3");
    expect(form3.dxfLayers).toContain("BOUNDARY");
    expect(form3.dxfLayers).toContain("BEACON");
    expect(form3.dxfLayers).toContain("TITLE-BLOCK");
    expect(form3.dxfLayers).toContain("NORTH-ARROW");
  });

  it("throws on unknown doc type", () => {
    expect(() => getStatutoryDoc(KENYA, "Nonexistent Form 99")).toThrow(/not found|No statutory/i);
  });
});

// ─── Professional body ───────────────────────────────────────────

describe("Kenya config: professional body", () => {
  it("is the Institution of Surveyors of Kenya", () => {
    expect(KENYA.professionalBody.name).toContain("ISK");
    expect(KENYA.professionalBody.name).toContain("Institution of Surveyors of Kenya");
  });

  it("uses ISK Reg. No. as the registration field", () => {
    expect(KENYA.professionalBody.registrationNumberField).toBe("ISK Reg. No.");
  });

  it("has a registration number pattern", () => {
    expect(KENYA.professionalBody.registrationPattern).toBeDefined();
    // Should match LS/123 or LS/1234
    expect("LS/1234").toMatch(new RegExp(KENYA.professionalBody.registrationPattern!));
    expect("ABC/123").not.toMatch(new RegExp(KENYA.professionalBody.registrationPattern!));
  });
});

// ─── Sectional property regime ───────────────────────────────────

describe("Kenya config: sectional property regime", () => {
  it("is governed by the Sectional Properties Act 2020", () => {
    expect(KENYA.sectionalPropertyRegime).toBeDefined();
    expect(KENYA.sectionalPropertyRegime!.legislation).toContain("Sectional Properties Act 2020");
  });

  it("requires participation quotas on sectional plans", () => {
    expect(KENYA.sectionalPropertyRegime!.requiresParticipationQuotas).toBe(true);
  });

  it("uses 'Sectional Plan' as the document type", () => {
    expect(KENYA.sectionalPropertyRegime!.planType).toBe("Sectional Plan");
  });
});

// ─── Source documents checklist ──────────────────────────────────

describe("Kenya config: source docs checklist (invariant B1 gate)", () => {
  it("lists Survey Act Cap. 299 as required", () => {
    expect(KENYA.sourceDocsRequired).toContain("Survey Act Cap. 299 (Laws of Kenya)");
  });

  it("lists Kenya Survey Regulations 1994 as required", () => {
    expect(KENYA.sourceDocsRequired).toContain("Kenya Survey Regulations 1994");
  });

  it("lists RDM 1.1 (2025) as required", () => {
    expect(KENYA.sourceDocsRequired).toContain("RDM 1.1 (2025) — Kenya Roads Design Manual");
  });

  it("lists Sectional Properties Act 2020 as required", () => {
    expect(KENYA.sourceDocsRequired).toContain("Sectional Properties Act 2020");
  });

  it("lists LSB Topographical Survey Guidelines as required", () => {
    expect(KENYA.sourceDocsRequired).toContain("LSB Topographical Survey Guidelines");
  });
});

// ─── Registry ────────────────────────────────────────────────────

describe("country registry", () => {
  it("Kenya is in the registry", () => {
    expect(COUNTRY_REGISTRY.KE).toBe(KENYA);
  });

  it("Australia, UK, SA, UAE are placeholders (undefined) until Phase 8+", () => {
    expect(COUNTRY_REGISTRY.AU).toBeUndefined();
    expect(COUNTRY_REGISTRY.GB).toBeUndefined();
    expect(COUNTRY_REGISTRY.ZA).toBeUndefined();
    expect(COUNTRY_REGISTRY.AE).toBeUndefined();
  });

  it("implementedCountries() returns only KE", () => {
    const implemented = implementedCountries();
    expect(implemented).toEqual(["KE"]);
  });

  it("getCountryConfig('KE') returns the Kenya config", () => {
    expect(getCountryConfig("KE")).toBe(KENYA);
  });

  it("getCountryConfig('AU') throws a clear error citing invariant B1", () => {
    expect(() => getCountryConfig("AU")).toThrow(/not yet implemented|invariant B1/i);
  });
});

// ─── Tolerance rule traceability ─────────────────────────────────

describe("Kenya config: every tolerance rule cites a source (invariant C1)", () => {
  it("all rules have a non-empty source citation", () => {
    for (const rule of KENYA.toleranceTable) {
      expect(rule.source.length).toBeGreaterThan(10);
      // Every source must mention either "Survey Regulations" or "RDM"
      expect(rule.source).toMatch(/Survey Regulations|RDM/i);
    }
  });

  it("all rules have a non-trivial formula description", () => {
    for (const rule of KENYA.toleranceTable) {
      expect(rule.formula.length).toBeGreaterThan(3);
    }
  });
});
