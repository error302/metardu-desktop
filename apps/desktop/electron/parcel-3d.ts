/**
 * 3D Parcel Visualization — Subsurface Rights, Building Heights, Volumetric Parcels
 *
 * OV5: Web apps are 2D only. Desktop has Three.js with full GPU acceleration.
 * This module generates 3D scene data for:
 *   - Parcel extrusion (show building heights from footprints)
 *   - Subsurface rights (mineral rights, underground easements — 3D volumes below ground)
 *   - Airspace rights (height restrictions, flight path clearance — 3D volumes above ground)
 *   - 3D beacons (real elevation, not just 2D points)
 *   - Volumetric parcel computation (3D Shoelace formula)
 *   - Cross-section viewer (cut any parcel along a line, see the profile)
 */

export interface Parcel3DExtrusion {
  parcelId: string;
  parcelNumber: string;
  footprint: Array<[number, number]>;  // XY coordinates of the parcel boundary
  buildingHeight: number;  // metres above ground
  extrusionGeometry: {
    vertices: number[];  // x, y, z interleaved
    faces: number[];     // triangle indices
  };
  color: [number, number, number];  // RGB 0-1
}

export interface SubsurfaceRight {
  parcelId: string;
  type: 'mineral' | 'easement' | 'tunnel' | 'basement' | 'utility';
  description: string;
  depthFrom: number;  // metres below ground
  depthTo: number;    // metres below ground
  footprint: Array<[number, number]>;
  geometry: {
    vertices: number[];
    faces: number[];
  };
  owner?: string;
  grantedDate?: string;
}

export interface AirspaceRight {
  parcelId: string;
  type: 'height_restriction' | 'flight_path' | 'easement' | 'view_corridor';
  description: string;
  heightFrom: number;  // metres above ground
  heightTo: number;    // metres above ground
  footprint: Array<[number, number]>;
  geometry: {
    vertices: number[];
    faces: number[];
  };
}

export interface CrossSection {
  line: { start: [number, number]; end: [number, number] };
  profile: Array<{
    chainage: number;      // distance along the line
    elevation: number;     // ground elevation at this point
    parcelBoundary?: {    // if the line crosses a parcel boundary
      parcelNumber: string;
      offset: number;     // perpendicular distance from line
    };
  }>;
  length: number;
}

export interface Scene3D {
  parcels: Parcel3DExtrusion[];
  subsurface: SubsurfaceRight[];
  airspace: AirspaceRight[];
  beacons: Array<{
    number: string;
    position: [number, number, number];
    type: 'control' | 'beacon' | 'benchmark';
  }>;
  groundSurface?: {
    vertices: number[];
    faces: number[];
  };
}

/**
 * Extrude a 2D parcel footprint into a 3D box (for building visualization).
 */
export function extrudeParcel(
  footprint: Array<[number, number]>,
  height: number,
): { vertices: number[]; faces: number[] } {
  const vertices: number[] = [];
  const faces: number[] = [];
  const n = footprint.length;

  // Bottom face (z=0)
  for (const [x, y] of footprint) {
    vertices.push(x, y, 0);
  }
  // Top face (z=height)
  for (const [x, y] of footprint) {
    vertices.push(x, y, height);
  }

  // Bottom face triangles (reversed for normal pointing down)
  for (let i = 1; i < n - 1; i++) {
    faces.push(0, i + 1, i);
  }
  // Top face triangles
  for (let i = 1; i < n - 1; i++) {
    faces.push(n, n + i, n + i + 1);
  }
  // Side faces
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    faces.push(i, next, n + next);
    faces.push(i, n + next, n + i);
  }

  return { vertices, faces };
}

/**
 * Create a subsurface volume (box going below ground).
 */
export function createSubsurfaceVolume(
  footprint: Array<[number, number]>,
  depthFrom: number,
  depthTo: number,
): { vertices: number[]; faces: number[] } {
  // Same as extrudeParcel but z is negative (below ground)
  const vertices: number[] = [];
  const faces: number[] = [];
  const n = footprint.length;

  for (const [x, y] of footprint) {
    vertices.push(x, y, -depthFrom);
  }
  for (const [x, y] of footprint) {
    vertices.push(x, y, -depthTo);
  }

  for (let i = 1; i < n - 1; i++) {
    faces.push(0, i + 1, i);
  }
  for (let i = 1; i < n - 1; i++) {
    faces.push(n, n + i, n + i + 1);
  }
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    faces.push(i, next, n + next);
    faces.push(i, n + next, n + i);
  }

  return { vertices, faces };
}

/**
 * Create an airspace volume (box above ground).
 */
export function createAirspaceVolume(
  footprint: Array<[number, number]>,
  heightFrom: number,
  heightTo: number,
): { vertices: number[]; faces: number[] } {
  return extrudeParcel(footprint, heightTo - heightFrom).vertices.length > 0
    ? (() => {
        const result = extrudeParcel(footprint, heightTo);
        // Shift all z by -heightFrom to start at heightFrom
        for (let i = 2; i < result.vertices.length; i += 3) {
          result.vertices[i] -= heightFrom;
        }
        return result;
      })()
    : { vertices: [], faces: [] };
}

/**
 * Compute a cross-section along a line through a set of parcels.
 * Returns the profile of ground elevation and any parcel boundaries crossed.
 */
export function computeCrossSection(
  line: { start: [number, number]; end: [number, number] },
  parcels: Array<{
    parcelNumber: string;
    points: Array<{ easting: number; northing: number; elevation?: number }>;
  }>,
  groundSurface?: Array<{ x: number; y: number; z: number }>,
): CrossSection {
  const [x1, y1] = line.start;
  const [x2, y2] = line.end;
  const lineLength = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  const dx = (x2 - x1) / lineLength;
  const dy = (y2 - y1) / lineLength;

  const profile: CrossSection['profile'] = [];

  // Sample elevation along the line at 1m intervals
  const interval = 1.0;
  for (let ch = 0; ch <= lineLength; ch += interval) {
    const px = x1 + dx * ch;
    const py = y1 + dy * ch;
    let elevation = 0;

    if (groundSurface && groundSurface.length > 0) {
      // Find nearest point in ground surface (simplified — production would use IDW)
      let minDist = Infinity;
      for (const p of groundSurface) {
        const d = Math.sqrt((p.x - px) ** 2 + (p.y - py) ** 2);
        if (d < minDist) { minDist = d; elevation = p.z; }
      }
    }

    profile.push({ chainage: ch, elevation });
  }

  // Check for parcel boundary crossings (line-segment intersection)
  for (const parcel of parcels) {
    const pts = parcel.points;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const intersect = lineSegmentIntersection(
        x1, y1, x2, y2,
        pts[i].easting, pts[i].northing,
        pts[j].easting, pts[j].northing,
      );
      if (intersect) {
        const ch = Math.sqrt((intersect.x - x1) ** 2 + (intersect.y - y1) ** 2);
        profile.push({
          chainage: ch,
          elevation: 0,
          parcelBoundary: { parcelNumber: parcel.parcelNumber, offset: 0 },
        });
      }
    }
  }

  // Sort by chainage
  profile.sort((a, b) => a.chainage - b.chainage);

  return { line, profile, length: lineLength };
}

function lineSegmentIntersection(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number,
): { x: number; y: number } | null {
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
  }
  return null;
}

/**
 * Compute the 3D volume of a parcel (3D Shoelace formula).
 * For a prism (extruded footprint), volume = 2D area × height.
 */
export function compute3DVolume(
  footprint: Array<[number, number]>,
  height: number,
): number {
  // 2D Shoelace
  let area = 0;
  for (let i = 0; i < footprint.length; i++) {
    const j = (i + 1) % footprint.length;
    area += footprint[i][0] * footprint[j][1];
    area -= footprint[j][0] * footprint[i][1];
  }
  area = Math.abs(area) / 2;
  return area * height;
}
