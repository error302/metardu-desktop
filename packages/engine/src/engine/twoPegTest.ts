// METARDU Two-Peg Test Computation
// Source: N.N. Basak, Surveying and Levelling, Chapter 14 — Two-Peg Test
// Source: Ghilani & Wolf, Elementary Surveying 16th Ed., Chapter 23 — Instrument Adjustment Check
// Source: USACE EM 1110-1-1005 §3-6 — Collimation error threshold 30 arc-seconds

export type TwoPegTestResult = {
  obsDiff1: number
  obsDiff2: number
  trueDiff: number
  collimationError: number
  collimationPer100m: number
  allowableMmPer100m: number
  pass: boolean
  baselineMeters: number
}

export function twoPegTest(input: {
  A1: number
  B1: number
  A2: number
  B2: number
  baselineMeters?: number
  allowableMmPer100m?: number
}): TwoPegTestResult {
  const baselineMeters = input.baselineMeters ?? 100
  const allowableMmPer100m = input.allowableMmPer100m ?? 10

  const obsDiff1 = input.A1 - input.B1
  const obsDiff2 = input.A2 - input.B2
  const trueDiff = (obsDiff1 + obsDiff2) / 2
  const collimationError = (obsDiff1 - obsDiff2) / 2
  const collimationPer100m = collimationError * (100 / baselineMeters)
  const pass = Math.abs(collimationPer100m * 1000) <= allowableMmPer100m

  return {
    obsDiff1,
    obsDiff2,
    trueDiff,
    collimationError,
    collimationPer100m,
    allowableMmPer100m,
    pass,
    baselineMeters,
  }
}

