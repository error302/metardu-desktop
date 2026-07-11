/**
 * Least Squares Adjustment Module
 * 
 * Implements variation of coordinates (parametric) method for
 * traverse and network adjustment. This provides statistically
 * optimal coordinates with full uncertainty information.
 * 
 * Used for 1st and 2nd order surveys where Bowditch is insufficient.
 * 
 * Method:
 * 1. Form observation equations: v = A×δx - b
 * 2. Weight matrix P from a priori standard deviations
 * 3. Normal equations: N×δx = Aᵀ×P×b, where N = Aᵀ×P×A
 * 4. Solution: δx = N⁻¹ × Aᵀ × P × b
 * 5. A posteriori variance factor: σ̂₀² = vᵀPv / (n - u)
 * 6. Covariance matrix: C_xx = σ̂₀² × N⁻¹
 * 
 * References:
 * - Mikhail, E.M. (1976) "Observations and Least Squares"
 * - Harvey, B.R. (2006) "Practical Least Squares and Statistics for Surveyors"
 */

// ─── Types ───────────────────────────────────────────────────────

export interface LSObservation {
  type: 'distance' | 'angle' | 'azimuth' | 'position';
  fromStation: string;
  toStation: string;
  /** For angles: the station at the angle vertex */
  atStation?: string;
  /** Observed value (meters for distance, decimal degrees for angle/azimuth) */
  value: number;
  /** A priori standard deviation (meters or seconds of arc) */
  stdDev: number;
}

export interface LSStation {
  name: string;
  easting: number;    // Approximate coordinates
  northing: number;
  isFixed: boolean;
}

export interface LSResult {
  adjustedStations: {
    name: string;
    easting: number;
    northing: number;
    stdDevE: number;
    stdDevN: number;
    errorEllipse: {
      semiMajor: number;   // meters
      semiMinor: number;   // meters
      orientation: number; // degrees from north
    };
    isFixed: boolean;
  }[];
  residuals: {
    observation: LSObservation;
    residual: number;
    standardized: number;  // v / σ_v
  }[];
  aPosterioriVariance: number;
  sigmaZeroSquared: number;
  degreesOfFreedom: number;
  chiSquareTest: {
    value: number;
    lower: number;
    upper: number;
    passes: boolean;  // σ̂₀² within 95% confidence bounds
  };
  corrections: {
    name: string;
    dE: number;
    dN: number;
  }[];
}

// ─── Matrix Operations ───────────────────────────────────────────

/** Simple matrix class for least squares computation */
class Matrix {
  data: number[][];
  rows: number;
  cols: number;
  
  constructor(rows: number, cols: number) {
    this.rows = rows;
    this.cols = cols;
    this.data = Array.from({ length: rows }, () => new Array(cols).fill(0));
  }
  
  static fromArray(arr: number[][]): Matrix {
    const m = new Matrix(arr.length, arr[0].length);
    m.data = arr;
    return m;
  }
  
  static identity(n: number): Matrix {
    const m = new Matrix(n, n);
    for (let i = 0; i < n; i++) m.data[i][i] = 1;
    return m;
  }
  
  static diagonal(values: number[]): Matrix {
    const m = new Matrix(values.length, values.length);
    for (let i = 0; i < values.length; i++) m.data[i][i] = values[i];
    return m;
  }
  
  get(i: number, j: number): number { return this.data[i][j]; }
  set(i: number, j: number, v: number): void { this.data[i][j] = v; }
  
  transpose(): Matrix {
    const result = new Matrix(this.cols, this.rows);
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        result.data[j][i] = this.data[i][j];
      }
    }
    return result;
  }
  
  multiply(other: Matrix): Matrix {
    if (this.cols !== other.rows) {
      throw new Error(`Matrix multiply: ${this.cols} !== ${other.rows}`);
    }
    const result = new Matrix(this.rows, other.cols);
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < other.cols; j++) {
        let sum = 0;
        for (let k = 0; k < this.cols; k++) {
          sum += this.data[i][k] * other.data[k][j];
        }
        result.data[i][j] = sum;
      }
    }
    return result;
  }
  
  multiplyVector(v: number[]): number[] {
    const result = new Array(this.rows).fill(0);
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        result[i] += this.data[i][j] * v[j];
      }
    }
    return result;
  }
  
  /** Invert using Gauss-Jordan elimination */
  invert(): Matrix {
    if (this.rows !== this.cols) {
      throw new Error('Can only invert square matrices');
    }
    const n = this.rows;
    
    // Augmented matrix [A | I]
    const aug = new Matrix(n, 2 * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        aug.data[i][j] = this.data[i][j];
      }
      aug.data[i][n + i] = 1;
    }
    
    // Forward elimination
    for (let col = 0; col < n; col++) {
      // Pivot
      let maxRow = col;
      let maxVal = Math.abs(aug.data[col][col]);
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(aug.data[row][col]) > maxVal) {
          maxVal = Math.abs(aug.data[row][col]);
          maxRow = row;
        }
      }
      if (maxVal < 1e-15) {
        throw new Error('Matrix is singular — cannot invert');
      }
      
      // Swap rows
      if (maxRow !== col) {
        [aug.data[col], aug.data[maxRow]] = [aug.data[maxRow], aug.data[col]];
      }
      
      // Scale pivot row
      const pivot = aug.data[col][col];
      for (let j = 0; j < 2 * n; j++) {
        aug.data[col][j] /= pivot;
      }
      
      // Eliminate column
      for (let row = 0; row < n; row++) {
        if (row === col) continue;
        const factor = aug.data[row][col];
        for (let j = 0; j < 2 * n; j++) {
          aug.data[row][j] -= factor * aug.data[col][j];
        }
      }
    }
    
    // Extract inverse
    const result = new Matrix(n, n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        result.data[i][j] = aug.data[i][n + j];
      }
    }
    return result;
  }
}

// ─── Least Squares Adjustment ────────────────────────────────────

/**
 * Perform least squares adjustment of a traverse or network.
 * 
 * @param stations - Approximate station coordinates
 * @param observations - Observations (distances, angles, azimuths)
 * @returns Adjusted coordinates with uncertainties
 */
export function leastSquaresAdjustment(
  stations: LSStation[],
  observations: LSObservation[]
): LSResult {
  // Separate fixed and free stations
  const freeStations = stations.filter(s => !s.isFixed);
  const u = freeStations.length * 2; // Number of unknowns (E, N for each free station)
  const n = observations.length;      // Number of observations
  
  if (u === 0) {
    throw new Error('No free stations to adjust');
  }
  
  if (n < u / 2) {
    throw new Error(`Insufficient observations (${n}) for ${u} unknowns`);
  }
  
  // Build station index
  const stationIndex = new Map<string, number>();
  freeStations.forEach((s, i) => stationIndex.set(s.name, i));
  
  // Step 1: Build design matrix A and observation vector b
  const A = new Matrix(n, u);
  const b = new Array(n).fill(0);
  const weights = new Array(n).fill(0);
  
  for (let i = 0; i < n; i++) {
    const obs = observations[i];
    const w = 1 / (obs.stdDev * obs.stdDev);
    weights[i] = w;
    
    if (obs.type === 'distance') {
      const fromStation = stations.find(s => s.name === obs.fromStation)!;
      const toStation = stations.find(s => s.name === obs.toStation)!;
      
      const dE = toStation.easting - fromStation.easting;
      const dN = toStation.northing - fromStation.northing;
      const dist = Math.sqrt(dE * dE + dN * dN);
      
      if (dist < 1e-10) continue;
      
      // Partial derivatives for distance observation
      const dDist_dEfrom = -dE / dist;
      const dDist_dNfrom = -dN / dist;
      const dDist_dEto = dE / dist;
      const dDist_dNto = dN / dist;
      
      // Computed distance
      const computedDist = dist;
      b[i] = obs.value - computedDist; // Observed - computed
      
      // Fill design matrix
      const fromIdx = stationIndex.get(obs.fromStation);
      const toIdx = stationIndex.get(obs.toStation);
      
      if (fromIdx !== undefined) {
        A.set(i, fromIdx * 2, dDist_dEfrom);
        A.set(i, fromIdx * 2 + 1, dDist_dNfrom);
      }
      if (toIdx !== undefined) {
        A.set(i, toIdx * 2, dDist_dEto);
        A.set(i, toIdx * 2 + 1, dDist_dNto);
      }
      
    } else if (obs.type === 'angle') {
      // AUDIT FIX (H12, 2026-07-02): Implemented angle observation equation.
      // Previously was `b[i] = 0; // Placeholder` — the file was non-functional
      // for traverses with angle observations.
      //
      // Angle at station B between backsight A and foresight C:
      //   θ = α_BC - α_BA  (clockwise from backsight to foresight)
      // where α_XY = atan2(E_Y - E_X, N_Y - N_X) is the bearing from X to Y.
      //
      // Partial derivatives (bearing α from P1 to P2, dist = |P2-P1|):
      //   ∂α/∂E_1 =  dN / dist²    ∂α/∂N_1 = -dE / dist²
      //   ∂α/∂E_2 = -dN / dist²    ∂α/∂N_2 =  dE / dist²
      //
      // For θ = α_BC - α_BA:
      //   ∂θ/∂E_B = dN_BC/dist_BC² - dN_BA/dist_BA²
      //   ∂θ/∂N_B = -dE_BC/dist_BC² + dE_BA/dist_BA²
      //   ∂θ/∂E_A = dN_BA/dist_BA²
      //   ∂θ/∂N_A = -dE_BA/dist_BA²
      //   ∂θ/∂E_C = -dN_BC/dist_BC²
      //   ∂θ/∂N_C = dE_BC/dist_BC²

      const atStation = stations.find(s => s.name === obs.atStation)!;
      const fromStation = stations.find(s => s.name === obs.fromStation)!; // backsight
      const toStation = stations.find(s => s.name === obs.toStation)!;     // foresight

      // Vectors and distances
      const dE_BA = fromStation.easting - atStation.easting;
      const dN_BA = fromStation.northing - atStation.northing;
      const dist_BA = Math.sqrt(dE_BA * dE_BA + dN_BA * dN_BA);

      const dE_BC = toStation.easting - atStation.easting;
      const dN_BC = toStation.northing - atStation.northing;
      const dist_BC = Math.sqrt(dE_BC * dE_BC + dN_BC * dN_BC);

      if (dist_BA < 1e-10 || dist_BC < 1e-10) continue;

      // Computed bearings (radians)
      const alpha_BA = Math.atan2(dE_BA, dN_BA);
      const alpha_BC = Math.atan2(dE_BC, dN_BC);

      // Computed angle (radians → degrees)
      let computedAngle = alpha_BC - alpha_BA;
      // Normalize to [0, 360°)
      while (computedAngle < 0) computedAngle += 2 * Math.PI;
      while (computedAngle >= 2 * Math.PI) computedAngle -= 2 * Math.PI;
      const computedDeg = computedAngle * 180 / Math.PI;

      // Misclosure: observed - computed (in degrees)
      b[i] = obs.value - computedDeg;

      // Convert partial derivatives from radians to degrees
      // (so the weight 1/σ² in degrees² is consistent)
      const RAD_TO_DEG = 180 / Math.PI;
      const dist_BA2 = dist_BA * dist_BA;
      const dist_BC2 = dist_BC * dist_BC;

      // ∂θ/∂E_B = (dN_BC/dist_BC² - dN_BA/dist_BA²) × RAD_TO_DEG
      // ∂θ/∂N_B = (-dE_BC/dist_BC² + dE_BA/dist_BA²) × RAD_TO_DEG
      const dTh_dEB = (dN_BC / dist_BC2 - dN_BA / dist_BA2) * RAD_TO_DEG;
      const dTh_dNB = (-dE_BC / dist_BC2 + dE_BA / dist_BA2) * RAD_TO_DEG;
      const dTh_dEA = (dN_BA / dist_BA2) * RAD_TO_DEG;
      const dTh_dNA = (-dE_BA / dist_BA2) * RAD_TO_DEG;
      const dTh_dEC = (-dN_BC / dist_BC2) * RAD_TO_DEG;
      const dTh_dNC = (dE_BC / dist_BC2) * RAD_TO_DEG;

      // Fill design matrix (only for free/non-fixed stations)
      const atIdx = obs.atStation ? stationIndex.get(obs.atStation) : undefined;
      if (atIdx !== undefined) {
        A.set(i, atIdx * 2, dTh_dEB);
        A.set(i, atIdx * 2 + 1, dTh_dNB);
      }
      const fromIdx = stationIndex.get(obs.fromStation);
      if (fromIdx !== undefined) {
        A.set(i, fromIdx * 2, dTh_dEA);
        A.set(i, fromIdx * 2 + 1, dTh_dNA);
      }
      const toIdx = stationIndex.get(obs.toStation);
      if (toIdx !== undefined) {
        A.set(i, toIdx * 2, dTh_dEC);
        A.set(i, toIdx * 2 + 1, dTh_dNC);
      }

    } else if (obs.type === 'azimuth') {
      // AUDIT FIX (H12, 2026-07-02): Implemented azimuth observation equation.
      // Previously was `b[i] = 0; // Placeholder`.
      //
      // Azimuth (bearing) from station P1 to station P2:
      //   α = atan2(E_2 - E_1, N_2 - N_1)
      //
      // Partial derivatives (dist = |P2-P1|):
      //   ∂α/∂E_1 =  dN / dist²    ∂α/∂N_1 = -dE / dist²
      //   ∂α/∂E_2 = -dN / dist²    ∂α/∂N_2 =  dE / dist²

      const fromStation = stations.find(s => s.name === obs.fromStation)!;
      const toStation = stations.find(s => s.name === obs.toStation)!;

      const dE = toStation.easting - fromStation.easting;
      const dN = toStation.northing - fromStation.northing;
      const dist = Math.sqrt(dE * dE + dN * dN);

      if (dist < 1e-10) continue;

      // Computed azimuth (radians → degrees)
      const computedAz = Math.atan2(dE, dN) * 180 / Math.PI;
      const computedDeg = (computedAz + 360) % 360; // normalize to [0, 360)

      // Misclosure: observed - computed (in degrees)
      b[i] = obs.value - computedDeg;

      // Partial derivatives (convert radians → degrees)
      const RAD_TO_DEG = 180 / Math.PI;
      const dist2 = dist * dist;
      const dAz_dEfrom = (dN / dist2) * RAD_TO_DEG;
      const dAz_dNfrom = (-dE / dist2) * RAD_TO_DEG;
      const dAz_dEto = (-dN / dist2) * RAD_TO_DEG;
      const dAz_dNto = (dE / dist2) * RAD_TO_DEG;

      const fromIdx = stationIndex.get(obs.fromStation);
      if (fromIdx !== undefined) {
        A.set(i, fromIdx * 2, dAz_dEfrom);
        A.set(i, fromIdx * 2 + 1, dAz_dNfrom);
      }
      const toIdx = stationIndex.get(obs.toStation);
      if (toIdx !== undefined) {
        A.set(i, toIdx * 2, dAz_dEto);
        A.set(i, toIdx * 2 + 1, dAz_dNto);
      }

    } else if (obs.type === 'position') {
      // Position observation (pseudo-observation for constraints)
      const stationIdx = stationIndex.get(obs.fromStation);
      if (stationIdx !== undefined) {
        if (obs.value === stations.find(s => s.name === obs.fromStation)!.easting) {
          A.set(i, stationIdx * 2, 1);
        } else {
          A.set(i, stationIdx * 2 + 1, 1);
        }
        b[i] = 0;
      }
    }
  }
  
  // Step 2: Build weight matrix P (diagonal)
  const P = Matrix.diagonal(weights);
  
  // Step 3: Form and solve normal equations
  const AT = A.transpose();
  const ATP = AT.multiply(P);
  const N = ATP.multiply(A);   // Normal equation matrix
  const ATPb = ATP.multiplyVector(b);  // Right-hand side
  
  // Solve: δx = N⁻¹ × ATPb
  const Ninv = N.invert();
  const deltaX = Ninv.multiplyVector(ATPb);
  
  // Step 4: Compute residuals
  const deltaXMatrix = new Matrix(u, 1);
  for (let i = 0; i < u; i++) deltaXMatrix.set(i, 0, deltaX[i]);
  
  const v = A.multiply(deltaXMatrix); // v = A×δx - b → need to subtract b
  const residuals: LSResult['residuals'] = [];
  
  let vTPv = 0;
  for (let i = 0; i < n; i++) {
    const residual = v.get(i, 0) - b[i];
    const stdResidual = residual * Math.sqrt(weights[i]);
    vTPv += residual * residual * weights[i];
    
    residuals.push({
      observation: observations[i],
      residual,
      standardized: stdResidual,
    });
  }
  
  // Step 5: A posteriori variance factor
  const df = n - u; // Degrees of freedom
  const sigma0sq = df > 0 ? vTPv / df : 0;
  
  // Step 6: Covariance matrix
  const Cxx = Ninv;
  
  // Step 7: Compute adjusted coordinates and error ellipses
  const adjustedStations = freeStations.map((station, i) => {
    const dE = deltaX[i * 2] ?? 0;
    const dN = deltaX[i * 2 + 1] ?? 0;
    
    const adjE = station.easting + dE;
    const adjN = station.northing + dN;
    
    // Standard deviations from covariance matrix
    const varE = sigma0sq * Cxx.get(i * 2, i * 2);
    const varN = sigma0sq * Cxx.get(i * 2 + 1, i * 2 + 1);
    const covEN = sigma0sq * Cxx.get(i * 2, i * 2 + 1);
    
    const stdE = Math.sqrt(Math.abs(varE));
    const stdN = Math.sqrt(Math.abs(varN));
    
    // Error ellipse
    const ellipse = computeErrorEllipse(varE, varN, covEN);
    
    return {
      name: station.name,
      easting: adjE,
      northing: adjN,
      stdDevE: stdE,
      stdDevN: stdN,
      errorEllipse: ellipse,
      isFixed: false,
    };
  });
  
  // Add fixed stations
  for (const station of stations) {
    if (station.isFixed) {
      adjustedStations.push({
        name: station.name,
        easting: station.easting,
        northing: station.northing,
        stdDevE: 0,
        stdDevN: 0,
        errorEllipse: { semiMajor: 0, semiMinor: 0, orientation: 0 },
        isFixed: true,
      });
    }
  }
  
  // Chi-square test for variance factor
  const chiSquareLower = df > 0 ? chiSquareLower95(df) : 0;
  const chiSquareUpper = df > 0 ? chiSquareUpper95(df) : Infinity;
  const chiSquareValue = df > 0 ? vTPv : 0;
  
  return {
    adjustedStations,
    residuals,
    aPosterioriVariance: sigma0sq,
    sigmaZeroSquared: sigma0sq,
    degreesOfFreedom: df,
    chiSquareTest: {
      value: chiSquareValue,
      lower: chiSquareLower,
      upper: chiSquareUpper,
      passes: sigma0sq >= chiSquareLower / df && sigma0sq <= chiSquareUpper / df,
    },
    corrections: freeStations.map((s, i) => ({
      name: s.name,
      dE: deltaX[i * 2] ?? 0,
      dN: deltaX[i * 2 + 1] ?? 0,
    })),
  };
}

// ─── Error Ellipse ───────────────────────────────────────────────

/**
 * Compute 95% confidence error ellipse from variance-covariance components.
 * 
 * Semi-major axis: a = σ₀ × √(λ₁ × F)
 * Semi-minor axis: b = σ₀ × √(λ₂ × F)
 * Orientation: θ = 0.5 × atan2(2σ_EN, σ²_E - σ²_N)
 * 
 * Where λ₁, λ₂ are eigenvalues of the 2×2 covariance sub-matrix,
 * and F is the Fisher F-statistic for 95% confidence with 2 and df degrees of freedom.
 * 
 * @param varE - Variance of easting
 * @param varN - Variance of northing
 * @param covEN - Covariance of easting-northing
 * @param confidence - Confidence level (default: 0.95)
 * @param degreesOfFreedom - Degrees of freedom for F-statistic
 */
export function computeErrorEllipse(
  varE: number,
  varN: number,
  covEN: number,
  confidence: number = 0.95,
  degreesOfFreedom: number = 10
): { semiMajor: number; semiMinor: number; orientation: number } {
  // Eigenvalues of 2×2 covariance matrix
  const trace = varE + varN;
  const det = varE * varN - covEN * covEN;
  const discriminant = Math.sqrt(Math.max(0, trace * trace - 4 * det));
  
  const lambda1 = (trace + discriminant) / 2;
  const lambda2 = (trace - discriminant) / 2;
  
  // Orientation (angle of semi-major axis from north)
  const orientation = 0.5 * Math.atan2(2 * covEN, varE - varN) * 180 / Math.PI;
  
  // F-statistic for 95% confidence (approximation)
  // For 2 numerator df and various denominator df
  const F = fStatistic95(2, degreesOfFreedom);
  
  const semiMajor = Math.sqrt(Math.abs(lambda1) * 2 * F);
  const semiMinor = Math.sqrt(Math.abs(lambda2) * 2 * F);
  
  return {
    semiMajor: Math.round(semiMajor * 1000) / 1000, // mm precision
    semiMinor: Math.round(semiMinor * 1000) / 1000,
    orientation: Math.round(orientation * 100) / 100,
  };
}

// ─── Statistical Helpers ─────────────────────────────────────────

/**
 * Approximate F-statistic for 95% confidence level.
 * Uses an approximation formula for quick computation.
 */
function fStatistic95(numeratorDf: number, denominatorDf: number): number {
  // Simplified approximation for F(2, df) at 95%
  // More accurate values from statistical tables
  if (numeratorDf === 2) {
    if (denominatorDf >= 120) return 3.07;
    if (denominatorDf >= 60) return 3.15;
    if (denominatorDf >= 30) return 3.32;
    if (denominatorDf >= 20) return 3.49;
    if (denominatorDf >= 10) return 4.10;
    if (denominatorDf >= 5) return 5.79;
    return 6.94; // df = 2-4
  }
  return 4.0; // Default approximation
}

/**
 * Approximate lower bound of chi-square distribution at 95% confidence.
 */
function chiSquareLower95(df: number): number {
  // Approximate: χ²_lower = df × (1 - 2/(9df) - 1.96×√(2/(9df)))³
  const a = 1 - 2 / (9 * df);
  const b = 1.96 * Math.sqrt(2 / (9 * df));
  return df * Math.pow(Math.max(0.01, a - b), 3);
}

/**
 * Approximate upper bound of chi-square distribution at 95% confidence.
 */
function chiSquareUpper95(df: number): number {
  const a = 1 - 2 / (9 * df);
  const b = 1.96 * Math.sqrt(2 / (9 * df));
  return df * Math.pow(a + b, 3);
}
