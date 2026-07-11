/**
 * Mutation Form Template — Kenya Survey Department Standard
 *
 * Standard form for land subdivision, amalgamation, or boundary adjustment
 * as required by the Survey Act (Cap 299) and the Land Registration Act.
 *
 * Layout: A4 portrait
 *
 * Required elements:
 * - Original parcel number
 * - New parcel numbers
 * - Area before and after mutation
 * - Consent details
 * - LCB (Land Control Board) consent reference
 * - Surveyor declaration with license number
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

export interface MutationResultingParcel {
  /** New parcel number after mutation */
  parcelNumber: string;
  /** Area of resulting parcel in hectares */
  areaHa: number;
  /** Owner/proprietor of the resulting parcel */
  owner?: string;
}

export interface MutationBeaconChange {
  /** Beacon identifier */
  beaconId: string;
  /** Action on the beacon */
  action: 'new' | 'disturbed' | 'adopted' | 'cancelled';
  /** Easting coordinate */
  easting: number;
  /** Northing coordinate */
  northing: number;
}

export interface MutationFormData {
  /** Original parcel LR number */
  originalLRNumber: string;
  /** Original parcel number */
  originalParcelNumber: string;
  /** Area of original parcel in hectares */
  originalAreaHa: number;
  /** Registry Map Sheet reference */
  registryMapSheet: string;
  /** County */
  county: string;
  /** Sub-county or division */
  subCounty?: string;
  /** District */
  district?: string;
  /** Locality */
  locality?: string;
  /** Type of mutation */
  mutationType: 'subdivision' | 'amalgamation' | 'boundary_adjustment' | 'resurvey';
  /** Reason for mutation */
  reasonForMutation: string;
  /** LCB (Land Control Board) consent reference number */
  lcbConsentRef?: string;
  /** Date of LCB consent */
  lcbConsentDate?: string;
  /** Resulting parcels after mutation */
  resultingParcels: MutationResultingParcel[];
  /** Affected beacons */
  affectedBeacons: MutationBeaconChange[];
  /** Surveyor name */
  surveyorName: string;
  /** Surveyor license number */
  surveyorLicense: string;
  /** Date of survey */
  date: string;
  /** Mutation reference number */
  mutationNumber?: string;
}

// ─── Core Generator ──────────────────────────────────────────────

async function generateMutationFormPdf(
  data: MutationFormData,
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
      title: `Mutation Form - ${data.originalLRNumber}`,
      surveyorName: data.surveyorName,
      surveyorLicense: data.surveyorLicense,
      projectReference: data.originalLRNumber,
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

  const mx = 20;
  let y = 20;

  // ─── Header ─────────────────────────────────────────────────
  if (companyLogo?.data) {
    drawCompanyLogo(doc, companyLogo.data, mx, y, 25, 8);
    y += 2;
  }
  drawText(doc, 'REPUBLIC OF KENYA', mx, y, 4.5, { bold: true, align: 'center' });
  y += 7;
  drawText(doc, 'SURVEY OF KENYA', mx, y, 3.5, { bold: true, align: 'center' });
  y += 6;
  drawText(doc, 'SURVEY MUTATION FORM', mx, y, 5, { bold: true, align: 'center' });
  y += 5;
  drawText(doc, '(Survey Act Cap 299 — Kenya Survey Regulations 1994)', mx, y, 2, { align: 'center' });
  y += 6;

  // Separator
  drawLine(doc, mx, y, 210 - mx, y, LINE_WEIGHTS.titleBorder);
  y += 5;

  // Reference number and mutation number
  drawText(doc, `Reference: ${data.mutationNumber ?? 'PENDING'}`, mx, y, TEXT_SIZES.coordinate, { bold: true });
  if (data.mutationNumber) {
    drawText(doc, `Mutation No.: ${data.mutationNumber}`, 210 - mx, y, TEXT_SIZES.coordinate, { align: 'right' });
  }
  y += 7;

  // ─── PART A — Original Parcel (Before Mutation) ─────────────
  drawSectionHeader(doc, mx, y, 'PART A — ORIGINAL PARCEL (BEFORE MUTATION)');
  y += 8;

  drawField(doc, mx, y, 'LR Number:', data.originalLRNumber);
  y += 7;
  drawField(doc, mx, y, 'Parcel Number:', data.originalParcelNumber);
  y += 7;
  drawField(doc, mx, y, 'Area (Ha):', data.originalAreaHa.toFixed(4));
  y += 7;
  drawField(doc, mx, y, 'Registry Map Sheet:', data.registryMapSheet);
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
  if (data.locality) {
    drawField(doc, mx, y, 'Locality:', data.locality);
    y += 7;
  }
  drawField(doc, mx, y, 'Mutation Type:', data.mutationType.replace(/_/g, ' ').toUpperCase());
  y += 7;
  drawField(doc, mx, y, 'Reason:', data.reasonForMutation);
  y += 9;

  // ─── PART B — Resulting Parcels (After Mutation) ───────────
  drawSectionHeader(doc, mx, y, 'PART B — RESULTING PARCELS (AFTER MUTATION)');
  y += 8;

  // Table header
  const colX = [mx, mx + 45, mx + 90, mx + 130];
  const tableHeaders = ['Parcel Number', 'Area (Ha)', 'Owner/Proprietor', 'Notes'];
  drawTableHeader(doc, colX, tableHeaders, y, 210 - mx);
  y += 6;

  // Table rows
  for (const parcel of data.resultingParcels) {
    drawText(doc, parcel.parcelNumber, colX[0], y, TEXT_SIZES.small);
    drawText(doc, parcel.areaHa.toFixed(4), colX[1], y, TEXT_SIZES.small);
    drawText(doc, parcel.owner ?? '—', colX[2], y, TEXT_SIZES.small);
    drawLine(doc, mx, y + 3, 210 - mx, y + 3, 0.08);
    y += 6;
  }

  // Area summary
  const totalResultingHa = data.resultingParcels.reduce((s, p) => s + p.areaHa, 0);
  const areaDiff = Math.abs(totalResultingHa - data.originalAreaHa);
  y += 2;
  drawText(doc, `Total Resulting: ${totalResultingHa.toFixed(4)} Ha`, mx, y, TEXT_SIZES.small, { bold: true });
  drawText(doc, `Original: ${data.originalAreaHa.toFixed(4)} Ha`, mx + 65, y, TEXT_SIZES.small);
  drawText(doc, `Difference: ${areaDiff.toFixed(4)} Ha`, mx + 130, y, TEXT_SIZES.small);
  y += 9;

  // ─── PART C — LCB Consent ──────────────────────────────────
  drawSectionHeader(doc, mx, y, 'PART C — LAND CONTROL BOARD CONSENT');
  y += 8;

  drawField(doc, mx, y, 'LCB Consent Ref:', data.lcbConsentRef ?? 'Pending');
  y += 7;
  drawField(doc, mx, y, 'LCB Consent Date:', data.lcbConsentDate ?? 'Pending');
  y += 9;

  // ─── PART D — Affected Beacons ────────────────────────────
  drawSectionHeader(doc, mx, y, 'PART D — AFFECTED BEACONS');
  y += 8;

  if (data.affectedBeacons.length === 0) {
    drawText(doc, 'No beacon changes recorded.', mx, y, TEXT_SIZES.small, { color: '#666666' });
    y += 7;
  } else {
    const bColX = [mx, mx + 25, mx + 60, mx + 95, mx + 135];
    const bHeaders = ['Beacon', 'Action', 'Easting (m)', 'Northing (m)', 'Remarks'];
    drawTableHeader(doc, bColX, bHeaders, y, 210 - mx);
    y += 6;

    for (const beacon of data.affectedBeacons) {
      drawText(doc, beacon.beaconId, bColX[0], y, TEXT_SIZES.small);
      drawText(doc, beacon.action.toUpperCase(), bColX[1], y, TEXT_SIZES.small);
      drawText(doc, beacon.easting.toFixed(3), bColX[2], y, TEXT_SIZES.small);
      drawText(doc, beacon.northing.toFixed(3), bColX[3], y, TEXT_SIZES.small);
      drawLine(doc, mx, y + 3, 210 - mx, y + 3, 0.08);
      y += 6;
    }
  }
  y += 5;

  // ─── PART E — Surveyor Declaration ──────────────────────────
  drawSectionHeader(doc, mx, y, 'PART E — SURVEYOR CERTIFICATION');
  y += 8;

  drawText(doc, `I, ${data.surveyorName} (License: ${data.surveyorLicense}), Licensed Surveyor,`, mx, y, TEXT_SIZES.small);
  y += 4;
  drawText(doc, 'hereby certify that the mutation described in this form has been carried out', mx, y, TEXT_SIZES.small);
  y += 4;
  drawText(doc, 'in accordance with the Kenya Survey Regulations 1994 and the Survey Act Cap 299.', mx, y, TEXT_SIZES.small);
  y += 10;

  // Surveyor signature
  drawLine(doc, mx + 100, y, 210 - mx, y, 0.2);
  drawText(doc, 'Surveyor Signature / Date', mx + 100, y + 2, TEXT_SIZES.small);

  y += 12;

  // ─── For Official Use ──────────────────────────────────────
  drawLine(doc, mx, y, 210 - mx, y, LINE_WEIGHTS.titleBorder);
  y += 5;
  drawText(doc, 'FOR OFFICIAL USE ONLY', mx, y, TEXT_SIZES.coordinate, { bold: true });
  y += 7;

  // Stamp box
  drawText(doc, 'Official Stamp:', mx, y, TEXT_SIZES.coordinate, { bold: true });
  drawRect(doc, mx + 35, y - 2, 40, 25, 0.15);
  drawText(doc, '(STAMP)', mx + 43, y + 8, TEXT_SIZES.small, { color: '#999999' });

  drawLine(doc, mx + 100, y + 15, 210 - mx, y + 15, 0.2);
  drawText(doc, 'Director of Surveys / Date', mx + 100, y + 17, TEXT_SIZES.small);

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

function drawTableHeader(
  doc: PDFKit.PDFDocument,
  colX: number[],
  headers: string[],
  y: number,
  rightX: number
): void {
  drawLine(doc, colX[0], y + 2, rightX, y + 2, 0.2);
  for (let i = 0; i < headers.length; i++) {
    drawText(doc, headers[i], colX[i], y, TEXT_SIZES.small, { bold: true });
  }
}

// ─── Template Registration ───────────────────────────────────────

export const MUTATION_FORM_TEMPLATE: DocumentTemplate<MutationFormData> = {
  id: 'mutation-form',
  name: 'Mutation Form (Survey Act Cap 299)',
  description: 'A4 portrait mutation form for land subdivision, amalgamation, or boundary adjustment with LCB consent section',
  documentType: 'mutation-form',
  paperSize: 'A4',
  orientation: 'portrait',
  generate: generateMutationFormPdf,
};
