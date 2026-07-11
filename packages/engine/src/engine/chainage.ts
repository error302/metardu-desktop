import { distanceBearing } from './distance'

export type ChainageRow = {
  pointName: string
  easting: number
  northing: number
  chainage: number
  distance: number
}

export function computeChainageTable(input: {
  start: { easting: number; northing: number }
  startName?: string
  startChainage: number
  alignment: Array<{ name: string; easting: number; northing: number }>
}): ChainageRow[] {
  const rows: ChainageRow[] = []
  let total = input.startChainage
  let prev = { easting: input.start.easting, northing: input.start.northing }

  rows.push({ pointName: input.startName ?? 'START', easting: prev.easting, northing: prev.northing, chainage: total, distance: 0 })

  for (const p of input.alignment) {
    const dist = distanceBearing(prev, { easting: p.easting, northing: p.northing }).distance
    total += dist
    rows.push({ pointName: p.name, easting: p.easting, northing: p.northing, chainage: total, distance: dist })
    prev = { easting: p.easting, northing: p.northing }
  }

  return rows
}

export function reverseChainageLinear(input: {
  targetChainage: number
  table: ChainageRow[]
}): { easting: number; northing: number } | null {
  const rows = input.table
  if (rows.length < 2) return null
  const target = input.targetChainage

  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]
    const b = rows[i]
    if (target < Math.min(a.chainage, b.chainage) || target > Math.max(a.chainage, b.chainage)) continue
    const segLen = b.chainage - a.chainage
    const t = segLen !== 0 ? (target - a.chainage) / segLen : 0
    return {
      easting: a.easting + t * (b.easting - a.easting),
      northing: a.northing + t * (b.northing - a.northing),
    }
  }

  return null
}
