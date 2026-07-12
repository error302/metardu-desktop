#!/usr/bin/env node
/**
 * Rewrite metardu's `@/lib/*` path-alias imports to relative paths.
 *
 * metardu uses Next.js's `@/lib/*` alias which resolves to `src/lib/*`.
 * Our engine package layout is `packages/engine/src/*`, so:
 *   @/lib/engine/traverse  →  ../traverse        (from src/engine/__tests__/)
 *   @/lib/engine/traverse  →  ./engine/traverse   (from src/other/)
 *   @/lib/geo/cassiniSoldner → ../geo/cassiniSoldner  (from src/engine/)
 *
 * Also rewrites:
 *   - `@jest/globals` → `vitest`
 *   - Other `@/lib/*` paths to the equivalent relative path
 *
 * Usage: node scripts/rewrite-test-imports.js
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ENGINE_SRC = path.join(ROOT, 'packages', 'engine', 'src');

function findTsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findTsFiles(full));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

function rewriteImports(filePath) {
  const original = fs.readFileSync(filePath, 'utf-8');
  let content = original;

  const fileDir = path.dirname(filePath);
  const relToEngineSrc = path.relative(fileDir, ENGINE_SRC).replace(/\\/g, '/');

  content = content.replace(
    /from\s+['"]@\/lib\/([^'"]+)['"]/g,
    (match, p1) => `from '${relToEngineSrc}/${p1}'`
  );

  content = content.replace(
    /require\(\s*['"]@\/lib\/([^'"]+)['"]\s*\)/g,
    (match, p1) => `require('${relToEngineSrc}/${p1}')`
  );

  content = content.replace(
    /from\s+['"]@jest\/globals['"]/g,
    `from 'vitest'`
  );

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  }
  return false;
}

const files = findTsFiles(ENGINE_SRC);
let rewritten = 0;
for (const f of files) {
  if (rewriteImports(f)) rewritten++;
}
console.log(`Rewrote imports in ${rewritten} of ${files.length} TypeScript files.`);
