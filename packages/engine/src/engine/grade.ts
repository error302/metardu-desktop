import { gradient } from './distance'

export type GradeResult = {
  riseFall: number
  gradientPercent: number
  slopeAngleDeg: number
  ratio: number
}

export function gradeFromElevations(input: { elev1: number; elev2: number; horizontalDistance: number }): GradeResult {
  const riseFall = input.elev2 - input.elev1
  const g = gradient(riseFall, input.horizontalDistance)
  const ratio = riseFall === 0 ? Infinity : Math.abs(input.horizontalDistance / riseFall)
  return {
    riseFall,
    gradientPercent: g.percentage,
    slopeAngleDeg: g.degrees,
    ratio,
  }
}

