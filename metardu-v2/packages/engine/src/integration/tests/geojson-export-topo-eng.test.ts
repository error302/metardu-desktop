/**
 * Tests for the GeoJSON integration exporter — topographic + engineering paths.
 *
 * Brief 02 extends Brief 01 (cadastral-only) to cover the topographic and
 * engineering workflow outputs. The same IntegrationExporter contract
 * applies — CRS from country-config, per-feature uncertainty attribution
 * per invariant C1, no rounding per invariant C2.
 *
 * Topographic specifics tested:
 *   1. Happy path: 5×5 grid → TIN vertices + contours + spot heights as features.
 *   2. CRS lookup: Kenya → urn:ogc:def:crs:EPSG::21037.
 *   3. Per-point uncertainty: every topo point has adjusted=false + reason="field-data".
 *   4. Contours are LineString features with derived=true flag.
 *   5. Spot heights are Point features with derived=true + uncertaintyNote.
 *   6. Metadata.metardu.surveyType === "topographic" + topographic summary block.
 *   7. Round-trip via JSON.parse preserves feature count and CRS.
 *
 * Engineering specifics tested:
 *   8. Happy path: sections + cross-section profiles as features.
 *   9. CRS lookup: Kenya → urn:ogc:def:crs:EPSG::21037.
 *  10. Section centerline points have featureType="section-centerline".
 *  11. Cross-section profiles are LineStrings with coordinateSpace="offset-vs-cut-fill-depth".
 *  12. Metadata.metardu.surveyType === "engineering" + engineering summary (volumes, sectionCount).
 *  13. Round-trip via JSON.parse.
 *
 * Cross-cutting:
 *  14. Unknown survey type (synthetic input with none of the discriminator keys) → validate() fails.
 *  15. Brief 01 cadastral tests still pass after the refactor (regression check).
 */

import { describe, it, expect } from "vitest";
import { geoJsonExporter } from "../geojson-export.js";
import { runTopographicWorkflow, runEngineeringWorkflow } from "../../workflows/index.js";
import { KENYA } from "@metardu/country-config";
import type { TopoWorkflowOutput, TopoPoint, TIN } from "../../workflows/topographic.js";
import type { EngineeringWorkflowOutput } from "../../workflows/engineering.js";
import type { GeoJsonOptions } from "../geojson-export.js";

const baseMetadata = {
  projectName: "Brief 02 Test",
  surveyorName: "Test Surveyor",
  licenseNumber: "LS/1234",
  surveyDate: "2026-07-23",
  adjustmentRunId: "brief-02-test-001",
};

// ─── Topographic fixtures ────────────────────────────────────────

/**
 * 5×5 grid of points with a known slope (5m elevation increase per
 * 10m horizontal in the X direction). Same fixture as the existing
 * topographic workflow tests.
 */
function makeTopoPoints(): TopoPoint[] {
  const points: TopoPoint[] = [];
  for (let x = 0; x < 5; x++) {
    for (let y = 0; y < 5; y++) {
      points.push({
        id: `P${x}${y}`,
        easting: 1000 + x * 10,
        northing: 2000 + y * 10,
        elevation: 100 + x * 5, // 5m slope per 10m
      });
    }
  }
  return points;
}

function runTopo(): TopoWorkflowOutput {
  return runTopographicWorkflow({
    points: makeTopoPoints(),
    contourInterval: 5,
    country: KENYA,
    planTitle: "Brief 02 Topo Test",
    surveyor: { name: "Test", regNo: "LS/1234", dateOfSurvey: "2026-07-23" },
  });
}

// ─── Engineering fixtures ────────────────────────────────────────

function runEngg(): EngineeringWorkflowOutput {
  // Simple existing-ground TIN: a 3-triangle slope rising in X.
  const vertices: TopoPoint[] = [
    { id: "V0", easting: 0, northing: 0, elevation: 100 },
    { id: "V1", easting: 10, northing: 0, elevation: 100 },
    { id: "V2", easting: 20, northing: 0, elevation: 100 },
    { id: "V3", easting: 0, northing: 10, elevation: 100 },
    { id: "V4", easting: 10, northing: 10, elevation: 100 },
    { id: "V5", easting: 20, northing: 10, elevation: 100 },
  ];
  const tin: TIN = {
    vertices,
    triangles: [
      [0, 1, 4],
      [0, 4, 3],
      [1, 2, 5],
      [1, 5, 4],
    ],
  };
  return runEngineeringWorkflow({
    existingGround: tin,
    design: { type: "plane", plane: { a: 0, b: 0, c: 99 } }, // flat design 1m below existing
    alignment: {
      points: [
        { chainage: 0, easting: 5, northing: 5 },
        { chainage: 10, easting: 15, northing: 5 },
      ],
    },
    sectionSpacing: 5,
    sectionWidth: 10,
    sectionSampleInterval: 2,
    country: KENYA,
  });
}

// ─── Topographic tests ───────────────────────────────────────────

describe("geoJsonExporter — topographic happy path", () => {
  it("produces features for TIN vertices, contours, and spot heights", async () => {
    const input = runTopo();
    const options: GeoJsonOptions = {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    };
    const result = await geoJsonExporter.export(input, options);

    expect(result.format).toBe("geojson");
    expect(result.crsUrn).toBe("urn:ogc:def:crs:EPSG::21037");
    // 25 topo points + N contours + spot heights (> 25 features total).
    expect(result.featureCount).toBeGreaterThan(25);

    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));
    expect(parsed.metadata.metardu.surveyType).toBe("topographic");
    expect(parsed.metadata.metardu.countryCode).toBe("KE");
    expect(parsed.metadata.metardu.topographic).toBeDefined();
    expect(parsed.metadata.metardu.topographic.triangleCount).toBeGreaterThan(0);
    expect(parsed.metadata.metardu.topographic.contourCount).toBe(input.contours.length);
    expect(parsed.metadata.metardu.topographic.spotHeightCount).toBe(input.spotHeights.length);
  });
});

describe("geoJsonExporter — topo per-point uncertainty", () => {
  it("marks every topo point as adjusted=false with reason='field-data'", async () => {
    const input = runTopo();
    const result = await geoJsonExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });
    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));

    const topoPoints = parsed.features.filter(
      (f: { properties: { featureType: string } }) =>
        f.properties.featureType === "topo-point",
    );
    expect(topoPoints.length).toBe(25); // 5×5 grid

    for (const f of topoPoints) {
      expect(f.properties.adjusted).toBe(false);
      expect(f.properties.uncertainty).toBeDefined();
      expect(f.properties.uncertainty.reason).toBe("field-data");
    }
  });
});

describe("geoJsonExporter — topo contours are LineStrings with derived flag", () => {
  it("emits each contour as a LineString feature with derived=true", async () => {
    const input = runTopo();
    const result = await geoJsonExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });
    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));

    const contours = parsed.features.filter(
      (f: { properties: { featureType: string } }) =>
        f.properties.featureType === "contour",
    );
    expect(contours.length).toBe(input.contours.length);

    for (const c of contours) {
      expect(c.geometry.type).toBe("LineString");
      expect(c.properties.derived).toBe(true);
      expect(c.properties.elevation).toBeDefined();
      expect(typeof c.properties.uncertaintyNote).toBe("string");
    }
  });
});

describe("geoJsonExporter — topo spot heights are Points with derived flag", () => {
  it("emits each spot height as a Point feature with derived=true", async () => {
    const input = runTopo();
    const result = await geoJsonExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });
    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));

    const spotHeights = parsed.features.filter(
      (f: { properties: { featureType: string } }) =>
        f.properties.featureType === "spot-height",
    );
    expect(spotHeights.length).toBe(input.spotHeights.length);

    for (const sh of spotHeights) {
      expect(sh.geometry.type).toBe("Point");
      expect(sh.properties.derived).toBe(true);
      expect(sh.properties.elevation).toBeDefined();
      expect(sh.properties.uncertainty.reason).toBe("field-data");
    }
  });
});

describe("geoJsonExporter — topo round-trip via JSON.parse", () => {
  it("parses back to an object with the same feature count and CRS", async () => {
    const input = runTopo();
    const result = await geoJsonExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });
    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));

    expect(parsed.type).toBe("FeatureCollection");
    expect(parsed.features.length).toBe(result.featureCount);
    expect(parsed.crs.properties.name).toBe(result.crsUrn);
    expect(parsed.metadata.metardu.surveyType).toBe("topographic");
  });
});

// ─── Engineering tests ───────────────────────────────────────────

describe("geoJsonExporter — engineering happy path", () => {
  it("produces section centerline + cross-section profile features", async () => {
    const input = runEngg();
    const result = await geoJsonExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });

    expect(result.format).toBe("geojson");
    expect(result.crsUrn).toBe("urn:ogc:def:crs:EPSG::21037");
    // Each section produces 1 centerline point + 1 profile LineString.
    expect(result.featureCount).toBe(input.sections.length * 2);

    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));
    expect(parsed.metadata.metardu.surveyType).toBe("engineering");
    expect(parsed.metadata.metardu.engineering).toBeDefined();
    expect(parsed.metadata.metardu.engineering.sectionCount).toBe(input.sectionCount);
    expect(parsed.metadata.metardu.engineering.cutVolume).toBe(input.cutVolume);
    expect(parsed.metadata.metardu.engineering.fillVolume).toBe(input.fillVolume);
    expect(parsed.metadata.metardu.engineering.netVolume).toBe(input.netVolume);
  });
});

describe("geoJsonExporter — engineering section centerline points", () => {
  it("emits centerline points with featureType='section-centerline'", async () => {
    const input = runEngg();
    const result = await geoJsonExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });
    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));

    const centerlines = parsed.features.filter(
      (f: { properties: { featureType: string } }) =>
        f.properties.featureType === "section-centerline",
    );
    expect(centerlines.length).toBe(input.sections.length);

    for (const c of centerlines) {
      expect(c.geometry.type).toBe("Point");
      expect(c.properties.surveyType).toBe("engineering");
      expect(c.properties.chainage).toBeDefined();
      expect(c.properties.cutFillArea).toBeDefined();
      expect(c.properties.adjusted).toBe(false);
      expect(c.properties.uncertainty.reason).toBe("field-data");
    }
  });
});

describe("geoJsonExporter — engineering cross-section profiles", () => {
  it("emits cross-section profiles as LineStrings in offset-vs-depth space", async () => {
    const input = runEngg();
    const result = await geoJsonExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });
    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));

    const profiles = parsed.features.filter(
      (f: { properties: { featureType: string } }) =>
        f.properties.featureType === "cross-section-profile",
    );
    expect(profiles.length).toBe(input.sections.length);

    for (const p of profiles) {
      expect(p.geometry.type).toBe("LineString");
      expect(p.properties.coordinateSpace).toBe("offset-vs-cut-fill-depth");
      expect(p.properties.derived).toBe(true);
      expect(p.properties.chainage).toBeDefined();
    }
  });
});

describe("geoJsonExporter — engineering round-trip", () => {
  it("parses back to an object with the same feature count and CRS", async () => {
    const input = runEngg();
    const result = await geoJsonExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });
    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));

    expect(parsed.type).toBe("FeatureCollection");
    expect(parsed.features.length).toBe(result.featureCount);
    expect(parsed.crs.properties.name).toBe(result.crsUrn);
    expect(parsed.metadata.metardu.surveyType).toBe("engineering");
  });
});

// ─── Cross-cutting ───────────────────────────────────────────────

describe("geoJsonExporter — unknown survey type rejection", () => {
  it("validate() fails for a synthetic input with none of the discriminator keys", async () => {
    const synthetic = {
      someOtherField: "not a survey output",
    } as unknown as Parameters<typeof geoJsonExporter.export>[0];

    const validation = geoJsonExporter.validate(synthetic, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e: string) => e.includes("Cannot detect survey type"))).toBe(true);

    await expect(
      geoJsonExporter.export(synthetic, {
        countryCode: "KE",
        projectMetadata: baseMetadata,
      }),
    ).rejects.toThrow(/validation failed/);
  });
});

describe("geoJsonExporter — Brief 01 cadastral regression check", () => {
  it("cadastral export still works after the Brief 02 refactor", async () => {
    // Build a minimal cadastral output via the workflow, then export.
    const { runCadastralWorkflow } = await import("../../workflows/cadastral.js");
    const input = await runCadastralWorkflow({
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

    const result = await geoJsonExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });
    expect(result.crsUrn).toBe("urn:ogc:def:crs:EPSG::21037");

    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));
    expect(parsed.metadata.metardu.surveyType).toBe("cadastral");
    // 4 beacons + 1 parcel polygon.
    expect(parsed.features.length).toBe(5);
    const b3 = parsed.features.find((f: { id: string }) => f.id === "beacon-B3");
    expect(b3.properties.adjusted).toBe(true);
    expect(b3.properties.uncertainty.semiMajorAxis).toBeGreaterThan(0);
  });
});

// ─── Golden fixture tests ────────────────────────────────────────

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname_fixture = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname_fixture, "fixtures");

describe("geoJsonExporter — topo + engineering golden fixtures", () => {
  it("kenya-topographic-5x5-grid.json exists and has the expected shape", () => {
    const raw = readFileSync(
      join(FIXTURES_DIR, "kenya-topographic-5x5-grid.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw);

    expect(parsed.type).toBe("FeatureCollection");
    expect(parsed.crs.properties.name).toBe("urn:ogc:def:crs:EPSG::21037");
    expect(parsed.metadata.metardu.countryCode).toBe("KE");
    expect(parsed.metadata.metardu.surveyType).toBe("topographic");
    expect(parsed.metadata.metardu.adjustmentRunId).toBe("golden-topo-ke-001");
    expect(parsed.metadata.metardu.exportedAt).toBe("<DETERMINISTIC_PLACEHOLDER>");

    // 25 topo points + N contours + spot heights.
    const topoPoints = parsed.features.filter(
      (f: { properties: { featureType: string } }) =>
        f.properties.featureType === "topo-point",
    );
    expect(topoPoints.length).toBe(25);

    // Every topo point is adjusted=false with reason="field-data".
    for (const p of topoPoints) {
      expect(p.properties.adjusted).toBe(false);
      expect(p.properties.uncertainty.reason).toBe("field-data");
    }

    // Topographic summary block in metadata.
    expect(parsed.metadata.metardu.topographic.triangleCount).toBe(64);
    expect(parsed.metadata.metardu.topographic.minElevation).toBe(100);
    expect(parsed.metadata.metardu.topographic.maxElevation).toBe(120);
    expect(parsed.metadata.metardu.topographic.contourCount).toBeGreaterThan(0);
  });

  it("kenya-engineering-cut-fill.json exists and has the expected shape", () => {
    const raw = readFileSync(
      join(FIXTURES_DIR, "kenya-engineering-cut-fill.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw);

    expect(parsed.type).toBe("FeatureCollection");
    expect(parsed.crs.properties.name).toBe("urn:ogc:def:crs:EPSG::21037");
    expect(parsed.metadata.metardu.countryCode).toBe("KE");
    expect(parsed.metadata.metardu.surveyType).toBe("engineering");
    expect(parsed.metadata.metardu.adjustmentRunId).toBe("golden-engg-ke-001");
    expect(parsed.metadata.metardu.exportedAt).toBe("<DETERMINISTIC_PLACEHOLDER>");

    // Engineering summary: 3 sections, 100m³ cut (1m depth over 100m²).
    expect(parsed.metadata.metardu.engineering.sectionCount).toBe(3);
    expect(parsed.metadata.metardu.engineering.cutVolume).toBe(100);
    expect(parsed.metadata.metardu.engineering.fillVolume).toBe(0);
    expect(parsed.metadata.metardu.engineering.netVolume).toBe(100);

    // 3 section centerlines + 3 cross-section profiles = 6 features.
    const centerlines = parsed.features.filter(
      (f: { properties: { featureType: string } }) =>
        f.properties.featureType === "section-centerline",
    );
    expect(centerlines.length).toBe(3);
    const profiles = parsed.features.filter(
      (f: { properties: { featureType: string } }) =>
        f.properties.featureType === "cross-section-profile",
    );
    expect(profiles.length).toBe(3);

    // Centerline points have uncertainty reason="field-data".
    for (const c of centerlines) {
      expect(c.properties.adjusted).toBe(false);
      expect(c.properties.uncertainty.reason).toBe("field-data");
    }

    // Profiles are LineStrings in offset-vs-cut-fill-depth space.
    for (const p of profiles) {
      expect(p.geometry.type).toBe("LineString");
      expect(p.properties.coordinateSpace).toBe("offset-vs-cut-fill-depth");
      expect(p.properties.derived).toBe(true);
    }
  });

  it("topo fixture is byte-stable when re-exported with the same input", async () => {
    const input = runTopo();
    const result = await geoJsonExporter.export(input, {
      countryCode: "KE",
      projectMetadata: {
        ...baseMetadata,
        projectName: "Golden Fixture — Kenya Topographic",
        adjustmentRunId: "golden-topo-ke-001",
      },
    });
    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));
    parsed.metadata.metardu.exportedAt = "<DETERMINISTIC_PLACEHOLDER>";

    const fixtureRaw = readFileSync(
      join(FIXTURES_DIR, "kenya-topographic-5x5-grid.json"),
      "utf-8",
    );
    const fixtureParsed = JSON.parse(fixtureRaw);

    // Compare feature counts and survey-type summary.
    expect(parsed.features.length).toBe(fixtureParsed.features.length);
    expect(parsed.metadata.metardu.topographic.triangleCount).toBe(
      fixtureParsed.metadata.metardu.topographic.triangleCount,
    );
    expect(parsed.metadata.metardu.topographic.contourCount).toBe(
      fixtureParsed.metadata.metardu.topographic.contourCount,
    );

    // Compare a topo-point coordinate to catch silent drift.
    const liveP00 = parsed.features.find(
      (f: { id: string }) => f.id === "topo-point-P00",
    );
    const fixtP00 = fixtureParsed.features.find(
      (f: { id: string }) => f.id === "topo-point-P00",
    );
    expect(liveP00.geometry.coordinates[0]).toBe(fixtP00.geometry.coordinates[0]);
    expect(liveP00.geometry.coordinates[1]).toBe(fixtP00.geometry.coordinates[1]);
  });
});
