import { Feature } from "ol";
import { Point, LineString } from "ol/geom";
import { Circle, Fill, Stroke, Style, Text } from "ol/style";
import type { MapGeometry } from "./map-geometry.js";

/** Render retained topography using only coordinates supplied by the Rust operation. */
export function topographicOverlayFeatures(
  geometry: MapGeometry,
  project: (e: number, n: number) => [number, number] | null,
  visible: { fieldPoints: boolean; contours: boolean },
): Feature[] {
  const features: Feature[] = [];
  if (visible.contours) {
    for (const contour of geometry.contours) {
      const vertices = contour.vertices.map(p => project(p.easting, p.northing));
      // Missing projection must never silently join the remaining vertices.
      if (vertices.length < 2 || vertices.some(p => !p || !p.every(Number.isFinite))) continue;
      const feature = new Feature({ geometry: new LineString(vertices as [number, number][]), kind: "contour", elevation: contour.elevation });
      feature.setStyle([
        new Style({ stroke: new Stroke({ color: "rgba(13,17,23,0.85)", width: 4.5 }) }),
        new Style({ stroke: new Stroke({ color: "#FFBC66", width: 2.2 }) }),
      ]);
      features.push(feature);
    }
  }
  if (visible.fieldPoints) {
    for (const point of geometry.fieldPoints) {
      const coordinate = project(point.easting, point.northing);
      if (!coordinate || !coordinate.every(Number.isFinite)) continue;
      const feature = new Feature({ geometry: new Point(coordinate), kind: "fieldPoint", label: point.label,
        easting: point.easting, northing: point.northing, lon: coordinate[0], lat: coordinate[1] });
      feature.setStyle(new Style({
        image: new Circle({ radius: 4.5, fill: new Fill({ color: "#00E5FF" }), stroke: new Stroke({ color: "#0D1117", width: 2 }) }),
        text: new Text({ text: point.label, font: "bold 11px JetBrains Mono, monospace", offsetX: 9, offsetY: -11,
          textAlign: "left", fill: new Fill({ color: "#FFFFFF" }), stroke: new Stroke({ color: "#0D1117", width: 3 }) }),
      }));
      features.push(feature);
    }
  }
  return features;
}
