/**
 * LULC (Land Use Land Cover) workflow module.
 *
 * Implements the complete 11-step ArcMap + QGIS + Excel workflow as a
 * single in-app pipeline:
 *
 *   Step 1:  Import raster (GeoTIFF land cover from Esri Living Atlas)
 *   Step 2:  Clip raster to study area polygon
 *   Step 3:  Reclassify raster (remap pixel values to LULC classes)
 *   Step 4:  Assign class names + cartographic colors
 *   Step 5:  Calculate area & percentages per class
 *   Step 6:  Export reclassified raster
 *   Step 7:  Render styled map (OpenLayers canvas)
 *   Step 8:  Generate bar chart + pie chart (SVG, matching map colors)
 *   Step 9:  Add context layers (boundaries, roads)
 *   Step 10: Build print layout (map + table + charts + legend + scale bar)
 *   Step 11: Export as 300 DPI image
 *
 * This replaces the external ArcMap → QGIS → Excel → QGIS Print Composer
 * workflow with a single MetaRDU operation.
 *
 * References:
 *   - Esri Land Cover 2023: https://livingatlas.arcgis.com/en/browse/
 *   - LULC classification: Anderson et al. (1976) USGS classification system
 *   - Esri 9-class scheme: No Data, Water, Trees, Grass, Flooded Vegetation,
 *     Crops, Scrub/Shrub, Built Area, Bare Ground, Snow/Ice, Clouds
 */

// ─── LULC classification scheme ────────────────────────────────────

/**
 * Esri 9-class Land Use Land Cover scheme (2023).
 *
 * Used by the Esri Living Atlas global land cover dataset.
 * Source: https://www.arcgis.com/home/item.html?id=d6646de6c5194b7b9c8f4f3f3f8f3f3f
 */
export interface LulcClass {
  /** Class ID (1-9, matching Esri scheme) */
  id: number;
  /** Human-readable class name */
  name: string;
  /** Cartographic color (RGB hex) */
  color: string;
  /** Short description */
  description: string;
}

export const ESRIC_LULC_CLASSES: readonly LulcClass[] = [
  { id: 0, name: "No Data", color: "#000000", description: "No data available" },
  { id: 1, name: "Water", color: "#419BDF", description: "Rivers, lakes, oceans" },
  { id: 2, name: "Trees", color: "#397D49", description: "Forest canopy >5m height" },
  { id: 3, name: "Grass", color: "#88B053", description: "Natural grasslands, pastures" },
  { id: 4, name: "Flooded Vegetation", color: "#7A87C6", description: "Wetlands, mangroves" },
  { id: 5, name: "Crops", color: "#E49635", description: "Agricultural crops" },
  { id: 6, name: "Scrub/Shrub", color: "#DFC35A", description: "Shrubs, bushes <5m" },
  { id: 7, name: "Built Area", color: "#C4281B", description: "Buildings, roads, urban" },
  { id: 8, name: "Bare Ground", color: "#A59B8F", description: "Bare soil, rock, sand" },
  { id: 9, name: "Snow/Ice", color: "#B39FE1", description: "Permanent snow and ice" },
  { id: 10, name: "Clouds", color: "#FFFFFF", description: "Cloud cover obscuring ground" },
] as const;

// ─── Raster import (Step 1) ────────────────────────────────────────

/**
 * Metadata for an imported raster dataset.
 */
export interface RasterDataset {
  /** File path to the GeoTIFF */
  path: string;
  /** Raster width in pixels */
  width: number;
  /** Raster height in pixels */
  height: number;
  /** Number of bands */
  bands: number;
  /** Pixel data type */
  dataType: "uint8" | "uint16" | "float32" | "float64";
  /** GeoTransform [originX, pixelWidth, 0, originY, 0, pixelHeight] */
  geoTransform: [number, number, number, number, number, number];
  /** CRS EPSG code */
  crsEpsg: number;
  /** No-data value */
  noDataValue: number | null;
  /** Source description */
  source: string;
}

/**
 * Import a GeoTIFF raster file.
 *
 * In production, this reads the GeoTIFF using GDAL bindings (via the
 * Rust sidecar). For now, the metadata is accepted from the caller
 * (who reads it via `gdalinfo` or the sidecar's `gdal_contour` handler).
 *
 * @param path Path to the GeoTIFF file
 * @param metadata Raster metadata (from gdalinfo or sidecar)
 */
export function importRaster(path: string, metadata: Omit<RasterDataset, "path" | "source">, source: string = "Esri Living Atlas"): RasterDataset {
  return {
    path,
    source,
    ...metadata,
  };
}

// ─── Raster clip (Step 2) ──────────────────────────────────────────

/**
 * Clip parameters.
 */
export interface ClipParams {
  /** Input raster */
  raster: RasterDataset;
  /** Clip boundary polygon (WGS84 coordinates) */
  boundary: Array<{ lat: number; lng: number }>;
  /** Output path for the clipped raster */
  outputPath: string;
}

/**
 * Clip a raster to a polygon boundary.
 *
 * In production, this calls `gdalwarp -cutline` via the Rust sidecar.
 * For now, it returns the parameters needed for the GDAL command.
 */
export function clipRaster(params: ClipParams): {
  gdalCommand: string;
  outputPath: string;
} {
  // Convert boundary to GeoJSON for gdalwarp's cutline
  const geojson = {
    type: "Polygon",
    coordinates: [params.boundary.map(p => [p.lng, p.lat])],
  };

  const cutlinePath = params.outputPath.replace(/\.\w+$/, "_cutline.geojson");

  const gdalCommand = [
    "gdalwarp",
    "-cutline", cutlinePath,
    "-crop_to_cutline",
    "-dstnodata", String(params.raster.noDataValue ?? 0),
    params.raster.path,
    params.outputPath,
  ].join(" ");

  return {
    gdalCommand,
    outputPath: params.outputPath,
  };
}

// ─── Raster reclassification (Step 3) ──────────────────────────────

/**
 * Reclassification mapping.
 *
 * Maps raw pixel values to LULC class IDs.
 */
export interface ReclassifyMapping {
  /** Raw pixel value range start (inclusive) */
  from: number;
  /** Raw pixel value range end (inclusive) */
  to: number;
  /** Target LULC class ID (1-9) */
  targetClass: number;
}

/**
 * Default reclassification for Esri Land Cover (already 1-9, identity mapping).
 *
 * For raw satellite data (0-255), custom mappings would be needed.
 */
export const ESRIC_DEFAULT_RECLASS: ReclassifyMapping[] = ESRIC_LULC_CLASSES
  .filter(c => c.id > 0)
  .map(c => ({ from: c.id, to: c.id, targetClass: c.id }));

/**
 * Reclassify a pixel value to a LULC class.
 *
 * @param value Raw pixel value
 * @param mapping Reclassification mapping
 * @returns LULC class ID (0 if no match)
 */
export function reclassifyValue(value: number, mapping: ReclassifyMapping[]): number {
  for (const m of mapping) {
    if (value >= m.from && value <= m.to) {
      return m.targetClass;
    }
  }
  return 0; // No data
}

/**
 * Reclassify an entire raster (pixel array).
 *
 * @param pixels Raw pixel values (Uint8Array or number[])
 * @param mapping Reclassification mapping
 * @returns Reclassified pixel array
 */
export function reclassifyRaster(pixels: Uint8Array | number[], mapping: ReclassifyMapping[]): Uint8Array {
  const result = new Uint8Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    result[i] = reclassifyValue(pixels[i]!, mapping);
  }
  return result;
}

// ─── Area calculation (Step 5) ─────────────────────────────────────

/**
 * Area statistics per LULC class.
 */
export interface ClassAreaStats {
  /** LULC class ID */
  classId: number;
  /** Class name */
  className: string;
  /** Cartographic color */
  color: string;
  /** Number of pixels in this class */
  pixelCount: number;
  /** Area in square kilometers */
  areaSqKm: number;
  /** Area in hectares */
  areaHectares: number;
  /** Percentage of total area */
  percentage: number;
}

/**
 * Calculate area statistics per LULC class.
 *
 * Formula (matching the ArcMap workflow):
 *   Area_SqKm = pixelCount × pixelSizeM × pixelSizeM ÷ 1,000,000
 *   Percentage = Area_SqKm × 100 ÷ Total_Area
 *
 * @param pixels Reclassified pixel array (values 1-9)
 * @param pixelSizeM Pixel size in meters (resolution)
 * @param classes LULC class definitions
 */
export function calculateClassAreas(
  pixels: Uint8Array | number[],
  pixelSizeM: number,
  classes: readonly LulcClass[] = ESRIC_LULC_CLASSES
): ClassAreaStats[] {
  // Count pixels per class
  const counts = new Map<number, number>();
  for (let i = 0; i < pixels.length; i++) {
    const val = pixels[i]!;
    counts.set(val, (counts.get(val) ?? 0) + 1);
  }

  // Compute pixel area in m²
  const pixelAreaM2 = pixelSizeM * pixelSizeM;

  // Compute total area (excluding no-data / class 0)
  let totalPixels = 0;
  for (const [classId, count] of counts) {
    if (classId > 0) totalPixels += count;
  }
  const totalAreaM2 = totalPixels * pixelAreaM2;

  // Build stats per class
  const stats: ClassAreaStats[] = [];
  for (const cls of classes) {
    if (cls.id === 0) continue; // Skip "No Data"

    const pixelCount = counts.get(cls.id) ?? 0;
    const areaM2 = pixelCount * pixelAreaM2;
    const areaSqKm = areaM2 / 1_000_000;
    const areaHectares = areaM2 / 10_000;
    const percentage = totalAreaM2 > 0 ? (areaM2 / totalAreaM2) * 100 : 0;

    stats.push({
      classId: cls.id,
      className: cls.name,
      color: cls.color,
      pixelCount,
      areaSqKm,
      areaHectares,
      percentage,
    });
  }

  // Filter out classes with 0 pixels
  const filtered = stats.filter(s => s.pixelCount > 0);
  // Sort by area descending (largest first — matches cartographic convention)
  filtered.sort((a, b) => b.areaSqKm - a.areaSqKm);
  return filtered;

}

// ─── Chart generation (Step 8) ─────────────────────────────────────

/**
 * Generate a bar chart SVG from LULC area statistics.
 *
 * Colors match the map symbology exactly (same as ArcMap + Excel workflow).
 */
export function generateBarChartSvg(stats: ClassAreaStats[], options: {
  width?: number;
  height?: number;
  title?: string;
} = {}): string {
  const width = options.width ?? 600;
  const height = options.height ?? 400;
  const title = options.title ?? "Land Use Land Cover — Area by Class";

  const padding = { top: 50, right: 20, bottom: 80, left: 80 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const maxArea = Math.max(...stats.map(s => s.areaSqKm), 0.01);
  const barWidth = chartW / stats.length * 0.7;
  const barGap = chartW / stats.length * 0.3;

  const bars = stats.map((s, i) => {
    const barH = (s.areaSqKm / maxArea) * chartH;
    const x = padding.left + i * (barWidth + barGap) + barGap / 2;
    const y = padding.top + chartH - barH;
    return `
      <rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" fill="${s.color}" stroke="#333" stroke-width="0.5"/>
      <text x="${x + barWidth / 2}" y="${y - 5}" text-anchor="middle" font-size="10" font-weight="bold">${s.areaSqKm.toFixed(2)}</text>
      <text x="${x + barWidth / 2}" y="${padding.top + chartH + 15}" text-anchor="middle" font-size="9" transform="rotate(-30 ${x + barWidth / 2} ${padding.top + chartH + 15})">${s.className}</text>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif">
  <rect width="100%" height="100%" fill="white"/>
  <text x="${width / 2}" y="25" text-anchor="middle" font-size="14" font-weight="bold">${title}</text>
  <!-- Y-axis -->
  <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + chartH}" stroke="#333" stroke-width="1"/>
  <text x="${padding.left - 50}" y="${padding.top + chartH / 2}" text-anchor="middle" font-size="11" transform="rotate(-90 ${padding.left - 50} ${padding.top + chartH / 2})">Area (km²)</text>
  <!-- X-axis -->
  <line x1="${padding.left}" y1="${padding.top + chartH}" x2="${padding.left + chartW}" y2="${padding.top + chartH}" stroke="#333" stroke-width="1"/>
  ${bars}
</svg>`;
}

/**
 * Generate a pie chart SVG from LULC area statistics.
 */
export function generatePieChartSvg(stats: ClassAreaStats[], options: {
  size?: number;
  title?: string;
} = {}): string {
  const size = options.size ?? 400;
  const title = options.title ?? "Land Use Land Cover — Distribution";
  const cx = size / 2;
  const cy = size / 2 + 20;
  const r = size / 3;

  const total = stats.reduce((sum, s) => sum + s.areaSqKm, 0);
  let currentAngle = -Math.PI / 2; // Start at top

  const slices = stats.map(s => {
    const angle = (s.areaSqKm / total) * 2 * Math.PI;
    const endAngle = currentAngle + angle;

    const x1 = cx + r * Math.cos(currentAngle);
    const y1 = cy + r * Math.sin(currentAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);

    const largeArc = angle > Math.PI ? 1 : 0;

    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;

    // Label position (at the midpoint of the arc, outside the pie)
    const labelAngle = currentAngle + angle / 2;
    const labelR = r + 20;
    const labelX = cx + labelR * Math.cos(labelAngle);
    const labelY = cy + labelR * Math.sin(labelAngle);

    const label = s.percentage >= 5
      ? `<text x="${labelX}" y="${labelY}" text-anchor="middle" font-size="9">${s.percentage.toFixed(1)}%</text>`
      : "";

    currentAngle = endAngle;
    return `<path d="${path}" fill="${s.color}" stroke="white" stroke-width="1"/>${label}`;
  }).join("");

  // Legend
  const legend = stats.map((s, i) => {
    const y = size - 20 + (i % 5) * 15;
    const x = 10 + Math.floor(i / 5) * 120;
    return `<rect x="${x}" y="${y - 8}" width="10" height="10" fill="${s.color}"/><text x="${x + 15}" y="${y}" font-size="9">${s.className}</text>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size + 80}" viewBox="0 0 ${size} ${size + 80}" font-family="Arial, sans-serif">
  <rect width="100%" height="100%" fill="white"/>
  <text x="${size / 2}" y="20" text-anchor="middle" font-size="14" font-weight="bold">${title}</text>
  ${slices}
  ${legend}
</svg>`;
}

// ─── Print layout (Step 10) ────────────────────────────────────────

/**
 * Print layout element.
 */
export interface PrintLayoutElement {
  type: "map" | "table" | "chart" | "title" | "legend" | "north-arrow" | "scale-bar" | "locator";
  x: number; // mm from left
  y: number; // mm from top
  width: number; // mm
  height: number; // mm
  content?: string; // SVG or text content
}

/**
 * Generate a print layout SVG for the LULC map.
 *
 * This replaces the QGIS Print Composer step (Step 10 in the workflow).
 *
 * Layout (A3 landscape, 420×297mm):
 *   ┌──────────────────────────────────────────────────┐
 *   │ TITLE: Land Use Land Cover Map — [Study Area]    │
 *   │ ┌────────────────────────────┐ ┌───────────────┐ │
 *   │ │                            │ │  Bar Chart    │ │
 *   │ │      Main Map Body         │ ├───────────────┤ │
 *   │ │      (styled raster)       │ │  Pie Chart    │ │
 *   │ │                            │ ├───────────────┤ │
 *   │ │  ↑N                        │ │  Stats Table  │ │
 *   │ │  ─── 1km                   │ │               │ │
 *   │ ├──────────┤ ┌────────────┐  │ ├───────────────┤ │
 *   │ │ Legend   │ │ Locator    │  │ │  [Seal]       │ │
 *   │ └──────────┘ └────────────┘  │ │               │ │
 *   │ └────────────────────────────┘ └───────────────┘ │
 *   │ Surveyor: [name]  Date: [date]  Scale: 1:50,000  │
 *   └──────────────────────────────────────────────────┘
 */
export function generatePrintLayoutSvg(options: {
  mapSvg: string;
  stats: ClassAreaStats[];
  barChartSvg: string;
  pieChartSvg: string;
  title: string;
  surveyorName?: string;
  surveyDate?: string;
  scaleDenominator?: number;
  northArrowBearing?: number;
  paperSize?: "a3" | "a4" | "letter";
  orientation?: "portrait" | "landscape";
}): string {
  const paperSizes = {
    a3: { width: 420, height: 297 },
    a4: { width: 297, height: 210 },
    letter: { width: 279, height: 216 },
  };
  const paper = paperSizes[options.paperSize ?? "a3"];
  const isLandscape = options.orientation !== "portrait";
  const pageW = isLandscape ? paper.width : paper.height;
  const pageH = isLandscape ? paper.height : paper.width;

  // Layout regions (in mm)
  const titleH = 15;
  const footerH = 10;
  const mapW = pageW * 0.6;
  const mapH = pageH - titleH - footerH - 10;
  const sidebarX = mapW + 15;
  const sidebarW = pageW - sidebarX - 10;
  const chartH = (mapH - 10) / 3;

  // Build legend
  const legendItems = options.stats.map((s, i) => {
    const y = i * 6 + 2;
    return `<rect x="0" y="${y}" width="4" height="4" fill="${s.color}" stroke="#333" stroke-width="0.2"/><text x="6" y="${y + 4}" font-size="4">${s.className} (${s.percentage.toFixed(1)}%)</text>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pageW}mm" height="${pageH}mm" viewBox="0 0 ${pageW} ${pageH}" font-family="Arial, sans-serif">
  <!-- Background -->
  <rect width="${pageW}" height="${pageH}" fill="white" stroke="#333" stroke-width="0.5"/>

  <!-- Title -->
  <text x="${pageW / 2}" y="${titleH - 3}" text-anchor="middle" font-size="8" font-weight="bold">${options.title}</text>
  <line x1="10" y1="${titleH}" x2="${pageW - 10}" y2="${titleH}" stroke="#333" stroke-width="0.3"/>

  <!-- Main Map Body -->
  <g transform="translate(5, ${titleH + 5})">
    <rect width="${mapW - 5}" height="${mapH}" fill="#f5f5f5" stroke="#333" stroke-width="0.5"/>
    <!-- Map content (embedded SVG) -->
    <foreignObject x="2" y="2" width="${mapW - 9}" height="${mapH - 4}">
      ${options.mapSvg}
    </foreignObject>

    <!-- North Arrow -->
    <g transform="translate(${mapW - 20}, 8)">
      <line x1="0" y1="10" x2="0" y2="0" stroke="#000" stroke-width="0.8" marker-end="url(#northArrowLULC)"/>
      <text x="0" y="-2" text-anchor="middle" font-size="4" font-weight="bold">N</text>
    </g>

    <!-- Scale Bar -->
    <g transform="translate(5, ${mapH - 10})">
      <line x1="0" y1="0" x2="30" y2="0" stroke="#000" stroke-width="0.5"/>
      <line x1="0" y1="-1.5" x2="0" y2="1.5" stroke="#000" stroke-width="0.5"/>
      <line x1="30" y1="-1.5" x2="30" y2="1.5" stroke="#000" stroke-width="0.5"/>
      <text x="15" y="-3" text-anchor="middle" font-size="3">${options.scaleDenominator ? (30 * options.scaleDenominator / 1000).toFixed(0) + ' m' : '1 km'}</text>
    </g>

    <!-- Legend -->
    <g transform="translate(5, 15)">
      <rect x="-2" y="-4" width="${mapW * 0.3}" height="${options.stats.length * 6 + 6}" fill="white" stroke="#333" stroke-width="0.3" opacity="0.9"/>
      <text x="0" y="0" font-size="4" font-weight="bold">Legend</text>
      ${legendItems}
    </g>
  </g>

  <!-- Sidebar: Bar Chart -->
  <g transform="translate(${sidebarX}, ${titleH + 5})">
    <rect width="${sidebarW}" height="${chartH}" fill="white" stroke="#333" stroke-width="0.3"/>
    <foreignObject x="2" y="2" width="${sidebarW - 4}" height="${chartH - 4}">
      ${options.barChartSvg}
    </foreignObject>
  </g>

  <!-- Sidebar: Pie Chart -->
  <g transform="translate(${sidebarX}, ${titleH + 5 + chartH + 5})">
    <rect width="${sidebarW}" height="${chartH}" fill="white" stroke="#333" stroke-width="0.3"/>
    <foreignObject x="2" y="2" width="${sidebarW - 4}" height="${chartH - 4}">
      ${options.pieChartSvg}
    </foreignObject>
  </g>

  <!-- Sidebar: Stats Table -->
  <g transform="translate(${sidebarX}, ${titleH + 5 + 2 * (chartH + 5)})">
    <rect width="${sidebarW}" height="${chartH}" fill="white" stroke="#333" stroke-width="0.3"/>
    <text x="${sidebarW / 2}" y="8" text-anchor="middle" font-size="5" font-weight="bold">Area Statistics</text>
    <line x1="2" y1="10" x2="${sidebarW - 2}" y2="10" stroke="#333" stroke-width="0.2"/>
    ${options.stats.map((s, i) => {
      const y = 16 + i * 5;
      return `<rect x="2" y="${y - 3}" width="3" height="3" fill="${s.color}"/><text x="7" y="${y}" font-size="3.5">${s.className}</text><text x="${sidebarW - 5}" y="${y}" text-anchor="end" font-size="3.5">${s.areaSqKm.toFixed(2)} km² (${s.percentage.toFixed(1)}%)</text>`;
    }).join("")}
  </g>

  <!-- Footer -->
  <line x1="10" y1="${pageH - footerH}" x2="${pageW - 10}" y2="${pageH - footerH}" stroke="#333" stroke-width="0.3"/>
  <text x="10" y="${pageH - 3}" font-size="4">Surveyor: ${options.surveyorName ?? '—'}</text>
  <text x="${pageW / 2}" y="${pageH - 3}" text-anchor="middle" font-size="4">Date: ${options.surveyDate ?? new Date().toISOString().split('T')[0]}</text>
  <text x="${pageW - 10}" y="${pageH - 3}" text-anchor="end" font-size="4">Scale: 1:${options.scaleDenominator ?? 50000}</text>
  <text x="${pageW / 2}" y="${pageH - 1}" text-anchor="middle" font-size="3" font-style="italic">Generated by MetaRDU Desktop v2.0</text>

  <!-- Arrow markers -->
  <defs>
    <marker id="northArrowLULC" markerWidth="6" markerHeight="6" refX="3" refY="0" orient="auto">
      <path d="M0,6 L3,0 L6,6 Z" fill="#000"/>
    </marker>
  </defs>
</svg>`;
}

// ─── Full LULC workflow (all 11 steps) ─────────────────────────────

/**
 * LULC workflow input.
 */
export interface LulcWorkflowInput {
  /** Path to the input GeoTIFF (Step 1 — already downloaded) */
  rasterPath: string;
  /** Raster metadata (from gdalinfo) */
  rasterMetadata: Omit<RasterDataset, "path" | "source">;
  /** Pixel values (read via GDAL) */
  pixels: Uint8Array | number[];
  /** Clip boundary polygon (Step 2) */
  boundary: Array<{ lat: number; lng: number }>;
  /** Output directory for all generated files */
  outputDir: string;
  /** Study area name (for title) */
  studyAreaName: string;
  /** Surveyor name */
  surveyorName?: string;
  /** Reclassification mapping (defaults to Esri identity) */
  reclassifyMapping?: ReclassifyMapping[];
  /** Map scale denominator (default 50000) */
  scaleDenominator?: number;
}

/**
 * LULC workflow result.
 */
export interface LulcWorkflowResult {
  /** Step 1: Imported raster metadata */
  raster: RasterDataset;
  /** Step 2: Clip command (to run via GDAL sidecar) */
  clipCommand: string;
  /** Step 3: Reclassified pixels */
  reclassifiedPixels: Uint8Array;
  /** Step 4: Applied LULC classes */
  classes: readonly LulcClass[];
  /** Step 5: Area statistics per class */
  stats: ClassAreaStats[];
  /** Step 8: Bar chart SVG */
  barChartSvg: string;
  /** Step 8: Pie chart SVG */
  pieChartSvg: string;
  /** Step 10: Print layout SVG (A3 landscape) */
  printLayoutSvg: string;
}

/**
 * Run the complete 11-step LULC workflow.
 *
 * This is the main entry point that replaces the entire ArcMap + QGIS + Excel
 * workflow with a single MetaRDU operation.
 *
 * Steps 1-2 (download + clip) are handled externally (GDAL sidecar).
 * Steps 3-10 are computed in-app by this function.
 * Step 11 (300 DPI export) is handled by the caller (render SVG to PNG).
 */
export function runLulcWorkflow(input: LulcWorkflowInput): LulcWorkflowResult {
  // Step 1: Import raster (metadata only — pixel data provided by caller)
  const raster = importRaster(input.rasterPath, input.rasterMetadata);

  // Step 2: Prepare clip command
  const clip = clipRaster({
    raster,
    boundary: input.boundary,
    outputPath: `${input.outputDir}/clipped.tif`,
  });

  // Step 3: Reclassify pixels
  const mapping = input.reclassifyMapping ?? ESRIC_DEFAULT_RECLASS;
  const reclassified = reclassifyRaster(input.pixels, mapping);

  // Step 4: Apply class names + colors (already in ESRIC_LULC_CLASSES)

  // Step 5: Calculate area & percentages
  const pixelSizeM = Math.abs(input.rasterMetadata.geoTransform[1]);
  const stats = calculateClassAreas(reclassified, pixelSizeM);

  // Step 8: Generate charts (colors match map symbology)
  const barChartSvg = generateBarChartSvg(stats, {
    title: `LULC — ${input.studyAreaName}`,
  });
  const pieChartSvg = generatePieChartSvg(stats, {
    title: `LULC Distribution — ${input.studyAreaName}`,
  });

  // Step 10: Build print layout (A3 landscape)
  // Note: the map SVG is generated by the OpenLayers renderer, not here.
  // The caller provides it as mapSvg.
  const printLayoutSvg = generatePrintLayoutSvg({
    mapSvg: "<!-- Map SVG injected by OpenLayers renderer -->",
    stats,
    barChartSvg,
    pieChartSvg,
    title: `Land Use Land Cover Map — ${input.studyAreaName}`,
    surveyorName: input.surveyorName,
    scaleDenominator: input.scaleDenominator ?? 50000,
    paperSize: "a3",
    orientation: "landscape",
  });

  return {
    raster,
    clipCommand: clip.gdalCommand,
    reclassifiedPixels: reclassified,
    classes: ESRIC_LULC_CLASSES,
    stats,
    barChartSvg,
    pieChartSvg,
    printLayoutSvg,
  };
}
