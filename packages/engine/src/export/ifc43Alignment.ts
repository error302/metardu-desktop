/**
 * IFC 4.3 Alignment Export
 *
 * AUDIT FIX (2026-07-03): The existing IFC4 exporter generates survey/
 * cadastral entities (IfcSite, IfcBuilding). IFC 4.3 adds civil
 * infrastructure entities — IfcAlignment, IfcRoad, IfcBridge — that
 * enable data exchange with Bentley OpenRoads, Autodesk Civil 3D,
 * and Trimble Quadri.
 *
 * This exporter generates IFC 4.3 STEP files with:
 *   - IfcProject (root entity)
 *   - IfcSite (geographic context)
 *   - IfcRoad (the road being designed)
 *   - IfcAlignment (horizontal + vertical alignment)
 *     - IfcAlignmentHorizontal (station-based geometry)
 *     - IfcAlignmentVertical (profile with VIPs)
 *   - IfcGeometricCurveSet (3D alignment curve)
 *
 * References:
 *   - IFC 4.3 ADD2 specification (buildingSMART International, 2024)
 *   - IfcAlignment: https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/ lexical/Entities/IfcAlignment.htm
 */

import type { AlignmentPoint } from './machineControl'

export interface IFC43ExportOptions {
  projectName: string
  alignmentName: string
  horizontalPoints: AlignmentPoint[]
  verticalPoints: AlignmentPoint[]
  utmZone: number
  hemisphere: 'N' | 'S'
  surveyorName?: string
  surveyorLicense?: string
}

/**
 * Generate an IFC 4.3 STEP file with alignment entities.
 *
 * The STEP file format is a plain-text serialisation of the IFC schema.
 * Each entity has a line: #id = IFCTYPE(args)
 */
export function generateIFC43Alignment(opts: IFC43ExportOptions): string {
  const {
    projectName, alignmentName,
    horizontalPoints, verticalPoints,
    utmZone, hemisphere,
    surveyorName, surveyorLicense,
  } = opts

  const now = new Date().toISOString()
  const lines: string[] = []
  let nextId = 1
  const id = () => `#${nextId++}`

  // ─── STEP header ────────────────────────────────────────────────────────
  lines.push('ISO-10303-21;')
  lines.push('HEADER;')
  lines.push(`FILE_DESCRIPTION(('IFC 4.3 Alignment Export — METARDU','ViewDefinition [AlignmentExchange]'),'2;1');`)
  lines.push(`FILE_NAME('${projectName}_alignment.ifc','${now}',('${surveyorName || 'METARDU'}'),('METARDU'),('METARDU v1.0','IFC4x3_ADD2'),'METARDU','None');`)
  lines.push(`FILE_SCHEMA(('IFC4X3_ADD2'));`)
  lines.push('ENDSEC;')
  lines.push('DATA;')

  // ─── Units ──────────────────────────────────────────────────────────────
  const lengthUnit = id()
  lines.push(`${lengthUnit} = IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);`)
  const angleUnit = id()
  lines.push(`${angleUnit} = IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);`)
  const unitAssignment = id()
  lines.push(`${unitAssignment} = IFCUNITASSIGNMENT((${lengthUnit},${angleUnit}));`)

  // ─── Coordinate system ──────────────────────────────────────────────────
  // EPSG code for UTM zone
  const epsg = hemisphere === 'N' ? 32600 + utmZone : 32700 + utmZone
  const crs = id()
  lines.push(`${crs} = IFCCOORDINATESYSTEMREFERENCE('UTM Zone ${utmZone}${hemisphere}','EPSG','${epsg}',$);`)

  // ─── Owner history ──────────────────────────────────────────────────────
  const person = id()
  lines.push(`${person} = IFCPERSON($,'${surveyorName || 'METARDU'}','${surveyorName || ''}',$,($),($),($,$,$,$,${surveyorLicense ? `'${surveyorLicense}'` : '$'}));`)
  const org = id()
  lines.push(`${org} = IFCORGANIZATION($,'METARDU',$,$,$);`)
  const personOrg = id()
  lines.push(`${personOrg} = IFCPERSONANDORGANIZATION(${person},${org},$);`)
  const app = id()
  lines.push(`${app} = IFCAPPLICATION(${org},'1.0','METARDU','https://metardu.duckdns.org');`)
  const ownerHistory = id()
  lines.push(`${ownerHistory} = IFCOWNERHISTORY(${personOrg},${app},$,.ADDED.,$,'METARDU','METARDU',${now});`)

  // ─── Geometric representation context (3D model) ────────────────────────
  const worldCoords = id()
  lines.push(`${worldCoords} = IFCCARTESIANPOINT((0.,0.,0.));`)
  const worldAxis3D = id()
  lines.push(`${worldAxis3D} = IFCAXIS2PLACEMENT3D(${worldCoords},$,$);`)
  const context = id()
  lines.push(`${context} = IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,${worldAxis3D},${unitAssignment});`)

  // ─── Project ────────────────────────────────────────────────────────────
  const project = id()
  lines.push(`${project} = IFCPROJECT('${projectName}',$,'${projectName}',$,$,$,$,(${context}),${unitAssignment});`)

  // ─── Site ───────────────────────────────────────────────────────────────
  const sitePlacement = id()
  lines.push(`${sitePlacement} = IFCLOCALPLACEMENT($,${worldAxis3D});`)
  const site = id()
  lines.push(`${site} = IFCSITE(${id()},${ownerHistory},'${projectName} Site',$,$,${sitePlacement},$,$,.ELEMENT.,$,$,$,$,${crs});`)

  // ─── Road ───────────────────────────────────────────────────────────────
  const roadPlacement = id()
  lines.push(`${roadPlacement} = IFCLOCALPLACEMENT(${sitePlacement},${worldAxis3D});`)
  const road = id()
  lines.push(`${road} = IFCROAD(${id()},${ownerHistory},'${alignmentName}','Road alignment',$,$,${roadPlacement},$,$,'DESIGN','.ELEMENT.');`)

  // ─── Alignment ──────────────────────────────────────────────────────────
  // Build the 3D alignment curve as a polyline (IfcPolyline)
  const cartPoints: string[] = []
  for (const p of horizontalPoints) {
    const elev = interpolateElevation(p.chainage, verticalPoints)
    const cp = id()
    lines.push(`${cp} = IFCCARTESIANPOINT(($p.easting.toFixed(3)},${p.northing.toFixed(3)},${elev.toFixed(3)}));`)
    cartPoints.push(cp)
  }
  const polyline = id()
  lines.push(`${polyline} = IFCPOLYLINE((${cartPoints.join(',')}));`)

  // Geometric representation
  const shapeRep = id()
  lines.push(`${shapeRep} = IFCSHAPEREPRESENTATION(${context},'Body','Curve2D',(${polyline}));`)
  const productDef = id()
  lines.push(`${productDef} = IFCPRODUCTDEFINITIONSHAPE($,$,(${shapeRep}));`)

  // Alignment entity (IFC 4.3)
  const alignment = id()
  lines.push(`${alignment} = IFCALIGNMENT(${id()},${ownerHistory},'${alignmentName}','Road alignment',$,$,${roadPlacement},${productDef},$,$);`)

  // ─── Horizontal alignment ───────────────────────────────────────────────
  const horizPoints: string[] = []
  for (const p of horizontalPoints) {
    const cp = id()
    lines.push(`${cp} = IFCCARTESIANPOINT(($p.easting.toFixed(3)},${p.northing.toFixed(3)}));`)
    horizPoints.push(cp)
  }
  const horizPolyline = id()
  lines.push(`${horizPolyline} = IFCPOLYLINE((${horizPoints.join(',')}));`)
  const horizShapeRep = id()
  lines.push(`${horizShapeRep} = IFCSHAPEREPRESENTATION(${context},'Body','Curve2D',(${horizPolyline}));`)
  const horizProductDef = id()
  lines.push(`${horizProductDef} = IFCPRODUCTDEFINITIONSHAPE($,$,(${horizShapeRep}));`)

  const horizPlacement = id()
  lines.push(`${horizPlacement} = IFCLOCALPLACEMENT(${roadPlacement},${worldAxis3D});`)
  const horizAlignment = id()
  lines.push(`${horizAlignment} = IFCALIGNMENTHORIZONTAL(${id()},${ownerHistory},'${alignmentName}_Horizontal',$,$,${horizPlacement},${horizProductDef},$);`)

  // ─── Vertical alignment ─────────────────────────────────────────────────
  if (verticalPoints.length > 1) {
    const vertProfilePoints: string[] = []
    for (const p of verticalPoints) {
      const cp = id()
      // Vertical alignment uses (chainage, elevation) as 2D points
      lines.push(`${cp} = IFCCARTESIANPOINT(($p.chainage.toFixed(3)},${p.elevation.toFixed(3)}));`)
      vertProfilePoints.push(cp)
    }
    const vertPolyline = id()
    lines.push(`${vertPolyline} = IFCPOLYLINE((${vertProfilePoints.join(',')}));`)
    const vertShapeRep = id()
    lines.push(`${vertShapeRep} = IFCSHAPEREPRESENTATION(${context},'Body','Curve2D',(${vertPolyline}));`)
    const vertProductDef = id()
    lines.push(`${vertProductDef} = IFCPRODUCTDEFINITIONSHAPE($,$,(${vertShapeRep}));`)

    const vertPlacement = id()
    lines.push(`${vertPlacement} = IFCLOCALPLACEMENT(${roadPlacement},${worldAxis3D});`)
    const vertAlignment = id()
    lines.push(`${vertAlignment} = IFCALIGNMENTVERTICAL(${id()},${ownerHistory},'${alignmentName}_Vertical',$,$,${vertPlacement},${vertProductDef},$);`)

    // Relate vertical to alignment
    const relAligns = id()
    lines.push(`${relAligns} = IFCRELNESTS(${id()},${ownerHistory},'Alignment Components',$,${alignment},(${horizAlignment},${vertAlignment}));`)
  } else {
    const relAligns = id()
    lines.push(`${relAligns} = IFCRELNESTS(${id()},${ownerHistory},'Alignment Components',$,${alignment},(${horizAlignment}));`)
  }

  // ─── Spatial containment ────────────────────────────────────────────────
  const relContains1 = id()
  lines.push(`${relContains1} = IFCRELAGGREGATES(${id()},${ownerHistory},'Project to Site',$,${project},(${site}));`)
  const relContains2 = id()
  lines.push(`${relContains2} = IFCRELAGGREGATES(${id()},${ownerHistory},'Site to Road',$,${site},(${road}));`)
  const relContains3 = id()
  lines.push(`${relContains3} = IFCRELCONTAINEDINSPATIALSTRUCTURE(${id()},${ownerHistory},'Alignment in Road',$,(${alignment}),${road});`)

  // ─── Close ──────────────────────────────────────────────────────────────
  lines.push('ENDSEC;')
  lines.push('END-ISO-10303-21;')

  return lines.join('\n')
}

/**
 * Interpolate elevation at a given chainage from the vertical alignment points.
 */
function interpolateElevation(chainage: number, verticalPoints: AlignmentPoint[]): number {
  if (verticalPoints.length === 0) return 0
  if (verticalPoints.length === 1) return verticalPoints[0].elevation

  if (chainage <= verticalPoints[0].chainage) return verticalPoints[0].elevation
  if (chainage >= verticalPoints[verticalPoints.length - 1].chainage) {
    return verticalPoints[verticalPoints.length - 1].elevation
  }

  for (let i = 0; i < verticalPoints.length - 1; i++) {
    if (chainage >= verticalPoints[i].chainage && chainage <= verticalPoints[i + 1].chainage) {
      const t = (chainage - verticalPoints[i].chainage) /
                (verticalPoints[i + 1].chainage - verticalPoints[i].chainage)
      return verticalPoints[i].elevation + t * (verticalPoints[i + 1].elevation - verticalPoints[i].elevation)
    }
  }

  return 0
}
