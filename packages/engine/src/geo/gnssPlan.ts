export interface GNSSPlanInput {
  lat: number;
  lng: number;
  baselineLengthKm: number;
  requiredAccuracyMm: number;
  receivers: number;
}

export interface GNSSRecommendation {
  minOccupationMinutes: number;
  recommendedMethod: 'RTK' | 'FastStatic' | 'Static';
  notes: string[];
  cutoffElevationDeg: number;
}

export function planGNSSSession(input: GNSSPlanInput): GNSSRecommendation {
  const { baselineLengthKm, requiredAccuracyMm, receivers } = input;
  const notes: string[] = [];
  let minOccupationMinutes: number;
  let recommendedMethod: 'RTK' | 'FastStatic' | 'Static';

  if (baselineLengthKm <= 10 && requiredAccuracyMm >= 20) {
    recommendedMethod = 'RTK';
    minOccupationMinutes = 5;
    notes.push('RTK suitable for this baseline and accuracy requirement.');
    notes.push('Ensure at least 5 satellites above 15° elevation.');
  } else if (baselineLengthKm <= 30 && requiredAccuracyMm >= 5) {
    recommendedMethod = 'FastStatic';
    minOccupationMinutes = 20;
    notes.push('Fast-static recommended. Use dual-frequency receiver if available.');
  } else {
    recommendedMethod = 'Static';
    minOccupationMinutes = Math.max(60, Math.round(baselineLengthKm * 2));
    notes.push(`Static GNSS required. Minimum ${minOccupationMinutes} min occupation.`);
    if (baselineLengthKm > 100) {
      notes.push('Very long baseline — process with IGS precise ephemerides post-mission.');
    }
  }

  if (receivers < 2) {
    notes.push('Only 1 receiver available — tie to nearest CORS station instead of rover/base setup.');
  }

  return {
    minOccupationMinutes,
    recommendedMethod,
    notes,
    cutoffElevationDeg: 15,
  };
}
