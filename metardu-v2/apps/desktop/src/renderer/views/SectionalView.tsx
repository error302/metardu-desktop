/**
 * Sectional Properties workflow view.
 *
 * Defines a building with levels + units, computes participation
 * quotas, and verifies area balance.
 */

import React, { useState } from "react";
import { KENYA, AUSTRALIA, UNITED_KINGDOM, SOUTH_AFRICA, UNITED_ARAB_EMIRATES, type CountrySurveyConfig } from "@metardu/country-config";
import { runSectionalWorkflow, type SectionalWorkflowOutput, type BuildingLevel } from "@metardu/engine-flight-planning";

const COUNTRY_OPTIONS: Record<string, CountrySurveyConfig> = {
  KE: KENYA,
  AU: AUSTRALIA,
  GB: UNITED_KINGDOM,
  ZA: SOUTH_AFRICA,
  AE: UNITED_ARAB_EMIRATES,
};

export const SectionalView: React.FC = () => {
  const [countryCode, setCountryCode] = useState("KE");
  const [result, setResult] = useState<SectionalWorkflowOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Default: a 2-unit ground floor building.
  const defaultLevels: BuildingLevel[] = [
    {
      level: 0,
      name: "Ground Floor",
      footprint: { vertices: [
        { easting: 0, northing: 0 }, { easting: 20, northing: 0 },
        { easting: 20, northing: 10 }, { easting: 0, northing: 10 },
      ] },
      units: [
        { number: "A", type: "residential", boundary: { vertices: [
          { easting: 0, northing: 0 }, { easting: 10, northing: 0 },
          { easting: 10, northing: 10 }, { easting: 0, northing: 10 },
        ] } },
        { number: "B", type: "residential", boundary: { vertices: [
          { easting: 10, northing: 0 }, { easting: 20, northing: 0 },
          { easting: 20, northing: 10 }, { easting: 10, northing: 10 },
        ] } },
      ],
      commonProperty: [],
    },
  ];
  const [levels] = useState<BuildingLevel[]>(defaultLevels);

  const run = () => {
    setError(null);
    try {
      const country = COUNTRY_OPTIONS[countryCode]!;
      const output = runSectionalWorkflow({
        building: {
          name: "Test Building",
          address: "123 Survey Street",
          parentParcel: "LR/12345",
          levels,
        },
        country,
        surveyor: { name: "Surveyor", regNo: "LS/0000", dateOfSurvey: new Date().toISOString().split("T")[0]! },
      });
      setResult(output);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      <h2 style={{ fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>Sectional Properties</h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
        Compute unit areas, participation quotas, and verify area balance for sectional title / strata plans.
      </p>

      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <label>Country:</label>
        <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)} style={{ minWidth: "200px" }}>
          {Object.entries(COUNTRY_OPTIONS).map(([code, cfg]) => (
            <option key={code} value={code}>{cfg.countryName}</option>
          ))}
        </select>
        <button className="primary" onClick={run}>Compute</button>
      </div>

      {error && (
        <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--status-error)", color: "var(--status-error)", fontSize: "var(--text-sm)" }}>
          Error: {error}
        </div>
      )}

      {result && (
        <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: "12px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px", marginBottom: "12px" }}>
            <StatCard label="Total Building" value={`${result.totalBuildingArea.toFixed(1)} m²`} />
            <StatCard label="Total Units" value={`${result.totalUnitArea.toFixed(1)} m²`} />
            <StatCard label="Common Property" value={`${result.totalCommonArea.toFixed(1)} m²`} />
            <StatCard label="Area Balance" value={result.areaBalanceOk ? "✓ OK" : "✗ Mismatch"} color={result.areaBalanceOk ? "var(--status-success)" : "var(--status-error)"} />
          </div>

          <div style={{ padding: "8px 12px", background: "var(--bg-tertiary)", marginBottom: "12px" }}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase" }}>Sectional Regime</div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: "4px" }}>
              {result.regime.legislation}
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: "4px" }}>
              Plan type: {result.regime.planType} · Participation quotas: {result.regime.requiresParticipationQuotas ? "required" : "not required"}
            </div>
            {!result.sourceFiled && (
              <div style={{ marginTop: "6px", padding: "4px 8px", background: "rgba(245,158,11,0.1)", border: "1px solid var(--status-warning)", fontSize: "var(--text-xs)", color: "var(--status-warning)" }}>
                ⚠ DRAFT — source regulation not yet filed. Output is draft quality only.
              </div>
            )}
          </div>

          <h4 style={{ fontSize: "var(--text-md)", marginBottom: "4px", fontFamily: "var(--font-mono)" }}>Per-Level Breakdown</h4>
          {result.levels.map((lvl, i) => (
            <div key={i} style={{ marginBottom: "12px", padding: "8px 12px", background: "var(--bg-tertiary)" }}>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", marginBottom: "4px" }}>
                Level {lvl.level}: {lvl.name} — {lvl.totalArea.toFixed(1)} m² total
              </div>
              <table>
                <thead>
                  <tr><th>Unit</th><th>Type</th><th>Area (m²)</th><th>PQ (%)</th></tr>
                </thead>
                <tbody>
                  {lvl.units.map((u, j) => (
                    <tr key={j}>
                      <td>{u.number}</td>
                      <td>{u.type}</td>
                      <td>{u.area.toFixed(2)}</td>
                      <td>{u.participationQuota.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div style={{ padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase" }}>{label}</div>
    <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)", color: color ?? "var(--text-primary)" }}>{value}</div>
  </div>
);
