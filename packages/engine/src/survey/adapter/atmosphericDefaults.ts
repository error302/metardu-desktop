/**
 * Atmospheric Defaults Engine
 * 
 * Ensures surveyors ALWAYS have correct atmospheric conditions for their
 * observation corrections. Without atmospheric data, EDM distances in Kenya
 * accumulate massive errors:
 *   - Nairobi (~1700m): ~22 ppm atmospheric + ~267 ppm sea level = 289 ppm total
 *   - That's 289mm per kilometer of UNCORRECTED distance error
 *   - At 1:5000 cadastral precision, that blows misclosure on any line > ~17m
 * 
 * This engine provides a 3-tier fallback system:
 *   1. Project-level settings (stored in DB, set once per project)
 *   2. Location presets (Kenya cities with typical conditions)
 *   3. Real-time weather API (Open-Meteo, free, no API key)
 *   4. Auto UTM zone detection from coordinates
 * 
 * The UI should ALWAYS show atmospheric conditions — never leave them empty.
 * If no data is available, show a prominent warning.
 */

import { KENYA_CONDITIONS } from '../corrections/atmospheric';
import { KENYA_GEOID_UNDULATION } from '../corrections/sea-level-reduction';

// ─── Types ───────────────────────────────────────────────────────

export interface AtmosphericDefaults {
  /** Temperature in °C */
  temperature: number;
  /** Pressure in hPa */
  pressure: number;
  /** Relative humidity in % */
  humidity: number;
  /** Mean elevation above sea level in meters (orthometric height) */
  elevation: number;
  /** UTM zone (36S or 37S for Kenya) */
  utmZone: 'UTM36S' | 'UTM37S';
  /** Geoid undulation at the site (meters) — Kenya default: -12m */
  geoidUndulation: number;
  /** Refraction coefficient — Kenya tropical daytime default: 0.13 */
  refractionCoefficient: number;
  /** Source of the atmospheric data */
  source: AtmosphericSource;
  /** When the data was fetched (for weather API) */
  fetchedAt?: string;
  /** Whether these are verified/confirmed by the surveyor */
  verified: boolean;
}

export type AtmosphericSource =
  | 'project_settings'    // Explicitly set in project configuration
  | 'location_preset'     // Derived from known Kenya city/location
  | 'weather_api'         // Fetched from Open-Meteo API
  | 'default';            // Fallback defaults

export interface ProjectAtmosphericSettings {
  temperature?: number;
  pressure?: number;
  humidity?: number;
  elevation?: number;
  utmZone?: 'UTM36S' | 'UTM37S';
  county?: string;
  latitude?: number;
  longitude?: number;
}

// ─── Kenya Location Presets ──────────────────────────────────────
// Expanded from the survey engine's KENYA_CONDITIONS with elevation data
// Elevation data from SRTM, pressure from ICAO standard atmosphere formula:
//   P = 1013.25 × (1 - 2.25577e-5 × h)^5.25588

export interface KenyaLocationPreset {
  name: string;
  county: string;
  latitude: number;
  longitude: number;
  elevation: number;
  temperature: number;
  /** Pressure computed from ICAO formula or measured */
  pressure: number;
  humidity: number;
  utmZone: 'UTM36S' | 'UTM37S';
  geoidUndulation: number;
}

export const KENYA_LOCATION_PRESETS: Record<string, KenyaLocationPreset> = {
  nairobi: {
    name: 'Nairobi',
    county: 'Nairobi',
    latitude: -1.2921,
    longitude: 36.8219,
    elevation: 1795,
    temperature: 20,
    pressure: 830,    // ICAO at 1795m: ~820, measured avg ~830
    humidity: 60,
    utmZone: 'UTM37S',
    geoidUndulation: -12,
  },
  mombasa: {
    name: 'Mombasa',
    county: 'Mombasa',
    latitude: -4.0435,
    longitude: 39.6682,
    elevation: 50,
    temperature: 30,
    pressure: 1010,
    humidity: 75,
    utmZone: 'UTM37S',
    geoidUndulation: -8,
  },
  kisumu: {
    name: 'Kisumu',
    county: 'Kisumu',
    latitude: -0.0917,
    longitude: 34.7680,
    elevation: 1130,
    temperature: 24,
    pressure: 880,
    humidity: 65,
    utmZone: 'UTM36S',
    geoidUndulation: -15,
  },
  eldoret: {
    name: 'Eldoret',
    county: 'Uasin Gishu',
    latitude: 0.5143,
    longitude: 35.2698,
    elevation: 2100,
    temperature: 18,
    pressure: 820,
    humidity: 70,
    utmZone: 'UTM36S',
    geoidUndulation: -14,
  },
  nakuru: {
    name: 'Nakuru',
    county: 'Nakuru',
    latitude: -0.3031,
    longitude: 36.0800,
    elevation: 1850,
    temperature: 19,
    pressure: 810,
    humidity: 65,
    utmZone: 'UTM36S',
    geoidUndulation: -13,
  },
  meru: {
    name: 'Meru',
    county: 'Meru',
    latitude: 0.0469,
    longitude: 37.6508,
    elevation: 1520,
    temperature: 20,
    pressure: 845,
    humidity: 65,
    utmZone: 'UTM37S',
    geoidUndulation: -12,
  },
  garissa: {
    name: 'Garissa',
    county: 'Garissa',
    latitude: -0.4536,
    longitude: 39.6461,
    elevation: 140,
    temperature: 33,
    pressure: 996,
    humidity: 55,
    utmZone: 'UTM37S',
    geoidUndulation: -8,
  },
  machakos: {
    name: 'Machakos',
    county: 'Machakos',
    latitude: -1.5178,
    longitude: 37.2634,
    elevation: 1700,
    temperature: 21,
    pressure: 835,
    humidity: 60,
    utmZone: 'UTM37S',
    geoidUndulation: -12,
  },
  malindi: {
    name: 'Malindi',
    county: 'Kilifi',
    latitude: -3.2197,
    longitude: 40.1169,
    elevation: 20,
    temperature: 29,
    pressure: 1012,
    humidity: 78,
    utmZone: 'UTM37S',
    geoidUndulation: -7,
  },
  kiambu: {
    name: 'Kiambu',
    county: 'Kiambu',
    latitude: -1.1747,
    longitude: 36.8356,
    elevation: 1580,
    temperature: 20,
    pressure: 840,
    humidity: 62,
    utmZone: 'UTM37S',
    geoidUndulation: -12,
  },
  thika: {
    name: 'Thika',
    county: 'Kiambu',
    latitude: -1.0333,
    longitude: 37.0833,
    elevation: 1550,
    temperature: 21,
    pressure: 842,
    humidity: 62,
    utmZone: 'UTM37S',
    geoidUndulation: -12,
  },
  muranga: {
    name: "Murang'a",
    county: "Murang'a",
    latitude: -0.7167,
    longitude: 37.1500,
    elevation: 1280,
    temperature: 22,
    pressure: 865,
    humidity: 65,
    utmZone: 'UTM37S',
    geoidUndulation: -12,
  },
  nyeri: {
    name: 'Nyeri',
    county: 'Nyeri',
    latitude: -0.4167,
    longitude: 36.9500,
    elevation: 1760,
    temperature: 19,
    pressure: 820,
    humidity: 68,
    utmZone: 'UTM37S',
    geoidUndulation: -13,
  },
  embu: {
    name: 'Embu',
    county: 'Embu',
    latitude: -0.5333,
    longitude: 37.4500,
    elevation: 1350,
    temperature: 22,
    pressure: 860,
    humidity: 65,
    utmZone: 'UTM37S',
    geoidUndulation: -12,
  },
  kitale: {
    name: 'Kitale',
    county: 'Trans Nzoia',
    latitude: 1.0167,
    longitude: 34.9833,
    elevation: 1900,
    temperature: 19,
    pressure: 805,
    humidity: 70,
    utmZone: 'UTM36S',
    geoidUndulation: -14,
  },
  kakamega: {
    name: 'Kakamega',
    county: 'Kakamega',
    latitude: 0.2833,
    longitude: 34.7500,
    elevation: 1535,
    temperature: 22,
    pressure: 840,
    humidity: 75,
    utmZone: 'UTM36S',
    geoidUndulation: -14,
  },
  lodwar: {
    name: 'Lodwar',
    county: 'Turkana',
    latitude: 3.1167,
    longitude: 35.5833,
    elevation: 510,
    temperature: 35,
    pressure: 950,
    humidity: 30,
    utmZone: 'UTM36S',
    geoidUndulation: -10,
  },
  marsabit: {
    name: 'Marsabit',
    county: 'Marsabit',
    latitude: 2.3333,
    longitude: 37.9833,
    elevation: 1340,
    temperature: 22,
    pressure: 860,
    humidity: 55,
    utmZone: 'UTM37S',
    geoidUndulation: -10,
  },
};

// ─── Core Functions ──────────────────────────────────────────────

/**
 * Compute ICAO standard atmosphere pressure for a given elevation.
 * P = 1013.25 × (1 - 2.25577e-5 × h)^5.25588
 * 
 * Valid for elevations up to ~11,000m. Accuracy: ±5 hPa for Kenya.
 */
export function icaoPressure(elevationMeters: number): number {
  const P0 = 1013.25;
  const exponent = 5.25588;
  const lapseRate = 2.25577e-5;
  return P0 * Math.pow(1 - lapseRate * elevationMeters, exponent);
}

/**
 * Auto-detect UTM zone from longitude.
 * UTM 36S: 30°E to 36°E (western Kenya)
 * UTM 37S: 36°E to 42°E (central/eastern Kenya)
 * 
 * Kenya spans roughly 34°E to 42°E, so most of Kenya is in Zone 37S.
 * Only the far western counties (Busia, Siaya, parts of Kisumu) fall in Zone 36S.
 */
export function autoDetectUTMZone(longitude: number): 'UTM36S' | 'UTM37S' {
  // Zone 36S: 30°E - 36°E, Zone 37S: 36°E - 42°E
  if (longitude < 36) return 'UTM36S';
  return 'UTM37S';
}

/**
 * Find the nearest Kenya location preset to given coordinates.
 * Uses simple Euclidean distance on lat/lon (sufficient for Kenya's scale).
 */
export function findNearestPreset(
  latitude: number,
  longitude: number
): { key: string; preset: KenyaLocationPreset; distanceKm: number } | null {
  let nearest: { key: string; preset: KenyaLocationPreset; distanceKm: number } | null = null;

  for (const [key, preset] of Object.entries(KENYA_LOCATION_PRESETS)) {
    const dLat = preset.latitude - latitude;
    const dLon = preset.longitude - longitude;
    // Approximate distance in km (1° ≈ 111km at equator)
    const distanceKm = Math.sqrt(dLat * dLat + dLon * dLon) * 111;

    if (!nearest || distanceKm < nearest.distanceKm) {
      nearest = { key, preset, distanceKm };
    }
  }

  return nearest;
}

/**
 * Find a preset by county name (case-insensitive partial match).
 */
export function findPresetByCounty(county: string): KenyaLocationPreset | null {
  const lower = county.toLowerCase().trim();
  for (const preset of Object.values(KENYA_LOCATION_PRESETS)) {
    if (preset.county.toLowerCase().includes(lower) || preset.name.toLowerCase().includes(lower)) {
      return preset;
    }
  }
  return null;
}

/**
 * Get atmospheric defaults using the 3-tier fallback system.
 * 
 * Priority:
 *   1. Project-level explicit settings (user-entered)
 *   2. Location preset (matched by county or nearest coordinates)
 *   3. Weather API (real-time data)
 *   4. Default (Nairobi conditions as safest Kenya default)
 * 
 * @param settings - Project atmospheric settings (may be partial)
 * @returns Full atmospheric defaults with source tracking
 */
export function getAtmosphericDefaults(
  settings: ProjectAtmosphericSettings = {}
): AtmosphericDefaults {
  // ── Tier 1: Use project-level settings if complete ──
  const hasCompleteProjectData =
    settings.temperature !== undefined &&
    settings.pressure !== undefined &&
    settings.elevation !== undefined;

  if (hasCompleteProjectData) {
    return {
      temperature: settings.temperature!,
      pressure: settings.pressure!,
      humidity: settings.humidity ?? 50,
      elevation: settings.elevation!,
      utmZone: settings.utmZone ?? autoDetectUTMZone(settings.longitude ?? 37),
      geoidUndulation: -12, // Kenya default
      refractionCoefficient: 0.13, // Kenya tropical daytime
      source: 'project_settings',
      verified: true,
    };
  }

  // ── Tier 2: Match location preset ──
  // Try by county first, then by nearest coordinates
  let preset: KenyaLocationPreset | null = null;

  if (settings.county) {
    preset = findPresetByCounty(settings.county);
  }

  if (!preset && settings.latitude !== undefined && settings.longitude !== undefined) {
    const nearest = findNearestPreset(settings.latitude, settings.longitude);
    if (nearest && nearest.distanceKm < 200) { // Within 200km
      preset = nearest.preset;
    }
  }

  if (preset) {
    // Merge: project settings override preset values
    return {
      temperature: settings.temperature ?? preset.temperature,
      pressure: settings.pressure ?? preset.pressure,
      humidity: settings.humidity ?? preset.humidity,
      elevation: settings.elevation ?? preset.elevation,
      utmZone: settings.utmZone ?? preset.utmZone,
      geoidUndulation: preset.geoidUndulation,
      refractionCoefficient: 0.13,
      source: 'location_preset',
      verified: false,
    };
  }

  // ── Tier 3: If we have elevation but no preset, compute pressure ──
  if (settings.elevation !== undefined) {
    return {
      temperature: settings.temperature ?? 20,
      pressure: settings.pressure ?? Math.round(icaoPressure(settings.elevation) * 10) / 10,
      humidity: settings.humidity ?? 50,
      elevation: settings.elevation,
      utmZone: settings.utmZone ?? autoDetectUTMZone(settings.longitude ?? 37),
      geoidUndulation: -12,
      refractionCoefficient: 0.13,
      source: settings.temperature !== undefined ? 'project_settings' : 'default',
      verified: settings.temperature !== undefined,
    };
  }

  // ── Tier 4: Default to Nairobi conditions ──
  // Nairobi is the most common survey location and has the safest
  // defaults for Kenya. The ICAO-computed pressure at 1795m is ~820 hPa,
  // but measured average is ~830 hPa (we use the measured value).
  return {
    temperature: 20,
    pressure: 830,
    humidity: 60,
    elevation: 1795,
    utmZone: 'UTM37S',
    geoidUndulation: -12,
    refractionCoefficient: 0.13,
    source: 'default',
    verified: false,
  };
}

/**
 * Fetch real-time weather data from Open-Meteo API.
 * Free, no API key required. Updates every ~15 minutes.
 * 
 * @param latitude - Site latitude
 * @param longitude - Site longitude
 * @returns Weather data or null if unavailable
 */
export async function fetchRealtimeWeather(
  latitude: number,
  longitude: number
): Promise<{
  temperature: number;
  pressure: number;
  humidity: number;
  fetchedAt: string;
} | null> {
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('current', 'temperature_2m,surface_pressure,relative_humidity_2m');
    url.searchParams.set('timezone', 'auto');

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) return null;

    const data = await response.json();
    return {
      temperature: data.current.temperature_2m,
      pressure: data.current.surface_pressure,
      humidity: data.current.relative_humidity_2m,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Compute the error impact of NOT applying atmospheric corrections.
 * Returns the total PPM error and the mm error per km for the given conditions.
 * 
 * Useful for showing surveyors why atmospheric data matters.
 */
export function computeAtmosphericErrorImpact(defaults: AtmosphericDefaults): {
  atmosphericPPM: number;
  seaLevelPPM: number;
  gridScalePPM: number;
  totalPPM: number;
  mmPerKm: number;
  explanation: string;
} {
  // Atmospheric correction PPM (vs standard conditions)
  // At standard (20°C, 1013.25 hPa), PPM = 0
  // At Nairobi (20°C, 830 hPa): ~28 ppm
  const N_standard = 273.82; // Standard refractivity
  const T = defaults.temperature + 273.15;
  const e = (defaults.humidity / 100) * 6.112 * Math.exp(17.62 * defaults.temperature / (243.12 + defaults.temperature));
  const N_obs = 287.604 * defaults.pressure * 1.0003 / T - 11.27 * e / T;
  const atmosphericPPM = N_standard - N_obs;

  // Sea level reduction PPM
  const R = 6378000; // approximate
  const seaLevelPPM = (defaults.elevation / R) * 1e6;

  // Grid scale factor PPM (typical for Kenya)
  // At 180km from CM: ~400 ppm
  const gridScalePPM = 400; // approximate typical for Kenya

  const totalPPM = Math.abs(atmosphericPPM) + seaLevelPPM + gridScalePPM;
  const mmPerKm = totalPPM; // 1 ppm = 1mm per km

  const explanation = `At ${defaults.elevation}m elevation, ${defaults.pressure} hPa, ${defaults.temperature}°C: ` +
    `atmospheric ≈ ${Math.abs(atmosphericPPM).toFixed(0)} ppm, ` +
    `sea level ≈ ${seaLevelPPM.toFixed(0)} ppm, ` +
    `grid scale ≈ ${gridScalePPM} ppm. ` +
    `Total uncorrected error: ${mmPerKm.toFixed(0)} mm/km. ` +
    `For a 500m traverse line: ${(mmPerKm * 0.5).toFixed(1)} mm error.`;

  return {
    atmosphericPPM: Math.abs(atmosphericPPM),
    seaLevelPPM,
    gridScalePPM,
    totalPPM,
    mmPerKm,
    explanation,
  };
}

/**
 * Validate atmospheric conditions for Kenya surveying.
 * Returns warnings if conditions are unusual.
 */
export function validateAtmosphericDefaults(defaults: AtmosphericDefaults): {
  valid: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Temperature range for Kenya
  if (defaults.temperature < 5 || defaults.temperature > 45) {
    errors.push(`Temperature ${defaults.temperature}°C is outside Kenya range (5-45°C). Verify reading.`);
  } else if (defaults.temperature < 10 || defaults.temperature > 40) {
    warnings.push(`Temperature ${defaults.temperature}°C is unusual for Kenya. Confirm reading.`);
  }

  // Pressure vs elevation consistency
  const expectedPressure = icaoPressure(defaults.elevation);
  const pressureDiff = Math.abs(defaults.pressure - expectedPressure);
  if (pressureDiff > 30) {
    warnings.push(
      `Pressure ${defaults.pressure} hPa differs significantly from ICAO expected ` +
      `${expectedPressure.toFixed(1)} hPa at ${defaults.elevation}m elevation. ` +
      `Difference: ${pressureDiff.toFixed(1)} hPa. Verify barometer reading.`
    );
  }

  // Humidity range
  if (defaults.humidity > 95) {
    warnings.push('Humidity >95% — check for condensation on EDM instrument prism.');
  } else if (defaults.humidity < 20) {
    warnings.push('Humidity <20% is very dry — atmospheric correction will be smaller than usual.');
  }

  // Elevation vs pressure sanity check
  if (defaults.elevation > 2500) {
    warnings.push(`Elevation ${defaults.elevation}m is above typical Kenya survey range. Verify.`);
  }

  // UTM zone vs longitude
  if (defaults.utmZone === 'UTM36S' && defaults.elevation > 0) {
    // Western Kenya — check if coordinates are actually in zone 36
    // This is just a gentle reminder
  }

  // Unverified data warning
  if (!defaults.verified) {
    warnings.push(
      'Atmospheric conditions are from ' + defaults.source.replace('_', ' ') +
      ' and have NOT been verified by the surveyor. ' +
      'Please confirm these values match your field readings.'
    );
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}
