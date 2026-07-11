/**
 * METARDU — Feature Code System & DXF Layer Mapping
 *
 * Comprehensive feature code library for Kenya / East Africa topographic surveys.
 * Each code maps to a DXF layer with AutoCAD Color Index (ACI), line type,
 * point symbol, and auto-join behaviour for polyline generation.
 *
 * Reference standards:
 *   - Survey of Kenya Topographic Mapping Standards
 *   - ASPRS Guidelines for Digital Topographic Surveys (2023)
 *   - OGC Simple Features Specification (ISO 19125)
 *   - Survey Act Cap 299 (Revised 2022), Kenya
 *   - Survey Regulations 1994
 */

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type FeatureCategory =
  | 'boundary'
  | 'structure'
  | 'transportation'
  | 'utilities'
  | 'hydrography'
  | 'vegetation'
  | 'relief'
  | 'control'
  | 'furniture'
  | 'other';

export type DXFLineType =
  | 'CONTINUOUS'
  | 'DASHED'
  | 'DOTTED'
  | 'CENTER'
  | 'PHANTOM';

export type PointSymbol =
  | 'circle'
  | 'square'
  | 'triangle'
  | 'cross'
  | 'diamond'
  | 'none';

/**
 * Full definition for a single feature code.
 */
export interface FeatureCodeDef {
  /** Short code e.g. "RD", "BLD", "TL" */
  code: string;
  /** Human-readable description */
  description: string;
  /** Category for grouping and filtering */
  category: FeatureCategory;
  /** DXF layer name — used as the AutoCAD layer */
  dxfLayer: string;
  /** AutoCAD Color Index (ACI) — 1-255 */
  color: number;
  /** DXF line type for polylines / lines */
  lineType: DXFLineType;
  /** Point marker symbol drawn at each point */
  symbol: PointSymbol;
  /** Auto-join sequential points with same code into a polyline */
  joinLines: boolean;
  /** Show point label (e.g. point number / RL) in DXF */
  pointLabel: boolean;
  /** Minimum map scale denominator to display this feature (e.g. 1000 = 1:1000) */
  minScale: number;
  /** Reference standard this code follows */
  standard: string;
}

/**
 * A named group of related feature codes, used for UI display.
 */
export interface FeatureCodeGroup {
  /** Display name for the group */
  name: string;
  /** Category key */
  category: FeatureCategory;
  /** Codes belonging to this group */
  codes: FeatureCodeDef[];
}

/**
 * A survey point that carries a feature code.
 *
 * Re-exported from the canonical `SurveyPointWithCode` interface. New code
 * should import from `@/types/surveyPoint` directly.
 */
export type { SurveyPointWithCode } from '@/types/surveyPoint'

// Re-export for internal use within this module
import type { SurveyPointWithCode } from '@/types/surveyPoint'


/**
 * Coordinate pair used in polyline vertex arrays.
 */
export interface Coordinate {
  e: number;
  n: number;
}

/**
 * Result of mapping classified survey points to DXF layers.
 */
export interface LayerMappingResult {
  /** DXF layer name */
  layer: string;
  /** ACI color */
  color: number;
  /** DXF line type */
  lineType: string;
  /** Individual points on this layer */
  points: Array<{
    e: number;
    n: number;
    z?: number;
    label?: string;
  }>;
  /** Polylines (joined sequential points with same code) */
  polylines: Coordinate[][];
}

// ─────────────────────────────────────────────────────────────────────────────
// REFERENCE STANDARDS
// ─────────────────────────────────────────────────────────────────────────────

const STD = {
  SK: 'Survey of Kenya Topographic Mapping Standards',
  ASPRS: 'ASPRS Guidelines 2023',
  OGC: 'OGC Simple Features (ISO 19125)',
  /** Combined Kenya reference */
  KENYA: 'Survey Act Cap 299; Survey Regulations 1994',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE CODE PRESET — Kenya / East Africa Topographic Surveys
// ─────────────────────────────────────────────────────────────────────────────

export const KENYA_TOPO_CODES: FeatureCodeDef[] = [
  // ── BOUNDARY (5 codes) ─────────────────────────────────────────────────────
  {
    code: 'BND',
    description: 'Cadastral Boundary',
    category: 'boundary',
    dxfLayer: 'BOUNDARY-CADASTRAL',
    color: 7,          // white
    lineType: 'DASHED',
    symbol: 'none',
    joinLines: true,
    pointLabel: true,
    minScale: 500,
    standard: STD.KENYA,
  },
  {
    code: 'BND-PP',
    description: 'Property Pillar / Beacon',
    category: 'boundary',
    dxfLayer: 'BOUNDARY-PILLAR',
    color: 7,
    lineType: 'CONTINUOUS',
    symbol: 'square',
    joinLines: true,
    pointLabel: true,
    minScale: 500,
    standard: STD.KENYA,
  },
  {
    code: 'BND-FENCE',
    description: 'Fence Line',
    category: 'boundary',
    dxfLayer: 'BOUNDARY-FENCE',
    color: 3,          // green
    lineType: 'DASHED',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'BND-WALL',
    description: 'Compound Wall',
    category: 'boundary',
    dxfLayer: 'BOUNDARY-WALL',
    color: 7,
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'BND-HEDGE',
    description: 'Hedge Line',
    category: 'boundary',
    dxfLayer: 'BOUNDARY-HEDGE',
    color: 3,
    lineType: 'DASHED',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },

  // ── STRUCTURES (10 codes) ──────────────────────────────────────────────────
  {
    code: 'BLD',
    description: 'Building Outline',
    category: 'structure',
    dxfLayer: 'STRUCT-BUILDING',
    color: 7,
    lineType: 'CONTINUOUS',
    symbol: 'square',
    joinLines: true,
    pointLabel: true,
    minScale: 500,
    standard: STD.SK,
  },
  {
    code: 'BLD-ABS',
    description: 'Abstract Building',
    category: 'structure',
    dxfLayer: 'STRUCT-BLDG-ABSTRACT',
    color: 9,          // light grey
    lineType: 'DASHED',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 2500,
    standard: STD.ASPRS,
  },
  {
    code: 'BLD-UND',
    description: 'Underground Structure',
    category: 'structure',
    dxfLayer: 'STRUCT-UNDERGROUND',
    color: 9,
    lineType: 'DASHED',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'CMP',
    description: 'Compounds / Wall Enclosure',
    category: 'structure',
    dxfLayer: 'STRUCT-COMPOUND',
    color: 7,
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'BRG',
    description: 'Bridge',
    category: 'structure',
    dxfLayer: 'STRUCT-BRIDGE',
    color: 1,          // red
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: true,
    pointLabel: true,
    minScale: 500,
    standard: STD.SK,
  },
  {
    code: 'CULV',
    description: 'Culvert',
    category: 'structure',
    dxfLayer: 'STRUCT-CULVERT',
    color: 3,
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'TWR',
    description: 'Tower / Mast',
    category: 'structure',
    dxfLayer: 'STRUCT-TOWER',
    color: 1,
    lineType: 'CONTINUOUS',
    symbol: 'circle',
    joinLines: false,
    pointLabel: true,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'TUN',
    description: 'Tunnel Entrance',
    category: 'structure',
    dxfLayer: 'STRUCT-TUNNEL',
    color: 1,
    lineType: 'CONTINUOUS',
    symbol: 'circle',
    joinLines: false,
    pointLabel: true,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'DMP',
    description: 'Dam / Embankment',
    category: 'structure',
    dxfLayer: 'STRUCT-DAM',
    color: 3,
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'SIV',
    description: 'Sewer / Manhole',
    category: 'structure',
    dxfLayer: 'STRUCT-MANHOLE',
    color: 4,          // cyan
    lineType: 'CONTINUOUS',
    symbol: 'circle',
    joinLines: false,
    pointLabel: true,
    minScale: 500,
    standard: STD.SK,
  },

  // ── TRANSPORTATION (12 codes) ──────────────────────────────────────────────
  {
    code: 'RD',
    description: 'Road Carriageway Edge',
    category: 'transportation',
    dxfLayer: 'ROAD-EDGE',
    color: 7,
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 500,
    standard: STD.SK,
  },
  {
    code: 'RD-CTR',
    description: 'Road Centre Line',
    category: 'transportation',
    dxfLayer: 'ROAD-CENTRELINE',
    color: 1,
    lineType: 'CENTER',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 500,
    standard: STD.SK,
  },
  {
    code: 'RD-VERGE',
    description: 'Road Verge Edge',
    category: 'transportation',
    dxfLayer: 'ROAD-VERGE',
    color: 3,
    lineType: 'DASHED',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'RD-KERB',
    description: 'Kerb Line',
    category: 'transportation',
    dxfLayer: 'ROAD-KERB',
    color: 7,
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 500,
    standard: STD.SK,
  },
  {
    code: 'RD-PATH',
    description: 'Footpath / Track',
    category: 'transportation',
    dxfLayer: 'ROAD-FOOTPATH',
    color: 3,
    lineType: 'DASHED',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'RW',
    description: 'Railway Line',
    category: 'transportation',
    dxfLayer: 'RAILWAY-LINE',
    color: 1,
    lineType: 'CENTER',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'RW-PLAT',
    description: 'Railway Platform',
    category: 'transportation',
    dxfLayer: 'RAILWAY-PLATFORM',
    color: 7,
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'APR',
    description: 'Apron',
    category: 'transportation',
    dxfLayer: 'ROAD-APRON',
    color: 7,
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.ASPRS,
  },
  {
    code: 'RWY',
    description: 'Runway',
    category: 'transportation',
    dxfLayer: 'AIRPORT-RUNWAY',
    color: 1,
    lineType: 'CENTER',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.ASPRS,
  },
  {
    code: 'STP',
    description: 'Step / Stair',
    category: 'transportation',
    dxfLayer: 'ROAD-STEP',
    color: 7,
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 500,
    standard: STD.SK,
  },
  {
    code: 'JNC',
    description: 'Junction / Intersection',
    category: 'transportation',
    dxfLayer: 'ROAD-JUNCTION',
    color: 3,
    lineType: 'CONTINUOUS',
    symbol: 'circle',
    joinLines: false,
    pointLabel: true,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'RND',
    description: 'Roundabout',
    category: 'transportation',
    dxfLayer: 'ROAD-ROUNDABOUT',
    color: 1,
    lineType: 'CENTER',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },

  // ── UTILITIES (10 codes) ───────────────────────────────────────────────────
  {
    code: 'ELV',
    description: 'Electricity Line',
    category: 'utilities',
    dxfLayer: 'UTIL-ELECTRICITY',
    color: 1,
    lineType: 'DASHED',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'ELV-POL',
    description: 'Electricity Pole',
    category: 'utilities',
    dxfLayer: 'UTIL-ELEC-POLE',
    color: 1,
    lineType: 'CONTINUOUS',
    symbol: 'circle',
    joinLines: false,
    pointLabel: true,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'TEL',
    description: 'Telephone Line',
    category: 'utilities',
    dxfLayer: 'UTIL-TELEPHONE',
    color: 4,          // cyan
    lineType: 'DASHED',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'TEL-POL',
    description: 'Telephone Pole',
    category: 'utilities',
    dxfLayer: 'UTIL-TEL-POLE',
    color: 4,
    lineType: 'CONTINUOUS',
    symbol: 'circle',
    joinLines: false,
    pointLabel: true,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'WTR',
    description: 'Water Pipe',
    category: 'utilities',
    dxfLayer: 'UTIL-WATER-PIPE',
    color: 5,          // blue
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'WTR-VLV',
    description: 'Water Valve',
    category: 'utilities',
    dxfLayer: 'UTIL-WATER-VALVE',
    color: 5,
    lineType: 'CONTINUOUS',
    symbol: 'circle',
    joinLines: false,
    pointLabel: true,
    minScale: 500,
    standard: STD.SK,
  },
  {
    code: 'WTR-HYD',
    description: 'Hydrant',
    category: 'utilities',
    dxfLayer: 'UTIL-HYDRANT',
    color: 1,
    lineType: 'CONTINUOUS',
    symbol: 'circle',
    joinLines: false,
    pointLabel: true,
    minScale: 500,
    standard: STD.SK,
  },
  {
    code: 'GAS',
    description: 'Gas Line',
    category: 'utilities',
    dxfLayer: 'UTIL-GAS',
    color: 3,
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.ASPRS,
  },
  {
    code: 'DRA',
    description: 'Drain / Culvert Line',
    category: 'utilities',
    dxfLayer: 'UTIL-DRAIN',
    color: 3,
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'CMP-DRA',
    description: 'Concrete Drain',
    category: 'utilities',
    dxfLayer: 'UTIL-CONC-DRAIN',
    color: 5,
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },

  // ── HYDROGRAPHY (8 codes) ──────────────────────────────────────────────────
  {
    code: 'RIV',
    description: 'River / Stream Edge',
    category: 'hydrography',
    dxfLayer: 'HYDRO-RIVER',
    color: 3,          // green
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 500,
    standard: STD.SK,
  },
  {
    code: 'RIV-CTR',
    description: 'River Centre Line',
    category: 'hydrography',
    dxfLayer: 'HYDRO-RIVER-CTR',
    color: 5,          // blue
    lineType: 'CENTER',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'LAK',
    description: 'Lake / Pond Edge',
    category: 'hydrography',
    dxfLayer: 'HYDRO-LAKE',
    color: 3,
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 500,
    standard: STD.SK,
  },
  {
    code: 'CHN',
    description: 'Open Channel',
    category: 'hydrography',
    dxfLayer: 'HYDRO-CHANNEL',
    color: 3,
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'WTR-SPR',
    description: 'Spring',
    category: 'hydrography',
    dxfLayer: 'HYDRO-SPRING',
    color: 5,
    lineType: 'CONTINUOUS',
    symbol: 'circle',
    joinLines: false,
    pointLabel: true,
    minScale: 500,
    standard: STD.SK,
  },
  {
    code: 'WTR-WEL',
    description: 'Well / Borehole',
    category: 'hydrography',
    dxfLayer: 'HYDRO-WELL',
    color: 5,
    lineType: 'CONTINUOUS',
    symbol: 'circle',
    joinLines: false,
    pointLabel: true,
    minScale: 500,
    standard: STD.SK,
  },
  {
    code: 'SEA',
    description: 'Sea / Ocean',
    category: 'hydrography',
    dxfLayer: 'HYDRO-SEA',
    color: 3,
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 500,
    standard: STD.ASPRS,
  },
  {
    code: 'SWP',
    description: 'Swamp / Marsh',
    category: 'hydrography',
    dxfLayer: 'HYDRO-SWAMP',
    color: 3,
    lineType: 'DASHED',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },

  // ── VEGETATION (8 codes) ───────────────────────────────────────────────────
  {
    code: 'TRV',
    description: 'Tree',
    category: 'vegetation',
    dxfLayer: 'VEG-TREE',
    color: 3,          // green
    lineType: 'CONTINUOUS',
    symbol: 'circle',
    joinLines: false,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'TRV-LINE',
    description: 'Tree Line',
    category: 'vegetation',
    dxfLayer: 'VEG-TREE-LINE',
    color: 3,
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'FRS',
    description: 'Forest Edge',
    category: 'vegetation',
    dxfLayer: 'VEG-FOREST',
    color: 3,
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'GRV',
    description: 'Grass / Bush Area',
    category: 'vegetation',
    dxfLayer: 'VEG-GRASS',
    color: 3,
    lineType: 'DASHED',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 2500,
    standard: STD.SK,
  },
  {
    code: 'CUL',
    description: 'Cultivated Land',
    category: 'vegetation',
    dxfLayer: 'VEG-CULTIVATED',
    color: 3,
    lineType: 'DASHED',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 2500,
    standard: STD.SK,
  },
  {
    code: 'SCR',
    description: 'Scrub / Thicket',
    category: 'vegetation',
    dxfLayer: 'VEG-SCRUB',
    color: 3,
    lineType: 'DASHED',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 2500,
    standard: STD.SK,
  },
  {
    code: 'HGR',
    description: 'Hedge',
    category: 'vegetation',
    dxfLayer: 'VEG-HEDGE',
    color: 3,
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },
  {
    code: 'GRD',
    description: 'Garden',
    category: 'vegetation',
    dxfLayer: 'VEG-GARDEN',
    color: 3,
    lineType: 'DASHED',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },

  // ── RELIEF (5 codes) ───────────────────────────────────────────────────────
  {
    code: 'SH',
    description: 'Spot Height',
    category: 'relief',
    dxfLayer: 'RELIEF-SPOT-HEIGHT',
    color: 3,
    lineType: 'CONTINUOUS',
    symbol: 'cross',
    joinLines: false,
    pointLabel: true,
    minScale: 500,
    standard: STD.SK,
  },
  {
    code: 'BM',
    description: 'Benchmark',
    category: 'relief',
    dxfLayer: 'RELIEF-BENCHMARK',
    color: 1,          // red
    lineType: 'CONTINUOUS',
    symbol: 'triangle',
    joinLines: false,
    pointLabel: true,
    minScale: 500,
    standard: STD.KENYA,
  },
  {
    code: 'CRST',
    description: 'Crest / Ridge',
    category: 'relief',
    dxfLayer: 'RELIEF-RIDGE',
    color: 3,
    lineType: 'DASHED',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 2500,
    standard: STD.SK,
  },
  {
    code: 'VLY',
    description: 'Valley Floor',
    category: 'relief',
    dxfLayer: 'RELIEF-VALLEY',
    color: 3,
    lineType: 'DASHED',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 2500,
    standard: STD.SK,
  },
  {
    code: 'ESC',
    description: 'Escarpment',
    category: 'relief',
    dxfLayer: 'RELIEF-ESCARPMENT',
    color: 3,
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: true,
    pointLabel: false,
    minScale: 1000,
    standard: STD.SK,
  },

  // ── CONTROL (4 codes) ──────────────────────────────────────────────────────
  {
    code: 'CTRL',
    description: 'Control Point',
    category: 'control',
    dxfLayer: 'CONTROL-POINT',
    color: 1,          // red
    lineType: 'CONTINUOUS',
    symbol: 'triangle',
    joinLines: false,
    pointLabel: true,
    minScale: 500,
    standard: STD.KENYA,
  },
  {
    code: 'CTRL-P',
    description: 'Primary Control',
    category: 'control',
    dxfLayer: 'CONTROL-PRIMARY',
    color: 1,
    lineType: 'CONTINUOUS',
    symbol: 'triangle',
    joinLines: false,
    pointLabel: true,
    minScale: 250,
    standard: STD.KENYA,
  },
  {
    code: 'CTRL-S',
    description: 'Secondary Control',
    category: 'control',
    dxfLayer: 'CONTROL-SECONDARY',
    color: 3,
    lineType: 'CONTINUOUS',
    symbol: 'triangle',
    joinLines: false,
    pointLabel: true,
    minScale: 500,
    standard: STD.KENYA,
  },
  {
    code: 'GPS',
    description: 'GPS Point',
    category: 'control',
    dxfLayer: 'CONTROL-GPS',
    color: 1,
    lineType: 'CONTINUOUS',
    symbol: 'circle',
    joinLines: false,
    pointLabel: true,
    minScale: 500,
    standard: STD.ASPRS,
  },

  // ── FURNITURE (5 codes) ────────────────────────────────────────────────────
  {
    code: 'SLB',
    description: 'Slab Level',
    category: 'furniture',
    dxfLayer: 'FURN-SLAB',
    color: 7,
    lineType: 'CONTINUOUS',
    symbol: 'cross',
    joinLines: false,
    pointLabel: true,
    minScale: 250,
    standard: STD.ASPRS,
  },
  {
    code: 'INV',
    description: 'Invert Level',
    category: 'furniture',
    dxfLayer: 'FURN-INVERT',
    color: 5,          // blue
    lineType: 'CONTINUOUS',
    symbol: 'cross',
    joinLines: false,
    pointLabel: true,
    minScale: 250,
    standard: STD.ASPRS,
  },
  {
    code: 'CLB',
    description: 'Curb Level',
    category: 'furniture',
    dxfLayer: 'FURN-CURB',
    color: 7,
    lineType: 'CONTINUOUS',
    symbol: 'cross',
    joinLines: false,
    pointLabel: true,
    minScale: 250,
    standard: STD.ASPRS,
  },
  {
    code: 'FND',
    description: 'Foundation Level',
    category: 'furniture',
    dxfLayer: 'FURN-FOUNDATION',
    color: 7,
    lineType: 'CONTINUOUS',
    symbol: 'cross',
    joinLines: false,
    pointLabel: true,
    minScale: 250,
    standard: STD.ASPRS,
  },
  {
    code: 'FLR',
    description: 'Floor Level',
    category: 'furniture',
    dxfLayer: 'FURN-FLOOR',
    color: 7,
    lineType: 'CONTINUOUS',
    symbol: 'cross',
    joinLines: false,
    pointLabel: true,
    minScale: 250,
    standard: STD.ASPRS,
  },

  // ── OTHER (3 codes) ────────────────────────────────────────────────────────
  {
    code: 'UNK',
    description: 'Unknown Feature',
    category: 'other',
    dxfLayer: 'OTHER-UNKNOWN',
    color: 8,          // dark grey
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: false,
    pointLabel: false,
    minScale: 1000,
    standard: STD.ASPRS,
  },
  {
    code: 'TXT',
    description: 'Text Annotation',
    category: 'other',
    dxfLayer: 'OTHER-TEXT',
    color: 7,
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: false,
    pointLabel: true,
    minScale: 250,
    standard: STD.SK,
  },
  {
    code: 'OTH',
    description: 'Other Feature',
    category: 'other',
    dxfLayer: 'OTHER-MISC',
    color: 7,
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: false,
    pointLabel: true,
    minScale: 1000,
    standard: STD.ASPRS,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY METADATA — display ordering and names
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_META: Array<{
  category: FeatureCategory;
  name: string;
  order: number;
}> = [
  { category: 'boundary',        name: 'Boundary',          order: 1  },
  { category: 'structure',       name: 'Structures',        order: 2  },
  { category: 'transportation',  name: 'Transportation',    order: 3  },
  { category: 'utilities',       name: 'Utilities',         order: 4  },
  { category: 'hydrography',     name: 'Hydrography',       order: 5  },
  { category: 'vegetation',      name: 'Vegetation',        order: 6  },
  { category: 'relief',          name: 'Relief',            order: 7  },
  { category: 'control',         name: 'Control',           order: 8  },
  { category: 'furniture',       name: 'Furniture',         order: 9  },
  { category: 'other',           name: 'Other',             order: 10 },
];

// ─────────────────────────────────────────────────────────────────────────────
// LOOKUP INDEX (built once at module load)
// ─────────────────────────────────────────────────────────────────────────────

const CODE_INDEX: Map<string, FeatureCodeDef> = new Map(
  KENYA_TOPO_CODES.map(fc => [fc.code, fc])
);

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — Single code lookup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Look up a feature code definition by its short code.
 * Case-insensitive. Returns `undefined` for unknown codes.
 */
export function getFeatureCode(code: string): FeatureCodeDef | undefined {
  return CODE_INDEX.get(code.toUpperCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — Grouped lookup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return groups whose category matches the given filter.
 * Pass `'*'` or omit the argument to return all groups.
 */
export function getCodesByCategory(category?: string): FeatureCodeGroup[] {
  const all = getAllGroups();
  if (!category || category === '*') return all;
  return all.filter(g => g.category === category);
}

/**
 * Return all feature code groups, ordered by category metadata.
 * Each group contains the codes belonging to that category.
 */
export function getAllGroups(): FeatureCodeGroup[] {
  return CATEGORY_META.map(meta => ({
    name: meta.name,
    category: meta.category,
    codes: KENYA_TOPO_CODES.filter(fc => fc.category === meta.category),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — Layer mapping (survey points → DXF layers)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a collection of coded survey points to their DXF layers.
 *
 * Points with unrecognised codes are mapped to the `OTHER-UNKNOWN` layer.
 * When a code has `joinLines: true`, sequential points with that code
 * are also collected into polyline vertex arrays.
 *
 * @param points  Array of survey points carrying a feature code.
 * @returns       Array of `LayerMappingResult`, one per unique layer.
 */
export function mapPointsToLayers(
  points: SurveyPointWithCode[]
): LayerMappingResult[] {
  // Bucket points by their resolved layer name
  const bucketMap = new Map<string, {
    def: FeatureCodeDef;
    points: LayerMappingResult['points'];
    codedPoints: SurveyPointWithCode[];   // keep originals for polyline joining
  }>();

  // Fallback definition for unknown codes
  const unknownDef: FeatureCodeDef = {
    code: 'UNK',
    description: 'Unknown Feature',
    category: 'other',
    dxfLayer: 'OTHER-UNKNOWN',
    color: 8,
    lineType: 'CONTINUOUS',
    symbol: 'none',
    joinLines: false,
    pointLabel: false,
    minScale: 1000,
    standard: STD.ASPRS,
  };

  for (const pt of points) {
    const code = pt.code.toUpperCase();
    const def = CODE_INDEX.get(code) ?? unknownDef;
    const layerName = def.dxfLayer;

    let bucket = bucketMap.get(layerName);
    if (!bucket) {
      bucket = { def, points: [], codedPoints: [] };
      bucketMap.set(layerName, bucket);
    }

    bucket.points.push({
      e: pt.easting,
      n: pt.northing,
      z: pt.elevation,
      label: def.pointLabel ? (pt.pointNumber ?? `${code}`) : undefined,
    });
    bucket.codedPoints.push(pt);
  }

  // Build results
  const results: LayerMappingResult[] = [];

  bucketMap.forEach((bucket, layerName) => {
    const { def, points: layerPoints, codedPoints } = bucket;
    const polylines = def.joinLines
      ? joinFeatureLines(codedPoints, def.code)
      : [];

    results.push({
      layer: layerName,
      color: def.color,
      lineType: def.lineType,
      points: layerPoints,
      polylines,
    });
  });

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — Polyline joining
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Join sequential survey points that share the same feature code into
 * polyline vertex arrays.  Points are considered "sequential" when they
 * appear next to each other in the input array with an identical code.
 *
 * A gap (different code) or the end of the array breaks the current polyline.
 *
 * @param points  Ordered survey points.
 * @param code    Feature code to join (case-insensitive).
 * @returns       Array of polyline coordinate arrays.
 */
export function joinFeatureLines(
  points: SurveyPointWithCode[],
  code: string
): Coordinate[][] {
  const targetCode = code.toUpperCase();
  const polylines: Coordinate[][] = [];
  let current: Coordinate[] | null = null;

  for (const pt of points) {
    if (pt.code.toUpperCase() === targetCode) {
      if (!current) {
        current = [];
      }
      current.push({ e: pt.easting, n: pt.northing });
    } else {
      // Break — flush the current polyline if it has ≥ 2 vertices
      if (current && current.length >= 2) {
        polylines.push(current);
      }
      current = null;
    }
  }

  // Flush any remaining polyline
  if (current && current.length >= 2) {
    polylines.push(current);
  }

  return polylines;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — AutoCAD Color Index helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Common ACI color names for DXF rendering.
 * Useful for UI color pickers and legend generation.
 */
export const ACI_COLORS: Record<number, string> = {
  1:  '#FF0000',  // Red
  2:  '#FFFF00',  // Yellow
  3:  '#00FF00',  // Green
  4:  '#00FFFF',  // Cyan
  5:  '#0000FF',  // Blue
  6:  '#FF00FF',  // Magenta
  7:  '#FFFFFF',  // White / Black (depends on background)
  8:  '#808080',  // Dark Grey
  9:  '#C0C0C0',  // Light Grey
  10: '#FF0000',  // Red
  30: '#FF7F00',  // Orange
  40: '#FFFF00',  // Yellow
  50: '#00FF00',  // Green
  60: '#00FFFF',  // Cyan
  70: '#0000FF',  // Blue
  80: '#800080',  // Dark Magenta
  90: '#FF00FF',  // Magenta
  100:'#FF69B4',  // Pink
  130:'#FF4500',  // OrangeRed
  160:'#32CD32',  // LimeGreen
  190:'#00CED1',  // DarkTurquoise
  210:'#4169E1',  // RoyalBlue
  240:'#8B008B',  // DarkMagenta
  250:'#696969',  // DimGray
  251:'#A9A9A9',  // DarkGray
  252:'#808080',  // Gray
  253:'#C0C0C0',  // Silver
  254:'#D3D3D3',  // LightGray
  255:'#FFFFFF',  // White
};

/**
 * Get the hex color string for an ACI value.
 * Falls back to `#808080` (grey) for unknown indices.
 */
export function aciToHex(aci: number): string {
  return ACI_COLORS[aci] ?? '#808080';
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — DXF line type dash patterns
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard DXF line type dash patterns compatible with `dxf-writer`.
 */
export const DXF_LINE_TYPE_PATTERNS: Record<DXFLineType, { name: string; elements: number[] }> = {
  CONTINUOUS: { name: 'CONTINUOUS', elements: [] },
  DASHED:     { name: 'DASHED',     elements: [-1.0, 0.5] },
  DOTTED:     { name: 'DOTTED',     elements: [-0.5, 0.25] },
  CENTER:     { name: 'CENTER',     elements: [-1.5, 0.25, 0.25, 0.25] },
  PHANTOM:    { name: 'PHANTOM',    elements: [-2.0, 0.25, 0.25, 0.25, 0.25, 0.25] },
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — Unique line types used across all codes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deduplicated list of all DXF line types referenced by the code library.
 * Useful when initialising a DXF drawing to register every required line type.
 */
export function getUniqueLineTypes(): DXFLineType[] {
  const seen = new Set<DXFLineType>();
  for (const fc of KENYA_TOPO_CODES) {
    seen.add(fc.lineType);
  }
  return Array.from(seen);
}

/**
 * Deduplicated list of all DXF layers referenced by the code library.
 * Useful when initialising a DXF drawing to register every required layer.
 */
export function getUniqueLayers(): Array<{ layer: string; color: number; lineType: DXFLineType }> {
  const seen = new Map<string, { layer: string; color: number; lineType: DXFLineType }>();
  for (const fc of KENYA_TOPO_CODES) {
    if (!seen.has(fc.dxfLayer)) {
      seen.set(fc.dxfLayer, {
        layer: fc.dxfLayer,
        color: fc.color,
        lineType: fc.lineType,
      });
    }
  }
  return Array.from(seen.values());
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — Code search / autocomplete
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Search feature codes by keyword (matches against code, description, or DXF layer).
 * Returns at most `limit` results.
 */
export function searchFeatureCodes(query: string, limit = 20): FeatureCodeDef[] {
  const q = query.toUpperCase().trim();
  if (!q) return KENYA_TOPO_CODES.slice(0, limit);

  return KENYA_TOPO_CODES.filter(fc => {
    return (
      fc.code.toUpperCase().includes(q) ||
      fc.description.toUpperCase().includes(q) ||
      fc.dxfLayer.toUpperCase().includes(q) ||
      fc.category.toUpperCase().includes(q)
    );
  }).slice(0, limit);
}
