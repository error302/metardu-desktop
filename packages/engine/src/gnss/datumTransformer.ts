/**
 * PROJ-Based Datum Transformer
 * 
 * Replaces the hardcoded datum shift in coordinates.ts with proper proj4 pipelines.
 * Supports WGS84 ↔ Arc 1960 ↔ UTM Zone 37S transformations.
 * 
 * References:
 * - EPSG:21037 — Arc 1960 / UTM Zone 37S
 * - EPSG:4210 — Arc 1960 (Geographic)
 * - EPSG:4326 — WGS84
 * - EPSG:1165 — Arc 1960 → WGS84 transformation (Kenya)
 * - Clarke 1880 (RGS) ellipsoid: a=6378249.145, 1/f=293.465
 * 
 * Kenya Survey Regulations 1994 require Arc 1960 / UTM Zone 37S (SRID 21037)
 * for all cadastral survey computations.
 */

import proj4 from 'proj4';

// ─── PROJ Definitions ───────────────────────────────────────────────────────

/**
 * WGS84 geographic (EPSG:4326)
 */
const WGS84 = 'EPSG:4326';

/**
 * Arc 1960 / UTM Zone 37S (EPSG:21037)
 * Uses Clarke 1880 (RGS) ellipsoid with Transverse Mercator projection.
 * The towgs84 parameters are from EPSG transformation 1165 (Arc 1960 → WGS84, Kenya).
 * Parameters: 7-parameter Bursa-Wolf (EPSG:1314)
 *   dx=-160, dy=-6, dz=-302 (metres)
 *   rx=-0.807, ry=0.339, rz=-1.619 (arc-seconds)
 *   ds=-2.554 (ppm)
 */
const ARC1960_UTM37S = '+proj=utm +zone=37 +south +ellps=clrk80 +towgs84=-160,-6,-302,-0.807,0.339,-1.619,-2.554 +units=m +no_defs +type=crs';

/**
 * Arc 1960 geographic (EPSG:4210)
 * Clarke 1880 (RGS) ellipsoid with datum shift parameters for Kenya.
 */
const ARC1960_GEO = '+proj=longlat +ellps=clrk80 +towgs84=-160,-6,-302,-0.807,0.339,-1.619,-2.554 +no_defs +type=crs';

// Register custom projections with proj4
proj4.defs('EPSG:21037', ARC1960_UTM37S);
proj4.defs('EPSG:4210', ARC1960_GEO);

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface KenyaCoord {
  easting: number;
  northing: number;
  height: number;
}

export interface WGS84Coord {
  latitude: number;
  longitude: number;
  altitude: number;
}

export interface UTMCoord {
  easting: number;
  northing: number;
  zone: number;
  hemisphere: 'N' | 'S';
}

// ─── DatumTransformer ───────────────────────────────────────────────────────

/**
 * Professional-grade datum transformer for Kenya survey coordinates.
 *
 * Supports:
 * - WGS84 (GPS) → Arc 1960 / UTM Zone 37S (cadastral)
 * - Arc 1960 / UTM Zone 37S → WGS84 (inverse)
 * - WGS84 → UTM Zone 37S (projection only, no datum shift)
 * - Batch transforms for arrays of points
 *
 * All transforms use proj4 for rigorous geodetic computation.
 * No intermediate rounding — full float precision throughout.
 *
 * T1.5g FIX (2026-07-10): Now exposes the transformation provenance via
 * the DatumTransformationRegistry. Callers can use transformWithProvenance()
 * to get a full audit trail of which transformation was applied.
 */
export class DatumTransformer {
  /**
   * Convert WGS84 geographic coordinates to UTM Zone 37S.
   * This applies the datum shift from WGS84 to Arc 1960 AND projects to UTM.
   *
   * @param lat - Latitude in decimal degrees (negative for South)
   * @param lon - Longitude in decimal degrees
   * @returns UTM coordinates with zone and hemisphere
   */
  wgs84ToUTM37S(lat: number, lon: number): UTMCoord {
    const [easting, northing] = proj4(WGS84, ARC1960_UTM37S, [lon, lat]);
    return { easting, northing, zone: 37, hemisphere: 'S' };
  }

  /**
   * Convert UTM Zone 37S (Arc 1960) to WGS84 geographic.
   * Inverse of wgs84ToUTM37S.
   * 
   * @param easting - UTM Easting in metres
   * @param northing - UTM Northing in metres (includes false northing for southern hemisphere)
   * @returns WGS84 latitude and longitude
   */
  utm37SToWgs84(easting: number, northing: number): { latitude: number; longitude: number } {
    const [lon, lat] = proj4(ARC1960_UTM37S, WGS84, [easting, northing]);
    return { latitude: lat, longitude: lon };
  }

  /**
   * Convert WGS84 geographic to Arc 1960 / UTM Zone 37S (Kenya cadastral).
   * This is the primary forward transform for GPS → cadastral workflow.
   * 
   * @param lat - Latitude in decimal degrees
   * @param lon - Longitude in decimal degrees
   * @param h - Ellipsoidal height in metres (passed through as-is; geoid not applied)
   * @returns Kenya cadastral coordinates (Easting, Northing, Height)
   */
  wgs84ToArc1960(lat: number, lon: number, h: number): KenyaCoord {
    const [easting, northing] = proj4(WGS84, ARC1960_UTM37S, [lon, lat]);
    return { easting, northing, height: h };
  }

  /**
   * Convert Arc 1960 / UTM Zone 37S to WGS84 geographic.
   * Inverse of wgs84ToArc1960.
   * 
   * @param easting - UTM Easting in metres
   * @param northing - UTM Northing in metres
   * @param rl - Reduced Level in metres (passed through as altitude)
   * @returns WGS84 coordinates
   */
  arc1960ToWgs84(easting: number, northing: number, rl: number): WGS84Coord {
    const [lon, lat] = proj4(ARC1960_UTM37S, WGS84, [easting, northing]);
    return { latitude: lat, longitude: lon, altitude: rl };
  }

  /**
   * Batch transform: WGS84 → Arc 1960 / UTM Zone 37S
   * 
   * @param points - Array of WGS84 coordinates
   * @returns Array of Kenya cadastral coordinates
   */
  batchWgs84ToArc1960(points: WGS84Coord[]): KenyaCoord[] {
    return points.map(p => this.wgs84ToArc1960(p.latitude, p.longitude, p.altitude));
  }

  /**
   * Batch transform: Arc 1960 / UTM Zone 37S → WGS84
   * 
   * @param points - Array of Kenya cadastral coordinates
   * @returns Array of WGS84 coordinates
   */
  batchArc1960ToWgs84(points: KenyaCoord[]): WGS84Coord[] {
    return points.map(p => this.arc1960ToWgs84(p.easting, p.northing, p.height));
  }

  /**
   * Convert Arc 1960 geographic (lat/lon on Clarke 1880) to UTM Zone 37S.
   * Used when coordinates are already on the Arc 1960 datum but in geographic form.
   * 
   * @param lat - Latitude on Arc 1960 datum
   * @param lon - Longitude on Arc 1960 datum
   * @returns UTM coordinates
   */
  arc1960GeoToUTM37S(lat: number, lon: number): UTMCoord {
    const [easting, northing] = proj4(ARC1960_GEO, ARC1960_UTM37S, [lon, lat]);
    return { easting, northing, zone: 37, hemisphere: 'S' };
  }
}

// T1.5g: Re-export the provenance-tracked transform from the registry
// so callers can import everything from one module.
export {
  transformWithProvenance,
  getTowgs84String,
  listTransformations,
  registerLocalTransformation,
  validateTransformation,
} from '@/lib/geo/datumTransformationRegistry'
export type { TransformedCoordinate, ProvenanceRecord, TransformationSet } from '@/lib/geo/datumTransformationRegistry'
