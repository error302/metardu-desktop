/**
 * Form No. 4 Template — Kenya Survey Department Standard
 *
 * Survey submission form required by the Survey Act (Cap 299).
 * Used to submit survey work to the Director of Surveys for examination
 * and approval.
 *
 * Layout: A4 portrait
 *
 * Required elements:
 * - Survey order number
 * - Surveyor's name and license
 * - Type of survey
 * - Locality
 * - Number of parcels
 * - Date of survey
 * - Director of Surveys approval section
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

export interface FormNo4Data {
  /** Survey order number (from Director of Surveys) */
  surveyOrderNumber: string;
  /** Surveyor's full name */
  surveyorName: string;
  /** Surveyor's license/registration number (ISK number) */
  surveyorLicense: string;
  /** Surveyor's firm name */
  firmName?: string;
  /** Type of survey (e.g., 'Cadastral', 'Topographic', 'Engineering', 'Control') */
  surveyType: string;
  /** Locality / location of the survey */
  locality: string;
  /** County */
  county: string;
  /** Sub-county or division */
  subCounty?: string;
  /** District */
  district?: string;
  /** LR Number of the parcel */
  lrNumber: string;
  /** Number of parcels surveyed */
  numberOfParcels: number;
  /** Date of survey */
  dateOfSurvey: string;
  /** Date form was prepared */
  datePrepared: string;
  /** Area surveyed in hectares */
  areaHa?: number;
  /** Projection used */
  projection?: string;
  /** Datum used */
  datum?: string;
  /** Registry Map Sheet reference */
  registryMapSheet?: string;
  /** Deed Plan number(s) */
  deedPlanNumbers?: string[];
  /** Additional remarks */
  remarks?: string;
}

// ─── Core Generator ──────────────────────────────────────────────

async function generateFormNo4Pdf(
  data: FormNo4Data,
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
      title: `Form No. 4 - ${data.surveyOrderNumber}`,
      surveyorName: data.surveyorName,
      surveyorLicense: data.surveyorLicense,
      projectReference: data.surveyOrderNumber,
      date: data.datePrepared,
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

  const mx = 20;
  let y = 20;

  // ─── Header ─────────────────────────────────────────────────
  if (companyLogo?.data) {
    drawCompanyLogo(doc, companyLogo.data, mx, y, 25, 8);
    y += 2;
  }
  drawText(doc, 'REPUBLIC OF KENYA', mx, y, 4.5, { bold: true, align: 'center' });
  y += 7;
  drawText(doc, 'THE SURVEY ACT (CAP 299)', mx, y, 3, { bold: true, align: 'center' });
  y += 5;
  drawText(doc, 'FORM NO. 4', mx, y, 6, { bold: true, align: 'center' });
  y += 7;
  drawText(doc, 'SURVEY SUBMISSION FORM', mx, y, 3, { align: 'center' });
  y += 6;

  // Separator
  drawLine(doc, mx, y, 210 - mx, y, LINE_WEIGHTS.titleBorder);
  y += 8;

  // ─── Survey Details ─────────────────────────────────────────
  drawSectionHeader(doc, mx, y, 'SURVEY DETAILS');
  y += 8;

  drawField(doc, mx, y, 'Survey Order No.:', data.surveyOrderNumber);
  y += 7;
  drawField(doc, mx, y, 'Type of Survey:', data.surveyType);
  y += 7;
  drawField(doc, mx, y, 'LR Number:', data.lrNumber);
  y += 7;
  drawField(doc, mx, y, 'Number of Parcels:', data.numberOfParcels.toString());
  y += 7;
  if (data.areaHa !== undefined) {
    drawField(doc, mx, y, 'Area (Ha):', data.areaHa.toFixed(4));
    y += 7;
  }
  drawField(doc, mx, y, 'Date of Survey:', data.dateOfSurvey);
  y += 7;
  drawField(doc, mx, y, 'Date Prepared:', data.datePrepared);
  y += 9;

  // ─── Location ──────────────────────────────────────────────
  drawSectionHeader(doc, mx, y, 'LOCATION');
  y += 8;

  drawField(doc, mx, y, 'Locality:', data.locality);
  y += 7;
  drawField(doc, mx, y, 'County:', data.county);
  y += 7;
  if (data.subCounty) {
    drawField(doc, mx, y, 'Sub-County/Division:', data.subCounty);
    y += 7;
  }
  if (data.district) {
    drawField(doc, mx, y, 'District:', data.district);
    y += 7;
  }
  if (data.registryMapSheet) {
    drawField(doc, mx, y, 'Registry Map Sheet:', data.registryMapSheet);
    y += 7;
  }
  y += 4;

  // ─── Coordinate System ──────────────────────────────────────
  drawSectionHeader(doc, mx, y, 'COORDINATE SYSTEM');
  y += 8;

  drawField(doc, mx, y, 'Projection:', data.projection ?? 'UTM');
  y += 7;
  drawField(doc, mx, y, 'Datum:', data.datum ?? 'Arc 1960');
  y += 9;

  // ─── Deed Plans ─────────────────────────────────────────────
  if (data.deedPlanNumbers && data.deedPlanNumbers.length > 0) {
    drawSectionHeader(doc, mx, y, 'DEED PLANS SUBMITTED');
    y += 8;
    for (const dpNumber of data.deedPlanNumbers) {
      drawText(doc, `• DP No. ${dpNumber}`, mx + 5, y, TEXT_SIZES.coordinate);
      y += 6;
    }
    y += 4;
  }

  // ─── Remarks ────────────────────────────────────────────────
  if (data.remarks) {
    drawSectionHeader(doc, mx, y, 'REMARKS');
    y += 8;
    drawText(doc, data.remarks, mx, y, TEXT_SIZES.small);
    y += 12;
  }

  // ─── Surveyor Declaration ───────────────────────────────────
  drawSectionHeader(doc, mx, y, 'SURVEYOR DECLARATION');
  y += 8;

  drawText(doc, `I, ${data.surveyorName} (License: ${data.surveyorLicense}), Licensed Surveyor,`, mx, y, TEXT_SIZES.small);
  y += 4;
  drawText(doc, 'hereby submit the above survey for examination and approval in accordance', mx, y, TEXT_SIZES.small);
  y += 4;
  drawText(doc, 'with the Survey Act (Cap 299) and the Kenya Survey Regulations 1994.', mx, y, TEXT_SIZES.small);
  y += 10;

  // Surveyor signature
  drawLine(doc, mx + 80, y, 210 - mx, y, 0.2);
  drawText(doc, data.surveyorName, mx + 80, y + 2, TEXT_SIZES.small, { bold: true });
  drawText(doc, `License: ${data.surveyorLicense}`, mx + 80, y + 5, TEXT_SIZES.small);

  y += 8;
  if (data.firmName) {
    drawText(doc, `Firm: ${data.firmName}`, mx + 80, y, TEXT_SIZES.small);
    y += 6;
  }

  drawLine(doc, mx + 80, y, 210 - mx, y, 0.2);
  drawText(doc, 'Date', mx + 80, y + 2, TEXT_SIZES.small);

  // ─── Director of Surveys Approval ──────────────────────────
  y += 10;
  drawLine(doc, mx, y, 210 - mx, y, LINE_WEIGHTS.titleBorder);
  y += 5;
  drawText(doc, 'FOR DIRECTOR OF SURVEYS', mx, y, TEXT_SIZES.coordinate, { bold: true });
  y += 8;

  drawField(doc, mx, y, 'Examined by:', '');
  y += 10;
  drawField(doc, mx, y, 'Approved / Refused:', '');
  y += 10;
  drawField(doc, mx, y, 'Reference:', '');
  y += 10;
  drawLine(doc, mx + 80, y, 210 - mx, y, 0.2);
  drawText(doc, 'Signature / Date', mx + 80, y + 2, TEXT_SIZES.small);

  y += 8;
  drawText(doc, 'Official Stamp:', mx, y, TEXT_SIZES.coordinate, { bold: true });
  drawRect(doc, mx + 35, y - 2, 40, 25, 0.15);
  drawText(doc, '(STAMP)', mx + 43, y + 8, TEXT_SIZES.small, { color: '#999999' });

  // Footer
  drawText(doc, 'Generated by METARDU — Survey Act Cap 299 / Kenya Survey Regulations 1994', mx, pageH - 10, 1.5, { color: '#999999', align: 'center' });

  doc.end();
  return pdfPromise;
}

// ─── Helpers ─────────────────────────────────────────────────────

function drawSectionHeader(
  doc: PDFKit.PDFDocument,
  x: number, y: number,
  title: string
): void {
  drawRect(doc, x, y, 210 - 2 * x, 6, 0.15, 'black', '#1a3a5c');
  drawText(doc, title, x + 3, y + 1.5, TEXT_SIZES.small, { bold: true, color: '#FFFFFF' });
}

function drawField(
  doc: PDFKit.PDFDocument,
  x: number, y: number,
  label: string, value: string,
  labelWidth: number = 55
): void {
  drawText(doc, label, x, y, TEXT_SIZES.small, { bold: true });
  drawText(doc, value, x + labelWidth, y, TEXT_SIZES.coordinate);
  drawLine(doc, x + labelWidth, y + 3, 210 - x, y + 3, 0.08);
}

// ─── Template Registration ───────────────────────────────────────

export const FORM_NO4_TEMPLATE: DocumentTemplate<FormNo4Data> = {
  id: 'form-no4',
  name: 'Form No. 4 (Survey Submission)',
  description: 'A4 portrait survey submission form for the Director of Surveys, as required by the Survey Act Cap 299',
  documentType: 'form-no4',
  paperSize: 'A4',
  orientation: 'portrait',
  generate: generateFormNo4Pdf,
};
