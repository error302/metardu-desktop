/**
 * METARDU Canonical Precision Policy
 * 
 * Defines the exact precision for every value type in the system.
 * These are OUTPUT/DISPLAY precision rules — computation always uses full
 * IEEE 754 double precision. Rounding happens ONLY at the display/export layer.
 *
 * Source: Kenya Survey Regulations 1994, Cap 299
 * Source: RDM 1.1 Kenya 2025, Table 2.4
 * Source: Ghilani & Wolf, Elementary Surveying 16th Ed.
 */

export const PRECISION_POLICY = {
  /** Coordinates: 3 decimal places = 1mm (UTM metres) */
  coordinates: { decimals: 3, unit: 'm', description: 'Easting/Northing to 1mm' },
  
  /** Areas: 4 decimal places for sq metres, 6 for hectares */
  area_sqm: { decimals: 4, unit: 'm²', description: 'Area in square metres to 0.0001 m²' },
  area_ha: { decimals: 6, unit: 'ha', description: 'Area in hectares to 0.000001 ha' },
  area_acres: { decimals: 4, unit: 'ac', description: 'Area in acres to 0.0001 ac' },
  
  /** Distances: 3 decimal places = 1mm */
  distance: { decimals: 3, unit: 'm', description: 'Distance to 1mm' },
  
  /** Bearings: whole seconds of arc (1 decimal place in seconds) */
  bearing: { dms: true, secondsDecimals: 1, description: 'Bearings to 0.1 arcsecond' },
  
  /** Elevations/RL: 3 decimal places = 1mm */
  elevation: { decimals: 3, unit: 'm', description: 'Reduced level to 1mm' },
  
  /** Slope distances: 3 decimal places = 1mm */
  slope_distance: { decimals: 3, unit: 'm', description: 'Slope distance to 1mm' },
  
  /** Horizontal distances: 3 decimal places = 1mm */
  horizontal_distance: { decimals: 3, unit: 'm', description: 'Horizontal distance to 1mm' },
  
  /** Misclosure: 3 decimal places = 1mm */
  misclosure: { decimals: 3, unit: 'm', description: 'Misclosure to 1mm' },
  
  /** Precision ratios: displayed as 1:N, N is integer */
  precision_ratio: { asRatio: true, description: 'Precision ratio as 1:N (integer N)' },
} as const;

export type PrecisionKey = keyof typeof PRECISION_POLICY;

/** Apply canonical precision for display — rounds at output layer only */
export function formatCoordinate(value: number): string {
  return value.toFixed(PRECISION_POLICY.coordinates.decimals);
}

export function formatAreaSqm(value: number): string {
  return value.toFixed(PRECISION_POLICY.area_sqm.decimals);
}

export function formatAreaHa(value: number): string {
  return value.toFixed(PRECISION_POLICY.area_ha.decimals);
}

export function formatDistance(value: number): string {
  return value.toFixed(PRECISION_POLICY.distance.decimals);
}

export function formatElevation(value: number): string {
  return value.toFixed(PRECISION_POLICY.elevation.decimals);
}

export function formatMisclosure(value: number): string {
  return value.toFixed(PRECISION_POLICY.misclosure.decimals);
}

export function formatPrecisionRatio(perimeter: number, linearMisclosure: number): string {
  if (linearMisclosure <= 0) return '1 : ∞';
  const ratio = Math.round(perimeter / linearMisclosure);
  return `1 : ${ratio.toLocaleString()}`;
}
