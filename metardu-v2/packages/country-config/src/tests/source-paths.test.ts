/**
 * B1 guard — every statutory document that claims sourceFiled:true must have its source PDF on disk.
 *
 * Per Task 9: add sourceFiled?: boolean to StatutoryDocSpec. When true, file must exist or this test fails.
 * Default is false (no file required). This is the permanent B1 invariant guard.
 *
 * Checks all country configs via COUNTRY_REGISTRY. Failures indicate stale citations
 * (e.g. survey-act-cap-299-form-3.pdf missing) that must be fixed to the actual filed filenames.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COUNTRY_REGISTRY } from "../index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the repo root (metardu-v2) from this test file's location.
 * Walks up looking for docs/regulatory-sources, falling back to a fixed offset.
 */
function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.resolve(dir, "docs", "regulatory-sources");
    if (fs.existsSync(candidate)) {
      // dir is the candidate's parent is docs' parent — need to ascend until docs is directly under it
      // Check if dir + "/docs" exists, then dir is repo root
      if (fs.existsSync(path.join(dir, "docs"))) return dir;
    }
    // Also check parent
    if (fs.existsSync(path.join(dir, "docs", "regulatory-sources"))) return dir;
    // Check one level up's docs
    const parent = path.resolve(dir, "..");
    if (fs.existsSync(path.join(parent, "docs", "regulatory-sources"))) return parent;
    dir = parent;
  }
  // Fallback: from packages/country-config/src/tests -> 4 levels up is metardu-v2
  const fallback = path.resolve(__dirname, "..", "..", "..", "..");
  if (fs.existsSync(path.join(fallback, "docs", "regulatory-sources"))) return fallback;
  // Final fallback: process.cwd()
  return process.cwd();
}

function resolveDocPath(sourcePath: string, repoRoot: string): string {
  // sourcePath is repo-root-relative, e.g. docs/regulatory-sources/kenya/cadastral/...
  return path.resolve(repoRoot, sourcePath);
}

describe("B1 guard: every sourceFiled:true doc has its file on disk", () => {
  it("every sourceFiled:true doc has its file on disk", () => {
    const repoRoot = findRepoRoot();
    const failures: string[] = [];

    for (const cfg of Object.values(COUNTRY_REGISTRY)) {
      if (!cfg) continue;
      for (const doc of cfg.statutoryDocuments) {
        // Only enforce when sourceFiled === true; default false / undefined is not required
        if ((doc as { sourceFiled?: boolean }).sourceFiled === true) {
          const abs = resolveDocPath(doc.sourcePath, repoRoot);
          // Also try resolving from cwd and raw path as fallback
          const altAbs = path.resolve(process.cwd(), doc.sourcePath);
          const exists = fs.existsSync(abs) || fs.existsSync(altAbs) || fs.existsSync(doc.sourcePath);
          if (!exists) {
            failures.push(
              `${cfg.countryCode} ${doc.docType} claims filed but missing: ${doc.sourcePath} (checked ${abs})`,
            );
          }
          expect(
            exists,
            `${cfg.countryCode} ${doc.docType} claims filed but missing: ${doc.sourcePath} (checked ${abs} / ${altAbs})`,
          ).toBe(true);
        }
      }
    }

    // Also assert that at least one filed doc exists, so the guard isn't vacuous
    const filedCount = Object.values(COUNTRY_REGISTRY)
      .filter(Boolean)
      .flatMap((c) => c!.statutoryDocuments)
      .filter((d) => (d as { sourceFiled?: boolean }).sourceFiled === true).length;
    expect(filedCount, "expected at least one sourceFiled:true doc (Kenya Form 3)").toBeGreaterThan(0);

    if (failures.length > 0) {
      // Provide aggregated message for CI readability
      throw new Error(`B1 guard failed:\n  - ${failures.join("\n  - ")}`);
    }
  });

  it("Kenya citations point at actually-filed files", () => {
    const repoRoot = findRepoRoot();
    const kenya = COUNTRY_REGISTRY.KE;
    expect(kenya).toBeDefined();

    const form3 = kenya!.statutoryDocuments.find((d) => d.docType === "Form 3")!;
    expect(form3.sourcePath).toBe(
      "docs/regulatory-sources/kenya/cadastral/survey-act-cap-299-revised-2012.pdf",
    );
    expect((form3 as { sourceFiled?: boolean }).sourceFiled).toBe(true);
    expect(fs.existsSync(resolveDocPath(form3.sourcePath, repoRoot))).toBe(true);

    const beacon = kenya!.statutoryDocuments.find((d) => d.docType === "Beacon Certificate")!;
    expect(beacon.sourcePath).toBe(
      "docs/regulatory-sources/kenya/cadastral/kenya-gazette-survey-regulations-1994.pdf",
    );
    expect((beacon as { sourceFiled?: boolean }).sourceFiled).toBe(true);
    expect(fs.existsSync(resolveDocPath(beacon.sourcePath, repoRoot))).toBe(true);

    const form4 = kenya!.statutoryDocuments.find((d) => d.docType === "Form 4")!;
    expect(form4.sourcePath).toBe(
      "docs/regulatory-sources/kenya/cadastral/survey-act-cap-299-revised-2012.pdf",
    );
    expect((form4 as { sourceFiled?: boolean }).sourceFiled).toBe(false);
  });

  it("AU/GB/ZA/DE docs are explicitly marked not-filed (or default false) — no filesystem requirement", () => {
    for (const code of ["AU", "GB", "ZA", "DE"] as const) {
      const cfg = COUNTRY_REGISTRY[code];
      expect(cfg, `${code} config exists`).toBeDefined();
      for (const doc of cfg!.statutoryDocuments) {
        const filed = (doc as { sourceFiled?: boolean }).sourceFiled;
        // Must be false or undefined (default false); never true for these markets today
        expect(
          filed === false || filed === undefined,
          `${code} ${doc.docType} should be sourceFiled:false/undefined, got ${filed}`,
        ).toBe(true);
      }
    }
  });
});
