/**
 * SoK Map Layer Registry — Survey of Kenya compliant map layers
 *
 * Provides the layer hierarchy, symbology, and projection support that the
 * walking-skeleton MapView was missing.
 *
 * Layers (per SoK Drafting Manual 2020 + DXF Layer Registry):
 *   BASEMAP     — OSM / satellite / cadastre overlay
 *   GRID        — Coordinate grid (Cassini-Soldner or UTM)
 *   GRATICULE   — Lat/lon graticule
 *   CONTROL     — Survey control points (1st/2nd/3rd order)
 *   PARCEL_BDY  — Cadastral parcel boundaries (fixed vs general)
 *   BEACONS     — Survey beacons (concrete, iron pin, stone, ref obj)
 *   TRAVERSE    — Traverse legs + stations
 *   TOPO_POINTS — Topographic detail points (coded by feature code)
 *   BREAKLINES  — TIN breaklines
 *   CONTOURS    — Contour lines (index + intermediate)
 *   SPOT_HEIGHTS — Spot heights with elevation labels
 *   BUILDINGS   — Building footprints
 *   ROADS       — Road edges + centerlines
 *   WATER       — Rivers, lakes, streams
 *   VEGETATION  — Woodland, scrub, cultivated
 *   UTILITIES   — Power lines, pipelines, sewers
 *   ALIGNMENT   — Road alignment (chainage, IP, curves)
 *   CROSS_SECT  — Cross-section locations
 *   EARTHWORKS  — Cut/fill areas
 *   PAP_PARCELS — Wayleave affected parcels (color by status)
 *   CORRIDOR    — Wayleave corridor centerline + width
 *   ANNOTATION  — Text labels
 *   SCALE_BAR   — Scale bar (segmented)
 *   NORTH_ARROW — North arrow with grid convergence
 *   TITLE_BLOCK — SoK standard title block
 *
 * Projections supported:
 *   EPSG:3857  — Web Mercator (for online basemaps)
 *   EPSG:4326  — WGS84 lat/lon
 *   EPSG:21037 — Arc 1960 UTM Zone 37S (Kenya)
 *   EPSG:21036 — Arc 1960 UTM Zone 36S (Kenya)
 *   EPSG:20437 — Arc 1960 / Cassini-Soldner Kenya (per SoK)
 *
 * Map sheet series (Y717):
 *   1:50000 — Kenya national topographical series
 *   Sheet naming: sheet number + edition (e.g. "NAIROBI SOUTH 148/4")
 */

// ─── Layer Definitions ─────────────────────────────────────────────────

export type MapLayerId =
  | 'basemap_osm'
  | 'basemap_satellite'
  | 'basemap_offline'
  | 'grid_cassini'
  | 'grid_utm'
  | 'graticule'
  | 'control'
  | 'parcel_boundary'
  | 'parcel_boundary_fixed'
  | 'parcel_boundary_general'
  | 'beacons'
  | 'traverse'
  | 'traverse_legs'
  | 'traverse_stations'
  | 'topo_points'
  | 'breaklines'
  | 'contours_index'
  | 'contours_intermediate'
  | 'spot_heights'
  | 'buildings'
  | 'roads'
  | 'road_edges'
  | 'road_centerlines'
  | 'water'
  | 'rivers'
  | 'lakes'
  | 'streams'
  | 'vegetation'
  | 'woodland'
  | 'scrub'
  | 'cultivated'
  | 'utilities'
  | 'power_lines'
  | 'pipelines'
  | 'sewers'
  | 'alignment'
  | 'alignment_centerline'
  | 'alignment_chainage'
  | 'alignment_curves'
  | 'cross_sections'
  | 'earthworks_cut'
  | 'earthworks_fill'
  | 'pap_parcels'
  | 'corridor'
  | 'annotation'
  | 'scale_bar'
  | 'north_arrow'
  | 'title_block';

export interface LayerSpec {
  id: MapLayerId;
  label: string;
  category: LayerCategory;
  visible: boolean;
  opacity: number;
  minZoom?: number;
  maxZoom?: number;
  symbology: SymbologySpec;
  sourceLayer?: string;  // for tiled/vector sources
}

export type LayerCategory =
  | 'basemap'
  | 'grid'
  | 'control'
  | 'cadastral'
  | 'topographic'
  | 'engineering'
  | 'wayleave'
  | 'decoration';

export interface SymbologySpec {
  // Point symbology
  pointShape?: 'circle' | 'square' | 'triangle' | 'cross' | 'diamond' | 'star';
  pointColor?: string;
  pointSize?: number;
  pointStrokeColor?: string;
  pointStrokeWidth?: number;
  // Line symbology
  lineColor?: string;
  lineWidth?: number;
  lineStyle?: 'solid' | 'dashed' | 'dotted' | 'dash-dot';
  // Polygon symbology
  fillColor?: string;
  fillOpacity?: number;
  polygonStrokeColor?: string;
  polygonStrokeWidth?: number;
  // Hatch (for road reserves, water, etc.)
  hatchPattern?: 'diagonal' | 'cross' | 'horizontal' | 'vertical' | 'none';
  // Label
  labelField?: string;
  labelFont?: string;
  labelSize?: number;
  labelColor?: string;
  labelBackgroundColor?: string;
  labelOffset?: [number, number];
  // Min zoom to show label
  labelMinZoom?: number;
}

// ─── SoK Standard Symbology ────────────────────────────────────────────

const SOK_COLORS = {
  black: '#000000',
  red: '#CC0000',
  blue: '#0066CC',
  green: '#008800',
  brown: '#8B4513',
  grey: '#666666',
  cyan: '#00CCCC',
  magenta: '#CC00CC',
  orange: '#D97706',
  navy: '#0B2545',
  white: '#FFFFFF',
  // SoK standard
  boundaryFixed: '#000000',     // black
  boundaryGeneral: '#666666',   // grey
  water: '#0066CC',              // blue
  vegetation: '#008800',         // green
  contour: '#8B4513',            // brown
  contourIndex: '#5C2D0C',      // dark brown
  road: '#000000',               // black
  building: '#333333',           // dark grey
  control: '#CC0000',            // red
  beacons: '#000000',            // black
  cut: '#CC0000',                // red (cut areas)
  fill: '#0066CC',               // blue (fill areas)
  corridor: '#CC00CC',           // magenta (wayleave)
};

export const SOK_LAYERS: Record<MapLayerId, LayerSpec> = {
  // Basemaps
  basemap_osm: {
    id: 'basemap_osm', label: 'OpenStreetMap', category: 'basemap',
    visible: true, opacity: 0.7,
    symbology: {},
  },
  basemap_satellite: {
    id: 'basemap_satellite', label: 'Satellite Imagery', category: 'basemap',
    visible: false, opacity: 0.8,
    symbology: {},
  },
  basemap_offline: {
    id: 'basemap_offline', label: 'Offline Tiles (mbtiles)', category: 'basemap',
    visible: false, opacity: 1.0,
    symbology: {},
  },

  // Grids
  grid_cassini: {
    id: 'grid_cassini', label: 'Cassini-Soldner Grid', category: 'grid',
    visible: true, opacity: 0.5, minZoom: 14,
    symbology: {
      lineColor: SOK_COLORS.grey, lineWidth: 0.5, lineStyle: 'dashed',
      labelField: 'grid_label', labelSize: 9, labelColor: SOK_COLORS.grey,
    },
  },
  grid_utm: {
    id: 'grid_utm', label: 'UTM Grid', category: 'grid',
    visible: true, opacity: 0.5, minZoom: 14,
    symbology: {
      lineColor: SOK_COLORS.navy, lineWidth: 0.5, lineStyle: 'dashed',
      labelField: 'grid_label', labelSize: 9, labelColor: SOK_COLORS.navy,
    },
  },
  graticule: {
    id: 'graticule', label: 'Lat/Lon Graticule', category: 'grid',
    visible: false, opacity: 0.4, minZoom: 8,
    symbology: {
      lineColor: SOK_COLORS.grey, lineWidth: 0.3, lineStyle: 'dotted',
      labelField: 'lat_lon_label', labelSize: 8, labelColor: SOK_COLORS.grey,
    },
  },

  // Control
  control: {
    id: 'control', label: 'Control Points', category: 'control',
    visible: true, opacity: 1.0,
    symbology: {
      pointShape: 'triangle', pointColor: SOK_COLORS.control, pointSize: 8,
      pointStrokeColor: SOK_COLORS.black, pointStrokeWidth: 1,
      labelField: 'point_number', labelSize: 10, labelColor: SOK_COLORS.control,
      labelBackgroundColor: SOK_COLORS.white, labelOffset: [8, -8],
    },
  },

  // Cadastral
  parcel_boundary: {
    id: 'parcel_boundary', label: 'Parcel Boundaries (All)', category: 'cadastral',
    visible: true, opacity: 1.0,
    symbology: {
      lineColor: SOK_COLORS.black, lineWidth: 1.5,
      labelField: 'parcel_number', labelSize: 9, labelColor: SOK_COLORS.black,
    },
  },
  parcel_boundary_fixed: {
    id: 'parcel_boundary_fixed', label: 'Fixed Boundaries (Legally Binding)', category: 'cadastral',
    visible: true, opacity: 1.0,
    symbology: {
      lineColor: SOK_COLORS.boundaryFixed, lineWidth: 1.5, lineStyle: 'solid',
    },
  },
  parcel_boundary_general: {
    id: 'parcel_boundary_general', label: 'General Boundaries (Indicative)', category: 'cadastral',
    visible: true, opacity: 1.0,
    symbology: {
      lineColor: SOK_COLORS.boundaryGeneral, lineWidth: 1.0, lineStyle: 'dashed',
    },
  },
  beacons: {
    id: 'beacons', label: 'Survey Beacons', category: 'cadastral',
    visible: true, opacity: 1.0, minZoom: 16,
    symbology: {
      pointShape: 'circle', pointColor: SOK_COLORS.beacons, pointSize: 6,
      pointStrokeColor: SOK_COLORS.black, pointStrokeWidth: 1,
      labelField: 'beacon_number', labelSize: 8, labelColor: SOK_COLORS.black,
      labelOffset: [4, -4],
    },
  },

  // Traverse
  traverse: {
    id: 'traverse', label: 'Traverse', category: 'control',
    visible: true, opacity: 1.0,
    symbology: {
      lineColor: SOK_COLORS.red, lineWidth: 1.0, lineStyle: 'solid',
    },
  },
  traverse_legs: {
    id: 'traverse_legs', label: 'Traverse Legs', category: 'control',
    visible: true, opacity: 1.0,
    symbology: {
      lineColor: SOK_COLORS.red, lineWidth: 1.0, lineStyle: 'solid',
      labelField: 'bearing_distance', labelSize: 8, labelColor: SOK_COLORS.red,
    },
  },
  traverse_stations: {
    id: 'traverse_stations', label: 'Traverse Stations', category: 'control',
    visible: true, opacity: 1.0,
    symbology: {
      pointShape: 'circle', pointColor: SOK_COLORS.red, pointSize: 5,
      pointStrokeColor: SOK_COLORS.black, pointStrokeWidth: 1,
      labelField: 'station_name', labelSize: 9, labelColor: SOK_COLORS.red,
    },
  },

  // Topographic
  topo_points: {
    id: 'topo_points', label: 'Topo Points', category: 'topographic',
    visible: true, opacity: 0.8, minZoom: 17,
    symbology: {
      pointShape: 'circle', pointColor: SOK_COLORS.brown, pointSize: 3,
      labelField: 'code', labelSize: 7, labelColor: SOK_COLORS.brown,
      labelMinZoom: 19,
    },
  },
  breaklines: {
    id: 'breaklines', label: 'Breaklines', category: 'topographic',
    visible: true, opacity: 0.7, minZoom: 16,
    symbology: {
      lineColor: SOK_COLORS.brown, lineWidth: 0.8, lineStyle: 'solid',
    },
  },
  contours_index: {
    id: 'contours_index', label: 'Index Contours', category: 'topographic',
    visible: true, opacity: 0.9, minZoom: 13,
    symbology: {
      lineColor: SOK_COLORS.contourIndex, lineWidth: 0.8, lineStyle: 'solid',
      labelField: 'elevation', labelSize: 8, labelColor: SOK_COLORS.contourIndex,
    },
  },
  contours_intermediate: {
    id: 'contours_intermediate', label: 'Intermediate Contours', category: 'topographic',
    visible: true, opacity: 0.6, minZoom: 15,
    symbology: {
      lineColor: SOK_COLORS.contour, lineWidth: 0.3, lineStyle: 'solid',
    },
  },
  spot_heights: {
    id: 'spot_heights', label: 'Spot Heights', category: 'topographic',
    visible: true, opacity: 0.9, minZoom: 15,
    symbology: {
      pointShape: 'cross', pointColor: SOK_COLORS.brown, pointSize: 5,
      labelField: 'elevation', labelSize: 8, labelColor: SOK_COLORS.brown,
      labelOffset: [4, -4],
    },
  },
  buildings: {
    id: 'buildings', label: 'Buildings', category: 'topographic',
    visible: true, opacity: 1.0, minZoom: 15,
    symbology: {
      fillColor: SOK_COLORS.building, fillOpacity: 0.4,
      polygonStrokeColor: SOK_COLORS.black, polygonStrokeWidth: 0.8,
    },
  },
  roads: {
    id: 'roads', label: 'Roads', category: 'topographic',
    visible: true, opacity: 1.0, minZoom: 13,
    symbology: {
      lineColor: SOK_COLORS.road, lineWidth: 1.5, lineStyle: 'solid',
    },
  },
  road_edges: {
    id: 'road_edges', label: 'Road Edges', category: 'topographic',
    visible: true, opacity: 0.9, minZoom: 15,
    symbology: {
      lineColor: SOK_COLORS.road, lineWidth: 1.0, lineStyle: 'solid',
    },
  },
  road_centerlines: {
    id: 'road_centerlines', label: 'Road Centerlines', category: 'topographic',
    visible: false, opacity: 0.7, minZoom: 14,
    symbology: {
      lineColor: SOK_COLORS.grey, lineWidth: 0.5, lineStyle: 'dashed',
    },
  },
  water: {
    id: 'water', label: 'Water Features', category: 'topographic',
    visible: true, opacity: 1.0, minZoom: 12,
    symbology: {
      fillColor: SOK_COLORS.water, fillOpacity: 0.4,
      lineColor: SOK_COLORS.water, lineWidth: 1.0, lineStyle: 'solid',
    },
  },
  rivers: {
    id: 'rivers', label: 'Rivers', category: 'topographic',
    visible: true, opacity: 0.9, minZoom: 12,
    symbology: {
      lineColor: SOK_COLORS.water, lineWidth: 1.5, lineStyle: 'solid',
    },
  },
  lakes: {
    id: 'lakes', label: 'Lakes', category: 'topographic',
    visible: true, opacity: 0.9, minZoom: 10,
    symbology: {
      fillColor: SOK_COLORS.water, fillOpacity: 0.5,
      polygonStrokeColor: SOK_COLORS.water, polygonStrokeWidth: 1.0,
    },
  },
  streams: {
    id: 'streams', label: 'Streams', category: 'topographic',
    visible: true, opacity: 0.7, minZoom: 14,
    symbology: {
      lineColor: SOK_COLORS.water, lineWidth: 0.5, lineStyle: 'solid',
    },
  },
  vegetation: {
    id: 'vegetation', label: 'Vegetation', category: 'topographic',
    visible: true, opacity: 0.7, minZoom: 13,
    symbology: {
      fillColor: SOK_COLORS.vegetation, fillOpacity: 0.3,
      polygonStrokeColor: SOK_COLORS.vegetation, polygonStrokeWidth: 0.5,
    },
  },
  woodland: {
    id: 'woodland', label: 'Woodland', category: 'topographic',
    visible: true, opacity: 0.6, minZoom: 13,
    symbology: {
      fillColor: SOK_COLORS.vegetation, fillOpacity: 0.4,
      hatchPattern: 'diagonal',
    },
  },
  scrub: {
    id: 'scrub', label: 'Scrub', category: 'topographic',
    visible: false, opacity: 0.5, minZoom: 14,
    symbology: {
      fillColor: SOK_COLORS.vegetation, fillOpacity: 0.2,
      hatchPattern: 'horizontal',
    },
  },
  cultivated: {
    id: 'cultivated', label: 'Cultivated Land', category: 'topographic',
    visible: false, opacity: 0.5, minZoom: 14,
    symbology: {
      fillColor: '#AA8833', fillOpacity: 0.3,
      hatchPattern: 'cross',
    },
  },

  // Utilities
  utilities: {
    id: 'utilities', label: 'Utilities', category: 'topographic',
    visible: false, opacity: 0.8, minZoom: 14,
    symbology: {
      lineColor: SOK_COLORS.magenta, lineWidth: 0.5, lineStyle: 'dash-dot',
    },
  },
  power_lines: {
    id: 'power_lines', label: 'Power Lines', category: 'topographic',
    visible: false, opacity: 0.8, minZoom: 13,
    symbology: {
      lineColor: SOK_COLORS.magenta, lineWidth: 0.8, lineStyle: 'dash-dot',
    },
  },
  pipelines: {
    id: 'pipelines', label: 'Pipelines', category: 'topographic',
    visible: false, opacity: 0.8, minZoom: 13,
    symbology: {
      lineColor: SOK_COLORS.orange, lineWidth: 0.8, lineStyle: 'dashed',
    },
  },
  sewers: {
    id: 'sewers', label: 'Sewers', category: 'topographic',
    visible: false, opacity: 0.8, minZoom: 15,
    symbology: {
      lineColor: SOK_COLORS.green, lineWidth: 0.8, lineStyle: 'dashed',
    },
  },

  // Engineering
  alignment: {
    id: 'alignment', label: 'Road Alignment', category: 'engineering',
    visible: true, opacity: 1.0, minZoom: 12,
    symbology: {
      lineColor: SOK_COLORS.red, lineWidth: 1.5, lineStyle: 'solid',
    },
  },
  alignment_centerline: {
    id: 'alignment_centerline', label: 'Alignment Centerline', category: 'engineering',
    visible: true, opacity: 1.0, minZoom: 12,
    symbology: {
      lineColor: SOK_COLORS.red, lineWidth: 1.5, lineStyle: 'solid',
    },
  },
  alignment_chainage: {
    id: 'alignment_chainage', label: 'Chainage Markers', category: 'engineering',
    visible: true, opacity: 1.0, minZoom: 14,
    symbology: {
      pointShape: 'square', pointColor: SOK_COLORS.red, pointSize: 5,
      labelField: 'chainage', labelSize: 8, labelColor: SOK_COLORS.red,
      labelOffset: [5, -5],
    },
  },
  alignment_curves: {
    id: 'alignment_curves', label: 'Curve Elements', category: 'engineering',
    visible: true, opacity: 0.8, minZoom: 14,
    symbology: {
      lineColor: SOK_COLORS.magenta, lineWidth: 1.0, lineStyle: 'dashed',
      labelField: 'radius', labelSize: 8, labelColor: SOK_COLORS.magenta,
    },
  },
  cross_sections: {
    id: 'cross_sections', label: 'Cross-Section Lines', category: 'engineering',
    visible: false, opacity: 0.7, minZoom: 15,
    symbology: {
      lineColor: SOK_COLORS.cyan, lineWidth: 0.8, lineStyle: 'solid',
      labelField: 'chainage', labelSize: 7, labelColor: SOK_COLORS.cyan,
    },
  },
  earthworks_cut: {
    id: 'earthworks_cut', label: 'Cut Areas', category: 'engineering',
    visible: false, opacity: 0.6, minZoom: 14,
    symbology: {
      fillColor: SOK_COLORS.cut, fillOpacity: 0.3,
      hatchPattern: 'diagonal',
    },
  },
  earthworks_fill: {
    id: 'earthworks_fill', label: 'Fill Areas', category: 'engineering',
    visible: false, opacity: 0.6, minZoom: 14,
    symbology: {
      fillColor: SOK_COLORS.fill, fillOpacity: 0.3,
      hatchPattern: 'horizontal',
    },
  },

  // Wayleave
  pap_parcels: {
    id: 'pap_parcels', label: 'PAP Parcels (Color by Status)', category: 'wayleave',
    visible: true, opacity: 0.7, minZoom: 12,
    symbology: {
      fillColor: SOK_COLORS.orange, fillOpacity: 0.4,
      polygonStrokeColor: SOK_COLORS.black, polygonStrokeWidth: 0.8,
      labelField: 'parcel_number', labelSize: 8, labelColor: SOK_COLORS.black,
    },
  },
  corridor: {
    id: 'corridor', label: 'Wayleave Corridor', category: 'wayleave',
    visible: true, opacity: 0.6, minZoom: 11,
    symbology: {
      fillColor: SOK_COLORS.corridor, fillOpacity: 0.15,
      lineColor: SOK_COLORS.corridor, lineWidth: 1.0, lineStyle: 'dashed',
    },
  },

  // Decoration
  annotation: {
    id: 'annotation', label: 'Text Annotations', category: 'decoration',
    visible: true, opacity: 1.0,
    symbology: {
      labelField: 'text', labelSize: 10, labelColor: SOK_COLORS.black,
      labelBackgroundColor: SOK_COLORS.white,
    },
  },
  scale_bar: {
    id: 'scale_bar', label: 'Scale Bar', category: 'decoration',
    visible: true, opacity: 1.0,
    symbology: {},
  },
  north_arrow: {
    id: 'north_arrow', label: 'North Arrow', category: 'decoration',
    visible: true, opacity: 1.0,
    symbology: {},
  },
  title_block: {
    id: 'title_block', label: 'Title Block', category: 'decoration',
    visible: true, opacity: 1.0,
    symbology: {},
  },
};

// ─── PAP Status Color Mapping ──────────────────────────────────────────

export const PAP_STATUS_COLORS: Record<string, string> = {
  pending_survey: '#999999',
  pending_valuation: '#FFA500',
  valued: '#FFD700',
  offer_made: '#1E90FF',
  offer_accepted: '#0066CC',
  offer_rejected: '#FF4500',
  paid: '#008800',
  disputed: '#CC0000',
};

export function getPapStatusColor(status: string): string {
  return PAP_STATUS_COLORS[status] ?? SOK_COLORS.orange;
}

// ─── Beacon Type Symbology ─────────────────────────────────────────────

export interface BeaconSymbology {
  shape: 'circle' | 'square' | 'triangle' | 'diamond';
  color: string;
  size: number;
  label: string;
}

export const BEACON_SYMBOLOGY: Record<string, BeaconSymbology> = {
  concrete: { shape: 'circle', color: '#000000', size: 6, label: 'Concrete Beacon' },
  iron_pin: { shape: 'square', color: '#000000', size: 5, label: 'Iron Pin' },
  stone: { shape: 'triangle', color: '#000000', size: 6, label: 'Stone Beacon' },
  reference_object: { shape: 'diamond', color: '#666666', size: 5, label: 'Reference Object' },
  pipe: { shape: 'circle', color: '#0066CC', size: 5, label: 'Iron Pipe' },
  natural: { shape: 'cross', color: '#008800', size: 5, label: 'Natural Feature' },
};

export function getBeaconSymbology(beaconType: string): BeaconSymbology {
  return BEACON_SYMBOLOGY[beaconType] ?? BEACON_SYMBOLOGY.concrete;
}

// ─── Control Point Symbology (by order) ────────────────────────────────

export interface ControlSymbology {
  shape: 'triangle' | 'circle' | 'square';
  color: string;
  size: number;
  label: string;
}

export const CONTROL_SYMBOLOGY: Record<string, ControlSymbology> = {
  zero: { shape: 'triangle', color: '#CC0000', size: 10, label: 'Zero Order (Geodetic)' },
  first: { shape: 'triangle', color: '#CC0000', size: 8, label: 'First Order (Primary)' },
  second: { shape: 'circle', color: '#CC0000', size: 6, label: 'Second Order (Secondary)' },
  third: { shape: 'circle', color: '#CC0000', size: 5, label: 'Third Order (Tertiary)' },
};

export function getControlSymbology(order: string): ControlSymbology {
  return CONTROL_SYMBOLOGY[order] ?? CONTROL_SYMBOLOGY.third;
}

// ─── Kenya Projections ─────────────────────────────────────────────────

export interface ProjectionSpec {
  epsg: number;
  name: string;
  proj4: string;
  extent: [number, number, number, number];  // [minE, minN, maxE, maxN]
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

export function getProjection(epsg: number): ProjectionSpec | undefined {
  return KENYA_PROJECTIONS.find(p => p.epsg === epsg);
}

// ─── Map Sheet Layout (Y717 Series) ────────────────────────────────────

export interface MapSheetSpec {
  scale: string;
  scaleDenominator: number;
  sheetSize: { widthMM: number; heightMM: number };
  sheetExtent: { widthM: number; heightM: number };  // ground coverage
  marginMm: { top: number; right: number; bottom: number; left: number };
  titleBlockMm: { width: number; height: number; position: 'bottom-right' };
  seriesPrefix: string;
  exampleSheet: string;
}

export const Y717_MAP_SHEETS: MapSheetSpec[] = [
  {
    scale: '1:50000',
    scaleDenominator: 50000,
    sheetSize: { widthMM: 600, heightMM: 600 },
    sheetExtent: { widthM: 30000, heightM: 30000 },
    marginMm: { top: 10, right: 10, bottom: 10, left: 10 },
    titleBlockMm: { width: 180, height: 80, position: 'bottom-right' },
    seriesPrefix: 'Y717',
    exampleSheet: 'NAIROBI SOUTH 148/4',
  },
  {
    scale: '1:25000',
    scaleDenominator: 25000,
    sheetSize: { widthMM: 600, heightMM: 600 },
    sheetExtent: { widthM: 15000, heightM: 15000 },
    marginMm: { top: 10, right: 10, bottom: 10, left: 10 },
    titleBlockMm: { width: 180, height: 80, position: 'bottom-right' },
    seriesPrefix: 'Y717/25',
    exampleSheet: 'NAIROBI SOUTH 148/4 NE',
  },
  {
    scale: '1:10000',
    scaleDenominator: 10000,
    sheetSize: { widthMM: 600, heightMM: 600 },
    sheetExtent: { widthM: 6000, heightM: 6000 },
    marginMm: { top: 10, right: 10, bottom: 10, left: 10 },
    titleBlockMm: { width: 180, height: 80, position: 'bottom-right' },
    seriesPrefix: 'Y717/10',
    exampleSheet: 'NAIROBI SOUTH 148/4 NE/3',
  },
];

// ─── Grid Overlay Configuration ────────────────────────────────────────

export interface GridConfig {
  type: 'cassini' | 'utm';
  intervalM: number;       // grid spacing in metres
  labelInterval: number;   // label every Nth line
  majorLineStyle: string;
  minorLineStyle: string;
  labelFormat: (eastingOrNorthing: number, isEasting: boolean) => string;
}

export const GRID_CONFIGS: Record<string, GridConfig> = {
  // Standard UTM 1km grid for 1:50000
  utm_1km: {
    type: 'utm',
    intervalM: 1000,
    labelInterval: 1,
    majorLineStyle: 'solid',
    minorLineStyle: 'dashed',
    labelFormat: (v, isE) => `${isE ? 'E' : 'N'} ${(v / 1000).toFixed(0)}k`,
  },
  // UTM 100m grid for 1:5000
  utm_100m: {
    type: 'utm',
    intervalM: 100,
    labelInterval: 5,
    majorLineStyle: 'solid',
    minorLineStyle: 'dotted',
    labelFormat: (v, isE) => `${isE ? 'E' : 'N'} ${v.toFixed(0)}`,
  },
  // Cassini 1km grid for cadastral
  cassini_1km: {
    type: 'cassini',
    intervalM: 1000,
    labelInterval: 1,
    majorLineStyle: 'solid',
    minorLineStyle: 'dashed',
    labelFormat: (v, isE) => `${isE ? 'E' : 'N'} ${(v / 1000).toFixed(0)}k`,
  },
  // Cassini 100m grid for cadastral detail
  cassini_100m: {
    type: 'cassini',
    intervalM: 100,
    labelInterval: 5,
    majorLineStyle: 'solid',
    minorLineStyle: 'dotted',
    labelFormat: (v, isE) => `${isE ? 'E' : 'N'} ${v.toFixed(0)}`,
  },
};

// ─── Measurement Tools ─────────────────────────────────────────────────

export type MeasurementType = 'distance' | 'area' | 'bearing' | 'coordinate';

export interface MeasurementResult {
  type: MeasurementType;
  value: number;
  unit: string;
  formatted: string;
  points: Array<{ easting: number; northing: number }>;
  bearings?: Array<{ from: number; to: number; bearing: number; distance: number }>;
}

export function calculateDistance(p1: { easting: number; northing: number }, p2: { easting: number; northing: number }): number {
  return Math.sqrt(Math.pow(p2.easting - p1.easting, 2) + Math.pow(p2.northing - p1.northing, 2));
}

export function calculateBearing(p1: { easting: number; northing: number }, p2: { easting: number; northing: number }): number {
  const deltaE = p2.easting - p1.easting;
  const deltaN = p2.northing - p1.northing;
  const bearing = Math.atan2(deltaE, deltaN) * 180 / Math.PI;
  return (bearing + 360) % 360;
}

export function calculateArea(points: Array<{ easting: number; northing: number }>): number {
  // Shoelace formula
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    sum += points[i].easting * points[j].northing;
    sum -= points[j].easting * points[i].northing;
  }
  return Math.abs(sum / 2);
}

export function formatBearing(deg: number): string {
  const d = Math.floor(deg);
  const minFloat = (deg - d) * 60;
  const m = Math.floor(minFloat);
  const s = (minFloat - m) * 60;
  return `${String(d).padStart(3, '0')}°${String(m).padStart(2, '0')}'${s.toFixed(2).padStart(5, '0')}"`;
}

export function formatDistance(m: number): string {
  if (m < 1) return `${(m * 1000).toFixed(0)} mm`;
  if (m < 1000) return `${m.toFixed(3)} m`;
  return `${(m / 1000).toFixed(3)} km`;
}

export function formatArea(sqM: number): string {
  if (sqM < 10000) return `${sqM.toFixed(3)} m²`;
  return `${(sqM / 10000).toFixed(4)} ha (${(sqM / 4046.8564224).toFixed(4)} acres)`;
}

export function measureDistance(points: Array<{ easting: number; northing: number }>): MeasurementResult {
  if (points.length < 2) {
    return { type: 'distance', value: 0, unit: 'm', formatted: '0 m', points };
  }
  let total = 0;
  const bearings: any[] = [];
  for (let i = 1; i < points.length; i++) {
    const d = calculateDistance(points[i - 1], points[i]);
    const b = calculateBearing(points[i - 1], points[i]);
    total += d;
    bearings.push({ from: i - 1, to: i, bearing: b, distance: d });
  }
  return {
    type: 'distance',
    value: total,
    unit: 'm',
    formatted: formatDistance(total),
    points,
    bearings,
  };
}

export function measureArea(points: Array<{ easting: number; northing: number }>): MeasurementResult {
  const area = calculateArea(points);
  return {
    type: 'area',
    value: area,
    unit: 'm²',
    formatted: formatArea(area),
    points,
  };
}

export function measureBearing(p1: { easting: number; northing: number }, p2: { easting: number; northing: number }): MeasurementResult {
  const b = calculateBearing(p1, p2);
  const d = calculateDistance(p1, p2);
  return {
    type: 'bearing',
    value: b,
    unit: '°',
    formatted: `${formatBearing(b)} (${formatDistance(d)})`,
    points: [p1, p2],
  };
}

// ─── Scale Bar Generation ──────────────────────────────────────────────

export interface ScaleBarSegment {
  lengthM: number;
  label: string;
  isMajor: boolean;
}

export function generateScaleBar(scaleDenominator: number, paperWidthMM: number = 100): {
  totalLengthM: number;
  segments: ScaleBarSegment[];
  scaleText: string;
} {
  // Target: scale bar should be ~100mm wide on paper
  const totalLengthM = paperWidthMM * scaleDenominator / 1000;

  // Choose a "nice" round number
  const magnitude = Math.pow(10, Math.floor(Math.log10(totalLengthM)));
  const normalized = totalLengthM / magnitude;
  let niceLength: number;
  if (normalized < 1.5) niceLength = 1 * magnitude;
  else if (normalized < 3.5) niceLength = 2 * magnitude;
  else if (normalized < 7.5) niceLength = 5 * magnitude;
  else niceLength = 10 * magnitude;

  // 4 segments
  const segmentLength = niceLength / 4;
  const segments: ScaleBarSegment[] = [];
  for (let i = 0; i < 4; i++) {
    const lengthM = segmentLength;
    let label: string;
    if (lengthM >= 1000) label = `${(lengthM / 1000).toFixed(0)} km`;
    else label = `${lengthM.toFixed(0)} m`;
    segments.push({ lengthM, label, isMajor: i % 2 === 0 });
  }

  const scaleText = `1:${scaleDenominator.toLocaleString()}`;

  return { totalLengthM: niceLength, segments, scaleText };
}

// ─── Layer Visibility Helper ───────────────────────────────────────────

export function getLayersByCategory(category: LayerCategory): LayerSpec[] {
  return Object.values(SOK_LAYERS).filter(l => l.category === category);
}

export function getDefaultVisibleLayers(): MapLayerId[] {
  return Object.values(SOK_LAYERS).filter(l => l.visible).map(l => l.id);
}

export function getLayersForSurveyType(surveyType: 'cadastral' | 'engineering' | 'topographical' | 'wayleave'): MapLayerId[] {
  const commonBase: MapLayerId[] = ['basemap_osm', 'control', 'annotation', 'scale_bar', 'north_arrow', 'title_block'];
  switch (surveyType) {
    case 'cadastral':
      return [...commonBase, 'grid_cassini', 'parcel_boundary_fixed', 'parcel_boundary_general', 'beacons', 'traverse_legs', 'traverse_stations'];
    case 'engineering':
      return [...commonBase, 'grid_utm', 'alignment_centerline', 'alignment_chainage', 'alignment_curves', 'cross_sections', 'earthworks_cut', 'earthworks_fill'];
    case 'topographical':
      return [...commonBase, 'grid_utm', 'topo_points', 'breaklines', 'contours_index', 'contours_intermediate', 'spot_heights', 'buildings', 'roads', 'rivers', 'lakes', 'vegetation'];
    case 'wayleave':
      return [...commonBase, 'grid_utm', 'corridor', 'pap_parcels', 'parcel_boundary'];
  }
}
