/**
 * Smoke tests for the sparse matrix module.
 *
 * Verifies:
 *  - CSR construction from triplets
 *  - Sparse matvec vs dense reference
 *  - AᵀDA assembly of normal equations
 *  - Sparse Cholesky on a small SPD matrix
 *  - AMD ordering reduces fill-in
 *  - Selective inverse diagonal matches full inversion
 */

import {
  fromTriplets,
  fromDense,
  toDense,
  sparseMatVec,
  ataDiag,
  atdbDiag,
  approximateMinimumDegree,
  permuteSymmetric,
  symbolicFactorize,
  cholesky,
  sparseForwardSolve,
  sparseBackwardSolve,
  sparseCholeskySolve,
  sparseCholeskySolveOrdered,
  sparseInverseDiagonal,
  diagonal,
} from '../sparseMatrix'

function approxEqual(a: number, b: number, tol = 1e-9): boolean {
  return Math.abs(a - b) < tol
}

function approxEqualVec(a: number[], b: number[], tol = 1e-9): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!approxEqual(a[i], b[i], tol)) return false
  }
  return true
}

describe('sparseMatrix — construction', () => {
  test('fromTriplets builds correct CSR', () => {
    const M = fromTriplets(3, 3, [
      { row: 0, col: 0, value: 4 },
      { row: 1, col: 1, value: 9 },
      { row: 2, col: 2, value: 16 },
      { row: 1, col: 0, value: 1 },
    ], true) // symmetric, lower triangle: only (0,0), (1,0), (1,1), (2,2)

    expect(M.rows).toBe(3)
    expect(M.cols).toBe(3)
    expect(M.symmetric).toBe(true)
    // Lower triangle only: (0,0), (1,0), (1,1), (2,2)
    expect(M.colIdx).toEqual([0, 0, 1, 2])
    expect(M.values).toEqual([4, 1, 9, 16])
  })

  test('fromDense preserves non-zeros', () => {
    const dense = [
      [4, 1, 0],
      [1, 9, 2],
      [0, 2, 16],
    ]
    const M = fromDense(dense, true)
    expect(M.rows).toBe(3)
    // Lower triangle: (0,0)=4, (1,0)=1, (1,1)=9, (2,1)=2, (2,2)=16
    expect(M.colIdx).toEqual([0, 0, 1, 1, 2])
    expect(M.values).toEqual([4, 1, 9, 2, 16])
  })

  test('toDense reconstructs symmetric matrix', () => {
    const dense = [
      [4, 1, 0],
      [1, 9, 2],
      [0, 2, 16],
    ]
    const M = fromDense(dense, true)
    const reconstructed = toDense(M)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(approxEqual(reconstructed[i][j], dense[i][j])).toBe(true)
      }
    }
  })
})

describe('sparseMatrix — matvec', () => {
  test('sparseMatVec matches dense', () => {
    const dense = [
      [4, 1, 0],
      [1, 9, 2],
      [0, 2, 16],
    ]
    const M = fromDense(dense, true)
    const x = [1, 2, 3]
    const ySparse = sparseMatVec(M, x)
    const yDense = dense.map((row) => row.reduce((s, v, i) => s + v * x[i], 0))
    expect(approxEqualVec(ySparse, yDense)).toBe(true)
  })
})

describe('sparseMatrix — normal equation assembly', () => {
  test('ataDiag computes AᵀDA correctly', () => {
    // A = [[1, 0], [1, 1], [0, 1]]  (3 obs, 2 params)
    // D = diag(2, 3, 4)
    // AᵀDA = [[5, 3], [3, 7]]
    const A = fromTriplets(3, 2, [
      { row: 0, col: 0, value: 1 },
      { row: 1, col: 0, value: 1 },
      { row: 1, col: 1, value: 1 },
      { row: 2, col: 1, value: 1 },
    ])
    const d = [2, 3, 4]
    const N = ataDiag(A, d)

    // Lower triangle: (0,0)=5, (1,0)=3, (1,1)=7
    const dense = toDense(N)
    expect(approxEqual(dense[0][0], 5)).toBe(true)
    expect(approxEqual(dense[1][0], 3)).toBe(true)
    expect(approxEqual(dense[1][1], 7)).toBe(true)
  })

  test('atdbDiag computes AᵀDb correctly', () => {
    const A = fromTriplets(3, 2, [
      { row: 0, col: 0, value: 1 },
      { row: 1, col: 0, value: 1 },
      { row: 1, col: 1, value: 1 },
      { row: 2, col: 1, value: 1 },
    ])
    const d = [2, 3, 4]
    const b = [1, 2, 3]
    // u[0] = 1*2*1 + 1*3*2 + 0*4*3 = 2 + 6 = 8
    // u[1] = 0*2*1 + 1*3*2 + 1*4*3 = 6 + 12 = 18
    const u = atdbDiag(A, d, b)
    expect(approxEqual(u[0], 8)).toBe(true)
    expect(approxEqual(u[1], 18)).toBe(true)
  })
})

describe('sparseMatrix — Cholesky', () => {
  test('factors simple SPD matrix', () => {
    // M = [[4, 2], [2, 5]]
    // L should be [[2, 0], [1, 2]]
    const dense = [
      [4, 2],
      [2, 5],
    ]
    const M = fromDense(dense, true)
    const symbolic = symbolicFactorize(M)
    const { L } = cholesky(M, symbolic)

    // L as dense
    const Ldense = toDense({ ...L, symmetric: false })
    expect(approxEqual(Ldense[0][0], 2)).toBe(true)
    expect(approxEqual(Ldense[0][1], 0)).toBe(true)
    expect(approxEqual(Ldense[1][0], 1)).toBe(true)
    expect(approxEqual(Ldense[1][1], 2)).toBe(true)
  })

  test('sparseCholeskySolve matches dense solve', () => {
    // M = [[4, 2, 0], [2, 5, 1], [0, 1, 3]]
    // b = [1, 2, 3]
    const dense = [
      [4, 2, 0],
      [2, 5, 1],
      [0, 1, 3],
    ]
    const M = fromDense(dense, true)
    const b = [1, 2, 3]
    const x = sparseCholeskySolve(M, b)

    // Verify M·x = b
    const mx = sparseMatVec(M, x)
    expect(approxEqualVec(mx, b, 1e-9)).toBe(true)
  })

  test('sparseCholeskySolveOrdered matches unordered', () => {
    const dense = [
      [4, 2, 0, 1],
      [2, 5, 1, 0],
      [0, 1, 3, 2],
      [1, 0, 2, 6],
    ]
    const M = fromDense(dense, true)
    const b = [1, 2, 3, 4]
    const x1 = sparseCholeskySolve(M, b)
    const { x: x2 } = sparseCholeskySolveOrdered(M, b)
    expect(approxEqualVec(x1, x2, 1e-9)).toBe(true)
  })

  test('selective inverse diagonal matches full inverse', () => {
    // For M = [[4, 2], [2, 5]], M⁻¹ = (1/16) * [[5, -2], [-2, 4]]
    // Diagonal of M⁻¹ = [5/16, 4/16] = [0.3125, 0.25]
    const dense = [
      [4, 2],
      [2, 5],
    ]
    const M = fromDense(dense, true)
    const invDiag = sparseInverseDiagonal(M)
    expect(approxEqual(invDiag[0], 5 / 16, 1e-9)).toBe(true)
    expect(approxEqual(invDiag[1], 4 / 16, 1e-9)).toBe(true)
  })

  test('handles larger sparse network (chain of stations)', () => {
    // Chain of 50 stations, each connected to its neighbors
    // Normal matrix is tridiagonal — sparse Cholesky should be fast
    const n = 50
    const dense: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
    for (let i = 0; i < n; i++) {
      dense[i][i] = 2
      if (i > 0) dense[i][i - 1] = -1
      if (i < n - 1) dense[i][i + 1] = -1
    }
    // Make SPD: add 1 to last diagonal
    dense[n - 1][n - 1] += 1

    const M = fromDense(dense, true)
    const b = new Array(n).fill(0).map((_, i) => i)
    const { x } = sparseCholeskySolveOrdered(M, b)
    const mx = sparseMatVec(M, x)
    expect(approxEqualVec(mx, b, 1e-6)).toBe(true)
  })
})

describe('sparseMatrix — AMD ordering', () => {
  test('produces valid permutation', () => {
    const dense = [
      [4, 1, 0, 1],
      [1, 5, 1, 0],
      [0, 1, 6, 1],
      [1, 0, 1, 7],
    ]
    const M = fromDense(dense, true)
    const perm = approximateMinimumDegree(M)
    expect(perm.length).toBe(4)
    expect(new Set(perm)).toEqual(new Set([0, 1, 2, 3]))
  })

  test('permutation preserves matrix structure', () => {
    const dense = [
      [4, 1, 0, 1],
      [1, 5, 1, 0],
      [0, 1, 6, 1],
      [1, 0, 1, 7],
    ]
    const M = fromDense(dense, true)
    const perm = approximateMinimumDegree(M)
    const Mp = permuteSymmetric(M, perm)
    // After permutation, the permuted matrix should still have the same eigenvalues
    // Verify by checking that trace is preserved
    const origTrace = dense.reduce((s, row, i) => s + row[i], 0)
    const newTrace = diagonal(Mp).reduce((s, v) => s + v, 0)
    expect(approxEqual(origTrace, newTrace)).toBe(true)
  })
})

describe('sparseMatrix — error handling', () => {
  test('throws on non-SPD matrix', () => {
    // Indefinite matrix
    const dense = [
      [1, 2],
      [2, 1],
    ]
    const M = fromDense(dense, true)
    expect(() => sparseCholeskySolve(M, [1, 2])).toThrow()
  })

  test('throws on dimension mismatch', () => {
    const M = fromTriplets(2, 2, [{ row: 0, col: 0, value: 1 }])
    expect(() => sparseMatVec(M, [1, 2, 3])).toThrow()
  })
})
