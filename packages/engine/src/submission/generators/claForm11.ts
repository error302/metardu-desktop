// ============================================================
// METARDU — CLA Form 11: Notice of Variation of Community Land Rights
// Community Land Act No. 27 of 2016, Section 40
// ============================================================

import jsPDF from 'jspdf'

/** Row in the variation comparison table */
export interface VariationRow {
  /** Description of the attribute being varied */
  description: string
  /** Value before the variation */
  before: string
  /** Value after the variation */
  after: string
}

/**
 * Input interface for CLA Form 11 — Notice of Variation of Community Land Rights.
 * All fields correspond to requirements under Section 40 of the Community Land Act 2016.
 */
export interface CLA11Input {
  /** Variation reference number */
  variationReference: string
  /** Date of the variation notice */
  date: string
  /** Registered name of the community */
  communityName: string
  /** County */
  county: string
  /** Land reference number */
  landReference: string
  /** Parcel number */
  parcelNumber: string
  /** Current right holder name */
  currentRightHolderName: string
  /** Current right holder ID number */
  currentRightHolderId: string
  /** Nature of the current right */
  natureOfCurrentRight: 'lease' | 'license' | 'customary'
  /** Current term description (e.g. "99 years", "5 years remaining") */
  currentTerm: string
  /** Reason for the variation */
  reasonForVariation: 'extension' | 'reduction' | 'surrender' | 'subdivision' | 'other'
  /** Additional details if reason is "other" */
  otherReasonDescription?: string
  /** Detailed description of the proposed variation */
  proposedVariationDetails: string
  /** Date from which the variation takes effect */
  effectiveDate: string
  /** Compensation payable (if any), in KES */
  compensationPayable?: number
  /** Comparison table rows showing before and after values */
  variationTable: VariationRow[]
  /** Surveyor details (required if boundary change) */
  surveyor?: {
    name: string
    iskNumber: string
    firmName?: string
  }
  /** Land registrar details */
  registrar?: {
    name: string
    designation: string
  }
  /** Status of the variation notice */
  status?: 'DRAFT' | 'NOTIFIED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED'
}

/**
 * Generates CLA Form 11: Notice of Variation of Community Land Rights.
 *
 * This form provides official notice of a proposed variation to existing
 * community land rights, including extension, reduction, surrender, or
 * subdivision of interests, under Section 40 of the Community Land Act 2016.
 *
 * @param input - Structured data conforming to {@link CLA11Input}
 * @returns PDF document as a Uint8Array
 */
export function generateCLAForm11(input: CLA11Input): Uint8Array {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210
  const margin = 20

  // ── Header ──────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('REPUBLIC OF KENYA', W / 2, 22, { align: 'center' })
  doc.setFontSize(11)
  doc.text('COMMUNITY LAND ACT No. 27 OF 2016', W / 2, 30, { align: 'center' })
  doc.text('CLA FORM 11 — NOTICE OF VARIATION OF COMMUNITY LAND RIGHTS', W / 2, 38, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text('(Section 40)', W / 2, 45, { align: 'center' })

  doc.setLineWidth(0.5)
  doc.line(margin, 49, W - margin, 49)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(`Variation Ref.: ${input.variationReference}`, margin, 56)
  doc.text(`Date: ${input.date}`, W - margin, 56, { align: 'right' })
  if (input.status) {
    doc.setTextColor(27, 58, 92)
    doc.text(`Status: ${input.status.replace(/_/g, ' ')}`, W / 2, 56, { align: 'center' })
    doc.setTextColor(0, 0, 0)
  }

  let y = 64
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

  function field(label: string, value: string, labelWidth = 55) {
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

  function signatureBlock(label: string) {
    if (y > 255) {
      doc.addPage()
      y = 20
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text(label, margin, y)
    y += 6
    doc.setFont('helvetica', 'normal')
    doc.setLineWidth(0.1)
    doc.line(margin, y, margin + 90, y)
    doc.text('Signature', margin, y + 4)
    doc.line(margin + 105, y, W - margin, y)
    doc.text('Date', margin + 105, y + 4)
    y += 12
  }

  // ── Section A: Community and Land Details ───────────────────
  sectionHeader('PART A — COMMUNITY AND LAND DETAILS')
  field('Community Name:', input.communityName)
  field('County:', input.county)
  field('Land Reference:', input.landReference)
  field('Parcel Number:', input.parcelNumber)
  y += 2

  // ── Section B: Current Right Holder ─────────────────────────
  sectionHeader('PART B — CURRENT RIGHT HOLDER')
  field('Right Holder Name:', input.currentRightHolderName)
  field('ID Number:', input.currentRightHolderId)
  field('Nature of Right:', input.natureOfCurrentRight.toUpperCase())
  field('Current Term:', input.currentTerm)
  y += 2

  // ── Section C: Variation Details ────────────────────────────
  sectionHeader('PART C — VARIATION DETAILS')
  const reasonDisplay = input.reasonForVariation === 'other'
    ? `OTHER: ${input.otherReasonDescription ?? ''}`
    : input.reasonForVariation.toUpperCase()
  field('Reason for Variation:', reasonDisplay)
  field('Effective Date:', input.effectiveDate)
  field('Compensation (if any):', input.compensationPayable ? `KES ${input.compensationPayable.toLocaleString()}` : 'None')
  y += 2

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.text('Details of Proposed Variation:', margin, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  const detailLines = doc.splitTextToSize(input.proposedVariationDetails, W - margin * 2)
  detailLines.forEach((line: string) => {
    if (y > 275) { doc.addPage(); y = 20 }
    doc.text(line, margin, y)
    y += 5
  })
  y += 4

  // ── Section D: Comparison Table ─────────────────────────────
  sectionHeader('PART D — VARIATION COMPARISON TABLE')

  const colX = [margin, margin + 60, margin + 125, margin + 160]
  const headers = ['Description', 'Before Variation', 'After Variation', 'Remarks']
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  headers.forEach((h, i) => doc.text(h, colX[i], y))
  doc.setLineWidth(0.2)
  doc.line(margin, y + 2, W - margin, y + 2)
  y += 6

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  input.variationTable.forEach((row) => {
    if (y > 270) {
      doc.addPage()
      y = 20
      doc.setFont('helvetica', 'bold')
      headers.forEach((h, i) => doc.text(h, colX[i], y))
      doc.line(margin, y + 2, W - margin, y + 2)
      y += 6
      doc.setFont('helvetica', 'normal')
    }

    doc.text(row.description, colX[0], y)
    doc.text(row.before, colX[1], y)
    doc.text(row.after, colX[2], y)
    doc.line(margin, y + 2, W - margin, y + 2)
    y += 6
  })
  y += 4

  // ── Section E: Surveyor Certification (if boundary change) ──
  if (input.surveyor) {
    sectionHeader('PART E — LICENSED SURVEYOR CERTIFICATION')
    field('Surveyor Name:', input.surveyor.name)
    field('ISK Number:', input.surveyor.iskNumber)
    field('Firm / Company:', input.surveyor.firmName ?? '')
    y += 2
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text(
      `I, ${input.surveyor.name} (ISK ${input.surveyor.iskNumber}), Licensed Surveyor, hereby certify`,
      margin, y
    )
    y += 5
    doc.text(
      'that the variation described in this notice has been surveyed and the modified boundaries',
      margin, y
    )
    y += 5
    doc.text(
      'accurately reflect the new extent of the community land interest.',
      margin, y
    )
    y += 10
  }

  // ── Signature Blocks ────────────────────────────────────────
  sectionHeader('PART F — SIGNATURES')
  signatureBlock('1. Current Right Holder:')
  signatureBlock('2. Community Assembly Chairman (Seal):')
  if (input.surveyor) {
    signatureBlock('3. Licensed Surveyor:')
  }
  signatureBlock('4. Land Registrar:')
  if (input.registrar) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(`   Name: ${input.registrar.name}, ${input.registrar.designation}`, margin, y)
    y += 5
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
