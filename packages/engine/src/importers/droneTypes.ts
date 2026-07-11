export interface ParsedSurveyData {
  points: Array<{
    easting: number;
    northing: number;
    rl: number;
    code?: string;
    description?: string;
    station?: string;
    timestamp?: Date;
  }>;
  metadata: {
    source: string;
    format: string;
    crs?: string;
    totalPoints: number;
    droneSpecific?: {
      flightDate?: string;
      gcpCount?: number;
      averageError?: number;
      hasRgb?: boolean;
      hasGpsTime?: boolean;
      pointDataFormat?: number;
      gcpSet?: { id: string; x: number; y: number; z: number }[];
      recordLength?: number;
    };
  };
}

export type ParserFunction = (file: File) => Promise<ParsedSurveyData>;

export const DRONE_EXTENSIONS = ['.las', '.laz', '.csv', '.xml'] as const;
