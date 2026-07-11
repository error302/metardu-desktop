/**
 * METARDU Longitudinal Section DXF Export
 *
 * Generates an engineering drawing of a road or pipeline profile.
 * Features:
 * - Exaggerated vertical scale (e.g. H 1:1000, V 1:100)
 * - Ground profile line
 * - Design formation profile line
 * - Data bands: Chainage, Ground RL, Formation RL, Cut/Fill
 * - Grid lines
 */

import Drawing from 'dxf-writer'
import { initialiseSokDXFLayers, DXF_LAYERS } from '@/lib/drawing/dxfLayers'

export interface ProfilePoint {
  chainage: number
  groundRL: number
  formationRL: number | null
}

export interface LongSectionOptions {
  projectName?: string
  horizontalScale?: number // e.g. 1000 for 1:1000
  verticalScale?: number   // e.g. 100 for 1:100
  datum?: number           // Base elevation for the grid
  bandHeight?: number
}

export function generateLongSectionDXF(
  points: ProfilePoint[],
  options?: LongSectionOptions
): string {
  if (!points || points.length === 0) return ''

  const drawing = new Drawing()
  initialiseSokDXFLayers(drawing)
  drawing.setUnits('Meters')

  const hzScale = options?.horizontalScale ?? 1000
  const vtScale = options?.verticalScale ?? 100
  // Vertical Exaggeration
  const ve = hzScale / vtScale

  // Determine bounds
  let minChainage = points[0].chainage
  let maxChainage = points[0].chainage
  let minRL = points[0].groundRL
  let maxRL = points[0].groundRL

  for (const p of points) {
    if (p.chainage < minChainage) minChainage = p.chainage
    if (p.chainage > maxChainage) maxChainage = p.chainage
    if (p.groundRL < minRL) minRL = p.groundRL
    if (p.groundRL > maxRL) maxRL = p.groundRL
    if (p.formationRL !== null) {
      if (p.formationRL < minRL) minRL = p.formationRL
      if (p.formationRL > maxRL) maxRL = p.formationRL
    }
  }

  // Set datum just below minimum RL
  const datum = options?.datum ?? Math.floor(minRL / 5) * 5 - 5

  const bandHeight = options?.bandHeight ?? 15
  const startX = 0
  const startY = 0

  // ─── Draw Data Bands (Grid Frame) ──────────────────────────────────────────
  drawing.setActiveLayer(DXF_LAYERS.TITLE_BLK.name)

  const sectionWidth = maxChainage - minChainage
  const sectionRightX = startX + sectionWidth

  // Base lines for bands
  const bands = [
    { title: 'CUT / FILL', y: startY },
    { title: 'FORMATION LEVEL', y: startY + bandHeight },
    { title: 'GROUND LEVEL', y: startY + bandHeight * 2 },
    { title: 'CHAINAGE', y: startY + bandHeight * 3 },
  ]
  const topOfBands = startY + bandHeight * 4

  for (const band of bands) {
    drawing.drawLine(startX, band.y, sectionRightX, band.y)
    // Left header box
    drawing.drawLine(startX - 40, band.y, startX, band.y)
    drawing.drawText(startX - 38, band.y + bandHeight / 2 - 1, 2.0, 0, band.title)
  }
  drawing.drawLine(startX - 40, topOfBands, sectionRightX, topOfBands) // Top of bands
  
  // Vertical borders for bands
  drawing.drawLine(startX - 40, startY, startX - 40, topOfBands)
  drawing.drawLine(startX, startY, startX, topOfBands)
  drawing.drawLine(sectionRightX, startY, sectionRightX, topOfBands)

  // Datum line
  drawing.drawText(startX - 38, topOfBands + 2, 2.0, 0, `DATUM: ${datum.toFixed(2)} m`)
  drawing.drawLine(startX - 40, topOfBands, startX - 40, topOfBands + 10)

  // ─── Draw Grid Lines and Band Text ─────────────────────────────────────────
  drawing.setActiveLayer(DXF_LAYERS.GRID.name)

  for (const p of points) {
    const x = startX + (p.chainage - minChainage)
    
    // Vertical grid line (from top of bands up to ground/formation)
    const yGround = topOfBands + (p.groundRL - datum) * ve
    let yForm = yGround
    if (p.formationRL !== null) {
      yForm = topOfBands + (p.formationRL - datum) * ve
    }
    const maxY = Math.max(yGround, yForm) + 10
    drawing.drawLine(x, startY, x, maxY)

    // Text in bands
    drawing.setActiveLayer(DXF_LAYERS.NOTES_TXT.name)
    
    // Chainage
    drawing.drawText(x + 1, bands[3].y + bandHeight / 2 - 1, 1.8, 90, p.chainage.toFixed(3))
    
    // Ground
    drawing.drawText(x + 1, bands[2].y + bandHeight / 2 - 1, 1.8, 90, p.groundRL.toFixed(3))
    
    // Formation
    if (p.formationRL !== null) {
      drawing.drawText(x + 1, bands[1].y + bandHeight / 2 - 1, 1.8, 90, p.formationRL.toFixed(3))
      
      // Cut/Fill
      const diff = p.formationRL - p.groundRL
      if (Math.abs(diff) > 0.001) {
        const cfText = diff > 0 ? `F ${diff.toFixed(3)}` : `C ${Math.abs(diff).toFixed(3)}`
        drawing.drawText(x + 1, bands[0].y + bandHeight / 2 - 1, 1.8, 90, cfText)
      }
    }
    drawing.setActiveLayer(DXF_LAYERS.GRID.name)
  }

  // Horizontal Grid Lines (Elevation)
  drawing.setActiveLayer(DXF_LAYERS.GRID.name)
  const maxEl = Math.ceil(maxRL / 5) * 5
  for (let el = datum; el <= maxEl + 5; el += 5) {
    const y = topOfBands + (el - datum) * ve
    drawing.drawLine(startX - 5, y, sectionRightX + 5, y)
    drawing.setActiveLayer(DXF_LAYERS.NOTES_TXT.name)
    drawing.drawText(startX - 15, y - 1, 1.8, 0, `${el.toFixed(1)}`)
    drawing.drawText(sectionRightX + 2, y - 1, 1.8, 0, `${el.toFixed(1)}`)
    drawing.setActiveLayer(DXF_LAYERS.GRID.name)
  }

  // ─── Draw Profiles ────────────────────────────────────────────────────────
  
  // Ground Profile
  drawing.setActiveLayer(DXF_LAYERS.EXIST_BDY.name) // Use OLD_BOUNDARY or a dedicated ground layer
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]
    const p2 = points[i + 1]
    const x1 = startX + (p1.chainage - minChainage)
    const y1 = topOfBands + (p1.groundRL - datum) * ve
    const x2 = startX + (p2.chainage - minChainage)
    const y2 = topOfBands + (p2.groundRL - datum) * ve
    drawing.drawLine(x1, y1, x2, y2)
  }

  // Formation Profile
  drawing.setActiveLayer(DXF_LAYERS.PROFILE.name)
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]
    const p2 = points[i + 1]
    if (p1.formationRL !== null && p2.formationRL !== null) {
      const x1 = startX + (p1.chainage - minChainage)
      const y1 = topOfBands + (p1.formationRL - datum) * ve
      const x2 = startX + (p2.chainage - minChainage)
      const y2 = topOfBands + (p2.formationRL - datum) * ve
      drawing.drawLine(x1, y1, x2, y2)
    }
  }

  // ─── Title ──────────────────────────────────────────────────────────────
  drawing.setActiveLayer(DXF_LAYERS.TITLE_BLK.name)
  const titleY = topOfBands + (maxEl - datum) * ve + 30
  drawing.drawText(startX, titleY, 5.0, 0, options?.projectName ? `LONGITUDINAL SECTION: ${options.projectName}` : 'LONGITUDINAL SECTION')
  drawing.drawText(startX, titleY - 8, 2.5, 0, `SCALES — HORIZONTAL 1:${hzScale} | VERTICAL 1:${vtScale}`)

  return drawing.toDxfString()
}
