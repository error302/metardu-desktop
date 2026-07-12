/**
 * @module progressiveVolumeTracking
 *
 * Multi-epoch volume tracking for earthworks monitoring.
 *
 * Tracks cut/fill volumes over time by comparing successive survey epochs.
 * Used for:
 *   - Construction site progress monitoring (weekly/monthly surveys)
 *   - Mining stockpile tracking (how much material has been moved)
 *   - Landfill volume tracking (how much fill has been placed)
 *   - Erosion monitoring (how much soil has been lost)
 *
 * Each epoch is a survey (point cloud or TIN) captured at a specific date.
 * The module computes:
 *   - Volume change between consecutive epochs (epoch N vs epoch N-1)
 *   - Cumulative volume change from the baseline (epoch N vs epoch 1)
 *   - Progress percentage (actual volume moved vs design volume)
 */

import { gridMethodVolume, type Point3D, type VolumeResult } from '../compute/pointCloudVolume'

export interface SurveyEpoch {
  /** Unique identifier */
  id: string
  /** Human-readable name (e.g., "Week 1 - Initial Survey") */
  name: string
  /** Date of the survey */
  date: string
  /** 3D points captured in this epoch */
  points: Point3D[]
  /** Volume result (computed lazily) */
  volume?: VolumeResult
}

export interface EpochComparison {
  /** From epoch */
  fromEpochId: string
  /** To epoch */
  toEpochId: string
  /** Volume change between the two epochs */
  cut: number
  fill: number
  net: number
  /** Cumulative change from baseline */
  cumulativeCut: number
  cumulativeFill: number
  cumulativeNet: number
  /** Date range */
  fromDate: string
  toDate: string
  /** Days between epochs */
  daysBetween: number
  /** Average daily rate (m³/day) */
  dailyRate: number
}

export interface ProgressiveTrackingState {
  /** All recorded epochs (oldest first) */
  epochs: SurveyEpoch[]
  /** The baseline epoch (first survey) */
  baselineEpochId: string | null
  /** The design volume (target cut/fill for the project) */
  designVolume: number | null
  /** All epoch comparisons */
  comparisons: EpochComparison[]
  /** Total progress (% of design volume achieved) */
  progressPercent: number | null
}

/**
 * Progressive volume tracker.
 *
 * Usage:
 *   const tracker = new ProgressiveVolumeTracker()
 *   tracker.setDesignVolume(50000) // 50,000 m³ to move
 *   tracker.addEpoch('Week 1', '2026-01-01', points1)
 *   tracker.addEpoch('Week 2', '2026-01-08', points2)
 *   const state = tracker.compute()
 *   // → state.comparisons shows volume change between weeks
 *   // → state.progressPercent shows % of design volume completed
 */
export class ProgressiveVolumeTracker {
  private epochs: SurveyEpoch[] = []
  private designVolume: number | null = null
  private baselineEpochId: string | null = null
  private comparisons: EpochComparison[] = []

  /** Set the design volume (target cut or fill for the project). */
  setDesignVolume(volume: number) {
    this.designVolume = volume
  }

  /**
   * Add a new survey epoch.
   * The first epoch added becomes the baseline.
   */
  addEpoch(name: string, date: string, points: Point3D[]): SurveyEpoch {
    const epoch: SurveyEpoch = {
      id: `epoch-${this.epochs.length + 1}`,
      name,
      date,
      points,
    }

    this.epochs.push(epoch)

    if (this.baselineEpochId === null) {
      this.baselineEpochId = epoch.id
    }

    return epoch
  }

  /**
   * Compute all epoch comparisons.
   * Compares each epoch to both the previous epoch AND the baseline.
   */
  compute(): ProgressiveTrackingState {
    this.comparisons = []

    if (this.epochs.length < 2) {
      return {
        epochs: this.epochs,
        baselineEpochId: this.baselineEpochId,
        designVolume: this.designVolume,
        comparisons: [],
        progressPercent: null,
      }
    }

    let cumulativeCut = 0
    let cumulativeFill = 0

    for (let i = 1; i < this.epochs.length; i++) {
      const prev = this.epochs[i - 1]
      const curr = this.epochs[i]

      // Compute volume between consecutive epochs
      const result = gridMethodVolume(prev.points, curr.points, 1.0)

      // Accumulate cumulative change from baseline
      cumulativeCut += result.cut
      cumulativeFill += result.fill

      const fromDate = new Date(prev.date)
      const toDate = new Date(curr.date)
      const daysBetween = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)))
      const dailyRate = result.net / daysBetween

      this.comparisons.push({
        fromEpochId: prev.id,
        toEpochId: curr.id,
        cut: result.cut,
        fill: result.fill,
        net: result.net,
        cumulativeCut,
        cumulativeFill,
        cumulativeNet: cumulativeCut - cumulativeFill,
        fromDate: prev.date,
        toDate: curr.date,
        daysBetween,
        dailyRate,
      })
    }

    // Calculate progress percentage
    let progressPercent: number | null = null
    if (this.designVolume && this.designVolume > 0) {
      const totalMoved = cumulativeCut + cumulativeFill
      progressPercent = Math.min(100, (totalMoved / this.designVolume) * 100)
    }

    return {
      epochs: this.epochs,
      baselineEpochId: this.baselineEpochId,
      designVolume: this.designVolume,
      comparisons: this.comparisons,
      progressPercent,
    }
  }

  /** Get the current state without recomputing. */
  getState(): ProgressiveTrackingState {
    return {
      epochs: this.epochs,
      baselineEpochId: this.baselineEpochId,
      designVolume: this.designVolume,
      comparisons: this.comparisons,
      progressPercent: null, // Recompute to get this
    }
  }

  /** Clear all epochs. */
  reset() {
    this.epochs = []
    this.baselineEpochId = null
    this.comparisons = []
  }

  /** Remove an epoch by ID. */
  removeEpoch(epochId: string) {
    this.epochs = this.epochs.filter(e => e.id !== epochId)
    if (this.baselineEpochId === epochId) {
      this.baselineEpochId = this.epochs[0]?.id || null
    }
  }
}

/**
 * Format a volume for display (human-readable).
 */
export function formatVolume(volume: number): string {
  if (Math.abs(volume) >= 1000) {
    return `${(volume / 1000).toFixed(1)}K m³`
  }
  return `${volume.toFixed(1)} m³`
}

/**
 * Format a daily rate for display.
 */
export function formatDailyRate(rate: number): string {
  const sign = rate >= 0 ? '+' : ''
  return `${sign}${formatVolume(rate)}/day`
}
