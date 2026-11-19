import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

describe("sandboxed production preload",()=>{
 it("loads using only Electron's limited sandbox require",()=>{
  const code=readFileSync(path.resolve(__dirname,"../../dist/preload/index.cjs"),"utf8");
  const exposed:Record<string,unknown>={},requests:string[]=[];
  vm.runInNewContext(code,{console,require:(name:string)=>{
   requests.push(name);if(name!=="electron")throw new Error("Unexpected sandbox module: "+name);
   return {contextBridge:{exposeInMainWorld:(name:string,value:unknown)=>{exposed[name]=value;}},ipcRenderer:{invoke:async()=>undefined,on:()=>undefined,off:()=>undefined}};
  }});
  expect(requests).toEqual(["electron"]);
  expect(exposed.metardu).toMatchObject({sidecar:{call:expect.any(Function)},projects:{list:expect.any(Function)},export:{survey:expect.any(Function)}});
 });
 it("ships a renderer CSP without eval-enabled scripts",()=>{
  const html=readFileSync(path.resolve(__dirname,"../../renderer-build/index.html"),"utf8");
  expect(html).toContain('http-equiv="Content-Security-Policy"');
  expect(html).toContain("script-src 'self'");
  expect(html).not.toContain("unsafe-eval");
  const imagePolicy=html.match(/img-src ([^;]+);/)?.[1]?.split(/\s+/) ?? [];
  expect(imagePolicy).toContain("https://server.arcgisonline.com");
  expect(imagePolicy).toContain("https://a.tile.opentopomap.org");
  expect(imagePolicy).toContain("https://b.tile.opentopomap.org");
  expect(imagePolicy).toContain("https://c.tile.opentopomap.org");
  expect(imagePolicy).not.toContain("*");
  expect(imagePolicy).not.toContain("https:");
 });
});
