/**
 * Slope Reduction Module
 * 
 * Converts slope distances to horizontal distances.
 * This is the most basic distance correction — every survey
 * computation pipeline starts here.
 * 
 * Two methods:
 * 1. Using vertical angle (zenith distance)
 * 2. Using height difference between endpoints
 * 
 * Reference:
 * - Schofield, W. (2001) "Engineering Surveying" 5th edition
 */

// ─── Types ───────────────────────────────────────────────────────

export interface SlopeReductionByAngle {
  /** Slope distance in meters */
  slopeDistance: number;
  /** Vertical angle (zenith distance) in decimal degrees
   *  90° = horizontal, >90° = upward, <90° = downward */
  verticalAngle: number;
}

export interface SlopeReductionByHeight {
  /** Slope distance in meters */
  slopeDistance: number;
  /** Height difference between endpoints (meters)
   *  Positive = target higher than instrument */
  heightDifference: number;
}

export interface SlopeReductionResult {
  /** Slope distance (meters) */
  slopeDistance: number;
  /** Horizontal distance (meters) */
  horizontalDistance: number;
  /** Vertical component (meters) */
  verticalComponent: number;
  /** Reduction amount (meters) */
  reduction: number;
  /** Method used */
  method: 'vertical_angle' | 'height_difference';
}

// ─── Core Functions ──────────────────────────────────────────────

/**
 * Reduce slope distance to horizontal using vertical angle.
 * 
 * HD = SD × sin(VA)
 * VD = SD × cos(VA)
 * 
 * Where VA is the zenith distance (90° = horizontal).
 * 
 * @param input - Slope distance and vertical angle
 * @returns Reduction result
 */
export function reduceSlopeByAngle(input: SlopeReductionByAngle): SlopeReductionResult {
  const { slopeDistance, verticalAngle } = input;
  
  if (slopeDistance <= 0) {
    throw new Error(`Slope distance must be positive, got ${slopeDistance}`);
  }
  if (verticalAngle <= 0 || verticalAngle >= 180) {
    throw new Error(`Vertical angle must be 0-180°, got ${verticalAngle}`);
  }
  
  const vaRad = verticalAngle * Math.PI / 180;
  
  const horizontalDistance = slopeDistance * Math.sin(vaRad);
  const verticalComponent = slopeDistance * Math.cos(vaRad);
  const reduction = slopeDistance - horizontalDistance;
  
  return {
    slopeDistance,
    horizontalDistance,
    verticalComponent,
    reduction,
    method: 'vertical_angle',
  };
}

/**
 * Reduce slope distance to horizontal using height difference.
 * 
 * HD = √(SD² - ΔH²)
 * 
 * @param input - Slope distance and height difference
 * @returns Reduction result
 */
export function reduceSlopeByHeight(input: SlopeReductionByHeight): SlopeReductionResult {
  const { slopeDistance, heightDifference } = input;
  
  if (slopeDistance <= 0) {
    throw new Error(`Slope distance must be positive, got ${slopeDistance}`);
  }
  
  const hdSquared = slopeDistance * slopeDistance - heightDifference * heightDifference;
  
  if (hdSquared < 0) {
    throw new Error(
      `Height difference (${heightDifference}m) exceeds slope distance (${slopeDistance}m) — check values`
    );
  }
  
  const horizontalDistance = Math.sqrt(hdSquared);
  const reduction = slopeDistance - horizontalDistance;
  
  return {
    slopeDistance,
    horizontalDistance,
    verticalComponent: heightDifference,
    reduction,
    method: 'height_difference',
  };
}

/**
 * Quick slope reduction — returns just the horizontal distance.
 * Uses vertical angle method.
 */
export function quickSlopeReduction(
  slopeDistance: number,
  verticalAngle: number
): number {
  return reduceSlopeByAngle({ slopeDistance, verticalAngle }).horizontalDistance;
}
