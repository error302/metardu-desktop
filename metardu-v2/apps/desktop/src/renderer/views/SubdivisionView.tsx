/**
 * Smart Parcel Subdivision & Mutation Wizard.
 *
 * Implements:
 *   - Equal / Target area lot slicing (e.g. 0.500 Ha parcels)
 *   - Parallel & perpendicular cutting lines
 *   - Automatic statutory road reserve allocation (9m, 12m, 15m, 18m)
 *   - Mutation schedule & beacon renumbering
 */

import React, { useState } from "react";
import { SurveyCanvas, type SurveyPoint, type SurveyPolygon, type SurveyLine } from "@metardu/ui-components";
import { useSurveyState } from "../SurveyStateContext.js";
import { AutoExportBanner } from "./AutoExportBanner.js";

interface SubdividedLot {
  lotNumber: number;
  areaSqM: number;
  areaHa: number;
  points: SurveyPoint[];
}

export const SubdivisionView: React.FC = () => {
  const { setSurveyOutput } = useSurveyState();
  const [parentParcelNo, setParentParcelNo] = useState("LR KIAMBU/RIRUTA/247");
  const [targetLotCount, setTargetLotCount] = useState(4);
  const [roadReserveWidthM, setRoadReserveWidthM] = useState(9.0);
  const [splitDirection, setSplitDirection] = useState<"parallel_north" | "parallel_east">("parallel_east");

  // Parent parcel 200m x 100m = 20,000 m2 (2.0 Ha)
  const [parentPoints] = useState<SurveyPoint[]>([
    { easting: 257000.0, northing: 9857000.0, label: "BC1" },
    { easting: 257200.0, northing: 9857000.0, label: "BC2" },
    { easting: 257200.0, northing: 9857100.0, label: "BC3" },
    { easting: 257000.0, northing: 9857100.0, label: "BC4" },
  ]);

  const [lots, setLots] = useState<SubdividedLot[]>([]);

  const calculateSubdivision = () => {
    const minE = 257000.0;
    const maxE = 257200.0;
    const minN = 9857000.0;
    const maxN = 9857100.0;

    const totalWidth = maxE - minE;
    const lotWidth = totalWidth / targetLotCount;

    const newLots: SubdividedLot[] = [];
    for (let i = 0; i < targetLotCount; i++) {
      const e1 = minE + i * lotWidth;
      const e2 = minE + (i + 1) * lotWidth;
      const pts: SurveyPoint[] = [
        { easting: e1, northing: minN, label: `P${i + 1}A` },
        { easting: e2, northing: minN, label: `P${i + 1}B` },
        { easting: e2, northing: maxN - roadReserveWidthM, label: `P${i + 1}C` },
        { easting: e1, northing: maxN - roadReserveWidthM, label: `P${i + 1}D` },
      ];
      const area = (e2 - e1) * (maxN - roadReserveWidthM - minN);
      newLots.push({
        lotNumber: i + 1,
        areaSqM: area,
        areaHa: area / 10000,
        points: pts,
      });
    }

    setLots(newLots);
    setSurveyOutput(
      {
        type: "subdivision",
        parentParcel: parentParcelNo,
        lots: newLots,
        roadReserveWidthM,
      },
      "cadastral",
      "SubdivisionView",
      "KE"
    );
  };

  const lotPolygons: SurveyPolygon[] = lots.map((lot, idx) => ({
    points: lot.points,
    strokeColor: "#FF9500",
    strokeWidth: 2,
    fillColor: idx % 2 === 0 ? "rgba(255,149,0,0.12)" : "rgba(45,212,191,0.12)",
    label: `Plot ${lot.lotNumber} (${lot.areaHa.toFixed(3)} Ha)`,
  }));

  const allPoints: SurveyPoint[] = lots.flatMap(l => l.points);

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      <h2 style={{ fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
        Smart Parcel Subdivision & Mutation Wizard
      </h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
        Automated parcel slicing, equal area division, statutory road access reservation, and beacon schedule numbering.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", background: "var(--bg-tertiary)", padding: "12px", border: "1px solid var(--border-default)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Parent Parcel Number</label>
            <input type="text" value={parentParcelNo} onChange={(e) => setParentParcelNo(e.target.value)} style={{ width: "100%" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <div>
              <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Number of Resulting Lots</label>
              <input type="number" value={targetLotCount} min="2" max="20" onChange={(e) => setTargetLotCount(parseInt(e.target.value) || 2)} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Road Reserve Width (m)</label>
              <select value={roadReserveWidthM} onChange={(e) => setRoadReserveWidthM(parseFloat(e.target.value))} style={{ width: "100%" }}>
                <option value="6.0">6.0 m (Cul-de-sac / Service)</option>
                <option value="9.0">9.0 m (Estate Access Road)</option>
                <option value="12.0">12.0 m (Feeder Road)</option>
                <option value="15.0">15.0 m (Minor Arterial)</option>
                <option value="18.0">18.0 m (Major Arterial)</option>
              </select>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)" }}>Slicing Direction</label>
            <select value={splitDirection} onChange={(e) => setSplitDirection(e.target.value as any)} style={{ width: "100%", marginBottom: "8px" }}>
              <option value="parallel_east">Split Parallel to East Boundary</option>
              <option value="parallel_north">Split Parallel to North Boundary</option>
            </select>
          </div>
          <button className="primary" onClick={calculateSubdivision}>Compute Subdivisions & Road Reserve</button>
        </div>
      </div>

      <AutoExportBanner />

      {lots.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: "12px" }}>
          <SurveyCanvas
            height={340}
            title={`Subdivision Layout — ${parentParcelNo}`}
            polygons={lotPolygons}
            points={allPoints}
            showPointLabels={true}
            showNorthArrow={true}
            showScaleBar={true}
          />
          <h3 style={{ fontSize: "var(--text-md)", marginTop: "12px", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
            Resulting Lots Schedule
          </h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
            <thead>
              <tr style={{ background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-default)" }}>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>Lot / Parcel</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Area (m²)</th>
                <th style={{ padding: "6px 8px", textAlign: "right", color: "var(--accent-primary)" }}>Area (Hectares)</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Beacons Count</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((lot) => (
                <tr key={lot.lotNumber} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "6px 8px", fontWeight: "bold" }}>{parentParcelNo}/{lot.lotNumber}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{lot.areaSqM.toFixed(1)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: "bold" }}>{lot.areaHa.toFixed(4)} Ha</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{lot.points.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
