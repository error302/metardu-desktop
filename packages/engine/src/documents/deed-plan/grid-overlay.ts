/**
 * Coordinate Grid Overlay for Survey Plans
 * 
 * Draws UTM grid ticks and labels at the edges of the plan.
 * Required for all Kenya survey plans to be accepted by Ardhi House.
 * 
 * Standards:
 * - Grid interval: 100m for 1:1000, 200m for 1:2500
 * - Tick marks: 2mm long
 * - Edge labels: Full UTM coordinates (E, N)
 * - Interior ticks: Coordinates abbreviated to last 3 digits
 */

import type PDFKit from 'pdfkit';
import { drawLine, drawText } from '../pdf-engine';

// ─── Types ───────────────────────────────────────────────────────

export interface GridOverlayInput {
  /** Easting of the map area origin (meters) */
  originEasting: number;
  /** Northing of the map area origin (meters) */
  originNorthing: number;
  /** Width of the map area (meters on ground) */
  groundWidth: number;
  /** Height of the map area (meters on ground) */
  groundHeight: number;
  /** Paper X of map area origin (mm) */
  paperOriginX: number;
  /** Paper Y of map area origin (mm) */
  paperOriginY: number;
  /** Paper width of map area (mm) */
  paperWidth: number;
  /** Paper height of map area (mm) */
  paperHeight: number;
  /** Map scale (e.g., 1000 for 1:1000) */
  scale: number;
  /** Grid interval in meters (default: auto-computed from scale) */
  gridInterval?: number;
  /** Tick length in mm (default: 2) */
  tickLength?: number;
}

// ─── Core Function ───────────────────────────────────────────────

/**
 * Draw coordinate grid overlay on a survey plan.
 * 
 * Places tick marks at grid intersections around the border of the
 * map area, with coordinate labels at the edges.
 */
export function drawGridOverlay(
  doc: PDFKit.PDFDocument,
  input: GridOverlayInput
): void {
  const {
    originEasting,
    originNorthing,
    groundWidth,
    groundHeight,
    paperOriginX,
    paperOriginY,
    paperWidth,
    paperHeight,
    scale,
    tickLength = 2,
  } = input;
  
  // Auto-compute grid interval from scale
  const gridInterval = input.gridInterval ?? computeGridInterval(scale);
  
  // Compute scale factor: mm per meter
  const mmPerMeter = 1000 / scale;
  
  // Find first grid line positions (rounded to interval)
  const firstEasting = Math.ceil(originEasting / gridInterval) * gridInterval;
  const firstNorthing = Math.ceil(originNorthing / gridInterval) * gridInterval;
  
  // ─── Easting grid lines (vertical ticks) ────────────────────
  for (let e = firstEasting; e <= originEasting + groundWidth; e += gridInterval) {
    const dx = (e - originEasting) * mmPerMeter;
    const px = paperOriginX + dx;
    
    if (px < paperOriginX - 0.1 || px > paperOriginX + paperWidth + 0.1) continue;
    
    // Top tick
    drawLine(doc, px, paperOriginY, px, paperOriginY - tickLength, 0.1);
    
    // Bottom tick
    drawLine(doc, px, paperOriginY + paperHeight, px, paperOriginY + paperHeight + tickLength, 0.1);
    
    // Coordinate label (bottom)
    const label = formatEasting(e);
    drawText(doc, label, px, paperOriginY + paperHeight + tickLength + 0.5, 1.5, { align: 'center' });
  }
  
  // ─── Northing grid lines (horizontal ticks) ─────────────────
  for (let n = firstNorthing; n <= originNorthing + groundHeight; n += gridInterval) {
    const dy = (n - originNorthing) * mmPerMeter;
    const py = paperOriginY + paperHeight - dy; // Y is inverted (top = higher northing)
    
    if (py < paperOriginY - 0.1 || py > paperOriginY + paperHeight + 0.1) continue;
    
    // Left tick
    drawLine(doc, paperOriginX, py, paperOriginX - tickLength, py, 0.1);
    
    // Right tick
    drawLine(doc, paperOriginX + paperWidth, py, paperOriginX + paperWidth + tickLength, py, 0.1);
    
    // Coordinate label (left)
    const label = formatNorthing(n);
    drawText(doc, label, paperOriginX - tickLength - 1, py - 0.75, 1.5, { align: 'right' });
  }
  
  // ─── Interior grid ticks (lighter, every other interval) ───
  // These are smaller ticks at half the grid interval
  const halfInterval = gridInterval / 2;
  
  for (let e = firstEasting - halfInterval; e <= originEasting + groundWidth; e += gridInterval) {
    const dx = (e - originEasting) * mmPerMeter;
    const px = paperOriginX + dx;
    
    if (px < paperOriginX || px > paperOriginX + paperWidth) continue;
    
    // Small interior ticks (1mm)
    drawLine(doc, px, paperOriginY, px, paperOriginY + 0.5, 0.08);
    drawLine(doc, px, paperOriginY + paperHeight, px, paperOriginY + paperHeight - 0.5, 0.08);
  }
}

/**
 * Compute appropriate grid interval from map scale.
 */
function computeGridInterval(scale: number): number {
  if (scale <= 500) return 50;
  if (scale <= 2000) return 100;
  if (scale <= 5000) return 200;
  if (scale <= 10000) return 500;
  return 1000;
}

/**
 * Format easting coordinate for grid label.
 * Shows full value at edges, abbreviated (last 3 digits) in interior.
 */
function formatEasting(easting: number): string {
  return Math.round(easting).toString();
}

/**
 * Format northing coordinate for grid label.
 */
function formatNorthing(northing: number): string {
  return Math.round(northing).toString();
}
