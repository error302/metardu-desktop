// ============================================================
// METARDU — CLA Form 2: Notice of Intention to Allocate Community Land
// Community Land Act No. 27 of 2016, Section 15
// ============================================================

import jsPDF from 'jspdf'

/**
 * Input interface for CLA Form 2 — Notice of Intention to Allocate Community Land.
 * All fields correspond to requirements under Section 15 of the Community Land Act 2016.
 */
export interface CLA2Input {
  /** County where the community land is situated */
  county: string
  /** Registered name of the community */
  communityName: string
  /** Land reference number or LR number */
  landReference: string
  /** Approximate area in hectares */
  approximateAreaHa: number
  /** Purpose of the allocation */
  purpose: 'residential' | 'agricultural' | 'commercial' | 'grazing' | 'cultural' | 'institutional' | 'investment'
  /** Additional description of the purpose */
  purposeDescription?: string
  /** Details of the proposed allottee */
  allottee: {
    name: string
    idNumber: string
    address: string
    phone?: string
    email?: string
  }
  /** Nature of interest being allocated */
  natureOfInterest: 'lease' | 'license'
  /** Proposed duration of the lease/license in years */
  proposedDurationYears: number
  /** Proposed premium or consideration in KES */
  proposedPremiumKes?: number
  /** Proposed annual rent in KES */
  proposedAnnualRentKes?: number
  /** Date of the Community Assembly resolution */
  dateOfAssemblyResolution: string
  /** Community Assembly resolution number */
  resolutionNumber: string
  /** Notice publication date */
  noticeDate: string
  /** Notice reference number */
  referenceNumber: string
  /** Surveyor details */
  surveyor?: {
    name: string
    iskNumber: string
    firmName?: string
  }
  /** Status of the notice */
  status?: 'DRAFT' | 'PUBLISHED' | 'OBJECTION_PERIOD' | 'APPROVED' | 'REJECTED'
}

/**
 * Generates CLA Form 2: Notice of Intention to Allocate Community Land.
 *
 * This form provides public notice of the community's intention to allocate
 * community land to an individual or entity, as required under Section 15
 * of the Community Land Act 2016.
 *
 * @param input - Structured data conforming to {@link CLA2Input}
 * @returns PDF document as a Uint8Array
 */
export function generateCLAForm2(input: CLA2Input): Uint8Array {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210
  const margin = 20

  // ── Header ──────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('REPUBLIC OF KENYA', W / 2, 22, { align: 'center' })
  doc.setFontSize(11)
  doc.text('COMMUNITY LAND ACT No. 27 OF 2016', W / 2, 30, { align: 'center' })
  doc.text('CLA FORM 2 — NOTICE OF INTENTION TO ALLOCATE COMMUNITY LAND', W / 2, 38, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text('(Section 15)', W / 2, 45, { align: 'center' })

  doc.setLineWidth(0.5)
  doc.line(margin, 49, W - margin, 49)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(`Reference No.: ${input.referenceNumber}`, margin, 56)
  doc.text(`Date: ${input.noticeDate}`, W - margin, 56, { align: 'right' })
  if (input.status) {
    doc.setTextColor(27, 58, 92)
    doc.text(`Status: ${input.status}`, W / 2, 56, { align: 'center' })
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

  // ── Notice preamble ─────────────────────────────────────────
  sectionHeader('PART A — PUBLIC NOTICE')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  const noticeLines = [
    'TAKE NOTICE that the Community Assembly of the community named below, in exercise of',
    'its powers under Section 15 of the Community Land Act 2016, intends to allocate the',
    'community land described herein to the proposed allottee named below.',
    '',
    'Any person who objects to this proposed allocation may lodge a written objection with',
    'the County Land Management Board within THIRTY (30) DAYS of the date of this notice.',
  ]
  noticeLines.forEach((line: string) => {
    if (y > 275) { doc.addPage(); y = 20 }
    doc.text(line, margin, y)
    y += line === '' ? 4 : 5
  })
  y += 4

  // ── Section B: Community and Land Details ───────────────────
  sectionHeader('PART B — COMMUNITY AND LAND DETAILS')
  field('County:', input.county)
  field('Community Name:', input.communityName)
  field('Land Reference / LR No.:', input.landReference)
  field('Approximate Area (Ha):', input.approximateAreaHa.toFixed(2))
  field('Purpose of Allocation:', input.purpose.charAt(0).toUpperCase() + input.purpose.slice(1))
  if (input.purposeDescription) {
    field('Purpose Description:', input.purposeDescription)
  }
  y += 2

  // ── Section C: Proposed Allottee ────────────────────────────
  sectionHeader('PART C — PROPOSED ALLOTTEE DETAILS')
  field('Full Name:', input.allottee.name)
  field('ID Number:', input.allottee.idNumber)
  field('Address:', input.allottee.address)
  field('Phone:', input.allottee.phone ?? '')
  field('Email:', input.allottee.email ?? '')
  y += 2

  // ── Section D: Terms of Allocation ──────────────────────────
  sectionHeader('PART D — TERMS OF ALLOCATION')
  field('Nature of Interest:', input.natureOfInterest.toUpperCase())
  field('Proposed Duration:', `${input.proposedDurationYears} years`)
  field('Proposed Annual Rent:', input.proposedAnnualRentKes ? `KES ${input.proposedAnnualRentKes.toLocaleString()}` : '')
  field('Proposed Premium:', input.proposedPremiumKes ? `KES ${input.proposedPremiumKes.toLocaleString()}` : '')
  y += 2

  // ── Section E: Community Assembly Resolution ────────────────
  sectionHeader('PART E — COMMUNITY ASSEMBLY RESOLUTION')
  field('Resolution Date:', input.dateOfAssemblyResolution)
  field('Resolution Number:', input.resolutionNumber)
  y += 4

  // ── Section F: Surveyor Certification ───────────────────────
  sectionHeader('PART F — LICENSED SURVEYOR CERTIFICATION')
  if (input.surveyor) {
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
      'that the land described in this notice has been surveyed and demarcated in accordance',
      margin, y
    )
    y += 5
    doc.text(
      'with the Survey Act (Cap 299) and the Community Land Act 2016.',
      margin, y
    )
    y += 8
  } else {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8.5)
    doc.text('Surveyor details not provided.', margin, y)
    y += lineH
  }

  // ── Signature Blocks ────────────────────────────────────────
  sectionHeader('PART G — SIGNATURES AND AUTHORIZATION')
  signatureBlock('1. Community Assembly Chairman (Seal):')
  signatureBlock('2. County Land Management Board:')
  signatureBlock('3. Proposed Allottee:')

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
