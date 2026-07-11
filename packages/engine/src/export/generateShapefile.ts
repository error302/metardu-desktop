export interface BeaconData {
  id: string
  name: string
  type: string
  easting: number
  northing: number
  height?: number
  description?: string
}

export interface BoundaryLine {
  id: string
  from: string
  to: string
  fromEasting: number
  fromNorthing: number
  toEasting: number
  toNorthing: number
  bearing: number
  distance: number
}

export interface ParcelData {
  id: string
  lrNumber?: string
  boundaryPoints: Array<{ easting: number; northing: number }>
  area_sqm: number
  area_ha?: number
}

function getUTMPrj(zone: number, hemisphere: 'N' | 'S'): string {
  const hemi = hemisphere === 'N' ? 'Northern' : 'Southern'
  return `PROJCS["WGS 84 / UTM zone ${zone}${hemi}",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",${-183 + zone * 6}],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",${hemisphere === 'S' ? 10000000 : 0}],UNIT["metre",1]]`
}

export async function generateShapefileZip(
  beacons: BeaconData[],
  boundaries: BoundaryLine[],
  parcels: ParcelData[],
  submissionNumber: string,
  utmZone: number,
  hemisphere: 'N' | 'S'
): Promise<Blob> {
  const prjContent = getUTMPrj(utmZone, hemisphere)

  const parts: Array<{ name: string; blob: Blob }> = []

  if (beacons.length > 0) {
    const pointsGeoJSON = {
      type: 'FeatureCollection' as const,
      features: beacons.map((b: any) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [b.easting, b.northing] },
        properties: {
          STATION: b.name,
          CLASS: b.type,
          NORTHING: b.northing.toFixed(3),
          EASTING: b.easting.toFixed(3),
          HEIGHT: b.height?.toFixed(3) ?? '',
        }
      }))
    }

    const pointsStr = JSON.stringify(pointsGeoJSON)
    parts.push({ name: `${submissionNumber}_Beacons.geojson`, blob: new Blob([pointsStr], { type: 'application/json' }) })
  }

  if (boundaries.length > 0) {
    const linesGeoJSON = {
      type: 'FeatureCollection' as const,
      features: boundaries.map((b: any) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [b.fromEasting, b.fromNorthing],
            [b.toEasting, b.toNorthing],
          ]
        },
        properties: {
          FROM: b.from,
          TO: b.to,
          BEARING: b.bearing.toFixed(4),
          DISTANCE: b.distance.toFixed(3),
        }
      }))
    }

    const linesStr = JSON.stringify(linesGeoJSON)
    parts.push({ name: `${submissionNumber}_BoundaryLines.geojson`, blob: new Blob([linesStr], { type: 'application/json' }) })
  }

  if (parcels.length > 0) {
    const polygonsGeoJSON = {
      type: 'FeatureCollection' as const,
      features: parcels.map((p: any) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [p.boundaryPoints.map((pt: any) => [pt.easting, pt.northing])]
        },
        properties: {
          PARCEL_ID: p.id,
          LR_NUMBER: p.lrNumber ?? '',
          AREA_SQM: p.area_sqm.toFixed(3),
          AREA_HA: (p.area_ha ?? p.area_sqm / 10000).toFixed(4),
        }
      }))
    }

    const polygonsStr = JSON.stringify(polygonsGeoJSON)
    parts.push({ name: `${submissionNumber}_Parcels.geojson`, blob: new Blob([polygonsStr], { type: 'application/json' }) })
  }

  parts.push({ name: 'projection.prj', blob: new Blob([prjContent], { type: 'text/plain' }) })

  const combined = new Blob(parts.map((p: any) => p.blob), { type: 'application/zip' })
  return combined
}