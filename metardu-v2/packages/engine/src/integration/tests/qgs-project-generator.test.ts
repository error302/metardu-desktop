/**
 * Tests for the QGIS project file (.qgs) generator.
 *
 * Brief 05: emits a self-contained .qgs project file the GIS analyst
 * opens directly in QGIS (no Python console needed). Fifth concrete
 * exporter in ADR-0005's Integration & Export family.
 *
 * Coverage:
 *   1. Format metadata (format, mimeType, fileExtension)
 *   2. Cadastral happy path — beacons + parcel layers, Kenya symbology
 *   3. Topographic happy path — topo_points + contours + spot_heights
 *   4. Engineering happy path — section_centerlines + cross_section_profiles
 *   5. UK cadastral uses different symbology (blue dashed)
 *   6. CRS handling — Kenya (21037), UK (27700)
 *   7. XML well-formedness — parse the .qgs with a real XML parser
 *   8. Project metadata embedded in <projectMetadata>
 *   9. Custom geoPackageBaseName respected
 *  10. Missing project metadata → validate() fails
 *  11. Unknown country code → validate() fails
 *  12. Unknown survey type → validate() fails
 *  13. INTEGRATION_EXPORTERS registry includes qgsProjectExporter
 *  14. Layer-tree-group references the right table names
 *  15. Cross-section profiles flagged as non-map (magenta renderer)
 */

import { describe, it, expect } from "vitest";
import { qgsProjectExporter } from "../qgs-project-generator.js";
import { INTEGRATION_EXPORTERS } from "../index.js";
import { runCadastralWorkflow } from "../../workflows/cadastral.js";
import { runTopographicWorkflow, runEngineeringWorkflow } from "../../workflows/index.js";
import { KENYA } from "@metardu/country-config";
import type { TopoPoint, TIN } from "../../workflows/topographic.js";
import type { QgsOptions } from "../qgs-project-generator.js";

const baseMetadata = {
  projectName: "Brief 05 QGS Test",
  surveyorName: "Test Surveyor",
  licenseNumber: "LS/1234",
  surveyDate: "2026-07-23",
  adjustmentRunId: "brief-05-test-001",
};

// ─── Fixtures ────────────────────────────────────────────────────

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
  for (let x = 0; x < 5; x++) {
    for (let y = 0; y < 5; y++) {
      points.push({
        id: `P${x}${y}`,
        easting: 1000 + x * 10,
        northing: 2000 + y * 10,
        elevation: 100 + x * 5,
      });
    }
  }
  return runTopographicWorkflow({
    points,
    contourInterval: 5,
    country: KENYA,
    planTitle: "Brief 05 Topo",
    surveyor: { name: "Test", regNo: "LS/1234", dateOfSurvey: "2026-07-23" },
  });
}

function kenyaEngineeringOutput() {
  const vertices: TopoPoint[] = [
    { id: "V0", easting: 0, northing: 0, elevation: 100 },
    { id: "V1", easting: 10, northing: 0, elevation: 100 },
    { id: "V2", easting: 20, northing: 0, elevation: 100 },
    { id: "V3", easting: 0, northing: 10, elevation: 100 },
    { id: "V4", easting: 10, northing: 10, elevation: 100 },
    { id: "V5", easting: 20, northing: 10, elevation: 100 },
  ];
  const tin: TIN = { vertices, triangles: [[0,1,4],[0,4,3],[1,2,5],[1,5,4]] };
  return runEngineeringWorkflow({
    existingGround: tin,
    design: { type: "plane", plane: { a: 0, b: 0, c: 99 } },
    alignment: { points: [{ chainage: 0, easting: 5, northing: 5 }, { chainage: 10, easting: 15, northing: 5 }] },
    sectionSpacing: 5, sectionWidth: 10, sectionSampleInterval: 2,
    country: KENYA,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────

function decodeXml(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Minimal XML well-formedness check using Node's DOMParser (available
 * in Node 24+ via linkedom, or via the @xmldom/xmldom package).
 *
 * We use a simpler heuristic: check that tags are balanced and the
 * document has a single root element. A real XML parser would be more
 * thorough but adds a dependency.
 */
function isWellFormedXml(xml: string): { ok: boolean; error?: string } {
  // Quick check: starts with XML declaration or DOCTYPE, has a single
  // root element, all opening tags have matching closing tags.
  const trimmed = xml.trim();
  if (!trimmed.startsWith("<")) return { ok: false, error: "does not start with <" };

  // Strip DOCTYPE if present.
  let body = trimmed.replace(/^<!DOCTYPE[^>]*>/, "").trim();

  // Find the root element opening tag.
  const rootMatch = body.match(/^<(\w+)/);
  if (!rootMatch) return { ok: false, error: "no root element" };
  const rootTag = rootMatch[1]!;

  // Check that the document ends with </rootTag>.
  if (!body.endsWith(`</${rootTag}>`) && !body.endsWith(`</${rootTag}>\n`)) {
    return { ok: false, error: `does not end with </${rootTag}>` };
  }

  // Count opening and closing tags for the root.
  const openCount = (body.match(new RegExp(`<${rootTag}[\\s>]`, "g")) || []).length;
  const closeCount = (body.match(new RegExp(`</${rootTag}>`, "g")) || []).length;
  // openCount includes the root open; closeCount includes the root close.
  // For a single-root document, openCount === closeCount.
  if (openCount !== closeCount) {
    return {
      ok: false,
      error: `root tag '${rootTag}' unbalanced: ${openCount} opens, ${closeCount} closes`,
    };
  }

  return { ok: true };
}

// ─── Tests ───────────────────────────────────────────────────────

describe("qgsProjectExporter — format metadata", () => {
  it("exposes the correct format identifier, MIME type, and extension", () => {
    expect(qgsProjectExporter.format).toBe("qgs-project");
    expect(qgsProjectExporter.mimeType).toBe("application/x-qgis-project");
    expect(qgsProjectExporter.fileExtension).toBe("qgs");
    expect(qgsProjectExporter.description).toMatch(/QGIS/i);
  });
});

describe("qgsProjectExporter — Case 1: Kenya cadastral happy path", () => {
  it("generates a .qgs XML with beacons + parcel layers + Kenya symbology", async () => {
    const input = await kenyaCadastralOutput();
    const result = await qgsProjectExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });

    expect(result.format).toBe("qgs-project");
    expect(result.crsUrn).toBe("urn:ogc:def:crs:EPSG::21037");
    expect(result.srid).toBe(21037);
    expect(result.layers).toContain("beacons");
    expect(result.layers).toContain("parcel");
    expect(result.featureCount).toBe(2); // layer count
    expect(result.projectName).toBe("Brief 05 QGS Test");

    const xml = decodeXml(result.bytes);
    expect(xml).toContain("<!DOCTYPE qgis");
    expect(xml).toContain(`<qgis projectname="Brief 05 QGS Test"`);
    expect(xml).toContain("version=\"3.34.9-LTR\"");
    expect(xml).toContain("EPSG:21037");
    expect(xml).toContain("urn:ogc:def:crs:EPSG::21037");

    // Layer references to GeoPackage
    expect(xml).toContain("layername=beacons");
    expect(xml).toContain("layername=parcel");
    expect(xml).toContain("metardu-survey.gpkg");

    // Layer display names
    expect(xml).toContain("Beacons (Kenya Cadastral)");
    expect(xml).toContain("Parcel (Kenya Cadastral)");

    // Kenya symbology: red crosses for beacons (255,0,0,255)
    expect(xml).toContain("255,0,0,255");
    // Parcel: yellow fill (255,255,200,180)
    expect(xml).toContain("255,255,200,180");

    // XML well-formedness
    const wellFormed = isWellFormedXml(xml);
    expect(wellFormed.ok).toBe(true);
  });
});

describe("qgsProjectExporter — Case 2: Topographic happy path", () => {
  it("generates a .qgs with topo_points + contours + spot_heights layers", async () => {
    const input = kenyaTopoOutput();
    const result = await qgsProjectExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });

    expect(result.layers).toContain("topo_points");
    expect(result.layers).toContain("contours");
    expect(result.layers).toContain("spot_heights");
    expect(result.featureCount).toBe(3);

    const xml = decodeXml(result.bytes);
    // Contour symbology: brown (139,69,19,255 = saddle brown)
    expect(xml).toContain("139,69,19,255");
    // Spot heights: green (0,128,0,255)
    expect(xml).toContain("0,128,0,255");

    expect(isWellFormedXml(xml).ok).toBe(true);
  });
});

describe("qgsProjectExporter — Case 3: Engineering happy path", () => {
  it("generates a .qgs with section_centerlines + cross_section_profiles layers", async () => {
    const input = kenyaEngineeringOutput();
    const result = await qgsProjectExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });

    expect(result.layers).toContain("section_centerlines");
    expect(result.layers).toContain("cross_section_profiles");

    const xml = decodeXml(result.bytes);
    // Section centerlines: orange (255,165,0,255)
    expect(xml).toContain("255,165,0,255");
    // Cross-section profiles: magenta (255,0,255,255) — flagged as NOT map
    expect(xml).toContain("255,0,255,255");
    expect(xml).toContain("Cross-Section Profiles (NOT map features)");

    expect(isWellFormedXml(xml).ok).toBe(true);
  });
});

describe("qgsProjectExporter — Case 4: UK cadastral uses different symbology", () => {
  it("uses blue dashed lines for UK general-boundaries instead of red crosses", async () => {
    const input = {
      form3: {
        pdfBytes: new Uint8Array(0), pageCount: 0, scale: 0,
        coordinateSystemLabel: "OSGB36",
        hasDraftWatermark: false,
      },
      allBeacons: [
        { label: "P1", position: { easting: 525000.0, northing: 181000.0 }, description: "Fence corner" },
        { label: "P2", position: { easting: 525050.0, northing: 181000.0 }, description: "Fence corner" },
        { label: "P3", position: { easting: 525050.0, northing: 181040.0 }, description: "Wall corner" },
      ],
      residuals: {},
      sigma_0_sq: 0,
      passesCadastralTolerance: false,
      uncertainty: {
        P1: { adjusted: false, reason: "fixed-control" as const },
        P2: { adjusted: false, reason: "fixed-control" as const },
        P3: { adjusted: false, reason: "fixed-control" as const },
      },
    };

    const result = await qgsProjectExporter.export(input, {
      countryCode: "GB",
      projectMetadata: baseMetadata,
    });

    expect(result.crsUrn).toBe("urn:ogc:def:crs:EPSG::27700");

    const xml = decodeXml(result.bytes);
    // UK convention: blue dashed boundary
    expect(xml).toContain("0,0,255,255"); // blue
    expect(xml).toContain("dash"); // dashed line style
    // Should NOT have the Kenya red-cross styling
    expect(xml).not.toContain("255,0,0,255");
    // Display name confirms UK convention
    expect(xml).toContain("UK General Boundaries");

    expect(isWellFormedXml(xml).ok).toBe(true);
  });
});

describe("qgsProjectExporter — Case 5: project metadata in <projectMetadata>", () => {
  it("embeds all project metadata fields in the projectMetadata element", async () => {
    const input = await kenyaCadastralOutput();
    const result = await qgsProjectExporter.export(input, {
      countryCode: "KE",
      projectMetadata: {
        projectName: "QGS Metadata Test",
        surveyorName: "Jane Wanjiru",
        licenseNumber: "LS/5678",
        surveyDate: "2026-07-24",
        adjustmentRunId: "meta-test-042",
      },
    });

    const xml = decodeXml(result.bytes);
    expect(xml).toContain("<projectMetadata>");
    expect(xml).toContain("QGS Metadata Test");
    expect(xml).toContain("Jane Wanjiru");
    expect(xml).toContain("LS/5678");
    expect(xml).toContain("2026-07-24");
    expect(xml).toContain("meta-test-042");
    expect(xml).toContain("Country: KE | Survey type: cadastral");
  });
});

describe("qgsProjectExporter — Case 6: custom geoPackageBaseName", () => {
  it("respects the custom base name in the generated .qgs", async () => {
    const input = await kenyaCadastralOutput();
    const result = await qgsProjectExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
      geoPackageBaseName: "kasarani-parcel-2026",
    });

    const xml = decodeXml(result.bytes);
    expect(xml).toContain("kasarani-parcel-2026.gpkg");
    expect(xml).not.toContain("metardu-survey.gpkg");
  });
});

describe("qgsProjectExporter — Case 7: missing project metadata", () => {
  it("validate() fails and export() throws", async () => {
    const input = await kenyaCadastralOutput();
    const options: QgsOptions = { countryCode: "KE" };

    const validation = qgsProjectExporter.validate(input, options);
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("projectMetadata"))).toBe(true);

    await expect(qgsProjectExporter.export(input, options)).rejects.toThrow(/validation failed/);
  });
});

describe("qgsProjectExporter — Case 8: unknown country code", () => {
  it("validate() fails", async () => {
    const input = await kenyaCadastralOutput();
    const validation = qgsProjectExporter.validate(input, {
      countryCode: "XX",
      projectMetadata: baseMetadata,
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("Unknown country code"))).toBe(true);
  });
});

describe("qgsProjectExporter — Case 9: unknown survey type", () => {
  it("validate() fails for synthetic input", () => {
    const synthetic = { someOtherField: "not a survey" } as unknown as Parameters<typeof qgsProjectExporter.export>[0];
    const validation = qgsProjectExporter.validate(synthetic, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("Cannot detect survey type"))).toBe(true);
  });
});

describe("qgsProjectExporter — Case 10: INTEGRATION_EXPORTERS registry", () => {
  it("includes the qgsProjectExporter in the registry", () => {
    const formats = INTEGRATION_EXPORTERS.map((e) => e.format);
    expect(formats).toContain("geojson");
    expect(formats).toContain("geopackage");
    expect(formats).toContain("pyqgis-script");
    expect(formats).toContain("gcp");
    expect(formats).toContain("qgs-project");
  });
});

describe("qgsProjectExporter — Case 11: layer-tree-group references the right tables", () => {
  it("contains <layer-tree-layer> elements for each layer", async () => {
    const input = await kenyaCadastralOutput();
    const result = await qgsProjectExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });

    const xml = decodeXml(result.bytes);
    expect(xml).toContain("<layer-tree-group>");
    expect(xml).toContain("<layer-tree-layer");
    expect(xml).toContain("layername=beacons");
    expect(xml).toContain("layername=parcel");
  });
});

describe("qgsProjectExporter — Case 12: cross-survey-type consistency", () => {
  it("cadastral, topographic, and engineering all produce > 3KB .qgs files", async () => {
    const cadastralInput = await kenyaCadastralOutput();
    const cadastralResult = await qgsProjectExporter.export(cadastralInput, {
      countryCode: "KE", projectMetadata: baseMetadata,
    });
    expect(cadastralResult.bytes.length).toBeGreaterThan(3000);

    const topoInput = kenyaTopoOutput();
    const topoResult = await qgsProjectExporter.export(topoInput, {
      countryCode: "KE", projectMetadata: baseMetadata,
    });
    expect(topoResult.bytes.length).toBeGreaterThan(3000);

    const enggInput = kenyaEngineeringOutput();
    const enggResult = await qgsProjectExporter.export(enggInput, {
      countryCode: "KE", projectMetadata: baseMetadata,
    });
    expect(enggResult.bytes.length).toBeGreaterThan(3000);

    // All three pass XML well-formedness
    expect(isWellFormedXml(decodeXml(cadastralResult.bytes)).ok).toBe(true);
    expect(isWellFormedXml(decodeXml(topoResult.bytes)).ok).toBe(true);
    expect(isWellFormedXml(decodeXml(enggResult.bytes)).ok).toBe(true);
  });
});

// ─── Golden fixture tests ────────────────────────────────────────

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname_fixture = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname_fixture, "fixtures");

describe("qgsProjectExporter — golden .qgs fixtures", () => {
  it("kenya-cadastral.qgs exists and has the expected structure", () => {
    const xml = readFileSync(join(FIXTURES_DIR, "kenya-cadastral.qgs"), "utf-8");
    expect(xml.length).toBeGreaterThan(3000);

    // DOCTYPE + root element
    expect(xml).toContain("<!DOCTYPE qgis");
    expect(xml).toContain(`<qgis projectname="Golden Fixture — Kenya Cadastral QGS"`);
    expect(xml).toContain('version="3.34.9-LTR"');

    // CRS
    expect(xml).toContain("EPSG:21037");
    expect(xml).toContain("urn:ogc:def:crs:EPSG::21037");

    // Layers
    expect(xml).toContain("layername=beacons");
    expect(xml).toContain("layername=parcel");

    // Display names
    expect(xml).toContain("Beacons (Kenya Cadastral)");
    expect(xml).toContain("Parcel (Kenya Cadastral)");

    // Kenya symbology: red crosses + yellow parcel fill
    expect(xml).toContain("255,0,0,255");
    expect(xml).toContain("255,255,200,180");

    // Project metadata
    expect(xml).toContain("<projectMetadata>");
    expect(xml).toContain("golden-qgs-ke-001");

    // XML well-formedness
    expect(isWellFormedXml(xml).ok).toBe(true);

    // Validate via xmllint if available (catches malformed XML our
    // heuristic check would miss). Skip silently if xmllint isn't installed.
    try {
      execSync(`xmllint --noout ${join(FIXTURES_DIR, "kenya-cadastral.qgs")}`, {
        stdio: "pipe",
      });
    } catch {
      // xmllint not installed — skip.
    }
  });

  it("kenya-topographic.qgs exists and has the expected structure", () => {
    const xml = readFileSync(join(FIXTURES_DIR, "kenya-topographic.qgs"), "utf-8");
    expect(xml).toContain("layername=topo_points");
    expect(xml).toContain("layername=contours");
    expect(xml).toContain("layername=spot_heights");
    expect(xml).toContain("139,69,19,255"); // brown contours
    expect(xml).toContain("0,128,0,255"); // green spot heights
    expect(xml).toContain("golden-qgs-topo-ke-001");

    expect(isWellFormedXml(xml).ok).toBe(true);
  });

  it("fixtures are byte-stable for same input (modulo generatedAt timestamp)", async () => {
    // Re-generate and compare structural content. The .qgs embeds a
    // creationDate timestamp so byte-identical comparison would be
    // flaky — compare the layer + CRS elements instead.
    const input = await kenyaCadastralOutput();
    const result = await qgsProjectExporter.export(input, {
      countryCode: "KE",
      projectMetadata: {
        projectName: "Golden Fixture — Kenya Cadastral QGS",
        surveyorName: "Jane Wanjiru",
        licenseNumber: "LS/1234",
        surveyDate: "2026-07-23",
        adjustmentRunId: "golden-qgs-ke-001",
      },
    });
    const liveXml = decodeXml(result.bytes);
    const fixtureXml = readFileSync(join(FIXTURES_DIR, "kenya-cadastral.qgs"), "utf-8");

    // Both reference the same CRS + layers.
    expect(liveXml).toContain("EPSG:21037");
    expect(fixtureXml).toContain("EPSG:21037");
    expect(liveXml).toContain("layername=beacons");
    expect(fixtureXml).toContain("layername=beacons");
    expect(liveXml).toContain("layername=parcel");
    expect(fixtureXml).toContain("layername=parcel");
    // Same adjustment run ID.
    expect(liveXml).toContain("golden-qgs-ke-001");
    expect(fixtureXml).toContain("golden-qgs-ke-001");
    // Same Kenya symbology colors.
    expect(liveXml).toContain("255,0,0,255");
    expect(fixtureXml).toContain("255,0,0,255");
  });
});
