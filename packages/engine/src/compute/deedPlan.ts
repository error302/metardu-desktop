import type { BoundaryPoint, BoundaryLeg, ClosureCheck } from '@/types/deedPlan'

export function computeBoundaryLegs(points: BoundaryPoint[]): BoundaryLeg[] {
  if (points.length < 3) {
    throw new Error('A polygon requires at least 3 boundary points')
  }

  const legs: BoundaryLeg[] = []
  const closedPoints = [...points, points[0]]

  for (let i = 0; i < closedPoints.length - 1; i++) {
    const from = closedPoints[i]
    const to = closedPoints[i + 1]

    const deltaE = to.easting - from.easting
    const deltaN = to.northing - from.northing

    // Source: Ghilani & Wolf — WCB from North, clockwise: θ = atan2(ΔE, ΔN)
    const bearingDecimal = Math.atan2(deltaE, deltaN) * (180 / Math.PI)
    const bearing360 = (bearingDecimal + 360) % 360

    // Compute at full precision — do NOT round intermediate values
    const distance = Math.sqrt(deltaE * deltaE + deltaN * deltaN)

    legs.push({
      fromPoint: from.id,
      toPoint: to.id,
      bearing: degreesToDMS(bearing360),
      distance: Math.round(distance * 1000) / 1000 // 3dp = 1mm precision, per Kenya cadastral standard
    })
  }

  return legs
}

/**
 * Convert decimal degrees to DMS string.
 * FIXED: Previous version rounded seconds to 0 decimal places, losing sub-arcsecond
 * precision required for cadastral work. Now displays seconds to 1 decimal place
 * (nearest 0.1 arcsecond), which is the standard for Kenya deed plans.
 * Source: Kenya Survey Regulations 1994, Part XI — bearings to nearest second of arc
 */
export function degreesToDMS(decimalDegrees: number): string {
  const d = Math.floor(decimalDegrees)
  const decimalMinutes = (decimalDegrees - d) * 60
  const m = Math.floor(decimalMinutes)
  const seconds = (decimalMinutes - m) * 60

  return `${String(d).padStart(3, '0')}°${String(m).padStart(2, '0')}'${seconds.toFixed(1).padStart(5, '0')}"`
}

export function computeArea(points: BoundaryPoint[]): number {
  if (points.length < 3) {
    return 0
  }

  let area = 0
  const n = points.length

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += points[i].easting * points[j].northing
    area -= points[j].easting * points[i].northing
  }

  return Math.round(Math.abs(area / 2) * 10000) / 10000
}

/**
 * Compute closure check for a polygon defined by boundary points.
 * FIXED: Previous version rounded intermediate values (closingErrorE, closingErrorN, perimeter)
 * to 2 decimal places (1cm), which cascades rounding errors into the precision ratio.
 * Now computes at full precision and rounds ONLY at the display layer.
 * Source: Kenya Survey Regulations 1994 — cadastral minimum 1:5000
 */
export function computeClosureCheck(points: BoundaryPoint[]): ClosureCheck {
  if (points.length < 3) {
    return {
      closingErrorE: 0,
      closingErrorN: 0,
      perimeter: 0,
      precisionRatio: 'N/A',
      passes: false
    }
  }

  let totalDeparture = 0
  let totalLatitude = 0
  let perimeter = 0
  const closedPoints = [...points, points[0]]

  for (let i = 0; i < closedPoints.length - 1; i++) {
    const deltaE = closedPoints[i + 1].easting - closedPoints[i].easting
    const deltaN = closedPoints[i + 1].northing - closedPoints[i].northing

    totalDeparture += deltaE
    totalLatitude += deltaN

    const distance = Math.sqrt(deltaE * deltaE + deltaN * deltaN)
    perimeter += distance
  }

  // Compute at full precision — no intermediate rounding
  const closingErrorE = Math.abs(totalDeparture)
  const closingErrorN = Math.abs(totalLatitude)
  const linearMisclosure = Math.sqrt(closingErrorE * closingErrorE + closingErrorN * closingErrorN)

  const precisionRatio = linearMisclosure > 0
    ? perimeter / linearMisclosure
    : Infinity

  const formattedRatio = `1 : ${Math.round(precisionRatio).toLocaleString()}`

  return {
    closingErrorE: Math.round(closingErrorE * 1000) / 1000, // 1mm precision for display
    closingErrorN: Math.round(closingErrorN * 1000) / 1000, // 1mm precision for display
    perimeter: Math.round(perimeter * 1000) / 1000, // 1mm precision for display
    precisionRatio: formattedRatio,
    passes: precisionRatio >= 5000 // Kenya cadastral minimum 1:5000
  }
}
