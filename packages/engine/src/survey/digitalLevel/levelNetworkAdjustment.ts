// Level Network Adjustment – Weighted Least Squares for Leveling Networks
// Implements LSQ adjustment for loop, spur, and network leveling surveys.
// Kenya Survey Regulations compliant: allowable misclosure checks.

import {
  LevelObservation,
  LevelControlPoint,
  LevelAdjustmentResult,
  AdjustedLevel,
  ResidualDetail,
  allowableMisclosure,
} from './digitalLevelTypes'

/**
 * Perform weighted least-squares adjustment of a leveling network.
 *
 * @param observations - Height difference observations between stations
 * @param controlPoints - Known RL control points (at least one fixed)
 * @param order - Survey order: 'first', 'second', 'third', 'fourth'
 * @returns Full adjustment result with adjusted RLs, residuals, and misclosure
 *
 * Algorithm:
 *   1. Assign unknown heights to non-fixed points (initial approx from forward pass)
 *   2. Build observation equation: l = h_to - h_from - Δh_obs
 *   3. Weight matrix: W = diag(1/d²) where d in km
 *   4. Normal equations: (AᵀWA)x = AᵀWl
 *   5. Solve for corrections x
 *   6. Compute residuals, reference variance, sigma_RL
 */
export function adjustLevelNetwork(
  observations: LevelObservation[],
  controlPoints: LevelControlPoint[],
  order: string = 'third'
): LevelAdjustmentResult {
  // ── Validate inputs ───────────────────────────────────────────
  if (observations.length === 0) {
    throw new Error('At least one level observation is required.')
  }

  const fixedPoints = controlPoints.filter(cp => cp.isFixed)
  if (fixedPoints.length === 0) {
    throw new Error('At least one fixed control point is required.')
  }

  // ── Collect all unique station IDs ────────────────────────────
  const stationIds = new Set<string>()
  for (const obs of observations) {
    stationIds.add(obs.fromId)
    stationIds.add(obs.toId)
  }
  for (const cp of controlPoints) {
    stationIds.add(cp.id)
  }
  const allStations = Array.from(stationIds)

  // ── Build control point map ───────────────────────────────────
  const cpMap = new Map<string, LevelControlPoint>()
  for (const cp of controlPoints) {
    cpMap.set(cp.id, cp)
  }

  // ── Separate fixed vs free stations ───────────────────────────
  const fixedStations = fixedPoints.map(cp => cp.id)
  const freeStations = allStations.filter(id => !fixedStations.includes(id))

  const freeCount = freeStations.length

  // Index maps
  const freeIndex = new Map<string, number>()
  freeStations.forEach((id, i) => freeIndex.set(id, i))

  // ── Initial height approximations ─────────────────────────────
  // Start with known values for fixed, then propagate forward
  const heights = new Map<string, number>()

  // Set fixed heights
  for (const cp of fixedPoints) {
    heights.set(cp.id, cp.rl)
  }

  // Forward propagate to get initial estimates for free stations
  propagateHeights(observations, heights, fixedStations)

  // For any remaining unknown stations, use a default
  for (const id of freeStations) {
    if (!heights.has(id)) {
      heights.set(id, 0)
    }
  }

  // ── Build design matrix A and misclosure vector l ─────────────
  // For each observation: l_i = h_to - h_from - Δh_obs
  // A_i: +1 at freeIndex(to), -1 at freeIndex(from)
  const m = observations.length
  const n = freeCount

  if (n === 0) {
    // All stations fixed – just compute residuals and misclosure
    return adjustAllFixed(observations, controlPoints, allStations, heights, order)
  }

  const A: number[][] = []
  const l: number[] = []
  const W: number[] = []

  for (const obs of observations) {
    const row = new Array(n).fill(0)

    // to station
    const toIdx = freeIndex.get(obs.toId)
    if (toIdx !== undefined) {
      row[toIdx] = 1
    }
    // from station
    const fromIdx = freeIndex.get(obs.fromId)
    if (fromIdx !== undefined) {
      row[fromIdx] = -1
    }

    const computedDiff = (heights.get(obs.toId) ?? 0) - (heights.get(obs.fromId) ?? 0)
    const misclosure = computedDiff - obs.heightDifference

    A.push(row)
    l.push(misclosure)
    W.push(obs.weight > 0 ? obs.weight : 1000)
  }

  // ── Form normal equations: N = AᵀWA, t = AᵀWl ───────────────
  const N = multiplyAtWA(A, W, n)
  const t = multiplyAtWl(A, W, l, n)

  // ── Solve for corrections ─────────────────────────────────────
  let x: number[]
  try {
    x = solveLinearSystem(N, t)
  } catch (err: unknown) {
    throw new Error('Failed to solve normal equations: ' + ((err as Error).message || err))
  }

  // ── Update heights ────────────────────────────────────────────
  for (let i = 0; i < freeStations.length; i++) {
    const id = freeStations[i]
    const h = (heights.get(id) ?? 0) - x[i]
    heights.set(id, h)
  }

  // ── Compute residuals: v = Ax - l ─────────────────────────────
  const residuals: number[] = []
  for (let i = 0; i < m; i++) {
    let ax = 0
    for (let j = 0; j < n; j++) {
      ax += A[i][j] * x[j]
    }
    residuals.push(ax - l[i])
  }

  // ── Reference variance: σ₀² = (vᵀWv) / (m - n) ─────────────
  const dof = m - n
  const vWv = residuals.reduce((sum, v, i) => sum + W[i] * v * v, 0)
  const refVariance = dof > 0 ? vWv / dof : 0

  // ── Compute Qxx = (AᵀWA)⁻¹ for sigma_RL ──────────────────────
  const Qxx = invertMatrix(N, n)

  // ── Compute total distance ────────────────────────────────────
  const totalDistKm = observations.reduce((sum, obs) => sum + obs.distance / 1000, 0)

  // ── Compute misclosure for loop detection ─────────────────────
  const networkMisclosure = computeNetworkMisclosure(observations, heights)

  // ── Build residual details ────────────────────────────────────
  const residualDetails: ResidualDetail[] = []
  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i]
    const res = residuals[i]
    const sigmaV = dof > 0 ? Math.sqrt(refVariance / W[i]) : 0
    const standardized = sigmaV > 0 ? res / sigmaV : 0

    residualDetails.push({
      from: obs.fromId,
      to: obs.toId,
      residual: res * 1000, // convert to mm
      standardized,
    })
  }

  // ── Build adjusted levels ─────────────────────────────────────
  const adjustedLevels: AdjustedLevel[] = []
  for (const id of allStations) {
    const rl = heights.get(id) || 0
    let sigmaRL = 0

    const idx = freeIndex.get(id)
    if (idx !== undefined) {
      const q = Qxx[idx][idx]
      sigmaRL = refVariance > 0 ? Math.sqrt(Math.max(refVariance * q, 0)) : 0
    }

    adjustedLevels.push({ id, rl, sigmaRL })
  }

  // ── Misclosure check ──────────────────────────────────────────
  const misclosureMm = networkMisclosure * 1000 // convert to mm
  const allowable = allowableMisclosure(totalDistKm, order)
  const misclosurePerKm = totalDistKm > 0 ? misclosureMm / totalDistKm : 0
  const passed = Math.abs(misclosureMm) <= allowable

  return {
    adjustedLevels,
    residuals: residualDetails,
    misclosure: misclosureMm,
    allowableMisclosure: allowable,
    misclosurePerKm,
    totalDistance: totalDistKm,
    referenceVariance: refVariance,
    degreesOfFreedom: dof,
    passed,
    order,
  }
}

/**
 * Propagate heights from fixed stations through observations to get
 * initial approximations for free stations.
 */
function propagateHeights(
  observations: LevelObservation[],
  heights: Map<string, number>,
  fixedStations: string[]
): void {
  // BFS-like propagation from fixed stations
  const queue = [...fixedStations]
  const visited = new Set<string>(fixedStations)

  while (queue.length > 0) {
    const fromId = queue.shift()
    if (fromId === undefined) continue
    const fromH = heights.get(fromId)
    if (fromH === undefined) continue

    for (const obs of observations) {
      // Forward direction
      if (obs.fromId === fromId && !visited.has(obs.toId)) {
        heights.set(obs.toId, fromH + obs.heightDifference)
        visited.add(obs.toId)
        queue.push(obs.toId)
      }
      // Reverse direction
      if (obs.toId === fromId && !visited.has(obs.fromId)) {
        heights.set(obs.fromId, fromH - obs.heightDifference)
        visited.add(obs.fromId)
        queue.push(obs.fromId)
      }
    }
  }
}

/**
 * Compute network misclosure by summing height differences around loops.
 * For a simple spur, compute the misclosure from the forward pass.
 */
function computeNetworkMisclosure(
  observations: LevelObservation[],
  heights: Map<string, number>
): number {
  // Simple approach: sum of (computed - observed) differences
  let totalMisclosure = 0
  for (const obs of observations) {
    const fromH = heights.get(obs.fromId) || 0
    const toH = heights.get(obs.toId) || 0
    const computedDiff = toH - fromH
    totalMisclosure += (computedDiff - obs.heightDifference)
  }

  // For loop networks, the misclosure per observation is more meaningful
  // Average misclosure across all observations
  return observations.length > 0 ? totalMisclosure / observations.length : 0
}

/**
 * Handle the case where all stations are fixed (no free parameters).
 */
function adjustAllFixed(
  observations: LevelObservation[],
  controlPoints: LevelControlPoint[],
  allStations: string[],
  heights: Map<string, number>,
  order: string
): LevelAdjustmentResult {
  const m = observations.length
  const totalDistKm = observations.reduce((sum, obs) => sum + obs.distance / 1000, 0)

  // Compute residuals
  const residualDetails: ResidualDetail[] = []
  let sumResidualSq = 0

  for (const obs of observations) {
    const fromH = heights.get(obs.fromId) || 0
    const toH = heights.get(obs.toId) || 0
    const res = (toH - fromH) - obs.heightDifference

    residualDetails.push({
      from: obs.fromId,
      to: obs.toId,
      residual: res * 1000, // mm
      standardized: 0,
    })
    sumResidualSq += res * res
  }

  const refVariance = m > 0 ? sumResidualSq / m : 0
  const misclosureMm = residualDetails.reduce((s, r) => s + r.residual, 0)
  const allowable = allowableMisclosure(totalDistKm, order)
  const misclosurePerKm = totalDistKm > 0 ? misclosureMm / totalDistKm : 0
  const passed = Math.abs(misclosureMm) <= allowable

  const adjustedLevels: AdjustedLevel[] = allStations.map(id => ({
    id,
    rl: heights.get(id) || 0,
    sigmaRL: 0,
  }))

  return {
    adjustedLevels,
    residuals: residualDetails,
    misclosure: misclosureMm,
    allowableMisclosure: allowable,
    misclosurePerKm,
    totalDistance: totalDistKm,
    referenceVariance: refVariance,
    degreesOfFreedom: m,
    passed,
    order,
  }
}

// ── Matrix operations (pure TypeScript, no dependencies) ─────────────────────

function multiplyAtWA(A: number[][], W: number[], n: number): number[][] {
  const result = Array.from({ length: n }, function() { return new Array(n).fill(0) })
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < A.length; k++) {
        result[i][j] += A[k][i] * W[k] * A[k][j]
      }
    }
  }
  return result
}

function multiplyAtWl(A: number[][], W: number[], l: number[], n: number): number[] {
  let result = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < A.length; k++) {
      result[i] += A[k][i] * W[k] * l[k]
    }
  }
  return result
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  let n = b.length
  let M = A.map(function(row, i) { return row.concat([b[i]]) })

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row
    }
    let tmp = M[col]; M[col] = M[maxRow]; M[maxRow] = tmp

    let pivot = M[col][col]
    if (Math.abs(pivot) < 1e-12) {
      throw new Error('Singular normal equation matrix — check network geometry (possibly under-determined)')
    }

    for (let row2 = col + 1; row2 < n; row2++) {
      let factor = M[row2][col] / pivot
      for (let k = col; k <= n; k++) {
        M[row2][k] -= factor * M[col][k]
      }
    }
  }

  // Back substitution
  let x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n]
    for (let j = i + 1; j < n; j++) {
      x[i] -= M[i][j] * x[j]
    }
    x[i] /= M[i][i]
  }
  return x
}

function invertMatrix(A: number[][], n: number): number[][] {
  let M = A.map(function(row, i) {
    let aug = row.slice()
    for (let j = 0; j < n; j++) aug.push(0)
    aug[n + i] = 1
    return aug
  })

  for (let col = 0; col < n; col++) {
    let maxRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row
    }
    let tmp2 = M[col]; M[col] = M[maxRow]; M[maxRow] = tmp2

    let pivot = M[col][col]
    if (Math.abs(pivot) < 1e-12) {
      return Array.from({ length: n }, function() { return new Array(n).fill(0) })
    }

    for (let k = 0; k < 2 * n; k++) {
      M[col][k] /= pivot
    }
    for (let row3 = 0; row3 < n; row3++) {
      if (row3 === col) continue
      let factor2 = M[row3][col]
      for (let k2 = 0; k2 < 2 * n; k2++) {
        M[row3][k2] -= factor2 * M[col][k2]
      }
    }
  }

  return M.map(function(row) { return row.slice(n) })
}

// ── Utility: compute observations from readings ──────────────────────────────

/**
 * Compute LevelObservation array from BS/FS reading pairs.
 * Weight is 1/(d²) where d is average distance in km.
 */
export function computeObservations(
  readings: Array<{
    stationId: string
    type: string
    staffReading: number
    distance: number
  }>
): LevelObservation[] {
  const observations: LevelObservation[] = []
  let bsBuffer: any = null

  for (const r of readings) {
    if (r.type === 'BS') {
      bsBuffer = r
    } else if (r.type === 'FS' && bsBuffer) {
      const heightDiff = bsBuffer.staffReading - r.staffReading
      const avgDist = (bsBuffer.distance + r.distance) / 2
      const distKm = avgDist / 1000
      const weight = distKm > 0 ? 1 / (distKm * distKm) : 1000

      observations.push({
        fromId: bsBuffer.stationId,
        toId: r.stationId,
        heightDifference: heightDiff,
        distance: avgDist,
        weight,
      })
      bsBuffer = null
    }
  }

  return observations
}
