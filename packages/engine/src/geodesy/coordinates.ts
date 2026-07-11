/**
 * Calculation standard: N.N. Basak — Surveying and Levelling
 * Source: N.N. Basak, Surveying and Levelling, Chapter 3
 * Source: Ghilani & Wolf, Elementary Surveying 16th Ed., Chapter 7 (UTM)
 * Source: EPSG Guidance Note 7-2 — Standard Redfearn formula for UTM
 * Source: USACE EM 1110-1-1005 §5-2
 * - No intermediate rounding
 * - Full floating point precision throughout
 * - Round only at final display layer
 * - Bearings: WCB 0-360° clockwise from North
 */

// METARDU Engine - Coordinate conversions

import { LatLon, UTMCoord, DMS } from '@/lib/engine/types';
import { decimalToDMS } from '@/lib/engine/angles';
import { getUTMZoneFromLatLng } from './utmZones';

// WGS84 ellipsoid
const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F;
const WGS84_EP2 = WGS84_E2 / (1 - WGS84_E2); // e'^2

function normalizeLongitudeDeg(lon: number) {
  let x = lon
  while (x < -180) x += 360
  while (x >= 180) x -= 360
  return x
}

export function geographicToUTM(lat: number, lon: number, zone?: number): UTMCoord {
  const normalizedLon = normalizeLongitudeDeg(lon)

  const latRad = (lat * Math.PI) / 180;
  const lonRad = (normalizedLon * Math.PI) / 180;

  const computedZone = zone ?? getUTMZoneFromLatLng(lat, normalizedLon).zone
  const lonOrigin = (computedZone - 1) * 6 - 180 + 3;
  const lonOriginRad = (lonOrigin * Math.PI) / 180;

  const k0 = 0.9996;

  const sinLat = Math.sin(latRad)
  const cosLat = Math.cos(latRad)
  const tanLat = Math.tan(latRad)

  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const T = tanLat * tanLat;
  const C = WGS84_EP2 * cosLat * cosLat;
  const A = cosLat * (lonRad - lonOriginRad);

  const e4 = WGS84_E2 * WGS84_E2
  const e6 = e4 * WGS84_E2

  // Source: EPSG Guidance Note 7-2 — Redfearn formula, M series expansion
  // Source: Ghilani & Wolf, Chapter 7 — Meridian distance M
  const M = WGS84_A * (
    (1 - WGS84_E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * latRad
    - ((3 * WGS84_E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * latRad)
    + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * latRad)
    - ((35 * e6) / 3072) * Math.sin(6 * latRad)
  )

  // Source: EPSG Guidance Note 7-2 — Easting coordinate E = k₀N(A + ...)
  let easting = k0 * N * (
    A
    + ((1 - T + C) * Math.pow(A, 3)) / 6
    + ((5 - 18 * T + T * T + 72 * C - 58 * WGS84_EP2) * Math.pow(A, 5)) / 120
  ) + 500000

  // Source: EPSG Guidance Note 7-2 — Northing coordinate N = k₀(M + N·tan·φ·(...))
  let northing = k0 * (M + N * tanLat * (
    (A * A) / 2
    + ((5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4)) / 24
    + ((61 - 58 * T + T * T + 600 * C - 330 * WGS84_EP2) * Math.pow(A, 6)) / 720
  ))

  const hemisphere: 'N' | 'S' = lat >= 0 ? 'N' : 'S';
  if (hemisphere === 'S') northing += 10000000;

  return { easting, northing, zone: computedZone, hemisphere };
}

function utmToGeographicApprox(easting: number, northing: number, zone: number, hemisphere: 'N' | 'S'): LatLon {
  const k0 = 0.9996;
  const e1 = (1 - Math.sqrt(1 - WGS84_E2)) / (1 + Math.sqrt(1 - WGS84_E2));

  let y = northing;
  if (hemisphere === 'S') y -= 10000000;

  const x = easting - 500000;

  const lonOrigin = (zone - 1) * 6 - 180 + 3;
  const lonOriginRad = (lonOrigin * Math.PI) / 180;

  const e4 = WGS84_E2 * WGS84_E2
  const e6 = e4 * WGS84_E2

  const M = y / k0;
  const mu = M / (WGS84_A * (1 - WGS84_E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256));

  const phi1 =
    mu +
    (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu) +
    (21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu) +
    (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu) +
    (1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu);

  const sin1 = Math.sin(phi1)
  const cos1 = Math.cos(phi1)
  const tan1 = Math.tan(phi1)

  const N1 = WGS84_A / Math.sqrt(1 - WGS84_E2 * sin1 * sin1);
  const T1 = tan1 * tan1;
  const C1 = WGS84_EP2 * cos1 * cos1;
  const R1 = (WGS84_A * (1 - WGS84_E2)) / Math.pow(1 - WGS84_E2 * sin1 * sin1, 1.5);
  const D = x / (N1 * k0);

  const lat =
    phi1 -
    (N1 * tan1 / R1) *
      (D * D / 2 -
        (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * WGS84_EP2) * Math.pow(D, 4) / 24 +
        (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * WGS84_EP2 - 3 * C1 * C1) * Math.pow(D, 6) / 720);

  const lon =
    lonOriginRad +
    (D -
      (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6 +
      (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * WGS84_EP2 + 24 * T1 * T1) * Math.pow(D, 5) / 120) /
      cos1;

  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

export function utmToGeographic(easting: number, northing: number, zone: number, hemisphere: 'N' | 'S'): LatLon {
  const initial = utmToGeographicApprox(easting, northing, zone, hemisphere)

  // Refine with Newton iterations to improve round-trip (UTM -> lat/lon -> UTM) accuracy.
  // This targets the Basak requirement: round-trip < 1 mm across the valid UTM latitude band.
  let lat = initial.lat
  let lon = initial.lon

  const maxIterations = 8
  const targetMeters = 0.0005 // 0.5 mm

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const predicted = geographicToUTM(lat, lon, zone)
    const dE = easting - predicted.easting
    const dN = northing - predicted.northing

    if (Math.hypot(dE, dN) <= targetMeters) break

    // Numerical Jacobian (meters per degree)
    const deltaDeg = 1e-8

    const predictedLatPlus = geographicToUTM(lat + deltaDeg, lon, zone)
    const predictedLatMinus = geographicToUTM(lat - deltaDeg, lon, zone)

    const predictedLonPlus = geographicToUTM(lat, lon + deltaDeg, zone)
    const predictedLonMinus = geographicToUTM(lat, lon - deltaDeg, zone)

    const dEdLat = (predictedLatPlus.easting - predictedLatMinus.easting) / (2 * deltaDeg)
    const dNdLat = (predictedLatPlus.northing - predictedLatMinus.northing) / (2 * deltaDeg)

    const dEdLon = (predictedLonPlus.easting - predictedLonMinus.easting) / (2 * deltaDeg)
    const dNdLon = (predictedLonPlus.northing - predictedLonMinus.northing) / (2 * deltaDeg)

    const det = dEdLat * dNdLon - dEdLon * dNdLat

    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
      // Fallback: if Jacobian is singular (should be rare), return the approximation.
      return initial
    }

    // Solve J * [dLat, dLon] = [dE, dN]
    const dLat = (dE * dNdLon - dEdLon * dN) / det
    const dLon = (dEdLat * dN - dE * dNdLat) / det

    lat += dLat
    lon += dLon

    if (hemisphere === 'S' && lat > 0) lat = -Math.abs(lat)
    if (hemisphere === 'N' && lat < 0) lat = Math.abs(lat)

    lon = normalizeLongitudeDeg(lon)
  }

  return { lat, lon }
}

/** Convert a whole-circle bearing (degrees) + distance to coordinate deltas. */
export function bearingDistanceToDelta(bearingDeg: number, distance: number): { deltaE: number; deltaN: number } {
  const rad = (bearingDeg * Math.PI) / 180;
  return {
    deltaE: distance * Math.sin(rad),
    deltaN: distance * Math.cos(rad),
  };
}

export function latLonToString(lat: number, lon: number): string {
  const latDMS = decimalToDMS(lat, true);
  const lonDMS = decimalToDMS(lon, false);
  return `${latDMS.degrees}° ${latDMS.minutes}' ${latDMS.seconds.toFixed(3)}" ${latDMS.direction}, ${lonDMS.degrees}° ${lonDMS.minutes}' ${lonDMS.seconds.toFixed(3)}" ${lonDMS.direction}`;
}
