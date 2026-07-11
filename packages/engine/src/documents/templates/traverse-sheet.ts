/**
 * Traverse Computation Sheet Template
 * 
 * A4 landscape sheet showing all traverse computations including
 * corrections, adjusted coordinates, and misclosure analysis.
 * Enhanced with face-left/face-right columns, logo support,
 * and METARDU watermark for free tier.
 */

import {
  createSurveyDocument,
  drawLine,
  drawRect,
  drawText,
  drawCompanyLogo,
  drawMetarduWatermark,
  PAPER_SIZES,
  TEXT_SIZES,
} from '../pdf-engine';
import type { DocumentTemplate, TemplateGenerateOptions } from './registry';
import type { ResolvedLogo } from '../resolve-logo';
import type { PlanId } from '@/lib/subscription/catalog';

export interface TraverseSheetData {
  projectName: string;
  surveyorName: string;
  surveyorLicense: string;
  date: string;
  order: number;
  method: string;
  stations: Array<{
    name: string;
    bearing: string;
    distance: string;
    /** Slope distance (before reduction) */
    slopeDistance?: string;
    /** Vertical angle */
    verticalAngle?: string;
    /** Reduced level at station */
    reducedLevel?: string;
    dE: string;
    dN: string;
    easting: string;
    northing: string;
    correctionE: string;
    correctionN: string;
    /** Face-left horizontal angle */
    faceLeft?: string;
    /** Face-right horizontal angle */
    faceRight?: string;
    /** Mean angle from FL/FR */
    meanAngle?: string;
  }>;
  misclosure: {
    easting: string;
    northing: string;
    linear: string;
    /** Linear misclosure ratio (e.g., "1:25000") */
    ratio: string;
    angular: string;
    /** Bowditch correction summary if applicable */
    bowditchCorrectionE?: string;
    bowditchCorrectionN?: string;
  };
}

async function generateTraverseSheetPdf(
  data: TraverseSheetData,
  options?: TemplateGenerateOptions
): Promise<Buffer> {
  const plan: PlanId = options?.plan ?? 'free';
  const companyLogo: ResolvedLogo | null = options?.companyLogo ?? null;
  const pageW = PAPER_SIZES.A4.height; // Landscape
  const pageH = PAPER_SIZES.A4.width;

  const doc = createSurveyDocument({
    paperSize: 'A4',
    orientation: 'landscape',
    scale: 1,
    metadata: {
      title: `Traverse Sheet - ${data.projectName}`,
      surveyorName: data.surveyorName,
      surveyorLicense: data.surveyorLicense,
      projectReference: data.projectName,
      date: data.date,
    },
    companyLogo: companyLogo?.data ?? null,
    plan,
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const pdfPromise = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  // METARDU watermark for free plan
  if (plan === 'free') {
    drawMetarduWatermark(doc, pageW, pageH);
  }

  const mx = 10;
  let y = 10;

  // ─── Header with logo ──────────────────────────────────
  if (companyLogo?.data) {
    drawCompanyLogo(doc, companyLogo.data, mx, y, 25, 8);
    y += 1;
  }
  drawText(doc, 'TRAVERSE COMPUTATION SHEET', mx + (companyLogo?.data ? 28 : 0), y, 5, { bold: true });
  y += 7;
  drawText(doc, `${data.projectName} | ${data.method} | ${data.order} Order | ${data.date}`, mx, y, 2.5);
  y += 5;
  drawText(doc, `Surveyor: ${data.surveyorName} (${data.surveyorLicense})`, mx, y, 2);
  y += 6;

  // ─── Column headers (with face-left/face-right, vertical angle, reduced level) ──
  const cols = [
    { header: 'Station', width: 14 },
    { header: 'Face L', width: 12 },
    { header: 'Face R', width: 12 },
    { header: 'Mean', width: 12 },
    { header: 'Bearing', width: 16 },
    { header: 'Slope D.', width: 14 },
    { header: 'Hz D.', width: 14 },
    { header: 'Vert. ∠', width: 14 },
    { header: 'RL', width: 14 },
    { header: 'dE', width: 14 },
    { header: 'dN', width: 14 },
    { header: 'Corr. E', width: 12 },
    { header: 'Corr. N', width: 12 },
    { header: 'Easting', width: 22 },
    { header: 'Northing', width: 22 },
  ];

  let cx = mx;
  for (const col of cols) {
    drawRect(doc, cx, y, col.width, 6, 0.15);
    drawText(doc, col.header, cx + 1, y + 1, 1.8, { bold: true, align: 'center' });
    cx += col.width;
  }
  y += 6;

  // ─── Data rows ──────────────────────────────────────────
  const rowH = 5;
  for (const station of data.stations) {
    cx = mx;
    const values = [
      station.name,
      station.faceLeft ?? '',
      station.faceRight ?? '',
      station.meanAngle ?? '',
      station.bearing,
      station.slopeDistance ?? '',
      station.distance, // Horizontal distance
      station.verticalAngle ?? '',
      station.reducedLevel ?? '',
      station.dE,
      station.dN,
      station.correctionE,
      station.correctionN,
      station.easting,
      station.northing,
    ];

    for (let i = 0; i < cols.length; i++) {
      drawRect(doc, cx, y, cols[i].width, rowH, 0.08);
      drawText(doc, values[i], cx + 1, y + 1, 1.5);
      cx += cols[i].width;
    }
    y += rowH;
  }

  // ─── Misclosure summary ─────────────────────────────────
  y += 5;
  drawLine(doc, mx, y, 287 - mx, y, 0.3);
  y += 3;
  drawText(doc, 'MISCLOSURE ANALYSIS', mx, y, 3, { bold: true });
  y += 5;
  drawText(doc, `dE: ${data.misclosure.easting}   dN: ${data.misclosure.northing}   Linear: ${data.misclosure.linear}   Ratio: ${data.misclosure.ratio}   Angular: ${data.misclosure.angular}`, mx, y, 2);

  // Bowditch correction summary
  if (data.misclosure.bowditchCorrectionE || data.misclosure.bowditchCorrectionN) {
    y += 5;
    drawText(doc, `Bowditch Correction — dE: ${data.misclosure.bowditchCorrectionE ?? 'N/A'}   dN: ${data.misclosure.bowditchCorrectionN ?? 'N/A'}`, mx, y, 2);
  }

  // ─── Surveyor signature ──────────────────────────────────
  y += 8;
  drawLine(doc, mx + 160, y, 287 - mx, y, 0.2);
  drawText(doc, `Surveyor: ${data.surveyorName}`, mx + 160, y + 1, TEXT_SIZES.small);
  drawText(doc, `License: ${data.surveyorLicense}`, mx + 160, y + 3, TEXT_SIZES.small);

  // Checked-by line
  y += 10;
  drawLine(doc, mx + 160, y, 287 - mx, y, 0.2);
  drawText(doc, 'Checked by:', mx + 160, y + 1, TEXT_SIZES.small);

  // Director of Surveys approval line
  y += 10;
  drawLine(doc, mx + 160, y, 287 - mx, y, 0.2);
  drawText(doc, 'Director of Surveys:', mx + 160, y + 1, TEXT_SIZES.small);

  doc.end();
  return pdfPromise;
}

/** Keep backward-compatible named export */
export async function generateTraverseSheet(data: TraverseSheetData): Promise<Buffer> {
  return generateTraverseSheetPdf(data);
}

/** Template registration object */
export const TRAVERSE_SHEET_TEMPLATE: DocumentTemplate<TraverseSheetData> = {
  id: 'traverse-sheet',
  name: 'Traverse Computation Sheet',
  description: 'A4 landscape sheet with face-left/face-right columns, corrections, adjusted coordinates, and misclosure analysis',
  documentType: 'traverse-sheet',
  paperSize: 'A4',
  orientation: 'landscape',
  generate: generateTraverseSheetPdf,
};
