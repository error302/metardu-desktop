import fs from "node:fs";
import path from "node:path";

export interface SidecarBinaryLocation {
  mainDirectory: string;
  resourcesPath?: string;
  platform: string;
  packaged: boolean;
}

/** Resolve only the packaged resource or this workspace's existing build. */
export function resolveSidecarBinary(input: SidecarBinaryLocation): string | null {
  const name = "metardu-sidecar" + (input.platform === "win32" ? ".exe" : "");
  const candidates: string[] = [];
  if (input.resourcesPath) candidates.push(path.join(input.resourcesPath, name));
  if (!input.packaged) {
    // apps/desktop/dist/main -> workspace root (four parent directories).
    const root = path.resolve(input.mainDirectory, "..", "..", "..", "..");
    for (const mode of ["release", "debug"]) {
      candidates.push(path.join(root, "packages", "metardu-sidecar", "target", mode, name));
    }
  }
  return candidates.find(candidate => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  }) ?? null;
}
