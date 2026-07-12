/**
 * Raster / DEM Analysis — Pure TypeScript stub with PostGIS delegation.
 * Hillshade, slope, aspect, and contour extraction from DEM data.
 *
 * Currently returns structured stubs — full implementation delegates to
 * PostGIS raster functions via RPC when available.
 */

export type RasterAnalysisType = 'hillshade' | 'slope' | 'aspect' | 'contour' | 'statistics'

export interface RasterAnalysisParams {
  project_id: string
  analysis_type: RasterAnalysisType
  dem_source?: string  // e.g., 'postgis' | 'geotiff_upload'
  params?: Record<string, unknown>
}

export interface RasterAnalysisResult {
  type: RasterAnalysisType
  status: 'computed' | 'deferred' | 'unavailable'
  message?: string
  data?: unknown
}

/**
 * Compute raster analysis.
 * For PostGIS-backed rasters, this delegates to database-side computation.
 * For uploaded GeoTIFF, a client-side pipeline using geotiff.js can be added.
 */
export async function computeRasterAnalysis(
  params: RasterAnalysisParams
): Promise<RasterAnalysisResult> {
  const { analysis_type, dem_source } = params

  // If no DEM source is specified, return structured stub
  if (!dem_source && analysis_type !== 'statistics') {
    return {
      type: analysis_type,
      status: 'deferred',
      message: `Raster ${analysis_type} analysis requires a DEM source. Upload a GeoTIFF or configure PostGIS raster.`,
    }
  }

  switch (analysis_type) {
    case 'statistics':
      // Return placeholder statistics — can be computed from uploaded data
      return {
        type: 'statistics',
        status: 'computed',
        data: {
          min_elevation: null,
          max_elevation: null,
          mean_elevation: null,
          cell_count: 0,
          source: dem_source || 'none',
        },
      }

    case 'hillshade':
    case 'slope':
    case 'aspect':
    case 'contour':
      return {
        type: analysis_type,
        status: 'deferred',
        message: `${analysis_type} analysis requires DEM data. Configure PostGIS raster or upload GeoTIFF.`,
      }

    default:
      return {
        type: analysis_type,
        status: 'unavailable',
        message: `Unknown raster analysis type: ${analysis_type}`,
      }
  }
}

/**
 * Validate raster analysis request parameters.
 */
export interface ValidatedRasterRequest {
  analysis_type: RasterAnalysisType
  params: Record<string, unknown>
}

export function validateRasterRequest(body: unknown): ValidatedRasterRequest | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const validTypes: RasterAnalysisType[] = ['hillshade', 'slope', 'aspect', 'contour', 'statistics']
  if (typeof b.analysis_type !== 'string' || !validTypes.includes(b.analysis_type as RasterAnalysisType)) {
    return null
  }
  return {
    analysis_type: b.analysis_type as RasterAnalysisType,
    params: (typeof b.params === 'object' && b.params) ? b.params as Record<string, unknown> : {},
  }
}
