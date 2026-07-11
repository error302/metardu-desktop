/**
 * Volume Computation — End-Area Method
 * 
 * Computes earthwork volumes between cross-sections.
 * Standard method for road and railway design.
 * 
 * V = (A1 + A2) / 2 × L
 * 
 * Where A1, A2 are cross-section areas and L is the distance between them.
 * 
 * References:
 * - Schofield, W. (2001) "Engineering Surveying"
 */

// ─── Types ───────────────────────────────────────────────────────

export interface CrossSection {
  /** Chainage/station (meters) */
  chainage: number;
  /** Area of cut (m²) — material to be removed */
  cutArea: number;
  /** Area of fill (m²) — material to be added */
  fillArea: number;
}

export interface VolumeResult {
  /** Chainage of first section */
  fromChainage: number;
  /** Chainage of second section */
  toChainage: number;
  /** Distance between sections (meters) */
  distance: number;
  /** Cut volume (m³) */
  cutVolume: number;
  /** Fill volume (m³) */
  fillVolume: number;
  /** Net volume (m³): cut - fill. Positive = excess cut, Negative = excess fill */
  netVolume: number;
  /** Method used */
  method: 'end_area' | 'prismoidal';
}

export interface TotalVolumeResult {
  /** Total cut volume (m³) */
  totalCut: number;
  /** Total fill volume (m³) */
  totalFill: number;
  /** Net volume (m³) */
  netVolume: number;
  /** Haul (m³×m) — volume × distance, for haul optimization */
  haul: number;
  /** Individual section results */
  sections: VolumeResult[];
  /** Number of sections */
  sectionCount: number;
  /** Total chainage range */
  chainageRange: { from: number; to: number };
}

// ─── Core Functions ──────────────────────────────────────────────

/**
 * Compute volume between two cross-sections using the end-area method.
 * 
 * V_cut = (A1_cut + A2_cut) / 2 × L
 * V_fill = (A1_fill + A2_fill) / 2 × L
 */
export function computeEndAreaVolume(
  section1: CrossSection,
  section2: CrossSection
): VolumeResult {
  const distance = Math.abs(section2.chainage - section1.chainage);
  
  const cutVolume = (section1.cutArea + section2.cutArea) / 2 * distance;
  const fillVolume = (section1.fillArea + section2.fillArea) / 2 * distance;
  const netVolume = cutVolume - fillVolume;
  
  return {
    fromChainage: section1.chainage,
    toChainage: section2.chainage,
    distance,
    cutVolume: Math.round(cutVolume * 100) / 100,
    fillVolume: Math.round(fillVolume * 100) / 100,
    netVolume: Math.round(netVolume * 100) / 100,
    method: 'end_area',
  };
}

/**
 * Compute total earthwork volumes from a series of cross-sections.
 */
export function computeTotalVolumes(
  sections: CrossSection[]
): TotalVolumeResult {
  if (sections.length < 2) {
    throw new Error('Need at least 2 cross-sections');
  }
  
  // Sort by chainage
  const sorted = [...sections].sort((a, b) => a.chainage - b.chainage);
  
  const sectionResults: VolumeResult[] = [];
  let totalCut = 0;
  let totalFill = 0;
  let haul = 0;
  
  for (let i = 0; i < sorted.length - 1; i++) {
    const result = computeEndAreaVolume(sorted[i], sorted[i + 1]);
    sectionResults.push(result);
    totalCut += result.cutVolume;
    totalFill += result.fillVolume;
    
    // Haul = volume × average distance from start
    const midChainage = (sorted[i].chainage + sorted[i + 1].chainage) / 2;
    haul += Math.abs(result.netVolume) * (midChainage - sorted[0].chainage);
  }
  
  return {
    totalCut: Math.round(totalCut * 100) / 100,
    totalFill: Math.round(totalFill * 100) / 100,
    netVolume: Math.round((totalCut - totalFill) * 100) / 100,
    haul: Math.round(haul * 100) / 100,
    sections: sectionResults,
    sectionCount: sorted.length,
    chainageRange: {
      from: sorted[0].chainage,
      to: sorted[sorted.length - 1].chainage,
    },
  };
}

/**
 * Compute volume using the prismoidal formula (more accurate than end-area).
 * Requires a middle section at the midpoint between two end sections.
 * 
 * V = L / 6 × (A1 + 4×Am + A2)
 */
export function computePrismoidalVolume(
  section1: CrossSection,
  midSection: CrossSection,
  section2: CrossSection
): VolumeResult {
  const L = Math.abs(section2.chainage - section1.chainage);
  
  const cutVolume = L / 6 * (section1.cutArea + 4 * midSection.cutArea + section2.cutArea);
  const fillVolume = L / 6 * (section1.fillArea + 4 * midSection.fillArea + section2.fillArea);
  const netVolume = cutVolume - fillVolume;
  
  return {
    fromChainage: section1.chainage,
    toChainage: section2.chainage,
    distance: L,
    cutVolume: Math.round(cutVolume * 100) / 100,
    fillVolume: Math.round(fillVolume * 100) / 100,
    netVolume: Math.round(netVolume * 100) / 100,
    method: 'prismoidal',
  };
}
