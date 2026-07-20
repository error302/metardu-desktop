/**
 * Instrument data import — THE killer feature.
 *
 * Parses raw field data from surveying instruments:
 *   1. Leica GSI (Geo Serial Interface) — total stations + levels
 *   2. Trimble JOB/DC — total stations + GNSS
 *   3. Sokkia SDR (Standard Data Record) — total stations
 *   4. RINEX (Receiver Independent Exchange Format) — GNSS raw data
 *
 * References:
 *   - Leica GSI: Leica Geo Office documentation
 *   - Trimble JOB: Trimble Business Center import docs
 *   - Sokkia SDR: SDR Mapping Systems manual
 *   - RINEX 3.04: https://files.igs.org/pub/data/format/rinex304.pdf
 */

export interface FieldObservation {
  pointId: string;
  code?: string;
  type: "total_station" | "gnss" | "level";
  totalStation?: {
    horizontalAngle?: number;
    verticalAngle?: number;
    slopeDistance?: number;
    horizontalDistance?: number;
    reflectorHeight?: number;
    instrumentHeight?: number;
  };
  gnss?: {
    latitude: number;
    longitude: number;
    height: number;
    fixQuality: "fixed" | "float" | "autonomous" | "dgps" | "unknown";
    satellites: number;
    hdop: number;
    vdop: number;
  };
  level?: {
    backsight?: number;
    foresight?: number;
    reducedLevel?: number;
  };
  coordinates?: { easting: number; northing: number; elevation: number };
  stationId?: string;
  timestamp?: string;
}

export interface ImportResult {
  observations: FieldObservation[];
  warnings: string[];
  errors: string[];
  format: string;
  pointCount: number;
}

// ─── Leica GSI parser ────────────────────────────────────────────

export function parseLeicaGSI(content: string): ImportResult {
  const observations: FieldObservation[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const lines = content.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const firstLineWords = lines[0]?.split(/\s+/) ?? [];
  const wordLen = firstLineWords[0]?.length ?? 8;
  const isGSI16 = wordLen === 16;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    try {
      const words = line.split(/\s+/);
      const obs: FieldObservation = { pointId: "", type: "total_station", totalStation: {} };

      for (const word of words) {
        if (word.length < 2) continue;
        const wi = word.substring(0, 2);
        const data = word.substring(2);
        const num = isGSI16 ? parseInt(data.substring(0, 14), 10) : parseInt(data.substring(0, 6), 10);
        const v = isNaN(num) ? undefined : num;

        switch (wi) {
          case "11": obs.pointId = data.trim().replace(/^0+/, "") || "0"; break;
          case "21": if (v !== undefined) obs.totalStation!.horizontalAngle = (v * 360) / 4_000_000; break;
          case "22": if (v !== undefined) obs.totalStation!.verticalAngle = (v * 360) / 4_000_000; break;
          case "31": if (v !== undefined) obs.totalStation!.slopeDistance = v / 1000; break;
          case "32": if (v !== undefined) obs.totalStation!.horizontalDistance = v / 1000; break;
          case "81":
            if (v !== undefined) { obs.coordinates = obs.coordinates ?? { easting: 0, northing: 0, elevation: 0 }; obs.coordinates.easting = v / 1000; }
            break;
          case "82":
            if (v !== undefined) { obs.coordinates = obs.coordinates ?? { easting: 0, northing: 0, elevation: 0 }; obs.coordinates.northing = v / 1000; }
            break;
          case "83":
            if (v !== undefined) { obs.coordinates = obs.coordinates ?? { easting: 0, northing: 0, elevation: 0 }; obs.coordinates.elevation = v / 1000; }
            break;
          case "84": if (v !== undefined) obs.totalStation!.instrumentHeight = v / 1000; break;
          case "85": if (v !== undefined) obs.totalStation!.reflectorHeight = v / 1000; break;
          case "87": obs.code = data.trim(); break;
        }
      }
      if (obs.pointId) observations.push(obs);
    } catch (err) {
      errors.push(`Line ${lineIdx + 1}: ${(err as Error).message}`);
    }
  }
  return { observations, warnings, errors, format: `Leica GSI${isGSI16 ? "16" : "8"}`, pointCount: observations.length };
}

// ─── Sokkia SDR parser ───────────────────────────────────────────

export function parseSokkiaSDR(content: string): ImportResult {
  const observations: FieldObservation[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const lines = content.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  let currentStation: string | undefined;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    try {
      const recType = line.substring(0, 2);
      const data = line.substring(2).trim();

      switch (recType) {
        case "01": {
          const parts = data.split(/[,\s]+/).filter((p) => p.length > 0);
          if (parts.length >= 4) {
            observations.push({
              pointId: parts[0]!.trim(),
              code: parts[4]?.trim(),
              type: "total_station",
              coordinates: { easting: parseFloat(parts[1]!), northing: parseFloat(parts[2]!), elevation: parseFloat(parts[3]!) },
            });
          }
          break;
        }
        case "02": {
          const parts = data.split(/[,\s]+/).filter((p) => p.length > 0);
          if (parts.length >= 4) {
            observations.push({
              pointId: parts[0]!.trim(),
              code: parts[5]?.trim(),
              type: "total_station",
              stationId: currentStation,
              totalStation: {
                horizontalAngle: parseFloat(parts[1]!),
                verticalAngle: parseFloat(parts[2]!),
                slopeDistance: parseFloat(parts[3]!),
                reflectorHeight: parts[4] ? parseFloat(parts[4]) : undefined,
              },
            });
          }
          break;
        }
        case "06": {
          const parts = data.split(/[,\s]+/).filter((p) => p.length > 0);
          if (parts.length >= 1) currentStation = parts[0]!.trim();
          break;
        }
        case "08": {
          const parts = data.split(/[,\s]+/).filter((p) => p.length > 0);
          if (parts.length >= 1) {
            observations.push({
              pointId: parts[0]!.trim(),
              type: "level",
              level: {
                backsight: parts[1] ? parseFloat(parts[1]) : undefined,
                foresight: parts[2] ? parseFloat(parts[2]) : undefined,
                reducedLevel: parts[3] ? parseFloat(parts[3]) : undefined,
              },
            });
          }
          break;
        }
      }
    } catch (err) {
      errors.push(`Line ${lineIdx + 1}: ${(err as Error).message}`);
    }
  }
  return { observations, warnings, errors, format: "Sokkia SDR", pointCount: observations.length };
}

// ─── Trimble DC parser ───────────────────────────────────────────

export function parseTrimbleDC(content: string): ImportResult {
  const observations: FieldObservation[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const lines = content.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    try {
      if (line.startsWith("#") || line.startsWith(";")) continue;
      const parts = line.split(",").map((p) => p.trim());
      const numericCount = parts.filter((p) => !isNaN(parseFloat(p))).length;

      if (numericCount >= 4 && parts.length >= 4) {
        const pointId = parts[0]!;
        const easting = parseFloat(parts[1]!);
        const northing = parseFloat(parts[2]!);
        const elevation = parseFloat(parts[3]!);

        if (!isNaN(easting) && !isNaN(northing)) {
          observations.push({
            pointId,
            code: parts.find((p, i) => i > 3 && isNaN(parseFloat(p))),
            type: "total_station",
            coordinates: { easting, northing, elevation: isNaN(elevation) ? 0 : elevation },
            totalStation: parts.length > 6 ? {
              horizontalAngle: parseFloat(parts[4]!) || undefined,
              verticalAngle: parseFloat(parts[5]!) || undefined,
              slopeDistance: parseFloat(parts[6]!) || undefined,
            } : undefined,
          });
        }
      }
    } catch (err) {
      errors.push(`Line ${lineIdx + 1}: ${(err as Error).message}`);
    }
  }
  if (observations.length === 0) {
    warnings.push("No observations found — the file may be in binary format. Export as ASCII from Trimble Business Center.");
  }
  return { observations, warnings, errors, format: "Trimble DC (ASCII)", pointCount: observations.length };
}

// ─── RINEX header parser ─────────────────────────────────────────

export function parseRinexHeader(content: string): {
  markerName: string;
  observer: string;
  agency: string;
  receiverType: string;
  antennaType: string;
  approximatePosition: { x: number; y: number; z: number };
  antennaHeight: number;
  observations: string[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const lines = content.split("\n");
  let markerName = "", observer = "", agency = "", receiverType = "", antennaType = "";
  let approximatePosition = { x: 0, y: 0, z: 0 };
  let antennaHeight = 0;
  const observations: string[] = [];

  for (const line of lines) {
    if (line.includes("END OF HEADER")) break;
    const label = line.substring(60).trim();
    const data = line.substring(0, 60).trim();

    switch (label) {
      case "MARKER NAME": markerName = data; break;
      case "OBSERVER / AGENCY": observer = data.substring(0, 20).trim(); agency = data.substring(20).trim(); break;
      case "REC # / TYPE / VERS": receiverType = data.substring(20, 40).trim(); break;
      case "ANT # / TYPE": antennaType = data.substring(20, 40).trim(); break;
      case "APPROX POSITION XYZ": {
        const parts = data.split(/\s+/).filter((p) => p.length > 0);
        if (parts.length >= 3) approximatePosition = { x: parseFloat(parts[0]!), y: parseFloat(parts[1]!), z: parseFloat(parts[2]!) };
        break;
      }
      case "ANTENNA: DELTA H/E/N": {
        const parts = data.split(/\s+/).filter((p) => p.length > 0);
        if (parts.length >= 1) antennaHeight = parseFloat(parts[0]!);
        break;
      }
      case "# / TYPES OF OBSERV": {
        const obsTypes = data.split(/\s+/).filter((p) => p.length > 0);
        const count = parseInt(obsTypes[0] ?? "0", 10);
        for (let i = 1; i <= count && i < obsTypes.length; i++) observations.push(obsTypes[i]!);
        break;
      }
    }
  }
  if (!markerName) warnings.push("No marker name found in RINEX header.");
  return { markerName, observer, agency, receiverType, antennaType, approximatePosition, antennaHeight, observations, warnings };
}

// ─── Auto-detect + import ────────────────────────────────────────

export function importFieldData(filename: string, content: string): ImportResult {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const firstLine = content.split("\n")[0] ?? "";
  const upperContent = content.substring(0, 500).toUpperCase();

  if (ext === "rinex" || ext === "obs" || upperContent.includes("RINEX VERSION")) {
    const header = parseRinexHeader(content);
    return {
      observations: [{
        pointId: header.markerName || "GNSS_BASE",
        type: "gnss",
        code: header.markerName,
        gnss: { latitude: 0, longitude: 0, height: header.approximatePosition.z, fixQuality: "unknown", satellites: 0, hdop: 0, vdop: 0 },
        coordinates: { easting: header.approximatePosition.x, northing: header.approximatePosition.y, elevation: header.approximatePosition.z },
      }],
      warnings: header.warnings.concat([
        `RINEX header parsed. Marker: ${header.markerName}, Receiver: ${header.receiverType}`,
        `Full epoch-by-epoch GNSS processing requires the sidecar's Rust import module.`,
      ]),
      errors: [],
      format: `RINEX (${header.receiverType || "unknown receiver"})`,
      pointCount: 1,
    };
  }

  if (ext === "gsi" || /^\s*(11|21|22|31|32|81|82|83)\d/.test(firstLine)) return parseLeicaGSI(content);
  if (ext === "sdr" || /^\s*(00|01|02|03|04|06|08)/.test(firstLine)) return parseSokkiaSDR(content);
  if (ext === "dc" || ext === "job" || (firstLine.includes(",") && firstLine.split(",").length >= 4)) return parseTrimbleDC(content);

  return {
    observations: [],
    warnings: [`Unable to detect file format for ${filename}. Supported: GSI, SDR, DC/JOB, RINEX.`],
    errors: [`Unrecognized format. First line: ${firstLine.substring(0, 80)}`],
    format: "unknown",
    pointCount: 0,
  };
}
