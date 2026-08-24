import { describe, it, expect } from "vitest";
import { landxmlExporter } from "../landxml-export.js";

const meta = {
  projectName: "Test LandXML",
  surveyorName: "Test Surveyor",
  licenseNumber: "LS/0000",
  surveyDate: "2026-01-01",
  adjustmentRunId: "test-001",
};

const cadastralInput = {
  allBeacons: [
    { label: "A", position: { easting: 100, northing: 200 } },
    { label: "B", position: { easting: 200, northing: 200 } },
    { label: "C", position: { easting: 200, northing: 100 } },
    { label: "D", position: { easting: 100, northing: 100 } },
  ],
};

const topoInput = {
  tin: { vertices: [{ easting: 500000, northing: 100000, elevation: 10 }] },
  contours: [],
};

describe("landxml-country — SRID derived from country-config (Task 5)", () => {
  it("derives AU SRID 7856, not KE 21037, from country-config", async () => {
    const out = await landxmlExporter.export(cadastralInput as any, { countryCode: "AU", projectMetadata: meta } as any);
    expect(out.xml).toContain("7856");
    expect(out.xml).not.toContain("21037");
  });

  it("derives GB SRID 27700", async () => {
    const out = await landxmlExporter.export(cadastralInput as any, { countryCode: "GB", projectMetadata: meta } as any);
    expect(out.xml).toContain("27700");
  });

  it("derives ZA SRID 2053", async () => {
    const out = await landxmlExporter.export(cadastralInput as any, { countryCode: "ZA", projectMetadata: meta } as any);
    expect(out.xml).toContain("2053");
  });

  it("derives DE SRID 25832", async () => {
    const out = await landxmlExporter.export(cadastralInput as any, { countryCode: "DE", projectMetadata: meta } as any);
    expect(out.xml).toContain("25832");
  });

  it("defaults to KE 21037 when no countryCode given", async () => {
    const out = await landxmlExporter.export(cadastralInput as any, { projectMetadata: meta } as any);
    expect(out.xml).toContain("21037");
  });

  it("topographic export also derives SRID from country-config", async () => {
    const out = await landxmlExporter.export(topoInput as any, { countryCode: "AU", projectMetadata: meta } as any);
    expect(out.xml).toContain("7856");
    expect(out.xml).not.toContain("21037");
  });

  it("explicit srid overrides country-config", async () => {
    const out = await landxmlExporter.export(cadastralInput as any, { countryCode: "AU", srid: 4326, projectMetadata: meta } as any);
    expect(out.xml).toContain("4326");
    expect(out.xml).not.toContain("7856");
  });

  it("validate throws for unknown countryCode", async () => {
    const validation = landxmlExporter.validate(cadastralInput as any, { countryCode: "XX", projectMetadata: meta } as any);
    expect(validation.ok).toBe(false);
    await expect(landxmlExporter.export(cadastralInput as any, { countryCode: "XX", projectMetadata: meta } as any)).rejects.toThrow();
  });

  it("accepts valid AU topographic with explicit countryCode", async () => {
    const out = await landxmlExporter.export(topoInput as any, { countryCode: "GB", projectMetadata: meta } as any);
    expect(out.xml).toContain("27700");
  });
});
