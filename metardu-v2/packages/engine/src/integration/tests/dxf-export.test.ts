import { describe, it, expect } from "vitest";
import { dxfExporter, getCountryDxfLayerSpecs } from "../dxf-export.js";
import { INTEGRATION_EXPORTERS } from "../index.js";
import { runCadastralWorkflow } from "../../workflows/cadastral.js";
import { runTopographicWorkflow, runEngineeringWorkflow } from "../../workflows/index.js";
import { KENYA } from "@metardu/country-config";
import type { TopoPoint, TIN } from "../../workflows/topographic.js";
import type { DxfOptions } from "../dxf-export.js";

const baseMetadata = {
  projectName: "Brief 08 DXF Test", surveyorName: "Test Surveyor",
  licenseNumber: "LS/1234", surveyDate: "2026-07-23", adjustmentRunId: "brief-08-test-001",
};

async function kenyaCadastralOutput() {
  return await runCadastralWorkflow({
    knownBeacons: [
      { label: "B1", position: { easting: 257100.0, northing: 9857700.0 }, description: "Concrete pillar" },
      { label: "B2", position: { easting: 257150.0, northing: 9857700.0 }, description: "Concrete pillar" },
    ],
    observations: [
      { fromLabel: "B1", toLabel: "B3", distanceM: 50.0, sigmaM: 0.005 },
      { fromLabel: "B2", toLabel: "B3", distanceM: 50.0, sigmaM: 0.005 },
      { fromLabel: "B1", toLabel: "B4", distanceM: 70.71, sigmaM: 0.005 },
      { fromLabel: "B2", toLabel: "B4", distanceM: 50.0, sigmaM: 0.005 },
      { fromLabel: "B3", toLabel: "B4", distanceM: 50.0, sigmaM: 0.005 },
    ],
    parcel: { surveyNumber: "S/12345", district: "NAIROBI", location: "KASARANI", areaHa: 0.25 },
    surveyor: { name: "Jane Wanjiru", iskRegNo: "LS/1234", dateOfSurvey: "2026-07-23" },
    srid: 21037,
  });
}

function kenyaTopoOutput() {
  const points: TopoPoint[] = [];
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++)
    points.push({ id: `P${x}${y}`, easting: 1000 + x * 10, northing: 2000 + y * 10, elevation: 100 + x * 5 });
  return runTopographicWorkflow({ points, contourInterval: 5, country: KENYA,
    planTitle: "Topo", surveyor: { name: "T", regNo: "LS/1234", dateOfSurvey: "2026-07-23" } });
}

function decodeDxf(bytes: Uint8Array): string { return new TextDecoder().decode(bytes); }

describe("dxfExporter — format metadata", () => {
  it("exposes the correct format identifier, MIME type, and extension", () => {
    expect(dxfExporter.format).toBe("dxf");
    expect(dxfExporter.mimeType).toBe("application/dxf");
    expect(dxfExporter.fileExtension).toBe("dxf");
  });
});

describe("dxfExporter — Kenya cadastral", () => {
  it("produces a DXF with Kenya layer naming", async () => {
    const input = await kenyaCadastralOutput();
    const result = await dxfExporter.export(input, { countryCode: "KE", projectMetadata: baseMetadata });
    expect(result.crsUrn).toBe("urn:ogc:def:crs:EPSG::21037");
    expect(result.layers).toContain("BOUNDARY");
    expect(result.layers).toContain("BEACON");
    const dxf = decodeDxf(result.bytes);
    expect(dxf).toContain("SECTION");
    expect(dxf).toContain("ENTITIES");
    expect(dxf).toContain("EOF");
    expect(dxf).toContain("SRID 21037");
  });
});

describe("dxfExporter — UK cadastral SURV-* prefix", () => {
  it("uses SURV-BOUNDARY and SURV-POINT instead of BOUNDARY and BEACON", async () => {
    const input = {
      form3: { pdfBytes: new Uint8Array(0), pageCount: 0, scale: 0, coordinateSystemLabel: "OSGB36", hasDraftWatermark: false },
      allBeacons: [
        { label: "P1", position: { easting: 525000.0, northing: 181000.0 }, description: "F" },
        { label: "P2", position: { easting: 525050.0, northing: 181000.0 }, description: "F" },
        { label: "P3", position: { easting: 525050.0, northing: 181040.0 }, description: "W" },
      ],
      residuals: {}, sigma_0_sq: 0, passesCadastralTolerance: false,
      uncertainty: { P1: { adjusted: false, reason: "fixed-control" as const }, P2: { adjusted: false, reason: "fixed-control" as const }, P3: { adjusted: false, reason: "fixed-control" as const } },
    };
    const result = await dxfExporter.export(input, { countryCode: "GB", projectMetadata: baseMetadata });
    expect(result.layers).toContain("SURV-BOUNDARY");
    expect(result.layers).toContain("SURV-POINT");
    expect(result.layers).not.toContain("BOUNDARY");
    expect(result.layers).not.toContain("BEACON");
  });
});

describe("dxfExporter — topographic", () => {
  it("produces a DXF with TIN edges + contours + spot heights", async () => {
    const input = kenyaTopoOutput();
    const result = await dxfExporter.export(input, { countryCode: "KE", projectMetadata: baseMetadata });
    expect(result.surveyType).toBe("topographic");
    expect(result.layers).toContain("TIN-EDGES");
    expect(result.layers).toContain("CONTOURS");
    expect(result.layers).toContain("SPOT-HEIGHTS");
  });
});

describe("dxfExporter — country fallback warning", () => {
  it("warns when country has no documented DXF layer-naming convention", async () => {
    const input = await kenyaCadastralOutput();
    const result = await dxfExporter.export(input, { countryCode: "AU", projectMetadata: baseMetadata });
    expect(result.warnings.some((w) => w.includes("no documented DXF layer-naming"))).toBe(true);
    expect(result.layers).toContain("BOUNDARY");
  });
  it("does NOT warn for KE or GB", async () => {
    const input = await kenyaCadastralOutput();
    const result = await dxfExporter.export(input, { countryCode: "KE", projectMetadata: baseMetadata });
    expect(result.warnings.filter((w) => w.includes("DXF layer-naming"))).toHaveLength(0);
  });
});

describe("dxfExporter — per-beacon uncertainty in label", () => {
  it("appends ±Nmm to beacon label when uncertainty present", async () => {
    const input = await kenyaCadastralOutput();
    const result = await dxfExporter.export(input, { countryCode: "KE", projectMetadata: baseMetadata });
    const dxf = decodeDxf(result.bytes);
    expect(dxf).toMatch(/B3 \(±\d+mm\)/);
    expect(dxf).toContain("B1 (fixed)");
  });
});

describe("dxfExporter — validation failures", () => {
  it("missing project metadata → validate() fails", async () => {
    const input = await kenyaCadastralOutput();
    const options: DxfOptions = { countryCode: "KE" };
    const validation = dxfExporter.validate(input, options);
    expect(validation.ok).toBe(false);
    await expect(dxfExporter.export(input, options)).rejects.toThrow(/validation failed/);
  });
  it("unknown country code → validate() fails", async () => {
    const input = await kenyaCadastralOutput();
    const validation = dxfExporter.validate(input, { countryCode: "XX", projectMetadata: baseMetadata });
    expect(validation.ok).toBe(false);
  });
  it("unknown survey type → validate() fails", () => {
    const synthetic = { someOtherField: "not a survey" } as unknown as Parameters<typeof dxfExporter.export>[0];
    const validation = dxfExporter.validate(synthetic, { countryCode: "KE", projectMetadata: baseMetadata });
    expect(validation.ok).toBe(false);
  });
});

describe("dxfExporter — registry + layer specs", () => {
  it("includes the dxfExporter in the registry", () => {
    const formats = INTEGRATION_EXPORTERS.map((e) => e.format);
    expect(formats).toContain("dxf");
  });
  it("getCountryDxfLayerSpecs returns Kenya vs UK vs generic correctly", () => {
    const ke = getCountryDxfLayerSpecs("KE", "cadastral");
    expect(ke.some((s) => s.name === "BOUNDARY" && s.category === "boundary")).toBe(true);
    const gb = getCountryDxfLayerSpecs("GB", "cadastral");
    expect(gb.some((s) => s.name === "SURV-BOUNDARY" && s.category === "boundary")).toBe(true);
    const au = getCountryDxfLayerSpecs("AU", "cadastral");
    expect(au.some((s) => s.name === "BOUNDARY")).toBe(true);
  });
});

describe("dxfExporter — engineering", () => {
  it("produces a DXF with section centerlines + volume summary", async () => {
    const vertices: TopoPoint[] = [
      { id: "V0", easting: 0, northing: 0, elevation: 100 },
      { id: "V1", easting: 10, northing: 0, elevation: 100 },
      { id: "V2", easting: 20, northing: 0, elevation: 100 },
      { id: "V3", easting: 0, northing: 10, elevation: 100 },
      { id: "V4", easting: 10, northing: 10, elevation: 100 },
      { id: "V5", easting: 20, northing: 10, elevation: 100 },
    ];
    const tin: TIN = { vertices, triangles: [[0,1,4],[0,4,3],[1,2,5],[1,5,4]] };
    const input = runEngineeringWorkflow({
      existingGround: tin, design: { type: "plane", plane: { a: 0, b: 0, c: 99 } },
      alignment: { points: [{ chainage: 0, easting: 5, northing: 5 }, { chainage: 10, easting: 15, northing: 5 }] },
      sectionSpacing: 5, sectionWidth: 10, sectionSampleInterval: 2, country: KENYA,
    });
    const result = await dxfExporter.export(input, { countryCode: "KE", projectMetadata: baseMetadata });
    expect(result.surveyType).toBe("engineering");
    const dxf = decodeDxf(result.bytes);
    expect(dxf).toContain("ENGINEERING SURVEY");
    expect(dxf).toContain("CUT VOLUME");
    expect(dxf).toContain("FILL VOLUME");
  });
});
