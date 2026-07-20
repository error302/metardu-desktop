import { describe, it, expect } from "vitest";
import { parseLeicaGSI, parseSokkiaSDR, parseTrimbleDC, parseRinexHeader, importFieldData } from "../instrument-import.js";

describe("Leica GSI parser", () => {
  // GSI8: each word = 8 chars (WI(2) + data(6)), space-separated
  const gsi = "11000001 21+00000 22+00000 31+12345 81+45678 82+98765 83+12345 87TOP\n11000002 21+09000 22+09000 31+23456 81+45679 82+98766 83+12346 87BOT";

  it("parses 2 points", () => {
    const r = parseLeicaGSI(gsi);
    expect(r.pointCount).toBe(2);
    expect(r.format).toContain("GSI");
  });

  it("extracts coordinates (81/82/83 → E/N/H)", () => {
    const r = parseLeicaGSI(gsi);
    const o = r.observations[0]!;
    expect(o.coordinates).toBeDefined();
    expect(o.coordinates!.easting).toBeCloseTo(45.678, 2);
    expect(o.coordinates!.northing).toBeCloseTo(98.765, 2);
  });

  it("extracts slope distance (31)", () => {
    const r = parseLeicaGSI(gsi);
    expect(r.observations[0]!.totalStation!.slopeDistance).toBeCloseTo(12.345, 2);
  });

  it("handles empty input", () => {
    expect(parseLeicaGSI("").pointCount).toBe(0);
  });
});

describe("Sokkia SDR parser", () => {
  const sdr = "06STN1,1.500\n01PT1,1000.000,2000.000,100.000,TOP\n02PT3,90.0000,90.0000,15.234,1.500,CHK\n08BM1,1.234,1.567,99.833";

  it("parses coordinate records (01)", () => {
    const r = parseSokkiaSDR(sdr);
    const pt = r.observations.find(o => o.pointId === "PT1");
    expect(pt).toBeDefined();
    expect(pt!.coordinates!.easting).toBe(1000.0);
  });

  it("parses observations (02)", () => {
    const r = parseSokkiaSDR(sdr);
    const pt = r.observations.find(o => o.pointId === "PT3");
    expect(pt!.totalStation!.horizontalAngle).toBe(90.0);
    expect(pt!.totalStation!.slopeDistance).toBe(15.234);
  });

  it("parses level records (08)", () => {
    const r = parseSokkiaSDR(sdr);
    const bm = r.observations.find(o => o.pointId === "BM1");
    expect(bm!.type).toBe("level");
    expect(bm!.level!.backsight).toBe(1.234);
  });

  it("tracks station ID (06)", () => {
    const r = parseSokkiaSDR(sdr);
    expect(r.observations.find(o => o.pointId === "PT3")!.stationId).toBe("STN1");
  });
});

describe("Trimble DC parser", () => {
  const dc = "# Trimble export\nPT1,1000.000,2000.000,100.000,90.0000,90.0000,15.234,TOP\nPT3,1020.000,2010.000,101.000,180.0000,90.0000,12.345,CHK";

  it("parses comma-separated records", () => {
    const r = parseTrimbleDC(dc);
    expect(r.pointCount).toBeGreaterThanOrEqual(2);
    expect(r.observations[0]!.pointId).toBe("PT1");
    expect(r.observations[0]!.coordinates!.easting).toBe(1000.0);
  });

  it("warns on empty input", () => {
    expect(parseTrimbleDC("# comment\n").warnings.length).toBeGreaterThan(0);
  });
});

describe("RINEX header parser", () => {
  // Each line padded to 60 chars, then label starts at index 60
  const pad = (data: string, label: string) => data.padEnd(60).slice(0, 60) + label;
  const rinex = [
    pad("     3.04           OBSERVATION DATA    M (MIXED)", "RINEX VERSION / TYPE"),
    pad("MARKER001", "MARKER NAME"),
    pad("JOHN DOE   SURVEY CO", "OBSERVER / AGENCY"),
    pad("REC001   TRIMBLE R10       5.20", "REC # / TYPE / VERS"),
    pad("ANT001   TRM115000         NONE", "ANT # / TYPE"),
    pad("   1000.0000  2000.0000   100.0000", "APPROX POSITION XYZ"),
    pad("        1.5000        0.0000        0.0000", "ANTENNA: DELTA H/E/N"),
    pad("    6    L1    L2    C1    P1    P2    D1", "# / TYPES OF OBSERV"),
    "".padEnd(60) + "END OF HEADER",
  ].join("\n");

  it("extracts marker name", () => {
    expect(parseRinexHeader(rinex).markerName).toBe("MARKER001");
  });

  it("extracts receiver type", () => {
    const h = parseRinexHeader(rinex);
    expect(h.receiverType).toBeTruthy();
  });

  it("extracts approximate position", () => {
    const h = parseRinexHeader(rinex);
    expect(h.approximatePosition.x).toBe(1000.0);
    expect(h.approximatePosition.z).toBe(100.0);
  });

  it("extracts antenna height", () => {
    expect(parseRinexHeader(rinex).antennaHeight).toBe(1.5);
  });

  it("extracts observation types", () => {
    const h = parseRinexHeader(rinex);
    expect(h.observations).toContain("L1");
    expect(h.observations.length).toBe(6);
  });
});

describe("importFieldData auto-detection", () => {
  it("detects GSI", () => {
    expect(importFieldData("f.gsi", "11000001 21+00000").format).toContain("GSI");
  });

  it("detects SDR", () => {
    expect(importFieldData("f.sdr", "01PT1,1000,2000,100").format).toBe("Sokkia SDR");
  });

  it("detects RINEX", () => {
    expect(importFieldData("f.obs", "     3.04           OBSERVATION DATA              RINEX VERSION / TYPE\n").format).toContain("RINEX");
  });

  it("detects Trimble DC", () => {
    expect(importFieldData("f.dc", "PT1,1000,2000,100").format).toContain("Trimble");
  });

  it("returns error for unknown", () => {
    const r = importFieldData("f.xyz", "hello");
    expect(r.format).toBe("unknown");
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
