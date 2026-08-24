import { describe, it, expect } from "vitest";
import { getCountryDxfLayerSpecs } from "../dxf-export.js";
import { getCountryConfig } from "@metardu/country-config";

describe("getCountryDxfLayerSpecs — AU/ZA/DE country-correct layers (Task 6)", () => {
  function layersFor(code: string): string[] {
    return getCountryDxfLayerSpecs(code, "cadastral").map((s) => s.name);
  }

  it("AU DP uses NSW LRS layers not Kenya names — contains BOUNDARY and not TEXT-DEEDPLAN", () => {
    const cfg = getCountryConfig("AU");
    const auDoc = cfg.statutoryDocuments.find((d) => d.docType === "Plan of Survey");
    expect(auDoc, "AU Plan of Survey doc must exist in country-config").toBeDefined();
    const expectedLayers = auDoc!.dxfLayers;
    const specs = getCountryDxfLayerSpecs("AU", "cadastral");
    const names = specs.map((s) => s.name);
    // Must contain at least BOUNDARY from australia.ts (live config, not hardcoded Kenya)
    for (const expected of expectedLayers) {
      expect(names).toContain(expected);
    }
    // Must NOT contain Kenya-only TEXT-DEEDPLAN
    expect(names).not.toContain("TEXT-DEEDPLAN");
    // Specifically must contain BOUNDARY (from australia.ts 174-183)
    expect(names).toContain("BOUNDARY");
  });

  it("ZA SG Diagram uses SAGC layers not Kenya names", () => {
    const cfg = getCountryConfig("ZA");
    const zaDoc = cfg.statutoryDocuments.find((d) => d.docType === "SG Diagram");
    expect(zaDoc, "ZA SG Diagram doc must exist").toBeDefined();
    const expectedLayers = zaDoc!.dxfLayers;
    const specs = getCountryDxfLayerSpecs("ZA", "cadastral");
    const names = specs.map((s) => s.name);
    for (const expected of expectedLayers) {
      expect(names).toContain(expected);
    }
    expect(names).not.toContain("TEXT-DEEDPLAN");
    // ZA specific layer TEXT-SG should be present, not Kenya's TEXT-DEEDPLAN
    expect(names).toContain("TEXT-SG");
  });

  it("DE Grenzfeststellung uses AdV layers not Kenya names", () => {
    const cfg = getCountryConfig("DE");
    const deDoc = cfg.statutoryDocuments.find((d) => d.docType === "Grenzfeststellung");
    expect(deDoc, "DE Grenzfeststellung doc must exist").toBeDefined();
    const expectedLayers = deDoc!.dxfLayers;
    const specs = getCountryDxfLayerSpecs("DE", "cadastral");
    const names = specs.map((s) => s.name);
    for (const expected of expectedLayers) {
      expect(names).toContain(expected);
    }
    expect(names).not.toContain("TEXT-DEEDPLAN");
  });

  it("AU/ZA/DE do not fall back to Kenya TEXT-DEEDPLAN layer — no Kenya leak", () => {
    for (const code of ["AU", "ZA", "DE"] as const) {
      const names = layersFor(code);
      expect(names, `${code} should not contain Kenya-only TEXT-DEEDPLAN`).not.toContain("TEXT-DEEDPLAN");
      // Also should not contain Kenya-only TEXT-BEARINGS/TEXT-DISTANCES if not in config
      // For AU, config does not have those, so they should not appear verbatim from Kenya fallback
      // Instead should have country-correct layers
    }
  });

  it("each market returns its own layers — AU vs ZA vs DE distinct or at least not identical to KE", () => {
    const ke = layersFor("KE");
    const au = layersFor("AU");
    const za = layersFor("ZA");
    const de = layersFor("DE");
    // KE contains TEXT-DEEDPLAN, others must not
    expect(ke).toContain("TEXT-DEEDPLAN");
    expect(au).not.toContain("TEXT-DEEDPLAN");
    expect(za).not.toContain("TEXT-DEEDPLAN");
    expect(de).not.toContain("TEXT-DEEDPLAN");
    // AU should have MARK (NSW LRS distinguishes MARK vs BEACON), ZA/DE have BEACON
    expect(au).toContain("MARK");
    expect(za).toContain("BEACON");
    expect(de).toContain("BEACON");
  });
});
