/**
 * Kenya Standard Symbology for Survey Plans
 * 
 * All symbols defined as drawing functions that render vector paths.
 * Follows Kenya Survey Department standards for beacon types,
 * boundary types, and cartographic features.
 */

import type PDFKit from 'pdfkit';
import { drawLine, drawCircle, drawRect, drawText } from '../pdf-engine';

// ─── Beacon Symbols ──────────────────────────────────────────────

/**
 * Draw a control beacon — cross in circle with square.
 */
export function drawControlBeacon(
  doc: PDFKit.PDFDocument,
  cx: number, cy: number,
  diameter: number = 4,
  label?: string
): void {
  const r = diameter / 2;
  
  // Outer circle
  drawCircle(doc, cx, cy, r, 0.3);
  
  // Inner cross
  const cs = r * 0.6;
  drawLine(doc, cx - cs, cy, cx + cs, cy, 0.2);
  drawLine(doc, cx, cy - cs, cx, cy + cs, 0.2);
  
  // Outer square (rotated 45° — draw as diamond)
  const ds = r * 1.2;
  drawLine(doc, cx, cy - ds, cx + ds, cy, 0.2);
  drawLine(doc, cx + ds, cy, cx, cy + ds, 0.2);
  drawLine(doc, cx, cy + ds, cx - ds, cy, 0.2);
  drawLine(doc, cx - ds, cy, cx, cy - ds, 0.2);
  
  if (label) {
    drawText(doc, label, cx, cy + r + 1, 1.5, { align: 'center' });
  }
}

/**
 * Draw a beacon — cross in circle.
 */
export function drawBeacon(
  doc: PDFKit.PDFDocument,
  cx: number, cy: number,
  diameter: number = 3,
  label?: string
): void {
  const r = diameter / 2;
  
  // Circle
  drawCircle(doc, cx, cy, r, 0.2);
  
  // Cross
  const cs = r * 0.5;
  drawLine(doc, cx - cs, cy, cx + cs, cy, 0.15);
  drawLine(doc, cx, cy - cs, cx, cy + cs, 0.15);
  
  if (label) {
    drawText(doc, label, cx, cy + r + 1, 1.5, { align: 'center' });
  }
}

/**
 * Draw a benchmark — triangle with dot.
 */
export function drawBenchmark(
  doc: PDFKit.PDFDocument,
  cx: number, cy: number,
  size: number = 3,
  elevation?: number
): void {
  const h = size * 0.866; // Height of equilateral triangle
  
  // Triangle
  drawLine(doc, cx, cy - h * 2 / 3, cx - size / 2, cy + h / 3, 0.2);
  drawLine(doc, cx - size / 2, cy + h / 3, cx + size / 2, cy + h / 3, 0.2);
  drawLine(doc, cx + size / 2, cy + h / 3, cx, cy - h * 2 / 3, 0.2);
  
  // Center dot
  drawCircle(doc, cx, cy, 0.3, 0.1);
  
  if (elevation !== undefined) {
    drawText(doc, `BM ${elevation.toFixed(2)}m`, cx, cy + h / 3 + 1, 1.5, { align: 'center' });
  }
}

// ─── Boundary Line Styles ────────────────────────────────────────

export type BoundaryType = 'scheme' | 'parcel' | 'road' | 'river' | 'railway' | 'dimension';

/**
 * Draw a boundary line with the correct Kenya standard style.
 */
export function drawBoundaryLine(
  doc: PDFKit.PDFDocument,
  points: { x: number; y: number }[],
  type: BoundaryType
): void {
  if (points.length < 2) return;
  
  const config: Record<BoundaryType, { weight: number; color: string; dash?: number[] }> = {
    scheme: { weight: 0.5, color: 'black' },
    parcel: { weight: 0.3, color: 'black' },
    road: { weight: 0.4, color: 'black' },
    river: { weight: 0.3, color: '#0066CC' },
    railway: { weight: 0.3, color: 'black', dash: [3, 1.5] },
    dimension: { weight: 0.15, color: 'black', dash: [1, 0.5] },
  };
  
  const style = config[type];
  const mmToPt = 2.8346;
  
  doc.save();
  doc.lineWidth(style.weight * mmToPt).strokeColor(style.color);
  
  if (style.dash) {
    doc.dash(style.dash[0] * mmToPt, { space: style.dash[1] * mmToPt });
  }
  
  doc.moveTo(points[0].x * mmToPt, points[0].y * mmToPt);
  for (let i = 1; i < points.length; i++) {
    doc.lineTo(points[i].x * mmToPt, points[i].y * mmToPt);
  }
  doc.stroke();
  doc.undash();
  doc.restore();
}

// ─── Vegetation & Feature Symbols ────────────────────────────────

/**
 * Draw a tree symbol (circle with dot).
 */
export function drawTreeSymbol(
  doc: PDFKit.PDFDocument,
  cx: number, cy: number,
  size: number = 2
): void {
  drawCircle(doc, cx, cy, size / 2, 0.15);
  drawCircle(doc, cx, cy, 0.3, 0.1); // Center dot
}

/**
 * Draw a fence symbol (line with perpendicular ticks).
 */
export function drawFenceLine(
  doc: PDFKit.PDFDocument,
  x1: number, y1: number,
  x2: number, y2: number,
  tickSpacing: number = 3
): void {
  // Main line
  drawLine(doc, x1, y1, x2, y2, 0.15);
  
  // Ticks
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const numTicks = Math.floor(length / tickSpacing);
  
  // Direction perpendicular to the line
  const nx = -dy / length;
  const ny = dx / length;
  const tickLen = 1;
  
  for (let i = 1; i <= numTicks; i++) {
    const t = i / (numTicks + 1);
    const px = x1 + dx * t;
    const py = y1 + dy * t;
    drawLine(doc, px, py, px + nx * tickLen, py + ny * tickLen, 0.1);
  }
}

/**
 * Draw a building footprint with hatching.
 */
export function drawBuilding(
  doc: PDFKit.PDFDocument,
  x: number, y: number,
  width: number, height: number,
  angle: number = 0
): void {
  // Building outline
  drawRect(doc, x, y, width, height, 0.25);
  
  // Hatching (45° lines)
  const mmToPt = 2.8346;
  const spacing = 1.5; // mm between hatch lines
  
  doc.save();
  doc.lineWidth(0.1 * mmToPt).strokeColor('#666666');
  
  // Clip to building rectangle
  doc
    .rect(x * mmToPt, y * mmToPt, width * mmToPt, height * mmToPt)
    .clip();
  
  for (let d = -Math.max(width, height); d < Math.max(width, height) * 2; d += spacing) {
    doc
      .moveTo((x + d) * mmToPt, y * mmToPt)
      .lineTo((x + d + height) * mmToPt, (y + height) * mmToPt)
    ;
  }
  doc.stroke();
  doc.restore();
}
