/**
 * @module geodesicArea
 *
 * Geodesic Area & Distance Computation using ol/sphere
 *
 * Computes TRUE ellipsoidal surface area accounting for Earth's curvature.
 * This is critical for cadastral compliance — planar (Shoelace) area
 * calculations in Web Mercator (EPSG:3857) produce massive errors
 * that fail registry audits.
 *
 * Uses OpenLayers' ol/sphere module which implements:
 * - Karney's algorithm for geodesic polygon area (2013)
 * - Vincenty's formula for geodesic distance (1975)
 *
 * Reference: "Geodesics on an ellipsoid" by Charles Karney (2013)
 *            Survey Act Cap 299 — area must be in hectares to 4 decimal places
 */

import { getArea, getLength } from 'ol/sphere'
import type { Geometry, Polygon, LineString } from 'ol/geom'
import type { ProjectionLike } from 'ol/proj'

export interface GeodesicMetrics {
  /** True surface area in square meters */
  areaSqM: number
  /** Area in hectares (4 decimal places) */
  areaHectares: number
  /** Area in acres (for reference) */
  areaAcres: number
  /** True geodesic perimeter in meters */
  perimeterM: number
  /** Number of vertices */
  vertexCount: number
  /** Whether the computation used geodesic (true) or planar (false) method */
  isGeodesic: boolean
  /** Estimated error in m² (based on coordinate precision) */
  estimatedErrorSqM: number
}

/**
 * Compute geodesic area and perimeter of a polygon.
 *
 * This uses ol/sphere.getArea() which computes the true ellipsoidal
 * surface area, correcting for projection distortion.
 *
 * @param geometry - OpenLayers Polygon geometry
 * @param projection - Map projection (default: EPSG:3857 Web Mercator)
 * @returns Geodesic metrics with area in m², ha, and acres
 */
export function calculateGeodesicArea(
  geometry: Polygon,
  projection: ProjectionLike = 'EPSG:3857',
): GeodesicMetrics {
  // ol/sphere.getArea automatically handles projection transformation
  const areaSqM = getArea(geometry, { projection })

  // Geodesic perimeter
  const perimeterM = getLength(geometry, { projection })

  // Vertex count
  const coords = geometry.getCoordinates()
  const ring = coords[0] || []
  const vertexCount = ring.length > 0 ? ring.length - 1 : 0 // exclude closing point

  // Error estimate: for geodesic computation, error is minimal
  // Based on coordinate precision (typically 1mm = 0.001m)
  const estimatedErrorSqM = (0.001 * perimeterM) / 2

  return {
    areaSqM,
    areaHectares: parseFloat((areaSqM / 10000).toFixed(4)),
    areaAcres: parseFloat((areaSqM / 4046.86).toFixed(4)),
    perimeterM,
    vertexCount,
    isGeodesic: true,
    estimatedErrorSqM,
  }
}

/**
 * Compute geodesic length of a LineString.
 *
 * @param geometry - OpenLayers LineString geometry
 * @param projection - Map projection
 */
export function calculateGeodesicLength(
  geometry: LineString,
  projection: ProjectionLike = 'EPSG:3857',
): { lengthM: number; vertexCount: number } {
  const lengthM = getLength(geometry, { projection })
  const coords = geometry.getCoordinates()
  return {
    lengthM,
    vertexCount: coords.length,
  }
}

/**
 * Compare planar (Shoelace) vs geodesic area to show the distortion error.
 *
 * This is useful for QA/QC — if the difference is > 0.001 ha,
 * the planar calculation would fail registry audit.
 *
 * @param geometry - OpenLayers Polygon geometry
 * @param projection - Map projection
 */
export function compareAreaMethods(
  geometry: Polygon,
  projection: ProjectionLike = 'EPSG:3857',
): {
  geodesic: GeodesicMetrics
  planar: { areaSqM: number; areaHectares: number }
  differenceSqM: number
  differenceHa: number
  distortionPercent: number
  registryCompliant: boolean
} {
  const geodesic = calculateGeodesicArea(geometry, projection)

  // Planar area (Shoelace in projected coordinates)
  const planarAreaSqM = geometry.getArea()

  const differenceSqM = Math.abs(geodesic.areaSqM - planarAreaSqM)
  const differenceHa = differenceSqM / 10000
  const distortionPercent = geodesic.areaSqM > 0
    ? (differenceSqM / geodesic.areaSqM) * 100
    : 0

  return {
    geodesic,
    planar: {
      areaSqM: planarAreaSqM,
      areaHectares: parseFloat((planarAreaSqM / 10000).toFixed(4)),
    },
    differenceSqM,
    differenceHa: parseFloat(differenceHa.toFixed(6)),
    distortionPercent: parseFloat(distortionPercent.toFixed(4)),
    registryCompliant: differenceHa <= 0.001, // tolerance: 10 m²
  }
}

/**
 * Format area for Kenya statutory documents.
 *
 * Per Survey Act Cap 299:
 * - Areas < 1 ha: show in m² with 2 decimal places
 * - Areas ≥ 1 ha: show in hectares with 4 decimal places
 * - Always show both for reference
 */
export function formatAreaForStatutory(areaSqM: number): {
  primary: string
  secondary: string
  full: string
} {
  const ha = areaSqM / 10000

  if (ha < 1) {
    return {
      primary: `${areaSqM.toFixed(2)} m²`,
      secondary: `${ha.toFixed(4)} ha`,
      full: `${areaSqM.toFixed(2)} m² (${ha.toFixed(4)} ha)`,
    }
  }

  return {
    primary: `${ha.toFixed(4)} ha`,
    secondary: `${areaSqM.toFixed(2)} m²`,
    full: `${ha.toFixed(4)} ha (${areaSqM.toFixed(2)} m²)`,
  }
}
