import { geographicToUTM, utmToGeographic } from '@/lib/geodesy/coordinates'
import { decimalToDMS, dmsToDecimal } from '@/lib/engine/angles'
import type { DMS } from '@/lib/engine/types'
import { createSolutionV1, solveWithSteps, type Solved, type Solution } from '@/lib/engine/solution/solutionBuilder'
import { fullNumber } from '@/lib/solution/format'

export function utmToGeographicSolved(input: {
  easting: number
  northing: number
  zone: number
  hemisphere: 'N' | 'S'
}): Solved<ReturnType<typeof utmToGeographic>> & { solution: Solution } {
  const r = utmToGeographic(input.easting, input.northing, input.zone, input.hemisphere)
  const latDms = decimalToDMS(r.lat, true)
  const lonDms = decimalToDMS(r.lon, false)
  const latStr = `${latDms.degrees}° ${latDms.minutes}' ${latDms.seconds.toFixed(3)}" ${latDms.direction}`
  const lonStr = `${lonDms.degrees}° ${lonDms.minutes}' ${lonDms.seconds.toFixed(3)}" ${lonDms.direction}`

  const solution = createSolutionV1({
    title: 'UTM → Geographic (WGS84)',
    given: [
      { label: 'Easting', value: `${fullNumber(input.easting)} m` },
      { label: 'Northing', value: `${fullNumber(input.northing)} m` },
      { label: 'Zone', value: `${input.zone}${input.hemisphere}` },
    ],
    toFind: ['Latitude', 'Longitude'],
    solution: [
      {
        title: 'Ellipsoidal Transverse Mercator (UTM)',
        formula: 'WGS84 UTM inverse projection (full ellipsoid)',
        substitution: `E=${fullNumber(input.easting)}, N=${fullNumber(input.northing)}, Zone=${input.zone}, Hemisphere=${input.hemisphere}`,
        computation: `lat=${fullNumber(r.lat)}°, lon=${fullNumber(r.lon)}°`,
      },
      {
        title: 'Format (DMS)',
        formula: 'Convert decimal degrees to DMS for display',
        computation: `lat=${latStr}, lon=${lonStr}`,
      },
    ],
    result: [
      { label: 'Latitude (decimal)', value: `${r.lat.toFixed(8)}°` },
      { label: 'Longitude (decimal)', value: `${r.lon.toFixed(8)}°` },
      { label: 'Latitude (DMS)', value: latStr },
      { label: 'Longitude (DMS)', value: lonStr },
    ],
  })

  return solveWithSteps(r, solution)
}

export function utmToGeographicSolution(input: {
  easting: number
  northing: number
  zone: number
  hemisphere: 'N' | 'S'
}): Solution {
  return utmToGeographicSolved(input).solution
}

export function geographicToUtmSolved(input: { lat: number; lon: number }): Solved<ReturnType<typeof geographicToUTM>> & { solution: Solution } {
  const r = geographicToUTM(input.lat, input.lon)
  const solution = createSolutionV1({
    title: 'Geographic → UTM (WGS84)',
    given: [
      { label: 'Latitude', value: `${fullNumber(input.lat)}°` },
      { label: 'Longitude', value: `${fullNumber(input.lon)}°` },
    ],
    toFind: ['UTM Zone + hemisphere', 'Easting', 'Northing'],
    solution: [
      {
        title: 'Ellipsoidal Transverse Mercator (UTM)',
        formula: 'WGS84 UTM forward projection (full ellipsoid)',
        substitution: `lat=${fullNumber(input.lat)}°, lon=${fullNumber(input.lon)}°`,
        computation: `Zone=${r.zone}${r.hemisphere}, E=${fullNumber(r.easting)} m, N=${fullNumber(r.northing)} m`,
      },
    ],
    result: [
      { label: 'Zone', value: `${r.zone}${r.hemisphere}` },
      { label: 'Easting', value: `${r.easting.toFixed(4)} m` },
      { label: 'Northing', value: `${r.northing.toFixed(4)} m` },
    ],
  })

  return solveWithSteps(r, solution)
}

export function geographicToUtmSolution(input: { lat: number; lon: number }): Solution {
  return geographicToUtmSolved(input).solution
}

function parseDmsLike(input: string, isLatitude: boolean): DMS | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const dirMatch = trimmed.match(/([NSEW])\s*$/i)
  const dir = dirMatch ? (dirMatch[1].toUpperCase() as DMS['direction']) : null
  const cleaned = trimmed.replace(/[NSEW]$/i, '').replace(/[°'"]/g, ' ').trim().replace(/\s+/g, ' ')
  const parts = cleaned.split(' ')

  if (parts.length === 1) {
    const dec = Number(parts[0])
    if (!isFinite(dec)) return null
    return decimalToDMS(dec, isLatitude)
  }

  if (parts.length < 3) return null
  const degrees = Number(parts[0])
  const minutes = Number(parts[1])
  const seconds = Number(parts[2])
  if (![degrees, minutes, seconds].every(isFinite)) return null

  const useDir = dir ?? (isLatitude ? (degrees < 0 ? 'S' : 'N') : degrees < 0 ? 'W' : 'E')

  return {
    degrees: Math.abs(degrees),
    minutes: Math.abs(minutes),
    seconds: Math.abs(seconds),
    direction: useDir,
  }
}

export function dmsToDecimalSolution(input: { dms: string; isLatitude: boolean }): Solution {
  const dms = parseDmsLike(input.dms, input.isLatitude)
  if (!dms) {
    return createSolutionV1({
      title: 'DMS → Decimal Degrees',
      given: [{ label: 'Input', value: input.dms }],
      toFind: ['Decimal degrees'],
      solution: [{ formula: 'Invalid DMS input', computation: 'Unable to parse DMS.' }],
      result: [{ label: 'Decimal degrees', value: '—' }],
    })
  }

  const decimal = dmsToDecimal(dms)
  return dmsToDecimalSolved({ dms: input.dms, isLatitude: input.isLatitude }).solution
}

export function dmsToDecimalSolved(input: { dms: string; isLatitude: boolean }): Solved<{ decimal: number | null; parsed: DMS | null }> & { solution: Solution } {
  const dms = parseDmsLike(input.dms, input.isLatitude)
  if (!dms) {
    const solution = createSolutionV1({
      title: 'DMS → Decimal Degrees',
      given: [{ label: 'Input', value: input.dms }],
      toFind: ['Decimal degrees'],
      solution: [{ formula: 'Invalid DMS input', computation: 'Unable to parse DMS.' }],
      result: [{ label: 'Decimal degrees', value: '—' }],
    })
    return solveWithSteps({ decimal: null, parsed: null }, solution)
  }

  const decimal = dmsToDecimal(dms)
  const solution = createSolutionV1({
    title: 'DMS → Decimal Degrees',
    given: [
      { label: 'Degrees', value: fullNumber(dms.degrees) },
      { label: 'Minutes', value: fullNumber(dms.minutes) },
      { label: 'Seconds', value: fullNumber(dms.seconds) },
      { label: 'Direction', value: dms.direction },
    ],
    toFind: ['Decimal degrees'],
    solution: [
      {
        formula: 'Decimal = Deg + Min/60 + Sec/3600 (apply sign by direction)',
        substitution: `= ${fullNumber(dms.degrees)} + ${fullNumber(dms.minutes)}/60 + ${fullNumber(dms.seconds)}/3600`,
        computation: `= ${fullNumber(decimal)}°`,
        result: `${decimal.toFixed(8)}°`,
      },
    ],
    result: [{ label: 'Decimal degrees', value: `${decimal.toFixed(8)}°` }],
  })

  return solveWithSteps({ decimal, parsed: dms }, solution)
}

export function decimalToDmsSolved(input: { decimal: number; isLatitude: boolean }): Solved<ReturnType<typeof decimalToDMS>> & { solution: Solution } {
  const dms = decimalToDMS(input.decimal, input.isLatitude)
  const formatted = `${dms.degrees}° ${dms.minutes}' ${dms.seconds.toFixed(3)}" ${dms.direction}`
  const solution = createSolutionV1({
    title: 'Decimal Degrees → DMS',
    given: [{ label: 'Decimal degrees', value: `${fullNumber(input.decimal)}°` }],
    toFind: ['Degrees, minutes, seconds + direction'],
    solution: [
      {
        formula: 'Deg = floor(|x|), Min = floor((|x|−Deg)×60), Sec = remainder×60',
        computation: formatted,
        result: formatted,
      },
    ],
    result: [{ label: 'DMS', value: formatted }],
  })

  return solveWithSteps(dms, solution)
}

export function decimalToDmsSolution(input: { decimal: number; isLatitude: boolean }): Solution {
  return decimalToDmsSolved(input).solution
}
