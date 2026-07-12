/**
 * Central compute module index.
 * All compute functions are exported from one location.
 *
 * Native TS implementations (no Python dependency):
 *   - generateTIN, interpolateElevation       → ./tin
 *   - computeRasterAnalysis                   → ./rasterAnalysis
 *   - computeEDMCorrection                    → ./edmCorrection (atmospheric)
 *   - generateVerificationQR                  → ./qrCode (document auth)
 *
 * Existing compute runners:
 *   - runTraverseComputation                  → ./traverseRunner
 *   - runLevelingComputation                  → ./levelingRunner  (uses 10√K mm tolerance)
 *
 * Python bridge (optional — graceful 503 if PYTHON_COMPUTE_URL not set):
 *   - callPythonCompute                       → ./pythonService
 *   - convertDatum                            → ./pythonService
 *   - validateGeometry                        → ./pythonService
 *   - generateContours                        → ./pythonService
 *   - computeVolumes                          → ./pythonService
 *
 * Note: mining (MineTwin) and marine (seabed, depth sounder, sounding chart)
 * modules were removed in v1 scope narrowing. They live in the separate
 * `metardu-industrial` repo.
 */

// Native TypeScript compute modules
export { generateTIN, interpolateElevation, computeSurfaceArea, computeTINVolume, type TINPoint, type TINTriangle } from './tin'
export { computeRasterAnalysis, validateRasterRequest, type RasterAnalysisType, type RasterAnalysisParams, type RasterAnalysisResult } from './rasterAnalysis'
export { computeEDMCorrection, fetchWeatherData } from './edmCorrection'
export { generateVerificationQR, getVerificationUrl } from './qrCode'

// Existing compute runners
export { runTraverseComputation, runForwardTraverse, runBowditchAdjustment, getTraversePrecisionStatus, type TraverseComputeInput, type TraverseComputationResult } from './traverseRunner'
export { runLevelingComputation, getLevelingClosureStatus, type LevelingComputeInput } from './levelingRunner'

// Python bridge (optional)
export { callPythonCompute, convertDatum, validateGeometry, generateContours, computeVolumes } from './pythonService'
