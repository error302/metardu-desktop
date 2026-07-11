/**
 * @module sokStandards
 *
 * Survey of Kenya (SoK) Standards Compliance Module
 *
 * Implements the exact rendering standards required by the Director of Surveys:
 *
 * 1. LINE WEIGHTS (per SoK Drafting Manual, 2020 edition)
 *    - National/framework boundaries: 0.6mm
 *    - Scheme/parcel boundaries: 0.5mm
 *    - Plot/subdivision boundaries: 0.3mm
 *    - Dimension/leader lines: 0.15mm
 *    - Grid lines (major): 0.2mm
 *    - Grid lines (minor): 0.1mm
 *    - Contour index: 0.4mm
 *    - Contour intermediate: 0.12mm
 *    - Building outlines: 0.25mm
 *    - Road edges: 0.4mm
 *    - Water features: 0.3mm
 *    - Title block border: 0.7mm (double line)
 *
 * 2. TEXT SIZES (per SoK Cartographic Standards)
 *    - Title block heading: 6mm (uppercase, bold)
 *    - Subtitle: 4mm (uppercase)
 *    - Parcel numbers: 3mm (uppercase)
 *    - Coordinates: 2.5mm (monospace)
 *    - Bearings: 2mm (monospace)
 *    - Distances: 2mm (monospace)
 *    - Area labels: 2.5mm
 *    - Grid labels: 2mm
 *    - Legend: 2.5mm
 *    - North arrow: 4mm (uppercase "N")
 *    - Scale bar labels: 2mm
 *
 * 3. TYPOGRAPHY
 *    - All bearings/distances in UPRIGHT OPEN STYLE (vertical text)
 *    - Parcel numbers in CAPITAL LETTERS
 *    - Coordinates in MONOSPACE font
 *    - No italic or decorative fonts on legal documents
 *
 * 4. HATCH PATTERNS (for area delineation)
 *    - Road reserve: diagonal hatching 45° at 2mm spacing
 *    - Water bodies: horizontal dashed lines at 1.5mm spacing
 *    - Built-up areas: cross-hatching at 3mm spacing
 *    - Reserved land: dotted pattern at 2mm spacing
 *
 * 5. COORDINATE PRECISION
 *    - Easting/Northing: 3 decimal places (mm precision)
 *    - Bearings: DDD°MM'SS.SS" format (centisec precision)
 *    - Distances: 3 decimal places (mm precision)
 *    - Areas: 4 decimal places for hectares, 2 for m²
 *    - Elevations: 3 decimal places
 */

// ---------------------------------------------------------------------------
// Enhanced Line Weights (SoK 2020)
// ---------------------------------------------------------------------------

export const SOK_LINE_WEIGHTS = {
  // Boundaries
  nationalBoundary: 0.6,
  schemeBoundary: 0.5,
  parcelBoundary: 0.3,
  subdivisionBoundary: 0.25,

  // Dimension lines
  dimensionLine: 0.15,
  leaderLine: 0.12,

  // Grid
  gridMajor: 0.2,
  gridMinor: 0.1,

  // Contours
  contourIndex: 0.4,
  contourIntermediate: 0.12,

  // Features
  buildingOutline: 0.25,
  roadEdge: 0.4,
  roadCenterline: 0.15,
  waterLine: 0.3,
  vegetationLine: 0.2,

  // Administrative
  titleBorder: 0.7,
  titleBorderInner: 0.2,
  tableBorder: 0.3,
  tableInner: 0.1,
} as const

// ---------------------------------------------------------------------------
// Enhanced Text Sizes (SoK Cartographic)
// ---------------------------------------------------------------------------

export const SOK_TEXT_SIZES = {
  titleHeading: 6,       // Title block main heading
  subTitle: 4,           // Subtitles
  parcelNumber: 3,       // Parcel identifiers
  coordinate: 2.5,       // Easting/Northing values
  bearing: 2,            // Bearing annotations
  distance: 2,           // Distance annotations
  areaLabel: 2.5,        // Area labels
  gridLabel: 2,          // Grid coordinate labels
  legend: 2.5,           // Legend entries
  northArrow: 4,         // "N" label
  scaleBar: 2,           // Scale bar labels
  beaconLabel: 2,        // Beacon identifiers
  signature: 2.5,        // Signature block labels
  footnote: 1.5,         // Footnotes
  stamp: 3,              // Official stamps
} as const

// ---------------------------------------------------------------------------
// Typography Rules
// ---------------------------------------------------------------------------

export const SOK_TYPOGRAPHY = {
  // All bearings must be upright (not rotated with the line)
  bearingStyle: {
    font: 'Courier',
    size: SOK_TEXT_SIZES.bearing,
    uppercase: true,
    rotation: 0, // Always upright
  },
  // Parcel numbers must be uppercase
  parcelNumberStyle: {
    font: 'Helvetica-Bold',
    size: SOK_TEXT_SIZES.parcelNumber,
    uppercase: true,
  },
  // Coordinates must be monospace
  coordinateStyle: {
    font: 'Courier',
    size: SOK_TEXT_SIZES.coordinate,
    uppercase: false,
  },
  // Title must be uppercase bold
  titleStyle: {
    font: 'Helvetica-Bold',
    size: SOK_TEXT_SIZES.titleHeading,
    uppercase: true,
  },
} as const

// ---------------------------------------------------------------------------
// Coordinate Precision Formatting
// ---------------------------------------------------------------------------

/**
 * Format an easting/northing coordinate to SoK standard precision.
 * 3 decimal places = millimeter precision.
 */
export function formatCoordinate(value: number): string {
  return value.toFixed(3)
}

/**
 * Format a bearing in DDD°MM'SS.SS" format.
 * Centisecond precision per SoK standard.
 */
export function formatBearingDMS(decimalDegrees: number): string {
  // Normalize to 0-360
  let bearing = decimalDegrees % 360
  if (bearing < 0) bearing += 360

  const degrees = Math.floor(bearing)
  const minutesFull = (bearing - degrees) * 60
  const minutes = Math.floor(minutesFull)
  const seconds = (minutesFull - minutes) * 60

  return `${degrees}°${minutes}'${seconds.toFixed(2)}"`
}

/**
 * Format a bearing with quadrant prefix (e.g., "N 45°30'15.25" E").
 * Used on deed plans per SoK standard.
 */
export function formatBearingQuadrant(decimalDegrees: number): string {
  let bearing = decimalDegrees % 360
  if (bearing < 0) bearing += 360

  let quadrant: string
  let quadBearing: number

  if (bearing >= 0 && bearing < 90) {
    quadrant = 'N'
    quadBearing = bearing
    return `N ${formatBearingDMS(quadBearing)} E`
  } else if (bearing >= 90 && bearing < 180) {
    quadrant = 'S'
    quadBearing = 180 - bearing
    return `S ${formatBearingDMS(quadBearing)} E`
  } else if (bearing >= 180 && bearing < 270) {
    quadrant = 'S'
    quadBearing = bearing - 180
    return `S ${formatBearingDMS(quadBearing)} W`
  } else {
    quadrant = 'N'
    quadBearing = 360 - bearing
    return `N ${formatBearingDMS(quadBearing)} W`
  }
}

/**
 * Format a distance in meters to SoK precision (3 decimal places).
 */
export function formatDistance(meters: number): string {
  return meters.toFixed(3) + 'm'
}

/**
 * Format an area in hectares to SoK precision (4 decimal places).
 */
export function formatAreaHectares(sqMeters: number): string {
  return (sqMeters / 10000).toFixed(4) + ' ha'
}

/**
 * Format an area in square meters.
 */
export function formatAreaSqM(sqMeters: number): string {
  return sqMeters.toFixed(2) + ' m²'
}

/**
 * Format an elevation to SoK precision (3 decimal places).
 */
export function formatElevation(meters: number): string {
  return meters.toFixed(3) + 'm'
}

// ---------------------------------------------------------------------------
// Hatch Pattern Generators
// ---------------------------------------------------------------------------

export type HatchPattern = 'road_reserve' | 'water' | 'built_up' | 'reserved' | 'none'

export interface HatchConfig {
  pattern: HatchPattern
  angle: number      // degrees
  spacing: number    // mm
  lineWidth: number  // mm
  color: string
}

export const HATCH_CONFIGS: Record<HatchPattern, HatchConfig> = {
  road_reserve: {
    pattern: 'road_reserve',
    angle: 45,
    spacing: 2,
    lineWidth: 0.15,
    color: '#000000',
  },
  water: {
    pattern: 'water',
    angle: 0, // horizontal
    spacing: 1.5,
    lineWidth: 0.1,
    color: '#0066CC',
  },
  built_up: {
    pattern: 'built_up',
    angle: 45,
    spacing: 3,
    lineWidth: 0.2,
    color: '#000000',
  },
  reserved: {
    pattern: 'reserved',
    angle: 90,
    spacing: 2,
    lineWidth: 0.1,
    color: '#666666',
  },
  none: {
    pattern: 'none',
    angle: 0,
    spacing: 0,
    lineWidth: 0,
    color: '#000000',
  },
}

// ---------------------------------------------------------------------------
// Scale Standards
// ---------------------------------------------------------------------------

export const SOK_SCALES = {
  500: { label: '1:500', useCase: 'Building plans, site plans' },
  1000: { label: '1:1,000', useCase: 'Cadastral plans, urban subdivisions' },
  2500: { label: '1:2,500', useCase: 'Mutation plans, rural subdivisions' },
  5000: { label: '1:5,000', useCase: 'Topographic plans, scheme plans' },
  10000: { label: '1:10,000', useCase: 'Regional plans, index maps' },
  25000: { label: '1:25,000', useCase: 'Topographic surveys, regional' },
} as const

/**
 * Auto-select the best standard scale for a given bounding box.
 */
export function autoSelectScale(
  bboxWidthM: number,
  bboxHeightM: number,
  availableWidthMm: number,
  availableHeightMm: number,
): number {
  const scales = [500, 1000, 2500, 5000, 10000, 25000]
  for (const scale of scales) {
    const drawingWidthMm = (bboxWidthM / scale) * 1000
    const drawingHeightMm = (bboxHeightM / scale) * 1000
    if (drawingWidthMm <= availableWidthMm && drawingHeightMm <= availableHeightMm) {
      return scale
    }
  }
  return 25000
}

// ---------------------------------------------------------------------------
// Title Block Standards (SoK Standard Layout)
// ---------------------------------------------------------------------------

export interface SOKTitleBlock {
  // Required fields per SoK
  planNumber: string
  lrNumber: string
  county: string
  subCounty: string
  locality: string
  sheetNumber: string
  area: string        // formatted with ha
  scale: string       // "1:2,500"
  surveyorName: string
  surveyorLicense: string
  surveyDate: string
  planType: 'DEED_PLAN' | 'MUTATION' | 'SECTIONAL' | 'TOPOGRAPHIC' | 'ENGINEERING'
  // Optional
  firmName?: string
  registryMapSheet?: string
  approvedBy?: string  // Director of Surveys
  approvalDate?: string
  revisionNumber?: number
}

/**
 * Standard SoK title block dimensions (mm).
 * Placed in the bottom-right corner of the plan.
 */
export const TITLE_BLOCK_DIMENSIONS = {
  width: 180,    // standard width
  height: 80,    // standard height
  margin: 5,     // internal margin
  rowHeight: 5,  // height of each row
} as const

// ---------------------------------------------------------------------------
// Precision Validation
// ---------------------------------------------------------------------------

export interface PrecisionCheck {
  field: string
  value: string
  isValid: boolean
  expectedFormat: string
}

/**
 * Validate that coordinates meet SoK precision requirements.
 */
export function validateCoordinatePrecision(easting: number, northing: number): PrecisionCheck[] {
  const checks: PrecisionCheck[] = []

  // Easting should be 6-7 digits + 3 decimals for UTM 37S
  const eStr = easting.toFixed(3)
  checks.push({
    field: 'Easting',
    value: eStr,
    isValid: /^\d{6,7}\.\d{3}$/.test(eStr),
    expectedFormat: 'XXXXXX.XXX (6-7 digits, 3 decimals)',
  })

  // Northing should be 7 digits + 3 decimals for UTM 37S (equatorial)
  const nStr = northing.toFixed(3)
  checks.push({
    field: 'Northing',
    value: nStr,
    isValid: /^\d{7}\.\d{3}$/.test(nStr),
    expectedFormat: 'XXXXXXX.XXX (7 digits, 3 decimals)',
  })

  return checks
}
