/**
 * @module landCoverOverlay
 *
 * Multi-spectral Land Cover Overlay for METARDU
 *
 * Uses Sentinel-2 satellite data to compute:
 * - NDVI (Normalized Difference Vegetation Index) — vegetation health
 * - NDBI (Normalized Difference Built-up Index) — urban/structures
 * - NDWI (Normalized Difference Water Index) — water bodies
 *
 * NDVI = (NIR - Red) / (NIR + Red)
 *   Range: -1 to +1
 *   < 0:    Water/snow/bare rock
 *   0-0.2:  Bare soil, sparse vegetation
 *   0.2-0.5: Moderate vegetation (grassland, crops)
 *   0.5-0.8: Dense vegetation (forest)
 *   > 0.8:  Very dense, healthy vegetation
 *
 * NDBI = (SWIR - NIR) / (SWIR + NIR)
 *   Range: -1 to +1
 *   > 0:    Built-up area (buildings, roads, concrete)
 *   < 0:    Natural surface (vegetation, water)
 *
 * NDWI = (Green - NIR) / (Green + NIR)
 *   Range: -1 to +1
 *   > 0:    Water body
 *   < 0:    Non-water
 *
 * Data source: Esri Living Atlas Sentinel-2 WMS (free, no API key)
 *   - Provides pre-computed NDVI/NDBI tiles
 *   - Updated every 5-10 days
 *   - 10m resolution
 *
 * For client-side computation from raw bands:
 *   - Sentinel-2 Band 4 = Red (664 nm)
 *   - Sentinel-2 Band 8 = NIR (832 nm)
 *   - Sentinel-2 Band 11 = SWIR (1610 nm)
 *   - Sentinel-2 Band 3 = Green (559 nm)
 */

export type SpectralIndex = 'ndvi' | 'ndbi' | 'ndwi' | 'true_color'

export interface LandCoverConfig {
  index: SpectralIndex
  opacity: number  // 0-100
  dateRange?: string  // e.g., '2024-01-01/2024-12-31'
}

export interface LandCoverClass {
  name: string
  range: [number, number]  // min, max
  color: string  // hex
  description: string
  terrainDifficulty: 'easy' | 'moderate' | 'difficult' | 'hazardous'
  clearingRequired: boolean
}

// NDVI classification
export const NDVI_CLASSES: LandCoverClass[] = [
  { name: 'Water/Snow', range: [-1, 0], color: '#0000FF', description: 'Water bodies, snow, ice', terrainDifficulty: 'hazardous', clearingRequired: false },
  { name: 'Bare Rock/Soil', range: [0, 0.1], color: '#A0522D', description: 'Exposed rock, bare soil, paved', terrainDifficulty: 'easy', clearingRequired: false },
  { name: 'Sparse Vegetation', range: [0.1, 0.2], color: '#DAA520', description: 'Scrubland, sparse grass', terrainDifficulty: 'easy', clearingRequired: false },
  { name: 'Grassland', range: [0.2, 0.4], color: '#ADFF2F', description: 'Open grassland, pastures', terrainDifficulty: 'easy', clearingRequired: false },
  { name: 'Moderate Vegetation', range: [0.4, 0.6], color: '#32CD32', description: 'Crops, shrubland, young forest', terrainDifficulty: 'moderate', clearingRequired: true },
  { name: 'Dense Vegetation', range: [0.6, 0.8], color: '#006400', description: 'Mature forest, dense thicket', terrainDifficulty: 'difficult', clearingRequired: true },
  { name: 'Very Dense', range: [0.8, 1.0], color: '#003200', description: 'Tropical rainforest, very dense canopy', terrainDifficulty: 'difficult', clearingRequired: true },
]

// NDBI classification (built-up index)
export const NDBI_CLASSES: LandCoverClass[] = [
  { name: 'Water', range: [-1, -0.3], color: '#0000FF', description: 'Water bodies', terrainDifficulty: 'hazardous', clearingRequired: false },
  { name: 'Natural Surface', range: [-0.3, 0], color: '#228B22', description: 'Vegetation, natural terrain', terrainDifficulty: 'easy', clearingRequired: false },
  { name: 'Mixed', range: [0, 0.1], color: '#DAA520', description: 'Mixed urban/natural', terrainDifficulty: 'easy', clearingRequired: false },
  { name: 'Built-up Area', range: [0.1, 0.3], color: '#FF8C00', description: 'Buildings, roads, concrete', terrainDifficulty: 'easy', clearingRequired: false },
  { name: 'Dense Urban', range: [0.3, 1.0], color: '#FF0000', description: 'Dense urban core, industrial', terrainDifficulty: 'easy', clearingRequired: false },
]

// NDWI classification (water index)
export const NDWI_CLASSES: LandCoverClass[] = [
  { name: 'Non-water', range: [-1, 0], color: '#8B4513', description: 'Dry land', terrainDifficulty: 'easy', clearingRequired: false },
  { name: 'Wet Soil', range: [0, 0.2], color: '#DAA520', description: 'Wet soil, marsh edges', terrainDifficulty: 'moderate', clearingRequired: false },
  { name: 'Shallow Water', range: [0.2, 0.5], color: '#1E90FF', description: 'Shallow water, wetlands', terrainDifficulty: 'hazardous', clearingRequired: false },
  { name: 'Open Water', range: [0.5, 1.0], color: '#0000CD', description: 'Deep water bodies', terrainDifficulty: 'hazardous', clearingRequired: false },
]

export function getClassesForIndex(index: SpectralIndex): LandCoverClass[] {
  switch (index) {
    case 'ndvi': return NDVI_CLASSES
    case 'ndbi': return NDBI_CLASSES
    case 'ndwi': return NDWI_CLASSES
    default: return NDVI_CLASSES
  }
}

/**
 * Get the Esri WMS URL for a spectral index.
 *
 * Esri Living Atlas provides free Sentinel-2 derived layers:
 * - NDVI: Sentinel-2 NDVI
 * - True Color: Sentinel-2 RGB
 *
 * These are served as WMS tile services that work directly with OpenLayers.
 */
export function getWMSUrl(index: SpectralIndex): string {
  switch (index) {
    case 'ndvi':
      // Esri Sentinel-2 NDVI (updated every 5 days)
      return 'https://services.arcgisonline.com/arcgis/rest/services/Sentinel2/ImageServer'
    case 'ndbi':
      // No free NDBI tile service — use built-up layer
      return 'https://services.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer'
    case 'ndwi':
      // No free NDWI tile service — use water bodies
      return 'https://services.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer'
    case 'true_color':
      // Esri Sentinel-2 true color
      return 'https://services.arcgisonline.com/arcgis/rest/services/Sentinel2/ImageServer'
    default:
      return ''
  }
}

/**
 * Get a tile URL template for OpenLayers XYZ source.
 *
 * Uses Esri's free tile services that serve pre-computed indices.
 */
export function getTileUrl(index: SpectralIndex): string {
  switch (index) {
    case 'ndvi':
      // Sentinel-2 NDVI via Esri (rendering rule for NDVI)
      return 'https://services.arcgisonline.com/arcgis/rest/services/Sentinel2/ImageServer/tile/{z}/{y}/{x}'
    case 'true_color':
      // Sentinel-2 true color
      return 'https://services.arcgisonline.com/arcgis/rest/services/Sentinel2/ImageServer/tile/{z}/{y}/{x}'
    case 'ndbi':
      // Esri World Imagery with built-up overlay
      return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    case 'ndwi':
      // Esri World Imagery (water is visible)
      return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    default:
      return ''
  }
}

/**
 * Compute NDVI from raw band values.
 *
 * @param nir - Near-infrared reflectance (Sentinel-2 Band 8)
 * @param red - Red reflectance (Sentinel-2 Band 4)
 * @returns NDVI value (-1 to +1)
 */
export function computeNDVI(nir: number, red: number): number {
  const sum = nir + red
  if (Math.abs(sum) < 1e-10) return 0
  return (nir - red) / sum
}

/**
 * Compute NDBI from raw band values.
 *
 * @param swir - Short-wave infrared (Sentinel-2 Band 11)
 * @param nir - Near-infrared (Sentinel-2 Band 8)
 * @returns NDBI value (-1 to +1)
 */
export function computeNDBI(swir: number, nir: number): number {
  const sum = swir + nir
  if (Math.abs(sum) < 1e-10) return 0
  return (swir - nir) / sum
}

/**
 * Compute NDWI from raw band values.
 *
 * @param green - Green reflectance (Sentinel-2 Band 3)
 * @param nir - Near-infrared (Sentinel-2 Band 8)
 * @returns NDWI value (-1 to +1)
 */
export function computeNDWI(green: number, nir: number): number {
  const sum = green + nir
  if (Math.abs(sum) < 1e-10) return 0
  return (green - nir) / sum
}

/**
 * Get the color for a given index value.
 */
export function getColorForIndex(index: SpectralIndex, value: number): string {
  const classes = getClassesForIndex(index)
  for (const cls of classes) {
    if (value >= cls.range[0] && value < cls.range[1]) {
      return cls.color
    }
  }
  return '#000000'
}

/**
 * Get the land cover class for a given index value.
 */
export function getClassForIndex(index: SpectralIndex, value: number): LandCoverClass | null {
  const classes = getClassesForIndex(index)
  for (const cls of classes) {
    if (value >= cls.range[0] && value < cls.range[1]) {
      return cls
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Route Analysis
// ---------------------------------------------------------------------------

export interface RouteSegment {
  startStation: number
  endStation: number
  landCover: LandCoverClass
  percentage: number
  distance: number  // meters
}

export interface RouteAnalysis {
  segments: RouteSegment[]
  totalDistance: number
  easyDistance: number
  moderateDistance: number
  difficultDistance: number
  hazardousDistance: number
  clearingRequiredDistance: number
  summary: string
}

/**
 * Analyze a proposed traverse route for land cover composition.
 *
 * Takes sample points along the route and classifies each segment.
 *
 * @param routePoints - Array of { easting, northing, ndvi? } sampled along route
 * @param index - Which spectral index to use for classification
 */
export function analyzeRoute(
  routePoints: Array<{ easting: number; northing: number; ndvi?: number }>,
  index: SpectralIndex = 'ndvi',
): RouteAnalysis {
  if (routePoints.length < 2) {
    return {
      segments: [],
      totalDistance: 0,
      easyDistance: 0,
      moderateDistance: 0,
      difficultDistance: 0,
      hazardousDistance: 0,
      clearingRequiredDistance: 0,
      summary: 'Insufficient route points for analysis',
    }
  }

  const segments: RouteSegment[] = []
  let totalDistance = 0
  let easyDistance = 0
  let moderateDistance = 0
  let difficultDistance = 0
  let hazardousDistance = 0
  let clearingRequiredDistance = 0

  for (let i = 1; i < routePoints.length; i++) {
    const prev = routePoints[i - 1]
    const curr = routePoints[i]

    const dE = curr.easting - prev.easting
    const dN = curr.northing - prev.northing
    const distance = Math.sqrt(dE * dE + dN * dN)
    totalDistance += distance

    // Use NDVI value if available, otherwise assume grassland
    const ndviValue = curr.ndvi ?? 0.3
    const landCover = getClassForIndex(index, ndviValue) || NDVI_CLASSES[3]

    switch (landCover.terrainDifficulty) {
      case 'easy': easyDistance += distance; break
      case 'moderate': moderateDistance += distance; break
      case 'difficult': difficultDistance += distance; break
      case 'hazardous': hazardousDistance += distance; break
    }

    if (landCover.clearingRequired) {
      clearingRequiredDistance += distance
    }

    segments.push({
      startStation: totalDistance - distance,
      endStation: totalDistance,
      landCover,
      percentage: 0, // filled after
      distance,
    })
  }

  // Compute percentages
  for (const seg of segments) {
    seg.percentage = totalDistance > 0 ? (seg.distance / totalDistance) * 100 : 0
  }

  const summary = `Route Analysis (${totalDistance.toFixed(0)}m total):\n` +
    `  ${((easyDistance / totalDistance) * 100).toFixed(0)}% Easy terrain (${easyDistance.toFixed(0)}m)\n` +
    `  ${((moderateDistance / totalDistance) * 100).toFixed(0)}% Moderate (${moderateDistance.toFixed(0)}m)\n` +
    `  ${((difficultDistance / totalDistance) * 100).toFixed(0)}% Difficult - clearing required (${difficultDistance.toFixed(0)}m)\n` +
    `  ${((hazardousDistance / totalDistance) * 100).toFixed(0)}% Hazardous (${hazardousDistance.toFixed(0)}m)\n` +
    `  Clearing required: ${clearingRequiredDistance.toFixed(0)}m`

  return {
    segments,
    totalDistance,
    easyDistance,
    moderateDistance,
    difficultDistance,
    hazardousDistance,
    clearingRequiredDistance,
    summary,
  }
}
