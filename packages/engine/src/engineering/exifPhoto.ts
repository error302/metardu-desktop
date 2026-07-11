/**
 * Geotagged Photo EXIF Parsing
 *
 * Client-side EXIF GPS data extraction from JPEG/TIFF photo files.
 * No npm dependencies — all parsing implemented from scratch using the
 * EXIF 2.3 Specification and well-documented binary format structures.
 *
 * Standards:
 * - EXIF 2.3 Specification (JEITA CP-3451)
 * - OGC EXIF Metadata
 * - WGS84 Technical Manual (NIMA TR8350.2)
 *
 * @packageDocumentation
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EXIFGPSData {
  /** Latitude in decimal degrees */
  latitude: number;
  /** Longitude in decimal degrees */
  longitude: number;
  /** Altitude in meters above sea level (may be negative) */
  altitude: number;
  /** Altitude reference: above/below sea level */
  altitudeRef: 'above' | 'below' | 'unknown';
  /** Photo capture timestamp */
  timestamp: Date;
  /** Camera manufacturer */
  cameraMake: string;
  /** Camera model */
  cameraModel: string;
  /** GPS compass heading 0–360°, -1 if unavailable */
  heading: number;
  /** GPS accuracy in meters, -1 if unavailable */
  accuracy: number;
  /** Original filename */
  filename: string;
  /** Base64-encoded JPEG thumbnail if available */
  thumbnail: string | null;
}

export interface PhotoWithLocation {
  file: File;
  /** EXIF data, or null if no GPS information found */
  exif: EXIFGPSData | null;
  /** Whether any EXIF data was found (even without GPS) */
  hasEXIF: boolean;
  /** Error message if parsing failed */
  error?: string;
}

// ─── Internal EXIF Types ─────────────────────────────────────────────────────

const TIFF_BYTE_ORDER_LE = 0x4949; // 'II' (Intel, little-endian)
const TIFF_BYTE_ORDER_BE = 0x4d4d; // 'MM' (Motorola, big-endian)
const TIFF_MAGIC = 42;

// EXIF data types
const EXIF_TYPE_BYTE = 1; // 1 byte
const EXIF_TYPE_ASCII = 2; // 1 byte per char, null-terminated
const EXIF_TYPE_SHORT = 3; // 2 bytes unsigned
const EXIF_TYPE_LONG = 4; // 4 bytes unsigned
const EXIF_TYPE_RATIONAL = 5; // 8 bytes (numerator/denominator)
const EXIF_TYPE_UNDEFINED = 7; // 1 byte
const EXIF_TYPE_SLONG = 9; // 4 bytes signed
const EXIF_TYPE_SRATIONAL = 10; // 8 bytes signed rational

// Tag sizes in bytes
const TAG_TYPE_SIZES: Record<number, number> = {
  [EXIF_TYPE_BYTE]: 1,
  [EXIF_TYPE_ASCII]: 1,
  [EXIF_TYPE_SHORT]: 2,
  [EXIF_TYPE_LONG]: 4,
  [EXIF_TYPE_RATIONAL]: 8,
  [EXIF_TYPE_UNDEFINED]: 1,
  [EXIF_TYPE_SLONG]: 4,
  [EXIF_TYPE_SRATIONAL]: 8,
};

// Main IFD tag IDs
const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_GPS_IFD_POINTER = 0x8825;

// GPS IFD tag IDs
const TAG_GPS_LATITUDE_REF = 0x0001;
const TAG_GPS_LATITUDE = 0x0002;
const TAG_GPS_LONGITUDE_REF = 0x0003;
const TAG_GPS_LONGITUDE = 0x0004;
const TAG_GPS_ALTITUDE_REF = 0x0005;
const TAG_GPS_ALTITUDE = 0x0006;
const TAG_GPS_TIMESTAMP = 0x0007;
const TAG_GPS_IMG_DIRECTION = 0x0011;
const TAG_GPS_H_POSITIONING_ERROR = 0x001e;

interface IFDEntry {
  tag: number;
  type: number;
  count: number;
  valueOffset: number; // offset from TIFF header start
  isOffset: boolean; // true if value doesn't fit in 4 bytes
}

interface ParsedEXIF {
  byteOrder: 'le' | 'be';
  tiffHeaderOffset: number; // offset in the ArrayBuffer where TIFF header starts
  ifd0Entries: IFDEntry[];
  ifd1Offset: number | null; // thumbnail IFD offset (relative to TIFF header)
  gpsEntries: IFDEntry[];
}

// ─── Binary Reader Helper ────────────────────────────────────────────────────

/**
 * Lightweight binary reader that handles both little-endian and big-endian byte orders.
 */
class BinaryReader {
  private view: DataView;
  private order: 'le' | 'be';

  constructor(buffer: ArrayBuffer, order: 'le' | 'be') {
    this.view = new DataView(buffer);
    this.order = order;
  }

  getUint8(offset: number): number {
    return this.view.getUint8(offset);
  }

  getUint16(offset: number): number {
    return this.order === 'le'
      ? this.view.getUint16(offset, true)
      : this.view.getUint16(offset, false);
  }

  getInt16(offset: number): number {
    return this.order === 'le'
      ? this.view.getInt16(offset, true)
      : this.view.getInt16(offset, false);
  }

  getUint32(offset: number): number {
    return this.order === 'le'
      ? this.view.getUint32(offset, true)
      : this.view.getUint32(offset, false);
  }

  getInt32(offset: number): number {
    return this.order === 'le'
      ? this.view.getInt32(offset, true)
      : this.view.getInt32(offset, false);
  }

  getFloat64(offset: number): number {
    return this.view.getFloat64(offset, this.order === 'le');
  }

  /**
   * Read a rational number (two 32-bit values: numerator/denominator).
   * Returns the floating-point result.
   */
  getRational(offset: number): number {
    const num = this.getUint32(offset);
    const den = this.getUint32(offset + 4);
    return den === 0 ? 0 : num / den;
  }

  /**
   * Read a signed rational number.
   */
  getSRational(offset: number): number {
    const num = this.getInt32(offset);
    const den = this.getInt32(offset + 4);
    return den === 0 ? 0 : num / den;
  }

  /**
   * Read an ASCII string (null-terminated).
   */
  getASCII(offset: number, length: number): string {
    const bytes = new Uint8Array(this.view.buffer, offset, length);
    // Find null terminator
    let end = bytes.indexOf(0);
    if (end === -1) end = length;
    let str = '';
    for (let i = 0; i < end; i++) {
      str += String.fromCharCode(bytes[i]);
    }
    return str.trim();
  }

  getBufferLength(): number {
    return this.view.byteLength;
  }
}

// ─── EXIF Parsing ────────────────────────────────────────────────────────────

/**
 * Find the EXIF APP1 segment in a JPEG file.
 *
 * JPEG structure:
 * - Starts with FF D8 (SOI marker)
 * - APP1 marker: FF E1, followed by 2-byte length, "Exif\0\0", then TIFF data
 *
 * @returns offset of TIFF header within the buffer, or -1 if not found
 */
function findEXIFAPP1(buffer: ArrayBuffer): number {
  const view = new DataView(buffer);

  // Verify JPEG SOI marker
  if (view.byteLength < 4) return -1;
  if (view.getUint8(0) !== 0xff || view.getUint8(1) !== 0xd8) return -1;

  let offset = 2;

  while (offset < view.byteLength - 4) {
    const marker = view.getUint16(offset);

    // Check for APP1 (0xFFE1)
    if (marker === 0xffe1) {
      const segLength = view.getUint16(offset + 2);

      // Verify "Exif\0\0" header
      if (offset + 4 + 6 <= view.byteLength) {
        const exifHeader = String.fromCharCode(
          view.getUint8(offset + 4),
          view.getUint8(offset + 5),
          view.getUint8(offset + 6),
          view.getUint8(offset + 7),
          view.getUint8(offset + 8),
          view.getUint8(offset + 9)
        );
        if (exifHeader === 'Exif\0\0') {
          // TIFF header starts right after "Exif\0\0"
          return offset + 10;
        }
      }
    }

    // Not APP1 — skip to next segment
    if ((marker & 0xff00) !== 0xff00) break; // Not a valid marker
    if (marker === 0xffd8 || marker === 0xffd9) break; // SOI or EOI

    const segLength = view.getUint16(offset + 2);
    if (segLength < 2) break; // Invalid segment length
    offset += 2 + segLength;
  }

  return -1;
}

/**
 * Parse the EXIF data from a JPEG ArrayBuffer.
 *
 * Returns structured IFD entries, raw buffer reference, and byte order info.
 */
function parseEXIFData(buffer: ArrayBuffer): ParsedEXIF | null {
  const tiffOffset = findEXIFAPP1(buffer);
  if (tiffOffset === -1) return null;

  const view = new DataView(buffer);
  if (tiffOffset + 8 > view.byteLength) return null;

  // Read TIFF header
  const byteOrderMark = view.getUint16(tiffOffset);
  let order: 'le' | 'be';
  if (byteOrderMark === TIFF_BYTE_ORDER_LE) {
    order = 'le';
  } else if (byteOrderMark === TIFF_BYTE_ORDER_BE) {
    order = 'be';
  } else {
    return null; // Invalid byte order
  }

  const reader = new BinaryReader(buffer, order);

  // Verify TIFF magic number (42)
  const magic = reader.getUint16(tiffOffset + 2);
  if (magic !== TIFF_MAGIC) return null;

  // Offset to first IFD (relative to TIFF header start)
  const ifd0Offset = reader.getUint32(tiffOffset + 4);
  if (ifd0Offset + tiffOffset > view.byteLength) return null;

  // Parse IFD0 (main image IFD)
  const { entries: ifd0Entries, nextIFDOffset } = parseIFD(
    reader,
    tiffOffset,
    ifd0Offset
  );

  // Find GPS IFD pointer
  let gpsEntries: IFDEntry[] = [];
  const gpsPointerEntry = ifd0Entries.find((e) => e.tag === TAG_GPS_IFD_POINTER);
  if (gpsPointerEntry) {
    const gpsIFDOffset = gpsPointerEntry.valueOffset;
    const gpsResult = parseIFD(reader, tiffOffset, gpsIFDOffset);
    gpsEntries = gpsResult.entries;
  }

  return {
    byteOrder: order,
    tiffHeaderOffset: tiffOffset,
    ifd0Entries,
    ifd1Offset: nextIFDOffset,
    gpsEntries,
  };
}

/**
 * Parse an IFD (Image File Directory) at a given offset.
 *
 * IFD structure:
 * - 2 bytes: number of entries
 * - N × 12 bytes: entries (tag:2, type:2, count:4, value/offset:4)
 * - 4 bytes: offset to next IFD (0 if none)
 */
function parseIFD(
  reader: BinaryReader,
  tiffOffset: number,
  ifdOffset: number
): { entries: IFDEntry[]; nextIFDOffset: number | null } {
  const absOffset = tiffOffset + ifdOffset;

  if (absOffset + 2 > reader.getBufferLength()) {
    return { entries: [], nextIFDOffset: null };
  }

  const entryCount = reader.getUint16(absOffset);
  const entries: IFDEntry[] = [];
  let ptr = absOffset + 2;

  for (let i = 0; i < entryCount; i++) {
    if (ptr + 12 > reader.getBufferLength()) break;

    const tag = reader.getUint16(ptr);
    const type = reader.getUint16(ptr + 2);
    const count = reader.getUint32(ptr + 4);

    const typeSize = TAG_TYPE_SIZES[type] ?? 1;
    const totalSize = count * typeSize;

    // If total data fits in 4 bytes, value is stored inline;
    // otherwise it's an offset from TIFF header
    let valueOffset: number;
    let isOffset: boolean;

    if (totalSize <= 4) {
      // Value is stored inline at ptr + 8
      valueOffset = ptr + 8;
      isOffset = false;
    } else {
      // Value offset is relative to TIFF header start
      valueOffset = tiffOffset + reader.getUint32(ptr + 8);
      isOffset = true;
    }

    entries.push({ tag, type, count, valueOffset, isOffset });
    ptr += 12;
  }

  // Next IFD offset
  let nextIFDOffset: number | null = null;
  if (ptr + 4 <= reader.getBufferLength()) {
    const next = reader.getUint32(ptr);
    if (next !== 0) {
      nextIFDOffset = next;
    }
  }

  return { entries, nextIFDOffset };
}

/**
 * Find an IFD entry by tag number.
 */
function findEntry(entries: IFDEntry[], tag: number): IFDEntry | undefined {
  return entries.find((e) => e.tag === tag);
}

/**
 * Read a string value from an IFD entry.
 */
function readStringValue(reader: BinaryReader, entry: IFDEntry): string {
  if (entry.type !== EXIF_TYPE_ASCII) return '';
  return reader.getASCII(entry.valueOffset, entry.count);
}

/**
 * Read a single unsigned 32-bit value from an IFD entry.
 * Used for IFD pointer offsets.
 */
function readLongValue(reader: BinaryReader, entry: IFDEntry): number {
  if (entry.isOffset) {
    return reader.getUint32(entry.valueOffset);
  }
  return reader.getUint32(entry.valueOffset);
}

/**
 * Read a rational array from an IFD entry (e.g., GPS coordinates).
 * GPS latitude/longitude are stored as 3 rationals: [degrees, minutes, seconds].
 */
function readRationalArray(reader: BinaryReader, entry: IFDEntry): number[] {
  const result: number[] = [];
  const count = entry.count;

  for (let i = 0; i < count; i++) {
    const offset = entry.valueOffset + i * 8;
    result.push(reader.getRational(offset));
  }

  return result;
}

/**
 * Read a single rational value from an IFD entry.
 */
function readRationalValue(reader: BinaryReader, entry: IFDEntry): number {
  return reader.getRational(entry.valueOffset);
}

/**
 * Read a single unsigned byte value from an IFD entry.
 */
function readByteValue(reader: BinaryReader, entry: IFDEntry): number {
  return reader.getUint8(entry.valueOffset);
}

/**
 * Parse a GPS date/time string (format: "YYYY:MM:DD HH:MM:SS").
 */
function parseEXIFDateTime(dateStr: string): Date {
  // Format: "2024:01:15 14:30:45"
  const cleaned = dateStr.trim();
  const match = cleaned.match(
    /^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/
  );

  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    return new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10),
      parseInt(minute, 10),
      parseInt(second, 10)
    );
  }

  // Fallback: try native Date parsing
  const fallback = new Date(cleaned.replace(/:/g, '-'));
  return isNaN(fallback.getTime()) ? new Date() : fallback;
}

/**
 * Convert GPS DMS (degrees, minutes, seconds) rational values to decimal degrees.
 *
 * @param dms   Array of 3 rational values [degrees, minutes, seconds]
 * @param ref   Reference direction ('N', 'S', 'E', 'W')
 * @returns Decimal degrees (negative for S/W)
 */
function gpsDMSToDecimal(dms: number[], ref: string): number {
  const degrees = dms[0];
  const minutes = dms[1];
  const seconds = dms[2];

  let decimal = degrees + minutes / 60 + seconds / 3600;

  if (ref === 'S' || ref === 'W') {
    decimal = -decimal;
  }

  return decimal;
}

/**
 * Extract thumbnail from IFD1 (second Image File Directory).
 *
 * Thumbnail data is referenced by two tags in IFD1:
 * - 0x0201: JPEGInterchangeFormat (offset to JPEG data)
 * - 0x0202: JPEGInterchangeFormatLength (length of JPEG data)
 */
function extractThumbnail(
  reader: BinaryReader,
  tiffOffset: number,
  ifd1Offset: number
): string | null {
  if (ifd1Offset === 0 || ifd1Offset === null) return null;

  const { entries } = parseIFD(reader, tiffOffset, ifd1Offset);
  if (entries.length === 0) return null;

  const jpegOffsetEntry = findEntry(entries, 0x0201);
  const jpegLengthEntry = findEntry(entries, 0x0202);

  if (!jpegOffsetEntry || !jpegLengthEntry) return null;

  const jpegDataOffset = tiffOffset + readLongValue(reader, jpegOffsetEntry);
  const jpegDataLength = readLongValue(reader, jpegLengthEntry);

  if (
    jpegDataOffset + jpegDataLength > reader.getBufferLength() ||
    jpegDataLength <= 0
  ) {
    return null;
  }

  // Extract the raw JPEG bytes and convert to base64
  const bytes = new Uint8Array(
    reader.getBufferLength() === reader.getBufferLength()
      ? reader['view'].buffer
      : reader['view'].buffer,
    jpegDataOffset,
    jpegDataLength
  );

  // Convert to base64
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return 'data:image/jpeg;base64,' + btoa(binary);
}

// ─── Main: extractEXIFGPS ───────────────────────────────────────────────────

/**
 * Extract EXIF GPS data from a JPEG photo file.
 *
 * Parses the binary JPEG/TIFF file, locates the EXIF APP1 marker (0xFFE1),
 * reads IFD entries, finds the GPS IFD (tag 0x8825), and extracts:
 *
 * - GPS Latitude/Longitude (DMS rationals → decimal degrees)
 * - GPS Altitude and reference
 * - GPS timestamp
 * - Camera make/model
 * - GPS compass heading and accuracy
 * - Thumbnail from IFD1
 *
 * @param file  JPEG or TIFF File object
 * @returns Parsed EXIF GPS data
 * @throws Error if file cannot be read or has no EXIF data
 *
 * @example
 * ```ts
 * const exif = await extractEXIFGPS(photoFile);
 * }, ${exif.longitude.toFixed(6)}`);
 * } m ${exif.altitudeRef}`);
 * ```
 */
export async function extractEXIFGPS(file: File): Promise<EXIFGPSData> {
  const buffer = await file.arrayBuffer();
  const exif = parseEXIFData(buffer);

  if (!exif) {
    throw new Error(`No EXIF data found in "${file.name}". Ensure the photo contains EXIF metadata.`);
  }

  const reader = new BinaryReader(buffer, exif.byteOrder);

  // ── Extract camera info from IFD0 ──
  const makeEntry = findEntry(exif.ifd0Entries, TAG_MAKE);
  const modelEntry = findEntry(exif.ifd0Entries, TAG_MODEL);
  const dateTimeEntry = findEntry(exif.ifd0Entries, TAG_DATE_TIME_ORIGINAL);

  const cameraMake = makeEntry ? readStringValue(reader, makeEntry) : '';
  const cameraModel = modelEntry ? readStringValue(reader, modelEntry) : '';

  // Try DateTimeOriginal first, fall back to DateTime (0x0132)
  let timestamp = new Date();
  if (dateTimeEntry) {
    timestamp = parseEXIFDateTime(readStringValue(reader, dateTimeEntry));
  } else {
    const dtEntry = findEntry(exif.ifd0Entries, 0x0132);
    if (dtEntry) {
      timestamp = parseEXIFDateTime(readStringValue(reader, dtEntry));
    }
  }

  // ── Extract GPS data ──
  if (exif.gpsEntries.length === 0) {
    throw new Error(
      `No GPS data found in "${file.name}". The photo may not have geotagging enabled.`
    );
  }

  const latRefEntry = findEntry(exif.gpsEntries, TAG_GPS_LATITUDE_REF);
  const latEntry = findEntry(exif.gpsEntries, TAG_GPS_LATITUDE);
  const lonRefEntry = findEntry(exif.gpsEntries, TAG_GPS_LONGITUDE_REF);
  const lonEntry = findEntry(exif.gpsEntries, TAG_GPS_LONGITUDE);
  const altRefEntry = findEntry(exif.gpsEntries, TAG_GPS_ALTITUDE_REF);
  const altEntry = findEntry(exif.gpsEntries, TAG_GPS_ALTITUDE);

  // Validate required GPS fields
  if (!latEntry || !lonEntry) {
    throw new Error(
      `Incomplete GPS coordinates in "${file.name}". Both latitude and longitude are required.`
    );
  }

  // GPS Latitude
  const latDMS = readRationalArray(reader, latEntry);
  const latRef = latRefEntry ? readStringValue(reader, latRefEntry) : 'N';
  const latitude = gpsDMSToDecimal(latDMS, latRef);

  // GPS Longitude
  const lonDMS = readRationalArray(reader, lonEntry);
  const lonRef = lonRefEntry ? readStringValue(reader, lonRefEntry) : 'E';
  const longitude = gpsDMSToDecimal(lonDMS, lonRef);

  // GPS Altitude
  let altitude = 0;
  let altitudeRef: 'above' | 'below' | 'unknown' = 'unknown';
  if (altEntry) {
    altitude = readRationalValue(reader, altEntry);
    if (altRefEntry) {
      const ref = readByteValue(reader, altRefEntry);
      altitudeRef = ref === 0 ? 'above' : ref === 1 ? 'below' : 'unknown';
      if (altitudeRef === 'below') {
        altitude = -Math.abs(altitude);
      }
    }
  }

  // GPS Timestamp (use if DateTimeOriginal not available)
  if (!dateTimeEntry) {
    const gpsTimeEntry = findEntry(exif.gpsEntries, TAG_GPS_TIMESTAMP);
    if (gpsTimeEntry) {
      const timeDMS = readRationalArray(reader, gpsTimeEntry);
      if (timeDMS.length === 3) {
        const gpsDateEntry = findEntry(exif.gpsEntries, 0x001d); // GPSDateStamp
        if (gpsDateEntry) {
          const dateStr = readStringValue(reader, gpsDateEntry);
          // Format: "YYYY:MM:DD"
          const parts = dateStr.split(':');
          if (parts.length === 3) {
            timestamp = new Date(
              parseInt(parts[0], 10),
              parseInt(parts[1], 10) - 1,
              parseInt(parts[2], 10),
              Math.floor(timeDMS[0]),
              Math.floor(timeDMS[1]),
              Math.floor(timeDMS[2])
            );
          }
        }
      }
    }
  }

  // GPS Heading (compass direction)
  let heading = -1;
  const headingEntry = findEntry(exif.gpsEntries, TAG_GPS_IMG_DIRECTION);
  if (headingEntry) {
    heading = readRationalValue(reader, headingEntry);
  }

  // GPS Horizontal Positioning Error (accuracy)
  let accuracy = -1;
  const hpeEntry = findEntry(exif.gpsEntries, TAG_GPS_H_POSITIONING_ERROR);
  if (hpeEntry) {
    accuracy = readRationalValue(reader, hpeEntry);
  }

  // Thumbnail
  let thumbnail: string | null = null;
  if (exif.ifd1Offset !== null && exif.ifd1Offset > 0) {
    try {
      thumbnail = extractThumbnail(reader, exif.tiffHeaderOffset, exif.ifd1Offset);
    } catch {
      // Thumbnail extraction is best-effort — don't fail the whole parse
      thumbnail = null;
    }
  }

  return {
    latitude,
    longitude,
    altitude: roundTo(altitude, 2),
    altitudeRef,
    timestamp,
    cameraMake,
    cameraModel,
    heading: roundTo(heading, 2),
    accuracy: roundTo(accuracy, 2),
    filename: file.name,
    thumbnail,
  };
}

// ─── Main: processPhotoFiles ────────────────────────────────────────────────

/**
 * Process multiple photo files, extracting EXIF GPS data from each.
 *
 * Files are processed in parallel for performance. Each result indicates
 * whether EXIF was found and whether GPS data is available.
 *
 * @param files  Array of File objects (JPEG/TIFF)
 * @returns Array of results with file reference, EXIF data, and status
 *
 * @example
 * ```ts
 * const results = await processPhotoFiles(fileInput.files);
 * const geotagged = results.filter(r => r.exif !== null);
 * 
 * ```
 */
export async function processPhotoFiles(
  files: File[]
): Promise<PhotoWithLocation[]> {
  const results: PhotoWithLocation[] = await Promise.all(
    files.map(async (file) => {
      try {
        const exif = await extractEXIFGPS(file);
        return {
          file,
          exif,
          hasEXIF: true,
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unknown error';
        return {
          file,
          exif: null,
          hasEXIF: false,
          error: message,
        };
      }
    })
  );

  return results;
}

// ─── Main: photosToGeoJSON ──────────────────────────────────────────────────

/**
 * Convert geotagged photos to a GeoJSON FeatureCollection of Point features.
 *
 * Only photos with valid EXIF GPS data are included. Each feature's properties
 * contain the full EXIF metadata.
 *
 * @param photos  Processed photo results from `processPhotoFiles`
 * @returns GeoJSON FeatureCollection with Point geometries
 *
 * @example
 * ```ts
 * const geojson = photosToGeoJSON(results);
 * // Use with any GeoJSON-compatible viewer (Leaflet, Mapbox, etc.)
 * ```
 */
export function photosToGeoJSON(
  photos: PhotoWithLocation[]
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  for (const photo of photos) {
    if (!photo.exif) continue;

    const exif = photo.exif;

    const feature: GeoJSON.Feature = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [exif.longitude, exif.latitude, exif.altitude],
      },
      properties: {
        filename: exif.filename,
        altitude: exif.altitude,
        altitudeRef: exif.altitudeRef,
        timestamp: exif.timestamp.toISOString(),
        cameraMake: exif.cameraMake,
        cameraModel: exif.cameraModel,
        heading: exif.heading,
        accuracy: exif.accuracy,
      },
    };

    features.push(feature);
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

// ─── Main: photosToSurveyPoints ─────────────────────────────────────────────

/**
 * Convert geotagged photos to survey point format with UTM coordinates.
 *
 * GPS coordinates (WGS84 lat/lon) are converted to UTM Zone 37S (Arc 1960)
 * for Kenya. If the photo is outside Kenya, the appropriate UTM zone is
 * determined from the longitude.
 *
 * The conversion uses a simple Transverse Mercator projection formula
 * with WGS84 ellipsoid parameters (a=6378137.0, f=1/298.257223563).
 * Accuracy is within a few metres — sufficient for photo locations.
 *
 * @param photos  Processed photo results from `processPhotoFiles`
 * @returns Array of survey points with UTM easting, northing, elevation
 *
 * @example
 * ```ts
 * const surveyPoints = photosToSurveyPoints(results);
 * for (const sp of surveyPoints) {
 *   } N: ${sp.northing.toFixed(2)} RL: ${sp.elevation.toFixed(2)}`);
 * }
 * ```
 */
export function photosToSurveyPoints(
  photos: PhotoWithLocation[]
): Array<{
  easting: number;
  northing: number;
  elevation: number;
  code: string;
  description: string;
}> {
  const results: Array<{
    easting: number;
    northing: number;
    elevation: number;
    code: string;
    description: string;
  }> = [];

  for (const photo of photos) {
    if (!photo.exif) continue;

    const exif = photo.exif;
    const { easting, northing, zone, hemisphere } = latLonToUTM(
      exif.latitude,
      exif.longitude
    );

    const code = 'PHOTO';
    const dt = exif.timestamp;
    const dateStr = dt
      ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
      : 'unknown-date';
    const timeStr = dt
      ? `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}:${String(dt.getSeconds()).padStart(2, '0')}`
      : '';

    const description = [
      `Photo: ${exif.filename}`,
      exif.cameraMake ? `Camera: ${exif.cameraMake} ${exif.cameraModel}` : '',
      `Date: ${dateStr} ${timeStr}`,
      `Alt: ${exif.altitude.toFixed(1)}m ${exif.altitudeRef}`,
      exif.heading >= 0 ? `Heading: ${exif.heading.toFixed(1)}°` : '',
      `UTM Zone ${zone}${hemisphere}`,
    ]
      .filter(Boolean)
      .join(' | ');

    results.push({
      easting: roundTo(easting, 3),
      northing: roundTo(northing, 3),
      elevation: roundTo(exif.altitude, 3),
      code,
      description,
    });
  }

  return results;
}

// ─── UTM Conversion (Transverse Mercator Projection) ────────────────────────

/**
 * WGS84 ellipsoid parameters.
 */
const WGS84_A = 6378137.0; // Semi-major axis (metres)
const WGS84_F = 1 / 298.257223563; // Flattening
const WGS84_B = WGS84_A * (1 - WGS84_F); // Semi-minor axis
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F; // First eccentricity squared
const WGS84_EP2 =
  WGS84_E2 / (1 - WGS84_E2); // Second eccentricity squared
const UTM_K0 = 0.9996; // Scale factor
const UTM_FE = 500000.0; // False easting (metres)
const UTM_FN = 10000000.0; // False northing for southern hemisphere (metres)

/**
 * Convert latitude/longitude (WGS84) to UTM coordinates.
 *
 * Uses the Transverse Mercator projection formulas from:
 * - "Map Projections — A Working Manual" (Snyder, USGS Professional Paper 1395)
 * - WGS84 Technical Manual (NIMA TR8350.2)
 *
 * For Kenya, defaults to Zone 37S. For other locations, the zone is
 * determined from the longitude: zone = floor((lon + 180) / 6) + 1.
 *
 * @param lat  Latitude in decimal degrees
 * @param lon  Longitude in decimal degrees
 * @returns UTM coordinates with zone and hemisphere info
 */
function latLonToUTM(
  lat: number,
  lon: number
): { easting: number; northing: number; zone: number; hemisphere: 'N' | 'S' } {
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;

  // Determine UTM zone
  const zone = Math.floor((lon + 180) / 6) + 1;
  const centralMeridianRad = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);

  // Northern or southern hemisphere
  const hemisphere = lat >= 0 ? 'N' : 'S';

  const sinPhi = Math.sin(latRad);
  const cosPhi = Math.cos(latRad);
  const tanPhi = Math.tan(latRad);

  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi); // Radius of curvature in prime vertical
  const T = tanPhi * tanPhi; // tan²(φ)
  const C = WGS84_EP2 * cosPhi * cosPhi; // e'²cos²(φ)
  const A = cosPhi * (lonRad - centralMeridianRad); // (λ - λ₀)cos(φ)

  // Meridional arc distance from equator
  const M = computeMeridionalArc(latRad);

  // Transverse Mercator easting
  let easting =
    UTM_K0 *
    N *
    (A +
      (1 - T + C) * (A * A * A) / 6 +
      (5 - 18 * T + T * T + 72 * C - 58 * WGS84_EP2) *
        (A * A * A * A * A) /
        120);

  // Transverse Mercator northing
  let northing =
    UTM_K0 *
    (M +
      N *
        tanPhi *
        ((A * A) / 2 +
          (5 - T + 9 * C + 4 * C * C) * (A * A * A * A) / 24 +
          (61 -
            58 * T +
            T * T +
            600 * C -
            330 * WGS84_EP2) *
            (A * A * A * A * A * A) /
            720));

  easting += UTM_FE;
  if (hemisphere === 'S') {
    northing += UTM_FN;
  }

  return { easting, northing, zone, hemisphere };
}

/**
 * Compute meridional arc distance M(φ) from the equator to latitude φ.
 *
 * Uses the series expansion per Snyder (1987):
 *   M = a[(1 − e²/4 − 3e⁴/64 − 5e⁶/256)φ
 *        − (3e²/8 + 3e⁴/32 + 45e⁶/1024)sin(2φ)
 *        + (15e⁴/256 + 45e⁶/1024)sin(4φ)
 *        − (35e⁶/3072)sin(6φ)]
 */
function computeMeridionalArc(phi: number): number {
  const e2 = WGS84_E2;
  const e4 = e2 * e2;
  const e6 = e4 * e2;

  const m0 = 1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256;
  const m1 = (3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024;
  const m2 = (15 * e4) / 256 + (45 * e6) / 1024;
  const m3 = (35 * e6) / 3072;

  return WGS84_A * (m0 * phi - m1 * Math.sin(2 * phi) + m2 * Math.sin(4 * phi) - m3 * Math.sin(6 * phi));
}

// ─── Main: isEXIFSupported ──────────────────────────────────────────────────

/**
 * Check if the browser/environment supports EXIF parsing.
 *
 * Requires:
 * - File API (File, Blob, FileReader)
 * - ArrayBuffer support
 *
 * @returns true if EXIF parsing is supported
 */
export function isEXIFSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof File === 'undefined') return false;
  if (typeof ArrayBuffer === 'undefined') return false;
  if (typeof DataView === 'undefined') return false;
  if (typeof Uint8Array === 'undefined') return false;
  if (typeof btoa === 'undefined') return false;

  return true;
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Round a number to a given number of decimal places.
 */
function roundTo(value: number, decimals: number): number {
  if (value === -1) return -1;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
