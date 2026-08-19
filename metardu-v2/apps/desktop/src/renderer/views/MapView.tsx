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
 *   - Basemap selector: satellite (Esri), street (OSM), topo (OSM)
 *   - Vector overlay: draws the ACTIVE PROJECT's real survey geometry —
 *     beacons (labeled markers), boundaries (parcel/alignment), and
 *     field points — converted from the country's projected CRS to
 *     WGS84 via the sidecar (metardu:geo:projectToWgs84). The hardcoded
 *     "Sample Parcel" demo is now only a fallback for empty state.
 *   - Click to read coordinates (lat/lon → projected)
 *   - Scale bar + north arrow (built into OpenLayers)
 *
 * # Data flow
 *
 *   SurveyStateContext (active project output)
 *     → extractMapGeometry (pure normalizer for any workflow shape)
 *     → window.metardu.geo.projectToWgs84 (sidecar inverse projection)
 *     → OpenLayers features on the basemap
 *
 * # Bundle impact
 *
 *   OpenLayers adds ~500KB to the bundle. By lazy-loading this view
 *   (via React.lazy in main.tsx), that cost is only paid when the user
 *   actually opens the Map view — not on app startup.
 */

import React, { useEffect, useRef, useState } from "react";
import { Map, View, Feature } from "ol";
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
import { Crosshair, Download, Locate, Printer, X } from "lucide-react";

type BasemapType = "osm" | "satellite" | "topo";

/** WGS84 lon/lat for a projected easting/northing. */
interface LonLat {
  lon: number;
  lat: number;
}

/** A beacon the user clicked in the map, with its coordinates + uncertainty. */
interface SelectedBeacon {
  label: string;
  /** Projected survey coordinates (country CRS, metres). */
  easting: number;
  northing: number;
  /** WGS84 display coordinates (the feature's actual map position). */
  lon: number;
  lat: number;
  uncertainty: MapUncertainty | null;
}

function getBasemapSource(type: BasemapType) {
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
}

// crsLabelFor is the shared datum-deduped CRS label from countries.ts
// (mirrors the main process's resolveCrsLabel via crsLabelForCountry), so
// the print preview matches the exported PNG exactly.

export const MapView: React.FC = () => {
  const { state: surveyState, activeProject, updateProject } = useSurveyState();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<Map | null>(null);
  const tileLayerRef = useRef<Tile | null>(null);
  const vectorSourceRef = useRef<VectorSource | null>(null);
  // Selection overlay (beacon highlight + error ellipse + GPS marker) sits
  // above the survey layer so click feedback never fights the data.
  const selectionSourceRef = useRef<VectorSource | null>(null);
  // Union extent of the parcel boundaries (WGS84) for the centre-on-parcel
  // fly-to; recomputed every time the survey data loads.
  const parcelExtentRef = useRef<Extent | null>(null);
  const [basemap, setBasemap] = useState<BasemapType>("osm");
  const [coords, setCoords] = useState<string>("Click on the map to read coordinates");
  const [overlayInfo, setOverlayInfo] = useState<string>("No survey data loaded yet.");
  const [converting, setConverting] = useState(false);
  const [selectedBeacon, setSelectedBeacon] = useState<SelectedBeacon | null>(null);
  const [locating, setLocating] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfResult, setPdfResult] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [exportingReport, setExportingReport] = useState(false);
  const [reportResult, setReportResult] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  // ─── Print preview state ───────────────────────────────────────────
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sheetSize, setSheetSize] = useState<string>("a4");
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [scaleFit, setScaleFit] = useState(true);
  const [scaleDenomInput, setScaleDenomInput] = useState("1000");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<PrintPreviewMeta | null>(null);
  // Dirty flag: set by the control handlers when the user changes a print
  // choice; cleared after a persist write or a project switch. Guards the
  // debounced write so loading values never bumps the project version.
  const planSheetDirtyRef = useRef(false);

  // ─── Map lifecycle (mount only — basemap swaps swap the tile source) ──
  useEffect(() => {
    if (!mapRef.current) return;
    useGeographic();

    // Vector layer bound to a ref'd source so the data-loading effect can
    // populate it without recreating the map.
    const vectorSource = new VectorSource();
    const vectorLayer = new VectorLayer({
      source: vectorSource,
      style: new Style({
        fill: new Fill({ color: "rgba(255, 149, 0, 0.15)" }),
        stroke: new Stroke({ color: "#FF9500", width: 2 }),
      }),
    });
    // Selection overlay: beacon highlight ring, error ellipse, GPS marker.
    const selectionSource = new VectorSource();
    const selectionLayer = new VectorLayer({ source: selectionSource });
    const tileLayer = new Tile({ source: getBasemapSource("osm") });

    const map = new Map({
      target: mapRef.current,
      layers: [tileLayer, vectorLayer, selectionLayer],
      view: new View({
        center: [36.8172, -1.2864], // Nairobi (lon/lat under useGeographic)
        zoom: 12,
      }),
      controls: defaultControls().extend([new ScaleLine()]),
    });

    mapInstance.current = map;
    tileLayerRef.current = tileLayer;
    vectorSourceRef.current = vectorSource;
    selectionSourceRef.current = selectionSource;

    // Click handler — read coordinates, or inspect a beacon when one is
    // hit (its label, projected + WGS84 coordinates, and error ellipse).
    map.on("click", (event) => {
      let hitBeacon = false;
      map.forEachFeatureAtPixel(event.pixel, (feature) => {
        if (feature.get("kind") === "beacon") {
          hitBeacon = true;
          const geometry = feature.getGeometry();
          const coords = geometry instanceof Point ? geometry.getCoordinates() : null;
          // Selection-layer features (highlight ring / error ellipse) carry
          // the beacon's WGS84 position as metadata; the survey-layer point
          // feature has it in its geometry. Either way the panel gets real
          // coordinates — never Null Island.
          const lon = (feature.get("lon") as number | undefined) ?? (coords ? coords[0] : 0);
          const lat = (feature.get("lat") as number | undefined) ?? (coords ? coords[1] : 0);
          setSelectedBeacon({
            label: (feature.get("label") as string | undefined) ?? "?",
            easting: (feature.get("easting") as number | undefined) ?? 0,
            northing: (feature.get("northing") as number | undefined) ?? 0,
            lon,
            lat,
            uncertainty: (feature.get("uncertainty") as MapUncertainty | null) ?? null,
          });
          drawSelection(selectionSource, feature);
          return true; // stop at the first beacon hit
        }
        return undefined;
      });
      if (!hitBeacon) {
        setSelectedBeacon(null);
        selectionSource.clear();
        const [lon, lat] = toLonLat(event.coordinate);
        setCoords(`Lat: ${lat.toFixed(6)}, Lon: ${lon.toFixed(6)}`);
      }
    });

    return () => {
      map.setTarget(undefined);
      mapInstance.current = null;
      tileLayerRef.current = null;
      vectorSourceRef.current = null;
      selectionSourceRef.current = null;
    };
  }, []);

  // ─── Basemap swap (no map recreation — just swap the tile source) ─────
  useEffect(() => {
    tileLayerRef.current?.setSource(getBasemapSource(basemap));
  }, [basemap]);

  // ─── Load the active project's real survey geometry ───────────────────
  // Prefer the persisted active project; fall back to the in-memory survey
  // state (e.g. browser mode without a project store). Re-runs whenever the
  // active project or survey output changes.
  useEffect(() => {
    const source = vectorSourceRef.current;
    if (!source) return;

    const output = activeProject?.output ?? surveyState?.output ?? null;
    const countryCode = activeProject?.countryCode ?? surveyState?.countryCode ?? "KE";
    const sourceLabel = activeProject?.name ?? (surveyState ? `${surveyState.surveyType} (${surveyState.sourceView})` : null);

    let cancelled = false;
    (async () => {
      source.clear();
      // A new project / output invalidates any previous selection (beacon
      // popup, GPS marker, error ellipse) and the parcel fly-to extent.
      selectionSourceRef.current?.clear();
      setSelectedBeacon(null);
      parcelExtentRef.current = null;
      if (!output) {
        setOverlayInfo("No survey data loaded yet — run a workflow view or load the demo parcel.");
        setConverting(false);
        // Reset to the default Nairobi extent so an empty project doesn't
        // leave the map stranded at the previous project's zoom.
        mapInstance.current?.getView().setCenter([36.8172, -1.2864]);
        mapInstance.current?.getView().setZoom(12);
        return;
      }

      const geometry = extractMapGeometry(output);
      if (
        geometry.beacons.length === 0 &&
        geometry.boundaries.length === 0 &&
        geometry.fieldPoints.length === 0 &&
        geometry.contours.length === 0
      ) {
        setOverlayInfo(`No plottable geometry in ${sourceLabel ?? "this survey"} output.`);
        setConverting(false);
        return;
      }

      const geoApi = (window as unknown as {
        metardu?: { geo?: { projectToWgs84?: (cc: string, pts: Array<{ easting: number; northing: number }>) => Promise<LonLat[]> } };
      }).metardu?.geo?.projectToWgs84;

      // Collect the unique projected points we need to convert.
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

      if (geoApi) {
        setConverting(true);
        try {
          const converted = await geoApi(countryCode, points);
          converted.forEach((ll, i) => {
            toLonLatMap.set(keyOf(points[i]!.easting, points[i]!.northing), ll);
          });
        } catch (err) {
          if (cancelled) return;
          source.clear();
          setOverlayInfo(`Couldn't place survey geometry: ${(err as Error).message}`);
          setConverting(false);
          return;
        }
        if (cancelled) return;
        setConverting(false);
      } else {
        // Browser mode (no Electron bridge) — show the parcel ring but tell
        // the user reprojection is unavailable, so coordinates are placeholders.
        if (cancelled) return;
        setOverlayInfo("Running in browser mode — real survey geometry needs the Electron app (sidecar reprojection). Loading demo parcel instead.");
        drawSampleParcel(source, mapInstance);
        return;
      }

      const project = (e: number, n: number): [number, number] | null => {
        const ll = toLonLatMap.get(keyOf(e, n));
        if (!ll) {
          // All unique points are converted before drawing, so this is
          // effectively unreachable — but never silently place a feature at
          // Null Island (0,0); skip it and surface the gap.
          console.warn(`[MapView] missing WGS84 conversion for E=${e}, N=${n}`);
          return null;
        }
        return [ll.lon, ll.lat];
      };

      // ── Boundaries (parcel ring / alignment polyline) ────────────────
      for (const boundary of geometry.boundaries) {
        const ring = boundary.vertices
          .map((v) => project(v.easting, v.northing))
          .filter((p): p is [number, number] => p !== null);
        const isRing =
          ring.length >= 4 &&
          ring[0]![0] === ring[ring.length - 1]![0] &&
          ring[0]![1] === ring[ring.length - 1]![1];
        if (ring.length < (isRing ? 4 : 2)) continue;

        const polygon = new Feature({
          geometry: new OlPolygon([isRing ? ring : [...ring, ring[0]!]]),
        });
        polygon.setStyle(new Style({
          fill: new Fill({ color: "rgba(255, 149, 0, 0.12)" }),
          stroke: new Stroke({ color: "#FF9500", width: 2.5 }),
          text: new TextStyle({
            text: boundary.label,
            font: "12px JetBrains Mono, monospace",
            fill: new Fill({ color: "#FF9500" }),
            stroke: new Stroke({ color: "#1A1F36", width: 3 }),
            offsetY: -10,
          }),
        }));
        source.addFeature(polygon);
      }

      // ── Beacons (labeled markers) ─────────────────────────────────────
      for (const beacon of geometry.beacons) {
        const projected = project(beacon.easting, beacon.northing);
        if (!projected) continue;
        const [lon, lat] = projected;
        const point = new Feature({ geometry: new Point([lon, lat]) });
        point.setStyle(new Style({
          image: new CircleStyle({
            radius: 5,
            fill: new Fill({ color: "#FF9500" }),
            stroke: new Stroke({ color: "#ffffff", width: 1.5 }),
          }),
          text: new TextStyle({
            text: beacon.label,
            font: "11px JetBrains Mono, monospace",
            fill: new Fill({ color: "#2dd4bf" }),
            stroke: new Stroke({ color: "#1A1F36", width: 3 }),
            offsetX: 9,
            offsetY: -9,
          }),
        }));
        // Beacon metadata for the click-to-inspect handler: the survey's
        // projected coordinates + WGS84 position + error ellipse (when
        // LS-adjusted). The WGS84 pair is also copied onto the selection
        // features so clicking the ellipse/ring keeps the panel open.
        point.set("kind", "beacon");
        point.set("label", beacon.label);
        point.set("easting", beacon.easting);
        point.set("northing", beacon.northing);
        point.set("lon", lon);
        point.set("lat", lat);
        point.set("uncertainty", beacon.uncertainty ?? null);
        source.addFeature(point);
      }

      // ── Field points (TIN vertices, spot heights, design points) ──────
      for (const fp of geometry.fieldPoints) {
        const projected = project(fp.easting, fp.northing);
        if (!projected) continue;
        const [lon, lat] = projected;
        const point = new Feature({ geometry: new Point([lon, lat]) });
        point.setStyle(new Style({
          image: new CircleStyle({
            radius: 2.5,
            fill: new Fill({ color: "#2dd4bf" }),
            stroke: new Stroke({ color: "#1A1F36", width: 1 }),
          }),
        }));
        source.addFeature(point);
      }

      // ── Contours (topographic elevation lines) ───────────────────────
      // Green polylines matching SurveyCanvas; closed rings get an
      // explicit closure vertex so the stroke never leaves a gap.
      for (const contour of geometry.contours) {
        const line = contour.vertices
          .map((v) => project(v.easting, v.northing))
          .filter((p): p is [number, number] => p !== null);
        if (line.length < 2) continue;
        const lineFeature = new Feature({
          geometry: new OlLineString(contour.closed ? [...line, line[0]!] : line),
        });
        lineFeature.setStyle(new Style({
          stroke: new Stroke({ color: "#22c55e", width: 1.4 }),
        }));
        source.addFeature(lineFeature);
      }

      // Remember the parcel (boundary) extent for the centre-on-parcel
      // fly-to — boundaries only, so field points / control spread never
      // pull the fly-to off the parcel itself.
      const boundaryFeatures = source.getFeatures().filter((f) => f.getGeometry() instanceof OlPolygon);
      if (boundaryFeatures.length > 0) {
        let ext = boundaryFeatures[0]!.getGeometry()!.getExtent();
        for (const bf of boundaryFeatures.slice(1)) {
          ext = extendExtent(ext, bf.getGeometry()!.getExtent());
        }
        parcelExtentRef.current = ext;
      }

      // Fit the map to the survey extent.
      if (source.getFeatures().length > 0) {
        mapInstance.current?.getView().fit(source.getExtent(), { padding: [60, 60, 60, 60], maxZoom: 18 });
      }

      setOverlayInfo(
        `${sourceLabel ? `Project: ${sourceLabel} — ` : ""}${summarizeGeometry(geometry)} (${countryCode} → WGS84 via sidecar)`,
      );
    })();

    return () => { cancelled = true; };
  }, [activeProject, surveyState]);

  // ─── Per-project plan-sheet settings ────────────────────────────────
  // Load the ACTIVE PROJECT's remembered print choices (sheet size,
  // orientation, scale) so every project keeps its own plan settings
  // across restarts and sync. When the project has no saved planSheet
  // (or none yet), adopt the statutory defaults from its country's
  // planSheet profile (ZA → A1, US → letter, …).
  useEffect(() => {
    const ps = activeProject?.planSheet;
    const country = activeProject?.countryCode ?? surveyState?.countryCode;
    const profile = getPlanSheet(country);
    // Saved settings win where present; any field the project hasn't saved
    // yet falls back to the country's statutory default — so switching
    // projects never leaks the previous project's scale/denominator.
    setSheetSize(ps?.sheetSize ?? profile.defaultSheetSize);
    setOrientation(ps?.orientation ?? profile.defaultOrientation);
    setScaleFit(ps?.scaleFit ?? true);
    setScaleDenomInput(ps?.scaleDenominator !== undefined ? String(ps.scaleDenominator) : "1000");
    // Reset the dirty flag: the values we just loaded (or defaulted to)
    // are the baseline — no persist write fires until the user actually
    // changes a control, so switching projects never bumps the version.
    planSheetDirtyRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, activeProject?.countryCode, surveyState?.countryCode]);

  // Persist plan-sheet choices back to the active project, debounced,
  // ONLY when the user changed something (dirty flag). Each persist bumps
  // the project version once, so a re-push on sync is a genuine PUT.
  useEffect(() => {
    if (!activeProject || !planSheetDirtyRef.current) return;
    const timer = window.setTimeout(() => {
      planSheetDirtyRef.current = false;
      void updateProject(activeProject.id, {
        planSheet: {
          sheetSize,
          orientation,
          scaleFit,
          scaleDenominator: scaleFit ? undefined : parseFloat(scaleDenomInput) || undefined,
        },
      });
    }, 350);
    return () => window.clearTimeout(timer);
    // Keyed on the id (not the whole object): the write only needs the id,
    // and unrelated projects broadcasts (background workflow persists, sync
    // fetches) must not cancel and re-schedule an in-flight debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, sheetSize, orientation, scaleFit, scaleDenomInput, updateProject]);

  // ─── Print preview — live SVG of exactly what sharp will rasterize ───
  // Pure renderer-side build (map-svg.ts has no Node deps), so the panel
  // works even in browser mode. Rebuilds whenever the project/output or
  // the sheet/orientation/scale settings change.
  useEffect(() => {
    if (!previewOpen) return;
    const output = activeProject?.output ?? surveyState?.output ?? null;
    if (!output) {
      setPreviewUrl(null);
      setPreviewMeta(null);
      return;
    }
    const geometry = extractMapGeometry(output);
    const country = activeProject?.countryCode ?? surveyState?.countryCode;
    const planSheet = getPlanSheet(country);
    const built: SurveyMapSvgResult = buildSurveyMapSvg(geometry, {
      title: activeProject?.name ?? surveyState?.surveyType ?? "Survey Plan",
      coordinateSystemLabel: crsLabelFor(country),
      date: new Date().toISOString().split("T")[0],
      sheetSize,
      orientation,
      scaleMode: scaleFit
        ? { mode: "fit" }
        : { mode: "fixed", denominator: parseFloat(scaleDenomInput) || 0 },
      titleBlockLabel: planSheet.titleBlockLabel,
      planTypeLabel: planSheet.planTypeLabel,
      footerNote: planSheet.footerNote,
      titleBlockLayout: planSheet.titleBlockLayout,
    });
    const url = URL.createObjectURL(
      new Blob([built.svg], { type: "image/svg+xml;charset=utf-8" }),
    );
    setPreviewUrl(url);
    setPreviewMeta({
      widthPx: built.widthPx,
      heightPx: built.heightPx,
      scaleDenominator: built.scaleDenominator,
      fitsSheet: built.fitsSheet,
    });
    return () => { URL.revokeObjectURL(url); };
  }, [previewOpen, activeProject, surveyState, sheetSize, orientation, scaleFit, scaleDenomInput]);

  // Demo fallback — a hardcoded 4-beacon parcel in WGS84 (browser mode /
  // empty state only). The real path above is what production uses.
  const addSampleParcel = () => {
    const source = vectorSourceRef.current;
    if (!source) return;
    source.clear();
    drawSampleParcel(source, mapInstance);
    parcelExtentRef.current = source.getExtent();
    setOverlayInfo("Demo parcel (hardcoded WGS84) — run a workflow to plot real survey geometry.");
  };

  // ─── Centre on parcel (animated fly-to) ───────────────────────────
  // Fits the view to the parcel boundaries with an animated transition.
  // Falls back to the whole survey extent when no boundaries exist (e.g.
  // an engineering alignment project).
  const centerOnParcel = () => {
    const map = mapInstance.current;
    if (!map) return;
    const ext = parcelExtentRef.current;
    if (ext) {
      map.getView().fit(ext, { padding: [90, 90, 90, 90], duration: 600, maxZoom: 19 });
      return;
    }
    const source = vectorSourceRef.current;
    if (source && source.getFeatures().length > 0) {
      map.getView().fit(source.getExtent(), { padding: [90, 90, 90, 90], duration: 600, maxZoom: 19 });
      return;
    }
    setCoords("Nothing to centre on — load survey data or a demo parcel first.");
  };

  // ─── GPS locate control ───────────────────────────────────────────
  // One-shot high-accuracy fix via the browser geolocation API (works in
  // the Electron renderer); flies to the position and draws a marker with
  // the accuracy circle. Failures surface in the status line, never crash.
  const locateMe = () => {
    const nav = navigator.geolocation;
    if (!nav) {
      setGpsStatus("Geolocation is not available in this environment.");
      return;
    }
    setLocating(true);
    setGpsStatus("Locating…");
    nav.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setLocating(false);
        setGpsStatus(null);
        setSelectedBeacon(null);
        setCoords(`GPS: Lat ${latitude.toFixed(6)}, Lon ${longitude.toFixed(6)} (±${Math.round(accuracy)} m)`);
        mapInstance.current?.getView().animate({
          center: [longitude, latitude],
          zoom: 17,
          duration: 700,
        });
        drawGpsMarker(selectionSourceRef.current, longitude, latitude, accuracy);
      },
      (err) => {
        setLocating(false);
        setGpsStatus(`GPS locate failed: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  };

  // Shared style for the toolbar icon buttons.
  const toolBtnStyle: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "6px 12px", borderRadius: "6px",
    border: "1px solid var(--border-default)",
    background: "var(--bg-elevated, #FFFFFF)",
    color: "var(--text-primary)", fontSize: "12px", fontWeight: 500,
    cursor: "pointer",
  };

  // 300 DPI map export — main process rasterizes the real project geometry
  // (extracted from the same output the overlay uses) with sharp.
  // Single-page PDF export — the same plan sheet rendered to a print-grade
  // PDF (no flight-plan report wrapper), honouring the preview's sheet,
  // orientation, and scale choices. Mirrors exportMapPng.
  const exportMapPdf = async () => {
    setExportingPdf(true);
    setPdfResult(null);
    setPdfError(null);
    try {
      const w = window as unknown as {
        metardu?: { map?: { exportPdf?: (input: {
          surveyOutput: unknown;
          projectName: string;
          countryCode?: string;
          surveyorName?: string;
          sheetSize?: string;
          orientation?: "landscape" | "portrait";
          scaleDenominator?: number;
        }) => Promise<{ canceled: true } | { canceled: false; filePath: string; bytes: number; widthPx: number; heightPx: number; scaleDenominator: number; fitsSheet: boolean; summary: string }> } };
      };
      const api = w.metardu?.map?.exportPdf;
      if (!api) {
        setPdfError("PDF export not available — run in the Electron app.");
        return;
      }
      const output = activeProject?.output ?? surveyState?.output ?? null;
      if (!output) {
        setPdfError("No survey output to export — run a workflow first.");
        return;
      }
      const result = await api({
        surveyOutput: output,
        projectName: activeProject?.name ?? surveyState?.surveyType ?? "Survey Plan",
        countryCode: activeProject?.countryCode ?? surveyState?.countryCode ?? "KE",
        sheetSize,
        orientation,
        scaleDenominator: scaleFit ? undefined : parseFloat(scaleDenomInput) || undefined,
      });
      if (result.canceled) {
        setPdfResult("Export cancelled.");
      } else {
        setPdfResult(
          `Saved single-page PDF (${result.widthPx}×${result.heightPx}px embedded, scale 1:${result.scaleDenominator}) → ${result.filePath}`,
        );
      }
    } catch (e) {
      setPdfError((e as Error).message);
    } finally {
      setExportingPdf(false);
    }
  };

  // Statutory survey report PDF — the same plan sheet the preview shows
  // (same sheet/orientation/scale choices, same renderSurveyMapPng path in
  // main) embedded as the report's survey-map page behind an A4 cover. The
  // report's map page therefore matches the print-preview pixel-for-pixel.
  const exportMapReport = async () => {
    setExportingReport(true);
    setReportResult(null);
    setReportError(null);
    try {
      const w = window as unknown as {
        metardu?: { map?: { exportReport?: (input: {
          surveyOutput: unknown;
          projectName: string;
          countryCode?: string;
          surveyorName?: string;
          sheetSize?: string;
          orientation?: "landscape" | "portrait";
          scaleDenominator?: number;
        }) => Promise<{ canceled: true } | { canceled: false; filePath: string; bytes: number; widthPx: number; heightPx: number; scaleDenominator: number; fitsSheet: boolean; summary: string }> } };
      };
      const api = w.metardu?.map?.exportReport;
      if (!api) {
        setReportError("Statutory report export not available — run in the Electron app.");
        return;
      }
      const output = activeProject?.output ?? surveyState?.output ?? null;
      if (!output) {
        setReportError("No survey output to export — run a workflow first.");
        return;
      }
      const result = await api({
        surveyOutput: output,
        projectName: activeProject?.name ?? surveyState?.surveyType ?? "Survey Plan",
        countryCode: activeProject?.countryCode ?? surveyState?.countryCode ?? "KE",
        sheetSize,
        orientation,
        scaleDenominator: scaleFit ? undefined : parseFloat(scaleDenomInput) || undefined,
      });
      if (result.canceled) {
        setReportResult("Export cancelled.");
      } else {
        setReportResult(
          `Saved statutory report (${(result.bytes / 1024).toFixed(1)} KB, map page ${result.widthPx}×${result.heightPx}px, scale 1:${result.scaleDenominator}) → ${result.filePath}`,
        );
      }
    } catch (e) {
      setReportError((e as Error).message);
    } finally {
      setExportingReport(false);
    }
  };

  // 300 DPI map export — main process rasterizes the real project geometry
  // (extracted from the same output the overlay uses) with sharp, honouring
  // the print-preview's sheet/orientation/scale choices.
  const exportMapPng = async () => {
    setExporting(true);
    setExportResult(null);
    setExportError(null);
    try {
      const w = window as unknown as {
        metardu?: { map?: { exportPng?: (input: {
          surveyOutput: unknown;
          projectName: string;
          countryCode?: string;
          surveyorName?: string;
          sheetSize?: string;
          orientation?: "landscape" | "portrait";
          scaleDenominator?: number;
        }) => Promise<{ canceled: true } | { canceled: false; filePath: string; bytes: number; widthPx: number; heightPx: number; scaleDenominator: number; fitsSheet: boolean; summary: string }> } };
      };
      const api = w.metardu?.map?.exportPng;
      if (!api) {
        setExportError("Map export not available — run in the Electron app.");
        return;
      }
      const output = activeProject?.output ?? surveyState?.output ?? null;
      if (!output) {
        setExportError("No survey output to export — run a workflow first.");
        return;
      }
      const result = await api({
        surveyOutput: output,
        projectName: activeProject?.name ?? surveyState?.surveyType ?? "Survey Plan",
        countryCode: activeProject?.countryCode ?? surveyState?.countryCode ?? "KE",
        sheetSize,
        orientation,
        scaleDenominator: scaleFit ? undefined : parseFloat(scaleDenomInput) || undefined,
      });
      if (result.canceled) {
        setExportResult("Export cancelled.");
      } else {
        setExportResult(
          `Saved 300 DPI PNG (${result.widthPx}×${result.heightPx}px, scale 1:${result.scaleDenominator}, ${result.summary}) → ${result.filePath}`,
        );
      }
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%" }}>
      <h2 className="view-title">Map View</h2>
      <p className="view-subtitle">
        Satellite / street basemap with the active project's real survey overlay.
        Click on the map to read coordinates. Uses OpenLayers (~500KB, lazy-loaded only when opened).
      </p>

      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <label>Basemap:</label>
        <select value={basemap} onChange={(e) => setBasemap(e.target.value as BasemapType)} style={{ minWidth: "150px" }}>
          <option value="osm">OpenStreetMap (street)</option>
          <option value="satellite">Esri World Imagery (satellite)</option>
          <option value="topo">OpenTopoMap (topographic)</option>
        </select>
        <button className="primary" onClick={addSampleParcel} disabled={converting}>
          {converting ? "Reprojecting…" : "Load Demo Parcel"}
        </button>
        <button
          onClick={centerOnParcel}
          disabled={converting}
          title="Fly to the surveyed parcel"
          style={toolBtnStyle}
        >
          <Crosshair size={14} strokeWidth={2} />
          Center on parcel
        </button>
        <button
          onClick={locateMe}
          disabled={locating}
          title="Show your GPS position on the map"
          style={toolBtnStyle}
        >
          <Locate size={14} strokeWidth={2} />
          {locating ? "Locating…" : "Locate me"}
        </button>
        <button
          onClick={() => setPreviewOpen((o) => !o)}
          disabled={converting}
          title="Print preview — pick sheet size, orientation and scale before exporting the 300 DPI PNG"
          style={{
            display: "inline-flex", alignItems: "center", gap: "6px",
            padding: "6px 12px", borderRadius: "6px", border: "1px solid var(--accent-primary)",
            background: previewOpen ? "var(--accent-primary)" : "transparent",
            color: previewOpen ? "#FFFFFF" : "var(--accent-primary)", fontSize: "12px", fontWeight: 500,
            cursor: "pointer",
          }}
        >
          <Printer size={14} strokeWidth={2} />
          {previewOpen ? "Close Print Preview" : "Print Preview & Export"}
        </button>
        {overlayInfo && (
          <span style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
            {overlayInfo}
          </span>
        )}
      </div>

      {/* Map container + print-preview overlay */}
      <div style={{ position: "relative", flex: 1, minHeight: "400px" }}>
        <div
          ref={mapRef}
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--bg-tertiary)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-default)",
          }}
        />
        {previewOpen && (
          <PrintPreviewPanel
            sheetSize={sheetSize}
            onSheetSize={(s) => { setSheetSize(s); planSheetDirtyRef.current = true; }}
            orientation={orientation}
            onOrientation={(o) => { setOrientation(o); planSheetDirtyRef.current = true; }}
            scaleFit={scaleFit}
            onScaleFit={(fit) => { setScaleFit(fit); planSheetDirtyRef.current = true; }}
            scaleDenomInput={scaleDenomInput}
            onScaleDenomInput={(v) => { setScaleDenomInput(v); planSheetDirtyRef.current = true; }}
            previewUrl={previewUrl}
            previewMeta={previewMeta}
            exporting={exporting}
            onExport={exportMapPng}
            exportResult={exportResult}
            exportError={exportError}
            exportingPdf={exportingPdf}
            onExportPdf={exportMapPdf}
            pdfResult={pdfResult}
            pdfError={pdfError}
            exportingReport={exportingReport}
            onExportReport={exportMapReport}
            reportResult={reportResult}
            reportError={reportError}
            onClose={() => setPreviewOpen(false)}
          />
        )}
      </div>

      {/* Coordinate readout / beacon inspection panel */}
      {selectedBeacon ? (
        <div style={{
          padding: "10px 14px",
          background: "var(--bg-tertiary)",
          borderRadius: "var(--radius-sm)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-sm)",
          display: "flex", flexDirection: "column", gap: 4,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <strong style={{ color: "var(--text-primary)" }}>Beacon {selectedBeacon.label}</strong>
            <span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>
              Click another beacon to compare
            </span>
            <button
              onClick={() => { setSelectedBeacon(null); selectionSourceRef.current?.clear(); }}
              title="Clear beacon selection"
              style={{
                marginLeft: "auto", background: "none", border: "none", cursor: "pointer",
                color: "var(--text-tertiary)", fontSize: 13, padding: 2,
              }}
            >
              ✕
            </button>
          </div>
          <span style={{ color: "var(--text-secondary)" }}>
            E: {fmtCoord(selectedBeacon.easting)} m · N: {fmtCoord(selectedBeacon.northing)} m
          </span>
          <span style={{ color: "var(--text-secondary)" }}>
            WGS84: {selectedBeacon.lat.toFixed(7)}, {selectedBeacon.lon.toFixed(7)}
          </span>
          <span style={{ color: selectedBeacon.uncertainty?.adjusted ? "var(--status-warning)" : "var(--text-tertiary)" }}>
            {formatUncertainty(selectedBeacon.uncertainty)}
          </span>
        </div>
      ) : (
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
      )}
      {gpsStatus && (
        <span style={{ fontSize: 11, color: "var(--status-warning)", fontFamily: "var(--font-mono)" }}>
          {gpsStatus}
        </span>
      )}
    </div>
  );
};

/** Metadata about the print-plan preview (what the 300 DPI PNG will be). */
interface PrintPreviewMeta {
  widthPx: number;
  heightPx: number;
  scaleDenominator: number;
  fitsSheet: boolean;
}

interface PrintPreviewPanelProps {
  sheetSize: string;
  onSheetSize: (s: string) => void;
  orientation: "landscape" | "portrait";
  onOrientation: (o: "landscape" | "portrait") => void;
  scaleFit: boolean;
  onScaleFit: (fit: boolean) => void;
  scaleDenomInput: string;
  onScaleDenomInput: (v: string) => void;
  previewUrl: string | null;
  previewMeta: PrintPreviewMeta | null;
  exporting: boolean;
  onExport: () => void;
  exportResult: string | null;
  exportError: string | null;
  exportingPdf: boolean;
  onExportPdf: () => void;
  pdfResult: string | null;
  pdfError: string | null;
  exportingReport: boolean;
  onExportReport: () => void;
  reportResult: string | null;
  reportError: string | null;
  onClose: () => void;
}

/**
 * Print-preview overlay: sheet size, orientation, and scale controls above
 * a live render of the exact SVG that sharp will rasterize at 300 DPI.
 * Warns (and blocks export) when a fixed scale overflows the sheet, so a
 * clipped statutory plan can't be produced silently.
 */
function PrintPreviewPanel(props: PrintPreviewPanelProps): React.ReactElement {
  const {
    sheetSize, onSheetSize, orientation, onOrientation,
    scaleFit, onScaleFit, scaleDenomInput, onScaleDenomInput,
    previewUrl, previewMeta, exporting, onExport, exportResult, exportError,
    exportingPdf, onExportPdf, pdfResult, pdfError,
    exportingReport, onExportReport, reportResult, reportError, onClose,
  } = props;

  const fixedOverflow = !scaleFit && !!previewMeta && !previewMeta.fitsSheet;
  const canExport = !!previewUrl && !exporting && !fixedOverflow;

  const toggleStyle = (active: boolean): React.CSSProperties => ({
    padding: "4px 10px", borderRadius: "var(--radius-sm)", fontSize: 12, cursor: "pointer",
    border: `1px solid ${active ? "var(--accent-primary)" : "var(--border-default)"}`,
    background: active ? "var(--accent-primary)" : "transparent",
    color: active ? "#FFFFFF" : "var(--text-secondary)",
  });

  return (
    <div
      style={{
        position: "absolute", top: 8, right: 8, bottom: 8, width: "min(400px, 42%)",
        background: "var(--bg-elevated, #FFFFFF)", border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-md)", boxShadow: "0 10px 36px rgba(10,12,28,0.22)",
        display: "flex", flexDirection: "column", overflow: "hidden", zIndex: 10,
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", borderBottom: "1px solid var(--border-default)",
      }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>Print Preview</span>
        <button onClick={onClose} title="Close print preview" style={{
          background: "none", border: "none", cursor: "pointer",
          color: "var(--text-secondary)", display: "inline-flex", padding: 2,
        }}>
          <X size={16} />
        </button>
      </div>

      {/* Sheet / orientation / scale controls */}
      <div style={{
        padding: "10px 14px", borderBottom: "1px solid var(--border-default)",
        display: "flex", flexDirection: "column", gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 72, fontSize: 12, color: "var(--text-secondary)" }}>Sheet size</span>
          <select value={sheetSize} onChange={(e) => onSheetSize(e.target.value)} style={{
            flex: 1, padding: "4px 6px", borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-default)", background: "var(--bg-tertiary)",
            color: "var(--text-primary)", fontSize: 12,
          }}>
            {Object.keys(SHEET_SIZES_PT).map((s) => (
              <option key={s} value={s}>{s.toUpperCase()}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 72, fontSize: 12, color: "var(--text-secondary)" }}>Orientation</span>
          <div style={{ display: "flex", gap: 4 }}>
            {(["landscape", "portrait"] as const).map((o) => (
              <button
                key={o}
                onClick={() => onOrientation(o)}
                aria-pressed={orientation === o}
                style={toggleStyle(orientation === o)}
              >
                {o === "landscape" ? "Landscape" : "Portrait"}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 72, fontSize: 12, color: "var(--text-secondary)" }}>Scale</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
            <button onClick={() => onScaleFit(true)} aria-pressed={scaleFit} style={toggleStyle(scaleFit)}>Fit sheet</button>
            <span style={{ fontSize: 12, color: "var(--text-secondary)", paddingLeft: 4 }}>1:</span>
            <input
              type="number"
              min={1}
              step={100}
              value={scaleDenomInput}
              disabled={scaleFit}
              onChange={(e) => onScaleDenomInput(e.target.value)}
              title="Fixed scale denominator (e.g. 500, 1000, 2500)"
              style={{
                width: 84, padding: "4px 6px", borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-default)", background: "var(--bg-tertiary)",
                color: "var(--text-primary)", fontSize: 12,
              }}
            />
            <button onClick={() => onScaleFit(false)} aria-pressed={!scaleFit} style={toggleStyle(!scaleFit)}>Fixed</button>
          </div>
        </div>
      </div>

      {/* Output meta + fit warning */}
      <div style={{
        padding: "8px 14px", borderBottom: "1px solid var(--border-default)",
        display: "flex", flexDirection: "column", gap: 3,
        fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)",
      }}>
        {previewMeta ? (
          <>
            <span>300 DPI output: {previewMeta.widthPx} × {previewMeta.heightPx} px</span>
            <span>Plan scale 1:{previewMeta.scaleDenominator.toLocaleString("en-US")}</span>
          </>
        ) : (
          <span>No survey output yet — run a workflow first.</span>
        )}
        {fixedOverflow && (
          <span style={{ color: "var(--status-error)", fontWeight: 700 }}>
            ✗ Scale 1:{previewMeta!.scaleDenominator.toLocaleString("en-US")} does not fit this sheet — use a larger sheet or a smaller scale.
          </span>
        )}
      </div>

      {/* Live plan preview — the exact SVG sharp will rasterize */}
      <div
        style={{
          flex: 1, overflow: "auto", padding: 12,
          background:
            "linear-gradient(45deg,#E4E3DE 25%,transparent 25%,transparent 75%,#E4E3DE 75%)," +
            "linear-gradient(45deg,#E4E3DE 25%,#F1F0EC 25%,#F1F0EC 75%,#E4E3DE 75%)",
          backgroundSize: "20px 20px",
          backgroundPosition: "0 0, 10px 10px",
        }}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Survey plan print preview"
            style={{
              width: "100%", background: "#FFFFFF",
              border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)",
            }}
          />
        ) : (
          <div style={{ padding: "28px 12px", textAlign: "center", fontSize: 12, color: "var(--text-tertiary)" }}>
            Run a cadastral, topographic or engineering workflow, then open the Map view — the plan preview builds automatically from the active project's real geometry.
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div style={{
        padding: "10px 14px", borderTop: "1px solid var(--border-default)",
        display: "flex", flexDirection: "column", gap: 6,
      }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={onExportPdf}
            disabled={!canExport || exportingPdf}
            title={fixedOverflow ? "The current scale overflows the sheet — fix it first." : "Save the plan sheet as a print-grade PDF (no report wrapper)"}
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              padding: "8px 12px", borderRadius: "var(--radius-sm)",
              fontSize: 12, fontWeight: 600,
              cursor: exportingPdf ? "wait" : canExport ? "pointer" : "not-allowed",
              border: `1px solid ${canExport ? "var(--accent-primary)" : "var(--border-default)"}`,
              background: canExport ? "#FFFFFF" : "var(--bg-tertiary)",
              color: canExport ? "var(--accent-primary)" : "var(--text-tertiary)",
              opacity: canExport ? 1 : 0.7,
            }}
          >
            <Download size={14} />
            {exportingPdf ? "Building PDF…" : "Save PDF"}
          </button>
          <button
            onClick={onExport}
            disabled={!canExport}
            title={fixedOverflow ? "The current scale overflows the sheet — fix it first." : "Save the 300 DPI PNG"}
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              padding: "8px 12px", borderRadius: "var(--radius-sm)",
              fontSize: 12, fontWeight: 600,
              cursor: exporting ? "wait" : canExport ? "pointer" : "not-allowed",
              border: "none", background: canExport ? "var(--accent-primary)" : "var(--bg-tertiary)",
              color: canExport ? "#FFFFFF" : "var(--text-tertiary)",
              opacity: canExport ? 1 : 0.7,
            }}
          >
            <Download size={14} />
            {exporting ? "Exporting 300 DPI…" : "Export PNG"}
          </button>
        </div>
        <button
          onClick={onExportReport}
          disabled={!canExport || exportingReport}
          title={fixedOverflow ? "The current scale overflows the sheet — fix it first." : "Save a statutory report: A4 cover + this exact plan sheet as the survey-map page"}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "8px 12px", borderRadius: "var(--radius-sm)",
            fontSize: 12, fontWeight: 600,
            cursor: exportingReport ? "wait" : canExport ? "pointer" : "not-allowed",
            border: "1px solid var(--border-default)",
            background: canExport ? "var(--bg-tertiary)" : "var(--bg-secondary)",
            color: canExport ? "var(--text-primary)" : "var(--text-tertiary)",
            opacity: canExport ? 1 : 0.7,
          }}
        >
          <Download size={14} />
          {exportingReport ? "Building report…" : "Save Statutory Report (PDF)"}
        </button>
        {reportResult && (
          <span style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>✓ {reportResult}</span>
        )}
        {reportError && (
          <span style={{ fontSize: 11, color: "var(--status-error)", fontFamily: "var(--font-mono)" }}>✗ {reportError}</span>
        )}
        {pdfResult && (
          <span style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>✓ {pdfResult}</span>
        )}
        {pdfError && (
          <span style={{ fontSize: 11, color: "var(--status-error)", fontFamily: "var(--font-mono)" }}>✗ {pdfError}</span>
        )}
        {exportResult && (
          <span style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>✓ {exportResult}</span>
        )}
        {exportError && (
          <span style={{ fontSize: 11, color: "var(--status-error)", fontFamily: "var(--font-mono)" }}>✗ {exportError}</span>
        )}
      </div>
    </div>
  );
}

/** Format a survey coordinate with thousands separators. */
function fmtCoord(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

/**
 * Draw the beacon selection overlay: a highlight ring at the beacon and,
 * when the beacon carries an LS-adjusted error ellipse, the ellipse
 * polygon itself (dashed, semi-transparent) scaled from metres to local
 * WGS84 degrees. Clears any previous selection (incl. a GPS marker).
 */
function drawSelection(source: VectorSource, feature: Feature): void {
  source.clear();
  // The hit feature may be the survey-layer beacon point OR a selection
  // feature redrawn in a previous click (ring / ellipse). Both carry the
  // beacon's WGS84 position: the point feature in its geometry, the
  // selection features as metadata copied below.
  const geometry = feature.getGeometry();
  const coords = geometry instanceof Point ? geometry.getCoordinates() : null;
  const lon = coords ? coords[0] : (feature.get("lon") as number | undefined);
  const lat = coords ? coords[1] : (feature.get("lat") as number | undefined);
  if (lon === undefined || lat === undefined || !Number.isFinite(lon) || !Number.isFinite(lat)) return;

  // Copy the beacon's metadata onto the selection features so clicking the
  // highlight ring or the error ellipse keeps the inspection panel open
  // instead of dismissing it — they are part of the selected beacon.
  const meta: Record<string, unknown> = {
    kind: "beacon",
    label: feature.get("label"),
    easting: feature.get("easting"),
    northing: feature.get("northing"),
    lon,
    lat,
    uncertainty: feature.get("uncertainty"),
  };

  const ring = new Feature({ geometry: new Point([lon, lat]) });
  ring.setProperties(meta);
  ring.setStyle(new Style({
    image: new CircleStyle({
      radius: 9,
      fill: new Fill({ color: "rgba(45, 212, 191, 0.25)" }),
      stroke: new Stroke({ color: "#2dd4bf", width: 2 }),
    }),
  }));
  source.addFeature(ring);

  const uncertainty = feature.get("uncertainty") as MapUncertainty | null;
  if (
    uncertainty?.adjusted &&
    typeof uncertainty.semiMajorAxis === "number" &&
    typeof uncertainty.semiMinorAxis === "number"
  ) {
    const ringPts = ellipseRingDegrees(
      lon, lat,
      uncertainty.semiMajorAxis,
      uncertainty.semiMinorAxis,
      uncertainty.orientation ?? 0,
    );
    if (ringPts.length >= 4) {
      const ellipse = new Feature({ geometry: new OlPolygon([ringPts]) });
      ellipse.setProperties(meta);
      ellipse.setStyle(new Style({
        fill: new Fill({ color: "rgba(45, 212, 191, 0.12)" }),
        stroke: new Stroke({ color: "#0E7490", width: 1.5, lineDash: [4, 3] }),
      }));
      source.addFeature(ellipse);
    }
  }
}

/**
 * Draw the GPS locate marker: a dot at the fix with a dashed circle of the
 * reported accuracy radius (metres → local WGS84 degrees).
 */
function drawGpsMarker(source: VectorSource | null, lon: number, lat: number, accuracyM: number): void {
  if (!source) return;
  source.clear();
  // A GPS accuracy circle is exactly an equal-axis error ellipse — reuse
  // the ellipse ring builder (same metre → local WGS84 degree conversion).
  const ring = ellipseRingDegrees(lon, lat, accuracyM, accuracyM, 0, 64);
  const accuracy = new Feature({ geometry: new OlPolygon([ring]) });
  accuracy.setStyle(new Style({
    fill: new Fill({ color: "rgba(45, 108, 223, 0.12)" }),
    stroke: new Stroke({ color: "#2d6cdf", width: 1.5, lineDash: [4, 3] }),
  }));
  const dot = new Feature({ geometry: new Point([lon, lat]) });
  dot.setStyle(new Style({
    image: new CircleStyle({
      radius: 6,
      fill: new Fill({ color: "#2d6cdf" }),
      stroke: new Stroke({ color: "#ffffff", width: 2 }),
    }),
  }));
  source.addFeature(accuracy);
  source.addFeature(dot);
}

/**
 * Draw the legacy demo parcel (4 WGS84 corners + beacon markers) into the
 * given vector source and fit the view. Used only as a browser-mode /
 * empty-state fallback — production shows the real project.
 */
function drawSampleParcel(source: VectorSource, mapInstance: React.MutableRefObject<Map | null>): void {
  const coords: [number, number][] = [
    [36.8170, -1.2860],
    [36.8175, -1.2860],
    [36.8175, -1.2865],
    [36.8170, -1.2865],
  ];

  const polygon = new Feature({
    geometry: new OlPolygon([coords]),
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

  for (let i = 0; i < coords.length; i++) {
    const point = new Feature({ geometry: new Point(coords[i]!) });
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

  mapInstance.current?.getView().fit(source.getExtent(), { padding: [50, 50, 50, 50] });
}
