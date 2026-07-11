import { jsPDF } from 'jspdf'
import type { SubmissionPackage } from '../types'
import { PlanGeometry, computePlanGeometry } from '@/lib/engine/planGeometry'
import { formatPlanDate, formatBearingDMS, formatDistanceM } from '@/lib/drawing/dxfLayers'

function stationsToAdjusted(pkg: SubmissionPackage) {
  return pkg.traverse.points.map((p) => ({
    pointName: p.pointName,
    originalEasting: p.easting,
    originalNorthing: p.northing,
    adjustedEasting: p.adjustedEasting,
    adjustedNorthing: p.adjustedNorthing
  }))
}

export function generateFormNo4PDF(pkg: SubmissionPackage): Buffer {
  const stations = stationsToAdjusted(pkg)
  const geometry = computePlanGeometry(stations)
  
  if (!geometry) {
    return Buffer.from('')
  }

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a3'
  })

  const pageWidth = 420
  const pageHeight = 297
  const margin = 10
  const titleBlockHeight = 65
  const planAreaWidth = pageWidth - margin * 2
  const planAreaHeight = pageHeight - margin * 2 - titleBlockHeight

  const scale = geometry.scale
  const ext = geometry.extent
  const padding = 10
  const drawableWidth = planAreaWidth - padding * 2
  const drawableHeight = planAreaHeight - padding * 2

  const plotWidth = ext.width
  const plotHeight = ext.height
  const scaleX = drawableWidth / plotWidth
  const scaleY = drawableHeight / plotHeight
  const plotScale = Math.min(scaleX, scaleY)

  const offsetX = margin + padding + (drawableWidth - plotWidth * plotScale) / 2
  const offsetY = margin + padding + (drawableHeight - plotHeight * plotScale) / 2

  function toPlotX(easting: number): number {
    return offsetX + (easting - ext.minEasting) * plotScale
  }

  function toPlotY(northing: number): number {
    return offsetY + (ext.maxNorthing - northing) * plotScale
  }

  doc.setLineWidth(0.3)
  doc.setDrawColor(0)

  for (let i = 0; i < geometry.edges.length; i++) {
    const edge = geometry.edges[i]
    const x1 = toPlotX(edge.from.adjustedEasting)
    const y1 = toPlotY(edge.from.adjustedNorthing)
    const x2 = toPlotX(edge.to.adjustedEasting)
    const y2 = toPlotY(edge.to.adjustedNorthing)
    doc.line(x1, y1, x2, y2)
  }

  doc.setFontSize(8)
  doc.setTextColor(0)
  for (const station of geometry.stations) {
    const x = toPlotX(station.adjustedEasting)
    const y = toPlotY(station.adjustedNorthing)
    doc.circle(x, y, 1.5, 'S')
    doc.text(station.pointName, x + 2, y - 1)
  }

  doc.setFontSize(6)
  doc.setTextColor(100)
  for (let i = 0; i < geometry.edges.length; i++) {
    const edge = geometry.edges[i]
    const x1 = toPlotX(edge.from.adjustedEasting)
    const y1 = toPlotY(edge.from.adjustedNorthing)
    const x2 = toPlotX(edge.to.adjustedEasting)
    const y2 = toPlotY(edge.to.adjustedNorthing)
    const midX = (x1 + x2) / 2
    const midY = (y1 + y2) / 2
    const bearText = formatBearingDMS(edge.bearing)
    const distText = formatDistanceM(edge.distance) + 'm'
    doc.text(bearText, midX - 5, midY - 2)
    doc.text(distText, midX - 5, midY + 2)
  }

  doc.setFontSize(10)
  doc.setTextColor(0)
  const areaText = `Area = ${geometry.areaHa.toFixed(4)} Ha`
  const centroidPlotX = toPlotX(geometry.centroid.easting)
  const centroidPlotY = toPlotY(geometry.centroid.northing)
  doc.text(areaText, centroidPlotX, centroidPlotY)

  const titleBlockY = pageHeight - margin - titleBlockHeight + 5

  doc.setFontSize(8)
  doc.text('REPUBLIC OF KENYA', margin, titleBlockY + 4)
  doc.text('SURVEY OF KENYA', margin, titleBlockY + 9)
  doc.text('FORM NO. 4 — SURVEY PLAN', margin, titleBlockY + 14)

  doc.setFontSize(7)
  doc.text(`LR No: ${pkg.parcel.lrNumber}`, margin, titleBlockY + 21)
  doc.text(`Parcel No: ${pkg.parcel.parcelNumber || pkg.parcel.lrNumber}`, margin, titleBlockY + 26)
  doc.text(`County: ${pkg.parcel.county}`, margin, titleBlockY + 31)
  doc.text(`Division: ${pkg.parcel.division || '-'}`, margin, titleBlockY + 36)
  doc.text(`District: ${pkg.parcel.district}`, margin, titleBlockY + 41)
  doc.text(`Locality: ${pkg.parcel.locality}`, margin, titleBlockY + 46)
  if (pkg.parcel.clientName) {
    doc.text(`Client: ${pkg.parcel.clientName}`, margin, titleBlockY + 51)
  }

  const col2X = margin + 60
  doc.text(`Area: ${geometry.areaHa.toFixed(4)} Ha`, col2X, titleBlockY + 21)
  doc.text(`Perimeter: ${geometry.perimeterM.toFixed(3)} m`, col2X, titleBlockY + 26)
  doc.text(`Surveyor: ${pkg.surveyor.fullName}`, col2X, titleBlockY + 31)
  doc.text(`ISK No: ${pkg.surveyor.iskNumber || pkg.surveyor.registrationNumber}`, col2X, titleBlockY + 36)
  doc.text(`Firm: ${pkg.surveyor.firmName}`, col2X, titleBlockY + 41)
  doc.text(`Survey Date: ${formatPlanDate(pkg.generatedAt)}`, col2X, titleBlockY + 46)
  
  if (pkg.surveyor.verifiedIsk) {
    doc.setFontSize(7)
    doc.setTextColor(34, 139, 34)
    doc.text(' ISK VERIFIED', col2X + 45, titleBlockY + 36)
    doc.setTextColor(0)
  }

  const col3X = margin + 120
  doc.text(`Scale: 1:${scale}`, col3X, titleBlockY + 21)
  doc.text(`Coord: Arc 1960 / UTM Zone 37S (SRID: 21037)`, col3X, titleBlockY + 26)
  doc.text(`Ref: ${pkg.submissionRef}`, col3X, titleBlockY + 31)
  doc.text(`Sheet: 1 of 1  Rev: R${String(pkg.revision).padStart(2, '0')}`, col3X, titleBlockY + 36)

  doc.line(margin, titleBlockY + 50, pageWidth - margin, titleBlockY + 50)

  doc.setFontSize(6)
  doc.text('GN', pageWidth - margin - 10, margin + 10)
  doc.line(pageWidth - margin - 8, margin + 5, pageWidth - margin - 8, margin + 20)
  doc.line(pageWidth - margin - 12, margin + 8, pageWidth - margin - 8, margin + 5)
  doc.line(pageWidth - margin - 4, margin + 8, pageWidth - margin - 8, margin + 5)

  const scaleBarLength = 50
  const scaleBarX = pageWidth - margin - scaleBarLength - 5
  const scaleBarY = margin + 25
  doc.line(scaleBarX, scaleBarY, scaleBarX + scaleBarLength, scaleBarY)
  doc.line(scaleBarX, scaleBarY - 2, scaleBarX, scaleBarY + 2)
  doc.line(scaleBarX + scaleBarLength, scaleBarY - 2, scaleBarX + scaleBarLength, scaleBarY + 2)
  doc.setFontSize(5)
  doc.text(`Scale 1:${scale}`, scaleBarX, scaleBarY - 4)

  const pdfBuffer = doc.output('arraybuffer') as ArrayBuffer
  return Buffer.from(pdfBuffer)
}