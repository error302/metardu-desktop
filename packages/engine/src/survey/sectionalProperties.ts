/**
 * @module sectionalProperties
 *
 * Sectional Properties Act Engine — 3D Cadastre for Kenya
 *
 * Implements the Sectional Properties Act (2012) requirements:
 * - Distributes exactly 10,000 unit factors across all units
 * - Unit factors are proportional to individual floor area
 * - Supports exclusive use areas (parking, balconies) vs common property
 * - Generates Form SP-1 (Sectional Plan) data
 *
 * Mathematical basis:
 *   Unit Factor = (Individual Unit Floor Area / Total Floor Area) × 10,000
 *
 * Reference: Sectional Properties Act, 2012 (Kenya)
 *            Survey Act Cap 299 — Sectional Plans Regulations
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UnitType = 'residential' | 'commercial' | 'office' | 'industrial' | 'parking' | 'storage'
export type AreaCategory = 'unit' | 'exclusive_use' | 'common_property'

export interface SectionalUnit {
  id: string
  unitNumber: string // e.g., "A-101", "B-204"
  unitType: UnitType
  floorNumber: number // 0 = ground, 1 = first floor, etc.
  floorAreaSqM: number
  areaCategory: AreaCategory
  ownerName?: string
  description?: string
  /** Calculated unit factor (0-10000) */
  unitFactor?: number
  /** Percentage of total (0-100) */
  percentage?: number
}

export interface SectionalPlan {
  id: string
  parentParcelNumber: string
  parentTitleDeed: string
  parentAreaHectares: number
  buildingName: string
  totalFloors: number
  units: SectionalUnit[]
  /** Sum of all unit floor areas (excluding common property) */
  totalUnitAreaSqM: number
  /** Sum of exclusive use areas */
  totalExclusiveUseAreaSqM: number
  /** Sum of common property areas */
  totalCommonPropertyAreaSqM: number
  /** Total unit factors (must equal 10,000) */
  totalUnitFactors: number
  /** Date of sectional plan preparation */
  preparedDate: string
  surveyorName: string
  surveyorLicense: string
}

export interface UnitFactorCalculation {
  unitId: string
  unitNumber: string
  floorAreaSqM: number
  unitFactor: number
  percentage: number
}

// ---------------------------------------------------------------------------
// Core Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate unit factors for a sectional plan.
 *
 * Per the Sectional Properties Act, exactly 10,000 unit factors must be
 * distributed across all units proportional to their floor area.
 *
 * Exclusive use areas and common property are NOT included in the
 * unit factor calculation — only the actual unit floor areas.
 *
 * @param units - Array of units in the sectional plan
 * @returns Array of unit factor calculations
 *
 * @example
 * ```ts
 * const units = [
 *   { id: '1', unitNumber: 'A-101', floorAreaSqM: 120, areaCategory: 'unit', ... },
 *   { id: '2', unitNumber: 'A-102', floorAreaSqM: 80, areaCategory: 'unit', ... },
 * ]
 * const factors = calculateUnitFactors(units)
 * // factors[0].unitFactor = 6000 (60%)
 * // factors[1].unitFactor = 4000 (40%)
 * ```
 */
export function calculateUnitFactors(units: SectionalUnit[]): UnitFactorCalculation[] {
  // Filter to only 'unit' category (not exclusive use or common property)
  const eligibleUnits = units.filter(u => u.areaCategory === 'unit')

  const totalArea = eligibleUnits.reduce((sum, u) => sum + u.floorAreaSqM, 0)

  if (totalArea === 0) {
    // If no area, distribute equally
    const equalFactor = Math.floor(10000 / eligibleUnits.length)
    const remainder = 10000 - equalFactor * eligibleUnits.length
    return eligibleUnits.map((u, idx) => ({
      unitId: u.id,
      unitNumber: u.unitNumber,
      floorAreaSqM: u.floorAreaSqM,
      unitFactor: equalFactor + (idx === 0 ? remainder : 0),
      percentage: 0,
    }))
  }

  // Calculate raw unit factors
  const rawFactors = eligibleUnits.map(u => ({
    unitId: u.id,
    unitNumber: u.unitNumber,
    floorAreaSqM: u.floorAreaSqM,
    rawFactor: (u.floorAreaSqM / totalArea) * 10000,
  }))

  // Round to integers
  const rounded = rawFactors.map(f => ({
    ...f,
    unitFactor: Math.floor(f.rawFactor),
  }))

  // Distribute remainder to ensure total = exactly 10,000
  const totalRounded = rounded.reduce((sum, f) => sum + f.unitFactor, 0)
  const remainder = 10000 - totalRounded

  if (remainder > 0) {
    // Sort by largest fractional remainder and add 1 to each
    const remainders = rawFactors.map((f, idx) => ({
      idx,
      remainder: f.rawFactor - Math.floor(f.rawFactor),
    }))
    remainders.sort((a, b) => b.remainder - a.remainder)

    for (let i = 0; i < remainder; i++) {
      rounded[remainders[i % remainders.length].idx].unitFactor++
    }
  }

  return rounded.map(f => ({
    unitId: f.unitId,
    unitNumber: f.unitNumber,
    floorAreaSqM: f.floorAreaSqM,
    unitFactor: f.unitFactor,
    percentage: (f.unitFactor / 10000) * 100,
  }))
}

/**
 * Compute the full sectional plan with all calculations.
 */
export function computeSectionalPlan(
  plan: Omit<SectionalPlan, 'totalUnitAreaSqM' | 'totalExclusiveUseAreaSqM' | 'totalCommonPropertyAreaSqM' | 'totalUnitFactors'>
): SectionalPlan {
  const factorCalcs = calculateUnitFactors(plan.units)

  // Update units with calculated factors
  const unitsWithFactors = plan.units.map(u => {
    const calc = factorCalcs.find(c => c.unitId === u.id)
    return calc
      ? { ...u, unitFactor: calc.unitFactor, percentage: calc.percentage }
      : u
  })

  const totalUnitAreaSqM = unitsWithFactors
    .filter(u => u.areaCategory === 'unit')
    .reduce((sum, u) => sum + u.floorAreaSqM, 0)

  const totalExclusiveUseAreaSqM = unitsWithFactors
    .filter(u => u.areaCategory === 'exclusive_use')
    .reduce((sum, u) => sum + u.floorAreaSqM, 0)

  const totalCommonPropertyAreaSqM = unitsWithFactors
    .filter(u => u.areaCategory === 'common_property')
    .reduce((sum, u) => sum + u.floorAreaSqM, 0)

  const totalUnitFactors = factorCalcs.reduce((sum, f) => sum + f.unitFactor, 0)

  return {
    ...plan,
    units: unitsWithFactors,
    totalUnitAreaSqM,
    totalExclusiveUseAreaSqM,
    totalCommonPropertyAreaSqM,
    totalUnitFactors,
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface SectionalPlanValidation {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

export function validateSectionalPlan(plan: SectionalPlan): SectionalPlanValidation {
  const errors: string[] = []
  const warnings: string[] = []

  // Must have at least 2 units
  const units = plan.units.filter(u => u.areaCategory === 'unit')
  if (units.length < 2) {
    errors.push('A sectional plan must have at least 2 units')
  }

  // Unit factors must total exactly 10,000
  if (plan.totalUnitFactors !== 10000) {
    errors.push(`Unit factors must total exactly 10,000 (currently ${plan.totalUnitFactors})`)
  }

  // Each unit must have a unique number
  const unitNumbers = units.map(u => u.unitNumber)
  const duplicates = unitNumbers.filter((n, i) => unitNumbers.indexOf(n) !== i)
  if (duplicates.length > 0) {
    errors.push(`Duplicate unit numbers: ${duplicates.join(', ')}`)
  }

  // Each unit must have positive floor area
  const zeroArea = units.filter(u => u.floorAreaSqM <= 0)
  if (zeroArea.length > 0) {
    errors.push(`${zeroArea.length} unit(s) have zero or negative floor area`)
  }

  // Floor numbers should be sequential
  const floors = [...new Set(units.map(u => u.floorNumber))].sort((a, b) => a - b)
  if (floors.length > 0) {
    const minFloor = floors[0]
    const maxFloor = floors[floors.length - 1]
    for (let f = minFloor; f <= maxFloor; f++) {
      if (!floors.includes(f)) {
        warnings.push(`Floor ${f} has no units — verify this is intentional`)
      }
    }
  }

  // Parent area should accommodate the building footprint
  const parentAreaSqM = plan.parentAreaHectares * 10000
  const totalArea = plan.totalUnitAreaSqM + plan.totalExclusiveUseAreaSqM + plan.totalCommonPropertyAreaSqM
  if (totalArea > parentAreaSqM * plan.totalFloors) {
    warnings.push('Total unit areas exceed parent parcel × floors — verify measurements')
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Form SP-1 Export Data
// ---------------------------------------------------------------------------

export interface FormSP1Data {
  planNumber: string
  parentParcelNumber: string
  parentTitleDeed: string
  buildingName: string
  totalFloors: number
  surveyorName: string
  surveyorLicense: string
  preparedDate: string
  units: Array<{
    unitNumber: string
    floorNumber: number
    unitType: UnitType
    floorAreaSqM: number
    unitFactor: number
    percentage: number
    ownerName?: string
  }>
  exclusiveUseAreas: Array<{
    description: string
    areaSqM: number
    assignedTo: string
  }>
  commonPropertyAreas: Array<{
    description: string
    areaSqM: number
  }>
  totals: {
    totalUnits: number
    totalUnitAreaSqM: number
    totalExclusiveUseAreaSqM: number
    totalCommonPropertyAreaSqM: number
    totalUnitFactors: number
  }
}

export function generateFormSP1Data(plan: SectionalPlan): FormSP1Data {
  const units = plan.units.filter(u => u.areaCategory === 'unit')
  const exclusiveUse = plan.units.filter(u => u.areaCategory === 'exclusive_use')
  const commonProperty = plan.units.filter(u => u.areaCategory === 'common_property')

  return {
    planNumber: `SP-${plan.id.substring(0, 8).toUpperCase()}`,
    parentParcelNumber: plan.parentParcelNumber,
    parentTitleDeed: plan.parentTitleDeed,
    buildingName: plan.buildingName,
    totalFloors: plan.totalFloors,
    surveyorName: plan.surveyorName,
    surveyorLicense: plan.surveyorLicense,
    preparedDate: plan.preparedDate,
    units: units.map(u => ({
      unitNumber: u.unitNumber,
      floorNumber: u.floorNumber,
      unitType: u.unitType,
      floorAreaSqM: u.floorAreaSqM,
      unitFactor: u.unitFactor || 0,
      percentage: u.percentage || 0,
      ownerName: u.ownerName,
    })),
    exclusiveUseAreas: exclusiveUse.map(u => ({
      description: u.description || u.unitNumber,
      areaSqM: u.floorAreaSqM,
      assignedTo: u.ownerName || '—',
    })),
    commonPropertyAreas: commonProperty.map(u => ({
      description: u.description || u.unitNumber,
      areaSqM: u.floorAreaSqM,
    })),
    totals: {
      totalUnits: units.length,
      totalUnitAreaSqM: plan.totalUnitAreaSqM,
      totalExclusiveUseAreaSqM: plan.totalExclusiveUseAreaSqM,
      totalCommonPropertyAreaSqM: plan.totalCommonPropertyAreaSqM,
      totalUnitFactors: plan.totalUnitFactors,
    },
  }
}
