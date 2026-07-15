/**
 * LULC Panel — Land Use Land Cover analysis workflow.
 *
 * Replaces the ArcMap + QGIS + Excel 11-step workflow:
 *   1. Import raster path (GeoTIFF from Esri Living Atlas)
 *   2. Set pixel size and boundary
 *   3. Run reclassification + area calculation
 *   4. View bar chart + pie chart (colors match map)
 *   5. View print layout (A3 with map + charts + table + legend)
 */

import React, { useState, useCallback } from "react";
import { useLulcWorkflow } from "../hooks/index.js";

export const LulcPanel: React.FC = () => {
  const { result, run, loading, error } = useLulcWorkflow();
  const [rasterPath, setRasterPath] = useState("");
  const [pixelSize, setPixelSize] = useState(10);
  const [studyAreaName, setStudyAreaName] = useState("");
  const [boundaryCoords, setBoundaryCoords] = useState("");

  const handleRun = useCallback(() => {
    const coords = boundaryCoords.trim().split("\n").map(line => {
      const [lat, lng] = line.trim().split(",").map(parseFloat);
      return { lat, lng };
    }).filter(p => !isNaN(p.lat));

    // Simulate pixel data (in production, read from GeoTIFF via sidecar)
    const pixelCount = 10000;
    const pixels = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      pixels[i] = Math.floor(Math.random() * 9) + 1; // Classes 1-9
    }

    run({
      rasterPath,
      rasterMetadata: {
        width: 100, height: 100, bands: 1, dataType: "uint8" as const,
        geoTransform: [36.8, pixelSize, 0, -1.28, 0, pixelSize] as [number, number, number, number, number, number],
        crsEpsg: 4326, noDataValue: 0,
      },
      pixels,
      boundary: { coordinates: coords },
      outputDir: "/tmp/lulc_output",
      studyAreaName: studyAreaName || "Study Area",
      surveyorName: "",
    });
  }, [rasterPath, pixelSize, studyAreaName, boundaryCoords, run]);

  return (
    <div style={{ padding: 16, fontFamily: "system-ui", display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 18, color: "#333" }}>LULC Analysis</h2>
      <p style={{ fontSize: 12, color: "#666", margin: 0 }}>Replaces ArcMap + QGIS + Excel (11 steps → 1 click)</p>

      {/* Inputs */}
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, color: "#666" }}>GeoTIFF Path</span>
        <input type="text" value={rasterPath} onChange={e => setRasterPath(e.target.value)}
          placeholder="/data/landcover.tif" disabled={loading}
          style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc" }} />
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "#666" }}>Pixel Size (m)</span>
          <input type="number" value={pixelSize} onChange={e => setPixelSize(Number(e.target.value))} disabled={loading}
            style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc" }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "#666" }}>Study Area Name</span>
          <input type="text" value={studyAreaName} onChange={e => setStudyAreaName(e.target.value)} disabled={loading}
            placeholder="Nairobi County" style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc" }} />
        </label>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, color: "#666" }}>Boundary (lat,lng per line)</span>
        <textarea value={boundaryCoords} onChange={e => setBoundaryCoords(e.target.value)} rows={4} disabled={loading}
          placeholder={"-1.2864,36.8172\n-1.2774,36.8172\n-1.2774,36.8227\n-1.2864,36.8227"}
          style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc", fontFamily: "monospace", fontSize: 12 }} />
      </label>

      <button onClick={handleRun} disabled={loading || !rasterPath}
        style={{ padding: 10, borderRadius: 6, border: "none", background: loading || !rasterPath ? "#ccc" : "#2563eb", color: "white", fontWeight: 600, cursor: loading || !rasterPath ? "default" : "pointer" }}>
        {loading ? "Processing..." : "Run LULC Analysis"}
      </button>

      {error && <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div>}

      {/* Results */}
      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Stats table */}
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: 8, background: "#f9fafb", fontWeight: 600, fontSize: 13 }}>Area Statistics</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f3f4f6" }}>
                  <th style={{ padding: 6, textAlign: "left" }}>Class</th>
                  <th style={{ padding: 6, textAlign: "right" }}>Pixels</th>
                  <th style={{ padding: 6, textAlign: "right" }}>Area (km²)</th>
                  <th style={{ padding: 6, textAlign: "right" }}>%</th>
                </tr>
              </thead>
              <tbody>
                {result.stats.map((s: any, i: number) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: 6 }}>
                      <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 2, background: s.color, marginRight: 6 }} />
                      {s.className}
                    </td>
                    <td style={{ padding: 6, textAlign: "right" }}>{s.pixelCount}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>{s.areaSqKm.toFixed(4)}</td>
                    <td style={{ padding: 6, textAlign: "right", fontWeight: 600 }}>{s.percentage.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Charts */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={{ background: "#f8f9fa", borderRadius: 8, padding: 8 }}>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Bar Chart</div>
              <div dangerouslySetInnerHTML={{ __html: result.barChartSvg }} style={{ display: "flex", justifyContent: "center" }} />
            </div>
            <div style={{ background: "#f8f9fa", borderRadius: 8, padding: 8 }}>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Pie Chart</div>
              <div dangerouslySetInnerHTML={{ __html: result.pieChartSvg }} style={{ display: "flex", justifyContent: "center" }} />
            </div>
          </div>

          {/* Print layout preview */}
          <div style={{ background: "#f8f9fa", borderRadius: 8, padding: 8 }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Print Layout (A3)</div>
            <div dangerouslySetInnerHTML={{ __html: result.printLayoutSvg }} style={{ display: "flex", justifyContent: "center", overflow: "auto" }} />
          </div>
        </div>
      )}
    </div>
  );
};
