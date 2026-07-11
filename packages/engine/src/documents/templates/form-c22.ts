/**
 * Form C-22 Template — Kenya Land Registration
 * 
 * Standard form for deed plan submission to Ardhi House.
 * A4 portrait, with fields for all required registration data.
 */

import {
  createSurveyDocument,
  drawLine,
  drawRect,
  drawText,
  drawMetarduWatermark,
  PAPER_SIZES,
  LINE_WEIGHTS,
  TEXT_SIZES,
} from '../pdf-engine';
import type { DocumentTemplate, TemplateGenerateOptions } from './registry';
import type { ResolvedLogo } from '../resolve-logo';
import type { PlanId } from '@/lib/subscription/catalog';

export interface FormC22Data {
  lrNumber: string;
  area: string;
  county: string;
  subCounty?: string;
  surveyorName: string;
  surveyorLicense: string;
  date: string;
  deedPlanNumber?: string;
  registry?: string;
  ownerName?: string;
  plotNumber?: string;
  /** Type of registration (e.g., 'first registration', 'transfer', 'subdivision') */
  registrationType?: string;
}

async function generateFormC22Pdf(
  data: FormC22Data,
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
      title: `Form C-22 - ${data.lrNumber}`,
      surveyorName: data.surveyorName,
      surveyorLicense: data.surveyorLicense,
      projectReference: data.lrNumber,
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

  const mx = 20; // Left margin mm
  let y = 20;    // Current Y position

  drawText(doc, 'REPUBLIC OF KENYA', mx, y, 5, { align: 'center', bold: true });
  y += 8;
  drawText(doc, 'THE LAND REGISTRATION ACT', mx, y, 3.5, { align: 'center', bold: true });
  y += 6;
  drawText(doc, 'FORM C-22', mx, y, 6, { align: 'center', bold: true });
  y += 8;
  drawText(doc, 'APPLICATION FOR REGISTRATION', mx, y, 3, { align: 'center' });
  y += 10;

  // ─── Separator ───────────────────────────────────────────
  drawLine(doc, mx, y, 210 - mx, y, LINE_WEIGHTS.titleBorder);
  y += 8;

  // ─── Form Fields ────────────────────────────────────────
  const fields = [
    { label: 'Land Registration Number:', value: data.lrNumber },
    { label: 'Area:', value: `${data.area} Ha` },
    { label: 'County:', value: data.county },
    { label: 'Sub-County:', value: data.subCounty ?? '' },
    { label: 'Registry:', value: data.registry ?? '' },
    { label: 'Owner/Applicant:', value: data.ownerName ?? '' },
    { label: 'Plot Number:', value: data.plotNumber ?? '' },
    { label: 'Deed Plan Number:', value: data.deedPlanNumber ?? '' },
    { label: 'Registration Type:', value: data.registrationType ?? '' },
  ];

  for (const field of fields) {
    // Label
    drawText(doc, field.label, mx, y, TEXT_SIZES.coordinate, { bold: true });
    // Value (after label)
    drawText(doc, field.value, mx + 60, y, TEXT_SIZES.coordinate);
    // Underline for value
    drawLine(doc, mx + 60, y + 3, 210 - mx, y + 3, 0.1);
    y += 8;
  }

  // ─── Surveyor Declaration (required by Land Registration Act) ────
  y += 5;
  drawLine(doc, mx, y, 210 - mx, y, LINE_WEIGHTS.titleBorder);
  y += 5;
  drawText(doc, 'SURVEYOR DECLARATION', mx, y, 3, { bold: true });
  y += 6;
  drawText(doc, 'I, the undersigned Licensed Surveyor, hereby certify that the survey of the', mx, y, TEXT_SIZES.small);
  y += 4;
  drawText(doc, 'above-described land has been carried out in accordance with the Survey Act', mx, y, TEXT_SIZES.small);
  y += 4;
  drawText(doc, '(Cap 299) and the Land Registration Act, and that the particulars shown herein', mx, y, TEXT_SIZES.small);
  y += 4;
  drawText(doc, 'are true and correct to the best of my knowledge and belief.', mx, y, TEXT_SIZES.small);
  y += 10;

  // ─── Signature Area ──────────────────────────────────────
  drawLine(doc, mx + 100, y, 210 - mx, y, 0.2);
  drawText(doc, 'Signature of Surveyor', mx + 100, y + 2, TEXT_SIZES.small);
  drawText(doc, data.surveyorName, mx + 100, y + 5, TEXT_SIZES.small, { bold: true });
  drawText(doc, `License: ${data.surveyorLicense}`, mx + 100, y + 8, TEXT_SIZES.small);

  y += 15;
  drawLine(doc, mx + 100, y, 210 - mx, y, 0.2);
  drawText(doc, 'Date', mx + 100, y + 2, TEXT_SIZES.small);

  // ─── Applicant signature ──────────────────────────────────
  y += 12;
  drawLine(doc, mx + 100, y, 210 - mx, y, 0.2);
  drawText(doc, 'Signature of Applicant', mx + 100, y + 2, TEXT_SIZES.small);

  y += 10;
  drawLine(doc, mx + 100, y, 210 - mx, y, 0.2);
  drawText(doc, 'Date', mx + 100, y + 2, TEXT_SIZES.small);

  // ─── For Official Use ────────────────────────────────────
  y += 12;
  drawLine(doc, mx, y, 210 - mx, y, LINE_WEIGHTS.titleBorder);
  y += 5;
  drawText(doc, 'FOR OFFICIAL USE ONLY', mx, y, 3, { bold: true });
  y += 6;
  drawText(doc, 'Official Stamp:', mx, y, TEXT_SIZES.coordinate, { bold: true });
  // Stamp box placeholder
  drawRect(doc, mx + 35, y - 2, 40, 30, 0.15);
  drawText(doc, '(STAMP)', mx + 43, y + 10, TEXT_SIZES.small, { color: '#999999' });

  y += 20;
  drawLine(doc, mx + 100, y, 210 - mx, y, 0.2);
  drawText(doc, 'Registrar Signature / Date', mx + 100, y + 2, TEXT_SIZES.small);

  doc.end();
  return pdfPromise;
}

/** Keep backward-compatible named export */
export async function generateFormC22(data: FormC22Data): Promise<Buffer> {
  return generateFormC22Pdf(data);
}

/** Template registration object */
export const FORM_C22_TEMPLATE: DocumentTemplate<FormC22Data> = {
  id: 'form-c22',
  name: 'Form C-22 (Land Registration)',
  description: 'A4 portrait registration form for deed plan submission to Ardhi House',
  documentType: 'form-c22',
  paperSize: 'A4',
  orientation: 'portrait',
  generate: generateFormC22Pdf,
};
