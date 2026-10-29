import React from "react";
import { AlertTriangle, FileInput, Layers3, Ruler, ShieldCheck } from "lucide-react";

const panelStyle: React.CSSProperties = {
  background: "var(--bg-tertiary)",
  border: "1px solid var(--border-default)",
  borderRadius: 6,
  padding: 16,
};

const roadmap = [
  {
    icon: FileInput,
    title: "Read and preserve source data",
    description: "LAS and LAZ intake with source hash, header and attribute inspection, and explicit handling of missing CRS metadata.",
  },
  {
    icon: Ruler,
    title: "Classify with a named method",
    description: "Select and configure a supported ground classifier in the dataset's declared units, with parameters and software version recorded.",
  },
  {
    icon: Layers3,
    title: "Review and deliver derived data",
    description: "Compare class counts and surfaces, inspect warnings, then export a separate classified copy and terrain products with provenance.",
  },
  {
    icon: ShieldCheck,
    title: "Check against survey evidence",
    description: "Keep the original immutable and expose method limits, validation evidence, manual overrides, and the reviewer responsible.",
  },
];

export const PointCloudView: React.FC = () => (
  <main style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16, height: "100%", overflow: "auto", maxWidth: 1180, margin: "0 auto" }}>
    <header style={{ borderBottom: "1px solid var(--border-default)", paddingBottom: 12 }}>
      <div style={{ color: "var(--text-tertiary)", fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Survey data workspace
      </div>
      <h1 style={{ margin: "5px 0", fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
        Point Cloud Processing
      </h1>
      <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-sm)", lineHeight: 1.6 }}>
        Inspect, classify, review, and deliver LiDAR and photogrammetry point clouds while preserving source data and processing evidence.
      </p>
    </header>

    <section role="status" aria-live="polite" style={{ ...panelStyle, display: "flex", gap: 12, borderColor: "var(--status-warning, #D97706)", background: "rgba(217, 119, 6, 0.08)" }}>
      <AlertTriangle size={20} color="var(--status-warning, #D97706)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 5, color: "var(--text-primary)", fontSize: "var(--text-sm)", lineHeight: 1.55 }}>
        <strong>Processing is not available in this build.</strong>
        <span>
          This workspace is not connected to a LAS/LAZ reader or a ground-classification engine. No source file is loaded and no survey result can be produced here. The previous screen displayed invented point counts, coordinates, and classification statistics; those sample results have been removed.
        </span>
      </div>
    </section>

    <section style={panelStyle}>
      <h2 style={{ margin: "0 0 12px", color: "var(--text-primary)", fontSize: 14 }}>What a usable survey workflow needs</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(215px, 1fr))", gap: 10 }}>
        {roadmap.map(({ icon: Icon, title, description }) => (
          <article key={title} style={{ padding: 12, background: "var(--bg-primary)", border: "1px solid var(--border-subtle)", borderRadius: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Icon size={16} color="var(--accent-primary)" aria-hidden="true" />
              <h3 style={{ margin: 0, color: "var(--text-primary)", fontSize: 12 }}>{title}</h3>
            </div>
            <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.55 }}>{description}</p>
          </article>
        ))}
      </div>
    </section>

    <section style={{ ...panelStyle, display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 style={{ margin: 0, color: "var(--text-primary)", fontSize: 14 }}>Current implementation boundary</h2>
      <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.6 }}>
        The engine contains an experimental TypeScript PMF prototype, but it is not a tested LAS/LAZ import-and-export pipeline, it is not the Cloth Simulation Filter (CSF), and it is not connected to this screen. The community extension preview accepts small JSON input only; large point clouds need a separate host-managed, chunked data interface. Neither path is ready for professional point-cloud deliverables.
      </p>
      <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.6 }}>
        A future workflow can support ground extraction for terrain models and contours, vegetation or building separation, stockpile and earthwork review, and asset mapping. Each method must be selected for the data and intended use, then reviewed against suitable reference data before its outputs are trusted.
      </p>
    </section>
  </main>
);
