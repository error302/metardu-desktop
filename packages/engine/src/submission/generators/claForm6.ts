// ============================================================
// METARDU — CLA Form 6: Community Assembly Resolution Record
// Community Land Act No. 27 of 2016, Section 6
// ============================================================

import jsPDF from 'jspdf'

/**
 * Input interface for CLA Form 6 — Community Assembly Resolution Record.
 * Captures the proceedings and outcomes of a community assembly meeting
 * as required under Section 6 of the Community Land Act 2016.
 */
export interface CLA6Input {
  /** Registered name of the community */
  communityName: string
  /** County */
  county: string
  /** Sub-county */
  subCounty: string
  /** Ward */
  ward: string
  /** Date of the assembly meeting (DD/MM/YYYY) */
  meetingDate: string
  /** Venue of the meeting */
  venue: string
  /** Time the meeting was convened (HH:MM) */
  timeConvened: string
  /** Time the meeting was adjourned (HH:MM) */
  timeAdjourned: string
  /** Type of assembly meeting */
  meetingType: 'ordinary' | 'special'
  /** Number of members present (quorum) */
  membersPresent: number
  /** Total number of registered community members */
  totalRegisteredMembers: number
  /** Short title of the resolution */
  resolutionTitle: string
  /** Full text of the resolution */
  resolutionText: string
  /** Voting record */
  voting: {
    votesFor: number
    votesAgainst: number
    abstentions: number
  }
  /** Outcome of the resolution */
  resolutionStatus: 'carried' | 'deferred' | 'withdrawn'
  /** Assembly chairman details */
  chairman: {
    name: string
    idNumber: string
  }
  /** Assembly secretary details */
  secretary: {
    name: string
    idNumber: string
  }
  /** Counting officer details */
  countingOfficer?: {
    name: string
    idNumber: string
  }
  /** Authorized observer (county representative) */
  authorizedObserver?: {
    name: string
    designation: string
    idNumber?: string
  }
  /** Resolution reference number */
  resolutionReferenceNumber: string
  /** Any additional remarks */
  remarks?: string
}

/**
 * Generates CLA Form 6: Community Assembly Resolution Record.
 *
 * This form provides an official record of community assembly proceedings
 * and resolutions, documenting the meeting details, quorum, resolution text,
 * voting record, and required signatures under Section 6 of the Community
 * Land Act 2016.
 *
 * @param input - Structured data conforming to {@link CLA6Input}
 * @returns PDF document as a Uint8Array
 */
export function generateCLAForm6(input: CLA6Input): Uint8Array {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210
  const margin = 20

  // ── Header ──────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('REPUBLIC OF KENYA', W / 2, 22, { align: 'center' })
  doc.setFontSize(11)
  doc.text('COMMUNITY LAND ACT No. 27 OF 2016', W / 2, 30, { align: 'center' })
  doc.text('CLA FORM 6 — COMMUNITY ASSEMBLY RESOLUTION RECORD', W / 2, 38, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text('(Section 6)', W / 2, 45, { align: 'center' })

  doc.setLineWidth(0.5)
  doc.line(margin, 49, W - margin, 49)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(`Resolution Ref.: ${input.resolutionReferenceNumber}`, margin, 56)
  doc.text(`Date: ${input.meetingDate}`, W - margin, 56, { align: 'right' })

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

  // ── Section A: Meeting Details ──────────────────────────────
  sectionHeader('PART A — MEETING DETAILS')
  field('Community Name:', input.communityName)
  field('County:', input.county)
  field('Sub-county:', input.subCounty)
  field('Ward:', input.ward)
  field('Meeting Date:', input.meetingDate)
  field('Venue:', input.venue)
  field('Meeting Type:', input.meetingType === 'ordinary' ? 'ORDINARY' : 'SPECIAL')
  field('Time Convened:', input.timeConvened)
  field('Time Adjourned:', input.timeAdjourned)
  y += 2

  // ── Section B: Attendance ───────────────────────────────────
  sectionHeader('PART B — ATTENDANCE AND QUORUM')
  field('Members Present:', input.membersPresent.toString())
  field('Total Registered Members:', input.totalRegisteredMembers.toString())

  // Quorum calculation
  const quorumRequired = Math.ceil(input.totalRegisteredMembers * 0.5)
  const quorumMet = input.membersPresent >= quorumRequired
  y += 2
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.text(`Quorum Required (50%): ${quorumRequired}`, margin, y)
  doc.text(`Quorum Status: `, margin + 70, y)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(quorumMet ? 0 : 200, quorumMet ? 128 : 0, 0)
  doc.text(quorumMet ? 'SATISFIED' : 'NOT SATISFIED', margin + 105, y)
  doc.setTextColor(0, 0, 0)
  y += lineH + 2

  // ── Section C: Resolution Details ───────────────────────────
  sectionHeader('PART C — RESOLUTION DETAILS')
  field('Resolution Title:', input.resolutionTitle)
  y += 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.text('Resolution Text (Full):', margin, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  const resLines = doc.splitTextToSize(input.resolutionText, W - margin * 2)
  resLines.forEach((line: string) => {
    if (y > 275) { doc.addPage(); y = 20 }
    doc.text(line, margin, y)
    y += 5
  })
  y += 4

  // ── Section D: Voting Record ────────────────────────────────
  sectionHeader('PART D — VOTING RECORD')
  const vFor = input.voting?.votesFor ?? 0; const vAg = input.voting?.votesAgainst ?? 0; const vAb = input.voting?.abstentions ?? 0; const totalVotes = vFor + vAg + vAb
  field('Votes FOR:', `${vFor}`)
  field('Votes AGAINST:', `${vAg}`)
  field('Abstentions:', `${vAb}`)
  field('Total Votes Cast:', `${totalVotes}`)

  // Result highlight
  y += 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  const statusColor = input.resolutionStatus === 'carried' ? [0, 128, 0] as [number, number, number]
    : input.resolutionStatus === 'deferred' ? [200, 150, 0] as [number, number, number]
    : [200, 0, 0] as [number, number, number]
  doc.setTextColor(...statusColor)
  doc.text(`Resolution Status: ${input.resolutionStatus.toUpperCase()}`, margin, y)
  doc.setTextColor(0, 0, 0)
  y += lineH + 2

  // ── Section E: Remarks ──────────────────────────────────────
  if (input.remarks) {
    sectionHeader('PART E — REMARKS')
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

  // ── Signature Blocks ────────────────────────────────────────
  sectionHeader('PART F — SIGNATURES')
  signatureBlock('1. Assembly Chairman:')
  signatureBlock('2. Assembly Secretary:')
  if (input.countingOfficer) {
    signatureBlock('3. Counting Officer:')
  }
  if (input.authorizedObserver) {
    signatureBlock('4. Authorized Observer (County Representative):')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(`   Name: ${input.authorizedObserver?.name ?? ""}`, margin, y)
    y += 5
    doc.text(`   Designation: ${input.authorizedObserver?.designation ?? ""}`, margin, y)
    if (input.authorizedObserver?.idNumber ?? "") {
      y += 5
      doc.text(`   ID No: ${input.authorizedObserver?.idNumber ?? ""}`, margin, y)
    }
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
