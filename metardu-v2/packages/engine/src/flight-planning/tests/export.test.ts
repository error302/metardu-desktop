/**
 * Tests for all 5 mission export formats.
 *
 * Verifies:
 *   - Each format produces non-empty output
 *   - Each format round-trips the correct number of waypoints
 *   - Format-specific invariants (XML well-formedness, CSV column count, etc.)
 *   - The unified `exportMission` function dispatches correctly
 */
import { describe, it, expect } from "vitest";
import {
  generateLawnmowerWaypoints,
  computeFlightPlanParameters,
  getCameraById,
  type Waypoint,
  exportMission,
  exportDjiKmz,
  exportArduPilotWaypoints,
  exportLitchiCsv,
  exportSenseflyXml,
  exportKml,
  SUPPORTED_EXPORT_FORMATS,
} from "../../index.js";

// Helper: generate a small test mission
function getTestWaypoints(): Waypoint[] {
  const params = computeFlightPlanParameters(
    getCameraById("dji-mavic-3-enterprise"),
    75,
    0.75,
    0.65
  );
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

const TEST_WPS = getTestWaypoints();

describe("SUPPORTED_EXPORT_FORMATS", () => {
  it("should list all 5 formats", () => {
    expect(SUPPORTED_EXPORT_FORMATS.length).toBe(5);
    const formats = SUPPORTED_EXPORT_FORMATS.map((f) => f.format);
    expect(formats).toContain("dji-kmz");
    expect(formats).toContain("ardupilot-waypoints");
    expect(formats).toContain("litchi-csv");
    expect(formats).toContain("sensefly-xml");
    expect(formats).toContain("kml");
  });

  it("every format should have a unique file extension", () => {
    const exts = SUPPORTED_EXPORT_FORMATS.map((f) => f.fileExtension);
    const unique = new Set(exts);
    expect(unique.size).toBe(exts.length);
  });
});

describe("exportArduPilotWaypoints", () => {
  const content = exportArduPilotWaypoints(TEST_WPS);

  it("should start with QGC WPL 110 header", () => {
    expect(content.startsWith("QGC WPL 110")).toBe(true);
  });

  it("should have one line per waypoint + header + takeoff + RTL", () => {
    const lines = content.trim().split("\n");
    // QGC WPL 110 + takeoff + N waypoints + RTL = N + 3
    expect(lines.length).toBe(TEST_WPS.length + 3);
  });

  it("each waypoint line should have 12 tab-separated fields", () => {
    const lines = content.trim().split("\n").slice(1); // skip header
    for (const line of lines) {
      const fields = line.split("\t");
      expect(fields.length).toBe(12);
    }
  });

  it("first command after header should be MAV_CMD_NAV_TAKEOFF (22)", () => {
    const lines = content.trim().split("\n");
    const takeoffLine = lines[1]!;
    const cmd = takeoffLine.split("\t")[3]!;
    expect(cmd).toBe("22");
  });

  it("waypoint commands should be MAV_CMD_NAV_WAYPOINT (16)", () => {
    const lines = content.trim().split("\n").slice(2, 2 + TEST_WPS.length);
    for (const line of lines) {
      const cmd = line.split("\t")[3]!;
      expect(cmd).toBe("16");
    }
  });

  it("last command should be MAV_CMD_NAV_RETURN_TO_LAUNCH (21)", () => {
    const lines = content.trim().split("\n");
    const lastLine = lines[lines.length - 1]!;
    const cmd = lastLine.split("\t")[3]!;
    expect(cmd).toBe("21");
  });

  it("should throw for empty waypoints", () => {
    expect(() => exportArduPilotWaypoints([])).toThrow(/empty/);
  });
});

describe("exportLitchiCsv", () => {
  const content = exportLitchiCsv(TEST_WPS);

  it("should have a header row with the correct columns", () => {
    const lines = content.trim().split("\n");
    const header = lines[0]!;
    expect(header).toContain("latitude");
    expect(header).toContain("longitude");
    expect(header).toContain("altitude(m)");
    expect(header).toContain("heading(deg)");
    expect(header).toContain("gimbalpitch");
    expect(header).toContain("altitudemode");
    expect(header).toContain("speed(m/s)");
    expect(header).toContain("actions");
  });

  it("should have one row per waypoint plus header", () => {
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(TEST_WPS.length + 1);
  });

  it("each data row should have 10 comma-separated fields", () => {
    const lines = content.trim().split("\n").slice(1);
    for (const line of lines) {
      const fields = line.split(",");
      expect(fields.length).toBe(10);
    }
  });

  it("should throw for empty waypoints", () => {
    expect(() => exportLitchiCsv([])).toThrow(/empty/);
  });
});

describe("exportSenseflyXml", () => {
  const content = exportSenseflyXml(TEST_WPS);

  it("should be valid XML (starts with declaration, has Mission root)", () => {
    expect(content.startsWith("<?xml")).toBe(true);
    expect(content).toContain("<Mission");
    expect(content).toContain("</Mission>");
  });

  it("should contain the correct number of Waypoint elements", () => {
    const count = (content.match(/<Waypoint Index=/g) || []).length;
    expect(count).toBe(TEST_WPS.length);
  });

  it("should include Position with Latitude and Longitude", () => {
    expect(content).toContain("<Position");
    expect(content).toContain("Latitude=");
    expect(content).toContain("Longitude=");
  });

  it("should throw for empty waypoints", () => {
    expect(() => exportSenseflyXml([])).toThrow(/empty/);
  });
});

describe("exportKml", () => {
  const content = exportKml(TEST_WPS);

  it("should be valid KML (starts with declaration, has kml root)", () => {
    expect(content.startsWith("<?xml")).toBe(true);
    expect(content).toContain("<kml");
    expect(content).toContain("</kml>");
  });

  it("should contain the correct number of Placemark elements", () => {
    // N waypoint placemarks + 1 flight path placemark (default drawFlightPath=true)
    const count = (content.match(/<Placemark>/g) || []).length;
    expect(count).toBe(TEST_WPS.length + 1);
  });

  it("should include a LineString for the flight path", () => {
    expect(content).toContain("<LineString>");
  });

  it("should not include flight path when drawFlightPath is false", () => {
    const noPath = exportKml(TEST_WPS, { drawFlightPath: false });
    expect(noPath).not.toContain("<LineString>");
    const count = (noPath.match(/<Placemark>/g) || []).length;
    expect(count).toBe(TEST_WPS.length);
  });

  it("should throw for empty waypoints", () => {
    expect(() => exportKml([])).toThrow(/empty/);
  });
});

describe("exportDjiKmz", () => {
  it("should return a Uint8Array (KMZ = ZIP binary)", async () => {
    const bytes = await exportDjiKmz(TEST_WPS);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(100); // non-trivial size
  });

  it("KMZ should start with PK ZIP signature (0x504B0304)", async () => {
    const bytes = await exportDjiKmz(TEST_WPS);
    // ZIP local file header signature: 0x04034b50 (little-endian: 50 4B 03 04)
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4B); // K
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
  });

  it("should throw for empty waypoints", async () => {
    await expect(exportDjiKmz([])).rejects.toThrow(/empty/);
  });
});

describe("exportMission — unified dispatcher", () => {
  it("should dispatch to ArduPilot format", async () => {
    const result = await exportMission(TEST_WPS, { format: "ardupilot-waypoints" });
    expect(result.format).toBe("ardupilot-waypoints");
    expect(result.fileExtension).toBe(".waypoints");
    expect(result.mimeType).toBe("text/plain");
    expect(result.text).toBeDefined();
    expect(result.text!.startsWith("QGC WPL 110")).toBe(true);
  });

  it("should dispatch to Litchi CSV format", async () => {
    const result = await exportMission(TEST_WPS, { format: "litchi-csv" });
    expect(result.format).toBe("litchi-csv");
    expect(result.fileExtension).toBe(".csv");
    expect(result.mimeType).toBe("text/csv");
    expect(result.text).toBeDefined();
    expect(result.text!.startsWith("latitude,longitude")).toBe(true);
  });

  it("should dispatch to senseFly XML format", async () => {
    const result = await exportMission(TEST_WPS, { format: "sensefly-xml" });
    expect(result.format).toBe("sensefly-xml");
    expect(result.fileExtension).toBe(".xml");
    expect(result.mimeType).toBe("application/xml");
    expect(result.text).toBeDefined();
    expect(result.text!.startsWith("<?xml")).toBe(true);
  });

  it("should dispatch to KML format", async () => {
    const result = await exportMission(TEST_WPS, { format: "kml" });
    expect(result.format).toBe("kml");
    expect(result.fileExtension).toBe(".kml");
    expect(result.mimeType).toBe("application/vnd.google-earth.kml+xml");
    expect(result.text).toBeDefined();
    expect(result.text!.startsWith("<?xml")).toBe(true);
  });

  it("should dispatch to DJI KMZ format", async () => {
    const result = await exportMission(TEST_WPS, { format: "dji-kmz" });
    expect(result.format).toBe("dji-kmz");
    expect(result.fileExtension).toBe(".kmz");
    expect(result.mimeType).toBe("application/vnd.google-earth.kmz");
    expect(result.bytes).toBeDefined();
    expect(result.bytes![0]).toBe(0x50); // PK signature
  });

  it("should throw for unknown format", async () => {
    // @ts-expect-error testing runtime error for unknown format
    await expect(exportMission(TEST_WPS, { format: "nonexistent" })).rejects.toThrow();
  });
});

// ─── Integration test: end-to-end mission generation + export ───────
describe("end-to-end: 50ha Nairobi survey with all 5 exports", () => {
  it("should generate waypoints and export to all 5 formats without error", async () => {
    const wps = getTestWaypoints();
    expect(wps.length).toBeGreaterThan(10);

    for (const fmt of SUPPORTED_EXPORT_FORMATS) {
      const result = await exportMission(wps, { format: fmt.format } as any);
      expect(result.format).toBe(fmt.format);
      expect(result.fileExtension).toBe(fmt.fileExtension);

      if (result.text) {
        expect(result.text.length).toBeGreaterThan(100);
      }
      if (result.bytes) {
        expect(result.bytes.length).toBeGreaterThan(100);
      }
    }
  });
});
