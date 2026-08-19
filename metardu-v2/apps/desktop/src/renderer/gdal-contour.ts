/**
 * gdal-contour.ts — GDAL contour generation from GeoTIFF DSM files.
 *
 * Sends a GeoTIFF raster to the Rust sidecar which runs `gdal_contour`
 * to extract contour lines at a specified interval. Returns GeoJSON
 * contour polylines that can be rendered on the SurveyCanvas.
 *
 * Falls back to the TS marching-squares implementation when GDAL is
 * not available (sidecar not running).
 */

// ─── Types ───────────────────────────────────────────────────────

export interface GdalContourParams {
  /** Path to the GeoTIFF DSM file. */
  dsmPath: string;
  /** Contour interval in metres. */
  interval: number;
  /** Output format (default: "geojson"). */
  format?: "geojson" | "shapefile";
  /** Minimum elevation (optional, defaults to raster min). */
  minElevation?: number;
  /** Maximum elevation (optional, defaults to raster max). */
  maxElevation?: number;
}

export interface GdalContourResult {
  /** Contour lines as GeoJSON features. */
  contours: Array<{
    elevation: number;
    coordinates: [number, number][][];
  }>;
  /** Raster metadata. */
  metadata: {
    width: number;
    height: number;
    cellSize: number;
    minElevation: number;
    maxElevation: number;
    srid?: number;
  };
  /** Total number of contour lines generated. */
  count: number;
  /** Any warnings from GDAL. */
  warnings: string[];
}

export interface GdalRasterInfo {
  /** Raster width in pixels. */
  width: number;
  /** Raster height in pixels. */
  height: number;
  /** Cell size in map units. */
  cellSize: number;
  /** Minimum elevation value. */
  minElevation: number;
  /** Maximum elevation value. */
  maxElevation: number;
  /** Number of bands. */
  bands: number;
  /** CRS/EPSG code if known. */
  srid?: number;
  /** NoData value. */
  noData?: number;
}

// ─── Sidecar IPC Bridge ──────────────────────────────────────────

function getSidecarApi(): {
  gdalContour?: (params: GdalContourParams) => Promise<GdalContourResult>;
  gdalInfo?: (path: string) => Promise<GdalRasterInfo>;
  generateContours?: (params: { dsmPath: string; interval: number; format: string; outputPath?: string }) => Promise<{
    count: number;
    min_elevation: number;
    max_elevation: number;
    interval: number;
    geojson?: string;
  }>;
} | null {
  const w = window as unknown as {
    metardu?: {
      sidecar?: {
        call?: (method: string, params: unknown) => Promise<unknown>;
      };
      gdal?: {
        contour?: (params: unknown) => Promise<unknown>;
        info?: (path: string) => Promise<unknown>;
      };
    };
  };
  return (w.metardu?.gdal ?? null) as ReturnType<typeof getSidecarApi>;
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Generate contour lines from a GeoTIFF DSM file using GDAL.
 *
 * Tries the sidecar's GDAL bindings first. Falls back to error
 * if GDAL is not available.
 */
export async function generateContoursFromGeoTiff(
  params: GdalContourParams,
): Promise<GdalContourResult> {
  const api = getSidecarApi();

  // Try the dedicated GDAL contour handler.
  if (api?.gdalContour) {
    return api.gdalContour(params);
  }

  // Try the sidecar call interface.
  const sidecar = (window as unknown as {
    metardu?: { sidecar?: { call?: (method: string, params: unknown) => Promise<unknown> } };
  }).metardu?.sidecar;

  if (sidecar?.call) {
    try {
      const result = await sidecar.call("gdal.contour", {
        dsm_path: params.dsmPath,
        interval: params.interval,
        format: params.format ?? "geojson",
        min_elevation: params.minElevation,
        max_elevation: params.maxElevation,
      });
      return result as GdalContourResult;
    } catch {
      // Fall through to error.
    }
  }

  throw new Error(
    "GDAL contour generation requires the Rust sidecar to be running. " +
    "Start the sidecar or use the TS contour generator for point clouds instead. " +
    "Install GDAL: https://gdal.org/install.html"
  );
}

/**
 * Get raster metadata from a GeoTIFF file.
 */
export async function getGeoTiffInfo(path: string): Promise<GdalRasterInfo> {
  const api = getSidecarApi();
  if (api?.gdalInfo) {
    return api.gdalInfo(path);
  }

  const sidecar = (window as unknown as {
    metardu?: { sidecar?: { call?: (method: string, params: unknown) => Promise<unknown> } };
  }).metardu?.sidecar;

  if (sidecar?.call) {
    return sidecar.call("gdal.info", { path }) as Promise<GdalRasterInfo>;
  }

  throw new Error(
    "GDAL raster info requires the Rust sidecar. " +
    "Install GDAL: https://gdal.org/install.html"
  );
}

/**
 * Check if GDAL is available (sidecar running with GDAL support).
 */
export async function isGdalAvailable(): Promise<boolean> {
  try {
    const sidecar = (window as unknown as {
      metardu?: { sidecar?: { call?: (method: string, params: unknown) => Promise<unknown> } };
    }).metardu?.sidecar;
    if (!sidecar?.call) return false;
    await sidecar.call("gdal.ping", {});
    return true;
  } catch {
    return false;
  }
}
