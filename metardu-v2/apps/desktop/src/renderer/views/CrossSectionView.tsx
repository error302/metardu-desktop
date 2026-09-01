import React, { useState, useMemo, useCallback } from "react";
import DOMPurify from "dompurify";
import { useSurveyState } from "../SurveyStateContext.js";

interface CrossSectionPoint {
  offset: number;
  groundElevation: number;
  designElevation?: number;
  feature?: string;
}

interface CrossSectionData {
  chainage: number;
  points: CrossSectionPoint[];
  centerlineElevation: number;
  area?: { cut: number; fill: number };
}

function renderCrossSectionSvg(section: CrossSectionData, options: {
  width?: number;
  height?: number;
  scale?: number;
  showDesign?: boolean;
  highlightCut?: boolean;
} = {}): string {
  const width = options.width ?? 600;
  const height = options.height ?? 350;
  const scale = options.scale ?? 20;
  const showDesign = options.showDesign ?? true;
  const highlightCut = options.highlightCut ?? true;

  const cx = width / 2;
  const baseY = height - 60;

  // Find elevation range
  const allElev = section.points.map(p => p.groundElevation);
  if (showDesign) {
    section.points.forEach(p => {
      if (p.designElevation !== undefined) allElev.push(p.designElevation);
    });
  }
  if (allElev.length === 0) return `<svg width="${width}" height="${height}"><text x="${cx}" y="${height/2}" text-anchor="middle" fill="#999">No data</text></svg>`;

  const minElev = Math.min(...allElev) - 1;
  const maxElev = Math.max(...allElev) + 1;
  const centerElev = (minElev + maxElev) / 2;

  const projectX = (offset: number) => cx + offset * scale;
  const projectY = (elev: number) => baseY - (elev - centerElev) * scale;

  // Ground line points
  const groundPoints = section.points.map(p =>
    `${projectX(p.offset).toFixed(1)},${projectY(p.groundElevation).toFixed(1)}`
  ).join(" ");

  // Design line points
  const designPoints = section.points
    .filter(p => p.designElevation !== undefined)
    .map(p => `${projectX(p.offset).toFixed(1)},${projectY(p.designElevation!).toFixed(1)}`)
    .join(" ");

  // Cut/fill polygon (between ground and design)
  let cutFillPolygon = "";
  if (highlightCut && designPoints) {
    const groundOnly = section.points;
    const designOnly = section.points.filter(p => p.designElevation !== undefined);
    if (groundOnly.length === designOnly.length) {
      const groundPoly = groundOnly.map(p => `${projectX(p.offset).toFixed(1)},${projectY(p.groundElevation).toFixed(1)}`);
      const designPoly = designOnly.map(p => `${projectX(p.offset).toFixed(1)},${projectY(p.designElevation!).toFixed(1)}`);
      // Check if it's cut (ground > design) or fill (ground < design)
      const midIdx = Math.floor(groundOnly.length / 2);
      const isCut = groundOnly[midIdx]!.groundElevation > (groundOnly[midIdx]!.designElevation ?? groundOnly[midIdx]!.groundElevation);
      const color = isCut ? "rgba(255,80,80,0.15)" : "rgba(80,120,255,0.15)";
      cutFillPolygon = `<polygon points="${[...groundPoly, ...designPoly.reverse()].join(" ")}" fill="${color}" stroke="none"/>`;
    }
  }

  // Grid lines
  const gridLines: string[] = [];
  const elevStep = Math.ceil((maxElev - minElev) / 6);
  for (let e = Math.ceil(minElev / elevStep) * elevStep; e <= maxElev; e += elevStep) {
    const y = projectY(e);
    if (y > 30 && y < baseY) {
      gridLines.push(`<line x1="50" y1="${y.toFixed(1)}" x2="${width - 20}" y2="${y.toFixed(1)}" stroke="#e0e0e0" stroke-width="0.5"/>`);
      gridLines.push(`<text x="45" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="#999">${e.toFixed(1)}</text>`);
    }
  }

  const featureMarkers
  const featureMarkers = section.points
    .filter(p => p.feature)
    .map(p => {
      const x = projectX(p.offset);
      const y = projectY(p.groundElevation);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#FF9500" stroke="#fff" stroke-width="1"/>
              <text x="${x.toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" font-size="8" fill="#FF9500" font-weight="bold">${p.feature}</text>`;
    })
    .join("\n    ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="monospace, Arial, sans-serif">
    <rect width="100%" height="100%" fill="#fafafa"/>
    <text x="${cx}" y="18" text-anchor="middle" font-size="12" font-weight="bold" fill="#1a1a1a">Cross-Section @ CH ${section.chainage.toFixed(3)}</text>
    <!-- Grid -->
    ${gridLines.join("\n    ")}
    <!-- Center line -->
    <line x1="${cx}" y1="30" x2="${cx}" y2="${baseY}" stroke="#ccc" stroke-width="0.5" stroke-dasharray="2,2"/>
    <line x1="50" y1="${baseY}" x2="${width - 20}" y2="${baseY}" stroke="#999" stroke-width="0.5"/>
    <!-- Cut/Fill fill -->
    ${cutFillPolygon}
    <!-- Ground profile -->
    <polyline points="${groundPoints}" fill="none" stroke="#2d7d2d" stroke-width="2" stroke-linejoin="round"/>
    <!-- Design profile -->
    ${designPoints ? `<polyline points="${designPoints}" fill="none" stroke="#d32f2f" stroke-width="1.5" stroke-dasharray="6,3" stroke-linejoin="round"/>` : ""}
    <!-- Feature markers -->
    ${featureMarkers}
    <!-- Axis labels -->
    <text x="${cx}" y="${baseY + 30}" text-anchor="middle" font-size="9" fill="#666">Offset (m)</text>
    <text x="12" y="${(baseY + 30) / 2}" text-anchor="middle" font-size="9" fill="#666" transform="rotate(-90,12,${(baseY + 30) / 2})">Elevation (m)</text>
    <!-- Legend -->
    <line x1="${width - 180}" y1="35" x2="${width - 160}" y2="35" stroke="#2d7d2d" stroke-width="2"/>
    <text x="${width - 155}" y="38" font-size="9" fill="#333">Ground</text>
    ${designPoints ? `<line x1="${width - 180}" y1="48" x2="${width - 160}" y2="48" stroke="#d32f2f" stroke-width="1.5" stroke-dasharray="4,2"/><text x="${width - 155}" y="51" font-size="9" fill="#333">Design</text>` : ""}
    <!-- Cut/Fill info -->
    ${section.area ? `<text x="${width - 10}" y="35" text-anchor="end" font-size="9" fill="#333">Cut: ${section.area.cut.toFixed(2)} m² | Fill: ${section.area.fill.toFixed(2)} m²</text>` : ""}
  </svg>`;
}

function generateSampleSections(): CrossSectionData[] {
  const sections: CrossSectionData[] = [];
  for (let ch = 0; ch <= 100; ch += 10) {
    const points: CrossSectionPoint[] = [];
    // Ground: rolling terrain with a valley at center
    for (let offset = -15; offset <= 15; offset += 2.5) {
      const baseElev = 100 + Math.sin(ch * 0.05) * 2;
      const valleyDepth = Math.exp(-offset * offset / 50) * 3;
      const groundElev = baseElev + Math.abs(offset) * 0.1 - valleyDepth + Math.random() * 0.3;
      const designElev = baseElev + 0.5; // Flat design grade
      points.push({
        offset,
        groundElevation: parseFloat(groundElev.toFixed(3)),
        designElevation: parseFloat(designElev.toFixed(3)),
        feature: offset === 0 ? "CL" : offset === -10 ? "EL" : offset === 10 ? "ER" : undefined,
      });
    }
    const cut = points.filter(p => p.designElevation !== undefined && p.groundElevation > p.designElevation!)
      .reduce((sum, p) => sum + (p.groundElevation - p.designElevation!) * 2.5, 0);
    const fill = points.filter(p => p.designElevation !== undefined && p.groundElevation < p.designElevation!)
      .reduce((sum, p) => sum + (p.designElevation! - p.groundElevation) * 2.5, 0);
    sections.push({
      chainage: ch,
      points,
      centerlineElevation: points.find(p => p.offset === 0)?.groundElevation ?? 100,
      area: { cut: parseFloat(cut.toFixed(2)), fill: parseFloat(fill.toFixed(2)) },
    });
  }
  return sections;
}

export const CrossSectionView: React.FC = () => {
  const { state: surveyState } = useSurveyState();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDesign, setShowDesign] = useState(true);
  const [highlightCut, setHighlightCut] = useState(true);
  const [scale, setScale] = useState(20);

  const sections: CrossSectionData[] = useMemo(() => {
    const output = surveyState?.output as Record<string, unknown> | undefined;
    if (output && "sections" in output && Array.isArray(output.sections)) {
      return output.sections as CrossSectionData[];
    }
    return generateSampleSections();
  }, [surveyState]);

  const currentSection = sections[selectedIndex];

  const prevSection = useCallback(() => {
    setSelectedIndex(i => Math.max(0, i - 1));
  }, []);

  const nextSection = useCallback(() => {
    setSelectedIndex(i => Math.min(sections.length - 1, i + 1));
  }, [sections.length]);

  const totalVolumes = useMemo(() => {
    let totalCut = 0;
    let totalFill = 0;
    for (let i = 0; i < sections.length - 1; i++) {
      const s1 = sections[i]!;
      const s2 = sections[i + 1]!;
      const L = Math.abs(s2.chainage - s1.chainage);
      if (s1.area && s2.area) {
        totalCut += ((s1.area.cut + s2.area.cut) / 2) * L;
        totalFill += ((s1.area.fill + s2.area.fill) / 2) * L;
      }
    }
    return { cut: totalCut, fill: totalFill, balance: totalCut - totalFill };
  }, [sections]);

  const svgHtml = useMemo(() => {
    if (!currentSection) return "";
    return renderCrossSectionSvg(currentSection, {
      width: 650,
      height: 380,
      scale,
      showDesign,
      highlightCut,
    });
  }, [currentSection, scale, showDesign, highlightCut]);

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      <h2 style={{ fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
        Cross-Section Viewer
      </h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
        Interactive cross-section drawing along the road alignment. Ground line (green) vs design grade (red dashed). Cut/fill areas highlighted.
      </p>

      {/* Controls */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
          <button onClick={prevSection} disabled={selectedIndex === 0}
            style={{ padding: "4px 12px", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>◀</button>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", minWidth: "120px", textAlign: "center" }}>
            CH {currentSection?.chainage.toFixed(1) ?? "—"} ({selectedIndex + 1}/{sections.length})
          </span>
          <button onClick={nextSection} disabled={selectedIndex === sections.length - 1}
            style={{ padding: "4px 12px", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>▶</button>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "var(--text-xs)" }}>
          <input type="checkbox" checked={showDesign} onChange={(e) => setShowDesign(e.target.checked)} />
          Show Design
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "var(--text-xs)" }}>
          <input type="checkbox" checked={highlightCut} onChange={(e) => setHighlightCut(e.target.checked)} />
          Highlight Cut/Fill
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "var(--text-xs)" }}>
          Scale:
          <input type="range" min="5" max="50" value={scale} onChange={(e) => setScale(parseInt(e.target.value))} style={{ width: "80px" }} />
          {scale}px/m
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: "12px" }}>
        {/* SVG Rendering */}
        <div style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-default)", padding: "8px", overflow: "auto" }}
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(svgHtml) }} />

        {/* Side Panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {/* Section Stats */}
          <div style={{ background: "var(--bg-tertiary)", padding: "10px", border: "1px solid var(--border-default)" }}>
            <h4 style={{ margin: "0 0 6px 0", color: "var(--accent-primary)", fontSize: "var(--text-sm)" }}>Section Data</h4>
            <div style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", display: "flex", flexDirection: "column", gap: "3px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Chainage:</span><span>{currentSection?.chainage.toFixed(3)} m</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>CL Elevation:</span><span>{currentSection?.centerlineElevation.toFixed(3)} m</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Points:</span><span>{currentSection?.points.length ?? 0}</span>
              </div>
              {currentSection?.area && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#d32f2f" }}>
                    <span>Cut Area:</span><span>{currentSection.area.cut.toFixed(2)} m²</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#1976d2" }}>
                    <span>Fill Area:</span><span>{currentSection.area.fill.toFixed(2)} m²</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Volume Summary */}
          <div style={{ background: "var(--bg-tertiary)", padding: "10px", border: "1px solid var(--border-default)" }}>
            <h4 style={{ margin: "0 0 6px 0", color: "var(--accent-primary)", fontSize: "var(--text-sm)" }}>Volume Summary</h4>
            <div style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", display: "flex", flexDirection: "column", gap: "3px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Total Cut:</span><span style={{ color: "#d32f2f" }}>{totalVolumes.cut.toFixed(1)} m³</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Total Fill:</span><span style={{ color: "#1976d2" }}>{totalVolumes.fill.toFixed(1)} m³</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border-default)", paddingTop: "4px", fontWeight: "bold" }}>
                <span>Balance:</span>
                <span style={{ color: totalVolumes.balance > 0 ? "#d32f2f" : "#1976d2" }}>
                  {totalVolumes.balance > 0 ? "+" : ""}{totalVolumes.balance.toFixed(1)} m³
                  {totalVolumes.balance > 0 ? " (waste)" : " (borrow)"}
                </span>
              </div>
            </div>
          </div>

          {/* Section List */}
          <div style={{ background: "var(--bg-tertiary)", padding: "10px", border: "1px solid var(--border-default)", flex: 1, overflow: "auto" }}>
            <h4 style={{ margin: "0 0 6px 0", color: "var(--accent-primary)", fontSize: "var(--text-sm)" }}>Sections ({sections.length})</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
              {sections.map((s, i) => (
                <div
                  key={i}
                  onClick={() => setSelectedIndex(i)}
                  style={{
                    padding: "3px 6px", cursor: "pointer",
                    background: i === selectedIndex ? "var(--bg-hover)" : "transparent",
                    color: i === selectedIndex ? "var(--accent-primary)" : "var(--text-secondary)",
                    borderRadius: "3px",
                  }}
                >
                  CH {s.chainage.toFixed(1)} — Cut: {s.area?.cut.toFixed(1) ?? "—"} Fill: {s.area?.fill.toFixed(1) ?? "—"}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
