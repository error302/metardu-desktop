// EDM Correction Engine
// Based on: Basak - Surveying and Levelling, Chapter 3
// Reference: Bannister, Raymond & Baker - Surveying

import type { EDMCorrectionInput, EDMCorrectionResult, CorrectionStep } from '@/types/edmCorrection'

export function computeEDMCorrection(input: EDMCorrectionInput): EDMCorrectionResult {
  const workings: CorrectionStep[] = []
  
  const { measuredDistance, temperature, pressure, humidity, wavelength = 780, elevation, latitude } = input
  
  // Step 1: Calculate saturated vapor pressure (kPa)
  // Tetens formula: e_sat = 6.112 * exp(17.67 * T / (T + 243.5))
  const saturatedVaporPressure = 6.112 * Math.exp(17.67 * temperature / (temperature + 243.5))
  workings.push({
    name: 'Saturated Vapor Pressure',
    formula: 'e_sat = 6.112 × exp(17.67 × T / (T + 243.5))',
    value: saturatedVaporPressure,
    unit: 'kPa'
  })

  // Step 2: Calculate actual vapor pressure
  const actualVaporPressure = (humidity / 100) * saturatedVaporPressure
  workings.push({
    name: 'Actual Vapor Pressure',
    formula: 'e = (humidity/100) × e_sat',
    value: actualVaporPressure,
    unit: 'kPa'
  })

  // Step 3: Calculate refractive index deviation from standard
  // N = 281.8 × P / (273.15 + T) - 11.27 × e / (273.15 + T)
  const refractiveIndex = (281.8 * pressure / (273.15 + temperature)) - (11.27 * actualVaporPressure / (273.15 + temperature))
  workings.push({
    name: 'Refractive Index Deviation',
    formula: 'N = 281.8 × P / (273.15 + T) - 11.27 × e / (273.15 + T)',
    value: refractiveIndex,
    unit: 'ppm'
  })

  // Step 4: Calculate atmospheric correction (ppm)
  // Standard atmospheric condition = 281.77 ppm (for wavelength ~780nm)
  const standardRefractiveIndex = 281.77
  const atmosphericCorrection = refractiveIndex - standardRefractiveIndex
  workings.push({
    name: 'Atmospheric Correction',
    formula: 'K = N - 281.77',
    value: atmosphericCorrection,
    unit: 'ppm'
  })

  // Step 5: Calculate corrected distance
  const correctedDistance = measuredDistance * (1 + atmosphericCorrection / 1_000_000)
  workings.push({
    name: 'Corrected Distance (Atmospheric)',
    formula: 'D_corrected = D_measured × (1 + K/1,000,000)',
    value: correctedDistance,
    unit: 'm'
  })

  let seaLevelCorrection = 0
  if (elevation !== undefined && elevation !== 0) {
    // Sea level correction: -D × h / R (where R = Earth radius ~6,371,000m)
    seaLevelCorrection = -measuredDistance * elevation / 6_371_000
    workings.push({
      name: 'Sea Level Correction',
      formula: 'Δh = -D × elevation / 6,371,000',
      value: seaLevelCorrection,
      unit: 'm'
    })
  }

  let scaleFactor = 1
  if (latitude !== undefined) {
    // Simplified UTM scale factor calculation
    // k = k0 × (1 + p²/2 + p⁴/24) where p = distance from central meridian / R
    const k0 = 0.9996
    // Approximate distance from central meridian (simplified)
    const p = 0 // Would need actual calculation with central meridian
    scaleFactor = k0 * (1 + (p * p) / 2)
    workings.push({
      name: 'UTM Scale Factor',
      formula: 'k = k₀ × (1 + p²/2 + p⁴/24)',
      value: scaleFactor,
      unit: ''
    })
  }

  // Final distance after all corrections
  const finalDistance = correctedDistance + seaLevelCorrection
  workings.push({
    name: 'Final Corrected Distance',
    formula: 'D_final = D_atmospheric + Δh + (D × (k-1))',
    value: finalDistance,
    unit: 'm'
  })

  return {
    measuredDistance,
    atmosphericCorrection,
    correctedDistance,
    seaLevelCorrection: elevation ? seaLevelCorrection : undefined,
    scaleFactor: latitude ? scaleFactor : undefined,
    finalDistance,
    workings
  }
}

// Weather data fetch from Open-Meteo
export async function fetchWeatherData(lat: number, lon: number): Promise<{
  temperature: number
  pressure: number
  humidity: number
  fetchedAt: string
} | null> {
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast')
    url.searchParams.set('latitude', String(lat))
    url.searchParams.set('longitude', String(lon))
    url.searchParams.set('current', 'temperature_2m,surface_pressure,relative_humidity_2m')
    url.searchParams.set('timezone', 'auto')

    const response = await fetch(url.toString())
    if (!response.ok) return null

    const data = await response.json()
    return {
      temperature: data.current.temperature_2m,
      pressure: data.current.surface_pressure,
      humidity: data.current.relative_humidity_2m,
      fetchedAt: new Date().toISOString()
    }
  } catch {
    return null
  }
}
