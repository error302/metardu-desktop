/**
 * Geodesy Client Fallback — Pure TypeScript client-side projection converter.
 *
 * Provides instant in-browser and fallback reprojection from national grid
 * coordinates (Easting, Northing) to WGS84 (Lon, Lat) degrees.
 */

export interface LonLat {
  lon: number;
  lat: number;
}

export function utmInverseClient(
  easting: number,
  northing: number,
  zone: number,
  isSouthern: boolean,
  a = 6378137.0,
  f = 1 / 298.257223563,
): LonLat {
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1.0 - e2);
  const k0 = 0.9996;
  const centralMeridian = (zone * 6.0 - 183.0) * (Math.PI / 180);
  const falseNorthing = isSouthern ? 10000000.0 : 0.0;
  const falseEasting = 500000.0;

  const m = (northing - falseNorthing) / k0;
  const mu = m / (a * (1.0 - e2 / 4.0 - (3.0 * e2 * e2) / 64.0 - (5.0 * Math.pow(e2, 3)) / 256.0));
  const e1 = (1.0 - Math.sqrt(1.0 - e2)) / (1.0 + Math.sqrt(1.0 - e2));

  const phi1 =
    mu +
    ((3.0 * e1) / 2.0 - (27.0 * Math.pow(e1, 3)) / 32.0) * Math.sin(2.0 * mu) +
    ((21.0 * e1 * e1) / 16.0 - (55.0 * Math.pow(e1, 4)) / 32.0) * Math.sin(4.0 * mu) +
    ((151.0 * Math.pow(e1, 3)) / 96.0) * Math.sin(6.0 * mu);

  const tanPhi1 = Math.tan(phi1);
  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);

  const n1 = a / Math.sqrt(1.0 - e2 * sinPhi1 * sinPhi1);
  const t1 = tanPhi1 * tanPhi1;
  const c1 = ep2 * cosPhi1 * cosPhi1;
  const r1 = (a * (1.0 - e2)) / Math.pow(Math.sqrt(1.0 - e2 * sinPhi1 * sinPhi1), 3);

  const d = (easting - falseEasting) / (n1 * k0);

  const phi =
    phi1 -
    ((n1 * tanPhi1) / r1) *
      ((d * d) / 2.0 -
        (5.0 + 3.0 * t1 + 10.0 * c1 - 4.0 * c1 * c1 - 9.0 * ep2) * (Math.pow(d, 4) / 24.0) +
        (61.0 + 90.0 * t1 + 298.0 * c1 + 45.0 * t1 * t1 - 252.0 * ep2 - 3.0 * c1 * c1) *
          (Math.pow(d, 6) / 720.0));

  const lam =
    centralMeridian +
    (d -
      (1.0 + 2.0 * t1 + c1) * (Math.pow(d, 3) / 6.0) +
      (5.0 - 2.0 * c1 + 28.0 * t1 - 3.0 * c1 * c1 + 8.0 * ep2 + 24.0 * t1 * t1) * (Math.pow(d, 5) / 120.0)) /
      cosPhi1;

  return {
    lat: (phi * 180) / Math.PI,
    lon: (lam * 180) / Math.PI,
  };
}

export function projectToWgs84Client(
  countryCode: string,
  easting: number,
  northing: number,
): LonLat {
  const cc = countryCode.toUpperCase();
  if (cc === "KE") return utmInverseClient(easting, northing, 37, true, 6378249.145, 1 / 293.465); // Clarke 1880 UTM 37S
  if (cc === "AU") return utmInverseClient(easting, northing, 56, true);
  if (cc === "DE") return utmInverseClient(easting, northing, 32, false);
  if (cc === "AE") return utmInverseClient(easting, northing, 40, false);
  if (cc === "GH") return utmInverseClient(easting, northing, 30, false);
  if (cc === "GB") {
    // Transverse Mercator for BNG
    return utmInverseClient(easting, northing, 30, false, 6377563.396, 1 / 299.3249646);
  }
  return utmInverseClient(easting, northing, 37, true);
}
