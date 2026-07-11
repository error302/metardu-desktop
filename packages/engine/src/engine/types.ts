// METARDU Engine - Type definitions
import type { SurveyTypeKey } from './traverse';

export interface Point2D {
  easting: number;
  northing: number;
}

export interface Point3D extends Point2D {
  elevation: number;
}

export interface NamedPoint2D extends Point2D {
  name: string;
}

export interface NamedPoint3D extends NamedPoint2D {
  elevation: number;
}

export interface LatLon {
  lat: number;
  lon: number;
}

export interface UTMCoord {
  easting: number;
  northing: number;
  zone: number;
  hemisphere: 'N' | 'S';
}

export interface DMS {
  degrees: number;
  minutes: number;
  seconds: number;
  direction: 'N' | 'S' | 'E' | 'W';
}

export type SurveyResult<T> = 
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface DistanceBearingResult {
  distance: number;
  bearing: number;
  bearingDMS: string;
  backBearing: number;
  backBearingDMS: string;
  quadrant: string;
  deltaE: number;
  deltaN: number;
}

export interface TraverseLeg {
  from: string;
  to: string;
  distance: number;
  bearing: number;
  bearingDMS: string;
  rawDeltaE: number;
  rawDeltaN: number;
  correctionE: number;
  correctionN: number;
  adjDeltaE: number;
  adjDeltaN: number;
  adjEasting: number;
  adjNorthing: number;
}

export interface TraverseResult {
  legs: TraverseLeg[];
  closingErrorE: number;
  closingErrorN: number;
  linearError: number;
  precisionRatio: number;
  precisionGrade: 'excellent' | 'good' | 'acceptable' | 'poor';
  totalDistance: number;
  isClosed: boolean;
  surveyType?: SurveyTypeKey;
  passesQA?: boolean;
}

export interface LevelingReading {
  station: string;
  bs?: number;
  is?: number;
  fs?: number;
  rise?: number;
  fall?: number;
  reducedLevel?: number;
  adjustedRL?: number;
}

export interface LevelingResult {
  readings: LevelingReading[];
  misclosure: number;
  arithmeticCheck: boolean;
  allowableMisclosure: number;
  isAcceptable: boolean;
  method: 'rise_and_fall' | 'height_of_collimation';
}

export interface AreaResult {
  areaSqm: number;
  areaHa: number;
  areaAcres: number;
  perimeter: number;
  centroid: Point2D;
  method: string;
}

export interface CurveElements {
  radius: number;
  deflectionAngle: number;
  tangentLength: number;
  arcLength: number;
  longChord: number;
  externalDistance: number;
  midOrdinate: number;
  degreeOfCurve: number;
}

export interface CurveStakeoutPoint {
  chainage: number;
  deflectionAngle: string;
  totalDeflection: string;
  chordLength: number;
}

export interface CurveStakeoutResult {
  elements: CurveElements;
  points: CurveStakeoutPoint[];
  pcChainage: number;
  piChainage: number;
  ptChainage: number;
}

export interface COGOIntersection {
  point: Point2D;
  distanceFromA: number;
  distanceFromB: number;
}

export interface COGORadiation {
  point: Point2D;
  distance: number;
  bearing: number;
}

export interface COOResection {
  point: Point2D;
  distanceToP1: number;
  distanceToP2: number;
  distanceToP3: number;
}
