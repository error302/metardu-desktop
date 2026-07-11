import { ParsedSurveyData } from '../droneTypes';

export async function parsePly(file: File): Promise<ParsedSurveyData> {
  const text = await file.text();
  const lines = text.trim().split('\n');

  let headerEnd = 0;
  let vertexCount = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('element vertex')) {
      vertexCount = parseInt(lines[i].split(' ')[2], 10);
    }
    if (lines[i].trim() === 'end_header') {
      headerEnd = i + 1;
      break;
    }
  }

  const points: ParsedSurveyData['points'] = [];
  const maxPoints = Math.min(vertexCount, 50000);

  for (let i = headerEnd; i < headerEnd + maxPoints; i++) {
    if (!lines[i]) continue;
    const cols = lines[i].trim().split(/\s+/);
    if (cols.length >= 3) {
      points.push({
        easting: parseFloat(cols[0]) || 0,
        northing: parseFloat(cols[1]) || 0,
        rl: parseFloat(cols[2]) || 0,
        code: 'DRONE-PLY',
        description: 'Point cloud vertex',
      });
    }
  }

  return {
    points,
    metadata: {
      source: 'PLY Point Cloud',
      format: 'PLY',
      totalPoints: vertexCount,
      droneSpecific: {
        flightDate: new Date().toISOString(),
      },
    },
  };
}
