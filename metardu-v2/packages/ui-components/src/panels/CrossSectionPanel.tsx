/**
 * Cross-Section Panel — road/railway cross-section surveying.
 *
 * Shows:
 *   - Input form for chainage, centerline elevation, offset/elevation observations
 *   - Section SVG (ground profile + design template)
 *   - Cut/fill areas per section
 *   - Earthwork volume table (end-area method between sections)
 */

import React, { useState, useCallback } from "react";
import { useCrossSection } from "../hooks/index.js";

export const CrossSectionPanel: React.FC = () => {
  const { sections, volume, addSection, computeVolumes } = useCrossSection();
  const [chainage, setChainage] = useState(0);
  const [centerElev, setCenterElev] = useState(1700);
  const [observations, setObservations] = useState("-7.5,1699.5\n0,1700.0\n7.5,1699.8");
  const [designTemplate, setDesignTemplate] = useState("-7.5,1700.2\n0,1700.5\n7.5,1700.2");
  const [sectionSvg, setSectionSvg] = useState("");

  const handleAdd = useCallback(() => {
    const obs = observations.trim().split("\n").map(line => {
      const [offset, elev] = line.trim().split(",").map(parseFloat);
      return { offset, elevation: elev };
    }).filter(o => !isNaN(o.offset));

    addSection(chainage, centerElev, obs);
  }, [chainage, centerElev, observations, addSection]);

  const handleApplyDesign = useCallback(async () => {
    if (sections.length === 0) return;
    const template = designTemplate.trim().split("\n").map(line => {
      const [offset, elev] = line.trim().split(",").map(parseFloat);
      return { offset, elevation: elev };
    }).filter(t => !isNaN(t.offset));

    const { applyDesignTemplate, renderCrossSectionSvg } = await import("@metardu/engine-v2");
    const last = sections[sections.length - 1];
    const withDesign = applyDesignTemplate(last, template);
    setSectionSvg(renderCrossSectionSvg(withDesign));
  }, [sections, designTemplate]);

  const handleComputeVolumes = useCallback(() => {
    computeVolumes();
  }, [computeVolumes]);

  return (
    <div style={{ padding: 16, fontFamily: "system-ui", display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 18, color: "#333" }}>Cross-Sections</h2>

      {/* Section input */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "#666" }}>Chainage (m)</span>
          <input type="number" value={chainage} onChange={e => setChainage(Number(e.target.value))}
            style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc" }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "#666" }}>Centerline Elev (m)</span>
          <input type="number" value={centerElev} onChange={e => setCenterElev(Number(e.target.value))} step={0.001}
            style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc" }} />
        </label>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, color: "#666" }}>Ground Observations (offset,elevation per line)</span>
        <textarea value={observations} onChange={e => setObservations(e.target.value)} rows={5}
          style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc", fontFamily: "monospace", fontSize: 12 }} />
      </label>

      <button onClick={handleAdd}
        style={{ padding: 10, borderRadius: 6, border: "none", background: "#2563eb", color: "white", fontWeight: 600, cursor: "pointer" }}>
        Add Section
      </button>

      {/* Design template */}
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, color: "#666" }}>Design Template (offset,elevation)</span>
        <textarea value={designTemplate} onChange={e => setDesignTemplate(e.target.value)} rows={3}
          style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc", fontFamily: "monospace", fontSize: 12 }} />
      </label>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={handleApplyDesign} disabled={sections.length === 0}
          style={{ flex: 1, padding: 10, borderRadius: 6, border: "none", background: sections.length === 0 ? "#ccc" : "#059669", color: "white", fontWeight: 600, cursor: sections.length === 0 ? "default" : "pointer" }}>
          Apply Design + View
        </button>
        <button onClick={handleComputeVolumes} disabled={sections.length < 2}
          style={{ flex: 1, padding: 10, borderRadius: 6, border: "none", background: sections.length < 2 ? "#ccc" : "#7c3aed", color: "white", fontWeight: 600, cursor: sections.length < 2 ? "default" : "pointer" }}>
          Compute Volumes
        </button>
      </div>

      {/* Section count */}
      <div style={{ fontSize: 13, color: "#666" }}>
        {sections.length} section(s) recorded
      </div>

      {/* Section SVG */}
      {sectionSvg && (
        <div style={{ background: "#f8f9fa", borderRadius: 8, padding: 8 }}>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Cross-Section View</div>
          <div dangerouslySetInnerHTML={{ __html: sectionSvg }} style={{ display: "flex", justifyContent: "center" }} />
        </div>
      )}

      {/* Volume results */}
      {volume && (
        <div style={{ background: "#f0fdf4", borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Earthwork Volumes</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 13 }}>
            <div>
              <div style={{ fontSize: 11, color: "#666" }}>CUT</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#dc2626" }}>{volume.totalCut.toFixed(0)} m³</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#666" }}>FILL</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#2563eb" }}>{volume.totalFill.toFixed(0)} m³</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#666" }}>NET</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: volume.totalNet > 0 ? "#dc2626" : "#2563eb" }}>
                {volume.totalNet > 0 ? "+" : ""}{volume.totalNet.toFixed(0)} m³
              </div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
            {volume.segments.length} segment(s) | End-area method
          </div>
        </div>
      )}
    </div>
  );
};
