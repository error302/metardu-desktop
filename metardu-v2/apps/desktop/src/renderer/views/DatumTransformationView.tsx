import React, { useState } from "react";
import { Compass, Mountain } from "lucide-react";

type ReferencePanel = "datum" | "height";

const cardStyle: React.CSSProperties = {
  background: "var(--bg-tertiary)",
  border: "1px solid var(--border-default)",
  borderRadius: "6px",
  padding: "18px",
};

const labelStyle: React.CSSProperties = {
  color: "var(--text-tertiary)",
  fontSize: "11px",
  fontFamily: "var(--font-mono)",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

export const DatumTransformationView: React.FC = () => {
  const [panel, setPanel] = useState<ReferencePanel>("datum");

  return (
    <main style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px", height: "100%", overflow: "auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "20px", borderBottom: "1px solid var(--border-default)", paddingBottom: "14px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
            Reference systems
          </h2>
          <p style={{ margin: "6px 0 0", maxWidth: "760px", color: "var(--text-secondary)", fontSize: "var(--text-sm)", lineHeight: 1.5 }}>
            Coordinate and height conversions require an applicable operation or model grid with traceable source, area, reference frame, and accuracy evidence.
          </p>
        </div>

        <nav role="group" aria-label="Reference system tools" style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
          <button
            id="datum-tab"
            type="button"
            aria-pressed={panel === "datum"}
            className={panel === "datum" ? "primary" : "secondary"}
            onClick={() => setPanel("datum")}
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <Compass size={14} /> Datum operations
          </button>
          <button
            id="height-tab"
            type="button"
            aria-pressed={panel === "height"}
            className={panel === "height" ? "primary" : "secondary"}
            onClick={() => setPanel("height")}
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <Mountain size={14} /> Height models
          </button>
        </nav>
      </header>

      {panel === "datum" ? (
        <section id="datum-panel" style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "14px", maxWidth: "980px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
            <h3 style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-primary)" }}>No approved coordinate operation is loaded</h3>
            <span style={{ ...labelStyle, color: "var(--status-warning, #F59E0B)" }}>Conversion unavailable</span>
          </div>
          <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            METARDU will not derive or export transformed coordinates from preset parameters or demonstration control points. Choose an operation only after its source and target CRS, area of use, coordinate epoch, required grids, and independent validation are recorded.
          </p>

          <div style={{ background: "var(--bg-primary)", border: "1px solid var(--border-subtle)", borderRadius: "4px", padding: "14px" }}>
            <div style={labelStyle}>Known Arc 1960 operation</div>
            <div style={{ marginTop: "6px", color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: "13px" }}>
              EPSG:1122 · Arc 1960 → WGS 84 · stated accuracy 35 m
            </div>
            <p style={{ margin: "8px 0 0", color: "var(--text-secondary)", fontSize: "var(--text-sm)", lineHeight: 1.5 }}>
              This published regional operation is retained as registry information; its accuracy does not support survey-grade output, so METARDU blocks its use for that purpose. Other areas may require a different operation.
            </p>
          </div>

          <div>
            <div style={labelStyle}>Evidence required to enable a transformation</div>
            <ul style={{ margin: "8px 0 0", paddingLeft: "20px", color: "var(--text-secondary)", lineHeight: 1.7 }}>
              <li>Authority identifier and published operation parameters or grid files</li>
              <li>Source and target reference frames, area of use, and coordinate epoch where applicable</li>
              <li>Stated accuracy and independent known-answer or control-network validation</li>
            </ul>
          </div>
        </section>
      ) : (
        <section id="height-panel" style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "14px", maxWidth: "980px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
            <h3 style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-primary)" }}>No verified geoid grid is installed</h3>
            <span style={{ ...labelStyle, color: "var(--status-warning, #F59E0B)" }}>Height conversion unavailable</span>
          </div>
          <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            This build contains no authoritative geoid grid. It will not present a low-degree approximation or illustrative city offsets as EGM2008, a national vertical datum, or a survey result.
          </p>

          <div style={{ background: "var(--bg-primary)", border: "1px solid var(--border-subtle)", borderRadius: "4px", padding: "14px" }}>
            <div style={labelStyle}>Height relationship</div>
            <div style={{ marginTop: "6px", color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: "15px" }}>H = h − N</div>
            <p style={{ margin: "8px 0 0", color: "var(--text-secondary)", fontSize: "var(--text-sm)", lineHeight: 1.5 }}>
              Applying this relationship requires a compatible ellipsoid, geoid model, vertical datum, tide system, and point inside the model’s valid coverage. Outside the grid or at nodata cells, the calculation must stop without fallback.
            </p>
          </div>

          <div>
            <div style={labelStyle}>Required model record</div>
            <p style={{ margin: "8px 0 0", color: "var(--text-secondary)", lineHeight: 1.6 }}>
              A model identifier and version, authoritative source, reference ellipsoid, vertical datum, coverage, declared accuracy scope, and verified grid checksum must accompany any future height result.
            </p>
          </div>
        </section>
      )}
    </main>
  );
};
