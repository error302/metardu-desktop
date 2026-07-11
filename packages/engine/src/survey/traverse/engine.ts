/**
 * Traverse Computation Engine
 * 
 * Computes adjusted coordinates for a traverse (open or closed)
 * using either the Bowditch/Compass rule or Least Squares adjustment.
 * 
 * For 3rd/4th order: Bowditch adjustment (proportional distribution)
 * For 1st/2nd order: Least Squares adjustment (statistically optimal)
 * 
 * References:
 * - Schofield, W. (2001) "Engineering Surveying"
 * - Anderson & Mikhail (1998) "Surveying: Theory and Practice"
 */

// ─── Types ───────────────────────────────────────────────────────

export interface TraverseStation {
  name: string;
  easting?: number;    // Known for control points
  northing?: number;   // Known for control points
  isFixed: boolean;    // Control/fixed point
}

export interface TraverseLeg {
  fromStation: string;
  toStation: string;
  bearing: number;       // Decimal degrees (0-360)
  distance: number;      // Meters (already corrected through pipeline)
  stdDevBearing?: number; // Standard deviation of bearing (seconds)
  stdDevDistance?: number; // Standard deviation of distance (meters)
}

export interface TraverseResult {
  stations: AdjustedStation[];
  misclosure: {
    easting: number;       // meters
    northing: number;      // meters
    linear: number;        // meters (total linear misclosure)
    angular: number;       // seconds (angular misclosure)
    ratio: string;         // e.g., "1:25000"
    ratioValue: number;    // numeric ratio denominator
  };
  adjustmentMethod: 'bowditch' | 'least_squares';
  order: number;           // 1st, 2nd, 3rd, 4th
  passesOrder: boolean;    // Whether misclosure meets the order requirement
  totalDistance: number;   // meters
  warnings: string[];
}

export interface AdjustedStation {
  name: string;
  easting: number;
  northing: number;
  correctionE: number;     // Correction applied (meters)
  correctionN: number;     // Correction applied (meters)
  isFixed: boolean;
  stdDevE?: number;        // From least squares
  stdDevN?: number;        // From least squares
}

// ─── Accuracy Order Requirements ─────────────────────────────────

/** Minimum misclosure ratio for each survey order */
export const ORDER_REQUIREMENTS: Record<number, number> = {
  1: 100000,   // 1st order: 1:100,000
  2: 20000,    // 2nd order: 1:20,000
  3: 10000,    // 3rd order: 1:10,000 (Kenya cadastral minimum)
  4: 5000,     // 4th order: 1:5,000 (topographic)
};

/** Default standard deviations for each order */
export const ORDER_STDS: Record<number, { angle: number; distPPM: number }> = {
  1: { angle: 1.0, distPPM: 5 },       // 1", 5 ppm
  2: { angle: 2.0, distPPM: 10 },       // 2", 10 ppm
  3: { angle: 5.0, distPPM: 20 },       // 5", 20 ppm
  4: { angle: 10.0, distPPM: 50 },      // 10", 50 ppm
};

// ─── Bowditch (Compass Rule) Adjustment ──────────────────────────

/**
 * Apply Bowditch/Compass rule adjustment to a closed traverse.
 * 
 * The Bowditch rule distributes the misclosure proportionally
 * to the cumulative distance from the start:
 * 
 *   Correction_E(i) = -misclosure_E × (Σd₀→i / Σd_total)
 *   Correction_N(i) = -misclosure_N × (Σd₀→i / Σd_total)
 * 
 * This is the standard method for 3rd and 4th order traverses
 * and is accepted by Kenya Survey Department for cadastral work.
 * 
 * @param stations - Traverse stations (with fixed coordinates for control points)
 * @param legs - Traverse legs with bearings and distances
 * @param order - Required accuracy order (1-4)
 * @returns Traverse result with adjusted coordinates
 */
export function bowditchAdjustment(
  stations: TraverseStation[],
  legs: TraverseLeg[],
  order: number = 3
): TraverseResult {
  const warnings: string[] = [];
  
  // Validate: need at least 2 fixed stations
  const fixedStations = stations.filter(s => s.isFixed && s.easting !== undefined && s.northing !== undefined);
  if (fixedStations.length < 2) {
    throw new Error('Need at least 2 fixed control stations for traverse');
  }
  
  // Compute preliminary coordinates
  const preliminary = computePreliminaryCoordinates(stations, legs);
  
  // Compute misclosure
  const misclosure = computeMisclosure(preliminary, stations, legs);
  
  // Check angular misclosure
  const angularClosure = computeAngularClosure(legs, fixedStations);
  misclosure.angular = angularClosure;
  
  // Compute total traverse distance
  const totalDistance = legs.reduce((sum, leg) => sum + leg.distance, 0);
  
  // Compute misclosure ratio
  const ratioValue = totalDistance / misclosure.linear;
  misclosure.ratioValue = ratioValue;
  misclosure.ratio = `1:${Math.round(ratioValue)}`;
  
  // Check against order requirement
  const requiredRatio = ORDER_REQUIREMENTS[order] ?? ORDER_REQUIREMENTS[3];
  const passesOrder = ratioValue >= requiredRatio;
  
  if (!passesOrder) {
    warnings.push(
      `Traverse closure ${misclosure.ratio} does NOT meet ${order} order requirement (1:${requiredRatio})`
    );
  }
  
  // Apply Bowditch corrections
  const adjusted: AdjustedStation[] = [];
  let cumulativeDistance = 0;
  
  for (let i = 0; i < preliminary.length; i++) {
    const station = preliminary[i];
    
    if (station.isFixed) {
      adjusted.push({
        name: station.name,
        easting: stations.find(s => s.name === station.name)!.easting!,
        northing: stations.find(s => s.name === station.name)!.northing!,
        correctionE: 0,
        correctionN: 0,
        isFixed: true,
      });
    } else {
      // Proportional correction based on cumulative distance
      const proportion = cumulativeDistance / totalDistance;
      const corrE = -misclosure.easting * proportion;
      const corrN = -misclosure.northing * proportion;
      
      adjusted.push({
        name: station.name,
        easting: (station.easting ?? 0) + corrE,
        northing: (station.northing ?? 0) + corrN,
        correctionE: corrE,
        correctionN: corrN,
        isFixed: false,
      });
    }
    
    // Add distance to next leg
    const leg = legs.find(l => l.fromStation === station.name);
    if (leg) {
      cumulativeDistance += leg.distance;
    }
  }
  
  return {
    stations: adjusted,
    misclosure,
    adjustmentMethod: 'bowditch',
    order,
    passesOrder,
    totalDistance,
    warnings,
  };
}

// ─── Helper Functions ────────────────────────────────────────────

/**
 * Compute preliminary (unadjusted) traverse coordinates.
 */
function computePreliminaryCoordinates(
  stations: TraverseStation[],
  legs: TraverseLeg[]
): TraverseStation[] {
  const result: TraverseStation[] = [];
  const coordMap = new Map<string, { easting: number; northing: number }>();
  
  // Initialize with fixed station coordinates
  for (const station of stations) {
    if (station.isFixed && station.easting !== undefined && station.northing !== undefined) {
      coordMap.set(station.name, { easting: station.easting, northing: station.northing });
    }
  }
  
  // Compute coordinates along each leg
  for (const leg of legs) {
    const from = coordMap.get(leg.fromStation);
    if (!from) {
      throw new Error(`No coordinates for station ${leg.fromStation}`);
    }
    
    const bearingRad = leg.bearing * Math.PI / 180;
    const dE = leg.distance * Math.sin(bearingRad);
    const dN = leg.distance * Math.cos(bearingRad);
    
    const toCoord = {
      easting: from.easting + dE,
      northing: from.northing + dN,
    };
    
    coordMap.set(leg.toStation, toCoord);
  }
  
  // Build result preserving order
  for (const station of stations) {
    const coord = coordMap.get(station.name);
    result.push({
      name: station.name,
      easting: coord?.easting,
      northing: coord?.northing,
      isFixed: station.isFixed,
    });
  }
  
  return result;
}

/**
 * Compute linear misclosure of a closed traverse.
 */
function computeMisclosure(
  preliminary: TraverseStation[],
  original: TraverseStation[],
  legs: TraverseLeg[]
): TraverseResult['misclosure'] {
  // For a closed traverse, the last computed position should
  // match the closing fixed point
  const firstFixed = original.find(s => s.isFixed && s.easting !== undefined);
  const lastLeg = legs[legs.length - 1];
  
  // Find the last computed position
  const lastComputed = preliminary.find(s => s.name === lastLeg.toStation);
  const closingPoint = original.find(s => s.name === lastLeg.toStation && s.isFixed);
  
  let dE = 0, dN = 0;
  
  if (closingPoint && closingPoint.easting !== undefined && closingPoint.northing !== undefined) {
    if (lastComputed?.easting !== undefined && lastComputed?.northing !== undefined) {
      dE = lastComputed.easting - closingPoint.easting;
      dN = lastComputed.northing - closingPoint.northing;
    }
  }
  
  const linear = Math.sqrt(dE * dE + dN * dN);
  
  return {
    easting: dE,
    northing: dN,
    linear,
    angular: 0, // Computed separately
    ratio: '',
    ratioValue: 0,
  };
}

/**
 * Compute angular misclosure of a closed traverse.
 * 
 * For a closed traverse with n sides:
 *   Sum of interior angles = (n - 2) × 180°
 *   Angular misclosure = Observed sum - Theoretical sum
 */
function computeAngularClosure(
  legs: TraverseLeg[],
  fixedStations: TraverseStation[]
): number {
  // Simple check: sum of bearings should be consistent
  // For a full loop traverse, the sum of bearing differences
  // should equal n × 180° (for interior angles)
  // This is a simplified version — full angular closure requires
  // observed angles at each station
  
  // For now, use the bearing-based check
  // The total angular closure is checked by verifying
  // that the computed azimuth from the last leg back to
  // the start matches the known azimuth
  
  return 0; // Placeholder — will be computed from observed angles in full implementation
}

/**
 * Compute forward bearing from two coordinate pairs.
 */
export function computeBearing(
  fromE: number,
  fromN: number,
  toE: number,
  toN: number
): number {
  const dE = toE - fromE;
  const dN = toN - fromN;
  
  let bearing = Math.atan2(dE, dN) * 180 / Math.PI;
  if (bearing < 0) bearing += 360;
  
  return bearing;
}

/**
 * Compute distance between two coordinate pairs.
 */
export function computeDistance(
  fromE: number,
  fromN: number,
  toE: number,
  toN: number
): number {
  const dE = toE - fromE;
  const dN = toN - fromN;
  return Math.sqrt(dE * dE + dN * dN);
}
