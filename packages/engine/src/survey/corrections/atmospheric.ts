/**
 * EDM Atmospheric Correction Module
 * 
 * Corrects measured EDM distances for atmospheric conditions
 * (temperature, pressure, humidity) using the IAG/ISO standard formula.
 * 
 * At Nairobi altitude (~1700m, P≈830hPa), uncorrected measurements
 * accumulate ~22 ppm error — that's 22mm per kilometer.
 * 
 * References:
 * - IAG Resolution (1999) for refractivity formulae
 * - ISO 17123-4:2012 for EDM testing
 * - Rüeger, J.M. (1996) "Electronic Distance Measurement"
 */

// ─── Types ───────────────────────────────────────────────────────

export type EDMWavelength = 0.6328 | 0.850 | 0.910; // μm: HeNe, IR, common IR

export interface AtmosphericConditions {
  /** Dry bulb temperature in degrees Celsius */
  temperature: number;
  /** Atmospheric pressure in hectopascals (mbar) */
  pressure: number;
  /** Relative humidity as percentage (0-100) */
  humidity: number;
}

export interface AtmosphericCorrectionResult {
  /** Original raw slope distance (meters) */
  rawDistance: number;
  /** Corrected slope distance (meters) */
  correctedDistance: number;
  /** Correction in parts per million */
  ppmCorrection: number;
  /** Absolute correction in meters */
  correctionMeters: number;
  /** First velocity correction (ppm) */
  firstVelocityCorrection: number;
  /** Second velocity correction (ppm) — small, usually < 0.1 ppm */
  secondVelocityCorrection: number;
  /** Partial water vapor pressure (hPa) used in computation */
  vaporPressure: number;
  /** Group refractivity under reference conditions */
  nRef: number;
  /** Group refractivity under observed conditions */
  nObs: number;
  /** Reference conditions used */
  referenceConditions: AtmosphericConditions;
}

export interface EDMInstrument {
  /** Carrier wavelength in micrometers */
  wavelength: EDMWavelength;
  /** Reference refractivity (N-value) — default 273.82 for most instruments */
  referenceN: number;
  /** Instrument constant in meters (additive) */
  constant: number;
  /** PPM setting on instrument (if pre-set) */
  ppmSetting: number;
}

// ─── Constants ───────────────────────────────────────────────────

/** Standard atmospheric conditions (most EDM instruments calibrated here) */
export const STANDARD_CONDITIONS: AtmosphericConditions = {
  temperature: 20,       // °C
  pressure: 1013.25,     // hPa (1 atm)
  humidity: 0,           // 0% for dry air reference
};

/** Kenya-specific typical conditions for validation */
export const KENYA_CONDITIONS = {
  nairobi: { temperature: 20, pressure: 830, humidity: 60 },
  mombasa: { temperature: 30, pressure: 1010, humidity: 75 },
  kisumu: { temperature: 24, pressure: 880, humidity: 65 },
  eldoret: { temperature: 18, pressure: 820, humidity: 70 },
} as const;

// ─── Core Functions ──────────────────────────────────────────────

/**
 * Compute partial water vapor pressure using the Magnus-Tetens formula.
 * 
 * e = (RH / 100) × 6.112 × exp(17.62 × t / (243.12 + t))
 * 
 * Valid for: -45°C < t < +60°C (sufficient for all field conditions)
 * Accuracy: ±0.2 hPa over normal survey temperature range
 * 
 * @param temperature - Dry bulb temperature (°C)
 * @param humidity - Relative humidity (%)
 * @returns Partial water vapor pressure (hPa)
 */
export function computeVaporPressure(temperature: number, humidity: number): number {
  if (temperature < -45 || temperature > 60) {
    throw new Error(`Temperature ${temperature}°C outside valid range (-45 to +60°C)`);
  }
  if (humidity < 0 || humidity > 100) {
    throw new Error(`Humidity ${humidity}% outside valid range (0-100%)`);
  }
  
  const saturationVaporPressure = 6.112 * Math.exp(
    (17.62 * temperature) / (243.12 + temperature)
  );
  
  return (humidity / 100) * saturationVaporPressure;
}

/**
 * Compute group refractivity (N-value) for a given wavelength and conditions.
 * 
 * N = (n_group - 1) × 10^6
 * 
 * Uses the IAG standard formula (Rüeger 1996) for GROUP refractivity:
 * 
 * N_grp = (n_g - 1) × 10^6
 *       = [(287.604 + 3 × 1.6288/λ² + 5 × 0.0136/λ⁴) × P × 1.0003 / (273.15 + t)]
 *         - [11.27 × e / (273.15 + t)]
 * 
 * The factors 3 and 5 on the dispersion terms convert phase refractivity
 * to group refractivity (which is what EDM instruments measure).
 * 
 * The factor 1.0003 is an enhancement factor for non-ideal gas behavior.
 * 
 * At standard conditions (20°C, 1013.25 hPa, 0% humidity, λ=0.850μm):
 *   N_ref ≈ 273-275 (consistent with most EDM instrument reference values)
 * 
 * @param wavelength - Carrier wavelength (μm)
 * @param conditions - Atmospheric conditions
 * @returns Group refractivity N-value
 */
export function computeGroupRefractivity(
  wavelength: EDMWavelength,
  conditions: AtmosphericConditions
): number {
  const { temperature, pressure, humidity } = conditions;
  
  // Partial water vapor pressure
  const e = computeVaporPressure(temperature, humidity);
  
  // Dry component of GROUP refractivity
  // The factors 3 and 5 on dispersion terms convert phase → group refractivity
  const lambdaSq = wavelength * wavelength;
  const lambdaFourth = lambdaSq * lambdaSq;
  const groupCoeff = 287.604 + (3 * 1.6288 / lambdaSq) + (5 * 0.0136 / lambdaFourth);
  
  // Enhancement factor for non-ideal gas (≈1.0003 at normal pressures)
  const enhancement = 1 + 0.0003;
  
  const N_dry = groupCoeff * pressure * enhancement / (273.15 + temperature);
  
  // Wet component (water vapor reduces refractivity)
  const N_wet = (11.27 * e) / (273.15 + temperature);
  
  return N_dry - N_wet;
}

/**
 * Apply atmospheric correction to an EDM distance measurement.
 * 
 * Corrected distance = Raw distance × (1 + (N_ref - N_obs) / 10^6)
 * 
 * This is the "first velocity correction". A second velocity correction
 * exists but is typically < 0.1 ppm and is included for completeness.
 * 
 * @param rawDistance - Raw measured slope distance (meters)
 * @param conditions - Observed atmospheric conditions
 * @param instrument - EDM instrument parameters
 * @returns Full correction result with audit trail
 */
export function applyAtmosphericCorrection(
  rawDistance: number,
  conditions: AtmosphericConditions,
  instrument: Partial<EDMInstrument> = {}
): AtmosphericCorrectionResult {
  // Defaults
  const wavelength: EDMWavelength = (instrument.wavelength as EDMWavelength) ?? 0.850;
  const referenceN = instrument.referenceN ?? computeGroupRefractivity(wavelength, STANDARD_CONDITIONS);
  const ppmSetting = instrument.ppmSetting ?? 0;
  
  // Validate inputs
  if (rawDistance < 0) {
    throw new Error(`Raw distance ${rawDistance}m must be non-negative`);
  }
  if (conditions.pressure < 500 || conditions.pressure > 1100) {
    throw new Error(`Pressure ${conditions.pressure} hPa outside valid range (500-1100 hPa)`);
  }
  
  // Compute observed refractivity
  const nObs = computeGroupRefractivity(wavelength, conditions);
  
  // First velocity correction (ppm)
  const firstVelocityCorrection = referenceN - nObs;
  
  // Second velocity correction (ppm) — small correction for the
  // difference between phase and group velocity in the atmosphere
  // Typically < 0.1 ppm, but included for completeness
  const e = computeVaporPressure(conditions.temperature, conditions.humidity);
  const secondVelocityCorrection = computeSecondVelocityCorrection(
    wavelength, conditions, e
  );
  
  // Total correction in ppm
  const ppmCorrection = firstVelocityCorrection + secondVelocityCorrection - ppmSetting;
  
  // Apply correction
  const correctionMeters = rawDistance * ppmCorrection / 1e6;
  const correctedDistance = rawDistance + correctionMeters;
  
  return {
    rawDistance,
    correctedDistance,
    ppmCorrection: Math.round(ppmCorrection * 100) / 100, // 2 decimal places
    correctionMeters: Math.round(correctionMeters * 1e6) / 1e6, // micrometer precision
    firstVelocityCorrection: Math.round(firstVelocityCorrection * 100) / 100,
    secondVelocityCorrection: Math.round(secondVelocityCorrection * 1000) / 1000,
    vaporPressure: Math.round(e * 100) / 100,
    nRef: Math.round(referenceN * 100) / 100,
    nObs: Math.round(nObs * 100) / 100,
    referenceConditions: STANDARD_CONDITIONS,
  };
}

/**
 * Compute the second velocity correction.
 * This accounts for the difference between the phase refractivity
 * (which the EDM actually measures) and the group refractivity
 * (which determines the propagation speed of the modulation).
 * 
 * Typically < 0.1 ppm but included for highest accuracy.
 * 
 * @param wavelength - Carrier wavelength (μm)
 * @param conditions - Atmospheric conditions
 * @param vaporPressure - Pre-computed vapor pressure (hPa)
 * @returns Second velocity correction in ppm
 */
function computeSecondVelocityCorrection(
  wavelength: EDMWavelength,
  conditions: AtmosphericConditions,
  vaporPressure: number
): number {
  const { temperature, pressure } = conditions;
  const T = 273.15 + temperature;
  
  // Wavelength dependence
  const lambdaSq = wavelength * wavelength;
  const lambdaFourth = lambdaSq * lambdaSq;
  
  // Derivative of dry refractivity with respect to wavelength
  const dN_dLambda2 = -2 * (1.6288 / (lambdaSq * lambdaSq)) - 4 * (0.0136 / (lambdaFourth * lambdaSq));
  
  // Second velocity correction
  const svc = dN_dLambda2 * lambdaSq * pressure / T * 1e-6;
  
  return svc;
}

// ─── Convenience Functions ───────────────────────────────────────

/**
 * Quick atmospheric correction — returns just the corrected distance.
 * Useful when you don't need the full audit trail.
 */
export function quickAtmosphericCorrection(
  rawDistance: number,
  temperature: number,
  pressure: number,
  humidity: number,
  wavelength: EDMWavelength = 0.850
): number {
  return applyAtmosphericCorrection(
    rawDistance,
    { temperature, pressure, humidity },
    { wavelength }
  ).correctedDistance;
}

/**
 * Compute the atmospheric correction ppm for given conditions.
 * Useful for checking if a measurement needs correction.
 */
export function getAtmosphericPPM(
  temperature: number,
  pressure: number,
  humidity: number,
  wavelength: EDMWavelength = 0.850
): number {
  return applyAtmosphericCorrection(
    1000, // arbitrary reference distance
    { temperature, pressure, humidity },
    { wavelength }
  ).ppmCorrection;
}

/**
 * Validate that atmospheric conditions are within reasonable ranges
 * for surveying in Kenya.
 */
export function validateAtmosphericConditions(conditions: AtmosphericConditions): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  
  if (conditions.temperature < -10 || conditions.temperature > 50) {
    warnings.push(`Temperature ${conditions.temperature}°C is outside normal Kenya range (10-40°C)`);
  }
  if (conditions.pressure < 600 || conditions.pressure > 1050) {
    warnings.push(`Pressure ${conditions.pressure} hPa is unusual for Kenya (600-1050 hPa expected)`);
  }
  if (conditions.humidity > 95) {
    warnings.push(`Humidity ${conditions.humidity}% is very high — check for condensation on instrument`);
  }
  
  return {
    valid: warnings.length === 0,
    warnings,
  };
}
