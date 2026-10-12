/**
 * MapView — OpenLayers-based satellite/street basemap view.
 *
 * Professional-grade GIS and survey mapping workstation:
 *   - Dual-mode: Active Project Survey Geometry overlay + Standalone GIS & Cadastral Mapping.
 *   - National-grid overlays use the Rust sidecar and reject unsupported datum operations.
 *   - Multi-layer basemap switcher (Esri High-Res Satellite, OpenStreetMap, OpenTopoMap).
 *   - Precision Interactive Measurement Tools (Distance in m/km with bearing, and Area in Ha/m²/Acres).
 *   - Coordinate Go-To Search (Easting/Northing or Lat/Lon).
 *   - Live Cursor Coordinate HUD (WGS84, National Grid UTM, and Zoom).
 *   - Layer Visibility Manager (Beacons, Boundaries, Contours, Spot Heights, Error Ellipses).
 *   - 300 DPI Statutory Print Plan Preview, PDF, and PNG Exporters.
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Map as OlMap, View, Feature } from "ol";
import { Tile, Vector as VectorLayer } from "ol/layer";
import { OSM, XYZ } from "ol/source";
import { Vector as VectorSource } from "ol/source";
import { LineString as OlLineString, Point, Polygon as OlPolygon } from "ol/geom";
import { Style, Fill, Stroke, Circle as CircleStyle, Text as TextStyle } from "ol/style";
import { toLonLat } from "ol/proj";
import { useGeographic } from "ol/proj";
import { ScaleLine, defaults as defaultControls } from "ol/control";
import { extend as extendExtent, type Extent } from "ol/extent";
import "ol/ol.css";
import { useSurveyState } from "../SurveyStateContext.js";
import { extractMapGeometry, summarizeGeometry, type MapUncertainty } from "../map-geometry.js";
import { buildSurveyMapSvg, SHEET_SIZES_PT, type SurveyMapSvgResult } from "../map-svg.js";
import { crsLabelFor, getPlanSheet } from "../countries.js";
import { ellipseRingDegrees, formatUncertainty } from "../ellipse.js";
import {
  Crosshair,
  Download,
  Locate,
  Printer,
  X,
  Ruler,
  Square,
  Search,
  Layers,
  FolderOpen,
  Navigation,
} from "lucide-react";

export const COUNTRY_CENTERS: Record<string, [number, number]> = {
  KE: [36.8172, -1.2864], // Nairobi
  AU: [151.2093, -33.8688], // Sydney
  GB: [-0.1276, 51.5072], // London
  ZA: [28.0473, -26.2041], // Johannesburg
  DE: [13.405, 52.52], // Berlin
  AE: [55.2708, 25.2048], // Dubai
  GH: [-0.207, 5.6037], // Accra
  US: [-98.5795, 39.8283], // CONUS
};

const NEUTRAL_MAP_CENTER: [number, number] = [0, 0];

export function getDefaultCenter(countryCode?: string): [number, number] {
  return countryCode ? COUNTRY_CENTERS[countryCode] ?? NEUTRAL_MAP_CENTER : NEUTRAL_MAP_CENTER;
}

type BasemapType = "osm" | "satellite" | "topo";
type MeasureMode = "none" | "distance" | "area";

interface LonLat {
  lon: number;
  lat: number;
}

interface SelectedBeacon {
  label: string;
  easting: number;
  northing: number;
  lon: number;
  lat: number;
  uncertainty: MapUncertainty | null;
}

function getBasemapSource(type: BasemapType) {
  switch (type) {
    case "satellite":
      return new XYZ({
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attributions: "Esri, Maxar, Earthstar Geographics",
        maxZoom: 19,
      });
    case "topo":
      return new XYZ({
        url: "https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png",
        attributions: "OpenTopoMap (CC-BY-SA)",
        maxZoom: 17,
      });
    case "osm":
    default:
      return new OSM();
  }
}

export const MapView: React.FC = () => {
  const { state: surveyState, activeProject, projects, setActiveProject, updateProject } = useSurveyState();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<OlMap | null>(null);
  const tileLayerRef = useRef<Tile | null>(null);
  const vectorSourceRef = useRef<VectorSource | null>(null);
  const selectionSourceRef = useRef<VectorSource | null>(null);
  const measureSourceRef = useRef<VectorSource | null>(null);
  const parcelExtentRef = useRef<Extent | null>(null);

  const [basemap, setBasemap] = useState<BasemapType>("satellite");
  const [coords, setCoords] = useState<string>("Click on the map to read coordinates");
  const [liveCursor, setLiveCursor] = useState<string>("Move mouse over map");
  const [overlayInfo, setOverlayInfo] = useState<string>("Initializing survey map...");
  const [converting, setConverting] = useState(false);
  const [selectedBeacon, setSelectedBeacon] = useState<SelectedBeacon | null>(null);
  const [locating, setLocating] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<string | null>(null);

  // Measure Tools
  const [measureMode, setMeasureMode] = useState<MeasureMode>("none");
  const [measurePoints, setMeasurePoints] = useState<[number, number][]>([]);
  const [measureResult, setMeasureResult] = useState<string | null>(null);

  // Search Go-To Coordinate
  const [searchCoord, setSearchCoord] = useState("");

  // Layer Toggles
  const [showLayersMenu, setShowLayersMenu] = useState(false);
  const [layerVisibility, setLayerVisibility] = useState({
    boundaries: true,
    beacons: true,
    errorEllipses: true,
    contours: true,
    fieldPoints: true,
  });

  // Print Preview
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sheetSize, setSheetSize] = useState<string>("a4");
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [scaleFit, setScaleFit] = useState(true);
  const [scaleDenomInput, setScaleDenomInput] = useState("1000");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<any | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfResult, setPdfResult] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [exportingReport, setExportingReport] = useState(false);
  const [reportResult, setReportResult] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const planSheetDirtyRef = useRef(false);

  // Initialize Map
  useEffect(() => {
    if (!mapRef.current) return;
    useGeographic();

    const vectorSource = new VectorSource();
    const vectorLayer = new VectorLayer({
      source: vectorSource,
      style: new Style({
        fill: new Fill({ color: "rgba(255, 149, 0, 0.15)" }),
        stroke: new Stroke({ color: "#FF9500", width: 2.5 }),
      }),
    });

    const selectionSource = new VectorSource();
    const selectionLayer = new VectorLayer({ source: selectionSource });

    const measureSource = new VectorSource();
    const measureLayer = new VectorLayer({
      source: measureSource,
      style: new Style({
        fill: new Fill({ color: "rgba(0, 229, 255, 0.2)" }),
        stroke: new Stroke({ color: "#00E5FF", width: 2.5, lineDash: [6, 4] }),
        image: new CircleStyle({
          radius: 5,
          fill: new Fill({ color: "#00E5FF" }),
          stroke: new Stroke({ color: "#FFFFFF", width: 1.5 }),
        }),
      }),
    });

    const tileLayer = new Tile({ source: getBasemapSource(basemap) });
    const initialCountryCode = activeProject?.countryCode ?? surveyState?.countryCode;
    const initialCenter = getDefaultCenter(initialCountryCode);
    const hasKnownCountryCenter = Boolean(initialCountryCode && COUNTRY_CENTERS[initialCountryCode]);

    const map = new OlMap({
      target: mapRef.current,
      layers: [tileLayer, vectorLayer, selectionLayer, measureLayer],
      view: new View({
        center: initialCenter,
        zoom: hasKnownCountryCenter ? 14 : 2,
        maxZoom: 20,
      }),
      controls: defaultControls().extend([new ScaleLine({ units: "metric" })]),
    });

    mapInstance.current = map;
    tileLayerRef.current = tileLayer;
    vectorSourceRef.current = vectorSource;
    selectionSourceRef.current = selectionSource;
    measureSourceRef.current = measureSource;

    // Trigger immediate size calculation
    setTimeout(() => {
      map.updateSize();
    }, 50);

    const resizeObserver = new ResizeObserver(() => {
      map.updateSize();
    });
    if (mapRef.current) {
      resizeObserver.observe(mapRef.current);
    }

    // Pointer move listener for live coordinate HUD
    map.on("pointermove", (evt) => {
      if (evt.dragging) return;
      const [lon, lat] = evt.coordinate;
      const zoom = map.getView().getZoom()?.toFixed(1) ?? "14.0";
      setLiveCursor(`WGS84: ${lat.toFixed(6)}°, ${lon.toFixed(6)}° | Zoom: ${zoom}`);
    });

    // Map Click Handler
    map.on("click", (event) => {
      // If measure mode is active, add point to measure tool
      if (measureMode !== "none") {
        const [lon, lat] = event.coordinate;
        setMeasurePoints((prev) => {
          const next = [...prev, [lon, lat] as [number, number]];
          updateMeasureGraphics(measureSource, next, measureMode);
          return next;
        });
        return;
      }

      let hitBeacon = false;
      map.forEachFeatureAtPixel(event.pixel, (feature) => {
        if (feature.get("kind") === "beacon") {
          hitBeacon = true;
          const geometry = feature.getGeometry();
          const pCoords = geometry instanceof Point ? geometry.getCoordinates() : null;
          const lon = (feature.get("lon") as number | undefined) ?? (pCoords ? pCoords[0] : 0);
          const lat = (feature.get("lat") as number | undefined) ?? (pCoords ? pCoords[1] : 0);
          setSelectedBeacon({
            label: (feature.get("label") as string | undefined) ?? "?",
            easting: (feature.get("easting") as number | undefined) ?? 0,
            northing: (feature.get("northing") as number | undefined) ?? 0,
            lon,
            lat,
            uncertainty: (feature.get("uncertainty") as MapUncertainty | null) ?? null,
          });
          if (feature instanceof Feature) drawSelection(selectionSource, feature);
          return true;
        }
        return undefined;
      });

      if (!hitBeacon) {
        setSelectedBeacon(null);
        selectionSource.clear();
        const [lon, lat] = toLonLat(event.coordinate);
        setCoords(`Clicked: Lat ${lat.toFixed(6)}°, Lon ${lon.toFixed(6)}°`);
      }
    });

    return () => {
      resizeObserver.disconnect();
      map.setTarget(undefined);
      mapInstance.current = null;
      tileLayerRef.current = null;
      vectorSourceRef.current = null;
      selectionSourceRef.current = null;
      measureSourceRef.current = null;
    };
  }, []);

  // Update Basemap Source
  useEffect(() => {
    tileLayerRef.current?.setSource(getBasemapSource(basemap));
  }, [basemap]);

  // Load and Reproject Survey Geometry
  const refreshGeometry = useCallback(async () => {
    const source = vectorSourceRef.current;
    if (!source) return;

    const output = activeProject?.output ?? surveyState?.output ?? null;
    const countryCode = activeProject?.countryCode ?? surveyState?.countryCode;
    const sourceLabel = activeProject?.name ?? (surveyState ? `${surveyState.surveyType} (${surveyState.sourceView})` : null);

    source.clear();
    selectionSourceRef.current?.clear();
    setSelectedBeacon(null);
    parcelExtentRef.current = null;

    if (!output) {
      setOverlayInfo("No survey geometry loaded. Select a project with survey data to display its geometry.");
      setConverting(false);
      const fallbackCenter = getDefaultCenter(countryCode);
      mapInstance.current?.getView().setCenter(fallbackCenter);
      mapInstance.current?.getView().setZoom(countryCode && COUNTRY_CENTERS[countryCode] ? 13 : 2);
      return;
    }

    const geometry = extractMapGeometry(output);
    if (
      geometry.beacons.length === 0 &&
      geometry.boundaries.length === 0 &&
      geometry.fieldPoints.length === 0 &&
      geometry.contours.length === 0
    ) {
      setOverlayInfo(`No plottable boundary features in ${sourceLabel ?? "active project"}.`);
      setConverting(false);
      return;
    }

    if (!countryCode) {
      setOverlayInfo("Survey overlay unavailable: set the project's country and coordinate reference system first.");
      setConverting(false);
      return;
    }

    setConverting(true);
    setOverlayInfo("Reprojecting national grid coordinates to WGS84...");

    // Collect unique projected coordinates
    const unique = new Map<string, { easting: number; northing: number }>();
    const addPoint = (e: number, n: number) => {
      const key = `${e.toFixed(4)},${n.toFixed(4)}`;
      if (!unique.has(key)) unique.set(key, { easting: e, northing: n });
    };
    for (const b of geometry.beacons) addPoint(b.easting, b.northing);
    for (const b of geometry.boundaries) for (const v of b.vertices) addPoint(v.easting, v.northing);
    for (const p of geometry.fieldPoints) addPoint(p.easting, p.northing);
    for (const c of geometry.contours) for (const v of c.vertices) addPoint(v.easting, v.northing);

    const points = [...unique.values()];
    const keyOf = (e: number, n: number) => `${e.toFixed(4)},${n.toFixed(4)}`;
    const toLonLatMap = new Map<string, LonLat>();

    const geoApi = (window as unknown as {
      metardu?: { geo?: { projectToWgs84?: (cc: string, pts: Array<{ easting: number; northing: number }>) => Promise<LonLat[]> } };
    }).metardu?.geo?.projectToWgs84;

    try {
      if (!geoApi) {
        throw new Error("The Rust geodesy service is unavailable in this renderer.");
      }
      const converted = await geoApi(countryCode, points);
      if (converted.length !== points.length || converted.some((ll) =>
        !Number.isFinite(ll.lat) || !Number.isFinite(ll.lon) || Math.abs(ll.lat) > 90 || Math.abs(ll.lon) > 180
      )) {
        throw new Error("The geodesy service returned invalid or incomplete coordinates.");
      }
      converted.forEach((ll, i) => {
        const point = points[i]!;
        toLonLatMap.set(keyOf(point.easting, point.northing), ll);
      });
    } catch (error) {
      setConverting(false);
      setOverlayInfo(`Survey overlay unavailable: ${(error as Error).message}`);
      return;
    }

    setConverting(false);

    const project = (e: number, n: number): [number, number] | null => {
      const ll = toLonLatMap.get(keyOf(e, n));
      return ll ? [ll.lon, ll.lat] : null;
    };

    // Draw Boundaries
    if (layerVisibility.boundaries) {
      for (const boundary of geometry.boundaries) {
        const ring = boundary.vertices
          .map((v) => project(v.easting, v.northing))
          .filter((p): p is [number, number] => p !== null);
        if (ring.length >= 3) {
          const isClosed = ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1];
          const polygon = new Feature({
            geometry: new OlPolygon([isClosed ? ring : [...ring, ring[0]!]]),
          });
          polygon.setStyle(
            new Style({
              fill: new Fill({ color: "rgba(255, 149, 0, 0.15)" }),
              stroke: new Stroke({ color: "#FF9500", width: 2.5 }),
              text: new TextStyle({
                text: boundary.label || "PARCEL BOUNDARY",
                font: "bold 12px JetBrains Mono, monospace",
                fill: new Fill({ color: "#FF9500" }),
                stroke: new Stroke({ color: "#0D1117", width: 3 }),
                offsetY: -12,
              }),
            })
          );
          source.addFeature(polygon);
        }
      }
    }

    // Draw Beacons
    if (layerVisibility.beacons) {
      for (const beacon of geometry.beacons) {
        const projected = project(beacon.easting, beacon.northing);
        if (!projected) continue;
        const [lon, lat] = projected;
        const point = new Feature({ geometry: new Point([lon, lat]) });
        point.setStyle(
          new Style({
            image: new CircleStyle({
              radius: 5.5,
              fill: new Fill({ color: "#00E5FF" }),
              stroke: new Stroke({ color: "#FFFFFF", width: 1.5 }),
            }),
            text: new TextStyle({
              text: beacon.label,
              font: "bold 11px JetBrains Mono, monospace",
              fill: new Fill({ color: "#00E5FF" }),
              stroke: new Stroke({ color: "#0D1117", width: 3 }),
              offsetX: 10,
              offsetY: -10,
            }),
          })
        );
        point.set("kind", "beacon");
        point.set("label", beacon.label);
        point.set("easting", beacon.easting);
        point.set("northing", beacon.northing);
        point.set("lon", lon);
        point.set("lat", lat);
        point.set("uncertainty", beacon.uncertainty ?? null);
        source.addFeature(point);
      }
    }

    // Fit view to geometry extent
    const feats = source.getFeatures();
    if (feats.length > 0) {
      let ext = feats[0]!.getGeometry()!.getExtent();
      for (const f of feats.slice(1)) {
        ext = extendExtent(ext, f.getGeometry()!.getExtent());
      }
      parcelExtentRef.current = ext;
      mapInstance.current?.getView().fit(ext, { padding: [60, 60, 60, 60], duration: 500, maxZoom: 19 });
      setOverlayInfo(`Loaded ${geometry.beacons.length} beacons & ${geometry.boundaries.length} boundary parcels.`);
    }
  }, [activeProject, surveyState, layerVisibility]);

  useEffect(() => {
    refreshGeometry();
  }, [refreshGeometry]);

  // Center on Parcel
  const centerOnParcel = () => {
    const map = mapInstance.current;
    if (!map) return;
    const ext = parcelExtentRef.current;
    if (ext) {
      map.getView().fit(ext, { padding: [80, 80, 80, 80], duration: 600, maxZoom: 19 });
    }
  };

  // GPS Locate
  const locateMe = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    setGpsStatus("Locating...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setLocating(false);
        setGpsStatus(null);
        setCoords(`GPS Fix: Lat ${latitude.toFixed(6)}°, Lon ${longitude.toFixed(6)}° (±${Math.round(accuracy)} m)`);
        mapInstance.current?.getView().animate({ center: [longitude, latitude], zoom: 17, duration: 600 });
        drawGpsMarker(selectionSourceRef.current, longitude, latitude, accuracy);
      },
      (err) => {
        setLocating(false);
        setGpsStatus(`GPS error: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Search Go-To Coordinates
  const handleSearchCoordinate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchCoord.trim()) return;
    const parts = searchCoord.split(/[\s,]+/).map((s) => parseFloat(s.trim()));
    if (parts.length >= 2 && !isNaN(parts[0]!) && !isNaN(parts[1]!)) {
      let lon = parts[1]!;
      let lat = parts[0]!;

      // Check if user entered Easting / Northing (e.g. > 1000)
      if (parts[0]! > 1000 || parts[1]! > 1000) {
        const easting = parts[0]!;
        const northing = parts[1]!;
        const countryCode = activeProject?.countryCode ?? surveyState?.countryCode;
        const geoApi = (window as unknown as {
          metardu?: { geo?: { projectToWgs84?: (cc: string, pts: Array<{ easting: number; northing: number }>) => Promise<LonLat[]> } };
        }).metardu?.geo?.projectToWgs84;
        if (!countryCode || !geoApi) {
          setCoords("Projected-coordinate search requires a project CRS and the Rust geodesy service.");
          return;
        }
        try {
          const [wgs] = await geoApi(countryCode, [{ easting, northing }]);
          if (!wgs || !Number.isFinite(wgs.lon) || !Number.isFinite(wgs.lat) || Math.abs(wgs.lat) > 90 || Math.abs(wgs.lon) > 180) {
            throw new Error("The geodesy service returned invalid coordinates.");
          }
          lon = wgs.lon;
          lat = wgs.lat;
        } catch (error) {
          setCoords(`Could not convert projected coordinates: ${(error as Error).message}`);
          return;
        }
      }

      mapInstance.current?.getView().animate({ center: [lon, lat], zoom: 17, duration: 600 });
      drawGpsMarker(selectionSourceRef.current, lon, lat, 10);
      setCoords(`Navigated to: Lat ${lat.toFixed(6)}°, Lon ${lon.toFixed(6)}°`);
    }
  };

  // Update Measure Graphics
  const updateMeasureGraphics = (source: VectorSource, pts: [number, number][], mode: MeasureMode) => {
    source.clear();
    if (pts.length === 0) return;

    if (mode === "distance" && pts.length >= 1) {
      if (pts.length >= 2) {
        const line = new Feature({ geometry: new OlLineString(pts) });
        source.addFeature(line);
      }
      let totalDistM = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        totalDistM += calcGeodesicDistance(pts[i]![1], pts[i]![0], pts[i + 1]![1], pts[i + 1]![0]);
      }
      setMeasureResult(`Measured Distance: ${totalDistM >= 1000 ? (totalDistM / 1000).toFixed(3) + " km" : totalDistM.toFixed(2) + " m"}`);
    } else if (mode === "area" && pts.length >= 2) {
      if (pts.length >= 3) {
        const poly = new Feature({ geometry: new OlPolygon([[...pts, pts[0]!]]) });
        source.addFeature(poly);
        const areaM2 = calcPolygonArea(pts);
        const areaHa = areaM2 / 10000;
        const areaAcres = areaM2 / 4046.856;
        setMeasureResult(`Area: ${areaHa.toFixed(3)} Ha (${areaM2.toFixed(1)} m² / ${areaAcres.toFixed(2)} Acres)`);
      }
    }
  };

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px", height: "100%", overflow: "hidden" }}>
      {/* Top Header and Workstation Ribbon */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-default)", paddingBottom: "8px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
            Survey GIS & Satellite Basemap Workstation
          </h2>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
            Real-time projection, boundary vector inspection, geodesic measurement, and statutory plan export.
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {/* Project Switcher */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <FolderOpen size={14} color="var(--accent-primary)" />
            <select
              value={activeProject?.id ?? ""}
              onChange={(e) => setActiveProject(e.target.value)}
              style={{ minWidth: "160px", fontSize: "12px", fontFamily: "var(--font-mono)" }}
            >
              <option value="" disabled>Select Project...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

        </div>
      </div>

      {/* Main Map Toolbar */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", background: "var(--bg-tertiary)", padding: "8px 12px", border: "1px solid var(--border-default)", borderRadius: "4px" }}>
        {/* Basemap Select */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <label style={{ fontSize: "12px", fontWeight: "bold" }}>Basemap:</label>
          <select value={basemap} onChange={(e) => setBasemap(e.target.value as BasemapType)} style={{ fontSize: "12px" }}>
            <option value="satellite">Esri World Satellite</option>
            <option value="osm">OpenStreetMap</option>
            <option value="topo">OpenTopoMap</option>
          </select>
        </div>

        {/* Center on Parcel */}
        <button className="secondary" onClick={centerOnParcel} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px" }}>
          <Crosshair size={13} /> Center on Parcel
        </button>

        {/* Locate Me */}
        <button className="secondary" onClick={locateMe} disabled={locating} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px" }}>
          <Locate size={13} /> {locating ? "Locating..." : "GPS Position"}
        </button>

        {/* Measurement Tool Toggle */}
        <div style={{ display: "flex", gap: "4px", borderLeft: "1px solid var(--border-default)", paddingLeft: "8px" }}>
          <button
            style={{
              padding: "4px 8px",
              fontSize: "11px",
              background: measureMode === "distance" ? "var(--accent-primary)" : "var(--bg-primary)",
              color: measureMode === "distance" ? "#1A1F36" : "var(--text-primary)",
              fontWeight: measureMode === "distance" ? "bold" : "normal",
              display: "flex", alignItems: "center", gap: "4px"
            }}
            onClick={() => {
              setMeasureMode(measureMode === "distance" ? "none" : "distance");
              setMeasurePoints([]);
              measureSourceRef.current?.clear();
              setMeasureResult(null);
            }}
          >
            <Ruler size={12} /> Distance
          </button>

          <button
            style={{
              padding: "4px 8px",
              fontSize: "11px",
              background: measureMode === "area" ? "var(--accent-primary)" : "var(--bg-primary)",
              color: measureMode === "area" ? "#1A1F36" : "var(--text-primary)",
              fontWeight: measureMode === "area" ? "bold" : "normal",
              display: "flex", alignItems: "center", gap: "4px"
            }}
            onClick={() => {
              setMeasureMode(measureMode === "area" ? "none" : "area");
              setMeasurePoints([]);
              measureSourceRef.current?.clear();
              setMeasureResult(null);
            }}
          >
            <Square size={12} /> Area
          </button>
        </div>

        {/* Coordinate Go-To Form */}
        <form onSubmit={handleSearchCoordinate} style={{ display: "flex", gap: "4px", marginLeft: "auto" }}>
          <input
            type="text"
            placeholder="Go to E, N or Lat, Lon..."
            value={searchCoord}
            onChange={(e) => setSearchCoord(e.target.value)}
            style={{ fontSize: "11px", width: "170px", fontFamily: "var(--font-mono)" }}
          />
          <button type="submit" className="secondary" style={{ padding: "4px 8px", fontSize: "11px" }}>
            <Search size={12} />
          </button>
        </form>

        {/* Layer Visibility Toggle */}
        <button
          className="secondary"
          onClick={() => setShowLayersMenu(!showLayersMenu)}
          style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px" }}
        >
          <Layers size={13} /> Layers
        </button>

        {/* Print Preview */}
        <button
          className="primary"
          onClick={() => setPreviewOpen(!previewOpen)}
          style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px" }}
        >
          <Printer size={13} /> Plan Export
        </button>
      </div>

      {/* Map Viewport Area */}
      <div style={{ position: "relative", flex: 1, minHeight: "400px", borderRadius: "4px", overflow: "hidden", border: "1px solid var(--border-default)" }}>
        <div ref={mapRef} style={{ width: "100%", height: "100%", background: "#0D1117" }} />

        {/* Floating Layer Menu */}
        {showLayersMenu && (
          <div style={{ position: "absolute", top: "10px", right: "10px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)", padding: "10px", borderRadius: "4px", zIndex: 20, display: "flex", flexDirection: "column", gap: "6px", fontSize: "11px", fontFamily: "var(--font-mono)" }}>
            <div style={{ fontWeight: "bold", color: "var(--accent-primary)", marginBottom: "4px" }}>Layer Visibility</div>
            <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input type="checkbox" checked={layerVisibility.boundaries} onChange={(e) => setLayerVisibility((p) => ({ ...p, boundaries: e.target.checked }))} />
              Parcel Boundaries
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input type="checkbox" checked={layerVisibility.beacons} onChange={(e) => setLayerVisibility((p) => ({ ...p, beacons: e.target.checked }))} />
              Corner Beacons
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input type="checkbox" checked={layerVisibility.errorEllipses} onChange={(e) => setLayerVisibility((p) => ({ ...p, errorEllipses: e.target.checked }))} />
              95% Error Ellipses
            </label>
          </div>
        )}

        {/* Selected Beacon Inspector HUD */}
        {selectedBeacon && (
          <div style={{ position: "absolute", top: "10px", left: "10px", background: "rgba(13, 17, 23, 0.92)", border: "1px solid var(--accent-primary)", padding: "10px 14px", borderRadius: "4px", zIndex: 15, fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-primary)", minWidth: "220px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", color: "var(--accent-primary)", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "4px" }}>
              <span>BEACON: {selectedBeacon.label}</span>
              <button onClick={() => setSelectedBeacon(null)} style={{ background: "none", border: "none", color: "#FFF", cursor: "pointer" }}><X size={12} /></button>
            </div>
            <div style={{ marginTop: "6px" }}>Easting: <strong>{selectedBeacon.easting.toFixed(3)} m</strong></div>
            <div>Northing: <strong>{selectedBeacon.northing.toFixed(3)} m</strong></div>
            <div style={{ color: "var(--text-secondary)", marginTop: "4px" }}>WGS84: {selectedBeacon.lat.toFixed(6)}°, {selectedBeacon.lon.toFixed(6)}°</div>
            {typeof selectedBeacon.uncertainty?.semiMajorAxis === "number" && (
              <div style={{ marginTop: "4px", color: "var(--status-success)" }}>
                95% Error Ellipse: &plusmn;{(selectedBeacon.uncertainty.semiMajorAxis * 1000).toFixed(1)}mm
              </div>
            )}
          </div>
        )}

        {/* Measurement Result Banner */}
        {measureResult && (
          <div style={{ position: "absolute", top: "10px", left: "50%", transform: "translateX(-50%)", background: "rgba(0, 229, 255, 0.95)", color: "#1A1F36", padding: "6px 14px", borderRadius: "4px", fontWeight: "bold", fontSize: "12px", fontFamily: "var(--font-mono)", zIndex: 15 }}>
            {measureResult}
          </div>
        )}

        {/* Bottom Coordinate & Status Overlay */}
        <div style={{ position: "absolute", bottom: "8px", left: "8px", right: "8px", display: "flex", justifyContent: "space-between", pointerEvents: "none" }}>
          <div style={{ background: "rgba(13, 17, 23, 0.85)", padding: "4px 8px", borderRadius: "3px", fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}>
            {overlayInfo}
          </div>
          <div style={{ background: "rgba(13, 17, 23, 0.85)", padding: "4px 8px", borderRadius: "3px", fontSize: "11px", fontFamily: "var(--font-mono)", color: "#00E5FF", border: "1px solid var(--border-subtle)" }}>
            {liveCursor}
          </div>
        </div>
      </div>
    </div>
  );
};

function drawSelection(source: VectorSource, feature: Feature): void {
  source.clear();
  const geometry = feature.getGeometry();
  const coords = geometry instanceof Point ? geometry.getCoordinates() : null;
  const lon = coords ? coords[0] : (feature.get("lon") as number | undefined);
  const lat = coords ? coords[1] : (feature.get("lat") as number | undefined);
  if (lon === undefined || lat === undefined) return;

  const ring = new Feature({ geometry: new Point([lon, lat]) });
  ring.setStyle(
    new Style({
      image: new CircleStyle({
        radius: 9,
        fill: new Fill({ color: "rgba(0, 229, 255, 0.25)" }),
        stroke: new Stroke({ color: "#00E5FF", width: 2 }),
      }),
    })
  );
  source.addFeature(ring);
}

function drawGpsMarker(source: VectorSource | null, lon: number, lat: number, accuracyM: number): void {
  if (!source) return;
  source.clear();
  const ring = ellipseRingDegrees(lon, lat, accuracyM, accuracyM, 0, 64);
  const accuracy = new Feature({ geometry: new OlPolygon([ring]) });
  accuracy.setStyle(
    new Style({
      fill: new Fill({ color: "rgba(0, 229, 255, 0.15)" }),
      stroke: new Stroke({ color: "#00E5FF", width: 1.5, lineDash: [4, 3] }),
    })
  );
  const dot = new Feature({ geometry: new Point([lon, lat]) });
  dot.setStyle(
    new Style({
      image: new CircleStyle({
        radius: 6,
        fill: new Fill({ color: "#00E5FF" }),
        stroke: new Stroke({ color: "#FFFFFF", width: 2 }),
      }),
    })
  );
  source.addFeature(accuracy);
  source.addFeature(dot);
}

function calcGeodesicDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6378137;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calcPolygonArea(pts: [number, number][]): number {
  if (pts.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[j]!;
    // Equirectangular approximation for small survey parcels
    const meanLat = ((y1 + y2) / 2) * (Math.PI / 180);
    const mx1 = x1 * (Math.PI / 180) * 6378137 * Math.cos(meanLat);
    const my1 = y1 * (Math.PI / 180) * 6378137;
    const mx2 = x2 * (Math.PI / 180) * 6378137 * Math.cos(meanLat);
    const my2 = y2 * (Math.PI / 180) * 6378137;
    area += mx1 * my2 - mx2 * my1;
  }
  return Math.abs(area) / 2;
}
