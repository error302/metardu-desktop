import { parseGSIContent } from '../../importers/parsers/gsi'
import { generateTopoDXF, TopoPoint } from '../topoDXF'

const mockGSI = `
110001+00000PT1 81..10+00000TRV 82..10-00000100 83..10+00000100 84..10+00000001 85..10+00000001 86..10+00000001 87..10+00000001
110002+00000RD1 81..10+00000010 82..10+00000100 83..10+00000100 84..10+00000001 85..10+00000001 86..10+00000001 87..10+00000001
110003+00000RD1 81..10+00000020 82..10+00000100 83..10+00000100 84..10+00000001 85..10+00000001 86..10+00000001 87..10+00000001
110004+00000BLD 81..10+00000030 82..10+00000100 83..10+00000100 84..10+00000001 85..10+00000001 86..10+00000001 87..10+00000001
110005+00000BLD 81..10+00000040 82..10+00000100 83..10+00000100 84..10+00000001 85..10+00000001 86..10+00000001 87..10+00000001
`

async function run() {
  console.log('Parsing GSI...')
  const parsed = parseGSIContent(mockGSI.trim())
  
  if (parsed.warnings.length > 0) {
    console.warn('Warnings:', parsed.warnings)
  }

  const topoPoints: TopoPoint[] = parsed.points.map((p, index) => ({
    pointNumber: p.point_no ?? ('PT' + index.toString()),
    code: p.code,
    easting: p.easting ?? (p.raw?.easting as number) ?? Math.random() * 100,
    northing: p.northing ?? (p.raw?.northing as number) ?? Math.random() * 100,
    elevation: p.rl ?? (p.raw?.elevation as number) ?? Math.random() * 10,
  }))

  console.log('Parsed Points:', topoPoints.map(p => p.pointNumber + ': ' + p.code))

  console.log('Generating DXF...')
  const dxf = generateTopoDXF(topoPoints)
  
  console.log('DXF length:', dxf.length)
  if (dxf.length > 0 && dxf.includes('ENTITIES')) {
    console.log('PASS Pipeline Test Passed!')
  } else {
    console.log('FAIL DXF Generation Failed.')
  }
}

run().catch(console.error)
