/**
 * MapView — OpenLayers-based satellite/street basemap view.
 *
 * This is the "full map library" view, complementing the lightweight
 * SurveyCanvas (which is SVG-only, no basemap). Use MapView when you
 * need to see the parcel on satellite imagery or street maps; use
 * SurveyCanvas for pure survey geometry (TIN, contours, boundaries).
 *
 * # Features
 *
 *   - Basemap selector: satellite (Bing), street (OSM), topo (OSM)
 *   - Vector overlay: draw the active parcel boundary on the map
 *   - Click to read coordinates (lat/lon → projected)
 *   - Scale bar + north arrow (built into OpenLayers)
 *
 * # Bundle impact
 *
 * OpenLayers adds ~500KB to the bundle. By lazy-loading this view
 * (via React.lazy in main.tsx), that cost is only paid when the user
 * actually opens the Map view — not on app startup.
 *
 * # References
 *
 *   - OpenLayers docs: https://openlayers.org/
 *   - ESRI ArcGIS Pro uses similar basemap+overlay pattern
 *   - Cursor/Linear use lazy-loading for heavy features
 */

import React, { useEffect, useRef, useState } from "react";
import { Map, View, Feature } from "ol";
import { Tile, Vector as VectorLayer } from "ol/layer";
import { OSM, XYZ } from "ol/source";
import { Vector as VectorSource } from "ol/source";
import { Point, Polygon as OlPolygon } from "ol/geom";
import { Style, Fill, Stroke, Circle as CircleStyle, Text as TextStyle } from "ol/style";
import { fromLonLat, toLonLat } from "ol/proj";
import { useGeographic } from "ol/proj";
import { ScaleLine, defaults as defaultControls } from "ol/control";
import "ol/ol.css";

type BasemapType = "osm" | "satellite" | "topo";

export const MapView: React.FC = () => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<Map | null>(null);
  const [basemap, setBasemap] = useState<BasemapType>("osm");
  const [coords, setCoords] = useState<string>("Click on the map to read coordinates");

  useEffect(() => {
    if (!mapRef.current) return;
    useGeographic();

    // Create the base tile layer.
    const getBasemapSource = (type: BasemapType) => {
      switch (type) {
        case "satellite":
          // Esri World Imagery (free, no API key needed)
          return new XYZ({
            url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            attributions: "Esri, Maxar, Earthstar Geographics",
            maxZoom: 19,
          });
        case "topo":
          // OpenTopoMap (free topographic basemap)
          return new XYZ({
            url: "https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png",
            attributions: "OpenTopoMap (CC-BY-SA)",
            maxZoom: 17,
          });
        case "osm":
        default:
          return new OSM();
      }
    };

    const tileLayer = new Tile({ source: getBasemapSource(basemap) });

    // Vector layer for survey overlays (boundaries, beacons).
    const vectorSource = new VectorSource();
    const vectorLayer = new VectorLayer({
      source: vectorSource,
      style: new Style({
        fill: new Fill({ color: "rgba(255, 149, 0, 0.15)" }),
        stroke: new Stroke({ color: "#FF9500", width: 2 }),
      }),
    });

    const map = new Map({
      target: mapRef.current,
      layers: [tileLayer, vectorLayer],
      view: new View({
        center: fromLonLat([36.8172, -1.2864]), // Nairobi
        zoom: 12,
      }),
      controls: defaultControls().extend([new ScaleLine()]),
    });

    mapInstance.current = map;

    // Click handler — read coordinates.
    map.on("click", (event) => {
      const [lon, lat] = toLonLat(event.coordinate);
      setCoords(`Lat: ${lat.toFixed(6)}, Lon: ${lon.toFixed(6)}`);
    });

    return () => {
      map.setTarget(undefined);
      mapInstance.current = null;
    };
  }, [basemap]);

  // Demo: add a sample parcel polygon (Nairobi, Kasarani area).
  const addSampleParcel = () => {
    if (!mapInstance.current) return;
    const layers = mapInstance.current.getLayers().getArray();
    const vLayer = layers.find((l) => l instanceof VectorLayer) as VectorLayer | undefined;
    if (!vLayer) return;
    const source = vLayer.getSource() as VectorSource;
    source.clear();

    // Sample 4-point parcel in lat/lon (approximately UTM 37S coords
    // converted to WGS84 for display on the basemap).
    const coords: [number, number][] = [
      [36.8170, -1.2860],
      [36.8175, -1.2860],
      [36.8175, -1.2865],
      [36.8170, -1.2865],
    ];
    const projected = coords.map(([lon, lat]) => fromLonLat([lon, lat]));

    const polygon = new Feature({
      geometry: new OlPolygon([projected]),
    });
    polygon.setStyle(new Style({
      fill: new Fill({ color: "rgba(255, 149, 0, 0.15)" }),
      stroke: new Stroke({ color: "#FF9500", width: 2 }),
      text: new TextStyle({
        text: "Sample Parcel",
        font: "12px JetBrains Mono, monospace",
        fill: new Fill({ color: "#FF9500" }),
        offsetY: -15,
      }),
    }));
    source.addFeature(polygon);

    // Add beacon markers.
    for (let i = 0; i < projected.length; i++) {
      const point = new Feature({
        geometry: new Point(projected[i]!),
      });
      point.setStyle(new Style({
        image: new CircleStyle({
          radius: 5,
          fill: new Fill({ color: "#FF9500" }),
          stroke: new Stroke({ color: "#ffffff", width: 1 }),
        }),
        text: new TextStyle({
          text: `B${i + 1}`,
          font: "10px JetBrains Mono, monospace",
          fill: new Fill({ color: "#2dd4bf" }),
          offsetX: 8,
          offsetY: -8,
        }),
      }));
      source.addFeature(point);
    }

    // Zoom to the parcel.
    mapInstance.current.getView().fit(source.getExtent(), { padding: [50, 50, 50, 50] });
  };

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%" }}>
      <h2 className="view-title">Map View</h2>
      <p className="view-subtitle">
        Satellite / street basemap with survey overlay. Click on the map to read coordinates.
        This view uses OpenLayers (~500KB, lazy-loaded only when you open it).
      </p>

      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <label>Basemap:</label>
        <select value={basemap} onChange={(e) => setBasemap(e.target.value as BasemapType)} style={{ minWidth: "150px" }}>
          <option value="osm">OpenStreetMap (street)</option>
          <option value="satellite">Esri World Imagery (satellite)</option>
          <option value="topo">OpenTopoMap (topographic)</option>
        </select>
        <button className="primary" onClick={addSampleParcel}>Add Sample Parcel</button>
      </div>

      {/* Map container */}
      <div
        ref={mapRef}
        style={{
          width: "100%",
          flex: 1,
          minHeight: "400px",
          background: "var(--bg-tertiary)",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border-default)",
        }}
      />

      {/* Coordinate readout */}
      <div style={{
        padding: "8px 12px",
        background: "var(--bg-tertiary)",
        borderRadius: "var(--radius-sm)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-sm)",
        color: "var(--text-secondary)",
      }}>
        {coords}
      </div>
    </div>
  );
};
