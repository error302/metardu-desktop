import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveSidecarBinary } from "../main/sidecar-binary.js";
const owned: string[] = [];
afterEach(() => { for (const root of owned.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
 const root=mkdtempSync(path.join(tmpdir(), "metardu-sidecar-path-")); owned.push(root);
 return {root,mainDirectory:path.join(root,"apps","desktop","dist","main"),resourcesPath:path.join(root,"resources"),packaged:false,platform:"win32"};
}
function binary(filename:string) {mkdirSync(path.dirname(filename),{recursive:true});writeFileSync(filename,"synthetic fixture, never executed");return filename;}
describe("native sidecar resolution",()=>{
 it("finds the Windows release binary from the compiled main layout",()=>{
  const f=fixture(),expected=binary(path.join(f.root,"packages","metardu-sidecar","target","release","metardu-sidecar.exe"));
  expect(resolveSidecarBinary(f)).toBe(expected);
 });
 it("prefers the packaged resource",()=>{
  const f=fixture(),expected=binary(path.join(f.resourcesPath,"metardu-sidecar.exe"));
  binary(path.join(f.root,"packages","metardu-sidecar","target","release","metardu-sidecar.exe"));
  expect(resolveSidecarBinary({...f,packaged:true})).toBe(expected);
 });
 it("does not fall back to source paths in a packaged app",()=>{
  const f=fixture();binary(path.join(f.root,"packages","metardu-sidecar","target","release","metardu-sidecar.exe"));
  expect(resolveSidecarBinary({...f,packaged:true})).toBeNull();
 });
 it("supports Unix debug binaries",()=>{
  const f=fixture(),expected=binary(path.join(f.root,"packages","metardu-sidecar","target","debug","metardu-sidecar"));
  expect(resolveSidecarBinary({...f,platform:"linux"})).toBe(expected);
 });
 it("does not select a directory as an executable",()=>{
  const f=fixture();mkdirSync(path.join(f.resourcesPath,"metardu-sidecar.exe"),{recursive:true});
  expect(resolveSidecarBinary(f)).toBeNull();
 });
});
