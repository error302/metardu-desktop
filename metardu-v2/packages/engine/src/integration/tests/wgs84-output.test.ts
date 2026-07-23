/**
 * Tests for outputWgs84 option in GeoJSON, GeoPackage, QGS exporters.
 * Verifies that when outputWgs84=true + projectToWgs84 callback is
 * provided, coordinates are reprojected to WGS84 and CRS changes to 4326.
 */

import { describe, it, expect } from "vitest";
import { geoJsonExporter } from "../geojson-export.js";
import { geoPackageExporter } from "../geopackage-export.js";
import { qgsProjectExporter } from "../qgs-project-generator.js";
import { runCadastralWorkflow } from "../../workflows/cadastral.js";

const baseMetadata = {
  projectName: "WGS84 Output Test",
  surveyorName: "Test Surveyor",
  licenseNumber: "LS/1234",
  surveyDate: "2026-07-23",
  adjustmentRunId: "wgs84-test-001",
};

// Mock callback — simulates sidecar's geodesy.utm_inverse
const mockCallback = async (_e: number, _n: number, _srid: number) => {
  return { lat: -1.22, lon: 36.90 };
};

async function kenyaCadastral() {
  return await runCadastralWorkflow({
    knownBeacons: [
      { label: "B1", position: { easting: 257100.0, northing: 9857700.0 }, description: "P" },
      { label: "B2", position: { easting: 257150.0, northing: 9857700.0 }, description: "P" },
    ],
    observations: [
      { fromLabel: "B1", toLabel: "B3", distanceM: 50.0, sigmaM: 0.005 },
      { fromLabel: "B2", toLabel: "B3", distanceM: 50.0, sigmaM: 0.005 },
      { fromLabel: "B1", toLabel: "B4", distanceM: 70.71, sigmaM: 0.005 },
      { fromLabel: "B2", toLabel: "B4", distanceM: 50.0, sigmaM: 0.005 },
      { fromLabel: "B3", toLabel: "B4", distanceM: 50.0, sigmaM: 0.005 },
    ],
    parcel: { surveyNumber: "S/1", district: "N", location: "K", areaHa: 0.25 },
    surveyor: { name: "T", iskRegNo: "LS/1234", dateOfSurvey: "2026-07-23" },
    srid: 21037,
  });
}

describe("GeoJSON — outputWgs84", () => {
  it("reprojects coordinates to WGS84 when callback provided", async () => {
    const input = await kenyaCadastral();
    const result = await geoJsonExporter.export(input, {
      countryCode: "KE", projectMetadata: baseMetadata,
      outputWgs84: true, projectToWgs84: mockCallback,
    });
    expect(result.crsUrn).toBe("urn:ogc:def:crs:EPSG::4326");

    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));
    expect(parsed.crs.properties.name).toBe("urn:ogc:def:crs:EPSG::4326");
    // Coordinates should be [lon, lat] = [36.90, -1.22], not [easting, northing]
    const b1 = parsed.features.find((f: { id: string }) => f.id === "beacon-B1");
    expect(b1.geometry.coordinates[0]).toBeCloseTo(36.90, 5); // lon
    expect(b1.geometry.coordinates[1]).toBeCloseTo(-1.22, 5); // lat
  });

  it("emits warning when outputWgs84=true but no callback", async () => {
    const input = await kenyaCadastral();
    const result = await geoJsonExporter.export(input, {
      countryCode: "KE", projectMetadata: baseMetadata,
      outputWgs84: true, // no callback
    });
    expect(result.warnings.some((w) => w.includes("no projectToWgs84 callback"))).toBe(true);
    // Falls back to native CRS
    expect(result.crsUrn).toBe("urn:ogc:def:crs:EPSG::21037");
  });

  it("uses native CRS when outputWgs84 not set (default)", async () => {
    const input = await kenyaCadastral();
    const result = await geoJsonExporter.export(input, {
      countryCode: "KE", projectMetadata: baseMetadata,
      // no outputWgs84
    });
    expect(result.crsUrn).toBe("urn:ogc:def:crs:EPSG::21037");
  });
});

describe("GeoPackage — outputWgs84", () => {
  it("registers EPSG:4326 when callback provided", async () => {
    const input = await kenyaCadastral();
    const result = await geoPackageExporter.export(input, {
      countryCode: "KE", projectMetadata: baseMetadata,
      outputWgs84: true, projectToWgs84: mockCallback,
    });
    expect(result.crsUrn).toBe("urn:ogc:def:crs:EPSG::4326");
    expect(result.bytes.length).toBeGreaterThan(1000);
  });

  it("emits warning when outputWgs84=true but no callback", async () => {
    const input = await kenyaCadastral();
    const result = await geoPackageExporter.export(input, {
      countryCode: "KE", projectMetadata: baseMetadata,
      outputWgs84: true,
    });
    expect(result.warnings.some((w) => w.includes("no projectToWgs84 callback"))).toBe(true);
    expect(result.crsUrn).toBe("urn:ogc:def:crs:EPSG::21037");
  });
});

describe("QGS — outputWgs84", () => {
  it("sets project CRS to EPSG:4326 when callback provided", async () => {
    const input = await kenyaCadastral();
    const result = await qgsProjectExporter.export(input, {
      countryCode: "KE", projectMetadata: baseMetadata,
      outputWgs84: true, projectToWgs84: mockCallback,
    });
    expect(result.crsUrn).toBe("urn:ogc:def:crs:EPSG::4326");
    expect(result.srid).toBe(4326);

    const xml = new TextDecoder().decode(result.bytes);
    expect(xml).toContain("EPSG:4326");
    expect(xml).not.toContain("EPSG:21037");
  });

  it("emits warning when outputWgs84=true but no callback", async () => {
    const input = await kenyaCadastral();
    const result = await qgsProjectExporter.export(input, {
      countryCode: "KE", projectMetadata: baseMetadata,
      outputWgs84: true,
    });
    expect(result.warnings.some((w) => w.includes("no projectToWgs84 callback"))).toBe(true);
    expect(result.srid).toBe(21037);
  });
});
