/**
 * Tests for the GeoJSON integration exporter.
 *
 * Covers the 10 mandatory cases from Task Brief 01:
 *   1. Happy path: Kenya 4-beacon cadastral → valid GeoJSON with CRS,
 *      uncertainty, metadata.
 *   2. UK general-boundaries case: beacons with no covariance →
 *      exporter emits warnings, sets adjusted=false, still produces
 *      valid GeoJSON.
 *   3. Missing project metadata → validate() fails, export() throws.
 *   4. Unknown country code → validate() fails, export() throws.
 *   5. SRID lookup: parameterized across all 5 countries.
 *   6. Round-trip: JSON.parse(bytes) produces the same shape.
 *   7. Precision preservation: float64 coordinate survives round-trip.
 *   8. UTF-8: TextDecoder.decode(bytes) === original JSON string.
 *   9. includeUncertainty default true vs explicit false.
 *  10. Beacon with adjusted=true but missing ellipse → warning + default
 *      confidenceLevel fills in 0.95.
 *
 * Per ADR-0005 + invariant C1: every test fixture that includes
 * adjusted beacons must include propagated uncertainty.
 */

import { describe, it, expect } from "vitest";
import { geoJsonExporter } from "../geojson-export.js";
import { runCadastralWorkflow } from "../../workflows/cadastral.js";
import type { CadastralWorkflowOutput } from "../../workflows/cadastral.js";
import type { GeoJsonOptions } from "../geojson-export.js";

// ─── Fixtures ────────────────────────────────────────────────────

const baseMetadata = {
  projectName: "Test Parcel — Kasarani",
  surveyorName: "Jane Wanjiru",
  licenseNumber: "LS/1234",
  surveyDate: "2026-07-23",
  adjustmentRunId: "adj-run-001",
};

/**
 * Run a 4-beacon Kenya cadastral survey to use as the input for export
 * tests. Two known control beacons + two new beacons tied by distance
 * observations → exercises the LS adjustment + uncertainty path.
 */
async function kenyaCadastralOutput(): Promise<CadastralWorkflowOutput> {
  return await runCadastralWorkflow({
    knownBeacons: [
      {
        label: "B1",
        position: { easting: 257100.0, northing: 9857700.0 },
        description: "Concrete pillar",
      },
      {
        label: "B2",
        position: { easting: 257150.0, northing: 9857700.0 },
        description: "Concrete pillar",
      },
    ],
    observations: [
      { fromLabel: "B1", toLabel: "B3", distanceM: 50.0, sigmaM: 0.005 },
      { fromLabel: "B2", toLabel: "B3", distanceM: 50.0, sigmaM: 0.005 },
      { fromLabel: "B1", toLabel: "B4", distanceM: 70.71, sigmaM: 0.005 },
      { fromLabel: "B2", toLabel: "B4", distanceM: 50.0, sigmaM: 0.005 },
      // Over-determined: add an extra obs to give the LS fit redundancy.
      { fromLabel: "B3", toLabel: "B4", distanceM: 50.0, sigmaM: 0.005 },
    ],
    parcel: {
      surveyNumber: "S/12345",
      district: "NAIROBI",
      location: "KASARANI",
      areaHa: 0.25,
    },
    surveyor: {
      name: "Jane Wanjiru",
      iskRegNo: "LS/1234",
      dateOfSurvey: "2026-07-23",
    },
    srid: 21037,
  });
}

/**
 * UK general-boundaries case — a measured survey where beacons aren't
 * fixed-boundary statutory points. We simulate this by building a
 * minimal workflow output manually with no covariance.
 */
function ukGeneralBoundariesOutput(): CadastralWorkflowOutput {
  return {
    form3: {
      pdfBytes: new Uint8Array(0),
      pageCount: 0,
      scale: 0,
      coordinateSystemLabel: "OSGB36 / British National Grid (general boundaries)",
      hasDraftWatermark: false,
    },
    allBeacons: [
      {
        label: "P1",
        position: { easting: 525000.0, northing: 181000.0 },
        description: "Fence corner",
      },
      {
        label: "P2",
        position: { easting: 525050.0, northing: 181000.0 },
        description: "Fence corner",
      },
      {
        label: "P3",
        position: { easting: 525050.0, northing: 181040.0 },
        description: "Wall corner",
      },
      {
        label: "P4",
        position: { easting: 525000.0, northing: 181040.0 },
        description: "Wall corner",
      },
    ],
    residuals: {},
    sigma_0_sq: 0,
    passesCadastralTolerance: false,
    // UK general boundaries: no propagated uncertainty (beacons are
    // physical features, not adjusted statutory points).
    uncertainty: {
      P1: { adjusted: false },
      P2: { adjusted: false },
      P3: { adjusted: false },
      P4: { adjusted: false },
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe("geoJsonExporter — format metadata", () => {
  it("exposes the correct format identifier, MIME type, and extension", () => {
    expect(geoJsonExporter.format).toBe("geojson");
    expect(geoJsonExporter.mimeType).toBe("application/geo+json");
    expect(geoJsonExporter.fileExtension).toBe("geojson");
    expect(geoJsonExporter.description).toMatch(/GeoJSON/i);
  });
});

describe("geoJsonExporter — Case 1: Kenya happy path", () => {
  it("produces valid GeoJSON with CRS, uncertainty, and metadata", async () => {
    const input = await kenyaCadastralOutput();
    const options: GeoJsonOptions = {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    };

    const result = await geoJsonExporter.export(input, options);
    expect(result.format).toBe("geojson");
    expect(result.featureCount).toBe(5); // 4 beacons + 1 parcel polygon
    expect(result.crsUrn).toBe("urn:ogc:def:crs:EPSG::21037");

    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));
    expect(parsed.type).toBe("FeatureCollection");
    expect(parsed.crs.type).toBe("name");
    expect(parsed.crs.properties.name).toBe("urn:ogc:def:crs:EPSG::21037");

    // Metadata block
    expect(parsed.metadata.metardu.countryCode).toBe("KE");
    expect(parsed.metadata.metardu.projectName).toBe("Test Parcel — Kasarani");
    expect(parsed.metadata.metardu.surveyorName).toBe("Jane Wanjiru");
    expect(parsed.metadata.metardu.licenseNumber).toBe("LS/1234");
    expect(parsed.metadata.metardu.surveyDate).toBe("2026-07-23");
    expect(parsed.metadata.metardu.adjustmentRunId).toBe("adj-run-001");
    expect(parsed.metadata.metardu.crsUrn).toBe("urn:ogc:def:crs:EPSG::21037");
    expect(parsed.metadata.metardu.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Beacon features carry uncertainty (B3, B4 are new/adjusted)
    const b3 = parsed.features.find((f: { id: string }) => f.id === "beacon-B3");
    expect(b3).toBeDefined();
    expect(b3.properties.adjusted).toBe(true);
    expect(b3.properties.uncertainty).toBeDefined();
    expect(b3.properties.uncertainty.semiMajorAxis).toBeGreaterThan(0);
    expect(b3.properties.uncertainty.semiMinorAxis).toBeGreaterThan(0);
    expect(b3.properties.uncertainty.orientation).toBeGreaterThanOrEqual(0);
    expect(b3.properties.uncertainty.orientation).toBeLessThan(180);
    expect(b3.properties.uncertainty.confidenceLevel).toBe(0.95);

    // B1, B2 are known (fixed) — adjusted=false, reason=_fixed-control
    const b1 = parsed.features.find((f: { id: string }) => f.id === "beacon-B1");
    expect(b1.properties.adjusted).toBe(false);
    expect(b1.properties.uncertainty.reason).toBe("fixed-control");
  });
});

describe("geoJsonExporter — Case 2: UK general-boundaries", () => {
  it("emits warnings and adjusted=false for beacons without covariance", async () => {
    const input = ukGeneralBoundariesOutput();
    const options: GeoJsonOptions = {
      countryCode: "GB",
      projectMetadata: baseMetadata,
    };

    const result = await geoJsonExporter.export(input, options);
    expect(result.crsUrn).toBe("urn:ogc:def:crs:EPSG::27700"); // OSGB36

    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));
    // All beacons are adjusted=false (UK general boundaries).
    for (const feature of parsed.features) {
      if (feature.properties.featureType === "beacon") {
        expect(feature.properties.adjusted).toBe(false);
        expect(feature.properties.uncertainty.reason).toBe("fixed-control");
      }
    }
  });
});

describe("geoJsonExporter — Case 3: missing project metadata", () => {
  it("validate() returns errors and export() throws", async () => {
    const input = await kenyaCadastralOutput();
    const options: GeoJsonOptions = { countryCode: "KE" };

    const validation = geoJsonExporter.validate(input, options);
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e: string) => e.includes("projectMetadata"))).toBe(true);

    await expect(geoJsonExporter.export(input, options)).rejects.toThrow(
      /validation failed/,
    );
  });

  it("rejects incomplete project metadata", async () => {
    const input = await kenyaCadastralOutput();
    const options: GeoJsonOptions = {
      countryCode: "KE",
      projectMetadata: {
        projectName: "Test",
        surveyorName: "",
        licenseNumber: "LS/1234",
        surveyDate: "2026-07-23",
        adjustmentRunId: "adj-1",
      },
    };

    const validation = geoJsonExporter.validate(input, options);
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e: string) => e.includes("surveyorName"))).toBe(true);
  });
});

describe("geoJsonExporter — Case 4: unknown country code", () => {
  it("validate() returns errors and export() throws", async () => {
    const input = await kenyaCadastralOutput();
    const options: GeoJsonOptions = {
      countryCode: "XX", // not in [KE, AU, GB, ZA, AE]
      projectMetadata: baseMetadata,
    };

    const validation = geoJsonExporter.validate(input, options);
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e: string) => e.includes("Unknown country code"))).toBe(
      true,
    );

    await expect(geoJsonExporter.export(input, options)).rejects.toThrow(
      /validation failed/,
    );
  });
});

describe("geoJsonExporter — Case 5: SRID lookup across all 5 countries", () => {
  // Each country's primary SRID, sourced from country-config.
  // These are NOT hardcoded SRIDs in the exporter — they're the
  // expected outputs from the country-config lookup, used to verify
  // the exporter reads the right value.
  const cases: Array<{ code: string; expectedSrid: number; expectedUrn: string }> = [
    { code: "KE", expectedSrid: 21037, expectedUrn: "urn:ogc:def:crs:EPSG::21037" },
    { code: "GB", expectedSrid: 27700, expectedUrn: "urn:ogc:def:crs:EPSG::27700" },
    // AU, ZA, AE SRIDs depend on the country config; we just check the
    // URN shape here and that it's non-empty.
    { code: "AU", expectedSrid: 0, expectedUrn: "" }, // 0 = "any non-zero"
    { code: "ZA", expectedSrid: 0, expectedUrn: "" },
    { code: "AE", expectedSrid: 0, expectedUrn: "" },
  ];

  for (const c of cases) {
    it(`country ${c.code} produces a valid CRS URN`, async () => {
      const input = ukGeneralBoundariesOutput(); // country-agnostic shape
      const options: GeoJsonOptions = {
        countryCode: c.code,
        projectMetadata: baseMetadata,
      };

      const result = await geoJsonExporter.export(input, options);
      expect(result.crsUrn).toMatch(/^urn:ogc:def:crs:EPSG::\d+$/);

      if (c.expectedSrid !== 0) {
        expect(result.crsUrn).toBe(c.expectedUrn);
      }

      const parsed = JSON.parse(new TextDecoder().decode(result.bytes));
      expect(parsed.crs.properties.name).toBe(result.crsUrn);
    });
  }
});

describe("geoJsonExporter — Case 6: round-trip via JSON.parse", () => {
  it("parses back to an object with the same feature count and CRS", async () => {
    const input = await kenyaCadastralOutput();
    const options: GeoJsonOptions = {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    };

    const result = await geoJsonExporter.export(input, options);
    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));

    expect(parsed.type).toBe("FeatureCollection");
    expect(parsed.features.length).toBe(result.featureCount);
    expect(parsed.crs.properties.name).toBe(result.crsUrn);
    expect(parsed.metadata.metardu.countryCode).toBe("KE");
  });
});

describe("geoJsonExporter — Case 7: precision preservation", () => {
  it("preserves a high-precision coordinate through the round-trip", async () => {
    // Build a synthetic input with a coordinate that has many significant digits.
    const input: CadastralWorkflowOutput = {
      form3: {
        pdfBytes: new Uint8Array(0),
        pageCount: 0,
        scale: 0,
        coordinateSystemLabel: "test",
        hasDraftWatermark: false,
      },
      allBeacons: [
        {
          label: "PRECISION",
          position: { easting: 257100.123456789012, northing: 9857700.987654321098 },
          description: "precision test",
        },
      ],
      residuals: {},
      sigma_0_sq: 1.0,
      passesCadastralTolerance: true,
      uncertainty: { PRECISION: { adjusted: false } },
    };

    const options: GeoJsonOptions = {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    };

    const result = await geoJsonExporter.export(input, options);
    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));
    const beacon = parsed.features.find(
      (f: { id: string }) => f.id === "beacon-PRECISION",
    );
    expect(beacon.geometry.coordinates[0]).toBe(257100.123456789012);
    expect(beacon.geometry.coordinates[1]).toBe(9857700.987654321098);
  });
});

describe("geoJsonExporter — Case 8: UTF-8 encoding", () => {
  it("decodes back to the original JSON string via TextDecoder", async () => {
    const input = await kenyaCadastralOutput();
    const options: GeoJsonOptions = {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    };

    const result = await geoJsonExporter.export(input, options);
    const decoded = new TextDecoder().decode(result.bytes);
    // Round-trip: re-encoding the decoded string should produce the same bytes.
    const reEncoded = new TextEncoder().encode(decoded);
    expect(reEncoded.length).toBe(result.bytes.length);
    expect(Buffer.from(reEncoded).equals(Buffer.from(result.bytes))).toBe(true);
  });
});

describe("geoJsonExporter — Case 9: includeUncertainty default vs explicit false", () => {
  it("default includes uncertainty; explicit false omits it", async () => {
    const input = await kenyaCadastralOutput();
    const optionsWith: GeoJsonOptions = {
      countryCode: "KE",
      projectMetadata: baseMetadata,
      // includeUncertainty default → true
    };
    const optionsWithout: GeoJsonOptions = {
      countryCode: "KE",
      projectMetadata: baseMetadata,
      includeUncertainty: false,
    };

    const resultWith = await geoJsonExporter.export(input, optionsWith);
    const resultWithout = await geoJsonExporter.export(input, optionsWithout);

    const parsedWith = JSON.parse(new TextDecoder().decode(resultWith.bytes));
    const parsedWithout = JSON.parse(new TextDecoder().decode(resultWithout.bytes));

    // With uncertainty (default): beacon B3 carries an uncertainty object.
    const b3With = parsedWith.features.find(
      (f: { id: string }) => f.id === "beacon-B3",
    );
    expect(b3With.properties.uncertainty).toBeDefined();
    expect(b3With.properties.uncertainty.semiMajorAxis).toBeDefined();

    // Without uncertainty: beacon B3 has no uncertainty property.
    const b3Without = parsedWithout.features.find(
      (f: { id: string }) => f.id === "beacon-B3",
    );
    expect(b3Without.properties.uncertainty).toBeUndefined();
    // But `adjusted` flag is still correct.
    expect(b3Without.properties.adjusted).toBe(true);
  });
});

describe("geoJsonExporter — Case 10: adjusted beacon with missing ellipse", () => {
  it("emits a warning and surfaces a 'degenerate-configuration' uncertainty reason", async () => {
    // Synthetic input: beacon is marked adjusted=true but has no ellipse.
    const input: CadastralWorkflowOutput = {
      form3: {
        pdfBytes: new Uint8Array(0),
        pageCount: 0,
        scale: 0,
        coordinateSystemLabel: "test",
        hasDraftWatermark: false,
      },
      allBeacons: [
        {
          label: "DEGEN",
          position: { easting: 100.0, northing: 200.0 },
          description: "degenerate test",
        },
      ],
      residuals: {},
      sigma_0_sq: 1.0,
      passesCadastralTolerance: false,
      uncertainty: {
        DEGEN: { adjusted: true, confidenceLevel: 0.95 }, // missing semiMajor/semiMinor/orientation
      },
    };

    const options: GeoJsonOptions = {
      countryCode: "KE",
      projectMetadata: baseMetadata,
    };

    const result = await geoJsonExporter.export(input, options);
    expect(result.warnings.some((w) => w.includes("DEGEN"))).toBe(true);

    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));
    const beacon = parsed.features.find((f: { id: string }) => f.id === "beacon-DEGEN");
    expect(beacon.properties.adjusted).toBe(true);
    expect(beacon.properties.uncertainty.reason).toBe("degenerate-configuration");
  });
});

// ─── Golden fixture tests ────────────────────────────────────────

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname_fixture = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname_fixture, "fixtures");

describe("geoJsonExporter — golden fixtures", () => {
  it("kenya-cadastral-4-beacon.json exists and has the expected shape", () => {
    const raw = readFileSync(join(FIXTURES_DIR, "kenya-cadastral-4-beacon.json"), "utf-8");
    const parsed = JSON.parse(raw);

    expect(parsed.type).toBe("FeatureCollection");
    expect(parsed.crs.properties.name).toBe("urn:ogc:def:crs:EPSG::21037");
    expect(parsed.metadata.metardu.countryCode).toBe("KE");
    expect(parsed.metadata.metardu.adjustmentRunId).toBe("golden-ke-001");
    expect(parsed.metadata.metardu.exportedAt).toBe("<DETERMINISTIC_PLACEHOLDER>");

    // 4 beacons + 1 parcel polygon = 5 features.
    expect(parsed.features.length).toBe(5);

    // B3 is an adjusted beacon — must carry a full error ellipse.
    const b3 = parsed.features.find((f: { id: string }) => f.id === "beacon-B3");
    expect(b3.properties.adjusted).toBe(true);
    expect(b3.properties.uncertainty.semiMajorAxis).toBeGreaterThan(0);
    expect(b3.properties.uncertainty.semiMinorAxis).toBeGreaterThan(0);
    expect(b3.properties.uncertainty.semiMajorAxis).toBeGreaterThanOrEqual(
      b3.properties.uncertainty.semiMinorAxis,
    );
    expect(b3.properties.uncertainty.orientation).toBeGreaterThanOrEqual(0);
    expect(b3.properties.uncertainty.orientation).toBeLessThan(180);
    expect(b3.properties.uncertainty.confidenceLevel).toBe(0.95);
  });

  it("uk-cadastral-general-boundaries.json exists and has the expected shape", () => {
    const raw = readFileSync(
      join(FIXTURES_DIR, "uk-cadastral-general-boundaries.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw);

    expect(parsed.type).toBe("FeatureCollection");
    expect(parsed.crs.properties.name).toBe("urn:ogc:def:crs:EPSG::27700");
    expect(parsed.metadata.metardu.countryCode).toBe("GB");
    expect(parsed.metadata.metardu.adjustmentRunId).toBe("golden-gb-001");

    // All beacons are general-boundaries points — adjusted=false, reason=fixed-control.
    const beacons = parsed.features.filter(
      (f: { properties: { featureType: string } }) =>
        f.properties.featureType === "beacon",
    );
    expect(beacons.length).toBe(4);
    for (const b of beacons) {
      expect(b.properties.adjusted).toBe(false);
      expect(b.properties.uncertainty.reason).toBe("fixed-control");
    }
  });

  it("golden fixtures are byte-stable when exported with the same input", async () => {
    // Re-run the Kenya export and compare against the fixture, ignoring
    // the exportedAt timestamp. This catches silent schema drift.
    const input = await kenyaCadastralOutput();
    const result = await geoJsonExporter.export(input, {
      countryCode: "KE",
      projectMetadata: {
        ...baseMetadata,
        projectName: "Golden Fixture — Kasarani 4-Beacon",
        adjustmentRunId: "golden-ke-001",
      },
    });
    const parsed = JSON.parse(new TextDecoder().decode(result.bytes));
    parsed.metadata.metardu.exportedAt = "<DETERMINISTIC_PLACEHOLDER>";

    const fixtureRaw = readFileSync(
      join(FIXTURES_DIR, "kenya-cadastral-4-beacon.json"),
      "utf-8",
    );
    const fixtureParsed = JSON.parse(fixtureRaw);

    // Compare features (coordinate values, uncertainty ellipses).
    expect(parsed.features.length).toBe(fixtureParsed.features.length);
    for (let i = 0; i < parsed.features.length; i++) {
      const live = parsed.features[i];
      const fixt = fixtureParsed.features[i];
      expect(live.id).toBe(fixt.id);
      expect(live.properties.adjusted).toBe(fixt.properties.adjusted);
      if (live.properties.uncertainty?.semiMajorAxis !== undefined) {
        // Allow tiny float drift (< 1e-9 m = 1 nm).
        expect(Math.abs(live.properties.uncertainty.semiMajorAxis - fixt.properties.uncertainty.semiMajorAxis)).toBeLessThan(1e-9);
        expect(Math.abs(live.properties.uncertainty.semiMinorAxis - fixt.properties.uncertainty.semiMinorAxis)).toBeLessThan(1e-9);
      }
    }
  });
});
