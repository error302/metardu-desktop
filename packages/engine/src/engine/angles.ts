/**
 * Calculation standard: N.N. Basak — Surveying and Levelling
 * - No intermediate rounding
 * - Full floating point precision throughout
 * - Round only at final display layer
 * - Bearings: WCB 0-360° clockwise from North
 */

// METARDU Engine - Angle calculations

import { DMS } from './types';

export function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

export function toDegrees(radians: number): number {
  return radians * (180 / Math.PI);
}

export function normalizeBearing(bearing: number): number {
  let normalized = bearing % 360;
  if (normalized < 0) normalized += 360;
  return normalized;
}

export function decimalToDMS(decimal: number, isLatitude: boolean): DMS {
  const isNegative = decimal < 0;
  const absDecimal = Math.abs(decimal);
  const degrees = Math.floor(absDecimal);
  const minutesFloat = (absDecimal - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = (minutesFloat - minutes) * 60;
  
  let direction: DMS['direction'];
  if (isLatitude) {
    direction = isNegative ? 'S' : 'N';
  } else {
    direction = isNegative ? 'W' : 'E';
  }
  
  return {
    degrees,
    minutes,
    seconds: Math.round(seconds * 1000) / 1000,
    direction
  };
}

export function dmsToDecimal(dms: DMS): number {
  let decimal = dms.degrees + dms.minutes / 60 + dms.seconds / 3600;
  if (dms.direction === 'S' || dms.direction === 'W') {
    decimal = -decimal;
  }
  return decimal;
}

export function bearingToString(bearing: number): string {
  const normalized = normalizeBearing(bearing);
  const dms = decimalToDMS(normalized, false);
  return `${String(dms.degrees).padStart(3, '0')}° ${String(dms.minutes).padStart(2, '0')}' ${dms.seconds.toFixed(3)}"`;
}

export function parseDMSString(input: string): number | null {
  // Handle formats: 45°30'22.5", 45 30 22.5, 45.5, N45°30'E
  const cleaned = input.replace(/[°'"]/g, ' ').trim().replace(/\s+/g, ' ');
  const parts = cleaned.split(' ');
  
  if (parts.length === 1) {
    // Just decimal degrees
    const num = parseFloat(parts[0]);
    if (isNaN(num)) return null;
    return Math.abs(num);
  }
  
  if (parts.length >= 3) {
    const degrees = parseFloat(parts[0]);
    const minutes = parseFloat(parts[1]);
    const seconds = parseFloat(parts[2]);
    
    if (isNaN(degrees) || isNaN(minutes) || isNaN(seconds)) return null;
    
    let decimal = degrees + minutes / 60 + seconds / 3600;
    
    // Check for direction
    const lastChar = input.trim().slice(-1).toUpperCase();
    if (lastChar === 'S' || lastChar === 'W') {
      decimal = -decimal;
    }
    
    return decimal;
  }
  
  return null;
}

export function wcbToQuadrant(bearing: number): string {
  const normalized = normalizeBearing(bearing);
  const dms = decimalToDMS(normalized, false);
  
  let quadrant: string;
  let direction: string;
  
  if (normalized >= 0 && normalized < 90) {
    quadrant = 'N';
    direction = 'E';
  } else if (normalized >= 90 && normalized < 180) {
    quadrant = 'S';
    direction = 'E';
  } else if (normalized >= 180 && normalized < 270) {
    quadrant = 'S';
    direction = 'W';
  } else {
    quadrant = 'N';
    direction = 'W';
  }
  
  return `${quadrant} ${dms.degrees}° ${dms.minutes}' ${dms.seconds.toFixed(3)}" ${direction}`;
}

export function backBearing(forwardBearing: number): number {
  return normalizeBearing(forwardBearing + 180);
}

export function angularMisclosure(observedSum: number, numStations: number): {
  misclosure: number;
  correctionPerStation: number;
} {
  const theoreticalSum = (numStations - 2) * 180;
  const misclosure = observedSum - theoreticalSum;
  const correctionPerStation = -misclosure / numStations;
  
  return { misclosure, correctionPerStation };
}

/**
 * Parse DDD.MMSS format (the field convention for angular input in East African surveying).
 * In this format: 47.2314 means 47° 23' 14" (degrees.minutesseconds)
 * 47.3 means 47° 30' 00" (only minutes, no seconds)
 * Source: Kenya Survey Regulations 1994 — field book convention
 * Source: RDM 1.1 Kenya — angular data entry format
 */
export function parseFieldAngle(input: string | number): number | null {
  if (typeof input === 'number') {
    // If already a decimal degrees value > 360, it's probably not DDD.MMSS
    if (input > 360) return null;
    // Check if it looks like DDD.MMSS (has a decimal point with 4+ digits after)
    const str = input.toString();
    const dotIdx = str.indexOf('.');
    if (dotIdx >= 0 && str.length - dotIdx - 1 <= 4) {
      // Could be DDD.MMSS format — parse it
      return dmsToDecimalFromField(input);
    }
    // Otherwise treat as decimal degrees
    return input;
  }
  
  // String input
  const trimmed = input.trim();
  
  // Try DMS format first: 47°23'14" or 47 23 14
  const dmsResult = parseDMSString(trimmed);
  if (dmsResult !== null) return dmsResult;
  
  // Try DDD.MMSS format: 47.2314
  const num = parseFloat(trimmed);
  if (isNaN(num)) return null;
  
  return dmsToDecimalFromField(num);
}

function dmsToDecimalFromField(dmsValue: number): number {
  const isNegative = dmsValue < 0;
  const absVal = Math.abs(dmsValue);
  
  const degrees = Math.floor(absVal);
  const frac = absVal - degrees;
  
  // The fractional part encodes minutes and seconds
  // 0.2314 → minutes = 23, seconds = 14
  // 0.3 → minutes = 30, seconds = 0
  // 0.0230 → minutes = 2, seconds = 30
  const fracStr = frac.toFixed(4).slice(2); // Get 4 decimal digits as string
  const paddedStr = fracStr.padEnd(4, '0'); // Ensure 4 digits
  
  const minutes = parseInt(paddedStr.slice(0, 2), 10);
  const seconds = parseInt(paddedStr.slice(2, 4), 10);
  
  let result = degrees + minutes / 60 + seconds / 3600;
  if (isNegative) result = -result;
  
  return result;
}
