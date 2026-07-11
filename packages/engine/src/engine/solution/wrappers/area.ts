import { coordinateArea, simpsonsArea, trapezoidalArea } from '@/lib/engine/area'
import type { Point2D } from '@/lib/engine/types'
import { createSolutionV1, solveWithSteps, type Solution, type Solved } from '@/lib/engine/solution/solutionBuilder'
import { formatAreaAcres, formatAreaHa, formatAreaSqm, formatDistanceMeters, fullNumber } from '@/lib/solution/format'

export function coordinateAreaSolution(points: Point2D[]): Solved<ReturnType<typeof coordinateArea>> & { solution: Solution } {
  const r = coordinateArea(points)
  const solution = createSolutionV1({
      title: 'Coordinate (Shoelace) Method',
      given: [
        { label: 'Vertices (in order)', value: `${points.length} point(s)` },
        { label: 'Order', value: 'Clockwise or anticlockwise' },
      ],
      toFind: ['Area', 'Perimeter (if polygon closed)', 'Centroid (if available)'],
      solution: [
        {
          formula: 'A = 0.5 × |Σ(EᵢNᵢ₊₁ − Eᵢ₊₁Nᵢ)|',
          substitution: `Using input coordinates A..${String.fromCharCode(64 + points.length)} (in order)`,
          computation: `A = ${fullNumber(r.areaSqm)} m²`,
          result: formatAreaSqm(r.areaSqm),
        },
        {
          formula: 'Perimeter = Σ distance between consecutive vertices (closed)',
          computation: r.perimeter ? `Perimeter = ${fullNumber(r.perimeter)} m` : 'Perimeter not computed',
          result: r.perimeter ? formatDistanceMeters(r.perimeter) : undefined,
        },
      ],
      check: [{ label: 'Sign check', value: 'If area is negative due to vertex order, absolute value is used.' }],
      result: [
        { label: 'Area', value: formatAreaSqm(r.areaSqm) },
        { label: 'Area (ha)', value: formatAreaHa(r.areaHa) },
        { label: 'Area (acres)', value: formatAreaAcres(r.areaAcres) },
        ...(r.perimeter ? [{ label: 'Perimeter', value: formatDistanceMeters(r.perimeter) }] : []),
        ...(r.centroid
          ? [{ label: 'Centroid (E, N)', value: `(${fullNumber(r.centroid.easting)}, ${fullNumber(r.centroid.northing)}) m` }]
          : []),
      ],
    })

  return solveWithSteps(r, solution)
}

export function offsetAreaSolution(input: { ordinates: number[]; interval: number; method: 'trapezoidal' | 'simpsons' }): Solved<ReturnType<typeof trapezoidalArea>> & { solution: Solution } {
  const ord = input.ordinates
  const int = input.interval

  const r = input.method === 'trapezoidal' ? trapezoidalArea(ord, int) : simpsonsArea(ord, int)
  r.method = input.method === 'trapezoidal' ? 'Trapezoidal Rule' : "Simpson's Rule"

  const step: Solution['solution'][number] =
    input.method === 'trapezoidal'
      ? {
          formula: 'A = d × [ (y₀ + yₙ)/2 + Σyᵢ ]',
          substitution: `d = ${fullNumber(int)} m, ordinates = [${ord.map((x) => fullNumber(x)).join(', ')}]`,
          computation: `A = ${fullNumber(r.areaSqm)} m²`,
          result: formatAreaSqm(r.areaSqm),
        }
      : {
          formula: 'A = (d/3) × [ y₀ + yₙ + 4Σy_odd + 2Σy_even ]',
          substitution: `d = ${fullNumber(int)} m, ordinates = [${ord.map((x) => fullNumber(x)).join(', ')}]`,
          computation: `A = ${fullNumber(r.areaSqm)} m²`,
          result: formatAreaSqm(r.areaSqm),
        }

  const solution = createSolutionV1({
    title: r.method,
    given: [
      { label: 'Ordinates', value: ord.map((x) => fullNumber(x)).join(', ') },
      { label: 'Interval', value: `${fullNumber(int)} m` },
    ],
    toFind: ['Area'],
    solution: [step],
    result: [
      { label: 'Area', value: formatAreaSqm(r.areaSqm) },
      { label: 'Area (ha)', value: formatAreaHa(r.areaHa) },
      { label: 'Area (acres)', value: formatAreaAcres(r.areaAcres) },
    ],
  })

  return solveWithSteps(r, solution)
}
