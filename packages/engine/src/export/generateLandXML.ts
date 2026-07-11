export interface LandXMLProject {
  name: string
  location?: string
  utm_zone: number
  hemisphere: string
}

export interface LandXMLPoint {
  name: string
  easting: number
  northing: number
  elevation?: number | null
  is_control: boolean
}

export function generateLandXML(
  project: LandXMLProject,
  points: LandXMLPoint[]
): string {
  const date = new Date().toISOString()
  
  const cgPoints = points.map((p: any) => `
    <CgPoint name="${escapeXml(p.name)}" 
      pntRef="${escapeXml(p.name)}"
      featureCode="${p.is_control ? 'CTRL' : 'SURV'}">
      ${p.northing.toFixed(4)} ${p.easting.toFixed(4)} ${(p.elevation || 0).toFixed(4)}
    </CgPoint>`).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2"
  version="1.2" date="${date.slice(0,10)}" time="${date.slice(11,19)}"
  language="English" readOnly="false"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.landxml.org/schema/LandXML-1.2 http://www.landxml.org/schema/LandXML-1.2/LandXML-1.2.xsd">
  <Header>
    <Creator>METARDU - Professional Surveying Platform</Creator>
    <Created>${date.slice(0,19)}</Created>
    <Name>${escapeXml(project.name)}</Name>
  </Header>
  <Project name="${escapeXml(project.name)}">
    <Description>${escapeXml(project.location || '')}</Description>
  </Project>
  <CoordinateSystem>
    <Datum name="WGS84">
      <Ellipsoid name="WGS84" a="6378137.0" invF="298.257223563"/>
    </Datum>
    <Projection name="UTM Zone ${project.utm_zone}${project.hemisphere}" 
      type="TransverseMercator" 
      zone="${project.utm_zone}"
      hemisphere="${project.hemisphere}"
      originLat="0"
      originLong="${project.utm_zone * 6 - 183}"
      scaleFactor="0.9996"
      falseEasting="500000"
      falseNorthing="${project.hemisphere === 'S' ? '10000000' : '0'}"/>
  </CoordinateSystem>
  <CgPoints>
    ${cgPoints}
  </CgPoints>
  <Survey>
    <SurveyHeader name="${escapeXml(project.name)}" 
      date="${date.slice(0,10)}"
      startDate="${date.slice(0,10)}"
      endDate="${date.slice(0,10)}"
      surveyor="METARDU User"
      surveyType="Topographic"/>
  </Survey>
</LandXML>`
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function downloadLandXML(
  project: LandXMLProject,
  points: LandXMLPoint[]
): void {
  const xml = generateLandXML(project, points)
  const blob = new Blob([xml], { type: 'application/xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${project.name.replace(/\s+/g, '_')}_export.xml`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
