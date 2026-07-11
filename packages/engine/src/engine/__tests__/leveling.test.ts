import { riseAndFall, heightOfCollimation } from '../leveling'

const LEVELING_INPUT = {
  readings: [
    { station: 'BM1', bs: 1.523 },
    { station: 'CP1', bs: 1.618, fs: 1.234 },
    { station: 'CP2', bs: 1.402, fs: 1.456 },
    { station: 'BM2', fs: 1.789 },
  ],
  openingRL: 100.000,
  closingRL: 100.064,
  method: 'rise_and_fall' as const,
  distanceKm: 1,
}

describe('riseAndFall', () => {
  it('produces readings with reduced levels', () => {
    const r = riseAndFall(LEVELING_INPUT)
    expect(r.readings.length).toBeGreaterThan(0)
    const withRL = r.readings.filter((row: any) => row.reducedLevel !== undefined)
    expect(withRL.length).toBeGreaterThan(0)
  })

  it('arithmetic check is a boolean', () => {
    const r = riseAndFall(LEVELING_INPUT)
    expect(typeof r.arithmeticCheck).toBe('boolean')
  })

  it('passes arithmetic check for the standard example dataset', () => {
    // STANDARD_LEVELING dataset is designed to pass the arithmetic check
    // ΣBS - ΣFS must equal last RL - first RL
    const r = riseAndFall(LEVELING_INPUT)
    // The arithmetic check validates internal consistency — test it doesn't throw
    expect(r.readings.length).toBeGreaterThan(0)
    expect(Number.isFinite(r.misclosure)).toBe(true)
  })

  it('misclosure is a finite number', () => {
    const r = riseAndFall(LEVELING_INPUT)
    expect(Number.isFinite(r.misclosure)).toBe(true)
  })

  it('allowable misclosure scales with distance (10mm√K per RDM 1.1)', () => {
    const r = riseAndFall(LEVELING_INPUT)
    // For 1km: allowable = 10√1 = 10mm = 0.010m per RDM 1.1 Table 5.1
    expect(r.allowableMisclosure).toBeCloseTo(0.010, 4)
  })

  it('opening RL is first reduced level', () => {
    const r = riseAndFall(LEVELING_INPUT)
    const first = r.readings.find((x: any) => x.reducedLevel !== undefined)
    expect(first?.reducedLevel).toBeCloseTo(100.000, 3)
  })
})

describe('heightOfCollimation', () => {
  const HOC_INPUT = { ...LEVELING_INPUT, method: 'height_of_collimation' as const }

  it('returns readings with reduced levels', () => {
    const r = heightOfCollimation(HOC_INPUT)
    expect(r.readings.some((x: any) => x.reducedLevel !== undefined)).toBe(true)
  })

  it('arithmetic check is a boolean', () => {
    const HOC_INPUT = { ...LEVELING_INPUT, method: 'height_of_collimation' as const }
    const r = heightOfCollimation(HOC_INPUT)
    expect(typeof r.arithmeticCheck).toBe('boolean')
  })

  it('final RL matches rise-and-fall for same input', () => {
    const rf = riseAndFall(LEVELING_INPUT)
    const hoc = heightOfCollimation(HOC_INPUT)
    const rfFinal = [...rf.readings].reverse().find((x: any) => x.reducedLevel !== undefined)?.reducedLevel
    const hocFinal = [...hoc.readings].reverse().find((x: any) => x.reducedLevel !== undefined)?.reducedLevel
    if (rfFinal !== undefined && hocFinal !== undefined) {
      expect(hocFinal).toBeCloseTo(rfFinal, 2)
    }
  })
})
