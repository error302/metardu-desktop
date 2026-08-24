/**
 * Beacon Certificate — Kenya Beacon Certificate renderer.
 *
 * Produces a print-ready A4 PDF (with A5 content centred) for a single
 * beacon's certificate. Text-only certificate per Survey Act Cap.299
 * ss.24/41/45(1)(c) and Survey Regulations 1994 Reg.12.
 *
 * One PDF per beacon. A 4-beacon parcel yields four certificates.
 *
 * # Source spec
 *
 * Every layout decision cites `docs/regulatory-sources/kenya/cadastral/beacon-certificate-spec.md`
 * per invariant B2. Unverifiable decisions flagged [HK] with hkItemCount = 9.
 *
 * Source documents:
 *   docs/regulatory-sources/kenya/cadastral/survey-act-cap-299-revised-2012.pdf ss.24/41/45(1)(c)
 *   docs/regulatory-sources/kenya/cadastral/kenya-gazette-survey-regulations-1994.pdf Reg.12, §6.6
 *   packages/country-config/src/countries/kenya.ts BEACON_CERTIFICATE
 *   docs/regulatory-sources/kenya/cadastral/form-3-spec.md (pattern reuse)
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { KENYA } from "@metardu/country-config";
import {
  validateNonEmptyString,
  validateNonNaN,
  validateSRID,
} from "../workflows/validation.js";
import type { Form3Surveyor } from "./form-3.js";

// ─── Types ─────────────────────────────────────────────────────────

export interface BeaconCertificateBeacon {
  label: string;
  position: { easting: number; northing: number };
  markType: string;
  description: string;
}

export interface BeaconCertificateInput {
  beacon: BeaconCertificateBeacon;
  parcelRef: string;
  ownerName?: string;
  srid: number;
  surveyor: Form3Surveyor;
}

export interface BeaconCertificateOutput {
  pdfBytes: Uint8Array;
  hasDraftWatermark: true;
  hkItemCount: number;
}

// ─── Constants ────────────────────────────────────────────────────

// Rendered as A4 portrait — [HK] spec says A5 but renderer outputs A4 for pdf-lib consistency
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
const MARGIN_TOP_MM = 20;
const MARGIN_RIGHT_MM = 15;
const MARGIN_BOTTOM_MM = 20;
const MARGIN_LEFT_MM = 15;
const MM_TO_PT = 2.834645669;
const PAGE_WIDTH_PT = PAGE_WIDTH_MM * MM_TO_PT;
const PAGE_HEIGHT_PT = PAGE_HEIGHT_MM * MM_TO_PT;
const MARGIN_TOP_PT = MARGIN_TOP_MM * MM_TO_PT;
const MARGIN_RIGHT_PT = MARGIN_RIGHT_MM * MM_TO_PT;
const MARGIN_BOTTOM_PT = MARGIN_BOTTOM_MM * MM_TO_PT;
const MARGIN_LEFT_PT = MARGIN_LEFT_MM * MM_TO_PT;

// Inner A5 content border inset — [HK]
const INNER_INSET_PT = 10 * MM_TO_PT;
const CERT_ROW_H_PT = 12; // pt

const BLACK = rgb(0, 0, 0);
const DRAFT_RED = rgb(0.75, 0.15, 0.15);
const LIGHT_GRAY = rgb(0.8, 0.8, 0.8);
const HK_ITEM_COUNT = 9; // per beacon-certificate-spec.md

// ─── Helpers ──────────────────────────────────────────────────────

function sanitizeAscii(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0x00b0 || code === 0x00ba) out += "d";
    else if (code >= 32 && code < 127) out += s[i]!;
    else if (code === 8211 || code === 8212) out += "-";
    else if (code === 8220 || code === 8221) out += '"';
    else if (code === 8216 || code === 8217) out += "'";
    else if (code >= 128) out += "?";
    else out += s[i]!;
  }
  return out;
}

function drawDraftWatermark(page: PDFPage, font: PDFFont) {
  const text = sanitizeAscii("DRAFT -- NOT FOR LODGEMENT (HK-PENDING-SPECIMEN)");
  const size = 38;
  const textWidth = font.widthOfTextAtSize(text, size);
  const x = PAGE_WIDTH_PT / 2 - textWidth / 2;
  const y = PAGE_HEIGHT_PT / 2;
  page.drawText(text, { x, y, size, font, color: DRAFT_RED, opacity: 0.15, rotate: degrees(45) });
}

function drawVerificationFooter(page: PDFPage, font: PDFFont, hkCount: number) {
  const lines = [
    sanitizeAscii(`Layout cites: Survey Act Cap.299 ss.24/41/45(1)(c) & Survey Regs 1994 Reg.12/s.6.6 -- HK items: ${hkCount} pending specimen.`),
    sanitizeAscii(`DRAFT watermark -- NOT FOR LODGEMENT. A4 rendered; A5 per BEACON_CERTIFICATE.pageSize [HK].`),
    sanitizeAscii(`Source: beacon-certificate-spec.md -- verification required before lodgement.`),
  ];
  const size = 6.5; const lineH = size * 1.35;
  const xM = MARGIN_LEFT_PT;
  const totalH = lines.length * lineH;
  const y0 = MARGIN_BOTTOM_PT - 4 - totalH;
  page.drawLine({ start: { x: xM, y: y0 + totalH + 2 }, end: { x: PAGE_WIDTH_PT - MARGIN_RIGHT_PT, y: y0 + totalH + 2 }, thickness: 0.25, color: rgb(0.55,0.55,0.55) });
  for (let i = 0; i < lines.length; i++) {
    page.drawText(lines[i]!, { x: xM, y: y0 + (lines.length - 1 - i) * lineH, size, font, color: rgb(0.45,0.45,0.45) });
  }
}

// ─── Validation ────────────────────────────────────────────────────

function validateBeaconCertificateInput(input: BeaconCertificateInput): void {
  validateNonEmptyString(input.beacon.label, "BeaconCertificateInput.beacon.label");
  validateNonEmptyString(input.beacon.markType, "BeaconCertificateInput.beacon.markType");
  validateNonEmptyString(input.beacon.description, "BeaconCertificateInput.beacon.description");
  validateNonNaN(input.beacon.position.easting, "BeaconCertificateInput.beacon.position.easting");
  validateNonNaN(input.beacon.position.northing, "BeaconCertificateInput.beacon.position.northing");
  validateNonEmptyString(input.parcelRef, "BeaconCertificateInput.parcelRef");
  if (input.ownerName !== undefined) validateNonEmptyString(input.ownerName, "BeaconCertificateInput.ownerName");
  validateSRID(input.srid, "BeaconCertificateInput.srid");
  validateNonEmptyString(input.surveyor.name, "BeaconCertificateInput.surveyor.name");
  validateNonEmptyString(input.surveyor.iskRegNo, "BeaconCertificateInput.surveyor.iskRegNo");
  validateNonEmptyString(input.surveyor.dateOfSurvey, "BeaconCertificateInput.surveyor.dateOfSurvey");
  const iskPattern = KENYA.professionalBody.registrationPattern;
  if (iskPattern && !new RegExp(iskPattern, "i").test(input.surveyor.iskRegNo)) {
    throw new Error(`Validation error: BeaconCertificateInput.surveyor.iskRegNo '${input.surveyor.iskRegNo}' does not match pattern ${iskPattern} (e.g. 'LS/1234').`);
  }
}

// ─── Main entry point ──────────────────────────────────────────────

/**
 * Generate a Beacon Certificate PDF for a single beacon.
 *
 * A4 portrait sheet with A5 content centred + bordered, certificate table
 * (9 rows), coordinate note, certification block, seal placeholder,
 * DRAFT watermark opacity 0.15 diagonal, verification footer with HK count 9.
 */
export async function generateBeaconCertificatePdf(input: BeaconCertificateInput): Promise<BeaconCertificateOutput> {
  validateBeaconCertificateInput(input);

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(sanitizeAscii(`Beacon Certificate -- ${input.beacon.label} -- Parcel ${input.parcelRef}`));
  pdfDoc.setAuthor(sanitizeAscii(input.surveyor.name));
  pdfDoc.setSubject(sanitizeAscii("Kenya Survey Act Cap. 299, Beacon Certificate -- Reg.12 [DRAFT]"));
  pdfDoc.setKeywords(["Kenya", "Cadastral", "Beacon Certificate", sanitizeAscii(input.beacon.label), sanitizeAscii(input.parcelRef)]);
  pdfDoc.setProducer("MetaRDU Desktop");
  pdfDoc.setCreator("MetaRDU Desktop -- packages/engine/src/documents/beacon-certificate.ts");
  pdfDoc.setCreationDate(new Date());

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const page = pdfDoc.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);

  // 1. DRAFT watermark
  drawDraftWatermark(page, fontBold);

  // 2. Outer A4 border (light) and inner certificate border (strong)
  const outerX = MARGIN_LEFT_PT;
  const outerY = MARGIN_BOTTOM_PT;
  const outerW = PAGE_WIDTH_PT - MARGIN_LEFT_PT - MARGIN_RIGHT_PT;
  const outerH = PAGE_HEIGHT_PT - MARGIN_TOP_PT - MARGIN_BOTTOM_PT;
  page.drawRectangle({ x: outerX, y: outerY, width: outerW, height: outerH, borderColor: rgb(0.85,0.85,0.85), borderWidth: 0.4, color: rgb(1,1,1) });

  const certX = outerX + INNER_INSET_PT;
  const certW = outerW - 2 * INNER_INSET_PT;
  const certTop = outerY + outerH - INNER_INSET_PT;
  // Header band
  const headerH = 28;
  const headerY = certTop - headerH;
  page.drawRectangle({ x: certX, y: headerY, width: certW, height: headerH, color: rgb(0.92,0.92,0.92), borderColor: BLACK, borderWidth: 0.6 });
  const headerLines = [
    { text: "REPUBLIC OF KENYA", size: 9, bold: true },
    { text: "BEACON CERTIFICATE", size: 10, bold: true },
    { text: "Survey Act Cap. 299 -- Survey Regulations 1994, Reg.12 [HK]", size: 6.5, bold: false },
  ];
  let hy = headerY + headerH - 10;
  for (const hl of headerLines) {
    const f = hl.bold ? fontBold : fontOblique;
    const w = f.widthOfTextAtSize(sanitizeAscii(hl.text), hl.size);
    page.drawText(sanitizeAscii(hl.text), { x: certX + (certW - w) / 2, y: hy, size: hl.size, font: f, color: BLACK });
    hy -= hl.bold ? 10 : 7;
  }

  // Certificate table (9 rows, 2 columns: Field | Value)
  const rows: Array<{ label: string; value: string }> = [
    { label: "BEACON REFERENCE NO.", value: input.beacon.label },
    { label: "PARCEL NO.", value: input.parcelRef },
    { label: "OWNER NAME", value: input.ownerName ?? "--" },
    { label: "BEACON TYPE (mark)", value: input.beacon.markType },
    { label: "COORDINATES (E, N)", value: `E ${input.beacon.position.easting.toFixed(3)}   N ${input.beacon.position.northing.toFixed(3)}` },
    { label: "SRID / CRS", value: (() => {
      const zone = KENYA.geodeticFramework.projectionZones.find(z => z.srid === input.srid);
      return zone ? `${zone.name} (EPSG::${String(zone.srid).padStart(5,"0")})` : `SRID ${input.srid}`;
    })() },
    { label: "BEACON DESCRIPTION", value: input.beacon.description },
    { label: "DATE PLACED", value: input.surveyor.dateOfSurvey },
    { label: "WITNESSES", value: "________________________  ________________________" },
  ];
  const tableX = certX;
  const tableW = certW;
  const tableHeaderH = 0; // no extra header — cert header is above
  void tableHeaderH;
  const rowH = CERT_ROW_H_PT + 2;
  const tableH = rows.length * rowH;
  const tableY = headerY - tableH;
  page.drawRectangle({ x: tableX, y: tableY, width: tableW, height: tableH, borderColor: BLACK, borderWidth: 0.7, color: rgb(1,1,1) });
  // Horizontal rules + content
  const labelColW = tableW * 0.38;
  for (let i = 0; i < rows.length; i++) {
    const rowY = tableY + tableH - (i + 1) * rowH;
    // Horizontal rule
    if (i > 0) page.drawLine({ start: { x: tableX, y: rowY + rowH }, end: { x: tableX + tableW, y: rowY + rowH }, thickness: 0.3, color: LIGHT_GRAY });
    // Vertical divider
    page.drawLine({ start: { x: tableX + labelColW, y: rowY }, end: { x: tableX + labelColW, y: rowY + rowH }, thickness: 0.4, color: BLACK });
    // Label (small bold, upper)
    page.drawText(sanitizeAscii(rows[i]!.label), { x: tableX + 3, y: rowY + rowH - 8, size: 6, font: fontBold, color: BLACK });
    // Value — wrap if too long
    const val = sanitizeAscii(rows[i]!.value);
    const maxW = tableW - labelColW - 6;
    let displayVal = val;
    let sz = 7.5;
    if (font.widthOfTextAtSize(val, sz) > maxW) {
      // truncate with ellipsis
      while (displayVal.length > 3 && font.widthOfTextAtSize(displayVal + "...", sz) > maxW) displayVal = displayVal.slice(0, -1);
      displayVal = displayVal + "...";
    }
    page.drawText(displayVal, { x: tableX + labelColW + 3, y: rowY + 4, size: sz, font, color: BLACK });
  }
  // Single-beacon coordinate schedule note below table
  const coordNoteY = tableY - 10;
  const coordNote = sanitizeAscii(`Coordinate schedule (single beacon): ${input.beacon.label}  E ${input.beacon.position.easting.toFixed(3)}  N ${input.beacon.position.northing.toFixed(3)}`);
  page.drawText(coordNote, { x: tableX, y: coordNoteY, size: 6, font, color: rgb(0.35,0.35,0.35) });
  const datumLine = (() => {
    const zone = KENYA.geodeticFramework.projectionZones.find(z => z.srid === input.srid);
    const label = zone ? `${zone.name} (EPSG::${String(zone.srid).padStart(5,"0")})` : `SRID ${input.srid}`;
    return sanitizeAscii(`Datum: ${label} -- per KENYA geodeticFramework.`);
  })();
  page.drawText(datumLine, { x: tableX, y: coordNoteY - 8, size: 6, font, color: rgb(0.35,0.35,0.35) });

  // Certification block
  const certLines = [
    sanitizeAscii(`I, ${input.surveyor.name}, licensed land surveyor No. ${input.surveyor.iskRegNo},`),
    sanitizeAscii(`certify that the beacon described above -- mark type "${input.beacon.markType}",`),
    sanitizeAscii(`at E ${input.beacon.position.easting.toFixed(3)} N ${input.beacon.position.northing.toFixed(3)} (SRID ${input.srid})`),
    sanitizeAscii(`on parcel ${input.parcelRef} -- was placed / re-established by me on ${input.surveyor.dateOfSurvey}`),
    sanitizeAscii(`per Survey Act Cap.299 s.24 & Survey Regs 1994 Reg.12 [HK].`),
  ];
  let certY = coordNoteY - 24;
  for (let i = 0; i < certLines.length; i++) {
    page.drawText(certLines[i]!, { x: tableX, y: certY - i * 8, size: 6.5, font, color: BLACK });
  }
  certY -= certLines.length * 8 + 4;
  page.drawText(sanitizeAscii(`Owner (where stated): ${input.ownerName ?? "--"}`), { x: tableX, y: certY, size: 6.5, font, color: BLACK });
  certY -= 14;
  page.drawText(sanitizeAscii(`Signed: _______________________      Date: ${input.surveyor.dateOfSurvey}`), { x: tableX, y: certY, size: 7, font, color: BLACK });
  // Seal placeholder — bottom-right of inner area
  const sealBoxSize = 25 * MM_TO_PT / 4; // ~17.7pt square visual
  void sealBoxSize;
  page.drawText(sanitizeAscii("Seal: [ISK SEAL]"), { x: tableX + tableW - 70, y: certY - 12, size: 6, font: fontOblique, color: rgb(0.45,0.45,0.45) });

  // A4 footnote hint: A4 rendered; A5 per spec
  page.drawText(sanitizeAscii("A4 rendered; A5 per BEACON_CERTIFICATE.pageSize [HK]"), { x: tableX, y: tableY - 28, size: 5.5, font: fontOblique, color: rgb(0.55,0.55,0.55) });

  // Verification footer — outside inner border, at page bottom
  drawVerificationFooter(page, font, HK_ITEM_COUNT);

  const pdfBytes = await pdfDoc.save();
  return { pdfBytes, hasDraftWatermark: true, hkItemCount: HK_ITEM_COUNT };
}
