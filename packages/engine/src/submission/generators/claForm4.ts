// ============================================================
// METARDU — CLA Form 4: Community Land Register Entry
// Community Land Act No. 27 of 2016, Section 17
// ============================================================

import jsPDF from 'jspdf'

/**
 * Input interface for CLA Form 4 — Community Land Register Entry.
 * Designed to be filled sequentially as entries in the community land register,
 * as required under Section 17 of the Community Land Act 2016.
 */
export interface CLA4Input {
  /** Register volume number */
  volumeNumber: string
  /** Register page number */
  pageNumber: string
  /** Sequential entry number on the page */
  entryNumber: string
  /** Date of the register entry */
  dateOfEntry: string
  /** Registered name of the community */
  communityName: string
  /** County */
  county: string
  /** Land reference number */
  landReferenceNumber: string
  /** Parcel number */
  parcelNumber: string
  /** Area in hectares */
  areaHa: number
  /** Nature of the interest registered (e.g. lease, license, customary right, collective title) */
  natureOfInterest: string
  /** Name of the person or entity holding the interest */
  interestHolderName: string
  /** ID or PIN number of the interest holder */
  idOrPinNumber: string
  /** Date the interest was acquired */
  dateOfAcquisition: string
  /** Term of the interest (e.g. "99 years", "in perpetuity", "customary") */
  termOfInterest: string
  /** Any restrictions, encumbrances, or cautions registered against the land */
  restrictions?: string
  /** Previous register entry reference if this is a variation, cancellation, or transfer */
  previousEntryReference?: string
  /** Reason for the entry (new registration, variation, cancellation, transfer) */
  entryReason?: 'new_registration' | 'variation' | 'cancellation' | 'transfer' | 'correction'
  /** Additional remarks or notes */
  remarks?: string
  /** Land Registrar details */
  registrar?: {
    name: string
    designation: string
    stampReference?: string
  }
}

/**
 * Generates CLA Form 4: Community Land Register Entry.
 *
 * This form creates an official register entry for community land rights
 * as maintained by the Land Registrar under Section 17 of the Community
 * Land Act 2016. It is designed for sequential recording of interests in
 * the community land register.
 *
 * @param input - Structured data conforming to {@link CLA4Input}
 * @returns PDF document as a Uint8Array
 */
export function generateCLAForm4(input: CLA4Input): Uint8Array {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210
  const margin = 20

  // ── Header ──────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('REPUBLIC OF KENYA', W / 2, 22, { align: 'center' })
  doc.setFontSize(11)
  doc.text('COMMUNITY LAND ACT No. 27 OF 2016', W / 2, 30, { align: 'center' })
  doc.text('CLA FORM 4 — COMMUNITY LAND REGISTER ENTRY', W / 2, 38, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text('(Section 17)', W / 2, 45, { align: 'center' })

  doc.setLineWidth(0.5)
  doc.line(margin, 49, W - margin, 49)

  let y = 56
  const lineH = 8

  // ── Helper functions ────────────────────────────────────────
  function sectionHeader(title: string) {
    if (y > 260) {
      doc.addPage()
      y = 20
    }
    doc.setFillColor(27, 58, 92)
    doc.rect(margin, y, W - margin * 2, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(255, 255, 255)
    doc.text(title, margin + 3, y + 5)
    doc.setTextColor(0, 0, 0)
    y += 10
  }

  function field(label: string, value: string, labelWidth = 50) {
    if (y > 275) {
      doc.addPage()
      y = 20
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text(label, margin, y)
    doc.setFont('helvetica', 'normal')
    doc.text(value || '\u2014', margin + labelWidth, y)
    doc.setLineWidth(0.1)
    doc.line(margin + labelWidth, y + 1, W - margin, y + 1)
    y += lineH
  }

  // ── Section A: Register Identification ──────────────────────
  sectionHeader('PART A — REGISTER IDENTIFICATION')
  field('Volume No.:', input.volumeNumber)
  field('Page No.:', input.pageNumber)
  field('Entry No.:', input.entryNumber)
  field('Date of Entry:', input.dateOfEntry)
  field('Entry Reason:', (input.entryReason ?? '').replace(/_/g, ' ').toUpperCase())
  y += 2

  // ── Section B: Community and Land Details ───────────────────
  sectionHeader('PART B — COMMUNITY AND LAND DETAILS')
  field('Community Name:', input.communityName)
  field('County:', input.county)
  field('Land Reference No.:', input.landReferenceNumber)
  field('Parcel Number:', input.parcelNumber)
  field('Area (Ha):', input.areaHa.toFixed(4))
  y += 2

  // ── Section C: Interest Details ─────────────────────────────
  sectionHeader('PART C — INTEREST HOLDER DETAILS')
  field('Nature of Interest:', input.natureOfInterest)
  field('Interest Holder Name:', input.interestHolderName)
  field('ID / PIN Number:', input.idOrPinNumber)
  field('Date of Acquisition:', input.dateOfAcquisition)
  field('Term of Interest:', input.termOfInterest)
  y += 2

  // ── Section D: Restrictions and Encumbrances ────────────────
  sectionHeader('PART D — RESTRICTIONS AND ENCUMBRANCES')
  if (input.restrictions) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    const restrictionLines = doc.splitTextToSize(input.restrictions, W - margin * 2)
    restrictionLines.forEach((line: string) => {
      if (y > 275) { doc.addPage(); y = 20 }
      doc.text(line, margin, y)
      y += 5
    })
  } else {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8.5)
    doc.text('None recorded.', margin, y)
    y += lineH
  }
  y += 4

  // ── Section E: Previous Entry Reference ─────────────────────
  sectionHeader('PART E — PREVIOUS ENTRY REFERENCE')
  if (input.previousEntryReference) {
    field('Previous Entry Ref.:', input.previousEntryReference)
  } else {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8.5)
    doc.text('No previous entry (new registration).', margin, y)
    y += lineH
  }
  y += 2

  // ── Section F: Remarks ──────────────────────────────────────
  if (input.remarks) {
    sectionHeader('PART F — REMARKS')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    const remarkLines = doc.splitTextToSize(input.remarks, W - margin * 2)
    remarkLines.forEach((line: string) => {
      if (y > 275) { doc.addPage(); y = 20 }
      doc.text(line, margin, y)
      y += 5
    })
    y += 4
  }

  // ── Section G: Land Registrar Certification ─────────────────
  sectionHeader('PART G — LAND REGISTRAR CERTIFICATION')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.text(
    'I hereby certify that the particulars entered above are a true record of the',
    margin, y
  )
  y += 5
  doc.text(
    'community land interest as maintained in the Community Land Register under',
    margin, y
  )
  y += 5
  doc.text(
    'Section 17 of the Community Land Act 2016.',
    margin, y
  )
  y += 12

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.text('Land Registrar:', margin, y)
  doc.setFont('helvetica', 'normal')
  doc.text((input.registrar && input.registrar.name) || '--', margin + 45, y)
  doc.text('Designation:', margin + 115, y)
  doc.text((input.registrar && input.registrar.designation) || '--', margin + 155, y)
  y += 10

  doc.setLineWidth(0.1)
  doc.line(margin, y, margin + 90, y)
  doc.text('Signature', margin, y + 4)
  doc.line(margin + 105, y, W - margin, y)
  doc.text('Date', margin + 105, y + 4)
  y += 14

  doc.setFont('helvetica', 'bold')
  doc.text('Official Stamp:', margin, y)
  doc.setFont('helvetica', 'normal')
  doc.text(input.registrar?.stampReference ?? '', margin + 40, y)
  if (!(input.registrar && input.registrar.stampReference)) {
    doc.line(margin + 40, y + 1, margin + 120, y + 1)
  }

  // ── Footer ──────────────────────────────────────────────────
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(7.5)
  doc.setTextColor(100, 100, 100)
  doc.text(
    'Generated by Metardu Survey Platform \u2014 Community Land Act 2016 Compliant',
    W / 2,
    285,
    { align: 'center' }
  )

  return doc.output('arraybuffer') as unknown as Uint8Array
}

