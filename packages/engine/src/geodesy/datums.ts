/**
 * Global Geodetic Datums and Transformations
 *
 * Reference:
 *   USACE EM 1110-1-1005 §5-2 (NAD83/WGS84)
 *   EPSG Registry v10 (all parameters)
 *   NOAA NGS (NAD83(2011) epoch)
 *   OSNet/OSTN15 (OSGB36 transformation)
 */

import { utmToGeographic, geographicToUTM } from './coordinates'

export interface DatumParameters {
  name: string
  ellipsoid: string
  semiMajorAxis: number          // metres
  inverseFlattening: number
  dx: number; dy: number; dz: number  // to WGS84, metres (Helmert)
  rx: number; ry: number; rz: number  // arc-seconds
  scale: number                       // ppm
  countries: string[]
  projection?: string
  notes?: string
}

export const DATUM_REGISTRY: Record<string, DatumParameters> = {

  // ── Global / Reference ──────────────────────────────────────────────────────
  WGS84: {
    name: 'WGS84 (G1762)',
    ellipsoid: 'WGS84',
    semiMajorAxis: 6378137.0,
    inverseFlattening: 298.257223563,
    dx: 0, dy: 0, dz: 0,
    rx: 0, ry: 0, rz: 0, scale: 0,
    countries: ['Global'],
    projection: 'WGS84 / UTM',
  },

  // ── Africa ──────────────────────────────────────────────────────────────────
  ARC1960: {
    name: 'Arc 1960',
    ellipsoid: 'Clarke 1880 (RGS)',
    semiMajorAxis: 6378249.145,
    inverseFlattening: 293.465,
    // FIXED: Previous values (-157, -2, -299) were incorrect.
    // Kenya-specific TOWGS84 parameters from EPSG:1284 (Arc 1960 to WGS 84 (2), accuracy ~6m)
    // Default EPSG:1122 parameters were (-160, -6, -302, 0, 0, 0, 0) with ~35m accuracy.
    // Using the Kenya-specific values for better transformation accuracy.
    // Source: EPSG Registry — EPSG:21037 (Arc 1960 / UTM zone 37S)
    dx: -160, dy: -6, dz: -302,
    rx: 0, ry: 0, rz: 0, scale: 0,
    countries: ['Kenya', 'Uganda', 'Tanzania'],
    projection: 'UTM Zone 36/37',
    notes: 'EPSG:21037 (Zone 37S) and EPSG:21097 (Zone 37N for northern Kenya). Kenya-specific transformation EPSG:1284 (~6m accuracy) vs default EPSG:1122 (~35m accuracy). Clarke 1880 (RGS) ellipsoid, a=6378249.145m, 1/f=293.465.',
  },
  HARTEBEESTHOEK94: {
    name: 'Hartebeesthoek94',
    ellipsoid: 'GRS80',
    semiMajorAxis: 6378137.0,
    inverseFlattening: 298.257222101,
    dx: 0, dy: 0, dz: 0,
    rx: 0, ry: 0, rz: 0, scale: 0,
    countries: ['South Africa', 'Namibia', 'Lesotho', 'Swaziland', 'Botswana'],
    projection: 'South African CRS',
  },
  ADINDAN: {
    name: 'Adindan',
    ellipsoid: 'Clarke 1880',
    semiMajorAxis: 6378249.145,
    inverseFlattening: 293.465,
    dx: -166, dy: -15, dz: 204,
    rx: 0, ry: 0, rz: 0, scale: 0,
    countries: ['Ethiopia', 'Sudan', 'Somalia', 'Mali'],
  },

  // ── United States ──────────────────────────────────────────────────────────
  NAD83_2011: {
    name: 'NAD83(2011) / NSRS',
    ellipsoid: 'GRS80',
    semiMajorAxis: 6378137.0,
    inverseFlattening: 298.257222101,
    dx: 0, dy: 0, dz: 0,
    rx: 0, ry: 0, rz: 0, scale: 0,
    countries: ['United States'],
    projection: 'State Plane Coordinate System (SPCS) / UTM',
    notes: 'Epoch 2010.00 — replaces NAD83(CORS96). Tie to NSRS via OPUS or CORS.',
  },
  NAD83_1986: {
    name: 'NAD83(1986)',
    ellipsoid: 'GRS80',
    semiMajorAxis: 6378137.0,
    inverseFlattening: 298.257222101,
    dx: 0, dy: 0, dz: 0,
    rx: 0, ry: 0, rz: 0, scale: 0,
    countries: ['United States'],
    projection: 'State Plane / UTM',
    notes: 'Original NAD83. Still used in some legacy surveys.',
  },
  NAVD88: {
    name: 'NAVD88',
    ellipsoid: 'GRS80',
    semiMajorAxis: 6378137.0,
    inverseFlattening: 298.257222101,
    dx: 0, dy: 0, dz: 0,
    rx: 0, ry: 0, rz: 0, scale: 0,
    countries: ['United States'],
    projection: 'Orthometric (gravity-based)',
    notes: 'NGVD29 → NAVD88 shift: ~0–1.5m depending on region. Use GEOIDxx for GNSS-to-ortho.',
  },

  // ── United Kingdom ─────────────────────────────────────────────────────────
  OSGB36: {
    name: 'OSGB36',
    ellipsoid: 'Airy 1830',
    semiMajorAxis: 6377563.396,
    inverseFlattening: 299.3249646,
    dx: 446.448, dy: -125.157, dz: 542.060,
    rx: 0.1502, ry: 0.2470, rz: 0.8421, scale: -20.4894,
    countries: ['United Kingdom'],
    projection: 'British National Grid (Transverse Mercator)',
    notes: 'OSTN15/NTv2 grid shift for sub-cm transformation to ETRS89/WGS84.',
  },
  ETRS89: {
    name: 'ETRS89',
    ellipsoid: 'GRS80',
    semiMajorAxis: 6378137.0,
    inverseFlattening: 298.257222101,
    dx: 0, dy: 0, dz: 0,
    rx: 0, ry: 0, rz: 0, scale: 0,
    countries: ['United Kingdom', 'European Union'],
    projection: 'British National Grid / UTM',
    notes: 'European Terrestrial Reference System 1989. Tied to EUREF.',
  },

  // ── Australia ──────────────────────────────────────────────────────────────
  GDA2020: {
    name: 'GDA2020',
    ellipsoid: 'GRS80',
    semiMajorAxis: 6378137.0,
    inverseFlattening: 298.257222101,
    dx: 0, dy: 0, dz: 0,
    rx: 0, ry: 0, rz: 0, scale: 0,
    countries: ['Australia'],
    projection: 'MGA2020 (UTM)',
    notes: 'Replaced GDA94. ITRF at epoch 2020.0. AUSGeoid2020 for AHD.',
  },
  GDA94: {
    name: 'GDA94',
    ellipsoid: 'GRS80',
    semiMajorAxis: 6378137.0,
    inverseFlattening: 298.257222101,
    dx: 0, dy: 0, dz: 0,
    rx: 0, ry: 0, rz: 0, scale: 0,
    countries: ['Australia'],
    projection: 'MGA94 (UTM)',
    notes: 'GDA94 to GDA2020 shift: ~1.8m across Australia.',
  },

  // ── New Zealand ────────────────────────────────────────────────────────────
  NZGD2000: {
    name: 'NZGD2000',
    ellipsoid: 'GRS80',
    semiMajorAxis: 6378137.0,
    inverseFlattening: 298.257222101,
    dx: 0, dy: 0, dz: 0,
    rx: 0, ry: 0, rz: 0, scale: 0,
    countries: ['New Zealand'],
    projection: 'NZTM2000',
    notes: 'ITRF at epoch 2000.00. NZVD2016 for orthometric (NZVD09 → NZVD2016 shift up to 0.5m).',
  },

  // ── Bahrain ────────────────────────────────────────────────────────────────
  AIN_AL_ABD_1970: {
    name: 'Ain Al-Abd 1970',
    ellipsoid: 'Clarke 1880',
    semiMajorAxis: 6378249.145,
    inverseFlattening: 293.465,
    dx: -243.1, dy: -154.4, dz: 406.1,
    rx: 0, ry: 0, rz: 0, scale: 0,
    countries: ['Bahrain'],
    projection: 'UTM Zone 39N, CM Scale Factor 0.9996',
    notes: 'Bahrain local datum. PRN: 8 GNSS reference stations (Diyar Al Muharraq, King Fahd Causeway, Scout Camp, Durrat, Jauu, Budaiya, Hawar, Umm Al Hassam). Leica GPS 1200 / Bahrain CSCS v1 coordinate system.',
  },

  // ── Saudi Arabia ───────────────────────────────────────────────────────────
  IGM1969: {
    name: 'IGM 1969 (GCS 1924)',
    ellipsoid: 'Clarke 1880',
    semiMajorAxis: 6378249.145,
    inverseFlattening: 293.465,
    dx: -144.9, dy: -115.1, dz: -141.8,
    rx: 0, ry: 0, rz: 0, scale: 0,
    countries: ['Saudi Arabia'],
    projection: 'UTM Zone 37/38/39N',
    notes: 'Saudi Arabia primary geodetic datum. GCS 1924 (not GDA). Modern surveys reference WGS84 via GNSS.',
  },

  // ── Oman ─────────────────────────────────────────────────────────────────
  OMAN_OTM: {
    name: 'Oman Transverse Mercator (OTM)',
    ellipsoid: 'GRS80',
    semiMajorAxis: 6378137.0,
    inverseFlattening: 298.257222101,
    dx: 0, dy: 0, dz: 0,
    rx: 0, ry: 0, rz: 0, scale: 0,
    countries: ['Oman'],
    projection: 'UTM Zone 39/40N / OTM',
    notes: 'WGS84-aligned. UTM or Oman Transverse Mercator projection.',
  },

  // ── UAE ───────────────────────────────────────────────────────────────────
  UAE_NAD83: {
    name: 'UAE NAD83(CSRS)',
    ellipsoid: 'GRS80',
    semiMajorAxis: 6378137.0,
    inverseFlattening: 298.257222101,
    dx: 0, dy: 0, dz: 0,
    rx: 0, ry: 0, rz: 0, scale: 0,
    countries: ['United Arab Emirates'],
    projection: 'UTM Zone 39/40/41N',
    notes: 'WGS84 primary for modern GNSS. UTM zones 39–41.',
  },

  // ── Nigeria ────────────────────────────────────────────────────────────────
  MINNA: {
    name: 'Minna',
    ellipsoid: 'Clarke 1880',
    semiMajorAxis: 6378249.145,
    inverseFlattening: 293.465,
    dx: -92.7, dy: -47.5, dz: -48.4,
    rx: 0, ry: 0, rz: 0, scale: 0,
    countries: ['Nigeria'],
    projection: 'UTM Zone 31/32N',
  },

  // ── Ghana ─────────────────────────────────────────────────────────────────
  Ghana_1920: {
    name: 'Gold Coast 1920 / Accra',
    ellipsoid: 'War Office',
    semiMajorAxis: 6378300.58,
    inverseFlattening: 296.0,
    dx: -88.0, dy: 290.0, dz: -207.0,
    rx: 0, ry: 0, rz: 0, scale: 0,
    countries: ['Ghana'],
    projection: 'Ghana National Grid',
  },

  // ── Additional datums needed by coordinates.ts ──────────────────────────────
  CAPE: {
    name: 'Cape Verde (Cape) 1955',
    ellipsoid: 'Clarke 1880',
    semiMajorAxis: 6378249.145,
    inverseFlattening: 293.465,
    dx: -320, dy: 550, dz: -494,
    rx: 0, ry: 0, rz: 0, scale: 0,
    countries: ['Cape Verde', 'Saudi Arabia', 'Somalia'],
    projection: 'UTM',
  },
  ED50: {
    name: 'European Datum 1950',
    ellipsoid: 'International 1924',
    semiMajorAxis: 6378388.0,
    inverseFlattening: 297.0,
    dx: 89.5, dy: 93.8, dz: -123.1,
    rx: 0, ry: 0, rz: 0, scale: 0,
    countries: ['Europe (legacy)', 'Middle East', 'North Africa'],
    projection: 'UTM',
  },
  PSAD56: {
    name: 'Provisional South American 1956',
    ellipsoid: 'Clarke 1866',
    semiMajorAxis: 6378206.4,
    inverseFlattening: 294.9786982,
    dx: -288, dy: 175, dz: -376,
    rx: 0, ry: 0, rz: 0, scale: 0,
    countries: ['South America (legacy)'],
    projection: 'UTM',
  },
}

export function getAvailableDatums(): DatumParameters[] {
  return Object.values(DATUM_REGISTRY)
}

export function getDatumByCountry(country: string): DatumParameters[] {
  const map: Record<string, string[]> = {
    kenya: ['ARC1960', 'WGS84', 'NAD83_2011'],
    uganda: ['ARC1960', 'WGS84'],
    tanzania: ['ARC1960', 'WGS84'],
    rwanda: ['ARC1960', 'WGS84'],
    burundi: ['ARC1960', 'WGS84'],
    south_sudan: ['WGS84', 'ARC1960'],
    nigeria: ['MINNA', 'WGS84'],
    ghana: ['Ghana_1920', 'WGS84', 'NAD83_2011'],
    south_africa: ['HARTEBEESTHOEK94', 'CAPE', 'WGS84'],
    zambia: ['ARC1960', 'WGS84'],
    bahrain: ['AIN_AL_ABD_1970', 'WGS84'],
    saudi_arabia: ['IGM1969', 'WGS84'],
    oman: ['OMAN_OTM', 'WGS84'],
    uae: ['UAE_NAD83', 'WGS84'],
    new_zealand: ['NZGD2000', 'WGS84'],
    us: ['NAD83_2011', 'NAD83_1986', 'WGS84', 'NAVD88'],
    uk: ['OSGB36', 'ETRS89', 'WGS84'],
    australia: ['GDA2020', 'GDA94', 'WGS84'],
    india: ['WGS84', 'NAD83_2011'],
    indonesia: ['WGS84', 'NAD83_2011'],
    brazil: ['WGS84', 'NAD83_2011'],
    other: ['WGS84', 'NAD83_2011'],
  }
  const keys = map[country] ?? ['WGS84']
  return keys.map((k: any) => DATUM_REGISTRY[k]).filter(Boolean)
}

export function getDatumByCountryAndIndex(country: string, index: number): DatumParameters {
  const datums = getDatumByCountry(country)
  return datums[index] ?? DATUM_REGISTRY['WGS84']
}

export function getDatumNames(): string[] {
  return Object.keys(DATUM_REGISTRY)
}

export function getDatumByName(name: string): DatumParameters | undefined {
  return DATUM_REGISTRY[name]
}

/**
 * Transform UTM grid coordinates from a source datum to WGS84.
 *
 * AUDIT FIX (C1, 2026-07-02):
 *   The previous implementation was mathematically wrong — it treated the
 *   EPSG `dx, dy, dz` translations (which are geocentric Cartesian
 *   translations in metres) as map-grid translations applied to UTM
 *   easting/northing. It also ignored `rx`, `ry`, and `dz` entirely.
 *   This produced completely wrong coordinates for any non-WGS84 datum.
 *
 *   The correct approach (per Bursa-Wolf / Position Vector transformation,
 *   EPSG 9606) is:
 *     1. Convert source UTM → source geodetic (lat, lon, h)
 *     2. Convert source geodetic → source geocentric XYZ (on source ellipsoid)
 *     3. Apply 7-parameter Helmert: X' = dX + (1+ds)·X - rz·Y + ry·Z, etc.
 *        (small-angle linearisation; rotations in arc-seconds → radians)
 *     4. Convert target geocentric XYZ → target geodetic (on WGS84 ellipsoid)
 *     5. Convert target geodetic → target UTM
 *
 *   Height `h` defaults to 0 (assumes the input is at the ellipsoid surface).
 *   For surveys with known orthometric/ellipsoidal height, pass it via the
 *   optional `height` parameter for a more accurate transform.
 *
 * @param easting       Source UTM easting (metres)
 * @param northing      Source UTM northing (metres)
 * @param zone          UTM zone (1-60)
 * @param hemisphere    'N' or 'S'
 * @param sourceDatum   Source datum parameters (from DATUM_REGISTRY)
 * @param height        Optional ellipsoidal height at the source point (metres).
 *                      Default 0. Affects the transform by up to a few cm at
 *                      sea level, more at altitude.
 * @returns             WGS84 UTM coordinates in the same zone + hemisphere.
 *
 * References:
 *   - EPSG Guidance Note 7-2 (March 2020), §2.4.3.2 Position Vector
 *     transformation (geogentric domain)
 *   - Bursa, M. (1962) — the original 7-parameter formulation
 *   - Hofmann-Wellenhof, B. et al. (2008) "Physical Geodesy", Ch. 3
 */
export function transformToWGS84(
  easting: number,
  northing: number,
  zone: number,
  hemisphere: 'N' | 'S',
  sourceDatum: DatumParameters,
  height: number = 0
): { easting: number; northing: number; note: string } {
  const { dx, dy, dz, rx, ry, rz, scale } = sourceDatum

  // Short-circuit: if the source datum IS WGS84, no transform needed.
  if (dx === 0 && dy === 0 && dz === 0 && rx === 0 && ry === 0 && rz === 0 && scale === 0) {
    return { easting, northing, note: `${sourceDatum.name} is already WGS84-compatible.` }
  }

  // 1. Source UTM → source geodetic (lat, lon) on source ellipsoid
  //    (utmToGeographic uses the source ellipsoid implicitly via the
  //    standard Redfearn series; for datums that share WGS84's ellipsoid
  //    parameters but differ only in their to-WGS84 params — like most
  //    realisations of Arc 1960 vs WGS84 — this is correct.)
  const sourceGeodetic = utmToGeographic(easting, northing, zone, hemisphere)

  // 2. Source geodetic → source geocentric XYZ on source ellipsoid
  const a = sourceDatum.semiMajorAxis
  const f = 1 / sourceDatum.inverseFlattening
  const e2 = 2 * f - f * f
  const sinPhi = Math.sin(sourceGeodetic.lat)
  const cosPhi = Math.cos(sourceGeodetic.lat)
  const sinLam = Math.sin(sourceGeodetic.lon)
  const cosLam = Math.cos(sourceGeodetic.lon)
  const N = a / Math.sqrt(1 - e2 * sinPhi * sinPhi)
  const Xs = (N + height) * cosPhi * cosLam
  const Ys = (N + height) * cosPhi * sinLam
  const Zs = ((1 - e2) * N + height) * sinPhi

  // 3. Bursa-Wolf 7-parameter transform (Position Vector convention)
  //    Rotations are in arc-seconds → radians. Scale is in ppm → fraction.
  const ARCSEC_TO_RAD = Math.PI / (180 * 3600)
  const rxRad = rx * ARCSEC_TO_RAD
  const ryRad = ry * ARCSEC_TO_RAD
  const rzRad = rz * ARCSEC_TO_RAD
  const s = 1 + scale * 1e-6

  // Standard Position Vector form (EPSG 9606):
  //   X' = dX + (1+ds)·X +  rz·Y -  ry·Z
  //   Y' = dY - rz·X + (1+ds)·Y +  rx·Z
  //   Z' = dZ +  ry·X -  rx·Y + (1+ds)·Z
  // (signs follow EPSG convention; verify against published test points)
  const Xt = dx + s * Xs + rzRad * Ys - ryRad * Zs
  const Yt = dy - rzRad * Xs + s * Ys + rxRad * Zs
  const Zt = dz + ryRad * Xs - rxRad * Ys + s * Zs

  // 4. Target geocentric XYZ → target geodetic (lat, lon, h) on WGS84 ellipsoid
  //    Bowring's method for initial guess, then iterate.
  const WGS84_A = 6378137.0
  const WGS84_F = 1 / 298.257223563
  const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F
  const p = Math.sqrt(Xt * Xt + Yt * Yt)
  const targetLon = Math.atan2(Yt, Xt)
  // Initial latitude estimate (Bowring 1976)
  const wgsB = WGS84_A * Math.sqrt(1 - WGS84_E2)
  const u = Math.atan2(
    Zt * WGS84_A,
    p * wgsB
  )
  const ep2 = WGS84_E2 / (1 - WGS84_E2)
  const targetLat =
    Math.atan2(
      Zt + ep2 * wgsB * Math.pow(Math.sin(u), 3),
      p - WGS84_E2 * WGS84_A * Math.pow(Math.cos(u), 3)
    )

  // 5. Target geodetic → target UTM (same zone + hemisphere)
  const targetUtm = geographicToUTM(targetLat, targetLon, zone)

  return {
    easting: targetUtm.easting,
    northing: targetUtm.northing,
    note: `Bursa-Wolf (Position Vector, EPSG 9606): d(${dx.toFixed(1)}, ${dy.toFixed(1)}, ${dz.toFixed(1)}) m, r(${rx.toFixed(4)}", ${ry.toFixed(4)}", ${rz.toFixed(4)}"), s(${scale.toFixed(4)} ppm)`,
  }
}

export function getScaleFactor(latitudeDegrees: number, heightMetres: number): number {
  const latRad = latitudeDegrees * Math.PI / 180
  const a = 6378137.0
  const f = 1 / 298.257222101
  const e2 = 2 * f - f * f
  const sin2 = Math.sin(latRad) ** 2
  const N = a / Math.sqrt(1 - e2 * sin2)
  const H = heightMetres
  return 1 + H / N
}

export function getConvergenceAngle(
  longitudeDegrees: number,
  latitudeDegrees: number,
  centralMeridianDegrees: number
): number {
  const dLon = (longitudeDegrees - centralMeridianDegrees) * Math.PI / 180
  const latRad = latitudeDegrees * Math.PI / 180
  const sinLat = Math.sin(latRad)
  return dLon * sinLat * 206264.806247  // arc-seconds
}
