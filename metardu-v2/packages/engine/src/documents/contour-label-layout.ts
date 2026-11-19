/** Display-only placement; retained contour coordinates are never modified. */
export interface LabelBox {left:number;top:number;right:number;bottom:number}
interface Contour {elevation:number;coordinates:[number,number][]}
export interface ContourLabel extends LabelBox {x:number;y:number;text:string}
export function placeRetainedContourLabels(contours:Contour[],transform:(e:number,n:number)=>{x:number;y:number},reserved:LabelBox[],viewport:{width:number;height:number}):ContourLabel[]{
 const placed:ContourLabel[]=[],seen=new Set<number>();
 const overlaps=(a:LabelBox,b:LabelBox)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
 // Long segments offer the clearest placement. No interpolation of terrain occurs.
 const candidates=contours.flatMap(c=>c.coordinates.slice(1).map((p,i)=>({elevation:c.elevation,a:transform(...c.coordinates[i]!),b:transform(...p)})))
 .sort((a,b)=>Math.hypot(b.b.x-b.a.x,b.b.y-b.a.y)-Math.hypot(a.b.x-a.a.x,a.b.y-a.a.y));
 const levelLengths=new Map<number,number>();
 for(const c of candidates)levelLengths.set(c.elevation,(levelLengths.get(c.elevation)??0)+Math.hypot(c.b.x-c.a.x,c.b.y-c.a.y));
 for(const c of candidates){
  if(seen.has(c.elevation)||!Number.isFinite(c.elevation))continue;
  const text=c.elevation.toFixed(2),w=text.length*6+8;
  if((levelLengths.get(c.elevation)??0)<w+12 || Math.hypot(c.b.x-c.a.x,c.b.y-c.a.y)<8)continue;
  for(const t of [0.5,0.25,0.75]){
   const x=c.a.x+(c.b.x-c.a.x)*t,y=c.a.y+(c.b.y-c.a.y)*t;
   const box={left:x-w/2,top:y-10,right:x+w/2,bottom:y+7};
   if(box.left<8||box.top<24||box.right>viewport.width-8||box.bottom>viewport.height-30||[...reserved,...placed].some(b=>overlaps(box,b)))continue;
   placed.push({...box,x,y,text});seen.add(c.elevation);break;
  }
 }
 return placed;
}
