/**
 * METARDU Subdivision DXF Export
 *
 * Generates a DXF file for a subdivision plan using `dxf-writer`.
 * Follows the existing DXF export patterns in generateDXF.ts.
 *
 * Layers used:
 * - OLD_BOUNDARY: parent parcel boundary (dashed)
 * - NEW_BOUNDARY: lot boundaries (solid)
 * - LABELS: lot numbers and area labels
 * - ROAD_RESERVE: road corridor boundary and fill
 * - TITLEBLOCK: title block with survey metadata
 * - NORTH_ARROW: north arrow symbol
 */

import Drawing from 'dxf-writer'
import { initialiseSokDXFLayers, DXF_LAYERS } from '@/lib/drawing/dxfLayers'
import type { SubdivisionResult } from '@/types/subdivision'

/**
 * Generate a DXF string for the subdivision plan.
 */
export function generateSubdivisionDXF(
  result: SubdivisionResult,
  projectName: string,
  options?: {
    surveyorName?: string
    lrNumber?: string
    county?: string
    scale?: string
    date?: string
  }
): string {
  const drawing = new Drawing()
  initialiseSokDXFLayers(drawing)
  drawing.setUnits('Meters')

  drawing.addLineType('DASHED', 'Dashed', [-5.0, 2.5])
  drawing.addLineType('DASHDOT', 'DashDot', [-5.0, 2.5, 0.5, 2.5])

  const parent = result.parentParcel.vertices
  const n = parent.length

  // ─── Parent Boundary (OLD_BOUNDARY, dashed) ───────────────────────────
  // dxf-writer sets line type per-layer — recreate OLD_BOUNDARY with DASHED
  drawing.addLayer('OLD_BOUNDARY_DASH', Drawing.ACI.GREEN, 'DASHED')
  drawing.setActiveLayer('OLD_BOUNDARY_DASH')

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    drawing.drawLine(parent[i].easting, parent[i].northing, parent[j].easting, parent[j].northing)
  }

  // ─── Road Reserve (ROAD_RESERVE, dashed) ──────────────────────────────
  if (result.roadReserve && result.roadReserve.roadPolygon.length >= 3) {
    const rr = result.roadReserve
    // Add ROAD_RESERVE layer with DASHDOT linetype (ACI 30 = orange)
    drawing.addLayer('ROAD_RESERVE', 30, 'DASHDOT')
    drawing.setActiveLayer('ROAD_RESERVE')

    const rrVerts = rr.roadPolygon
    const m = rrVerts.length

    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m
      drawing.drawLine(
        rrVerts[i].easting, rrVerts[i].northing,
        rrVerts[j].easting, rrVerts[j].northing
      )
    }

    // Road reserve label
    drawing.setActiveLayer('LABELS')
    let rrCx = 0, rrCy = 0
    for (const p of rrVerts) {
      rrCx += p.easting
      rrCy += p.northing
    }
    rrCx /= m
    rrCy /= m

    drawing.drawText(
      rrCx,
      rrCy + 2,
      2.0,
      0,
      `ROAD RESERVE (${rr.width}m)`
    )
    drawing.drawText(
      rrCx,
      rrCy - 1,
      1.5,
      0,
      `${rr.areaHa.toFixed(4)} ha`
    )
  }

  // ─── Lot Boundaries (NEW_BOUNDARY, solid) ─────────────────────────────
  drawing.setActiveLayer(DXF_LAYERS.NEW_BOUNDARY.name)

  for (const lot of result.lots) {
    const vertices = lot.vertices
    const m = vertices.length

    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m
      drawing.drawLine(
        vertices[i].easting, vertices[i].northing,
        vertices[j].easting, vertices[j].northing
      )
    }

    // Draw lot number label at centroid
    drawing.setActiveLayer('LABELS')
    drawing.drawText(
      lot.centroid.easting,
      lot.centroid.northing + 2,
      2.0,
      0,
      `LOT ${lot.lotNumber}`
    )
    drawing.drawText(
      lot.centroid.easting,
      lot.centroid.northing - 1,
      1.5,
      0,
      `${lot.areaHa.toFixed(4)} ha`
    )
    drawing.setActiveLayer(DXF_LAYERS.NEW_BOUNDARY.name)
  }

  // ─── Area label for parent ─────────────────────────────────────────────
  drawing.setActiveLayer('LABELS')

  // Compute parent centroid using area-weighted (Shoelace-based) formula
  // Correct for non-convex polygons, unlike simple arithmetic mean
  let signedArea = 0;
  let cx6A = 0;
  let cy6A = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cross = parent[i].easting * parent[j].northing - parent[j].easting * parent[i].northing;
    signedArea += cross;
    cx6A += (parent[i].easting + parent[j].easting) * cross;
    cy6A += (parent[i].northing + parent[j].northing) * cross;
  }
  signedArea /= 2;
  const centroidE = signedArea !== 0 ? cx6A / (6 * signedArea) : parent.reduce((s, p) => s + p.easting, 0) / n;
  const centroidN = signedArea !== 0 ? cy6A / (6 * signedArea) : parent.reduce((s, p) => s + p.northing, 0) / n;

  drawing.drawText(
    centroidE,
    centroidN - 5,
    2.5,
    0,
    `Total: ${result.parentParcel.areaHa.toFixed(4)} ha`
  )
  drawing.drawText(
    centroidE,
    centroidN - 8,
    1.8,
    0,
    `${result.lots.length} Lots | Remainder: ${result.remainderAreaHa.toFixed(4)} ha`
  )

  // ─── North Arrow ───────────────────────────────────────────────────────
  drawing.setActiveLayer(DXF_LAYERS.NORTHARROW.name)
  const arrowX = centroidE + 20
  const arrowY = centroidN + 20
  drawing.drawLine(arrowX, arrowY - 10, arrowX, arrowY + 10)
  drawing.drawLine(arrowX, arrowY + 10, arrowX - 2, arrowY + 6)
  drawing.drawLine(arrowX, arrowY + 10, arrowX + 2, arrowY + 6)
  drawing.drawText(arrowX, arrowY + 13, 2.0, 0, 'N')

  // ─── Title Block ───────────────────────────────────────────────────────
  drawing.setActiveLayer(DXF_LAYERS.TITLEBLOCK.name)

  const date = options?.date ?? new Date().toISOString().split('T')[0]
  const titleBlockX = parent.reduce((min, p) => Math.min(min, p.easting), Infinity) - 5
  const titleBlockY = parent.reduce((min, p) => Math.min(min, p.northing), Infinity) - 15

  const titleRows: [number, string][] = [
    [0,    `REPUBLIC OF KENYA — SUBDIVISION PLAN`],
    [-3.5, `Project: ${projectName}`],
    [-7,   `Method: ${result.method.toUpperCase()}`],
    [-10.5,`Parent Area: ${result.parentParcel.areaHa.toFixed(4)} ha (${result.lots.length} Lots)`],
    [-14,  `LR No: ${options?.lrNumber ?? 'N/A'}`],
    [-17.5,`County: ${options?.county ?? 'N/A'}`],
    [-21,  `Surveyor: ${options?.surveyorName ?? 'N/A'}`],
    [-24.5,`Scale: ${options?.scale ?? 'As Noted'}`],
    [-28,  `Date: ${date}`],
    [-31.5,`Generated by METARDU Survey Platform`],
  ]

  for (const [yOffset, text] of titleRows) {
    drawing.drawText(
      titleBlockX,
      titleBlockY + yOffset,
      yOffset === 0 ? 2.5 : 1.8,
      0,
      text
    )
  }

  return drawing.toDxfString()
}

/**
 * Trigger a browser download of the subdivision DXF file.
 */
export function downloadSubdivisionDXF(
  result: SubdivisionResult,
  projectName: string,
  options?: {
    surveyorName?: string
    lrNumber?: string
    county?: string
    scale?: string
  }
): void {
  const dxfString = generateSubdivisionDXF(result, projectName, options)
  const blob = new Blob([dxfString], { type: 'application/dxf' })
  const url = URL.createObjectURL(blob)

  const date = new Date().toISOString().split('T')[0]
  const filename = `${projectName.replace(/\s+/g, '_')}_subdivision_${date}.dxf`

  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
