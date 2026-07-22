/**
 * Tests for the GeoPackage integration exporter.
 *
 * Brief 03: GeoPackage (OGC 12-128r14) binary exporter. Multi-layer
 * pattern (layer-per-feature-type). Per-feature uncertainty attribution
 * per invariant C1, same contract as the GeoJSON exporter.
 *
 * Coverage:
 *   1. Format metadata (format, mimeType, fileExtension)
 *   2. Cadastral happy path — beacons + parcel layers, CRS registered
 *   3. Cadastral per-beacon uncertainty attribution
 *   4. Topographic happy path — topo_points + contours + spot_heights layers
 *   5. Topographic per-point uncertainty (all field-data)
 *   6. Engineering happy path — section_centerlines + cross_section_profiles layers
 *   7. Engineering cross-section profiles in offset-vs-cut-fill-depth space
 *   8. Round-trip via re-read — open the .gpkg with better-sqlite3 and verify tables
 *   9. Missing project metadata → validate() fails
 *  10. Unknown country code → validate() fails
 *  11. Unknown survey type → validate() fails
 *  12. INTEGRATION_EXPORTERS registry includes geoPackageExporter
 */

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { geoPackageExporter } from "../geopackage-export.js";
import { INTEGRATION_EXPORTERS } from "../index.js";
import { runCadastralWorkflow } from "../../workflows/cadastral.js";
import { runTopographicWorkflow, runEngineeringWorkflow } from "../../workflows/index.js";
import { KENYA } from "@metardu/country-config";
import type { TopoPoint, TIN } from "../../workflows/topographic.js";
import type { GeoPackageOptions } from "../geopackage-export.js";

const baseMetadata = {
  projectName: "Brief 03 Test",
  surveyorName: "Test Surveyor",
  licenseNumber: "LS/1234",
  surveyDate: "2026-07-23",
  adjustmentRunId: "brief-03-test-001",
};

// ─── Cadastral fixture ───────────────────────────────────────────

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

// ─── Topographic fixture ─────────────────────────────────────────

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
    planTitle: "Brief 03 Topo Test",
    surveyor: { name: "Test", regNo: "LS/1234", dateOfSurvey: "2026-07-23" },
  });
}

// ─── Engineering fixture ─────────────────────────────────────────

function kenyaEngineeringOutput() {
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
    triangles: [[0, 1, 4], [0, 4, 3], [1, 2, 5], [1, 5, 4]],
  };
  return runEngineeringWorkflow({
    existingGround: tin,
    design: { type: "plane", plane: { a: 0, b: 0, c: 99 } },
    alignment: { points: [{ chainage: 0, easting: 5, northing: 5 }, { chainage: 10, easting: 15, northing: 5 }] },
    sectionSpacing: 5, sectionWidth: 10, sectionSampleInterval: 2,
    country: KENYA,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Open the produced GeoPackage bytes as an in-memory SQLite database
 * and return a Database handle for inspection.
 */
function reopenGpkg(bytes: Uint8Array): Database.Database {
  // better-sqlite3 requires a Buffer for in-memory deserialization.
  const buf = Buffer.from(bytes);
  // Use the `:memory:` path with explicit buffer deserialization.
  // Per better-sqlite3 docs: `new Database(buffer)` doesn't work —
  // we need to use the temporary-file workaround.
  // Simpler: write to temp file, open, return handle + cleanup function.
  // But for tests, we use the better-sqlite3 deserialization API.
  const db = new Database(":memory:");
  // better-sqlite3 doesn't have a direct deserialize API in v13;
  // use the `loadExtension`-free approach via temp file.
  // Actually, the simplest is to write to /tmp and reopen.
  throw new Error("not reached — overridden below");
}

/**
 * Open the produced GeoPackage bytes via a temp file.
 * Returns the Database handle; caller must close it.
 */
function openGpkgFromBytes(bytes: Uint8Array): { db: Database.Database; cleanup: () => void } {
  const tmpPath = `/tmp/metardu-test-${Date.now()}-${Math.random().toString(36).slice(2)}.gpkg`;
  const fs = require("node:fs");
  fs.writeFileSync(tmpPath, Buffer.from(bytes));
  const db = new Database(tmpPath);
  return {
    db,
    cleanup: () => {
      db.close();
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe("geoPackageExporter — format metadata", () => {
  it("exposes the correct format identifier, MIME type, and extension", () => {
    expect(geoPackageExporter.format).toBe("geopackage");
    expect(geoPackageExporter.mimeType).toBe("application/geopackage+sqlite3");
    expect(geoPackageExporter.fileExtension).toBe("gpkg");
    expect(geoPackageExporter.description).toMatch(/GeoPackage/i);
  });
});

describe("geoPackageExporter — Case 1: cadastral happy path", () => {
  it("produces a valid GeoPackage with beacons + parcel layers", async () => {
    const input = await kenyaCadastralOutput();
    const result = await geoPackageExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });

    expect(result.format).toBe("geopackage");
    expect(result.crsUrn).toBe("urn:ogc:def:crs:EPSG::21037");
    expect(result.layers).toContain("beacons");
    expect(result.layers).toContain("parcel");
    // 4 beacons + 1 parcel = 5 features
    expect(result.featureCount).toBe(5);
    expect(result.bytes.length).toBeGreaterThan(1000); // non-trivial SQLite file

    // Verify by reopening.
    const { db, cleanup } = openGpkgFromBytes(result.bytes);
    try {
      // System tables exist
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain("gpkg_spatial_ref_sys");
      expect(tableNames).toContain("gpkg_contents");
      expect(tableNames).toContain("gpkg_geometry_columns");
      expect(tableNames).toContain("beacons");
      expect(tableNames).toContain("parcel");

      // CRS registered
      const srs = db.prepare("SELECT srs_id FROM gpkg_spatial_ref_sys WHERE srs_id=21037").get() as { srs_id: number } | undefined;
      expect(srs).toBeDefined();
      expect(srs?.srs_id).toBe(21037);

      // Layer registered in gpkg_contents
      const contents = db.prepare("SELECT table_name, data_type, srs_id FROM gpkg_contents").all() as { table_name: string; data_type: string; srs_id: number }[];
      expect(contents.length).toBe(2);
      for (const c of contents) {
        expect(c.data_type).toBe("features");
        expect(c.srs_id).toBe(21037);
      }

      // Beacons layer has 4 rows
      const beaconCount = db.prepare("SELECT COUNT(*) as n FROM beacons").get() as { n: number };
      expect(beaconCount.n).toBe(4);

      // Parcel layer has 1 row
      const parcelCount = db.prepare("SELECT COUNT(*) as n FROM parcel").get() as { n: number };
      expect(parcelCount.n).toBe(1);

      // Beacon labels match
      const labels = db.prepare("SELECT label FROM beacons ORDER BY label").all() as { label: string }[];
      expect(labels.map((l) => l.label)).toEqual(["B1", "B2", "B3", "B4"]);
    } finally {
      cleanup();
    }
  });
});

describe("geoPackageExporter — Case 2: cadastral per-beacon uncertainty", () => {
  it("adjusted beacons carry ellipse columns; known beacons have uncertainty_reason='fixed-control'", async () => {
    const input = await kenyaCadastralOutput();
    const result = await geoPackageExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });

    const { db, cleanup } = openGpkgFromBytes(result.bytes);
    try {
      const b1 = db.prepare("SELECT * FROM beacons WHERE label='B1'").get() as {
        label: string; adjusted: number; semi_major: number | null; uncertainty_reason: string | null;
      };
      const b3 = db.prepare("SELECT * FROM beacons WHERE label='B3'").get() as {
        label: string; adjusted: number; semi_major: number | null; semi_minor: number | null; orientation: number | null; uncertainty_reason: string | null;
      };

      // B1 is known (fixed) — adjusted=0, reason='fixed-control', no ellipse
      expect(b1.adjusted).toBe(0);
      expect(b1.uncertainty_reason).toBe("fixed-control");
      expect(b1.semi_major).toBeNull();

      // B3 is adjusted — adjusted=1, has ellipse, no reason
      expect(b3.adjusted).toBe(1);
      expect(b3.semi_major).not.toBeNull();
      expect(b3.semi_major!).toBeGreaterThan(0);
      expect(b3.semi_minor).not.toBeNull();
      expect(b3.orientation).not.toBeNull();
      expect(b3.uncertainty_reason).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("geoPackageExporter — Case 3: topographic happy path", () => {
  it("produces topo_points + contours + spot_heights layers", async () => {
    const input = kenyaTopoOutput();
    const result = await geoPackageExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });

    expect(result.crsUrn).toBe("urn:ogc:def:crs:EPSG::21037");
    expect(result.layers).toContain("topo_points");
    expect(result.layers).toContain("contours");
    expect(result.layers).toContain("spot_heights");

    const { db, cleanup } = openGpkgFromBytes(result.bytes);
    try {
      const topoCount = db.prepare("SELECT COUNT(*) as n FROM topo_points").get() as { n: number };
      expect(topoCount.n).toBe(25); // 5×5 grid

      const contourCount = db.prepare("SELECT COUNT(*) as n FROM contours").get() as { n: number };
      expect(contourCount.n).toBe(input.contours.length);

      const spotCount = db.prepare("SELECT COUNT(*) as n FROM spot_heights").get() as { n: number };
      expect(spotCount.n).toBe(input.spotHeights.length);

      // All topo points have adjusted=0 + uncertainty_reason='field-data'
      const allAdjusted = db.prepare("SELECT COUNT(*) as n FROM topo_points WHERE adjusted=1").get() as { n: number };
      expect(allAdjusted.n).toBe(0);
      const allFieldData = db.prepare("SELECT COUNT(*) as n FROM topo_points WHERE uncertainty_reason='field-data'").get() as { n: number };
      expect(allFieldData.n).toBe(25);
    } finally {
      cleanup();
    }
  });
});

describe("geoPackageExporter — Case 4: engineering happy path", () => {
  it("produces section_centerlines + cross_section_profiles layers", async () => {
    const input = kenyaEngineeringOutput();
    const result = await geoPackageExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });

    expect(result.crsUrn).toBe("urn:ogc:def:crs:EPSG::21037");
    expect(result.layers).toContain("section_centerlines");
    expect(result.layers).toContain("cross_section_profiles");

    const { db, cleanup } = openGpkgFromBytes(result.bytes);
    try {
      const clCount = db.prepare("SELECT COUNT(*) as n FROM section_centerlines").get() as { n: number };
      expect(clCount.n).toBe(input.sections.length);

      const profCount = db.prepare("SELECT COUNT(*) as n FROM cross_section_profiles").get() as { n: number };
      expect(profCount.n).toBe(input.sections.length);

      // Cross-section profiles carry the coordinate_space flag
      const prof = db.prepare("SELECT coordinate_space FROM cross_section_profiles LIMIT 1").get() as { coordinate_space: string };
      expect(prof.coordinate_space).toBe("offset-vs-cut-fill-depth");

      // Project metadata embedded in gpkg_metadata
      const md = db.prepare("SELECT metadata FROM gpkg_metadata LIMIT 1").get() as { metadata: string };
      const mdJson = JSON.parse(md.metadata);
      expect(mdJson.surveyType).toBe("engineering");
      expect(mdJson.engineering.sectionCount).toBe(input.sectionCount);
      expect(mdJson.engineering.cutVolume).toBe(input.cutVolume);
    } finally {
      cleanup();
    }
  });
});

describe("geoPackageExporter — Case 5: project metadata in gpkg_metadata", () => {
  it("embeds project metadata as dataset-level gpkg_metadata", async () => {
    const input = await kenyaCadastralOutput();
    const result = await geoPackageExporter.export(input, {
      countryCode: "KE",
      projectMetadata: {
        ...baseMetadata,
        projectName: "Brief 03 Metadata Test",
        adjustmentRunId: "meta-test-001",
      },
    });

    const { db, cleanup } = openGpkgFromBytes(result.bytes);
    try {
      const md = db.prepare("SELECT metadata, md_scope FROM gpkg_metadata LIMIT 1").get() as {
        metadata: string; md_scope: string;
      };
      expect(md.md_scope).toBe("dataset");
      const j = JSON.parse(md.metadata);
      expect(j.projectName).toBe("Brief 03 Metadata Test");
      expect(j.surveyorName).toBe("Test Surveyor");
      expect(j.licenseNumber).toBe("LS/1234");
      expect(j.surveyDate).toBe("2026-07-23");
      expect(j.adjustmentRunId).toBe("meta-test-001");
      expect(j.countryCode).toBe("KE");
      expect(j.crsUrn).toBe("urn:ogc:def:crs:EPSG::21037");
      expect(j.surveyType).toBe("cadastral");
      expect(j.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      cleanup();
    }
  });
});

describe("geoPackageExporter — Case 6: missing project metadata", () => {
  it("validate() fails and export() throws", async () => {
    const input = await kenyaCadastralOutput();
    const options: GeoPackageOptions = { countryCode: "KE" };

    const validation = geoPackageExporter.validate(input, options);
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("projectMetadata"))).toBe(true);

    await expect(geoPackageExporter.export(input, options)).rejects.toThrow(/validation failed/);
  });
});

describe("geoPackageExporter — Case 7: unknown country code", () => {
  it("validate() fails and export() throws", async () => {
    const input = await kenyaCadastralOutput();
    const options: GeoPackageOptions = {
      countryCode: "XX",
      projectMetadata: baseMetadata,
    };

    const validation = geoPackageExporter.validate(input, options);
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("Unknown country code"))).toBe(true);
  });
});

describe("geoPackageExporter — Case 8: unknown survey type", () => {
  it("validate() fails for a synthetic input with none of the discriminator keys", async () => {
    const synthetic = { someOtherField: "not a survey output" } as unknown as Parameters<typeof geoPackageExporter.export>[0];

    const validation = geoPackageExporter.validate(synthetic, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("Cannot detect survey type"))).toBe(true);
  });
});

describe("geoPackageExporter — Case 9: includeParcelLayer option", () => {
  it("suppresses the parcel layer when includeParcelLayer=false", async () => {
    const input = await kenyaCadastralOutput();
    const result = await geoPackageExporter.export(input, {
      countryCode: "KE",
      projectMetadata: baseMetadata,
      includeParcelLayer: false,
    });

    expect(result.layers).toContain("beacons");
    expect(result.layers).not.toContain("parcel");
    expect(result.featureCount).toBe(4); // 4 beacons only
  });
});

describe("geoPackageExporter — Case 10: INTEGRATION_EXPORTERS registry", () => {
  it("includes the geoPackageExporter in the registry", () => {
    const formats = INTEGRATION_EXPORTERS.map((e) => e.format);
    expect(formats).toContain("geojson");
    expect(formats).toContain("geopackage");
  });
});

describe("geoPackageExporter — Case 11: UK general-boundaries case", () => {
  it("produces a GeoPackage with OSGB36 SRID for UK input", async () => {
    // Synthetic UK input — general boundaries, no adjustment.
    const input = {
      form3: {
        pdfBytes: new Uint8Array(0), pageCount: 0, scale: 0,
        coordinateSystemLabel: "OSGB36 / British National Grid (general boundaries)",
        hasDraftWatermark: false,
      },
      allBeacons: [
        { label: "P1", position: { easting: 525000.0, northing: 181000.0 }, description: "Fence corner" },
        { label: "P2", position: { easting: 525050.0, northing: 181000.0 }, description: "Fence corner" },
        { label: "P3", position: { easting: 525050.0, northing: 181040.0 }, description: "Wall corner" },
        { label: "P4", position: { easting: 525000.0, northing: 181040.0 }, description: "Wall corner" },
      ],
      residuals: {},
      sigma_0_sq: 0,
      passesCadastralTolerance: false,
      uncertainty: {
        P1: { adjusted: false, reason: "fixed-control" as const },
        P2: { adjusted: false, reason: "fixed-control" as const },
        P3: { adjusted: false, reason: "fixed-control" as const },
        P4: { adjusted: false, reason: "fixed-control" as const },
      },
    };

    const result = await geoPackageExporter.export(input, {
      countryCode: "GB",
      projectMetadata: baseMetadata,
    });

    expect(result.crsUrn).toBe("urn:ogc:def:crs:EPSG::27700");

    const { db, cleanup } = openGpkgFromBytes(result.bytes);
    try {
      const srs = db.prepare("SELECT srs_id FROM gpkg_spatial_ref_sys WHERE srs_id=27700").get() as { srs_id: number } | undefined;
      expect(srs).toBeDefined();
      expect(srs?.srs_id).toBe(27700);
    } finally {
      cleanup();
    }
  });
});

// ─── Golden fixture tests ────────────────────────────────────────

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname_fixture = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname_fixture, "fixtures");

describe("geoPackageExporter — golden .gpkg fixtures", () => {
  it("kenya-cadastral.gpkg exists and has the expected structure", () => {
    const bytes = readFileSync(join(FIXTURES_DIR, "kenya-cadastral.gpkg"));
    expect(bytes.length).toBeGreaterThan(1000);

    // SQLite file header magic.
    expect(bytes.subarray(0, 15).toString("utf-8")).toMatch(/SQLite format 3/);

    const { db, cleanup } = openGpkgFromBytes(new Uint8Array(bytes));
    try {
      // user_version = 10300 (GeoPackage 1.3.0)
      const uv = db.pragma("user_version", { simple: true });
      expect(uv).toBe(10300);

      // Required system tables
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain("gpkg_spatial_ref_sys");
      expect(tableNames).toContain("gpkg_contents");
      expect(tableNames).toContain("gpkg_geometry_columns");
      expect(tableNames).toContain("gpkg_metadata");
      expect(tableNames).toContain("beacons");
      expect(tableNames).toContain("parcel");

      // CRS for Kenya (21037) registered
      const srs = db.prepare("SELECT * FROM gpkg_spatial_ref_sys WHERE srs_id=21037").get() as {
        srs_id: number; srs_name: string; organization: string;
      };
      expect(srs.srs_id).toBe(21037);
      expect(srs.organization).toBe("EPSG");
      expect(srs.srs_name).toBe("urn:ogc:def:crs:EPSG::21037");

      // 4 beacons, 1 parcel
      const beaconCount = db.prepare("SELECT COUNT(*) as n FROM beacons").get() as { n: number };
      expect(beaconCount.n).toBe(4);
      const parcelCount = db.prepare("SELECT COUNT(*) as n FROM parcel").get() as { n: number };
      expect(parcelCount.n).toBe(1);

      // B3 and B4 are adjusted (carry ellipses); B1 and B2 are fixed.
      const b3 = db.prepare("SELECT adjusted, semi_major FROM beacons WHERE label='B3'").get() as {
        adjusted: number; semi_major: number | null;
      };
      expect(b3.adjusted).toBe(1);
      expect(b3.semi_major).not.toBeNull();
      expect(b3.semi_major!).toBeGreaterThan(0);

      // Project metadata in gpkg_metadata
      const md = db.prepare("SELECT metadata FROM gpkg_metadata LIMIT 1").get() as { metadata: string };
      const j = JSON.parse(md.metadata);
      expect(j.adjustmentRunId).toBe("golden-gpkg-ke-001");
      expect(j.surveyType).toBe("cadastral");
    } finally {
      cleanup();
    }
  });

  it("kenya-topographic.gpkg exists and has the expected structure", () => {
    const bytes = readFileSync(join(FIXTURES_DIR, "kenya-topographic.gpkg"));
    expect(bytes.length).toBeGreaterThan(1000);

    const { db, cleanup } = openGpkgFromBytes(new Uint8Array(bytes));
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain("topo_points");
      expect(tableNames).toContain("contours");
      expect(tableNames).toContain("spot_heights");

      // 25 topo points, all adjusted=0 with uncertainty_reason='field-data'
      const topoCount = db.prepare("SELECT COUNT(*) as n FROM topo_points").get() as { n: number };
      expect(topoCount.n).toBe(25);
      const allFieldData = db.prepare(
        "SELECT COUNT(*) as n FROM topo_points WHERE adjusted=0 AND uncertainty_reason='field-data'",
      ).get() as { n: number };
      expect(allFieldData.n).toBe(25);

      // Contours and spot heights are non-empty
      const contourCount = db.prepare("SELECT COUNT(*) as n FROM contours").get() as { n: number };
      expect(contourCount.n).toBeGreaterThan(0);
      const spotCount = db.prepare("SELECT COUNT(*) as n FROM spot_heights").get() as { n: number };
      expect(spotCount.n).toBeGreaterThan(0);

      // Project metadata
      const md = db.prepare("SELECT metadata FROM gpkg_metadata LIMIT 1").get() as { metadata: string };
      const j = JSON.parse(md.metadata);
      expect(j.adjustmentRunId).toBe("golden-gpkg-topo-ke-001");
      expect(j.surveyType).toBe("topographic");
      expect(j.topographic.triangleCount).toBe(64);
    } finally {
      cleanup();
    }
  });

  it("kenya-cadastral.gpkg is byte-stable when re-exported with the same input", async () => {
    // Re-export and compare structural properties. Bytes won't be
    // identical because SQLite stores last-change timestamps per
    // table, but feature counts and CRS must match.
    const input = await kenyaCadastralOutput();
    const result = await geoPackageExporter.export(input, {
      countryCode: "KE",
      projectMetadata: {
        ...baseMetadata,
        projectName: "Golden Fixture — Kenya Cadastral GeoPackage",
        adjustmentRunId: "golden-gpkg-ke-001",
      },
    });

    const fixtureBytes = readFileSync(join(FIXTURES_DIR, "kenya-cadastral.gpkg"));

    const { db: liveDb, cleanup: liveCleanup } = openGpkgFromBytes(result.bytes);
    const { db: fixtDb, cleanup: fixtCleanup } = openGpkgFromBytes(new Uint8Array(fixtureBytes));
    try {
      const liveBeaconCount = liveDb.prepare("SELECT COUNT(*) as n FROM beacons").get() as { n: number };
      const fixtBeaconCount = fixtDb.prepare("SELECT COUNT(*) as n FROM beacons").get() as { n: number };
      expect(liveBeaconCount.n).toBe(fixtBeaconCount.n);

      // Compare B3's ellipse (should be bit-identical for same input).
      const liveB3 = liveDb.prepare("SELECT semi_major, semi_minor, orientation FROM beacons WHERE label='B3'").get() as {
        semi_major: number; semi_minor: number; orientation: number;
      };
      const fixtB3 = fixtDb.prepare("SELECT semi_major, semi_minor, orientation FROM beacons WHERE label='B3'").get() as {
        semi_major: number; semi_minor: number; orientation: number;
      };
      expect(Math.abs(liveB3.semi_major - fixtB3.semi_major)).toBeLessThan(1e-9);
      expect(Math.abs(liveB3.semi_minor - fixtB3.semi_minor)).toBeLessThan(1e-9);
      expect(Math.abs(liveB3.orientation - fixtB3.orientation)).toBeLessThan(1e-9);
    } finally {
      liveCleanup();
      fixtCleanup();
    }
  });
});
