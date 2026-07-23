/**
 * Tests for the GCP (Ground Control Point) file exporter.
 *
 * Brief 06: emits CSVs in Pix4D, Metashape, and Agisoft format for
 * drone photogrammetry tie-in. The Spatial Data Editor (drone side)
 * differentiator per ADR-0005.
 *
 * Coverage:
 *   1. Format metadata (format, mimeType, fileExtension)
 *   2. Pix4D happy path — 8-column CSV with CRS display name
 *   3. Metashape happy path — 7-column CSV with accuracy columns
 *   4. Agisoft format — same as Metashape (different header label)
 *   5. CRS handling — Kenya (21037), UK (27700) SRID lookup
 *   6. Accuracy propagation — uncertainty.semiMajor → accuracyXY;
 *      1.5× accuracyXY → accuracyZ
 *   7. Default accuracy when no uncertainty provided (0.020m + warning)
 *   8. Custom accuracyXY / accuracyZ overrides respected
 *   9. Missing project metadata → validate() fails
 *  10. Unknown country code → validate() fails
 *  11. Unknown GCP format → validate() fails
 *  12. Duplicate GCP labels → validate() fails
 *  13. Empty GCP list → validate() fails
 *  14. INTEGRATION_EXPORTERS registry includes gcpExporter
 *  15. Round-trip: parse the CSV back, verify GCP count + coordinates
 *  16. Pix4D per-GCP uncertainty trailing comment is present
 */

import { describe, it, expect } from "vitest";
import { gcpExporter } from "../gcp-export.js";
import { INTEGRATION_EXPORTERS } from "../index.js";
import type { GcpInput, GcpOptions, GcpPoint } from "../gcp-export.js";

const baseMetadata = {
  projectName: "Brief 06 GCP Test",
  surveyorName: "Test Surveyor",
  licenseNumber: "LS/1234",
  surveyDate: "2026-07-23",
  adjustmentRunId: "brief-06-test-001",
};

// ─── Fixtures ────────────────────────────────────────────────────

/** 4 GCPs around Kasarani, Nairobi (Kenya, SRID 21037). */
function kenyaGcps(): GcpPoint[] {
  return [
    {
      label: "GCP01",
      easting: 257100.0,
      northing: 9857700.0,
      elevation: 1795.0,
      description: "White cross on asphalt",
      uncertainty: {
        adjusted: true,
        semiMajorAxis: 0.012,
        semiMinorAxis: 0.008,
        orientation: 45.3,
        confidenceLevel: 0.95,
      },
    },
    {
      label: "GCP02",
      easting: 257200.0,
      northing: 9857700.0,
      elevation: 1796.0,
      description: "Painted target on concrete",
      uncertainty: {
        adjusted: true,
        semiMajorAxis: 0.015,
        semiMinorAxis: 0.010,
        orientation: 30.0,
        confidenceLevel: 0.95,
      },
    },
    {
      label: "GCP03",
      easting: 257100.0,
      northing: 9857800.0,
      elevation: 1794.0,
      // No uncertainty — should default to 0.020m + warning
      description: "Black square target",
    },
    {
      label: "GCP04",
      easting: 257200.0,
      northing: 9857800.0,
      elevation: 1795.0,
      // Explicit accuracy overrides — no uncertainty object
      accuracyXY: 0.025,
      accuracyZ: 0.040,
      description: "Checkerboard target",
    },
  ];
}

// ─── Helpers ─────────────────────────────────────────────────────

function decodeCsv(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Parse a CSV string into rows (skipping comment lines). */
function parseCsv(csv: string, options: { skipComments?: boolean } = {}): string[][] {
  const { skipComments = true } = options;
  return csv
    .split("\n")
    .filter((line) => line.length > 0)
    .filter((line) => !(skipComments && line.trimStart().startsWith("#")))
    .map((line) =>
      line
        .split(",")
        .map((cell) => cell.trim()),
    );
}

// ─── Tests ───────────────────────────────────────────────────────

describe("gcpExporter — format metadata", () => {
  it("exposes the correct format identifier, MIME type, and extension", () => {
    expect(gcpExporter.format).toBe("gcp");
    expect(gcpExporter.mimeType).toBe("text/csv");
    expect(gcpExporter.fileExtension).toBe("csv");
    expect(gcpExporter.description).toMatch(/GCP/i);
    expect(gcpExporter.description).toMatch(/Pix4D|Metashape|Agisoft/);
  });
});

describe("gcpExporter — Case 1: Pix4D happy path", () => {
  it("produces an 8-column CSV with CRS display name", async () => {
    const input: GcpInput = { points: kenyaGcps() };
    const result = await gcpExporter.export(input, {
      countryCode: "KE",
      format: "pix4d",
      projectMetadata: baseMetadata,
    });

    expect(result.format).toBe("gcp");
    expect(result.gcpFormat).toBe("pix4d");
    expect(result.crsUrn).toBe("urn:ogc:def:crs:EPSG::21037");
    expect(result.pointCount).toBe(4);
    expect(result.featureCount).toBe(4);

    const csv = decodeCsv(result.bytes);
    expect(csv).toContain("# Pix4D Ground Control Points file");
    expect(csv).toContain("urn:ogc:def:crs:EPSG::21037");
    expect(csv).toContain("Arc 1960"); // Kenya datum
    expect(csv).toContain("UTM zone 37S"); // Kenya zone

    // Header row has the 8 expected column names
    const rows = parseCsv(csv);
    const headerRow = rows[0]!;
    expect(headerRow[0]).toBe("GCP Name");
    expect(headerRow[1]).toBe("X (Projected)");
    expect(headerRow[2]).toBe("Y (Projected)");
    expect(headerRow[3]).toBe("Z (Orthometric)");
    expect(headerRow[7]).toBe("Coordinate System");

    // 4 GCP rows + 1 header = 5 data rows
    expect(rows.length).toBe(5);

    // First GCP row (8 columns exactly — uncertainty is on a separate comment line below)
    const gcp01 = rows[1]!;
    expect(gcp01[0]).toBe("GCP01");
    expect(gcp01[1]).toBe("257100.000000");
    expect(gcp01[2]).toBe("9857700.000000");
    expect(gcp01[3]).toBe("1795.000000");
    // Lat/lon/ellH are blank (Pix4D accepts projected-only CRS)
    expect(gcp01[4]).toBe("");
    expect(gcp01[5]).toBe("");
    expect(gcp01[6]).toBe("");
    // Coordinate system column is the CRS display name only — uncertainty
    // is on a separate comment line below (to avoid breaking Pix4D's CSV
    // parser with commas in the comment).
    expect(gcp01[7]).toBe("Arc 1960 / UTM zone 37S");

    // The uncertainty comment is on the line after the GCP row.
    const rawCsv = decodeCsv(result.bytes);
    const gcp01CommentLine = rawCsv.split("GCP01,")[1]!.split("\n")[1];
    expect(gcp01CommentLine).toContain("# acc_xy=");
    expect(gcp01CommentLine).toContain("adjusted=true");
  });
});

describe("gcpExporter — Case 2: Metashape happy path", () => {
  it("produces a 7-column CSV with accuracy columns", async () => {
    const input: GcpInput = { points: kenyaGcps() };
    const result = await gcpExporter.export(input, {
      countryCode: "KE",
      format: "metashape",
      projectMetadata: baseMetadata,
    });

    expect(result.gcpFormat).toBe("metashape");

    const csv = decodeCsv(result.bytes);
    expect(csv).toContain("# Metashape Ground Control Points file");
    expect(csv).toContain("urn:ogc:def:crs:EPSG::21037");

    const rows = parseCsv(csv);
    const headerRow = rows[0]!;
    expect(headerRow[0]).toBe("label");
    expect(headerRow[1]).toBe("x");
    expect(headerRow[2]).toBe("y");
    expect(headerRow[3]).toBe("z");
    expect(headerRow[4]).toBe("accuracy_xy");
    expect(headerRow[5]).toBe("accuracy_z");
    expect(headerRow[6]).toBe("camera_label");

    // GCP01 — uncertainty.semiMajor = 0.012 → accuracy_xy = 0.012
    const gcp01 = rows[1]!;
    expect(gcp01[0]).toBe("GCP01");
    expect(gcp01[4]).toBe("0.012000"); // accuracy_xy = semiMajor
    expect(gcp01[5]).toBe("0.018000"); // accuracy_z = 1.5 × 0.012

    // GCP03 — no uncertainty → default 0.020
    const gcp03 = rows[3]!;
    expect(gcp03[0]).toBe("GCP03");
    expect(gcp03[4]).toBe("0.020000");
    expect(gcp03[5]).toBe("0.030000");

    // GCP04 — explicit accuracyXY=0.025, accuracyZ=0.040 overrides
    const gcp04 = rows[4]!;
    expect(gcp04[0]).toBe("GCP04");
    expect(gcp04[4]).toBe("0.025000");
    expect(gcp04[5]).toBe("0.040000");
  });
});

describe("gcpExporter — Case 3: Agisoft format", () => {
  it("produces the same format as Metashape but with different header label", async () => {
    const input: GcpInput = { points: kenyaGcps() };
    const result = await gcpExporter.export(input, {
      countryCode: "KE",
      format: "agisoft",
      projectMetadata: baseMetadata,
    });

    expect(result.gcpFormat).toBe("agisoft");

    const csv = decodeCsv(result.bytes);
    expect(csv).toContain("# Agisoft PhotoScan / Metashape Ground Control Points file");

    // Same column structure as Metashape
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual([
      "label", "x", "y", "z", "accuracy_xy", "accuracy_z", "camera_label",
    ]);
    expect(rows.length).toBe(5);
  });
});

describe("gcpExporter — Case 4: UK GCPs use OSGB36 CRS", () => {
  it("uses SRID 27700 + OSGB36 datum for UK country code", async () => {
    const input: GcpInput = {
      points: [
        {
          label: "UK-GCP-01",
          easting: 525000.0,
          northing: 181000.0,
          elevation: 50.0,
          accuracyXY: 0.015,
        },
      ],
    };
    const result = await gcpExporter.export(input, {
      countryCode: "GB",
      format: "pix4d",
      projectMetadata: baseMetadata,
    });

    expect(result.crsUrn).toBe("urn:ogc:def:crs:EPSG::27700");

    const csv = decodeCsv(result.bytes);
    expect(csv).toContain("urn:ogc:def:crs:EPSG::27700");
    expect(csv).toContain("OSGB36"); // UK datum
  });
});

describe("gcpExporter — Case 5: accuracy propagation", () => {
  it("uncertainty.semiMajor → accuracyXY; 1.5× accuracyXY → accuracyZ", async () => {
    const input: GcpInput = {
      points: [
        {
          label: "GCP_X",
          easting: 1000.0,
          northing: 2000.0,
          elevation: 100.0,
          uncertainty: {
            adjusted: true,
            semiMajorAxis: 0.025, // 25mm
            semiMinorAxis: 0.015,
            orientation: 0,
            confidenceLevel: 0.95,
          },
        },
      ],
    };
    const result = await gcpExporter.export(input, {
      countryCode: "KE",
      format: "metashape",
      projectMetadata: baseMetadata,
    });

    const csv = decodeCsv(result.bytes);
    const rows = parseCsv(csv);
    const gcp = rows[1]!;
    expect(gcp[4]).toBe("0.025000"); // semiMajor → accuracy_xy
    expect(gcp[5]).toBe("0.037500"); // 1.5 × 0.025 = 0.0375
  });

  it("default 0.020m + warning when no uncertainty or accuracy provided", async () => {
    const input: GcpInput = {
      points: [
        {
          label: "GCP_NO_UNC",
          easting: 1000.0,
          northing: 2000.0,
          elevation: 100.0,
        },
      ],
    };
    const result = await gcpExporter.export(input, {
      countryCode: "KE",
      format: "metashape",
      projectMetadata: baseMetadata,
    });

    expect(result.warnings.some((w) => w.includes("GCP_NO_UNC"))).toBe(true);

    const csv = decodeCsv(result.bytes);
    const rows = parseCsv(csv);
    const gcp = rows[1]!;
    expect(gcp[4]).toBe("0.020000"); // default
    expect(gcp[5]).toBe("0.030000"); // 1.5 × 0.020
  });
});

describe("gcpExporter — Case 6: missing project metadata", () => {
  it("validate() fails and export() throws", async () => {
    const input: GcpInput = { points: kenyaGcps() };
    const options: GcpOptions = { countryCode: "KE", format: "pix4d" };

    const validation = gcpExporter.validate(input, options);
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("projectMetadata"))).toBe(true);

    await expect(gcpExporter.export(input, options)).rejects.toThrow(/validation failed/);
  });
});

describe("gcpExporter — Case 7: unknown country code", () => {
  it("validate() fails", () => {
    const input: GcpInput = { points: kenyaGcps() };
    const validation = gcpExporter.validate(input, {
      countryCode: "XX",
      format: "pix4d",
      projectMetadata: baseMetadata,
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("Unknown country code"))).toBe(true);
  });
});

describe("gcpExporter — Case 8: unknown GCP format", () => {
  it("validate() fails", () => {
    const input: GcpInput = { points: kenyaGcps() };
    const validation = gcpExporter.validate(input, {
      countryCode: "KE",
      format: "droneDeploy" as never, // intentional — cast to bypass TS
      projectMetadata: baseMetadata,
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("Unknown GCP format"))).toBe(true);
  });
});

describe("gcpExporter — Case 9: duplicate GCP labels", () => {
  it("validate() fails on duplicate labels", () => {
    const input: GcpInput = {
      points: [
        { label: "GCP01", easting: 1000, northing: 2000, elevation: 100 },
        { label: "GCP01", easting: 1100, northing: 2100, elevation: 110 },
      ],
    };
    const validation = gcpExporter.validate(input, {
      countryCode: "KE",
      format: "pix4d",
      projectMetadata: baseMetadata,
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("Duplicate GCP label"))).toBe(true);
  });
});

describe("gcpExporter — Case 10: empty GCP list", () => {
  it("validate() fails on empty list", () => {
    const input: GcpInput = { points: [] };
    const validation = gcpExporter.validate(input, {
      countryCode: "KE",
      format: "pix4d",
      projectMetadata: baseMetadata,
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("no GCPs"))).toBe(true);
  });
});

describe("gcpExporter — Case 11: INTEGRATION_EXPORTERS registry", () => {
  it("includes gcpExporter in the registry", () => {
    const formats = INTEGRATION_EXPORTERS.map((e) => e.format);
    expect(formats).toContain("geojson");
    expect(formats).toContain("geopackage");
    expect(formats).toContain("pyqgis-script");
    expect(formats).toContain("gcp");
  });
});

describe("gcpExporter — Case 12: Pix4D per-GCP uncertainty comment on separate line", () => {
  it("includes acc_xy, acc_z, and adjusted/confidence in a comment line below each GCP", async () => {
    const input: GcpInput = { points: kenyaGcps() };
    const result = await gcpExporter.export(input, {
      countryCode: "KE",
      format: "pix4d",
      projectMetadata: baseMetadata,
    });

    const csv = decodeCsv(result.bytes);
    // GCP01 has uncertainty.adjusted=true, confidence=0.95.
    // The comment is on the line AFTER the GCP01 row.
    const gcp01Lines = csv.split("\n");
    const gcp01Idx = gcp01Lines.findIndex((l) => l.startsWith("GCP01,"));
    expect(gcp01Idx).toBeGreaterThanOrEqual(0);
    const gcp01Comment = gcp01Lines[gcp01Idx + 1]!;
    expect(gcp01Comment).toContain("# acc_xy=");
    expect(gcp01Comment).toContain("acc_z=");
    expect(gcp01Comment).toContain("adjusted=true");
    expect(gcp01Comment).toContain("conf=0.95");

    // GCP03 has no uncertainty — should show "uncertainty=missing"
    const gcp03Idx = gcp01Lines.findIndex((l) => l.startsWith("GCP03,"));
    expect(gcp03Idx).toBeGreaterThanOrEqual(0);
    const gcp03Comment = gcp01Lines[gcp03Idx + 1]!;
    expect(gcp03Comment).toContain("uncertainty=missing");
  });
});

describe("gcpExporter — Case 13: round-trip via CSV parse", () => {
  it("Metashape CSV parses back to the same GCP count + coordinates", async () => {
    const originalPoints = kenyaGcps();
    const input: GcpInput = { points: originalPoints };
    const result = await gcpExporter.export(input, {
      countryCode: "KE",
      format: "metashape",
      projectMetadata: baseMetadata,
    });

    const csv = decodeCsv(result.bytes);
    const rows = parseCsv(csv);
    // Skip header row
    const dataRows = rows.slice(1);

    expect(dataRows.length).toBe(originalPoints.length);
    for (let i = 0; i < originalPoints.length; i++) {
      const original = originalPoints[i]!;
      const parsed = dataRows[i]!;
      expect(parsed[0]).toBe(original.label);
      // Coordinates parse back to the same float values
      expect(parseFloat(parsed[1]!)).toBeCloseTo(original.easting, 6);
      expect(parseFloat(parsed[2]!)).toBeCloseTo(original.northing, 6);
      expect(parseFloat(parsed[3]!)).toBeCloseTo(original.elevation, 6);
    }
  });
});

describe("gcpExporter — Case 14: header metadata embedded", () => {
  it("Pix4D CSV header includes project metadata", async () => {
    const input: GcpInput = { points: kenyaGcps() };
    const result = await gcpExporter.export(input, {
      countryCode: "KE",
      format: "pix4d",
      projectMetadata: {
        projectName: "Drone Mission Alpha",
        surveyorName: "Jane Wanjiru",
        licenseNumber: "LS/9999",
        surveyDate: "2026-08-01",
        adjustmentRunId: "drone-mission-alpha-001",
      },
    });

    const csv = decodeCsv(result.bytes);
    expect(csv).toContain("Project: Drone Mission Alpha");
    expect(csv).toContain("Jane Wanjiru");
    expect(csv).toContain("LS/9999");
    expect(csv).toContain("2026-08-01");
    expect(csv).toContain("drone-mission-alpha-001");
  });
});

describe("gcpExporter — Case 15: non-finite coordinates rejected", () => {
  it("validate() fails when coordinates contain NaN or Infinity", () => {
    const input: GcpInput = {
      points: [
        {
          label: "BAD_GCP",
          easting: NaN,
          northing: 2000,
          elevation: 100,
        },
      ],
    };
    const validation = gcpExporter.validate(input, {
      countryCode: "KE",
      format: "pix4d",
      projectMetadata: baseMetadata,
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("non-finite coordinates"))).toBe(true);
  });
});

// ─── Golden fixture tests ────────────────────────────────────────

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname_fixture = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname_fixture, "fixtures");

describe("gcpExporter — golden CSV fixtures", () => {
  it("kenya-gcp-pix4d.csv exists and has the expected structure", () => {
    const csv = readFileSync(join(FIXTURES_DIR, "kenya-gcp-pix4d.csv"), "utf-8");
    expect(csv.length).toBeGreaterThan(500);

    // Header comment
    expect(csv).toContain("# Pix4D Ground Control Points file");
    expect(csv).toContain("# CRS: urn:ogc:def:crs:EPSG::21037");
    expect(csv).toContain("Arc 1960 / UTM zone 37S");
    expect(csv).toContain("golden-gcp-ke-001");

    // 8-column header row
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual([
      "GCP Name", "X (Projected)", "Y (Projected)", "Z (Orthometric)",
      "Geodetic X (Longitude)", "Geodetic Y (Latitude)", "Geodetic Z (Ellipsoidal H)",
      "Coordinate System",
    ]);

    // 4 GCP rows + 1 header = 5 data rows (uncertainty comments are
    // filtered out by parseCsv's skipComments=true).
    expect(rows.length).toBe(5);

    // GCP01's row has the CRS display name in column 7.
    const gcp01Row = rows[1]!;
    expect(gcp01Row[0]).toBe("GCP01");
    expect(gcp01Row[7]).toBe("Arc 1960 / UTM zone 37S");

    // The uncertainty comment is on a SEPARATE line below the GCP row
    // (not in the same row, to avoid breaking Pix4D's CSV parser).
    // Read the raw CSV (with comments) to find it.
    const rawCsv = readFileSync(join(FIXTURES_DIR, "kenya-gcp-pix4d.csv"), "utf-8");
    const gcp01Section = rawCsv.split("GCP01,")[1]!.split("\n")[1];
    expect(gcp01Section).toContain("# acc_xy=0.012000m");
    expect(gcp01Section).toContain("adjusted=true");
    expect(gcp01Section).toContain("conf=0.95");

    // GCP03 has no uncertainty — should show "uncertainty=missing"
    const gcp03Section = rawCsv.split("GCP03,")[1]!.split("\n")[1];
    expect(gcp03Section).toContain("uncertainty=missing");
  });

  it("kenya-gcp-metashape.csv exists and has the expected structure", () => {
    const csv = readFileSync(join(FIXTURES_DIR, "kenya-gcp-metashape.csv"), "utf-8");
    expect(csv).toContain("# Metashape Ground Control Points file");
    expect(csv).toContain("golden-gcp-ke-002");

    const rows = parseCsv(csv);
    expect(rows[0]).toEqual([
      "label", "x", "y", "z", "accuracy_xy", "accuracy_z", "camera_label",
    ]);

    // 4 GCPs + 1 header
    expect(rows.length).toBe(5);

    // GCP01: uncertainty.semiMajor=0.012 → accuracy_xy=0.012; accuracy_z=0.018
    const gcp01 = rows[1]!;
    expect(gcp01[0]).toBe("GCP01");
    expect(gcp01[4]).toBe("0.012000");
    expect(gcp01[5]).toBe("0.018000");
  });

  it("kenya-gcp-agisoft.csv exists and has the expected structure", () => {
    const csv = readFileSync(join(FIXTURES_DIR, "kenya-gcp-agisoft.csv"), "utf-8");
    expect(csv).toContain("# Agisoft PhotoScan / Metashape Ground Control Points file");
    expect(csv).toContain("golden-gcp-ke-003");

    const rows = parseCsv(csv);
    expect(rows[0]).toEqual([
      "label", "x", "y", "z", "accuracy_xy", "accuracy_z", "camera_label",
    ]);
    expect(rows.length).toBe(5);
  });

  it("fixtures are byte-stable for same input (modulo timestamp)", async () => {
    // Re-export Pix4D and compare structural content. The header has a
    // timestamp so byte-identical comparison would be flaky — compare
    // the GCP rows + CRS line instead.
    const input: GcpInput = {
      points: [
        { label: "GCP01", easting: 257100.0, northing: 9857700.0, elevation: 1795.0,
          description: "White cross on asphalt",
          uncertainty: { adjusted: true, semiMajorAxis: 0.012, semiMinorAxis: 0.008, orientation: 45.3, confidenceLevel: 0.95 } },
        { label: "GCP02", easting: 257200.0, northing: 9857700.0, elevation: 1796.0,
          description: "Painted target on concrete",
          uncertainty: { adjusted: true, semiMajorAxis: 0.015, semiMinorAxis: 0.010, orientation: 30.0, confidenceLevel: 0.95 } },
        { label: "GCP03", easting: 257100.0, northing: 9857800.0, elevation: 1794.0,
          description: "Black square target" },
        { label: "GCP04", easting: 257200.0, northing: 9857800.0, elevation: 1795.0,
          accuracyXY: 0.025, accuracyZ: 0.040, description: "Checkerboard target" },
      ],
    };
    const result = await gcpExporter.export(input, {
      countryCode: "KE",
      format: "pix4d",
      projectMetadata: {
        projectName: "Golden Fixture — Kenya Drone GCPs",
        surveyorName: "Jane Wanjiru",
        licenseNumber: "LS/1234",
        surveyDate: "2026-07-23",
        adjustmentRunId: "golden-gcp-ke-001",
      },
    });

    const liveRows = parseCsv(decodeCsv(result.bytes));
    const fixtureRows = parseCsv(
      readFileSync(join(FIXTURES_DIR, "kenya-gcp-pix4d.csv"), "utf-8"),
    );

    // Same row count
    expect(liveRows.length).toBe(fixtureRows.length);

    // Compare each GCP row's first 4 columns (label + E + N + Z) +
    // the CRS display name (column 7).
    for (let i = 1; i < liveRows.length; i++) {
      const live = liveRows[i]!;
      const fixt = fixtureRows[i]!;
      expect(live[0]).toBe(fixt[0]); // label
      expect(live[1]).toBe(fixt[1]); // easting
      expect(live[2]).toBe(fixt[2]); // northing
      expect(live[3]).toBe(fixt[3]); // elevation
      // CRS display name in column 7 (uncertainty is on a separate comment line).
      expect(live[7]).toBe(fixt[7]);
      expect(live[7]).toContain("Arc 1960 / UTM zone 37S");
    }

    // Verify the uncertainty comments are present in the raw CSV
    // (separate comment lines after each GCP row).
    const liveRaw = decodeCsv(result.bytes);
    const fixtRaw = readFileSync(join(FIXTURES_DIR, "kenya-gcp-pix4d.csv"), "utf-8");
    expect(liveRaw).toContain("# acc_xy=0.012000m");
    expect(fixtRaw).toContain("# acc_xy=0.012000m");
  });
});

// ─── projectToWgs84 callback tests (sidecar lat/lon bridge) ─────

describe("gcpExporter — projectToWgs84 callback auto-fills Pix4D lat/lon", () => {
  it("fills lat/lon columns when callback provided", async () => {
    const input: GcpInput = {
      points: [
        { label: "GCP01", easting: 257100.0, northing: 9857700.0, elevation: 1795.0 },
      ],
    };
    const result = await gcpExporter.export(input, {
      countryCode: "KE",
      format: "pix4d",
      projectMetadata: baseMetadata,
      projectToWgs84: async (e, n, _srid) => {
        // Mock callback — simulates sidecar's geodesy.utm_inverse
        return { lat: -1.2200000, lon: 36.9000000 };
      },
    });

    const csv = decodeCsv(result.bytes);
    // Header should say "auto-filled"
    expect(csv).toContain("# Lat/lon columns auto-filled via sidecar projection-inverse.");
    // GCP01 row should have non-blank lat/lon
    const gcp01Line = csv.split("\n").find((l) => l.startsWith("GCP01,"));
    expect(gcp01Line).toBeDefined();
    // Column 5 (lon) and 6 (lat) should NOT be empty
    const cols = gcp01Line!.split(",").map((c) => c.trim());
    expect(cols[4]).not.toBe(""); // lon
    expect(cols[5]).not.toBe(""); // lat
    expect(cols[4]).toBe("36.9000000"); // lon
    expect(cols[5]).toBe("-1.2200000"); // lat
  });

  it("leaves lat/lon blank when no callback (backward compat)", async () => {
    const input: GcpInput = {
      points: [
        { label: "GCP01", easting: 257100.0, northing: 9857700.0, elevation: 1795.0 },
      ],
    };
    const result = await gcpExporter.export(input, {
      countryCode: "KE",
      format: "pix4d",
      projectMetadata: baseMetadata,
      // No projectToWgs84 callback
    });

    const csv = decodeCsv(result.bytes);
    expect(csv).toContain("# Lat/lon columns are blank");
    const gcp01Line = csv.split("\n").find((l) => l.startsWith("GCP01,"));
    const cols = gcp01Line!.split(",").map((c) => c.trim());
    expect(cols[4]).toBe(""); // lon blank
    expect(cols[5]).toBe(""); // lat blank
  });

  it("surfaces warning when callback throws", async () => {
    const input: GcpInput = {
      points: [
        { label: "GCP01", easting: 257100.0, northing: 9857700.0, elevation: 1795.0 },
      ],
    };
    const result = await gcpExporter.export(input, {
      countryCode: "KE",
      format: "pix4d",
      projectMetadata: baseMetadata,
      projectToWgs84: async () => {
        throw new Error("sidecar IPC timeout");
      },
    });

    expect(result.warnings.some((w) => w.includes("lat/lon conversion failed"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("sidecar IPC timeout"))).toBe(true);
  });
});
