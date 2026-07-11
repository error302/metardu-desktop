// ============================================================
// METARDU — CLA Form 12: Community Land Dispute Resolution Form
// Community Land Act No. 27 of 2016, Sections 38 & 39
// ============================================================

import jsPDF from 'jspdf'

/** Witness details for a dispute resolution */
export interface Witness {
  /** Full name of the witness */
  name: string
  /** National ID number */
  idNumber: string
  /** Contact phone number */
  phone: string
}

/** Dispute Resolution Committee hearing details */
export interface DisputeResolutionCommittee {
  /** Date of the hearing */
  hearingDate: string
  /** Names of committee members present */
  committeeMembersPresent: string[]
  /** Summary of the decision reached */
  decisionSummary: string
  /** Date the decision was issued */
  decisionDate: string
  /** Whether the decision was appealed */
  appealed: 'Yes' | 'No'
  /** Appeal reference number (if appealed) */
  appealReference?: string
}

/**
 * Input interface for CLA Form 12 — Community Land Dispute Resolution Form.
 * All fields correspond to requirements under Sections 38 & 39 of the Community Land Act 2016.
 */
export interface CLA12Input {
  /** Dispute reference number */
  disputeReferenceNumber: string
  /** Date the dispute was filed */
  dateFiled: string
  /** Registered name of the community */
  communityName: string
  /** County */
  county: string
  /** Land reference number */
  landReference: string
  /** Parcel number */
  parcelNumber: string
  /** Complainant details */
  complainant: {
    name: string
    idNumber: string
    address: string
    phone?: string
  }
  /** Respondent details */
  respondent: {
    name: string
    idNumber: string
    address?: string
  }
  /** Nature of the dispute */
  natureOfDispute: 'boundary' | 'ownership' | 'allocation' | 'access' | 'use' | 'other'
  /** Additional description if nature is "other" */
  otherNatureDescription?: string
  /** Detailed description of the dispute */
  disputeDescription: string
  /** Date the dispute arose */
  dateDisputeArose: string
  /** Previous attempts at resolution */
  previousResolutionAttempts?: string
  /** Witnesses (up to 4) */
  witnesses: Witness[]
  /** Relief sought by the complainant */
  reliefSought: string
  /** List of documents attached */
  documentsAttached?: string
  /** Mediator or arbitrator details (if appointed) */
  mediator?: {
    name: string
    designation: string
    appointmentDate: string
  }
  /** Dispute Resolution Committee details */
  disputeCommittee?: DisputeResolutionCommittee
  /** Status of the dispute */
  status?: 'FILED' | 'UNDER_MEDIATION' | 'UNDER_ARBITRATION' | 'RESOLVED' | 'APPEALED' | 'DISMISSED'
}

/**
 * Generates CLA Form 12: Community Land Dispute Resolution Form.
 *
 * This form records community land disputes and their resolution process,
 * including complainant and respondent details, witness information,
 * mediation/arbitration proceedings, and committee decisions under
 * Sections 38 & 39 of the Community Land Act 2016.
 *
 * @param input - Structured data conforming to {@link CLA12Input}
 * @returns PDF document as a Uint8Array
 */
export function generateCLAForm12(input: CLA12Input): Uint8Array {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210
  const margin = 20

  // ── Header ──────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('REPUBLIC OF KENYA', W / 2, 22, { align: 'center' })
  doc.setFontSize(11)
  doc.text('COMMUNITY LAND ACT No. 27 OF 2016', W / 2, 30, { align: 'center' })
  doc.text('CLA FORM 12 — COMMUNITY LAND DISPUTE RESOLUTION FORM', W / 2, 38, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text('(Sections 38 & 39)', W / 2, 45, { align: 'center' })

  doc.setLineWidth(0.5)
  doc.line(margin, 49, W - margin, 49)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(`Dispute Ref.: ${input.disputeReferenceNumber}`, margin, 56)
  doc.text(`Date Filed: ${input.dateFiled}`, W - margin, 56, { align: 'right' })
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

  // ── Section A: Dispute Details ──────────────────────────────
  sectionHeader('PART A — DISPUTE DETAILS')
  field('Dispute Ref. No.:', input.disputeReferenceNumber)
  field('Date Filed:', input.dateFiled)
  field('Community Name:', input.communityName)
  field('County:', input.county)
  field('Land Reference:', input.landReference)
  field('Parcel Number:', input.parcelNumber)
  y += 2

  // ── Section B: Nature of Dispute ────────────────────────────
  sectionHeader('PART B — NATURE OF DISPUTE')
  const natureDisplay = input.natureOfDispute === 'other'
    ? `OTHER: ${input.otherNatureDescription ?? ''}`
    : input.natureOfDispute.toUpperCase()
  field('Nature of Dispute:', natureDisplay)
  field('Date Dispute Arose:', input.dateDisputeArose)
  y += 2

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.text('Description of Dispute:', margin, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  const descLines = doc.splitTextToSize(input.disputeDescription, W - margin * 2)
  descLines.forEach((line: string) => {
    if (y > 275) { doc.addPage(); y = 20 }
    doc.text(line, margin, y)
    y += 5
  })
  y += 4

  // ── Section C: Complainant ──────────────────────────────────
  sectionHeader('PART C — COMPLAINANT')
  field('Full Name:', input.complainant.name)
  field('ID Number:', input.complainant.idNumber)
  field('Address:', input.complainant.address)
  field('Phone:', input.complainant.phone ?? '')
  y += 2

  // ── Section D: Respondent ───────────────────────────────────
  sectionHeader('PART D — RESPONDENT')
  field('Full Name:', input.respondent.name)
  field('ID Number:', input.respondent.idNumber)
  field('Address:', input.respondent.address ?? '')
  y += 2

  // ── Section E: Previous Resolution Attempts ─────────────────
  sectionHeader('PART E — PREVIOUS RESOLUTION ATTEMPTS')
  if (input.previousResolutionAttempts) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    const attemptLines = doc.splitTextToSize(input.previousResolutionAttempts, W - margin * 2)
    attemptLines.forEach((line: string) => {
      if (y > 275) { doc.addPage(); y = 20 }
      doc.text(line, margin, y)
      y += 5
    })
  } else {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8.5)
    doc.text('No previous attempts at resolution.', margin, y)
    y += lineH
  }
  y += 4

  // ── Section F: Witnesses ────────────────────────────────────
  sectionHeader('PART F — WITNESSES')
  const witnessCols = [margin, margin + 60, margin + 120]
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text('Name', witnessCols[0], y)
  doc.text('ID Number', witnessCols[1], y)
  doc.text('Phone', witnessCols[2], y)
  doc.line(margin, y + 2, W - margin, y + 2)
  y += 6

  doc.setFont('helvetica', 'normal')
  if (input.witnesses.length === 0) {
    doc.text('No witnesses listed.', margin, y)
    y += lineH
  } else {
    input.witnesses.slice(0, 4).forEach((w) => {
      if (y > 275) { doc.addPage(); y = 20 }
      doc.text(w.name, witnessCols[0], y)
      doc.text(w.idNumber, witnessCols[1], y)
      doc.text(w.phone, witnessCols[2], y)
      doc.line(margin, y + 2, W - margin, y + 2)
      y += 6
    })
  }
  y += 4

  // ── Section G: Relief Sought ────────────────────────────────
  sectionHeader('PART G — RELIEF SOUGHT BY COMPLAINANT')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  const reliefLines = doc.splitTextToSize(input.reliefSought, W - margin * 2)
  reliefLines.forEach((line: string) => {
    if (y > 275) { doc.addPage(); y = 20 }
    doc.text(line, margin, y)
    y += 5
  })
  y += 4

  // ── Section H: Documents Attached ───────────────────────────
  if (input.documentsAttached) {
    sectionHeader('PART H — DOCUMENTS ATTACHED')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    const docLines = doc.splitTextToSize(input.documentsAttached, W - margin * 2)
    docLines.forEach((line: string) => {
      if (y > 275) { doc.addPage(); y = 20 }
      doc.text(line, margin, y)
      y += 5
    })
    y += 4
  }

  // ── Section I: Signatures ───────────────────────────────────
  sectionHeader('PART I — SIGNATURES')
  signatureBlock('1. Complainant:')
  signatureBlock('2. Community Assembly Representative:')
  if (input.mediator) {
    signatureBlock('3. Mediator / Arbitrator:')
  }

  // ── Section J: Dispute Resolution Committee ─────────────────
  if (input.disputeCommittee) {
    sectionHeader('PART J — DISPUTE RESOLUTION COMMITTEE')
    field('Hearing Date:', input.disputeCommittee.hearingDate)
    field('Decision Date:', input.disputeCommittee?.decisionDate ?? "—")
    field('Appealed:', input.disputeCommittee?.appealed ?? "—")
    if (input.disputeCommittee.appealReference) {
      field('Appeal Reference:', input.disputeCommittee.appealReference)
    }
    y += 2

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text('Committee Members Present:', margin, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    input.disputeCommittee.committeeMembersPresent.forEach((member) => {
      if (y > 275) { doc.addPage(); y = 20 }
      doc.text(`\u2022  ${member}`, margin + 5, y)
      y += 5
    })
    y += 4

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text('Decision Summary:', margin, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    const decisionLines = doc.splitTextToSize(input.disputeCommittee?.decisionSummary ?? "—", W - margin * 2)
    decisionLines.forEach((line: string) => {
      if (y > 275) { doc.addPage(); y = 20 }
      doc.text(line, margin, y)
      y += 5
    })
    y += 8

    // Committee chairperson signature
    signatureBlock('Committee Chairperson:')
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
