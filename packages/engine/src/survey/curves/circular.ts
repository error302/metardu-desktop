/**
 * Circular Curve Calculations
 * 
 * Horizontal circular curve computations for road and railway design.
 * Handles simple curves, compound curves, and reverse curves.
 * 
 * References:
 * - Schofield, W. (2001) "Engineering Surveying"
 * - Meyer, C.F. (1969) "Route Surveying and Design"
 */

// ─── Types ───────────────────────────────────────────────────────

export interface CircularCurveParams {
  /** Intersection angle (decimal degrees) — total deflection */
  intersectionAngle: number;
  /** Radius of the curve (meters) */
  radius: number;
}

export interface CircularCurveResult {
  /** Intersection angle (decimal degrees) */
  intersectionAngle: number;
  /** Radius (meters) */
  radius: number;
  /** Tangent length (meters) — PI to PC or PI to PT */
  tangentLength: number;
  /** Curve length (meters) — arc from PC to PT */
  curveLength: number;
  /** Length of long chord (meters) — straight line PC to PT */
  longChordLength: number;
  /** Mid-ordinate (meters) — distance from midpoint of long chord to curve */
  midOrdinate: number;
  /** External distance (meters) — distance from PI to curve midpoint */
  externalDistance: number;
  /** Degree of curvature (decimal degrees) — based on arc definition */
  degreeOfCurvature: number;
  /** Deflection angle to any point on curve (for setting out) */
  deflectionPerMeter: number; // degrees per meter of arc
}

export interface CurveStationResult {
  /** Chainage/station (meters) */
  chainage: number;
  /** Deflection angle from PC (decimal degrees) */
  deflectionAngle: number;
  /** Chord length from PC (meters) */
  chordLength: number;
  /** Easting coordinate */
  easting?: number;
  /** Northing coordinate */
  northing?: number;
}

// ─── Core Functions ──────────────────────────────────────────────

/**
 * Compute circular curve parameters from intersection angle and radius.
 * 
 * Standard formulas:
 *   T = R × tan(Δ/2)          — Tangent length
 *   L = R × Δ × (π/180)       — Curve length (arc)
 *   LC = 2R × sin(Δ/2)        — Long chord
 *   M = R × (1 - cos(Δ/2))    — Mid-ordinate
 *   E = R × (sec(Δ/2) - 1)    — External distance
 *   D = 5729.578 / R           — Degree of curvature (arc definition, 30m arc)
 */
export function computeCircularCurve(params: CircularCurveParams): CircularCurveResult {
  const { intersectionAngle, radius } = params;
  
  const deltaRad = intersectionAngle * Math.PI / 180;
  const halfDelta = deltaRad / 2;
  
  const tangentLength = radius * Math.tan(halfDelta);
  const curveLength = radius * deltaRad;
  const longChordLength = 2 * radius * Math.sin(halfDelta);
  const midOrdinate = radius * (1 - Math.cos(halfDelta));
  const externalDistance = radius * (1 / Math.cos(halfDelta) - 1);
  const degreeOfCurvature = 5729.578 / radius; // Arc definition (30m arc)
  const deflectionPerMeter = (intersectionAngle / 2) / curveLength; // degrees per meter
  
  return {
    intersectionAngle,
    radius,
    tangentLength: Math.round(tangentLength * 1000) / 1000,
    curveLength: Math.round(curveLength * 1000) / 1000,
    longChordLength: Math.round(longChordLength * 1000) / 1000,
    midOrdinate: Math.round(midOrdinate * 1000) / 1000,
    externalDistance: Math.round(externalDistance * 1000) / 1000,
    degreeOfCurvature: Math.round(degreeOfCurvature * 10000) / 10000,
    deflectionPerMeter: Math.round(deflectionPerMeter * 1000000) / 1000000,
  };
}

/**
 * Compute setting-out data for a circular curve at regular intervals.
 * 
 * Generates deflection angles and chord lengths for each station
 * along the curve, suitable for field stakeout.
 * 
 * @param curve - Circular curve parameters (from computeCircularCurve)
 * @param interval - Station interval (meters), default 10m
 * @param pcChainage - Chainage of PC (Point of Curvature)
 * @param pcEasting - Easting of PI (Point of Intersection)
 * @param pcNorthing - Northing of PI
 * @param backBearing - Bearing from PI to PC (decimal degrees)
 */
export function computeCurveStations(
  curve: CircularCurveResult,
  interval: number = 10,
  pcChainage: number = 0,
  piEasting?: number,
  piNorthing?: number,
  backBearing?: number,
): CurveStationResult[] {
  const stations: CurveStationResult[] = [];
  
  // PC station
  const pcDeflection = 0;
  stations.push({
    chainage: pcChainage,
    deflectionAngle: 0,
    chordLength: 0,
  });
  
  // Intermediate stations
  const numStations = Math.floor(curve.curveLength / interval);
  
  for (let i = 1; i <= numStations; i++) {
    const arcLength = i * interval;
    const deflectionAngle = arcLength * curve.deflectionPerMeter;
    const chordLength = 2 * curve.radius * Math.sin(deflectionAngle * Math.PI / 180);
    
    stations.push({
      chainage: pcChainage + arcLength,
      deflectionAngle: Math.round(deflectionAngle * 1000) / 1000,
      chordLength: Math.round(chordLength * 1000) / 1000,
    });
  }
  
  // PT station (exact)
  const ptArcLength = curve.curveLength;
  const ptDeflection = curve.intersectionAngle / 2;
  const ptChord = curve.longChordLength;
  
  // Only add if not already at an interval station
  const lastStation = stations[stations.length - 1];
  if (Math.abs(lastStation.chainage - (pcChainage + ptArcLength)) > 0.01) {
    stations.push({
      chainage: Math.round((pcChainage + ptArcLength) * 1000) / 1000,
      deflectionAngle: Math.round(ptDeflection * 1000) / 1000,
      chordLength: ptChord,
    });
  }
  
  // Compute coordinates if PI and bearing provided
  if (piEasting !== undefined && piNorthing !== undefined && backBearing !== undefined) {
    computeCurveCoordinates(stations, curve, piEasting, piNorthing, backBearing);
  }
  
  return stations;
}

/**
 * Compute coordinates for curve stations.
 */
function computeCurveCoordinates(
  stations: CurveStationResult[],
  curve: CircularCurveResult,
  piEasting: number,
  piNorthing: number,
  backBearing: number,
): void {
  // PC coordinates
  const pcBearing = backBearing; // Bearing from PI to PC
  const pcE = piEasting - curve.tangentLength * Math.sin(pcBearing * Math.PI / 180);
  const pcN = piNorthing - curve.tangentLength * Math.cos(pcBearing * Math.PI / 180);
  
  stations[0].easting = pcE;
  stations[0].northing = pcN;
  
  // Subsequent stations — compute from PC using deflection angles
  // AUDIT FIX (M6, 2026-07-02): original code was a no-op —
  // `if (tangentBearing >= 360) tangentBearing - 360;` computed the
  // subtraction but discarded the result. Replaced with modulo to wrap
  // to [0, 360). Also changed const → let.
  let tangentBearing = (backBearing + 180) % 360;
  if (tangentBearing < 0) tangentBearing += 360;
  
  for (let i = 1; i < stations.length; i++) {
    const deflRad = stations[i].deflectionAngle * Math.PI / 180;
    const tangentBearingRad = (tangentBearing) * Math.PI / 180;
    
    // Bearing to point on curve
    const bearingToStation = tangentBearingRad + deflRad;
    const chord = stations[i].chordLength;
    
    stations[i].easting = pcE + chord * Math.sin(bearingToStation);
    stations[i].northing = pcN + chord * Math.cos(bearingToStation);
  }
}

/**
 * Compute circular curve from tangent length and intersection angle.
 * Useful when radius is not directly specified.
 */
export function computeCurveFromTangent(
  tangentLength: number,
  intersectionAngle: number
): CircularCurveResult {
  const halfDelta = intersectionAngle * Math.PI / 360;
  const radius = tangentLength / Math.tan(halfDelta);
  
  return computeCircularCurve({ intersectionAngle, radius });
}

/**
 * Compute circular curve from degree of curvature.
 * Degree of curvature (arc definition): D = 5729.578 / R
 */
export function computeCurveFromDegree(
  degreeOfCurvature: number,
  intersectionAngle: number
): CircularCurveResult {
  const radius = 5729.578 / degreeOfCurvature;
  
  return computeCircularCurve({ intersectionAngle, radius });
}
