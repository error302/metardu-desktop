import { describe,it,expect } from "vitest";
import { placeRetainedContourLabels as place } from "../../../../packages/engine/src/documents/contour-label-layout.js";
const transform=(x:number,y:number)=>({x,y});
const contours=[100,100.25,100.5].map((elevation,i)=>({elevation,coordinates:[[20,40+i*2],[180,40+i*2]] as [number,number][]}));
describe("retained contour labels",()=>{
 it("preserves quarter-metre precision and geometry",()=>{const before=JSON.stringify(contours);const out=place(contours,transform,[],{width:200,height:120});expect(out.length).toBeGreaterThan(0);expect(out[0]?.text).toBe("100.00");expect(JSON.stringify(contours)).toBe(before);});
 it("avoids reserved rectangles",()=>expect(place(contours,transform,[{left:0,top:0,right:200,bottom:120}],{width:200,height:120})).toEqual([]));
 it("does not overlap labels",()=>{const out=place(contours,transform,[],{width:200,height:120});for(let i=0;i<out.length;i++)for(let j=i+1;j<out.length;j++){const a=out[i]!,b=out[j]!;expect(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top).toBe(true);}});
});

it("labels a retained level split into short triangle segments without changing vertices",()=>{
 const pieces=Array.from({length:8},(_,i)=>({elevation:100.25,coordinates:[[20+i*12,60],[32+i*12,60]] as [number,number][]}));
 const before=JSON.stringify(pieces);expect(place(pieces,transform,[],{width:200,height:120}).map(p=>p.text)).toEqual(["100.25"]);expect(JSON.stringify(pieces)).toBe(before);
});
