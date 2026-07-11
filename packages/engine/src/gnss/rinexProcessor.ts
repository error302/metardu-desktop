/**
 * GNSS RINEX Processing Service — client for the Python worker
 *
 * Submits RINEX observation files to the Python compute worker for
 * SPP (Single Point Positioning) or PPP (Precise Point Positioning)
 * processing. Returns adjusted coordinates with full covariance matrices.
 *
 * Usage:
 *   import { processRinexFile } from '@/lib/gnss/rinexProcessor'
 *
 *   const result = await processRinexFile({
 *     rinexObsFile: file,           // File object from <input type="file">
 *     usePreciseEphemeris: true,
 *     stationName: 'NALR',
 *   })
 *   // result = { latitude, longitude, height, ecef, covariance, rms, ... }
 */

import { callPythonCompute } from '@/lib/compute/pythonService'

export interface RINEXProcessParams {
  /** RINEX observation file (from <input type="file">) */
  rinexObsFile: File
  /** Optional RINEX navigation (broadcast ephemeris) file */
  rinexNavFile?: File
  /** Download IGS precise ephemeris (SP3) for sub-meter accuracy */
  usePreciseEphemeris?: boolean
  /** Station name/identifier (e.g., 'NALR' for Nairobi) */
  stationName?: string
}

export interface GNSSPositionResult {
  /** Latitude (WGS84 degrees) */
  latitude: number
  /** Longitude (WGS84 degrees) */
  longitude: number
  /** Ellipsoidal height (meters) */
  height: number
  /** ECEF [X, Y, Z] in meters */
  ecef: [number, number, number]
  /** 3×3 or 4×4 covariance matrix */
  covariance: number[][] | null
  /** RMS of residuals (meters) */
  rms: number
  /** Number of satellites used */
  n_satellites: number
  /** Method: 'SPP' or 'PPP' */
  method: string
  /** Processing timestamp (ISO) */
  epoch: string
  /** Number of epochs in the RINEX file */
  n_epochs: number
  /** Station name */
  station_name: string
}

/**
 * Read a File as base64 string.
 */
async function fileToBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Process a RINEX observation file via the Python GNSS worker.
 *
 * The worker computes either:
 *   - SPP (Single Point Positioning): code-range only, ~5-10m accuracy
 *   - PPP (Precise Point Positioning): code + phase, sub-meter accuracy
 *     (requires precise ephemeris)
 *
 * @example
 *   const result = await processRinexFile({
 *     rinexObsFile: file,
 *     usePreciseEphemeris: true,
 *   })
 *   console.log(`${result.latitude}, ${result.longitude} (±${result.rms.toFixed(3)}m)`)
 */
export async function processRinexFile(
  params: RINEXProcessParams,
): Promise<GNSSPositionResult> {
  const rinexObs = await fileToBase64(params.rinexObsFile)
  const rinexNav = params.rinexNavFile
    ? await fileToBase64(params.rinexNavFile)
    : undefined

  const workerParams: Record<string, unknown> = {
    rinex_obs: rinexObs,
    use_precise_ephemeris: params.usePreciseEphemeris ?? false,
    station_name: params.stationName ?? 'unknown',
  }
  if (rinexNav) {
    workerParams.rinex_nav = rinexNav
  }

  const result = await callPythonCompute('gnss_process_rinex', workerParams)

  if (!result.ok) {
    throw new Error(`GNSS processing failed: ${result.error}`)
  }

  return result.value as GNSSPositionResult
}

/**
 * Compute the 95% confidence ellipse from a 2D covariance matrix.
 *
 * @param covariance - 2×2 covariance matrix [[σ_E², σ_EN], [σ_EN, σ_N²]]
 * @returns semiMajor, semiMinor, orientation (degrees from North)
 */
export function computeConfidenceEllipse(
  covariance: number[][],
): { semiMajor: number; semiMinor: number; orientation: number } {
  if (!covariance || covariance.length < 2) {
    return { semiMajor: 0, semiMinor: 0, orientation: 0 }
  }

  const a = covariance[0][0] // σ_E²
  const b = covariance[1][1] // σ_N²
  const c = covariance[0][1] // σ_EN

  // Eigenvalues
  const lambda1 = (a + b) / 2 + Math.sqrt(((a - b) / 2) ** 2 + c ** 2)
  const lambda2 = (a + b) / 2 - Math.sqrt(((a - b) / 2) ** 2 + c ** 2)

  // 95% confidence: k = 2.4477 (chi-square 2D, α=0.05)
  const k = 2.4477

  const semiMajor = Math.sqrt(k * Math.max(lambda1, 0))
  const semiMinor = Math.sqrt(k * Math.max(lambda2, 0))
  const orientation = (Math.atan2(2 * c, a - b) * 180 / Math.PI / 2 + 360) % 360

  return { semiMajor, semiMinor, orientation }
}
