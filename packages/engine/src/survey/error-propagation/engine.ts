/**
 * Error Propagation Engine
 * 
 * Propagates uncertainties through all survey computations to provide
 * confidence intervals on computed values. This is what separates
 * professional survey software from basic calculators.
 * 
 * General variance propagation law:
 *   σ²_f = Σ(∂f/∂xᵢ)² × σ²_xᵢ + 2 × Σ(∂f/∂xᵢ)(∂f/∂xⱼ) × σ_xᵢxⱼ
 * 
 * References:
 * - Mikhail, E.M. (1976) "Observations and Least Squares"
 * - Ghilani, C.D. (2010) "Adjustment Computations"
 */

// ─── Types ───────────────────────────────────────────────────────

export interface UncertainValue {
  value: number;
  stdDev: number;
  units: string;
  description?: string;
}

export interface PropagationResult {
  computedValue: number;
  stdDev: number;
  variance: number;
  confidence95: number;  // 95% confidence interval half-width
  relativeAccuracy: string;  // e.g., "1:25000"
  contributors: {
    name: string;
    variance: number;
    percentage: number;
  }[];
}

// ─── Basic Propagation Functions ─────────────────────────────────

/**
 * Propagate uncertainty through addition/subtraction.
 * f = a₁ ± a₂ ± ... ± aₙ
 * σ²_f = σ²_a1 + σ²_a2 + ... + σ²_an
 * (Covariances assumed zero for independent observations)
 */
export function propagateSum(values: UncertainValue[]): PropagationResult {
  const totalValue = values.reduce((sum, v) => sum + v.value, 0);
  const totalVariance = values.reduce((sum, v) => sum + v.stdDev * v.stdDev, 0);
  const totalStdDev = Math.sqrt(totalVariance);
  
  return {
    computedValue: totalValue,
    stdDev: totalStdDev,
    variance: totalVariance,
    confidence95: 1.96 * totalStdDev,
    relativeAccuracy: totalValue !== 0 ? `1:${Math.round(Math.abs(totalValue / totalStdDev))}` : 'undefined',
    contributors: values.map(v => ({
      name: v.description ?? 'unknown',
      variance: v.stdDev * v.stdDev,
      percentage: totalVariance > 0 ? (v.stdDev * v.stdDev / totalVariance) * 100 : 0,
    })),
  };
}

/**
 * Propagate uncertainty through multiplication by a constant.
 * f = k × a
 * σ_f = |k| × σ_a
 */
export function propagateScale(value: UncertainValue, constant: number): PropagationResult {
  const result = value.value * constant;
  const stdDev = Math.abs(constant) * value.stdDev;
  const variance = stdDev * stdDev;
  
  return {
    computedValue: result,
    stdDev,
    variance,
    confidence95: 1.96 * stdDev,
    relativeAccuracy: result !== 0 ? `1:${Math.round(Math.abs(result / stdDev))}` : 'undefined',
    contributors: [{
      name: value.description ?? 'input',
      variance,
      percentage: 100,
    }],
  };
}

/**
 * Propagate uncertainty through a general function using partial derivatives.
 * 
 * σ²_f = Σ(∂f/∂xᵢ)² × σ²_xᵢ
 * 
 * @param func - The function f(x₁, x₂, ..., xₙ)
 * @param values - Input values with uncertainties
 * @param partials - Partial derivatives ∂f/∂xᵢ (numerical or analytical)
 */
export function propagateGeneral(
  func: (...args: number[]) => number,
  values: UncertainValue[],
  partials?: ((...args: number[]) => number)[]
): PropagationResult {
  const args = values.map(v => v.value);
  const computedValue = func(...args);
  
  let totalVariance = 0;
  const contributors: PropagationResult['contributors'] = [];
  
  for (let i = 0; i < values.length; i++) {
    let partial: number;
    
    if (partials && partials[i]) {
      // Analytical partial derivative
      partial = partials[i](...args);
    } else {
      // Numerical partial derivative (finite difference)
      const h = Math.max(Math.abs(args[i]) * 1e-8, 1e-10);
      const argsPlus = [...args];
      argsPlus[i] += h;
      const argsMinus = [...args];
      argsMinus[i] -= h;
      partial = (func(...argsPlus) - func(...argsMinus)) / (2 * h);
    }
    
    const contribution = partial * partial * values[i].stdDev * values[i].stdDev;
    totalVariance += contribution;
    
    contributors.push({
      name: values[i].description ?? `x${i + 1}`,
      variance: contribution,
      percentage: 0, // Will be computed after total
    });
  }
  
  // Compute percentages
  for (const c of contributors) {
    c.percentage = totalVariance > 0 ? (c.variance / totalVariance) * 100 : 0;
  }
  
  const stdDev = Math.sqrt(totalVariance);
  
  return {
    computedValue,
    stdDev,
    variance: totalVariance,
    confidence95: 1.96 * stdDev,
    relativeAccuracy: computedValue !== 0 ? `1:${Math.round(Math.abs(computedValue / stdDev))}` : 'undefined',
    contributors,
  };
}

// ─── Survey-Specific Propagations ────────────────────────────────

/**
 * Propagate uncertainty through coordinate computation.
 * 
 * E_to = E_from + d × sin(θ)
 * N_to = N_from + d × cos(θ)
 * 
 * σ²_E = σ²_Efrom + sin²(θ) × σ²_d + d² × cos²(θ) × σ²_θ
 * σ²_N = σ²_Nfrom + cos²(θ) × σ²_d + d² × sin²(θ) × σ²_θ
 */
export function propagateCoordinate(
  fromE: UncertainValue,
  fromN: UncertainValue,
  distance: UncertainValue,
  bearing: UncertainValue  // stdDev in radians
): { easting: PropagationResult; northing: PropagationResult } {
  const theta = bearing.value;
  const d = distance.value;
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  
  // Easting
  const eValue = fromE.value + d * sinT;
  const eVariance = fromE.stdDev * fromE.stdDev +
    sinT * sinT * distance.stdDev * distance.stdDev +
    d * d * cosT * cosT * bearing.stdDev * bearing.stdDev;
  
  // Northing
  const nValue = fromN.value + d * cosT;
  const nVariance = fromN.stdDev * fromN.stdDev +
    cosT * cosT * distance.stdDev * distance.stdDev +
    d * d * sinT * sinT * bearing.stdDev * bearing.stdDev;
  
  const eStdDev = Math.sqrt(Math.abs(eVariance));
  const nStdDev = Math.sqrt(Math.abs(nVariance));
  
  return {
    easting: {
      computedValue: eValue,
      stdDev: eStdDev,
      variance: eVariance,
      confidence95: 1.96 * eStdDev,
      relativeAccuracy: eValue !== 0 ? `1:${Math.round(Math.abs(eValue / eStdDev))}` : 'undefined',
      contributors: [
        { name: 'From E', variance: fromE.stdDev * fromE.stdDev, percentage: 0 },
        { name: 'Distance', variance: sinT * sinT * distance.stdDev * distance.stdDev, percentage: 0 },
        { name: 'Bearing', variance: d * d * cosT * cosT * bearing.stdDev * bearing.stdDev, percentage: 0 },
      ],
    },
    northing: {
      computedValue: nValue,
      stdDev: nStdDev,
      variance: nVariance,
      confidence95: 1.96 * nStdDev,
      relativeAccuracy: nValue !== 0 ? `1:${Math.round(Math.abs(nValue / nStdDev))}` : 'undefined',
      contributors: [
        { name: 'From N', variance: fromN.stdDev * fromN.stdDev, percentage: 0 },
        { name: 'Distance', variance: cosT * cosT * distance.stdDev * distance.stdDev, percentage: 0 },
        { name: 'Bearing', variance: d * d * sinT * sinT * bearing.stdDev * bearing.stdDev, percentage: 0 },
      ],
    },
  };
}

/**
 * Propagate uncertainty through area computation (Shoelace formula).
 * 
 * For a polygon with n vertices:
 *   A = 0.5 × |Σ(xᵢ × yᵢ₊₁ - xᵢ₊₁ × yᵢ)|
 * 
 * σ²_A = Σ[(∂A/∂xᵢ)² × σ²_xᵢ + (∂A/∂yᵢ)² × σ²_yᵢ]
 */
export function propagateArea(
  coordinates: { easting: UncertainValue; northing: UncertainValue }[]
): PropagationResult {
  const n = coordinates.length;
  
  // Compute area using Shoelace formula
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += coordinates[i].easting.value * coordinates[j].northing.value -
            coordinates[j].easting.value * coordinates[i].northing.value;
  }
  area = Math.abs(area) / 2;
  
  // Propagate uncertainty
  let totalVariance = 0;
  
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    const next = (i + 1) % n;
    
    // ∂A/∂xᵢ = (yᵢ₊₁ - yᵢ₋₁) / 2
    const dA_dE = (coordinates[next].northing.value - coordinates[prev].northing.value) / 2;
    // ∂A/∂yᵢ = (xᵢ₋₁ - xᵢ₊₁) / 2
    const dA_dN = (coordinates[prev].easting.value - coordinates[next].easting.value) / 2;
    
    totalVariance += dA_dE * dA_dE * coordinates[i].easting.stdDev * coordinates[i].easting.stdDev;
    totalVariance += dA_dN * dA_dN * coordinates[i].northing.stdDev * coordinates[i].northing.stdDev;
  }
  
  const stdDev = Math.sqrt(totalVariance);
  
  return {
    computedValue: area,
    stdDev,
    variance: totalVariance,
    confidence95: 1.96 * stdDev,
    relativeAccuracy: area !== 0 ? `1:${Math.round(area / stdDev)}` : 'undefined',
    contributors: coordinates.map((c, i) => ({
      name: `Point ${i + 1}`,
      variance: c.easting.stdDev * c.easting.stdDev + c.northing.stdDev * c.northing.stdDev,
      percentage: 0,
    })),
  };
}
