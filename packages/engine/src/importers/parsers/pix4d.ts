import { ParsedSurveyData } from '../droneTypes';

export async function parsePix4dCsv(file: File): Promise<ParsedSurveyData> {
  const text = await file.text();
  const rows = text.trim().split('\n').filter((row: any) => !row.startsWith('#') && row.trim());

  const points: ParsedSurveyData['points'] = rows.map((row: any) => {
    const cols = row.split(',').map((c: any) => c.trim());
    return {
      easting: parseFloat(cols[0]) || 0,
      northing: parseFloat(cols[1]) || 0,
      rl: parseFloat(cols[2]) || 0,
      code: cols[3] || 'GCP',
      description: cols[4] || '',
    };
  }).filter((p: any) => p.easting !== 0 || p.northing !== 0);

  return {
    points,
    metadata: {
      source: 'Pix4D CSV',
      format: 'CSV',
      totalPoints: points.length,
      droneSpecific: {
        gcpCount: points.length,
      },
    },
  };
}

export async function parsePix4dXml(file: File): Promise<ParsedSurveyData> {
  const text = await file.text();
  
  const gcpMatches = text.match(/<GCP[^>]*>(.*?)<\/GCP>/g) || [];
  
  const points: ParsedSurveyData['points'] = gcpMatches.map((match, i) => {
    const eastingMatch = match.match(/x[^0-9.-]*([-0-9.]+)/);
    const northingMatch = match.match(/y[^0-9.-]*([-0-9.]+)/);
    const zMatch = match.match(/z[^0-9.-]*([-0-9.]+)/);
    
    return {
      easting: parseFloat(eastingMatch?.[1] || '0'),
      northing: parseFloat(northingMatch?.[1] || '0'),
      rl: parseFloat(zMatch?.[1] || '0'),
      code: 'GCP',
      station: `GCP${i + 1}`,
    };
  });

  const errorMatch = text.match(/averageError[^0-9.-]*([-0-9.]+)/);
  const averageError = errorMatch ? parseFloat(errorMatch[1]) : undefined;

  return {
    points,
    metadata: {
      source: 'Pix4D Report',
      format: 'XML',
      totalPoints: points.length,
      droneSpecific: {
        averageError,
        gcpCount: points.length,
      },
    },
  };
}
