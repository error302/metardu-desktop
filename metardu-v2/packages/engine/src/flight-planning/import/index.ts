/**
 * Mission import — read mission files back into MetaRDU.
 *
 * Supports importing the same 5 formats we export:
 *   - ArduPilot .waypoints (QGC WPL 110) — plain text, easiest to parse
 *   - Litchi CSV
 *   - senseFly eMotion XML
 *   - Generic KML 2.2
 *   - DJI KMZ (wpml) — ZIP containing template.kml + wml.waypoints
 *
 * Each importer returns a normalized Waypoint[] that can be round-tripped
 * back through the exporter and compared for verification.
 *
 * The importers are strict: they throw on malformed input rather than
 * silently producing garbage. This is critical because surveyors may
 * import missions created by other tools (QGroundControl, Mission Planner,
 * Litchi web editor) and we need to surface any incompatibility immediately.
 */

import type { Waypoint } from "../waypoints.js";

// ─── ArduPilot .waypoints import ───────────────────────────────────

/**
 * Parse an ArduPilot .waypoints file (QGC WPL 110 format).
 *
 * Format: tab-separated, one waypoint per line.
 *   QGC WPL 110
 *   <index> <current> <coord_frame> <command> <param1> <param2> <param3> <param4> <lat> <lng> <alt> <autocontinue>
 *
 * Commands we recognize:
 *   16 = MAV_CMD_NAV_WAYPOINT  → photo waypoint
 *   22 = MAV_CMD_NAV_TAKEOFF   → takeoff (skipped, not a survey waypoint)
 *   21 = MAV_CMD_NAV_RETURN_TO_LAUNCH → RTL (skipped)
 */
export function importArduPilotWaypoints(content: string): Waypoint[] {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length === 0) {
    throw new Error("Empty .waypoints file");
  }

  // First line must be the QGC WPL 110 header
  if (!lines[0]!.trim().startsWith("QGC WPL 110")) {
    throw new Error(
      `Invalid .waypoints header: expected "QGC WPL 110", got "${lines[0]!.trim().substring(0, 30)}..."`
    );
  }

  const waypoints: Waypoint[] = [];
  let surveyIdx = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = line.split(/\t/);
    if (fields.length !== 12) {
      throw new Error(
        `Line ${i + 1}: expected 12 tab-separated fields, got ${fields.length}`
      );
    }

    const [
      , // index (we re-index)
      , // current
      coordFrameStr,
      cmdStr,
      , // param1 (hold time)
      , // param2 (acceptance radius)
      , // param3 (pass radius)
      yawStr,
      latStr,
      lngStr,
      altStr,
      , // autocontinue
    ] = fields;

    const cmd = parseInt(cmdStr!, 10);
    const lat = parseFloat(latStr!);
    const lng = parseFloat(lngStr!);
    const alt = parseFloat(altStr!);
    const yaw = yawStr === "nan" ? 0 : parseFloat(yawStr!);

    // Skip non-waypoint commands (takeoff, RTL, etc.)
    if (cmd !== 16) continue;

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(alt)) {
      throw new Error(
        `Line ${i + 1}: invalid coordinates (lat=${latStr}, lng=${lngStr}, alt=${altStr})`
      );
    }

    void coordFrameStr; // acknowledged but not used for normalization

    waypoints.push({
      index: surveyIdx++,
      latitude: lat,
      longitude: lng,
      altitudeMeters: alt,
      flightLine: 0, // ArduPilot format doesn't encode flight line info
      isPhoto: true,
      headingDegrees: yaw,
    });
  }

  if (waypoints.length === 0) {
    throw new Error("No waypoints found in .waypoints file (only takeoff/RTL commands?)");
  }

  return waypoints;
}

// ─── Litchi CSV import ─────────────────────────────────────────────

/**
 * Parse a Litchi CSV mission file.
 *
 * Expected header (case-insensitive, may have extra columns):
 *   latitude,longitude,altitude(m),heading(deg),curvesize(%),rotationdir,
 *   gimbalpitch,altitudemode,speed(m/s),actions
 */
export function importLitchiCsv(content: string): Waypoint[] {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error("Litchi CSV must have a header and at least one data row");
  }

  // Parse header to find column indices
  const header = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
  const colIdx = {
    lat: header.findIndex((h) => h === "latitude"),
    lng: header.findIndex((h) => h === "longitude"),
    alt: header.findIndex((h) => h.startsWith("altitude")),
    heading: header.findIndex((h) => h.startsWith("heading")),
    gimbal: header.findIndex((h) => h.startsWith("gimbalpitch")),
    speed: header.findIndex((h) => h.startsWith("speed")),
  };

  if (colIdx.lat === -1 || colIdx.lng === -1) {
    throw new Error(
      `Litchi CSV missing required latitude/longitude columns. Found: ${header.join(", ")}`
    );
  }

  const waypoints: Waypoint[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = line.split(",");
    const lat = parseFloat(fields[colIdx.lat]!);
    const lng = parseFloat(fields[colIdx.lng]!);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error(`Line ${i + 1}: invalid coordinates (lat=${fields[colIdx.lat]}, lng=${fields[colIdx.lng]})`);
    }

    const alt = colIdx.alt >= 0 ? parseFloat(fields[colIdx.alt]!) : 0;
    const heading = colIdx.heading >= 0 ? parseFloat(fields[colIdx.heading]!) : 0;
    const gimbal = colIdx.gimbal >= 0 ? parseFloat(fields[colIdx.gimbal]!) : -90;
    const speed = colIdx.speed >= 0 ? parseFloat(fields[colIdx.speed]!) : undefined;

    waypoints.push({
      index: i - 1,
      latitude: lat,
      longitude: lng,
      altitudeMeters: Number.isFinite(alt) ? alt : 0,
      flightLine: 0,
      isPhoto: true,
      headingDegrees: Number.isFinite(heading) ? heading : 0,
      gimbalPitchDegrees: Number.isFinite(gimbal) ? gimbal : -90,
      speedMs: Number.isFinite(speed) ? speed : undefined,
    });
  }

  if (waypoints.length === 0) {
    throw new Error("No data rows found in Litchi CSV");
  }

  return waypoints;
}

// ─── senseFly eMotion XML import ───────────────────────────────────

/**
 * Parse a senseFly eMotion XML mission file.
 *
 * Expected structure:
 *   <Mission Name="..." Version="1.0">
 *     <MissionInfo>...</MissionInfo>
 *     <Waypoints>
 *       <Waypoint Index="0">
 *         <Position Latitude="..." Longitude="..." Altitude="..." AltitudeType="AboveSeaLevel"/>
 *         <PhotoAction TakePhoto="true" StopAndTurn="false"/>
 *         <Speed>15.00</Speed>
 *         <GimbalPitch>-90</GimbalPitch>
 *       </Waypoint>
 *       ...
 *     </Waypoints>
 *   </Mission>
 */
export function importSenseflyXml(content: string): Waypoint[] {
  // Basic XML validation
  if (!content.includes("<Mission") || !content.includes("</Mission>")) {
    throw new Error("senseFly XML must contain <Mission> root element");
  }

  const waypoints: Waypoint[] = [];

  // Extract all <Waypoint Index="N">...</Waypoint> blocks
  const wpRegex = /<Waypoint\s+Index="(\d+)">([\s\S]*?)<\/Waypoint>/g;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = wpRegex.exec(content)) !== null) {
    const block = match[2]!;

    // Extract Position attributes
    const posMatch = block.match(/<Position\s+([^/]+)\/>/);
    if (!posMatch) {
      throw new Error(`Waypoint ${idx}: missing <Position> element`);
    }
    const posAttrs = posMatch[1]!;
    const lat = extractXmlAttribute(posAttrs, "Latitude");
    const lng = extractXmlAttribute(posAttrs, "Longitude");
    const alt = extractXmlAttribute(posAttrs, "Altitude");

    if (lat === undefined || lng === undefined || alt === undefined) {
      throw new Error(`Waypoint ${idx}: <Position> missing Latitude/Longitude/Altitude`);
    }

    // Extract optional Speed
    const speedMatch = block.match(/<Speed>([\d.]+)<\/Speed>/);
    const speed = speedMatch ? parseFloat(speedMatch[1]!) : undefined;

    // Extract optional GimbalPitch
    const gimbalMatch = block.match(/<GimbalPitch>(-?[\d.]+)<\/GimbalPitch>/);
    const gimbal = gimbalMatch ? parseFloat(gimbalMatch[1]!) : -90;

    // Extract optional PhotoAction
    const photoMatch = block.match(/<PhotoAction\s+TakePhoto="(true|false)"/);
    const isPhoto = photoMatch ? photoMatch[1] === "true" : true;

    waypoints.push({
      index: idx++,
      latitude: lat,
      longitude: lng,
      altitudeMeters: alt,
      flightLine: 0,
      isPhoto,
      gimbalPitchDegrees: gimbal,
      speedMs: speed,
    });
  }

  if (waypoints.length === 0) {
    throw new Error("No <Waypoint> elements found in senseFly XML");
  }

  return waypoints;
}

// ─── Generic KML import ────────────────────────────────────────────

/**
 * Parse a generic KML 2.2 file with waypoint Placemarks.
 *
 * Expected structure (matches our export format):
 *   <Placemark>
 *     <name>WP 1</name>
 *     <Point>
 *       <coordinates>lng,lat,alt</coordinates>
 *       <altitudeMode>relativeToGround</altitudeMode>
 *     </Point>
 *     <ExtendedData>
 *       <Data name="index"><value>0</value></Data>
 *       <Data name="flightLine"><value>0</value></Data>
 *       <Data name="altitudeMeters"><value>75.00</value></Data>
 *       <Data name="headingDegrees"><value>0.00</value></Data>
 *       <Data name="isPhoto"><value>true</value></Data>
 *     </ExtendedData>
 *   </Placemark>
 */
export function importKml(content: string): Waypoint[] {
  if (!content.includes("<kml") || !content.includes("</kml>")) {
    throw new Error("KML must contain <kml> root element");
  }

  const waypoints: Waypoint[] = [];

  // Extract all <Placemark>...</Placemark> blocks (skip the flight path LineString placemark)
  const pmRegex = /<Placemark>([\s\S]*?)<\/Placemark>/g;
  let match: RegExpExecArray | null;

  while ((match = pmRegex.exec(content)) !== null) {
    const block = match[1]!;

    // Skip if this is a LineString (flight path), not a Point
    if (!block.includes("<Point>")) continue;

    // Extract coordinates: <coordinates>lng,lat,alt</coordinates>
    const coordMatch = block.match(/<coordinates>([^<]+)<\/coordinates>/);
    if (!coordMatch) {
      throw new Error("Placemark missing <coordinates> element");
    }
    const coordParts = coordMatch[1]!.trim().split(",");
    if (coordParts.length < 2) {
      throw new Error(`Invalid coordinates: ${coordMatch[1]}`);
    }
    const lng = parseFloat(coordParts[0]!);
    const lat = parseFloat(coordParts[1]!);
    const alt = coordParts.length >= 3 ? parseFloat(coordParts[2]!) : 0;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error(`Invalid coordinates: lat=${lat}, lng=${lng}`);
    }

    // Extract ExtendedData
    const extData = extractKmlExtendedData(block);

    waypoints.push({
      index: extData.index ?? waypoints.length,
      latitude: lat,
      longitude: lng,
      altitudeMeters: Number.isFinite(alt) ? alt : 0,
      flightLine: extData.flightLine ?? 0,
      isPhoto: extData.isPhoto ?? true,
      headingDegrees: extData.headingDegrees ?? 0,
      gimbalPitchDegrees: extData.gimbalPitchDegrees ?? -90,
      speedMs: extData.speedMs,
    });
  }

  if (waypoints.length === 0) {
    throw new Error("No <Placemark> with <Point> found in KML");
  }

  // Re-index sequentially
  waypoints.forEach((wp, i) => { wp.index = i; });

  return waypoints;
}

// ─── DJI KMZ import ────────────────────────────────────────────────

/**
 * Parse a DJI KMZ file (ZIP containing wpmz/res/wml.waypoints).
 *
 * @param bytes KMZ file as a Uint8Array
 */
export async function importDjiKmz(bytes: Uint8Array): Promise<Waypoint[]> {
  const files = unzipKmz(bytes);

  // Find the wml.waypoints file (path may vary slightly between DJI versions)
  const wpFile = files.find((f) => f.path.includes("wml.waypoints")) ??
                 files.find((f) => f.path.endsWith(".waypoints"));
  if (!wpFile) {
    throw new Error(
      `KMZ does not contain a wml.waypoints file. Found: ${files.map((f) => f.path).join(", ")}`
    );
  }

  const xml = new TextDecoder().decode(wpFile.content);
  return parseDjiWpmlWaypoints(xml);
}

/**
 * Parse the DJI wpml wml.waypoints XML content.
 */
function parseDjiWpmlWaypoints(xml: string): Waypoint[] {
  if (!xml.includes("<kml") || !xml.includes("wpml:")) {
    throw new Error("XML does not appear to be a DJI wpml waypoints file");
  }

  const waypoints: Waypoint[] = [];

  // Extract all <Placemark> blocks
  const pmRegex = /<Placemark>([\s\S]*?)<\/Placemark>/g;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = pmRegex.exec(xml)) !== null) {
    const block = match[1]!;

    // Extract coordinates from <Point><coordinates>lng,lat</coordinates>
    const coordMatch = block.match(/<coordinates>([^<]+)<\/coordinates>/);
    if (!coordMatch) continue;

    const coordParts = coordMatch[1]!.trim().split(",");
    if (coordParts.length < 2) continue;

    const lng = parseFloat(coordParts[0]!);
    const lat = parseFloat(coordParts[1]!);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    // Extract waypoint height from <wpml:waypointHeight>
    const heightMatch = block.match(/<wpml:waypointHeight>([^<]+)<\/wpml:waypointHeight>/);
    const alt = heightMatch ? parseFloat(heightMatch[1]!) : 0;

    // Extract heading from <wpml:waypointHeadingAngle>
    const headingMatch = block.match(/<wpml:waypointHeadingAngle>([^<]+)<\/wpml:waypointHeadingAngle>/);
    const heading = headingMatch ? parseFloat(headingMatch[1]!) : 0;

    // Extract gimbal pitch from <wpml:gimbalPitch>
    const gimbalMatch = block.match(/<wpml:gimbalPitch>([^<]+)<\/wpml:gimbalPitch>/);
    const gimbal = gimbalMatch ? parseFloat(gimbalMatch[1]!) : -90;

    // Extract speed from <wpml:waypointSpeed>
    const speedMatch = block.match(/<wpml:waypointSpeed>([^<]+)<\/wpml:waypointSpeed>/);
    const speed = speedMatch ? parseFloat(speedMatch[1]!) : undefined;

    // Determine if this waypoint has a photo action
    const isPhoto = block.includes("takePhoto");

    waypoints.push({
      index: idx++,
      latitude: lat,
      longitude: lng,
      altitudeMeters: Number.isFinite(alt) ? alt : 0,
      flightLine: 0,
      isPhoto,
      headingDegrees: heading,
      gimbalPitchDegrees: gimbal,
      speedMs: Number.isFinite(speed) ? speed : undefined,
    });
  }

  if (waypoints.length === 0) {
    throw new Error("No <Placemark> waypoints found in DJI wpml XML");
  }

  return waypoints;
}

// ─── Unified import entry point ────────────────────────────────────

/**
 * Supported import formats.
 */
export type MissionImportFormat =
  | "ardupilot-waypoints"
  | "litchi-csv"
  | "sensefly-xml"
  | "kml"
  | "dji-kmz";

/**
 * Import a mission from a file.
 *
 * @param format The format to parse
 * @param content The file content (string for text formats, Uint8Array for KMZ)
 */
export async function importMission(
  format: MissionImportFormat,
  content: string | Uint8Array
): Promise<Waypoint[]> {
  switch (format) {
    case "ardupilot-waypoints":
      if (typeof content !== "string") throw new Error(".waypoints import requires string content");
      return importArduPilotWaypoints(content);

    case "litchi-csv":
      if (typeof content !== "string") throw new Error("CSV import requires string content");
      return importLitchiCsv(content);

    case "sensefly-xml":
      if (typeof content !== "string") throw new Error("XML import requires string content");
      return importSenseflyXml(content);

    case "kml":
      if (typeof content !== "string") throw new Error("KML import requires string content");
      return importKml(content);

    case "dji-kmz":
      if (typeof content !== "string") {
        return importDjiKmz(content);
      }
      throw new Error("DJI KMZ import requires Uint8Array (binary) content");

    default: {
      const _exhaustive: never = format;
      throw new Error(`Unknown import format: ${_exhaustive}`);
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Extract a numeric attribute from an XML attribute string.
 */
function extractXmlAttribute(attrs: string, name: string): number | undefined {
  const match = attrs.match(new RegExp(`${name}="([^"]+)"`));
  if (!match) return undefined;
  const val = parseFloat(match[1]!);
  return Number.isFinite(val) ? val : undefined;
}

/**
 * Extract ExtendedData from a KML Placemark.
 */
function extractKmlExtendedData(block: string): {
  index?: number;
  flightLine?: number;
  altitudeMeters?: number;
  headingDegrees?: number;
  speedMs?: number;
  gimbalPitchDegrees?: number;
  isPhoto?: boolean;
} {
  const result: {
    index?: number;
    flightLine?: number;
    altitudeMeters?: number;
    headingDegrees?: number;
    speedMs?: number;
    gimbalPitchDegrees?: number;
    isPhoto?: boolean;
  } = {};

  const dataRegex = /<Data\s+name="([^"]+)"><value>([^<]+)<\/value><\/Data>/g;
  let match: RegExpExecArray | null;
  while ((match = dataRegex.exec(block)) !== null) {
    const key = match[1]!;
    const value = match[2]!;
    switch (key) {
      case "index": result.index = parseInt(value, 10); break;
      case "flightLine": result.flightLine = parseInt(value, 10); break;
      case "altitudeMeters": result.altitudeMeters = parseFloat(value); break;
      case "headingDegrees": result.headingDegrees = parseFloat(value); break;
      case "speedMs": result.speedMs = parseFloat(value); break;
      case "gimbalPitchDegrees": result.gimbalPitchDegrees = parseFloat(value); break;
      case "isPhoto": result.isPhoto = value === "true"; break;
    }
  }

  return result;
}

// ─── Minimal ZIP (KMZ) reader ──────────────────────────────────────

interface ZipEntry {
  path: string;
  content: Uint8Array;
}

/**
 * Read a ZIP archive and return the file entries.
 *
 * Supports deflate (method 8) and stored (method 0) entries.
 * This is a minimal reader — for a full-featured ZIP parser use the
 * `fflate` or `jszip` library.
 */
function unzipKmz(bytes: Uint8Array): ZipEntry[] {
  // Lazy-load zlib only when needed
  const { inflateSync } = require("node:zlib");
  const entries: ZipEntry[] = [];

  // Find all local file headers (signature 0x04034b50)
  let offset = 0;
  while (offset < bytes.length - 4) {
    // Look for local file header signature
    if (
      bytes[offset] === 0x50 && bytes[offset + 1] === 0x4B &&
      bytes[offset + 2] === 0x03 && bytes[offset + 3] === 0x04
    ) {
      // Parse local file header
      const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
      const compressionMethod = dv.getUint16(8, true);
      const compressedSize = dv.getUint32(18, true);
      const uncompressedSize = dv.getUint32(22, true);
      const fileNameLength = dv.getUint16(26, true);
      const extraFieldLength = dv.getUint16(28, true);

      const fileNameStart = offset + 30;
      const fileName = new TextDecoder().decode(
        bytes.subarray(fileNameStart, fileNameStart + fileNameLength)
      );

      const dataStart = fileNameStart + fileNameLength + extraFieldLength;
      const compressedData = bytes.subarray(dataStart, dataStart + compressedSize);

      let content: Uint8Array;
      if (compressionMethod === 0) {
        // Stored (no compression)
        content = compressedData;
      } else if (compressionMethod === 8) {
        // Deflate
        content = new Uint8Array(inflateSync(Buffer.from(compressedData)));
      } else {
        throw new Error(`Unsupported ZIP compression method: ${compressionMethod} for file ${fileName}`);
      }

      // uncompressedSize may be 0 when using data descriptors; trust the inflated size
      void uncompressedSize;

      entries.push({ path: fileName, content });
      offset = dataStart + compressedSize;
    } else {
      offset++;
    }
  }

  if (entries.length === 0) {
    throw new Error("No ZIP entries found in KMZ (invalid ZIP signature)");
  }

  return entries;
}
