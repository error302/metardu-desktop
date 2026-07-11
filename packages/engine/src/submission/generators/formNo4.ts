import Drawing from 'dxf-writer'
import type { SubmissionPackage } from '../types'
import {
  initialiseSokDXFLayers,
  DXF_LAYERS,
  formatPlanDate,
  formatBearingDMS,
  formatDistanceM
} from '@/lib/drawing/dxfLayers'

export { formatPlanDate, formatBearingDMS, formatDistanceM }

export function generateFormNo4DXF(pkg: SubmissionPackage): string {
  const drawing = new Drawing()

  initialiseSokDXFLayers(drawing)

  const points = pkg.traverse.points
  if (points.length < 3) {
    return drawing.toDxfString()
  }

  const adjustedAreaHa = pkg.traverse.areaM2 / 10000
  const { extentWidth, extentHeight, centroid } = computeExtentAndCentroid(points)

  drawing.setActiveLayer(DXF_LAYERS.PARCEL_BDY.name)
  for (let i = 0; i < points.length; i++) {
    const from = points[i]
    const to = points[(i + 1) % points.length]
    drawing.drawLine(
      from.adjustedEasting,
      from.adjustedNorthing,
      to.adjustedEasting,
      to.adjustedNorthing
    )
  }

  const symbolSize = 2.5
  drawing.setActiveLayer(DXF_LAYERS.BEACONS.name)
  points.forEach(pt => {
    drawBeacon(drawing, pt.adjustedEasting, pt.adjustedNorthing, symbolSize)
  })

  drawing.setActiveLayer(DXF_LAYERS.BEACON_TXT.name)
  points.forEach(pt => {
    drawBeaconLabel(drawing, pt.adjustedEasting, pt.adjustedNorthing, pt.pointName, symbolSize)
  })

  for (let i = 0; i < points.length; i++) {
    const from = points[i]
    const to = points[(i + 1) % points.length]
    const bearing = computeBearing(from.adjustedEasting, from.adjustedNorthing, to.adjustedEasting, to.adjustedNorthing)
    const distance = computeDistance(from.adjustedEasting, from.adjustedNorthing, to.adjustedEasting, to.adjustedNorthing)
    drawLegAnnotation(drawing, from.adjustedEasting, from.adjustedNorthing, to.adjustedEasting, to.adjustedNorthing, bearing, distance)
  }

  drawAreaAnnotation(drawing, centroid.x, centroid.y, adjustedAreaHa)

  const scale = computePlanScale(extentWidth, extentHeight)
  drawTitleBlock(drawing, pkg, adjustedAreaHa, scale)

  drawing.setActiveLayer(DXF_LAYERS.SCL_BAR.name)
  drawScaleBar(drawing, extentWidth + 50, -30, scale)

  drawing.setActiveLayer(DXF_LAYERS.NORTH_ARR.name)
  drawNorthArrow(drawing, extentWidth + 50, 0)

  return drawing.toDxfString()
}

function computeExtentAndCentroid(points: SubmissionPackage['traverse']['points']) {
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity
  let sumE = 0, sumN = 0
  points.forEach(p => {
    minE = Math.min(minE, p.adjustedEasting)
    maxE = Math.max(maxE, p.adjustedEasting)
    minN = Math.min(minN, p.adjustedNorthing)
    maxN = Math.max(maxN, p.adjustedNorthing)
    sumE += p.adjustedEasting
    sumN += p.adjustedNorthing
  })
  return {
    extentWidth: maxE - minE,
    extentHeight: maxN - minN,
    centroid: { x: sumE / points.length, y: sumN / points.length },
    originX: minE - 30,
    originY: minN - 30
  }
}

function drawBeacon(drawing: Drawing, x: number, y: number, symbolSizeM: number = 2.5): void {
  const r = symbolSizeM * 0.4
  const arm = symbolSizeM * 0.8
  drawing.drawCircle(x, y, r)
  drawing.drawLine(x - arm, y, x + arm, y)
  drawing.drawLine(x, y - arm, x, y + arm)
}

function drawBeaconLabel(drawing: Drawing, x: number, y: number, label: string, symbolSizeM: number = 2.5): void {
  drawing.drawText(
    x + symbolSizeM * 0.6,
    y + symbolSizeM * 0.6,
    symbolSizeM * 0.5,
    0,
    label
  )
}

function computeBearing(x1: number, y1: number, x2: number, y2: number): number {
  const dE = x2 - x1
  const dN = y2 - y1
  let bearing = Math.atan2(dE, dN) * (180 / Math.PI)
  if (bearing < 0) bearing += 360
  return bearing
}

function computeDistance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
}

function drawLegAnnotation(drawing: Drawing, x1: number, y1: number, x2: number, y2: number, bearing: number, distance: number): void {
  const midX = (x1 + x2) / 2
  const midY = (y1 + y2) / 2
  const textHeight = 2.0

  drawing.setActiveLayer(DXF_LAYERS.BEARINGS.name)
  drawing.drawText(midX, midY + textHeight * 1.5, textHeight, 0, formatBearingDMS(bearing))

  drawing.setActiveLayer(DXF_LAYERS.DISTANCES.name)
  drawing.drawText(midX, midY, textHeight, 0, formatDistanceM(distance) + 'm')
}

function drawAreaAnnotation(drawing: Drawing, centroidX: number, centroidY: number, areaHa: number, textHeightM: number = 3.0): void {
  drawing.setActiveLayer(DXF_LAYERS.AREA_TXT.name)
  drawing.drawText(centroidX, centroidY, textHeightM, 0, `Area = ${areaHa.toFixed(4)} Ha`)
}

function computePlanScale(extentWidthM: number, extentHeightM: number, sheetWidthMM = 420, sheetHeightMM = 297): number {
  const STANDARD_SCALES = [500, 1000, 2500, 5000, 10000, 25000]
  const marginFactor = 0.75
  const usableWidthM = (sheetWidthMM * marginFactor) / 1000
  const usableHeightM = (sheetHeightMM * marginFactor) / 1000

  for (const scale of STANDARD_SCALES) {
    const drawingWidthM = extentWidthM / scale
    const drawingHeightM = extentHeightM / scale
    if (drawingWidthM <= usableWidthM && drawingHeightM <= usableHeightM) {
      return scale
    }
  }
  return 25000
}

function drawTitleBlock(drawing: Drawing, pkg: SubmissionPackage, areaHa: number, scaleDenominator: number): void {
  drawing.setActiveLayer(DXF_LAYERS.TITLE_BLK.name)

  const originX = 0
  const originY = -100
  const titleBlockHeight = 30

  const rows: [number, string][] = [
    [0, 'REPUBLIC OF KENYA'],
    [-3, 'SURVEY OF KENYA'],
    [-7, 'FORM NO. 4 — SURVEY PLAN'],
    [-13, `LR No: ${pkg.parcel.lrNumber}`],
    [-17, `Parcel No: ${pkg.parcel.parcelNumber || pkg.parcel.lrNumber}`],
    [-21, `County: ${pkg.parcel.county}`],
    [-25, `Division: ${pkg.parcel.division || '-'}`],
    [-29, `District: ${pkg.parcel.district}`],
    [-33, `Location: ${pkg.parcel.locality}`],
    [-39, `Area: ${areaHa.toFixed(4)} Ha`],
    [-43, `Perimeter: ${pkg.traverse.perimeterM.toFixed(3)} m`],
    [-49, `Surveyor: ${pkg.surveyor.fullName}`],
    [-53, `ISK No: ${pkg.surveyor.iskNumber || pkg.surveyor.registrationNumber}`],
    [-57, `Firm: ${pkg.surveyor.firmName}`],
    [-63, `Survey Date: ${formatPlanDate(pkg.generatedAt)}`],
    [-67, `Scale: 1:${scaleDenominator}`],
    [-71, `Coord: Arc 1960 / UTM Zone 37S (SRID: 21037)`],
    [-75, `Ref: ${pkg.submissionRef}`],
    [-79, `Sheet: 1 of 1  Rev: R${String(pkg.revision).padStart(2, '0')}`],
  ]

  rows.forEach(([yOffset, text]) => {
    drawing.drawText(originX + 2, originY + titleBlockHeight + yOffset, 1.5, 0, text)
  })
}

function drawScaleBar(drawing: Drawing, originX: number, originY: number, scaleDenominator: number): void {
  const segmentMetres = Math.round(scaleDenominator * 0.01 / 5) * 5
  const segmentLengthM = segmentMetres
  const totalSegments = 5
  const barHeight = segmentLengthM * 0.3

  drawing.drawLine(originX, originY, originX + totalSegments * segmentLengthM, originY)
  drawing.drawLine(originX, originY, originX, originY + barHeight)
  drawing.drawLine(originX + totalSegments * segmentLengthM, originY, originX + totalSegments * segmentLengthM, originY + barHeight)
  drawing.drawLine(originX, originY + barHeight, originX + totalSegments * segmentLengthM, originY + barHeight)

  for (let i = 0; i <= totalSegments; i++) {
    drawing.drawText(originX + i * segmentLengthM, originY - barHeight, barHeight * 0.8, 0, `${i * segmentMetres}m`)
  }

  drawing.drawText(originX, originY - barHeight * 2.5, barHeight * 0.8, 0, `Scale 1:${scaleDenominator}`)
}

function drawNorthArrow(drawing: Drawing, centreX: number, centreY: number, heightM: number = 20): void {
  const shaft = heightM * 0.7
  const headHeight = heightM * 0.3
  const headWidth = heightM * 0.15

  drawing.drawLine(centreX, centreY, centreX, centreY + shaft)
  drawing.drawLine(centreX, centreY + shaft, centreX - headWidth, centreY + shaft - headHeight)
  drawing.drawLine(centreX, centreY + shaft, centreX + headWidth, centreY + shaft - headHeight)
  drawing.drawLine(centreX - headWidth, centreY + shaft - headHeight, centreX + headWidth, centreY + shaft - headHeight)
  drawing.drawText(centreX - heightM * 0.1, centreY + shaft + heightM * 0.05, heightM * 0.15, 0, 'GN')
}
