/**
 * DeedPlanView country-switch tests — Task 4.
 *
 * Verifies that registration patterns and SRIDs are country-driven via
 * @metardu/country-config, and that DeedPlanView.tsx is not hardcoded to KE.
 */

import { describe, it, expect } from "vitest";
import { getCountryConfig } from "@metardu/country-config";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const deedPlanPath = join(__dirname, "..", "renderer", "views", "DeedPlanView.tsx");

function deedPlanSource(): string {
  return readFileSync(deedPlanPath, "utf8");
}

describe("country-config registration patterns", () => {
  it("AU validates CSPS pattern not LS", () => {
    const auPat = new RegExp(getCountryConfig("AU").professionalBody.registrationPattern!);
    expect(auPat.test("CSPS/1234")).toBe(true);
    expect(auPat.test("CSPS/12345")).toBe(true);
    expect(auPat.test("LS/0481")).toBe(false);
    expect(auPat.test("PLATO/1234")).toBe(false);
  });

  it("ZA validates PLATO pattern not CSPS or LS", () => {
    const zaPat = new RegExp(getCountryConfig("ZA").professionalBody.registrationPattern!);
    expect(zaPat.test("PLATO/1234")).toBe(true);
    expect(zaPat.test("PLATO/12345")).toBe(true);
    expect(zaPat.test("CSPS/1234")).toBe(false);
    expect(zaPat.test("LS/0481")).toBe(false);
  });

  it("GB validates 7-digit RICS pattern", () => {
    const gbPat = new RegExp(getCountryConfig("GB").professionalBody.registrationPattern!);
    expect(gbPat.test("1234567")).toBe(true);
    expect(gbPat.test("0000001")).toBe(true);
    expect(gbPat.test("LS/0481")).toBe(false);
    expect(gbPat.test("CSPS/1234")).toBe(false);
    expect(gbPat.test("123456")).toBe(false); // 6 digits invalid
    expect(gbPat.test("12345678")).toBe(false); // 8 digits invalid
  });

  it("DE validates numeric pattern", () => {
    const dePat = new RegExp(getCountryConfig("DE").professionalBody.registrationPattern!);
    expect(dePat.test("1234")).toBe(true);
    expect(dePat.test("123456")).toBe(true);
    expect(dePat.test("LS/0481")).toBe(false);
  });

  it("KE validates LS pattern", () => {
    const kePat = new RegExp(getCountryConfig("KE").professionalBody.registrationPattern!);
    expect(kePat.test("LS/0481")).toBe(true);
    expect(kePat.test("LS/12345")).toBe(true);
    expect(kePat.test("CSPS/1234")).toBe(false);
  });
});

describe("country-specific SRIDs", () => {
  it("AU primary SRID is 7856 not 21037", () => {
    expect(getCountryConfig("AU").geodeticFramework.primarySRID).toBe(7856);
    expect(getCountryConfig("AU").geodeticFramework.primarySRID).not.toBe(21037);
  });
  it("ZA primary SRID is 2053 not 21037", () => {
    expect(getCountryConfig("ZA").geodeticFramework.primarySRID).toBe(2053);
  });
  it("GB primary SRID is 27700 not 21037", () => {
    expect(getCountryConfig("GB").geodeticFramework.primarySRID).toBe(27700);
  });
  it("DE primary SRID is 25832 not 21037", () => {
    expect(getCountryConfig("DE").geodeticFramework.primarySRID).toBe(25832);
  });
  it("KE primary SRID is 21037", () => {
    expect(getCountryConfig("KE").geodeticFramework.primarySRID).toBe(21037);
  });
});

describe("DeedPlanView country-aware refactor", () => {
  it("does not hardcode 21037", () => {
    const src = deedPlanSource();
    // No literal 21037 should remain outside comments about CRS database
    expect(src.includes("21037")).toBe(false);
  });

  it("imports getCountryConfig and CountryCode", () => {
    const src = deedPlanSource();
    expect(src).toMatch(/getCountryConfig/);
    expect(src).toMatch(/CountryCode/);
  });

  it("uses cfg.geodeticFramework.primarySRID not literal", () => {
    const src = deedPlanSource();
    expect(src).toMatch(/cfg\.geodeticFramework\.primarySRID/);
  });

  it("uses cfg.professionalBody.registrationPattern for validation", () => {
    const src = deedPlanSource();
    expect(src).toMatch(/cfg\.professionalBody\.registrationPattern/);
  });

  it("signing uses cfg.professionalBody.name and cfg.countryName", () => {
    const src = deedPlanSource();
    expect(src).toMatch(/cfg\.professionalBody\.name/);
    expect(src).toMatch(/cfg\.countryName/);
  });

  it("CRS display uses cfg.geodeticFramework.projectionZones not hardcoded Arc 1960", () => {
    const src = deedPlanSource();
    expect(src).not.toMatch(/Arc 1960 \/ UTM 37S/);
    expect(src).toMatch(/cfg\.geodeticFramework\.projectionZones/);
  });

  it("has countryCode state with useState<CountryCode>", () => {
    const src = deedPlanSource();
    expect(src).toMatch(/useState<CountryCode>/);
    expect(src).toMatch(/countryCode.*setCountryCode/);
  });

  it("has <select> for countryCode with AU/GB/ZA/DE/KE options", () => {
    const src = deedPlanSource();
    expect(src).toMatch(/<select[^>]*value=\{countryCode\}/);
    for (const code of ["AU", "GB", "ZA", "DE", "KE"]) {
      expect(src.includes(`value="${code}"`)).toBe(true);
    }
  });

  it("wires setSurveyOutput with countryCode not hardcoded KE", () => {
    const src = deedPlanSource();
    // Should call setSurveyOutput(..., countryCode) and not with literal "KE" in that call
    expect(src).toMatch(/setSurveyOutput\([\s\S]*countryCode/);
    // Ensure no setSurveyOutput call contains hardcoded "KE" literal
    const calls = src.match(/setSurveyOutput\([\s\S]*?\)/g) || [];
    for (const c of calls) {
      expect(c.includes('"KE"')).toBe(false);
      expect(c.includes("'KE'")).toBe(false);
    }
  });

  it("does not hardcode ISK or Kenya in signing", () => {
    const src = deedPlanSource();
    // After refactor, signing should not contain literal "ISK" or '"Kenya"' for professionalBody/country
    // Allow "ISK" in comments but not in professionalBody: "ISK"
    expect(src).toMatch(/professionalBody:\s*cfg\.professionalBody\.name/);
    expect(src).not.toMatch(/professionalBody:\s*"ISK"/);
    expect(src).not.toMatch(/country:\s*"Kenya"/);
  });

  it("does not hardcode isValidISK", () => {
    const src = deedPlanSource();
    expect(src).not.toMatch(/isValidISK/);
    expect(src).not.toMatch(/\^LS\/\\d\{3,5\}\$/);
  });

  it("DxF export uses countryCode not hardcoded KE", () => {
    const src = deedPlanSource();
    expect(src).toMatch(/countryCode:\s*countryCode/);
    expect(src).not.toMatch(/countryCode:\s*"KE"/);
  });
});
