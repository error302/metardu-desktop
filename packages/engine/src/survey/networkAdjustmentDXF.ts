import Drawing from 'dxf-writer'
import {
  initialiseSokDXFLayers,
  addStandardTitleBlock,
  DXF_LAYERS,
} from '@/lib/drawing/dxfLayers'
import type { AdjustedStation, Observation } from './networkAdjustment'

export function generateNetworkDXF(params: {
  adjustedStations: AdjustedStation[]
  observations: Observation[]
  projectData: Record<string, any>
  surveyorProfile: { fullName: string; registrationNumber: string; firmName: string }
}): string {
  const { adjustedStations, observations, projectData, surveyorProfile } = params
  const drawing = new Drawing()

  initialiseSokDXFLayers(drawing)

  addStandardTitleBlock(drawing, {
    drawingTitle: 'GPS CONTROL NETWORK DIAGRAM',
    lrNumber: projectData?.lr_number ?? 'N/A',
    county: projectData?.county ?? 'N/A',
    district: projectData?.district ?? 'N/A',
    locality: projectData?.locality ?? 'N/A',
    areaHa: 0,
    perimeterM: 0,
    surveyorName: surveyorProfile.fullName,
    registrationNumber: surveyorProfile.registrationNumber,
    firmName: surveyorProfile.firmName,
    date: new Date().toLocaleDateString('en-KE'),
    submissionRef: 'N/A',
    coordinateSystem: 'Arc 1960 / UTM Zone 37S (SRID: 21037)',
    scale: '1:5000',
    sheetNumber: '1 of 1',
    revision: 'R00',
  })

  const stationMap = new Map(adjustedStations.map(s => [s.id, s]))

  for (const obs of observations) {
    const from = stationMap.get(obs.from)
    const to = stationMap.get(obs.to)
    if (!from || !to) continue
    drawing.setActiveLayer(DXF_LAYERS.CONTROL.name)
    drawing.drawLine(from.easting, from.northing, to.easting, to.northing)
  }

  const symbolSize = 2
  for (const s of adjustedStations) {
    drawing.setActiveLayer(DXF_LAYERS.CONTROL.name)
    drawing.drawLine(s.easting, s.northing + symbolSize, s.easting - symbolSize, s.northing - symbolSize)
    drawing.drawLine(s.easting - symbolSize, s.northing - symbolSize, s.easting + symbolSize, s.northing - symbolSize)
    drawing.drawLine(s.easting + symbolSize, s.northing - symbolSize, s.easting, s.northing + symbolSize)

    drawing.setActiveLayer(DXF_LAYERS.NOTES_TXT.name)
    drawing.drawText(
      s.easting + symbolSize * 1.5,
      s.northing,
      symbolSize * 1.2,
      0,
      `${s.name} (${s.easting.toFixed(3)}E, ${s.northing.toFixed(3)}N)`
    )

    if (!s.isFixed && s.semiMajor > 0) {
drawing.setActiveLayer(DXF_LAYERS.NOTES_TXT.name)
      drawing.drawCircle(s.easting, s.northing, s.semiMajor * 1000)
    }
  }

  return drawing.toDxfString()
}