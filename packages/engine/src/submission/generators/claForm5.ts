// ============================================================
// METARDU — CLA Form 5: Application for Community Land Title
// Community Land Act No. 27 of 2016, Section 27
// ============================================================

import jsPDF from 'jspdf'

/**
 * Input interface for CLA Form 5 — Application for Community Land Title.
 * All fields correspond to requirements under Section 27 of the Community Land Act 2016.
 */
export interface CLA5Input {
  /** Type of title being applied for */
  titleType: 'collective_title' | 'individual_title'
  /** County */
  county: string
  /** Registered name of the community */
  communityName: string
  /** Land reference number */
  landReference: string
  /** One or more parcel numbers */
  parcelNumbers: string[]
  /** Total area in hectares */
  areaHa: number
  /** Community assembly resolution reference authorizing this title application */
  assemblyResolutionRef: string
  /** Date of the assembly resolution */
  assemblyResolutionDate: string
  /** Purpose for which the title is being sought */
  purposeForTitle: string
  /** Any existing encumbrances (mortgages, charges, restrictions) */
  encumbrances?: {
    mortgages?: string
    charges?: string
    restrictions?: string
  }
  /** Previous title details if this is a conversion or re-issuance */
  previousTitle?: {
    titleNumber?: string
    dateOfIssuance?: string
    registrar?: string
  }
  /** Applicant details */
  applicant?: {
    name: string
    capacity: string
    idNumber: string
    phone: string
    email?: string
    address?: string
  }
  /** Attached documents checklist */
  attachments: {
    allocationLetter: boolean
    communityResolution: boolean
    surveyPlan: boolean
    beaconSchedule: boolean
    feeReceipts: boolean
    otherDocuments?: string
  }
  /** Surveyor details */
  surveyor?: {
    name: string
    iskNumber: string
    firmName?: string
  }
  /** Application reference number */
  referenceNumber: string
  /** Date of application */
  applicationDate: string
  /** Application status */
  status?: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED'
}

/**
 * Generates CLA Form 5: Application for Community Land Title.
 *
 * This form is used to apply for the issuance of a community land title
 * (collective or individual) under Section 27 of the Community Land Act 2016.
 *
 * @param input - Structured data conforming to {@link CLA5Input}
 * @returns PDF document as a Uint8Array
 */
export function generateCLAForm5(input: CLA5Input): Uint8Array {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210
  const margin = 20

  // ── Header ──────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('REPUBLIC OF KENYA', W / 2, 22, { align: 'center' })
  doc.setFontSize(11)
  doc.text('COMMUNITY LAND ACT No. 27 OF 2016', W / 2, 30, { align: 'center' })
  doc.text('CLA FORM 5 — APPLICATION FOR COMMUNITY LAND TITLE', W / 2, 38, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text('(Section 27)', W / 2, 45, { align: 'center' })

  doc.setLineWidth(0.5)
  doc.line(margin, 49, W - margin, 49)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(`Reference No.: ${input.referenceNumber}`, margin, 56)
  doc.text(`Date: ${input.applicationDate}`, W - margin, 56, { align: 'right' })
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

  // ── Section A: Title Application Details ────────────────────
  sectionHeader('PART A — TITLE APPLICATION DETAILS')
  field('Title Type Sought:', input.titleType === 'collective_title' ? 'COLLECTIVE TITLE' : 'INDIVIDUAL TITLE')
  field('County:', input.county)
  field('Community Name:', input.communityName)
  field('Land Reference:', input.landReference)
  field('Parcel Number(s):', input.parcelNumbers.join(', '))
  field('Total Area (Ha):', input.areaHa.toFixed(2))
  field('Purpose for Title:', input.purposeForTitle)
  y += 2

  // ── Section B: Community Assembly Resolution ────────────────
  sectionHeader('PART B — COMMUNITY ASSEMBLY RESOLUTION')
  field('Resolution Reference:', input.assemblyResolutionRef)
  field('Resolution Date:', input.assemblyResolutionDate)
  y += 2

  // ── Section C: Encumbrances ─────────────────────────────────
  sectionHeader('PART C — ENCUMBRANCES')
  field('Mortgages:', input.encumbrances?.mortgages ?? 'None')
  field('Charges:', input.encumbrances?.charges ?? 'None')
  field('Restrictions:', input.encumbrances?.restrictions ?? 'None')
  y += 2

  // ── Section D: Previous Title Details ───────────────────────
  sectionHeader('PART D — PREVIOUS TITLE DETAILS (if conversion/re-issuance)')
  field('Previous Title No.:', input.previousTitle?.titleNumber ?? '')
  field('Date of Issuance:', input.previousTitle?.dateOfIssuance ?? '')
  field('Issuing Registrar:', input.previousTitle?.registrar ?? '')
  y += 2

  // ── Section E: Applicant Details ────────────────────────────
  sectionHeader('PART E — APPLICANT DETAILS')
  field('Full Name:', input.applicant?.name ?? '')
  field('Capacity:', input.applicant?.capacity ?? '')
  field('ID Number:', input.applicant?.idNumber ?? '')
  field('Phone:', input.applicant?.phone ?? '')
  field('Email:', input.applicant?.email ?? '')
  field('Address:', input.applicant?.address ?? '')
  y += 2

  // ── Section F: Attached Documents ───────────────────────────
  sectionHeader('PART F — ATTACHED DOCUMENTS CHECKLIST')
  checkbox('Allocation Letter', input.attachments.allocationLetter)
  checkbox('Community Assembly Resolution', input.attachments.communityResolution)
  checkbox('Survey Plan', input.attachments.surveyPlan)
  checkbox('Beacon Schedule', input.attachments.beaconSchedule)
  checkbox('Receipts for Fees Paid', input.attachments.feeReceipts)
  if (input.attachments.otherDocuments) {
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
      `I, ${input.surveyor.name} (ISK ${input.surveyor.iskNumber}), Licensed Surveyor, hereby certify that`,
      margin, y
    )
    y += 5
    doc.text(
      'I have surveyed the land described in this application and confirm that the boundaries',
      margin, y
    )
    y += 5
    doc.text(
      'and area as stated are accurate and in accordance with the Survey Act (Cap 299).',
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
  signatureBlock('1. Community Representative (Seal):')
  if (input.surveyor) {
    signatureBlock('2. Licensed Surveyor:')
  }
  signatureBlock('3. County Director of Land:')
  signatureBlock('4. Commissioner of Lands:')

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
