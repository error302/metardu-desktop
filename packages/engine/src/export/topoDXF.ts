/**
 * METARDU Topographic Auto-Draw DXF Export
 * Phase B3 — Topo Auto-Draw
 *
 * Takes feature-coded points and auto-generates a DXF plan with:
 * - Layers mapped from the feature code library
 * - Polylines joining sequential points of the same code
 * - Point symbols (blocks or basic CAD entities)
 * - Point labels (elevation / point number)
 */

import Drawing from 'dxf-writer'
import { KENYA_TOPO_CODES, FeatureCodeDef } from '@/lib/topo/featureCodes'
import { initialiseSokDXFLayers, DXF_LAYERS } from '@/lib/drawing/dxfLayers'

export interface TopoPoint {
  easting: number
  northing: number
  elevation?: number
  code?: string
  pointNumber?: string
}

export interface TopoAutoDrawOptions {
  projectName?: string
  drawElevations?: boolean
  drawPointNumbers?: boolean
  defaultLayer?: string
}

export function generateTopoDXF(
  points: TopoPoint[],
  options?: TopoAutoDrawOptions
): string {
  if (!points || points.length === 0) return ''

  const drawing = new Drawing()
  initialiseSokDXFLayers(drawing)
  drawing.setUnits('Meters')

  // Register linetypes
  drawing.addLineType('DASHED', 'Dashed', [-5.0, 2.5])
  drawing.addLineType('CENTER', 'Center', [10.0, -2.5, 2.5, -2.5])
  drawing.addLineType('DOTTED', 'Dotted', [0, -2.5])

  // Build code lookup map
  const codeMap = new Map<string, FeatureCodeDef>()
  for (const def of KENYA_TOPO_CODES) {
    codeMap.set(def.code.toUpperCase(), def)
  }

  // Register layers dynamically based on codes present
  const usedCodes = new Set<string>()
  for (const pt of points) {
    if (pt.code) {
      const baseCode = pt.code.split(/\s+/)[0].toUpperCase()
      usedCodes.add(baseCode)
    }
  }

  const registeredLayers = new Set<string>()
  for (const code of Array.from(usedCodes)) {
    const def = codeMap.get(code)
    if (def && !registeredLayers.has(def.dxfLayer)) {
      drawing.addLayer(def.dxfLayer, def.color, def.lineType)
      registeredLayers.add(def.dxfLayer)
    }
  }

  // Group points by code for polyline generation
  // Format: MAP<code, Array<Array<TopoPoint>>>
  // Some field practices use string suffixes (e.g., RD1, RD2) to separate multiple strings of the same code.
  const lineStrings = new Map<string, TopoPoint[]>()
  
  for (const pt of points) {
    if (!pt.code) continue

    // The raw code might be "RD 1" or "RD1"
    const parts = pt.code.trim().split(/\s+/)
    const rawCode = parts[0].toUpperCase()
    
    // Attempt to extract base code (e.g., RD from RD1)
    const match = rawCode.match(/^([A-Z\-]+)(\d*)$/)
    const baseCode = match ? match[1] : rawCode
    const stringId = rawCode // unique identifier for the string, e.g., RD1

    const def = codeMap.get(baseCode)
    if (!def) {
      // Fallback: draw as point on default layer
      drawPoint(drawing, pt, options?.defaultLayer ?? 'TOPO-UNKNOWN')
      continue
    }

    if (def.joinLines) {
      const arr = lineStrings.get(stringId) ?? []
      arr.push(pt)
      lineStrings.set(stringId, arr)
    } else {
      drawFeaturePoint(drawing, pt, def, options)
    }
  }

  // Draw Polylines
  for (const [stringId, pts] of Array.from(lineStrings.entries())) {
    const match = stringId.match(/^([A-Z\-]+)(\d*)$/)
    const baseCode = match ? match[1] : stringId
    const def = codeMap.get(baseCode)!

    drawing.setActiveLayer(def.dxfLayer)
    
    // Draw lines
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i]
      const p2 = pts[i + 1]
      drawing.drawLine(p1.easting, p1.northing, p2.easting, p2.northing)
    }

    // Draw individual symbols/labels if needed
    for (const pt of pts) {
      drawFeaturePoint(drawing, pt, def, options, false) // false = don't set layer again
    }
  }

  return drawing.toDxfString()
}

function drawFeaturePoint(
  drawing: Drawing,
  pt: TopoPoint,
  def: FeatureCodeDef,
  options?: TopoAutoDrawOptions,
  setLayer: boolean = true
) {
  if (setLayer) {
    drawing.setActiveLayer(def.dxfLayer)
  }

  const sSize = 1.0 // symbol size
  
  // Draw Symbol
  if (def.symbol === 'circle') {
    drawing.drawCircle(pt.easting, pt.northing, sSize / 2)
  } else if (def.symbol === 'square') {
    const r = sSize / 2
    drawing.drawLine(pt.easting - r, pt.northing - r, pt.easting + r, pt.northing - r)
    drawing.drawLine(pt.easting + r, pt.northing - r, pt.easting + r, pt.northing + r)
    drawing.drawLine(pt.easting + r, pt.northing + r, pt.easting - r, pt.northing + r)
    drawing.drawLine(pt.easting - r, pt.northing + r, pt.easting - r, pt.northing - r)
  } else if (def.symbol === 'cross') {
    const r = sSize / 2
    drawing.drawLine(pt.easting - r, pt.northing, pt.easting + r, pt.northing)
    drawing.drawLine(pt.easting, pt.northing - r, pt.easting, pt.northing + r)
  } else if (def.symbol === 'triangle') {
    const r = sSize / 2
    drawing.drawLine(pt.easting - r, pt.northing - r, pt.easting + r, pt.northing - r)
    drawing.drawLine(pt.easting + r, pt.northing - r, pt.easting, pt.northing + r)
    drawing.drawLine(pt.easting, pt.northing + r, pt.easting - r, pt.northing - r)
  } else {
    // just a small tick
    drawing.drawPoint(pt.easting, pt.northing)
  }

  // Draw Labels
  if (def.pointLabel || options?.drawElevations || options?.drawPointNumbers) {
    let label = ''
    if ((def.pointLabel || options?.drawElevations) && pt.elevation !== undefined) {
      label += pt.elevation.toFixed(2)
    }
    if ((def.pointLabel || options?.drawPointNumbers) && pt.pointNumber) {
      label += (label ? ' / ' : '') + pt.pointNumber
    }

    if (label) {
      // Put labels on a generic ANNOTATIONS layer to keep them manageable, or the same layer
      // For now we keep them on the feature layer but shifted slightly
      drawing.drawText(pt.easting + 1, pt.northing + 1, 1.0, 0, label)
    }
  }
}

function drawPoint(drawing: Drawing, pt: TopoPoint, layerName: string) {
  drawing.setActiveLayer(layerName)
  drawing.drawPoint(pt.easting, pt.northing)
  drawing.drawText(pt.easting + 1, pt.northing + 1, 1.0, 0, pt.code ?? '?')
}
