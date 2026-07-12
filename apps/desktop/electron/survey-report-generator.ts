/**
 * Survey Report Generator — Consolidated SoK Statutory Report
 *
 * Produces a single multi-page PDF containing the full suite of statutory
 * documents that Kenyan surveyors submit to Survey of Kenya for examination:
 *
 *   Page 1: COVER SHEET
 *     - Project name, parcel number, LR number
 *     - Surveyor name + license + firm
 *     - Survey type (cadastral/engineering/topographical)
 *     - County, sub-county, locality
 *     - Plan index (list of accompanying plans)
 *     - Date of survey, date of submission
 *
 *   Page 2: FORM J — TRAVERSE COMPUTATION SHEET
 *     - Traverse abstract: station, observed bearing, distance,
 *       ΔE, ΔN, adjusted coordinates
 *     - Closure summary: linear misclose, ratio, precision class
 *     - Adjustment method: Bowditch / Transit / Least Squares
 *     - Per Reg 97 precision classes (1:5000 cadastral, 1:10000 engineering)
 *
 *   Page 3: SCHEDULE OF BEACONS
 *     - Beacon number, type (concrete/iron pin/stone/ref obj)
 *     - Easting, Northing (3 decimal places)
 *     - Elevation (if observed)
 *     - Description (location notes)
 *     - Placement date
 *
 *   Page 4: SCHEDULE OF AREAS
 *     - Parent parcel number + area
 *     - Subdivisions (if mutation): parcel number, area, % of parent
 *     - Reconciliation: parent area = sum of children + balance/roads
 *     - Hectares + acres conversion
 *
 *   Page 5: SURVEYOR'S CERTIFICATE
 *     - Certificate text per Survey Regulations 1994 Reg 3(2)
 *     - Surveyor name, license, firm, date
 *     - RSA-2048 digital signature (base64)
 *     - Public key fingerprint
 *     - Verification instructions
 *
 * Standards compliance:
 *   - Survey Act Cap 299
 *   - Survey Regulations 1994 (Reg 3, Reg 17, Reg 97)
 *   - Survey of Kenya Drafting Manual 2020
 *   - RDM 1.1 (2025) for engineering
 *   - PDF/A-1b for archival
 *
 * Output: Vector PDF, A4 portrait, all elements as vectors.
 */

import PDFDocument from 'pdfkit';
import * as fs from 'node:fs';
import * as path from 'node:path';
import log from 'electron-log/main';
import { sealDocument, loadOrCreateSurveyorKeypair, type SurveyorKeypair } from './crypto-seal.js';

// ─── Constants ─────────────────────────────────────────────────────────
const MM_TO_PT = 2.8346; // 1mm = 2.8346 points
const A4_WIDTH_PT = 210 * MM_TO_PT;   // 595.27 pt
const A4_HEIGHT_PT = 297 * MM_TO_PT;  // 841.89 pt
const MARGIN_PT = 15 * MM_TO_PT;       // 15mm margin

// Colors (SoK — black & accent only for statutory docs)
const COLOR_BLACK = '#000000';
const COLOR_GREY = '#666666';
const COLOR_LIGHT_GREY = '#CCCCCC';
const COLOR_ACCENT = '#003366'; // SoK navy
const COLOR_WARNING = '#CC0000';

// Font sizes (mm → pt at runtime)
const FS_TITLE = 14;
const FS_HEADING = 11;
const FS_SUBHEADING = 9;
const FS_BODY = 8;
const FS_SMALL = 6.5;
const FS_MONO = 7.5;

// ─── Types ─────────────────────────────────────────────────────────────

export type SurveyType = 'cadastral' | 'engineering' | 'topographical' | 'mutation';

export interface ReportSurveyor {
  name: string;
  license: string;
  firmName?: string;
  postalAddress?: string;
  phoneNumber?: string;
  email?: string;
}

export interface ReportProject {
  name: string;
  surveyType: SurveyType;
  parcelNumber: string;
  lrNumber: string;
  county: string;
  subCounty?: string;
  locality: string;
  surveyDate: string;       // ISO date
  submissionDate?: string;  // ISO date
  projection: string;       // e.g. 'Cassini-Soldner (Arc 1960)'
  datum: string;            // e.g. 'Arc 1960'
  zone?: string;            // e.g. '37S' for UTM
  directorOfSurveysRef?: string;
}

export interface ReportTraverseLeg {
  fromStation: string;
  toStation: string;
  observedBearing: number;   // degrees, decimal
  distance: number;          // metres
  deltaE: number;            // metres
  deltaN: number;            // metres
  adjustedEasting: number;   // metres
  adjustedNorthing: number;  // metres
}

export interface ReportTraverse {
  legs: ReportTraverseLeg[];
  startingStation: string;
  startingEasting: number;
  startingNorthing: number;
  closingStation?: string;
  linearMisclose: number;     // metres
  ratioDenominator: number;   // e.g. 5000 for 1:5000
  precisionClass: string;     // e.g. 'Class I (Cadastral)'
  adjustmentMethod: 'bowditch' | 'transit' | 'least_squares';
  totalLength: number;        // metres
}

export interface ReportBeacon {
  number: string;
  type: 'concrete' | 'iron_pin' | 'stone' | 'reference_object' | 'pipe' | 'natural';
  easting: number;
  northing: number;
  elevation?: number;
  description?: string;
  placedDate?: string;
}

export interface ReportAreaRow {
  parcelNumber: string;
  areaSqM: number;
  areaHa: number;
  areaAcres: number;
  percentage?: number;       // % of parent (for subdivisions)
  notes?: string;
}

export interface ReportAreaSchedule {
  parentParcelNumber: string;
  parentAreaSqM: number;
  rows: ReportAreaRow[];     // subdivisions or single parcel
  balanceAreaSqM?: number;   // remaining (roads, open spaces)
  reconciliationPassed: boolean;
  reconciliationDelta?: number; // metres² (parent - sum of children)
}

export interface ReportPlanIndex {
  planTitle: string;
  planNumber?: string;
  paperSize: string;
  scale: string;
  fileName?: string;
}

export interface SurveyReportInput {
  project: ReportProject;
  surveyor: ReportSurveyor;
  traverse?: ReportTraverse;
  beacons: ReportBeacon[];
  areaSchedule: ReportAreaSchedule;
  planIndex?: ReportPlanIndex[];
  outputPath: string;
  sealWithRSA?: boolean;  // default true
  keypair?: SurveyorKeypair; // optional — loads from disk if absent
}

export interface SurveyReportResult {
  pdfPath: string;
  pdfSizeBytes: number;
  pageCount: number;
  sealed: boolean;
  signatureFingerprint?: string;
  signedAt?: string;
  warnings: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────

function fmtBearing(deg: number): string {
  // DDD°MM'SS.SS"
  const d = Math.floor(deg);
  const minFloat = (deg - d) * 60;
  const m = Math.floor(minFloat);
  const s = (minFloat - m) * 60;
  return `${String(d).padStart(3, '0')}°${String(m).padStart(2, '0')}'${s.toFixed(2).padStart(5, '0')}"`;
}

function fmtCoord(v: number): string {
  return v.toFixed(3);
}

function fmtDistance(v: number): string {
  return v.toFixed(3);
}

function fmtArea(v: number): string {
  return v.toLocaleString('en-KE', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function sqMToHa(v: number): number {
  return v / 10000;
}

function sqMToAcres(v: number): number {
  return v / 4046.8564224;
}

function surveyTypeLabel(t: SurveyType): string {
  switch (t) {
    case 'cadastral': return 'Cadastral Survey';
    case 'engineering': return 'Engineering Survey';
    case 'topographical': return 'Topographical Survey';
    case 'mutation': return 'Mutation Survey (Subdivision/Amalgamation)';
    default: return String(t);
  }
}

function beaconTypeLabel(t: ReportBeacon['type']): string {
  switch (t) {
    case 'concrete': return 'Concrete Beacon';
    case 'iron_pin': return 'Iron Pin';
    case 'stone': return 'Stone Beacon';
    case 'reference_object': return 'Reference Object';
    case 'pipe': return 'Iron Pipe';
    case 'natural': return 'Natural Feature';
    default: return String(t);
  }
}

function adjustmentLabel(m: ReportTraverse['adjustmentMethod']): string {
  switch (m) {
    case 'bowditch': return 'Bowditch (Compass Rule)';
    case 'transit': return 'Transit Rule';
    case 'least_squares': return 'Least Squares Adjustment';
    default: return String(m);
  }
}

// ─── Page Renderers ───────────────────────────────────────────────────

function drawHeader(doc: PDFKit.PDFDocument, project: ReportProject, pageNum: string) {
  const top = MARGIN_PT;
  // Top rule
  doc.moveTo(MARGIN_PT, top + 18)
    .lineTo(A4_WIDTH_PT - MARGIN_PT, top + 18)
    .lineWidth(1.2)
    .stroke(COLOR_ACCENT);

  // Title — left
  doc.font('Helvetica-Bold')
    .fontSize(FS_HEADING)
    .fillColor(COLOR_ACCENT)
    .text('REPUBLIC OF KENYA — SURVEY OF KENYA', MARGIN_PT, top, { continued: false });

  doc.font('Helvetica')
    .fontSize(FS_SUBHEADING)
    .fillColor(COLOR_BLACK)
    .text(surveyTypeLabel(project.surveyType), MARGIN_PT, top + 12);

  // Page number — right
  doc.font('Helvetica')
    .fontSize(FS_SUBHEADING)
    .fillColor(COLOR_GREY)
    .text(`Page ${pageNum}`, A4_WIDTH_PT - 80, top, { width: 65, align: 'right' });
}

function drawFooter(doc: PDFKit.PDFDocument, project: ReportProject, surveyor: ReportSurveyor) {
  const bottom = A4_HEIGHT_PT - MARGIN_PT - 14;
  doc.moveTo(MARGIN_PT, bottom)
    .lineTo(A4_WIDTH_PT - MARGIN_PT, bottom)
    .lineWidth(0.5)
    .stroke(COLOR_GREY);

  doc.font('Helvetica')
    .fontSize(FS_SMALL)
    .fillColor(COLOR_GREY)
    .text(
      `Surveyor: ${surveyor.name} (Lic. ${surveyor.license})  •  Parcel: ${project.parcelNumber}  •  LR: ${project.lrNumber}  •  Generated by METARDU Desktop`,
      MARGIN_PT,
      bottom + 3,
      { width: A4_WIDTH_PT - 2 * MARGIN_PT, align: 'center' }
    );
}

// ── Page 1: Cover Sheet ───────────────────────────────────────────────

function drawCoverSheet(doc: PDFKit.PDFDocument, input: SurveyReportInput) {
  const { project, surveyor, planIndex } = input;
  const yStart = MARGIN_PT + 30;

  // Big title
  doc.font('Helvetica-Bold')
    .fontSize(FS_TITLE + 4)
    .fillColor(COLOR_ACCENT)
    .text('SURVEY REPORT', MARGIN_PT, yStart, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });

  doc.font('Helvetica')
    .fontSize(FS_HEADING)
    .fillColor(COLOR_BLACK)
    .text(surveyTypeLabel(project.surveyType), MARGIN_PT, yStart + 22, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });

  doc.font('Helvetica-Oblique')
    .fontSize(FS_SUBHEADING)
    .fillColor(COLOR_GREY)
    .text('Submitted in accordance with the Survey Act (Cap. 299) and Survey Regulations 1994',
      MARGIN_PT, yStart + 38, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });

  // Project information table
  const infoY = yStart + 65;
  const labelW = 60 * MM_TO_PT;
  const valueW = (A4_WIDTH_PT - 2 * MARGIN_PT) - labelW;

  const infoRows: Array<[string, string]> = [
    ['Project Name', project.name],
    ['Parcel Number', project.parcelNumber],
    ['LR Number', project.lrNumber],
    ['Survey Type', surveyTypeLabel(project.surveyType)],
    ['County', project.county],
    ['Sub-County', project.subCounty ?? '—'],
    ['Locality', project.locality],
    ['Date of Survey', project.surveyDate],
    ['Date of Submission', project.submissionDate ?? new Date().toISOString().substring(0, 10)],
    ['Projection', project.projection],
    ['Datum', project.datum],
    ['Zone', project.zone ?? '—'],
    ['Director of Surveys Ref.', project.directorOfSurveysRef ?? '—'],
  ];

  let y = infoY;
  for (const [label, value] of infoRows) {
    doc.font('Helvetica-Bold')
      .fontSize(FS_BODY)
      .fillColor(COLOR_BLACK)
      .text(label, MARGIN_PT, y, { width: labelW });

    doc.font('Helvetica')
      .fontSize(FS_BODY)
      .fillColor(COLOR_BLACK)
      .text(value, MARGIN_PT + labelW, y, { width: valueW });

    // Underline
    doc.moveTo(MARGIN_PT, y + 12)
      .lineTo(A4_WIDTH_PT - MARGIN_PT, y + 12)
      .lineWidth(0.2)
      .stroke(COLOR_LIGHT_GREY);

    y += 14;
  }

  // Surveyor block
  y += 10;
  doc.font('Helvetica-Bold')
    .fontSize(FS_HEADING)
    .fillColor(COLOR_ACCENT)
    .text('Surveyor Information', MARGIN_PT, y);
  y += 16;

  const surveyorRows: Array<[string, string]> = [
    ['Name', surveyor.name],
    ['License Number', surveyor.license],
    ['Firm', surveyor.firmName ?? '—'],
    ['Postal Address', surveyor.postalAddress ?? '—'],
    ['Phone', surveyor.phoneNumber ?? '—'],
    ['Email', surveyor.email ?? '—'],
  ];

  for (const [label, value] of surveyorRows) {
    doc.font('Helvetica-Bold')
      .fontSize(FS_BODY)
      .fillColor(COLOR_BLACK)
      .text(label, MARGIN_PT, y, { width: labelW });
    doc.font('Helvetica')
      .fontSize(FS_BODY)
      .fillColor(COLOR_BLACK)
      .text(value, MARGIN_PT + labelW, y, { width: valueW });
    doc.moveTo(MARGIN_PT, y + 12)
      .lineTo(A4_WIDTH_PT - MARGIN_PT, y + 12)
      .lineWidth(0.2)
      .stroke(COLOR_LIGHT_GREY);
    y += 14;
  }

  // Plan index
  if (planIndex && planIndex.length > 0) {
    y += 10;
    doc.font('Helvetica-Bold')
      .fontSize(FS_HEADING)
      .fillColor(COLOR_ACCENT)
      .text('Accompanying Plans', MARGIN_PT, y);
    y += 16;

    // Table header
    const cols = [
      { title: '#', x: MARGIN_PT, w: 10 * MM_TO_PT },
      { title: 'Plan Title', x: MARGIN_PT + 10 * MM_TO_PT, w: 70 * MM_TO_PT },
      { title: 'Plan No.', x: MARGIN_PT + 80 * MM_TO_PT, w: 30 * MM_TO_PT },
      { title: 'Paper', x: MARGIN_PT + 110 * MM_TO_PT, w: 20 * MM_TO_PT },
      { title: 'Scale', x: MARGIN_PT + 130 * MM_TO_PT, w: 30 * MM_TO_PT },
      { title: 'File', x: MARGIN_PT + 160 * MM_TO_PT, w: 35 * MM_TO_PT },
    ];
    for (const c of cols) {
      doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
        .text(c.title, c.x, y, { width: c.w });
    }
    y += 12;
    doc.moveTo(MARGIN_PT, y).lineTo(A4_WIDTH_PT - MARGIN_PT, y).lineWidth(0.5).stroke(COLOR_BLACK);

    for (let i = 0; i < planIndex.length; i++) {
      const p = planIndex[i];
      y += 2;
      doc.font('Helvetica').fontSize(FS_BODY).fillColor(COLOR_BLACK)
        .text(String(i + 1), cols[0].x, y, { width: cols[0].w });
      doc.text(p.planTitle, cols[1].x, y, { width: cols[1].w });
      doc.text(p.planNumber ?? '—', cols[2].x, y, { width: cols[2].w });
      doc.text(p.paperSize, cols[3].x, y, { width: cols[3].w });
      doc.text(p.scale, cols[4].x, y, { width: cols[4].w });
      doc.font('Helvetica').fontSize(FS_SMALL).fillColor(COLOR_GREY)
        .text(p.fileName ?? '—', cols[5].x, y, { width: cols[5].w });
      y += 12;
      doc.moveTo(MARGIN_PT, y).lineTo(A4_WIDTH_PT - MARGIN_PT, y).lineWidth(0.15).stroke(COLOR_LIGHT_GREY);
    }
  }
}

// ── Page 2: Form J — Traverse Computation Sheet ───────────────────────

function drawFormJ(doc: PDFKit.PDFDocument, input: SurveyReportInput) {
  const { project, traverse } = input;
  const yStart = MARGIN_PT + 30;

  doc.font('Helvetica-Bold')
    .fontSize(FS_TITLE)
    .fillColor(COLOR_ACCENT)
    .text('FORM J — TRAVERSE COMPUTATION SHEET', MARGIN_PT, yStart, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });

  doc.font('Helvetica-Oblique')
    .fontSize(FS_SUBHEADING)
    .fillColor(COLOR_GREY)
    .text('Per Survey Regulations 1994, Reg 17 (Traverse abstracts)', MARGIN_PT, yStart + 18, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });

  if (!traverse) {
    doc.font('Helvetica')
      .fontSize(FS_BODY)
      .fillColor(COLOR_WARNING)
      .text('No traverse data provided for this survey.', MARGIN_PT, yStart + 50);
    return;
  }

  // Traverse summary block
  let y = yStart + 35;
  const summaryCols = [
    { label: 'Starting Station', value: traverse.startingStation },
    { label: 'Starting E', value: fmtCoord(traverse.startingEasting) + ' m' },
    { label: 'Starting N', value: fmtCoord(traverse.startingNorthing) + ' m' },
    { label: 'Closing Station', value: traverse.closingStation ?? '—' },
    { label: 'Total Length', value: fmtDistance(traverse.totalLength) + ' m' },
    { label: 'No. of Legs', value: String(traverse.legs.length) },
    { label: 'Linear Misclose', value: fmtDistance(traverse.linearMisclose) + ' m' },
    { label: 'Precision Ratio', value: `1:${traverse.ratioDenominator.toLocaleString()}` },
    { label: 'Precision Class', value: traverse.precisionClass },
    { label: 'Adjustment Method', value: adjustmentLabel(traverse.adjustmentMethod) },
  ];

  const labelW = 50 * MM_TO_PT;
  const valW = 45 * MM_TO_PT;
  for (let i = 0; i < summaryCols.length; i += 2) {
    const left = summaryCols[i];
    const right = summaryCols[i + 1];
    doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
      .text(left.label + ':', MARGIN_PT, y, { width: labelW });
    doc.font('Helvetica').fontSize(FS_BODY).fillColor(COLOR_BLACK)
      .text(left.value, MARGIN_PT + labelW, y, { width: valW });
    if (right) {
      doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
        .text(right.label + ':', MARGIN_PT + labelW + valW + 5, y, { width: labelW });
      doc.font('Helvetica').fontSize(FS_BODY).fillColor(COLOR_BLACK)
        .text(right.value, MARGIN_PT + 2 * (labelW + valW) + 5, y, { width: valW });
    }
    y += 13;
  }

  y += 8;
  doc.moveTo(MARGIN_PT, y).lineTo(A4_WIDTH_PT - MARGIN_PT, y).lineWidth(0.5).stroke(COLOR_BLACK);

  // Traverse table
  y += 6;
  const cols = [
    { title: 'From', x: MARGIN_PT, w: 18 * MM_TO_PT, align: 'left' as const },
    { title: 'To', x: MARGIN_PT + 18 * MM_TO_PT, w: 18 * MM_TO_PT, align: 'left' as const },
    { title: 'Bearing', x: MARGIN_PT + 36 * MM_TO_PT, w: 28 * MM_TO_PT, align: 'right' as const },
    { title: 'Distance (m)', x: MARGIN_PT + 64 * MM_TO_PT, w: 25 * MM_TO_PT, align: 'right' as const },
    { title: 'ΔE (m)', x: MARGIN_PT + 89 * MM_TO_PT, w: 25 * MM_TO_PT, align: 'right' as const },
    { title: 'ΔN (m)', x: MARGIN_PT + 114 * MM_TO_PT, w: 25 * MM_TO_PT, align: 'right' as const },
    { title: 'E (m)', x: MARGIN_PT + 139 * MM_TO_PT, w: 28 * MM_TO_PT, align: 'right' as const },
    { title: 'N (m)', x: MARGIN_PT + 167 * MM_TO_PT, w: 28 * MM_TO_PT, align: 'right' as const },
  ];

  // Header
  for (const c of cols) {
    doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
      .text(c.title, c.x, y, { width: c.w, align: c.align });
  }
  y += 12;
  doc.moveTo(MARGIN_PT, y).lineTo(A4_WIDTH_PT - MARGIN_PT, y).lineWidth(0.5).stroke(COLOR_BLACK);

  // Rows
  for (const leg of traverse.legs) {
    y += 2;
    const rowY = y;
    doc.font('Helvetica').fontSize(FS_SMALL).fillColor(COLOR_BLACK);
    doc.text(leg.fromStation, cols[0].x, rowY, { width: cols[0].w, align: 'left' });
    doc.text(leg.toStation, cols[1].x, rowY, { width: cols[1].w, align: 'left' });
    doc.font('Courier').fontSize(FS_SMALL).fillColor(COLOR_BLACK);
    doc.text(fmtBearing(leg.observedBearing), cols[2].x, rowY, { width: cols[2].w, align: 'right' });
    doc.text(fmtDistance(leg.distance), cols[3].x, rowY, { width: cols[3].w, align: 'right' });
    doc.text((leg.deltaE >= 0 ? '+' : '') + leg.deltaE.toFixed(3), cols[4].x, rowY, { width: cols[4].w, align: 'right' });
    doc.text((leg.deltaN >= 0 ? '+' : '') + leg.deltaN.toFixed(3), cols[5].x, rowY, { width: cols[5].w, align: 'right' });
    doc.text(fmtCoord(leg.adjustedEasting), cols[6].x, rowY, { width: cols[6].w, align: 'right' });
    doc.text(fmtCoord(leg.adjustedNorthing), cols[7].x, rowY, { width: cols[7].w, align: 'right' });
    y += 11;
    doc.moveTo(MARGIN_PT, y).lineTo(A4_WIDTH_PT - MARGIN_PT, y).lineWidth(0.1).stroke(COLOR_LIGHT_GREY);

    // Page break if needed
    if (y > A4_HEIGHT_PT - MARGIN_PT - 30) {
      doc.addPage();
      drawHeader(doc, input.project, '2 (cont.)');
      // Repeat header
      y = MARGIN_PT + 35;
      for (const c of cols) {
        doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
          .text(c.title, c.x, y, { width: c.w, align: c.align });
      }
      y += 12;
      doc.moveTo(MARGIN_PT, y).lineTo(A4_WIDTH_PT - MARGIN_PT, y).lineWidth(0.5).stroke(COLOR_BLACK);
    }
  }

  // Footer summary
  y += 6;
  doc.font('Helvetica-Oblique').fontSize(FS_BODY).fillColor(COLOR_GREY)
    .text(
      `Closure: ${fmtDistance(traverse.linearMisclose)} m over ${fmtDistance(traverse.totalLength)} m = 1:${traverse.ratioDenominator.toLocaleString()} — ${traverse.precisionClass}`,
      MARGIN_PT, y, { width: A4_WIDTH_PT - 2 * MARGIN_PT, align: 'left' }
    );

  // Check footer (Reg 97)
  const reg97Threshold = input.project.surveyType === 'cadastral' ? 5000
    : input.project.surveyType === 'engineering' ? 10000
    : 2500;
  const passedReg97 = traverse.ratioDenominator >= reg97Threshold;
  y += 14;
  doc.font('Helvetica-Bold').fontSize(FS_BODY)
    .fillColor(passedReg97 ? COLOR_BLACK : COLOR_WARNING)
    .text(
      `Reg 97 compliance: ${passedReg97 ? 'PASS' : 'FAIL'} — required 1:${reg97Threshold.toLocaleString()} for ${surveyTypeLabel(input.project.surveyType)}`,
      MARGIN_PT, y,
      { width: A4_WIDTH_PT - 2 * MARGIN_PT }
    );
}

// ── Page 3: Schedule of Beacons ───────────────────────────────────────

function drawBeaconSchedule(doc: PDFKit.PDFDocument, input: SurveyReportInput) {
  const { beacons } = input;
  const yStart = MARGIN_PT + 30;

  doc.font('Helvetica-Bold')
    .fontSize(FS_TITLE)
    .fillColor(COLOR_ACCENT)
    .text('SCHEDULE OF BEACONS', MARGIN_PT, yStart, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });

  doc.font('Helvetica-Oblique')
    .fontSize(FS_SUBHEADING)
    .fillColor(COLOR_GREY)
    .text(`Total beacons: ${beacons.length}`, MARGIN_PT, yStart + 18, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });

  // Table
  let y = yStart + 35;
  const cols = [
    { title: '#', x: MARGIN_PT, w: 8 * MM_TO_PT, align: 'left' as const },
    { title: 'Beacon No.', x: MARGIN_PT + 8 * MM_TO_PT, w: 22 * MM_TO_PT, align: 'left' as const },
    { title: 'Type', x: MARGIN_PT + 30 * MM_TO_PT, w: 32 * MM_TO_PT, align: 'left' as const },
    { title: 'Easting (m)', x: MARGIN_PT + 62 * MM_TO_PT, w: 32 * MM_TO_PT, align: 'right' as const },
    { title: 'Northing (m)', x: MARGIN_PT + 94 * MM_TO_PT, w: 32 * MM_TO_PT, align: 'right' as const },
    { title: 'Elev. (m)', x: MARGIN_PT + 126 * MM_TO_PT, w: 22 * MM_TO_PT, align: 'right' as const },
    { title: 'Description', x: MARGIN_PT + 148 * MM_TO_PT, w: 47 * MM_TO_PT, align: 'left' as const },
  ];

  for (const c of cols) {
    doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
      .text(c.title, c.x, y, { width: c.w, align: c.align });
  }
  y += 12;
  doc.moveTo(MARGIN_PT, y).lineTo(A4_WIDTH_PT - MARGIN_PT, y).lineWidth(0.5).stroke(COLOR_BLACK);

  for (let i = 0; i < beacons.length; i++) {
    const b = beacons[i];
    y += 2;
    doc.font('Helvetica').fontSize(FS_SMALL).fillColor(COLOR_BLACK);
    doc.text(String(i + 1), cols[0].x, y, { width: cols[0].w, align: 'left' });
    doc.font('Helvetica-Bold').fontSize(FS_SMALL).fillColor(COLOR_BLACK);
    doc.text(b.number, cols[1].x, y, { width: cols[1].w, align: 'left' });
    doc.font('Helvetica').fontSize(FS_SMALL).fillColor(COLOR_BLACK);
    doc.text(beaconTypeLabel(b.type), cols[2].x, y, { width: cols[2].w, align: 'left' });
    doc.font('Courier').fontSize(FS_SMALL).fillColor(COLOR_BLACK);
    doc.text(fmtCoord(b.easting), cols[3].x, y, { width: cols[3].w, align: 'right' });
    doc.text(fmtCoord(b.northing), cols[4].x, y, { width: cols[4].w, align: 'right' });
    doc.text(b.elevation != null ? b.elevation.toFixed(3) : '—', cols[5].x, y, { width: cols[5].w, align: 'right' });
    doc.font('Helvetica').fontSize(FS_SMALL).fillColor(COLOR_GREY);
    doc.text(b.description ?? '—', cols[6].x, y, { width: cols[6].w, align: 'left' });
    y += 11;
    doc.moveTo(MARGIN_PT, y).lineTo(A4_WIDTH_PT - MARGIN_PT, y).lineWidth(0.1).stroke(COLOR_LIGHT_GREY);

    if (y > A4_HEIGHT_PT - MARGIN_PT - 30) {
      doc.addPage();
      drawHeader(doc, input.project, '3 (cont.)');
      y = MARGIN_PT + 35;
      for (const c of cols) {
        doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
          .text(c.title, c.x, y, { width: c.w, align: c.align });
      }
      y += 12;
      doc.moveTo(MARGIN_PT, y).lineTo(A4_WIDTH_PT - MARGIN_PT, y).lineWidth(0.5).stroke(COLOR_BLACK);
    }
  }

  // Legend
  y += 8;
  doc.font('Helvetica-Oblique').fontSize(FS_SMALL).fillColor(COLOR_GREY)
    .text(
      'Beacon types: Concrete (per Reg 16), Iron Pin, Stone, Reference Object, Iron Pipe, Natural Feature',
      MARGIN_PT, y, { width: A4_WIDTH_PT - 2 * MARGIN_PT }
    );
}

// ── Page 4: Schedule of Areas ─────────────────────────────────────────

function drawAreaSchedule(doc: PDFKit.PDFDocument, input: SurveyReportInput) {
  const { areaSchedule } = input;
  const yStart = MARGIN_PT + 30;

  doc.font('Helvetica-Bold')
    .fontSize(FS_TITLE)
    .fillColor(COLOR_ACCENT)
    .text('SCHEDULE OF AREAS', MARGIN_PT, yStart, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });

  doc.font('Helvetica-Oblique')
    .fontSize(FS_SUBHEADING)
    .fillColor(COLOR_GREY)
    .text('Area computation and reconciliation per Survey Regulations 1994',
      MARGIN_PT, yStart + 18, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });

  let y = yStart + 38;

  // Parent parcel block
  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_ACCENT)
    .text('Parent Parcel', MARGIN_PT, y);
  y += 16;

  const labelW = 50 * MM_TO_PT;
  const valW = 60 * MM_TO_PT;
  const rows: Array<[string, string]> = [
    ['Parcel Number', areaSchedule.parentParcelNumber],
    ['Area (m²)', fmtArea(areaSchedule.parentAreaSqM)],
    ['Area (ha)', sqMToHa(areaSchedule.parentAreaSqM).toFixed(4)],
    ['Area (acres)', sqMToAcres(areaSchedule.parentAreaSqM).toFixed(4)],
  ];
  for (const [label, value] of rows) {
    doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
      .text(label, MARGIN_PT, y, { width: labelW });
    doc.font('Courier').fontSize(FS_BODY).fillColor(COLOR_BLACK)
      .text(value, MARGIN_PT + labelW, y, { width: valW });
    doc.moveTo(MARGIN_PT, y + 12).lineTo(A4_WIDTH_PT - MARGIN_PT, y + 12).lineWidth(0.2).stroke(COLOR_LIGHT_GREY);
    y += 14;
  }

  // Subdivision rows (if mutation)
  if (areaSchedule.rows.length > 0) {
    y += 8;
    doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_ACCENT)
      .text('Subdivisions / Component Parcels', MARGIN_PT, y);
    y += 16;

    const cols = [
      { title: 'Parcel No.', x: MARGIN_PT, w: 30 * MM_TO_PT, align: 'left' as const },
      { title: 'Area (m²)', x: MARGIN_PT + 30 * MM_TO_PT, w: 30 * MM_TO_PT, align: 'right' as const },
      { title: 'Area (ha)', x: MARGIN_PT + 60 * MM_TO_PT, w: 30 * MM_TO_PT, align: 'right' as const },
      { title: 'Area (acres)', x: MARGIN_PT + 90 * MM_TO_PT, w: 30 * MM_TO_PT, align: 'right' as const },
      { title: '% of Parent', x: MARGIN_PT + 120 * MM_TO_PT, w: 25 * MM_TO_PT, align: 'right' as const },
      { title: 'Notes', x: MARGIN_PT + 145 * MM_TO_PT, w: 50 * MM_TO_PT, align: 'left' as const },
    ];
    for (const c of cols) {
      doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
        .text(c.title, c.x, y, { width: c.w, align: c.align });
    }
    y += 12;
    doc.moveTo(MARGIN_PT, y).lineTo(A4_WIDTH_PT - MARGIN_PT, y).lineWidth(0.5).stroke(COLOR_BLACK);

    for (const row of areaSchedule.rows) {
      y += 2;
      doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
        .text(row.parcelNumber, cols[0].x, y, { width: cols[0].w, align: 'left' });
      doc.font('Courier').fontSize(FS_BODY).fillColor(COLOR_BLACK)
        .text(fmtArea(row.areaSqM), cols[1].x, y, { width: cols[1].w, align: 'right' });
      doc.text(row.areaHa.toFixed(4), cols[2].x, y, { width: cols[2].w, align: 'right' });
      doc.text(row.areaAcres.toFixed(4), cols[3].x, y, { width: cols[3].w, align: 'right' });
      doc.font('Helvetica').fontSize(FS_BODY).fillColor(COLOR_BLACK)
        .text(row.percentage != null ? row.percentage.toFixed(2) + '%' : '—', cols[4].x, y, { width: cols[4].w, align: 'right' });
      doc.font('Helvetica').fontSize(FS_SMALL).fillColor(COLOR_GREY)
        .text(row.notes ?? '—', cols[5].x, y, { width: cols[5].w, align: 'left' });
      y += 13;
      doc.moveTo(MARGIN_PT, y).lineTo(A4_WIDTH_PT - MARGIN_PT, y).lineWidth(0.1).stroke(COLOR_LIGHT_GREY);
    }

    // Reconciliation
    y += 8;
    doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_ACCENT)
      .text('Area Reconciliation', MARGIN_PT, y);
    y += 16;

    const sumChildren = areaSchedule.rows.reduce((s, r) => s + r.areaSqM, 0);
    const balance = areaSchedule.balanceAreaSqM ?? (areaSchedule.parentAreaSqM - sumChildren);
    const delta = areaSchedule.reconciliationDelta ?? (areaSchedule.parentAreaSqM - sumChildren - balance);

    const reconRows: Array<[string, string, string]> = [
      ['Parent area', fmtArea(areaSchedule.parentAreaSqM) + ' m²', ''],
      ['Sum of children', fmtArea(sumChildren) + ' m²', ''],
      ['Balance (roads/open)', fmtArea(balance) + ' m²', ''],
      ['Reconciliation delta', fmtArea(Math.abs(delta)) + ' m²', delta < 0.01 ? 'OK' : 'CHECK'],
      ['Result', areaSchedule.reconciliationPassed ? 'PASS' : 'FAIL', areaSchedule.reconciliationPassed ? '' : 'Investigate delta'],
    ];
    for (const [label, value, status] of reconRows) {
      doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
        .text(label, MARGIN_PT, y, { width: labelW });
      doc.font('Courier').fontSize(FS_BODY).fillColor(COLOR_BLACK)
        .text(value, MARGIN_PT + labelW, y, { width: valW });
      doc.font('Helvetica-Bold').fontSize(FS_BODY)
        .fillColor(status === 'OK' ? COLOR_BLACK : status === 'CHECK' ? COLOR_WARNING : status === 'PASS' ? COLOR_BLACK : COLOR_WARNING)
        .text(status, MARGIN_PT + labelW + valW, y, { width: 40 * MM_TO_PT });
      doc.moveTo(MARGIN_PT, y + 12).lineTo(A4_WIDTH_PT - MARGIN_PT, y + 12).lineWidth(0.2).stroke(COLOR_LIGHT_GREY);
      y += 14;
    }
  }
}

// ── Page 5: Surveyor's Certificate ────────────────────────────────────

function drawCertificate(doc: PDFKit.PDFDocument, input: SurveyReportInput, sealResult: {
  signature: string;
  publicKeyPem: string;
  keyFingerprint: string;
  signedAt: string;
  documentHash: string;
}) {
  const { project, surveyor, traverse, areaSchedule } = input;
  const yStart = MARGIN_PT + 30;

  doc.font('Helvetica-Bold')
    .fontSize(FS_TITLE + 2)
    .fillColor(COLOR_ACCENT)
    .text("SURVEYOR'S CERTIFICATE", MARGIN_PT, yStart, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });

  doc.font('Helvetica-Oblique')
    .fontSize(FS_SUBHEADING)
    .fillColor(COLOR_GREY)
    .text('Per Survey Regulations 1994, Regulation 3(2)',
      MARGIN_PT, yStart + 22, { align: 'center', width: A4_WIDTH_PT - 2 * MARGIN_PT });

  let y = yStart + 50;

  // Certificate body
  const precisionRatio = traverse ? traverse.ratioDenominator : 0;
  const precisionText = precisionRatio === 0 ? '—'
    : precisionRatio >= 999999 ? '∞ (perfect closure)'
    : `1:${precisionRatio.toLocaleString()}`;

  const body = [
    `I, ${surveyor.name} (Licensed Surveyor No. ${surveyor.license}${surveyor.firmName ? `, ${surveyor.firmName}` : ''}),`,
    `hereby certify that the survey shown on the accompanying plans and`,
    `described in this report was executed by me (or under my immediate`,
    `personal supervision) in accordance with the Survey Act (Cap. 299)`,
    `and the Survey Regulations 1994.`,
    '',
    `Survey particulars:`,
    `  Parcel:       ${project.parcelNumber} (LR ${project.lrNumber})`,
    `  Locality:     ${project.locality}, ${project.county} County`,
    `  Survey type:  ${surveyTypeLabel(project.surveyType)}`,
    `  Survey date:  ${project.surveyDate}`,
    `  Projection:   ${project.projection} on ${project.datum}${project.zone ? ' (Zone ' + project.zone + ')' : ''}`,
    `  Area:         ${fmtArea(areaSchedule.parentAreaSqM)} m² (${sqMToHa(areaSchedule.parentAreaSqM).toFixed(4)} ha)`,
    traverse
      ? `  Traverse:     ${traverse.legs.length} legs, ${adjustmentLabel(traverse.adjustmentMethod)}`
      : `  Traverse:     N/A`,
    traverse
      ? `  Precision:    ${precisionText} — ${traverse.precisionClass}`
      : `  Precision:    N/A`,
    '',
    `I further certify that:`,
    `  (a) All beacons shown on the plan were placed or verified by me;`,
    `  (b) All measurements were made with calibrated instruments;`,
    `  (c) The coordinates shown are true and correct to the best of my`,
    `      knowledge and belief;`,
    `  (d) The plan and this report comply with the Survey Regulations 1994.`,
    '',
    `Signature: _______________________________`,
    `          ${surveyor.name}`,
    `          Licensed Surveyor No. ${surveyor.license}`,
    `Date: ${project.surveyDate}`,
  ];

  for (const line of body) {
    if (line.startsWith('Signature:') || line.startsWith('          ') || line.startsWith('Date:')) {
      doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
        .text(line, MARGIN_PT, y, { width: A4_WIDTH_PT - 2 * MARGIN_PT });
    } else {
      doc.font('Helvetica').fontSize(FS_BODY).fillColor(COLOR_BLACK)
        .text(line, MARGIN_PT, y, { width: A4_WIDTH_PT - 2 * MARGIN_PT });
    }
    y += 13;
  }

  // Digital signature block
  y += 10;
  doc.moveTo(MARGIN_PT, y).lineTo(A4_WIDTH_PT - MARGIN_PT, y).lineWidth(0.5).stroke(COLOR_ACCENT);
  y += 8;

  doc.font('Helvetica-Bold').fontSize(FS_HEADING).fillColor(COLOR_ACCENT)
    .text('Digital Seal (RSA-2048)', MARGIN_PT, y);
  y += 16;

  doc.font('Helvetica').fontSize(FS_BODY).fillColor(COLOR_BLACK)
    .text('This document is digitally sealed with RSA-SHA256. Verification:', MARGIN_PT, y);
  y += 14;

  // Seal details
  const sealRows: Array<[string, string]> = [
    ['Algorithm', 'RSA-SHA256 (RSA-2048 keypair)'],
    ['Signed at', sealResult.signedAt],
    ['Document hash (SHA-256)', sealResult.documentHash],
    ['Key fingerprint', sealResult.keyFingerprint],
    ['Public key', sealResult.publicKeyPem.split('\n').slice(0, 2).join(' ') + ' …'],
    ['Signature (base64)', sealResult.signature.substring(0, 64) + ' …'],
  ];
  const labelW = 50 * MM_TO_PT;
  for (const [label, value] of sealRows) {
    doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor(COLOR_BLACK)
      .text(label, MARGIN_PT, y, { width: labelW });
    doc.font('Courier').fontSize(FS_SMALL).fillColor(COLOR_BLACK)
      .text(value, MARGIN_PT + labelW, y, { width: A4_WIDTH_PT - MARGIN_PT - labelW });
    y += 13;
    doc.moveTo(MARGIN_PT, y).lineTo(A4_WIDTH_PT - MARGIN_PT, y).lineWidth(0.1).stroke(COLOR_LIGHT_GREY);
  }

  y += 10;
  doc.font('Helvetica-Oblique').fontSize(FS_SMALL).fillColor(COLOR_GREY)
    .text(
      'To verify: extract the SHA-256 hash of this PDF and verify against the public key using any RSA-SHA256 verifier (OpenSSL, GnuPG, or Python cryptography library).',
      MARGIN_PT, y, { width: A4_WIDTH_PT - 2 * MARGIN_PT }
    );
}

// ─── Main Entry Point ─────────────────────────────────────────────────

export async function generateSurveyReport(input: SurveyReportInput): Promise<SurveyReportResult> {
  log.info(`Generating survey report for parcel ${input.project.parcelNumber} → ${input.outputPath}`);

  const warnings: string[] = [];
  if (input.beacons.length === 0) {
    warnings.push('No beacons in schedule — beacon page will be empty.');
  }
  if (!input.traverse) {
    warnings.push('No traverse data — Form J page will note "no traverse data".');
  }
  if (!input.areaSchedule.reconciliationPassed) {
    warnings.push('Area reconciliation FAILED — check Schedule of Areas page.');
  }

  // Create PDF
  const doc = new PDFDocument({
    size: [A4_WIDTH_PT, A4_HEIGHT_PT],
    margins: { top: MARGIN_PT, bottom: MARGIN_PT, left: MARGIN_PT, right: MARGIN_PT },
    info: {
      Title: `Survey Report — ${input.project.parcelNumber} (LR ${input.project.lrNumber})`,
      Author: `${input.surveyor.name} (Lic. ${input.surveyor.license})`,
      Subject: surveyTypeLabel(input.project.surveyType),
      Keywords: 'Survey of Kenya, Cap 299, Survey Regulations 1994, METARDU Desktop',
      Producer: 'METARDU Desktop',
    },
  });

  const writeStream = fs.createWriteStream(input.outputPath);
  doc.pipe(writeStream);

  // Page 1 — Cover Sheet
  drawHeader(doc, input.project, '1');
  drawCoverSheet(doc, input);
  drawFooter(doc, input.project, input.surveyor);

  // Page 2 — Form J
  doc.addPage();
  drawHeader(doc, input.project, '2');
  drawFormJ(doc, input);
  drawFooter(doc, input.project, input.surveyor);

  // Page 3 — Schedule of Beacons
  doc.addPage();
  drawHeader(doc, input.project, '3');
  drawBeaconSchedule(doc, input);
  drawFooter(doc, input.project, input.surveyor);

  // Page 4 — Schedule of Areas
  doc.addPage();
  drawHeader(doc, input.project, '4');
  drawAreaSchedule(doc, input);
  drawFooter(doc, input.project, input.surveyor);

  // Compute document hash for sealing
  // We need to write the document first, then read it back to hash + seal.
  // For RSA sealing, we sign the SHA-256 of the rendered PDF bytes.
  doc.end();

  await new Promise<void>((resolve, reject) => {
    writeStream.on('finish', () => resolve());
    writeStream.on('error', (err) => reject(err));
  });

  const pdfBytes = fs.readFileSync(input.outputPath);
  const crypto = await import('node:crypto');
  const documentHash = crypto.createHash('sha256').update(pdfBytes).digest('hex');

  let sealed = false;
  let signatureFingerprint: string | undefined;
  let signedAt: string | undefined;

  if (input.sealWithRSA !== false) {
    try {
      const keypair = input.keypair ?? loadOrCreateSurveyorKeypair();
      const seal = sealDocument(documentHash, keypair);
      sealed = true;
      signatureFingerprint = seal.keyFingerprint;
      signedAt = seal.signedAt;

      // Append a 5th page with the certificate + digital seal
      const certDoc = new PDFDocument({
        size: [A4_WIDTH_PT, A4_HEIGHT_PT],
        margins: { top: MARGIN_PT, bottom: MARGIN_PT, left: MARGIN_PT, right: MARGIN_PT },
        info: {
          Title: `Surveyor's Certificate — ${input.project.parcelNumber}`,
          Author: `${input.surveyor.name} (Lic. ${input.surveyor.license})`,
          Subject: 'RSA-2048 Digital Seal',
        },
      });
      const appendStream = fs.createWriteStream(input.outputPath + '.cert.tmp');
      certDoc.pipe(appendStream);

      drawHeader(certDoc, input.project, '5');
      drawCertificate(certDoc, input, {
        signature: seal.signature,
        publicKeyPem: seal.publicKeyPem,
        keyFingerprint: seal.keyFingerprint,
        signedAt: seal.signedAt,
        documentHash,
      });
      drawFooter(certDoc, input.project, input.surveyor);
      certDoc.end();

      await new Promise<void>((resolve, reject) => {
        appendStream.on('finish', () => resolve());
        appendStream.on('error', (err) => reject(err));
      });

      // Merge the two PDFs using pdfkit's "append" trick — or simply concat using a PDF merge library.
      // For simplicity, we use the approach of reading both PDFs and using pdf-lib to merge.
      // If pdf-lib isn't available, we fall back to embedding as an attachment.
      try {
        const { PDFDocument } = await import('pdf-lib');
        const basePdf = await PDFDocument.load(fs.readFileSync(input.outputPath));
        const certPdf = await PDFDocument.load(fs.readFileSync(input.outputPath + '.cert.tmp'));
        const copiedPages = await basePdf.copyPages(certPdf, certPdf.getPageIndices());
        for (const p of copiedPages) basePdf.addPage(p);
        const mergedBytes = await basePdf.save();
        fs.writeFileSync(input.outputPath, mergedBytes);
        fs.unlinkSync(input.outputPath + '.cert.tmp');
      } catch (mergeErr) {
        log.warn('pdf-lib merge failed, keeping certificate as separate file: ' + String(mergeErr));
        // Rename .cert.tmp to .certificate.pdf
        const certPath = input.outputPath.replace(/\.pdf$/i, '') + '.certificate.pdf';
        fs.renameSync(input.outputPath + '.cert.tmp', certPath);
        warnings.push(`Certificate page saved separately: ${path.basename(certPath)}`);
      }
    } catch (sealErr) {
      log.error('RSA sealing failed: ' + String(sealErr));
      warnings.push(`RSA sealing failed: ${String(sealErr)}`);
    }
  }

  const finalStats = fs.statSync(input.outputPath);
  const result: SurveyReportResult = {
    pdfPath: input.outputPath,
    pdfSizeBytes: finalStats.size,
    pageCount: 5, // 4 base pages + 1 certificate
    sealed,
    signatureFingerprint,
    signedAt,
    warnings,
  };

  log.info(`Survey report generated: ${finalStats.size} bytes, sealed=${sealed}`);
  return result;
}
