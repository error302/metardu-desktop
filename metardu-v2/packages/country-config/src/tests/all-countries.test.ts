/**
 * Tests for the Australia, UK, South Africa, and UAE country configs.
 *
 * Verifies the core identity, geodetic framework, tolerance rules, and
 * statutory documents of each new country. Values are sourced from
 * EPSG registry + cited professional standards (NOT statutory documents
 * in the case of UK/AU/ZA/AE — those source documents are still
 * pending filing per invariant B1).
 */

import { describe, it, expect } from "vitest";
import {
  AUSTRALIA,
  UNITED_KINGDOM,
  SOUTH_AFRICA,
  UNITED_ARAB_EMIRATES,
  getCountryConfig,
  implementedCountries,
  COUNTRY_REGISTRY,
} from "../index.js";

// ─── Australia (NSW) ─────────────────────────────────────────────

describe("Australia config", () => {
  it("has ISO code AU", () => {
    expect(AUSTRALIA.countryCode).toBe("AU");
  });

  it("uses GDA2020 as the primary datum", () => {
    expect(AUSTRALIA.geodeticFramework.datum).toBe("GDA2020");
  });

  it("has primary SRID 7856 (GDA2020 / MGA zone 56 — Sydney)", () => {
    expect(AUSTRALIA.geodeticFramework.primarySRID).toBe(7856);
  });

  it("documents the GDA94 → GDA2020 Helmert transform (EPSG::8048)", () => {
    const gda94 = AUSTRALIA.geodeticFramework.legacyDatums?.find(
      (d) => d.from === "GDA94",
    );
    expect(gda94).toBeDefined();
    expect(gda94!.source).toContain("EPSG::8048");
    // Translation parameters (from EPSG::8048)
    expect(gda94!.helmert.tx).toBeCloseTo(-0.06155, 5);
  });

  it("documents the AGD66/84 → GDA94 Helmert transform (EPSG::1280)", () => {
    const agd = AUSTRALIA.geodeticFramework.legacyDatums?.find(
      (d) => d.from === "AGD66 / AGD84",
    );
    expect(agd).toBeDefined();
    expect(agd!.source).toContain("EPSG::1280");
    expect(agd!.helmert.tx).toBeCloseTo(-117.763, 3);
  });

  it("uses SSSI as the professional body with CSPS reg pattern", () => {
    expect(AUSTRALIA.professionalBody.name).toContain("SSSI");
    // registrationPattern is a regex string like '^CSPS/\\d{4,5}$'
    const pattern = AUSTRALIA.professionalBody.registrationPattern!;
    expect(pattern).toContain("CSPS");
    expect("CSPS/12345").toMatch(new RegExp(pattern));
    expect("INVALID").not.toMatch(new RegExp(pattern));
  });

  it("includes Plan of Survey (Deposited Plan) as a statutory doc", () => {
    const plan = AUSTRALIA.statutoryDocuments.find((d) => d.docType === "Plan of Survey");
    expect(plan).toBeDefined();
    expect(plan!.pageSize).toBe("A3");
    expect(plan!.requiresProfessionalSeal).toBe(true);
  });

  it("has a Strata Schemes Development Act 2015 sectional regime", () => {
    expect(AUSTRALIA.sectionalPropertyRegime).toBeDefined();
    expect(AUSTRALIA.sectionalPropertyRegime!.legislation).toContain("Strata Schemes Development Act 2015");
  });

  it("levelling tolerance is 4mm × √K (ICSM SP1 Class LB)", () => {
    const rule = AUSTRALIA.toleranceTable.find(
      (r) => r.surveyType === "Levelling" && r.toleranceType === "levelling_misclosure",
    );
    expect(rule).toBeDefined();
    expect(rule!.compute({ K_km: 4 })).toBeCloseTo(8.0, 6);
    expect(rule!.source).toContain("ICSM SP1");
  });

  it("angular misclosure is 6″ × √N (ICSM SP1 §3.5)", () => {
    const rule = AUSTRALIA.toleranceTable.find(
      (r) => r.surveyType === "Cadastral" && r.toleranceType === "angular_misclosure",
    );
    expect(rule).toBeDefined();
    expect(rule!.compute({ N_stations: 4 })).toBeCloseTo(12.0, 6);
  });

  it("lists ICSM SP1 v2.2 in the source-docs-required checklist", () => {
    expect(AUSTRALIA.sourceDocsRequired).toContain("ICSM SP1 v2.2 (Australian Survey Control Network standard)");
  });
});

// ─── United Kingdom ──────────────────────────────────────────────

describe("United Kingdom config", () => {
  it("has ISO code GB", () => {
    expect(UNITED_KINGDOM.countryCode).toBe("GB");
  });

  it("uses OSGB36 + ETRS89 as the dual datum system", () => {
    expect(UNITED_KINGDOM.geodeticFramework.datum).toContain("OSGB36");
    expect(UNITED_KINGDOM.geodeticFramework.datum).toContain("ETRS89");
  });

  it("has primary SRID 27700 (OSGB36 / British National Grid)", () => {
    expect(UNITED_KINGDOM.geodeticFramework.primarySRID).toBe(27700);
  });

  it("BNG zone uses Airy 1830 ellipsoid + central meridian -2°", () => {
    const bng = UNITED_KINGDOM.geodeticFramework.projectionZones[0]!;
    expect(bng.ellipsoid).toBe("Airy 1830");
    expect(bng.central_meridian_deg).toBe(-2.0);
    expect(bng.scale_factor).toBeCloseTo(0.999_601_271_7, 10);
  });

  it("documents ETRS89 → OSGB36 (Helmert approximation, OSTN15 for survey-grade)", () => {
    const etrs = UNITED_KINGDOM.geodeticFramework.legacyDatums?.find(
      (d) => d.from === "ETRS89",
    );
    expect(etrs).toBeDefined();
    expect(etrs!.source).toContain("OSTN15");
    // Coarse Helmert values for the approximation
    expect(etrs!.helmert.tx).toBeCloseTo(446.448, 3);
  });

  it("uses RICS as the professional body with 7-digit reg pattern", () => {
    expect(UNITED_KINGDOM.professionalBody.name).toContain("RICS");
    expect("1234567").toMatch(new RegExp(UNITED_KINGDOM.professionalBody.registrationPattern!));
  });

  it("documents the general boundaries rule (Land Registration Act 2002 s. 60)", () => {
    const rule = UNITED_KINGDOM.toleranceTable.find(
      (r) => r.toleranceType === "boundary_determination",
    );
    expect(rule).toBeDefined();
    expect(Number.isNaN(rule!.compute({}))).toBe(true); // no numeric tolerance
    expect(rule!.source).toContain("general boundaries rule");
  });

  it("includes Title Plan as a statutory doc (does NOT require professional seal)", () => {
    const titlePlan = UNITED_KINGDOM.statutoryDocuments.find((d) => d.docType === "Title Plan");
    expect(titlePlan).toBeDefined();
    expect(titlePlan!.requiresProfessionalSeal).toBe(false); // HMLR-issued, not surveyor-sealed
    expect(titlePlan!.scaleConvention).toContain("1:1250");
  });

  it("has a Commonhold and Leasehold Reform Act 2002 sectional regime", () => {
    expect(UNITED_KINGDOM.sectionalPropertyRegime).toBeDefined();
    expect(UNITED_KINGDOM.sectionalPropertyRegime!.legislation).toContain("Commonhold and Leasehold Reform Act 2002");
  });

  it("levelling tolerance is 4mm × √K (BS 7334 Class II)", () => {
    const rule = UNITED_KINGDOM.toleranceTable.find(
      (r) => r.surveyType === "Levelling",
    );
    expect(rule).toBeDefined();
    expect(rule!.compute({ K_km: 4 })).toBeCloseTo(8.0, 6);
    expect(rule!.source).toContain("BS 7334");
  });
});

// ─── South Africa ────────────────────────────────────────────────

describe("South Africa config", () => {
  it("has ISO code ZA", () => {
    expect(SOUTH_AFRICA.countryCode).toBe("ZA");
  });

  it("uses Hartebeesthoek94 as the primary datum", () => {
    expect(SOUTH_AFRICA.geodeticFramework.datum).toBe("Hartebeesthoek94");
  });

  it("has primary SRID 2053 (Hartebeesthoek94 / Lo27 — Johannesburg)", () => {
    expect(SOUTH_AFRICA.geodeticFramework.primarySRID).toBe(2053);
  });

  it("Lo zones have scale factor 1.0 and zero false easting/northing", () => {
    for (const zone of SOUTH_AFRICA.geodeticFramework.projectionZones) {
      expect(zone.scale_factor).toBe(1.0);
      expect(zone.false_easting_m).toBe(0.0);
      expect(zone.false_northing_m).toBe(0.0);
      expect(zone.ellipsoid).toBe("WGS84");
    }
  });

  it("documents Cape Datum → Hartebeesthoek94 legacy transform", () => {
    const cape = SOUTH_AFRICA.geodeticFramework.legacyDatums?.find(
      (d) => d.from === "Cape Datum",
    );
    expect(cape).toBeDefined();
    expect(cape!.source).toContain("Chief Surveyor-General");
  });

  it("uses SAGC (formerly PLATO) as the professional body", () => {
    expect(SOUTH_AFRICA.professionalBody.name).toContain("SAGC");
    expect(SOUTH_AFRICA.professionalBody.name).toContain("PLATO");
    expect("PLATO/12345").toMatch(new RegExp(SOUTH_AFRICA.professionalBody.registrationPattern!));
  });

  it("includes SG Diagram as a statutory doc", () => {
    const sg = SOUTH_AFRICA.statutoryDocuments.find((d) => d.docType === "SG Diagram");
    expect(sg).toBeDefined();
    expect(sg!.pageSize).toBe("A4");
    expect(sg!.requiresProfessionalSeal).toBe(true);
  });

  it("includes General Plan for township layouts (A1 size)", () => {
    const gp = SOUTH_AFRICA.statutoryDocuments.find((d) => d.docType === "General Plan");
    expect(gp).toBeDefined();
    expect(gp!.pageSize).toBe("A1");
  });

  it("has a Sectional Titles Act 95 of 1986 sectional regime", () => {
    expect(SOUTH_AFRICA.sectionalPropertyRegime).toBeDefined();
    expect(SOUTH_AFRICA.sectionalPropertyRegime!.legislation).toContain("Sectional Titles Act 95 of 1986");
    expect(SOUTH_AFRICA.sectionalPropertyRegime!.requiresParticipationQuotas).toBe(true);
  });

  it("levelling tolerance is 4mm × √K (SANS 2814 Class B)", () => {
    const rule = SOUTH_AFRICA.toleranceTable.find(
      (r) => r.surveyType === "Levelling",
    );
    expect(rule).toBeDefined();
    expect(rule!.compute({ K_km: 9 })).toBeCloseTo(12.0, 6);
    expect(rule!.source).toContain("SANS 2814");
  });
});

// ─── United Arab Emirates (Dubai) ────────────────────────────────

describe("United Arab Emirates (Dubai) config", () => {
  it("has ISO code AE", () => {
    expect(UNITED_ARAB_EMIRATES.countryCode).toBe("AE");
  });

  it("uses WGS84 as the primary datum (no legacy datum)", () => {
    expect(UNITED_ARAB_EMIRATES.geodeticFramework.datum).toBe("WGS84");
    expect(UNITED_ARAB_EMIRATES.geodeticFramework.legacyDatums).toHaveLength(0);
  });

  it("has primary SRID 32640 (WGS84 / UTM zone 40N — Dubai)", () => {
    expect(UNITED_ARAB_EMIRATES.geodeticFramework.primarySRID).toBe(32640);
  });

  it("UTM zone 40N has CM 57°E (Dubai)", () => {
    const zone = UNITED_ARAB_EMIRATES.geodeticFramework.projectionZones[0]!;
    expect(zone.central_meridian_deg).toBe(57.0);
    expect(zone.false_northing_m).toBe(0.0); // northern hemisphere
  });

  it("lists Dubai Land Department + Dubai Municipality as regulatory bodies", () => {
    expect(UNITED_ARAB_EMIRATES.regulatoryBody.length).toBeGreaterThanOrEqual(2);
    const names = UNITED_ARAB_EMIRATES.regulatoryBody.map((b) => b.name);
    expect(names.some((n) => n.includes("Dubai Land Department"))).toBe(true);
    expect(names.some((n) => n.includes("Dubai Municipality"))).toBe(true);
  });

  it("includes Dubai Title Deed as a statutory doc", () => {
    const td = UNITED_ARAB_EMIRATES.statutoryDocuments.find((d) => d.docType === "Title Deed");
    expect(td).toBeDefined();
    expect(td!.requiresProfessionalSeal).toBe(false); // DLD-issued
  });

  it("includes JOP Declaration (strata equivalent) under Law No. 6 of 2019", () => {
    const jop = UNITED_ARAB_EMIRATES.statutoryDocuments.find((d) => d.docType === "JOP Declaration");
    expect(jop).toBeDefined();
    expect(jop!.requiresProfessionalSeal).toBe(true);
    expect(UNITED_ARAB_EMIRATES.sectionalPropertyRegime!.legislation).toContain("Law No. 6 of 2019");
  });

  it("levelling tolerance is 6mm × √K (Dubai Municipality)", () => {
    const rule = UNITED_ARAB_EMIRATES.toleranceTable.find(
      (r) => r.surveyType === "Levelling",
    );
    expect(rule).toBeDefined();
    expect(rule!.compute({ K_km: 4 })).toBeCloseTo(12.0, 6);
    expect(rule!.source).toContain("Dubai Municipality");
  });

  it("linear misclosure for cadastral is 1:10000 (DLD)", () => {
    const rule = UNITED_ARAB_EMIRATES.toleranceTable.find(
      (r) => r.surveyType === "Cadastral" && r.toleranceType === "linear_misclosure",
    );
    expect(rule).toBeDefined();
    // 10000m traverse with 1m misclosure → ratio 10000 (passes 1:10000 exactly)
    expect(rule!.compute({ total_length_m: 10000, misclosure_m: 1.0 })).toBe(10000);
  });
});

// ─── Registry ────────────────────────────────────────────────────

describe("country registry (with all 5 countries)", () => {
  it("contains all 5 implemented countries", () => {
    expect(COUNTRY_REGISTRY.KE).toBe(KE_REF);
    expect(COUNTRY_REGISTRY.AU).toBe(AUSTRALIA);
    expect(COUNTRY_REGISTRY.GB).toBe(UNITED_KINGDOM);
    expect(COUNTRY_REGISTRY.ZA).toBe(SOUTH_AFRICA);
    expect(COUNTRY_REGISTRY.AE).toBe(UNITED_ARAB_EMIRATES);
  });

  it("implementedCountries() returns all 5 codes", () => {
    const implemented = implementedCountries();
    expect(implemented.sort()).toEqual(["AE", "AU", "GB", "KE", "ZA"]);
  });

  it("getCountryConfig works for all 5", () => {
    expect(getCountryConfig("KE")).toBeDefined();
    expect(getCountryConfig("AU")).toBeDefined();
    expect(getCountryConfig("GB")).toBeDefined();
    expect(getCountryConfig("ZA")).toBeDefined();
    expect(getCountryConfig("AE")).toBeDefined();
  });
});

// Local reference to KENYA for the registry test above (avoids an extra import).
import { KENYA as KE_REF } from "../countries/kenya.js";
