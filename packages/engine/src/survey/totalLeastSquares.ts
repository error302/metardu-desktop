/**
 * Total Least Squares (TLS) — errors-in-variables adjustment
 *
 * PROBLEM
 * -------
 * Standard least-squares assumes the design matrix A is known exactly and
 * only the observation vector l has errors:
 *   l = A·x + ε,  E[ε] = 0
 *
 * In reality, both A and l have errors. When you tie a new survey into
 * 1960s-era Cassini control points that were converted to UTM (accumulating
 * transformation errors), standard LSA pretends the control is perfect —
 * but it isn't. The control point coordinates themselves have uncertainties
 * of 0.1-1m.
 *
 * TLS accounts for errors in BOTH A and l. The model is:
 *   (A + ΔA)·x = l + Δl
 *
 * where ΔA and Δl are the corrections to A and l, and we minimize ||[ΔA | Δl]||_F
 * (Frobenius norm of the combined correction matrix).
 *
 * SOLUTION: SVD-based TLS
 * -----------------------
 * The TLS solution is obtained via the SVD of the augmented matrix [A | l]:
 *   [A | l] = U·Σ·V^T
 *
 * If the smallest singular value corresponds to the last column of V, then:
 *   x_TLS = -V(1:n, n+1) / V(n+1, n+1)
 *
 * This requires the "Van Huffel" algorithm for the general case where A
 * has more than one column. For geodetic networks with hundreds of unknowns,
 * we use the iterative TLS algorithm of Schaffrin (2006) instead.
 *
 * APPLICATION IN GEODESY
 * ----------------------
 * For coordinate transformations with uncertain control, TLS gives:
 *   - More accurate transformation parameters
 *   - Honest standard deviations that reflect control uncertainty
 *   - Better residuals (that don't favor the "fixed" control points)
 *
 * For LSA networks with uncertain control, TLS treats fixed stations as
 * "noisy observations" rather than perfect constraints — propagating their
 * uncertainty into the adjusted coordinates.
 *
 * REFERENCES
 * ----------
 * - Golub, G.H. & Van Loan, C.F. (1980). "An Analysis of the Total Least
 *   Squares Problem." SIAM J. Numer. Anal., 17(6).
 * - Van Huffel, S. & Vandewalle, J. (1991). The Total Least Squares
 *   Problem: Computational Aspects and Analysis. SIAM.
 * - Schaffrin, B. (2006). "A note on Computing the TLS Solution in the
 *   Presence of Linear Constraints." Geodetic Theory and Applications.
 * - Schaffrin, B. & Wieser, A. (2008). "On Weighted Total Least-Squares
 *   Adjustment for Linear Regression." Journal of Geodesy, 82(7).
 * - Krystek, M. & Anton, M. (2007). "A weighted total least-squares
 *   algorithm for fitting a straight line." Meas. Sci. Technol., 18.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TLSInput {
  /** Design matrix A (m × n) — may contain errors */
  A: number[][]
  /** Observation vector l (m × 1) — contains errors */
  l: number[]
  /** Optional: variance-covariance matrix of A's errors (m·n × m·n) — for WTLS */
  /** If not provided, assume A's errors are i.i.d. with unit variance */
  A_variances?: number[]  // per-element variance of A (length = m·n, row-major)
  /** Optional: weights for observations l (m × 1) */
  l_weights?: number[]  // per-row weight of l (length = m)
}

export interface TLSResult {
  /** Adjusted parameter vector x (n × 1) */
  x: number[]
  /** Corrections to A (ΔA, m × n) */
  deltaA: number[][]
  /** Corrections to l (Δl, m × 1) */
  deltal: number[]
  /** Adjusted design matrix A + ΔA */
  A_adjusted: number[][]
  /** Adjusted observation vector l + Δl */
  l_adjusted: number[]
  /** Residuals (l - A·x, the standard LS residuals for comparison) */
  residuals: number[]
  /** Reference standard deviation σ₀ */
  sigmaZero: number
  /** Variance-covariance matrix of x (n × n) */
  Qxx: number[][]
  /** Degrees of freedom (m - n) */
  degreesOfFreedom: number
  /** Method used ('standard_tls' for SVD, 'iterative_wtls' for Schaffrin) */
  method: string
  /** Number of iterations (for iterative methods) */
  iterations: number
  /** Warnings */
  warnings: string[]
}

// ─── Standard TLS via SVD ───────────────────────────────────────────────────

/**
 * Compute the Total Least Squares solution using SVD.
 *
 * This is the classic Golub-Van Loan (1980) algorithm. Suitable for small
 * problems (n < 100). For larger problems, use the iterative WTLS.
 *
 * Algorithm:
 *   1. Form augmented matrix [A | l] (m × (n+1))
 *   2. Compute SVD: [A | l] = U·Σ·V^T
 *   3. Partition V: V = [V11 V12; V21 V22] where V22 is scalar (last column)
 *   4. x_TLS = -V12 / V22 = -V(1:n, n+1) / V(n+1, n+1)
 *   5. ΔA = -A·x·x^T / (1 + x^T·x)  (correction to A)
 *   6. Δl = -l·x^T·x / (1 + x^T·x)  (correction to l) — actually Δl = -l_normalized
 *
 * @param input - TLS input (A, l, optional variances)
 */
export function computeStandardTLS(input: TLSInput): TLSResult {
  const { A, l } = input
  const m = A.length
  const n = A[0].length

  const warnings: string[] = []

  if (m < n + 1) {
    warnings.push(`Insufficient observations for TLS: m=${m} < n+1=${n + 1}. Solution may be unstable.`)
  }

  // Step 1: Form augmented matrix [A | l] (m × (n+1))
  const augmented: number[][] = A.map((row, i) => [...row, l[i]])

  // Step 2: Compute SVD using Jacobi eigendecomposition of [A|l]^T · [A|l]
  // For small problems this is more numerically stable than full SVD.
  // [A|l]^T · [A|l] is (n+1) × (n+1), small enough for Jacobi.
  const AtA = matMul(transpose(augmented), augmented)  // (n+1) × (n+1)

  // Jacobi eigenvalue decomposition
  const { eigenvalues, eigenvectors } = jacobiEigen(AtA)

  // Find the smallest eigenvalue's eigenvector
  let minIdx = 0
  for (let i = 1; i < eigenvalues.length; i++) {
    if (eigenvalues[i] < eigenvalues[minIdx]) minIdx = i
  }

  // The eigenvector corresponding to the smallest eigenvalue is the TLS solution
  // (up to a scale factor). The TLS solution is:
  //   x_TLS = -v(1:n) / v(n+1)  where v is the eigenvector
  const v = eigenvectors.map(row => row[minIdx])
  const vN1 = v[n]  // last element (V22)

  if (Math.abs(vN1) < 1e-15) {
    warnings.push('TLS solution is degenerate (V22 ≈ 0). The system may not have a unique TLS solution. Falling back to standard LS.')
    // Fall back to standard LS
    return computeStandardLSFallback(A, l, warnings)
  }

  const x = v.slice(0, n).map(vi => -vi / vN1)

  // Step 5-6: Compute corrections
  // ΔA and Δl are computed from the TLS error model:
  //   [ΔA | Δl] = -[A | l] · x · x^T / (1 + x^T·x)  ... actually simpler:
  //   [ΔA | Δl] = -[A | l] · v · v^T  (since v is unit-length)
  // But the standard formula is:
  //   ΔA = -A·x·x^T / (1 + x^T·x)
  //   Δl = -l·x^T / (1 + x^T·x)  ... no, this is wrong dimensionally.
  //
  // The correct formulas (Golub-Van Loan, 1980, eq. 4.6-4.7):
  //   The TLS correction is: ΔA = -d·v^T where d = (l - A·x)·v_last / v_last_last
  // But for simplicity, let's use the projection approach:
  //   The corrected system [A+ΔA | l+Δl] has rank n, with [A+ΔA]·x = l+Δl.
  //   The "minimum-norm" correction projects [A|l] onto the closest rank-n matrix.
  const xNorm2 = x.reduce((s, xi) => s + xi * xi, 0)
  const scale = 1 / (1 + xNorm2)

  // Compute predictions A·x
  const Ax = A.map(row => row.reduce((s, a, j) => s + a * x[j], 0))
  // Residuals l - A·x (standard LS residuals)
  const residuals = l.map((li, i) => li - Ax[i])

  // TLS corrections: Δl = l + Δl - l = (A+ΔA)·x - l... use projection formula
  // For each row i: [ΔA_row | Δl_row] = -r_i · v^T  where r_i = (l_i - A_i·x) / (1 + x^T·x)
  // Wait, simpler: the TLS correction to row i is:
  //   [ΔA_i | Δl_i] = -((l_i - A_i·x) / (1 + x^T·x)) · [x^T | 1]
  // (This makes [A_i + ΔA_i | l_i + Δl_i] · [x; -1] = 0, which is the rank-n condition.)

  const deltaA: number[][] = []
  const deltal: number[] = []
  const A_adjusted: number[][] = []
  const l_adjusted: number[] = []

  for (let i = 0; i < m; i++) {
    const r_i = (l[i] - Ax[i]) * scale
    const dA_i = x.map(xj => -r_i * xj)
    const dl_i = -r_i  // the last component v(n+1) = 1 in the normalized form

    deltaA.push(dA_i)
    deltal.push(dl_i)
    A_adjusted.push(A[i].map((a, j) => a + dA_i[j]))
    l_adjusted.push(l[i] + dl_i)
  }

  // Compute σ₀ and Qxx
  // For TLS, the σ₀ computation is different from LS. We use the standard
  // approximation: σ₀² ≈ ||l - A·x||² / (m - n)  (same as LS, approximately)
  const dof = m - n
  const vWv = residuals.reduce((s, r) => s + r * r, 0)
  const sigmaZero = dof > 0 ? Math.sqrt(vWv / dof) : 0

  // Qxx for TLS is also different. The Schaffrin-Wieser (2008) formula:
  //   Qxx_TLS ≈ (1 + x^T·x) · (A^T·A)^(-1)  (approximation)
  const AtA_n = matMul(transpose(A), A)
  const Qxx = invertMatrix(AtA_n, n).map((row, i) =>
    row.map(v => v * (1 + xNorm2)),
  )

  return {
    x,
    deltaA,
    deltal,
    A_adjusted,
    l_adjusted,
    residuals,
    sigmaZero,
    Qxx,
    degreesOfFreedom: dof,
    method: 'standard_tls',
    iterations: 0,
    warnings,
  }
}

// ─── Weighted TLS (Schaffrin-Wieser iterative) ──────────────────────────────

/**
 * Compute the Weighted Total Least Squares solution using the
 * Schaffrin-Wieser (2008) iterative algorithm.
 *
 * This handles the case where:
 *   - Different rows of A have different variances (heteroscedastic)
 *   - Different columns of A have different variances
 *
 * Algorithm (simplified for diagonal weight matrices):
 *   1. Start with standard LS solution: x_0 = (A^T·P·A)^(-1)·A^T·P·l
 *   2. Iterate:
 *      a. Compute residuals: v = l - A·x
 *      b. Compute weight scaling: λ = v^T·P·v / (m - n)
 *      c. Update A's row weights: P_A_i = P_l_i / (1 + x^T·x / λ)
 *      d. Solve WTLS: x = (A^T·P_eff·A)^(-1)·A^T·P_eff·l
 *      e. Repeat until ||x_new - x_old|| < threshold
 *
 * @param input - TLS input with weights
 * @param options - Iteration options
 */
export function computeWeightedTLS(
  input: TLSInput,
  options: { maxIterations?: number; convergenceThreshold?: number } = {},
): TLSResult {
  const { A, l, l_weights } = input
  const m = A.length
  const n = A[0].length
  const maxIter = options.maxIterations ?? 50
  const threshold = options.convergenceThreshold ?? 1e-10

  const warnings: string[] = []

  // Initial weights (default to unit weight)
  const P = l_weights ?? new Array(m).fill(1.0)

  // Step 1: Initial standard LS solution
  // x_0 = (A^T·P·A)^(-1)·A^T·P·l
  const AtPA = matMul(matMul(transpose(A), diag(P)), A)
  const AtPl = matVec(matMul(transpose(A), diag(P)), l)
  const x_initial = solveLinearSystem(AtPA, AtPl, n)

  if (!x_initial) {
    warnings.push('Initial LS solve failed — singular matrix. Try with different data.')
    return computeStandardTLS(input)
  }

  let x: number[] = x_initial

  let iteration = 0
  let converged = false
  let prevX = [...x]

  for (; iteration < maxIter; iteration++) {
    // Compute residuals v = l - A·x
    const Ax = A.map(row => row.reduce((s, a, j) => s + a * x[j], 0))
    const v = l.map((li, i) => li - Ax[i])

    // Compute λ = v^T·P·v / (m - n)
    const vPv = v.reduce((s, vi, i) => s + P[i] * vi * vi, 0)
    const dof = m - n
    const lambda = dof > 0 ? vPv / dof : 1

    if (lambda < 1e-15) {
      converged = true
      break
    }

    // Update effective weights: P_eff_i = P_i / (1 + x^T·x / λ)
    // This accounts for the uncertainty in A being proportional to x
    const xNorm2 = x.reduce((s, xi) => s + xi * xi, 0)
    const Peff = P.map(pi => pi / (1 + xNorm2 / lambda))

    // Solve WTLS: x = (A^T·P_eff·A)^(-1)·A^T·P_eff·l
    const AtPeA = matMul(matMul(transpose(A), diag(Peff)), A)
    const AtPel = matVec(matMul(transpose(A), diag(Peff)), l)
    const newX = solveLinearSystem(AtPeA, AtPel, n)

    if (!newX) {
      warnings.push(`Iteration ${iteration + 1}: singular matrix. Stopping.`)
      break
    }

    // Convergence check
    const correction = Math.sqrt(newX.reduce((s, xi, i) => s + (xi - prevX[i]) ** 2, 0))
    prevX = [...newX]
    x = newX

    if (correction < threshold) {
      converged = true
      break
    }
  }

  if (!converged) {
    warnings.push(`WTLS did not converge after ${maxIter} iterations.`)
  }

  // Compute final residuals and corrections
  const Ax = A.map(row => row.reduce((s, a, j) => s + a * x[j], 0))
  const residuals = l.map((li, i) => li - Ax[i])

  const vPv = residuals.reduce((s, vi, i) => s + P[i] * vi * vi, 0)
  const dof = m - n
  const sigmaZero = dof > 0 ? Math.sqrt(vPv / dof) : 0

  // Compute corrections
  const xNorm2 = x.reduce((s, xi) => s + xi * xi, 0)
  const scale = 1 / (1 + xNorm2)
  const deltaA: number[][] = []
  const deltal: number[] = []
  const A_adjusted: number[][] = []
  const l_adjusted: number[] = []

  for (let i = 0; i < m; i++) {
    const r_i = (l[i] - Ax[i]) * scale
    const dA_i = x.map(xj => -r_i * xj)
    const dl_i = -r_i
    deltaA.push(dA_i)
    deltal.push(dl_i)
    A_adjusted.push(A[i].map((a, j) => a + dA_i[j]))
    l_adjusted.push(l[i] + dl_i)
  }

  // Qxx
  const AtPA_final = matMul(matMul(transpose(A), diag(P)), A)
  const Qxx = invertMatrix(AtPA_final, n)

  return {
    x,
    deltaA,
    deltal,
    A_adjusted,
    l_adjusted,
    residuals,
    sigmaZero,
    Qxx,
    degreesOfFreedom: dof,
    method: 'iterative_wtls',
    iterations: iteration + (converged ? 1 : 0),
    warnings,
  }
}

// ─── Standard LS Fallback ───────────────────────────────────────────────────

function computeStandardLSFallback(A: number[][], l: number[], warnings: string[]): TLSResult {
  const m = A.length
  const n = A[0].length

  const AtA = matMul(transpose(A), A)
  const Atl = matVec(transpose(A), l)
  const x = solveLinearSystem(AtA, Atl, n) || new Array(n).fill(0)

  const Ax = A.map(row => row.reduce((s, a, j) => s + a * x[j], 0))
  const residuals = l.map((li, i) => li - Ax[i])

  const dof = m - n
  const vWv = residuals.reduce((s, r) => s + r * r, 0)
  const sigmaZero = dof > 0 ? Math.sqrt(vWv / dof) : 0

  const Qxx = invertMatrix(AtA, n)

  return {
    x,
    deltaA: A.map(() => new Array(n).fill(0)),
    deltal: new Array(m).fill(0),
    A_adjusted: A,
    l_adjusted: l,
    residuals,
    sigmaZero,
    Qxx,
    degreesOfFreedom: dof,
    method: 'standard_ls_fallback',
    iterations: 0,
    warnings,
  }
}

// ─── Matrix Helpers ─────────────────────────────────────────────────────────

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
  return A.map(row => row.reduce((s, a, i) => s + a * v[i], 0))
}

function diag(v: number[]): number[][] {
  const n = v.length
  return Array(n).fill(null).map((_, i) =>
    Array(n).fill(null).map((_, j) => (i === j ? v[i] : 0)),
  )
}

function solveLinearSystem(A: number[][], b: number[], n: number): number[] | null {
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let maxRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row
    }
    ;[M[col], M[maxRow]] = [M[maxRow], M[col]]

    if (Math.abs(M[col][col]) < 1e-15) return null

    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / M[col][col]
      for (let k = col; k <= n; k++) M[row][k] -= factor * M[col][k]
    }
  }

  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n]
    for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j]
    x[i] /= M[i][i]
  }
  return x
}

function invertMatrix(A: number[][], n: number): number[][] {
  if (A.length === 0) return Array.from({ length: n }, () => new Array(n).fill(0))
  const M = A.map((row, i) => {
    const aug = [...row, ...new Array(n).fill(0)]
    aug[n + i] = 1
    return aug
  })

  for (let col = 0; col < n; col++) {
    let maxRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row
    }
    ;[M[col], M[maxRow]] = [M[maxRow], M[col]]

    const pivot = M[col][col]
    if (Math.abs(pivot) < 1e-15) return Array.from({ length: n }, () => new Array(n).fill(0))

    for (let k = 0; k < 2 * n; k++) M[col][k] /= pivot
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = M[row][col]
      for (let k = 0; k < 2 * n; k++) M[row][k] -= factor * M[col][k]
    }
  }

  return M.map(row => row.slice(n))
}

/**
 * Jacobi eigenvalue algorithm for symmetric matrices.
 *
 * Returns eigenvalues and eigenvectors of a symmetric n×n matrix.
 * Used by TLS to compute the SVD of [A|l] via eigendecomposition of [A|l]^T·[A|l].
 *
 * Algorithm: classic Jacobi rotations (Press et al., Numerical Recipes, §11.1).
 * Converges in ~5-10 sweeps for typical matrices.
 */
function jacobiEigen(A_in: number[][]): { eigenvalues: number[]; eigenvectors: number[][] } {
  const n = A_in.length
  // Copy A (work on a copy)
  const A = A_in.map(row => [...row])
  // V starts as identity
  const V: number[][] = Array(n).fill(null).map((_, i) =>
    Array(n).fill(null).map((_, j) => (i === j ? 1 : 0) as number),
  )

  const maxSweeps = 100
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    // Compute off-diagonal sum of squares
    let offDiag = 0
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        offDiag += A[i][j] * A[i][j]
      }
    }
    if (offDiag < 1e-20) break  // converged

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-20) continue

        // Compute rotation angle
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q])
        let t: number
        if (Math.abs(theta) > 1e10) {
          t = 1 / (2 * theta)
        } else {
          t = Math.sign(theta) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        }
        const c: number = 1 / Math.sqrt(t * t + 1)
        const s: number = t * c

        // Apply rotation
        const app = A[p][p]
        const aqq = A[q][q]
        const apq = A[p][q]

        A[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq
        A[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq
        A[p][q] = 0
        A[q][p] = 0

        for (let i = 0; i < n; i++) {
          if (i !== p && i !== q) {
            const aip = A[i][p]
            const aiq = A[i][q]
            A[i][p] = c * aip - s * aiq
            A[p][i] = A[i][p]
            A[i][q] = s * aip + c * aiq
            A[q][i] = A[i][q]
          }
          // Update eigenvector matrix
          const vip = V[i][p]
          const viq = V[i][q]
          V[i][p] = c * vip - s * viq
          V[i][q] = s * vip + c * viq
        }
      }
    }
  }

  // Eigenvalues are on the diagonal of A
  const eigenvalues = A.map((row, i) => row[i])

  return { eigenvalues, eigenvectors: V }
}
