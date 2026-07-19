/**
 * GNSS (Global Navigation Satellite System) module for MetaRDU Desktop v2.0.
 *
 * Provides survey-grade GNSS capabilities:
 *   - Multi-constellation support (GPS, GLONASS, Galileo, BeiDou, QZSS, IRNSS, SBAS)
 *   - NMEA sentence parsing (GGA, GSA, GSV, RMC, VTG, ZDA, GST)
 *   - RTCM v3 message decoding (MSM for all constellations)
 *   - NTRIP v2 client (caster connection, sourcetable parsing)
 *   - Satellite skyplot generation (SVG polar plot)
 *   - DOP/precision computation (HDOP, VDOP, PDOP, CEP, R95)
 *   - RINEX observation file writing (for PPK post-processing)
 *   - Quality control (multipath, cycle slip, AR ratio, convergence)
 *   - Kenya CORS preset database
 *
 * References:
 *   - NMEA 0183 Standard: https://www.nmea.org/content/STANDARDS/NMEA_0183_Standard
 *   - RTCM 10410.1 (RTCM v3.3): https://www.rtcm.org/standard-10410-1-
 *   - RINEX 3.04: https://files.igs.org/pub/data/format/rinex304.pdf
 *   - ITRF2014: https://itrf.ign.fr/ITRF_solutions/2014/
 *   - Kenya CORS: https://kencors.go.ke/
 */

// ═══════════════════════════════════════════════════════════════════
// PART 1: CONSTELLATIONS AND SATELLITES
// ═══════════════════════════════════════════════════════════════════

/** GNSS constellation identifiers. */
export type Constellation =
  | "GPS"        // US Navstar GPS (PRN 1-32)
  | "GLONASS"    // Russian GLONASS (Slot 1-24)
  | "Galileo"    // European Galileo (PRN 1-36)
  | "BeiDou"     // Chinese BeiDou (PRN 1-63)
  | "QZSS"       // Japanese QZSS (PRN 193-202)
  | "IRNSS"      // Indian NavIC (PRN 1-14)
  | "SBAS";      // SBAS (WAAS/EGNOS/MSAS/GAGAN, PRN 120-151)

/** Constellation metadata. */
export interface ConstellationInfo {
  id: Constellation;
  name: string;
  agency: string;
  country: string;
  /** RINEX satellite system code (G, R, E, C, J, I, S) */
  rinexCode: string;
  /** NMEA talker ID prefix (GP, GL, GA, GB, GQ, GI) */
  nmeaPrefix: string;
  /** Maximum PRN/slot number */
  maxPrn: number;
  /** Carrier frequencies (MHz) */
  frequencies: number[];
  /** Orbital altitude (km) */
  altitudeKm: number;
  /** Orbital period (hours) */
  orbitalPeriodH: number;
}

export const CONSTELLATIONS: Record<Constellation, ConstellationInfo> = {
  GPS: {
    id: "GPS", name: "Navstar GPS", agency: "US Space Force", country: "USA",
    rinexCode: "G", nmeaPrefix: "GP", maxPrn: 32,
    frequencies: [1575.42, 1227.60, 1176.45, 1381.05],
    altitudeKm: 20180, orbitalPeriodH: 11.967,
  },
  GLONASS: {
    id: "GLONASS", name: "GLONASS", agency: "Roscosmos", country: "Russia",
    rinexCode: "R", nmeaPrefix: "GL", maxPrn: 24,
    frequencies: [1602.0, 1246.0], // FDMA — channel-dependent
    altitudeKm: 19130, orbitalPeriodH: 11.267,
  },
  Galileo: {
    id: "Galileo", name: "Galileo", agency: "EUSPA", country: "EU",
    rinexCode: "E", nmeaPrefix: "GA", maxPrn: 36,
    frequencies: [1575.42, 1278.75, 1207.14, 1176.45],
    altitudeKm: 23222, orbitalPeriodH: 14.08,
  },
  BeiDou: {
    id: "BeiDou", name: "BeiDou (BDS)", agency: "CSNO", country: "China",
    rinexCode: "C", nmeaPrefix: "GB", maxPrn: 63,
    frequencies: [1561.098, 1589.742, 1207.14, 1268.52, 1176.45],
    altitudeKm: 21528, orbitalPeriodH: 12.63, // MEO; IGSO/GEO differ
  },
  QZSS: {
    id: "QZSS", name: "QZSS (Michibiki)", agency: "JAXA", country: "Japan",
    rinexCode: "J", nmeaPrefix: "GQ", maxPrn: 10,
    frequencies: [1575.42, 1227.60, 1176.45, 1278.75, 1381.05],
    altitudeKm: 32000, orbitalPeriodH: 23.93, // IGSO
  },
  IRNSS: {
    id: "IRNSS", name: "NavIC (IRNSS)", agency: "ISRO", country: "India",
    rinexCode: "I", nmeaPrefix: "GI", maxPrn: 14,
    frequencies: [1575.42, 2492.028],
    altitudeKm: 36000, orbitalPeriodH: 23.93, // GEO/IGSO
  },
  SBAS: {
    id: "SBAS", name: "SBAS (WAAS/EGNOS)", agency: "FAA/ESSP", country: "Multi",
    rinexCode: "S", nmeaPrefix: "GP", maxPrn: 39, // PRN 120-158 (offset by 87 in RINEX)
    frequencies: [1575.42],
    altitudeKm: 36000, orbitalPeriodH: 23.93, // GEO
  },
};

/** A satellite visible in the sky. */
export interface Satellite {
  /** Constellation */
  constellation: Constellation;
  /** PRN or slot number */
  prn: number;
  /** Elevation in degrees (0=horizon, 90=zenith) */
  elevation: number;
  /** Azimuth in degrees (0=north, 90=east, 180=south, 270=west) */
  azimuth: number;
  /** Signal-to-noise ratio (dB-Hz) */
  snr: number;
  /** Whether this satellite is used in the position fix */
  usedInFix: boolean;
  /** Optional: L1/L2/L5 carrier lock status */
  l1Locked?: boolean;
  l2Locked?: boolean;
  l5Locked?: boolean;
}

/** Satellite vehicle identifier (constellation + PRN). */
export function satelliteId(constellation: Constellation, prn: number): string {
  return `${CONSTELLATIONS[constellation].rinexCode}${String(prn).padStart(2, "0")}`;
}

/** Parse a satellite ID (e.g., "G01" → GPS PRN 1, "E14" → Galileo PRN 14). */
export function parseSatelliteId(id: string): { constellation: Constellation; prn: number } | null {
  const code = id[0]!.toUpperCase();
  const prn = parseInt(id.slice(1), 10);
  if (isNaN(prn)) return null;

  for (const [name, info] of Object.entries(CONSTELLATIONS)) {
    if (info.rinexCode === code) {
      return { constellation: name as Constellation, prn };
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// PART 2: FIX STATUS AND DOP
// ═══════════════════════════════════════════════════════════════════

/** GNSS fix quality (from NMEA GGA sentence). */
export type FixQuality =
  | 0  // Invalid (no fix)
  | 1  // GPS SPS (standard positioning — ~3-10m)
  | 2  // DGPS (differential — ~0.5-3m)
  | 3  // PPS (precise positioning service — military)
  | 4  // RTK fixed (centimeter-level — <2cm)
  | 5  // RTK float (decimeter-level — ~20cm-1m)
  | 6  // Dead reckoning
  | 7  // Manual input
  | 8  // Simulation
  | 9  // WAAS/EGNOS (SBAS-corrected — ~0.5-2m);

/** Fix quality as human-readable string. */
export function fixQualityName(quality: FixQuality): string {
  const names: Record<number, string> = {
    0: "No Fix",
    1: "GPS SPS (3-10m)",
    2: "DGPS (0.5-3m)",
    3: "PPS (military)",
    4: "RTK Fixed (<2cm)",
    5: "RTK Float (20cm-1m)",
    6: "Dead Reckoning",
    7: "Manual",
    8: "Simulation",
    9: "SBAS (0.5-2m)",
  };
  return names[quality] ?? "Unknown";
}

/** Whether the fix quality is survey-grade (RTK or better). */
export function isSurveyGrade(quality: FixQuality): boolean {
  return quality === 4 || quality === 5;
}

/** Dilution of Precision. */
export interface DOP {
  /** Position DOP (3D) — overall geometry quality */
  pdop: number;
  /** Horizontal DOP (2D — lat/lng) */
  hdop: number;
  /** Vertical DOP (height) */
  vdop: number;
  /** Time DOP */
  tdop: number;
  /** Geometric DOP (all 4 dimensions) */
  gdop: number;
}

/** DOP quality rating. */
export function dopRating(dop: DOP): "ideal" | "excellent" | "good" | "moderate" | "fair" | "poor" {
  const p = dop.pdop;
  if (p < 1) return "ideal";
  if (p < 2) return "excellent";
  if (p < 5) return "good";
  if (p < 10) return "moderate";
  if (p < 20) return "fair";
  return "poor";
}

/** Compute estimated horizontal accuracy from HDOP and UERE. */
export function estimatedHorizontalAccuracy(hdop: number, uereM: number = 3.0): number {
  // 2DRMS = 2 × HDOP × UERE
  return 2 * hdop * uereM;
}

/** Compute estimated vertical accuracy from VDOP and UERE. */
export function estimatedVerticalAccuracy(vdop: number, uereM: number = 3.0): number {
  return 2 * vdop * uereM;
}

/** Compute Circular Error Probable (CEP, 50% confidence) from HDOP and UERE. */
export function computeCEP(hdop: number, uereM: number = 3.0): number {
  // CEP ≈ 0.59 × HDOP × UERE
  return 0.59 * hdop * uereM;
}

/** Compute R95 (95% confidence radius) from HDOP and UERE. */
export function computeR95(hdop: number, uereM: number = 3.0): number {
  // R95 ≈ 1.73 × HDOP × UERE (for 2D)
  return 1.73 * hdop * uereM;
}

// ═══════════════════════════════════════════════════════════════════
// PART 3: NMEA SENTENCE PARSING
// ═══════════════════════════════════════════════════════════════════

/** Parsed GGA (Global Positioning System Fix Data) sentence. */
export interface GGA {
  time: string;           // UTC time hhmmss.sss
  latitude: number;       // decimal degrees (positive = north)
  longitude: number;      // decimal degrees (positive = east)
  fixQuality: FixQuality;
  satelliteCount: number;  // number of satellites used in fix
  hdop: number;
  altitude: number;       // meters above mean sea level
  altitudeUnits: string;  // "M"
  geoidSeparation: number; // meters (ellipsoid - geoid)
  geoidUnits: string;
  dgpsAge: number | null;  // seconds since last DGPS correction
  dgpsStationId: string | null;
}

/** Parsed GSA (Satellites and DOP) sentence. */
export interface GSA {
  mode: "A" | "M";        // A=automatic, M=manual
  fixType: 1 | 2 | 3;     // 1=no fix, 2=2D, 3=3D
  satellites: string[];   // satellite PRNs used in fix
  pdop: number;
  hdop: number;
  vdop: number;
}

/** Parsed GSV (Satellites in View) sentence. */
export interface GSV {
  totalMessages: number;
  messageNumber: number;
  totalSatellites: number;
  satellites: Array<{
    prn: number;
    elevation: number;    // degrees (0-90)
    azimuth: number;      // degrees (0-359)
    snr: number | null;   // dB-Hz (null = not tracking)
  }>;
}

/** Parsed RMC (Recommended Minimum) sentence. */
export interface RMC {
  time: string;
  status: "A" | "V";      // A=active (valid), V=void
  latitude: number;
  longitude: number;
  speedKnots: number;
  course: number;         // heading in degrees
  date: string;           // ddmmyy
  magneticVariation: number | null;
  magneticVariationDir: "E" | "W" | null;
}

/** Parsed VTG (Track Made Good) sentence. */
export interface VTG {
  trueTrack: number;
  trueTrackText: string;  // "T"
  magneticTrack: number | null;
  magneticTrackText: string; // "M"
  speedKnots: number;
  speedKnotsText: string; // "N"
  speedKmh: number;
  speedKmhText: string;   // "K"
}

/** Parsed ZDA (Time and Date) sentence. */
export interface ZDA {
  time: string;
  day: number;
  month: number;
  year: number;
  localZoneHours: number;
  localZoneMinutes: number;
}

/** Parsed GST (Position Error Statistics) sentence. */
export interface GST {
  time: string;
  rms: number;            // RMS value of the standard deviation of the range inputs
  stddevMajor: number;    // Standard deviation of semi-major axis of error ellipse
  stddevMinor: number;    // Standard deviation of semi-minor axis of error ellipse
  orientation: number;    // Orientation of semi-major axis (degrees from true north)
  stddevLat: number;      // Standard deviation of latitude error (meters)
  stddevLng: number;      // Standard deviation of longitude error (meters)
  stddevAlt: number;      // Standard deviation of altitude error (meters)
}

/** NMEA checksum validation. */
export function validateNmeaChecksum(sentence: string): boolean {
  const starIdx = sentence.indexOf("*");
  if (starIdx === -1) return false;

  const data = sentence.substring(1, starIdx); // skip leading '$'
  const checksum = parseInt(sentence.substring(starIdx + 1, starIdx + 3), 16);

  let computed = 0;
  for (let i = 0; i < data.length; i++) {
    computed ^= data.charCodeAt(i);
  }

  return computed === checksum;
}

/** Convert NMEA coordinate format (ddmm.mmmm) to decimal degrees. */
function nmeaToDecimal(value: string, direction: string): number {
  if (!value) return 0;
  const dot = value.indexOf(".");
  const degLen = dot <= 4 ? 2 : 3; // 2 for latitude, 3 for longitude
  const deg = parseInt(value.substring(0, degLen), 10);
  const min = parseFloat(value.substring(degLen));
  const decimal = deg + min / 60;
  return direction === "S" || direction === "W" ? -decimal : decimal;
}

/** Parse an NMEA GGA sentence. */
export function parseGGA(sentence: string): GGA | null {
  // $GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,47.0,M,,*47
  const parts = sentence.split(",");
  if (parts.length < 15) return null;

  return {
    time: parts[1] ?? "",
    latitude: nmeaToDecimal(parts[2] ?? "", parts[3] ?? "N"),
    longitude: nmeaToDecimal(parts[4] ?? "", parts[5] ?? "E"),
    fixQuality: parseInt(parts[6] ?? "0", 10) as FixQuality,
    satelliteCount: parseInt(parts[7] ?? "0", 10),
    hdop: parseFloat(parts[8] ?? "0"),
    altitude: parseFloat(parts[9] ?? "0"),
    altitudeUnits: parts[10] ?? "M",
    geoidSeparation: parseFloat(parts[11] ?? "0"),
    geoidUnits: parts[12] ?? "M",
    dgpsAge: parts[13] ? parseFloat(parts[13]) : null,
    dgpsStationId: parts[14]?.split("*")[0] || null,
  };
}

/** Parse an NMEA GSA sentence. */
export function parseGSA(sentence: string): GSA | null {
  // $GPGSA,A,3,04,05,,09,12,,,24,,,,,2.5,1.3,2.1*39
  const parts = sentence.split(",");
  if (parts.length < 18) return null;

  const satellites: string[] = [];
  for (let i = 3; i < 15; i++) {
    const part = parts[i];
    if (part && part.trim()) {
      satellites.push(part.trim());
    }
  }

  return {
    mode: (parts[1] ?? "A") as "A" | "M",
    fixType: parseInt(parts[2] ?? "1", 10) as 1 | 2 | 3,
    satellites,
    pdop: parseFloat(parts[15] ?? "0"),
    hdop: parseFloat(parts[16] ?? "0"),
    vdop: parseFloat(parts[17]?.split("*")[0] ?? "0"),
  };
}

/** Parse an NMEA GSV sentence. */
export function parseGSV(sentence: string): GSV | null {
  // $GPGSV,2,1,08,01,40,083,46,02,17,308,41,12,25,107,46,22,10,270,41*75
  const parts = sentence.split(",");
  if (parts.length < 8) return null;

  const totalMessages = parseInt(parts[1] ?? "1", 10);
  const messageNumber = parseInt(parts[2] ?? "1", 10);
  const totalSatellites = parseInt(parts[3] ?? "0", 10);

  const satellites: GSV["satellites"] = [];
  // Each satellite uses 4 fields: PRN, elevation, azimuth, SNR
  for (let i = 4; i + 3 < parts.length; i += 4) {
    const snrStr = parts[i + 3]?.split("*")[0] ?? "";
    satellites.push({
      prn: parseInt(parts[i] ?? "0", 10),
      elevation: parseInt(parts[i + 1] ?? "0", 10),
      azimuth: parseInt(parts[i + 2] ?? "0", 10),
      snr: snrStr ? parseInt(snrStr, 10) : null,
    });
  }

  return { totalMessages, messageNumber, totalSatellites, satellites };
}

/** Parse an NMEA RMC sentence. */
export function parseRMC(sentence: string): RMC | null {
  // $GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A
  const parts = sentence.split(",");
  if (parts.length < 12) return null;

  return {
    time: parts[1] ?? "",
    status: (parts[2] ?? "V") as "A" | "V",
    latitude: nmeaToDecimal(parts[3] ?? "", parts[4] ?? "N"),
    longitude: nmeaToDecimal(parts[5] ?? "", parts[6] ?? "E"),
    speedKnots: parseFloat(parts[7] ?? "0"),
    course: parseFloat(parts[8] ?? "0"),
    date: parts[9] ?? "",
    magneticVariation: parts[10] ? parseFloat(parts[10]) : null,
    magneticVariationDir: (parts[11]?.split("*")[0] as "E" | "W") || null,
  };
}

/** Parse an NMEA VTG sentence. */
export function parseVTG(sentence: string): VTG | null {
  // $GPVTG,054.7,T,034.4,M,005.5,N,010.2,K*48
  const parts = sentence.split(",");
  if (parts.length < 9) return null;

  return {
    trueTrack: parseFloat(parts[1] ?? "0"),
    trueTrackText: parts[2] ?? "T",
    magneticTrack: parts[3] ? parseFloat(parts[3]) : null,
    magneticTrackText: parts[4] ?? "M",
    speedKnots: parseFloat(parts[5] ?? "0"),
    speedKnotsText: parts[6] ?? "N",
    speedKmh: parseFloat(parts[7] ?? "0"),
    speedKmhText: parts[8]?.split("*")[0] ?? "K",
  };
}

/** Parse an NMEA ZDA sentence. */
export function parseZDA(sentence: string): ZDA | null {
  // $GPZDA,123519,23,03,1994,00,00*6C
  const parts = sentence.split(",");
  if (parts.length < 7) return null;

  return {
    time: parts[1] ?? "",
    day: parseInt(parts[2] ?? "1", 10),
    month: parseInt(parts[3] ?? "1", 10),
    year: parseInt(parts[4] ?? "2000", 10),
    localZoneHours: parseInt(parts[5] ?? "0", 10),
    localZoneMinutes: parseInt(parts[6]?.split("*")[0] ?? "0", 10),
  };
}

/** Parse an NMEA GST sentence. */
export function parseGST(sentence: string): GST | null {
  // $GPGST,123519,0.05,0.03,0.02,45.0,0.021,0.018,0.085*5A
  const parts = sentence.split(",");
  if (parts.length < 9) return null;

  return {
    time: parts[1] ?? "",
    rms: parseFloat(parts[2] ?? "0"),
    stddevMajor: parseFloat(parts[3] ?? "0"),
    stddevMinor: parseFloat(parts[4] ?? "0"),
    orientation: parseFloat(parts[5] ?? "0"),
    stddevLat: parseFloat(parts[6] ?? "0"),
    stddevLng: parseFloat(parts[7] ?? "0"),
    stddevAlt: parseFloat(parts[8]?.split("*")[0] ?? "0"),
  };
}

/** Parse any NMEA sentence and return the typed result. */
export function parseNMEA(sentence: string):
  | { type: "GGA"; data: GGA }
  | { type: "GSA"; data: GSA }
  | { type: "GSV"; data: GSV }
  | { type: "RMC"; data: RMC }
  | { type: "VTG"; data: VTG }
  | { type: "ZDA"; data: ZDA }
  | { type: "GST"; data: GST }
  | { type: "UNKNOWN"; data: null }
{
  const trimmed = sentence.trim();
  if (!trimmed.startsWith("$")) return { type: "UNKNOWN", data: null };

  // Extract sentence type from talker ID + type (e.g., "GPGGA" → "GGA")
  const talkerType = trimmed.substring(1, 6).toUpperCase();

  // Normalize: strip talker prefix, keep sentence type
  const sentenceType = talkerType.substring(2); // "GPGGA" → "GGA"

  switch (sentenceType) {
    case "GGA": { const d = parseGGA(trimmed); return d ? { type: "GGA", data: d } : { type: "UNKNOWN", data: null }; }
    case "GSA": { const d = parseGSA(trimmed); return d ? { type: "GSA", data: d } : { type: "UNKNOWN", data: null }; }
    case "GSV": { const d = parseGSV(trimmed); return d ? { type: "GSV", data: d } : { type: "UNKNOWN", data: null }; }
    case "RMC": { const d = parseRMC(trimmed); return d ? { type: "RMC", data: d } : { type: "UNKNOWN", data: null }; }
    case "VTG": { const d = parseVTG(trimmed); return d ? { type: "VTG", data: d } : { type: "UNKNOWN", data: null }; }
    case "ZDA": { const d = parseZDA(trimmed); return d ? { type: "ZDA", data: d } : { type: "UNKNOWN", data: null }; }
    case "GST": { const d = parseGST(trimmed); return d ? { type: "GST", data: d } : { type: "UNKNOWN", data: null }; }
    default: return { type: "UNKNOWN", data: null };
  }
}

/** Parse a batch of NMEA sentences. */
export function parseNMEABatch(sentences: string[]): {
  gga: GGA | null;
  gsa: GSA | null;
  gsv: GSV[];
  rmc: RMC | null;
  vtg: VTG | null;
  zda: ZDA | null;
  gst: GST | null;
} {
  const result = {
    gga: null as GGA | null,
    gsa: null as GSA | null,
    gsv: [] as GSV[],
    rmc: null as RMC | null,
    vtg: null as VTG | null,
    zda: null as ZDA | null,
    gst: null as GST | null,
  };

  for (const s of sentences) {
    const parsed = parseNMEA(s);
    switch (parsed.type) {
      case "GGA": result.gga = parsed.data; break;
      case "GSA": result.gsa = parsed.data; break;
      case "GSV": result.gsv.push(parsed.data); break;
      case "RMC": result.rmc = parsed.data; break;
      case "VTG": result.vtg = parsed.data; break;
      case "ZDA": result.zda = parsed.data; break;
      case "GST": result.gst = parsed.data; break;
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════
// PART 4: SATELLITE SKYPLOT GENERATOR
// ═══════════════════════════════════════════════════════════════════

/** Generate an SVG skyplot showing satellite positions. */
export function generateSkyplotSvg(satellites: Satellite[], options: {
  size?: number;
  showLabels?: boolean;
  elevationMask?: number;
} = {}): string {
  const size = options.size ?? 400;
  const showLabels = options.showLabels ?? true;
  const elevationMask = options.elevationMask ?? 10;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 30;

  // Elevation rings (90°, 60°, 30°, 0°)
  const rings = [0, 30, 60, 90].map(elev => {
    const ringR = r * (1 - elev / 90);
    return `<circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none" stroke="#ccc" stroke-width="0.5"/>
            <text x="${cx + 3}" y="${cy - ringR + 10}" font-size="8" fill="#999">${elev}°</text>`;
  }).join("");

  // Azimuth lines (N, NE, E, SE, S, SW, W, NW)
  const azimuthLines = [0, 45, 90, 135, 180, 225, 270, 315].map(az => {
    const rad = (az - 90) * Math.PI / 180; // -90 because SVG y-axis is down
    const x = cx + r * Math.cos(rad);
    const y = cy + r * Math.sin(rad);
    const labelX = cx + (r + 15) * Math.cos(rad);
    const labelY = cy + (r + 15) * Math.sin(rad);
    const labels: Record<number, string> = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
    return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#eee" stroke-width="0.3"/>
            <text x="${labelX}" y="${labelY}" text-anchor="middle" dominant-baseline="central" font-size="9" font-weight="bold" fill="#666">${labels[az]}</text>`;
  }).join("");

  // Satellite markers
  const satMarkers = satellites.map(sat => {
    // Skip satellites below the elevation mask
    if (sat.elevation < elevationMask) return "";

    const rad = (sat.azimuth - 90) * Math.PI / 180;
    const satR = r * (1 - sat.elevation / 90);
    const x = cx + satR * Math.cos(rad);
    const y = cy + satR * Math.sin(rad);

    // Color by SNR quality
    let color = "#ccc";
    if (sat.snr >= 45) color = "#22c55e"; // green — excellent
    else if (sat.snr >= 35) color = "#3b82f6"; // blue — good
    else if (sat.snr >= 25) color = "#f59e0b"; // amber — moderate
    else if (sat.snr >= 15) color = "#ef4444"; // red — weak
    else color = "#9ca3af"; // gray — no signal

    const label = satelliteId(sat.constellation, sat.prn);

    // Filled circle if used in fix, open circle if not
    const fill = sat.usedInFix ? color : "white";

    return `<circle cx="${x}" cy="${y}" r="6" fill="${fill}" stroke="${color}" stroke-width="1.5"/>
            ${showLabels ? `<text x="${x}" y="${y - 9}" text-anchor="middle" font-size="7" font-weight="bold" fill="#333">${label}</text>` : ""}`;
  }).join("");

  // Elevation mask zone (shaded below the mask)
  const maskR = r * (1 - elevationMask / 90);
  const maskZone = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f5f5f5"/>
                    <circle cx="${cx}" cy="${cy}" r="${maskR}" fill="white"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" font-family="Arial, sans-serif">
    <!-- Background and elevation mask -->
    ${maskZone}
    <!-- Elevation rings -->
    ${rings}
    <!-- Azimuth lines -->
    ${azimuthLines}
    <!-- Outer circle -->
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#333" stroke-width="1"/>
    <!-- Satellites -->
    ${satMarkers}
    <!-- Title -->
    <text x="${cx}" y="${size - 5}" text-anchor="middle" font-size="10" fill="#666">Skyplot (${satellites.filter(s => s.elevation >= elevationMask).length} satellites above ${elevationMask}°)</text>
  </svg>`;
}

// ═══════════════════════════════════════════════════════════════════
// PART 5: NTRIP CLIENT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

/** NTRIP caster connection parameters. */
export interface NtripCasterConfig {
  /** Caster hostname or IP */
  host: string;
  /** Caster port (default 2101) */
  port: number;
  /** Mountpoint name (e.g., "KEN01_RTCM3") */
  mountpoint: string;
  /** Username (if authentication required) */
  username?: string;
  /** Password */
  password?: string;
  /** Requested RTCM version (default "3") */
  rtcmVersion?: "2" | "3";
  /** NMEA GGA string to send to the caster (for VRS networks) */
  nmeaGga?: string;
}

/** NTRIP sourcetable entry (from the caster's mountpoint list). */
export interface NtripMountpoint {
  name: string;
  format: string;        // "RTCM 3.2" etc.
  formatDetails: string;
  carrier: string;       // "L1+L2" etc.
  navSystem: string;     // "GPS+GLO+GAL+BDS"
  network: string;
  country: string;
  latitude: number;
  longitude: number;
  nmeaRequired: boolean; // whether the rover must send NMEA GGA
  solution: string;      // "no" = single base, "yes" = network
}

/** Kenya CORS NTRIP presets. */
export const KENYA_CORS_PRESETS: readonly NtripCasterConfig[] = [
  {
    host: "kencors.go.ke",
    port: 2101,
    mountpoint: "NAIROBI_RTCM3",
    username: "", // User must register at kencors.go.ke
    password: "",
    rtcmVersion: "3",
  },
  {
    host: "kencors.go.ke",
    port: 2101,
    mountpoint: "MOMBASA_RTCM3",
    rtcmVersion: "3",
  },
  {
    host: "kencors.go.ke",
    port: 2101,
    mountpoint: "NAKURU_RTCM3",
    rtcmVersion: "3",
  },
  {
    host: "kencors.go.ke",
    port: 2101,
    mountpoint: "KISUMU_RTCM3",
    rtcmVersion: "3",
  },
  {
    host: "kencors.go.ke",
    port: 2101,
    mountpoint: "ELDORET_RTCM3",
    rtcmVersion: "3",
  },
] as const;

/** Additional regional NTRIP casters (East Africa). */
export const EAST_AFRICA_CORS_PRESETS: readonly NtripCasterConfig[] = [
  {
    host: "ntrip.pec.go.tz",
    port: 2101,
    mountpoint: "DAR_ES_SALAAM",
    rtcmVersion: "3",
  },
  {
    host: "ntrip.pec.go.tz",
    port: 2101,
    mountpoint: "ARUSHA",
    rtcmVersion: "3",
  },
  {
    host: "ntrip.unma.or.ug",
    port: 2101,
    mountpoint: "KAMPALA",
    rtcmVersion: "3",
  },
  {
    host: "ntrip.rwb.rw",
    port: 2101,
    mountpoint: "KIGALI",
    rtcmVersion: "3",
  },
] as const;

/** All available NTRIP presets. */
export const ALL_NTRIP_PRESETS: readonly NtripCasterConfig[] = [
  ...KENYA_CORS_PRESETS,
  ...EAST_AFRICA_CORS_PRESETS,
] as const;

/** Build the NTRIP HTTP request for connecting to a mountpoint. */
export function buildNtripRequest(config: NtripCasterConfig): string {
  const auth = config.username
    ? `Authorization: Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}\r\n`
    : "";

  const gga = config.nmeaGga ? `${config.nmeaGga}\r\n` : "";

  return (
    `GET /${config.mountpoint} HTTP/1.1\r\n` +
    `Host: ${config.host}:${config.port}\r\n` +
    `User-Agent: MetaRDU/2.0\r\n` +
    auth +
    `Ntrip-Version: Ntrip/2.0\r\n` +
    `Connection: close\r\n\r\n` +
    gga
  );
}

/** Parse an NTRIP sourcetable response. */
export function parseNtripSourcetable(response: string): NtripMountpoint[] {
  const lines = response.split("\n");
  const mountpoints: NtripMountpoint[] = [];

  for (const line of lines) {
    if (!line.startsWith("STR;")) continue;

    const fields = line.split(";");
    if (fields.length < 11) continue;

    mountpoints.push({
      name: fields[1] ?? "",
      format: fields[2] ?? "",
      formatDetails: fields[3] ?? "",
      carrier: fields[4] ?? "",
      navSystem: fields[5] ?? "",
      network: fields[6] ?? "",
      country: fields[7] ?? "",
      latitude: parseFloat(fields[8] ?? "0"),
      longitude: parseFloat(fields[9] ?? "0"),
      nmeaRequired: (fields[10] ?? "0") === "1",
      solution: fields[11] ?? "no",
    });
  }

  return mountpoints;
}

// ═══════════════════════════════════════════════════════════════════
// PART 6: GNSS QUALITY CONTROL
// ═══════════════════════════════════════════════════════════════════

/** GNSS quality metrics for the current session. */
export interface GnssQualityMetrics {
  /** Current fix quality (from GGA) */
  fixQuality: FixQuality;
  /** Number of satellites used in fix */
  satellitesUsed: number;
  /** Number of satellites visible (above elevation mask) */
  satellitesVisible: number;
  /** HDOP (horizontal dilution of precision) */
  hdop: number;
  /** VDOP (vertical dilution of precision) */
  vdop: number;
  /** PDOP (position dilution of precision) */
  pdop: number;
  /** Estimated horizontal accuracy (2DRMS, meters) */
  horizontalAccuracyM: number;
  /** Estimated vertical accuracy (meters) */
  verticalAccuracyM: number;
  /** CEP (50% confidence, meters) */
  cepM: number;
  /** R95 (95% confidence radius, meters) */
  r95M: number;
  /** Ambiguity resolution ratio (AR ratio — should be >3 for reliable fix) */
  arRatio: number | null;
  /** Convergence time (seconds since reaching RTK fix) */
  convergenceSec: number | null;
  /** Whether the fix is survey-grade */
  surveyGrade: boolean;
  /** DOP quality rating */
  dopRating: string;
  /** GNSS receiver position error (from GST, if available) */
  positionError: {
    rms: number;
    stddevLat: number;
    stddevLng: number;
    stddevAlt: number;
  } | null;
}

/** Compute quality metrics from NMEA data. */
export function computeQualityMetrics(
  gga: GGA | null,
  gsa: GSA | null,
  gst: GST | null,
  satellitesVisible: number,
  arRatio?: number | null,
  convergenceSec?: number | null,
): GnssQualityMetrics {
  const fixQuality = gga?.fixQuality ?? 0;
  const hdop = gga?.hdop ?? gsa?.hdop ?? 99;
  const vdop = gsa?.vdop ?? 99;
  const pdop = gsa?.pdop ?? 99;

  const uereM = 3.0; // User Equivalent Range Error (typical for multi-constellation)

  const metrics: GnssQualityMetrics = {
    fixQuality,
    satellitesUsed: gga?.satelliteCount ?? gsa?.satellites.length ?? 0,
    satellitesVisible,
    hdop,
    vdop,
    pdop,
    horizontalAccuracyM: estimatedHorizontalAccuracy(hdop, uereM),
    verticalAccuracyM: estimatedVerticalAccuracy(vdop, uereM),
    cepM: computeCEP(hdop, uereM),
    r95M: computeR95(hdop, uereM),
    arRatio: arRatio ?? null,
    convergenceSec: convergenceSec ?? null,
    surveyGrade: isSurveyGrade(fixQuality),
    dopRating: dopRating({ pdop, hdop, vdop, tdop: 0, gdop: 0 }),
    positionError: gst ? {
      rms: gst.rms,
      stddevLat: gst.stddevLat,
      stddevLng: gst.stddevLng,
      stddevAlt: gst.stddevAlt,
    } : null,
  };

  return metrics;
}

/** Generate a quality assessment summary. */
export function assessQuality(metrics: GnssQualityMetrics): {
  overall: "excellent" | "good" | "moderate" | "poor" | "no_fix";
  recommendation: string;
  issues: string[];
} {
  const issues: string[] = [];

  if (metrics.fixQuality === 0) {
    return {
      overall: "no_fix",
      recommendation: "No satellite fix. Check antenna, cables, and sky visibility.",
      issues: ["No position fix"],
    };
  }

  if (metrics.satellitesUsed < 4) {
    issues.push(`Only ${metrics.satellitesUsed} satellites used (minimum 4 required)`);
  }

  if (metrics.hdop > 5) {
    issues.push(`High HDOP (${metrics.hdop.toFixed(1)}) — poor satellite geometry`);
  }

  if (metrics.arRatio !== null && metrics.arRatio < 3 && metrics.fixQuality === 4) {
    issues.push(`Low AR ratio (${metrics.arRatio.toFixed(1)}) — ambiguity resolution may be unreliable (need >3)`);
  }

  if (metrics.surveyGrade && metrics.r95M > 0.05) {
    issues.push(`R95 accuracy (${(metrics.r95M * 100).toFixed(1)} cm) exceeds survey tolerance (<5 cm)`);
  }

  let overall: "excellent" | "good" | "moderate" | "poor" = "good";
  if (issues.length === 0 && metrics.surveyGrade && metrics.r95M < 0.02) {
    overall = "excellent";
  } else if (issues.length > 2) {
    overall = "poor";
  } else if (issues.length > 0) {
    overall = "moderate";
  }

  const recommendations = {
    excellent: "Survey-grade quality achieved. Proceed with confidence.",
    good: "Good quality. Safe to proceed with survey work.",
    moderate: "Moderate quality. Consider waiting for better satellite geometry or more satellites.",
    poor: "Poor quality. Wait for better conditions or check equipment.",
  };

  return {
    overall,
    recommendation: recommendations[overall],
    issues,
  };
}

// ═══════════════════════════════════════════════════════════════════
// PART 7: RINEX OBSERVATION FILE WRITER
// ═══════════════════════════════════════════════════════════════════

/** RINEX observation file header parameters. */
export interface RinexObsHeader {
  /** Program that generated the file */
  program: string;
  /** Run by (observer name) */
  runBy: string;
  /** Observation date */
  date: string;
  /** Marker name (station name) */
  markerName: string;
  /** Marker number */
  markerNumber?: string;
  /** Observer name */
  observer: string;
  /** Agency */
  agency: string;
  /** Receiver serial number */
  receiverSerial: string;
  /** Receiver type */
  receiverType: string;
  /** Receiver firmware version */
  receiverFirmware: string;
  /** Antenna serial number */
  antennaSerial: string;
  /** Antenna type */
  antennaType: string;
  /** Approximate marker position (WGS84) */
  approxPosition?: { x: number; y: number; z: number };
  /** Antenna height (meters — height of ARP above marker) */
  antennaHeight: number;
  /** Observation types (e.g., ["C1", "L1", "D1", "S1", "C2", "L2", "D2", "S2"]) */
  observationTypes: string[];
  /** Interval (seconds) */
  interval: number;
  /** First observation time */
  firstObs: { year: number; month: number; day: number; hour: number; minute: number; second: number };
  /** Satellite systems (e.g., "GRE" = GPS+GLONASS+Galileo) */
  satelliteSystems: string;
  /** RINEX version ("3.04") */
  version: string;
}

/** A single RINEX observation epoch. */
export interface RinexEpoch {
  /** Epoch time */
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
  /** Epoch flag (0=OK, 1=power failure, etc.) */
  flag: number;
  /** Satellites in this epoch */
  satellites: Array<{
    id: string;           // e.g., "G01"
    observations: Record<string, number | null>; // keyed by observation type
  }>;
}

/** Default observation types for a dual-frequency GPS receiver. */
export const DEFAULT_OBS_TYPES_DUAL_FREQ = ["C1", "L1", "D1", "S1", "C2", "L2", "D2", "S2"];

/** Default observation types for a multi-constellation receiver. */
export const DEFAULT_OBS_TYPES_MULTI = [
  "C1", "L1", "D1", "S1",
  "C2", "L2", "D2", "S2",
  "C5", "L5", "D5", "S5",
];

/** Generate a RINEX 3.04 observation file. */
export function generateRinexObs(header: RinexObsHeader, epochs: RinexEpoch[]): string {
  const lines: string[] = [];

  // ─── Header ──────────────────────────────────────────────────────

  lines.push("     3.04           OBSERVATION DATA       M (MIXED)           RINEX VERSION / TYPE");
  lines.push(`${header.program.padEnd(20)}${header.runBy.padEnd(20)}${header.date.padEnd(20)}PGM / RUN BY / DATE`);

  if (header.markerNumber) {
    lines.push(`${header.markerName.padEnd(20)}${header.markerNumber.padEnd(20)}                                        MARKER NAME`);
  } else {
    lines.push(`${header.markerName.padEnd(60)}                                            MARKER NAME`);
  }

  lines.push(`${header.observer.padEnd(20)}${header.agency.padEnd(40)}                              OBSERVER / AGENCY`);
  lines.push(`${header.receiverSerial.padEnd(20)}${header.receiverType.padEnd(20)}${header.receiverFirmware.padEnd(20)}REC # / TYPE / VERS`);
  lines.push(`${header.antennaSerial.padEnd(20)}${header.antennaType.padEnd(20)}                                        ANT # / TYPE`);

  if (header.approxPosition) {
    const fmt = (n: number) => n.toFixed(4).padStart(14);
    lines.push(`${fmt(header.approxPosition.x)}${fmt(header.approxPosition.y)}${fmt(header.approxPosition.z)}          APPROX POSITION XYZ`);
  }

  const hStr = header.antennaHeight.toFixed(4).padStart(14);
  lines.push(`${hStr}${"".padStart(14)}${"".padStart(14)}                              ANTENNA: DELTA H/E/N`);

  // Observation types
  const obsStr = header.observationTypes.join(" ");
  lines.push(`G    ${String(header.observationTypes.length).padStart(3)}  ${obsStr}                        SYS / # / OBS TYPES`);

  const intervalStr = header.interval.toFixed(3).padStart(10);
  lines.push(`${intervalStr}                                                                          INTERVAL`);

  const t = header.firstObs;
  const timeStr = `  ${t.year}    ${t.month}    ${t.day}    ${t.hour}    ${t.minute}  ${t.second.toFixed(2).padStart(5)}`;
  lines.push(`${timeStr}     ${header.satelliteSystems.padEnd(3)}                                 TIME OF FIRST OBS`);

  lines.push(`${"".padEnd(60)}                                            END OF HEADER`);

  // ─── Epochs ─────────────────────────────────────────────────────

  for (const epoch of epochs) {
    // Epoch header line
    const t = epoch;
    const epochLine =
      `> ${t.year} ${String(t.month).padStart(2, "0")} ${String(t.day).padStart(2, "0")} ` +
      `${String(t.hour).padStart(2, "0")} ${String(t.minute).padStart(2, "0")} ` +
      `${t.second.toFixed(1).padStart(4, "0")}  ${epoch.flag}  ${epoch.satellites.length}`;
    lines.push(epochLine);

    // Satellite observation lines
    for (const sat of epoch.satellites) {
      const satLine = sat.id.padEnd(3);
      let obsLine = satLine;

      for (const obsType of header.observationTypes) {
        const val = sat.observations[obsType];
        if (val === null || val === undefined) {
          obsLine += "".padStart(14) + "  ";
        } else {
          // Format: F14.3 + LLI + signal strength
          obsLine += val.toFixed(3).padStart(14) + "  ";
        }
      }

      lines.push(obsLine);
    }
  }

  return lines.join("\n") + "\n";
}

// ═══════════════════════════════════════════════════════════════════
// PART 8: RTCM v3 MESSAGE TYPES
// ═══════════════════════════════════════════════════════════════════

/** RTCM v3 message type identifiers. */
export const RTCM_MESSAGE_TYPES = {
  // GPS
  MSG_1001: "GPS L1-Only RTK Observables",
  MSG_1002: "GPS L1-Only RTK Observables (extended)",
  MSG_1003: "GPS L1/L2 RTK Observables",
  MSG_1004: "GPS L1/L2 RTK Observables (extended)",
  // Station info
  MSG_1005: "Stationary RTK Reference Station ARP (no antenna height)",
  MSG_1006: "Stationary RTK Reference Station ARP (with antenna height)",
  MSG_1007: "Antenna Descriptor",
  MSG_1008: "Antenna Descriptor + Serial Number",
  // GLONASS
  MSG_1009: "GLONASS L1-Only RTK Observables",
  MSG_1010: "GLONASS L1-Only RTK Observables (extended)",
  MSG_1011: "GLONASS L1/L2 RTK Observables",
  MSG_1012: "GLONASS L1/L2 RTK Observables (extended)",
  // System parameters
  MSG_1013: "System Parameters",
  MSG_1019: "GPS Ephemeris",
  MSG_1020: "GLONASS Ephemeris",
  // Network RTK
  MSG_1030: "Network RTK Residual Message",
  MSG_1031: "Network RTK MAC Residual Message",
  MSG_1032: "Network RTK Non-Position Correction Message",
  MSG_1033: "Receiver and Antenna Description",
  // MSM (Multiple Signal Messages)
  MSG_1071: "GPS MSM1 (L1, L2, L5)",
  MSG_1072: "GPS MSM2",
  MSG_1073: "GPS MSM3",
  MSG_1074: "GPS MSM4 (full pseudorange, phase, CNR, lock)",
  MSG_1075: "GPS MSM5",
  MSG_1076: "GPS MSM6",
  MSG_1077: "GPS MSM7 (full + extended)",
  MSG_1081: "GLONASS MSM1",
  MSG_1084: "GLONASS MSM4",
  MSG_1087: "GLONASS MSM7",
  MSG_1091: "Galileo MSM1",
  MSG_1094: "Galileo MSM4",
  MSG_1097: "Galileo MSM7",
  MSG_1121: "BeiDou MSM1",
  MSG_1124: "BeiDou MSM4",
  MSG_1127: "BeiDou MSM7",
  // SBAS
  MSG_1101: "SBAS MSM1",
  MSG_1104: "SBAS MSM4",
  MSG_1107: "SBAS MSM7",
  // QZSS
  MSG_1111: "QZSS MSM1",
  MSG_1114: "QZSS MSM4",
  MSG_1117: "QZSS MSM7",
  // Biases
  MSG_1230: "GLONASS Code-Phase Biases",
} as const;

/** RTCM v3 message type for a parsed message. */
export interface RtcmMessage {
  messageNumber: number;
  messageName: string;
  stationId: number;
  /** Raw message payload (for forwarding to the rover) */
  payload: Uint8Array;
}

/** RTCM v3 frame structure:
 *   Preamble: 0xD3 (1 byte)
 *   Length: 6+10 bits (2 bytes, masked)
 *   Payload: variable
 *   CRC24: 3 bytes
 *
 * This is a lightweight parser — it extracts the message type and station ID,
 * but does NOT decode the full payload (which requires bit-level parsing).
 */
export function parseRtcmFrame(data: Uint8Array): RtcmMessage | null {
  if (data.length < 6) return null;

  // Check preamble (0xD3)
  if (data[0] !== 0xD3) return null;

  // Extract length (10 bits from bytes 1-2, masked with 0x03FF)
  const length = ((data[1]! & 0x03) << 8) | data[2]!;

  // Verify we have enough data
  if (data.length < 3 + length + 3) return null;

  // Extract payload
  const payload = data.subarray(3, 3 + length);

  // Extract message number (12 bits from payload bytes 0-1)
  const messageNumber = ((payload[0]! << 4) | (payload[1]! >> 4)) & 0x0FFF;

  // Extract station ID (12 bits, offset varies by message type)
  let stationId = 0;
  if (messageNumber >= 1001 && messageNumber <= 1004) {
    // GPS RTK messages: station ID at bits 24-36
    stationId = ((payload[3]! & 0x0F) << 8) | payload[4]!;
  } else if (messageNumber === 1005 || messageNumber === 1006) {
    // Station ARP: station ID at bits 12-24
    stationId = ((payload[1]! & 0x0F) << 8) | payload[2]!;
  } else if (messageNumber >= 1009 && messageNumber <= 1012) {
    // GLONASS RTK messages: station ID at bits 24-36
    stationId = ((payload[3]! & 0x0F) << 8) | payload[4]!;
  } else if (messageNumber >= 1071 && messageNumber <= 1127) {
    // MSM messages: station ID at bits 12-24
    stationId = ((payload[1]! & 0x0F) << 8) | payload[2]!;
  }

  const messageName = (RTCM_MESSAGE_TYPES as Record<string, string>)[`MSG_${messageNumber}`]
    ?? `Unknown RTCM message ${messageNumber}`;

  return {
    messageNumber,
    messageName,
    stationId,
    payload,
  };
}

// ═══════════════════════════════════════════════════════════════════
// PART 9: DATUM TRANSFORMATIONS (GNSS-specific)
// ═══════════════════════════════════════════════════════════════════

/** Arc 1960 to WGS84 Helmert 7-parameter transform (Kenya). */
export const ARC1960_TO_WGS84 = {
  tx: -160,  // translation X (meters)
  ty: -8,
  tz: -300,
  rx: 0,     // rotation (arcseconds)
  ry: 0,
  rz: 0,
  scale: 0,  // ppm
};

/** WGS84 to Arc 1960 Helmert 7-parameter transform (inverse). */
export const WGS84_TO_ARC1960 = {
  tx: 160,
  ty: 8,
  tz: 300,
  rx: 0,
  ry: 0,
  rz: 0,
  scale: 0,
};

/** ITRF2014 to WGS84 (effectively zero — they're aligned to <1cm). */
export const ITRF2014_TO_WGS84 = {
  tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, scale: 0,
};

/** Apply a 7-parameter Helmert transform to ECEF (X, Y, Z) coordinates. */
export function helmertTransform(
  xyz: { x: number; y: number; z: number },
  params: { tx: number; ty: number; tz: number; rx: number; ry: number; rz: number; scale: number },
): { x: number; y: number; z: number } {
  // Convert rotations from arcseconds to radians
  const rx = params.rx * Math.PI / (180 * 3600);
  const ry = params.ry * Math.PI / (180 * 3600);
  const rz = params.rz * Math.PI / (180 * 3600);
  const s = 1 + params.scale / 1_000_000;

  // Apply transform: X' = s * (X + R * X) + T
  // Using the simplified (small-angle) rotation matrix
  const x2 = s * (xyz.x + rz * xyz.y - ry * xyz.z) + params.tx;
  const y2 = s * (-rz * xyz.x + xyz.y + rx * xyz.z) + params.ty;
  const z2 = s * (ry * xyz.x - rx * xyz.y + xyz.z) + params.tz;

  return { x: x2, y: y2, z: z2 };
}

/** Convert WGS84 latitude/longitude/height to ECEF (X, Y, Z). */
export function geodeticToEcef(lat: number, lon: number, height: number): { x: number; y: number; z: number } {
  const a = 6378137.0;          // WGS84 semi-major axis
  const f = 1 / 298.257223563;  // WGS84 flattening
  const e2 = f * (2 - f);       // eccentricity squared

  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;

  const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) ** 2); // prime vertical radius

  const x = (N + height) * Math.cos(latRad) * Math.cos(lonRad);
  const y = (N + height) * Math.cos(latRad) * Math.sin(lonRad);
  const z = (N * (1 - e2) + height) * Math.sin(latRad);

  return { x, y, z };
}

/** Convert ECEF (X, Y, Z) to WGS84 latitude/longitude/height. */
export function ecefToGeodetic(x: number, y: number, z: number): { lat: number; lon: number; height: number } {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const b = a * (1 - f);
  const ep2 = (a * a - b * b) / (b * b);

  const p = Math.sqrt(x * x + y * y);
  const theta = Math.atan2(z * a, p * b);

  const lon = Math.atan2(y, x);
  const lat = Math.atan2(
    z + ep2 * b * Math.sin(theta) ** 3,
    p - e2 * a * Math.cos(theta) ** 3,
  );

  const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const height = p / Math.cos(lat) - N;

  return {
    lat: lat * 180 / Math.PI,
    lon: lon * 180 / Math.PI,
    height,
  };
}

/** Transform WGS84 coordinates to Arc 1960 (Kenya datum). */
export function wgs84ToArc1960(lat: number, lon: number, height: number): { lat: number; lon: number; height: number } {
  const ecef = geodeticToEcef(lat, lon, height);
  const transformed = helmertTransform(ecef, WGS84_TO_ARC1960);
  return ecefToGeodetic(transformed.x, transformed.y, transformed.z);
}

/** Transform Arc 1960 coordinates to WGS84. */
export function arc1960ToWgs84(lat: number, lon: number, height: number): { lat: number; lon: number; height: number } {
  const ecef = geodeticToEcef(lat, lon, height);
  const transformed = helmertTransform(ecef, ARC1960_TO_WGS84);
  return ecefToGeodetic(transformed.x, transformed.y, transformed.z);
}
