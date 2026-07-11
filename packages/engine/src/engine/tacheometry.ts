import { toRadians } from './angles'

export type TacheometryInput = {
  instrumentHeight: number
  upper: number
  middle: number
  lower: number
  verticalAngleDeg: number
  K: number
  C: number
}

export type TacheometryResult = {
  S: number
  horizontalDistance: number
  verticalDistance: number
  staffStationRL: number
}

/**
 * Tacheometric reduction (stadia):
 * D = K·S·cos²θ + C
 * V = (K·S·sin2θ)/2
 * RL(staff station) = HI + V − middle
 */
export function tacheometryReduction(input: TacheometryInput): TacheometryResult {
  const S = input.upper - input.lower
  const rad = toRadians(input.verticalAngleDeg)
  const horizontalDistance = input.K * S * (Math.cos(rad) ** 2) + input.C
  const verticalDistance = 0.5 * input.K * S * Math.sin(2 * rad)
  const staffStationRL = input.instrumentHeight + verticalDistance - input.middle
  return { S, horizontalDistance, verticalDistance, staffStationRL }
}

