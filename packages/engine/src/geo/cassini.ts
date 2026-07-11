/**
 * Cassini ↔ UTM — Compatibility Shim
 *
 * This file is a thin re-export barrel. The actual implementation lives in
 * src/lib/geo/cassini/ (split into constants / types / helmert / exact / datum /
 * projection / verify / sheets / subsheets / index).
 *
 * Existing imports like `import { cassiniFeetToUTM } from '@/lib/geo/cassini'`
 * keep working unchanged — that's the whole point.
 *
 * Refactor history:
 *   - Pre-Phase 3: this file was 2,817 LOC mixing constants, types, math,
 *     data tables, JSON IIFE, and UI helpers.
 *   - Phase 3 (2026-06-20): split into src/lib/geo/cassini/* and replaced
 *     with this 1-line barrel. Golden master verified byte-identical outputs.
 *     See scripts/cassini_golden_master.ts and docs/cassini/engineering-log.md.
 */

export * from './cassini/index'
