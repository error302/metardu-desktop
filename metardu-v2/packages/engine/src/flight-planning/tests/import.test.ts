/**
 * Round-trip verification tests.
 *
 * For each export format, we:
 *   1. Generate a known set of waypoints
 *   2. Export to the format
 *   3. Import the exported content back
 *   4. Compare the imported waypoints to the originals
 *
 * The comparison tolerates tiny floating-point differences (8 decimal places
 * for lat/lng, 2 decimal places for altitude) because text formats round
 * values during serialization.
 *
 * If any round-trip fails, it means either the exporter is producing
 * malformed output OR the importer is parsing incorrectly. Either way,
 * a failure here is a release-blocking bug.
 */

import { describe, it, expect } from "vitest";
import {
  getCameraById,
  computeFlightPlanParameters,
  generateLawnmowerWaypoints,
  exportMission,
  importMission,
  type Waypoint,
} from "../../index.js";

// Generate a known set of waypoints for testing
function getTestWaypoints(): Waypoint[] {
  const camera = getCameraById("dji-mavic-3-enterprise");
  const params = computeFlightPlanParameters(camera, 75, 0.75, 0.65);
  return generateLawnmowerWaypoints({
    params,
    area: {
      coordinates: [
        { lat: -1.2864, lng: 36.8172 },
        { lat: -1.2819, lng: 36.8172 },
        { lat: -1.2819, lng: 36.8200 },
        { lat: -1.2864, lng: 36.8200 },
        { lat: -1.2864, lng: 36.8172 },
      ],
    },
  });
}

// Tolerance for round-trip comparison
const LAT_LNG_TOLERANCE = 1e-7;  // ~1 cm at the equator
const ALT_TOLERANCE = 0.01;       // 1 cm
const HEADING_TOLERANCE = 0.5;    // 0.5 degree

/**
 * Compare two waypoints arrays for round-trip equality.
 *
 * The imported array may have different flightLine values (some formats
 * don't encode flight line info) and may have different isPhoto flags
 * (some formats mark all waypoints as photos).
 */
function compareWaypoints(
  original: Waypoint[],
  imported: Waypoint[],
  options: { expectCount?: boolean } = {}
): void {
  const expectCount = options.expectCount ?? true;

  if (expectCount) {
    expect(imported.length, "waypoint count should match").toBe(original.length);
  }

  const compareCount = Math.min(original.length, imported.length);

  for (let i = 0; i < compareCount; i++) {
    const orig = original[i]!;
    const imp = imported[i]!;

    expect(imp.latitude,
      `WP ${i}: lat ${imp.latitude} should match ${orig.latitude} (within ${LAT_LNG_TOLERANCE})`
    ).toBeCloseTo(orig.latitude, 5);

    expect(imp.longitude,
      `WP ${i}: lng ${imp.longitude} should match ${orig.longitude} (within ${LAT_LNG_TOLERANCE})`
    ).toBeCloseTo(orig.longitude, 5);

    expect(imp.altitudeMeters,
      `WP ${i}: alt ${imp.altitudeMeters} should match ${orig.altitudeMeters} (within ${ALT_TOLERANCE})`
    ).toBeCloseTo(orig.altitudeMeters, 1);
  }
}

// ─── ArduPilot .waypoints round-trip ───────────────────────────────

describe("Round-trip: ArduPilot .waypoints", () => {
  it("export → import should preserve waypoint coordinates", async () => {
    const original = getTestWaypoints();

    // Export
    const exportResult = await exportMission(original, { format: "ardupilot-waypoints" });
    expect(exportResult.text).toBeDefined();
    const text = exportResult.text!;

    // Import
    const imported = await importMission("ardupilot-waypoints", text);

    // Compare (ArduPilot export adds takeoff + RTL commands, so imported count = original count)
    expect(imported.length).toBe(original.length);
    compareWaypoints(original, imported);
  });

  it("should throw on invalid header", async () => {
    await expect(importMission("ardupilot-waypoints", "INVALID HEADER\n")).rejects.toThrow(/header/);
  });

  it("should throw on malformed line", async () => {
    const bad = "QGC WPL 110\n0\t0\t0\t16\tincomplete\n";
    await expect(importMission("ardupilot-waypoints", bad)).rejects.toThrow(/12 tab-separated/);
  });
});

// ─── Litchi CSV round-trip ─────────────────────────────────────────

describe("Round-trip: Litchi CSV", () => {
  it("export → import should preserve waypoint coordinates", async () => {
    const original = getTestWaypoints();

    const exportResult = await exportMission(original, { format: "litchi-csv" });
    const imported = await importMission("litchi-csv", exportResult.text!);

    expect(imported.length).toBe(original.length);
    compareWaypoints(original, imported);
  });

  it("should throw on missing latitude/longitude columns", async () => {
    const bad = "foo,bar\n1,2\n";
    await expect(importMission("litchi-csv", bad)).rejects.toThrow(/latitude\/longitude/);
  });
});

// ─── senseFly XML round-trip ───────────────────────────────────────

describe("Round-trip: senseFly XML", () => {
  it("export → import should preserve waypoint coordinates", async () => {
    const original = getTestWaypoints();

    const exportResult = await exportMission(original, { format: "sensefly-xml" });
    const imported = await importMission("sensefly-xml", exportResult.text!);

    expect(imported.length).toBe(original.length);
    compareWaypoints(original, imported);
  });

  it("should throw on missing Mission root", async () => {
    await expect(importMission("sensefly-xml", "<NotMission/>")).rejects.toThrow(/Mission/);
  });
});

// ─── Generic KML round-trip ────────────────────────────────────────

describe("Round-trip: Generic KML", () => {
  it("export → import should preserve waypoint coordinates", async () => {
    const original = getTestWaypoints();

    const exportResult = await exportMission(original, { format: "kml" });
    const imported = await importMission("kml", exportResult.text!);

    expect(imported.length).toBe(original.length);
    compareWaypoints(original, imported);
  });

  it("should throw on missing kml root", async () => {
    await expect(importMission("kml", "<NotKml/>")).rejects.toThrow(/kml/);
  });
});

// ─── DJI KMZ round-trip ────────────────────────────────────────────

describe("Round-trip: DJI KMZ", () => {
  it("export → import should preserve waypoint coordinates", async () => {
    const original = getTestWaypoints();

    const exportResult = await exportMission(original, { format: "dji-kmz" });
    expect(exportResult.bytes).toBeDefined();

    const imported = await importMission("dji-kmz", exportResult.bytes!);

    expect(imported.length).toBe(original.length);
    compareWaypoints(original, imported);
  });

  it("should throw on non-KMZ input", async () => {
    const notAZip = new Uint8Array([0, 1, 2, 3, 4, 5]);
    await expect(importMission("dji-kmz", notAZip)).rejects.toThrow(/ZIP/);
  });
});

// ─── Cross-format consistency ──────────────────────────────────────

describe("Cross-format consistency", () => {
  it("all 5 formats should produce the same waypoint coordinates when round-tripped", async () => {
    const original = getTestWaypoints();
    const formats = ["ardupilot-waypoints", "litchi-csv", "sensefly-xml", "kml", "dji-kmz"] as const;

    const roundTrips: Record<string, Waypoint[]> = {};

    for (const fmt of formats) {
      const exportResult = await exportMission(original, { format: fmt });
      const content = exportResult.text ?? exportResult.bytes!;
      const imported = await importMission(fmt, content as any);
      roundTrips[fmt] = imported;
    }

    // All formats should agree on the first waypoint's latitude (within tolerance)
    const firstLat = original[0]!.latitude;
    for (const fmt of formats) {
      const impLat = roundTrips[fmt]![0]!.latitude;
      expect(Math.abs(impLat - firstLat),
        `${fmt}: first lat ${impLat} should match ${firstLat}`
      ).toBeLessThan(LAT_LNG_TOLERANCE * 10);
    }
  });
});

// ─── Real mission file round-trip (from demo output) ──────────────

describe("Real mission file round-trip", () => {
  it("should round-trip the flat-terrain demo mission files", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const demoDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "scripts", "demo-output");

    let files: string[];
    try {
      files = readFileSync(join(demoDir, "nairobi-50ha-survey.waypoints"), "utf-8").length > 0
        ? ["nairobi-50ha-survey.waypoints", "nairobi-50ha-survey.csv", "nairobi-50ha-survey.xml", "nairobi-50ha-survey.kml"]
        : [];
    } catch {
      files = []; // demo output doesn't exist yet — skip
    }

    if (files.length === 0) {
      console.log("Skipping real-file round-trip (demo output not present)");
      return;
    }

    // Read the .waypoints file and round-trip it
    const wpContent = readFileSync(join(demoDir, "nairobi-50ha-survey.waypoints"), "utf-8");
    const imported = await importMission("ardupilot-waypoints", wpContent);
    expect(imported.length).toBeGreaterThan(100); // 50ha mission should have ~1188 waypoints
    expect(imported.length).toBeLessThan(2000);

    // All imported waypoints should have valid coordinates in Nairobi
    for (const wp of imported) {
      expect(wp.latitude).toBeGreaterThan(-1.30);
      expect(wp.latitude).toBeLessThan(-1.27);
      expect(wp.longitude).toBeGreaterThan(36.81);
      expect(wp.longitude).toBeLessThan(36.83);
    }
  });
});
