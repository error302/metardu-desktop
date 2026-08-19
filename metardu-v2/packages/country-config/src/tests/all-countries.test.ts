/**
 * Tests for the Australia, UK, South Africa, UAE, Germany, and USA
 * country configs.
 *
 * Verifies the core identity, geodetic framework, tolerance rules, and
 * statutory documents of each country. Values are sourced from
 * EPSG registry + cited professional standards (NOT statutory documents
 * in the case of the non-Kenya countries — those source documents are
 * still pending filing per invariant B1).
 */

import { describe, it, expect } from "vitest";
import {
  AUSTRALIA,
  UNITED_KINGDOM,
  SOUTH_AFRICA,
  UNITED_ARAB_EMIRATES,
  GERMANY,
  UNITED_STATES,
  GHANA,
  getCountryConfig,
  implementedCountries,
  COUNTRY_REGISTRY,
  crsLabelForCountry,
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

// ─── Germany ─────────────────────────────────────────────────────

describe("Germany config", () => {
  it("has ISO code DE", () => {
    expect(GERMANY.countryCode).toBe("DE");
  });

  it("uses ETRS89 as the primary datum", () => {
    expect(GERMANY.geodeticFramework.datum).toBe("ETRS89");
  });

  it("has primary SRID 25832 (ETRS89 / UTM zone 32N)", () => {
    expect(GERMANY.geodeticFramework.primarySRID).toBe(25832);
  });

  it("UTM zone 32N has CM 9°E and GRS80 ellipsoid", () => {
    const zone = GERMANY.geodeticFramework.projectionZones[0]!;
    expect(zone.central_meridian_deg).toBe(9.0);
    expect(zone.ellipsoid).toBe("GRS80");
    expect(zone.scale_factor).toBeCloseTo(0.9996, 4);
  });

  it("includes legacy DHDN Gauss-Krüger zone 3 (EPSG::31467)", () => {
    const gk = GERMANY.geodeticFramework.projectionZones.find((z) => z.srid === 31467);
    expect(gk).toBeDefined();
    expect(gk!.ellipsoid).toBe("Bessel 1841");
  });

  it("documents DHDN → ETRS89 legacy transform", () => {
    const dhdn = GERMANY.geodeticFramework.legacyDatums?.find((d) => d.from.includes("DHDN"));
    expect(dhdn).toBeDefined();
    expect(dhdn!.source).toContain("NTV2");
  });

  it("uses DVW/ÖbVI as the professional body", () => {
    expect(GERMANY.professionalBody.name).toContain("DVW");
    expect(GERMANY.professionalBody.registrationNumberField).toContain("ÖbVI");
  });

  it("includes Grenzfeststellung as a statutory doc (surveyor-sealed)", () => {
    const gf = GERMANY.statutoryDocuments.find((d) => d.docType === "Grenzfeststellung");
    expect(gf).toBeDefined();
    expect(gf!.pageSize).toBe("A4");
    expect(gf!.requiresProfessionalSeal).toBe(true);
  });

  it("has a WEG sectional regime with participation quotas", () => {
    expect(GERMANY.sectionalPropertyRegime).toBeDefined();
    expect(GERMANY.sectionalPropertyRegime!.legislation).toContain("Wohnungseigentumsgesetz");
    expect(GERMANY.sectionalPropertyRegime!.requiresParticipationQuotas).toBe(true);
  });

  it("angular misclosure is 10″ × √N", () => {
    const rule = GERMANY.toleranceTable.find(
      (r) => r.surveyType === "Cadastral" && r.toleranceType === "angular_misclosure",
    );
    expect(rule).toBeDefined();
    expect(rule!.compute({ N_stations: 9 })).toBeCloseTo(30.0, 6);
  });

  it("levelling tolerance is 4mm × √K", () => {
    const rule = GERMANY.toleranceTable.find((r) => r.surveyType === "Levelling");
    expect(rule).toBeDefined();
    expect(rule!.compute({ K_km: 9 })).toBeCloseTo(12.0, 6);
  });
});

// ─── United States ───────────────────────────────────────────────

describe("United States config", () => {
  it("has ISO code US", () => {
    expect(UNITED_STATES.countryCode).toBe("US");
  });

  it("uses NAD83(2011) as the primary datum", () => {
    expect(UNITED_STATES.geodeticFramework.datum).toBe("NAD83(2011)");
  });

  it("has primary SRID 6360 (NAD83(2011) / Texas South Central, metres)", () => {
    // Metre CRS (EPSG::6360) — the ftUS variant is EPSG::6589. We use
    // the metre CRS so the sidecar's LCC (metre-native) is consistent
    // with false_easting_m/false_northing_m.
    expect(UNITED_STATES.geodeticFramework.primarySRID).toBe(6360);
  });

  it("Texas South Central zone uses Lambert Conformal Conic with GRS80", () => {
    const tx = UNITED_STATES.geodeticFramework.projectionZones[0]!;
    expect(tx.method).toBe("Lambert Conformal Conic");
    expect(tx.ellipsoid).toBe("GRS80");
    expect(tx.central_meridian_deg).toBe(-99.0);
  });

  it("LCC zones carry standard parallels for the sidecar (EPSG 2SP)", () => {
    const tx = UNITED_STATES.geodeticFramework.projectionZones[0]!;
    const ca = UNITED_STATES.geodeticFramework.projectionZones[1]!;
    const ny = UNITED_STATES.geodeticFramework.projectionZones[3]!;
    expect(tx.standard_parallel_1_deg).toBeCloseTo(27.8333333333, 9);
    expect(tx.standard_parallel_2_deg).toBeCloseTo(31.8833333333, 9);
    expect(ca.standard_parallel_1_deg).toBeCloseTo(34.0333333333, 9);
    expect(ca.standard_parallel_2_deg).toBeCloseTo(35.4666666667, 9);
    expect(ny.standard_parallel_1_deg).toBeCloseTo(40.6666666667, 9);
    expect(ny.standard_parallel_2_deg).toBeCloseTo(41.0333333333, 9);
  });

  it("covers CA, FL, and NY with additional SPCS zones", () => {
    const srids = UNITED_STATES.geodeticFramework.projectionZones.map((z) => z.srid);
    expect(srids).toContain(6335); // California zone 5
    expect(srids).toContain(6344); // Florida East
    expect(srids).toContain(6539); // New York Long Island
  });

  it("documents NAD27 → NAD83 legacy transform", () => {
    const nad27 = UNITED_STATES.geodeticFramework.legacyDatums?.find((d) => d.from === "NAD27");
    expect(nad27).toBeDefined();
    expect(nad27!.source).toContain("NADCON");
  });

  it("uses NSPS as the professional body", () => {
    expect(UNITED_STATES.professionalBody.name).toContain("NSPS");
    expect(UNITED_STATES.professionalBody.registrationNumberField).toContain("State Reg. No.");
  });

  it("includes ALTA/NSPS Land Title Survey as a statutory doc (surveyor-sealed)", () => {
    const alta = UNITED_STATES.statutoryDocuments.find((d) => d.docType === "ALTA/NSPS Land Title Survey");
    expect(alta).toBeDefined();
    expect(alta!.pageSize).toBe("ANSI B (11×17)");
    expect(alta!.requiresProfessionalSeal).toBe(true);
  });

  it("includes BLM Cadastral Plat for federal lands", () => {
    const blm = UNITED_STATES.statutoryDocuments.find((d) => d.docType === "BLM Cadastral Plat");
    expect(blm).toBeDefined();
    expect(blm!.requiresProfessionalSeal).toBe(true);
  });

  it("has a condominium sectional regime (state acts)", () => {
    expect(UNITED_STATES.sectionalPropertyRegime).toBeDefined();
    expect(UNITED_STATES.sectionalPropertyRegime!.legislation).toContain("condominium");
  });

  it("ALTA urban RPA is 2cm (0.020m)", () => {
    const rule = UNITED_STATES.toleranceTable.find(
      (r) => r.toleranceType === "relative_positional_accuracy" && r.formula.includes("urban"),
    );
    expect(rule).toBeDefined();
    expect(rule!.compute({})).toBeCloseTo(0.020, 6);
  });

  it("FGCS second-order Class I is 1:50000", () => {
    const rule = UNITED_STATES.toleranceTable.find(
      (r) => r.surveyType === "Geodetic" && r.toleranceType === "linear_misclosure",
    );
    expect(rule).toBeDefined();
    expect(rule!.compute({ total_length_m: 50000, misclosure_m: 1.0 })).toBe(50000);
  });

  it("includes UTM zones for engine WGS84 reprojection (outputWgs84 path)", () => {
    // The desktop main process matches /UTM zone (\d+)([NS])/i against zone
    // names to wire the sidecar's utm_inverse for WGS84 output. SPCS (Lambert)
    // names don't match, so each US market needs a UTM equivalent in the list.
    const utmZones = UNITED_STATES.geodeticFramework.projectionZones.filter(
      (z) => /UTM zone (\d+)([NS])/i.test(z.name),
    );
    expect(utmZones.length).toBeGreaterThanOrEqual(3); // 16N, 17N, 18N
    for (const z of utmZones) {
      expect(z.method).toBe("Transverse Mercator");
      expect(z.scale_factor).toBeCloseTo(0.9996, 4);
      expect(z.ellipsoid).toBe("GRS80");
    }
    expect(utmZones.some((z) => z.srid === 6320)).toBe(true); // 16N (CA)
    expect(utmZones.some((z) => z.srid === 6321)).toBe(true); // 17N
    expect(utmZones.some((z) => z.srid === 6322)).toBe(true); // 18N (TX east/FL/NY)
  });
});

// ─── Ghana ───────────────────────────────────────────────────────

describe("Ghana config", () => {
  it("has ISO code GH", () => {
    expect(GHANA.countryCode).toBe("GH");
  });

  it("uses the Leigon / Ghana Metre Grid as primary CRS (EPSG:25000)", () => {
    expect(GHANA.geodeticFramework.primarySRID).toBe(25000);
    const grid = GHANA.geodeticFramework.projectionZones.find((z) => z.srid === 25000);
    expect(grid).toBeDefined();
    expect(grid!.method).toBe("Transverse Mercator");
    expect(grid!.central_meridian_deg).toBe(-1.0);
    expect(grid!.latitude_of_origin_deg).toBeCloseTo(4.66666666666667, 9);
    expect(grid!.scale_factor).toBeCloseTo(0.99975, 6);
    expect(grid!.false_easting_m).toBeCloseTo(274_319.51, 2);
  });

  it("documents the legacy Accra / Ghana National Grid (EPSG:2136)", () => {
    const accra = GHANA.geodeticFramework.projectionZones.find((z) => z.srid === 2136);
    expect(accra).toBeDefined();
    expect(accra!.ellipsoid).toBe("War Office");
    // 900,000 Gold Coast feet ≈ 274,319.74 m
    expect(accra!.false_easting_m).toBeCloseTo(274_319.74, 1);
  });

  it("includes UTM 30N/31N for engine WGS84 reprojection", () => {
    const srids = GHANA.geodeticFramework.projectionZones.map((z) => z.srid);
    expect(srids).toContain(32630); // 30N (west)
    expect(srids).toContain(32631); // 31N (east)
  });

  it("uses GhIS as the professional body", () => {
    expect(GHANA.professionalBody.name).toContain("GhIS");
    expect(GHANA.professionalBody.registrationNumberField).toContain("GhIS");
    expect("GHIS/1234").toMatch(new RegExp(GHANA.professionalBody.registrationPattern!));
  });

  it("includes the Lands Commission Survey Plan as a statutory doc", () => {
    const sp = GHANA.statutoryDocuments.find((d) => d.docType === "Survey Plan");
    expect(sp).toBeDefined();
    expect(sp!.pageSize).toBe("A1");
    expect(sp!.requiresProfessionalSeal).toBe(true);
    expect(sp!.citation).toContain("Land Act 2020");
  });

  it("defaults to a large-format A0 plan sheet (Lands Commission lodgment)", () => {
    expect(GHANA.planSheet!.defaultSheetSize).toBe("a0");
    expect(GHANA.planSheet!.defaultOrientation).toBe("landscape");
  });

  it("carries required statutory footer disclaimers", () => {
    expect(GHANA.planSheet!.titleBlockLayout.statutoryFooterLines?.length).toBeGreaterThan(0);
  });
});

// ─── Registry ────────────────────────────────────────────────────

describe("country registry (with all 8 countries)", () => {
  it("contains all 8 implemented countries", () => {
    expect(COUNTRY_REGISTRY.KE).toBe(KE_REF);
    expect(COUNTRY_REGISTRY.AU).toBe(AUSTRALIA);
    expect(COUNTRY_REGISTRY.GB).toBe(UNITED_KINGDOM);
    expect(COUNTRY_REGISTRY.ZA).toBe(SOUTH_AFRICA);
    expect(COUNTRY_REGISTRY.AE).toBe(UNITED_ARAB_EMIRATES);
    expect(COUNTRY_REGISTRY.DE).toBe(GERMANY);
    expect(COUNTRY_REGISTRY.US).toBe(UNITED_STATES);
    expect(COUNTRY_REGISTRY.GH).toBe(GHANA);
  });

  it("implementedCountries() returns all 8 codes", () => {
    const implemented = implementedCountries();
    expect(implemented.sort()).toEqual(["AE", "AU", "DE", "GB", "GH", "KE", "US", "ZA"]);
  });

  it("getCountryConfig works for all 8", () => {
    expect(getCountryConfig("KE")).toBeDefined();
    expect(getCountryConfig("AU")).toBeDefined();
    expect(getCountryConfig("GB")).toBeDefined();
    expect(getCountryConfig("ZA")).toBeDefined();
    expect(getCountryConfig("AE")).toBeDefined();
    expect(getCountryConfig("DE")).toBeDefined();
    expect(getCountryConfig("US")).toBeDefined();
    expect(getCountryConfig("GH")).toBeDefined();
  });
});

// ─── Plan-sheet profiles (per-country print plans) ──────────────

describe("planSheet profiles (all countries)", () => {
  // Sheet sizes must match the map-svg SHEET_SIZES_PT registry.
  const KNOWN_SHEETS = new Set(["a4", "a3", "a2", "a1", "a0", "letter", "legal"]);

  it("every implemented country defines a planSheet profile", () => {
    for (const code of implementedCountries()) {
      expect(getCountryConfig(code).planSheet, `${code} planSheet`).toBeDefined();
    }
  });

  it("every profile has a known sheet size, orientation, and statutory text", () => {
    for (const code of implementedCountries()) {
      const ps = getCountryConfig(code).planSheet!;
      expect(KNOWN_SHEETS.has(ps.defaultSheetSize), `${code} sheet ${ps.defaultSheetSize}`).toBe(true);
      expect(["landscape", "portrait"]).toContain(ps.defaultOrientation);
      expect(ps.titleBlockLabel.length).toBeGreaterThan(0);
      expect(ps.planTypeLabel.length).toBeGreaterThan(0);
      expect(ps.footerNote.length).toBeGreaterThan(20);
    }
  });

  it("large-format markets default to large sheets (ZA A1, AU A1, GH A0)", () => {
    expect(getCountryConfig("ZA").planSheet!.defaultSheetSize).toBe("a1");
    expect(getCountryConfig("AU").planSheet!.defaultSheetSize).toBe("a1");
    expect(getCountryConfig("GH").planSheet!.defaultSheetSize).toBe("a0");
  });

  it("every profile defines a valid statutory titleBlockLayout", () => {
    const VARIANTS = ["standard", "sg-diagram", "us-alta", "hmlr-title-plan"];
    const SEAL_POSITIONS = ["bottom-right", "bottom-left", "none"];
    for (const code of implementedCountries()) {
      const layout = getCountryConfig(code).planSheet!.titleBlockLayout;
      expect(layout, `${code} titleBlockLayout`).toBeDefined();
      expect(VARIANTS, `${code} variant`).toContain(layout!.variant);
      expect(layout!.fieldRows.length, `${code} fieldRows`).toBeGreaterThan(0);
      for (const row of layout!.fieldRows) {
        expect(row.label.length, `${code} field label`).toBeGreaterThan(0);
        if (row.value) {
          // Token placeholders must be a known token (renderer fills them).
          const tokens = row.value.match(/\{\{(\w+)\}\}/g) ?? [];
          for (const t of tokens) {
            expect(
              ["{{title}}", "{{surveyor}}", "{{date}}", "{{scale}}", "{{crs}}", "{{planType}}"],
              `${code} unknown token ${t}`,
            ).toContain(t);
          }
        }
      }
      expect(SEAL_POSITIONS, `${code} seal position`).toContain(layout!.seal.position);
    }
  });

  it("registry-issued markets carry no surveyor seal (GB HMLR title plans)", () => {
    expect(getCountryConfig("GB").planSheet!.titleBlockLayout.seal.position).toBe("none");
    expect(getCountryConfig("GB").planSheet!.titleBlockLayout.statutoryFooterLines?.length).toBeGreaterThan(0);
  });

  it("every market's sheet carries required statutory footer disclaimers", () => {
    for (const code of implementedCountries()) {
      const lines = getCountryConfig(code).planSheet!.titleBlockLayout.statutoryFooterLines;
      expect(lines, `${code} statutoryFooterLines`).toBeDefined();
      expect(lines!.length, `${code} footer line count`).toBeGreaterThan(0);
      for (const line of lines!) {
        expect(line.length, `${code} footer line text`).toBeGreaterThan(10);
      }
    }
  });

  it("surveyor-sealed markets require a certification block + seal caption", () => {
    for (const code of ["KE", "ZA", "US", "AU", "AE", "DE", "GH"] as const) {
      const layout = getCountryConfig(code).planSheet!.titleBlockLayout;
      expect(layout.certification, `${code} certification`).toBeDefined();
      expect(layout.certification!.heading.length, `${code} cert heading`).toBeGreaterThan(0);
      expect(layout.certification!.lines.length, `${code} cert lines`).toBeGreaterThan(0);
      expect(layout.seal.position, `${code} seal position`).not.toBe("none");
      expect(layout.seal.caption?.length ?? 0, `${code} seal caption`).toBeGreaterThan(0);
    }
  });
});

// ─── CRS label for statutory plan title strips / {{crs}} token ───

describe("crsLabelForCountry (datum-deduped CRS label)", () => {
  it("never double-prints the datum when the zone name embeds it (US SPCS zone)", () => {
    // US zone names already embed the datum ("NAD83(2011) / Texas South
    // Central"); a naive datum prefix produced the SPCS ZONE field reading
    // "NAD83(2011) / NAD83(2011) / Texas South Central" on ALTA/NSPS plats.
    expect(crsLabelForCountry("US")).toBe("NAD83(2011) / Texas South Central");
    expect(crsLabelForCountry("US")).not.toContain("NAD83(2011) / NAD83(2011)");
  });

  it("returns the primary zone's full CRS name for every country", () => {
    const expected: Record<string, string> = {
      KE: "Arc 1960 / UTM zone 37S",
      AU: "GDA2020 / MGA zone 56",
      GB: "OSGB36 / British National Grid",
      ZA: "Hartebeesthoek94 / Lo27",
      AE: "WGS 84 / UTM zone 40N",
      DE: "ETRS89 / UTM zone 32N",
      US: "NAD83(2011) / Texas South Central",
      GH: "Leigon / Ghana Metre Grid",
    };
    for (const code of implementedCountries()) {
      expect(crsLabelForCountry(code), `${code} CRS label`).toBe(expected[code]);
    }
  });

  it("never contains the datum twice for any country", () => {
    for (const code of implementedCountries()) {
      const label = crsLabelForCountry(code);
      const datum = getCountryConfig(code).geodeticFramework.datum;
      const datumCount = label.split(datum).length - 1;
      expect(datumCount, `${code} label "${label}" mentions datum ${datumCount}x`).toBeLessThanOrEqual(1);
    }
  });

  it("matches the zone name for the primary SRID (compound zone names used as-is)", () => {
    for (const code of implementedCountries()) {
      const cfg = getCountryConfig(code);
      const zone = cfg.geodeticFramework.projectionZones.find(
        (z) => z.srid === cfg.geodeticFramework.primarySRID,
      );
      if (zone && zone.name.includes("/")) {
        expect(crsLabelForCountry(code), `${code} uses zone name as-is`).toBe(zone.name);
      }
    }
  });
});

// Local reference to KENYA for the registry test above (avoids an extra import).
import { KENYA as KE_REF } from "../countries/kenya.js";
