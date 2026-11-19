import { describe, expect, it } from "vitest";
import { Point, LineString } from "ol/geom";
import { Style } from "ol/style";
import { topographicOverlayFeatures } from "../renderer/topographic-overlay.js";
import type { MapGeometry } from "../renderer/map-geometry.js";
const geometry: MapGeometry = {
 beacons:[], boundaries:[],
 fieldPoints:[{label:"P01",easting:500000,northing:9850000},{label:"P02",easting:500010,northing:9850010}],
 contours:[{elevation:100.25,closed:false,vertices:[{label:"",easting:500000,northing:9850000},{label:"",easting:500010,northing:9850010}]}],
};
// Independently supplied geodesy results; this renderer must not perform CRS math.
const projected = (e:number,n:number):[number,number] | null => e===500000 && n===9850000 ? [39,-1.35] : e===500010 && n===9850010 ? [39.00009,-1.34991] : null;
describe("topographic GIS overlay",()=>{
 it("renders named field points at the supplied geographic coordinates",()=>{
  const features=topographicOverlayFeatures(geometry,projected,{fieldPoints:true,contours:false});
  expect(features).toHaveLength(2);
  expect((features[0]!.getGeometry() as Point).getCoordinates()).toEqual([39,-1.35]);
  expect(features[0]!.get("label")).toBe("P01");
  expect((features[0]!.getStyle() as Style).getText()?.getText()).toBe("P01");
 });
 it("retains contour vertices and elevation without smoothing or joining",()=>{
  const features=topographicOverlayFeatures(geometry,projected,{fieldPoints:false,contours:true});
  expect(features).toHaveLength(1);
  expect((features[0]!.getGeometry() as LineString).getCoordinates()).toEqual([[39,-1.35],[39.00009,-1.34991]]);
  expect(features[0]!.get("elevation")).toBe(100.25);
 });
 it("honours both layer switches",()=>expect(topographicOverlayFeatures(geometry,projected,{fieldPoints:false,contours:false})).toEqual([]));
 it("refuses to bridge across a missing projected contour vertex",()=>{
  const broken={...geometry,contours:[{...geometry.contours[0]!,vertices:[...geometry.contours[0]!.vertices,{label:"",easting:999,northing:999}]}]};
  expect(topographicOverlayFeatures(broken,projected,{fieldPoints:false,contours:true})).toEqual([]);
 });
});
