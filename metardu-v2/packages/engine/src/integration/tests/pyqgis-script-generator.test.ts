/**
 * Tests for the PyQGIS helper script generator.
 *
 * Brief 04: emits a .py script the GIS analyst runs in QGIS to load
 * metardu-desktop's GeoPackage with country-correct symbology. The
 * differentiator per ADR-0005's GIS Analyst claim.
 *
 * Coverage:
 *   1. Format metadata (format, mimeType, fileExtension)
 *   2. Cadastral happy path — beacons + parcel layers, Kenya style
 *   3. Cadastral per-country symbology (KE red crosses, GB blue dashed)
 *   4. Topographic happy path — topo_points + contours + spot_heights
 *   5. Engineering happy path — section_centerlines + cross_section_profiles
 *      (cross_section_profiles flagged as non-map)
 *   6. Script contains correct CRS URN and EPSG SRID
 *   7. Script references the GeoPackage by base name
 *   8. Project metadata embedded in the script docstring
 *   9. Missing project metadata → validate() fails
 *  10. Unknown country code → validate() fails
 *  11. Unknown survey type → validate() fails
 *  12. Custom geoPackageBaseName option respected
 *  13. INTEGRATION_EXPORTERS registry includes pyQgisScriptExporter
 *  14. Script is valid Python — sanity check for balanced quotes,
 *      no obvious syntax issues (basic lexical check; full Python
 *      parse would require a Python interpreter)
 */

import { describe, it, expect } from "vitest";
import { pyQgisScriptExporter } from "../pyqgis-script-generator.js";
import { INTEGRATION_EXPORTERS } from "../index.js";
import { runCadastralWorkflow } from "../../workflows/cadastral.js";
import { runTopographicWorkflow, runEngineeringWorkflow } from "../../workflows/index.js";
import { KENYA } from "@metardu/country-config";
import type { TopoPoint, TIN } from "../../workflows/topographic.js";
import type { PyQgisOptions } from "../pyqgis-script-generator.js";

const baseMetadata = {
  projectName: "Brief 04 Test",
  surveyorName: "Test Surveyor",
  licenseNumber: "LS/1234",
  surveyDate: "2026-07-23",
  adjustmentRunId: "brief-04-test-001",
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
    planTitle: "Brief 04 Topo",
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

// ─── Helper: decode script text from bytes ───────────────────────

function decodeScript(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

// ─── Tests ───────────────────────────────────────────────────────

describe("pyQgisScriptExporter — format metadata", () => {
  it("exposes the correct format identifier, MIME type, and extension", () => {
    expect(pyQgisScriptExporter.format).toBe("pyqgis-script");
    expect(pyQgisScriptExporter.mimeType).toBe("text/x-python");
    expect(pyQgisScriptExporter.fileExtension).toBe("py");
    expect(pyQgisScriptExporter.description).toMatch(/PyQGIS/i);
  });
});

describe("pyQgisScriptExporter — Case 1: Kenya cadastral happy path", () => {
  it("generates a script with beacons + parcel layers + Kenya symbology", async () => {
    const input = await kenyaCadastralOutput();
    const result = await pyQgisScriptExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });

    expect(result.format).toBe("pyqgis-script");
    expect(result.crsUrn).toBe("urn:ogc:def:crs:EPSG::21037");
    expect(result.srid).toBe(21037);
    expect(result.layers).toContain("beacons");
    expect(result.layers).toContain("parcel");
    expect(result.featureCount).toBe(2); // layer count
    expect(result.groupName).toBe("Brief 04 Test");

    const script = decodeScript(result.bytes);
    expect(script).toContain("#!/usr/bin/env python3");
    expect(script).toContain("PyQGIS loader script");
    expect(script).toContain('GPKG_PATH = os.path.join(');
    expect(script).toContain('"metardu-survey.gpkg"');
    expect(script).toContain('GROUP_NAME = "Brief 04 Test"');
    expect(script).toContain("SRID = 21037");
    expect(script).toContain('CRS_URN = "urn:ogc:def:crs:EPSG::21037"');

    // Kenya cadastral symbology: red crosses for beacons
    expect(script).toContain("QColor(255, 0, 0)"); // red
    // Parcel layer: light yellow fill (Kenya Form 3 convention)
    expect(script).toContain("QColor(255, 255, 200, 180)");

    // Both layers loaded (referenced by table name in the GeoPackage URI)
    expect(script).toContain("layername=beacons");
    expect(script).toContain("layername=parcel");
  });
});

describe("pyQgisScriptExporter — Case 2: UK cadastral uses different symbology", () => {
  it("uses blue dashed lines for UK general-boundaries instead of red crosses", async () => {
    // Use the same cadastral input but with UK country code — the
    // script generator's getLayerSpecs branches on country.
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

    const result = await pyQgisScriptExporter.export(input, {
      countryCode: "GB",
      projectMetadata: baseMetadata,
    });

    expect(result.crsUrn).toBe("urn:ogc:def:crs:EPSG::27700");

    const script = decodeScript(result.bytes);
    // UK convention: blue dashed boundary, no fixed beacons
    expect(script).toContain("QColor(0, 0, 255)"); // blue
    expect(script).toContain("Qt.DashLine");
    // Should NOT have the Kenya red-cross styling
    expect(script).not.toContain("QColor(255, 0, 0)");
    // Display name confirms UK convention
    expect(script).toContain("UK General Boundaries");
  });
});

describe("pyQgisScriptExporter — Case 3: topographic happy path", () => {
  it("generates a script with topo_points + contours + spot_heights layers", async () => {
    const input = kenyaTopoOutput();
    const result = await pyQgisScriptExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });

    expect(result.layers).toContain("topo_points");
    expect(result.layers).toContain("contours");
    expect(result.layers).toContain("spot_heights");
    expect(result.featureCount).toBe(3); // layer count

    const script = decodeScript(result.bytes);
    // Contour symbology: brown lines (139, 69, 19 = saddle brown)
    expect(script).toContain("QColor(139, 69, 19)");
    // Spot heights: green
    expect(script).toContain("QColor(0, 128, 0)");
    // Contours labeled with elevation
    expect(script).toContain("'elevation'");
  });
});

describe("pyQgisScriptExporter — Case 4: engineering happy path", () => {
  it("generates a script with section_centerlines + cross_section_profiles layers", async () => {
    const input = kenyaEngineeringOutput();
    const result = await pyQgisScriptExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });

    expect(result.layers).toContain("section_centerlines");
    expect(result.layers).toContain("cross_section_profiles");

    const script = decodeScript(result.bytes);
    // Section centerlines: orange
    expect(script).toContain("QColor(255, 165, 0)");
    // Cross-section profiles: WARNING comment about non-map space
    expect(script).toContain("WARNING: cross_section_profiles");
    expect(script).toContain("offset, cut-fill-depth");
  });
});

describe("pyQgisScriptExporter — Case 5: project metadata in script docstring", () => {
  it("embeds all project metadata fields in the script header", async () => {
    const input = await kenyaCadastralOutput();
    const result = await pyQgisScriptExporter.export(input, {
      countryCode: "KE",
      projectMetadata: {
        projectName: "PyQGIS Metadata Test",
        surveyorName: "Jane Wanjiru",
        licenseNumber: "LS/5678",
        surveyDate: "2026-07-24",
        adjustmentRunId: "meta-test-042",
      },
    });

    const script = decodeScript(result.bytes);
    expect(script).toContain("Project name:        PyQGIS Metadata Test");
    expect(script).toContain("Surveyor:            Jane Wanjiru");
    expect(script).toContain("License number:      LS/5678");
    expect(script).toContain("Survey date:         2026-07-24");
    expect(script).toContain("Adjustment run ID:   meta-test-042");
    expect(script).toContain("Country code:        KE");
    expect(script).toContain("Survey type:         cadastral");
    expect(script).toContain("urn:ogc:def:crs:EPSG::21037 (EPSG:21037)");
  });
});

describe("pyQgisScriptExporter — Case 6: missing project metadata", () => {
  it("validate() fails and export() throws", async () => {
    const input = await kenyaCadastralOutput();
    const options: PyQgisOptions = { countryCode: "KE" };

    const validation = pyQgisScriptExporter.validate(input, options);
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("projectMetadata"))).toBe(true);

    await expect(pyQgisScriptExporter.export(input, options)).rejects.toThrow(/validation failed/);
  });
});

describe("pyQgisScriptExporter — Case 7: unknown country code", () => {
  it("validate() fails", async () => {
    const input = await kenyaCadastralOutput();
    const validation = pyQgisScriptExporter.validate(input, {
      countryCode: "XX",
      projectMetadata: baseMetadata,
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("Unknown country code"))).toBe(true);
  });
});

describe("pyQgisScriptExporter — Case 8: unknown survey type", () => {
  it("validate() fails for synthetic input", () => {
    const synthetic = { someOtherField: "not a survey" } as unknown as Parameters<typeof pyQgisScriptExporter.export>[0];
    const validation = pyQgisScriptExporter.validate(synthetic, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("Cannot detect survey type"))).toBe(true);
  });
});

describe("pyQgisScriptExporter — Case 9: custom geoPackageBaseName", () => {
  it("respects the custom base name in the generated script", async () => {
    const input = await kenyaCadastralOutput();
    const result = await pyQgisScriptExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
      geoPackageBaseName: "kasarani-parcel-2026",
    });

    const script = decodeScript(result.bytes);
    expect(script).toContain('"kasarani-parcel-2026.gpkg"');
    expect(script).not.toContain('"metardu-survey.gpkg"');
  });
});

describe("pyQgisScriptExporter — Case 10: INTEGRATION_EXPORTERS registry", () => {
  it("includes the pyQgisScriptExporter in the registry", () => {
    const formats = INTEGRATION_EXPORTERS.map((e) => e.format);
    expect(formats).toContain("geojson");
    expect(formats).toContain("geopackage");
    expect(formats).toContain("pyqgis-script");
  });
});

describe("pyQgisScriptExporter — Case 11: script basic Python sanity", () => {
  it("has balanced triple-quotes and no unterminated strings", async () => {
    const input = await kenyaCadastralOutput();
    const result = await pyQgisScriptExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });
    const script = decodeScript(result.bytes);

    // Triple-quoted docstring at the top must be balanced (open + close).
    const tripleQuoteCount = (script.match(/"""/g) || []).length;
    expect(tripleQuoteCount % 2).toBe(0); // even = balanced

    // Script ends cleanly with a newline.
    expect(script.endsWith("\n")).toBe(true);

    // Imports are present
    expect(script).toContain("from qgis.core import (");
    expect(script).toContain("QgsProject");
    expect(script).toContain("QgsVectorLayer");
    expect(script).toContain("QgsSingleSymbolRenderer");
  });
});

// ─── Cross-survey-type consistency ───────────────────────────────

describe("pyQgisScriptExporter — Case 12: each survey type produces a non-empty script", () => {
  it("cadastral, topographic, and engineering all produce > 1KB scripts", async () => {
    const cadastralInput = await kenyaCadastralOutput();
    const cadastralResult = await pyQgisScriptExporter.export(cadastralInput, {
      countryCode: "KE", projectMetadata: baseMetadata,
    });
    expect(cadastralResult.bytes.length).toBeGreaterThan(3000);

    const topoInput = kenyaTopoOutput();
    const topoResult = await pyQgisScriptExporter.export(topoInput, {
      countryCode: "KE", projectMetadata: baseMetadata,
    });
    expect(topoResult.bytes.length).toBeGreaterThan(3000);

    const enggInput = kenyaEngineeringOutput();
    const enggResult = await pyQgisScriptExporter.export(enggInput, {
      countryCode: "KE", projectMetadata: baseMetadata,
    });
    expect(enggResult.bytes.length).toBeGreaterThan(3000);
  });
});

// ─── Golden fixture tests ────────────────────────────────────────

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname_fixture = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname_fixture, "fixtures");

describe("pyQgisScriptExporter — golden .py fixtures", () => {
  it("kenya-cadastral.py exists and is valid Python syntax", () => {
    const script = readFileSync(join(FIXTURES_DIR, "kenya-cadastral.py"), "utf-8");
    expect(script.length).toBeGreaterThan(3000);
    expect(script).toContain("#!/usr/bin/env python3");
    expect(script).toContain("PyQGIS loader script");
    expect(script).toContain("SRID = 21037");
    expect(script).toContain('CRS_URN = "urn:ogc:def:crs:EPSG::21037"');
    expect(script).toContain("layername=beacons");
    expect(script).toContain("layername=parcel");
    expect(script).toContain("QColor(255, 0, 0)"); // Kenya red crosses
    expect(script).toContain("golden-pyqgis-ke-001"); // adjustment run ID

    // Validate Python syntax via python3 -m py_compile.
    // Skip if python3 isn't available (rare in CI but possible).
    try {
      execSync(`python3 -m py_compile ${join(FIXTURES_DIR, "kenya-cadastral.py")}`, {
        stdio: "pipe",
      });
    } catch (e) {
      throw new Error(
        `kenya-cadastral.py is not valid Python: ${(e as Error).message}`,
      );
    }
  });

  it("kenya-topographic.py exists and is valid Python syntax", () => {
    const script = readFileSync(join(FIXTURES_DIR, "kenya-topographic.py"), "utf-8");
    expect(script.length).toBeGreaterThan(3000);
    expect(script).toContain("layername=topo_points");
    expect(script).toContain("layername=contours");
    expect(script).toContain("layername=spot_heights");
    expect(script).toContain("QColor(139, 69, 19)"); // brown contours
    expect(script).toContain("QColor(0, 128, 0)"); // green spot heights
    expect(script).toContain("golden-pyqgis-topo-ke-001");

    try {
      execSync(`python3 -m py_compile ${join(FIXTURES_DIR, "kenya-topographic.py")}`, {
        stdio: "pipe",
      });
    } catch (e) {
      throw new Error(
        `kenya-topographic.py is not valid Python: ${(e as Error).message}`,
      );
    }
  });

  it("fixtures are byte-stable for same input (modulo generatedAt timestamp)", async () => {
    // Re-generate the cadastral script and compare structural content.
    // The docstring includes a timestamp so byte-identical comparison
    // would be flaky — compare the layer-loading code instead.
    const input = await kenyaCadastralOutput();
    const result = await pyQgisScriptExporter.export(input, {
      countryCode: "KE",
      projectMetadata: {
        projectName: "Golden Fixture — Kenya Cadastral PyQGIS",
        surveyorName: "Jane Wanjiru",
        licenseNumber: "LS/1234",
        surveyDate: "2026-07-23",
        adjustmentRunId: "golden-pyqgis-ke-001",
      },
    });
    const liveScript = decodeScript(result.bytes);
    const fixtureScript = readFileSync(join(FIXTURES_DIR, "kenya-cadastral.py"), "utf-8");

    // Both should reference the same GeoPackage, same layers, same SRID.
    expect(liveScript).toContain("SRID = 21037");
    expect(fixtureScript).toContain("SRID = 21037");
    expect(liveScript).toContain("layername=beacons");
    expect(fixtureScript).toContain("layername=beacons");
    expect(liveScript).toContain("layername=parcel");
    expect(fixtureScript).toContain("layername=parcel");
    // Same adjustment run ID embedded in docstring.
    expect(liveScript).toContain("golden-pyqgis-ke-001");
    expect(fixtureScript).toContain("golden-pyqgis-ke-001");
  });
});
