// ============================================================
// METARDU — CLA Form 3: Community Land Rights Allocation Record
// Community Land Act No. 27 of 2016, Section 16
// ============================================================

import jsPDF from 'jspdf'

/** Single allocation entry within the allocation record */
export interface AllocationEntry {
  /** Allottee full name */
  allotteeName: string
  /** Allottee national ID or PIN number */
  allotteeId: string
  /** Type of interest allocated */
  interestType: 'lease' | 'license' | 'customary_right'
  /** Area allocated in hectares */
  areaHa: number
  /** Term of the lease in years (if applicable) */
  termYears?: number
  /** Commencement date of the interest */
  commencementDate: string
  /** Annual rent in KES (if applicable) */
  annualRentKes?: number
  /** One-time premium in KES (if applicable) */
  premiumKes?: number
  /** Special conditions attached to the allocation */
  specialConditions?: string
}

/**
 * Input interface for CLA Form 3 — Community Land Rights Allocation Record.
 * Supports multiple allocation entries per form, as required under Section 16.
 */
export interface CLA3Input {
  /** Allocation reference number */
  allocationReference: string
  /** Date of the allocation record */
  date: string
  /** Registered name of the community */
  communityName: string
  /** County */
  county: string
  /** Land reference number */
  landReference: string
  /** Parcel number */
  parcelNumber: string
  /** Community Assembly resolution reference authorizing these allocations */
  assemblyResolutionRef: string
  /** County approval reference */
  countyApprovalRef?: string
  /** Array of individual allocation entries */
  allocations: AllocationEntry[]
  /** Surveyor certification details */
  surveyor: {
    name: string
    iskNumber: string
    firmName?: string
  }
  /** Status of the allocation record */
  status?: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'
}

/**
 * Generates CLA Form 3: Community Land Rights Allocation Record.
 *
 * Records the allocation of community land rights to individuals or entities,
 * including lease, license, and customary rights, under Section 16 of the
 * Community Land Act 2016. Supports multiple allocation entries per record.
 *
 * @param input - Structured data conforming to {@link CLA3Input}
 * @returns PDF document as a Uint8Array
 */
export function generateCLAForm3(input: CLA3Input): Uint8Array {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210
  const margin = 20

  // ── Header ──────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('REPUBLIC OF KENYA', W / 2, 22, { align: 'center' })
  doc.setFontSize(11)
  doc.text('COMMUNITY LAND ACT No. 27 OF 2016', W / 2, 30, { align: 'center' })
  doc.text('CLA FORM 3 — COMMUNITY LAND RIGHTS ALLOCATION RECORD', W / 2, 38, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text('(Section 16)', W / 2, 45, { align: 'center' })

  doc.setLineWidth(0.5)
  doc.line(margin, 49, W - margin, 49)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(`Allocation Ref.: ${input.allocationReference}`, margin, 56)
  doc.text(`Date: ${input.date}`, W - margin, 56, { align: 'right' })
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

  // ── Section A: Record Details ───────────────────────────────
  sectionHeader('PART A — ALLOCATION RECORD DETAILS')
  field('Allocation Ref. No.:', input.allocationReference)
  field('Date:', input.date)
  field('Community Name:', input.communityName)
  field('County:', input.county)
  field('Land Reference:', input.landReference)
  field('Parcel Number:', input.parcelNumber)
  field('Assembly Resolution Ref.:', input.assemblyResolutionRef)
  field('County Approval Ref.:', input.countyApprovalRef ?? '')
  y += 2

  // ── Section B: Table of Allocations ─────────────────────────
  sectionHeader('PART B — TABLE OF ALLOCATIONS')

  // Table headers
  const cols = [margin, margin + 38, margin + 72, margin + 100, margin + 120, margin + 142, margin + 164]
  const headers = ['Allottee Name', 'ID Number', 'Interest', 'Area (Ha)', 'Term (Yr)', 'Rent (KES)', 'Start Date']
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  headers.forEach((h, i) => doc.text(h, cols[i], y))
  doc.setLineWidth(0.2)
  doc.line(margin, y + 2, W - margin, y + 2)
  y += 6

  // Table rows
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  input.allocations.forEach((entry) => {
    if (y > 270) {
      doc.addPage()
      y = 20
      // Reprint headers on new page
      doc.setFont('helvetica', 'bold')
      headers.forEach((h, i) => doc.text(h, cols[i], y))
      doc.line(margin, y + 2, W - margin, y + 2)
      y += 6
      doc.setFont('helvetica', 'normal')
    }

    const nameLines = doc.splitTextToSize(entry.allotteeName, 34)
    doc.text(nameLines[0], cols[0], y)
    doc.text(entry.allotteeId, cols[1], y)
    doc.text(entry.interestType.replace(/_/g, ' ').toUpperCase(), cols[2], y)
    doc.text(entry.areaHa.toFixed(2), cols[3], y)
    doc.text(entry.termYears?.toString() ?? '\u2014', cols[4], y)
    doc.text(entry.annualRentKes ? entry.annualRentKes.toLocaleString() : '\u2014', cols[5], y)
    doc.text(entry.commencementDate, cols[6], y)
    doc.line(margin, y + 2, W - margin, y + 2)

    // Special conditions on sub-row
    if (entry.specialConditions) {
      y += 5
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(7)
      doc.text(`Conditions: ${entry.specialConditions}`, cols[0], y)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
    }
    y += 6
  })

  // Summary row
  if (input.allocations.length > 0) {
    const totalArea = input.allocations.reduce((sum, a) => sum + a.areaHa, 0)
    y += 2
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text(`Total Allocations: ${input.allocations.length}`, margin, y)
    doc.text(`Total Area: ${totalArea.toFixed(2)} Ha`, margin + 70, y)
    y += lineH
  }
  y += 4

  // ── Section C: Surveyor Certification ───────────────────────
  sectionHeader('PART C — SURVEYOR CERTIFICATION')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.text(
    `I, ${input.surveyor.name} (ISK ${input.surveyor.iskNumber}), Licensed Surveyor of ${input.surveyor.firmName ?? 'N/A'},`,
    margin, y
  )
  y += 5
  doc.text(
    'hereby certify that the land described in this allocation record has been surveyed and',
    margin, y
  )
  y += 5
  doc.text(
    'demarcated in accordance with the Survey Act (Cap 299) and the Community Land Act 2016.',
    margin, y
  )
  y += 5
  doc.text(
    'The boundaries and areas stated herein accurately reflect the survey on the ground.',
    margin, y
  )
  y += 10

  field('Surveyor Name:', input.surveyor.name)
  field('ISK Number:', input.surveyor.iskNumber)
  field('Firm / Company:', input.surveyor.firmName ?? '')
  y += 4

  // ── Signature Blocks ────────────────────────────────────────
  sectionHeader('PART D — SIGNATURES')
  signatureBlock('1. Community Assembly Chairman (Seal):')
  signatureBlock('2. Licensed Surveyor:')
  signatureBlock('3. County Director of Land:')

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
