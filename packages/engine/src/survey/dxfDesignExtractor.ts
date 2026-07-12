/**
 * DXF Design Point Extractor — extract stakeout points from a DXF file
 *
 * PROBLEM
 * -------
 * The existing parseDXF.ts produces building data (floors, walls, rooms) —
 * not survey points. For setting-out, we need to extract DesignPoints
 * (id, easting, northing, RL, target height, description) from DXF
 * entities: POINT, LINE endpoints, CIRCLE centers, INSERT positions,
 * TEXT/MTEXT positions.
 *
 * This module does a lightweight raw DXF parse focused on coordinate
 * extraction, bypassing the building-extraction pipeline.
 *
 * USAGE
 * -----
 *   import { extractDesignPointsFromDXF } from '@/lib/survey/dxfDesignExtractor'
 *
 *   const points = extractDesignPointsFromDXF(dxfString, {
 *     layerFilter: ['STAKEOUT', 'SETTING-OUT'],
 *     defaultRL: 0,
 *     defaultTH: 2.0,
 *   })
 */

import type { DesignPoint } from '@/lib/computations/settingOutEngine'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DXFExtractionOptions {
  /** Only extract points from these layers (case-insensitive). Empty = all layers. */
  layerFilter?: string[]
  /** Default reduced level if not specified in the DXF (meters) */
  defaultRL?: number
  /** Default target height for setting out (meters) */
  defaultTH?: number
  /** Prefix for auto-generated point IDs */
  idPrefix?: string
}

export interface DXFExtractionResult {
  points: DesignPoint[]
  warnings: string[]
  layersFound: string[]
  entitiesScanned: number
}

// ─── DXF Entity Types ───────────────────────────────────────────────────────

interface DXFEntity {
  type: string
  layer: string
  x: number
  y: number
  z: number
  x2?: number  // for LINE endpoints
  y2?: number
  z2?: number
  text?: string  // for TEXT/MTEXT
  radius?: number  // for CIRCLE
  handle?: string
}

/**
 * Parse raw DXF content into entities.
 *
 * DXF is a tag-value format: odd lines are group codes (numbers),
 * even lines are values. We scan for entity sections (POINT, LINE,
 * CIRCLE, INSERT, TEXT, MTEXT) and extract coordinates.
 */
function parseDXFEntities(content: string): { entities: DXFEntity[]; layers: Set<string> } {
  const lines = content.split(/\r?\n/).map(l => l.trim())
  const entities: DXFEntity[] = []
  const layers = new Set<string>()

  let inEntitiesSection = false
  let currentEntity: Partial<DXFEntity> | null = null

  // DXF is strictly alternating: group code (line N), value (line N+1)
  let i = 0
  while (i < lines.length - 1) {
    const groupCodeStr = lines[i]
    const value = lines[i + 1]
    i += 2

    const groupCode = parseInt(groupCodeStr, 10)
    if (isNaN(groupCode)) continue

    // Section detection (group code 2 = name)
    if (groupCode === 2) {
      if (value === 'ENTITIES') {
        inEntitiesSection = true
        continue
      }
      if (value === 'ENDSEC') {
        // Save last entity before leaving section
        if (currentEntity && currentEntity.type) {
          entities.push(currentEntity as DXFEntity)
        }
        currentEntity = null
        inEntitiesSection = false
        continue
      }
    }

    // Entity type (group code 0)
    if (groupCode === 0) {
      // Save previous entity
      if (currentEntity && currentEntity.type) {
        entities.push(currentEntity as DXFEntity)
      }

      if (['POINT', 'LINE', 'CIRCLE', 'INSERT', 'TEXT', 'MTEXT'].includes(value)) {
        currentEntity = { type: value, layer: '0', x: 0, y: 0, z: 0 }
      } else {
        currentEntity = null
      }
      continue
    }

    if (!inEntitiesSection || !currentEntity) continue

    // Parse entity properties based on group code
    switch (groupCode) {
      case 8: // Layer name
        currentEntity.layer = value
        layers.add(value)
        break
      case 10: // X coordinate (primary point)
        currentEntity.x = parseFloat(value) || 0
        break
      case 20: // Y coordinate (primary point)
        currentEntity.y = parseFloat(value) || 0
        break
      case 30: // Z coordinate (primary point)
        currentEntity.z = parseFloat(value) || 0
        break
      case 11: // X coordinate (second point for LINE)
        currentEntity.x2 = parseFloat(value) || 0
        break
      case 21: // Y coordinate (second point for LINE)
        currentEntity.y2 = parseFloat(value) || 0
        break
      case 31: // Z coordinate (second point for LINE)
        currentEntity.z2 = parseFloat(value) || 0
        break
      case 40: // Radius (CIRCLE) or height (TEXT)
        if (currentEntity.type === 'CIRCLE') {
          currentEntity.radius = parseFloat(value) || 0
        }
        break
      case 1: // Text content (TEXT/MTEXT)
        currentEntity.text = value
        break
      case 5: // Entity handle (unique ID)
        currentEntity.handle = value
        break
    }
  }

  // Save last entity (if file didn't end with ENDSEC)
  if (currentEntity && currentEntity.type) {
    entities.push(currentEntity as DXFEntity)
  }

  return { entities, layers }
}

/**
 * Extract design points from a DXF file string.
 *
 * Extracts from:
 *   - POINT entities → single point
 *   - LINE entities → two points (start + end)
 *   - CIRCLE entities → center point
 *   - INSERT entities → insertion point
 *   - TEXT/MTEXT → point at text position, text used as description
 *
 * @param dxfContent - Raw DXF file content as a string
 * @param options - Extraction options
 * @returns DesignPoint[] ready for computeSettingOut()
 */
export function extractDesignPointsFromDXF(
  dxfContent: string,
  options: DXFExtractionOptions = {},
): DXFExtractionResult {
  const {
    layerFilter = [],
    defaultRL = 0,
    defaultTH = 2.0,
    idPrefix = 'PT',
  } = options

  const warnings: string[] = []
  const { entities, layers } = parseDXFEntities(dxfContent)

  if (entities.length === 0) {
    warnings.push('No entities found in DXF. Ensure the file contains a valid ENTITIES section.')
    return { points: [], warnings, layersFound: Array.from(layers), entitiesScanned: 0 }
  }

  // Filter by layer if specified
  const layerFilterLower = layerFilter.map(l => l.toLowerCase())
  const filteredEntities = layerFilterLower.length > 0
    ? entities.filter(e => layerFilterLower.includes(e.layer.toLowerCase()))
    : entities

  if (layerFilterLower.length > 0 && filteredEntities.length === 0) {
    warnings.push(`No entities found on layers: ${layerFilter.join(', ')}. Available layers: ${Array.from(layers).join(', ')}`)
  }

  // Convert entities to DesignPoints
  const points: DesignPoint[] = []
  let pointNum = 1

  for (const entity of filteredEntities) {
    const baseId = entity.handle || `${idPrefix}${String(pointNum).padStart(3, '0')}`

    switch (entity.type) {
      case 'POINT':
      case 'INSERT':
        points.push({
          id: baseId,
          e: entity.x,
          n: entity.y,
          rl: entity.z || defaultRL,
          th: defaultTH,
          description: entity.text || `${entity.type} on ${entity.layer}`,
        })
        pointNum++
        break

      case 'LINE':
        // Start point
        points.push({
          id: `${baseId}-A`,
          e: entity.x,
          n: entity.y,
          rl: entity.z || defaultRL,
          th: defaultTH,
          description: `Line start on ${entity.layer}`,
        })
        pointNum++
        // End point
        if (entity.x2 !== undefined && entity.y2 !== undefined) {
          points.push({
            id: `${baseId}-B`,
            e: entity.x2,
            n: entity.y2,
            rl: entity.z2 || defaultRL,
            th: defaultTH,
            description: `Line end on ${entity.layer}`,
          })
          pointNum++
        }
        break

      case 'CIRCLE':
        points.push({
          id: baseId,
          e: entity.x,
          n: entity.y,
          rl: entity.z || defaultRL,
          th: defaultTH,
          description: `Circle center${entity.radius ? ` (r=${entity.radius.toFixed(3)})` : ''} on ${entity.layer}`,
        })
        pointNum++
        break

      case 'TEXT':
      case 'MTEXT':
        if (entity.text) {
          points.push({
            id: baseId,
            e: entity.x,
            n: entity.y,
            rl: entity.z || defaultRL,
            th: defaultTH,
            description: entity.text,
          })
          pointNum++
        }
        break
    }
  }

  if (points.length === 0) {
    warnings.push('No coordinate-bearing entities (POINT, LINE, CIRCLE, INSERT, TEXT) found.')
  }

  return {
    points,
    warnings,
    layersFound: Array.from(layers),
    entitiesScanned: entities.length,
  }
}
