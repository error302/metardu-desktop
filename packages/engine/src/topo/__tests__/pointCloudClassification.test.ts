/**
 * Point Cloud Classification Tests
 * Run: npx jest src/lib/topo/__tests__/pointCloudClassification.test.ts
 */

import { describe, it, expect } from '@jest/globals'
import {
  classifyPointCloud,
  extractGroundPoints,
  getClassificationStats,
  DEFAULT_PARAMS,
} from '../pointCloudClassification'

describe('classifyPointCloud', () => {
  it('classifies a flat surface as ground', () => {
    const points = [
      { x: 0, y: 0, z: 100 },
      { x: 5, y: 0, z: 100 },
      { x: 0, y: 5, z: 100 },
      { x: 5, y: 5, z: 100.1 },
    ]
    const result = classifyPointCloud(points, { ...DEFAULT_PARAMS, cellSize: 10 })
    const ground = result.filter(p => p.classification === 'ground')
    expect(ground.length).toBeGreaterThan(0)
  })

  it('classifies elevated points above threshold as vegetation/building', () => {
    const points = [
      { x: 0, y: 0, z: 100 },
      { x: 1, y: 0, z: 100 },
      { x: 0, y: 1, z: 100 },
      { x: 1, y: 1, z: 100.01 },
      { x: 0.5, y: 0.5, z: 103 }, // 3m above ground
    ]
    const result = classifyPointCloud(points, { ...DEFAULT_PARAMS, cellSize: 5 })
    const elevated = result.find(p => p.z === 103)
    expect(elevated).toBeDefined()
    expect(elevated?.classification).not.toBe('ground')
  })

  it('returns empty array for empty input', () => {
    const result = classifyPointCloud([])
    expect(result).toEqual([])
  })

  it('extractGroundPoints returns only ground-classified points', () => {
    const points = [
      { x: 0, y: 0, z: 100 },
      { x: 1, y: 1, z: 100 },
      { x: 2, y: 2, z: 106 }, // high vegetation
    ]
    const classified = classifyPointCloud(points, { ...DEFAULT_PARAMS, cellSize: 5 })
    const ground = extractGroundPoints(classified)
    expect(ground.length).toBeGreaterThan(0)
    expect(ground.every(p => p.z < 101)).toBe(true)
  })

  it('getClassificationStats returns counts per class', () => {
    const points = [
      { x: 0, y: 0, z: 100 },
      { x: 1, y: 1, z: 100 },
      { x: 2, y: 2, z: 106 },
    ]
    const classified = classifyPointCloud(points, { ...DEFAULT_PARAMS, cellSize: 5 })
    const stats = getClassificationStats(classified)
    expect(stats.ground).toBeGreaterThan(0)
    expect(Object.values(stats).reduce((a, b) => a + b, 0)).toBe(classified.length)
  })
})
