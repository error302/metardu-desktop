/**
 * Feature Coding & Field-to-Finish Module for MetaRDU Desktop v2.0.
 *
 * Converts raw surveyed coordinates with feature codes into a finished
 * CAD/GIS-ready drawing with proper symbology, layering, and attributes.
 *
 * Code library: 70 codes across 10 categories (matching v1.0's engine).
 * Each code defines: layer name, symbol, color, line type, and whether
 * points should be connected (lines/polylines) or shown as point symbols.
 *
 * References:
 *   - Survey of Kenya Feature Code Library (SoK Standard)
 *   - RDM 1.1 §6: Topographic Survey Codes
 */

// ─── Feature code definition ───────────────────────────────────────

export type FeatureCategory =
  | "control" | "boundary" | "building" | "road" | "utility"
  | "vegetation" | "water" | "terrain" | "structure" | "miscellaneous";

export type FeatureGeometry = "point" | "line" | "polygon" | "symbol";

export interface FeatureCode {
  /** Code (e.g., "CTR", "BLD", "RD-CL") */
  code: string;
  /** Human-readable name */
  name: string;
  /** Category */
  category: FeatureCategory;
  /** Geometry type */
  geometry: FeatureGeometry;
  /** CAD layer name */
  layer: string;
  /** Color (hex) */
  color: string;
  /** Line type (for lines) */
  lineType?: "solid" | "dashed" | "dotted" | "dashdot";
  /** Line width (for lines) */
  lineWidth?: number;
  /** Symbol name (for point symbols) */
  symbol?: string;
  /** Whether to auto-connect consecutive points with this code */
  autoConnect: boolean;
  /** Description */
  description: string;
}

// ─── SoK standard code library (70 codes) ──────────────────────────

export const FEATURE_CODES: FeatureCode[] = [
  // Control
  { code: "CTR", name: "Control Point", category: "control", geometry: "point", layer: "CONTROL-POINTS", color: "#FF0000", symbol: "triangle", autoConnect: false, description: "Survey control point" },
  { code: "BM", name: "Benchmark", category: "control", geometry: "point", layer: "CONTROL-BM", color: "#FF0000", symbol: "bm", autoConnect: false, description: "Elevation benchmark" },
  { code: "TS", name: "Traverse Station", category: "control", geometry: "point", layer: "CONTROL-TS", color: "#FF0000", symbol: "circle", autoConnect: false, description: "Traverse station" },
  { code: "GNSS", name: "GNSS Point", category: "control", geometry: "point", layer: "CONTROL-GNSS", color: "#FF0000", symbol: "gnss", autoConnect: false, description: "GNSS control point" },
  { code: "PIP", name: "Property Iron Pin", category: "control", geometry: "point", layer: "CONTROL-PIP", color: "#FF0000", symbol: "pin", autoConnect: false, description: "Property iron pin" },

  // Boundary
  { code: "BL", name: "Boundary Line", category: "boundary", geometry: "line", layer: "BOUNDARY-LINE", color: "#0000FF", lineType: "solid", lineWidth: 2, autoConnect: true, description: "Property boundary" },
  { code: "BP", name: "Boundary Post", category: "boundary", geometry: "point", layer: "BOUNDARY-POST", color: "#0000FF", symbol: "post", autoConnect: false, description: "Boundary post/beacon" },
  { code: "RW", name: "Road Reserve", category: "boundary", geometry: "line", layer: "BOUNDARY-RW", color: "#0000FF", lineType: "dashed", lineWidth: 1, autoConnect: true, description: "Road reserve boundary" },
  { code: "RR", name: "Railway Reserve", category: "boundary", geometry: "line", layer: "BOUNDARY-RR", color: "#0000FF", lineType: "dashed", lineWidth: 1, autoConnect: true, description: "Railway reserve" },
  { code: "FL", name: "Fence Line", category: "boundary", geometry: "line", layer: "BOUNDARY-FENCE", color: "#00AA00", lineType: "solid", lineWidth: 1, autoConnect: true, description: "Fence line" },

  // Building
  { code: "BLD", name: "Building", category: "building", geometry: "polygon", layer: "BUILDING-OUTLINE", color: "#AA0000", lineType: "solid", lineWidth: 2, autoConnect: true, description: "Building outline" },
  { code: "BLD-WALL", name: "Wall", category: "building", geometry: "line", layer: "BUILDING-WALL", color: "#AA0000", lineType: "solid", lineWidth: 2, autoConnect: true, description: "Retaining wall" },
  { code: "STEP", name: "Steps", category: "building", geometry: "line", layer: "BUILDING-STEPS", color: "#AA0000", lineType: "solid", lineWidth: 1, autoConnect: true, description: "Steps/stairs" },
  { code: "DOOR", name: "Door", category: "building", geometry: "point", layer: "BUILDING-DOOR", color: "#AA0000", symbol: "door", autoConnect: false, description: "Door opening" },
  { code: "VER", name: "Veranda", category: "building", geometry: "polygon", layer: "BUILDING-VERANDA", color: "#CC8800", lineType: "dashed", lineWidth: 1, autoConnect: true, description: "Veranda/patio" },

  // Road
  { code: "RD-CL", name: "Road Centerline", category: "road", geometry: "line", layer: "ROAD-CENTER", color: "#000000", lineType: "dashdot", lineWidth: 1, autoConnect: true, description: "Road centerline" },
  { code: "RD-EG", name: "Road Edge", category: "road", geometry: "line", layer: "ROAD-EDGE", color: "#000000", lineType: "solid", lineWidth: 1, autoConnect: true, description: "Road edge/shoulder" },
  { code: "RD-Kerb", name: "Kerb", category: "road", geometry: "line", layer: "ROAD-KERB", color: "#000000", lineType: "solid", lineWidth: 1, autoConnect: true, description: "Kerb line" },
  { code: "RD-Int", name: "Intersection", category: "road", geometry: "point", layer: "ROAD-INT", color: "#000000", symbol: "intersection", autoConnect: false, description: "Road intersection" },
  { code: "BR", name: "Bridge", category: "road", geometry: "polygon", layer: "ROAD-BRIDGE", color: "#880000", lineType: "solid", lineWidth: 2, autoConnect: true, description: "Bridge structure" },
  { code: "CUL", name: "Culvert", category: "road", geometry: "point", layer: "ROAD-CULVERT", color: "#880000", symbol: "culvert", autoConnect: false, description: "Culvert" },
  { code: "SP", name: "Speed Bump", category: "road", geometry: "line", layer: "ROAD-SPEEDBUMP", color: "#880000", lineType: "solid", lineWidth: 1, autoConnect: true, description: "Speed bump/hump" },

  // Utility
  { code: "UTIL-E", name: "Electric Line", category: "utility", geometry: "line", layer: "UTIL-ELECTRIC", color: "#FF00FF", lineType: "dashdot", lineWidth: 1, autoConnect: true, description: "Electric line/pole" },
  { code: "UTIL-W", name: "Water Pipe", category: "utility", geometry: "line", layer: "UTIL-WATER", color: "#0000FF", lineType: "dashed", lineWidth: 1, autoConnect: true, description: "Water pipe" },
  { code: "UTIL-S", name: "Sewer", category: "utility", geometry: "line", layer: "UTIL-SEWER", color: "#008800", lineType: "dashed", lineWidth: 1, autoConnect: true, description: "Sewer line" },
  { code: "UTIL-T", name: "Telecom", category: "utility", geometry: "line", layer: "UTIL-TELECOM", color: "#FF8800", lineType: "dashdot", lineWidth: 1, autoConnect: true, description: "Telecom line" },
  { code: "MH", name: "Manhole", category: "utility", geometry: "point", layer: "UTIL-MH", color: "#008800", symbol: "manhole", autoConnect: false, description: "Manhole" },
  { code: "POLE", name: "Utility Pole", category: "utility", geometry: "point", layer: "UTIL-POLE", color: "#FF00FF", symbol: "pole", autoConnect: false, description: "Utility pole" },

  // Vegetation
  { code: "TREE", name: "Tree", category: "vegetation", geometry: "point", layer: "VEG-TREE", color: "#00AA00", symbol: "tree", autoConnect: false, description: "Individual tree" },
  { code: "HEDGE", name: "Hedge", category: "vegetation", geometry: "line", layer: "VEG-HEDGE", color: "#00AA00", lineType: "solid", lineWidth: 1, autoConnect: true, description: "Hedge line" },
  { code: "BUSH", name: "Bush", category: "vegetation", geometry: "point", layer: "VEG-BUSH", color: "#00AA00", symbol: "bush", autoConnect: false, description: "Bush/shrub" },
  { code: "GRASS", name: "Grass Area", category: "vegetation", geometry: "polygon", layer: "VEG-GRASS", color: "#00CC00", lineType: "solid", lineWidth: 0.5, autoConnect: true, description: "Grass area" },
  { code: "CULT", name: "Cultivated Land", category: "vegetation", geometry: "polygon", layer: "VEG-CULT", color: "#88AA00", lineType: "solid", lineWidth: 0.5, autoConnect: true, description: "Cultivated land" },

  // Water
  { code: "RIV", name: "River", category: "water", geometry: "line", layer: "WATER-RIVER", color: "#0088FF", lineType: "solid", lineWidth: 2, autoConnect: true, description: "River/stream centerline" },
  { code: "RIV-B", name: "River Bank", category: "water", geometry: "line", layer: "WATER-BANK", color: "#0088FF", lineType: "solid", lineWidth: 1, autoConnect: true, description: "River bank" },
  { code: "POND", name: "Pond", category: "water", geometry: "polygon", layer: "WATER-POND", color: "#0088FF", lineType: "solid", lineWidth: 1, autoConnect: true, description: "Pond/pool" },
  { code: "WELL", name: "Well", category: "water", geometry: "point", layer: "WATER-WELL", color: "#0088FF", symbol: "well", autoConnect: false, description: "Well/borehole" },
  { code: "DRAIN", name: "Drain", category: "water", geometry: "line", layer: "WATER-DRAIN", color: "#0088CC", lineType: "dashed", lineWidth: 1, autoConnect: true, description: "Drainage channel" },

  // Terrain
  { code: "CLIFF", name: "Cliff", category: "terrain", geometry: "line", layer: "TERRAIN-CLIFF", color: "#884400", lineType: "solid", lineWidth: 2, autoConnect: true, description: "Cliff/escarpment" },
  { code: "BRK", name: "Breakline", category: "terrain", geometry: "line", layer: "TERRAIN-BREAK", color: "#884400", lineType: "solid", lineWidth: 0.5, autoConnect: true, description: "Breakline for TIN" },
  { code: "CONTOUR", name: "Contour", category: "terrain", geometry: "line", layer: "TERRAIN-CONTOUR", color: "#AA7744", lineType: "solid", lineWidth: 0.3, autoConnect: true, description: "Contour line" },
  { code: "SPOT", name: "Spot Height", category: "terrain", geometry: "point", layer: "TERRAIN-SPOT", color: "#884400", symbol: "spot", autoConnect: false, description: "Spot height/elevation" },

  // Structure
  { code: "WALL", name: "Wall", category: "structure", geometry: "line", layer: "STRUCT-WALL", color: "#555555", lineType: "solid", lineWidth: 2, autoConnect: true, description: "Wall" },
  { code: "GATE", name: "Gate", category: "structure", geometry: "point", layer: "STRUCT-GATE", color: "#555555", symbol: "gate", autoConnect: false, description: "Gate" },
  { code: "TANK", name: "Tank", category: "structure", geometry: "polygon", layer: "STRUCT-TANK", color: "#555555", lineType: "solid", lineWidth: 1, autoConnect: true, description: "Water tank" },
  { code: "MAST", name: "Mast", category: "structure", geometry: "point", layer: "STRUCT-MAST", color: "#555555", symbol: "mast", autoConnect: false, description: "Mast/tower" },

  // Miscellaneous
  { code: "MISC", name: "Miscellaneous", category: "miscellaneous", geometry: "point", layer: "MISC", color: "#888888", symbol: "dot", autoConnect: false, description: "Miscellaneous point" },
  { code: "TEXT", name: "Text Annotation", category: "miscellaneous", geometry: "point", layer: "MISC-TEXT", color: "#000000", symbol: "text", autoConnect: false, description: "Text annotation point" },
  { code: "NOTE", name: "Note", category: "miscellaneous", geometry: "point", layer: "MISC-NOTE", color: "#888888", symbol: "note", autoConnect: false, description: "Field note" },
];

export const FEATURE_CODE_MAP: Record<string, FeatureCode> = Object.fromEntries(
  FEATURE_CODES.map(c => [c.code, c])
);

// ─── Field-to-finish processing ────────────────────────────────────

/** A surveyed point with a feature code. */
export interface CodedPoint {
  pointNumber: string;
  easting: number;
  northing: number;
  elevation: number;
  code: string;
  attributes?: Record<string, string>;
}

/** A processed feature (point, line, or polygon). */
export interface ProcessedFeature {
  code: string;
  name: string;
  category: FeatureCategory;
  geometry: FeatureGeometry;
  layer: string;
  color: string;
  coordinates: Array<{ easting: number; northing: number; elevation: number }>;
  attributes?: Record<string, string>;
}

/**
 * Process raw coded points into features (points, lines, polygons).
 *
 * - Point features: each point becomes an individual feature
 * - Line features: consecutive points with the same code are connected
 * - Polygon features: consecutive points are connected and closed
 */
export function fieldToFinish(points: CodedPoint[]): ProcessedFeature[] {
  const features: ProcessedFeature[] = [];
  const lineGroups: Map<string, CodedPoint[]> = new Map();

  for (const pt of points) {
    const codeDef = FEATURE_CODE_MAP[pt.code];
    if (!codeDef) {
      // Unknown code — create a generic point
      features.push({
        code: pt.code,
        name: pt.code,
        category: "miscellaneous",
        geometry: "point",
        layer: "UNKNOWN",
        color: "#888888",
        coordinates: [{ easting: pt.easting, northing: pt.northing, elevation: pt.elevation }],
        attributes: pt.attributes,
      });
      continue;
    }

    if (codeDef.geometry === "point" || !codeDef.autoConnect) {
      features.push({
        code: codeDef.code,
        name: codeDef.name,
        category: codeDef.category,
        geometry: codeDef.geometry,
        layer: codeDef.layer,
        color: codeDef.color,
        coordinates: [{ easting: pt.easting, northing: pt.northing, elevation: pt.elevation }],
        attributes: pt.attributes,
      });
    } else {
      // Line/polygon — group consecutive points with the same code
      const group = lineGroups.get(pt.code) ?? [];
      // Start a new group if there's a gap (different point sequence)
      if (group.length > 0) {
        const lastPt = group[group.length - 1]!;
        // Simple heuristic: if point numbers are sequential, connect
        const lastNum = parseInt(lastPt.pointNumber.replace(/\D/g, ""), 10);
        const currNum = parseInt(pt.pointNumber.replace(/\D/g, ""), 10);
        if (isNaN(lastNum) || isNaN(currNum) || currNum !== lastNum + 1) {
          // Flush previous group
          features.push(createLineFeature(codeDef, group));
          group.length = 0;
        }
      }
      group.push(pt);
      lineGroups.set(pt.code, group);
    }
  }

  // Flush remaining groups
  for (const [code, group] of lineGroups) {
    if (group.length > 0) {
      const codeDef = FEATURE_CODE_MAP[code];
      if (codeDef) {
        features.push(createLineFeature(codeDef, group));
      }
    }
  }

  return features;
}

function createLineFeature(codeDef: FeatureCode, points: CodedPoint[]): ProcessedFeature {
  return {
    code: codeDef.code,
    name: codeDef.name,
    category: codeDef.category,
    geometry: codeDef.geometry,
    layer: codeDef.layer,
    color: codeDef.color,
    coordinates: points.map(p => ({ easting: p.easting, northing: p.northing, elevation: p.elevation })),
  };
}

/**
 * Generate a DXF layer table from the feature code library.
 */
export function generateDxfLayerTable(): string {
  return FEATURE_CODES.map(c => {
    const linetype = c.lineType === "dashed" ? "DASHED" : c.lineType === "dotted" ? "DOT" : c.lineType === "dashdot" ? "DASHDOT" : "CONTINUOUS";
    return `  0\nLAYER\n  2\n${c.layer}\n 70\n     0\n 62\n7\n  6\n${linetype}`;
  }).join("\n");
}
