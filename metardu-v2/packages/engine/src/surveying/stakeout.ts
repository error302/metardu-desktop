/**
 * Real-time Stakeout Module for MetaRDU Desktop v2.0.
 *
 * Provides real-time guidance for staking out design points in the field.
 * Shows the surveyor:
 *   - Distance to the design point (how far to walk)
 *   - Direction (left/right, forward/back)
 *   - Cut/Fill (elevation difference — are you too high or too low?)
 *   - Convergence status (how close is "close enough"?)
 *
 * This is the most-used feature in professional surveying software.
 * Surveyors spend 60% of their field day in stakeout mode.
 *
 * Usage:
 *   const stakeout = createStakeoutSession(designPoints, { tolerance: 0.020 });
 *   const guidance = stakeout.update(currentLat, currentLng, currentElevation);
 *   // guidance.distance = 2.34 (meters to go)
 *   // guidance.direction = "→ Right 1.23, ↑ Forward 2.00"
 *   // guidance.cutFill = -0.15 (cut 15cm — you're too high)
 *   // guidance.status = "within_tolerance" | "close" | "far" | "wrong_point"
 *
 * References:
 *   - Ghilani & Wolf, "Elementary Surveying" Ch. 23 (Construction Surveys)
 *   - Schofield & Breach, "Engineering Surveying" Ch. 12 (Setting Out)
 *   - RDM 1.1 §7 (Staking tolerances for Kenya)
 */

// ─── Types ─────────────────────────────────────────────────────────

/** A design point to be staked out. */
export interface DesignPoint {
  /** Unique point ID */
  id: string;
  /** Point number/label (e.g., "STN-001", "CHAIN 0+250") */
  label: string;
  /** Easting (local grid) or longitude (WGS84) */
  easting: number;
  /** Northing (local grid) or latitude (WGS84) */
  northing: number;
  /** Design elevation (meters) — null for 2D points */
  elevation: number | null;
  /** Optional: point description/code */
  code?: string;
  /** Optional: point type */
  type?: "control" | "detail" | "boundary" | "centerline" | "offset" | "generic";
}

/** Current rover position. */
export interface RoverPosition {
  /** Easting or longitude */
  easting: number;
  /** Northing or latitude */
  northing: number;
  /** Current elevation (meters) */
  elevation: number;
  /** Optional: heading in degrees (0=north, clockwise) */
  heading?: number;
  /** Optional: horizontal accuracy (CEP, meters) */
  accuracy?: number;
}

/** Tolerance settings for stakeout. */
export interface StakeoutTolerance {
  /** Horizontal tolerance — point is "in" if within this distance (meters). Default 0.020 (2cm). */
  horizontal: number;
  /** Vertical tolerance — elevation must be within this (meters). Default 0.020 (2cm). */
  vertical: number;
  /** Alert distance — start showing "close" alert when within this (meters). Default 0.500. */
  alertDistance: number;
}

/** Default tolerance: 2cm horizontal and vertical (survey-grade). */
export const DEFAULT_TOLERANCE: StakeoutTolerance = {
  horizontal: 0.020,
  vertical: 0.020,
  alertDistance: 0.500,
};

/** RDM 1.1 Kenya tolerance presets. */
export const KENYA_TOLERANCE_PRESETS: Record<string, StakeoutTolerance> = {
  cadastral_urban: { horizontal: 0.010, vertical: 0.020, alertDistance: 0.200 },
  cadastral_rural: { horizontal: 0.050, vertical: 0.100, alertDistance: 0.500 },
  engineering_precise: { horizontal: 0.005, vertical: 0.005, alertDistance: 0.100 },
  engineering_standard: { horizontal: 0.020, vertical: 0.020, alertDistance: 0.500 },
  topographic: { horizontal: 0.100, vertical: 0.050, alertDistance: 1.000 },
};

/** Stakeout status. */
export type StakeoutStatus =
  | "within_tolerance"  // point is staked to required accuracy
  | "close"             // within alert distance — slow down
  | "far"               // still navigating to the point
  | "wrong_point"       // not near any design point
  | "no_design_points"; // no points loaded

/** Stakeout guidance for the current position. */
export interface StakeoutGuidance {
  /** Current target design point (null if no point is active) */
  target: DesignPoint | null;
  /** Distance to target (meters, horizontal) */
  distance: number;
  /** Bearing to target (degrees, 0=north, clockwise) */
  bearing: number;
  /** East-West offset (meters, positive = go east/right) */
  eastOffset: number;
  /** North-South offset (meters, positive = go north/forward) */
  northOffset: number;
  /** Left-right offset relative to rover heading (meters, positive = right) */
  rightOffset: number;
  /** Forward-back offset relative to rover heading (meters, positive = forward) */
  forwardOffset: number;
  /** Cut/Fill (meters, positive = fill needed, negative = cut needed) */
  cutFill: number | null;
  /** Status */
  status: StakeoutStatus;
  /** Human-readable direction string */
  directionText: string;
  /** Human-readable cut/fill string */
  cutFillText: string;
  /** Whether the point is staked (within tolerance) */
  isStaked: boolean;
  /** Timestamp */
  timestamp: number;
}

// ─── Stakeout session ──────────────────────────────────────────────

/**
 * Stakeout session manager.
 *
 * Manages a list of design points and provides real-time guidance
 * as the rover moves. Automatically selects the nearest design point
 * as the current target.
 */
export class StakeoutSession {
  private designPoints: DesignPoint[];
  private tolerance: StakeoutTolerance;
  private currentTargetId: string | null = null;
  private stakedPoints: Set<string> = new Set();
  // startTime is recorded for future session-duration / productivity metrics.
  // Exposed via getSessionElapsedMs() below so the field is actually read.
  private startTime: number;

  constructor(designPoints: DesignPoint[], tolerance: StakeoutTolerance = DEFAULT_TOLERANCE) {
    this.designPoints = [...designPoints];
    this.tolerance = tolerance;
    this.startTime = Date.now();
  }

  /** Milliseconds since this stakeout session started. */
  getSessionElapsedMs(): number {
    return Date.now() - this.startTime;
  }

  /** Add a design point. */
  addPoint(point: DesignPoint): void {
    this.designPoints.push(point);
  }

  /** Remove a design point. */
  removePoint(id: string): void {
    this.designPoints = this.designPoints.filter(p => p.id !== id);
    if (this.currentTargetId === id) {
      this.currentTargetId = null;
    }
    this.stakedPoints.delete(id);
  }

  /** Get all design points. */
  getPoints(): DesignPoint[] {
    return [...this.designPoints];
  }

  /** Get the next unstaked point (auto-advance). */
  getNextUnstakedPoint(): DesignPoint | null {
    const unstaked = this.designPoints.filter(p => !this.stakedPoints.has(p.id));
    return unstaked[0] ?? null;
  }

  /** Set the current target manually. */
  setTarget(id: string): void {
    this.currentTargetId = id;
  }

  /** Mark a point as staked. */
  markStaked(id: string): void {
    this.stakedPoints.add(id);
    // Auto-advance to next unstaked point
    const next = this.getNextUnstakedPoint();
    this.currentTargetId = next?.id ?? null;
  }

  /** Get all staked point IDs. */
  getStakedPointIds(): string[] {
    return Array.from(this.stakedPoints);
  }

  /** Get staking progress (0-1). */
  getProgress(): number {
    if (this.designPoints.length === 0) return 0;
    return this.stakedPoints.size / this.designPoints.length;
  }

  /**
   * Update the stakeout guidance based on the current rover position.
   *
   * If no target is set, automatically selects the nearest unstaked point.
   */
  update(rover: RoverPosition): StakeoutGuidance {
    const now = Date.now();

    if (this.designPoints.length === 0) {
      return {
        target: null, distance: 0, bearing: 0,
        eastOffset: 0, northOffset: 0, rightOffset: 0, forwardOffset: 0,
        cutFill: null, status: "no_design_points",
        directionText: "No design points loaded",
        cutFillText: "", isStaked: false, timestamp: now,
      };
    }

    // Select target: current target or nearest unstaked
    let target: DesignPoint | null = null;
    if (this.currentTargetId) {
      target = this.designPoints.find(p => p.id === this.currentTargetId) ?? null;
    }
    if (!target) {
      target = this.findNearestPoint(rover);
      if (target) {
        this.currentTargetId = target.id;
      }
    }

    if (!target) {
      return {
        target: null, distance: 0, bearing: 0,
        eastOffset: 0, northOffset: 0, rightOffset: 0, forwardOffset: 0,
        cutFill: null, status: "wrong_point",
        directionText: "No target", cutFillText: "",
        isStaked: false, timestamp: now,
      };
    }

    // Compute offsets
    const eastOffset = target.easting - rover.easting;
    const northOffset = target.northing - rover.northing;
    const distance = Math.sqrt(eastOffset * eastOffset + northOffset * northOffset);
    const bearing = Math.atan2(eastOffset, northOffset) * 180 / Math.PI;
    const bearingNormalized = (bearing + 360) % 360;

    // Compute left/right and forward/back relative to heading
    let rightOffset = eastOffset;
    let forwardOffset = northOffset;
    if (rover.heading !== undefined) {
      const headingRad = rover.heading * Math.PI / 180;
      // Rotate (east, north) by -heading to get (right, forward)
      const cosH = Math.cos(headingRad);
      const sinH = Math.sin(headingRad);
      rightOffset = eastOffset * cosH + northOffset * sinH;
      forwardOffset = -eastOffset * sinH + northOffset * cosH;
    }

    // Compute cut/fill
    let cutFill: number | null = null;
    if (target.elevation !== null) {
      cutFill = target.elevation - rover.elevation;
    }

    // Determine status
    let status: StakeoutStatus;
    let isStaked = false;

    const horizontalOk = distance <= this.tolerance.horizontal;
    const verticalOk = cutFill === null || Math.abs(cutFill) <= this.tolerance.vertical;

    if (horizontalOk && verticalOk) {
      status = "within_tolerance";
      isStaked = true;
    } else if (distance <= this.tolerance.alertDistance) {
      status = "close";
    } else {
      status = "far";
    }

    // Generate direction text
    const directionText = formatDirection(rightOffset, forwardOffset, distance, bearingNormalized);

    // Generate cut/fill text
    const cutFillText = cutFill !== null ? formatCutFill(cutFill) : "";

    return {
      target, distance, bearing: bearingNormalized,
      eastOffset, northOffset, rightOffset, forwardOffset,
      cutFill, status, directionText, cutFillText, isStaked, timestamp: now,
    };
  }

  /** Find the nearest unstaked design point to the rover. */
  private findNearestPoint(rover: RoverPosition): DesignPoint | null {
    let nearest: DesignPoint | null = null;
    let minDist = Infinity;

    for (const point of this.designPoints) {
      if (this.stakedPoints.has(point.id)) continue;

      const dx = point.easting - rover.easting;
      const dy = point.northing - rover.northing;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < minDist) {
        minDist = dist;
        nearest = point;
      }
    }

    return nearest;
  }
}

// ─── Formatting helpers ────────────────────────────────────────────

function formatDirection(right: number, forward: number, distance: number, _bearing: number): string {
  // _bearing is reserved for future directional-arrow rendering (e.g. "↗ 45°").
  // Currently the offset strings already convey direction; the bearing is
  // kept on the signature so callers don't need to change when we add it.
  void _bearing;
  if (distance < 0.001) return "ON POINT";

  const absRight = Math.abs(right);
  const absForward = Math.abs(forward);

  let rightStr = "";
  if (absRight > 0.001) {
    rightStr = right > 0 ? `→ Right ${absRight.toFixed(3)}m` : `← Left ${absRight.toFixed(3)}m`;
  }

  let fwdStr = "";
  if (absForward > 0.001) {
    fwdStr = forward > 0 ? `↑ Fwd ${absForward.toFixed(3)}m` : `↓ Back ${absForward.toFixed(3)}m`;
  }

  const parts = [rightStr, fwdStr].filter(s => s);
  return parts.length > 0 ? parts.join("  ") : `Distance: ${distance.toFixed(3)}m`;
}

function formatCutFill(cutFill: number): string {
  if (Math.abs(cutFill) < 0.001) return "ON GRADE";

  const absVal = Math.abs(cutFill).toFixed(3);
  if (cutFill > 0) {
    return `▲ FILL ${absVal}m`;  // Need to fill up
  } else {
    return `▼ CUT ${absVal}m`;   // Need to cut down
  }
}

// ─── Convenience: create session ───────────────────────────────────

export function createStakeoutSession(
  designPoints: DesignPoint[],
  tolerance?: Partial<StakeoutTolerance>,
): StakeoutSession {
  const fullTolerance: StakeoutTolerance = {
    ...DEFAULT_TOLERANCE,
    ...tolerance,
  };
  return new StakeoutSession(designPoints, fullTolerance);
}
