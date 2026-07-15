/**
 * DJI KMZ (wpml) mission export.
 *
 * Generates a KMZ file containing a `wpmz/res/wml.waypoints` XML document
 * in the DJI Pilot 2 / Litchi waypoint format.
 *
 * The KMZ is a ZIP archive containing:
 *   wpmz/
 *     res/
 *       wml.waypoints   (the actual waypoint XML, despite the extension it's XML)
 *     template.kml      (mission metadata)
 *
 * References:
 *   - DJI WPML spec: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/overview.html
 *   - Litchi CSV-compatible waypoints: https://flylitchi.com/help/how-to-create-and-edit-missions
 *
 * The wpml format uses a two-file structure:
 *   1. template.kml: mission-level config (takeoff security height, global speed, etc.)
 *   2. wml.waypoints: per-waypoint detail (lat, lng, height, actions)
 */

import type { Waypoint } from "../waypoints.js";

/**
 * Options for DJI KMZ export.
 */
export interface DjiKmzOptions {
  /**
   * Altitude reference mode.
   * - "EGM96" (default, DJI standard): height above the EGM96 geoid (≈ MSL)
   * - "WGS84": height above the WGS84 ellipsoid
   * - "relative" / "takeoff": height above the takeoff point
   *
   * For photogrammetry missions, "EGM96" is recommended because it gives
   * consistent AGL when terrain-aware altitude is used.
   */
  altitudeReference?: "EGM96" | "WGS84" | "relative" | "takeoff";
  /**
   * Global auto-flight speed in m/s. Individual waypoints can override.
   * Default: drone's cruise speed.
   */
  globalSpeedMs?: number;
  /**
   * Takeoff security height in meters. The drone ascends to this height
   * before flying to the first waypoint. Default 30m.
   */
  takeoffSecurityHeightM?: number;
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
 * Generate the `template.kml` content for a DJI wpml mission.
 *
 * This file contains mission-level configuration.
 */
function generateTemplateKml(
  waypoints: Waypoint[],
  options: Required<DjiKmzOptions>
): string {
  const first = waypoints[0]!;

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
  <Document>
    <wpml:missionConfig>
      <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
      <wpml:finishAction>goHome</wpml:finishAction>
      <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>
      <wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>
      <wpml:globalTransitionalSpeed>${options.globalSpeedMs}</wpml:globalTransitionalSpeed>
      <wpml:droneInfo>
        <wpml:droneEnumValue>68</wpml:droneEnumValue>
        <wpml:droneSubEnumValue>0</wpml:droneSubEnumValue>
      </wpml:droneInfo>
      <wpml:payloadInfo>
        <wpml:payloadEnumValue>52</wpml:payloadEnumValue>
        <wpml:payloadSubEnumValue>0</wpml:payloadSubEnumValue>
        <wpml:positionX>0</wpml:positionX>
        <wpml:positionY>0</wpml:positionY>
        <wpml:positionZ>0</wpml:positionZ>
      </wpml:payloadInfo>
      <wpml:takeoffSecurityHeight>${options.takeoffSecurityHeightM}</wpml:takeoffSecurityHeight>
      <wpml:takeoffRefPoint>
        <wpml:longitude>${first.longitude.toFixed(8)}</wpml:longitude>
        <wpml:latitude>${first.latitude.toFixed(8)}</wpml:latitude>
      </wpml:takeoffRefPoint>
    </wpml:missionConfig>
    <Folder>
      <wpml:templateType>waypoint</wpml:templateType>
      <wpml:templateId>0</wpml:templateId>
      <wpml:autoFlightSpeed>${options.globalSpeedMs}</wpml:autoFlightSpeed>
      <wpml:waypointHeadingParam>
        <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>
      </wpml:waypointHeadingParam>
      <wpml:waypointTurnParam>
        <wpml:waypointTurnMode>coordinateTurn</wpml:waypointTurnMode>
        <wpml:waypointTurnDampingDist>0</wpml:waypointTurnDampingDist>
      </wpml:waypointTurnParam>
      <wpml:waypointGimbalHeadingParam>
        <wpml:waypointGimbalHeadingMode>followWayline</wpml:waypointGimbalHeadingMode>
        <wpml:gimbalPitch>${options.globalGimbalPitchDeg}</wpml:gimbalPitch>
      </wpml:waypointGimbalHeadingParam>
      <Placemark>
        <wpml:index>0</wpml:index>
        <Point>
          <coordinates>${first.longitude.toFixed(8)},${first.latitude.toFixed(8)}</coordinates>
        </Point>
        <wpml:waypointHeadingParam>
          <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>
        </wpml:waypointHeadingParam>
        <wpml:waypointTurnParam>
          <wpml:waypointTurnMode>coordinateTurn</wpml:waypointTurnMode>
          <wpml:waypointTurnDampingDist>0</wpml:waypointTurnDampingDist>
        </wpml:waypointTurnParam>
        <wpml:waypointGimbalHeadingParam>
          <wpml:waypointGimbalHeadingMode>followWayline</wpml:waypointGimbalHeadingMode>
          <wpml:gimbalPitch>${options.globalGimbalPitchDeg}</wpml:gimbalPitch>
        </wpml:waypointGimbalHeadingParam>
        <wpml:waypointContent>
          <wpml:waypointSpeed>${options.globalSpeedMs}</wpml:waypointSpeed>
          <wpml:waypointHeight>${first.altitudeMeters.toFixed(2)}</wpml:waypointHeight>
          <wpml:useGlobalHeight>0</wpml:useGlobalHeight>
          <wpml:useGlobalSpeed>1</wpml:useGlobalSpeed>
          <wpml:useGlobalTurnParam>1</wpml:useGlobalTurnParam>
          <wpml:useGlobalHeadingParam>1</wpml:useGlobalHeadingParam>
          <wpml:waypointHeadingParam>
            <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>
          </wpml:waypointHeadingParam>
          <wpml:actionGroup>
            <wpml:actionGroupId>0</wpml:actionGroupId>
            <wpml:actionGroupStartIndex>0</wpml:actionGroupStartIndex>
            <wpml:actionGroupEndIndex>${waypoints.length - 1}</wpml:actionGroupEndIndex>
            <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
            <wpml:actionTrigger>
              <wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>
            </wpml:actionTrigger>
            <wpml:action>
              <wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc>
              <wpml:actionActuatorFuncParam>
                <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
                <wpml:useGlobalPayloadLensIndex>1</wpml:useGlobalPayloadLensIndex>
              </wpml:actionActuatorFuncParam>
            </wpml:action>
          </wpml:actionGroup>
        </wpml:waypointContent>
      </Placemark>
    </Folder>
  </Document>
</kml>`;
}

/**
 * Generate the `wml.waypoints` content (per-waypoint detail).
 *
 * Despite the `.waypoints` extension, this file is XML.
 */
function generateWaypointsXml(
  waypoints: Waypoint[],
  options: Required<DjiKmzOptions>
): string {
  const placemarks = waypoints.map((wp, i) => {
    const speed = wp.speedMs ?? options.globalSpeedMs;
    const gimbalPitch = wp.gimbalPitchDegrees ?? options.globalGimbalPitchDeg;
    const heading = wp.headingDegrees ?? 0;

    return `      <Placemark>
        <wpml:index>${i}</wpml:index>
        <Point>
          <coordinates>${wp.longitude.toFixed(8)},${wp.latitude.toFixed(8)}</coordinates>
        </Point>
        <wpml:waypointContent>
          <wpml:waypointSpeed>${speed}</wpml:waypointSpeed>
          <wpml:waypointHeight>${wp.altitudeMeters.toFixed(2)}</wpml:waypointHeight>
          <wpml:useGlobalHeight>0</wpml:useGlobalHeight>
          <wpml:useGlobalSpeed>1</wpml:useGlobalSpeed>
          <wpml:useGlobalTurnParam>1</wpml:useGlobalTurnParam>
          <wpml:useGlobalHeadingParam>1</wpml:useGlobalHeadingParam>
          <wpml:waypointHeadingParam>
            <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>
            <wpml:waypointHeadingAngle>${heading.toFixed(2)}</wpml:waypointHeadingAngle>
          </wpml:waypointHeadingParam>
          <wpml:waypointGimbalHeadingParam>
            <wpml:waypointGimbalHeadingMode>followWayline</wpml:waypointGimbalHeadingMode>
            <wpml:gimbalPitch>${gimbalPitch}</wpml:gimbalPitch>
          </wpml:waypointGimbalHeadingParam>
          <wpml:actionGroup>
            <wpml:actionGroupId>${i}</wpml:actionGroupId>
            <wpml:actionGroupStartIndex>${i}</wpml:actionGroupStartIndex>
            <wpml:actionGroupEndIndex>${i}</wpml:actionGroupEndIndex>
            <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
            <wpml:actionTrigger>
              <wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>
            </wpml:actionTrigger>
            <wpml:action>
              <wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc>
              <wpml:actionActuatorFuncParam>
                <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
                <wpml:useGlobalPayloadLensIndex>1</wpml:useGlobalPayloadLensIndex>
              </wpml:actionActuatorFuncParam>
            </wpml:action>
          </wpml:actionGroup>
        </wpml:waypointContent>
      </Placemark>`;
  }).join("\n");

  const first = waypoints[0]!;

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
  <Document>
    <wpml:missionConfig>
      <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
      <wpml:finishAction>goHome</wpml:finishAction>
      <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>
      <wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>
      <wpml:globalTransitionalSpeed>${options.globalSpeedMs}</wpml:globalTransitionalSpeed>
      <wpml:takeoffSecurityHeight>${options.takeoffSecurityHeightM}</wpml:takeoffSecurityHeight>
      <wpml:takeoffRefPoint>
        <wpml:longitude>${first.longitude.toFixed(8)}</wpml:longitude>
        <wpml:latitude>${first.latitude.toFixed(8)}</wpml:latitude>
      </wpml:takeoffRefPoint>
    </wpml:missionConfig>
    <Folder>
      <wpml:templateType>waypoint</wpml:templateType>
      <wpml:templateId>0</wpml:templateId>
      <wpml:autoFlightSpeed>${options.globalSpeedMs}</wpml:autoFlightSpeed>
      <wpml:waypointHeadingParam>
        <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>
      </wpml:waypointHeadingParam>
      <wpml:waypointTurnParam>
        <wpml:waypointTurnMode>coordinateTurn</wpml:waypointTurnMode>
        <wpml:waypointTurnDampingDist>0</wpml:waypointTurnDampingDist>
      </wpml:waypointTurnParam>
      <wpml:waypointGimbalHeadingParam>
        <wpml:waypointGimbalHeadingMode>followWayline</wpml:waypointGimbalHeadingMode>
        <wpml:gimbalPitch>${options.globalGimbalPitchDeg}</wpml:gimbalPitch>
      </wpml:waypointGimbalHeadingParam>
${placemarks}
    </Folder>
  </Document>
</kml>`;
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
  options: DjiKmzOptions = {}
): Promise<Uint8Array> {
  if (waypoints.length === 0) {
    throw new Error("Cannot export KMZ: waypoints array is empty");
  }

  const merged: Required<DjiKmzOptions> = {
    altitudeReference: options.altitudeReference ?? "EGM96",
    globalSpeedMs: options.globalSpeedMs ?? 15,
    takeoffSecurityHeightM: options.takeoffSecurityHeightM ?? 30,
    missionName: options.missionName ?? "MetaRDU Mission",
    globalGimbalPitchDeg: options.globalGimbalPitchDeg ?? -90,
  };

  const templateKml = generateTemplateKml(waypoints, merged);
  const waypointsXml = generateWaypointsXml(waypoints, merged);

  // Build the ZIP archive (KMZ = ZIP)
  return await buildKmzZip([
    { path: "wpmz/template.kml", content: templateKml },
    { path: "wpmz/res/wml.waypoints", content: waypointsXml },
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
  const { deflateSync } = await import("node:zlib");

  const encoder = new TextEncoder();
  const localFileHeaders: Uint8Array[] = [];
  const centralDirectoryEntries: Uint8Array[] = [];
  const fileData: Uint8Array[] = [];

  let offset = 0;

  for (const file of files) {
    const contentBytes = encoder.encode(file.content);
    const compressed = deflateSync(Buffer.from(contentBytes));

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
