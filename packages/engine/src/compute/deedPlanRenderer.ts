import type { DeedPlanInput, BoundaryLeg, BoundaryPoint, ClosureCheck } from '@/types/deedPlan'
import { getBeaconSymbol } from './beaconSymbols'

/**
 * Enhanced Kenyan Deed Plan SVG Renderer
 * Compliant with Survey of Kenya standards and Kenya Survey Regulations 1994
 * Paper size: A1 (841 x 594mm)
 */

// ============================================================
// SECURITY: XML escaping for user-supplied strings
// ============================================================
// All user-supplied strings (surveyNumber, parcelNumber, county, etc.)
// MUST pass through escapeXml() before being interpolated into SVG.
// Without this, a malicious surveyor entering
// `</text><script>fetch('/api/db',{method:'POST',body:...})</script><text>`
// as a parcel number would execute arbitrary JS in every viewer's browser
// (stored XSS via deed plan SVG rendered with dangerouslySetInnerHTML).
function escapeXml(s: string): string {
  if (typeof s !== 'string') return ''
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ============================================================
// LAYOUT CONSTANTS (A1 Landscape: 841 x 594mm)
// ============================================================
const VB_W = 841
const VB_H = 594

// Double-line border
const OB_X = 0; const OB_Y = 0; const OB_SW = 2
const IB_X = 6; const IB_Y = 6; const IB_SW = 0.5

// Drawing area (left side)
const DA_LEFT = IB_X + 4
const DA_TOP = IB_Y + 4
const DA_WIDTH = 568
const DA_HEIGHT = VB_H - (IB_Y * 2) - 8
const TITLE_H = 34

// Right info panel
const RP_X = DA_LEFT + DA_WIDTH + 10
const RP_W = VB_W - RP_X - IB_X - 4

// ============================================================
// MAIN RENDER FUNCTION
// ============================================================
export function renderDeedPlanSVG(
  input: DeedPlanInput,
  bearingSchedule: BoundaryLeg[],
  closureCheck: ClosureCheck
): string {
  const { boundaryPoints, scale, utmZone, hemisphere } = input

  // ---- Coordinate projection ----
  const coords = boundaryPoints.map((p: any) => ({ x: p.easting, y: p.northing }))
  const minX = Math.min(...coords.map((c: any) => c.x))
  const maxX = Math.max(...coords.map((c: any) => c.x))
  const minY = Math.min(...coords.map((c: any) => c.y))
  const maxY = Math.max(...coords.map((c: any) => c.y))

  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1
  const pad = 55

  const effTop = DA_TOP + TITLE_H + 8
  const effH = DA_HEIGHT - TITLE_H - 30

  const sX = (DA_WIDTH - pad * 2) / rangeX
  const sY = (effH - pad * 2) / rangeY
  const plotScale = Math.min(sX, sY) * 0.78

  const cX = (minX + maxX) / 2
  const cY = (minY + maxY) / 2

  const toX = (e: number) => DA_LEFT + DA_WIDTH / 2 + (e - cX) * plotScale
  const toY = (n: number) => effTop + effH / 2 - (n - cY) * plotScale

  // Polygon string
  const poly = boundaryPoints.map((p: any) =>
    `${toX(p.easting).toFixed(2)},${toY(p.northing).toFixed(2)}`
  ).join(' ')

  // Build sub-elements
  const grid = buildGrid(toX, toY, minX, maxX, minY, maxY)
  const beacons = buildBeacons(boundaryPoints, toX, toY)
  const bLabels = buildBoundaryLabels(bearingSchedule, boundaryPoints, toX, toY)
  const abuttals = buildAbuttals(input, boundaryPoints, toX, toY)
  const ptLabels = buildPointLabels(boundaryPoints, toX, toY)
  const northArrow = buildNorthArrow(DA_LEFT + DA_WIDTH - 52, effTop + 38)
  const scaleBar = buildScaleBar(DA_LEFT + DA_WIDTH / 2 - 85, effTop + effH - 18, scale)
  const locDiagram = buildLocationDiagram(DA_LEFT + DA_WIDTH - 108, effTop + effH - 95)
  const titleBlock = buildTitleBlock(input)
  const rightPanel = buildRightPanel(input, bearingSchedule, closureCheck, boundaryPoints)

  const areaHa = input.area / 10000
  const areaAc = input.area / 4046.8564224
  const prec = closureCheck.precisionRatio.replace('\u221e', '&#8734;')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB_W} ${VB_H}" width="${VB_W}" height="${VB_H}" font-family="Arial, Helvetica, sans-serif">
  <defs>
    <style>
      .tm { font-size:14pt; font-weight:bold; font-family:Arial,sans-serif; letter-spacing:3px; }
      .sh { font-size:7pt; font-weight:bold; font-family:Arial,sans-serif; text-decoration:underline; }
      .th { font-size:5.5pt; font-weight:bold; font-family:'Courier New',monospace; }
      .tt { font-size:5.5pt; font-family:'Courier New',monospace; }
      .bt { font-size:6pt; font-family:Arial,sans-serif; }
      .st { font-size:4.5pt; font-family:Arial,sans-serif; }
      .lt { font-size:5pt; font-family:Arial,sans-serif; }
      .bi { font-size:5pt; font-weight:bold; font-family:Arial,sans-serif; }
      .at { font-size:4.5pt; font-style:italic; font-family:Arial,sans-serif; fill:#444; }
      .gl { font-size:3.5pt; font-family:'Courier New',monospace; fill:#999; }
    </style>
    <pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="4" stroke="#ddd" stroke-width="0.5"/>
    </pattern>
  </defs>

  <!-- ===================== 1. DOUBLE-LINE BORDER ===================== -->
  <rect x="0" y="0" width="${VB_W}" height="${VB_H}" fill="white"/>
  <rect x="${OB_X}" y="${OB_Y}" width="${VB_W}" height="${VB_H}" fill="none" stroke="black" stroke-width="${OB_SW}"/>
  <rect x="${IB_X}" y="${IB_Y}" width="${VB_W - IB_X*2}" height="${VB_H - IB_Y*2}" fill="none" stroke="black" stroke-width="${IB_SW}"/>

  <!-- Paper size -->
  <text x="${VB_W - IB_X - 5}" y="${IB_Y + 8}" class="st" text-anchor="end">PAPER SIZE: A1 (${VB_W} x ${VB_H}mm)</text>

  <!-- ===================== 2. TITLE BLOCK ===================== -->
  ${titleBlock}

  <!-- ===================== 5. COORDINATE GRID ===================== -->
  ${grid.lines}
  ${grid.labels}

  <!-- ===================== 6. BOUNDARY POLYGON ===================== -->
  <polygon points="${poly}" fill="#FEFCE8" stroke="black" stroke-width="1" stroke-linejoin="round"/>

  <!-- ===================== 11. ABUTTAL LABELS ===================== -->
  ${abuttals}

  <!-- ===================== 7&8. BEARING & DISTANCE LABELS ===================== -->
  ${bLabels}

  <!-- ===================== 9. BEACON SYMBOLS ===================== -->
  ${beacons}

  <!-- ===================== 10. POINT ID LABELS ===================== -->
  ${ptLabels}

  <!-- ===================== 3. NORTH ARROW ===================== -->
  ${northArrow}

  <!-- ===================== 4. SCALE BAR ===================== -->
  ${scaleBar}

  <!-- ===================== 14. SCALE STATEMENT ===================== -->
  <text x="${DA_LEFT + DA_WIDTH/2}" y="${effTop + effH - 6}" class="bt" text-anchor="middle" font-weight="bold">DRAWN TO SCALE 1:${scale}</text>
  <text x="${DA_LEFT + DA_WIDTH/2}" y="${effTop + effH - 12}" class="st" text-anchor="middle">REPRESENTATIVE FRACTION 1:${scale}</text>

  <!-- ===================== 13. LOCATION DIAGRAM ===================== -->
  ${locDiagram}

  <!-- ===================== AREA STATEMENT ===================== -->
  <g transform="translate(${DA_LEFT + 15}, ${effTop + effH - 28})">
    <rect x="-5" y="-9" width="285" height="22" fill="white" fill-opacity="0.92" stroke="#ccc" stroke-width="0.3" rx="2"/>
    <text x="0" y="3" class="bt" font-weight="bold">AREA: ${areaHa.toFixed(3)} Ha | ${areaAc.toFixed(2)} Acres | ${input.area.toFixed(2)} m&#178;</text>
    <text x="0" y="12" class="st">Ground Area (Grid-to-Ground corrected)</text>
    <text x="0" y="19" class="st">Grid Area: ${input.gridArea ? input.gridArea.toFixed(2) + ' m²' : 'N/A'}</text>
  </g>

  <!-- ===================== 12. RIGHT PANEL ===================== -->
  <rect x="${RP_X - 2}" y="${IB_Y + 2}" width="${RP_W + 2}" height="${VB_H - IB_Y*2 - 4}" fill="white" stroke="black" stroke-width="0.5"/>
  ${rightPanel}
</svg>`
}

// ============================================================
// TITLE BLOCK
// ============================================================
function buildTitleBlock(input: DeedPlanInput): string {
  const x = DA_LEFT, y = DA_TOP, w = DA_WIDTH
  const subLine = input.submissionNumber
    ? `<text x="${x+10}" y="${y+8}" class="st">Submission Ref: <tspan font-weight="bold">${escapeXml(input.submissionNumber)}</tspan></text>`
    : ''
  const sheetLine = (input.sheetNumber && input.totalSheets)
    ? `<text x="${x+w-10}" y="${y+8}" class="st" text-anchor="end">Sheet <tspan font-weight="bold">${input.sheetNumber}</tspan> of <tspan font-weight="bold">${input.totalSheets}</tspan></text>`
    : ''
  return `
  <rect x="${x}" y="${y}" width="${w}" height="${TITLE_H}" fill="#F5F5F5" stroke="black" stroke-width="0.5"/>
  <rect x="${x}" y="${y}" width="${w}" height="${TITLE_H}" fill="url(#hatch)" stroke="none"/>
  <rect x="${x+2}" y="${y+2}" width="${w-4}" height="${TITLE_H-4}" fill="none" stroke="black" stroke-width="0.3"/>
  <text x="${x + w/2}" y="${y + 21}" class="tm" text-anchor="middle">DEED PLAN</text>
  <line x1="${x + w/2 - 85}" y1="${y + 24}" x2="${x + w/2 + 85}" y2="${y + 24}" stroke="black" stroke-width="0.6"/>
  ${subLine}
  <text x="${x+10}" y="${y+12}" class="st">Survey No: <tspan font-weight="bold">${escapeXml(input.surveyNumber)}</tspan></text>
  <text x="${x+10}" y="${y+22}" class="st">Drawing No: <tspan font-weight="bold">${input.drawingNumber}</tspan></text>
  <text x="${x+10}" y="${y+31}" class="st">Parcel No: <tspan font-weight="bold">${escapeXml(input.parcelNumber)}</tspan></text>
  <text x="${x+w-10}" y="${y+12}" class="st" text-anchor="end">County: <tspan font-weight="bold">${escapeXml(input.county)}</tspan></text>
  <text x="${x+w-10}" y="${y+22}" class="st" text-anchor="end">Locality: <tspan font-weight="bold">${escapeXml(input.locality)}</tspan></text>
  <text x="${x+w-10}" y="${y+31}" class="st" text-anchor="end">Date: <tspan font-weight="bold">${input.surveyDate}</tspan></text>
  ${sheetLine}`
}

// ============================================================
// NORTH ARROW (half-black/half-white survey style)
// ============================================================
function buildNorthArrow(cx: number, cy: number): string {
  const sz = 20, hw = 4.5
  return `
  <g transform="translate(${cx},${cy})">
    <circle cx="0" cy="0" r="${sz+4}" fill="white" stroke="black" stroke-width="0.5"/>
    <circle cx="0" cy="0" r="${sz+2}" fill="none" stroke="black" stroke-width="0.25"/>
    <polygon points="0,-${sz} ${hw},0 -${hw},0" fill="black" stroke="black" stroke-width="0.4"/>
    <polygon points="0,${sz} ${hw},0 -${hw},0" fill="white" stroke="black" stroke-width="0.4"/>
    <line x1="0" y1="-${sz}" x2="0" y2="${sz}" stroke="black" stroke-width="0.25"/>
    <text x="0" y="${-sz-8}" font-size="8pt" font-weight="bold" text-anchor="middle" font-family="Arial">N</text>
    <line x1="${sz}" y1="0" x2="${sz+3}" y2="0" stroke="black" stroke-width="0.4"/>
    <line x1="-${sz}" y1="0" x2="-${sz-3}" y2="0" stroke="black" stroke-width="0.4"/>
  </g>`
}

// ============================================================
// SCALE BAR (alternating black/white with RF notation)
// ============================================================
function buildScaleBar(cx: number, cy: number, nominalScale: number): string {
  let divs: {label:string, m:number}[]
  if (nominalScale <= 500) divs = [{label:'0',m:0},{label:'10m',m:10},{label:'20m',m:20},{label:'30m',m:30},{label:'40m',m:40},{label:'50m',m:50}]
  else if (nominalScale <= 1000) divs = [{label:'0',m:0},{label:'20m',m:20},{label:'40m',m:40},{label:'60m',m:60},{label:'80m',m:80},{label:'100m',m:100}]
  else if (nominalScale <= 2500) divs = [{label:'0',m:0},{label:'50m',m:50},{label:'100m',m:100},{label:'150m',m:150},{label:'200m',m:200},{label:'250m',m:250}]
  else divs = [{label:'0',m:0},{label:'100m',m:100},{label:'200m',m:200},{label:'300m',m:300},{label:'400m',m:400},{label:'500m',m:500}]

  const totalM = divs[divs.length-1].m
  const totalPx = Math.min(170, totalM * 0.2)
  const f = totalPx / totalM

  let t = ''
  divs.forEach((d, i) => {
    const x = d.m * f
    const big = i===0 || i===divs.length-1 || i===Math.floor(divs.length/2)
    t += `<line x1="${cx+x}" y1="${cy-4}" x2="${cx+x}" y2="${cy+4}" stroke="black" stroke-width="${big?0.7:0.4}"/>`
    t += `<text x="${cx+x}" y="${cy+10}" font-size="3.5pt" text-anchor="middle" font-family="Arial">${d.label}</text>`
    if (i > 0) {
      const px = divs[i-1].m * f
      const fill = i%2===0 ? 'black' : 'white'
      const sw = i%2===0 ? 'none' : '0.3'
      t += `<rect x="${px}" y="${cy-3}" width="${x-px}" height="6" fill="${fill}" stroke="black" stroke-width="${sw}"/>`
    }
  })
  return `
  <g>
    <rect x="${cx}" y="${cy-3}" width="${totalPx}" height="6" fill="none" stroke="black" stroke-width="0.5"/>
    ${t}
    <text x="${cx+totalPx/2}" y="${cy-8}" font-size="4pt" text-anchor="middle" font-weight="bold" font-family="Arial">RF 1:${nominalScale}</text>
  </g>`
}

// ============================================================
// COORDINATE GRID (dashed lines with easting/northing labels)
// ============================================================
function buildGrid(
  toX: (e:number)=>number, toY: (n:number)=>number,
  minX:number, maxX:number, minY:number, maxY:number
): {lines:string, labels:string} {
  let lines='', labels=''
  const stepX = niceStep((maxX-minX)/8)
  const stepY = niceStep((maxY-minY)/8)
  const effTop = DA_TOP + TITLE_H + 8
  const effBot = DA_TOP + DA_HEIGHT - 24
  const effR = DA_LEFT + DA_WIDTH
  const effL = DA_LEFT

  for (let e = Math.ceil(minX/stepX)*stepX; e <= maxX; e += stepX) {
    const x = toX(e)
    if (x < effL || x > effR) continue
    lines += `<line x1="${x.toFixed(1)}" y1="${effTop}" x2="${x.toFixed(1)}" y2="${effBot}" stroke="#E5E7EB" stroke-width="0.2" stroke-dasharray="3,3"/>`
    labels += `<text x="${(x+2).toFixed(1)}" y="${(effBot+8).toFixed(1)}" class="gl">${e.toFixed(0)}</text>`
  }
  for (let n = Math.ceil(minY/stepY)*stepY; n <= maxY; n += stepY) {
    const y = toY(n)
    if (y < effTop || y > effBot) continue
    lines += `<line x1="${effL}" y1="${y.toFixed(1)}" x2="${effR}" y2="${y.toFixed(1)}" stroke="#E5E7EB" stroke-width="0.2" stroke-dasharray="3,3"/>`
    labels += `<text x="${(effL-3).toFixed(1)}" y="${(y+3).toFixed(1)}" class="gl" text-anchor="end">${n.toFixed(0)}</text>`
  }
  return {lines, labels}
}

// ============================================================
// BEACON SYMBOLS
// ============================================================
function buildBeacons(pts: BoundaryPoint[], toX:(e:number)=>number, toY:(n:number)=>number): string {
  return pts.map(p => {
    const sx = toX(p.easting).toFixed(2)
    const sy = toY(p.northing).toFixed(2)
    return `<g transform="translate(${sx},${sy})">${getBeaconSymbol(p.markType, p.markStatus)}</g>`
  }).join('\n')
}

// ============================================================
// BEARING & DISTANCE LABELS (rotated along each leg)
// ============================================================
function buildBoundaryLabels(
  legs: BoundaryLeg[], pts: BoundaryPoint[],
  toX:(e:number)=>number, toY:(n:number)=>number
): string {
  return legs.map(leg => {
    const fp = pts.find((p:any)=>p.id===leg.fromPoint)
    const tp = pts.find((p:any)=>p.id===leg.toPoint)
    if (!fp || !tp) return ''
    const fx=toX(fp.easting), fy=toY(fp.northing), tx=toX(tp.easting), ty=toY(tp.northing)
    const mx=(fx+tx)/2, my=(fy+ty)/2
    const ang = Math.atan2(ty-fy, tx-fx) * 180/Math.PI
    const norm = ((ang%360)+360)%360
    const tAng = (norm>90 && norm<270) ? norm-180 : norm
    const perpX = -Math.sin(ang*Math.PI/180), perpY = Math.cos(ang*Math.PI/180)
    const off = 7
    const lx = (mx + perpX*off).toFixed(2), ly = (my + perpY*off).toFixed(2)
    return `<g transform="translate(${lx},${ly}) rotate(${tAng.toFixed(2)})">
      <text x="0" y="-3" font-size="4pt" text-anchor="middle" font-family="Arial" font-weight="bold">${leg.bearing}</text>
      <text x="0" y="4" font-size="3.5pt" text-anchor="middle" font-family="Arial">${leg.distance.toFixed(2)}m</text>
    </g>`
  }).join('\n')
}

// ============================================================
// ABUTTAL LABELS (positioned outside polygon edges)
// ============================================================
function buildAbuttals(
  input: DeedPlanInput, pts: BoundaryPoint[],
  toX:(e:number)=>number, toY:(n:number)=>number
): string {
  const byN = [...pts].sort((a,b)=>b.northing-a.northing)
  const byE = [...pts].sort((a,b)=>b.easting-a.easting)
  const third = Math.max(2, Math.ceil(pts.length/3))
  let s = ''

  // North abuttal
  const nPts = byN.slice(0, third)
  const nCx = nPts.reduce((a,p)=>a+toX(p.easting),0)/nPts.length
  const nCy = Math.min(...nPts.map(p=>toY(p.northing)))
  s += `<text x="${nCx.toFixed(1)}" y="${(nCy-12).toFixed(1)}" class="at" text-anchor="middle">N: ${escapeXml(input.abuttalNorth)}</text>\n`

  // South abuttal
  const sPts = byN.slice(-third)
  const sCx = sPts.reduce((a,p)=>a+toX(p.easting),0)/sPts.length
  const sCy = Math.max(...sPts.map(p=>toY(p.northing)))
  s += `<text x="${sCx.toFixed(1)}" y="${(sCy+15).toFixed(1)}" class="at" text-anchor="middle">S: ${escapeXml(input.abuttalSouth)}</text>\n`

  // East abuttal
  const ePts = byE.slice(0, third)
  const eCx = Math.max(...ePts.map(p=>toX(p.easting)))
  const eCy = ePts.reduce((a,p)=>a+toY(p.northing),0)/ePts.length
  s += `<g transform="translate(${(eCx+14).toFixed(1)},${eCy.toFixed(1)}) rotate(-90)"><text class="at" text-anchor="middle">E: ${escapeXml(input.abuttalEast)}</text></g>\n`

  // West abuttal
  const wPts = byE.slice(-third)
  const wCx = Math.min(...wPts.map(p=>toX(p.easting)))
  const wCy = wPts.reduce((a,p)=>a+toY(p.northing),0)/wPts.length
  s += `<g transform="translate(${(wCx-14).toFixed(1)},${wCy.toFixed(1)}) rotate(-90)"><text class="at" text-anchor="middle">W: ${escapeXml(input.abuttalWest)}</text></g>\n`

  return s
}

// ============================================================
// POINT ID LABELS
// ============================================================
function buildPointLabels(pts: BoundaryPoint[], toX:(e:number)=>number, toY:(n:number)=>number): string {
  return pts.map((p:any) => {
    const sx = (toX(p.easting)+5).toFixed(2)
    const sy = (toY(p.northing)-5).toFixed(2)
    return `<text x="${sx}" y="${sy}" class="bi">${p.id}</text>`
  }).join('\n')
}

// ============================================================
// LOCATION DIAGRAM (small Kenya map inset)
// ============================================================
function buildLocationDiagram(x: number, y: number): string {
  const w=95, h=82
  return `
  <g transform="translate(${x},${y})">
    <rect x="0" y="0" width="${w}" height="${h}" fill="white" stroke="black" stroke-width="0.5" rx="2"/>
    <text x="${w/2}" y="9" font-size="4pt" font-weight="bold" text-anchor="middle" font-family="Arial">LOCATION DIAGRAM</text>
    <line x1="3" y1="12" x2="${w-3}" y2="12" stroke="black" stroke-width="0.3"/>
    <g transform="translate(${w/2},${h/2+5})">
      <polygon points="-25,-28 -10,-30 5,-28 15,-24 22,-18 25,-8 22,2 18,10 12,18 5,24 -5,26 -15,24 -22,16 -28,6 -30,-4 -28,-14 -24,-22"
        fill="#E8F5E9" stroke="#333" stroke-width="0.6"/>
      <circle cx="18" cy="-2" r="1.3" fill="#888"/>
      <text x="18" y="-5" font-size="2.3pt" text-anchor="middle" fill="#666">MOMBASA</text>
      <circle cx="-5" cy="-16" r="1.3" fill="#888"/>
      <text x="-5" y="-19" font-size="2.3pt" text-anchor="middle" fill="#666">NAIROBI</text>
      <circle cx="-25" cy="-18" r="1" fill="#888"/>
      <text x="-25" y="-21" font-size="2pt" text-anchor="middle" fill="#666">KISUMU</text>
      <polygon points="10,-12 11,-9 14,-9 12,-7 13,-4 10,-6 7,-4 8,-7 6,-9 9,-9" fill="#EF4444" stroke="#991B1B" stroke-width="0.3"/>
    </g>
    <text x="${w/2}" y="${h-3}" font-size="2.5pt" text-anchor="middle" fill="#888" font-family="Arial">NOT TO SCALE</text>
  </g>`
}

// ============================================================
// RIGHT INFO PANEL
// ============================================================
function buildRightPanel(
  input: DeedPlanInput,
  legs: BoundaryLeg[],
  cc: ClosureCheck,
  pts: BoundaryPoint[]
): string {
  const px = RP_X
  const le = px + 8
  const re = px + RP_W - 8
  let y = IB_Y + 12
  let s = ''

  // --- PARCEL INFORMATION ---
  s += secHdr(le, y, 'PARCEL INFORMATION'); y += 12
  s += row(le, y, 'Parcel No:', escapeXml(input.parcelNumber)); y += 10
  s += row(le, y, 'Reg. Section:', input.registrationSection); y += 10
  s += row(le, y, 'Locality:', escapeXml(input.locality)); y += 10
  s += row(le, y, 'County:', escapeXml(input.county)); y += 10
  if (input.titleDeedNumber) { s += row(le, y, 'Title Deed:', input.titleDeedNumber); y += 10 }
  if (input.firNumber) { s += row(le, y, 'FIR No:', input.firNumber); y += 10 }
  if (input.registryMapSheet) { s += row(le, y, 'Map Sheet:', input.registryMapSheet); y += 10 }
  s += hr(le, y, re); y += 7

  // --- ABUTTALS ---
  s += secHdr(le, y, 'ABUTTALS'); y += 11
  s += row(le, y, 'North:', escapeXml(input.abuttalNorth)); y += 9
  s += row(le, y, 'South:', escapeXml(input.abuttalSouth)); y += 9
  s += row(le, y, 'East:', escapeXml(input.abuttalEast)); y += 9
  s += row(le, y, 'West:', escapeXml(input.abuttalWest)); y += 10
  s += hr(le, y, re); y += 6

  // --- AREA ---
  s += secHdr(le, y, 'AREA'); y += 11
  const areaHa = input.area / 10000
  const areaAc = input.area / 4046.8564224
  s += `<text x="${le}" y="${y}" class="bt" font-weight="bold">${areaHa.toFixed(3)} Hectares</text>\n`; y += 9
  s += `<text x="${le}" y="${y}" class="bt">${areaAc.toFixed(2)} Acres</text>\n`; y += 9
  s += `<text x="${le}" y="${y}" class="st">(${input.area.toFixed(2)} m&#178;)</text>\n`; y += 9
  if (input.gridArea && input.gridArea !== input.area) {
    s += `<text x="${le}" y="${y}" class="st">Grid Area: ${input.gridArea.toFixed(2)} m&#178;</text>\n`; y += 9
  }
  if (input.scaleFactor) {
    s += `<text x="${le}" y="${y}" class="st">Scale Factor: ${input.scaleFactor.toFixed(6)}</text>\n`; y += 9
    s += `<text x="${le}" y="${y}" class="st">Reduction applied: Grid to Ground</text>\n`; y += 9
  }
  s += hr(le, y, re); y += 6

  // --- DATUM & PROJECTION ---
  s += secHdr(le, y, 'DATUM & PROJECTION'); y += 11
  s += row(le, y, 'Datum:', input.datum); y += 9
  s += row(le, y, 'Projection:', input.projectionType); y += 9
  s += row(le, y, 'Zone:', `UTM ${input.utmZone}${input.hemisphere}`); y += 9
  s += row(le, y, 'Scale:', `1 : ${input.scale}`); y += 9
  if (input.meanElevation !== undefined) {
    s += row(le, y, 'Mean Elev.:', `${input.meanElevation.toFixed(1)}m`); y += 9
  }
  if (input.controlClass) {
    s += row(le, y, 'Class:', `${input.controlClass} ORDER`); y += 9
  }
  s += hr(le, y, re); y += 6

  // --- CLOSURE CHECK ---
  const ccCol = cc.passes ? '#22C55E' : '#EF4444'
  const prec = cc.precisionRatio.replace('\u221e', '&#8734;')
  s += secHdr(le, y, 'CLOSURE CHECK'); y += 11
  s += `<rect x="${le}" y="${y-8}" width="${RP_W-16}" height="27" fill="${ccCol}" fill-opacity="0.08" stroke="${ccCol}" stroke-width="0.3" rx="2"/>\n`
  s += row(le, y, 'Precision:', prec); y += 9
  s += `<text x="${le}" y="${y}" class="st">dE: ${cc.closingErrorE.toFixed(4)}m  dN: ${cc.closingErrorN.toFixed(4)}m</text>\n`; y += 9
  s += `<text x="${le}" y="${y}" class="st" font-weight="bold" fill="${ccCol}">${cc.passes ? '\u2713 CLOSURE ACCEPTABLE' : '\u2717 CLOSURE FAILED'}</text>\n`; y += 11
  s += hr(le, y, re); y += 6

  // --- COORDINATE SCHEDULE TABLE ---
  s += secHdr(le, y, 'COORDINATE SCHEDULE'); y += 10
  s += `<text x="${le+5}" y="${y}" class="th">PT</text>\n`
  s += `<text x="${le+30}" y="${y}" class="th">MARK</text>\n`
  s += `<text x="${le+100}" y="${y}" class="th">EASTING</text>\n`
  s += `<text x="${le+170}" y="${y}" class="th">NORTHING</text>\n`
  y += 9
  s += hr(le, y, re); y += 2
  for (const p of pts) {
    const eVal = typeof (p as any).easting === 'number' ? (p as any).easting : 0
    const nVal = typeof (p as any).northing === 'number' ? (p as any).northing : 0
    s += `<text x="${le+5}" y="${y}" class="tt">${p.id}</text>\n`
    s += `<text x="${le+30}" y="${y}" class="tt">${p.markType}</text>\n`
    s += `<text x="${le+100}" y="${y}" class="tt">${eVal.toFixed(4)}</text>\n`
    s += `<text x="${le+170}" y="${y}" class="tt">${nVal.toFixed(4)}</text>\n`
    y += 8
  }
  s += hr(le, y, re); y += 7

  // --- BEARING SCHEDULE TABLE ---
  s += secHdr(le, y, 'BEARING SCHEDULE'); y += 10
  s += `<text x="${le+5}" y="${y}" class="th">LEG</text>\n`
  s += `<text x="${le+30}" y="${y}" class="th">FROM</text>\n`
  s += `<text x="${le+60}" y="${y}" class="th">TO</text>\n`
  s += `<text x="${le+95}" y="${y}" class="th">BEARING</text>\n`
  s += `<text x="${le+185}" y="${y}" class="th">DIST(m)</text>\n`
  y += 9
  s += hr(le, y, re); y += 2
  legs.forEach((l, i) => {
    s += `<text x="${le+5}" y="${y}" class="tt">${i+1}</text>\n`
    s += `<text x="${le+30}" y="${y}" class="tt">${l.fromPoint}</text>\n`
    s += `<text x="${le+60}" y="${y}" class="tt">${l.toPoint}</text>\n`
    s += `<text x="${le+95}" y="${y}" class="tt">${l.bearing}</text>\n`
    s += `<text x="${le+185}" y="${y}" class="tt">${l.distance.toFixed(2)}</text>\n`
    y += 8
  })
  s += hr(le, y, re); y += 7

  // --- SURVEYOR DETAILS ---
  s += secHdr(le, y, 'LICENSED SURVEYOR'); y += 11
  s += row(le, y, 'Name:', escapeXml(input.surveyorName)); y += 9
  s += row(le, y, 'ISK No:', escapeXml(input.iskNumber)); y += 9
  s += row(le, y, 'Firm:', escapeXml(input.firmName)); y += 9
  if (input.firmAddress) { s += row(le, y, 'Address:', input.firmAddress); y += 9 }
  if (input.drawnBy) { s += row(le, y, 'Drawn By:', input.drawnBy); y += 9 }
  if (input.checkedBy) { s += row(le, y, 'Checked By:', input.checkedBy); y += 9 }
  s += hr(le, y, re); y += 7

  // --- SURVEYOR'S CERTIFICATE & SIGNATURE ---
  s += secHdr(le, y, "SURVEYOR'S CERTIFICATE"); y += 10
  s += `<text x="${le}" y="${y}" class="st">I hereby certify that this survey was carried out under my direct</text>\n`; y += 7
  s += `<text x="${le}" y="${y}" class="st">supervision in accordance with the Survey Act (Cap. 299)</text>\n`; y += 7
  s += `<text x="${le}" y="${y}" class="st">and Survey Regulations 1994. This plan is correct to the best</text>\n`; y += 7
  s += `<text x="${le}" y="${y}" class="st">of my knowledge and belief.</text>\n`; y += 14
  s += `<line x1="${le}" y1="${y}" x2="${re-30}" y2="${y}" stroke="black" stroke-width="0.5"/>\n`; y += 7
  s += `<text x="${le}" y="${y}" class="st">Signature</text>\n`; y += 6
  s += `<text x="${le}" y="${y}" class="st">Date: ${input.signatureDate}</text>\n`

  return s
}

// ============================================================
// PANEL HELPER FUNCTIONS
// ============================================================
function secHdr(x: number, y: number, t: string): string {
  return `<text x="${x}" y="${y}" class="sh">${t}</text>\n`
}

function row(x: number, y: number, label: string, val: string): string {
  return `<text x="${x}" y="${y}" class="bt">${label} <tspan font-weight="bold">${val}</tspan></text>\n`
}

function hr(x: number, y: number, re: number): string {
  return `<line x1="${x}" y1="${y}" x2="${re}" y2="${y}" stroke="black" stroke-width="0.3"/>\n`
}

// ============================================================
// UTILITY: Calculate nice grid step
// ============================================================
function niceStep(rough: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(rough)))
  const frac = rough / pow
  const nice = frac <= 1.5 ? 1 : frac <= 3 ? 2 : frac <= 7 ? 5 : 10
  return nice * pow
}
