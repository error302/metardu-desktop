// ============================================================
// METARDU — CLA Form 1: Application for Registration of Community Land
// Community Land Act No. 27 of 2016, Section 12
// ============================================================

import jsPDF from 'jspdf'

/**
 * Input interface for CLA Form 1 — Application for Registration of Community Land.
 * All fields correspond to data required under Section 12 of the Community Land Act 2016.
 */
export interface CLA1Input {
  /** County where the community land is situated */
  county: string
  /** Sub-county within the county */
  subCounty: string
  /** Ward within the sub-county */
  ward: string
  /** Registered or recognized name of the community */
  communityName: string
  /** Approximate area of the community land in hectares */
  approximateAreaHa: number
  /** Geographic description of the land (natural features, boundaries, landmarks) */
  geographicDescription: string
  /** Total number of registered community members */
  numberOfMembers: number
  /** Community leadership details */
  leadership: {
    chairmanName: string
    chairmanId?: string
    secretaryName: string
    secretaryId?: string
    treasurerName: string
    treasurerId?: string
  }
  /** Community contact details */
  contact: {
    postalAddress: string
    physicalAddress?: string
    phone: string
    email?: string
  }
  /** Date the community assembly passed a resolution authorizing this application */
  dateOfResolution: string
  /** Attached documents checklist */
  attachments: {
    communityConstitution: boolean
    membershipRegister: boolean
    boundaryDescription: boolean
    minutesOfMeeting: boolean
    otherDocuments?: string
  }
  /** Applicant / authorized representative details */
  applicant: {
    name: string
    idNumber: string
    phone: string
    email?: string
    capacity: string
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
  /** Status of the application */
  status?: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'
}

/**
 * Generates CLA Form 1: Application for Registration of Community Land.
 *
 * This form is used to initiate the registration of community land under
 * Section 12 of the Community Land Act 2016. It captures community details,
 * leadership information, attached documentation, and the authorized
 * representative's particulars.
 *
 * @param input - Structured data conforming to {@link CLA1Input}
 * @returns PDF document as a Uint8Array
 */
export function generateCLAForm1(input: CLA1Input): Uint8Array {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210
  const margin = 20

  // ── Header ──────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('REPUBLIC OF KENYA', W / 2, 22, { align: 'center' })
  doc.setFontSize(11)
  doc.text('COMMUNITY LAND ACT No. 27 OF 2016', W / 2, 30, { align: 'center' })
  doc.setFontSize(11)
  doc.text('CLA FORM 1 — APPLICATION FOR REGISTRATION OF COMMUNITY LAND', W / 2, 38, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text('(Section 12)', W / 2, 45, { align: 'center' })

  doc.setLineWidth(0.5)
  doc.line(margin, 49, W - margin, 49)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(`Reference No.: ${input.referenceNumber}`, margin, 56)
  doc.text(`Date: ${input.applicationDate}`, W - margin, 56, { align: 'right' })
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

  // ── Section A: Community Details ────────────────────────────
  sectionHeader('PART A — COMMUNITY DETAILS')
  field('County:', input.county)
  field('Sub-county:', input.subCounty)
  field('Ward:', input.ward)
  field('Community Name:', input.communityName)
  field('Approximate Area (Ha):', input.approximateAreaHa.toFixed(2))
  field('Number of Members:', input.numberOfMembers.toString())
  y += 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.text('Geographic Description:', margin, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  const geoLines = doc.splitTextToSize(input.geographicDescription || '\u2014', W - margin * 2)
  geoLines.forEach((line: string) => {
    if (y > 275) { doc.addPage(); y = 20 }
    doc.text(line, margin, y)
    y += 5
  })
  y += 4

  // ── Section B: Community Leadership ─────────────────────────
  sectionHeader('PART B — COMMUNITY LEADERSHIP')
  field('Chairman Name:', input.leadership.chairmanName)
  field('Chairman ID No.:', input.leadership.chairmanId ?? '')
  field('Secretary Name:', input.leadership.secretaryName)
  field('Secretary ID No.:', input.leadership.secretaryId ?? '')
  field('Treasurer Name:', input.leadership.treasurerName)
  field('Treasurer ID No.:', input.leadership.treasurerId ?? '')
  y += 2

  // ── Section C: Contact Details ──────────────────────────────
  sectionHeader('PART C — COMMUNITY CONTACT DETAILS')
  field('Postal Address:', input.contact.postalAddress)
  field('Physical Address:', input.contact.physicalAddress ?? '')
  field('Phone:', input.contact.phone)
  field('Email:', input.contact.email ?? '')
  y += 2

  // ── Section D: Resolution ───────────────────────────────────
  sectionHeader('PART D — COMMUNITY ASSEMBLY RESOLUTION')
  field('Date of Resolution:', input.dateOfResolution)
  y += 2
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.text(
    'I/We hereby certify that a resolution was passed by the Community Assembly authorizing',
    margin, y
  )
  y += 5
  doc.text(
    'the application for registration of the community land described in this form.',
    margin, y
  )
  y += 8

  // ── Section E: Attached Documents ───────────────────────────
  sectionHeader('PART E — ATTACHED DOCUMENTS CHECKLIST')
  checkbox('Community Constitution', input.attachments.communityConstitution)
  checkbox('Membership Register', input.attachments.membershipRegister)
  checkbox('Community Boundary Description', input.attachments.boundaryDescription)
  checkbox('Minutes of Meeting Authorizing Application', input.attachments.minutesOfMeeting)
  if (input.attachments.otherDocuments) {
    checkbox(`Other: ${input.attachments.otherDocuments}`, true)
  }
  y += 4

  // ── Section F: Applicant Details ────────────────────────────
  sectionHeader('PART F — AUTHORIZED REPRESENTATIVE / APPLICANT')
  field('Full Name:', input.applicant.name)
  field('ID Number:', input.applicant.idNumber)
  field('Phone:', input.applicant.phone)
  field('Email:', input.applicant.email ?? '')
  field('Capacity / Role:', input.applicant.capacity)
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
      'the land described in this application has been surveyed and the boundary description',
      margin, y
    )
    y += 5
    doc.text(
      'accurately reflects the extent of the community land as per the Community Land Act 2016.',
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
  sectionHeader('PART H — SIGNATURES')
  signatureBlock('1. Community Chairman (Seal):')
  signatureBlock('2. County Director of Land:')
  if (input.surveyor) {
    signatureBlock('3. Licensed Surveyor:')
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
