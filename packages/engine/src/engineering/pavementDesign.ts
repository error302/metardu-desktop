// METARDU Pavement Layer Design
// Source: KeNHA Pavement and Materials Design Manual
// Source: AASHTO 1993 Guide for Design of Pavement Structures
// Source: TRH4 (South Africa) — referenced in East Africa

// ─── TYPES ─────────────────────────────────────────────────────────────────────

export interface TrafficData {
  aadt: number
  heavyVehiclePercentage: number
  growthRate: number
  designPeriod: number
  directionalSplit: number
  laneFactor: number
  numberOfLanes: number
  vehicleDamageFactor?: number
}

export interface SubgradeData {
  cbr: number
  soilType?: string
  plasticityIndex?: number
  liquidLimit?: number
  optimumMoisture?: number
  maxDryDensity?: number
}

export interface PavementLayer {
  name: string
  material: string
  thicknessMm: number
  description: string
  color: string
}

export interface PavementDesignResult {
  esa: number
  esaMillions: number
  trafficClass: string
  subgradeClass: string
  layers: PavementLayer[]
  totalThickness: number
  reliability: number
  standardDeviation: number
  designCBR: number
  steps: Array<{ description: string; formula: string; value: string }>
}

export interface LayerQuantity {
  layer: string
  material: string
  volumeM3: number
  tonnage: number
  density: number
}

// ─── TRAFFIC CLASSIFICATION ────────────────────────────────────────────────────

export function computeESA(traffic: TrafficData): { esa: number; esaMillions: number; steps: Array<{ description: string; formula: string; value: string }> } {
  const { aadt, heavyVehiclePercentage, growthRate, designPeriod, directionalSplit, laneFactor, vehicleDamageFactor = 1.0 } = traffic

  const dailyHeavyVehicles = aadt * (heavyVehiclePercentage / 100)
  const directionalHeavy = dailyHeavyVehicles * directionalSplit
  const laneHeavy = directionalHeavy * laneFactor
  const annualESA = laneHeavy * vehicleDamageFactor * 365

  // Cumulative ESA over design period with growth: sum = Y * firstTerm * ((1+g)^Y - 1) / (g*Y)
  // Simplified: esa = annualESA * designPeriod * ((1+g)^designPeriod - 1) / (g * designPeriod)
  const g = growthRate / 100
  let cumulativeFactor: number
  if (g === 0) {
    cumulativeFactor = designPeriod
  } else {
    cumulativeFactor = ((Math.pow(1 + g, designPeriod) - 1) / g)
  }

  const esa = annualESA * cumulativeFactor
  const esaMillions = esa / 1_000_000

  const steps = [
    { description: 'Daily heavy vehicles', formula: `AADT x HV% = ${aadt} x ${heavyVehiclePercentage}%`, value: `${dailyHeavyVehicles.toFixed(0)} veh/day` },
    { description: 'Directional split', formula: `${dailyHeavyVehicles.toFixed(0)} x ${directionalSplit}`, value: `${directionalHeavy.toFixed(0)} veh/day/dir` },
    { description: 'Lane distribution', formula: `${directionalHeavy.toFixed(0)} x ${laneFactor}`, value: `${laneHeavy.toFixed(0)} veh/day/lane` },
    { description: 'Annual ESA (1 lane)', formula: `${laneHeavy.toFixed(0)} x VDF(${vehicleDamageFactor}) x 365`, value: `${annualESA.toFixed(0)} ESA/year` },
    { description: `Growth factor (${designPeriod}yr, ${growthRate}%/yr)`, formula: `((1+${g})^${designPeriod} - 1) / ${g}`, value: `${cumulativeFactor.toFixed(2)}` },
    { description: 'Cumulative ESA', formula: `${annualESA.toFixed(0)} x ${cumulativeFactor.toFixed(2)}`, value: `${esa.toFixed(0)} ESA` },
    { description: 'ESA (millions)', formula: `${esa.toFixed(0)} / 1,000,000`, value: `${esaMillions.toFixed(3)} M ESA` },
  ]

  return { esa, esaMillions, steps }
}

export function classifyTraffic(esaMillions: number): string {
  if (esaMillions > 30) return 'T1'
  if (esaMillions > 10) return 'T2'
  if (esaMillions > 3) return 'T3'
  if (esaMillions > 1) return 'T4'
  if (esaMillions > 0.3) return 'T5'
  return 'T6'
}

export function classifySubgrade(cbr: number): string {
  if (cbr > 15) return 'SG1'
  if (cbr > 7) return 'SG2'
  if (cbr > 3) return 'SG3'
  return 'SG4'
}

// ─── PAVEMENT DESIGN CATALOG ──────────────────────────────────────────────────
// KeNHA/TRH4 based catalog: 6 traffic classes x 4 subgrade classes = 24 entries

const PAVEMENT_CATALOG: Record<string, PavementLayer[]> = {
  // T1: > 30M ESA (heavy national highways)
  'T1-SG1': [
    { name: 'Wearing Course', material: 'Asphalt Concrete (AC14)', thicknessMm: 50, description: 'Continuous grade AC14', color: '#1e40af' },
    { name: 'Base Course', material: 'Crushed Stone (G40)', thicknessMm: 150, description: 'Granular base G40', color: '#6b7280' },
    { name: 'Sub-base', material: 'Crushed Stone (G35)', thicknessMm: 200, description: 'Granular sub-base G35', color: '#9ca3af' },
  ],
  'T1-SG2': [
    { name: 'Wearing Course', material: 'Asphalt Concrete (AC14)', thicknessMm: 50, description: 'Continuous grade AC14', color: '#1e40af' },
    { name: 'Base Course', material: 'Cement Treated Base (CTB)', thicknessMm: 150, description: 'CTB 3-5% cement', color: '#6b7280' },
    { name: 'Sub-base', material: 'Crushed Stone (G35)', thicknessMm: 200, description: 'Granular sub-base G35', color: '#9ca3af' },
    { name: 'Selected Layer', material: 'Natural Gravel (G30)', thicknessMm: 150, description: 'Selected subgrade material', color: '#d1d5db' },
  ],
  'T1-SG3': [
    { name: 'Wearing Course', material: 'Asphalt Concrete (AC20)', thicknessMm: 50, description: 'Continuous grade AC20', color: '#1e40af' },
    { name: 'Binder Course', material: 'Asphalt Base (AC28)', thicknessMm: 50, description: 'Asphalt base AC28', color: '#3730a3' },
    { name: 'Base Course', material: 'Cement Treated Base (CTB)', thicknessMm: 200, description: 'CTB 4-6% cement', color: '#6b7280' },
    { name: 'Sub-base', material: 'Crushed Stone (G35)', thicknessMm: 200, description: 'Granular sub-base G35', color: '#9ca3af' },
    { name: 'Selected Layer', material: 'Natural Gravel (G30)', thicknessMm: 200, description: 'Selected subgrade material', color: '#d1d5db' },
  ],
  'T1-SG4': [
    { name: 'Wearing Course', material: 'Asphalt Concrete (AC20)', thicknessMm: 50, description: 'Continuous grade AC20', color: '#1e40af' },
    { name: 'Binder Course', material: 'Asphalt Base (AC28)', thicknessMm: 50, description: 'Asphalt base AC28', color: '#3730a3' },
    { name: 'Base Course', material: 'Cement Treated Base (CTB)', thicknessMm: 200, description: 'CTB 5-7% cement', color: '#6b7280' },
    { name: 'Sub-base', material: 'Cement Treated Sub-base', thicknessMm: 200, description: 'CTS 2-3% cement', color: '#9ca3af' },
    { name: 'Selected Layer', material: 'Natural Gravel (G30)', thicknessMm: 200, description: 'Selected subgrade material', color: '#d1d5db' },
  ],

  // T2: 10-30M ESA
  'T2-SG1': [
    { name: 'Wearing Course', material: 'Asphalt Concrete (AC14)', thicknessMm: 40, description: 'Continuous grade AC14', color: '#1e40af' },
    { name: 'Base Course', material: 'Crushed Stone (G40)', thicknessMm: 150, description: 'Granular base G40', color: '#6b7280' },
    { name: 'Sub-base', material: 'Crushed Stone (G35)', thicknessMm: 150, description: 'Granular sub-base G35', color: '#9ca3af' },
  ],
  'T2-SG2': [
    { name: 'Wearing Course', material: 'Asphalt Concrete (AC14)', thicknessMm: 40, description: 'Continuous grade AC14', color: '#1e40af' },
    { name: 'Base Course', material: 'Crushed Stone (G40)', thicknessMm: 150, description: 'Granular base G40', color: '#6b7280' },
    { name: 'Sub-base', material: 'Crushed Stone (G35)', thicknessMm: 200, description: 'Granular sub-base G35', color: '#9ca3af' },
    { name: 'Selected Layer', material: 'Natural Gravel (G30)', thicknessMm: 150, description: 'Selected subgrade material', color: '#d1d5db' },
  ],
  'T2-SG3': [
    { name: 'Wearing Course', material: 'Asphalt Concrete (AC14)', thicknessMm: 40, description: 'Continuous grade AC14', color: '#1e40af' },
    { name: 'Base Course', material: 'Cement Treated Base (CTB)', thicknessMm: 150, description: 'CTB 3-5% cement', color: '#6b7280' },
    { name: 'Sub-base', material: 'Crushed Stone (G35)', thicknessMm: 200, description: 'Granular sub-base G35', color: '#9ca3af' },
    { name: 'Selected Layer', material: 'Natural Gravel (G30)', thicknessMm: 200, description: 'Selected subgrade material', color: '#d1d5db' },
  ],
  'T2-SG4': [
    { name: 'Wearing Course', material: 'Asphalt Concrete (AC20)', thicknessMm: 50, description: 'Continuous grade AC20', color: '#1e40af' },
    { name: 'Base Course', material: 'Cement Treated Base (CTB)', thicknessMm: 200, description: 'CTB 4-6% cement', color: '#6b7280' },
    { name: 'Sub-base', material: 'Cement Treated Sub-base', thicknessMm: 200, description: 'CTS 2-3% cement', color: '#9ca3af' },
    { name: 'Selected Layer', material: 'Natural Gravel (G30)', thicknessMm: 200, description: 'Selected subgrade material', color: '#d1d5db' },
  ],

  // T3: 3-10M ESA
  'T3-SG1': [
    { name: 'Surfacing', material: 'Double Bituminous Surface Treatment (DBST)', thicknessMm: 40, description: '2-coat DBST + precoats', color: '#1e40af' },
    { name: 'Base Course', material: 'Crushed Stone (G40)', thicknessMm: 100, description: 'Granular base G40', color: '#6b7280' },
    { name: 'Sub-base', material: 'Crushed Stone (G35)', thicknessMm: 150, description: 'Granular sub-base G35', color: '#9ca3af' },
  ],
  'T3-SG2': [
    { name: 'Surfacing', material: 'Double Bituminous Surface Treatment (DBST)', thicknessMm: 40, description: '2-coat DBST + precoats', color: '#1e40af' },
    { name: 'Base Course', material: 'Crushed Stone (G40)', thicknessMm: 100, description: 'Granular base G40', color: '#6b7280' },
    { name: 'Sub-base', material: 'Crushed Stone (G35)', thicknessMm: 200, description: 'Granular sub-base G35', color: '#9ca3af' },
  ],
  'T3-SG3': [
    { name: 'Surfacing', material: 'Asphalt Concrete (AC14)', thicknessMm: 40, description: 'Continuous grade AC14', color: '#1e40af' },
    { name: 'Base Course', material: 'Cement Treated Base (CTB)', thicknessMm: 150, description: 'CTB 3-5% cement', color: '#6b7280' },
    { name: 'Sub-base', material: 'Crushed Stone (G35)', thicknessMm: 200, description: 'Granular sub-base G35', color: '#9ca3af' },
    { name: 'Selected Layer', material: 'Natural Gravel (G30)', thicknessMm: 150, description: 'Selected subgrade material', color: '#d1d5db' },
  ],
  'T3-SG4': [
    { name: 'Surfacing', material: 'Asphalt Concrete (AC14)', thicknessMm: 40, description: 'Continuous grade AC14', color: '#1e40af' },
    { name: 'Base Course', material: 'Cement Treated Base (CTB)', thicknessMm: 150, description: 'CTB 3-5% cement', color: '#6b7280' },
    { name: 'Sub-base', material: 'Crushed Stone (G35)', thicknessMm: 200, description: 'Granular sub-base G35', color: '#9ca3af' },
    { name: 'Selected Layer', material: 'Natural Gravel (G30)', thicknessMm: 200, description: 'Selected subgrade material', color: '#d1d5db' },
  ],

  // T4: 1-3M ESA
  'T4-SG1': [
    { name: 'Surfacing', material: 'Single Bituminous Surface Treatment (SBST)', thicknessMm: 25, description: '1-coat SBST', color: '#1e40af' },
    { name: 'Base Course', material: 'Crushed Stone (G40)', thicknessMm: 100, description: 'Granular base G40', color: '#6b7280' },
    { name: 'Sub-base', material: 'Natural Gravel (G30)', thicknessMm: 150, description: 'Gravel sub-base G30', color: '#9ca3af' },
  ],
  'T4-SG2': [
    { name: 'Surfacing', material: 'Single Bituminous Surface Treatment (SBST)', thicknessMm: 25, description: '1-coat SBST', color: '#1e40af' },
    { name: 'Base Course', material: 'Crushed Stone (G40)', thicknessMm: 100, description: 'Granular base G40', color: '#6b7280' },
    { name: 'Sub-base', material: 'Natural Gravel (G30)', thicknessMm: 200, description: 'Gravel sub-base G30', color: '#9ca3af' },
  ],
  'T4-SG3': [
    { name: 'Surfacing', material: 'Double Bituminous Surface Treatment (DBST)', thicknessMm: 40, description: '2-coat DBST', color: '#1e40af' },
    { name: 'Base Course', material: 'Crushed Stone (G40)', thicknessMm: 100, description: 'Granular base G40', color: '#6b7280' },
    { name: 'Sub-base', material: 'Natural Gravel (G30)', thicknessMm: 200, description: 'Gravel sub-base G30', color: '#9ca3af' },
    { name: 'Selected Layer', material: 'Natural Gravel (G25)', thicknessMm: 150, description: 'Selected subgrade material', color: '#d1d5db' },
  ],
  'T4-SG4': [
    { name: 'Surfacing', material: 'Double Bituminous Surface Treatment (DBST)', thicknessMm: 40, description: '2-coat DBST', color: '#1e40af' },
    { name: 'Base Course', material: 'Cement Treated Base (CTB)', thicknessMm: 150, description: 'CTB 3-5% cement', color: '#6b7280' },
    { name: 'Sub-base', material: 'Crushed Stone (G35)', thicknessMm: 200, description: 'Granular sub-base G35', color: '#9ca3af' },
    { name: 'Selected Layer', material: 'Natural Gravel (G25)', thicknessMm: 200, description: 'Selected subgrade material', color: '#d1d5db' },
  ],

  // T5: 0.3-1M ESA
  'T5-SG1': [
    { name: 'Surfacing', material: 'Otta Seal', thicknessMm: 20, description: 'Otta seal surface', color: '#1e40af' },
    { name: 'Base Course', material: 'Natural Gravel (G40)', thicknessMm: 100, description: 'Gravel base G40', color: '#6b7280' },
  ],
  'T5-SG2': [
    { name: 'Surfacing', material: 'Otta Seal', thicknessMm: 20, description: 'Otta seal surface', color: '#1e40af' },
    { name: 'Base Course', material: 'Crushed Stone (G40)', thicknessMm: 100, description: 'Granular base G40', color: '#6b7280' },
    { name: 'Sub-base', material: 'Natural Gravel (G30)', thicknessMm: 150, description: 'Gravel sub-base G30', color: '#9ca3af' },
  ],
  'T5-SG3': [
    { name: 'Surfacing', material: 'Single Bituminous Surface Treatment', thicknessMm: 25, description: '1-coat SBST', color: '#1e40af' },
    { name: 'Base Course', material: 'Crushed Stone (G40)', thicknessMm: 100, description: 'Granular base G40', color: '#6b7280' },
    { name: 'Sub-base', material: 'Natural Gravel (G30)', thicknessMm: 200, description: 'Gravel sub-base G30', color: '#9ca3af' },
  ],
  'T5-SG4': [
    { name: 'Surfacing', material: 'Double Bituminous Surface Treatment', thicknessMm: 40, description: '2-coat DBST', color: '#1e40af' },
    { name: 'Base Course', material: 'Crushed Stone (G40)', thicknessMm: 100, description: 'Granular base G40', color: '#6b7280' },
    { name: 'Sub-base', material: 'Natural Gravel (G30)', thicknessMm: 200, description: 'Gravel sub-base G30', color: '#9ca3af' },
    { name: 'Selected Layer', material: 'Natural Gravel (G25)', thicknessMm: 150, description: 'Selected subgrade material', color: '#d1d5db' },
  ],

  // T6: < 0.3M ESA (low volume)
  'T6-SG1': [
    { name: 'Surfacing', material: 'Gravel Wearing Course', thicknessMm: 150, description: 'Natural gravel, maintained', color: '#92400e' },
  ],
  'T6-SG2': [
    { name: 'Surfacing', material: 'Gravel Wearing Course', thicknessMm: 150, description: 'Natural gravel, maintained', color: '#92400e' },
  ],
  'T6-SG3': [
    { name: 'Surfacing', material: 'Gravel Wearing Course', thicknessMm: 200, description: 'Improved gravel, maintained', color: '#92400e' },
    { name: 'Base', material: 'Natural Gravel (G30)', thicknessMm: 150, description: 'Gravel base G30', color: '#6b7280' },
  ],
  'T6-SG4': [
    { name: 'Surfacing', material: 'Gravel Wearing Course', thicknessMm: 200, description: 'Improved gravel, maintained', color: '#92400e' },
    { name: 'Base', material: 'Natural Gravel (G30)', thicknessMm: 150, description: 'Gravel base G30', color: '#6b7280' },
    { name: 'Sub-base', material: 'Natural Gravel (G25)', thicknessMm: 200, description: 'Selected gravel', color: '#9ca3af' },
  ],
}

// ─── MAIN DESIGN FUNCTION ─────────────────────────────────────────────────────

export function designPavement(traffic: TrafficData, subgrade: SubgradeData): PavementDesignResult {
  // Compute ESA
  const { esa, esaMillions, steps: esaSteps } = computeESA(traffic)

  // Classify
  const trafficClass = classifyTraffic(esaMillions)
  const subgradeClass = classifySubgrade(subgrade.cbr)

  // Lookup catalog
  const key = `${trafficClass}-${subgradeClass}`
  const layers = PAVEMENT_CATALOG[key] || PAVEMENT_CATALOG['T4-SG2'] // fallback

  const totalThickness = layers.reduce((sum, l) => sum + l.thicknessMm, 0)

  const steps = [
    ...esaSteps,
    { description: 'Traffic classification', formula: `${esaMillions.toFixed(3)}M ESA`, value: `${trafficClass}` },
    { description: 'Subgrade classification', formula: `CBR = ${subgrade.cbr}%`, value: `${subgradeClass}` },
    { description: 'Catalog lookup', formula: `${trafficClass}-${subgradeClass}`, value: `${layers.length} layers, ${totalThickness}mm total` },
  ]

  return {
    esa,
    esaMillions,
    trafficClass,
    subgradeClass,
    layers,
    totalThickness,
    reliability: 85,
    standardDeviation: totalThickness * 0.08, // ~8% variability
    designCBR: subgrade.cbr,
    steps,
  }
}

// ─── MATERIAL QUANTITIES ──────────────────────────────────────────────────────

const MATERIAL_DENSITIES: Record<string, number> = {
  'Asphalt Concrete (AC14)': 2400,
  'Asphalt Concrete (AC20)': 2400,
  'Asphalt Base (AC28)': 2400,
  'Crushed Stone (G40)': 2200,
  'Crushed Stone (G35)': 2150,
  'Natural Gravel (G30)': 2000,
  'Natural Gravel (G40)': 2100,
  'Natural Gravel (G25)': 1950,
  'Cement Treated Base (CTB)': 2300,
  'Cement Treated Sub-base': 2200,
  'Double Bituminous Surface Treatment (DBST)': 2300,
  'Single Bituminous Surface Treatment (SBST)': 2300,
  'Otta Seal': 2100,
  'Gravel Wearing Course': 1900,
}

export function computeLayerQuantities(
  layers: PavementLayer[],
  roadLengthM: number,
  carriagewayWidthM: number
): LayerQuantity[] {
  const areaM2 = roadLengthM * carriagewayWidthM

  return layers.map(layer => {
    const thicknessM = layer.thicknessMm / 1000
    const volumeM3 = areaM2 * thicknessM
    const density = MATERIAL_DENSITIES[layer.material] || 2000
    const tonnage = volumeM3 * density

    return {
      layer: layer.name,
      material: layer.material,
      volumeM3: Math.round(volumeM3 * 10) / 10,
      tonnage: Math.round(tonnage),
      density,
    }
  })
}
