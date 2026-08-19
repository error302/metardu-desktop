/**
 * GDAL contour generation from GeoTIFF DSM files.
 * Sends rasters to the Rust sidecar's gdal_contour; throws when GDAL
 * is unavailable (use the TS marching-squares generator instead).
 */

export interface GdalContourParams {
  dsmPath: string;
  interval: number;
  format?: "geojson" | "shapefile";
  minElevation?: number;
  maxElevation?: number;
}

export interface GdalContourResult {
  contours: Array<{ elevation: number; coordinates: [number, number][][] }>;
  metadata: {
    width: number;
    height: number;
    cellSize: number;
    minElevation: number;
    maxElevation: number;
    srid?: number;
  };
  count: number;
  warnings: string[];
}

export interface GdalRasterInfo {
  width: number;
  height: number;
  cellSize: number;
  minElevation: number;
  maxElevation: number;
  bands: number;
  srid?: number;
  noData?: number;
}

type SidecarBridge = { call?: (method: string, params: unknown) => Promise<unknown> };

function getSidecar(): SidecarBridge | null {
  const w = window as unknown as { metardu?: { sidecar?: SidecarBridge } };
  return w.metardu?.sidecar ?? null;
}

const GDAL_UNAVAILABLE =
  "GDAL requires the Rust sidecar. Install GDAL: https://gdal.org/install.html";

export async function generateContoursFromGeoTiff(
  params: GdalContourParams,
): Promise<GdalContourResult> {
  const sidecar = getSidecar();
  if (!sidecar?.call) throw new Error(GDAL_UNAVAILABLE);
  return sidecar.call("gdal.contour", {
    dsm_path: params.dsmPath,
    interval: params.interval,
    format: params.format ?? "geojson",
    min_elevation: params.minElevation,
    max_elevation: params.maxElevation,
  }) as Promise<GdalContourResult>;
}

export async function getGeoTiffInfo(path: string): Promise<GdalRasterInfo> {
  const sidecar = getSidecar();
  if (!sidecar?.call) throw new Error(GDAL_UNAVAILABLE);
  return sidecar.call("gdal.info", { path }) as Promise<GdalRasterInfo>;
}

export async function isGdalAvailable(): Promise<boolean> {
  try {
    const sidecar = getSidecar();
    if (!sidecar?.call) return false;
    await sidecar.call("gdal.ping", {});
    return true;
  } catch {
    return false;
  }
}
