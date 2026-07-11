import { ParsedSurveyData } from './droneTypes';

export interface NormalizedSurveyData {
  observations: Array<{
    id: string;
    easting: number;
    northing: number;
    rl: number;
    code: string;
    description?: string;
  }>;
  metadata: ParsedSurveyData['metadata'];
}

export function normalizeToEngine(data: ParsedSurveyData): NormalizedSurveyData {
  return {
    observations: data.points.map((p, i) => ({
      id: `obs-${i + 1}`,
      easting: p.easting,
      northing: p.northing,
      rl: p.rl,
      code: p.code || 'UNKNOWN',
      description: p.description,
    })),
    metadata: data.metadata,
  };
}
