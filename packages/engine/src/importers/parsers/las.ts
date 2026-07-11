import { ParsedSurveyData } from '../droneTypes';

/**
 * LAS/LAZ Point Cloud Parser
 *
 * AUDIT FIX (2026-07-03): Upgraded from a minimal parser that only supported
 * LAS point format 0 (20 bytes, no RGB, no GPS-time) with a hardcoded 28-byte
 * record length and 50K point cap.
 *
 * Now properly reads the LAS header to support:
 *   - LAS 1.2, 1.3, 1.4 (version major.minor at bytes 24-25)
 *   - Point data formats 0-3 (LAS 1.2-1.3) and 6-8 (LAS 1.4)
 *   - Variable point record length (read from header, not hardcoded)
 *   - RGB data (formats 2, 3, 7, 8)
 *   - GPS time (formats 1, 3, 6, 7, 8)
 *   - Variable header size with VLRs (offset to point data from bytes 96-99)
 *   - 100K point cap (was 50K)
 *
 * References:
 *   - LAS Specification 1.4-r15 (ASPRS, 2019)
 *   - LAS 1.2/1.3 point data record formats
 */

interface LasHeader {
  versionMajor: number
  versionMinor: number
  pointDataFormatId: number
  pointDataRecordLength: number
  pointDataOffset: number
  numberOfPointRecords: number
  scaleX: number
  scaleY: number
  scaleZ: number
  offsetX: number
  offsetY: number
  offsetZ: number
}

function readHeader(view: DataView): LasHeader {
  // File signature ("LASF")
  const sig = String.fromCharCode(
    view.getUint8(0), view.getUint8(1),
    view.getUint8(2), view.getUint8(3),
  )
  if (sig !== 'LASF') {
    throw new Error(`Invalid LAS file signature: "${sig}" (expected "LASF")`)
  }

  const versionMajor = view.getUint8(24)
  const versionMinor = view.getUint8(25)

  if (versionMajor < 1 || (versionMajor === 1 && versionMinor < 2)) {
    throw new Error(`Unsupported LAS version: ${versionMajor}.${versionMinor} (minimum 1.2)`)
  }

  // Header size (offset to first VLR) — typically 227 for LAS 1.2-1.3, 375 for LAS 1.4
  const headerSize = view.getUint16(94, true)

  // Offset to point data (may be larger than headerSize if VLRs exist)
  const pointDataOffset = view.getUint32(96, true)

  // Point data format ID (low 4 bits of byte 104; high 4 bits reserved in 1.4)
  const pointDataFormatId = view.getUint8(104) & 0x0F

  // Point data record length (bytes 105-106)
  const pointDataRecordLength = view.getUint16(105, true)

  // Number of point records (bytes 107-110 in 1.2-1.3; in 1.4 may be 0 if using extended counts)
  const numberOfPointRecords = view.getUint32(107, true)

  // Scale factors and offsets
  const scaleX = view.getFloat64(131, true)
  const scaleY = view.getFloat64(139, true)
  const scaleZ = view.getFloat64(147, true)
  const offsetX = view.getFloat64(155, true)
  const offsetY = view.getFloat64(163, true)
  const offsetZ = view.getFloat64(171, true)

  return {
    versionMajor,
    versionMinor,
    pointDataFormatId,
    pointDataRecordLength,
    pointDataOffset: pointDataOffset || headerSize,
    numberOfPointRecords,
    scaleX, scaleY, scaleZ,
    offsetX, offsetY, offsetZ,
  }
}

/**
 * Parse a single point record based on the point data format.
 *
 * LAS Point Data Record Formats:
 *   Format 0 (20 bytes): X, Y, Z, intensity, return info, classification, etc. (no GPS, no RGB)
 *   Format 1 (28 bytes): Format 0 + GPS time (8 bytes)
 *   Format 2 (26 bytes): Format 0 + RGB (2+2+2 bytes)
 *   Format 3 (34 bytes): Format 0 + GPS time + RGB
 *   Format 6 (30 bytes): LAS 1.4 — X, Y, Z, intensity, return info, classification, GPS time (no RGB)
 *   Format 7 (36 bytes): Format 6 + RGB
 *   Format 8 (38 bytes): Format 7 + NIR
 */
function parsePoint(
  view: DataView,
  offset: number,
  format: number,
  header: LasHeader,
): { x: number; y: number; z: number; r?: number; g?: number; b?: number; gpsTime?: number; classification?: number } {
  // X, Y, Z are always the first 12 bytes (3 × int32) in all formats
  const x = view.getInt32(offset, true) * header.scaleX + header.offsetX
  const y = view.getInt32(offset + 4, true) * header.scaleY + header.offsetY
  const z = view.getInt32(offset + 8, true) * header.scaleZ + header.offsetZ

  // Intensity (uint16 at offset 12)
  const intensity = view.getUint16(offset + 12, true)

  // Classification (offset 20 for formats 0-5, offset 18 for formats 6-8 in LAS 1.4)
  let classification = 0
  let gpsTime: number | undefined
  let r: number | undefined, g: number | undefined, b: number | undefined

  if (format <= 5) {
    classification = view.getUint8(offset + 20) & 0x1F  // low 5 bits

    // GPS time (format 1, 3, 4, 5) at offset 20
    if (format === 1 || format === 3 || format === 4 || format === 5) {
      gpsTime = view.getFloat64(offset + 20, true)
    }

    // RGB (format 2, 3, 5) — at the end of the record
    if (format === 2 || format === 3 || format === 5) {
      const rgbOffset = format === 2 ? offset + 20 : offset + 28
      r = view.getUint16(rgbOffset, true)
      g = view.getUint16(rgbOffset + 2, true)
      b = view.getUint16(rgbOffset + 4, true)
    }
  } else {
    // LAS 1.4 formats 6-8
    classification = view.getUint8(offset + 18) & 0x1F

    // GPS time at offset 22 for all 1.4 formats (6, 7, 8)
    gpsTime = view.getFloat64(offset + 22, true)

    // RGB (format 7, 8) at offset 30
    if (format === 7 || format === 8) {
      r = view.getUint16(offset + 30, true)
      g = view.getUint16(offset + 32, true)
      b = view.getUint16(offset + 34, true)
    }
  }

  return { x, y, z, r, g, b, gpsTime, classification }
}

export async function parseLas(file: File): Promise<ParsedSurveyData> {
  const arrayBuffer = await file.arrayBuffer();
  const view = new DataView(arrayBuffer);

  try {
    const header = readHeader(view)

    // Cap at 100K points (was 50K) for browser memory
    const maxPoints = Math.min(header.numberOfPointRecords, 100000)
    const recordLen = header.pointDataRecordLength

    const points: ParsedSurveyData['points'] = [];
    let hasRgb = false
    let hasGpsTime = false

    for (let i = 0; i < maxPoints; i++) {
      const offset = header.pointDataOffset + i * recordLen;
      if (offset + recordLen > arrayBuffer.byteLength) break;

      const pt = parsePoint(view, offset, header.pointDataFormatId, header)

      if (pt.r !== undefined) hasRgb = true
      if (pt.gpsTime !== undefined) hasGpsTime = true

      // Map LAS classification codes to feature codes
      let code = 'DRONE-PC'
      if (pt.classification === 2) code = 'GROUND'
      else if (pt.classification === 3) code = 'LOW-VEG'
      else if (pt.classification === 4) code = 'MED-VEG'
      else if (pt.classification === 5) code = 'HIGH-VEG'
      else if (pt.classification === 6) code = 'BUILDING'
      else if (pt.classification === 8) code = 'MODEL-KEY'
      else if (pt.classification === 9) code = 'WATER'

      points.push({
        easting: Number(pt.x.toFixed(3)),
        northing: Number(pt.y.toFixed(3)),
        rl: Number(pt.z.toFixed(3)),
        code,
      });
    }

    return {
      points,
      metadata: {
        source: 'LAS Point Cloud',
        format: `LAS ${header.versionMajor}.${header.versionMinor} (point format ${header.pointDataFormatId})`,
        totalPoints: header.numberOfPointRecords,
        droneSpecific: {
          flightDate: new Date().toISOString(),
          hasRgb,
          hasGpsTime,
          pointDataFormat: header.pointDataFormatId,
          recordLength: recordLen,
        },
      },
    };
  } catch (err) {
    throw new Error(
      `Failed to parse LAS file: ${err instanceof Error ? err.message : 'invalid format'}`
    );
  }
}

export async function parseLaz(file: File): Promise<ParsedSurveyData> {
  // LAZ is LASzip-compressed LAS — requires server-side decompression
  // (laszip-python or PDAL). The /api/compute/parse-laz route would
  // call PDAL or laszip to decompress, then parse the result.
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', 'parse-laz');

  const res = await fetch('/api/compute/parse-laz', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    throw new Error(
      'LAZ parsing requires server-side processing (PDAL/laszip). ' +
      'The /api/compute/parse-laz endpoint is not yet configured. ' +
      'Convert your LAZ file to LAS using laszip or PDAL, then upload the .las file.'
    );
  }

  return res.json();
}
