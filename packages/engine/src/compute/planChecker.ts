import { PlanCheckReport, PlanCheckResult, PlanCheckCategory, PlanCheckSeverity } from '@/types/landLaw'

export interface PlanInput {
  planId: string
  coordinates: Coordinate[]
  bearings: Bearing[]
  distances: number[]
  area: number
  perimeter: number
  parcelNumber?: string
  titleNumber?: string
  coordinatesSystem?: string
  scale?: number
  northArrow?: boolean
  legend?: boolean
  beacons: BeaconRecord[]
  Easements?: Easement[]
  metadata?: PlanMetadata
}

export interface Coordinate {
  id: string
  easting: number
  northing: number
  description: string
}

export interface Bearing {
  from: string
  to: string
  value: string
}

export interface Distance {
  from: string
  to: string
  value: number
}

export interface BeaconRecord {
  id: string
  type: string
  coordinates: { easting: number; northing: number }
  description: string
}

export interface Easement {
  type: string
  coordinates: { easting: number; northing: number }[]
  description: string
}

export interface PlanMetadata {
  surveyorName?: string
  surveyDate?: string
  approvalDate?: string
  sheetNumber?: string
  registrationNumber?: string
}

export function runPlanCheck(input: PlanInput): PlanCheckReport {
  const checks: PlanCheckResult[] = []
  
  checks.push(...checkGeometricClosure(input))
  checks.push(...checkAngularClosure(input))
  checks.push(...checkAreaCalculation(input))
  checks.push(...checkPerimeterCalculation(input))
  checks.push(...checkCoordinateSystem(input))
  checks.push(...checkBeaconMonumentation(input))
  checks.push(...checkBoundaryContinuity(input))
  checks.push(...checkOverlappingBoundaries(input))
  checks.push(...checkScaleAccuracy(input))
  checks.push(...checkNorthArrow(input))
  checks.push(...checkLegend(input))
  checks.push(...checkDocumentation(input))
  checks.push(...checkEasements(input))
  checks.push(...checkRegulatoryCompliance(input))
  
  const passedChecks = checks.filter((c: any) => c.passed).length
  const totalChecks = checks.length
  const score = Math.round((passedChecks / totalChecks) * 100)
  const errors = checks.filter((c: any) => c.severity === 'ERROR' && !c.passed).length
  const warnings = checks.filter((c: any) => c.severity === 'WARNING' && !c.passed).length
  const suggestions = checks.filter((c: any) => c.severity === 'INFO' && !c.passed).map((c: any) => c.recommendation).filter((r): r is string => !!r)
  
  return {
    planId: input.planId,
    overallPass: errors === 0,
    score,
    checks,
    checkedAt: new Date().toISOString(),
    warnings,
    errors,
    suggestions: suggestions.slice(0, 5)
  }
}

function createCheck(
  category: PlanCheckCategory,
  name: string,
  description: string,
  severity: PlanCheckSeverity,
  passed: boolean,
  details: string,
  recommendation?: string,
  regulation?: string
): PlanCheckResult {
  return {
    id: crypto.randomUUID(),
    category,
    checkName: name,
    description,
    severity,
    passed,
    details,
    recommendation,
    regulation
  }
}

function checkGeometricClosure(input: PlanInput): PlanCheckResult[] {
  const checks: PlanCheckResult[] = []
  
  if (input.coordinates.length < 3) {
    checks.push(createCheck(
      'GEOMETRIC',
      'Minimum Vertices',
      'Plan must have at least 3 vertices to form a closed polygon',
      'ERROR',
      false,
      `Found only ${input.coordinates.length} vertices`,
      'Add more boundary points to close the polygon',
      'Survey Regulations 1994'
    ))
    return checks
  }
  
  let totalDx = 0
  let totalDy = 0
  
  for (let i = 0; i < input.coordinates.length; i++) {
    const curr = input.coordinates[i]
    const next = input.coordinates[(i + 1) % input.coordinates.length]
    totalDx += next.easting - curr.easting
    totalDy += next.northing - curr.northing
  }
  
  const closureError = Math.sqrt(totalDx * totalDx + totalDy * totalDy)
  const closureRatio = input.perimeter / (closureError || 1)
  
  const passed = closureError < 0.01 || closureRatio > 10000
  checks.push(createCheck(
    'GEOMETRIC',
    'Geometric Closure',
    'Verify the survey forms a closed polygon with acceptable closure error',
    passed ? 'INFO' : 'ERROR',
    passed,
    `Closure error: ${closureError.toFixed(4)}m (1:${Math.round(closureRatio)})`,
    passed ? 'Geometric closure is acceptable' : 'Review traverse adjustments to improve closure',
    'Survey Regulations 1994 Reg 27'
  ))
  
  return checks
}

function checkAngularClosure(input: PlanInput): PlanCheckResult[] {
  const checks: PlanCheckResult[] = []
  
  if (input.coordinates.length < 3) {
    return checks
  }
  
  let sumAngles = 0
  for (let i = 0; i < input.coordinates.length; i++) {
    const prev = input.coordinates[(i - 1 + input.coordinates.length) % input.coordinates.length]
    const curr = input.coordinates[i]
    const next = input.coordinates[(i + 1) % input.coordinates.length]
    
    const angle1 = Math.atan2(curr.easting - prev.easting, curr.northing - prev.northing)
    const angle2 = Math.atan2(next.easting - curr.easting, next.northing - curr.northing)
    let angle = (angle2 - angle1) * (180 / Math.PI)
    if (angle < 0) angle += 360
    sumAngles += angle
  }
  
  const expectedSum = (input.coordinates.length - 2) * 180
  const angularError = Math.abs(sumAngles - expectedSum)
  const passed = angularError < 1.0
  
  checks.push(createCheck(
    'MATHEMATICAL',
    'Angular Closure',
    'Sum of interior angles should equal (n-2)×180°',
    passed ? 'INFO' : 'ERROR',
    passed,
    `Angular error: ${angularError.toFixed(2)}° (Expected: ${expectedSum}°, Actual: ${sumAngles.toFixed(2)}°)`,
    passed ? 'Angular closure is acceptable' : 'Check angle measurements and calculations',
    'RDM 1.1 Section 5.4'
  ))
  
  return checks
}

function checkAreaCalculation(input: PlanInput): PlanCheckResult[] {
  const checks: PlanCheckResult[] = []
  
  if (input.coordinates.length < 3) {
    return checks
  }
  
  let calculatedArea = 0
  for (let i = 0; i < input.coordinates.length; i++) {
    const curr = input.coordinates[i]
    const next = input.coordinates[(i + 1) % input.coordinates.length]
    calculatedArea += curr.easting * next.northing
    calculatedArea -= next.easting * curr.northing
  }
  calculatedArea = Math.abs(calculatedArea) / 2
  
  const areaDifference = Math.abs(calculatedArea - input.area)
  const areaTolerance = input.area * 0.01
  const passed = areaDifference < areaTolerance
  
  checks.push(createCheck(
    'MATHEMATICAL',
    'Area Calculation',
    'Verify area calculation matches coordinates',
    passed ? 'INFO' : 'WARNING',
    passed,
    `Area difference: ${areaDifference.toFixed(2)}m² (${((areaDifference / input.area) * 100).toFixed(2)}%)`,
    passed ? 'Area calculation is consistent' : 'Recalculate area from coordinates',
    'Survey Regulations 1994 Reg 99'
  ))
  
  return checks
}

function checkPerimeterCalculation(input: PlanInput): PlanCheckResult[] {
  const checks: PlanCheckResult[] = []
  
  if (input.coordinates.length < 2 || input.distances.length === 0) {
    return checks
  }
  
  const calculatedPerimeter = input.distances.reduce((sum, d) => sum + d, 0)
  const perimeterDifference = Math.abs(calculatedPerimeter - input.perimeter)
  const passed = perimeterDifference < 0.1
  
  checks.push(createCheck(
    'MATHEMATICAL',
    'Perimeter Calculation',
    'Verify perimeter calculation from boundary distances',
    passed ? 'INFO' : 'WARNING',
    passed,
    `Perimeter difference: ${perimeterDifference.toFixed(3)}m`,
    passed ? 'Perimeter is consistent' : 'Check boundary distance measurements',
    'Survey Regulations 1994'
  ))
  
  return checks
}

function checkCoordinateSystem(input: PlanInput): PlanCheckResult[] {
  const checks: PlanCheckResult[] = []
  
  const validSystems = ['Arc 1960', 'WGS84', 'Minna', 'UTM']
  const hasValidSystem = !!input.coordinatesSystem && 
    validSystems.some((s: any) => input.coordinatesSystem?.toUpperCase().includes(s.toUpperCase()))
  
  checks.push(createCheck(
    'BOUNDARY',
    'Coordinate Reference System',
    'Plan should specify the coordinate reference system used',
    hasValidSystem ? 'INFO' : 'WARNING',
    hasValidSystem,
    `Coordinate system: ${input.coordinatesSystem || 'NOT SPECIFIED'}`,
    hasValidSystem ? 'Coordinate system is specified' : 'Specify CRS (e.g., Arc 1960 / UTM Zone 36)',
    'Survey Regulations 1994 Reg 24'
  ))
  
  return checks
}

function checkBeaconMonumentation(input: PlanInput): PlanCheckResult[] {
  const checks: PlanCheckResult[] = []
  
  const hasBeacons = input.beacons && input.beacons.length > 0
  const beaconCount = input.beacons?.length || 0
  const expectedBeacons = input.coordinates.length
  
  const passed = hasBeacons && beaconCount >= expectedBeacons
  
  checks.push(createCheck(
    'BOUNDARY',
    'Beacon Monumentation',
    'All boundary corners must be marked with beacons',
    passed ? 'INFO' : 'ERROR',
    passed,
    `Beacons: ${beaconCount} found, ${expectedBeacons} expected`,
    passed ? 'All corners appear to be monumented' : 'Ensure all boundary corners have beacons per Survey Regulations',
    'Survey Regulations 1994 Reg 17'
  ))
  
  if (hasBeacons) {
    const hasValidTypes = input.beacons.every(b => 
      ['CB', 'IP', 'WP', 'MN', 'PSC', 'SSC', 'TSC'].includes(b.type)
    )
    checks.push(createCheck(
      'BOUNDARY',
      'Beacon Types',
      'Beacons should be of approved types per Survey Regulations',
      hasValidTypes ? 'INFO' : 'WARNING',
      hasValidTypes,
      `All beacons are of approved types: ${hasValidTypes}`,
      hasValidTypes ? 'Beacon types are compliant' : 'Use approved beacon types: CB, IP, WP, MN, PSC, SSC, TSC',
      'Survey Regulations 1994 Reg 17'
    ))
  }
  
  return checks
}

function checkBoundaryContinuity(input: PlanInput): PlanCheckResult[] {
  const checks: PlanCheckResult[] = []
  
  if (input.coordinates.length < 2) {
    return checks
  }
  
  for (let i = 0; i < input.coordinates.length; i++) {
    const curr = input.coordinates[i]
    const next = input.coordinates[(i + 1) % input.coordinates.length]
    
    const dx = next.easting - curr.easting
    const dy = next.northing - curr.northing
    const distance = Math.sqrt(dx * dx + dy * dy)
    
    if (distance < 0.01) {
      checks.push(createCheck(
        'GEOMETRIC',
        'Boundary Continuity',
        'Check for duplicate or overlapping vertices',
        'ERROR',
        false,
        `Zero-distance segment detected at points ${curr.description} and ${next.description}`,
        'Remove duplicate coordinates',
        'Survey Regulations 1994'
      ))
    }
  }
  
  if (checks.length === 0) {
    checks.push(createCheck(
      'GEOMETRIC',
      'Boundary Continuity',
      'All boundary segments have valid lengths',
      'INFO',
      true,
      'No zero-length or invalid segments detected',
      undefined,
      'Survey Regulations 1994'
    ))
  }
  
  return checks
}

function checkOverlappingBoundaries(input: PlanInput): PlanCheckResult[] {
  const checks: PlanCheckResult[] = []
  
  const segments: { start: Coordinate; end: Coordinate }[] = []
  for (let i = 0; i < input.coordinates.length; i++) {
    segments.push({
      start: input.coordinates[i],
      end: input.coordinates[(i + 1) % input.coordinates.length]
    })
  }
  
  let hasSelfIntersection = false
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 2; j < segments.length; j++) {
      if (i === 0 && j === segments.length - 1) continue
      
      if (segmentsIntersect(segments[i], segments[j])) {
        hasSelfIntersection = true
        break
      }
    }
    if (hasSelfIntersection) break
  }
  
  checks.push(createCheck(
    'GEOMETRIC',
    'Boundary Overlap Check',
    'Check for self-intersecting (complex) boundaries',
    hasSelfIntersection ? 'ERROR' : 'INFO',
    !hasSelfIntersection,
    hasSelfIntersection ? 'Self-intersecting boundary detected' : 'No overlaps detected',
    hasSelfIntersection ? 'Review boundary definition - polygon must be simple' : undefined,
    'Survey Regulations 1994'
  ))
  
  return checks
}

function segmentsIntersect(a: { start: Coordinate; end: Coordinate }, b: { start: Coordinate; end: Coordinate }): boolean {
  const ccw = (A: Coordinate, B: Coordinate, C: Coordinate) => 
    (C.northing - A.northing) * (B.easting - A.easting) > (B.northing - A.northing) * (C.easting - A.easting)
  
  return ccw(a.start, b.start, b.end) !== ccw(a.end, b.start, b.end) &&
         ccw(a.start, a.end, b.start) !== ccw(a.start, a.end, b.end)
}

function checkScaleAccuracy(input: PlanInput): PlanCheckResult[] {
  const checks: PlanCheckResult[] = []
  
  const validScales = [100, 200, 500, 1000, 1250, 2000, 2500, 5000, 10000]
  const hasValidScale = !!input.scale && validScales.includes(input.scale)
  
  checks.push(createCheck(
    'REGULATORY',
    'Standard Scale',
      'Plan should use standard survey scales',
    hasValidScale ? 'INFO' : 'WARNING',
    hasValidScale,
    `Scale: 1:${input.scale || 'NOT SPECIFIED'}`,
    hasValidScale ? 'Scale is standard' : 'Use standard scales: 1:100, 1:200, 1:500, 1:1000, etc.',
    'Survey Regulations 1994 Reg 100'
  ))
  
  return checks
}

function checkNorthArrow(input: PlanInput): PlanCheckResult[] {
  const checks: PlanCheckResult[] = []
  
  checks.push(createCheck(
    'DOCUMENTATION',
    'North Arrow',
    'Plan must show a north arrow indicating orientation',
    input.northArrow ? 'INFO' : 'ERROR',
    !!input.northArrow,
    `North arrow: ${input.northArrow ? 'PRESENT' : 'MISSING'}`,
    input.northArrow ? undefined : 'Add a north arrow to the plan',
    'Survey Regulations 1994 Reg 100'
  ))
  
  return checks
}

function checkLegend(input: PlanInput): PlanCheckResult[] {
  const checks: PlanCheckResult[] = []
  
  checks.push(createCheck(
    'DOCUMENTATION',
    'Legend',
    'Plan should include a legend explaining symbols and abbreviations',
    input.legend ? 'INFO' : 'WARNING',
    !!input.legend,
    `Legend: ${input.legend ? 'PRESENT' : 'MISSING'}`,
    input.legend ? undefined : 'Add a legend explaining all symbols used',
    'Survey Regulations 1994'
  ))
  
  return checks
}

function checkDocumentation(input: PlanInput): PlanCheckResult[] {
  const checks: PlanCheckResult[] = []
  
  const hasSurveyor = !!input.metadata?.surveyorName
  const hasDate = !!input.metadata?.surveyDate
  const hasParcel = !!input.parcelNumber
  const hasTitle = !!input.titleNumber
  
  checks.push(createCheck(
    'DOCUMENTATION',
    'Surveyor Information',
    'Plan should show surveyor name and qualification',
    hasSurveyor ? 'INFO' : 'WARNING',
    hasSurveyor,
    `Surveyor: ${input.metadata?.surveyorName || 'NOT SPECIFIED'}`,
    hasSurveyor ? undefined : 'Include surveyor name and ISK number',
    'Survey Regulations 1994'
  ))
  
  checks.push(createCheck(
    'DOCUMENTATION',
    'Survey Date',
    'Plan should show date of survey',
    hasDate ? 'INFO' : 'WARNING',
    hasDate,
    `Survey date: ${input.metadata?.surveyDate || 'NOT SPECIFIED'}`,
    hasDate ? undefined : 'Include date of survey',
    'Survey Regulations 1994'
  ))
  
  checks.push(createCheck(
    'DOCUMENTATION',
    'Parcel Identification',
    'Plan should show parcel number',
    hasParcel ? 'INFO' : 'ERROR',
    hasParcel,
    `Parcel: ${input.parcelNumber || 'NOT SPECIFIED'}`,
    hasParcel ? undefined : 'Include parcel LR number',
    'Land Registration Act 2012'
  ))
  
  checks.push(createCheck(
    'DOCUMENTATION',
    'Title Reference',
    'Plan should reference the title deed',
    hasTitle ? 'INFO' : 'WARNING',
    hasTitle,
    `Title: ${input.titleNumber || 'NOT SPECIFIED'}`,
    hasTitle ? undefined : 'Include title deed number',
    'Registered Land Act Cap 300'
  ))
  
  return checks
}

function checkEasements(input: PlanInput): PlanCheckResult[] {
  const checks: PlanCheckResult[] = []
  
  if (!input.Easements || input.Easements.length === 0) {
    checks.push(createCheck(
      'BOUNDARY',
      'Easement Check',
      'Check if any easements exist on the parcel',
      'INFO',
      true,
      'No easements shown on plan',
      'Verify with title deed if easements exist',
      'Registered Land Act Cap 300'
    ))
  } else {
    checks.push(createCheck(
      'BOUNDARY',
      'Easement Documentation',
      'Easements must be clearly shown on the plan',
      'INFO',
      true,
      `${input.Easements.length} easements documented`,
      'Ensure easement boundaries are clearly marked',
      'Registered Land Act Cap 300'
    ))
  }
  
  return checks
}

function checkRegulatoryCompliance(input: PlanInput): PlanCheckResult[] {
  const checks: PlanCheckResult[] = []
  
  const hasApproval = !!input.metadata?.approvalDate
  
  checks.push(createCheck(
    'REGULATORY',
    'Survey Approval',
    'Completed surveys require approval from Survey of Kenya or authorized officer',
    hasApproval ? 'INFO' : 'WARNING',
    hasApproval,
    `Approval: ${input.metadata?.approvalDate || 'NOT SPECIFIED'}`,
    hasApproval ? undefined : 'Survey may require approval before registration',
    'Survey Act Cap 299'
  ))
  
  return checks
}
