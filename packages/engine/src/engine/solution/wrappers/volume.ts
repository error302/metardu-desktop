import {
  cutFillVolumeFromSignedSections,
  surfaceCutFillVolumeGrid,
  volumeFromSections,
  type CutFillVolumeResult,
  type SurfaceVolumeGridInput,
  type SurfaceVolumeGridResult,
  type VolumeMethod,
  type VolumeResult,
  type VolumeSection,
} from '@/lib/engine/volume'
import { createSolutionV1, solveWithSteps, type Solved, type Solution } from '@/lib/engine/solution/solutionBuilder'
import { fullNumber } from '@/lib/solution/format'

function formatVolumeCubicMeters(v: number): string {
  return `${v.toFixed(3)} m³`
}

function chainageSummary(sections: VolumeSection[]) {
  if (!sections.length) return '—'
  const sorted = [...sections].sort((a: any, b: any) => a.chainage - b.chainage)
  return `${sorted[0].chainage} m → ${sorted[sorted.length - 1].chainage} m`
}

export function volumeFromSectionsSolved(sections: VolumeSection[], method: VolumeMethod): Solved<VolumeResult> & { solution: Solution } {
  const r = volumeFromSections(sections, method)
  const sumSegments = r.segments.reduce((s, seg) => s + seg.volume, 0)
  const diff = sumSegments - r.totalVolume

  const first = r.segments[0]
  const formula =
    method === 'end_area'
      ? 'V = (L/2) × (A₁ + A₂)'
      : 'V = (L/6) × (A₁ + 4Aₘ + A₂)  (applied on chainage triplets)'

  const substitution =
    method === 'end_area' && first
      ? `Example: V = (${fullNumber(first.L)}/2) × (${fullNumber(first.A1)} + ${fullNumber(first.A2)})`
      : method === 'prismoidal' && first
        ? `Example: V = (${fullNumber(first.L)}/6) × (${fullNumber(first.A1)} + 4×${fullNumber(first.Am ?? 0)} + ${fullNumber(first.A2)})`
        : undefined

  const solution = createSolutionV1({
    title: `Volume from Cross-Sections (${method === 'end_area' ? 'End Area' : 'Prismoidal'})`,
    given: [
      { label: 'Method', value: method === 'end_area' ? 'End Area' : 'Prismoidal' },
      { label: 'No. of sections', value: String(sections.length) },
      { label: 'Chainage range', value: chainageSummary(sections) },
    ],
    toFind: ['Segment volumes', 'Total volume'],
    solution: [
      { title: 'Volume formula', formula },
      ...(substitution ? [{ title: 'Substitution (example segment)', formula, substitution }] : []),
      {
        title: 'Total volume',
        formula: 'Total = ΣV(segment)',
        computation: `Total = ${fullNumber(r.totalVolume)} m³`,
        result: formatVolumeCubicMeters(r.totalVolume),
      },
    ],
    check: [
      {
        label: 'Arithmetic check',
        value: `ΣV − Total = ${fullNumber(diff)} m³`,
        ok: Math.abs(diff) < 1e-9,
      },
      ...(method === 'prismoidal' && sections.length % 2 === 0
        ? [{ label: 'Prismoidal pairing', value: 'Even section count: last section may be unused by triplet method.', ok: true }]
        : []),
    ],
    result: [
      { label: 'Total volume', value: formatVolumeCubicMeters(r.totalVolume) },
      { label: 'Segments', value: `${r.segments.length} segment(s)` },
    ],
  })

  return solveWithSteps(r, solution)
}

export function cutFillVolumeSolvedFromSignedSections(sections: VolumeSection[]): Solved<CutFillVolumeResult> & { solution: Solution } {
  const r = cutFillVolumeFromSignedSections(sections)
  const sumSegments = r.segments.reduce((s, seg) => s + seg.volume, 0)
  const diff = sumSegments - (r.cutVolume - r.fillVolume)

  const solution = createSolutionV1({
    title: 'Cut/Fill Volume (Signed Cross-Sections)',
    given: [
      { label: 'Convention', value: '+Area = Cut, −Area = Fill' },
      { label: 'No. of sections', value: String(sections.length) },
      { label: 'Chainage range', value: chainageSummary(sections) },
    ],
    toFind: ['Cut volume', 'Fill volume', 'Net volume'],
    solution: [
      {
        title: 'Segment volume',
        formula: 'V = (L/2) × (A₁ + A₂)',
        computation: `${r.segments.length} segment(s) evaluated in order of chainage`,
      },
      {
        title: 'Summation',
        formula: 'Net = Cut − Fill',
        substitution: `Cut=${fullNumber(r.cutVolume)} m³, Fill=${fullNumber(r.fillVolume)} m³`,
        computation: `Net = ${fullNumber(r.netVolume)} m³`,
      },
    ],
    check: [{ label: 'Arithmetic check', value: `ΣV − Net = ${fullNumber(diff)} m³`, ok: Math.abs(diff) < 1e-6 }],
    result: [
      { label: 'Cut', value: formatVolumeCubicMeters(r.cutVolume) },
      { label: 'Fill', value: formatVolumeCubicMeters(r.fillVolume) },
      { label: 'Net', value: formatVolumeCubicMeters(r.netVolume) },
    ],
  })

  return solveWithSteps(r, solution)
}

export function surfaceCutFillVolumeGridSolved(input: SurfaceVolumeGridInput): Solved<SurfaceVolumeGridResult> & { solution: Solution } {
  const r = surfaceCutFillVolumeGrid(input)

  const solution = createSolutionV1({
    title: 'Surface Cut/Fill (Deterministic Grid, IDW)',
    given: [
      { label: 'Grid spacing', value: `${fullNumber(input.gridSpacing)} m` },
      { label: 'Existing points', value: String(input.existing.length) },
      { label: 'Design points', value: String(input.design.length) },
      { label: 'IDW power', value: String(input.power ?? 2) },
      { label: 'Max influence radius', value: `${fullNumber(input.maxDistance ?? input.gridSpacing * 3)} m` },
    ],
    toFind: ['Cut volume', 'Fill volume', 'Net volume'],
    solution: [
      {
        title: 'Interpolation (IDW)',
        formula: 'z(x) = Σ(wᵢzᵢ) / Σ(wᵢ),  wᵢ = 1 / dᵖ',
        computation: 'Interpolate existing and design elevations at each grid cell centre.',
      },
      {
        title: 'Cell integration',
        formula: 'ΔV = (zExisting − zDesign) × cellArea',
        substitution: `cellArea = ${fullNumber(input.gridSpacing)} × ${fullNumber(input.gridSpacing)} m²`,
        computation: `Cells evaluated = ${r.cellCount}`,
      },
      {
        title: 'Summation',
        formula: 'Cut where zExisting > zDesign; Fill where zDesign > zExisting',
        computation: `Cut=${fullNumber(r.cutVolume)} m³, Fill=${fullNumber(r.fillVolume)} m³, Net=${fullNumber(r.netVolume)} m³`,
      },
    ],
    check: [
      ...(r.warnings.length ? [{ label: 'Warnings', value: r.warnings.join(' ') }] : []),
      { label: 'Cells evaluated', value: String(r.cellCount), ok: r.cellCount > 0 },
    ],
    result: [
      { label: 'Cut', value: formatVolumeCubicMeters(r.cutVolume) },
      { label: 'Fill', value: formatVolumeCubicMeters(r.fillVolume) },
      { label: 'Net', value: formatVolumeCubicMeters(r.netVolume) },
      { label: 'Cells', value: String(r.cellCount) },
    ],
  })

  return solveWithSteps(r, solution)
}

