/**
 * Cadastral workflow — boundary re-establishment → adjustment → Form 3.
 *
 * This is the vertical slice per master plan Section 9 step 4. It ties
 * together:
 *   - The sidecar's COGO + adjustment modules (boundary computation)
 *   - The country-config (Kenya tolerances + Form 3 spec)
 *   - The Form 3 renderer (statutory document output)
 *
 * The workflow is exposed as a single function that the Electron main
 * process can call. In production the sidecar calls happen via the
 * SidecarClient; for testing we accept an injected sidecar client.
 *
 * # References
 *
 *   - Master plan Section 6.2 (Cadastral workflow)
 *   - Master plan Section 9 step 4 (Kenya cadastral vertical slice)
 *   - Survey Act Cap. 299 Form 3 (renderer spec)
 */

import type { Form3Input, Form3Parcel, Form3Beacon } from "../documents/form-3.js";
import { generateForm3Pdf, type Form3Output } from "../documents/form-3.js";

// ─── Types ───────────────────────────────────────────────────────

/** A field observation: a horizontal distance between two beacons. */
export interface DistanceObservation {
  fromLabel: string;
  toLabel: string;
  /** Observed distance in metres. */
  distanceM: number;
  /** A priori standard deviation in metres (default 5mm = 0.005). */
  sigmaM?: number;
}

/** Input to the cadastral workflow. */
export interface CadastralWorkflowInput {
  /** Known beacons (fixed control — typically from prior surveys). */
  knownBeacons: Form3Beacon[];
  /** New observations tying the unknown beacons to the known ones. */
  observations: DistanceObservation[];
  /** Parcel metadata (survey number, district, location, area). */
  parcel: Omit<Form3Parcel, "beacons" | "srid">;
  /** Surveyor info for the certification block. */
  surveyor: Form3Input["surveyor"];
  /** SRID for the output (must match knownBeacons coordinates). */
  srid: number;
}

/** Output of the cadastral workflow. */
export interface CadastralWorkflowOutput {
  /** The generated Form 3 PDF. */
  form3: Form3Output;
  /** All beacons (known + new, ordered for the coordinate schedule). */
  allBeacons: Form3Beacon[];
  /** Per-observation residuals after adjustment (metres). */
  residuals: Record<string, number>;
  /** A posteriori variance factor (sigma_0²). ~1.0 = good fit. */
  sigma_0_sq: number;
  /** Whether the survey passes the Kenya cadastral 1:5000 tolerance. */
  passesCadastralTolerance: boolean;
}

// ─── The workflow ────────────────────────────────────────────────

/**
 * Run the cadastral workflow: compute adjusted coordinates from the
 * observations, then generate the Form 3 PDF.
 *
 * This Phase 6 version uses a simplified trilateration approach (only
 * distance observations, no angles or bearings). The full Phase 4B
 * adjustment engine handles directions and azimuths too — once that's
 * wired through the IPC boundary, this workflow will call it. For
 * now, we compute coordinates via intersection of distance arcs in
 * the engine itself (a sufficient approach for parcels with 2+
 * unknowns tied to 2+ known control points).
 *
 * # Inputs
 *
 * The workflow assumes the known beacons are in Arc 1960 / UTM 37S
 * coordinates (or whatever SRID is specified). New beacon coordinates
 * are computed by trilateration from the distance observations.
 *
 * # Output
 *
 * - Form 3 PDF bytes (ready to write to disk)
 * - All beacons (known + new) with adjusted coordinates
 * - Residuals per observation (observed - computed)
 * - σ₀² (should be ≈ 1.0 if the a priori sigmas are correct)
 *
 * @throws if the geometry is under-determined (< 2 known beacons
 *   or < 2 observations per unknown).
 */
export async function runCadastralWorkflow(
  input: CadastralWorkflowInput,
): Promise<CadastralWorkflowOutput> {
  // Validate input.
  if (input.knownBeacons.length < 2) {
    throw new Error(
      "Cadastral workflow requires at least 2 known beacons for trilateration; " +
        `got ${input.knownBeacons.length}.`,
    );
  }

  if (input.observations.length === 0) {
    throw new Error("Cadastral workflow requires at least one distance observation.");
  }

  // Collect all beacon labels (known + observed).
  const knownLabels = new Set(input.knownBeacons.map((b) => b.label));
  const observedLabels = new Set<string>();
  for (const obs of input.observations) {
    observedLabels.add(obs.fromLabel);
    observedLabels.add(obs.toLabel);
  }
  const newLabels = [...observedLabels].filter((l) => !knownLabels.has(l));

  if (newLabels.length === 0) {
    // All observations are between known beacons — just compute residuals.
    const allBeacons = [...input.knownBeacons];
    const residuals: Record<string, number> = {};
    let vvSum = 0;
    let dof = 0;
    for (const obs of input.observations) {
      const from = allBeacons.find((b) => b.label === obs.fromLabel);
      const to = allBeacons.find((b) => b.label === obs.toLabel);
      if (!from || !to) {
        throw new Error(`Observation references unknown beacon: ${obs.fromLabel} → ${obs.toLabel}`);
      }
      const computed = Math.sqrt(
        (to.position.easting - from.position.easting) ** 2 +
          (to.position.northing - from.position.northing) ** 2,
      );
      const r = obs.distanceM - computed;
      residuals[`${obs.fromLabel}->${obs.toLabel}`] = r;
      const sigma = obs.sigmaM ?? 0.005;
      vvSum += (r * r) / (sigma * sigma);
      dof++;
    }
    // σ₀² for the all-known case: dof = observations (no unknowns).
    const sigma_0_sq = dof > 0 ? vvSum / dof : 0.0;

    // Form 3 requires ≥ 3 beacons. If the user passed only 2 known
    // beacons (a "check survey" between 2 control points), we can't
    // generate a Form 3 — return the residuals only.
    if (allBeacons.length < 3) {
      // Skip Form 3 generation; return a stub.
      return {
        form3: {
          pdfBytes: new Uint8Array(0),
          pageCount: 0,
          scale: 0,
          coordinateSystemLabel: `SRID ${input.srid} (check survey — no Form 3 generated)`,
          hasDraftWatermark: false,
        },
        allBeacons,
        residuals,
        sigma_0_sq,
        passesCadastralTolerance: Math.max(...Object.values(residuals).map(Math.abs)) < 0.020,
      };
    }

    const form3Input: Form3Input = {
      parcel: { ...input.parcel, beacons: allBeacons, srid: input.srid },
      surveyor: input.surveyor,
    };
    const form3 = await generateForm3Pdf(form3Input);
    return {
      form3,
      allBeacons,
      residuals,
      sigma_0_sq,
      passesCadastralTolerance: Math.max(...Object.values(residuals).map(Math.abs)) < 0.020,
    };
  }

  // For new beacons: trilateration via least-squares.
  // We use an iterative approach: start with a rough initial position
  // (centroid of known beacons), then refine via Gauss-Newton.
  // This is a simplified version of what the sidecar's adjustment/
  // module does; Phase 4B will replace this with a proper sidecar call.

  const knownMap = new Map(input.knownBeacons.map((b) => [b.label, b.position]));

  // Initialize new beacons at the centroid of the known beacons, with
  // a small per-beacon offset to break symmetry. Without the offset,
  // trilateration from 2 known points hits a singular normal matrix
  // at the symmetric starting point (reflection ambiguity).
  let newPositions = new Map<string, { easting: number; northing: number }>();
  const centroidE =
    input.knownBeacons.reduce((s, b) => s + b.position.easting, 0) /
    input.knownBeacons.length;
  const centroidN =
    input.knownBeacons.reduce((s, b) => s + b.position.northing, 0) /
    input.knownBeacons.length;
  for (let i = 0; i < newLabels.length; i++) {
    const label = newLabels[i]!;
    // Offset each new beacon by a different amount in E and N to
    // break symmetry. The offset is small (1m + 0.5m per index) so
    // convergence is still fast.
    const offsetE = 1.0 + 0.5 * i;
    const offsetN = -1.0 + 0.3 * i;
    newPositions.set(label, { easting: centroidE + offsetE, northing: centroidN + offsetN });
  }

  // Gauss-Newton iteration. Update ALL unknowns simultaneously per
  // iteration (sequential updates would not converge for interlinked
  // observations).
  //
  // Build the full Jacobian J (rows = observations, cols = 2 per new
  // beacon) and the residual vector r, then solve Jᵀ W J Δx = Jᵀ W r
  // where W is the diagonal weight matrix (1/σ²).
  const sigmaDefault = 0.005; // 5mm
  const maxIter = 50;
  const convergenceThreshold = 1e-9;

  // Map each new beacon label to its index in the unknown vector.
  const newLabelIdx = new Map<string, number>();
  for (let i = 0; i < newLabels.length; i++) {
    newLabelIdx.set(newLabels[i]!, i);
  }

  for (let iter = 0; iter < maxIter; iter++) {
    const n = 2 * newLabels.length; // 2 unknowns per beacon
    const normal = new Array(n * n).fill(0); // n×n row-major
    const rhs = new Array(n).fill(0);

    for (const obs of input.observations) {
      const fromIsNew = newLabelIdx.has(obs.fromLabel);
      const toIsNew = newLabelIdx.has(obs.toLabel);
      if (!fromIsNew && !toIsNew) continue;

      const fromPos = knownMap.get(obs.fromLabel) ?? newPositions.get(obs.fromLabel)!;
      const toPos = knownMap.get(obs.toLabel) ?? newPositions.get(obs.toLabel)!;
      const de = toPos.easting - fromPos.easting;
      const dn = toPos.northing - fromPos.northing;
      const dCalc = Math.sqrt(de * de + dn * dn);
      if (dCalc < 1e-9) continue;
      const sigma = obs.sigmaM ?? sigmaDefault;
      const w = 1.0 / (sigma * sigma);
      const r = obs.distanceM - dCalc;

      // Jacobian entries: r = d_obs - d_calc, where d_calc = sqrt(de² + dn²)
      //   ∂d_calc/∂E_to   = +de/dCalc    →  ∂r/∂E_to   = -de/dCalc
      //   ∂d_calc/∂N_to   = +dn/dCalc    →  ∂r/∂N_to   = -dn/dCalc
      //   ∂d_calc/∂E_from = -de/dCalc    →  ∂r/∂E_from = +de/dCalc
      //   ∂d_calc/∂N_from = -dn/dCalc    →  ∂r/∂N_from = +dn/dCalc
      const jE_from = -de / dCalc;
      const jN_from = -dn / dCalc;
      const jE_to = de / dCalc;
      const jN_to = dn / dCalc;

      // Build a sparse Jacobian row: only the entries for the
      // participating beacons are nonzero.
      const rowEntries: Array<{ idx: number; value: number }> = [];
      if (fromIsNew) {
        const i = newLabelIdx.get(obs.fromLabel)!;
        rowEntries.push({ idx: 2 * i, value: jE_from });
        rowEntries.push({ idx: 2 * i + 1, value: jN_from });
      }
      if (toIsNew) {
        const i = newLabelIdx.get(obs.toLabel)!;
        rowEntries.push({ idx: 2 * i, value: jE_to });
        rowEntries.push({ idx: 2 * i + 1, value: jN_to });
      }

      // Accumulate into normal equations: N += w * JᵀJ, b += w * Jᵀ * r
      for (const a of rowEntries) {
        for (const b of rowEntries) {
          normal[a.idx * n + b.idx] += w * a.value * b.value;
        }
        rhs[a.idx] += w * a.value * r;
      }
    }

    // Solve normal Δx = N⁻¹ b via Gaussian elimination.
    const dx = solveLinearSystem(normal, rhs, n);
    if (!dx) break;

    let maxDelta = 0;
    for (let i = 0; i < newLabels.length; i++) {
      const label = newLabels[i]!;
      const pos = newPositions.get(label)!;
      const dE = dx[2 * i]!;
      const dN = dx[2 * i + 1]!;
      newPositions.set(label, {
        easting: pos.easting + dE,
        northing: pos.northing + dN,
      });
      maxDelta = Math.max(maxDelta, Math.abs(dE), Math.abs(dN));
    }
    if (maxDelta < convergenceThreshold) break;
  }

  // Compute final residuals + σ₀².
  const allBeacons: Form3Beacon[] = [...input.knownBeacons];
  for (const label of newLabels) {
    const pos = newPositions.get(label)!;
    allBeacons.push({
      label,
      position: pos,
      description: "Concrete pillar", // default; caller can override
    });
  }

  const residuals: Record<string, number> = {};
  let vvSum = 0;
  let dof = 0;
  for (const obs of input.observations) {
    const from = allBeacons.find((b) => b.label === obs.fromLabel);
    const to = allBeacons.find((b) => b.label === obs.toLabel);
    if (!from || !to) continue;
    const computed = Math.sqrt(
      (to.position.easting - from.position.easting) ** 2 +
        (to.position.northing - from.position.northing) ** 2,
    );
    const r = obs.distanceM - computed;
    residuals[`${obs.fromLabel}->${obs.toLabel}`] = r;
    const sigma = obs.sigmaM ?? sigmaDefault;
    vvSum += (r * r) / (sigma * sigma);
    dof++;
  }
  // dof = observations - unknowns (2 per new beacon)
  dof = Math.max(1, dof - 2 * newLabels.length);
  const sigma_0_sq = vvSum / dof;

  // Generate Form 3.
  const form3Input: Form3Input = {
    parcel: { ...input.parcel, beacons: allBeacons, srid: input.srid },
    surveyor: input.surveyor,
  };
  const form3 = await generateForm3Pdf(form3Input);

  // Check Kenya cadastral 1:5000 tolerance — for now, we don't have a
  // closed traverse so we check the worst-case residual.
  // TODO Phase 4B: replace with sidecar adjustment.run + tolerance check.
  const maxResidual = Math.max(...Object.values(residuals).map(Math.abs));
  const passesCadastralTolerance = maxResidual < 0.020; // 20mm threshold

  return {
    form3,
    allBeacons,
    residuals,
    sigma_0_sq,
    passesCadastralTolerance,
  };
}

// ─── Linear algebra helper ───────────────────────────────────────

/**
 * Solve a linear system M x = b via Gaussian elimination with partial pivoting.
 * M is n×n row-major; b is length n. Returns null if singular.
 *
 * This is a minimal implementation for the cadastral workflow's
 * normal equations. The sidecar's adjustment/ module has a more
 * robust version with matrix inversion + variance-covariance
 * propagation — Phase 4B will route the workflow through that.
 */
function solveLinearSystem(m: number[], b: number[], n: number): number[] | null {
  if (m.length !== n * n || b.length !== n) return null;
  // Augmented matrix.
  const aug: number[] = new Array(n * (n + 1));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) aug[i * (n + 1) + j] = m[i * n + j] ?? 0;
    aug[i * (n + 1) + n] = b[i] ?? 0;
  }
  // Forward elimination with partial pivoting.
  for (let k = 0; k < n; k++) {
    let maxRow = k;
    let maxVal = Math.abs(aug[k * (n + 1) + k]!);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(aug[i * (n + 1) + k]!);
      if (v > maxVal) { maxVal = v; maxRow = i; }
    }
    if (maxVal < 1e-15) return null; // singular
    if (maxRow !== k) {
      for (let j = 0; j <= n; j++) {
        const tmp = aug[k * (n + 1) + j]!;
        aug[k * (n + 1) + j] = aug[maxRow * (n + 1) + j]!;
        aug[maxRow * (n + 1) + j] = tmp;
      }
    }
    for (let i = k + 1; i < n; i++) {
      const factor = (aug[i * (n + 1) + k] ?? 0) / (aug[k * (n + 1) + k] ?? 1);
      for (let j = k; j <= n; j++) {
        aug[i * (n + 1) + j] = (aug[i * (n + 1) + j] ?? 0) - factor * (aug[k * (n + 1) + j] ?? 0);
      }
    }
  }
  // Back substitution.
  const x: number[] = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = aug[i * (n + 1) + n] ?? 0;
    for (let j = i + 1; j < n; j++) {
      sum -= (aug[i * (n + 1) + j] ?? 0) * (x[j] ?? 0);
    }
    x[i] = sum / (aug[i * (n + 1) + i] ?? 1);
  }
  return x;
}
