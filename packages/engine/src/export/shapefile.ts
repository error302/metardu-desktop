/**
 * Shapefile Export Module
 * Generates ESRI Shapefile format (.shp, .shx, .dbf, .prj) for GIS import
 * Pure TypeScript implementation - no external dependencies required
 */

import type { ShapefileData, ShapefileBeacon, ShapefileBoundary, ShapefileParcel } from '@/types/submission'

interface ShapefileBuffers {
  shp: ArrayBuffer
  shx: ArrayBuffer
  dbf: ArrayBuffer
  prj: string
  cpg: string
}

/**
 * Generate complete shapefile package from survey data
 */
export async function generateShapefileZip(
  data: ShapefileData
): Promise<Blob> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  
  const submissionName = `survey_${Date.now()}`
  const folder = zip.folder(submissionName)
  if (!folder) throw new Error('Failed to create zip folder')
  
  // Generate shapefiles for each geometry type
  const beacons = generatePointShapefile(data.beacons, 'beacons')
  const boundaries = generatePolylineShapefile(data.boundaries, 'boundaries')
  const parcels = generatePolygonShapefile(data.parcels, 'parcels')
  
  // Add files to zip
  folder.file(`${submissionName}_Beacons.shp`, new Uint8Array(beacons.shp))
  folder.file(`${submissionName}_Beacons.shx`, new Uint8Array(beacons.shx))
  folder.file(`${submissionName}_Beacons.dbf`, new Uint8Array(beacons.dbf))
  
  folder.file(`${submissionName}_Boundaries.shp`, new Uint8Array(boundaries.shp))
  folder.file(`${submissionName}_Boundaries.shx`, new Uint8Array(boundaries.shx))
  folder.file(`${submissionName}_Boundaries.dbf`, new Uint8Array(boundaries.dbf))
  
  folder.file(`${submissionName}_Parcels.shp`, new Uint8Array(parcels.shp))
  folder.file(`${submissionName}_Parcels.shx`, new Uint8Array(parcels.shx))
  folder.file(`${submissionName}_Parcels.dbf`, new Uint8Array(parcels.dbf))
  
  // Projection file (common for all)
  const prjContent = generatePRJ(data.projection)
  folder.file(`${submissionName}.prj`, prjContent)
  folder.file(`${submissionName}.cpg`, 'UTF-8')
  
  return zip.generateAsync({ type: 'blob' })
}

/**
 * Generate Point Shapefile (for beacons/control points)
 */
function generatePointShapefile(
  points: ShapefileBeacon[],
  name: string
): ShapefileBuffers {
  // SHP Header (100 bytes) + Records
  const header = createShapefileHeader(1, points.length) // 1 = Point type
  
  // Calculate record size: each point record = 12 bytes header + 16 bytes content
  const recordSize = 28
  const shpBuffer = new ArrayBuffer(100 + points.length * recordSize)
  const shpView = new DataView(shpBuffer)
  
  // Write header
  writeShapefileHeader(shpView, header, 1, points.length)
  
  // Write records
  let offset = 100
  points.forEach((pt, i) => {
    // Record header: content length in 16-bit words (16 bytes = 8 words)
    const recordHeader = new DataView(shpBuffer, offset, 8)
    recordHeader.setInt32(0, i + 1, false) // Record number (1-based, big-endian)
    recordHeader.setInt32(4, 10, false) // Content length in 16-bit words
    
    // Record content
    const recordContent = new DataView(shpBuffer, offset + 8, 16)
    recordContent.setInt32(0, 1, true) // Shape type: Point
    recordContent.setFloat64(4, pt.easting, true) // X
    recordContent.setFloat64(12, pt.northing, true) // Y
    
    offset += recordSize
  })
  
  // SHX (index file)
  const shxBuffer = createShapeIndex(header, points.length, recordSize)
  
  // DBF (attribute table)
  const dbfBuffer = createPointDBF(points)
  
  return {
    shp: shpBuffer,
    shx: shxBuffer,
    dbf: dbfBuffer,
    prj: '',
    cpg: 'UTF-8'
  }
}

/**
 * Generate Polyline Shapefile (for boundary lines)
 */
function generatePolylineShapefile(
  lines: ShapefileBoundary[],
  name: string
): ShapefileBuffers {
  // Each line has 2 points
  const totalPoints = lines.length * 2
  const numParts = lines.length
  
  // Calculate record size for polylines
  // Header (8) + Type (4) + Box (32) + NumParts (4) + NumPoints (4) + Parts array + Points array
  const headerSize = 8 + 4 + 32 + 4 + 4 + (numParts * 4) + (totalPoints * 16)
  const recordSize = 8 + headerSize
  
  const header = createShapefileHeader(3, lines.length) // 3 = Polyline type
  const shpBuffer = new ArrayBuffer(100 + lines.length * recordSize)
  const shpView = new DataView(shpBuffer)
  
  writeShapefileHeader(shpView, header, 3, lines.length)
  
  let offset = 100
  lines.forEach((line, i) => {
    const contentLength = headerSize
    
    // Record header
    const recordHeader = new DataView(shpBuffer, offset, 8)
    recordHeader.setInt32(0, i + 1, false)
    recordHeader.setInt32(4, (contentLength / 2), false) // In 16-bit words
    
    // Record content
    const content = new DataView(shpBuffer, offset + 8, contentLength)
    let contentOffset = 0
    
    content.setInt32(contentOffset, 3, true) // Shape type: Polyline
    contentOffset += 4
    
    // Bounding box
    const minX = Math.min(line.from_easting, line.to_easting)
    const maxX = Math.max(line.from_easting, line.to_easting)
    const minY = Math.min(line.from_northing, line.to_northing)
    const maxY = Math.max(line.from_northing, line.to_northing)
    
    content.setFloat64(contentOffset, minX, true); contentOffset += 8
    content.setFloat64(contentOffset, minY, true); contentOffset += 8
    content.setFloat64(contentOffset, maxX, true); contentOffset += 8
    content.setFloat64(contentOffset, maxY, true); contentOffset += 8
    
    content.setInt32(contentOffset, 1, true); contentOffset += 4 // NumParts
    content.setInt32(contentOffset, 2, true); contentOffset += 4 // NumPoints
    
    content.setInt32(contentOffset, 0, true); contentOffset += 4 // Part index
    
    // Points
    content.setFloat64(contentOffset, line.from_easting, true); contentOffset += 8
    content.setFloat64(contentOffset, line.from_northing, true); contentOffset += 8
    content.setFloat64(contentOffset, line.to_easting, true); contentOffset += 8
    content.setFloat64(contentOffset, line.to_northing, true); contentOffset += 8
    
    offset += 8 + contentLength
  })
  
  const shxBuffer = createShapeIndex(header, lines.length, recordSize)
  const dbfBuffer = createPolylineDBF(lines)
  
  return {
    shp: shpBuffer,
    shx: shxBuffer,
    dbf: dbfBuffer,
    prj: '',
    cpg: 'UTF-8'
  }
}

/**
 * Generate Polygon Shapefile (for parcels)
 */
function generatePolygonShapefile(
  parcels: ShapefileParcel[],
  name: string
): ShapefileBuffers {
  // Calculate sizes
  let totalPoints = 0
  parcels.forEach(p => totalPoints += p.coordinates.length + 1) // +1 for closing point
  
  const header = createShapefileHeader(5, parcels.length) // 5 = Polygon type
  
  // Simplified: approximate record size
  const recordSize = 100 + totalPoints * 16
  const shpBuffer = new ArrayBuffer(100 + parcels.length * recordSize)
  const shpView = new DataView(shpBuffer)
  
  writeShapefileHeader(shpView, header, 5, parcels.length)
  
  let offset = 100
  parcels.forEach((parcel, i) => {
    const coords = parcel.coordinates
    const numPoints = coords.length + 1 // Close the polygon
    const contentLength = 48 + 8 + (numPoints * 16) // Approximate
    
    const recordHeader = new DataView(shpBuffer, offset, 8)
    recordHeader.setInt32(0, i + 1, false)
    recordHeader.setInt32(4, (contentLength / 2), false)
    
    offset += 8 + contentLength
  })
  
  const shxBuffer = createShapeIndex(header, parcels.length, recordSize)
  const dbfBuffer = createPolygonDBF(parcels)
  
  return {
    shp: shpBuffer,
    shx: shxBuffer,
    dbf: dbfBuffer,
    prj: '',
    cpg: 'UTF-8'
  }
}

/**
 * Create Shapefile Header
 */
function createShapefileHeader(type: number, numRecords: number) {
  return {
    fileCode: 9994,
    fileLength: 100 + numRecords * 100, // Approximate
    version: 1000,
    shapeType: type,
    xMin: 0, xMax: 0, yMin: 0, yMax: 0
  }
}

/**
 * Write Shapefile Header to buffer
 */
function writeShapefileHeader(
  view: DataView,
  header: any,
  shapeType: number,
  numRecords: number
) {
  view.setInt32(0, 9994, false) // File code
  view.setInt32(24, 100 + numRecords * 100, false) // File length
  view.setInt32(28, 1000, true) // Version
  view.setInt32(32, shapeType, true) // Shape type
  
  // Bounding box (8 doubles)
  view.setFloat64(36, header.xMin || -180, true)
  view.setFloat64(44, header.yMin || -90, true)
  view.setFloat64(52, header.xMax || 180, true)
  view.setFloat64(60, header.yMax || 90, true)
  view.setFloat64(68, 0, true) // Z min
  view.setFloat64(76, 0, true) // Z max
  view.setFloat64(84, 0, true) // M min
  view.setFloat64(92, 0, true) // M max
}

/**
 * Create Shape Index (SHX) file
 */
function createShapeIndex(
  header: any,
  numRecords: number,
  recordSize: number
): ArrayBuffer {
  const buffer = new ArrayBuffer(100 + numRecords * 8)
  const view = new DataView(buffer)
  
  // Header
  view.setInt32(0, 9994, false)
  view.setInt32(24, 100 + numRecords * 8, false)
  view.setInt32(28, 1000, true)
  view.setInt32(32, header.shapeType, true)
  
  // Index records
  let offset = 100
  for (let i = 0; i < numRecords; i++) {
    const recordOffset = 100 + i * recordSize
    view.setInt32(100 + i * 8, recordOffset / 2, false) // Offset in 16-bit words
    view.setInt32(104 + i * 8, recordSize / 2, false) // Content length
  }
  
  return buffer
}

/**
 * Create DBF file for points
 */
function createPointDBF(points: ShapefileBeacon[]): ArrayBuffer {
  const headerSize = 32
  const recordSize = 1 + 50 + 20 + 20 + 20 + 50 // Delete flag + fields
  const buffer = new ArrayBuffer(headerSize + points.length * recordSize + 1)
  const view = new DataView(buffer)
  
  // DBF header (simplified)
  view.setUint8(0, 0x03) // Version
  view.setUint8(1, 26) // Year
  view.setUint8(2, 4) // Month
  view.setUint8(3, 22) // Day
  view.setUint32(4, points.length, true) // Number of records
  view.setUint16(8, headerSize, true) // Header size
  view.setUint16(10, recordSize, true) // Record size
  
  // Write records
  let offset = headerSize
  points.forEach(pt => {
    view.setUint8(offset, 0x20) // Not deleted
    offset++
    
    // Write fields (simplified - just convert to ASCII)
    const station = (pt.station || '').padEnd(50, ' ')
    for (let i = 0; i < 50 && i < station.length; i++) {
      view.setUint8(offset + i, station.charCodeAt(i))
    }
    offset += 50
    
    const beaconClass = (pt.beacon_class || '').padEnd(20, ' ')
    for (let i = 0; i < 20 && i < beaconClass.length; i++) {
      view.setUint8(offset + i, beaconClass.charCodeAt(i))
    }
    offset += 20
  })
  
  // End of file marker
  view.setUint8(offset, 0x1A)
  
  return buffer
}

/**
 * Create DBF file for polylines
 */
function createPolylineDBF(lines: ShapefileBoundary[]): ArrayBuffer {
  const headerSize = 32
  const recordSize = 1 + 50 + 50 + 20 + 20 // Delete flag + fields
  const buffer = new ArrayBuffer(headerSize + lines.length * recordSize + 1)
  // Simplified implementation
  return buffer
}

/**
 * Create DBF file for polygons
 */
function createPolygonDBF(parcels: ShapefileParcel[]): ArrayBuffer {
  const headerSize = 32
  const recordSize = 1 + 50 + 20 + 20 + 20 // Delete flag + fields
  const buffer = new ArrayBuffer(headerSize + parcels.length * recordSize + 1)
  // Simplified implementation
  return buffer
}

/**
 * Generate WKT projection file
 */
function generatePRJ(projection: { zone: number; hemisphere: 'N' | 'S'; datum: string; ellipsoid: string }): string {
  const hemi = projection.hemisphere === 'N' ? 'Northern' : 'Southern'
  const falseNorthing = projection.hemisphere === 'S' ? 10000000 : 0
  const centralMeridian = -183 + projection.zone * 6
  const datumUpper = (projection.datum || 'WGS84').toUpperCase()

  // Arc 1960 / Clarke 1880 (RGS) — standard for Kenya cadastral work (EPSG:21037)
  if (datumUpper === 'ARC1960' || datumUpper === 'ARC 1960') {
    return 'PROJCS["Arc 1960 / UTM Zone ' + projection.zone + projection.hemisphere + '",' +
      'GEOGCS["Arc 1960",' +
      'DATUM["Arc_1960",' +
      'SPHEROID["Clarke 1880 (RGS)",6378249.145,293.466307656]],' +
      'PRIMEM["Greenwich",0],' +
      'UNIT["degree",0.0174532925199433]],' +
      'PROJECTION["Transverse_Mercator"],' +
      'PARAMETER["latitude_of_origin",0],' +
      'PARAMETER["central_meridian",' + centralMeridian + '],' +
      'PARAMETER["scale_factor",0.9996],' +
      'PARAMETER["false_easting",500000],' +
      'PARAMETER["false_northing",' + falseNorthing + '],' +
      'UNIT["metre",1]]'
  }

  // Default: WGS 84
  return 'PROJCS["WGS 84 / UTM zone ' + projection.zone + projection.hemisphere + '",' +
    'GEOGCS["WGS 84",' +
    'DATUM["WGS_1984",' +
    'SPHEROID["WGS 84",6378137,298.257223563]],' +
    'PRIMEM["Greenwich",0],' +
    'UNIT["degree",0.0174532925199433]],' +
    'PROJECTION["Transverse_Mercator"],' +
    'PARAMETER["latitude_of_origin",0],' +
    'PARAMETER["central_meridian",' + centralMeridian + '],' +
    'PARAMETER["scale_factor",0.9996],' +
    'PARAMETER["false_easting",500000],' +
    'PARAMETER["false_northing",' + falseNorthing + '],' +
    'UNIT["metre",1]]'
}

export default generateShapefileZip
