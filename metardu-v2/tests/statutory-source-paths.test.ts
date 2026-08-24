/**
 * B1 guard — repo-root variant for `npx vitest run tests/statutory-source-paths.test.ts`.
 *
 * Mirrors packages/country-config/src/tests/source-paths.test.ts but imports via
 * the workspace package name so it runs from the `tests/` workspace harness.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COUNTRY_REGISTRY } from "@metardu/country-config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "docs", "regulatory-sources"))) return dir;
    const parent = path.resolve(dir, "..");
    if (fs.existsSync(path.join(parent, "docs", "regulatory-sources"))) return parent;
    dir = parent;
  }
  const fallback = path.resolve(__dirname, "..");
  if (fs.existsSync(path.join(fallback, "docs", "regulatory-sources"))) return fallback;
  return process.cwd();
}

function resolveDocPath(sourcePath: string, repoRoot: string): string {
  return path.resolve(repoRoot, sourcePath);
}

describe("B1 guard: every sourceFiled:true doc has its file on disk (tests workspace)", () => {
  it("every sourceFiled:true doc has its file on disk", () => {
    const repoRoot = findRepoRoot();
    const failures: string[] = [];

    for (const cfg of Object.values(COUNTRY_REGISTRY)) {
      if (!cfg) continue;
      for (const doc of cfg.statutoryDocuments) {
        if ((doc as { sourceFiled?: boolean }).sourceFiled === true) {
          const abs = resolveDocPath(doc.sourcePath, repoRoot);
          const altAbs = path.resolve(process.cwd(), doc.sourcePath);
          const exists = fs.existsSync(abs) || fs.existsSync(altAbs) || fs.existsSync(doc.sourcePath);
          if (!exists) {
            failures.push(
              `${cfg.countryCode} ${doc.docType} claims filed but missing: ${doc.sourcePath} (checked ${abs})`,
            );
          }
          expect(
            exists,
            `${cfg.countryCode} ${doc.docType} claims filed but missing: ${doc.sourcePath} (checked ${abs})`,
          ).toBe(true);
        }
      }
    }

    const filedCount = Object.values(COUNTRY_REGISTRY)
      .filter(Boolean)
      .flatMap((c) => c!.statutoryDocuments)
      .filter((d) => (d as { sourceFiled?: boolean }).sourceFiled === true).length;
    expect(filedCount).toBeGreaterThan(0);

    if (failures.length > 0) throw new Error(`B1 guard failed:\n  - ${failures.join("\n  - ")}`);
  });
});
