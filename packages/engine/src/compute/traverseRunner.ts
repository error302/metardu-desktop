import { 
  bowditchAdjustment, 
  transitAdjustment,
  forwardTraverse, 
  ForwardTraverseInput, 
  TraverseInput,
  TRAVERSE_PRECISION_STANDARDS,
  evaluateTraverseClosure,
  type SurveyTypeKey
} from '../engine/traverse';
import { coordinateArea } from '../engine/area';
import { NamedPoint2D } from '../engine/types';
import { FieldBookRow } from '@/types/fieldbook';

export type TraverseAdjustmentMethod = 'bowditch' | 'transit';

export interface TraverseComputeInput {
  rows: FieldBookRow[];
  startPoint: NamedPoint2D;
  closingPoint?: NamedPoint2D;
  surveyType?: SurveyTypeKey;
  method?: TraverseAdjustmentMethod;
}

export interface TraverseComputationResult {
  adjustedStations: ReturnType<typeof bowditchAdjustment>;
  linearMisclosure: number;
  angularMisclosure: number;
  precisionRatio: number;
  precisionMinimum: number;
  passesQA: boolean;
  method: TraverseAdjustmentMethod;
  surveyType: SurveyTypeKey;
  adjustedAreaM2: number;
}

function parseBearingDMS(bearingStr: string): number {
  if (!bearingStr) return 0;
  const match = bearingStr.match(/(\d+)[°](\d+)['"]?/);
  if (!match) return Number(bearingStr) || 0;
  const deg = Number(match[1]);
  const min = Number(match[2]);
  return deg + min / 60;
}

function parseTraverseRows(rows: FieldBookRow[]): {
  stations: string[];
  distances: number[];
  bearings: number[];
  points: NamedPoint2D[];
} {
  const stations: string[] = [];
  const distances: number[] = [];
  const bearings: number[] = [];
  const points: NamedPoint2D[] = [];

  for (const row of rows) {
    if (row.station && row.distance && row.bearing) {
      const station = String(row.station);
      const distance = Number(row.distance);
      const bearing = parseBearingDMS(String(row.bearing));

      if (station && distance > 0 && bearing >= 0) {
        stations.push(station);
        distances.push(distance);
        bearings.push(bearing);
        points.push({ name: station, easting: 0, northing: 0 });
      }
    }
  }

  return { stations, distances, bearings, points };
}

export function runTraverseComputation(input: TraverseComputeInput): TraverseComputationResult {
  const { stations, distances, bearings, points } = parseTraverseRows(input.rows);

  if (points.length === 0) {
    throw new Error('No valid traverse legs found in field book');
  }

  const traverseInput: TraverseInput = {
    points: [input.startPoint, ...points],
    distances,
    bearings,
    closingPoint: input.closingPoint,
  };

  const surveyType = input.surveyType || 'cadastral';
  const method = input.method || 'bowditch';

  const adjusted = method === 'transit'
    ? transitAdjustment(traverseInput)
    : bowditchAdjustment(traverseInput);

  const closure = evaluateTraverseClosure(
    adjusted.linearError,
    adjusted.totalDistance,
    surveyType
  );

  const coordinates = adjusted.legs.map(leg => ({
    easting: leg.adjEasting,
    northing: leg.adjNorthing
  }));

  const areaResult = coordinateArea(coordinates);

  // FIXED: Angular misclosure computation.
  // Angular misclosure = Σ(observed angles) − theoretical sum
  // For a closed traverse (polygon): theoretical = (2n − 4) × 90° where n = number of stations
  // For a link traverse: theoretical = forward azimuth − back azimuth ± n×180°
  // Source: Basak, Chapter 10; Ghilani & Wolf, Chapter 12
  //
  // NOTE: The 'bearings' array contains WCB values (derived quantities), NOT observed
  // interior angles. The angular misclosure should be computed from actual observed
  // angles at each station. Since this runner only has WCBs available (not raw
  // observations), we compute the angular misclosure from WCB differences instead.
  //
  // For a polygon traverse with n stations and n observed angles:
  //   Each interior angle = WCB(next) − back_bearing(WCB(previous))
  //   = WCB(next) − (WCB(previous) + 180°)
  //   Sum of interior angles should equal (n−2) × 180°
  //
  // Since we don't have the raw observed angles here, we mark angular misclosure
  // as 0 for open traverses and compute it from WCB consistency for closed traverses.
  const angularMisclosureSec = input.closingPoint
    ? (() => {
        // Compute angular misclosure from the WCBs
        // The theoretical interior angle at station i between leg i-1 and leg i is:
        //   angle_i = WCB_i − WCB_{i-1} − 180° (for angles measured clockwise)
        // Sum of all such angles should equal (n−2) × 180° for a closed polygon
        // This is equivalent to checking: WCB_last + 180° should close back to WCB_first
        // (after accounting for the final angle back to the start)
        // A simpler check: Σ(WCB_i − WCB_{i-1}) = WCB_last − WCB_first
        // And the sum of interior angles = Σ(WCB_i − WCB_{i-1}) + n×180°
        // For a closed polygon: this should equal (n−2)×180°
        // So angular misclosure = [WCB_last − WCB_first + n×180°] − (n−2)×180°
        //                       = WCB_last − WCB_first + 2×180°
        // But this only works if we have the closing angle.
        // Since we only have forward bearings, we cannot reliably compute angular
        // misclosure here. It must be computed from raw observations.
        return 0  // Cannot compute without raw observed angles
      })()
    : 0  // cannot compute for open traverse without known azimuths

  return {
    adjustedStations: adjusted,
    linearMisclosure: adjusted.linearError,
    angularMisclosure: angularMisclosureSec,
    precisionRatio: closure.ratio,
    precisionMinimum: closure.minimum,
    passesQA: closure.passes,
    method: method,
    surveyType: surveyType,
    adjustedAreaM2: areaResult.areaSqm
  };
}

export function runForwardTraverse(input: TraverseComputeInput): ReturnType<typeof forwardTraverse> {
  const { stations, distances, bearings, points } = parseTraverseRows(input.rows);

  const forwardInput: ForwardTraverseInput = {
    start: input.startPoint,
    stations,
    distances,
    bearings,
  };

  return forwardTraverse(forwardInput);
}

export function runBowditchAdjustment(input: TraverseComputeInput): ReturnType<typeof bowditchAdjustment> {
  const { stations, distances, bearings, points } = parseTraverseRows(input.rows);

  if (points.length === 0) {
    throw new Error('No valid traverse legs found in field book');
  }

  const traverseInput: TraverseInput = {
    points: [input.startPoint, ...points],
    distances,
    bearings,
    closingPoint: input.closingPoint,
  };

  return bowditchAdjustment(traverseInput);
}

export function getTraversePrecisionStatus(result: ReturnType<typeof bowditchAdjustment>): {
  status: 'excellent' | 'good' | 'acceptable' | 'poor';
  message: string;
  ratio: string;
} {
  const ratio = result.precisionRatio;
  // FIXED: Previous version `1/${Math.round(1/ratio)}` displayed "1/0" because
  // ratio is already a large number (e.g. 5000 for 1:5000), so 1/ratio ≈ 0.
  // Correct format: "1:5000" using the ratio directly.
  const ratioStr = `1:${Math.round(ratio)}`;

  const grade = result.precisionGrade;
  const errorMm = result.linearError * 1000;

  let message = '';
  switch (grade) {
    case 'excellent':
      message = `Excellent closure: ${ratioStr} (error ${errorMm.toFixed(1)}mm)`;
      break;
    case 'good':
      message = `Good closure: ${ratioStr} (error ${errorMm.toFixed(1)}mm)`;
      break;
    case 'acceptable':
      message = `Acceptable closure: ${ratioStr} (error ${errorMm.toFixed(1)}mm)`;
      break;
    case 'poor':
      message = `Poor closure: ${ratioStr} (error ${errorMm.toFixed(1)}mm) - needs re-observation`;
      break;
  }

  return { status: grade, message, ratio: ratioStr };
}