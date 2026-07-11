// ============================================================
// METARDU — CLA Form 9: Application for Lease or License of Community Land
// Community Land Act No. 27 of 2016, Section 36
// ============================================================

import jsPDF from 'jspdf'

/**
 * Input interface for CLA Form 9 — Application for Lease or License of Community Land.
 * All fields correspond to requirements under Section 36 of the Community Land Act 2016.
 */
export interface CLA9Input {
  /** Application reference number */
  applicationReference: string
  /** Date of application */
  date: string
  /** Registered name of the community */
  communityName: string
  /** County */
  county: string
  /** Land reference number */
  landReference: string
  /** Parcel number */
  parcelNumber: string
  /** Area in hectares */
  areaHa: number
  /** Current land use */
  currentLandUse: string
  /** Applicant details */
  applicant: {
    name: string
    idNumber: string
    address: string
    phone: string
    email?: string
  }
  /** Type of application */
  applicationType: 'lease' | 'license'
  /** Purpose of the lease or license */
  purpose: 'agricultural' | 'commercial' | 'residential' | 'industrial' | 'pastoral' | 'cultural' | 'other'
  /** Additional purpose description */
  purposeDescription?: string
  /** Proposed term in months or years */
  proposedTerm: number
  /** Unit of the proposed term */
  proposedTermUnit: 'months' | 'years'
  /** Proposed annual rent in KES */
  proposedAnnualRentKes?: number
  /** Proposed one-time premium in KES */
  proposedPremiumKes?: number
  /** Summary of the development plan */
  developmentPlanSummary?: string
  /** Environmental impact assessment status */
  eiaStatus: 'completed' | 'not_required' | 'pending'
  /** EIA reference number (if completed) */
  eiaReferenceNumber?: string
  /** Attached documents checklist */
  attachments?: {
    communityResolution: boolean
    surveyPlan: boolean
    idCopies: boolean
    passportPhotos: boolean
    businessRegistration?: boolean
    otherDocuments?: string
  }
  /** Surveyor details */
  surveyor?: {
    name: string
    iskNumber: string
    firmName?: string
  }
  /** Application status */
  status?: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED'
}

/**
 * Generates CLA Form 9: Application for Lease or License of Community Land.
 *
 * This form is used by individuals or entities to apply for a lease or license
 * over community land, as required under Section 36 of the Community Land Act 2016.
 *
 * @param input - Structured data conforming to {@link CLA9Input}
 * @returns PDF document as a Uint8Array
 */
export function generateCLAForm9(input: CLA9Input): Uint8Array {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210
  const margin = 20

  // ── Header ──────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('REPUBLIC OF KENYA', W / 2, 22, { align: 'center' })
  doc.setFontSize(11)
  doc.text('COMMUNITY LAND ACT No. 27 OF 2016', W / 2, 30, { align: 'center' })
  doc.text('CLA FORM 9 — APPLICATION FOR LEASE OR LICENSE OF COMMUNITY LAND', W / 2, 38, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text('(Section 36)', W / 2, 45, { align: 'center' })

  doc.setLineWidth(0.5)
  doc.line(margin, 49, W - margin, 49)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(`Application Ref.: ${input.applicationReference}`, margin, 56)
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

  function checkbox(label: string, checked: boolean) {
    if (y > 275) {
      doc.addPage()
      y = 20
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    const marker = checked ? '\u2611' : '\u2610'
    doc.text(`${marker}  ${label}`, margin + 5, y)
    y += 6
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

  // ── Section A: Land Details ─────────────────────────────────
  sectionHeader('PART A — LAND DETAILS')
  field('Community Name:', input.communityName)
  field('County:', input.county)
  field('Land Reference:', input.landReference)
  field('Parcel Number:', input.parcelNumber)
  field('Area (Ha):', input.areaHa.toFixed(2))
  field('Current Land Use:', input.currentLandUse)
  y += 2

  // ── Section B: Applicant Details ────────────────────────────
  sectionHeader('PART B — APPLICANT DETAILS')
  field('Full Name:', input.applicant?.name ?? "")
  field('ID Number:', input.applicant?.idNumber ?? "")
  field('Address:', input.applicant?.address ?? "")
  field('Phone:', input.applicant?.phone ?? "")
  field('Email:', input.applicant?.email ?? '')
  y += 2

  // ── Section C: Application Type and Purpose ─────────────────
  sectionHeader('PART C — APPLICATION TYPE AND PURPOSE')
  field('Application Type:', input.applicationType.toUpperCase())
  field('Purpose:', input.purpose.charAt(0).toUpperCase() + input.purpose.slice(1))
  if (input.purposeDescription) {
    field('Purpose Description:', input.purposeDescription)
  }
  field('Proposed Term:', `${input.proposedTerm} ${input.proposedTermUnit}`)
  field('Proposed Annual Rent:', input.proposedAnnualRentKes ? `KES ${input.proposedAnnualRentKes.toLocaleString()}` : '')
  field('Proposed Premium:', input.proposedPremiumKes ? `KES ${input.proposedPremiumKes.toLocaleString()}` : '')
  y += 2

  // ── Section D: Development Plan ─────────────────────────────
  sectionHeader('PART D — DEVELOPMENT PLAN')
  if (input.developmentPlanSummary) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    const devLines = doc.splitTextToSize(input.developmentPlanSummary, W - margin * 2)
    devLines.forEach((line: string) => {
      if (y > 275) { doc.addPage(); y = 20 }
      doc.text(line, margin, y)
      y += 5
    })
  } else {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8.5)
    doc.text('No development plan summary provided.', margin, y)
    y += lineH
  }
  y += 4

  // ── Section E: Environmental Impact Assessment ──────────────
  sectionHeader('PART E — ENVIRONMENTAL IMPACT ASSESSMENT')
  field('EIA Status:', input.eiaStatus.replace(/_/g, ' ').toUpperCase())
  if (input.eiaReferenceNumber) {
    field('EIA Reference No.:', input.eiaReferenceNumber)
  }
  y += 2

  // ── Section F: Attached Documents ───────────────────────────
  sectionHeader('PART F — ATTACHED DOCUMENTS CHECKLIST')
  checkbox('Community Assembly Resolution', input.attachments?.communityResolution ?? false)
  checkbox('Survey Plan', input.attachments?.surveyPlan ?? false)
  checkbox('ID Copies (Applicant)', input.attachments?.idCopies ?? false)
  checkbox('Passport Photos', input.attachments?.passportPhotos ?? false)
  checkbox('Business Registration Certificate', input.attachments?.businessRegistration ?? false)
  if (input.attachments?.otherDocuments) {
    checkbox(`Other: ${input.attachments.otherDocuments}`, true)
  }
  y += 4

  // ── Section G: Surveyor Certification ───────────────────────
  sectionHeader('PART G — LICENSED SURVEYOR CERTIFICATION')
  if (input.surveyor) {
    field('Surveyor Name:', input.surveyor.name)
    field('ISK Number:', input.surveyor.iskNumber)
    field('Firm / Company:', input.surveyor.firmName ?? '')
    y += 2
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text(
      `I, ${input.surveyor.name} (ISK ${input.surveyor.iskNumber}), Licensed Surveyor, hereby confirm`,
      margin, y
    )
    y += 5
    doc.text(
      'that the land described in this application has been surveyed and the particulars provided',
      margin, y
    )
    y += 5
    doc.text(
      'are accurate as per the Survey Act (Cap 299) and the Community Land Act 2016.',
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
  sectionHeader('PART H — SIGNATURES AND AUTHORIZATION')
  signatureBlock('1. Applicant:')
  signatureBlock('2. Community Assembly Chairman (Seal):')
  signatureBlock('3. Community Land Management Committee:')
  signatureBlock('4. County Land Officer:')

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

