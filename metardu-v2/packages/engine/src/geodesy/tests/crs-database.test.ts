import { describe, it, expect } from "vitest";
import {
  listCrsCandidatesForLocation,
  listCrsCatalogEntriesByEpsg,
  getCrsByEpsg,
  listCrsCatalogJurisdictions,
  CRS_DATABASE,
} from "../crs-database.js";

describe("CRS catalog discovery", () => {
  it("lists catalog metadata without calling the jurisdictions supported", () => {
    const jurisdictions = listCrsCatalogJurisdictions();
    expect(jurisdictions).toHaveLength(13);
    expect(jurisdictions.map(({ iso3 }) => iso3)).toContain("ZAF");
    expect(jurisdictions.map(({ iso3 }) => iso3)).toContain("DEU");
  });

  it("returns all Kenya candidates without selecting one", () => {
    const candidates = listCrsCandidatesForLocation("KEN", -1.2864, 36.8172);
    expect(candidates.some(({ crs }) => crs.epsg === 21037)).toBe(true);
    expect(candidates.every(({ jurisdiction }) => jurisdiction === "KEN")).toBe(true);
  });

  it("preserves all candidates on a zone boundary", () => {
    const candidates = listCrsCandidatesForLocation("KEN", -1, 36);
    expect(candidates.some(({ crs }) => crs.epsg === 21036)).toBe(true);
    expect(candidates.some(({ crs }) => crs.epsg === 21037)).toBe(true);
    expect(candidates).toHaveLength(2);
  });

  it("rejects invalid geographic coordinates and jurisdiction codes", () => {
    expect(() => listCrsCandidatesForLocation("KEN", Number.NaN, 0)).toThrow(RangeError);
    expect(() => listCrsCandidatesForLocation("KEN", 0, 181)).toThrow(RangeError);
    expect(() => listCrsCandidatesForLocation("Kenya", 0, 0)).toThrow(RangeError);
  });

  it("returns no candidate for a valid but uncatalogued jurisdiction", () => {
    expect(listCrsCandidatesForLocation("XXX", 0, 0)).toEqual([]);
  });

  it("exposes conflicting duplicate EPSG catalog entries instead of choosing the first", () => {
    const entries = listCrsCatalogEntriesByEpsg(21037);
    expect(entries.map(({ jurisdiction }) => jurisdiction)).toEqual(["KEN", "TZA"]);
    expect(getCrsByEpsg(21037)).toBeNull();
    expect(getCrsByEpsg(2053)?.name).toContain("Hartebeesthoek94");
    expect(getCrsByEpsg(25832)?.name).toContain("ETRS89");
    expect(getCrsByEpsg(99999)).toBeNull();
    expect(getCrsByEpsg(20537)).toBeNull();
    expect(() => listCrsCatalogEntriesByEpsg(0)).toThrow(RangeError);
  });

  it("retains catalog parameter records", () => {
    expect(CRS_DATABASE.ZAF).toHaveLength(3);
    expect(CRS_DATABASE.DEU).toHaveLength(3);
    expect(getCrsByEpsg(2053)?.centralMeridian).toBe(27);
    expect(getCrsByEpsg(25832)?.scaleFactor).toBe(0.9996);
  });
});
