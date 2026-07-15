/**
 * Cross-Section Surveying Module for MetaRDU Desktop v2.0.
 *
 * Handles cross-section data collection, computation, and sheet generation
 * for road/railway/canal alignment projects.
 *
 * A cross-section is a profile perpendicular to the centerline at a specific
 * chainage, showing the ground surface and design template.
 *
 * References:
 *   - RDM 1.1 §9: Cross-section Surveying
 *   - AASHTO Green Book: Cross-Section Elements
 *   - Schofield & Breach Ch. 12: Setting Out
 */

// ─── Types ─────────────────────────────────────────────────────────

/** A single point in a cross-section. */
export interface CrossSectionPoint {
  /** Offset from centerline (meters, negative = left, positive = right) */
  offset: number;
  /** Ground elevation (meters) */
  groundElevation: number;
  /** Design elevation (meters, if design template applied) */
  designElevation?: number;
  /** Cut/Fill at this point (design - ground, positive = fill) */
  cutFill?: number;
  /** Point description */
  description?: string;
}

/** A complete cross-section at a chainage. */
export interface CrossSection {
  /** Chainage (meters along centerline) */
  chainage: number;
  /** Centerline elevation */
  centerlineElevation: number;
  /** Section points (sorted by offset) */
  points: CrossSectionPoint[];
  /** Section area (m²) */
  area?: CrossSectionArea;
}

/** Computed cross-section areas. */
export interface CrossSectionArea {
  /** Cut area (m²) — ground above design */
  cut: number;
  /** Fill area (m²) — ground below design */
  fill: number;
  /** Net area (cut - fill) */
  net: number;
}

// ─── Area computation ──────────────────────────────────────────────

/**
 * Compute cut/fill areas for a cross-section.
 *
 * Uses the coordinate method (shoelace formula) on the closed polygon
 * formed by the ground profile and the design template.
 */
export function computeSectionArea(section: CrossSection): CrossSectionArea {
  if (section.points.length < 3) {
    return { cut: 0, fill: 0, net: 0 };
  }

  let cutArea = 0;
  let fillArea = 0;

  // Compute cut/fill between consecutive points
  for (let i = 0; i < section.points.length - 1; i++) {
    const p1 = section.points[i]!;
    const p2 = section.points[i + 1]!;
    if (p1.designElevation === undefined || p2.designElevation === undefined) continue;

    const width = Math.abs(p2.offset - p1.offset);
    const diff1 = p1.groundElevation - p1.designElevation;
    const diff2 = p2.groundElevation - p2.designElevation;

    // Trapezoidal area
    const avgDiff = (diff1 + diff2) / 2;
    const area = Math.abs(avgDiff * width);

    if (avgDiff > 0) {
      cutArea += area;
    } else {
      fillArea += area;
    }
  }

  return {
    cut: cutArea,
    fill: fillArea,
    net: cutArea - fillArea,
  };
}

// ─── Cross-section data collection ─────────────────────────────────

/**
 * Record a cross-section point during field survey.
 *
 * The surveyor sets up on the centerline, then takes shots at offsets
 * (e.g., -10, -7.5, -5, -2.5, 0, 2.5, 5, 7.5, 10).
 */
export function recordCrossSection(
  chainage: number,
  centerlineElevation: number,
  observations: Array<{ offset: number; elevation: number; description?: string }>,
): CrossSection {
  const points: CrossSectionPoint[] = observations.map(o => ({
    offset: o.offset,
    groundElevation: o.elevation,
    description: o.description,
  }));

  // Sort by offset (left to right)
  points.sort((a, b) => a.offset - b.offset);

  return {
    chainage,
    centerlineElevation,
    points,
  };
}

/**
 * Apply a design template to a cross-section.
 *
 * @param section Ground cross-section
 * @param template Design template (offset → elevation)
 */
export function applyDesignTemplate(
  section: CrossSection,
  template: Array<{ offset: number; elevation: number }>,
): CrossSection {
  // Sort template by offset
  const sortedTemplate = [...template].sort((a, b) => a.offset - b.offset);

  const points = section.points.map(p => {
    // Interpolate design elevation at this offset
    const designElev = interpolateDesign(sortedTemplate, p.offset);

    return {
      ...p,
      designElevation: designElev ?? undefined,
      cutFill: designElev !== null ? designElev - p.groundElevation : undefined,
    };
  });

  const result: CrossSection = {
    ...section,
    points,
  };

  result.area = computeSectionArea(result);

  return result;
}

function interpolateDesign(
  template: Array<{ offset: number; elevation: number }>,
  offset: number,
): number | null {
  if (template.length === 0) return null;
  if (template.length === 1) return template[0]!.elevation;

  // Find bracketing template points
  for (let i = 0; i < template.length - 1; i++) {
    const t1 = template[i]!;
    const t2 = template[i + 1]!;
    if (offset >= t1.offset && offset <= t2.offset) {
      const fraction = (offset - t1.offset) / (t2.offset - t1.offset);
      return t1.elevation + fraction * (t2.elevation - t1.elevation);
    }
  }

  // Outside template range — extrapolate
  if (offset < template[0]!.offset) return template[0]!.elevation;
  return template[template.length - 1]!.elevation;
}

// ─── Volume from cross-sections ────────────────────────────────────

/**
 * Compute earthwork volume between two cross-sections.
 *
 * Uses the average end-area method:
 *   V = (A1 + A2) / 2 × L
 *
 * @param section1 First cross-section
 * @param section2 Second cross-section
 * @returns Volume (m³) with cut and fill separated
 */
export function endAreaVolume(
  section1: CrossSection,
  section2: CrossSection,
): { cutVolume: number; fillVolume: number; chainage1: number; chainage2: number; length: number } {
  const L = Math.abs(section2.chainage - section1.chainage);

  const area1 = section1.area ?? { cut: 0, fill: 0, net: 0 };
  const area2 = section2.area ?? { cut: 0, fill: 0, net: 0 };

  return {
    cutVolume: (area1.cut + area2.cut) / 2 * L,
    fillVolume: (area1.fill + area2.fill) / 2 * L,
    chainage1: section1.chainage,
    chainage2: section2.chainage,
    length: L,
  };
}

/**
 * Compute total earthwork volume for a series of cross-sections.
 */
export function totalEarthworkVolume(sections: CrossSection[]): {
  totalCut: number;
  totalFill: number;
  totalNet: number;
  segments: Array<{ cutVolume: number; fillVolume: number; chainage1: number; chainage2: number; length: number }>;
} {
  if (sections.length < 2) {
    return { totalCut: 0, totalFill: 0, totalNet: 0, segments: [] };
  }

  // Ensure areas are computed
  for (const s of sections) {
    if (!s.area) {
      s.area = computeSectionArea(s);
    }
  }

  // Sort by chainage
  const sorted = [...sections].sort((a, b) => a.chainage - b.chainage);

  const segments: Array<{ cutVolume: number; fillVolume: number; chainage1: number; chainage2: number; length: number }> = [];
  let totalCut = 0;
  let totalFill = 0;

  for (let i = 0; i < sorted.length - 1; i++) {
    const vol = endAreaVolume(sorted[i]!, sorted[i + 1]!);
    segments.push(vol);
    totalCut += vol.cutVolume;
    totalFill += vol.fillVolume;
  }

  return {
    totalCut,
    totalFill,
    totalNet: totalCut - totalFill,
    segments,
  };
}

// ─── Cross-section sheet SVG ───────────────────────────────────────

/**
 * Generate an SVG of a cross-section for print.
 */
export function renderCrossSectionSvg(section: CrossSection, options: {
  width?: number;
  height?: number;
  scale?: number;       // pixels per meter
  showDesign?: boolean;
} = {}): string {
  const width = options.width ?? 500;
  const height = options.height ?? 300;
  const scale = options.scale ?? 20; // 20 px/m
  const showDesign = options.showDesign ?? true;

  const cx = width / 2;
  const baseY = height - 50;

  // Find elevation range
  const allElev = section.points.map(p => p.groundElevation);
  if (showDesign) {
    section.points.forEach(p => {
      if (p.designElevation !== undefined) allElev.push(p.designElevation);
    });
  }
  const minElev = Math.min(...allElev) - 1;
  const maxElev = Math.max(...allElev) + 1;
  const centerElev = (minElev + maxElev) / 2;

  // Project to SVG
  const projectX = (offset: number) => cx + offset * scale;
  const projectY = (elev: number) => baseY - (elev - centerElev) * scale;

  // Ground line
  const groundPoints = section.points.map(p =>
    `${projectX(p.offset)},${projectY(p.groundElevation)}`
  ).join(" ");

  // Design line (if present)
  let designSvg = "";
  if (showDesign) {
    const designPoints = section.points
      .filter(p => p.designElevation !== undefined)
      .map(p => `${projectX(p.offset)},${projectY(p.designElevation!)}`)
      .join(" ");
    designSvg = `<polyline points="${designPoints}" fill="none" stroke="#ff0000" stroke-width="1.5" stroke-dasharray="4,2"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif">
    <rect width="100%" height="100%" fill="white"/>
    <text x="${width/2}" y="20" text-anchor="middle" font-size="11" font-weight="bold">Cross-Section @ CH ${section.chainage.toFixed(3)}</text>
    <!-- Grid -->
    <line x1="${cx}" y1="30" x2="${cx}" y2="${baseY}" stroke="#ccc" stroke-width="0.5" stroke-dasharray="2,2"/>
    <line x1="50" y1="${baseY}" x2="${width-20}" y2="${baseY}" stroke="#ccc" stroke-width="0.5"/>
    <!-- Ground profile -->
    <polyline points="${groundPoints}" fill="none" stroke="#006600" stroke-width="2"/>
    <!-- Design profile -->
    ${designSvg}
    <!-- Labels -->
    <text x="${cx}" y="${baseY + 15}" text-anchor="middle" font-size="8">CL (elev: ${section.centerlineElevation.toFixed(3)}m)</text>
    ${section.area ? `<text x="${width-10}" y="35" text-anchor="end" font-size="9">Cut: ${section.area.cut.toFixed(2)} m² | Fill: ${section.area.fill.toFixed(2)} m²</text>` : ""}
  </svg>`;
}
