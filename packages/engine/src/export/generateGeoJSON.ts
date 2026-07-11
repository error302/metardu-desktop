import { utmToGeographic } from '@/lib/geodesy/coordinates'
import type { SurveyPoint } from '@/types/surveyPoint'
import { generateProjectMetadata } from '@/lib/geo/isoMetadata'

// Re-export for backwards compatibility with callers that import
// `{ SurveyPoint }` from this module. New code should import the type
// directly from '@/types/surveyPoint'.
export type { SurveyPoint }

/**
 * Generate a GeoJSON FeatureCollection.
 * Coordinates are converted to WGS84 lat/lon as required by the GeoJSON spec (RFC 7946).
 * UTM coordinates are retained as properties for reference.
 *
 * T1.5g FIX (2026-07-10): Now includes ISO 19115/19139 metadata as a
 * 'metadata' field in the FeatureCollection, so the export is self-documenting
 * and acceptable by spatial data catalogs.
 */
export function generateGeoJSON(
  points: SurveyPoint[],
  projectName: string,
  utmZone: number = 37,
  hemisphere: 'N' | 'S' = 'S'
): string {
  const features = points.map((p: any) => {
    const { lat, lon } = utmToGeographic(p.easting, p.northing, utmZone, hemisphere)
    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        // GeoJSON uses [longitude, latitude, elevation]
        coordinates: [
          parseFloat(lon.toFixed(8)),
          parseFloat(lat.toFixed(8)),
          p.elevation ?? 0,
        ],
      },
      properties: {
        name: p.name,
        elevation_m: p.elevation ?? 0,
        easting_utm: p.easting,
        northing_utm: p.northing,
        utm_zone: `${utmZone}${hemisphere}`,
        is_control: p.is_control || false,
        point_type: p.is_control ? 'control' : 'survey',
      },
    }
  })

  // T1.5g: Generate ISO 19115/19139 metadata for the export
  let metadata: string | undefined
  try {
    metadata = generateProjectMetadata({
      id: projectName,
      name: projectName,
      survey_type: 'cadastral',
      utm_zone: utmZone,
      hemisphere,
      datum: 'Arc 1960',
      user_name: 'METARDU User',
      user_email: 'surveyor@metardu.com',
    })
  } catch {
    // Metadata generation is non-blocking
  }

  const geojson: Record<string, unknown> = {
    type: 'FeatureCollection',
    name: projectName,
    // WGS84 is the default/required CRS for GeoJSON per RFC 7946
    features,
  }

  // Attach ISO 19139 metadata if generated
  if (metadata) {
    geojson.metadata = metadata
  }

  return JSON.stringify(geojson, null, 2)
}

export function downloadGeoJSON(
  points: SurveyPoint[],
  projectName: string,
  utmZone?: number,
  hemisphere?: 'N' | 'S'
): void {
  const content = generateGeoJSON(points, projectName, utmZone ?? 37, hemisphere ?? 'S')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([content], { type: 'application/geo+json' }))
  a.download = `${projectName.replace(/\s+/g, '_')}_WGS84.geojson`
  a.click()
}
