/**
 * Coordinate conversion utilities
 * Convert between WGS84 (GPS) and Kenya SRID 21037 (Arc 1960 / UTM Zone 37S)
 * 
 * Delegates to DatumTransformer for proper proj4-based geodetic computation.
 * Previous implementation used hardcoded datum shifts (-160, -302) which were
 * inaccurate. Now uses EPSG:1165 Bursa-Wolf parameters via proj4.
 * 
 * All function signatures are preserved for backward compatibility.
 */

import { DatumTransformer } from './datumTransformer';

const transformer = new DatumTransformer();

export interface WGS84Coordinate {
  latitude: number;
  longitude: number;
  altitude: number;
}

export interface UTMCoordinate {
  easting: number;
  northing: number;
  zone: number;
  hemisphere: 'N' | 'S';
}

export interface KenyanCoordinate {
  easting: number;
  northing: number;
  height?: number;
}

/**
 * Convert WGS84 lat/lon to UTM Zone 37S (Arc 1960 datum).
 * @param lat - Latitude in decimal degrees
 * @param lon - Longitude in decimal degrees
 */
export function wgs84ToUTM(lat: number, lon: number): UTMCoordinate {
  const result = transformer.wgs84ToUTM37S(lat, lon);
  return {
    easting: result.easting,
    northing: result.northing,
    zone: result.zone,
    hemisphere: result.hemisphere,
  };
}

/**
 * Convert WGS84 coordinate to Kenyan cadastral (Arc 1960 / UTM 37S).
 * @param wgs - WGS84 coordinate with lat, lon, altitude
 */
export function wgs84ToKenya(wgs: WGS84Coordinate): KenyanCoordinate {
  const result = transformer.wgs84ToArc1960(wgs.latitude, wgs.longitude, wgs.altitude);
  return {
    easting: result.easting,
    northing: result.northing,
    height: result.height,
  };
}

/**
 * Convert Kenyan cadastral (Arc 1960 / UTM 37S) to WGS84.
 * Inverse of wgs84ToKenya.
 * @param coord - Kenyan coordinate with easting, northing, optional height
 */
export function kenyaToWgs84(coord: KenyanCoordinate): WGS84Coordinate {
  const result = transformer.arc1960ToWgs84(coord.easting, coord.northing, coord.height ?? 0);
  return {
    latitude: result.latitude,
    longitude: result.longitude,
    altitude: result.altitude,
  };
}

/**
 * Convert UTM Zone 37S (Arc 1960) to WGS84 geographic.
 * @param easting - UTM Easting in metres
 * @param northing - UTM Northing in metres
 */
export function utmToWgs84(easting: number, northing: number): WGS84Coordinate {
  const result = transformer.utm37SToWgs84(easting, northing);
  return {
    latitude: result.latitude,
    longitude: result.longitude,
    altitude: 0,
  };
}

export function formatCoordinate(coord: KenyanCoordinate, decimals: number = 3): string {
  return `E ${coord.easting.toFixed(decimals)}  N ${coord.northing.toFixed(decimals)}`;
}

export function distance(coord1: KenyanCoordinate, coord2: KenyanCoordinate): number {
  const dE = coord2.easting - coord1.easting;
  const dN = coord2.northing - coord1.northing;
  return Math.sqrt(dE ** 2 + dN ** 2);
}