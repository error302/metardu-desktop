/**
 * @module computations — UI-facing computation engines
 *
 * UI-facing computation engines that wrap engine/ with richer result types
 * for field book and stakeout interfaces.
 *
 * This layer sits between engine/ (pure math) and compute/ (API runners).
 * It transforms the raw numeric results from engine/ into structured,
 * display-ready formats with rows, columns, status flags, and metadata
 * that the UI components can consume directly.
 *
 * Dependency direction: engine/ ← computations/ ← compute/
 *   - engine/ provides the pure math primitives
 *   - computations/ enriches results for presentation
 *   - compute/ adds I/O, persistence, and service integration
 */

export * from './cogoEngine';
export * from './clothoidTransition';
export * from './earthworksEngine';
export * from './roadDesignEngine';
export * from './settingOutEngine';
export * from './traverseEngine';
