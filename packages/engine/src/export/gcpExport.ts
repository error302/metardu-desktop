/**
 * GCP (Ground Control Point) Export
 * Converts UTM control points to formats used by drone/photogrammetry software.
 * Coordinates are converted to WGS84 lat/lon as required by most drone platforms.
 */

import { utmToGeographic } from '@/lib/geodesy/coordinates'

export interface GCPPoint {
  name: string
  easting: number
  northing: number
  elevation: number
  utmZone: number
  hemisphere: 'N' | 'S'
}

export interface GCPExportResult {
  lat: number
  lon: number
  elevation: number
  name: string
}

function toWGS84(pt: GCPPoint): GCPExportResult {
  const { lat, lon } = utmToGeographic(pt.easting, pt.northing, pt.utmZone, pt.hemisphere)
  return { lat, lon, elevation: pt.elevation, name: pt.name }
}

// ── Pix4D format ─────────────────────────────────────────────────────────────
// GCP_Name,Latitude,Longitude,Altitude(m)
export function exportPix4D(points: GCPPoint[]): string {
  const header = '#GCP_name,Latitude,Longitude,Altitude(m)'
  const rows = points.map((pt: any) => {
    const { lat, lon, elevation, name } = toWGS84(pt)
    return `${name},${lat.toFixed(8)},${lon.toFixed(8)},${elevation.toFixed(3)}`
  })
  return [header, ...rows].join('\n')
}

// ── DroneDeploy format ────────────────────────────────────────────────────────
// GCP Name,Lat,Lon,Alt
export function exportDroneDeploy(points: GCPPoint[]): string {
  const header = 'GCP Name,Lat,Lon,Alt'
  const rows = points.map((pt: any) => {
    const { lat, lon, elevation, name } = toWGS84(pt)
    return `${name},${lat.toFixed(8)},${lon.toFixed(8)},${elevation.toFixed(3)}`
  })
  return [header, ...rows].join('\n')
}

// ── Agisoft Metashape format ─────────────────────────────────────────────────
// label,x/long,y/lat,z/alt (WGS84 degrees, then elevation)
export function exportMetashape(points: GCPPoint[]): string {
  const header = '#Metashape GCP file\n#label\tx/long\ty/lat\tz/alt'
  const rows = points.map((pt: any) => {
    const { lat, lon, elevation, name } = toWGS84(pt)
    return `${name}\t${lon.toFixed(8)}\t${lat.toFixed(8)}\t${elevation.toFixed(3)}`
  })
  return [header, ...rows].join('\n')
}

// ── OpenDroneMap format ───────────────────────────────────────────────────────
// +proj=latlong +datum=WGS84
// name lat lon alt
export function exportODM(points: GCPPoint[]): string {
  const header = '+proj=latlong +datum=WGS84'
  const rows = points.map((pt: any) => {
    const { lat, lon, elevation, name } = toWGS84(pt)
    return `${lon.toFixed(8)} ${lat.toFixed(8)} ${elevation.toFixed(3)} 0 0 ${name}`
  })
  return [header, ...rows].join('\n')
}

// ── Generic CSV (for QGIS, ArcGIS, Excel) ────────────────────────────────────
export function exportGenericCSV(points: GCPPoint[]): string {
  const header = 'Name,Latitude_WGS84,Longitude_WGS84,Elevation_m,Easting_UTM,Northing_UTM,UTM_Zone'
  const rows = points.map((pt: any) => {
    const { lat, lon } = toWGS84(pt)
    return `${pt.name},${lat.toFixed(8)},${lon.toFixed(8)},${pt.elevation.toFixed(3)},${pt.easting.toFixed(4)},${pt.northing.toFixed(4)},${pt.utmZone}${pt.hemisphere}`
  })
  return [header, ...rows].join('\n')
}

// ── GeoJSON (WGS84) for QGIS / ArcGIS ────────────────────────────────────────
export function exportGCPGeoJSON(points: GCPPoint[]): string {
  const features = points.map((pt: any) => {
    const { lat, lon } = toWGS84(pt)
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat, pt.elevation] },
      properties: {
        name: pt.name,
        elevation: pt.elevation,
        easting: pt.easting,
        northing: pt.northing,
        utm_zone: `${pt.utmZone}${pt.hemisphere}`,
        type: 'GCP',
      },
    }
  })
  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2)
}

export type GCPFormat = 'pix4d' | 'dronedeploy' | 'metashape' | 'odm' | 'csv' | 'geojson'

export const GCP_FORMATS: { id: GCPFormat; label: string; ext: string; desc: string }[] = [
  { id: 'pix4d',       label: 'Pix4D',             ext: 'csv',     desc: 'Pix4Dmapper / Pix4Dmatic GCP file' },
  { id: 'dronedeploy', label: 'DroneDeploy',        ext: 'csv',     desc: 'DroneDeploy GCP import format' },
  { id: 'metashape',   label: 'Agisoft Metashape',  ext: 'txt',     desc: 'Agisoft Metashape GCP reference file' },
  { id: 'odm',         label: 'OpenDroneMap',       ext: 'txt',     desc: 'ODM / WebODM GCP file' },
  { id: 'csv',         label: 'Generic CSV',        ext: 'csv',     desc: 'Works with QGIS, ArcGIS, Excel' },
  { id: 'geojson',     label: 'GeoJSON (WGS84)',    ext: 'geojson', desc: 'Direct import into QGIS / ArcGIS / Mapbox' },
]

export function exportGCPs(points: GCPPoint[], format: GCPFormat): { content: string; ext: string } {
  const fmt = GCP_FORMATS.find((f: any) => f.id === format)!
  const exportFns: Record<GCPFormat, (pts: GCPPoint[]) => string> = {
    pix4d:       exportPix4D,
    dronedeploy: exportDroneDeploy,
    metashape:   exportMetashape,
    odm:         exportODM,
    csv:         exportGenericCSV,
    geojson:     exportGCPGeoJSON,
  }
  return { content: exportFns[format](points), ext: fmt.ext }
}
