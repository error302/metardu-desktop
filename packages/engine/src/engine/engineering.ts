/**
 * engineering.ts
 * Shared computation engine for all Metardu engineering survey sub-types.
 * Road, Bridge, Dam, Pipeline, Railway, Building, Tunnel.
 * All coordinates in SRID 21037 (Arc 1960 / UTM Zone 37S).
 */

export const ENGINEERING_SUBTYPES = [
  'road',
  'bridge',
  'dam',
  'pipeline',
  'railway',
  'building',
  'tunnel',
] as const;

export type EngineeringSubtype = typeof ENGINEERING_SUBTYPES[number];

export const ENGINEERING_SUBTYPE_LABELS: Record<EngineeringSubtype, string> = {
  road:     'Road Survey',
  bridge:   'Bridge Survey',
  dam:      'Dam / Reservoir Survey',
  pipeline: 'Pipeline Survey',
  railway:  'Railway Survey',
  building: 'Building Survey',
  tunnel:   'Tunnel Survey',
};

export interface AlignmentPoint {
  chainage: number;
  easting: number;
  northing: number;
  elevation?: number;
  label?: string;
}

export interface HorizontalCurve {
  piChainage: number;
  radius: number;
  delta: number;
  tangentLength: number;
  curveLength: number;
  externalDistance: number;
  midOrdinate: number;
  longChord: number;
  pcChainage: number;
  ptChainage: number;
}

export interface VerticalCurve {
  pvIChainage: number;
  pvIElevation: number;
  length: number;
  gradeIn: number;
  gradeOut: number;
  highLowPoint?: { chainage: number; elevation: number };
}

export interface CrossSection {
  chainage: number;
  naturalLevels: Array<{ offset: number; elevation: number }>;
  designLevel: number;
  cutFillArea?: number;
}

export function computeHorizontalCurve(
  radius: number,
  delta: number,
  piChainage: number
): HorizontalCurve {
  const deltaRad = (delta * Math.PI) / 180;
  const tangentLength = radius * Math.tan(deltaRad / 2);
  const curveLength = radius * deltaRad;
  const externalDistance = radius * (1 / Math.cos(deltaRad / 2) - 1);
  const midOrdinate = radius * (1 - Math.cos(deltaRad / 2));
  const longChord = 2 * radius * Math.sin(deltaRad / 2);
  const pcChainage = piChainage - tangentLength;
  const ptChainage = pcChainage + curveLength;

  return {
    piChainage,
    radius,
    delta,
    tangentLength,
    curveLength,
    externalDistance,
    midOrdinate,
    longChord,
    pcChainage,
    ptChainage,
  };
}

export function computeVerticalCurve(
  pvIChainage: number,
  pvIElevation: number,
  gradeIn: number,
  gradeOut: number,
  length: number
): VerticalCurve {
  const r = (gradeOut - gradeIn) / length;

  const pvcChainage = pvIChainage - length / 2;
  const pvcElevation = pvIElevation - (gradeIn * length / 200);

  let highLowPoint: { chainage: number; elevation: number } | undefined;
  const distToHL = -gradeIn / r;

  if (distToHL > 0 && distToHL < length) {
    const hlChainage = pvcChainage + distToHL;
    const hlElevation = pvcElevation + (gradeIn * distToHL / 100) + (r * distToHL * distToHL / 2);
    highLowPoint = { chainage: hlChainage, elevation: hlElevation };
  }

  return { pvIChainage, pvIElevation, length, gradeIn, gradeOut, highLowPoint };
}

export function verticalCurveElevation(
  vc: VerticalCurve,
  chainage: number
): number {
  const pvcChainage = vc.pvIChainage - vc.length / 2;
  const pvcElevation = vc.pvIElevation - (vc.gradeIn * vc.length / 200);
  const x = chainage - pvcChainage;

  if (x < 0 || x > vc.length) {
    return x < 0
      ? pvcElevation + (vc.gradeIn * x / 100)
      : pvcElevation + (vc.gradeIn * vc.length / 100) + (vc.gradeOut * (x - vc.length) / 100);
  }

  const r = (vc.gradeOut - vc.gradeIn) / vc.length;
  return pvcElevation + (vc.gradeIn * x / 100) + (r * x * x / 2);
}

/**
 * Compute cut/fill areas for a cross-section using trapezoidal integration.
 *
 * AUDIT FIX (2026-07-03): The old implementation was:
 *   `fillArea += Math.abs(diff) * sideSlopeH`  per point
 * which is dimensionally wrong (it multiplies a height by a ratio —
 * not an area) and produces meaningless results.
 *
 * The correct approach: the design (formation) is a horizontal line at
 * `designElevation`. The natural ground is a polyline through
 * `naturalLevels` (sorted by offset). We compute the area between these
 * two lines using the trapezoidal rule:
 *
 *   For each segment [i, i+1]:
 *     diff1 = designElevation - ground[i].elevation
 *     diff2 = designElevation - ground[i+1].elevation
 *     width = |ground[i+1].offset - ground[i].offset|
 *
 *     If both diffs > 0 (fill):  fillArea += (diff1 + diff2) / 2 * width
 *     If both diffs < 0 (cut):   cutArea  += (|diff1| + |diff2|) / 2 * width
 *     If different signs:        find the zero-crossing offset, split
 *                                into a cut triangle and a fill triangle
 *
 * The `sideSlopeH` parameter is no longer used in the calculation —
 * it was a misapplication. Side slopes are already accounted for in
 * the ground levels if the surveyor shot the full cross-section from
 * left slope stake to right slope stake. The parameter is kept in the
 * signature for backward compatibility but is ignored.
 */
export function crossSectionCutFill(
  designElevation: number,
  naturalLevels: Array<{ offset: number; elevation: number }>,
  _sideSlopeH: number = 1.5
): { cutArea: number; fillArea: number } {
  let cutArea = 0;
  let fillArea = 0;

  if (naturalLevels.length < 2) return { cutArea, fillArea };

  // Sort by offset to ensure left-to-right processing
  const sorted = [...naturalLevels].sort((a, b) => a.offset - b.offset);

  for (let i = 0; i < sorted.length - 1; i++) {
    const p1 = sorted[i];
    const p2 = sorted[i + 1];
    const width = Math.abs(p2.offset - p1.offset);
    if (width < 1e-10) continue;

    const diff1 = designElevation - p1.elevation;  // + = fill, - = cut
    const diff2 = designElevation - p2.elevation;

    if (diff1 >= 0 && diff2 >= 0) {
      // Both fill
      fillArea += (diff1 + diff2) / 2 * width;
    } else if (diff1 <= 0 && diff2 <= 0) {
      // Both cut
      cutArea += (Math.abs(diff1) + Math.abs(diff2)) / 2 * width;
    } else {
      // Mixed — find the zero-crossing point
      // Linear interpolation: at what fraction t does diff = 0?
      // diff(t) = diff1 + t * (diff2 - diff1) = 0
      // t = -diff1 / (diff2 - diff1)
      const t = -diff1 / (diff2 - diff1);
      const crossingWidth = t * width;

      if (diff1 > 0) {
        // p1 is fill, p2 is cut → fill triangle then cut triangle
        fillArea += (diff1 * crossingWidth) / 2;
        cutArea += (Math.abs(diff2) * (width - crossingWidth)) / 2;
      } else {
        // p1 is cut, p2 is fill → cut triangle then fill triangle
        cutArea += (Math.abs(diff1) * crossingWidth) / 2;
        fillArea += (diff2 * (width - crossingWidth)) / 2;
      }
    }
  }

  return { cutArea, fillArea };
}

/**
 * Compute volume between two cross-sections using the average-end-area method.
 *
 * AUDIT FIX (2026-07-03): This function was named `prismoidalVolume` but
 * actually computed the end-area formula `V = (A1 + A2) / 2 * L`. The
 * prismoidal formula is `V = L/6 * (A1 + 4*Am + A2)` where Am is the
 * area at the midpoint — which requires a middle cross-section that
 * callers don't have.
 *
 * Renamed to `endAreaVolume` (honest naming). The old name `prismoidalVolume`
 * is kept as a deprecated alias for backward compatibility — it calls
 * `endAreaVolume` under the hood. Callers should migrate to `endAreaVolume`.
 *
 * For a true prismoidal volume, use `prismoidalVolumeFromMidSection`.
 */
export function endAreaVolume(
  area1: number,
  area2: number,
  distance: number
): number {
  return ((area1 + area2) / 2) * distance;
}

/**
 * True prismoidal volume: V = L/6 * (A1 + 4*Am + A2)
 * Requires the middle cross-section area (Am).
 */
export function prismoidalVolumeFromMidSection(
  area1: number,
  middleArea: number,
  area2: number,
  distance: number
): number {
  return (distance / 6) * (area1 + 4 * middleArea + area2);
}

/**
 * @deprecated Use `endAreaVolume` instead. This function computes the
 * end-area volume, not the prismoidal volume. Kept for backward compat.
 */
export function prismoidalVolume(
  area1: number,
  area2: number,
  distance: number
): number {
  return endAreaVolume(area1, area2, distance);
}

export function curveStakeoutPoint(
  pcEasting: number,
  pcNorthing: number,
  initialBearing: number,
  radius: number,
  chainage: number,
  direction: 'left' | 'right' = 'right'
): { easting: number; northing: number; bearing: number } {
  const angleRad = chainage / radius;
  const angleDeg = angleRad * 180 / Math.PI;
  const deflection = direction === 'right' ? angleDeg : -angleDeg;
  const chordBearing = ((initialBearing + deflection / 2) + 360) % 360;
  const chord = 2 * radius * Math.sin(angleRad / 2);
  const bearingRad = chordBearing * Math.PI / 180;

  return {
    easting: pcEasting + chord * Math.sin(bearingRad),
    northing: pcNorthing + chord * Math.cos(bearingRad),
    bearing: ((initialBearing + deflection) + 360) % 360,
  };
}

export interface EngineeringQAStandards {
  traversePrecision: number;
  levellingClosureMM: string;
  angularClosureSec: string;
  horizontalClosureMM: number;
}

export const ENGINEERING_QA: Record<EngineeringSubtype, EngineeringQAStandards> = {
  road:     { traversePrecision: 3000, levellingClosureMM: '10√K', angularClosureSec: '60√n', horizontalClosureMM: 50 },
  bridge:   { traversePrecision: 5000, levellingClosureMM: '10√K', angularClosureSec: '60√n', horizontalClosureMM: 20 },
  dam:      { traversePrecision: 5000, levellingClosureMM: '10√K', angularClosureSec: '60√n', horizontalClosureMM: 20 },
  pipeline: { traversePrecision: 3000, levellingClosureMM: '10√K', angularClosureSec: '60√n', horizontalClosureMM: 50 },
  railway:  { traversePrecision: 5000, levellingClosureMM: '10√K', angularClosureSec: '60√n', horizontalClosureMM: 20 },
  building: { traversePrecision: 5000, levellingClosureMM: '10√K', angularClosureSec: '60√n', horizontalClosureMM: 10 },
  tunnel:   { traversePrecision: 10000, levellingClosureMM: '10√K', angularClosureSec: '60√n', horizontalClosureMM: 5 },
};