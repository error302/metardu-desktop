/**
 * Setting Out Sheet Template
 *
 * A4 portrait document for setting out survey points.
 * Contains a coordinate table with design and offset values.
 *
 * Layout:
 * - Header: Project name, surveyor, date
 * - Table: Point ID, Design E, Design N, Offset E, Offset N, Remarks
 * - Footer: Surveyor signature, checked-by line
 *
 * Watermark:
 * - Free plan: METARDU watermark
 * - Paid plan + company logo: Logo in header
 * - Paid plan + no logo: Blank
 */

import {
  createSurveyDocument,
  drawLine,
  drawRect,
  drawText,
  drawCompanyLogo,
  drawMetarduWatermark,
  PAPER_SIZES,
  LINE_WEIGHTS,
  TEXT_SIZES,
} from '../pdf-engine';
import type { DocumentTemplate, TemplateGenerateOptions } from './registry';
import type { ResolvedLogo } from '../resolve-logo';
import type { PlanId } from '@/lib/subscription/catalog';

// ─── Types ───────────────────────────────────────────────────────

export interface SettingOutPoint {
  /** Point identifier */
  pointId: string;
  /** Design easting coordinate */
  designE: number;
  /** Design northing coordinate */
  designN: number;
  /** Bearing from control station to design point (e.g., "45°30'15\"") */
  bearing?: string;
  /** Distance from control station to design point (meters) */
  distance?: string;
  /** Offset from design position (easting) */
  offsetE?: number;
  /** Offset from design position (northing) */
  offsetN?: number;
  /** Tolerance check result (e.g., "PASS", "FAIL", "±0.010m") */
  toleranceCheck?: string;
  /** Additional remarks */
  remarks?: string;
}

export interface SettingOutSheetData {
  /** Project name */
  projectName: string;
  /** Surveyor name */
  surveyorName: string;
  /** Surveyor license number */
  surveyorLicense: string;
  /** Date of setting out */
  date: string;
  /** Reference station name */
  referenceStation?: string;
  /** Instrument used */
  instrument?: string;
  /** Coordinate system / projection */
  projection?: string;
  /** Datum */
  datum?: string;
  /** List of setting out points */
  points: SettingOutPoint[];
}

// ─── Core Generator ──────────────────────────────────────────────

async function generateSettingOutPdf(
  data: SettingOutSheetData,
  options?: TemplateGenerateOptions
): Promise<Buffer> {
  const plan: PlanId = options?.plan ?? 'free';
  const companyLogo: ResolvedLogo | null = options?.companyLogo ?? null;
  const pageW = PAPER_SIZES.A4.width;
  const pageH = PAPER_SIZES.A4.height;

  const doc = createSurveyDocument({
    paperSize: 'A4',
    orientation: 'portrait',
    scale: 1,
    metadata: {
      title: `Setting Out Sheet - ${data.projectName}`,
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

  const mx = 15; // Left margin
  const rightMargin = 15;
  let y = 15;

  // ─── Header with logo ──────────────────────────────────────
  if (companyLogo?.data) {
    drawCompanyLogo(doc, companyLogo.data, mx, y, 30, 10);
    y += 2;
  }

  drawText(doc, 'SETTING OUT SHEET', mx + (companyLogo?.data ? 32 : 0), y, 5, { bold: true });
  y += 7;

  // Project info line
  drawText(doc, data.projectName, mx, y, 3, { bold: true });
  y += 4;
  drawText(doc, `Surveyor: ${data.surveyorName} (${data.surveyorLicense})  |  Date: ${data.date}`, mx, y, TEXT_SIZES.coordinate);
  y += 4;

  // Additional info
  const infoParts: string[] = [];
  if (data.referenceStation) infoParts.push(`Ref: ${data.referenceStation}`);
  if (data.instrument) infoParts.push(`Instr: ${data.instrument}`);
  if (data.projection) infoParts.push(`Proj: ${data.projection}`);
  if (data.datum) infoParts.push(`Datum: ${data.datum}`);
  if (infoParts.length > 0) {
    drawText(doc, infoParts.join('  |  '), mx, y, TEXT_SIZES.small);
    y += 4;
  }

  // Separator line
  drawLine(doc, mx, y, pageW - rightMargin, y, LINE_WEIGHTS.titleBorder);
  y += 5;

  // ─── Coordinate Table ───────────────────────────────────────
  const colWidths = [18, 28, 28, 18, 20, 20, 20, 18, 40];
  const colHeaders = ['Point', 'Design E', 'Design N', 'Bearing', 'Dist (m)', 'Offset E', 'Offset N', 'Tol.', 'Remarks'];
  const headerHeight = 7;
  const rowHeight = 6;

  // Table header
  let cx = mx;
  for (let i = 0; i < colHeaders.length; i++) {
    drawRect(doc, cx, y, colWidths[i], headerHeight, 0.2, 'black', '#E8E8E8');
    drawText(doc, colHeaders[i], cx + 1, y + 2, TEXT_SIZES.small, { bold: true });
    cx += colWidths[i];
  }
  y += headerHeight;

  // Table rows
  const maxRows = Math.min(data.points.length, 32); // Max rows that fit on A4
  for (let r = 0; r < maxRows; r++) {
    cx = mx;
    const pt = data.points[r];
    const values = [
      pt.pointId,
      pt.designE.toFixed(3),
      pt.designN.toFixed(3),
      pt.bearing ?? '',
      pt.distance ?? '',
      pt.offsetE != null ? pt.offsetE.toFixed(3) : '',
      pt.offsetN != null ? pt.offsetN.toFixed(3) : '',
      pt.toleranceCheck ?? '',
      pt.remarks ?? '',
    ];

    for (let i = 0; i < colWidths.length; i++) {
      drawRect(doc, cx, y, colWidths[i], rowHeight, 0.08);
      drawText(doc, values[i], cx + 1, y + 1.5, TEXT_SIZES.small);
      cx += colWidths[i];
    }
    y += rowHeight;
  }

  // Overflow note if too many points
  if (data.points.length > maxRows) {
    y += 2;
    drawText(doc, `... and ${data.points.length - maxRows} more points (continued on next page)`, mx, y, TEXT_SIZES.small, { color: '#999999' });
    y += 5;
  }

  // ─── Summary statistics ─────────────────────────────────────
  y += 5;
  drawLine(doc, mx, y, pageW - rightMargin, y, 0.3);
  y += 3;

  const totalPoints = data.points.length;
  const pointsWithOffsets = data.points.filter(p => p.offsetE != null || p.offsetN != null).length;
  const maxOffsetE = Math.max(...data.points.filter(p => p.offsetE != null).map(p => Math.abs(p.offsetE!)), 0);
  const maxOffsetN = Math.max(...data.points.filter(p => p.offsetN != null).map(p => Math.abs(p.offsetN!)), 0);

  drawText(doc, 'SUMMARY', mx, y, TEXT_SIZES.coordinate, { bold: true });
  y += 4;
  drawText(doc, `Total Points: ${totalPoints}`, mx, y, TEXT_SIZES.small);
  drawText(doc, `Points with Offsets: ${pointsWithOffsets}`, mx + 50, y, TEXT_SIZES.small);
  drawText(doc, `Max |Offset E|: ${maxOffsetE.toFixed(3)}m`, mx + 120, y, TEXT_SIZES.small);
  y += 4;
  drawText(doc, `Max |Offset N|: ${maxOffsetN.toFixed(3)}m`, mx, y, TEXT_SIZES.small);

  // ─── Footer: Signature and checked-by ───────────────────────
  // Position at bottom of page
  const footerY = pageH - 30;

  drawLine(doc, mx, footerY, pageW - rightMargin, footerY, 0.1);
  y = footerY + 3;

  // Surveyor signature
  drawLine(doc, mx + 80, y, mx + 140, y, 0.2);
  drawText(doc, data.surveyorName, mx + 80, y + 1, TEXT_SIZES.small);
  drawText(doc, `License: ${data.surveyorLicense}`, mx + 80, y + 3, TEXT_SIZES.small);

  // Checked-by line
  drawLine(doc, mx + 80, y + 12, mx + 140, y + 12, 0.2);
  drawText(doc, 'Checked by', mx + 80, y + 13, TEXT_SIZES.small);

  // Date field
  drawLine(doc, mx + 80, y + 24, mx + 140, y + 24, 0.2);
  drawText(doc, 'Date', mx + 80, y + 25, TEXT_SIZES.small);

  doc.end();
  return pdfPromise;
}

// ─── Template Registration ───────────────────────────────────────

export const SETTING_OUT_TEMPLATE: DocumentTemplate<SettingOutSheetData> = {
  id: 'setting-out',
  name: 'Setting Out Sheet',
  description: 'A4 portrait sheet with coordinate table for design and offset values, with surveyor signature block',
  documentType: 'setting-out',
  paperSize: 'A4',
  orientation: 'portrait',
  generate: generateSettingOutPdf,
};
