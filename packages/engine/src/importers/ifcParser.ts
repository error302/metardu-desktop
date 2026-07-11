/**
 * IFC4 STEP File Parser — Native TypeScript Implementation
 *
 * Parses IFC4 STEP files (plain text format) without external dependencies.
 *
 * STEP file structure:
 *   ISO-10303-21;
 *   HEADER;
 *     FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
 *     FILE_NAME('example.ifc','2024-01-01',('Author'),('Org'),'IfcOpenShell','IfcOpenShell','');
 *     FILE_SCHEMA(('IFC4'));
 *   ENDSEC;
 *   DATA;
 *     #1=IFCPROJECT('2x3k',$,'Project Name',(#2),$,$,$,(#3),#4);
 *     #2=IFCOWNERHISTORY(#5,#6,$,.ADDED.,$,$,$,1640995200);
 *     #3=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,$,$);
 *   ENDSEC;
 *   END-ISO-10303-21;
 *
 * Entity references: #1, #2, etc.
 * String args: 'single quoted' (escaped: '' for literal ')
 * Number args: 1.0, 100, -3.5
 * Enum args: .ENUMVALUE.
 * Boolean args: .T., .F.
 * Optional/missing args: $
 * Lists: (item1,item2,#3)
 * Nested lists: ((#1,#2),(#3,#4))
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IFCHeader {
  description: string
  implementationLevel: string
  fileName: string
  author: string
  organization: string
  preprocessorVersion: string
  originatingSystem: string
  authorization: string
  schema: string
}

export interface IFCEntity {
  id: number
  type: string
  args: unknown[]
  raw: string
}

export interface IFCModel {
  header: IFCHeader
  entities: Map<number, IFCEntity>
  byType: Map<string, number[]>
}

export interface BuildingGeometry {
  buildings: Array<{
    name: string
    footprint: Array<{ x: number; y: number; z: number }>
    floors: number
    walls: Array<{
      start: { x: number; y: number; z: number }
      end: { x: number; y: number; z: number }
    }>
    columns: Array<{ x: number; y: number; z: number }>
  }>
}

export interface IFCSurveyPoint {
  id: string
  label: string
  easting: number
  northing: number
  elevation: number
  type: string
}

export interface IFCProjectInfo {
  name: string
  description: string
  coordinateSystem: string
  epsgCode?: number
  originEasting?: number
  originNorthing?: number
}

// ─── STEP Argument Types ─────────────────────────────────────────────────────

type StepArg =
  | number
  | string
  | boolean
  | null
  | StepRef
  | StepArg[]

interface StepRef {
  __ref: true
  id: number
}

// ─── STEP Tokenizer / Parser ────────────────────────────────────────────────

/**
 * Parse a full IFC4 STEP file content string into an IFCModel.
 */
export function parseIFCStep(content: string): IFCModel {
  const header = parseHeader(content)
  const entities = new Map<number, IFCEntity>()
  const byType = new Map<string, number[]>()

  // Extract DATA section
  const dataSection = extractSection(content, 'DATA')
  if (!dataSection) {
    return { header, entities, byType }
  }

  // Parse entity lines
  const lines = dataSection.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('ENDSEC')) continue

    // Match entity declaration: #id=TYPE(args);
    const entityMatch = trimmed.match(/^#(\d+)\s*=\s*([A-Z][A-Z0-9_]*)\s*\(([\s\S]*)\);?\s*$/)
    if (!entityMatch) continue

    const id = parseInt(entityMatch[1], 10)
    const type = entityMatch[2]
    const argsRaw = entityMatch[3]

    const args = parseArgs(argsRaw)
    const entity: IFCEntity = { id, type, args, raw: trimmed }

    entities.set(id, entity)

    const typeList = byType.get(type)
    if (typeList) {
      typeList.push(id)
    } else {
      byType.set(type, [id])
    }
  }

  return { header, entities, byType }
}

/**
 * Parse the HEADER section of the STEP file.
 */
function parseHeader(content: string): IFCHeader {
  const headerSection = extractSection(content, 'HEADER')
  if (!headerSection) {
    return emptyHeader()
  }

  const header: IFCHeader = { ...emptyHeader() }

  // Parse FILE_DESCRIPTION
  const fileDescMatch = headerSection.match(
    /FILE_DESCRIPTION\s*\(\s*\(([^)]*)\)\s*,\s*'([^']*)'\s*\)/i
  )
  if (fileDescMatch) {
    header.description = fileDescMatch[1].trim()
    header.implementationLevel = fileDescMatch[2].trim()
  }

  // Parse FILE_NAME
  const fileNameMatch = headerSection.match(
    /FILE_NAME\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*\(([^)]*)\)\s*,\s*\(([^)]*)\)\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/i
  )
  if (fileNameMatch) {
    header.fileName = fileNameMatch[1]
    header.author = parseStringList(fileNameMatch[3])
    header.organization = parseStringList(fileNameMatch[4])
    header.preprocessorVersion = fileNameMatch[5]
    header.originatingSystem = fileNameMatch[6]
    header.authorization = fileNameMatch[7]
  }

  // Parse FILE_SCHEMA
  const schemaMatch = headerSection.match(
    /FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'\s*\)\s*\)/i
  )
  if (schemaMatch) {
    header.schema = schemaMatch[1]
  }

  return header
}

/**
 * Extract a named section from the STEP content.
 * Sections are bounded by SECTION_NAME; ... ENDSEC;
 */
function extractSection(content: string, sectionName: string): string | null {
  const startRegex = new RegExp(`${sectionName}\\s*;`, 'i')
  const startMatch = content.search(startRegex)
  if (startMatch === -1) return null

  const afterStart = content.substring(startMatch + sectionName.length + 1)
  const endIdx = afterStart.search(/\bENDSEC\s*;/i)
  if (endIdx === -1) return afterStart

  return afterStart.substring(0, endIdx)
}

/**
 * Parse comma-separated arguments from inside parentheses.
 * Handles nested lists, strings, refs, enums, booleans, and $ (null).
 */
function parseArgs(raw: string): StepArg[] {
  const args: StepArg[] = []
  let i = 0
  let current = ''

  while (i < raw.length) {
    const ch = raw[i]

    if (ch === ',') {
      const parsed = parseSingleArg(current.trim())
      if (parsed !== undefined) args.push(parsed)
      current = ''
      i++
      continue
    }

    if (ch === '(') {
      // Count nested parentheses to find the matching close
      const closeIdx = findMatchingParen(raw, i)
      const subStr = raw.substring(i + 1, closeIdx)
      const subArgs = parseArgs(subStr)

      // Check if this is a top-level empty pair like () which means empty list
      if (subArgs.length === 1 && subArgs[0] === null) {
        args.push([])
      } else {
        args.push(subArgs)
      }
      i = closeIdx + 1
      current = ''
      continue
    }

    current += ch
    i++
  }

  // Don't forget the last arg
  const lastParsed = parseSingleArg(current.trim())
  if (lastParsed !== undefined) args.push(lastParsed)

  return args
}

/**
 * Parse a single argument token (not a list).
 */
function parseSingleArg(token: string): StepArg | undefined {
  if (token === '' || token === '$') return null

  // Entity reference: #123
  const refMatch = token.match(/^#(\d+)$/)
  if (refMatch) {
    return { __ref: true, id: parseInt(refMatch[1], 10) } as StepRef
  }

  // Boolean: .T. or .F.
  if (token === '.T.' || token === '.F.') {
    return token === '.T.'
  }

  // Enum: .ENUMVALUE.
  const enumMatch = token.match(/^\.[A-Z][A-Z0-9_]*\.$/i)
  if (enumMatch) {
    return token // keep as string for enums
  }

  // String: 'single quoted' (escaped '' for literal ')
  if (token.startsWith("'") && token.endsWith("'")) {
    return token.slice(1, -1).replace(/''/g, "'")
  }

  // Number
  const num = Number(token)
  if (!isNaN(num) && token.trim() !== '') {
    return num
  }

  // Fallback: return as string (type names like IFCWALL in lists, etc.)
  return token
}

/**
 * Find the index of the matching closing parenthesis.
 */
function findMatchingParen(str: string, openIdx: number): number {
  let depth = 0
  let inString = false
  let i = openIdx

  while (i < str.length) {
    const ch = str[i]

    if (inString) {
      if (ch === "'") {
        if (i + 1 < str.length && str[i + 1] === "'") {
          i += 2 // escaped quote
          continue
        }
        inString = false
      }
      i++
      continue
    }

    if (ch === "'") {
      inString = true
      i++
      continue
    }

    if (ch === '(') {
      depth++
    } else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }

    i++
  }

  return str.length - 1
}

/**
 * Parse a parenthesized string list from header, e.g. "('John','Jane')" → "John, Jane"
 */
function parseStringList(raw: string): string {
  const matches = raw.match(/'([^']*)'/g)
  if (!matches) return ''
  return matches
    .map((m) => m.slice(1, -1).replace(/''/g, "'"))
    .join(', ')
}

function emptyHeader(): IFCHeader {
  return {
    description: '',
    implementationLevel: '2;1',
    fileName: '',
    author: '',
    organization: '',
    preprocessorVersion: '',
    originatingSystem: '',
    authorization: '',
    schema: '',
  }
}

// ─── Entity Resolution ───────────────────────────────────────────────────────

/**
 * Resolve an entity reference to its entity, or return null.
 */
export function resolveRef<T extends IFCEntity = IFCEntity>(
  model: IFCModel,
  arg: StepArg
): T | null {
  if (isRef(arg)) {
    return (model.entities.get(arg.id) as T) ?? null
  }
  return null
}

/**
 * Check if a StepArg is an entity reference.
 */
export function isRef(arg: StepArg): arg is StepRef {
  return (
    typeof arg === 'object' &&
    arg !== null &&
    !Array.isArray(arg) &&
    (arg as StepRef).__ref === true
  )
}

/**
 * Get the first entity of a given type.
 */
export function firstOfType<T extends IFCEntity = IFCEntity>(
  model: IFCModel,
  type: string
): T | null {
  const ids = model.byType.get(type)
  if (!ids || ids.length === 0) return null
  return (model.entities.get(ids[0]) as T) ?? null
}

/**
 * Get all entities of a given type.
 */
export function allOfType<T extends IFCEntity = IFCEntity>(
  model: IFCModel,
  type: string
): T[] {
  const ids = model.byType.get(type)
  if (!ids) return []
  return ids
    .map((id) => model.entities.get(id) as T)
    .filter((e): e is T => e !== null && e !== undefined)
}

// ─── Building Geometry Extraction ───────────────────────────────────────────

/**
 * Extract building geometry from IFC entities.
 * Resolves IFCSITE → IFCBUILDING → IFCBUILDINGSTOREY → walls/slabs/columns.
 */
export function extractBuildingGeometry(model: IFCModel): BuildingGeometry {
  const buildings: BuildingGeometry['buildings'] = []

  // Find IFCPROJECT to get sites
  const projects = allOfType(model, 'IFCPROJECT')

  // Collect all sites from project or standalone
  const sites = allOfType(model, 'IFCSITE')
  if (sites.length === 0) {
    return { buildings }
  }

  for (const site of sites) {
    // Find buildings linked to this site via IFCRELASSOCIATES or spatial decomposition
    const siteBuildings = findRelatedEntities(model, site.id, 'IFCRELAGGREGATES', 'IFCBUILDING')

    if (siteBuildings.length === 0) {
      // Fallback: just use all buildings
      siteBuildings.push(...allOfType(model, 'IFCBUILDING'))
    }

    for (const building of siteBuildings) {
      const buildingName = getEntityName(model, building)

      // Find building storeys
      const storeys = findRelatedEntities(
        model,
        building.id,
        'IFCRELAGGREGATES',
        'IFCBUILDINGSTOREY'
      )

      const footprint: Array<{ x: number; y: number; z: number }> = []
      const walls: BuildingGeometry['buildings'][0]['walls'] = []
      const columns: BuildingGeometry['buildings'][0]['columns'] = []
      const floorSet = new Set<number>()

      for (const storey of storeys) {
        floorSet.add(getStoreyElevation(model, storey))

        // Extract walls from this storey
        const storeyWalls = findRelatedEntities(
          model,
          storey.id,
          'IFCRELAGGREGATES',
          'IFCWALL'
        )
        // Also check IFCRELCONTAINEDINSPATIALSTRUCTURE
        storeyWalls.push(
          ...findContainedEntities(model, storey.id, 'IFCWALL')
        )

        for (const wall of storeyWalls) {
          const wallGeom = extractWallGeometry(model, wall)
          if (wallGeom) {
            walls.push(wallGeom)
            // Add wall endpoints to footprint approximation
            footprint.push(wallGeom.start, wallGeom.end)
          }
        }

        // Extract columns
        const storeyColumns = findRelatedEntities(
          model,
          storey.id,
          'IFCRELAGGREGATES',
          'IFCCOLUMN'
        )
        storeyColumns.push(
          ...findContainedEntities(model, storey.id, 'IFCCOLUMN')
        )

        for (const col of storeyColumns) {
          const colGeom = extractColumnGeometry(model, col)
          if (colGeom) {
            columns.push(colGeom)
          }
        }
      }

      // If no storeys found, try to find walls/columns directly from building
      if (storeys.length === 0) {
        const directWalls = findRelatedEntities(
          model,
          building.id,
          'IFCRELAGGREGATES',
          'IFCWALL'
        )
        directWalls.push(
          ...findContainedEntities(model, building.id, 'IFCWALL')
        )

        for (const wall of directWalls) {
          const wallGeom = extractWallGeometry(model, wall)
          if (wallGeom) {
            walls.push(wallGeom)
            footprint.push(wallGeom.start, wallGeom.end)
          }
        }

        const directCols = findRelatedEntities(
          model,
          building.id,
          'IFCRELAGGREGATES',
          'IFCCOLUMN'
        )
        directCols.push(
          ...findContainedEntities(model, building.id, 'IFCCOLUMN')
        )

        for (const col of directCols) {
          const colGeom = extractColumnGeometry(model, col)
          if (colGeom) {
            columns.push(colGeom)
          }
        }
      }

      // Deduplicate footprint points
      const uniqueFootprint = deduplicatePoints(footprint)

      buildings.push({
        name: buildingName,
        footprint: uniqueFootprint,
        floors: floorSet.size || 1,
        walls,
        columns,
      })
    }
  }

  // If no buildings found but there are walls directly, create a generic building
  if (buildings.length === 0) {
    const allWalls = allOfType(model, 'IFCWALL')
    const allCols = allOfType(model, 'IFCCOLUMN')

    if (allWalls.length > 0 || allCols.length > 0) {
      const walls: BuildingGeometry['buildings'][0]['walls'] = []
      const footprint: Array<{ x: number; y: number; z: number }> = []

      for (const wall of allWalls) {
        const wallGeom = extractWallGeometry(model, wall)
        if (wallGeom) {
          walls.push(wallGeom)
          footprint.push(wallGeom.start, wallGeom.end)
        }
      }

      const columns: BuildingGeometry['buildings'][0]['columns'] = []
      for (const col of allCols) {
        const colGeom = extractColumnGeometry(model, col)
        if (colGeom) {
          columns.push(colGeom)
        }
      }

      buildings.push({
        name: headerOrFallback(model, 'IFC Project'),
        footprint: deduplicatePoints(footprint),
        floors: 1,
        walls,
        columns,
      })
    }
  }

  return { buildings }
}

/**
 * Extract survey points from IFC entities.
 * Looks for IFCANNOTATION, IFCSURVEYPOINT, and IFCGRID entities.
 */
export function extractSurveyPoints(model: IFCModel): IFCSurveyPoint[] {
  const points: IFCSurveyPoint[] = []

  // Extract from IFCSITE survey points
  const sites = allOfType(model, 'IFCSITE')
  for (const site of sites) {
    const refLatitude = getArgValue(site.args, 8) as number | null
    const refLongitude = getArgValue(site.args, 9) as number | null
    const refElevation = getArgValue(site.args, 10) as number | null

    if (refLatitude !== null && refLongitude !== null) {
      points.push({
        id: `site-${site.id}`,
        label: getEntityName(model, site) || 'Site Reference',
        easting: refLongitude,
        northing: refLatitude,
        elevation: refElevation ?? 0,
        type: 'IFCSITE',
      })
    }

    // Also extract from site's ObjectPlacement
    if (site.args.length > 5) {
      const placementRef = getArgValue(site.args, 5)
      if (isRef(placementRef)) {
        const placement = resolveRef(model, placementRef)
        if (placement && placement.type === 'IFCLOCALPLACEMENT') {
          const coords = extractLocalPlacementCoords(model, placement)
          if (coords) {
            points.push({
              id: `site-placement-${site.id}`,
              label: `${getEntityName(model, site)} Origin`,
              easting: coords[0],
              northing: coords[1],
              elevation: coords[2],
              type: 'IFCSITE_ORIGIN',
            })
          }
        }
      }
    }
  }

  // Extract from IFCSURVEYPOINT entities (if present)
  const surveyPoints = allOfType(model, 'IFCSURVEYPOINT')
  for (const sp of surveyPoints) {
    const name = getEntityName(model, sp)
    const placementRef = getArgValue(sp.args, 5)
    let coords: [number, number, number] | null = null

    if (isRef(placementRef)) {
      const placement = resolveRef(model, placementRef)
      if (placement && placement.type === 'IFCLOCALPLACEMENT') {
        coords = extractLocalPlacementCoords(model, placement)
      }
    }

    points.push({
      id: `survey-point-${sp.id}`,
      label: name || `Survey Point ${sp.id}`,
      easting: coords?.[0] ?? 0,
      northing: coords?.[1] ?? 0,
      elevation: coords?.[2] ?? 0,
      type: 'IFCSURVEYPOINT',
    })
  }

  // Extract from IFCARTESIANPOINT entities used in annotations
  const annotations = allOfType(model, 'IFCANNOTATION')
  for (const ann of annotations) {
    const name = getEntityName(model, ann)
    const placementRef = getArgValue(ann.args, 5)
    let coords: [number, number, number] | null = null

    if (isRef(placementRef)) {
      const placement = resolveRef(model, placementRef)
      if (placement && placement.type === 'IFCLOCALPLACEMENT') {
        coords = extractLocalPlacementCoords(model, placement)
      }
    }

    if (coords) {
      points.push({
        id: `annotation-${ann.id}`,
        label: name || `Annotation ${ann.id}`,
        easting: coords[0],
        northing: coords[1],
        elevation: coords[2],
        type: 'IFCANNOTATION',
      })
    }
  }

  // Extract all IFCGRIDAXIS intersection points
  const grids = allOfType(model, 'IFCGRID')
  for (const grid of grids) {
    const name = getEntityName(model, grid)
    // Grid axes are in args[2] as a list of IFCGRIDAXIS refs
    const axesRef = getArgValue(grid.args, 2)
    if (Array.isArray(axesRef)) {
      for (const axisRef of axesRef) {
        if (isRef(axisRef)) {
          const axis = resolveRef(model, axisRef)
          if (axis) {
            const axisCurveRef = getArgValue(axis.args, 0)
            if (isRef(axisCurveRef)) {
              const curve = resolveRef(model, axisCurveRef)
              if (curve) {
                const curvePts = extractCurvePoints(model, curve)
                for (let ci = 0; ci < curvePts.length; ci++) {
                  points.push({
                    id: `grid-${grid.id}-axis-${axis.id}-${ci}`,
                    label: `${name || 'Grid'} Axis`,
                    easting: curvePts[ci][0],
                    northing: curvePts[ci][1],
                    elevation: curvePts[ci][2],
                    type: 'IFCGRID',
                  })
                }
              }
            }
          }
        }
      }
    }
  }

  return points
}

/**
 * Extract project metadata from IFC entities.
 */
export function extractProjectMetadata(model: IFCModel): IFCProjectInfo {
  const info: IFCProjectInfo = {
    name: '',
    description: '',
    coordinateSystem: '',
  }

  // Get IFCPROJECT entity
  const project = firstOfType(model, 'IFCPROJECT')
  if (project) {
    info.name = getEntityName(model, project) || model.header.fileName || 'Unnamed Project'

    // Description is in args[3]
    const descRef = getArgValue(project.args, 3)
    if (isRef(descRef)) {
      const desc = resolveRef(model, descRef)
      if (desc && desc.type === 'IFCTEXT') {
        info.description = String(getArgValue(desc.args, 0) ?? '')
      }
    } else if (typeof descRef === 'string') {
      info.description = descRef
    }

    // Units context is in args[7] or args[8] as a list
    const unitsRef = getArgValue(project.args, 8)
    if (isRef(unitsRef)) {
      const unitsCtx = resolveRef(model, unitsRef)
      if (unitsCtx) {
        info.coordinateSystem = extractUnitInfo(model, unitsCtx)
      }
    }
  } else {
    info.name = model.header.fileName || 'Unnamed Project'
  }

  // Extract IFCMAPCONVERSION for coordinate system info
  const mapConversions = allOfType(model, 'IFCMAPCONVERSION')
  for (const mc of mapConversions) {
    // args: (SourceCRS, TargetCRS, Eastings, Northings, OrthoHeight, XAxisAbscissa, XAxisOrdinate, Scale)
    const eastings = getArgValue(mc.args, 2) as number | null
    const northings = getArgValue(mc.args, 3) as number | null

    if (eastings !== null) info.originEasting = eastings
    if (northings !== null) info.originNorthing = northings

    // Target CRS ref
    const targetCrsRef = getArgValue(mc.args, 1)
    if (isRef(targetCrsRef)) {
      const crs = resolveRef(model, targetCrsRef)
      if (crs) {
        if (crs.type === 'IFCPROJECTEDCRS') {
          info.epsgCode = extractEPSGCode(model, crs)
          info.coordinateSystem = getArgValue(crs.args, 0) as string || info.coordinateSystem
        } else if (crs.type === 'IFCGEOGRAPHICCRS') {
          info.coordinateSystem = getArgValue(crs.args, 0) as string || info.coordinateSystem
        }
      }
    }
  }

  // Direct IFCPROJECTEDCRS lookup
  if (!info.epsgCode) {
    const projectedCrsList = allOfType(model, 'IFCPROJECTEDCRS')
    for (const crs of projectedCrsList) {
      const epsg = extractEPSGCode(model, crs)
      if (epsg) {
        info.epsgCode = epsg
        info.coordinateSystem = getArgValue(crs.args, 0) as string || info.coordinateSystem
        break
      }
    }
  }

  // Fallback to header schema
  if (!info.coordinateSystem) {
    info.coordinateSystem = model.header.schema
  }

  return info
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function getArgValue(args: unknown[], index: number): any {
  if (index < 0 || index >= args.length) return null
  const val = args[index]
  return val === null || val === undefined ? null : val
}

function getEntityName(model: IFCModel, entity: IFCEntity): string {
  // Name is typically args[1] for most IFC entities (args[0] is globalId)
  // But some types have name at different positions
  if (!entity.args || entity.args.length < 2) return ''

  // Try args[1] first (common for most spatial elements)
  const nameCandidate = entity.args[1]
  if (typeof nameCandidate === 'string' && nameCandidate !== '') {
    return nameCandidate
  }

  // For IFCPROJECT, name might be at args[2]
  if (entity.type === 'IFCPROJECT' && entity.args.length > 2) {
    const pName = entity.args[2]
    if (typeof pName === 'string' && pName !== '') return pName
  }

  return ''
}

function getStoreyElevation(model: IFCModel, storey: IFCEntity): number {
  // Try to get elevation from ObjectPlacement
  const placementRef = getArgValue(storey.args, 5)
  if (isRef(placementRef)) {
    const placement = resolveRef(model, placementRef)
    if (placement && placement.type === 'IFCLOCALPLACEMENT') {
      const coords = extractLocalPlacementCoords(model, placement)
      if (coords) return coords[2]
    }
  }

  // Fallback: try from Elevation property
  if (storey.args.length > 7) {
    const elevRef = getArgValue(storey.args, 7)
    if (typeof elevRef === 'number') return elevRef
  }

  return 0
}

function extractLocalPlacementCoords(
  model: IFCModel,
  placement: IFCEntity
): [number, number, number] | null {
  // IFCLOCALPLACEMENT args: (PlacementRelTo, RelativePlacement)
  // RelativePlacement is IFCAXIS2PLACEMENT3D
  const relPlacementRef = getArgValue(placement.args, 1)
  if (!isRef(relPlacementRef)) return null

  const axis2Placement = resolveRef(model, relPlacementRef)
  if (!axis2Placement) return null

  // IFCAXIS2PLACEMENT3D args: (Location, Axis, RefDirection)
  const locationRef = getArgValue(axis2Placement.args, 0)
  if (!isRef(locationRef)) return null

  const cartPoint = resolveRef(model, locationRef)
  if (!cartPoint || cartPoint.type !== 'IFCCARTESIANPOINT') return null

  // IFCARTESIANPOINT args: (Coordinates) — a list of numbers
  const coordsList = getArgValue(cartPoint.args, 0)
  if (Array.isArray(coordsList) && coordsList.length >= 2) {
    return [
      Number(coordsList[0]) || 0,
      Number(coordsList[1]) || 0,
      Number(coordsList[2]) || 0,
    ]
  }

  return null
}

function extractWallGeometry(
  model: IFCModel,
  wall: IFCEntity
): BuildingGeometry['buildings'][0]['walls'][0] | null {
  // Try to get geometry from representation
  const repRef = getArgValue(wall.args, 3)
  if (!isRef(repRef)) return null

  const rep = resolveRef(model, repRef)
  if (!rep || rep.type !== 'IFCPRODUCTDEFINITIONSHAPE') return null

  // Look for body representation
  const repList = getArgValue(rep.args, 2)
  if (!Array.isArray(repList)) return null

  for (const shapeRepRef of repList) {
    if (!isRef(shapeRepRef)) continue
    const shapeRep = resolveRef(model, shapeRepRef)
    if (!shapeRep || shapeRep.type !== 'IFCSHAPEREPRESENTATION') continue

    // Check if this is a body representation
    const repIdRef = getArgValue(shapeRep.args, 0)
    if (isRef(repIdRef)) {
      const repId = resolveRef(model, repIdRef)
      const repIdStr = repId ? getArgValue(repId.args, 0) : null
      if (repIdStr !== 'Body') continue
    } else if (typeof repIdRef === 'string' && repIdRef !== 'Body') {
      continue
    }

    // Get items
    const items = getArgValue(shapeRep.args, 2)
    if (!Array.isArray(items)) continue

    for (const itemRef of items) {
      if (!isRef(itemRef)) continue
      const item = resolveRef(model, itemRef)
      if (!item) continue

      // For extruded area solids, extract footprint
      if (item.type === 'IFCEXTRUDEDAREASOLID') {
        return extractExtrudedSolidWall(model, item)
      }

      // For polyline-based geometry
      if (item.type === 'IFCPOLYLINE') {
        return extractPolylineWall(model, item)
      }
    }
  }

  return null
}

function extractExtrudedSolidWall(
  model: IFCModel,
  solid: IFCEntity
): BuildingGeometry['buildings'][0]['walls'][0] | null {
  // IFCEXTRUDEDAREASOLID args: (SweptArea, Position, ExtrudedDirection, Depth)
  const profileRef = getArgValue(solid.args, 0)
  if (!isRef(profileRef)) return null

  const profile = resolveRef(model, profileRef)
  if (!profile) return null

  // Extract profile points
  let points: Array<{ x: number; y: number; z: number }> = []

  if (profile.type === 'IFCRECTANGLEPROFILEDEF') {
    // args: (ProfileType, ProfileName, XDim, YDim)
    const xDim = getArgValue(profile.args, 2) as number
    const yDim = getArgValue(profile.args, 3) as number
    const hx = (xDim || 0) / 2
    const hy = (yDim || 0) / 2
    points = [
      { x: -hx, y: -hy, z: 0 },
      { x: hx, y: -hy, z: 0 },
      { x: hx, y: hy, z: 0 },
      { x: -hx, y: hy, z: 0 },
    ]
  } else if (profile.type === 'IFCARBITRARYCLOSEDPROFILEDEF') {
    const outerCurveRef = getArgValue(profile.args, 2)
    if (isRef(outerCurveRef)) {
      const curve = resolveRef(model, outerCurveRef)
      if (curve) {
        points = extractCurvePoints2D(model, curve)
      }
    }
  }

  if (points.length < 2) return null

  // Get placement
  const posRef = getArgValue(solid.args, 1)
  let offsetX = 0, offsetY = 0, offsetZ = 0
  if (isRef(posRef)) {
    const placement = resolveRef(model, posRef)
    if (placement && placement.type === 'IFCAXIS2PLACEMENT3D') {
      const locRef = getArgValue(placement.args, 0)
      if (isRef(locRef)) {
        const cp = resolveRef(model, locRef)
        if (cp && cp.type === 'IFCCARTESIANPOINT') {
          const coords = getArgValue(cp.args, 0)
          if (Array.isArray(coords)) {
            offsetX = Number(coords[0]) || 0
            offsetY = Number(coords[1]) || 0
            offsetZ = Number(coords[2]) || 0
          }
        }
      }
    }
  }

  return {
    start: { x: points[0].x + offsetX, y: points[0].y + offsetY, z: points[0].z + offsetZ },
    end: { x: points[1].x + offsetX, y: points[1].y + offsetY, z: points[1].z + offsetZ },
  }
}

function extractPolylineWall(
  model: IFCModel,
  polyline: IFCEntity
): BuildingGeometry['buildings'][0]['walls'][0] | null {
  // IFCPOLYLINE args: (Points) — list of IFCCARTESIANPOINT refs
  const pointsRef = getArgValue(polyline.args, 0)
  if (!Array.isArray(pointsRef)) return null

  const pts: Array<{ x: number; y: number; z: number }> = []
  for (const ptRef of pointsRef) {
    if (!isRef(ptRef)) continue
    const cp = resolveRef(model, ptRef)
    if (!cp || cp.type !== 'IFCCARTESIANPOINT') continue

    const coords = getArgValue(cp.args, 0)
    if (Array.isArray(coords) && coords.length >= 2) {
      pts.push({
        x: Number(coords[0]) || 0,
        y: Number(coords[1]) || 0,
        z: Number(coords[2]) || 0,
      })
    }
  }

  if (pts.length < 2) return null

  return { start: pts[0], end: pts[1] }
}

function extractColumnGeometry(
  model: IFCModel,
  column: IFCEntity
): { x: number; y: number; z: number } | null {
  // Get from object placement
  const placementRef = getArgValue(column.args, 5)
  if (!isRef(placementRef)) return null

  const placement = resolveRef(model, placementRef)
  if (!placement || placement.type !== 'IFCLOCALPLACEMENT') return null

  const coords = extractLocalPlacementCoords(model, placement)
  if (!coords) return null

  return { x: coords[0], y: coords[1], z: coords[2] }
}

function extractCurvePoints(
  model: IFCModel,
  curve: IFCEntity
): [number, number, number][] {
  if (curve.type === 'IFCPOLYLINE') {
    const pointsRef = getArgValue(curve.args, 0)
    if (!Array.isArray(pointsRef)) return []
    return pointsRef
      .filter(isRef)
      .map((ref) => {
        const cp = resolveRef(model, ref)
        if (!cp || cp.type !== 'IFCCARTESIANPOINT') return null
        const coords = getArgValue(cp.args, 0)
        if (Array.isArray(coords) && coords.length >= 2) {
          return [Number(coords[0]) || 0, Number(coords[1]) || 0, Number(coords[2]) || 0] as [number, number, number]
        }
        return null
      })
      .filter((p): p is [number, number, number] => p !== null)
  }

  if (curve.type === 'IFCLINE') {
    const startRef = getArgValue(curve.args, 0)
    const endRef = getArgValue(curve.args, 1)
    const startPt = isRef(startRef) ? resolveRef(model, startRef) : null
    const endPt = isRef(endRef) ? resolveRef(model, endRef) : null

    const pts: [number, number, number][] = []
    if (startPt && startPt.type === 'IFCCARTESIANPOINT') {
      const coords = getArgValue(startPt.args, 0)
      if (Array.isArray(coords) && coords.length >= 2) {
        pts.push([Number(coords[0]) || 0, Number(coords[1]) || 0, Number(coords[2]) || 0])
      }
    }
    if (endPt && endPt.type === 'IFCCARTESIANPOINT') {
      const coords = getArgValue(endPt.args, 0)
      if (Array.isArray(coords) && coords.length >= 2) {
        pts.push([Number(coords[0]) || 0, Number(coords[1]) || 0, Number(coords[2]) || 0])
      }
    }
    return pts
  }

  return []
}

function extractCurvePoints2D(
  model: IFCModel,
  curve: IFCEntity
): Array<{ x: number; y: number; z: number }> {
  const pts3d = extractCurvePoints(model, curve)
  return pts3d.map(([x, y, z]) => ({ x, y, z }))
}

function extractEPSGCode(model: IFCModel, crs: IFCEntity): number | undefined {
  // IFCPROJECTEDCRS: args include Name, GeodeticDatum, MapProjection, MapZone, MapUnit
  // The EPSG code is sometimes in args[6] or can be found from the Name

  // Check if Name contains EPSG code pattern
  const name = getArgValue(crs.args, 0) as string | null
  if (name) {
    const epsgMatch = name.match(/EPSG[:\s]*(\d+)/i)
    if (epsgMatch) return parseInt(epsgMatch[1], 10)
  }

  // Check MapZone (arg[3]) for EPSG
  const mapZone = getArgValue(crs.args, 3)
  if (typeof mapZone === 'string') {
    const zoneMatch = mapZone.match(/EPSG[:\s]*(\d+)/i)
    if (zoneMatch) return parseInt(zoneMatch[1], 10)
  }

  // Check if there's a Name attribute (args might vary)
  if (crs.args.length > 6) {
    const identRef = getArgValue(crs.args, 6)
    if (typeof identRef === 'number') return identRef
  }

  return undefined
}

function extractUnitInfo(model: IFCModel, unitsCtx: IFCEntity): string {
  // IFcUNITASSIGNMENT or similar — look for length unit
  const unitsList = getArgValue(unitsCtx.args, 0)
  if (!Array.isArray(unitsList)) return ''

  for (const unitRef of unitsList) {
    if (!isRef(unitRef)) continue
    const unit = resolveRef(model, unitRef)
    if (!unit) continue

    if (
      unit.type === 'IFCSIUNIT' ||
      unit.type === 'IFCCONVERSIONBASEDUNIT' ||
      unit.type === 'IFCDERIVEDUNIT'
    ) {
      const unitType = getArgValue(unit.args, 0) as string
      if (unitType === 'LENGTHUNIT') {
        const name = getArgValue(unit.args, 1) as string
        return name || unit.type
      }
    }
  }

  return ''
}

function findRelatedEntities(
  model: IFCModel,
  parentId: number,
  relType: string,
  targetType: string
): IFCEntity[] {
  const results: IFCEntity[] = []

  // Find all IFCRELASSOCIATES / IFCRELCONTAINEDINSPATIALSTRUCTURE that reference the parent
  const rels = allOfType(model, relType)
  for (const rel of rels) {
    // RelatedObjects is typically args[4] for IFCRELASSIGNSTOGROUP
    // and args[5] for IFCRELAGGREGATES
    // IFCRELAGGREGATES: (GlobalId, OwnerHistory, Name, Description, RelatingObject, RelatedObjects)
    // IFCRELCONTAINEDINSPATIALSTRUCTURE: (GlobalId, OwnerHistory, Name, Description, RelatingStructure, RelatedElements)

    let relObjects: StepArg | null = null

    if (rel.type === 'IFCRELAGGREGATES') {
      // Check if parent is the RelatingObject (args[4])
      const relatingObj = getArgValue(rel.args, 4)
      if (isRef(relatingObj) && relatingObj.id === parentId) {
        relObjects = getArgValue(rel.args, 5)
      }
    } else if (rel.type === 'IFCRELCONTAINEDINSPATIALSTRUCTURE') {
      const relatingObj = getArgValue(rel.args, 4)
      if (isRef(relatingObj) && relatingObj.id === parentId) {
        relObjects = getArgValue(rel.args, 5)
      }
    } else if (rel.type === 'IFCRELASSIGNSTOGROUP') {
      const relatingObj = getArgValue(rel.args, 4)
      if (isRef(relatingObj) && relatingObj.id === parentId) {
        relObjects = getArgValue(rel.args, 5)
      }
    }

    if (Array.isArray(relObjects)) {
      for (const objRef of relObjects) {
        if (!isRef(objRef)) continue
        const entity = resolveRef(model, objRef)
        if (entity && (targetType === '*' || entity.type === targetType)) {
          results.push(entity)
        }
      }
    }
  }

  // Also check inverse: some IFC files use the parent as a related object
  if (results.length === 0) {
    for (const rel of rels) {
      let relObjects: StepArg | null = null
      let relatingObj: StepArg | null = null

      if (rel.type === 'IFCRELAGGREGATES') {
        relObjects = getArgValue(rel.args, 5)
        relatingObj = getArgValue(rel.args, 4)
      } else if (rel.type === 'IFCRELCONTAINEDINSPATIALSTRUCTURE') {
        relObjects = getArgValue(rel.args, 5)
        relatingObj = getArgValue(rel.args, 4)
      }

      if (!Array.isArray(relObjects)) continue

      // Check if parent is in RelatedObjects
      const parentInRelated = relObjects.some(
        (r) => isRef(r) && r.id === parentId
      )
      if (parentInRelated && isRef(relatingObj)) {
        const relating = resolveRef(model, relatingObj)
        if (relating && (targetType === '*' || relating.type === targetType)) {
          results.push(relating)
        }
      }
    }
  }

  return results
}

function findContainedEntities(
  model: IFCModel,
  parentId: number,
  targetType: string
): IFCEntity[] {
  return findRelatedEntities(model, parentId, 'IFCRELCONTAINEDINSPATIALSTRUCTURE', targetType)
}

function deduplicatePoints(
  pts: Array<{ x: number; y: number; z: number }>
): Array<{ x: number; y: number; z: number }> {
  const seen = new Set<string>()
  return pts.filter((p) => {
    const key = `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function headerOrFallback(model: IFCModel, fallback: string): string {
  return model.header.fileName || fallback
}
