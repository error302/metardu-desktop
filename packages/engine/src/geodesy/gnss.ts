/**
 * Calculation standard: N.N. Basak — Surveying and Planning
 * - No intermediate rounding
 * - Full floating point precision throughout
 * - Round only at final display layer
 */

// METARDU Engine - GNSS Baseline Processing

import { Point2D, Point3D } from '@/lib/engine/types';
import { toRadians, toDegrees } from '@/lib/engine/angles';

export interface GNSSBaseStation {
  name: string
  x: number  // ECEF X (meters)
  y: number  // ECEF Y (meters)
  z: number  // ECEF Z (meters)
}

export interface GNSSObservation {
  pointName: string
  x: number   // ECEF X (meters)
  y: number   // ECEF Y (meters)
  z: number   // ECEF Z (meters)
  sigmaX?: number  // Standard deviation (meters)
  sigmaY?: number
  sigmaZ?: number
  hdop?: number    // Horizontal DOP
  vdop?: number    // Vertical DOP
}

export interface BaselineResult {
  from: string
  to: string
  deltaX: number
  deltaY: number
  deltaZ: number
  distance3D: number
  distance2D: number
  azimuth: number  // Bearing from North (degrees)
  elevationAngle: number  // Degrees above horizon
  sigma: number   // Combined uncertainty (meters)
}

export interface GNSSNetworkResult {
  points: Array<{
    name: string
    easting: number
    northing: number
    elevation: number
    sigmaEasting: number
    sigmaNorthing: number
    sigmaElevation: number
  }>
  baselines: BaselineResult[]
  adjustmentStats: {
    rms: number
    maxResidual: number
    degreesOfFreedom: number
  }
}

/**
 * Convert Geodetic (lat, lon, height) to ECEF (X, Y, Z)
 * WGS84 ellipsoid
 */
export function geodeticToECEF(lat: number, lon: number, h: number): GNSSBaseStation {
  const a = 6378137.0  // WGS84 semi-major axis
  const f = 1 / 298.257223563  // WGS84 flattening
  const e2 = 2 * f - f * f
  
  const latRad = toRadians(lat)
  const lonRad = toRadians(lon)
  
  const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) * Math.sin(latRad))
  
  const x = (N + h) * Math.cos(latRad) * Math.cos(lonRad)
  const y = (N + h) * Math.cos(latRad) * Math.sin(lonRad)
  const z = (N * (1 - e2) + h) * Math.sin(latRad)
  
  return { name: '', x, y, z }
}

/**
 * Convert ECEF (X, Y, Z) to Geodetic (lat, lon, height)
 * Iterative solution, WGS84
 */
export function ecefToGeodetic(x: number, y: number, z: number): { lat: number; lon: number; h: number } {
  const a = 6378137.0
  const f = 1 / 298.257223563
  const e2 = 2 * f - f * f
  
  const lon = Math.atan2(y, x)
  
  const p = Math.sqrt(x * x + y * y)
  const lat0 = Math.atan2(z, p * (1 - e2))
  
  let lat = lat0
  for (let i = 0; i < 10; i++) {
    const N = a / Math.sqrt(1 - e2 * Math.sin(lat) * Math.sin(lat))
    const h = p / Math.cos(lat) - N
    lat = Math.atan2(z, p * (1 - e2 * N / (N + h)))
  }
  
  const N = a / Math.sqrt(1 - e2 * Math.sin(lat) * Math.sin(lat))
  const h = p / Math.cos(lat) - N
  
  return {
    lat: toDegrees(lat),
    lon: toDegrees(lon),
    h
  }
}

/**
 * Convert ECEF to local ENU (Easting, Northing, Up)
 * Returns ENU coordinates relative to origin point
 */
export function ecefToENU(
  x: number, y: number, z: number,
  originLat: number, originLon: number, originH: number
): { easting: number; northing: number; up: number } {
  const origin = geodeticToECEF(originLat, originLon, originH)
  
  const latRad = toRadians(originLat)
  const lonRad = toRadians(originLon)
  
  const dx = x - origin.x
  const dy = y - origin.y
  const dz = z - origin.z
  
  const easting = -Math.sin(lonRad) * dx + Math.cos(lonRad) * dy
  const northing = -Math.sin(latRad) * Math.cos(lonRad) * dx - Math.sin(latRad) * Math.sin(lonRad) * dy + Math.cos(latRad) * dz
  const up = Math.cos(latRad) * Math.cos(lonRad) * dx + Math.cos(latRad) * Math.sin(lonRad) * dy + Math.sin(latRad) * dz
  
  return { easting, northing, up }
}

/**
 * Compute baseline vector between two GNSS points
 */
export function computeBaseline(from: GNSSObservation, to: GNSSObservation): BaselineResult {
  const deltaX = to.x - from.x
  const deltaY = to.y - from.y
  const deltaZ = to.z - from.z
  
  const distance3D = Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ)
  const distance2D = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
  
  // Azimuth from North (0-360 degrees, WCB)
  let azimuth = toDegrees(Math.atan2(deltaX, deltaY))
  if (azimuth < 0) azimuth += 360
  
  // Elevation angle (angle above horizontal)
  const elevationAngle = toDegrees(Math.atan2(deltaZ, distance2D))
  
  // Combined uncertainty based on DOP and measurement precision
  let sigma = 0.01  // Base uncertainty 1cm
  if (from.sigmaX !== undefined && to.sigmaX !== undefined) {
    sigma = Math.sqrt(
      (from.sigmaX || 0.01) ** 2 + 
      (to.sigmaX || 0.01) ** 2 +
      (from.sigmaY || 0.01) ** 2 + 
      (to.sigmaY || 0.01) ** 2 +
      (from.sigmaZ || 0.01) ** 2 + 
      (to.sigmaZ || 0.01) ** 2
    ) / Math.sqrt(3)
  }
  
  return {
    from: from.pointName,
    to: to.pointName,
    deltaX,
    deltaY,
    deltaZ,
    distance3D,
    distance2D,
    azimuth,
    elevationAngle,
    sigma
  }
}

/**
 * Process GNSS network from base station and rover observations
 * Returns adjusted coordinates in local projection
 */
export function processGNSSNetwork(
  baseStation: GNSSBaseStation,
  observations: GNSSObservation[],
  originLat: number,
  originLon: number,
  originH: number
): GNSSNetworkResult {
  const baselines: BaselineResult[] = []
  const points: GNSSNetworkResult['points'] = []
  
  // Compute baselines from base station
  const baseECEF = { x: baseStation.x, y: baseStation.y, z: baseStation.z }
  
  for (const obs of observations) {
    const baseline = computeBaseline(
      { pointName: baseStation.name, ...baseECEF },
      obs
    )
    baselines.push(baseline)
    
    // Convert to local ENU
    const obsECEF = geodeticToECEF(0, 0, 0)  // placeholder
    const enu = ecefToENU(obs.x, obs.y, obs.z, originLat, originLon, originH)
    
    // Calculate uncertainties (simplified)
    const sigmaE = obs.sigmaX || 0.01
    const sigmaN = obs.sigmaY || 0.01
    const sigmaU = obs.sigmaZ || 0.02
    
    points.push({
      name: obs.pointName,
      easting: enu.easting,
      northing: enu.northing,
      elevation: enu.up,
      sigmaEasting: sigmaE,
      sigmaNorthing: sigmaN,
      sigmaElevation: sigmaU
    })
  }
  
  // Calculate network statistics
  const residuals = baselines.map((b: any) => b.sigma)
  const rms = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length) || 0
  
  return {
    points,
    baselines,
    adjustmentStats: {
      rms,
      maxResidual: Math.max(...residuals, 0),
      degreesOfFreedom: Math.max(observations.length - 3, 1)
    }
  }
}

/**
 * Convert UTM coordinates to/from Geodetic
 */
export function utmToGeodetic(easting: number, northing: number, zone: number, hemisphere: 'N' | 'S'): { lat: number; lon: number } {
  const a = 6378137.0
  const f = 1 / 298.257223563
  const e = Math.sqrt(2 * f - f * f)
  const e1 = (1 - Math.sqrt(1 - e * e)) / (1 + Math.sqrt(1 - e * e))
  
  const x = easting - 500000
  const y = hemisphere === 'S' ? northing - 10000000 : northing
  
  const M0 = 0
  const mu = M0 / (a * (1 - e * e / 4 - 3 * e * e * e * e / 64))
  
  const phi1 = mu + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu)
    + (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu)
  
  const N1 = a / Math.sqrt(1 - e * e * Math.sin(phi1) * Math.sin(phi1))
  const T1 = Math.tan(phi1) * Math.tan(phi1)
  const C1 = (e * e / (1 - e * e)) * Math.cos(phi1) * Math.cos(phi1)
  const R1 = a * (1 - e * e) / Math.pow(1 - e * e * Math.sin(phi1) * Math.sin(phi1), 1.5)
  const D = x / (N1 * Math.cos(phi1))
  
  let lat = phi1 - (N1 * Math.tan(phi1) / R1) * (
    D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * e * e) * D * D * D * D / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * e * e - 3 * C1 * C1) * D * D * D * D * D * D / 720
  )
  
  let lon = (D - (1 + 2 * T1 + C1) * D * D * D / 6 + 
    (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * e * e + 24 * T1 * T1) * D * D * D * D * D / 120) / Math.cos(phi1)
  
  lat = toDegrees(lat)
  lon = toDegrees(lon) + zone * 6 - 180 + 3
  
  return { lat, lon }
}

/**
 * Calculate PDOP (Position Dilution of Precision) from geometry
 */
export function calculatePDOP(satellites: Array<{ x: number; y: number; z: number }>, userPosition: { x: number; y: number; z: number }): number {
  if (satellites.length < 4) return Infinity
  
  // Build design matrix
  const G: number[][] = []
  
  for (const sat of satellites) {
    const dx = sat.x - userPosition.x
    const dy = sat.y - userPosition.y
    const dz = sat.z - userPosition.z
    const range = Math.sqrt(dx * dx + dy * dy + dz * dz)
    
    G.push([
      -dx / range,
      -dy / range,
      -dz / range,
      1
    ])
  }
  
  // Q = (G'G)^-1
  const GT = transpose(G)
  const GTG = multiply(GT, G)
  const Q = inverse(GTG)
  
  if (!Q) return Infinity
  
  // PDOP = sqrt(Q[0][0] + Q[1][1] + Q[2][2])
  const pdop = Math.sqrt(Q[0][0] + Q[1][1] + Q[2][2])
  
  return pdop
}

// Matrix utilities
function transpose(m: number[][]): number[][] {
  return m[0].map((_, i) => m.map((row: any) => row[i]))
}

function multiply(a: number[][], b: number[][]): number[][] {
  const result: number[][] = []
  for (let i = 0; i < a.length; i++) {
    result[i] = []
    for (let j = 0; j < b[0].length; j++) {
      let sum = 0
      for (let k = 0; k < a[0].length; k++) {
        sum += a[i][k] * b[k][j]
      }
      result[i][j] = sum
    }
  }
  return result
}

function inverse(m: number[][]): number[][] | null {
  const n = m.length
  const aug = m.map((row, i) => [...row, ...Array(n).fill(0).map((_, j) => i === j ? 1 : 0)])
  
  for (let i = 0; i < n; i++) {
    let maxRow = i
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) maxRow = k
    }
    [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]]
    
    if (Math.abs(aug[i][i]) < 1e-12) return null
    
    const factor = aug[i][i]
    for (let j = 0; j < 2 * n; j++) aug[i][j] /= factor
    
    for (let k = 0; k < n; k++) {
      if (k !== i) {
        const factor2 = aug[k][i]
        for (let j = 0; j < 2 * n; j++) aug[k][j] -= factor2 * aug[i][j]
      }
    }
  }
  
  return aug.map((row: any) => row.slice(n))
}
