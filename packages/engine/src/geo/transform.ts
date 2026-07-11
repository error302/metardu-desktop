import proj4 from 'proj4';

const DEFINITIONS: Record<string, string> = {
  'WGS84': '+proj=longlat +datum=WGS84 +no_defs',
  'Arc1960-UTM36S': '+proj=utm +zone=36 +south +ellps=clrk80 +towgs84=-160,-6,-302,-0.807,0.339,-1.619,-2.554 +units=m +no_defs',
  'Arc1960-UTM37S': '+proj=utm +zone=37 +south +ellps=clrk80 +towgs84=-160,-6,-302,-0.807,0.339,-1.619,-2.554 +units=m +no_defs',
  'Arc1960-UTM37N': '+proj=utm +zone=37 +ellps=clrk80 +towgs84=-160,-6,-302,-0.807,0.339,-1.619,-2.554 +units=m +no_defs',
  'Arc1960-UTM36N': '+proj=utm +zone=36 +ellps=clrk80 +towgs84=-160,-6,-302,-0.807,0.339,-1.619,-2.554 +units=m +no_defs',
  'Arc1960-UTM35S': '+proj=utm +zone=35 +south +ellps=clrk80 +towgs84=-160,-6,-302,-0.807,0.339,-1.619,-2.554 +units=m +no_defs',
  'WGS84-UTM36S': '+proj=utm +zone=36 +south +datum=WGS84 +units=m +no_defs',
  'WGS84-UTM37S': '+proj=utm +zone=37 +south +datum=WGS84 +units=m +no_defs',
  'WGS84-UTM37N': '+proj=utm +zone=37 +datum=WGS84 +units=m +no_defs',
  'WGS84-UTM36N': '+proj=utm +zone=36 +datum=WGS84 +units=m +no_defs',
};

export type CoordSystem = keyof typeof DEFINITIONS;

export interface TransformInput {
  points: Array<{ id: string; x: number; y: number; z?: number }>;
  fromCRS: CoordSystem;
  toCRS: CoordSystem;
}

export interface TransformOutput {
  points: Array<{ id: string; x: number; y: number; z?: number; warning?: string }>;
  fromCRS: CoordSystem;
  toCRS: CoordSystem;
}

export function transformCoordinates(input: TransformInput): TransformOutput {
  const fromDef = DEFINITIONS[input.fromCRS];
  const toDef = DEFINITIONS[input.toCRS];

  if (!fromDef) throw new Error(`Unknown CRS: ${input.fromCRS}`);
  if (!toDef) throw new Error(`Unknown CRS: ${input.toCRS}`);

  const results = input.points.map((pt) => {
    try {
      const result = proj4(fromDef, toDef, [pt.x, pt.y, pt.z ?? 0]);
      return {
        id: pt.id,
        x: Math.round(result[0] * 1000) / 1000,
        y: Math.round(result[1] * 1000) / 1000,
        z: pt.z !== undefined ? Math.round(result[2] * 1000) / 1000 : undefined,
      };
    } catch {
      return { id: pt.id, x: 0, y: 0, warning: 'Transform failed for this point' };
    }
  });

  return { points: results, fromCRS: input.fromCRS, toCRS: input.toCRS };
}

export function getSupportedCRS(): CoordSystem[] {
  return Object.keys(DEFINITIONS) as CoordSystem[];
}
