import type { RoadClass } from '@/types/engineering'

export const KRDM2017 = {
  name: 'Kenya Roads Design Manual 2017',
  shortName: 'KRDM 2017',
  designSpeeds: {
    A: [100, 120],
    B: [80, 100],
    C: [60, 80],
    D: [50, 60],
    E: [30, 50],
    F: [30, 40],
    G: [20, 30],
  } as Record<RoadClass, [number, number]>,
  minRadius: {
    30: 30, 40: 60, 50: 100, 60: 150,
    70: 230, 80: 320, 90: 430, 100: 560,
    110: 710, 120: 890,
  } as Record<number, number>,
  minKValue: {
    crest: {
      30: 1, 40: 3, 50: 6, 60: 11,
      70: 17, 80: 26, 90: 38, 100: 52,
      110: 72, 120: 92,
    } as Record<number, number>,
    sag: {
      30: 3, 40: 6, 50: 9, 60: 13,
      70: 17, 80: 23, 90: 30, 100: 37,
      110: 45, 120: 55,
    } as Record<number, number>,
  },
  maxGrade: {
    A: 5, B: 6, C: 7, D: 8, E: 10, F: 12, G: 15,
  } as Record<RoadClass, number>,
  carriageways: {
    A: 7.4, B: 7.0, C: 6.5, D: 6.0, E: 5.5, F: 5.0, G: 4.5,
  } as Record<RoadClass, number>,
  shoulders: {
    A: 2.0, B: 1.5, C: 1.5, D: 1.0, E: 1.0, F: 0.75, G: 0.5,
  } as Record<RoadClass, number>,
  minSSD: {
    30: 30, 40: 45, 50: 65, 60: 85,
    70: 110, 80: 140, 90: 175, 100: 215,
    110: 260, 120: 305,
  } as Record<number, number>,
}

export const KeRRA = {
  name: 'KeRRA Rural Roads Design Manual',
  shortName: 'KeRRA',
  designSpeeds: {
    D: [50, 60],
    E: [30, 50],
  } as Record<RoadClass, [number, number]>,
  minRadius: {
    30: 25, 40: 50, 50: 80, 60: 120,
  } as Record<number, number>,
  minKValue: {
    crest: { 30: 1, 40: 2, 50: 4, 60: 8 } as Record<number, number>,
    sag: { 30: 2, 40: 4, 50: 7, 60: 10 } as Record<number, number>,
  },
  maxGrade: {
    D: 9, E: 12,
  } as Record<RoadClass, number>,
  carriageways: {
    D: 6.0, E: 5.0,
  } as Record<RoadClass, number>,
  shoulders: {
    D: 1.0, E: 0.5,
  } as Record<RoadClass, number>,
  minSSD: {
    30: 30, 40: 45, 50: 60, 60: 80,
  } as Record<number, number>,
}

export const DRAINAGE_STANDARDS = {
  minGradient: 0.5,
  maxGradient: 10.0,
  minVelocity: 0.6,
  maxVelocity: 3.0,
  manningN: {
    HDPE: 0.011,
    Concrete: 0.013,
    uPVC: 0.011,
    VCP: 0.013,
  } as Record<string, number>,
}

export function getStandards(standard: 'KRDM2017' | 'KeRRA') {
  return standard === 'KRDM2017' ? KRDM2017 : KeRRA
}

export function getDesignSpeedRange(standard: 'KRDM2017' | 'KeRRA', roadClass: RoadClass): [number, number] | null {
  const std = getStandards(standard)
  return std.designSpeeds[roadClass] ?? null
}

export function getMinRadius(standard: 'KRDM2017' | 'KeRRA', designSpeed: number): number {
  const std = getStandards(standard)
  return std.minRadius[designSpeed] ?? 30
}

export function getMinKValue(standard: 'KRDM2017' | 'KeRRA', designSpeed: number, curveType: 'crest' | 'sag'): number {
  const std = getStandards(standard)
  return std.minKValue[curveType][designSpeed] ?? 1
}

export function getMaxGrade(standard: 'KRDM2017' | 'KeRRA', roadClass: RoadClass): number {
  const std = getStandards(standard)
  return std.maxGrade[roadClass] ?? 10
}

export function getCarriagewayWidth(standard: 'KRDM2017' | 'KeRRA', roadClass: RoadClass): number {
  const std = getStandards(standard)
  return std.carriageways[roadClass] ?? 6.0
}

export function getShoulderWidth(standard: 'KRDM2017' | 'KeRRA', roadClass: RoadClass): number {
  const std = getStandards(standard)
  return std.shoulders[roadClass] ?? 1.0
}

export function getMinSSD(standard: 'KRDM2017' | 'KeRRA', designSpeed: number): number {
  const std = getStandards(standard)
  return std.minSSD[designSpeed] ?? designSpeed * 0.7 * 3
}

export function getMinSuperelevation(designSpeed: number, radius: number): number {
  const e = (designSpeed * designSpeed) / (127 * radius)
  return Math.min(e * 100, 10)
}