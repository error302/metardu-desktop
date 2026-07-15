/**
 * Main App Shell — sidebar navigation + content area + status bar.
 *
 * This is the top-level layout component that ties all panels together.
 * The sidebar lets the surveyor switch between workflows:
 *   - Map (OpenLayers canvas — existing v1.0 component)
 *   - Flight Planning (drone mission)
 *   - Stakeout (real-time field guidance)
 *   - GNSS Monitor (receiver status + skyplot)
 *   - Drone Dashboard (live drone control)
 *   - LULC Analysis (land cover mapping)
 *   - Cross-Sections (road earthwork)
 *   - As-Built (QC comparison)
 *   - Traverse (existing v1.0)
 *   - COGO (existing v1.0)
 *   - Deed Plan (existing v1.0)
 *
 * The status bar shows: platform (Electron/Tauri), sidecar status,
 * GNSS fix quality, project name, coordinate display.
 */

import React, { useState, useEffect } from "react";
import { usePlatform, useGnssTelemetry } from "../hooks/index.js";
import { FlightPlanningPanel } from "./FlightPlanningPanel.js";
import { StakeoutPanel } from "./StakeoutPanel.js";
import { GnssPanel } from "./GnssPanel.js";
import { DroneDashboard } from "./DroneDashboard.js";
import { LulcPanel } from "./LulcPanel.js";
import { CrossSectionPanel } from "./CrossSectionPanel.js";
import { AsBuiltPanel } from "./AsBuiltPanel.js";

type ViewId =
  | "map" | "flight" | "stakeout" | "gnss" | "drone"
  | "lulc" | "crosssection" | "asbuilt"
  | "traverse" | "cogo" | "deedplan";

interface NavItem {
  id: ViewId;
  label: string;
  icon: string;
  category: "field" | "drone" | "office" | "existing";
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  // Field work
  { id: "map", label: "Map", icon: "🗺️", category: "field" },
  { id: "stakeout", label: "Stakeout", icon: "📍", category: "field" },
  { id: "gnss", label: "GNSS Monitor", icon: "🛰️", category: "field" },
  // Drone
  { id: "flight", label: "Flight Planning", icon: "✈️", category: "drone" },
  { id: "drone", label: "Drone Dashboard", icon: "🚁", category: "drone" },
  // Office
  { id: "lulc", label: "LULC Analysis", icon: "🌍", category: "office" },
  { id: "crosssection", label: "Cross-Sections", icon: "📏", category: "office" },
  { id: "asbuilt", label: "As-Built QC", icon: "✓", category: "office" },
  // Existing v1.0
  { id: "traverse", label: "Traverse", icon: "📐", category: "existing" },
  { id: "cogo", label: "COGO", icon: "📊", category: "existing" },
  { id: "deedplan", label: "Deed Plan", icon: "📋", category: "existing" },
];

const CATEGORY_LABELS: Record<string, string> = {
  field: "Field Work",
  drone: "Drone",
  office: "Office",
  existing: "Surveying",
};

export const AppShell: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const [activeView, setActiveView] = useState<ViewId>("map");
  const platform = usePlatform();
  const { telemetry, connected } = useGnssTelemetry(2000);
  const [sidecarStatus, setSidecarStatus] = useState<"running" | "stopped">("stopped");

  useEffect(() => {
    // Check sidecar status
    if (typeof window !== "undefined" && "metardu" in window) {
      const api = (window as any).metardu;
      if (api?.system?.sidecar?.status) {
        api.system.sidecar.status().then((r: any) => {
          setSidecarStatus(r?.running ? "running" : "stopped");
        }).catch(() => {});
      }
    }
  }, []);

  const fixQuality = telemetry?.fixQuality ?? 0;
  const fixColor = fixQuality === 4 ? "#22c55e" : fixQuality >= 2 ? "#3b82f6" : "#ef4444";
  const fixLabel = fixQuality === 4 ? "RTK FIX" : fixQuality === 5 ? "RTK FLT" : fixQuality >= 2 ? "DGPS" : fixQuality === 1 ? "GPS" : "NO FIX";

  // Group nav items by category
  const categories = ["field", "drone", "office", "existing"] as const;

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui", overflow: "hidden" }}>
      {/* Sidebar */}
      <div style={{ width: 220, background: "#1e293b", color: "#e2e8f0", display: "flex", flexDirection: "column" }}>
        {/* Logo */}
        <div style={{ padding: 16, borderBottom: "1px solid #334155" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#8c7226" }}>MetaRDU</div>
          <div style={{ fontSize: 10, color: "#64748b" }}>Desktop v2.0</div>
        </div>

        {/* Nav items */}
        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {categories.map(cat => (
            <div key={cat}>
              <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", padding: "8px 8px 4px", letterSpacing: 1 }}>
                {CATEGORY_LABELS[cat]}
              </div>
              {NAV_ITEMS.filter(n => n.category === cat).map(item => (
                <button
                  key={item.id}
                  onClick={() => setActiveView(item.id)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 12px", borderRadius: 6, border: "none",
                    background: activeView === item.id ? "#334155" : "transparent",
                    color: activeView === item.id ? "#e2e8f0" : "#94a3b8",
                    fontSize: 13, fontWeight: activeView === item.id ? 600 : 400,
                    cursor: "pointer", textAlign: "left", transition: "all 0.15s",
                  }}
                >
                  <span style={{ fontSize: 16 }}>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Content area */}
        <div style={{ flex: 1, overflowY: "auto", background: "#ffffff" }}>
          {activeView === "map" && (children ?? <div style={{ padding: 16, color: "#666" }}>Map canvas loads here (OpenLayers)</div>)}
          {activeView === "flight" && <FlightPlanningPanel />}
          {activeView === "stakeout" && <StakeoutPanel designPoints={[]} />}
          {activeView === "gnss" && <GnssPanel />}
          {activeView === "drone" && <DroneDashboard />}
          {activeView === "lulc" && <LulcPanel />}
          {activeView === "crosssection" && <CrossSectionPanel />}
          {activeView === "asbuilt" && <AsBuiltPanel />}
          {activeView === "traverse" && <div style={{ padding: 16, color: "#666" }}>Traverse panel (v1.0 component)</div>}
          {activeView === "cogo" && <div style={{ padding: 16, color: "#666" }}>COGO panel (v1.0 component)</div>}
          {activeView === "deedplan" && <div style={{ padding: 16, color: "#666" }}>Deed Plan panel (v1.0 component)</div>}
        </div>

        {/* Status bar */}
        <div style={{
          height: 32, background: "#1e293b", color: "#94a3b8",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 16px", fontSize: 11, fontFamily: "monospace",
        }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            {/* Platform */}
            <span style={{ textTransform: "uppercase" }}>{platform}</span>
            {/* Sidecar */}
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: sidecarStatus === "running" ? "#22c55e" : "#ef4444" }} />
              sidecar: {sidecarStatus}
            </span>
            {/* GNSS fix */}
            {connected && (
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: fixColor }} />
                gnss: {fixLabel}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            {/* Coordinates */}
            {telemetry && (
              <span>
                {telemetry.latitude?.toFixed(7)}, {telemetry.longitude?.toFixed(7)} | {telemetry.altitude_amsl_m?.toFixed(2)}m
              </span>
            )}
            {/* Battery */}
            {telemetry?.battery_percent != null && (
              <span style={{ color: telemetry.battery_percent > 25 ? "#94a3b8" : "#ef4444" }}>
                bat: {telemetry.battery_percent.toFixed(0)}%
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
