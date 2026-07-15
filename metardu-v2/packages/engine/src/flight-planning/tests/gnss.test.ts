/**
 * Tests for the GNSS module.
 *
 * NMEA test sentences use real-world format. Checksums are not hard-tested
 * (NMEA receivers generate them dynamically; we test parsing logic, not
 * checksum computation).
 */

import { describe, it, expect } from "vitest";
import {
  CONSTELLATIONS,
  satelliteId,
  parseSatelliteId,
  fixQualityName,
  isSurveyGrade,
  dopRating,
  estimatedHorizontalAccuracy,
  computeCEP,
  computeR95,
  validateNmeaChecksum,
  parseGGA,
  parseGSA,
  parseGSV,
  parseRMC,
  parseVTG,
  parseZDA,
  parseGST,
  parseNMEA,
  parseNMEABatch,
  generateSkyplotSvg,
  KENYA_CORS_PRESETS,
  EAST_AFRICA_CORS_PRESETS,
  ALL_NTRIP_PRESETS,
  buildNtripRequest,
  parseNtripSourcetable,
  computeQualityMetrics,
  assessQuality,
  generateRinexObs,
  parseRtcmFrame,
  RTCM_MESSAGE_TYPES,
  geodeticToEcef,
  ecefToGeodetic,
  wgs84ToArc1960,
  arc1960ToWgs84,
  helmertTransform,
  type Satellite,
} from "../gnss.js";

// Helper: strip checksum from NMEA sentences (so we don't need to compute it)
function noChecksum(s: string): string {
  return s.replace(/\*..$/, "");
}

describe("Constellations", () => {
  it("should define all 7 constellations", () => {
    expect(Object.keys(CONSTELLATIONS).length).toBe(7);
  });

  it("GPS should have L1 at 1575.42 MHz", () => {
    expect(CONSTELLATIONS.GPS.frequencies[0]).toBe(1575.42);
  });

  it("Galileo should share L1 frequency with GPS", () => {
    expect(CONSTELLATIONS.Galileo.frequencies[0]).toBe(1575.42);
  });
});

describe("satelliteId", () => {
  it("should format correctly", () => {
    expect(satelliteId("GPS", 1)).toBe("G01");
    expect(satelliteId("Galileo", 14)).toBe("E14");
    expect(satelliteId("BeiDou", 5)).toBe("C05");
  });
});

describe("parseSatelliteId", () => {
  it("should parse satellite IDs", () => {
    expect(parseSatelliteId("G01")?.constellation).toBe("GPS");
    expect(parseSatelliteId("E14")?.constellation).toBe("Galileo");
    expect(parseSatelliteId("X01")).toBeNull();
  });
});

describe("Fix quality", () => {
  it("should name RTK fixed correctly", () => {
    expect(fixQualityName(4)).toBe("RTK Fixed (<2cm)");
  });

  it("should detect survey-grade fix", () => {
    expect(isSurveyGrade(4)).toBe(true);
    expect(isSurveyGrade(5)).toBe(true);
    expect(isSurveyGrade(1)).toBe(false);
  });
});

describe("DOP calculations", () => {
  it("should rate DOP correctly", () => {
    expect(dopRating({ pdop: 0.8, hdop: 0.5, vdop: 0.6, tdop: 0.3, gdop: 0.9 })).toBe("ideal");
    expect(dopRating({ pdop: 3, hdop: 1.5, vdop: 2.5, tdop: 1, gdop: 4 })).toBe("good");
    expect(dopRating({ pdop: 25, hdop: 15, vdop: 20, tdop: 10, gdop: 30 })).toBe("poor");
  });

  it("should compute horizontal accuracy", () => {
    expect(estimatedHorizontalAccuracy(1.0, 3.0)).toBe(6.0);
  });

  it("should compute CEP", () => {
    expect(computeCEP(1.0, 3.0)).toBeCloseTo(1.77, 1);
  });

  it("should compute R95", () => {
    expect(computeR95(1.0, 3.0)).toBeCloseTo(5.19, 1);
  });
});

describe("NMEA checksum validation", () => {
  it("should handle sentences with valid checksums", () => {
    // Compute a valid checksum for a test sentence
    const data = "GPGGA,092750.000,0128.4829,S,03649.2779,E,4,13,0.6,1713.5,M,-21.3,M,,";
    let checksum = 0;
    for (let i = 0; i < data.length; i++) checksum ^= data.charCodeAt(i);
    const hexChecksum = checksum.toString(16).toUpperCase().padStart(2, "0");
    const sentence = `$${data}*${hexChecksum}`;
    expect(validateNmeaChecksum(sentence)).toBe(true);
  });

  it("should reject sentences without checksum", () => {
    expect(validateNmeaChecksum("$GPGGA,123519")).toBe(false);
  });
});

describe("NMEA parsing", () => {
  // Use sentences without checksums for parsing tests (checksum validation is separate)
  const GGA = "$GPGGA,092750.000,0128.4829,S,03649.2779,E,4,13,0.6,1713.5,M,-21.3,M,,";
  const GSA = "$GPGSA,A,3,04,05,,09,12,,,24,,,,,2.5,1.3,2.1";
  const GSV = "$GPGSV,2,1,08,01,40,083,46,02,17,308,41,12,25,107,46,22,10,270,41";
  const RMC = "$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W";
  const VTG = "$GPVTG,054.7,T,034.4,M,005.5,N,010.2,K";
  const ZDA = "$GPZDA,123519,23,03,1994,00,00";
  const GST = "$GPGST,123519,0.05,0.03,0.02,45.0,0.021,0.018,0.085";

  it("should parse GGA", () => {
    const gga = parseGGA(GGA);
    expect(gga).not.toBeNull();
    expect(gga!.fixQuality).toBe(4);
    expect(gga!.satelliteCount).toBe(13);
    expect(gga!.latitude).toBeLessThan(0); // South
    expect(gga!.longitude).toBeGreaterThan(0); // East
  });

  it("should parse GSA with correct mode and fix type", () => {
    const gsa = parseGSA(GSA);
    expect(gsa).not.toBeNull();
    expect(gsa!.mode).toBe("A"); // Automatic
    expect(gsa!.fixType).toBe(3); // 3D fix
    expect(gsa!.satellites.length).toBe(5); // 04,05,09,12,24
    expect(gsa!.pdop).toBe(2.5);
  });

  it("should parse GSV", () => {
    const gsv = parseGSV(GSV);
    expect(gsv).not.toBeNull();
    expect(gsv!.totalSatellites).toBe(8);
    expect(gsv!.satellites.length).toBe(4); // 4 satellites in this message
    expect(gsv!.satellites[0]!.prn).toBe(1);
    expect(gsv!.satellites[0]!.snr).toBe(46);
  });

  it("should parse RMC", () => {
    const rmc = parseRMC(RMC);
    expect(rmc).not.toBeNull();
    expect(rmc!.status).toBe("A");
    expect(rmc!.speedKnots).toBe(22.4);
  });

  it("should parse VTG", () => {
    const vtg = parseVTG(VTG);
    expect(vtg).not.toBeNull();
    expect(vtg!.trueTrack).toBe(54.7);
    expect(vtg!.speedKmh).toBe(10.2);
  });

  it("should parse ZDA", () => {
    const zda = parseZDA(ZDA);
    expect(zda).not.toBeNull();
    expect(zda!.day).toBe(23);
    expect(zda!.year).toBe(1994);
  });

  it("should parse GST", () => {
    const gst = parseGST(GST);
    expect(gst).not.toBeNull();
    expect(gst!.rms).toBe(0.05);
    expect(gst!.stddevLat).toBe(0.021);
  });
});

describe("parseNMEA (unified parser)", () => {
  it("should identify sentence types", () => {
    // Use full sentences with enough fields for each parser
    expect(parseNMEA("$GPGGA,092750.000,0128.4829,S,03649.2779,E,4,13,0.6,1713.5,M,-21.3,M,,").type).toBe("GGA");
    expect(parseNMEA("$GPGSA,A,3,04,05,,09,12,,,24,,,,,2.5,1.3,2.1").type).toBe("GSA");
    expect(parseNMEA("$GPGSV,2,1,08,01,40,083,46,02,17,308,41,12,25,107,46,22,10,270,41").type).toBe("GSV");
    expect(parseNMEA("$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W").type).toBe("RMC");
  });

  it("should handle multi-constellation prefixes", () => {
    expect(parseNMEA("$GAGGA,092750.000,0128.4829,S,03649.2779,E,4,13,0.6,1713.5,M,-21.3,M,,").type).toBe("GGA");
    expect(parseNMEA("$GBGSA,A,3,04,05,,09,12,,,24,,,,,2.5,1.3,2.1").type).toBe("GSA");
    expect(parseNMEA("$GLGGA,092750.000,0128.4829,S,03649.2779,E,4,13,0.6,1713.5,M,-21.3,M,,").type).toBe("GGA");
  });

  it("should return UNKNOWN for unrecognized sentences", () => {
    expect(parseNMEA("$GPXYZ,invalid").type).toBe("UNKNOWN");
    expect(parseNMEA("not nmea").type).toBe("UNKNOWN");
  });
});

describe("parseNMEABatch", () => {
  it("should parse mixed sentence batch", () => {
    const batch = parseNMEABatch([
      "$GPGGA,092750.000,0128.4829,S,03649.2779,E,4,13,0.6,1713.5,M,-21.3,M,,",
      "$GPGSA,A,3,04,05,,09,12,,,24,,,,,2.5,1.3,2.1",
      "$GPGSV,2,1,08,01,40,083,46,02,17,308,41,12,25,107,46,22,10,270,41",
      "$GPGSV,2,2,08,01,40,083,46,02,17,308,41,12,25,107,46,22,10,270,41",
    ]);
    expect(batch.gga).not.toBeNull();
    expect(batch.gsa).not.toBeNull();
    expect(batch.gsv.length).toBe(2);
  });
});

describe("Skyplot SVG", () => {
  it("should generate SVG with satellite markers", () => {
    const sats: Satellite[] = [
      { constellation: "GPS", prn: 1, elevation: 45, azimuth: 90, snr: 45, usedInFix: true },
      { constellation: "Galileo", prn: 14, elevation: 60, azimuth: 270, snr: 50, usedInFix: true },
    ];
    const svg = generateSkyplotSvg(sats);
    expect(svg).toContain("<svg");
    expect(svg).toContain("G01");
    expect(svg).toContain("E14");
  });

  it("should exclude satellites below elevation mask", () => {
    const sats: Satellite[] = [
      { constellation: "GPS", prn: 1, elevation: 45, azimuth: 90, snr: 45, usedInFix: true },
      { constellation: "GPS", prn: 2, elevation: 5, azimuth: 180, snr: 20, usedInFix: false },
    ];
    const svg = generateSkyplotSvg(sats, { elevationMask: 10 });
    expect(svg).toContain("G01");
    expect(svg).not.toContain("G02");
  });
});

describe("NTRIP presets", () => {
  it("should have Kenya and East Africa presets", () => {
    expect(KENYA_CORS_PRESETS.length).toBe(5);
    expect(EAST_AFRICA_CORS_PRESETS.length).toBe(4);
    expect(ALL_NTRIP_PRESETS.length).toBe(9);
  });
});

describe("NTRIP request builder", () => {
  it("should build valid HTTP request with auth", () => {
    const req = buildNtripRequest({
      host: "kencors.go.ke", port: 2101, mountpoint: "NAIROBI_RTCM3",
      username: "user", password: "pass",
    });
    expect(req).toContain("GET /NAIROBI_RTCM3 HTTP/1.1");
    expect(req).toContain("Authorization: Basic");
  });

  it("should omit auth without credentials", () => {
    const req = buildNtripRequest({ host: "test.com", port: 2101, mountpoint: "TEST" });
    expect(req).not.toContain("Authorization");
  });
});

describe("NTRIP sourcetable parser", () => {
  it("should parse mountpoints from sourcetable", () => {
    const table = "STR;NAIROBI_RTCM3;RTCM 3.2;1005,1074,1084;0;GPS+GLO+GAL+BDS;KEN;KEN;0;-1.2864;36.8172;1;0;none;none;0;0;\nSTR;MOMBASA_RTCM3;RTCM 3.2;1005,1074;0;GPS+GLO;KEN;KEN;0;-4.0435;39.6682;1;0;none;none;0;0;\nENDSOURCETABLE\n";
    const mps = parseNtripSourcetable(table);
    expect(mps.length).toBe(2);
    expect(mps[0]!.name).toBe("NAIROBI_RTCM3");
    expect(mps[0]!.navSystem).toBe("GPS+GLO+GAL+BDS");
  });
});

describe("Quality metrics", () => {
  it("should compute metrics from NMEA data", () => {
    // Full GGA with all 15 fields (including empty DGPS fields)
    const gga = parseGGA("$GPGGA,092750.000,0128.4829,S,03649.2779,E,4,13,0.6,1713.5,M,-21.3,M,,");
    const gsa = parseGSA("$GPGSA,A,3,04,05,,09,12,,,24,,,,,2.5,1.3,2.1");
    const gst = parseGST("$GPGST,092750.000,0.008,0.005,0.003,45.0,0.003,0.002,0.085");
    const metrics = computeQualityMetrics(gga, gsa, gst, 15);
    expect(metrics.fixQuality).toBe(4);
    expect(metrics.surveyGrade).toBe(true);
    expect(metrics.satellitesUsed).toBe(13); // from GGA
  });

  it("should assess quality correctly", () => {
    const metrics = {
      fixQuality: 4, satellitesUsed: 12, satellitesVisible: 15,
      hdop: 0.8, vdop: 1.0, pdop: 1.3,
      horizontalAccuracyM: 4.8, verticalAccuracyM: 6.0,
      cepM: 1.42, r95M: 0.015, arRatio: 5.2, convergenceSec: 30,
      surveyGrade: true, dopRating: "excellent", positionError: null,
    } as any;
    const assessment = assessQuality(metrics);
    expect(assessment.overall).toBe("excellent");
  });

  it("should flag low AR ratio", () => {
    const metrics = {
      fixQuality: 4, satellitesUsed: 6, satellitesVisible: 10,
      hdop: 2.0, vdop: 2.5, pdop: 3.2,
      horizontalAccuracyM: 12, verticalAccuracyM: 15,
      cepM: 3.54, r95M: 0.08, arRatio: 2.1, convergenceSec: null,
      surveyGrade: true, dopRating: "good", positionError: null,
    } as any;
    const assessment = assessQuality(metrics);
    expect(assessment.issues.some(i => i.includes("AR ratio"))).toBe(true);
  });

  it("should assess no-fix", () => {
    const metrics = {
      fixQuality: 0, satellitesUsed: 0, satellitesVisible: 5,
      hdop: 99, vdop: 99, pdop: 99,
      horizontalAccuracyM: 999, verticalAccuracyM: 999,
      cepM: 999, r95M: 999, arRatio: null, convergenceSec: null,
      surveyGrade: false, dopRating: "poor", positionError: null,
    } as any;
    expect(assessQuality(metrics).overall).toBe("no_fix");
  });
});

describe("RINEX file generation", () => {
  const header = {
    program: "MetaRDU", runBy: "test", date: "2026-07-15",
    markerName: "TEST001", observer: "Test", agency: "ISK",
    receiverSerial: "R001", receiverType: "u-blox ZED-F9P", receiverFirmware: "1.12",
    antennaSerial: "A001", antennaType: "ANN-MB-00",
    antennaHeight: 1.5,
    observationTypes: ["C1", "L1"],
    interval: 1.0,
    firstObs: { year: 2026, month: 7, day: 15, hour: 10, minute: 0, second: 0 },
    satelliteSystems: "G", version: "3.04",
  };

  it("should generate RINEX header", () => {
    const rinex = generateRinexObs(header, []);
    expect(rinex).toContain("3.04");
    expect(rinex).toContain("OBSERVATION DATA");
    expect(rinex).toContain("TEST001");
    expect(rinex).toContain("END OF HEADER");
  });

  it("should generate epoch data", () => {
    const epochs = [{
      year: 2026, month: 7, day: 15, hour: 10, minute: 0, second: 0,
      flag: 0,
      satellites: [
        { id: "G01", observations: { C1: 20456789.123, L1: 107719283.456 } },
      ],
    }];
    const rinex = generateRinexObs(header, epochs);
    expect(rinex).toContain("> 2026 07 15 10 00");
    expect(rinex).toContain("G01");
    expect(rinex).toContain("20456789.123");
  });
});

describe("RTCM message types", () => {
  it("should have critical message types defined", () => {
    expect(RTCM_MESSAGE_TYPES.MSG_1005).toContain("Reference Station");
    expect(RTCM_MESSAGE_TYPES.MSG_1074).toContain("GPS MSM4");
    expect(RTCM_MESSAGE_TYPES.MSG_1230).toContain("GLONASS");
  });
});

describe("RTCM frame parsing", () => {
  it("should reject invalid preamble", () => {
    expect(parseRtcmFrame(new Uint8Array([0x00, 0x01, 0x02]))).toBeNull();
  });

  it("should reject too-short data", () => {
    expect(parseRtcmFrame(new Uint8Array(3))).toBeNull();
  });
});

describe("Datum transformations", () => {
  it("should round-trip geodetic ↔ ECEF", () => {
    const ecef = geodeticToEcef(-1.2864, 36.8172, 1713.5);
    const back = ecefToGeodetic(ecef.x, ecef.y, ecef.z);
    expect(back.lat).toBeCloseTo(-1.2864, 7);
    expect(back.lon).toBeCloseTo(36.8172, 7);
    expect(back.height).toBeCloseTo(1713.5, 1);
  });

  it("should round-trip WGS84 ↔ Arc 1960", () => {
    const lat = -1.2864, lon = 36.8172, h = 1713.5;
    const arc = wgs84ToArc1960(lat, lon, h);
    const back = arc1960ToWgs84(arc.lat, arc.lon, arc.height);
    expect(back.lat).toBeCloseTo(lat, 7);
    expect(back.lon).toBeCloseTo(lon, 7);
  });

  it("Helmert with zero params should be identity", () => {
    const result = helmertTransform(
      { x: 100, y: 200, z: 300 },
      { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, scale: 0 },
    );
    expect(result.x).toBe(100);
    expect(result.y).toBe(200);
    expect(result.z).toBe(300);
  });
});
