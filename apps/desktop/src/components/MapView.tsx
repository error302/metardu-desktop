import { useEffect, useRef } from 'react';
import OlMap from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import OSM from 'ol/source/OSM';
import Point from 'ol/geom/Point';
import Feature from 'ol/Feature';
import { fromLonLat } from 'ol/proj';
import { Style, Circle as CircleStyle, Fill, Stroke, Text as StyleText } from 'ol/style';
import type { SurveyPoint, ProjectRow } from '../../electron/preload.js';

interface MapViewProps {
  points: SurveyPoint[];
  project: ProjectRow | null;
}

/**
 * OpenLayers map showing imported survey points.
 *
 * For the walking skeleton:
 *   - OSM basemap (online; mbtiles offline cache comes in M5)
 *   - Points rendered as orange circles with point_number labels
 *   - Auto-zoom to the bounding box of all points on first render
 *
 * NOTE: For the walking skeleton we assume coordinates are already in
 * EPSG:3857 (Web Mercator) for display. M2 will wire the proper CRS
 * transform from the project's default_crs_epsg to EPSG:3857 for display.
 */
export function MapView({ points, project }: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<OlMap | null>(null);
  const vectorSourceRef = useRef<VectorSource>(new VectorSource());

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = new OlMap({
      target: mapRef.current,
      layers: [
        new TileLayer({ source: new OSM() }),
        new VectorLayer({
          source: vectorSourceRef.current,
          style: (feature) => new Style({
            image: new CircleStyle({
              radius: 6,
              fill: new Fill({ color: '#D97706' }),
              stroke: new Stroke({ color: '#0B2545', width: 2 }),
            }),
            text: new StyleText({
              text: feature.get('point_number') ?? '',
              offsetY: -12,
              font: '600 11px Inter, sans-serif',
              fill: new Fill({ color: '#0B2545' }),
              stroke: new Stroke({ color: '#ffffff', width: 3 }),
            }),
          }),
        }),
      ],
      view: new View({
        center: fromLonLat([36.82, -1.29]),  // Nairobi
        zoom: 11,
      }),
      controls: [],
    });

    mapInstanceRef.current = map;

    return () => {
      map.setTarget(undefined);
      mapInstanceRef.current = null;
    };
  }, []);

  // Update points on the map when they change
  useEffect(() => {
    const source = vectorSourceRef.current;
    source.clear();

    if (points.length === 0) return;

    const features: Feature<Point>[] = points.map((p) => {
      const feature = new Feature({
        geometry: new Point([p.easting, p.northing]),
        point_number: p.point_number,
        code: p.code,
        elevation: p.elevation,
      });
      return feature;
    });
    source.addFeatures(features);

    // Auto-zoom to bounding box
    if (mapInstanceRef.current && features.length > 0) {
      const extent = source.getExtent();
      mapInstanceRef.current.getView().fit(extent, { padding: [80, 80, 80, 80], maxZoom: 17 });
    }
  }, [points]);

  return (
    <div className="map-container">
      <div ref={mapRef} className="ol-map" />
      {points.length === 0 && (
        <div className="map-overlay">
          <div className="map-overlay-card">
            <h3>Start Here</h3>
            <ol>
              <li>Click <strong>Import CSV</strong> in the top right.</li>
              <li>Select a CSV with columns: <code>point_number, easting, northing, elevation, code, description</code></li>
              <li>Points will appear on the map and in the sidebar.</li>
            </ol>
            <p className="map-overlay-note">
              For the walking skeleton, coordinates should be in Web Mercator (EPSG:3857).
              CRS transforms arrive in M2.
            </p>
          </div>
        </div>
      )}
      {project && (
        <div className="map-crs-badge">
          EPSG:{project.default_crs_epsg} · {project.country_pack}
        </div>
      )}
    </div>
  );
}
