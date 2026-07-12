/**
 * Map Standards Shim — renderer-side constants
 *
 * Provides the KENYA_PROJECTIONS constant to the renderer without requiring
 * a round-trip through IPC. For full SoK layer registry, the renderer can
 * also call window.metardu.map.getLayers() — but for the projection
 * definitions (needed at map init time), we keep them inline.
 *
 * Source of truth: apps/desktop/electron/map-standards.ts
 */

export interface ProjectionSpec {
  epsg: number;
  name: string;
  proj4: string;
  extent: [number, number, number, number];
  useCase: string;
}

export const KENYA_PROJECTIONS: ProjectionSpec[] = [
  {
    epsg: 3857,
    name: 'Web Mercator',
    proj4: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs',
    extent: [-20037508, -20037508, 20037508, 20037508],
    useCase: 'Online basemaps (OSM, satellite)',
  },
  {
    epsg: 4326,
    name: 'WGS84 Lat/Lon',
    proj4: '+proj=longlat +datum=WGS84 +no_defs',
    extent: [-180, -90, 180, 90],
    useCase: 'GNSS coordinates, KML export',
  },
  {
    epsg: 21037,
    name: 'Arc 1960 UTM Zone 37S',
    proj4: '+proj=utm +zone=37 +south +ellps=clrk80 +towgs84=-160,-6,-302,0,0,0,0 +units=m +no_defs',
    extent: [276483, 9783936, 945284, 11202538],
    useCase: 'Kenya engineering surveys (RDM 1.1)',
  },
  {
    epsg: 21036,
    name: 'Arc 1960 UTM Zone 36S',
    proj4: '+proj=utm +zone=36 +south +ellps=clrk80 +towgs84=-160,-6,-302,0,0,0,0 +units=m +no_defs',
    extent: [-323516, 9783936, 345284, 11202538],
    useCase: 'Western Kenya engineering surveys',
  },
  {
    epsg: 20437,
    name: 'Arc 1960 / Cassini-Soldner Kenya',
    proj4: '+proj=cass +lat_0=0 +lon_0=37 +x_0=300000 +y_0=0 +ellps=clrk80 +towgs84=-160,-6,-302,0,0,0,0 +units=m +no_defs',
    extent: [120000, 9800000, 480000, 10000000],
    useCase: 'Cadastral surveys (SoK standard per Cap 299)',
  },
  {
    epsg: 2038,
    name: 'Arc 1960 / Cassini-Soldner Kenya (Nairobi)',
    proj4: '+proj=cass +lat_0=-1 +lon_0=36.45 +x_0=300000 +y_0=0 +ellps=clrk80 +towgs84=-160,-6,-302,0,0,0,0 +units=m +no_defs',
    extent: [120000, 9800000, 480000, 10000000],
    useCase: 'Cadastral surveys in Nairobi region',
  },
];
