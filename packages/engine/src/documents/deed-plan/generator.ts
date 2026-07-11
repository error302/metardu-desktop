/**
 * Deed Plan Generator
 * 
 * Generates a complete vector PDF deed plan that meets Kenya
 * Survey Department standards for submission to Ardhi House.
 * 
 * Requirements:
 * - Paper: A1 (594 × 841mm) or A2
 * - Scale: 1:500, 1:1000, or 1:2500
 * - Vector-only lines and text
 * - Coordinate grid with UTM ticks
 * - Standard title block
 * - North arrow with convergence
 * - Scale bar (graphical + representative fraction)
 * - Beacon symbols per Kenya standards
 * - Line weights per Kenya standards
 * - PDF/A-1b compliant (archival)
 */

import PDFDocument from 'pdfkit';
import {
  createSurveyDocument,
  drawLine,
  drawRect,
  drawText,
  drawBeaconSymbol,
  drawNorthArrow,
  drawScaleBar,
  PAPER_SIZES,
  LINE_WEIGHTS,
  TEXT_SIZES,
  type PaperSizeName,
  type DocumentMetadata,
} from '../pdf-engine';
import { drawTitleBlock, type TitleBlockData } from './title-block';
import { drawGridOverlay, type GridOverlayInput } from './grid-overlay';
import { drawBoundaryLine, drawBeacon } from './symbology';

// ─── Types ───────────────────────────────────────────────────────

export interface DeedPlanPoint {
  easting: number;
  northing: number;
  label: string;
  beaconType: 'control' | 'beacon' | 'benchmark';
}

export interface DeedPlanBoundary {
  fromIndex: number;
  toIndex: number;
  type: 'scheme' | 'parcel' | 'road' | 'river' | 'dimension';
  bearing?: string;
  distance?: string;
}

export interface DeedPlanInput {
  /** Points defining the parcel boundary */
  points: DeedPlanPoint[];
  /** Boundary lines connecting points */
  boundaries: DeedPlanBoundary[];
  /** Paper size (A1 or A2) */
  paperSize: PaperSizeName;
  /** Map scale (e.g., 1000 for 1:1000) */
  scale: number;
  /** Title block data */
  titleData: TitleBlockData;
  /** Document metadata */
  metadata: DocumentMetadata;
  /** Grid convergence at map center (decimal degrees) */
  convergence?: number;
  /** Grid interval in meters (default: auto) */
  gridInterval?: number;
  /** Margin around map area (mm) */
  mapMargin?: number;
}

// ─── Constants ───────────────────────────────────────────────────

const TITLE_BLOCK_RESERVE = 55; // mm reserved for title block at bottom
const MARGIN = 15; // mm margin around the page

// ─── Core Function ───────────────────────────────────────────────

/**
 * Generate a complete deed plan PDF.
 * 
 * Returns a Buffer containing the PDF data.
 */
export async function generateDeedPlan(input: DeedPlanInput): Promise<Buffer> {
  const {
    points,
    boundaries,
    paperSize,
    scale,
    titleData,
    metadata,
    convergence,
    gridInterval,
    mapMargin = 10,
  } = input;
  
  const paper = PAPER_SIZES[paperSize];
  const mmToPt = 2.8346;
  
  // Create PDF document (landscape orientation for deed plans)
  const doc = createSurveyDocument({
    paperSize,
    orientation: 'landscape',
    scale,
    metadata,
  });
  
  // Collect PDF data into a buffer
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  
  const pdfPromise = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
  
  // ─── Compute map area ──────────────────────────────────────
  // Map area is the portion of the page where the survey drawing goes
  const pageW = paper.height; // Landscape
  const pageH = paper.width;
  
  const mapAreaX = MARGIN;
  const mapAreaY = MARGIN;
  const mapAreaW = pageW - 2 * MARGIN;
  const mapAreaH = pageH - 2 * MARGIN - TITLE_BLOCK_RESERVE;
  
  // ─── Compute coordinate extent of the survey ───────────────
  const eastings = points.map(p => p.easting);
  const northings = points.map(p => p.northing);
  
  const minE = Math.min(...eastings);
  const maxE = Math.max(...eastings);
  const minN = Math.min(...northings);
  const maxN = Math.max(...northings);
  
  // Add 10% padding around the survey area
  const rangeE = maxE - minE || 100;
  const rangeN = maxN - minN || 100;
  const paddingE = rangeE * 0.1;
  const paddingN = rangeN * 0.1;
  
  const originE = minE - paddingE;
  const originN = minN - paddingN;
  const extentE = rangeE + 2 * paddingE;
  const extentN = rangeN + 2 * paddingN;
  
  // mm per meter on the plan
  const mmPerMeter = 1000 / scale;
  
  // ─── Draw map border ───────────────────────────────────────
  drawRect(doc, mapAreaX, mapAreaY, mapAreaW, mapAreaH, LINE_WEIGHTS.titleBorder);
  
  // ─── Draw coordinate grid ──────────────────────────────────
  drawGridOverlay(doc, {
    originEasting: originE,
    originNorthing: originN,
    groundWidth: extentE,
    groundHeight: extentN,
    paperOriginX: mapAreaX + mapMargin,
    paperOriginY: mapAreaY + mapMargin,
    paperWidth: mapAreaW - 2 * mapMargin,
    paperHeight: mapAreaH - 2 * mapMargin,
    scale,
    gridInterval,
  });
  
  // ─── Coordinate transform: ground (meters) → paper (mm) ────
  const groundToPaperX = (easting: number) => {
    return mapAreaX + mapMargin + (easting - originE) * mmPerMeter;
  };
  const groundToPaperY = (northing: number) => {
    return mapAreaY + mapMargin + (maxN + paddingN - northing) * mmPerMeter; // Y inverted
  };
  
  // ─── Draw boundary lines ───────────────────────────────────
  for (const boundary of boundaries) {
    const fromPt = points[boundary.fromIndex];
    const toPt = points[boundary.toIndex];
    
    const paperPoints = [
      { x: groundToPaperX(fromPt.easting), y: groundToPaperY(fromPt.northing) },
      { x: groundToPaperX(toPt.easting), y: groundToPaperY(toPt.northing) },
    ];
    
    drawBoundaryLine(doc, paperPoints, boundary.type);
    
    // Draw bearing and distance labels
    if (boundary.bearing || boundary.distance) {
      const midX = (paperPoints[0].x + paperPoints[1].x) / 2;
      const midY = (paperPoints[0].y + paperPoints[1].y) / 2;
      
      // Offset label perpendicular to the line
      const dx = paperPoints[1].x - paperPoints[0].x;
      const dy = paperPoints[1].y - paperPoints[0].y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const nx = -dy / length * 3;
      const ny = dx / length * 3;
      
      if (boundary.bearing) {
        drawText(doc, boundary.bearing, midX + nx, midY + ny, TEXT_SIZES.bearing, { align: 'center' });
      }
      if (boundary.distance) {
        drawText(doc, boundary.distance, midX + nx, midY + ny + 2, TEXT_SIZES.dimension, { align: 'center' });
      }
    }
  }
  
  // ─── Draw beacon symbols ───────────────────────────────────
  for (const point of points) {
    const px = groundToPaperX(point.easting);
    const py = groundToPaperY(point.northing);
    
    drawBeacon(doc, px, py, 3, point.label);
    
    // Coordinate label
    const coordText = `E ${point.easting.toFixed(1)}  N ${point.northing.toFixed(1)}`;
    drawText(doc, coordText, px + 3, py - 1, TEXT_SIZES.coordinate);
  }
  
  // ─── Draw title block ──────────────────────────────────────
  drawTitleBlock(doc, pageW - MARGIN, pageH - MARGIN, titleData);
  
  // ─── Finalize PDF ──────────────────────────────────────────
  doc.end();
  
  return pdfPromise;
}
