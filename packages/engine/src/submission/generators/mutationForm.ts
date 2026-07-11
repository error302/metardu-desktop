import jsPDF from 'jspdf'

export interface MutationFormInput {
  parentLRNumber: string
  parentParcelNumber: string
  parentAreaHa: number
  resultingParcels: Array<{
    parcelNumber: string
    areaHa: number
    owner?: string
  }>
  county: string
  division: string
  district: string
  locality: string
  registryMapSheet: string
  mutationType: 'subdivision' | 'amalgamation' | 'boundary_adjustment' | 'resurvey'
  reasonForMutation: string
  affectedBeacons: Array<{
    beaconId: string
    action: 'new' | 'disturbed' | 'adopted' | 'cancelled'
    easting: number
    northing: number
  }>
  surveyorName: string
  iskNumber: string
  firmName: string
  surveyDate: string
  referenceNumber: string
  mutationNumber?: string
}

export function generateMutationForm(input: MutationFormInput): Uint8Array {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210
  const margin = 20

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('SURVEY OF KENYA', W / 2, 20, { align: 'center' })
  doc.setFontSize(11)
  doc.text('SURVEY MUTATION FORM', W / 2, 28, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text('(Kenya Survey Regulations 1994)', W / 2, 35, { align: 'center' })

  doc.setLineWidth(0.5)
  doc.line(margin, 39, W - margin, 39)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(`Reference: ${input.referenceNumber}`, margin, 46)
  if (input.mutationNumber) {
    doc.text(`Mutation No.: ${input.mutationNumber}`, W - margin, 46, { align: 'right' })
  }

  let y = 54
  const lineH = 8

  function sectionHeader(title: string) {
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
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text(label, margin, y)
    doc.setFont('helvetica', 'normal')
    doc.text(value || '—', margin + labelWidth, y)
    doc.setLineWidth(0.1)
    doc.line(margin + labelWidth, y + 1, W - margin, y + 1)
    y += lineH
  }

  sectionHeader('PART A — PARENT PARCEL (BEFORE MUTATION)')
  field('LR Number:', input.parentLRNumber)
  field('Parcel Number:', input.parentParcelNumber)
  field('Area (Ha):', input.parentAreaHa.toFixed(4))
  field('Registry Map Sheet:', input.registryMapSheet)
  field('County:', input.county)
  field('Division:', input.division)
  field('District:', input.district)
  field('Mutation Type:', input.mutationType.replace(/_/g, ' ').toUpperCase())
  field('Reason:', input.reasonForMutation)
  y += 4

  sectionHeader('PART B — RESULTING PARCELS (AFTER MUTATION)')

  const colX = [margin, margin + 50, margin + 100, margin + 140]
  const tableHeaders = ['Parcel Number', 'Area (Ha)', 'Owner / Proprietor', 'Notes']
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  tableHeaders.forEach((h, i) => doc.text(h, colX[i], y))
  doc.setLineWidth(0.2)
  doc.line(margin, y + 2, W - margin, y + 2)
  y += 6

  doc.setFont('helvetica', 'normal')
  input.resultingParcels.forEach((parcel, i) => {
    doc.text(parcel.parcelNumber, colX[0], y)
    doc.text(parcel.areaHa.toFixed(4), colX[1], y)
    doc.text(parcel.owner ?? '—', colX[2], y)
    doc.line(margin, y + 2, W - margin, y + 2)
    y += lineH
  })

  const totalResultingHa = input.resultingParcels.reduce((s, p) => s + p.areaHa, 0)
  const areaDiffHa = Math.abs(totalResultingHa - input.parentAreaHa)
  y += 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.text(`Total Resulting Area: ${totalResultingHa.toFixed(4)} Ha`, margin, y)
  doc.text(`Parent Area: ${input.parentAreaHa.toFixed(4)} Ha`, margin + 80, y)
  doc.text(`Difference: ${areaDiffHa.toFixed(4)} Ha`, margin + 150, y)
  y += lineH + 2

  sectionHeader('PART C — AFFECTED BEACONS')

  if (input.affectedBeacons.length === 0) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8.5)
    doc.text('No beacon changes recorded.', margin, y)
    y += lineH
  } else {
    const bColX = [margin, margin + 25, margin + 60, margin + 95, margin + 135]
    const bHeaders = ['Beacon', 'Action', 'Easting (m)', 'Northing (m)', 'Remarks']
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    bHeaders.forEach((h, i) => doc.text(h, bColX[i], y))
    doc.line(margin, y + 2, W - margin, y + 2)
    y += 6

    doc.setFont('helvetica', 'normal')
    input.affectedBeacons.forEach(b => {
      doc.text(b.beaconId, bColX[0], y)
      doc.text(b.action.toUpperCase(), bColX[1], y)
      doc.text(b.easting.toFixed(3), bColX[2], y)
      doc.text(b.northing.toFixed(3), bColX[3], y)
      doc.line(margin, y + 2, W - margin, y + 2)
      y += lineH
    })
  }
  y += 4

  sectionHeader('PART D — SURVEYOR CERTIFICATION')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.text([
    `I, ${input.surveyorName} (ISK ${input.iskNumber}), Licensed Surveyor, hereby certify that`,
    'the mutation described in this form has been carried out in accordance with the',
    'Kenya Survey Regulations 1994 and the Survey Act Cap 299.',
  ], margin, y)
  y += 22

  doc.setFont('helvetica', 'bold')
  doc.text('Surveyor Signature:', margin, y)
  doc.line(margin + 42, y + 1, margin + 100, y + 1)
  doc.text('Date:', margin + 110, y)
  doc.line(margin + 122, y + 1, W - margin, y + 1)
  y += 14

  doc.text('Firm / Company:', margin, y)
  doc.setFont('helvetica', 'normal')
  doc.text(input.firmName, margin + 42, y)

  doc.setFont('helvetica', 'italic')
  doc.setFontSize(7.5)
  doc.setTextColor(100, 100, 100)
  doc.text('Generated by Metardu Survey Platform — Survey Act Cap 299 / Kenya Survey Regulations 1994', W / 2, 285, { align: 'center' })

  return doc.output('arraybuffer') as unknown as Uint8Array
}