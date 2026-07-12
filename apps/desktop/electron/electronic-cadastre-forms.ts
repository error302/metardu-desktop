/**
 * Electronic Cadastre Forms — SR1 to SR10
 *
 * Implements the 10 statutory forms prescribed by the Survey (Electronic
 * Cadastre Transactions) Regulations, 2020 (Legal Notice 132 of 2020).
 *
 * These forms are the OFFICIAL documents used for the entire survey
 * submission lifecycle to the Director of Surveys via NLIS/ArdhiSasa:
 *
 *   SR1:  Surveyor user account creation (Reg 6(1))
 *   SR2:  Request for purchase of data (Reg 8(1))
 *   SR3:  Survey submission form (Reg 9(1)(a))
 *   SR4:  Notification of rejection before numbering (Reg 10(3))
 *   SR5:  Numbering of survey records (Reg 11(1))
 *   SR6:  Authentication (Reg 12(3))
 *   SR7:  Notification of authentication (Reg 12(4))
 *   SR8:  Notification of rejection of survey (Reg 12(5))
 *   SR9:  Request to update cadastral map (Reg 13(1)(c))
 *   SR10: Notification of sealing of cadastral map (Reg 14(3))
 *
 * Submission lifecycle:
 *   1. Surveyor signs up (SR1) + accepts terms
 *   2. Surveyor purchases reference data (SR2)
 *   3. Surveyor executes survey
 *   4. Surveyor submits (SR3) → tracking number assigned
 *   5. Director reviews → authorize processing OR reject (SR4)
 *   6. Numbering (SR5)
 *   7. Authentication check (SR6) — fees assessed
 *   8. Authentication notification (SR7) OR rejection (SR8)
 *      - Rejection requires corrections within 12 months
 *   9. Surveyor pays fees + requests update (SR9)
 *   10. Director updates Electronic Cadastral Map
 *   11. Director seals map (SR10) within 21 days
 *   12. Director notifies NLC OR OIC Land Administration
 *
 * All forms sealed with RSA-2048.
 */

import PDFDocument from 'pdfkit';
import * as fs from 'node:fs';
import log from 'electron-log/main';
import { sealDocument, loadOrCreateSurveyorKeypair, type SurveyorKeypair } from './crypto-seal.js';

// ─── Constants ─────────────────────────────────────────────────────────
const MM_TO_PT = 2.8346;
const A4_WIDTH_PT = 210 * MM_TO_PT;
const A4_HEIGHT_PT = 297 * MM_TO_PT;
const MARGIN_PT = 15 * MM_TO_PT;

const COLOR_BLACK = '#000000';
const COLOR_GREY = '#666666';
const COLOR_LIGHT_GREY = '#CCCCCC';
const COLOR_ACCENT = '#003366';
const COLOR_WARNING = '#CC0000';
const COLOR_GREEN = '#008800';

const FS_TITLE = 14;
const FS_HEADING = 11;
const FS_SUBHEADING = 9;
const FS_BODY = 8;
const FS_SMALL = 6.5;

// ─── Shared Types ──────────────────────────────────────────────────────

export type SurveyTypeOfficial =
  | 'new_grant'
  | 'subdivision'
  | 'partition'
  | 'reparcellation_combination'
  | 'change_of_user'
  | 'extension_of_user'
  | 'renewal_of_lease'
  | 'extension_of_lease'
  | 're_establishment'
  | 'compilation';

export const SURVEY_TYPE_LABELS: Record<SurveyTypeOfficial, string> = {
  new_grant: 'New Grant',
  subdivision: 'Subdivision',
  partition: 'Partition',
  reparcellation_combination: 'Re-parcellation Combination',
  change_of_user: 'Change of User',
  extension_of_user: 'Extension of User',
  renewal_of_lease: 'Renewal of Lease',
  extension_of_lease: 'Extension of Lease',
  re_establishment: 'Re-establishment',
  compilation: 'Compilation',
};

export interface SurveyorProfile {
  name: string;
  nationalIdOrAlien: string;        // National ID or Alien Card Number
  kraPin: string;                   // KRA PIN per Tax Procedures Act
  surveyLicenceNumber: string;      // Survey Licence Number
  dosAuthorizationCode: string;     // Director of Surveys Authorization Code
  practicingCertificateNumber: string;  // Current Practicing Certificate
  telephone: string;
  email: string;
  postalAddress: string;
  physicalAddress: string;
  passportPhotoPath?: string;       // path to passport photo file
}

export interface SubmissionTracking {
  trackingNumber: string;            // assigned by system on submission
  submittedAt: string;               // ISO datetime
  surveyor: SurveyorProfile;
  surveyType: SurveyTypeOfficial;
  locality: string;
  lrNumber: string;
  parcelNumbers: string[];
  status: SubmissionStatus;
  history: SubmissionHistoryEntry[];
}

export type SubmissionStatus =
  | 'draft'
  | 'submitted'           // SR3 submitted, tracking number assigned
  | 'under_review'        // Director reviewing
  | 'rejected_pre_numbering'  // SR4 issued
  | 'numbered'            // SR5 completed
  | 'authenticated'       // SR6 + SR7 issued
  | 'rejected_post_auth'  // SR8 issued
  | 'corrections_pending' // 12-month window
  | 'fees_paid'           // surveyor paid
  | 'update_requested'    // SR9 submitted
  | 'map_updated'         // Director updated
  | 'sealed'              // SR10 issued — final
  ;

export interface SubmissionHistoryEntry {
  timestamp: string;
  status: SubmissionStatus;
  note?: string;
  officerName?: string;
}

// ─── Form Inputs ───────────────────────────────────────────────────────

export interface SR1Input {
  surveyor: SurveyorProfile;
  outputPath: string;
  sealWithRSA?: boolean;
  keypair?: SurveyorKeypair;
}

export interface SR2Input {
  surveyor: SurveyorProfile;
  requestDate: string;
  items: Array<{
    type: 'cadastral_plan' | 'cadastral_map' | 'topographical_map' | 'other_data';
    frNumber?: string;
    sheetNumber?: string;
    lrNumber?: string;
    parcelNumber?: string;
    numberOfCopies: number;
    electronicFormat: string;
    unitPrice: number;
  }>;
  outputPath: string;
  sealWithRSA?: boolean;
  keypair?: SurveyorKeypair;
}

export interface SR3Input {
  surveyor: SurveyorProfile;
  registeredAssistant?: string;
  surveyType: SurveyTypeOfficial;
  dateSubmitted: string;
  locality: string;
  lrNumber: string;
  parcelNumbers: string[];
  plansUsedForData: string[];
  instruments: Array<{
    manufacturer: string;
    model: string;
    serialNumber: string;
    calibrationDate?: string;
  }>;
  fieldNotes: {
    totalPages: number;
    coverPage: boolean;
    indexToFieldNotes: boolean;
    otherPages: number;
  };
  surveyPlans: {
    total: number;
    formNo2: number;
    formNo3: number;
    formNo4: number;
  };
  surveyComputations: {
    totalPages: number;
    surveyorsReport: boolean;
    indexToComputations: boolean;
  };
  softCopyObservationData?: string;
  approvalDocuments?: string[];
  outputPath: string;
  sealWithRSA?: boolean;
  keypair?: SurveyorKeypair;
}

export interface SR4Input {
  trackingNumber: string;
  formerParcelNumbers: string[];
  locality: string;
  reasonsForReturning: string;
  outputPath: string;
  sealWithRSA?: boolean;
  keypair?: SurveyorKeypair;
}

export interface SR5Input {
  trackingNumber: string;
  recordsOfficer: string;
  entryNumber: string;
  dateReceived: string;
  lrNumber: string;
  planFrNumber: string;
  originalNumber: string;
  compsNumber: string;
  headTitleDeedPlanNumber: string;
  fieldNotesNumber: string;
  locality: string;
  surveyor: string;
  skFileNumber: string;
  fileCorrectForLocality: boolean;
  fileRefProvisionalApproval?: string;
  fileRefFinalApproval?: string;
  approvalStampAdded: boolean;
  referencePlans: string[];
  abuttals: string[];
  crossReferencesOnSurveyPlans: number;
  crossReferencesOnTracings: number;
  registrationCompletedBy: string;
  registrationCompletedDate: string;
  registrationCheckedBy: string;
  registrationCheckedDate: string;
  outputPath: string;
  sealWithRSA?: boolean;
  keypair?: SurveyorKeypair;
}

export interface SR6Input {
  trackingNumber: string;
  planFrNumber: string;
  finalCheckersRecommendation: string;
  authenticationDecision: 'authenticated' | 'rejected';
  plotNumber: string;
  assessedSurveyFees: number;
  assessedCheckingFees: number;
  assessedCadastralMapUpdatingFees: number;
  outputPath: string;
  sealWithRSA?: boolean;
  keypair?: SurveyorKeypair;
}

export interface SR7Input {
  referenceNumber: string;
  date: string;
  registrationDistrict: string;
  registrationBlockOrRimSheet: string;
  surveyorReference: string;
  surveyorReferenceDate: string;
  planFrNumber: string;
  parcelNumbers: string[];
  oldParcelNumbers: string[];
  printsCostPerCopy: number;
  newParcels: Array<{
    parcelNumber: string;
    areaHa: number;
    surveyCheckingFees: number;
    boundaryType: string;
  }>;
  outputPath: string;
  sealWithRSA?: boolean;
  keypair?: SurveyorKeypair;
}

export interface SR8Input {
  trackingNumber: string;
  dateOfNotification: string;
  surveyorName: string;
  locality: string;
  newParcelNumbers: string[];
  feesPayableToDirector: number;
  newSurveyPlanNumbers: string[];
  computationsFileNumber: string;
  fieldNotesNumber: string;
  reasonsForReturning: string;
  outputPath: string;
  sealWithRSA?: boolean;
  keypair?: SurveyorKeypair;
}

export interface SR9Input {
  trackingNumber: string;
  dateOfRequest: string;
  surveyorName: string;
  locality: string;
  newParcelNumbers: string[];
  newSurveyPlanNumbers: string[];
  computationsFileNumber: string;
  fieldNotesNumber: string;
  outputPath: string;
  sealWithRSA?: boolean;
  keypair?: SurveyorKeypair;
}

export interface SR10Input {
  trackingNumber: string;
  dateOfNotification: string;
  officerNotifying: string;
  surveyorName: string;
  locality: string;
  newParcelNumbers: string[];
  newSurveyPlanNumbers: string[];
  computationsFileNumber: string;
  fieldNotesNumber: string;
  officeNotified: 'nlc' | 'oic_land_admin';
  outputPath: string;
  sealWithRSA?: boolean;
  keypair?: SurveyorKeypair;
}

// ─── Shared Helpers ────────────────────────────────────────────────────

function drawHeader(doc: PDFKit.PDFDocument, formCode: string, formTitle: string) {
  const top = MARGIN_PT;
  doc.moveTo(MARGIN_PT, top + 18)
    .lineTo(A4_WIDTH_PT - MARGIN_PT, top + 18)
    .lineWidth(1.2)
    .stroke(COLOR_ACCENT);

  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_ACCENT)
    .text('REPUBLIC OF KENYA — SURVEY OF KENYA', MARGIN_PT, top);
  doc.font('Helvetica').fontSize(FS_SUBHEADING).fillColor(COLOR_BLACK)
    .text(`FORM ${formCode} — ${formTitle}`, MARGIN_PT, top + 12);
  doc.font('Helvetica-Oblique').fontSize(FS_SMALL).fillColor(COLOR_GREY)
    .text('Survey (Electronic Cadastre Transactions) Regulations, 2020 (LN 132 of 2020)',
      A4_WIDTH_PT - 130, top + 12, { width: 120, align: 'right' });
}

function drawFooter(doc: PDFKit.PDFDocument) {
  const bottom = A4_HEIGHT_PT - MARGIN_PT - 14;
  doc.moveTo(MARGIN_PT, bottom)
    .lineTo(A4_WIDTH_PT - MARGIN_PT, bottom)
    .lineWidth(0.5)
    .stroke(COLOR_GREY);
  doc.font('Helvetica').fontSize(FS_SMALL).fillColor(COLOR_GREY)
    .text('Generated by METARDU Desktop — sealed with RSA-2048 per LN 132 of 2020',
      MARGIN_PT, bottom + 3,
      { width: A4_WIDTH_PT - 2 * MARGIN_PT, align: 'center' }
    );
}

async function sealAndAppend(
  basePath: string,
  drawCertPage: (doc: PDFKit.PDFDocument) => void,
  sealWithRSA: boolean,
  keypair?: SurveyorKeypair,
): Promise<{ sealed: boolean; fingerprint?: string; signedAt?: string; warnings: string[] }> {
  const warnings: string[] = [];
  const pdfBytes = fs.readFileSync(basePath);
  const crypto = await import('node:crypto');
  const documentHash = crypto.createHash('sha256').update(pdfBytes).digest('hex');

  let sealed = false;
  let fingerprint: string | undefined;
  let signedAt: string | undefined;

  if (sealWithRSA !== false) {
    try {
      const kp = keypair ?? loadOrCreateSurveyorKeypair();
      const seal = sealDocument(documentHash, kp);
      sealed = true;
      fingerprint = seal.keyFingerprint;
      signedAt = seal.signedAt;

      const certDoc = new PDFDocument({
        size: [A4_WIDTH_PT, A4_HEIGHT_PT],
        margins: { top: MARGIN_PT, bottom: MARGIN_PT, left: MARGIN_PT, right: MARGIN_PT },
      });
      const tmpPath = basePath + '.cert.tmp';
      const stream = fs.createWriteStream(tmpPath);
      certDoc.pipe(stream);

      drawHeader(certDoc, 'CERT', 'Digital Seal');
      drawCertPage(certDoc);

      // Digital seal block
      let y = A4_HEIGHT_PT - MARGIN_PT - 100;
      certDoc.moveTo(MARGIN_PT, y).lineTo(A4_WIDTH_PT - MARGIN_PT, y).lineWidth(0.5).stroke(COLOR_ACCENT);
      y += 8;
      certDoc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_ACCENT)
        .text('Digital Seal (RSA-2048)', MARGIN_PT, y);
      y += 16;
      const labelW = 50 * MM_TO_PT;
      const sealRows: Array<[string, string]> = [
        ['Algorithm', 'RSA-SHA256 (RSA-2048 keypair)'],
        ['Signed at', seal.signedAt],
        ['Document hash (SHA-256)', documentHash],
        ['Key fingerprint', seal.keyFingerprint],
        ['Public key', seal.publicKeyPem.split('\n').slice(0, 2).join(' ') + ' ...'],
        ['Signature (base64)', seal.signature.substring(0, 64) + ' ...'],
      ];
      for (const [label, value] of sealRows) {
        certDoc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
          .text(label, MARGIN_PT, y, { width: labelW });
        certDoc.font('Courier').fontSize(FS_SMALL).fillColor(COLOR_BLACK)
          .text(value, MARGIN_PT + labelW, y, { width: A4_WIDTH_PT - MARGIN_PT - labelW });
        y += 12;
        certDoc.moveTo(MARGIN_PT, y).lineTo(A4_WIDTH_PT - MARGIN_PT, y).lineWidth(0.1).stroke(COLOR_LIGHT_GREY);
      }

      drawFooter(certDoc);
      certDoc.end();

      await new Promise<void>((resolve, reject) => {
        stream.on('finish', () => resolve());
        stream.on('error', reject);
      });

      const pdfLib = await import('pdf-lib');
      const basePdf = await pdfLib.PDFDocument.load(fs.readFileSync(basePath));
      const certPdf = await pdfLib.PDFDocument.load(fs.readFileSync(tmpPath));
      const copiedPages = await basePdf.copyPages(certPdf, certPdf.getPageIndices());
      for (const p of copiedPages) basePdf.addPage(p);
      const mergedBytes = await basePdf.save();
      fs.writeFileSync(basePath, mergedBytes);
      fs.unlinkSync(tmpPath);
    } catch (err) {
      log.error('RSA sealing failed: ' + String(err));
      warnings.push(`RSA sealing failed: ${String(err)}`);
    }
  }

  return { sealed, fingerprint, signedAt, warnings };
}

interface FormResult {
  pdfPath: string;
  pdfSizeBytes: number;
  pageCount: number;
  sealed: boolean;
  signatureFingerprint?: string;
  signedAt?: string;
  warnings: string[];
}

function drawKeyValueRow(doc: PDFKit.PDFDocument, label: string, value: string, y: number, labelW = 60 * MM_TO_PT): number {
  doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text(label, MARGIN_PT, y, { width: labelW });
  doc.font('Helvetica').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text(value, MARGIN_PT + labelW, y, { width: A4_WIDTH_PT - MARGIN_PT - labelW });
  doc.moveTo(MARGIN_PT, y + 12).lineTo(A4_WIDTH_PT - MARGIN_PT, y + 12).lineWidth(0.2).stroke(COLOR_LIGHT_GREY);
  return y + 14;
}

// ══════════════════════════════════════════════════════════════════════
// FORM SR1 — SURVEYOR USER ACCOUNT CREATION (Reg 6(1))
// ══════════════════════════════════════════════════════════════════════

export async function generateSR1(input: SR1Input): Promise<FormResult> {
  log.info('Generating Form SR1 — Surveyor User Account Creation');
  const doc = new PDFDocument({
    size: [A4_WIDTH_PT, A4_HEIGHT_PT],
    margins: { top: MARGIN_PT, bottom: MARGIN_PT, left: MARGIN_PT, right: MARGIN_PT },
    info: {
      Title: 'Form SR1 — Surveyor User Account Creation',
      Author: input.surveyor.name,
      Subject: 'LN 132 of 2020, Reg 6(1)',
      Producer: 'METARDU Desktop',
    },
  });
  const stream = fs.createWriteStream(input.outputPath);
  doc.pipe(stream);

  drawHeader(doc, 'SR1', 'SURVEYOR USER ACCOUNT CREATION');
  let y = MARGIN_PT + 30;
  doc.font('Helvetica-Bold').fontSize(FS_TITLE).fillColor(COLOR_ACCENT)
    .text('FORM SR1', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 22;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_BLACK)
    .text('DETAILS REQUIRED FOR CREATING A USER ACCOUNT BY A SURVEYOR', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 18;
  doc.font('Helvetica-Oblique').fontSize(FS_SUBHEADING).fillColor(COLOR_GREY)
    .text('Per Second Schedule, Regulation 6(1) — Survey (Electronic Cadastre Transactions) Regulations, 2020', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 22;

  const s = input.surveyor;
  y = drawKeyValueRow(doc, 'a) Name', s.name, y);
  y = drawKeyValueRow(doc, 'b) Personal Identity Number (KRA PIN)', s.kraPin, y);
  y = drawKeyValueRow(doc, 'c) Survey Licence Number', s.surveyLicenceNumber, y);
  y = drawKeyValueRow(doc, '   DOS Authorization Code', s.dosAuthorizationCode, y);
  y = drawKeyValueRow(doc, 'd) Current Practicing Certificate No.', s.practicingCertificateNumber, y);
  y = drawKeyValueRow(doc, 'e) Telephone Number', s.telephone, y);
  y = drawKeyValueRow(doc, 'f) Email Address', s.email, y);
  y = drawKeyValueRow(doc, 'g) Postal Address', s.postalAddress, y);
  y = drawKeyValueRow(doc, 'h) Passport Photo', s.passportPhotoPath ?? 'Attached separately', y);
  y = drawKeyValueRow(doc, 'i) Physical Address', s.physicalAddress, y);
  y += 8;
  y = drawKeyValueRow(doc, 'National ID / Alien Card', s.nationalIdOrAlien, y);

  // Declaration
  y += 20;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_ACCENT)
    .text('DECLARATION', MARGIN_PT, y);
  y += 16;
  doc.font('Helvetica').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('I declare that the information provided above is true and correct to the best of my knowledge. I have read and understood the Terms and Conditions of Use (First Schedule) and agree to be bound by them.', MARGIN_PT, y, { width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 30;
  doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('Name: _____________________________________________', MARGIN_PT, y);
  y += 16;
  doc.text('Signature: __________________________________________', MARGIN_PT, y);
  y += 16;
  doc.text('Date: _______________________________________________', MARGIN_PT, y);

  drawFooter(doc);
  doc.end();
  await new Promise<void>((resolve, reject) => { stream.on('finish', () => resolve()); stream.on('error', reject); });

  const sealResult = await sealAndAppend(input.outputPath, () => {}, input.sealWithRSA, input.keypair);
  const stats = fs.statSync(input.outputPath);
  return {
    pdfPath: input.outputPath, pdfSizeBytes: stats.size, pageCount: 2,
    sealed: sealResult.sealed, signatureFingerprint: sealResult.fingerprint, signedAt: sealResult.signedAt,
    warnings: sealResult.warnings,
  };
}

// ══════════════════════════════════════════════════════════════════════
// FORM SR2 — REQUEST FOR PURCHASE OF DATA (Reg 8(1))
// ══════════════════════════════════════════════════════════════════════

export async function generateSR2(input: SR2Input): Promise<FormResult> {
  log.info('Generating Form SR2 — Request for Purchase of Data');
  const doc = new PDFDocument({
    size: [A4_WIDTH_PT, A4_HEIGHT_PT],
    margins: { top: MARGIN_PT, bottom: MARGIN_PT, left: MARGIN_PT, right: MARGIN_PT },
    info: { Title: 'Form SR2 — Request for Purchase of Data', Author: input.surveyor.name, Producer: 'METARDU Desktop' },
  });
  const stream = fs.createWriteStream(input.outputPath);
  doc.pipe(stream);

  drawHeader(doc, 'SR2', 'REQUEST FOR PURCHASE OF DATA');
  let y = MARGIN_PT + 30;
  doc.font('Helvetica-Bold').fontSize(FS_TITLE).fillColor(COLOR_ACCENT)
    .text('FORM SR2', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 22;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_BLACK)
    .text('REQUEST FOR PURCHASE OF DATA', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 18;
  doc.font('Helvetica-Oblique').fontSize(FS_SUBHEADING).fillColor(COLOR_GREY)
    .text('Per Second Schedule, Regulation 8(1)', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 22;

  // Applicant info
  y = drawKeyValueRow(doc, 'Applicant (Surveyor)', input.surveyor.name, y);
  y = drawKeyValueRow(doc, 'Licence Number', input.surveyor.surveyLicenceNumber, y);
  y = drawKeyValueRow(doc, 'Date of Request', input.requestDate, y);
  y += 8;

  // Items table
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_ACCENT)
    .text('Data Requested', MARGIN_PT, y);
  y += 16;

  const cols = [
    { title: 'S/No', x: MARGIN_PT, w: 10 * MM_TO_PT, align: 'left' as const },
    { title: 'Type of Data', x: MARGIN_PT + 10 * MM_TO_PT, w: 30 * MM_TO_PT, align: 'left' as const },
    { title: 'F/R No. / Sheet / LR', x: MARGIN_PT + 40 * MM_TO_PT, w: 30 * MM_TO_PT, align: 'left' as const },
    { title: 'Parcel No.', x: MARGIN_PT + 70 * MM_TO_PT, w: 25 * MM_TO_PT, align: 'left' as const },
    { title: 'Copies', x: MARGIN_PT + 95 * MM_TO_PT, w: 15 * MM_TO_PT, align: 'right' as const },
    { title: 'E-Format', x: MARGIN_PT + 110 * MM_TO_PT, w: 25 * MM_TO_PT, align: 'left' as const },
    { title: 'Unit Price (KSh)', x: MARGIN_PT + 135 * MM_TO_PT, w: 25 * MM_TO_PT, align: 'right' as const },
    { title: 'Total (KSh)', x: MARGIN_PT + 160 * MM_TO_PT, w: 25 * MM_TO_PT, align: 'right' as const },
  ];
  for (const c of cols) {
    doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
      .text(c.title, c.x, y, { width: c.w, align: c.align });
  }
  y += 12;
  doc.moveTo(MARGIN_PT, y).lineTo(A4_WIDTH_PT - MARGIN_PT, y).lineWidth(0.5).stroke(COLOR_BLACK);

  let grandTotal = 0;
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i];
    y += 2;
    const total = item.unitPrice * item.numberOfCopies;
    grandTotal += total;
    const typeLabel = item.type === 'cadastral_plan' ? 'Cadastral Plan'
      : item.type === 'cadastral_map' ? 'Cadastral Map'
      : item.type === 'topographical_map' ? 'Topographical Map'
      : 'Other Data & Forms';
    doc.font('Helvetica').fontSize(FS_SMALL).fillColor(COLOR_BLACK)
      .text(String(i + 1), cols[0].x, y, { width: cols[0].w, align: 'left' })
      .text(typeLabel, cols[1].x, y, { width: cols[1].w, align: 'left' })
      .text(item.frNumber ?? item.sheetNumber ?? item.lrNumber ?? '—', cols[2].x, y, { width: cols[2].w, align: 'left' })
      .text(item.parcelNumber ?? '—', cols[3].x, y, { width: cols[3].w, align: 'left' });
    doc.font('Courier').fontSize(FS_SMALL).fillColor(COLOR_BLACK)
      .text(String(item.numberOfCopies), cols[4].x, y, { width: cols[4].w, align: 'right' });
    doc.font('Helvetica').fontSize(FS_SMALL)
      .text(item.electronicFormat, cols[5].x, y, { width: cols[5].w, align: 'left' });
    doc.font('Courier').fontSize(FS_SMALL)
      .text(item.unitPrice.toFixed(2), cols[6].x, y, { width: cols[6].w, align: 'right' })
      .text(total.toFixed(2), cols[7].x, y, { width: cols[7].w, align: 'right' });
    y += 12;
    doc.moveTo(MARGIN_PT, y).lineTo(A4_WIDTH_PT - MARGIN_PT, y).lineWidth(0.1).stroke(COLOR_LIGHT_GREY);
  }

  // Grand total
  y += 8;
  doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('GRAND TOTAL:', MARGIN_PT + 100 * MM_TO_PT, y, { width: 60 * MM_TO_PT, align: 'right' });
  doc.font('Courier').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text(`KSh ${grandTotal.toFixed(2)}`, MARGIN_PT + 160 * MM_TO_PT, y, { width: 25 * MM_TO_PT, align: 'right' });

  // Approval section
  y += 30;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_ACCENT)
    .text('APPROVAL OF REQUEST (For Official Use)', MARGIN_PT, y);
  y += 16;
  doc.font('Helvetica').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('Request for purchase of maps is hereby:  [  ] Approved    [  ] Not Approved', MARGIN_PT, y);
  y += 16;
  doc.text('If Approved: The OI/C Survey Records to supply the maps after the above payment has been made.', MARGIN_PT, y);
  y += 14;
  doc.text('If Not Approved, Reasons: _____________________________________________', MARGIN_PT, y);
  y += 20;
  doc.text('Signed: ____________________________  Date: _______________________', MARGIN_PT, y);
  y += 14;
  doc.font('Helvetica-Bold').text('Director of Surveys', MARGIN_PT, y);

  // Accounts section
  y += 24;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_ACCENT)
    .text('ACCOUNTS SECTION', MARGIN_PT, y);
  y += 16;
  doc.font('Helvetica').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('Payment of KSh ______________ in respect of the maps requested for is hereby acknowledged.', MARGIN_PT, y);
  y += 16;
  doc.text('Signed: ____________________________  Date: _______________________', MARGIN_PT, y);
  y += 14;
  doc.font('Helvetica-Bold').text('OI/C: Accounts', MARGIN_PT, y);

  // Survey records section
  y += 24;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_ACCENT)
    .text('OI/C: SURVEY RECORDS', MARGIN_PT, y);
  y += 16;
  doc.font('Helvetica').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('Maps as requested for have been supplied.', MARGIN_PT, y);
  y += 16;
  doc.text('Signed: ____________________________  Date: _______________________', MARGIN_PT, y);
  y += 14;
  doc.font('Helvetica-Bold').text('OI/C: Survey Records', MARGIN_PT, y);

  drawFooter(doc);
  doc.end();
  await new Promise<void>((resolve, reject) => { stream.on('finish', () => resolve()); stream.on('error', reject); });

  const sealResult = await sealAndAppend(input.outputPath, () => {}, input.sealWithRSA, input.keypair);
  const stats = fs.statSync(input.outputPath);
  return {
    pdfPath: input.outputPath, pdfSizeBytes: stats.size, pageCount: 2,
    sealed: sealResult.sealed, signatureFingerprint: sealResult.fingerprint, signedAt: sealResult.signedAt,
    warnings: sealResult.warnings,
  };
}

// ══════════════════════════════════════════════════════════════════════
// FORM SR3 — SURVEY SUBMISSION FORM (Reg 9(1)(a))
// ══════════════════════════════════════════════════════════════════════

export async function generateSR3(input: SR3Input): Promise<FormResult> {
  log.info('Generating Form SR3 — Survey Submission Form');
  const doc = new PDFDocument({
    size: [A4_WIDTH_PT, A4_HEIGHT_PT],
    margins: { top: MARGIN_PT, bottom: MARGIN_PT, left: MARGIN_PT, right: MARGIN_PT },
    info: { Title: 'Form SR3 — Survey Submission Form', Author: input.surveyor.name, Producer: 'METARDU Desktop' },
  });
  const stream = fs.createWriteStream(input.outputPath);
  doc.pipe(stream);

  drawHeader(doc, 'SR3', 'SURVEY SUBMISSION FORM');
  let y = MARGIN_PT + 30;
  doc.font('Helvetica-Bold').fontSize(FS_TITLE).fillColor(COLOR_ACCENT)
    .text('FORM SR3', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 22;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_BLACK)
    .text('SURVEY SUBMISSION FORM', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 18;
  doc.font('Helvetica-Oblique').fontSize(FS_SUBHEADING).fillColor(COLOR_GREY)
    .text('Per Second Schedule, Regulation 9(1)(a) — Submitted to Director of Surveys via NLIS', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 22;

  // Section 1: Surveyor info
  y = drawKeyValueRow(doc, '(1) Name of Surveyor', input.surveyor.name, y);
  y = drawKeyValueRow(doc, '    Licence Number', input.surveyor.surveyLicenceNumber, y);
  y = drawKeyValueRow(doc, '    Practicing Certificate', input.surveyor.practicingCertificateNumber, y);
  y = drawKeyValueRow(doc, '(2) Registered Assistant', input.registeredAssistant ?? 'N/A', y);
  y = drawKeyValueRow(doc, '(3) Type of Survey', SURVEY_TYPE_LABELS[input.surveyType], y);
  y = drawKeyValueRow(doc, '(4) Date Submitted', input.dateSubmitted, y);
  y = drawKeyValueRow(doc, '(5) Locality', input.locality, y);
  y = drawKeyValueRow(doc, '(6) LR No. / Parcel No.', `${input.lrNumber} / ${input.parcelNumbers.join(', ')}`, y);

  // Plans used
  y += 8;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_ACCENT)
    .text('(7) Plans Used for Data', MARGIN_PT, y);
  y += 14;
  for (const plan of input.plansUsedForData) {
    doc.font('Helvetica').fontSize(FS_BODY).fillColor(COLOR_BLACK)
      .text(`  - ${plan}`, MARGIN_PT, y);
    y += 12;
  }
  if (input.plansUsedForData.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(FS_BODY).fillColor(COLOR_GREY)
      .text('  (none)', MARGIN_PT, y);
    y += 12;
  }

  // Instruments
  y += 8;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_ACCENT)
    .text('(8) Instruments Used in the Survey', MARGIN_PT, y);
  y += 16;
  const instCols = [
    { title: '#', x: MARGIN_PT, w: 8 * MM_TO_PT, align: 'left' as const },
    { title: 'Manufacturer', x: MARGIN_PT + 8 * MM_TO_PT, w: 35 * MM_TO_PT, align: 'left' as const },
    { title: 'Model', x: MARGIN_PT + 43 * MM_TO_PT, w: 35 * MM_TO_PT, align: 'left' as const },
    { title: 'Serial No.', x: MARGIN_PT + 78 * MM_TO_PT, w: 35 * MM_TO_PT, align: 'left' as const },
    { title: 'Calibration Date', x: MARGIN_PT + 113 * MM_TO_PT, w: 35 * MM_TO_PT, align: 'left' as const },
  ];
  for (const c of instCols) {
    doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
      .text(c.title, c.x, y, { width: c.w, align: c.align });
  }
  y += 12;
  doc.moveTo(MARGIN_PT, y).lineTo(A4_WIDTH_PT - MARGIN_PT, y).lineWidth(0.5).stroke(COLOR_BLACK);
  for (let i = 0; i < input.instruments.length; i++) {
    const inst = input.instruments[i];
    y += 2;
    doc.font('Helvetica').fontSize(FS_SMALL).fillColor(COLOR_BLACK)
      .text(String(i + 1), instCols[0].x, y, { width: instCols[0].w, align: 'left' })
      .text(inst.manufacturer, instCols[1].x, y, { width: instCols[1].w, align: 'left' })
      .text(inst.model, instCols[2].x, y, { width: instCols[2].w, align: 'left' })
      .text(inst.serialNumber, instCols[3].x, y, { width: instCols[3].w, align: 'left' })
      .text(inst.calibrationDate ?? 'N/A', instCols[4].x, y, { width: instCols[4].w, align: 'left' });
    y += 11;
    doc.moveTo(MARGIN_PT, y).lineTo(A4_WIDTH_PT - MARGIN_PT, y).lineWidth(0.1).stroke(COLOR_LIGHT_GREY);
  }

  // Field notes
  y += 8;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_ACCENT)
    .text('(9) Field Notes', MARGIN_PT, y);
  y += 14;
  y = drawKeyValueRow(doc, '    a) Total number of pages', String(input.fieldNotes.totalPages), y);
  y = drawKeyValueRow(doc, '    b) Cover page', input.fieldNotes.coverPage ? 'Yes' : 'No', y);
  y = drawKeyValueRow(doc, '    c) Index to field notes', input.fieldNotes.indexToFieldNotes ? 'Yes' : 'No', y);
  y = drawKeyValueRow(doc, '    d) Other pages', String(input.fieldNotes.otherPages), y);

  // Survey plans
  y += 8;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_ACCENT)
    .text('(10) Survey Plans', MARGIN_PT, y);
  y += 14;
  y = drawKeyValueRow(doc, '    a) Total number', String(input.surveyPlans.total), y);
  y = drawKeyValueRow(doc, '    b) Form No. 2', String(input.surveyPlans.formNo2), y);
  y = drawKeyValueRow(doc, '    c) Form No. 3', String(input.surveyPlans.formNo3), y);
  y = drawKeyValueRow(doc, '    d) Form No. 4', String(input.surveyPlans.formNo4), y);

  // Survey computations
  y += 8;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_ACCENT)
    .text('(11) Survey Computations', MARGIN_PT, y);
  y += 14;
  y = drawKeyValueRow(doc, '    a) Total number of pages', String(input.surveyComputations.totalPages), y);
  y = drawKeyValueRow(doc, '    b) Surveyor\'s Report', input.surveyComputations.surveyorsReport ? 'Yes' : 'No', y);
  y = drawKeyValueRow(doc, '    c) Index to Computations', input.surveyComputations.indexToComputations ? 'Yes' : 'No', y);

  // Soft copy observation data
  y += 8;
  y = drawKeyValueRow(doc, '(12) Soft copy observation data', input.softCopyObservationData ?? 'N/A', y);

  // Approval documents
  y += 8;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_ACCENT)
    .text('(13) Approval Documents', MARGIN_PT, y);
  y += 14;
  if (input.approvalDocuments && input.approvalDocuments.length > 0) {
    for (const docName of input.approvalDocuments) {
      doc.font('Helvetica').fontSize(FS_BODY).fillColor(COLOR_BLACK)
        .text(`  - ${docName}`, MARGIN_PT, y);
      y += 12;
    }
  } else {
    doc.font('Helvetica-Oblique').fontSize(FS_BODY).fillColor(COLOR_GREY)
      .text('  (none)', MARGIN_PT, y);
    y += 12;
  }

  // Tracking number placeholder
  y += 14;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_ACCENT)
    .text('TRACKING NUMBER (assigned by system upon submission)', MARGIN_PT, y);
  y += 16;
  doc.font('Courier').fontSize(FS_TITLE).fillColor(COLOR_BLACK)
    .text('To be assigned by NLIS upon electronic submission', MARGIN_PT, y, { width: A4_WIDTH_PT - 2 * MARGIN_PT, align: 'center' });

  drawFooter(doc);
  doc.end();
  await new Promise<void>((resolve, reject) => { stream.on('finish', () => resolve()); stream.on('error', reject); });

  const sealResult = await sealAndAppend(input.outputPath, () => {}, input.sealWithRSA, input.keypair);
  const stats = fs.statSync(input.outputPath);
  return {
    pdfPath: input.outputPath, pdfSizeBytes: stats.size, pageCount: 2,
    sealed: sealResult.sealed, signatureFingerprint: sealResult.fingerprint, signedAt: sealResult.signedAt,
    warnings: sealResult.warnings,
  };
}

// ══════════════════════════════════════════════════════════════════════
// FORMS SR4, SR5, SR6, SR7, SR8, SR9, SR10 (compact implementations)
// ══════════════════════════════════════════════════════════════════════

export async function generateSR4(input: SR4Input): Promise<FormResult> {
  log.info('Generating Form SR4 — Notification of Rejection before Numbering');
  const doc = new PDFDocument({
    size: [A4_WIDTH_PT, A4_HEIGHT_PT],
    margins: { top: MARGIN_PT, bottom: MARGIN_PT, left: MARGIN_PT, right: MARGIN_PT },
    info: { Title: 'Form SR4', Author: 'Director of Surveys', Producer: 'METARDU Desktop' },
  });
  const stream = fs.createWriteStream(input.outputPath);
  doc.pipe(stream);

  drawHeader(doc, 'SR4', 'NOTIFICATION OF REJECTION OF A SURVEY BEFORE NUMBERING');
  let y = MARGIN_PT + 30;
  doc.font('Helvetica-Bold').fontSize(FS_TITLE).fillColor(COLOR_WARNING)
    .text('FORM SR4', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 22;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_BLACK)
    .text('NOTIFICATION OF REJECTION OF A SURVEY BEFORE NUMBERING OF RECORDS', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 18;
  doc.font('Helvetica-Oblique').fontSize(FS_SUBHEADING).fillColor(COLOR_GREY)
    .text('Per Second Schedule, Regulation 10(3)', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 22;

  y = drawKeyValueRow(doc, 'a) Tracking Number', input.trackingNumber, y);
  y = drawKeyValueRow(doc, 'b) Former Parcel Number(s) / LR Nos.', input.formerParcelNumbers.join(', '), y);
  y = drawKeyValueRow(doc, 'c) Locality', input.locality, y);
  y += 8;
  doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('d) Reasons for Returning the Survey:', MARGIN_PT, y);
  y += 14;
  doc.font('Helvetica').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text(input.reasonsForReturning, MARGIN_PT, y, { width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 40;

  doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('Signed: ____________________________  Date: _______________________', MARGIN_PT, y);
  y += 14;
  doc.font('Helvetica-Bold').text('For: Director of Surveys', MARGIN_PT, y);

  drawFooter(doc);
  doc.end();
  await new Promise<void>((resolve, reject) => { stream.on('finish', () => resolve()); stream.on('error', reject); });
  const sealResult = await sealAndAppend(input.outputPath, () => {}, input.sealWithRSA, input.keypair);
  const stats = fs.statSync(input.outputPath);
  return { pdfPath: input.outputPath, pdfSizeBytes: stats.size, pageCount: 2, sealed: sealResult.sealed, signatureFingerprint: sealResult.fingerprint, signedAt: sealResult.signedAt, warnings: sealResult.warnings };
}

export async function generateSR5(input: SR5Input): Promise<FormResult> {
  log.info('Generating Form SR5 — Numbering of Survey Records');
  const doc = new PDFDocument({
    size: [A4_WIDTH_PT, A4_HEIGHT_PT],
    margins: { top: MARGIN_PT, bottom: MARGIN_PT, left: MARGIN_PT, right: MARGIN_PT },
    info: { Title: 'Form SR5', Producer: 'METARDU Desktop' },
  });
  const stream = fs.createWriteStream(input.outputPath);
  doc.pipe(stream);
  drawHeader(doc, 'SR5', 'NUMBERING OF SURVEY RECORDS');
  let y = MARGIN_PT + 30;
  doc.font('Helvetica-Bold').fontSize(FS_TITLE).fillColor(COLOR_ACCENT)
    .text('FORM SR5', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 22;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_BLACK)
    .text('NUMBERING OF SURVEY RECORDS', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 18;
  doc.font('Helvetica-Oblique').fontSize(FS_SUBHEADING).fillColor(COLOR_GREY)
    .text('Per Second Schedule, Regulation 11(1)', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 22;

  y = drawKeyValueRow(doc, 'Survey Records Tracking Number', input.trackingNumber, y);
  y = drawKeyValueRow(doc, 'Records Officer', input.recordsOfficer, y);
  y = drawKeyValueRow(doc, 'Entry No. (receipt in SRO)', input.entryNumber, y);
  y = drawKeyValueRow(doc, 'Date of Receipt', input.dateReceived, y);
  y = drawKeyValueRow(doc, 'Survey of LR No. / Parcel No.', input.lrNumber, y);
  y = drawKeyValueRow(doc, 'Plan F/R No.', input.planFrNumber, y);
  y = drawKeyValueRow(doc, 'Original No.', input.originalNumber, y);
  y = drawKeyValueRow(doc, 'Comps. No.', input.compsNumber, y);
  y = drawKeyValueRow(doc, 'Head Title Deed Plan No.', input.headTitleDeedPlanNumber, y);
  y = drawKeyValueRow(doc, 'Field Notes No.', input.fieldNotesNumber, y);
  y = drawKeyValueRow(doc, 'Locality', input.locality, y);
  y = drawKeyValueRow(doc, 'Surveyor', input.surveyor, y);
  y = drawKeyValueRow(doc, 'SK File No.', input.skFileNumber, y);
  y = drawKeyValueRow(doc, 'File correct for locality?', input.fileCorrectForLocality ? 'Yes' : 'No', y);
  y = drawKeyValueRow(doc, 'File ref. of Provisional Approval', input.fileRefProvisionalApproval ?? '—', y);
  y = drawKeyValueRow(doc, 'File ref. of Final Approval', input.fileRefFinalApproval ?? '—', y);
  y = drawKeyValueRow(doc, 'Approval stamp added to plan', input.approvalStampAdded ? 'Yes' : 'No', y);

  y += 8;
  doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('Reference Plans:', MARGIN_PT, y);
  y += 12;
  for (const rp of input.referencePlans) {
    doc.font('Helvetica').fontSize(FS_SMALL).fillColor(COLOR_BLACK)
      .text(`  - ${rp}`, MARGIN_PT, y);
    y += 10;
  }

  y += 6;
  doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('Abuttals:', MARGIN_PT, y);
  y += 12;
  for (const ab of input.abuttals) {
    doc.font('Helvetica').fontSize(FS_SMALL).fillColor(COLOR_BLACK)
      .text(`  - ${ab}`, MARGIN_PT, y);
    y += 10;
  }

  y += 8;
  y = drawKeyValueRow(doc, 'Cross references on Survey Plans (total)', String(input.crossReferencesOnSurveyPlans), y);
  y = drawKeyValueRow(doc, 'Cross references on Tracings (total)', String(input.crossReferencesOnTracings), y);
  y = drawKeyValueRow(doc, 'Registration completed by', input.registrationCompletedBy, y);
  y = drawKeyValueRow(doc, 'Registration completed date', input.registrationCompletedDate, y);
  y = drawKeyValueRow(doc, 'Registration checked by', input.registrationCheckedBy, y);
  y = drawKeyValueRow(doc, 'Registration checked date', input.registrationCheckedDate, y);

  drawFooter(doc);
  doc.end();
  await new Promise<void>((resolve, reject) => { stream.on('finish', () => resolve()); stream.on('error', reject); });
  const sealResult = await sealAndAppend(input.outputPath, () => {}, input.sealWithRSA, input.keypair);
  const stats = fs.statSync(input.outputPath);
  return { pdfPath: input.outputPath, pdfSizeBytes: stats.size, pageCount: 2, sealed: sealResult.sealed, signatureFingerprint: sealResult.fingerprint, signedAt: sealResult.signedAt, warnings: sealResult.warnings };
}

export async function generateSR6(input: SR6Input): Promise<FormResult> {
  log.info('Generating Form SR6 — Authentication');
  const doc = new PDFDocument({
    size: [A4_WIDTH_PT, A4_HEIGHT_PT],
    margins: { top: MARGIN_PT, bottom: MARGIN_PT, left: MARGIN_PT, right: MARGIN_PT },
    info: { Title: 'Form SR6', Producer: 'METARDU Desktop' },
  });
  const stream = fs.createWriteStream(input.outputPath);
  doc.pipe(stream);
  drawHeader(doc, 'SR6', 'AUTHENTICATION');
  let y = MARGIN_PT + 30;
  doc.font('Helvetica-Bold').fontSize(FS_TITLE).fillColor(COLOR_ACCENT)
    .text('FORM SR6', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 22;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_BLACK)
    .text('AUTHENTICATION', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 18;
  doc.font('Helvetica-Oblique').fontSize(FS_SUBHEADING).fillColor(COLOR_GREY)
    .text('Per Second Schedule, Regulation 12(3)', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 22;

  y = drawKeyValueRow(doc, 'Survey Records Tracking Number', input.trackingNumber, y);
  y = drawKeyValueRow(doc, 'Plan No. F/R', input.planFrNumber, y);

  y += 8;
  doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('Final Checker\'s Recommendation:', MARGIN_PT, y);
  y += 14;
  doc.font('Helvetica').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text(input.finalCheckersRecommendation, MARGIN_PT, y, { width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 30;

  doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('Authentication Decision:', MARGIN_PT, y);
  y += 14;
  const decisionColor = input.authenticationDecision === 'authenticated' ? COLOR_GREEN : COLOR_WARNING;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(decisionColor)
    .text(`>>> ${input.authenticationDecision.toUpperCase()} <<<`, MARGIN_PT, y);
  y += 22;

  y = drawKeyValueRow(doc, 'Plot Number', input.plotNumber, y);

  // Fees
  y += 8;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_ACCENT)
    .text('ASSESSED FEES (Per Fifth Schedule, Survey Regulations 1994)', MARGIN_PT, y);
  y += 16;

  const totalFees = input.assessedSurveyFees + input.assessedCheckingFees + input.assessedCadastralMapUpdatingFees;
  y = drawKeyValueRow(doc, 'Assessed Survey Fees', `KSh ${input.assessedSurveyFees.toFixed(2)}`, y);
  y = drawKeyValueRow(doc, 'Assessed Checking Fees', `KSh ${input.assessedCheckingFees.toFixed(2)}`, y);
  y = drawKeyValueRow(doc, 'Assessed Cadastral Map Updating Fees', `KSh ${input.assessedCadastralMapUpdatingFees.toFixed(2)}`, y);
  y += 6;
  doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_ACCENT)
    .text('ASSESSED TOTAL FEES', MARGIN_PT, y, { width: 80 * MM_TO_PT });
  doc.font('Courier').fontSize(FS_HEADING).fillColor(COLOR_ACCENT)
    .text(`KSh ${totalFees.toFixed(2)}`, MARGIN_PT + 80 * MM_TO_PT, y);

  drawFooter(doc);
  doc.end();
  await new Promise<void>((resolve, reject) => { stream.on('finish', () => resolve()); stream.on('error', reject); });
  const sealResult = await sealAndAppend(input.outputPath, () => {}, input.sealWithRSA, input.keypair);
  const stats = fs.statSync(input.outputPath);
  return { pdfPath: input.outputPath, pdfSizeBytes: stats.size, pageCount: 2, sealed: sealResult.sealed, signatureFingerprint: sealResult.fingerprint, signedAt: sealResult.signedAt, warnings: sealResult.warnings };
}

export async function generateSR7(input: SR7Input): Promise<FormResult> {
  log.info('Generating Form SR7 — Notification of Authentication');
  const doc = new PDFDocument({
    size: [A4_WIDTH_PT, A4_HEIGHT_PT],
    margins: { top: MARGIN_PT, bottom: MARGIN_PT, left: MARGIN_PT, right: MARGIN_PT },
    info: { Title: 'Form SR7', Producer: 'METARDU Desktop' },
  });
  const stream = fs.createWriteStream(input.outputPath);
  doc.pipe(stream);
  drawHeader(doc, 'SR7', 'NOTIFICATION OF AUTHENTICATION');
  let y = MARGIN_PT + 30;
  doc.font('Helvetica-Bold').fontSize(FS_TITLE).fillColor(COLOR_GREEN)
    .text('FORM SR7', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 22;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_BLACK)
    .text('NOTIFICATION OF AUTHENTICATION', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 18;
  doc.font('Helvetica-Oblique').fontSize(FS_SUBHEADING).fillColor(COLOR_GREY)
    .text('Per Second Schedule, Regulation 12(4) — Issued by Director of Surveys', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 22;

  // Letterhead
  doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('SURVEY OF KENYA', MARGIN_PT, y);
  y += 12;
  doc.font('Helvetica').fontSize(FS_SMALL).fillColor(COLOR_GREY)
    .text('P.O. BOX 30046, NAIROBI', MARGIN_PT, y);
  y += 12;
  doc.text('E-mail: surveys@ardhi.go.ke', MARGIN_PT, y);
  y += 18;

  y = drawKeyValueRow(doc, 'Ref. No.', input.referenceNumber, y);
  y = drawKeyValueRow(doc, 'Date', input.date, y);
  y = drawKeyValueRow(doc, 'Registration District', input.registrationDistrict, y);
  y = drawKeyValueRow(doc, 'Registration Block / Rim Sheet', input.registrationBlockOrRimSheet, y);
  y = drawKeyValueRow(doc, 'Your Reference', input.surveyorReference, y);
  y = drawKeyValueRow(doc, 'Your Reference Date', input.surveyorReferenceDate, y);
  y = drawKeyValueRow(doc, 'Plan F/R', input.planFrNumber, y);
  y = drawKeyValueRow(doc, 'Parcel Numbers (new)', input.parcelNumbers.join(', '), y);
  y = drawKeyValueRow(doc, 'Old Parcel Numbers', input.oldParcelNumbers.join(', '), y);

  y += 8;
  doc.font('Helvetica').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text(`Plan F/R ${input.planFrNumber} representing the survey of parcels ${input.parcelNumbers.join(', ')} (Old Parcel Nos. ${input.oldParcelNumbers.join(', ')}) has been APPROVED.`, MARGIN_PT, y, { width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 24;
  doc.text(`Prints of the plan for use under section 18(6) of the Act are available at a cost of KSh ${input.printsCostPerCopy.toFixed(2)} each.`, MARGIN_PT, y, { width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 24;
  doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('Further details are as follows:', MARGIN_PT, y);
  y += 14;

  // New parcels table
  const cols = [
    { title: 'New Parcel No.', x: MARGIN_PT, w: 40 * MM_TO_PT, align: 'left' as const },
    { title: 'Area (ha)', x: MARGIN_PT + 40 * MM_TO_PT, w: 30 * MM_TO_PT, align: 'right' as const },
    { title: 'Survey/Checking Fees (KSh)', x: MARGIN_PT + 70 * MM_TO_PT, w: 45 * MM_TO_PT, align: 'right' as const },
    { title: 'Type of Boundary', x: MARGIN_PT + 115 * MM_TO_PT, w: 60 * MM_TO_PT, align: 'left' as const },
  ];
  for (const c of cols) {
    doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
      .text(c.title, c.x, y, { width: c.w, align: c.align });
  }
  y += 12;
  doc.moveTo(MARGIN_PT, y).lineTo(A4_WIDTH_PT - MARGIN_PT, y).lineWidth(0.5).stroke(COLOR_BLACK);
  for (const p of input.newParcels) {
    y += 2;
    doc.font('Helvetica-Bold').fontSize(FS_SMALL).fillColor(COLOR_BLACK)
      .text(p.parcelNumber, cols[0].x, y, { width: cols[0].w, align: 'left' });
    doc.font('Courier').fontSize(FS_SMALL).fillColor(COLOR_BLACK)
      .text(p.areaHa.toFixed(4), cols[1].x, y, { width: cols[1].w, align: 'right' })
      .text(p.surveyCheckingFees.toFixed(2), cols[2].x, y, { width: cols[2].w, align: 'right' });
    doc.font('Helvetica').fontSize(FS_SMALL).fillColor(COLOR_BLACK)
      .text(p.boundaryType, cols[3].x, y, { width: cols[3].w, align: 'left' });
    y += 12;
    doc.moveTo(MARGIN_PT, y).lineTo(A4_WIDTH_PT - MARGIN_PT, y).lineWidth(0.1).stroke(COLOR_LIGHT_GREY);
  }

  y += 12;
  doc.font('Helvetica-Oblique').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('Prints of the new amended Cadastral Map will be forwarded to the appropriate authorities as soon as they are available.', MARGIN_PT, y, { width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 30;
  doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('For: DIRECTOR OF SURVEYS', MARGIN_PT, y);
  y += 18;
  doc.font('Helvetica').fontSize(FS_SMALL).fillColor(COLOR_GREY)
    .text('Copy to: Computations, Chief/Assistant Land Registrar', MARGIN_PT, y);

  drawFooter(doc);
  doc.end();
  await new Promise<void>((resolve, reject) => { stream.on('finish', () => resolve()); stream.on('error', reject); });
  const sealResult = await sealAndAppend(input.outputPath, () => {}, input.sealWithRSA, input.keypair);
  const stats = fs.statSync(input.outputPath);
  return { pdfPath: input.outputPath, pdfSizeBytes: stats.size, pageCount: 2, sealed: sealResult.sealed, signatureFingerprint: sealResult.fingerprint, signedAt: sealResult.signedAt, warnings: sealResult.warnings };
}

export async function generateSR8(input: SR8Input): Promise<FormResult> {
  log.info('Generating Form SR8 — Notification of Rejection of a Survey');
  const doc = new PDFDocument({
    size: [A4_WIDTH_PT, A4_HEIGHT_PT],
    margins: { top: MARGIN_PT, bottom: MARGIN_PT, left: MARGIN_PT, right: MARGIN_PT },
    info: { Title: 'Form SR8', Producer: 'METARDU Desktop' },
  });
  const stream = fs.createWriteStream(input.outputPath);
  doc.pipe(stream);
  drawHeader(doc, 'SR8', 'NOTIFICATION OF REJECTION OF A SURVEY');
  let y = MARGIN_PT + 30;
  doc.font('Helvetica-Bold').fontSize(FS_TITLE).fillColor(COLOR_WARNING)
    .text('FORM SR8', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 22;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_BLACK)
    .text('NOTIFICATION OF REJECTION OF A SURVEY', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 18;
  doc.font('Helvetica-Oblique').fontSize(FS_SUBHEADING).fillColor(COLOR_GREY)
    .text('Per Second Schedule, Regulation 12(5) — Issued by Director of Surveys', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 22;

  y = drawKeyValueRow(doc, 'a) Survey Records Tracking Number', input.trackingNumber, y);
  y = drawKeyValueRow(doc, 'b) Date of Notification', input.dateOfNotification, y);
  y = drawKeyValueRow(doc, 'c) Name of the Surveyor', input.surveyorName, y);
  y = drawKeyValueRow(doc, 'd) Locality', input.locality, y);
  y = drawKeyValueRow(doc, 'e) New Parcel Numbers', input.newParcelNumbers.join(', '), y);
  y = drawKeyValueRow(doc, 'f) Fees Payable to the Director', `KSh ${input.feesPayableToDirector.toFixed(2)}`, y);
  y = drawKeyValueRow(doc, 'g) New Survey Plan Number(s)', input.newSurveyPlanNumbers.join(', '), y);
  y = drawKeyValueRow(doc, 'h) Computations File Number', input.computationsFileNumber, y);
  y = drawKeyValueRow(doc, 'i) Field Notes Number', input.fieldNotesNumber, y);

  y += 8;
  doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('j) Reasons for Returning the Survey:', MARGIN_PT, y);
  y += 14;
  doc.font('Helvetica').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text(input.reasonsForReturning, MARGIN_PT, y, { width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 40;

  // 12-month correction window warning
  y += 8;
  doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_WARNING)
    .text('k) REQUIREMENT:', MARGIN_PT, y);
  y += 14;
  doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('Corrections to the errors must be done within TWELVE (12) MONTHS from the date of this notification.', MARGIN_PT, y, { width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 24;
  const deadline = new Date(input.dateOfNotification);
  deadline.setFullYear(deadline.getFullYear() + 1);
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_WARNING)
    .text(`CORRECTION DEADLINE: ${deadline.toISOString().substring(0, 10)}`, MARGIN_PT, y);

  drawFooter(doc);
  doc.end();
  await new Promise<void>((resolve, reject) => { stream.on('finish', () => resolve()); stream.on('error', reject); });
  const sealResult = await sealAndAppend(input.outputPath, () => {}, input.sealWithRSA, input.keypair);
  const stats = fs.statSync(input.outputPath);
  return { pdfPath: input.outputPath, pdfSizeBytes: stats.size, pageCount: 2, sealed: sealResult.sealed, signatureFingerprint: sealResult.fingerprint, signedAt: sealResult.signedAt, warnings: sealResult.warnings };
}

export async function generateSR9(input: SR9Input): Promise<FormResult> {
  log.info('Generating Form SR9 — Request to Update Cadastral Map');
  const doc = new PDFDocument({
    size: [A4_WIDTH_PT, A4_HEIGHT_PT],
    margins: { top: MARGIN_PT, bottom: MARGIN_PT, left: MARGIN_PT, right: MARGIN_PT },
    info: { Title: 'Form SR9', Producer: 'METARDU Desktop' },
  });
  const stream = fs.createWriteStream(input.outputPath);
  doc.pipe(stream);
  drawHeader(doc, 'SR9', 'REQUEST TO UPDATE CADASTRAL MAP');
  let y = MARGIN_PT + 30;
  doc.font('Helvetica-Bold').fontSize(FS_TITLE).fillColor(COLOR_ACCENT)
    .text('FORM SR9', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 22;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_BLACK)
    .text('REQUEST TO UPDATE CADASTRAL MAP', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 18;
  doc.font('Helvetica-Oblique').fontSize(FS_SUBHEADING).fillColor(COLOR_GREY)
    .text('Per Second Schedule, Regulation 13(1)(c)', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 22;

  y = drawKeyValueRow(doc, 'a) Survey Records Tracking Number', input.trackingNumber, y);
  y = drawKeyValueRow(doc, 'b) Date of Request', input.dateOfRequest, y);
  y = drawKeyValueRow(doc, 'c) Name of the Surveyor', input.surveyorName, y);
  y = drawKeyValueRow(doc, 'd) Locality', input.locality, y);
  y = drawKeyValueRow(doc, 'e) New Parcel Numbers', input.newParcelNumbers.join(', '), y);
  y = drawKeyValueRow(doc, 'f) New Survey Plan Number(s)', input.newSurveyPlanNumbers.join(', '), y);
  y = drawKeyValueRow(doc, 'g) Computations File Number', input.computationsFileNumber, y);
  y = drawKeyValueRow(doc, 'h) Field Notes Number', input.fieldNotesNumber, y);

  y += 12;
  doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('i) Request for Update of Cadastral Map:', MARGIN_PT, y);
  y += 14;
  doc.font('Helvetica').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('I hereby request the Director of Surveys to update the Electronic Cadastral Map to reflect the amendments described above, in accordance with Regulation 13 of the Survey (Electronic Cadastre Transactions) Regulations, 2020.', MARGIN_PT, y, { width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 40;
  doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('Signed: ____________________________  Date: _______________________', MARGIN_PT, y);
  y += 14;
  doc.text(`Surveyor: ${input.surveyorName}`, MARGIN_PT, y);

  drawFooter(doc);
  doc.end();
  await new Promise<void>((resolve, reject) => { stream.on('finish', () => resolve()); stream.on('error', reject); });
  const sealResult = await sealAndAppend(input.outputPath, () => {}, input.sealWithRSA, input.keypair);
  const stats = fs.statSync(input.outputPath);
  return { pdfPath: input.outputPath, pdfSizeBytes: stats.size, pageCount: 2, sealed: sealResult.sealed, signatureFingerprint: sealResult.fingerprint, signedAt: sealResult.signedAt, warnings: sealResult.warnings };
}

export async function generateSR10(input: SR10Input): Promise<FormResult> {
  log.info('Generating Form SR10 — Notification of Sealing of Cadastral Map');
  const doc = new PDFDocument({
    size: [A4_WIDTH_PT, A4_HEIGHT_PT],
    margins: { top: MARGIN_PT, bottom: MARGIN_PT, left: MARGIN_PT, right: MARGIN_PT },
    info: { Title: 'Form SR10', Producer: 'METARDU Desktop' },
  });
  const stream = fs.createWriteStream(input.outputPath);
  doc.pipe(stream);
  drawHeader(doc, 'SR10', 'NOTIFICATION OF SEALING OF CADASTRAL MAP');
  let y = MARGIN_PT + 30;
  doc.font('Helvetica-Bold').fontSize(FS_TITLE).fillColor(COLOR_GREEN)
    .text('FORM SR10', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 22;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_BLACK)
    .text('NOTIFICATION OF SEALING OF CADASTRAL MAP', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 18;
  doc.font('Helvetica-Oblique').fontSize(FS_SUBHEADING).fillColor(COLOR_GREY)
    .text('Per Second Schedule, Regulation 14(3) — Issued within 21 days of request', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 22;

  y = drawKeyValueRow(doc, 'a) Survey Records Tracking Number', input.trackingNumber, y);
  y = drawKeyValueRow(doc, 'b) Date of Notification to Surveyor', input.dateOfNotification, y);
  y = drawKeyValueRow(doc, 'c) Officer Notifying', input.officerNotifying, y);
  y = drawKeyValueRow(doc, 'd) Name of the Surveyor', input.surveyorName, y);
  y = drawKeyValueRow(doc, 'e) Locality', input.locality, y);
  y = drawKeyValueRow(doc, 'f) New Parcel Numbers', input.newParcelNumbers.join(', '), y);
  y = drawKeyValueRow(doc, 'g) New Survey Plan Number(s)', input.newSurveyPlanNumbers.join(', '), y);
  y = drawKeyValueRow(doc, 'h) Computations File Number', input.computationsFileNumber, y);
  y = drawKeyValueRow(doc, 'i) Field Notes Number', input.fieldNotesNumber, y);
  y = drawKeyValueRow(doc, 'j) Office Being Notified', input.officeNotified === 'nlc' ? 'National Land Commission (NLC)' : 'OI/C Land Administration', y);

  y += 12;
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_GREEN)
    .text('>>> CADASTRAL MAP SEALED <<<', MARGIN_PT, y, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 22;
  doc.font('Helvetica').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('The Electronic Cadastral Map has been sealed in accordance with Regulation 14 of the Survey (Electronic Cadastre Transactions) Regulations, 2020. The sealed map is the official record of the parcel boundaries as surveyed.', MARGIN_PT, y, { width: A4_WIDTH_PT - 2 * MARGIN_PT });
  y += 40;
  doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('Signed: ____________________________  Date: _______________________', MARGIN_PT, y);
  y += 14;
  doc.text(`Officer: ${input.officerNotifying}`, MARGIN_PT, y);
  y += 14;
  doc.font('Helvetica-Bold').text('For: Director of Surveys', MARGIN_PT, y);

  drawFooter(doc);
  doc.end();
  await new Promise<void>((resolve, reject) => { stream.on('finish', () => resolve()); stream.on('error', reject); });
  const sealResult = await sealAndAppend(input.outputPath, () => {}, input.sealWithRSA, input.keypair);
  const stats = fs.statSync(input.outputPath);
  return { pdfPath: input.outputPath, pdfSizeBytes: stats.size, pageCount: 2, sealed: sealResult.sealed, signatureFingerprint: sealResult.fingerprint, signedAt: sealResult.signedAt, warnings: sealResult.warnings };
}
