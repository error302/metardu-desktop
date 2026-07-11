// METARDU Drainage Design Module
// Source: RDM 1.3 Section 6 (Drainage)
// Source: KeNHA Drainage Design Manual
// Source: BS EN 752:2008

// ─── TYPES ─────────────────────────────────────────────────────────────────────

export interface PipeInput {
  diameter: number        // mm
  manningN: number
  slope: number           // m/m (e.g., 0.005 for 0.5%)
  flowDepth?: number      // mm (if not full bore)
}

export interface PipeCapacity {
  fullBoreCapacity: number   // m³/s
  fullBoreVelocity: number   // m/s
  timeOfConcentration: number // min estimate
  isSelfCleansing: boolean
  minSelfCleansingGradient: number
  isVelocityAcceptable: boolean
}

export interface CatchmentInput {
  area: number            // hectares
  runoffCoefficient: number // 0-1
  rainfallIntensity: number // mm/hr
  timeOfConcentration: number // min
}

export interface CatchmentResult {
  peakFlow: number        // m³/s
  catchmentArea: number
  effectiveArea: number
  returnPeriod: string
}

export interface ChannelInput {
  bedWidth: number        // m
  sideSlope: number       // H:V (e.g., 1.5)
  manningN: number
  slope: number           // m/m
  flowDepth: number       // m
}

export interface ChannelCapacity {
  flowArea: number
  wettedPerimeter: number
  hydraulicRadius: number
  velocity: number
  discharge: number
  topWidth: number
  isSelfCleansing: boolean
}

// ─── MANNING'S N VALUES ───────────────────────────────────────────────────────

export const MANNING_N: Record<string, number> = {
  'Concrete pipe': 0.013,
  'HDPE': 0.011,
  'uPVC': 0.011,
  'VCP': 0.013,
  'Corrugated steel': 0.024,
  'Concrete channel': 0.015,
  'Earth channel': 0.025,
  'Grass channel': 0.035,
  'Stone lining': 0.025,
  'Masonry': 0.017,
}

// ─── RUNOFF COEFFICIENTS ──────────────────────────────────────────────────────

export const RUNOFF_COEFFICIENTS: Record<string, { min: number; max: number; typical: number }> = {
  'Asphalt/Concrete': { min: 0.85, max: 0.95, typical: 0.90 },
  'Paved': { min: 0.75, max: 0.85, typical: 0.80 },
  'Gravel': { min: 0.35, max: 0.70, typical: 0.50 },
  'Bare earth': { min: 0.20, max: 0.40, typical: 0.30 },
  'Grass/Park': { min: 0.10, max: 0.25, typical: 0.15 },
  'Forest': { min: 0.05, max: 0.15, typical: 0.10 },
  'Commercial': { min: 0.70, max: 0.95, typical: 0.85 },
  'Residential': { min: 0.40, max: 0.70, typical: 0.55 },
  'Industrial': { min: 0.50, max: 0.80, typical: 0.65 },
  'Agriculture': { min: 0.15, max: 0.45, typical: 0.25 },
}

// ─── STANDARD PIPE SIZES (mm) ────────────────────────────────────────────────

export const STANDARD_PIPE_SIZES = [100, 150, 200, 225, 300, 375, 450, 525, 600, 675, 750, 900, 1050, 1200, 1350, 1500]

// ─── PIPE HYDRAULICS ─────────────────────────────────────────────────────────

export function manningPipeCapacity(input: PipeInput): PipeCapacity {
  const { diameter, manningN, slope, flowDepth } = input
  const D = diameter / 1000 // mm to m

  // Full bore calculations
  const area = Math.PI * D * D / 4
  const wettedPerimeter = Math.PI * D
  const hydraulicRadius = D / 4

  const velocity = (1 / manningN) * Math.pow(hydraulicRadius, 2 / 3) * Math.pow(slope, 0.5)
  const capacity = velocity * area

  // Min slope for self-cleansing (V >= 0.6 m/s per RDM 1.3)
  const minSlope = Math.pow(0.6 * manningN / Math.pow(hydraulicRadius, 2 / 3), 2)

  // Max velocity check (V < 3.0 m/s for concrete, higher for HDPE/uPVC)
  const maxVelocity = manningN <= 0.012 ? 5.0 : 3.0

  return {
    fullBoreCapacity: Math.round(capacity * 10000) / 10000,
    fullBoreVelocity: Math.round(velocity * 1000) / 1000,
    timeOfConcentration: Math.round((D * 1000 / velocity / 60) * 10) / 10, // rough estimate in minutes
    isSelfCleansing: velocity >= 0.6,
    minSelfCleansingGradient: Math.round(minSlope * 100000) / 100000,
    isVelocityAcceptable: velocity < maxVelocity,
  }
}

export function minPipeSlope(diameterMm: number, manningN: number, minVelocity: number = 0.6): number {
  const D = diameterMm / 1000
  const R = D / 4
  return Math.pow(minVelocity * manningN / Math.pow(R, 2 / 3), 2)
}

// ─── CATCHMENT / RATIONAL METHOD ─────────────────────────────────────────────

export function rationalMethodCatchment(input: CatchmentInput): CatchmentResult {
  const { area, runoffCoefficient, rainfallIntensity, timeOfConcentration } = input

  // Q = (C × I × A) / 360
  // Converts mm/hr × ha to m³/s: divide by 3.6 × 100
  const peakFlow = (runoffCoefficient * rainfallIntensity * area) / 360

  // Return period recommendation (RDM 1.3)
  const isUrban = runoffCoefficient > 0.5
  const returnPeriod = isUrban ? '1 in 50 years' : '1 in 25 years'

  return {
    peakFlow: Math.round(peakFlow * 10000) / 10000,
    catchmentArea: area,
    effectiveArea: Math.round(runoffCoefficient * area * 100) / 100,
    returnPeriod,
  }
}

// ─── PIPE SIZING ──────────────────────────────────────────────────────────────

export function sizePipe(
  peakFlow: number,
  manningN: number,
  slope: number,
  fillRatio: number = 0.75
): { diameter: number; velocity: number; capacity: number; isSelfCleansing: boolean } | null {
  if (peakFlow <= 0 || slope <= 0) return null

  for (const diameter of STANDARD_PIPE_SIZES) {
    const result = manningPipeCapacity({ diameter, manningN, slope })

    // At partial fill, capacity ≈ full × flowRatio
    // Simplified: for fillRatio, capacity ≈ full × (theta - sin(theta)) / (2*pi)
    // More accurate: use hydraulic elements chart approximation
    const partialCapacity = result.fullBoreCapacity * (0.85 + 0.15 * fillRatio) // reasonable approximation

    if (partialCapacity >= peakFlow && result.isSelfCleansing) {
      return {
        diameter,
        velocity: result.fullBoreVelocity,
        capacity: result.fullBoreCapacity,
        isSelfCleansing: result.isSelfCleansing,
      }
    }
  }

  return null // no standard size sufficient
}

// ─── CHANNEL HYDRAULICS (TRAPEZOIDAL) ────────────────────────────────────────

export function manningChannelCapacity(input: ChannelInput): ChannelCapacity {
  const { bedWidth, sideSlope, manningN, slope, flowDepth } = input

  const y = flowDepth
  const z = sideSlope

  // Trapezoidal channel geometry
  const flowArea = (bedWidth + z * y) * y
  const wettedPerimeter = bedWidth + 2 * y * Math.sqrt(1 + z * z)
  const hydraulicRadius = flowArea / wettedPerimeter
  const topWidth = bedWidth + 2 * z * y

  const velocity = (1 / manningN) * Math.pow(hydraulicRadius, 2 / 3) * Math.pow(slope, 0.5)
  const discharge = velocity * flowArea

  return {
    flowArea: Math.round(flowArea * 10000) / 10000,
    wettedPerimeter: Math.round(wettedPerimeter * 10000) / 10000,
    hydraulicRadius: Math.round(hydraulicRadius * 10000) / 10000,
    velocity: Math.round(velocity * 1000) / 1000,
    discharge: Math.round(discharge * 10000) / 10000,
    topWidth: Math.round(topWidth * 100) / 100,
    isSelfCleansing: velocity >= 0.6,
  }
}

// ─── HYDRAULIC GRADIENT CHECK ────────────────────────────────────────────────

export function checkPipeGradient(
  pipeDiameterMm: number,
  manningN: number,
  peakFlow: number
): { requiredGradient: number; velocityAtGradient: number; isAdequate: boolean } {
  if (peakFlow <= 0) return { requiredGradient: 0, velocityAtGradient: 0, isAdequate: false }

  const D = pipeDiameterMm / 1000
  const R = D / 4
  const A = Math.PI * D * D / 4

  // Rearranged Manning's for slope: V = Q/A, S = (V*n/R^(2/3))^2
  const V = peakFlow / A
  const S = Math.pow(V * manningN / Math.pow(R, 2 / 3), 2)

  return {
    requiredGradient: Math.round(S * 100000) / 100000,
    velocityAtGradient: Math.round(V * 1000) / 1000,
    isAdequate: V >= 0.6 && V <= 3.0,
  }
}
