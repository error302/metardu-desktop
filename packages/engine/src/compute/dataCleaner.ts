import type { RawSurveyPoint, CleanDataResponse, CleanDataRequest } from '@/types/fieldguard'

const BASE = process.env.NEXT_PUBLIC_URL || ''

function buildLocalFallback(points: RawSurveyPoint[]): CleanDataResponse {
  if (points.length === 0) {
    return {
      cleaned_points: [],
      anomalies: [],
      confidence_scores: {},
      summary: {
        total_points: 0,
        outliers_removed: 0,
        classified_count: 0,
        confidence_avg: 0,
      },
    }
  }

  const centroid = points.reduce(
    (acc, point) => ({
      easting: acc.easting + point.easting / points.length,
      northing: acc.northing + point.northing / points.length,
    }),
    { easting: 0, northing: 0 }
  )

  const distances = points.map((point: any) =>
    Math.hypot(point.easting - centroid.easting, point.northing - centroid.northing)
  )
  const sortedDistances = [...distances].sort((a: any, b: any) => a - b)
  const medianDistance = sortedDistances[Math.floor(sortedDistances.length / 2)] || 0
  const anomalyThreshold = Math.max(medianDistance * 3, 5)

  const anomalies = points.flatMap((point, index) => {
    const anomalyList: CleanDataResponse['anomalies'] = []
    const distanceFromCentroid = distances[index]

    if (distanceFromCentroid > anomalyThreshold) {
      anomalyList.push({
        point_id: point.id || String(index),
        type: 'outlier',
        severity: 'medium',
        description: 'Point deviates significantly from the local centroid.',
      })
    }

    if (index > 0 && point.elevation !== undefined && points[index - 1].elevation !== undefined) {
      const elevationJump = Math.abs(point.elevation - (points[index - 1].elevation || 0))
      if (elevationJump > 25) {
        anomalyList.push({
          point_id: point.id || String(index),
          type: 'elevation_jump',
          severity: 'medium',
          description: 'Elevation differs sharply from the previous reading.',
        })
      }
    }

    return anomalyList
  })

  const confidence_scores = Object.fromEntries(
    points.map((point, index) => {
      const pointId = point.id || String(index)
      const hasAnomaly = anomalies.some((anomaly: any) => anomaly.point_id === pointId)
      return [pointId, hasAnomaly ? 0.7 : 0.95]
    })
  )

  const cleaned_points = points.map((point, index) => {
    const pointId = point.id || String(index)
    return {
      ...point,
      cleaned: true,
      confidence: confidence_scores[pointId],
    }
  })

  const confidenceValues = Object.values(confidence_scores)

  return {
    cleaned_points,
    anomalies,
    confidence_scores,
    summary: {
      total_points: points.length,
      outliers_removed: anomalies.filter((anomaly: any) => anomaly.type === 'outlier').length,
      classified_count: 0,
      confidence_avg: confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length,
    },
  }
}

export async function cleanSurveyData(
  points: RawSurveyPoint[],
  data_type: 'gnss' | 'totalstation' | 'lidar',
  options?: { outlier_threshold?: number; classification_enabled?: boolean }
): Promise<CleanDataResponse> {
  if (typeof fetch !== 'function') {
    return buildLocalFallback(points)
  }

  try {
    const res = await fetch(`${BASE}/api/ai/clean-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points, data_type, options } as CleanDataRequest)
    })
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || 'Failed to clean data')
    }
    
    return res.json()
  } catch (error) {
    console.warn('Falling back to local survey data cleaning:', error)
    return buildLocalFallback(points)
  }
}
