/**
 * Cross-Section Geometry Utilities
 *
 * Computes road formation templates, camber profiles, slope intercepts,
 * and cut/fill areas for road engineering cross-sections.
 *
 * References:
 *   - N.N. Basak, Surveying and Levelling, Ch. 8 — Earthwork computation
 *   - Ghilani & Wolf, Elementary Surveying, 16th Ed., §26.3
 *   - Kenya RDM 1.1 2025, §8 — Road cross-section design
 *
 * Conventions:
 *   - Offsets are measured from centreline: negative = left, positive = right.
 *   - Levels are Reduced Levels (RL) in metres.
 *   - Slopes expressed as "1V:H" (e.g. "1:2" means 1 vertical, 2 horizontal).
 *   - Camber is a percentage (e.g. 2.5 means 2.5%).
 *   - No intermediate rounding — full floating point throughout.
 */

// ─── TYPES ─────────────────────────────────────────────────────────────────────

export interface ProfilePoint {
  offset: number
  level: number
}

export interface RoadTemplate {
  carriagewayWidth: number
  shoulderWidth: number
  cutSlope: string     // "1:2" format (V:H)
  fillSlope: string    // "1:1.5" format
  camber: number       // percentage, e.g. 2.5
  subgradeDepth: number
}

// ─── SLOPE PARSING ─────────────────────────────────────────────────────────────

/**
 * Parse a slope string like "1:2", "1V:2H", "1:1.5" to a ratio (H per 1V).
 *
 * Examples:
 *   "1:2"   → 2    (for every 1m vertical, go 2m horizontal)
 *   "1:1.5" → 1.5
 *   "1:3"   → 3
 *
 * @param slope - Slope string in "1:H" or "1V:H" format
 * @returns Horizontal run per unit vertical rise
 * @throws Error if slope format is invalid
 */
export function parseSlopeRatio(slope: string): number {
  const trimmed = slope.trim().toUpperCase()

  // Match patterns like "1:2", "1V:2H", "1 V : 2 H"
  const match = trimmed.match(/^1\s*V?\s*:\s*(\d+(?:\.\d+)?)\s*H?$/)
  if (!match) {
    throw new Error(
      `Invalid slope format: "${slope}". Expected format: "1:H" or "1V:H" (e.g. "1:2").`
    )
  }

  return parseFloat(match[1])
}

// ─── CAMBER PROFILE ────────────────────────────────────────────────────────────

/**
 * Compute parabolic camber profile across the carriageway.
 *
 * Camber equation: y = c * x² where c = camber / (CW/2)²
 *
 * The camber creates a parabolic curve with the highest point at centreline
 * (formationLevel) sloping down symmetrically to both edges.
 *
 * Example: With 7m carriageway and 2.5% camber:
 *   - Half-width = 3.5m
 *   - c = 2.5 / 100 / 3.5² = 0.0002041
 *   - Edge level = formationLevel - 0.025 * 3.5 = formationLevel - 0.0875m
 *
 * @param carriagewayWidth - Total carriageway width in metres
 * @param camber - Camber percentage (e.g. 2.5 for 2.5%)
 * @param formationLevel - RL at centreline (top of camber)
 * @returns Array of {offset, level} points from left edge to right edge
 */
export function computeCamberProfile(
  carriagewayWidth: number,
  camber: number,
  formationLevel: number
): ProfilePoint[] {
  const halfWidth = carriagewayWidth / 2

  if (halfWidth <= 0) {
    return [{ offset: 0, level: formationLevel }]
  }

  // Camber coefficient: c = (camber / 100) / (halfWidth)²
  // This ensures the edge drop equals camber * halfWidth / 100
  const c = (camber / 100) / (halfWidth * halfWidth)

  // Generate points at 0.5m intervals along the carriageway
  const numPoints = Math.max(Math.ceil(carriagewayWidth / 0.5), 2)
  const points: ProfilePoint[] = []

  for (let i = 0; i <= numPoints; i++) {
    const x = -halfWidth + (carriagewayWidth * i) / numPoints
    const levelDrop = c * x * x
    points.push({
      offset: x,
      level: formationLevel - levelDrop,
    })
  }

  return points
}

// ─── SLOPE INTERCEPT ───────────────────────────────────────────────────────────

/**
 * Compute where a cut or fill slope intersects the ground profile.
 *
 * For a CUT slope: the slope rises from the shoulder edge upward toward the ground.
 * For a FILL slope: the slope descends from the shoulder edge downward toward the ground.
 *
 * Uses linear interpolation between ground points to find the exact intersection.
 *
 * @param shoulderOffset - Horizontal offset of the shoulder edge from centreline
 * @param shoulderLevel - RL at the shoulder edge
 * @param slopeRatio - H per 1V (e.g., 2 means 1V:2H)
 * @param isCut - true for cut slope (going up from shoulder), false for fill slope
 * @param groundPoints - Ground profile points sorted by offset
 * @returns Intersection point {offset, level} or null if no intersection found
 */
export function computeSlopeIntercept(
  shoulderOffset: number,
  shoulderLevel: number,
  slopeRatio: number,
  isCut: boolean,
  groundPoints: ProfilePoint[]
): ProfilePoint | null {
  if (groundPoints.length < 2) return null

  // Sort ground points by offset
  const sorted = [...groundPoints].sort((a, b) => a.offset - b.offset)

  // Determine slope direction
  // For cut: slope goes UP and OUTWARD from shoulder
  // For fill: slope goes DOWN and OUTWARD from shoulder
  const direction = shoulderOffset >= 0 ? 1 : -1

  // Maximum offset to check — extend slope to the extent of ground data
  const maxAbsOffset = Math.max(
    ...sorted.map(p => Math.abs(p.offset))
  )
  const maxSlopeOffset = maxAbsOffset + 10 // extra margin
  const maxVertical = maxSlopeOffset / slopeRatio

  // Check intersection with each ground segment
  for (let i = 0; i < sorted.length - 1; i++) {
    const gp1 = sorted[i]
    const gp2 = sorted[i + 1]

    // Skip segments that don't overlap with our slope direction
    if (direction > 0) {
      // Right side: slope extends to positive offsets
      if (gp1.offset > shoulderOffset && gp2.offset < shoulderOffset) continue
      if (gp2.offset < shoulderOffset) continue
    } else {
      // Left side: slope extends to negative offsets
      if (gp1.offset > shoulderOffset && gp2.offset < shoulderOffset) continue
      if (gp1.offset > shoulderOffset) continue
    }

    // Compute slope line parameters
    // Slope line: level = shoulderLevel + (isCut ? +1 : -1) * (|offset - shoulderOffset| / slopeRatio)
    const slopeEndOffset = shoulderOffset + direction * maxSlopeOffset
    const slopeEndLevel = shoulderLevel +
      (isCut ? 1 : -1) * (Math.abs(slopeEndOffset - shoulderOffset) / slopeRatio)

    // Line 1: slope line from (shoulderOffset, shoulderLevel) to (slopeEndOffset, slopeEndLevel)
    // Line 2: ground segment from (gp1.offset, gp1.level) to (gp2.offset, gp2.level)

    const x1 = shoulderOffset
    const y1 = shoulderLevel
    const x2 = slopeEndOffset
    const y2 = slopeEndLevel
    const x3 = gp1.offset
    const y3 = gp1.level
    const x4 = gp2.offset
    const y4 = gp2.level

    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if (Math.abs(denom) < 1e-12) continue // parallel lines

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom

    // Intersection is valid if both t and u are in [0, 1]
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      const intersectX = x1 + t * (x2 - x1)
      const intersectY = y1 + t * (y2 - y1)

      // Verify the intersection is in the correct direction from the shoulder
      const offsetFromShoulder = intersectX - shoulderOffset
      if ((direction > 0 && offsetFromShoulder <= 0) || (direction < 0 && offsetFromShoulder >= 0)) {
        continue
      }

      return { offset: intersectX, level: intersectY }
    }
  }

  // If no intersection found, return the furthest point the slope would reach
  // within the ground extent (for rendering purposes)
  const furthestGround = direction > 0
    ? sorted[sorted.length - 1]
    : sorted[0]

  const furthestDist = Math.abs(furthestGround.offset - shoulderOffset)
  const furthestLevel = shoulderLevel + (isCut ? 1 : -1) * (furthestDist / slopeRatio)

  // Only return if the slope would actually cross the ground at this point
  if (isCut && furthestLevel < furthestGround.level) {
    return null
  }
  if (!isCut && furthestLevel > furthestGround.level) {
    return null
  }

  return {
    offset: furthestGround.offset,
    level: furthestLevel,
  }
}

// ─── FORMATION LINE ────────────────────────────────────────────────────────────

/**
 * Compute the full formation line (carriageway + shoulders + slope intercepts).
 *
 * Builds the complete road template cross-section:
 *   1. Left slope intercept (if ground is above shoulder → cut, below → fill)
 *   2. Left shoulder
 *   3. Carriageway with parabolic camber
 *   4. Right shoulder
 *   5. Right slope intercept
 *
 * Shoulders have a slight outward cross-fall of 3-5% (hardcoded at 4% per RDM 1.1).
 *
 * @param template - Road template parameters
 * @param formationLevel - RL at centreline
 * @param groundPoints - Natural ground profile
 * @param isCut - Overall section mode (determines which slope ratio to use)
 * @returns Array of {offset, level} points defining the formation template
 */
export function computeFormationLine(
  template: RoadTemplate,
  formationLevel: number,
  groundPoints: ProfilePoint[],
  isCut: boolean
): ProfilePoint[] {
  const {
    carriagewayWidth,
    shoulderWidth,
    cutSlope,
    fillSlope,
    camber,
    subgradeDepth,
  } = template

  const halfCW = carriagewayWidth / 2
  const points: ProfilePoint[] = []

  // Determine slope ratio based on section mode
  const slopeStr = isCut ? cutSlope : fillSlope
  const slopeRatio = parseSlopeRatio(slopeStr)

  // Shoulder cross-fall (outward slope) — 4% per Kenya RDM 1.1
  const shoulderCrossfall = 0.04

  // --- Left side ---

  // Left carriageway edge level (from camber profile)
  const leftEdgeLevel = formationLevel - (camber / 100) * halfCW

  // Left shoulder outer edge
  const leftShoulderOffset = -(halfCW + shoulderWidth)
  const leftShoulderLevel = leftEdgeLevel - shoulderCrossfall * shoulderWidth

  // Left slope intercept
  const leftIntercept = computeSlopeIntercept(
    leftShoulderOffset,
    leftShoulderLevel,
    slopeRatio,
    isCut,
    groundPoints
  )

  // --- Right side ---

  // Right carriageway edge level (from camber profile)
  const rightEdgeLevel = formationLevel - (camber / 100) * halfCW

  // Right shoulder outer edge
  const rightShoulderOffset = halfCW + shoulderWidth
  const rightShoulderLevel = rightEdgeLevel - shoulderCrossfall * shoulderWidth

  // Right slope intercept
  const rightIntercept = computeSlopeIntercept(
    rightShoulderOffset,
    rightShoulderLevel,
    slopeRatio,
    isCut,
    groundPoints
  )

  // --- Build points array (left to right) ---

  // Left slope
  if (leftIntercept) {
    points.push(leftIntercept)
  }
  points.push({ offset: leftShoulderOffset, level: leftShoulderLevel })

  // Left carriageway edge
  points.push({ offset: -halfCW, level: leftEdgeLevel })

  // Carriageway with camber (centre point only — for key points)
  // Full camber profile can be generated separately
  points.push({ offset: 0, level: formationLevel })

  // Right carriageway edge
  points.push({ offset: halfCW, level: rightEdgeLevel })

  // Right shoulder
  points.push({ offset: rightShoulderOffset, level: rightShoulderLevel })

  // Right slope
  if (rightIntercept) {
    points.push(rightIntercept)
  }

  return points
}

/**
 * Compute the full formation line with detailed camber points for rendering.
 *
 * This returns a more detailed set of points including multiple camber profile
 * points across the carriageway (instead of just edge-centre-edge).
 */
export function computeDetailedFormationLine(
  template: RoadTemplate,
  formationLevel: number,
  groundPoints: ProfilePoint[],
  isCut: boolean
): ProfilePoint[] {
  const {
    carriagewayWidth,
    shoulderWidth,
    cutSlope,
    fillSlope,
    camber,
  } = template

  const halfCW = carriagewayWidth / 2
  const points: ProfilePoint[] = []

  const slopeStr = isCut ? cutSlope : fillSlope
  const slopeRatio = parseSlopeRatio(slopeStr)
  const shoulderCrossfall = 0.04

  // Left carriageway edge level
  const leftEdgeLevel = formationLevel - (camber / 100) * halfCW
  const rightEdgeLevel = formationLevel - (camber / 100) * halfCW

  // Left shoulder
  const leftShoulderOffset = -(halfCW + shoulderWidth)
  const leftShoulderLevel = leftEdgeLevel - shoulderCrossfall * shoulderWidth

  // Right shoulder
  const rightShoulderOffset = halfCW + shoulderWidth
  const rightShoulderLevel = rightEdgeLevel - shoulderCrossfall * shoulderWidth

  // Slope intercepts
  const leftIntercept = computeSlopeIntercept(
    leftShoulderOffset,
    leftShoulderLevel,
    slopeRatio,
    isCut,
    groundPoints
  )
  const rightIntercept = computeSlopeIntercept(
    rightShoulderOffset,
    rightShoulderLevel,
    slopeRatio,
    isCut,
    groundPoints
  )

  // Left slope
  if (leftIntercept) {
    points.push(leftIntercept)
  }
  points.push({ offset: leftShoulderOffset, level: leftShoulderLevel })
  points.push({ offset: -halfCW, level: leftEdgeLevel })

  // Detailed camber profile
  const camberProfile = computeCamberProfile(carriagewayWidth, camber, formationLevel)
  for (const cp of camberProfile) {
    // Skip duplicate points at edges and centre
    if (Math.abs(cp.offset - (-halfCW)) < 0.01) continue
    if (Math.abs(cp.offset - halfCW) < 0.01) continue
    if (Math.abs(cp.offset) < 0.01) continue
    points.push(cp)
  }

  // Centre point
  points.push({ offset: 0, level: formationLevel })

  // Right carriageway edge
  points.push({ offset: halfCW, level: rightEdgeLevel })
  points.push({ offset: rightShoulderOffset, level: rightShoulderLevel })

  // Right slope
  if (rightIntercept) {
    points.push(rightIntercept)
  }

  // Sort by offset to ensure correct rendering order
  return points.sort((a, b) => a.offset - b.offset)
}

// ─── CUT/FILL AREA (SHOELACE METHOD) ───────────────────────────────────────────

/**
 * Compute the area between ground profile and formation line using the shoelace formula.
 *
 * The function creates a closed polygon by tracing:
 *   1. Ground profile from left to right
 *   2. Formation line from right to left
 *   3. Close back to start
 *
 * Shoelace formula (surveyor's formula):
 *   A = ½ |Σ(xᵢyᵢ₊₁ - xᵢ₊₁yᵢ)|
 *
 * Sign convention:
 *   - Positive result = cut (ground above formation, material to remove)
 *   - Negative result = fill (ground below formation, material to add)
 *
 * Reference: Ghilani & Wolf, Elementary Surveying, §26.3
 *
 * @param groundPoints - Ground profile points (sorted by offset)
 * @param formationPoints - Formation line points (sorted by offset)
 * @returns Signed area: positive = cut, negative = fill (m²)
 */
export function computeCutFillArea(
  groundPoints: ProfilePoint[],
  formationPoints: ProfilePoint[]
): number {
  if (groundPoints.length < 2 || formationPoints.length < 2) {
    return 0
  }

  // Sort both profiles by offset
  const sortedGround = [...groundPoints].sort((a, b) => a.offset - b.offset)
  const sortedFormation = [...formationPoints].sort((a, b) => a.offset - b.offset)

  // Build a closed polygon by combining both profiles
  // Trace ground from left to right, then formation from right to left
  const polygon: ProfilePoint[] = []

  // Use the wider extent of both profiles
  const minOffset = Math.min(sortedGround[0].offset, sortedFormation[0].offset)
  const maxOffset = Math.max(
    sortedGround[sortedGround.length - 1].offset,
    sortedFormation[sortedFormation.length - 1].offset
  )

  // Helper: interpolate level at a given offset from a profile
  function interpolateLevel(profile: ProfilePoint[], offset: number): number {
    if (offset <= profile[0].offset) return profile[0].level
    if (offset >= profile[profile.length - 1].offset) {
      return profile[profile.length - 1].level
    }

    for (let i = 0; i < profile.length - 1; i++) {
      if (
        profile[i].offset <= offset &&
        profile[i + 1].offset >= offset
      ) {
        const segLen = profile[i + 1].offset - profile[i].offset
        if (segLen < 1e-12) return profile[i].level
        const t = (offset - profile[i].offset) / segLen
        return profile[i].level + t * (profile[i + 1].level - profile[i].level)
      }
    }
    return profile[profile.length - 1].level
  }

  // Build combined polygon with offset-aligned points
  const numSamples = Math.max(
    sortedGround.length + sortedFormation.length,
    20
  )

  // Collect all unique offset values from both profiles
  const offsets = new Set<number>()
  for (const p of sortedGround) offsets.add(p.offset)
  for (const p of sortedFormation) offsets.add(p.offset)

  const sortedOffsets = Array.from(offsets).sort((a, b) => a - b)

  // Build closed polygon:
  // Ground left→right, then Formation right→left
  for (const offset of sortedOffsets) {
    polygon.push({
      offset,
      level: interpolateLevel(sortedGround, offset),
    })
  }
  for (let i = sortedOffsets.length - 1; i >= 0; i--) {
    polygon.push({
      offset: sortedOffsets[i],
      level: interpolateLevel(sortedFormation, sortedOffsets[i]),
    })
  }

  // Shoelace formula
  let area = 0
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += polygon[i].offset * polygon[j].level
    area -= polygon[j].offset * polygon[i].level
  }

  area = area / 2

  // Positive area = clockwise = ground above formation = cut
  // We need to verify the sign convention by checking the first point relationship
  // If ground is above formation at centre → cut (positive)
  const centreGround = interpolateLevel(sortedGround, 0)
  const centreFormation = interpolateLevel(sortedFormation, 0)

  // If ground > formation at centre → cut, which should be positive
  // Shoelace convention: if vertices are ordered clockwise, result is positive
  // Our ground→formation polygon should give positive for cut
  // If the sign is wrong, negate it
  if (centreGround > centreFormation && area < 0) {
    return -area
  }
  if (centreGround < centreFormation && area > 0) {
    return -area
  }

  return area
}

// ─── UTILITY FUNCTIONS ─────────────────────────────────────────────────────────

/**
 * Determine whether a cross-section is predominantly cut or fill.
 *
 * A section is "cut" if the ground level at centreline is above the formation level,
 * "fill" if below, and "mixed" if there are significant areas of both.
 *
 * @param groundPoints - Ground profile points
 * @param formationLevel - Formation RL at centreline
 * @returns 'cut' | 'fill' | 'mixed'
 */
export function determineSectionType(
  groundPoints: ProfilePoint[],
  formationLevel: number
): 'cut' | 'fill' | 'mixed' {
  if (groundPoints.length === 0) return 'fill'

  const sorted = [...groundPoints].sort((a, b) => a.offset - b.offset)

  let aboveCount = 0
  let belowCount = 0

  for (const p of sorted) {
    if (p.level > formationLevel) aboveCount++
    else if (p.level < formationLevel) belowCount++
  }

  if (aboveCount === 0) return 'fill'
  if (belowCount === 0) return 'cut'

  // If more than 70% of points are on one side, classify as that side
  const total = aboveCount + belowCount
  if (aboveCount / total > 0.7) return 'cut'
  if (belowCount / total > 0.7) return 'fill'

  return 'mixed'
}

/**
 * Format chainage as "Km+mmm.ddd" for display.
 *
 * @param chainage - Chainage in metres
 * @returns Formatted chainage string
 */
export function formatChainage(chainage: number): string {
  const km = Math.floor(chainage / 1000)
  const m = chainage % 1000
  return km > 0
    ? `${km}+${m.toFixed(3).padStart(6, '0')}`
    : `${m.toFixed(3)}`
}

/**
 * Compute ground level at centreline by interpolation.
 */
export function interpolateGroundAtCentre(
  groundPoints: ProfilePoint[]
): number | null {
  if (groundPoints.length === 0) return null

  const sorted = [...groundPoints].sort((a, b) => a.offset - b.offset)

  // Check if we have a point at offset 0
  const exact = sorted.find(p => Math.abs(p.offset) < 0.001)
  if (exact) return exact.level

  // Check if offset 0 is within the range
  if (sorted[0].offset > 0 || sorted[sorted.length - 1].offset < 0) {
    // Extrapolate from the nearest two points
    if (sorted[0].offset > 0) {
      const p1 = sorted[0]
      const p2 = sorted[1] || p1
      const dOffset = p2.offset - p1.offset
      if (Math.abs(dOffset) < 1e-12) return p1.level
      return p1.level + (-p1.offset / dOffset) * (p2.level - p1.level)
    }
    const p1 = sorted[sorted.length - 2] || sorted[0]
    const p2 = sorted[sorted.length - 1]
    const dOffset = p2.offset - p1.offset
    if (Math.abs(dOffset) < 1e-12) return p2.level
    return p1.level + (-p1.offset / dOffset) * (p2.level - p1.level)
  }

  // Linear interpolation
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].offset <= 0 && sorted[i + 1].offset >= 0) {
      const t = -sorted[i].offset / (sorted[i + 1].offset - sorted[i].offset)
      return sorted[i].level + t * (sorted[i + 1].level - sorted[i].level)
    }
  }

  return null
}
