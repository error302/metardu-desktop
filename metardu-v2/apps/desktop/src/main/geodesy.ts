import {
  getCountryConfig,
  getWgs84UtmProjectionZone,
  type CountryCode,
} from "@metardu/country-config";

export interface GeodesySidecar {
  isRunning(): boolean;
  call<T = unknown>(method: string, params: unknown): Promise<T>;
}

export type ProjectToWgs84 = (
  easting: number,
  northing: number,
  sourceSrid: number,
) => Promise<{ lat: number; lon: number }>;

/**
 * Build a projected-to-WGS84 callback only when the current sidecar
 * operation is valid for the configured source datum. The available inverse
 * projection handlers do not perform cross-datum transformations, so this
 * intentionally refuses legacy and regional datums.
 */
export function makeProjectToWgs84(
  countryCode: string | undefined,
  sidecar: GeodesySidecar | null,
  sourceSridOverride?: number,
): ProjectToWgs84 | null {
  if (!sidecar || !sidecar.isRunning()) return null;

  let config: ReturnType<typeof getCountryConfig> | undefined;
  if (countryCode?.trim()) {
    try {
      config = getCountryConfig(countryCode.trim().toUpperCase() as CountryCode);
    } catch {
      // A project may have a CRS without a configured legal jurisdiction.
      // The explicit EPSG CRS below remains the authority for this operation.
    }
  }

  const resolvedSrid = sourceSridOverride ?? config?.geodeticFramework.primarySRID;
  if (typeof resolvedSrid !== "number" || !Number.isSafeInteger(resolvedSrid) || resolvedSrid <= 0) return null;

  const configuredZone = config?.geodeticFramework.projectionZones.find(
    (candidate) => candidate.srid === resolvedSrid,
  );
  let zone = configuredZone;
  if (configuredZone) {
    // The country profile's projection parameters can only be used as a
    // WGS84 operation when its source datum is WGS84. Projection inverse
    // alone is not a regional datum transformation.
    if (!/^WGS\s*84$/i.test(config!.geodeticFramework.datum.trim())) return null;
  } else {
    zone = getWgs84UtmProjectionZone(resolvedSrid) ?? undefined;
  }
  if (!zone) return null;

  const runningSidecar = sidecar;

  return async (easting, northing, requestedSrid) => {
    if (requestedSrid !== undefined && requestedSrid !== resolvedSrid) {
      throw new Error(`Requested CRS EPSG:${requestedSrid} does not match project CRS EPSG:${resolvedSrid}.`);
    }
    if (!Number.isFinite(easting) || !Number.isFinite(northing)) {
      throw new Error("Projected coordinates must be finite numbers.");
    }

    const validateGeographicResult = async (result: Promise<{ lat: number; lon: number }>) => {
      const point = await result;
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon) || Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180) {
        throw new Error(`The Rust geodesy service returned invalid geographic coordinates for EPSG:${resolvedSrid}.`);
      }
      return point;
    };

    if (zone.method === "Lambert Conformal Conic") {
      if (zone.standard_parallel_1_deg === undefined || zone.standard_parallel_2_deg === undefined) {
        throw new Error(`LCC CRS EPSG:${resolvedSrid} is missing its standard parallels.`);
      }
      return validateGeographicResult(runningSidecar.call("geodesy.lcc_inverse", {
        easting,
        northing,
        standard_parallel_1_deg: zone.standard_parallel_1_deg,
        standard_parallel_2_deg: zone.standard_parallel_2_deg,
        latitude_of_origin_deg: zone.latitude_of_origin_deg,
        central_meridian_deg: zone.central_meridian_deg,
        false_easting_m: zone.false_easting_m,
        false_northing_m: zone.false_northing_m,
        ellipsoid: zone.ellipsoid,
      }));
    }

    if (zone.method === "Transverse Mercator") {
      const zoneMatch = zone.name.match(/UTM zone (\d+)([NS])/i);
      if (zoneMatch) {
        const utmZone = Number.parseInt(zoneMatch[1]!, 10);
        const isSouthern = zoneMatch[2]!.toUpperCase() === "S";
        return validateGeographicResult(runningSidecar.call("geodesy.utm_inverse", {
          easting,
          northing,
          zone: utmZone,
          is_southern: isSouthern,
          ellipsoid: zone.ellipsoid,
        }));
      }

      return validateGeographicResult(runningSidecar.call("geodesy.tm_inverse", {
        easting,
        northing,
        central_meridian_deg: zone.central_meridian_deg,
        latitude_of_origin_deg: zone.latitude_of_origin_deg,
        false_easting_m: zone.false_easting_m,
        false_northing_m: zone.false_northing_m,
        scale_factor: zone.scale_factor,
        ellipsoid: zone.ellipsoid,
      }));
    }

    throw new Error(`Projection method '${zone.method}' for EPSG:${resolvedSrid} is not supported for WGS84 output.`);
  };
}
