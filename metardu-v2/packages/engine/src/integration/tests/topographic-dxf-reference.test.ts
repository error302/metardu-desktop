import {describe,it,expect} from "vitest";
import {dxfExporter} from "../dxf-export.js";
import {runTopographicWorkflow} from "../../workflows/topographic.js";
import {getCountryConfig} from "@metardu/country-config";
const source=getCountryConfig("GB").geodeticFramework.primarySRID;
const projectMetadata={projectName:"SYNTHETIC test",surveyorName:"synthetic fixture",licenseNumber:"SYNTHETIC-NOT-A-LICENCE",surveyDate:"2026-01-01",adjustmentRunId:"synthetic-fixture"};
function fixture(){return runTopographicWorkflow({points:[{id:"A",easting:500000,northing:9800000,elevation:10},{id:"B",easting:500020,northing:9800000,elevation:12},{id:"C",easting:500000,northing:9800020,elevation:14}],tinTriangles:[[0,1,2]],contourInterval:1,spotHeightEvery:1,coordinateContext:{horizontalCrsEpsg:source,horizontalCrsLabel:"Synthetic declared source",horizontalUnits:"m",verticalReference:"SYNTHETIC local benchmark",referenceStatus:"user-declared-unverified"}});}
function entities(bytes:Uint8Array){
 const raw=new TextDecoder().decode(bytes).trim().split(/\r?\n/),out:Array<Record<string,string>>=[];let entity:Record<string,string>|null=null;
 for(let i=0;i+1<raw.length;i+=2){const k=raw[i]!.trim(),v=raw[i+1]!.trim();if(k==="0"){entity={type:v};out.push(entity);}else if(entity)entity[k]=v;}
 return out;
}
describe("retained topographic DXF reference and heights",()=>{
 it("uses the saved explicit reference rather than relabelling to the jurisdiction",async()=>{
  const result=await dxfExporter.export(fixture(),{countryCode:"KE",projectMetadata,crsSrid:source});
  expect(result.crsUrn).toBe(`urn:ogc:def:crs:EPSG::${source}`);
  expect(new TextDecoder().decode(result.bytes)).toContain("SYNTHETIC local benchmark");
  expect(result.warnings.join(" ")).toMatch(/unverified|unadjusted|draft/i);
 });
 it("refuses an export option that contradicts the saved source",async()=>{
  await expect(dxfExporter.export(fixture(),{countryCode:"KE",projectMetadata,crsSrid:getCountryConfig("KE").geodeticFramework.primarySRID})).rejects.toThrow(/reference|CRS|source/i);
 });
 it("retains TIN vertex heights and contour elevations",async()=>{
  const result=await dxfExporter.export(fixture(),{countryCode:"KE",projectMetadata});const all=entities(result.bytes);
  const edges=all.filter(e=>e.type==="LINE"&&e["8"]==="TIN-EDGES");
  expect(new Set(edges.flatMap(e=>[Number(e["30"]),Number(e["31"])]))).toEqual(new Set([10,12,14]));
  const contours=all.filter(e=>e.type==="LINE"&&e["8"]==="CONTOURS");expect(contours.length).toBeGreaterThan(0);
  for(const e of contours){expect(Number(e["30"])).toBeGreaterThanOrEqual(10);expect(e["30"]).toBe(e["31"]);}
 });
 it("keeps reference text near the surveyed site",async()=>{
  const result=await dxfExporter.export(fixture(),{countryCode:"KE",projectMetadata});
  const labels=entities(result.bytes).filter(e=>e.type==="TEXT"&&e["1"]?.includes("SRID"));expect(labels.length).toBeGreaterThan(0);
  for(const e of labels){expect(Number(e["10"])).toBeGreaterThanOrEqual(499900);expect(Number(e["20"])).toBeGreaterThanOrEqual(9799900);}
 });
});
it("preserves spot marker height",async()=>{ const all=entities((await dxfExporter.export(fixture(),{countryCode:"KE",projectMetadata})).bytes); const marks=all.filter(e=>e.type==="LINE"&&e["8"]==="SPOT-HEIGHTS"); expect(new Set(marks.map(e=>Number(e["30"])))).toEqual(new Set([10,12,14])); });
it("keeps unknown metadata explicit for a computed draft",async()=>{const result=await dxfExporter.export(fixture(),{countryCode:"KE",projectMetadata:{projectName:"SYNTHETIC",surveyorName:"",licenseNumber:"",surveyDate:"",adjustmentRunId:""}});expect(new TextDecoder().decode(result.bytes)).toContain("SURVEY DATE: not recorded");});
it("refuses missing reference, nonfinite heights, or geographic conversion",()=>{const missing=fixture();delete missing.coordinateContext;expect(dxfExporter.validate(missing,{countryCode:"KE",projectMetadata}).ok).toBe(false);const invalid=fixture();invalid.tin.vertices[0]!.elevation=NaN;expect(dxfExporter.validate(invalid,{countryCode:"KE",projectMetadata}).ok).toBe(false);expect(dxfExporter.validate(fixture(),{countryCode:"KE",projectMetadata,outputWgs84:true}).ok).toBe(false);expect(dxfExporter.validate(fixture(),{countryCode:"XX" as "KE",projectMetadata}).ok).toBe(false);});
it("keeps every adjacent segment of a multi-vertex contour",async()=>{const output=fixture();output.contours=[{elevation:11.25,closed:false,coordinates:[[500000,9800000],[500005,9800005],[500010,9800000],[500015,9800005]]}];const lines=entities((await dxfExporter.export(output,{countryCode:"KE",projectMetadata})).bytes).filter(e=>e.type==="LINE"&&e["8"]==="CONTOURS");expect(lines).toHaveLength(3);expect(lines.map(e=>[Number(e["10"]),Number(e["11"])] )).toEqual([[500000,500005],[500005,500010],[500010,500015]]);for(const line of lines){expect(Number(line["30"])).toBe(11.25);expect(Number(line["31"])).toBe(11.25);}});
it("retains the requested spacing on new computed outputs",()=>expect(fixture().contourInterval).toBe(1));
