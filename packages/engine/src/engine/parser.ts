// METARDU Engine - Field data parser
import { NamedPoint3D } from './types';

export interface ParseResult {
  points: NamedPoint3D[];
  warnings: string[];
}

export function parseDelimitedFile(content: string, delimiter: string = ','): ParseResult {
  const lines = content.trim().split('\n');
  const points: NamedPoint3D[] = [];
  const warnings: string[] = [];
  
  let hasHeader = false;
  let startLine = 0;
  
  const firstLine = lines[0].toUpperCase();
  if (firstLine.includes('EASTING') || firstLine.includes('POINT') || firstLine.includes('NORTHING')) {
    hasHeader = true;
    startLine = 1;
  }
  
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const parts = line.split(delimiter).map((p: any) => p.trim());
    
    let name = '';
    let easting = 0;
    let northing = 0;
    let elevation = 0;
    
    if (parts.length >= 3) {
      // Try to detect column order
      name = parts[0];
      easting = parseFloat(parts[1]);
      northing = parseFloat(parts[2]);
      if (parts.length >= 4) {
        elevation = parseFloat(parts[3]) || 0;
      }
    }
    
    if (isNaN(easting) || isNaN(northing)) {
      warnings.push(`Row ${i + 1}: Could not parse coordinates for point "${name}"`);
      continue;
    }
    
    if (easting < 100000 || easting > 900000) {
      warnings.push(`Row ${i + 1} (${name}): Easting ${easting} outside typical UTM range (100000-900000)`);
    }
    
    points.push({ name, easting, northing, elevation });
  }
  
  return { points, warnings };
}

export function pointsToCSV(points: NamedPoint3D[]): string {
  const header = 'POINT,EASTING,NORTHING,ELEVATION\n';
  const rows = points.map((p: any) => `${p.name},${p.easting},${p.northing},${p.elevation}`).join('\n');
  return header + rows;
}

export function validatePoints(points: NamedPoint3D[]): string[] {
  const warnings: string[] = [];
  const names = new Set<string>();
  
  for (const p of points) {
    if (names.has(p.name)) {
      warnings.push(`Duplicate point name: ${p.name}`);
    }
    names.add(p.name);
    
    if (p.easting < 100000 || p.easting > 900000) {
      warnings.push(`Point ${p.name}: Easting ${p.easting} outside UTM range`);
    }
  }
  
  return warnings;
}
