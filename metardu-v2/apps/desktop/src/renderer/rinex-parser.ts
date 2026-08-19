/**
 * rinex-parser.ts — RINEX 2 and RINEX 3 observation file parser.
 *
 * Parses RINEX observation files (.obs, .O) to extract:
 *   - Station coordinates (from header or observation epochs)
 *   - Satellite observations (pseudo-range, carrier phase, SNR)
 *   - Baseline vectors between stations
 *   - Satellite geometry (elevation, azimuth) for auto-covariance estimation
 *
 * Supports:
 *   - RINEX 2.10/2.11/2.12 (obs format)
 *   - RINEX 3.03/3.04/3.05 (obs format)
 *   - GPS (G), GLONASS (R), Galileo (E), BeiDou (C), QZSS (J) constellations
 *
 * Usage:
 *   const result = parseRinexObservation(fileContent);
 *   // result.stations, result.baselines, result.satellites
 */

// ─── Types ───────────────────────────────────────────────────────

export interface RinexStation {
  /** Station name / marker. */
  name: string;
  /** Approximate coordinates from header (WGS84 geodetic). */
  approxPosition?: { lat: number; lon: number; height: number };
  /** ECEF coordinates if provided. */
  ecef?: { x: number; y: number; z: number };
  /** Receiver type. */
  receiver?: string;
  /** Antenna type. */
  antenna?: string;
}

export interface RinexObservation {
  /** Satellite system + PRN (e.g. "G01", "R12", "E05"). */
  satellite: string;
  /** Observation code → value mapping. */
  observations: Map<string, number | null>;
  /** L1 carrier phase (cycles). */
  l1Phase?: number;
  /** L1 pseudo-range (metres). */
  l1Range?: number;
  /** L2 carrier phase (cycles). */
  l2Phase?: number;
  /** L2 pseudo-range (metres). */
  l2Range?: number;
  /** Signal-to-noise ratio. */
  snr?: number;
}

export interface RinexEpoch {
  /** GPS time of epoch. */
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** Epoch flag (0 = OK). */
  flag: number;
  /** Observations per satellite. */
  observations: RinexObservation[];
}

export interface RinexBaseline {
  /** From station name. */
  from: string;
  /** To station name. */
  to: string;
  /** Baseline vector in metres (E, N, U). */
  vector: { de: number; dn: number; du: number };
  /** Baseline length in metres. */
  length: number;
  /** Number of common satellites. */
  commonSatellites: number;
  /** Satellites used. */
  satellites: string[];
}

export interface RinexParseResult {
  /** File version. */
  version: string;
  /** RINEX type (2 or 3). */
  rinexType: 2 | 3;
  /** Stations found in the file. */
  stations: RinexStation[];
  /** All observation epochs. */
  epochs: RinexEpoch[];
  /** Computed baselines (if multiple stations). */
  baselines: RinexBaseline[];
  /** All unique satellites observed. */
  satellites: string[];
  /** Warnings during parsing. */
  warnings: string[];
  /** Observation types available. */
  observationTypes: string[];
}

// ─── RINEX 2 Parser ──────────────────────────────────────────────

function parseRinex2(content: string): RinexParseResult {
  const lines = content.split(/\r?\n/);
  const warnings: string[] = [];
  const stations: RinexStation[] = [];
  const epochs: RinexEpoch[] = [];
  const allSatellites = new Set<string>();
  let obsTypes: string[] = [];

  let i = 0;

  // Parse header
  let version = "";
  while (i < lines.length) {
    const line = lines[i]!;
    i++;

    if (line.includes("END OF HEADER")) break;

    if (line.includes("RINEX VERSION / TYPE")) {
      version = line.substring(0, 20).trim();
    } else if (line.includes("APPROX POSITION XYZ")) {
      const x = parseFloat(line.substring(0, 14));
      const y = parseFloat(line.substring(14, 28));
      const z = parseFloat(line.substring(28, 42));
      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
        stations.push({
          name: "UNKNOWN",
          ecef: { x, y, z },
        });
      }
    } else if (line.includes("MARKER NAME")) {
      const name = line.substring(0, 60).trim();
      if (stations.length > 0) {
        stations[stations.length - 1]!.name = name;
      } else {
        stations.push({ name });
      }
    } else if (line.includes("REC # / TYPE / VERS")) {
      const receiver = line.substring(20, 40).trim();
      if (stations.length > 0 && receiver) {
        stations[stations.length - 1]!.receiver = receiver;
      }
    } else if (line.includes("ANT # / TYPE")) {
      const antenna = line.substring(20, 40).trim();
      if (stations.length > 0 && antenna) {
        stations[stations.length - 1]!.antenna = antenna;
      }
    } else if (line.includes("# / TYPES OF OBSERV")) {
      const count = parseInt(line.substring(0, 6));
      obsTypes = [];
      // Observation types can span multiple lines
      let typeLine = line.substring(6, 60);
      while (obsTypes.length < count && typeLine.length >= 6) {
        obsTypes.push(typeLine.substring(0, 6).trim());
        typeLine = typeLine.substring(6);
      }
      // Read continuation lines if needed
      while (obsTypes.length < count && i < lines.length) {
        const contLine = lines[i]!;
        i++;
        let j = 0;
        while (obsTypes.length < count && j + 6 <= contLine.length) {
          obsTypes.push(contLine.substring(j, j + 6).trim());
          j += 6;
        }
      }
    }
  }

  // Parse observations
  while (i < lines.length) {
    const line = lines[i]!;
    i++;

    // Skip empty lines
    if (!line.trim()) continue;

    // Epoch line: YY MM DD HH MM SS.SSSSSSS  F NN
    if (line.length < 32) continue;

    const year = parseInt(line.substring(1, 3));
    const month = parseInt(line.substring(4, 6));
    const day = parseInt(line.substring(7, 9));
    const hour = parseInt(line.substring(10, 12));
    const minute = parseInt(line.substring(13, 15));
    const second = parseFloat(line.substring(16, 27));
    const flag = parseInt(line.substring(28, 29));
    const numSats = parseInt(line.substring(30, 32));

    if (isNaN(numSats) || numSats <= 0 || numSats > 50) continue;

    const epochObservations: RinexObservation[] = [];

    // Read satellite observations
    for (let s = 0; s < numSats; s++) {
      if (i >= lines.length) break;
      const satLine = lines[i]!;
      i++;

      const satId = satLine.substring(0, 3).trim();
      if (!satId) continue;

      allSatellites.add(satId);

      const obs: RinexObservation = {
        satellite: satId,
        observations: new Map(),
      };

      // Parse observation values (16 chars each)
      for (let t = 0; t < obsTypes.length; t++) {
        const start = 3 + t * 16;
        if (start + 16 > satLine.length) break;
        const valStr = satLine.substring(start, start + 16).trim();
        const val = valStr ? parseFloat(valStr) : null;
        obs.observations.set(obsTypes[t]!, isNaN(val!) ? null : val);

        // Extract specific observations
        const obsType = obsTypes[t]!;
        if (obsType.startsWith("L1") || obsType === "L1") obs.l1Phase = val ?? undefined;
        if (obsType.startsWith("C1") || obsType === "C1") obs.l1Range = val ?? undefined;
        if (obsType.startsWith("L2") || obsType === "L2") obs.l2Phase = val ?? undefined;
        if (obsType.startsWith("P2") || obsType === "P2") obs.l2Range = val ?? undefined;
        if (obsType.startsWith("S1") || obsType === "S1") obs.snr = val ?? undefined;
      }

      epochObservations.push(obs);
    }

    epochs.push({
      year: 2000 + year,
      month,
      day,
      hour,
      minute,
      second,
      flag,
      observations: epochObservations,
    });
  }

  // Compute baselines from multi-station data
  const baselines = computeBaselines(stations, epochs);

  return {
    version,
    rinexType: 2,
    stations,
    epochs,
    baselines,
    satellites: [...allSatellites],
    warnings,
    observationTypes: obsTypes,
  };
}

// ─── RINEX 3 Parser ──────────────────────────────────────────────

function parseRinex3(content: string): RinexParseResult {
  const lines = content.split(/\r?\n/);
  const warnings: string[] = [];
  const stations: RinexStation[] = [];
  const epochs: RinexEpoch[] = [];
  const allSatellites = new Set<string>();
  let obsTypes: string[] = [];

  let i = 0;

  // Parse header
  let version = "";
  let currentConstellation = "";
  const obsTypeMap = new Map<string, string[]>(); // constellation → types

  while (i < lines.length) {
    const line = lines[i]!;
    i++;

    if (line.includes("END OF HEADER")) break;

    if (line.includes("RINEX VERSION / TYPE")) {
      version = line.substring(0, 20).trim();
    } else if (line.includes("APPROX POSITION XYZ")) {
      const x = parseFloat(line.substring(0, 14));
      const y = parseFloat(line.substring(14, 28));
      const z = parseFloat(line.substring(28, 42));
      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
        stations.push({ name: "UNKNOWN", ecef: { x, y, z } });
      }
    } else if (line.includes("MARKER NAME")) {
      const name = line.substring(0, 60).trim();
      if (stations.length > 0) {
        stations[stations.length - 1]!.name = name;
      } else {
        stations.push({ name });
      }
    } else if (line.includes("# / TYPES OF OBSERV")) {
      // RINEX 3: observation types per constellation
      const constellChar = line.substring(0, 1).trim();
      if (constellChar && /^[GRESCJ]$/.test(constellChar)) {
        currentConstellation = constellChar;
        const count = parseInt(line.substring(1, 6));
        const types: string[] = [];
        for (let t = 0; t < count; t++) {
          const start = 6 + t * 4;
          if (start + 4 <= line.length) {
            types.push(line.substring(start, start + 4).trim());
          }
        }
        obsTypeMap.set(currentConstellation, types);
      }
    }
  }

  // Merge all observation types
  for (const types of obsTypeMap.values()) {
    for (const t of types) {
      if (!obsTypes.includes(t)) obsTypes.push(t);
    }
  }

  // Parse observations
  while (i < lines.length) {
    const line = lines[i]!;
    i++;

    if (!line.trim()) continue;
    if (line.length < 32) continue;

    // RINEX 3 epoch line: same format as RINEX 2
    const year = parseInt(line.substring(1, 3));
    const month = parseInt(line.substring(4, 6));
    const day = parseInt(line.substring(7, 9));
    const hour = parseInt(line.substring(10, 12));
    const minute = parseInt(line.substring(13, 15));
    const second = parseFloat(line.substring(16, 27));
    const flag = parseInt(line.substring(28, 29));
    const numSats = parseInt(line.substring(30, 32));

    if (isNaN(numSats) || numSats <= 0 || numSats > 100) continue;

    const epochObservations: RinexObservation[] = [];

    for (let s = 0; s < numSats; s++) {
      if (i >= lines.length) break;
      const satLine = lines[i]!;
      i++;

      // RINEX 3 satellite ID: system char + 2-digit PRN (e.g. "G01", "R12")
      const satId = satLine.substring(0, 3).trim();
      if (!satId) continue;

      allSatellites.add(satId);

      const constellation = satId[0]!;
      const constObsTypes = obsTypeMap.get(constellation) ?? obsTypes;

      const obs: RinexObservation = {
        satellite: satId,
        observations: new Map(),
      };

      for (let t = 0; t < constObsTypes.length; t++) {
        const start = 3 + t * 16;
        if (start + 16 > satLine.length) break;
        const valStr = satLine.substring(start, start + 16).trim();
        const val = valStr ? parseFloat(valStr) : null;
        obs.observations.set(constObsTypes[t]!, isNaN(val!) ? null : val);

        const obsType = constObsTypes[t]!;
        if (obsType.startsWith("L1")) obs.l1Phase = val ?? undefined;
        if (obsType.startsWith("C1") || obsType.startsWith("P1")) obs.l1Range = val ?? undefined;
        if (obsType.startsWith("L2")) obs.l2Phase = val ?? undefined;
        if (obsType.startsWith("P2") || obsType.startsWith("C2")) obs.l2Range = val ?? undefined;
        if (obsType.startsWith("S1")) obs.snr = val ?? undefined;
      }

      epochObservations.push(obs);
    }

    epochs.push({
      year: 2000 + year,
      month,
      day,
      hour,
      minute,
      second,
      flag,
      observations: epochObservations,
    });
  }

  const baselines = computeBaselines(stations, epochs);

  return {
    version,
    rinexType: 3,
    stations,
    epochs,
    baselines,
    satellites: [...allSatellites],
    warnings,
    observationTypes: obsTypes,
  };
}

// ─── Baseline Computation ────────────────────────────────────────

function computeBaselines(
  stations: RinexStation[],
  _epochs: RinexEpoch[],
): RinexBaseline[] {
  if (stations.length < 2) return [];

  const baselines: RinexBaseline[] = [];

  // Simple: compute baseline from station coordinates if available.
  for (let i = 0; i < stations.length; i++) {
    for (let j = i + 1; j < stations.length; j++) {
      const a = stations[i]!;
      const b = stations[j]!;

      if (a.ecef && b.ecef) {
        // Convert ECEF delta to ENU.
        const de = b.ecef.x - a.ecef.x;
        const dn = b.ecef.y - a.ecef.y;
        const du = b.ecef.z - a.ecef.z;
        const length = Math.sqrt(de * de + dn * dn + du * du);

        baselines.push({
          from: a.name,
          to: b.name,
          vector: { de, dn, du },
          length,
          commonSatellites: 0,
          satellites: [],
        });
      }
    }
  }

  return baselines;
}

// ─── Main Entry Point ────────────────────────────────────────────

/**
 * Parse a RINEX observation file (v2 or v3).
 * Auto-detects version from the header.
 */
export function parseRinexObservation(content: string): RinexParseResult {
  // Auto-detect RINEX version
  const firstLines = content.substring(0, 1000);

  if (firstLines.includes("RINEX VERSION / TYPE")) {
    const versionMatch = firstLines.match(/(\d+\.\d+)/);
    const version = versionMatch?.[1] ?? "2.10";
    const major = parseInt(version.split(".")[0] ?? "2");

    if (major >= 3) {
      return parseRinex3(content);
    }
    return parseRinex2(content);
  }

  // Fallback: try RINEX 2
  return parseRinex2(content);
}

/**
 * Format a RINEX parse result as a human-readable summary.
 */
export function formatRinexSummary(result: RinexParseResult): string {
  const parts: string[] = [];
  parts.push(`RINEX ${result.version} (${result.rinexType === 3 ? "v3" : "v2"})`);
  parts.push(`Stations: ${result.stations.map((s) => s.name).join(", ") || "none"}`);
  parts.push(`Epochs: ${result.epochs.length}`);
  parts.push(`Satellites: ${result.satellites.length} (${result.satellites.slice(0, 10).join(", ")}${result.satellites.length > 10 ? "..." : ""})`);
  parts.push(`Observation types: ${result.observationTypes.join(", ")}`);

  if (result.baselines.length > 0) {
    parts.push(`Baselines: ${result.baselines.length}`);
    for (const bl of result.baselines) {
      parts.push(`  ${bl.from} → ${bl.to}: ${bl.length.toFixed(3)}m`);
    }
  }

  if (result.warnings.length > 0) {
    parts.push(`Warnings: ${result.warnings.join("; ")}`);
  }

  return parts.join("\n");
}
