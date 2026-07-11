/**
 * Helmert 7-Parameter Transformation Engine — v0.3
 *
 * Computes the 7-parameter similarity transformation between two coordinate
 * systems (e.g., WGS84 → Arc 1960, or local grid → national grid).
 *
 * The transformation:
 *   [X_t]          [X_s]   [Tx]
 *   [Y_t] = (1+S)·R·[Y_s] + [Ty]
 *   [Z_t]          [Z_s]   [Tz]
 *
 * Where:
 *   S = scale factor
 *   R = rotation matrix (from Rx, Ry, Rz)
 *   Tx, Ty, Tz = translations
 *
 * Requires at least 3 common points (points with known coordinates in
 * both systems). Uses least squares for overdetermined systems (4+ points).
 *
 * For Kenya: WGS84 (GNSS) → Arc 1960 (registry) transformation.
 * The horizontal shift can be 100-200m without this correction.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ControlPointPair {
  id: string
  // Source system (e.g., WGS84 from GNSS)
  sourceX: number
  sourceY: number
  sourceZ: number
  // Target system (e.g., Arc 1960 from registry)
  targetX: number
  targetY: number
  targetZ: number
}

export interface HelmertParameters {
  tx: number  // Translation X (metres)
  ty: number  // Translation Y (metres)
  tz: number  // Translation Z (metres)
  rx: number  // Rotation X (radians)
  ry: number  // Rotation Y (radians)
  rz: number  // Rotation Z (radians)
  scale: number  // Scale factor (dimensionless, e.g., 1.0000042)
}

export interface HelmertResult {
  parameters: HelmertParameters
  /** Transformed points (source → target using computed parameters) */
  transformedPoints: Array<{
    id: string
    x: number
    y: number
    z: number
    residualX: number
    residualY: number
    residualZ: number
  }>
  /** RMS of residuals (metres) */
  rmsX: number
  rmsY: number
  rmsZ: number
  rmsTotal: number
  /** Number of control points used */
  pointCount: number
  /** Degrees of freedom */
  degreesOfFreedom: number
}

// ─── Main computation ───────────────────────────────────────────────────────

/**
 * Compute 7-parameter Helmert transformation from control point pairs.
 *
 * Uses the least-squares method for 4+ points, exact solution for 3 points.
 *
 * @param points At least 3 control point pairs
 * @returns Helmert parameters + residuals
 */
export function computeHelmertTransformation(
  points: ControlPointPair[],
): HelmertResult | null {
  if (points.length < 3) return null

  const n = points.length

  // ─── Step 1: Compute centroids ──────────────────────────────────────────
  let srcCx = 0, srcCy = 0, srcCz = 0
  let tgtCx = 0, tgtCy = 0, tgtCz = 0

  for (const p of points) {
    srcCx += p.sourceX; srcCy += p.sourceY; srcCz += p.sourceZ
    tgtCx += p.targetX; tgtCy += p.targetY; tgtCz += p.targetZ
  }

  srcCx /= n; srcCy /= n; srcCz /= n
  tgtCx /= n; tgtCy /= n; tgtCz /= n

  // ─── Step 2: Centered coordinates ───────────────────────────────────────
  const src: number[][] = []
  const tgt: number[][] = []

  for (const p of points) {
    src.push([p.sourceX - srcCx, p.sourceY - srcCy, p.sourceZ - srcCz])
    tgt.push([p.targetX - tgtCx, p.targetY - tgtCy, p.targetZ - tgtCz])
  }

  // ─── Step 3: Compute scale factor ───────────────────────────────────────
  let srcSumSq = 0
  let dotProduct = 0

  for (let i = 0; i < n; i++) {
    srcSumSq += src[i][0] ** 2 + src[i][1] ** 2 + src[i][2] ** 2
    dotProduct += src[i][0] * tgt[i][0] + src[i][1] * tgt[i][1] + src[i][2] * tgt[i][2]
  }

  const scale = srcSumSq > 0 ? dotProduct / srcSumSq : 1

  // ─── Step 4: Compute rotation (simplified — small angle approximation) ──
  // For small rotations, the rotation matrix R can be linearized:
  // R ≈ I + [0 -rz ry; rz 0 -rx; -ry rx 0]
  //
  // We solve for rx, ry, rz using least squares.
  // The cross-correlation matrix C = Σ (src_i × tgt_i) gives the rotation axis.

  // Build the system: A * [rx, ry, rz]^T = b
  // Where A is 3n×3 and b is 3n×1

  const A: number[][] = []
  const b: number[] = []

  for (let i = 0; i < n; i++) {
    // For each point, the rotation contribution:
    // tgt_centered = scale * R * src_centered
    // tgt - scale*src = scale * [skew(rx,ry,rz)] * src
    //
    // [ty - s*sy]     [ 0  -rz  ry ] [sx]
    // [tx - s*sx]  = s[rz   0  -rx] [sy]   (simplified cross product)
    // [tz - s*sz]     [-ry  rx   0 ] [sz]

    const sx = src[i][0], sy = src[i][1], sz = src[i][2]
    const tx = tgt[i][0], ty = tgt[i][1], tz = tgt[i][2]

    const dx = tx - scale * sx
    const dy = ty - scale * sy
    const dz = tz - scale * sz

    // Cross product matrix: [rx, ry, rz] × src = [ry*sz - rz*sy, rz*sx - rx*sz, rx*sy - ry*sx]
    // Rearranged as A * [rx,ry,rz]^T = [dx, dy, dz]^T / scale
    A.push([0, sz, -sy])
    A.push([-sz, 0, sx])
    A.push([sy, -sx, 0])
    b.push(dx / scale)
    b.push(dy / scale)
    b.push(dz / scale)
  }

  // Solve A^T * A * x = A^T * b (normal equations)
  const AtA = matMul(transpose(A), A)
  const Atb = matVec(transpose(A), b)

  const rotation = solve3x3(AtA, Atb)

  if (!rotation) return null

  const rx = rotation[0]
  const ry = rotation[1]
  const rz = rotation[2]

  // ─── Step 5: Compute translations ───────────────────────────────────────
  // T = tgt_centroid - scale * R * src_centroid
  const tx = tgtCx - scale * (srcCx - rz * srcCy + ry * srcCz)
  const ty = tgtCy - scale * (rz * srcCx + srcCy - rx * srcCz)
  const tz = tgtCz - scale * (-ry * srcCx + rx * srcCy + srcCz)

  const parameters: HelmertParameters = { tx, ty, tz, rx, ry, rz, scale }

  // ─── Step 6: Compute residuals ──────────────────────────────────────────
  const transformedPoints = points.map(p => {
    const transformed = transformPoint(p.sourceX, p.sourceY, p.sourceZ, parameters)
    return {
      id: p.id,
      x: transformed.x,
      y: transformed.y,
      z: transformed.z,
      residualX: transformed.x - p.targetX,
      residualY: transformed.y - p.targetY,
      residualZ: transformed.z - p.targetZ,
    }
  })

  // RMS
  let sumSqX = 0, sumSqY = 0, sumSqZ = 0
  for (const tp of transformedPoints) {
    sumSqX += tp.residualX ** 2
    sumSqY += tp.residualY ** 2
    sumSqZ += tp.residualZ ** 2
  }

  const rmsX = Math.sqrt(sumSqX / n)
  const rmsY = Math.sqrt(sumSqY / n)
  const rmsZ = Math.sqrt(sumSqZ / n)
  const rmsTotal = Math.sqrt((sumSqX + sumSqY + sumSqZ) / n)

  const degreesOfFreedom = n - 3 // 3 parameters (minimum), more for overdetermined

  return {
    parameters,
    transformedPoints,
    rmsX,
    rmsY,
    rmsZ,
    rmsTotal,
    pointCount: n,
    degreesOfFreedom,
  }
}

// ─── Transform a point using Helmert parameters ─────────────────────────────

export function transformPoint(
  x: number,
  y: number,
  z: number,
  params: HelmertParameters,
): { x: number; y: number; z: number } {
  const { tx, ty, tz, rx, ry, rz, scale } = params

  // Apply rotation (small angle approximation)
  const rx2 = x - rz * y + ry * z
  const ry2 = rz * x + y - rx * z
  const rz2 = -ry * x + rx * y + z

  // Apply scale and translation
  return {
    x: scale * rx2 + tx,
    y: scale * ry2 + ty,
    z: scale * rz2 + tz,
  }
}

export function transformPoints(
  points: Array<{ x: number; y: number; z: number; id?: string }>,
  params: HelmertParameters,
): Array<{ x: number; y: number; z: number; id?: string }> {
  return points.map(p => ({
    id: p.id,
    ...transformPoint(p.x, p.y, p.z, params),
  }))
}

// ─── Matrix helpers ─────────────────────────────────────────────────────────

function transpose(A: number[][]): number[][] {
  const rows = A.length
  const cols = A[0].length
  const result: number[][] = Array(cols).fill(null).map(() => Array(rows).fill(0))
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      result[j][i] = A[i][j]
    }
  }
  return result
}

function matMul(A: number[][], B: number[][]): number[][] {
  const rows = A.length
  const cols = B[0].length
  const inner = B.length
  const result: number[][] = Array(rows).fill(null).map(() => Array(cols).fill(0))
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      let sum = 0
      for (let k = 0; k < inner; k++) {
        sum += A[i][k] * B[k][j]
      }
      result[i][j] = sum
    }
  }
  return result
}

function matVec(A: number[][], v: number[]): number[] {
  const rows = A.length
  const result: number[] = Array(rows).fill(0)
  for (let i = 0; i < rows; i++) {
    let sum = 0
    for (let j = 0; j < v.length; j++) {
      sum += A[i][j] * v[j]
    }
    result[i] = sum
  }
  return result
}

function solve3x3(A: number[][], b: number[]): number[] | null {
  // Cramer's rule for 3x3 system
  const det = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
            - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
            + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])

  if (Math.abs(det) < 1e-15) return null

  const detX = b[0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
             - A[0][1] * (b[1] * A[2][2] - A[1][2] * b[2])
             + A[0][2] * (b[1] * A[2][1] - A[1][1] * b[2])

  const detY = A[0][0] * (b[1] * A[2][2] - A[1][2] * b[2])
             - b[0] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
             + A[0][2] * (A[1][0] * b[2] - b[1] * A[2][0])

  const detZ = A[0][0] * (A[1][1] * b[2] - b[1] * A[2][1])
             - A[0][1] * (A[1][0] * b[2] - b[1] * A[2][0])
             + b[0] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])

  return [detX / det, detY / det, detZ / det]
}
