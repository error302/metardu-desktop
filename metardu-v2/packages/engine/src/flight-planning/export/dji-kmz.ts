/**
 * DJI KMZ (wpml) mission export.
 *
 * Generates a DJI WPML KMZ containing an editable template and executable wayline.
 *
 * The KMZ is a ZIP archive containing:
 *   wpmz/
 *     template.kml
 *     waylines.wpml
 *
 * References:
 *   - DJI WPML spec: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/overview.html
 *   - Litchi CSV-compatible waypoints: https://flylitchi.com/help/how-to-create-and-edit-missions
 *
 * The wpml format uses a two-file structure:
 *   1. template.kml: editable mission settings and EGM96 template heights
 *   2. waylines.wpml: executable route with WGS84 ellipsoid heights
 */

import type { Waypoint } from "../waypoints.js";
import { convertHeight, type GeoidGrid } from "../../geodesy/geoid.js";

export interface DjiAircraftProfile {
  /** DJI WPML droneEnumValue from DJI's current aircraft enumeration. */
  droneEnumValue: number;
  /** DJI WPML droneSubEnumValue when the selected aircraft has a subtype. */
  droneSubEnumValue?: number;
}

export interface DjiPayloadProfile {
  /** DJI WPML payloadEnumValue from DJI's current camera enumeration. */
  payloadEnumValue: number;
  /** Main gimbal is normally 0; use the DJI profile's actual mount position. */
  payloadPositionIndex: number;
}

/**
 * Options for DJI KMZ export.
 */
export interface DjiKmzOptions {
  /** Explicit WGS84 ellipsoid height for every waypoint, in waypoint order. */
  ellipsoidHeightsMeters: readonly number[];
  /**
   * Caller-supplied WGS84-to-EGM96 grid for paired template heights.
   * A trusted loader must verify package bytes and checksum before passing
   * the grid here; this exporter validates metadata shape, values, and coverage,
   * but cannot authenticate the source or checksum claim.
   */
  egm96Grid: GeoidGrid;
  /** Aircraft identity matching the aircraft that will fly the mission. */
  aircraft: DjiAircraftProfile;
  /** Camera identity and mount position matching the aircraft payload. */
  payload: DjiPayloadProfile;
  /**
   * Global auto-flight speed in m/s. Individual waypoints can override.
   * Default: drone's cruise speed.
   */
  globalSpeedMs: number;
  /**
   * Takeoff security height in meters. The drone ascends to this height
   * before flying to the first waypoint. The operator must choose it for
   * the aircraft and site; no operational height is assumed.
   */
  takeoffSecurityHeightM: number;
  /** Return-to-home height relative to takeoff. Required by DJI waylines. */
  returnToHomeHeightM: number;
  /**
   * Mission name (shown in DJI Pilot). Default "MetaRDU Mission".
   */
  missionName?: string;
  /**
   * Gimbal pitch in degrees. 0 = horizontal, -90 = straight down (nadir).
   * Default: -90 (nadir, for photogrammetry).
   */
  globalGimbalPitchDeg?: number;
}

/**
 * Generate the editable DJI template. Waypoint heights in this file use EGM96
 * and are paired with their source WGS84 ellipsoid heights.
 */
function createMissionConfig(options: NormalizedDjiKmzOptions): string {
  const droneSubType = options.aircraft.droneSubEnumValue === undefined
    ? ""
    : `<wpml:droneSubEnumValue>${options.aircraft.droneSubEnumValue}</wpml:droneSubEnumValue>`;
  return `    <wpml:missionConfig>
      <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
      <wpml:finishAction>goHome</wpml:finishAction>
      <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>
      <wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>
      <wpml:takeOffSecurityHeight>${options.takeoffSecurityHeightM}</wpml:takeOffSecurityHeight>
      <wpml:globalTransitionalSpeed>${options.globalSpeedMs}</wpml:globalTransitionalSpeed>
      <wpml:globalRTHHeight>${options.returnToHomeHeightM}</wpml:globalRTHHeight>
      <wpml:droneInfo>
        <wpml:droneEnumValue>${options.aircraft.droneEnumValue}</wpml:droneEnumValue>
        ${droneSubType}
      </wpml:droneInfo>
      <wpml:payloadInfo>
        <wpml:payloadEnumValue>${options.payload.payloadEnumValue}</wpml:payloadEnumValue>
        <wpml:payloadPositionIndex>${options.payload.payloadPositionIndex}</wpml:payloadPositionIndex>
      </wpml:payloadInfo>
    </wpml:missionConfig>`;
}

function photoActionGroup(index: number, payloadPositionIndex: number): string {
  return `
      <wpml:actionGroup>
        <wpml:actionGroupId>0</wpml:actionGroupId>
        <wpml:actionGroupStartIndex>${index}</wpml:actionGroupStartIndex>
        <wpml:actionGroupEndIndex>${index}</wpml:actionGroupEndIndex>
        <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
        <wpml:actionTrigger><wpml:actionTriggerType>reachPoint</wpml:actionTriggerType></wpml:actionTrigger>
        <wpml:action>
          <wpml:actionId>0</wpml:actionId>
          <wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc>
          <wpml:actionActuatorFuncParam>
            <wpml:fileSuffix>point-${String(index + 1).padStart(5, "0")}</wpml:fileSuffix>
            <wpml:payloadPositionIndex>${payloadPositionIndex}</wpml:payloadPositionIndex>
          </wpml:actionActuatorFuncParam>
        </wpml:action>
      </wpml:actionGroup>`;
}

function waylineActionGroup(
  index: number,
  payloadPositionIndex: number,
  gimbalPitchDeg: number,
  isPhoto: boolean,
): string {
  const photoAction = isPhoto
    ? `
        <wpml:action>
          <wpml:actionId>1</wpml:actionId>
          <wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc>
          <wpml:actionActuatorFuncParam>
            <wpml:fileSuffix>point-${String(index + 1).padStart(5, "0")}</wpml:fileSuffix>
            <wpml:payloadPositionIndex>${payloadPositionIndex}</wpml:payloadPositionIndex>
          </wpml:actionActuatorFuncParam>
        </wpml:action>`
    : "";
  return `
      <wpml:actionGroup>
        <wpml:actionGroupId>0</wpml:actionGroupId>
        <wpml:actionGroupStartIndex>${index}</wpml:actionGroupStartIndex>
        <wpml:actionGroupEndIndex>${index}</wpml:actionGroupEndIndex>
        <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
        <wpml:actionTrigger><wpml:actionTriggerType>reachPoint</wpml:actionTriggerType></wpml:actionTrigger>
        <wpml:action>
          <wpml:actionId>0</wpml:actionId>
          <wpml:actionActuatorFunc>gimbalRotate</wpml:actionActuatorFunc>
          <wpml:actionActuatorFuncParam>
            <wpml:gimbalRotateMode>absoluteAngle</wpml:gimbalRotateMode>
            <wpml:gimbalPitchRotateEnable>1</wpml:gimbalPitchRotateEnable>
            <wpml:gimbalPitchRotateAngle>${formatNumber(gimbalPitchDeg)}</wpml:gimbalPitchRotateAngle>
            <wpml:gimbalRollRotateEnable>0</wpml:gimbalRollRotateEnable>
            <wpml:gimbalRollRotateAngle>0</wpml:gimbalRollRotateAngle>
            <wpml:gimbalYawRotateEnable>0</wpml:gimbalYawRotateEnable>
            <wpml:gimbalYawRotateAngle>0</wpml:gimbalYawRotateAngle>
            <wpml:gimbalRotateTimeEnable>0</wpml:gimbalRotateTimeEnable>
            <wpml:gimbalRotateTime>0</wpml:gimbalRotateTime>
            <wpml:payloadPositionIndex>${payloadPositionIndex}</wpml:payloadPositionIndex>
          </wpml:actionActuatorFuncParam>
        </wpml:action>${photoAction}
      </wpml:actionGroup>`;
}

function waypointHeadingParam(wp: Waypoint): string {
  if (wp.headingDegrees === undefined) {
    return "<wpml:waypointHeadingParam><wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode></wpml:waypointHeadingParam>";
  }
  return `<wpml:waypointHeadingParam>
        <wpml:waypointHeadingMode>smoothTransition</wpml:waypointHeadingMode>
        <wpml:waypointHeadingAngle>${formatNumber(toDjiHeading(wp.headingDegrees))}</wpml:waypointHeadingAngle>
        <wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode>
      </wpml:waypointHeadingParam>`;
}

function waypointTurnParam(): string {
  return `<wpml:waypointTurnParam>
        <wpml:waypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:waypointTurnMode>
        <wpml:waypointTurnDampingDist>0</wpml:waypointTurnDampingDist>
      </wpml:waypointTurnParam>`;
}

function generateTemplateKml(
  waypoints: Waypoint[],
  ellipsoidHeights: readonly number[],
  egm96Heights: readonly number[],
  options: NormalizedDjiKmzOptions,
): string {
  const placemarks = waypoints.map((wp, i) => `    <Placemark>
      <Point><coordinates>${wp.longitude.toFixed(8)},${wp.latitude.toFixed(8)}</coordinates></Point>
      <wpml:index>${i}</wpml:index>
      <wpml:ellipsoidHeight>${formatNumber(ellipsoidHeights[i]!)}</wpml:ellipsoidHeight>
      <wpml:height>${formatNumber(egm96Heights[i]!)}</wpml:height>
      <wpml:useGlobalHeight>0</wpml:useGlobalHeight>
      <wpml:useGlobalSpeed>0</wpml:useGlobalSpeed>
      <wpml:waypointSpeed>${formatNumber(wp.speedMs ?? options.globalSpeedMs)}</wpml:waypointSpeed>
      <wpml:useGlobalHeadingParam>0</wpml:useGlobalHeadingParam>
      ${waypointHeadingParam(wp)}
      <wpml:useGlobalTurnParam>0</wpml:useGlobalTurnParam>
      ${waypointTurnParam()}
      <wpml:useStraightLine>1</wpml:useStraightLine>
      <wpml:gimbalPitchAngle>${formatNumber(wp.gimbalPitchDegrees ?? options.globalGimbalPitchDeg)}</wpml:gimbalPitchAngle>${wp.isPhoto ? photoActionGroup(i, options.payload.payloadPositionIndex) : ""}
    </Placemark>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
  <Document>
    <wpml:author>${xmlEscape(options.missionName)}</wpml:author>
${createMissionConfig(options)}
    <Folder>
      <wpml:templateType>waypoint</wpml:templateType>
      <wpml:templateId>0</wpml:templateId>
      <wpml:waylineCoordinateSysParam>
        <wpml:coordinateMode>WGS84</wpml:coordinateMode>
        <wpml:heightMode>EGM96</wpml:heightMode>
      </wpml:waylineCoordinateSysParam>
      <wpml:autoFlightSpeed>${options.globalSpeedMs}</wpml:autoFlightSpeed>
      <wpml:gimbalPitchMode>usePointSetting</wpml:gimbalPitchMode>
      <wpml:globalWaypointHeadingParam>
        <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>
        <wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode>
      </wpml:globalWaypointHeadingParam>
      <wpml:globalWaypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:globalWaypointTurnMode>
      <wpml:globalUseStraightLine>1</wpml:globalUseStraightLine>
${placemarks}
    </Folder>
  </Document>
</kml>`;
}

function generateWaylinesWpml(
  waypoints: Waypoint[],
  ellipsoidHeights: readonly number[],
  options: NormalizedDjiKmzOptions,
): string {
  const placemarks = waypoints.map((wp, i) => `    <Placemark>
      <Point><coordinates>${wp.longitude.toFixed(8)},${wp.latitude.toFixed(8)}</coordinates></Point>
      <wpml:index>${i}</wpml:index>
      <wpml:executeHeight>${formatNumber(ellipsoidHeights[i]!)}</wpml:executeHeight>
      <wpml:waypointSpeed>${formatNumber(wp.speedMs ?? options.globalSpeedMs)}</wpml:waypointSpeed>
      ${waypointHeadingParam(wp)}
      ${waypointTurnParam()}
      <wpml:useStraightLine>1</wpml:useStraightLine>${waylineActionGroup(i, options.payload.payloadPositionIndex, wp.gimbalPitchDegrees ?? options.globalGimbalPitchDeg, wp.isPhoto)}
    </Placemark>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
  <Document>
${createMissionConfig(options)}
    <Folder>
      <wpml:templateId>0</wpml:templateId>
      <wpml:executeHeightMode>WGS84</wpml:executeHeightMode>
      <wpml:waylineId>0</wpml:waylineId>
      <wpml:autoFlightSpeed>${options.globalSpeedMs}</wpml:autoFlightSpeed>
${placemarks}
    </Folder>
  </Document>
</kml>`;
}

interface NormalizedDjiKmzOptions {
  ellipsoidHeightsMeters: readonly number[];
  egm96Grid: GeoidGrid;
  aircraft: DjiAircraftProfile;
  payload: DjiPayloadProfile;
  globalSpeedMs: number;
  takeoffSecurityHeightM: number;
  returnToHomeHeightM: number;
  missionName: string;
  globalGimbalPitchDeg: number;
}

function normalizeOptions(options: DjiKmzOptions, waypointCount: number): NormalizedDjiKmzOptions {
  if (!options || typeof options !== "object") {
    throw new TypeError("DJI KMZ export requires explicit mission, aircraft, payload, and vertical-reference options");
  }
  if (!Array.isArray(options.ellipsoidHeightsMeters) || options.ellipsoidHeightsMeters.length !== waypointCount) {
    throw new RangeError("DJI export requires one explicit WGS84 ellipsoid height for every waypoint");
  }
  if (options.ellipsoidHeightsMeters.some((height) => !Number.isFinite(height))) {
    throw new RangeError("DJI export ellipsoid heights must all be finite");
  }
  if (!options.egm96Grid || typeof options.egm96Grid.verticalDatum !== "string") {
    throw new TypeError("DJI KMZ export requires an EGM96 grid with provenance metadata");
  }
  if (options.egm96Grid.verticalDatum.trim().toUpperCase() !== "EGM96") {
    throw new TypeError("DJI template heights require a caller-supplied grid labelled EGM96");
  }
  if (typeof options.egm96Grid.referenceEllipsoid !== "string" || !/^(WGS ?84)$/i.test(options.egm96Grid.referenceEllipsoid.trim())) {
    throw new TypeError("DJI paired ellipsoid heights require a WGS84 reference ellipsoid geoid grid");
  }
  if (!options.aircraft || !options.payload) {
    throw new TypeError("DJI KMZ export requires an explicit aircraft and camera profile");
  }
  if (!Number.isInteger(options.aircraft.droneEnumValue) || options.aircraft.droneEnumValue < 0) {
    throw new RangeError("DJI aircraft profile requires a non-negative droneEnumValue");
  }
  if (options.aircraft.droneSubEnumValue !== undefined && (!Number.isInteger(options.aircraft.droneSubEnumValue) || options.aircraft.droneSubEnumValue < 0)) {
    throw new RangeError("DJI aircraft subtype must be a non-negative integer");
  }
  if (!Number.isInteger(options.payload.payloadEnumValue) || options.payload.payloadEnumValue < 0) {
    throw new RangeError("DJI payload profile requires a non-negative payloadEnumValue");
  }
  if (!Number.isInteger(options.payload.payloadPositionIndex) || options.payload.payloadPositionIndex < 0 || options.payload.payloadPositionIndex > 2) {
    throw new RangeError("DJI payload position index must be 0, 1, or 2");
  }
  if (!Number.isFinite(options.globalSpeedMs) || options.globalSpeedMs <= 0 || options.globalSpeedMs > 15) {
    throw new RangeError("DJI global flight speed must be greater than 0 and no more than 15 m/s");
  }
  const takeoffSecurityHeightM = options.takeoffSecurityHeightM;
  if (!Number.isFinite(takeoffSecurityHeightM) || takeoffSecurityHeightM < 1.2 || takeoffSecurityHeightM > 1500) {
    throw new RangeError("DJI take-off security height must be between 1.2 and 1500 m");
  }
  if (!Number.isFinite(options.returnToHomeHeightM) || options.returnToHomeHeightM <= 0) {
    throw new RangeError("DJI return-to-home height must be a positive finite number of metres");
  }
  const missionName = options.missionName ?? "MetaRDU Survey Mission";
  if (!missionName.trim() || missionName.length > 200) {
    throw new RangeError("DJI mission name must contain 1 to 200 characters");
  }
  const globalGimbalPitchDeg = options.globalGimbalPitchDeg ?? -90;
  if (!Number.isFinite(globalGimbalPitchDeg) || globalGimbalPitchDeg < -90 || globalGimbalPitchDeg > 30) {
    throw new RangeError("DJI gimbal pitch must be between -90 and 30 degrees");
  }
  return {
    ...options,
    takeoffSecurityHeightM,
    missionName,
    globalGimbalPitchDeg,
  };
}

function validateWaypoints(waypoints: Waypoint[]): void {
  if (waypoints.length === 0) throw new Error("Cannot export KMZ: waypoints array is empty");
  if (waypoints.length > 65_536) throw new RangeError("DJI WPML supports at most 65,536 waypoints per wayline");
  for (const [index, wp] of waypoints.entries()) {
    if (!Number.isFinite(wp.latitude) || wp.latitude < -90 || wp.latitude > 90 ||
        !Number.isFinite(wp.longitude) || wp.longitude < -180 || wp.longitude > 180) {
      throw new RangeError(`DJI waypoint ${index} has invalid WGS84 coordinates`);
    }
    if (wp.speedMs !== undefined && (!Number.isFinite(wp.speedMs) || wp.speedMs <= 0 || wp.speedMs > 15)) {
      throw new RangeError(`DJI waypoint ${index} speed must be greater than 0 and no more than 15 m/s`);
    }
    if (wp.headingDegrees !== undefined && (!Number.isFinite(wp.headingDegrees) || wp.headingDegrees < -180 || wp.headingDegrees > 360)) {
      throw new RangeError(`DJI waypoint ${index} heading must be between -180 and 360 degrees`);
    }
    if (wp.gimbalPitchDegrees !== undefined && (!Number.isFinite(wp.gimbalPitchDegrees) || wp.gimbalPitchDegrees < -90 || wp.gimbalPitchDegrees > 30)) {
      throw new RangeError(`DJI waypoint ${index} gimbal pitch must be between -90 and 30 degrees`);
    }
  }
}

function formatNumber(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, "");
}

function toDjiHeading(degrees: number): number {
  return ((degrees + 180) % 360 + 360) % 360 - 180;
}

function xmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[char]!);
}

/**
 * Generate the DJI KMZ file as a Uint8Array (ZIP archive).
 *
 * Uses the built-in `zlib` module (Node.js) to create the ZIP without
 * any external dependencies.
 *
 * @param waypoints Array of waypoints
 * @param options Export options
 * @returns Uint8Array containing the KMZ file bytes
 */
export async function exportDjiKmz(
  waypoints: Waypoint[],
  options: DjiKmzOptions
): Promise<Uint8Array> {
  validateWaypoints(waypoints);
  const normalized = normalizeOptions(options, waypoints.length);
  const egm96Heights = waypoints.map((wp, i) => convertHeight(
    wp.latitude,
    wp.longitude,
    normalized.ellipsoidHeightsMeters[i]!,
    normalized.egm96Grid,
  ).orthometric);
  const templateKml = generateTemplateKml(waypoints, normalized.ellipsoidHeightsMeters, egm96Heights, normalized);
  const waylinesWpml = generateWaylinesWpml(waypoints, normalized.ellipsoidHeightsMeters, normalized);

  // Build the ZIP archive (KMZ = ZIP)
  return await buildKmzZip([
    { path: "wpmz/template.kml", content: templateKml },
    { path: "wpmz/waylines.wpml", content: waylinesWpml },
  ]);
}

/**
 * Build a minimal ZIP archive from a list of files.
 *
 * This is a minimal ZIP writer that supports the deflate compression
 * used by KMZ files. It does NOT support encryption, ZIP64, or multi-disk archives.
 *
 * For a full-featured ZIP writer, use the `jszip` or `fflate` library.
 * This minimal implementation is provided to keep the engine dependency-free.
 */
async function buildKmzZip(
  files: Array<{ path: string; content: string }>
): Promise<Uint8Array> {
  // Use Node's built-in zlib for deflate compression
  const { deflateRawSync } = await import("node:zlib");

  const encoder = new TextEncoder();
  const localFileHeaders: Uint8Array[] = [];
  const centralDirectoryEntries: Uint8Array[] = [];
  const fileData: Uint8Array[] = [];

  let offset = 0;

  for (const file of files) {
    const contentBytes = encoder.encode(file.content);
    // ZIP method 8 stores raw DEFLATE, without a zlib wrapper.
    const compressed = deflateRawSync(Buffer.from(contentBytes));

    // CRC32 of the uncompressed content
    const crc = crc32(contentBytes);

    // Local file header
    const localHeader = new ArrayBuffer(30 + file.path.length);
    const dv = new DataView(localHeader);
    dv.setUint32(0, 0x04034b50, true);     // Local file header signature
    dv.setUint16(4, 20, true);              // Version needed to extract (2.0)
    dv.setUint16(6, 0, true);               // General purpose bit flag
    dv.setUint16(8, 8, true);               // Compression method (deflate)
    dv.setUint16(10, 0, true);              // File last modification time
    dv.setUint16(12, 0, true);              // File last modification date
    dv.setUint32(14, crc, true);            // CRC-32
    dv.setUint32(18, compressed.length, true);  // Compressed size
    dv.setUint32(22, contentBytes.length, true); // Uncompressed size
    dv.setUint16(26, file.path.length, true);    // File name length
    dv.setUint16(28, 0, true);              // Extra field length

    const localHeaderBytes = new Uint8Array(localHeader);
    const pathBytes = encoder.encode(file.path);
    localHeaderBytes.set(pathBytes, 30);

    localFileHeaders.push(localHeaderBytes);
    fileData.push(new Uint8Array(compressed));

    // Central directory file header
    const centralHeader = new ArrayBuffer(46 + file.path.length);
    const cdv = new DataView(centralHeader);
    cdv.setUint32(0, 0x02014b50, true);     // Central file header signature
    cdv.setUint16(4, 20, true);             // Version made by
    cdv.setUint16(6, 20, true);             // Version needed to extract
    cdv.setUint16(8, 0, true);              // General purpose bit flag
    cdv.setUint16(10, 8, true);             // Compression method
    cdv.setUint16(12, 0, true);             // File last modification time
    cdv.setUint16(14, 0, true);             // File last modification date
    cdv.setUint32(16, crc, true);           // CRC-32
    cdv.setUint32(20, compressed.length, true);  // Compressed size
    cdv.setUint32(24, contentBytes.length, true); // Uncompressed size
    cdv.setUint16(28, file.path.length, true);    // File name length
    cdv.setUint16(30, 0, true);             // Extra field length
    cdv.setUint16(32, 0, true);             // File comment length
    cdv.setUint16(34, 0, true);             // Disk number where file starts
    cdv.setUint16(36, 0, true);             // Internal file attributes
    cdv.setUint32(38, 0, true);             // External file attributes
    cdv.setUint32(42, offset, true);        // Relative offset of local file header

    const centralHeaderBytes = new Uint8Array(centralHeader);
    centralHeaderBytes.set(pathBytes, 46);
    centralDirectoryEntries.push(centralHeaderBytes);

    // Update offset for next file
    offset += localHeaderBytes.length + compressed.length;
  }

  // End of central directory record
  const centralDirSize = centralDirectoryEntries.reduce(
    (sum, e) => sum + e.length, 0
  );
  const eocd = new ArrayBuffer(22);
  const edv = new DataView(eocd);
  edv.setUint32(0, 0x06054b50, true);       // End of central directory signature
  edv.setUint16(4, 0, true);                // Number of this disk
  edv.setUint16(6, 0, true);                // Disk where central directory starts
  edv.setUint16(8, files.length, true);     // Number of central directory records on this disk
  edv.setUint16(10, files.length, true);    // Total number of central directory records
  edv.setUint32(12, centralDirSize, true);  // Size of central directory
  edv.setUint32(16, offset, true);          // Offset of start of central directory
  edv.setUint16(20, 0, true);               // Comment length

  // Concatenate all parts
  const totalSize =
    localFileHeaders.reduce((s, a) => s + a.length, 0) +
    fileData.reduce((s, a) => s + a.length, 0) +
    centralDirectoryEntries.reduce((s, a) => s + a.length, 0) +
    22;

  const result = new Uint8Array(totalSize);
  let pos = 0;
  for (let i = 0; i < files.length; i++) {
    result.set(localFileHeaders[i]!, pos); pos += localFileHeaders[i]!.length;
    result.set(fileData[i]!, pos); pos += fileData[i]!.length;
  }
  for (const entry of centralDirectoryEntries) {
    result.set(entry, pos); pos += entry.length;
  }
  result.set(new Uint8Array(eocd), pos);

  return result;
}

/**
 * CRC-32 lookup table (polynomial 0xEDB88320, standard ZIP CRC).
 */
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/**
 * Compute CRC-32 of a byte array.
 */
function crc32(bytes: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    crc = CRC32_TABLE[(crc ^ byte) & 0xFF]! ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
