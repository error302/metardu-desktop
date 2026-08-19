//! Linear least-squares adjustment solver.
//!
//! Implements the core algorithm for parametric (indirect observation)
//! least-squares with full variance-covariance propagation.  Supports
//! all five observation kinds:
//!
//! - **Distance** — horizontal slope distance (1 component, non-linear)
//! - **Direction** — measured direction at a station with an unknown
//!   orientation parameter (1 component, non-linear)
//! - **Azimuth** — geodetic azimuth between two points (1 component,
//!   non-linear)
//! - **HeightDifference** — leveling observation (1 component, linear)
//! - **GnssBaseline** — 3D baseline vector with full 3×3 covariance
//!   block (3 components, linear)
//!
//! # Algorithm
//!
//! 1. Linearize each observation around the current parameter estimate:
//!      L_obs ≈ L_approx(X_0) + A · ΔX    where A is the design matrix.
//! 2. Form the normal equations:
//!      N = Aᵀ Σ⁻¹ A          (normal matrix)
//!      u = Aᵀ Σ⁻¹ Δl         (constant vector)
//!    where Σ is the observation covariance matrix (block-diagonal) and
//!    Δl is the misclosure vector.
//! 3. Solve: ΔX = N⁻¹ u
//! 4. Update: X = X_0 + ΔX
//! 5. Iterate to convergence (non-linear: 2–3 iters; linear: 1 iter).
//! 6. Compute residuals, redundancy numbers, chi-square test, Baarda.
//!
//! # Stochastic model
//!
//! The observation covariance Σ is **block-diagonal**: independent
//! between observations, but within each multi-component observation
//! (e.g. a GNSS baseline's ΔE/ΔN/ΔH) the full covariance block is
//! used, capturing the correlation introduced by shared satellite
//! geometry and atmospheric delays.
//!
//! # References
//!
//! - Mikhail, E. M. & Ackermann, F. (1976), *Observations and Least
//!   Squares*.
//! - Baarda, W. (1968), *A Testing Procedure for Use in Geodetic
//!   Networks*.
//! - Leick, A. (2004), *GPS Satellite Surveying*, 3rd ed., Ch. 4.

use crate::adjustment::types::*;
use serde::{Deserialize, Serialize};

// ─── Configuration ───────────────────────────────────────────────

/// Configuration for the adjustment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdjustmentConfig {
    /// Maximum number of iterations.  Linear problems converge in 1.
    /// Non-linear problems (like distance) typically converge in 2-3.
    pub max_iterations: usize,
    /// Convergence threshold: stop when the largest |ΔX| falls below this.
    pub convergence_threshold_m: f64,
}

impl Default for AdjustmentConfig {
    fn default() -> Self {
        Self {
            max_iterations: 10,
            convergence_threshold_m: 1e-6,
        }
    }
}

// ─── Public entry point ──────────────────────────────────────────

/// Run the least-squares adjustment.
///
/// Inputs:
///   - `parameters`: initial estimates + whether each is fixed.
///   - `observations`: the observed values with their a priori sigmas
///     and optional full covariance blocks.
///   - `config`: iteration control.
///   - `orientation_parameters`: initial estimates for per-station
///     unknown orientations (used only by `Direction` observations).
///
/// Returns the adjusted parameters + full variance-covariance + residuals
/// + redundancy + Baarda statistics.
pub fn adjust_least_squares(
    parameters: &[ParameterPrior],
    observations: &[Observation],
    config: &AdjustmentConfig,
    orientation_parameters: &[ParameterPrior],
) -> Result<AdjustmentResult, AdjustmentError> {
    if observations.is_empty() {
        return Err(AdjustmentError::NoObservations);
    }

    // ── 1. Build the unknown layout ──────────────────────────────

    // Coordinate unknowns: list of (parameter_index, component_index)
    // for each unknown coordinate component.  Variable-dimension
    // parameters are supported: a 2D point contributes [E, N], a 3D
    // point contributes [E, N, H].
    let mut unknown_layout: Vec<(usize, usize)> = Vec::new();
    for (p_idx, p) in parameters.iter().enumerate() {
        if !p.fixed {
            for c_idx in 0..p.initial.len() {
                unknown_layout.push((p_idx, c_idx));
            }
        }
    }

    // Orientation unknowns (per-station instrument setup orientations, radians).
    let mut orient_layout: Vec<usize> = Vec::new();
    for (o_idx, o) in orientation_parameters.iter().enumerate() {
        if !o.fixed {
            orient_layout.push(o_idx);
        }
    }

    let n_coord_unknowns = unknown_layout.len();
    let n_orient_unknowns = orient_layout.len();
    let n_unknowns = n_coord_unknowns + n_orient_unknowns;
    if n_unknowns == 0 {
        return Err(AdjustmentError::NoUnknowns);
    }

    let n_obs_components: usize = observations.iter().map(|o| o.observed.len()).sum();

    // Degrees of freedom check.
    let dof = n_obs_components as isize - n_unknowns as isize;
    if dof < 1 {
        return Err(AdjustmentError::Underdetermined {
            observations: n_obs_components,
            unknowns: n_unknowns,
            dof,
        });
    }

    // ── 2. Validate observations ─────────────────────────────────

    for (i, obs) in observations.iter().enumerate() {
        let expected = match obs.kind {
            ObservationKind::Distance => 1,
            ObservationKind::HeightDifference => 1,
            ObservationKind::Azimuth => 1,
            ObservationKind::Direction => 1,
            ObservationKind::GnssBaseline => 3,
        };
        if obs.observed.len() != expected || obs.sigma.len() != expected {
            return Err(AdjustmentError::BadObservationDimension {
                index: i,
                expected,
                got: obs.observed.len(),
            });
        }
        for &p_idx in &obs.point_indices {
            if p_idx >= parameters.len() {
                return Err(AdjustmentError::BadPointIndex {
                    index: i,
                    point_idx: p_idx,
                    n_points: parameters.len(),
                });
            }
        }
        // Direction observations MUST reference a valid orientation unknown.
        if matches!(obs.kind, ObservationKind::Direction) {
            match obs.orientation_param {
                Some(o) if o < orientation_parameters.len() => {}
                _ => {
                    return Err(AdjustmentError::Internal(format!(
                        "Direction observation {i} requires a valid orientation_param (< {})",
                        orientation_parameters.len()
                    )))
                }
            }
        }
        // Validate covariance block size for multi-component observations.
        if !obs.covariance.is_empty() {
            let expected_sq = expected * expected;
            if obs.covariance.len() != expected_sq {
                return Err(AdjustmentError::BadObservationDimension {
                    index: i,
                    expected: expected_sq,
                    got: obs.covariance.len(),
                });
            }
        }
    }

    // ── 3. Iterative linearization + solve ───────────────────────

    let mut x_current: Vec<Vec<f64>> = parameters.iter().map(|p| p.initial.clone()).collect();
    let mut z_current: Vec<f64> = orientation_parameters
        .iter()
        .map(|o| o.initial.get(0).copied().unwrap_or(0.0))
        .collect();

    let mut max_dx: f64;

    let mut iter_count = 0;
    loop {
        // Compute the design matrix A (rows = observation components,
        // cols = unknowns), the misclosure vector Δl, and the full
        // observation covariance Σ (block-diagonal).
        let (a, dl, sigma) = build_design_and_misclosure(
            &x_current,
            &z_current,
            parameters,
            observations,
            &unknown_layout,
            &orient_layout,
            n_coord_unknowns,
        )?;

        // Weight matrix W = Σ⁻¹.
        let sigma_inv = invert_symmetric_matrix(&sigma)?;

        // Form normal equations: N = Aᵀ W A, u = Aᵀ W Δl.
        let normal = matmul_at_w_a(&a, &sigma_inv);
        let u = matvec_at_w_b(&a, &sigma_inv, &dl);

        // Solve ΔX = N⁻¹ u.
        let dx = solve_linear_system(&normal, &u)?;

        // Update coordinate unknowns.
        max_dx = dx.iter().fold(0.0_f64, |acc, &v| acc.max(v.abs()));
        for (k, (p_idx, c_idx)) in unknown_layout.iter().enumerate() {
            x_current[*p_idx][*c_idx] += dx[k];
        }
        // Update orientation unknowns.
        for (kk, &o_idx) in orient_layout.iter().enumerate() {
            z_current[o_idx] += dx[n_coord_unknowns + kk];
        }

        iter_count += 1;
        if iter_count >= config.max_iterations || max_dx < config.convergence_threshold_m {
            break;
        }
    }

    // ── 4. Final statistics at the adjusted solution ─────────────

    let (a_final, dl_final, sigma_final) = build_design_and_misclosure(
        &x_current,
        &z_current,
        parameters,
        observations,
        &unknown_layout,
        &orient_layout,
        n_coord_unknowns,
    )?;

    let sigma_inv_final = invert_symmetric_matrix(&sigma_final)?;

    let normal_final = matmul_at_w_a(&a_final, &sigma_inv_final);
    let u_final = matvec_at_w_b(&a_final, &sigma_inv_final, &dl_final);
    let dx_final = solve_linear_system(&normal_final, &u_final)?;

    // Residuals: v = A ΔX − Δl.
    let residuals: Vec<f64> = (0..a_final.len())
        .map(|i| {
            let mut row_dot = 0.0_f64;
            for j in 0..n_unknowns {
                row_dot += a_final[i][j] * dx_final[j];
            }
            row_dot - dl_final[i]
        })
        .collect();

    // A posteriori variance factor: σ₀² = vᵀ W v / dof.
    let vt_w_v: f64 = {
        let mut sum = 0.0_f64;
        for i in 0..residuals.len() {
            for j in 0..residuals.len() {
                sum += residuals[i] * sigma_inv_final[i * residuals.len() + j] * residuals[j];
            }
        }
        sum
    };
    let dof_usize = dof as usize;
    let sigma_0_sq = vt_w_v / dof_usize as f64;

    // Parameter covariance: Q_xx = N⁻¹,  cov(X) = σ₀² Q_xx.
    let q_xx = invert_symmetric_matrix(&normal_final)?;
    let covariance_flat: Vec<f64> = q_xx.iter().map(|&q| q * sigma_0_sq).collect();

    // Redundancy numbers and Baarda w-statistics.
    // Q_ll = A Q_xx Aᵀ,  Q_vv = Σ − Q_ll.
    // r_i = Q_vv[i][i] / Σ[i][i],  w_i = v[i] / sqrt(Q_vv[i][i]).
    let n = a_final.len();
    let mut redundancy = Vec::with_capacity(n);
    let mut baarda_w = Vec::with_capacity(n);

    // Diagonal of Q_ll = A Q_xx Aᵀ.
    let q_ll_diag: Vec<f64> = (0..n)
        .map(|i| {
            let mut val = 0.0_f64;
            for k in 0..n_unknowns {
                for l in 0..n_unknowns {
                    val += a_final[i][k] * q_xx[k * n_unknowns + l] * a_final[i][l];
                }
            }
            val
        })
        .collect();

    // Compute block-wise redundancy for multi-component observations.
    // For a block of size b starting at row `start`:
    //   R_block = I − Q_ll_block · Σ_block⁻¹
    //   trace(R_block) / b  =  average redundancy per component
    let obs_offsets = compute_obs_offsets(observations);

    for (i, obs) in observations.iter().enumerate() {
        let b = obs.observed.len();
        let start = obs_offsets[i];

        if b == 1 {
            // Scalar observation — simple formula.
            let sigma_i_sq = sigma_final[start * n + start];
            let q_vv_i = sigma_i_sq - q_ll_diag[start];
            let r_i = if sigma_i_sq > 0.0 && q_vv_i > 0.0 {
                q_vv_i / sigma_i_sq
            } else {
                0.0
            };
            redundancy.push(r_i);
            let w = if q_vv_i > 0.0 {
                residuals[start] / q_vv_i.sqrt()
            } else {
                0.0
            };
            baarda_w.push(w);
        } else {
            // Multi-component block — use block redundancy via trace.
            // Extract Σ_block and Q_ll_block.
            let mut sigma_block = vec![0.0_f64; b * b];
            let mut qll_block = vec![0.0_f64; b * b];
            for bi in 0..b {
                for bj in 0..b {
                    sigma_block[bi * b + bj] = sigma_final[(start + bi) * n + start + bj];
                    qll_block[bi * b + bj] = a_final[start + bi]
                        .iter()
                        .enumerate()
                        .map(|(k, &a_ik)| {
                            a_ik * (0..n_unknowns)
                                .map(|l| q_xx[k * n_unknowns + l] * a_final[start + bj][l])
                                .sum::<f64>()
                        })
                        .sum();
                }
            }

            // R_block = I − Q_ll_block · Σ_block⁻¹
            let sigma_block_inv = invert_symmetric_matrix(&sigma_block).unwrap_or_else(|_| {
                vec![0.0; b * b]
            });
            let mut trace_r = 0.0_f64;
            for bi in 0..b {
                for bj in 0..b {
                    if bi == bj {
                        trace_r += 1.0 - qll_block[bi * b + bj] * sigma_block_inv[bi * b + bj];
                    }
                }
            }
            let avg_r = trace_r / b as f64;

            for k in 0..b {
                redundancy.push(avg_r);
            }

            // Baarda w per component: use the diagonal of Q_vv.
            for k in 0..b {
                let q_vv_kk =
                    sigma_final[(start + k) * n + start + k] - q_ll_diag[start + k];
                let w = if q_vv_kk > 0.0 {
                    residuals[start + k] / q_vv_kk.sqrt()
                } else {
                    0.0
                };
                baarda_w.push(w);
            }
        }
    }

    // Global chi-square test.
    let chi_square_stat = dof_usize as f64 * sigma_0_sq;
    let chi_square_p = chi_square_p_value(chi_square_stat, dof_usize);
    let passes_global_test = chi_square_p > 0.05;
    let has_flagged_blunder = baarda_w.iter().any(|&w| w.abs() > 3.29);

    let adjusted_orientations: Vec<f64> = z_current.clone();

    Ok(AdjustmentResult {
        adjusted: x_current,
        covariance: covariance_flat,
        residuals,
        redundancy,
        baarda_w,
        sigma_0_sq,
        degrees_of_freedom: dof_usize,
        chi_square_p_value: chi_square_p,
        passes_global_test,
        has_flagged_blunder,
        adjusted_orientations,
    })
}

// ─── Design matrix + covariance builder ──────────────────────────

/// Compute the starting row index of each observation's block in the
/// design matrix.  Observation `i` occupies rows
/// `offsets[i]..offsets[i] + observed.len()`.
fn compute_obs_offsets(observations: &[Observation]) -> Vec<usize> {
    let mut offsets = Vec::with_capacity(observations.len());
    let mut row = 0;
    for obs in observations {
        offsets.push(row);
        row += obs.observed.len();
    }
    offsets
}

/// Build the design matrix A, misclosure vector Δl, and the full
/// observation covariance matrix Σ at the current parameter estimate.
///
/// Returns `(A, Δl, Σ)` where:
///   - A is `m × n` (m = observation components, n = unknowns)
///   - Δl is length `m`
///   - Σ is `m × m` (flattened row-major), block-diagonal
fn build_design_and_misclosure(
    x: &[Vec<f64>],
    z: &[f64],
    parameters: &[ParameterPrior],
    observations: &[Observation],
    coord_layout: &[(usize, usize)],
    orient_layout: &[usize],
    n_coord: usize,
) -> Result<(Vec<Vec<f64>>, Vec<f64>, Vec<f64>), AdjustmentError> {
    let n_unknowns = coord_layout.len() + orient_layout.len();
    let n_total: usize = observations.iter().map(|o| o.observed.len()).sum();

    let mut a: Vec<Vec<f64>> = Vec::new();
    let mut dl: Vec<f64> = Vec::new();
    let mut sigma = vec![0.0_f64; n_total * n_total];

    // Column index for a coordinate unknown (None if the component is fixed).
    let col_of = |p_idx: usize, c_idx: usize| -> Option<usize> {
        coord_layout
            .iter()
            .position(|&(p, c)| p == p_idx && c == c_idx)
    };
    // Column index for a station orientation unknown (lives after coordinate columns).
    let orient_col_of = |o_idx: usize| -> Option<usize> {
        orient_layout
            .iter()
            .position(|&o| o == o_idx)
            .map(|pos| n_coord + pos)
    };

    // Track the current row offset for multi-component observations.
    let offsets = compute_obs_offsets(observations);

    for (obs_idx, obs) in observations.iter().enumerate() {
        let row_start = offsets[obs_idx];
        let b = obs.observed.len(); // number of components

        match obs.kind {
            // ── Distance (non-linear, 1 component) ──────────────
            ObservationKind::Distance => {
                let from = obs.point_indices[0];
                let to = obs.point_indices[1];
                let e_from = x[from][0];
                let n_from = x[from][1];
                let e_to = x[to][0];
                let n_to = x[to][1];
                let de = e_to - e_from;
                let dn = n_to - n_from;
                let l_approx = (de * de + dn * dn).sqrt();
                let dl_i = obs.observed[0] - l_approx;

                let mut row = vec![0.0_f64; n_unknowns];
                if l_approx > 1e-12 {
                    if let Some(col) = col_of(from, 0) {
                        row[col] = -de / l_approx;
                    }
                    if let Some(col) = col_of(from, 1) {
                        row[col] = -dn / l_approx;
                    }
                    if let Some(col) = col_of(to, 0) {
                        row[col] = de / l_approx;
                    }
                    if let Some(col) = col_of(to, 1) {
                        row[col] = dn / l_approx;
                    }
                }

                a.push(row);
                dl.push(dl_i);
                // Diagonal covariance.
                sigma[row_start * n_total + row_start] =
                    obs.sigma[0] * obs.sigma[0];
            }

            // ── Height difference (linear, 1 component) ─────────
            ObservationKind::HeightDifference => {
                let from = obs.point_indices[0];
                let to = obs.point_indices[1];

                // Support both 1D parameters (h) and 3D parameters (E,N,H).
                // The height component is at index 2 for 3D points, or index
                // 0 if the point has only 1 component (pure height).
                let h_from = if x[from].len() >= 3 {
                    x[from][2]
                } else if x[from].len() == 1 {
                    x[from][0]
                } else {
                    x[from].get(1).copied().unwrap_or(0.0)
                };
                let h_to = if x[to].len() >= 3 {
                    x[to][2]
                } else if x[to].len() == 1 {
                    x[to][0]
                } else {
                    x[to].get(1).copied().unwrap_or(0.0)
                };

                let dl_i = obs.observed[0] - (h_to - h_from);

                let mut row = vec![0.0_f64; n_unknowns];
                // For 3D points, height is at component index 2.
                // For 1D height-only points, it's at index 0.
                let h_from_comp = if x[from].len() >= 3 { 2 } else { 0 };
                let h_to_comp = if x[to].len() >= 3 { 2 } else { 0 };
                if let Some(col) = col_of(from, h_from_comp) {
                    row[col] = -1.0;
                }
                if let Some(col) = col_of(to, h_to_comp) {
                    row[col] = 1.0;
                }

                a.push(row);
                dl.push(dl_i);
                sigma[row_start * n_total + row_start] =
                    obs.sigma[0] * obs.sigma[0];
            }

            // ── Azimuth (non-linear, 1 component) ───────────────
            ObservationKind::Azimuth => {
                let from = obs.point_indices[0];
                let to = obs.point_indices[1];
                let de = x[to][0] - x[from][0];
                let dn = x[to][1] - x[from][1];
                let l2 = de * de + dn * dn;
                if l2 < 1e-12 {
                    return Err(AdjustmentError::Internal(
                        "Azimuth observation: degenerate (near-zero) baseline".into(),
                    ));
                }
                let alpha = dn.atan2(de);
                let mut misc = obs.observed[0] - alpha;
                // Normalize to (-π, π].
                while misc > std::f64::consts::PI {
                    misc -= 2.0 * std::f64::consts::PI;
                }
                while misc < -std::f64::consts::PI {
                    misc += 2.0 * std::f64::consts::PI;
                }

                let mut row = vec![0.0_f64; n_unknowns];
                if let Some(col) = col_of(from, 0) {
                    row[col] = dn / l2;
                }
                if let Some(col) = col_of(from, 1) {
                    row[col] = -de / l2;
                }
                if let Some(col) = col_of(to, 0) {
                    row[col] = -dn / l2;
                }
                if let Some(col) = col_of(to, 1) {
                    row[col] = de / l2;
                }

                a.push(row);
                dl.push(misc);
                sigma[row_start * n_total + row_start] =
                    obs.sigma[0] * obs.sigma[0];
            }

            // ── Direction (non-linear, 1 component + orientation) ─
            ObservationKind::Direction => {
                let o_idx = obs.orientation_param.expect("validated by caller");
                let from = obs.point_indices[0];
                let to = obs.point_indices[1];
                let de = x[to][0] - x[from][0];
                let dn = x[to][1] - x[from][1];
                let l2 = de * de + dn * dn;
                if l2 < 1e-12 {
                    return Err(AdjustmentError::Internal(
                        "Direction observation: degenerate (near-zero) baseline".into(),
                    ));
                }
                let alpha = dn.atan2(de);
                let z = z[o_idx];
                let mut misc = obs.observed[0] - (alpha - z);
                while misc > std::f64::consts::PI {
                    misc -= 2.0 * std::f64::consts::PI;
                }
                while misc < -std::f64::consts::PI {
                    misc += 2.0 * std::f64::consts::PI;
                }

                let mut row = vec![0.0_f64; n_unknowns];
                if let Some(col) = col_of(from, 0) {
                    row[col] = dn / l2;
                }
                if let Some(col) = col_of(from, 1) {
                    row[col] = -de / l2;
                }
                if let Some(col) = col_of(to, 0) {
                    row[col] = -dn / l2;
                }
                if let Some(col) = col_of(to, 1) {
                    row[col] = de / l2;
                }
                // Orientation contributes a column when it is a free unknown.
                if let Some(ocol) = orient_col_of(o_idx) {
                    row[ocol] = -1.0;
                }

                a.push(row);
                dl.push(misc);
                sigma[row_start * n_total + row_start] =
                    obs.sigma[0] * obs.sigma[0];
            }

            // ── GNSS baseline (linear, 3 components) ────────────
            //
            // A baseline vector from `from` to `to` gives three linear
            // observation equations:
            //   ΔE_obs = E_to − E_from + v₁
            //   ΔN_obs = N_to − N_from + v₂
            //   ΔH_obs = H_to − H_from + v₃
            //
            // Jacobian rows are trivial (∂ΔE/∂E_from = −1, etc.) and
            // the system is exactly linear → one iteration.
            //
            // The3×3 covariance block captures the correlation between
            // components introduced by shared satellite geometry and
            // atmospheric delays.
            ObservationKind::GnssBaseline => {
                let from = obs.point_indices[0];
                let to = obs.point_indices[1];

                // Coordinates (support 2D and 3D points).
                let e_from = x[from][0];
                let n_from = x[from][1];
                let h_from = x[from].get(2).copied().unwrap_or(0.0);
                let e_to = x[to][0];
                let n_to = x[to][1];
                let h_to = x[to].get(2).copied().unwrap_or(0.0);

                // Approximate baseline components.
                let de = e_to - e_from;
                let dn = n_to - n_from;
                let dh = h_to - h_from;

                // Misclosure: observed − computed.
                let misc = [
                    obs.observed[0] - de,
                    obs.observed[1] - dn,
                    obs.observed[2] - dh,
                ];

                // Three design matrix rows (linear — Jacobian is constant).
                for c in 0..3 {
                    let mut row = vec![0.0_f64; n_unknowns];
                    if let Some(col) = col_of(from, c) {
                        row[col] = -1.0;
                    }
                    if let Some(col) = col_of(to, c) {
                        row[col] = 1.0;
                    }
                    a.push(row);
                    dl.push(misc[c]);
                }

                // Covariance: use full block if provided, else diagonal.
                if obs.covariance.len() == 9 {
                    // Full 3×3 covariance block provided by the caller.
                    for i in 0..3 {
                        for j in 0..3 {
                            sigma[(row_start + i) * n_total + row_start + j] =
                                obs.covariance[i * 3 + j];
                        }
                    }
                } else {
                    // Build diagonal covariance from sigma values.
                    for i in 0..3 {
                        sigma[(row_start + i) * n_total + row_start + i] =
                            obs.sigma[i] * obs.sigma[i];
                    }
                }
            }
        }
    }

    Ok((a, dl, sigma))
}

// ─── Matrix algebra helpers ──────────────────────────────────────

/// Compute N = Aᵀ W A where W is a full n×n weight matrix.
/// A is m×p, W is m×m → result is p×p (flattened row-major).
fn matmul_at_w_a(a: &[Vec<f64>], w: &[f64]) -> Vec<f64> {
    let m = a.len();
    let p = a.first().map(|r| r.len()).unwrap_or(0);
    let mut result = vec![0.0_f64; p * p];
    for i in 0..p {
        for j in 0..p {
            let mut sum = 0.0_f64;
            for k in 0..m {
                let mut wsum = 0.0_f64;
                for l in 0..m {
                    wsum += a[k][i] * w[k * m + l];
                }
                sum += wsum * a[k][j];
            }
            result[i * p + j] = sum;
        }
    }
    result
}

/// Compute u = Aᵀ W b where W is a full n×n weight matrix.
/// A is m×p, W is m×m, b is m×1 → result is p×1.
fn matvec_at_w_b(a: &[Vec<f64>], w: &[f64], b: &[f64]) -> Vec<f64> {
    let m = a.len();
    let p = a.first().map(|r| r.len()).unwrap_or(0);
    let mut result = vec![0.0_f64; p];
    for i in 0..p {
        let mut sum = 0.0_f64;
        for k in 0..m {
            let mut wsum = 0.0_f64;
            for l in 0..m {
                wsum += w[k * m + l] * b[l];
            }
            sum += a[k][i] * wsum;
        }
        result[i] = sum;
    }
    result
}

/// Solve a linear system M x = b via Gaussian elimination with partial
/// pivoting.  M is symmetric positive definite (in our case), but the
/// solver is general.
fn solve_linear_system(m: &[f64], b: &[f64]) -> Result<Vec<f64>, AdjustmentError> {
    let n = b.len();
    if m.len() != n * n {
        return Err(AdjustmentError::Internal(format!(
            "matrix is {} entries, expected {}",
            m.len(),
            n * n
        )));
    }

    // Augmented matrix [M | b].
    let mut aug = vec![0.0_f64; n * (n + 1)];
    for i in 0..n {
        for j in 0..n {
            aug[i * (n + 1) + j] = m[i * n + j];
        }
        aug[i * (n + 1) + n] = b[i];
    }

    // Forward elimination with partial pivoting.
    for k in 0..n {
        let mut max_row = k;
        let mut max_val = aug[k * (n + 1) + k].abs();
        for i in (k + 1)..n {
            let v = aug[i * (n + 1) + k].abs();
            if v > max_val {
                max_val = v;
                max_row = i;
            }
        }
        if max_val < 1e-15 {
            return Err(AdjustmentError::SingularMatrix);
        }
        if max_row != k {
            for j in 0..=n {
                let tmp = aug[k * (n + 1) + j];
                aug[k * (n + 1) + j] = aug[max_row * (n + 1) + j];
                aug[max_row * (n + 1) + j] = tmp;
            }
        }
        for i in (k + 1)..n {
            let factor = aug[i * (n + 1) + k] / aug[k * (n + 1) + k];
            for j in k..=n {
                aug[i * (n + 1) + j] -= factor * aug[k * (n + 1) + j];
            }
        }
    }

    // Back substitution.
    let mut x = vec![0.0_f64; n];
    for i in (0..n).rev() {
        let mut sum = aug[i * (n + 1) + n];
        for j in (i + 1)..n {
            sum -= aug[i * (n + 1) + j] * x[j];
        }
        x[i] = sum / aug[i * (n + 1) + i];
    }
    Ok(x)
}

/// Invert a symmetric matrix via Gauss-Jordan elimination.
/// Input is row-major flattened.  Returns row-major flattened inverse.
fn invert_symmetric_matrix(m: &[f64]) -> Result<Vec<f64>, AdjustmentError> {
    let n = (m.len() as f64).sqrt() as usize;
    if n * n != m.len() {
        return Err(AdjustmentError::Internal("matrix not square".into()));
    }

    // Augmented [M | I].
    let mut aug = vec![0.0_f64; n * 2 * n];
    for i in 0..n {
        for j in 0..n {
            aug[i * 2 * n + j] = m[i * n + j];
        }
        aug[i * 2 * n + n + i] = 1.0;
    }

    for k in 0..n {
        let pivot = aug[k * 2 * n + k];
        if pivot.abs() < 1e-15 {
            return Err(AdjustmentError::SingularMatrix);
        }
        for j in 0..(2 * n) {
            aug[k * 2 * n + j] /= pivot;
        }
        for i in 0..n {
            if i == k {
                continue;
            }
            let factor = aug[i * 2 * n + k];
            for j in 0..(2 * n) {
                aug[i * 2 * n + j] -= factor * aug[k * 2 * n + j];
            }
        }
    }

    let mut inv = vec![0.0_f64; n * n];
    for i in 0..n {
        for j in 0..n {
            inv[i * n + j] = aug[i * 2 * n + n + j];
        }
    }
    Ok(inv)
}

// ─── Statistical functions ───────────────────────────────────────

/// Regularized lower incomplete gamma function P(a, x) = γ(a, x) / Γ(a).
fn regularized_lower_gamma(a: f64, x: f64) -> f64 {
    if x < 0.0 || a <= 0.0 {
        return 0.0;
    }
    if x < a + 1.0 {
        let mut term = 1.0 / a;
        let mut sum = term;
        let mut n = 1.0;
        while n < 100.0 {
            term *= x / (a + n);
            sum += term;
            if term.abs() < sum.abs() * 1e-12 {
                break;
            }
            n += 1.0;
        }
        sum * x.powf(a) * (-x).exp() / gamma(a)
    } else {
        let mut b = x + 1.0 - a;
        let mut c = 1e30_f64;
        let mut d = 1.0 / b;
        let mut h = d;
        let mut i = 1;
        while i < 100 {
            let an = -(i as f64) * (i as f64 - a);
            b += 2.0;
            d = an * d + b;
            if d.abs() < 1e-30 {
                d = 1e-30;
            }
            c = b + an / c;
            if c.abs() < 1e-30 {
                c = 1e-30;
            }
            d = 1.0 / d;
            let del = d * c;
            h *= del;
            if (del - 1.0).abs() < 1e-12 {
                break;
            }
            i += 1;
        }
        1.0 - h * x.powf(a) * (-x).exp() / gamma(a)
    }
}

/// Lanczos approximation to the Gamma function Γ(a).
fn gamma(a: f64) -> f64 {
    if a < 0.5 {
        std::f64::consts::PI / ((std::f64::consts::PI * a).sin() * gamma(1.0 - a))
    } else {
        let g = 7.0;
        let c = [
            0.999_999_999_999_809_3,
            676.520_368_121_885_1,
            -1_259.139_216_722_402_8,
            771.323_428_777_653_13,
            -176.615_029_162_140_6,
            12.507_343_278_686_905,
            -0.138_571_095_265_720_12,
            9.984_369_578_019_572e-6,
            1.505_632_735_149_311_6e-7,
        ];
        let a = a - 1.0;
        let mut x = c[0];
        for i in 1..9 {
            x += c[i] / (a + i as f64);
        }
        let t = a + g + 0.5;
        (2.0 * std::f64::consts::PI).sqrt() * t.powf(a + 0.5) * (-t).exp() * x
    }
}

/// P-value for a chi-square statistic with `dof` degrees of freedom.
fn chi_square_p_value(stat: f64, dof: usize) -> f64 {
    if dof == 0 || stat < 0.0 {
        return 1.0;
    }
    let a = dof as f64 / 2.0;
    let x = stat / 2.0;
    let cdf = regularized_lower_gamma(a, x);
    1.0 - cdf
}

// ─── Tests ───────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Existing tests (updated with `covariance: vec![]`) ──────

    /// Simple trilateration: 3 distances to 1 unknown point.
    #[test]
    fn test_trilateration_3_distances_1_point() {
        let parameters = vec![
            ParameterPrior { initial: vec![0.0, 0.0], fixed: true },   // P1
            ParameterPrior { initial: vec![100.0, 0.0], fixed: true }, // P2
            ParameterPrior { initial: vec![0.0, 100.0], fixed: true }, // P3
            ParameterPrior { initial: vec![50.0, 50.0], fixed: false }, // P4 (initial guess off)
        ];
        let d14 = (60.0_f64 * 60.0 + 70.0 * 70.0).sqrt();
        let d24 = (40.0_f64 * 40.0 + 70.0 * 70.0).sqrt();
        let d34 = (60.0_f64 * 60.0 + 30.0 * 30.0).sqrt();

        let observations = vec![
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![0, 3],
                observed: vec![d14],
                orientation_param: None,
                sigma: vec![0.005],
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![1, 3],
                observed: vec![d24],
                orientation_param: None,
                sigma: vec![0.005],
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![2, 3],
                observed: vec![d34],
                orientation_param: None,
                sigma: vec![0.005],
                covariance: vec![],
            },
        ];

        let config = AdjustmentConfig::default();
        let result = adjust_least_squares(&parameters, &observations, &config, &[]).unwrap();

        let p4 = &result.adjusted[3];
        assert!((p4[0] - 60.0).abs() < 1e-6, "E4 = {} (expected 60)", p4[0]);
        assert!((p4[1] - 70.0).abs() < 1e-6, "N4 = {} (expected 70)", p4[1]);
        assert!(
            result.sigma_0_sq < 1e-6,
            "sigma_0_sq = {} (expected ~0)",
            result.sigma_0_sq
        );
        assert_eq!(result.degrees_of_freedom, 1);
        assert_eq!(result.residuals.len(), 3);
        assert!(!result.has_flagged_blunder);
        for (i, r) in result.residuals.iter().enumerate() {
            assert!(r.abs() < 1e-6, "residual[{}] = {}", i, r);
        }
    }

    /// Over-determined system: 4 distances to 1 unknown point with noise.
    #[test]
    fn test_overdetermined_4_distances_with_noise() {
        let parameters = vec![
            ParameterPrior { initial: vec![0.0, 0.0], fixed: true },
            ParameterPrior { initial: vec![100.0, 0.0], fixed: true },
            ParameterPrior { initial: vec![0.0, 100.0], fixed: true },
            ParameterPrior { initial: vec![100.0, 100.0], fixed: true },
            ParameterPrior { initial: vec![50.0, 50.0], fixed: false },
        ];

        let d15 = (60.0_f64 * 60.0 + 70.0 * 70.0).sqrt();
        let d25 = (40.0_f64 * 40.0 + 70.0 * 70.0).sqrt();
        let d35 = (60.0_f64 * 60.0 + 30.0 * 30.0).sqrt();
        let d45 = (40.0_f64 * 40.0 + 30.0 * 30.0).sqrt();

        let observations = vec![
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![0, 4],
                observed: vec![d15 + 0.002],
                orientation_param: None,
                sigma: vec![0.005],
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![1, 4],
                observed: vec![d25],
                orientation_param: None,
                sigma: vec![0.005],
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![2, 4],
                observed: vec![d35],
                orientation_param: None,
                sigma: vec![0.005],
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![3, 4],
                observed: vec![d45],
                orientation_param: None,
                sigma: vec![0.005],
                covariance: vec![],
            },
        ];

        let config = AdjustmentConfig::default();
        let result = adjust_least_squares(&parameters, &observations, &config, &[]).unwrap();

        assert_eq!(result.degrees_of_freedom, 2);
        let p5 = &result.adjusted[4];
        assert!((p5[0] - 60.0).abs() < 0.01, "E5 = {}", p5[0]);
        assert!((p5[1] - 70.0).abs() < 0.01, "N5 = {}", p5[1]);
        assert!(result.sigma_0_sq > 0.0, "sigma_0_sq = {}", result.sigma_0_sq);
        let r_sum: f64 = result.redundancy.iter().sum();
        assert!((r_sum - 2.0).abs() < 1e-6, "sum(r) = {} (expected 2)", r_sum);
    }

    /// Blunder detection: 50 mm error (10× sigma) must produce |w| > 3.29.
    #[test]
    fn test_baarda_blunder_detection() {
        let parameters = vec![
            ParameterPrior { initial: vec![0.0, 0.0], fixed: true },
            ParameterPrior { initial: vec![100.0, 0.0], fixed: true },
            ParameterPrior { initial: vec![0.0, 100.0], fixed: true },
            ParameterPrior { initial: vec![100.0, 100.0], fixed: true },
            ParameterPrior { initial: vec![50.0, 50.0], fixed: false },
        ];

        let d15 = (60.0_f64 * 60.0 + 70.0 * 70.0).sqrt();
        let d25 = (40.0_f64 * 40.0 + 70.0 * 70.0).sqrt();
        let d35 = (60.0_f64 * 60.0 + 30.0 * 30.0).sqrt();
        let d45 = (40.0_f64 * 40.0 + 30.0 * 30.0).sqrt();

        let observations = vec![
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![0, 4],
                observed: vec![d15 + 0.050],
                orientation_param: None,
                sigma: vec![0.005],
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![1, 4],
                observed: vec![d25],
                orientation_param: None,
                sigma: vec![0.005],
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![2, 4],
                observed: vec![d35],
                orientation_param: None,
                sigma: vec![0.005],
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![3, 4],
                observed: vec![d45],
                orientation_param: None,
                sigma: vec![0.005],
                covariance: vec![],
            },
        ];

        let result = adjust_least_squares(
            &parameters,
            &observations,
            &AdjustmentConfig::default(),
            &[],
        )
        .unwrap();

        assert!(result.has_flagged_blunder, "blunder not flagged");
        let max_w_idx = result
            .baarda_w
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| a.abs().partial_cmp(&b.abs()).unwrap())
            .map(|(i, _)| i)
            .unwrap();
        assert_eq!(max_w_idx, 0, "expected obs 0 to have the largest |w|");
        assert!(
            result.baarda_w[0].abs() > 3.29,
            "w[0] = {} (expected |w| > 3.29)",
            result.baarda_w[0]
        );
    }

    /// Under-determined system must error.
    #[test]
    fn test_underdetermined_errors() {
        let parameters = vec![
            ParameterPrior { initial: vec![0.0, 0.0], fixed: true },
            ParameterPrior { initial: vec![50.0, 50.0], fixed: false },
        ];
        let observations = vec![Observation {
            kind: ObservationKind::Distance,
            point_indices: vec![0, 1],
            observed: vec![100.0],
            orientation_param: None,
            sigma: vec![0.005],
            covariance: vec![],
        }];
        let result =
            adjust_least_squares(&parameters, &observations, &AdjustmentConfig::default(), &[]);
        assert!(matches!(result, Err(AdjustmentError::Underdetermined { .. })));
    }

    /// Gamma function sanity checks.
    #[test]
    fn test_gamma_values() {
        assert!((gamma(1.0) - 1.0).abs() < 1e-9);
        assert!((gamma(2.0) - 1.0).abs() < 1e-9);
        assert!((gamma(3.0) - 2.0).abs() < 1e-9);
        assert!((gamma(4.0) - 6.0).abs() < 1e-9);
        assert!((gamma(0.5) - std::f64::consts::PI.sqrt()).abs() < 1e-9);
    }

    /// Chi-square p-value sanity.
    #[test]
    fn test_chi_square_p_value_5_dof() {
        let p = chi_square_p_value(11.07, 5);
        assert!((p - 0.05).abs() < 0.01, "p = {} (expected ~0.05)", p);
    }

    /// Azimuth observation adjusts to the correct point.
    #[test]
    fn test_azimuth_observation_adjusts() {
        use std::f64::consts::FRAC_PI_4;
        let parameters = vec![
            ParameterPrior {
                initial: vec![0.0, 0.0],
                fixed: true,
            },
            ParameterPrior {
                initial: vec![100.01, 100.0],
                fixed: false,
            },
        ];
        let true_dist = (100.0_f64 * 100.0 + 100.0 * 100.0).sqrt();
        let observations = vec![
            Observation {
                kind: ObservationKind::Azimuth,
                point_indices: vec![0, 1],
                observed: vec![FRAC_PI_4],
                sigma: vec![1e-4],
                orientation_param: None,
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![0, 1],
                observed: vec![true_dist],
                sigma: vec![0.005],
                orientation_param: None,
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::Azimuth,
                point_indices: vec![1, 0],
                observed: vec![-3.0 * FRAC_PI_4],
                sigma: vec![1e-4],
                orientation_param: None,
                covariance: vec![],
            },
        ];
        let result = adjust_least_squares(
            &parameters,
            &observations,
            &AdjustmentConfig::default(),
            &[],
        )
        .expect("azimuth adjustment should succeed");
        assert!(
            (result.adjusted[1][0] - 100.0).abs() < 1e-6,
            "E1 = {}",
            result.adjusted[1][0]
        );
        assert!(
            (result.adjusted[1][1] - 100.0).abs() < 1e-6,
            "N1 = {}",
            result.adjusted[1][1]
        );
        for &r in &result.residuals {
            assert!(r.abs() < 1e-9, "residual = {}", r);
        }
    }

    /// Direction observations with free orientation recover the correct point.
    #[test]
    fn test_direction_solves_orientation() {
        use std::f64::consts::FRAC_PI_2;
        let z0 = 0.3;
        let parameters = vec![
            ParameterPrior { initial: vec![0.0, 0.0], fixed: true },
            ParameterPrior { initial: vec![100.0, 0.0], fixed: true },
            ParameterPrior { initial: vec![0.0, 100.01], fixed: false },
        ];
        let orientation_parameters = vec![ParameterPrior {
            initial: vec![0.0],
            fixed: false,
        }];
        let observations = vec![
            Observation {
                kind: ObservationKind::Direction,
                point_indices: vec![0, 1],
                observed: vec![-z0],
                sigma: vec![1e-4],
                orientation_param: Some(0),
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::Direction,
                point_indices: vec![0, 2],
                observed: vec![FRAC_PI_2 - z0],
                sigma: vec![1e-4],
                orientation_param: Some(0),
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![0, 1],
                observed: vec![100.0],
                sigma: vec![0.005],
                orientation_param: None,
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![0, 2],
                observed: vec![100.0],
                sigma: vec![0.005],
                orientation_param: None,
                covariance: vec![],
            },
        ];
        let result = adjust_least_squares(
            &parameters,
            &observations,
            &AdjustmentConfig::default(),
            &orientation_parameters,
        )
        .expect("direction adjustment should succeed");
        assert!(
            (result.adjusted[2][1] - 100.0).abs() < 1e-6,
            "N2 = {}",
            result.adjusted[2][1]
        );
        assert!(
            (result.adjusted_orientations[0] - z0).abs() < 1e-6,
            "z = {}",
            result.adjusted_orientations[0]
        );
        for &r in &result.residuals {
            assert!(r.abs() < 1e-9, "residual = {}", r);
        }
    }

    /// Fixed orientation must be honoured exactly.
    #[test]
    fn test_direction_fixed_orientation_honoured() {
        use std::f64::consts::FRAC_PI_2;
        let z0 = 0.3;
        let parameters = vec![
            ParameterPrior { initial: vec![0.0, 0.0], fixed: true },
            ParameterPrior { initial: vec![100.0, 0.0], fixed: true },
            ParameterPrior { initial: vec![0.0, 100.01], fixed: false },
        ];
        let orientation_parameters = vec![ParameterPrior {
            initial: vec![z0],
            fixed: true,
        }];
        let observations = vec![
            Observation {
                kind: ObservationKind::Direction,
                point_indices: vec![0, 1],
                observed: vec![-z0],
                sigma: vec![1e-4],
                orientation_param: Some(0),
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::Direction,
                point_indices: vec![0, 2],
                observed: vec![FRAC_PI_2 - z0],
                sigma: vec![1e-4],
                orientation_param: Some(0),
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![0, 1],
                observed: vec![100.0],
                sigma: vec![0.005],
                orientation_param: None,
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![0, 2],
                observed: vec![100.0],
                sigma: vec![0.005],
                orientation_param: None,
                covariance: vec![],
            },
        ];
        let result = adjust_least_squares(
            &parameters,
            &observations,
            &AdjustmentConfig::default(),
            &orientation_parameters,
        )
        .expect("direction adjustment should succeed");
        assert!(
            (result.adjusted_orientations[0] - z0).abs() < 1e-12,
            "z = {}",
            result.adjusted_orientations[0]
        );
        assert!(
            (result.adjusted[2][1] - 100.0).abs() < 1e-6,
            "N2 = {}",
            result.adjusted[2][1]
        );
        for &r in &result.residuals {
            assert!(r.abs() < 1e-9, "residual = {}", r);
        }
    }

    // ── NEW tests: GNSS baseline observations ──────────────────

    /// Basic GNSS baseline: a single baseline to one unknown point
    /// with 3D coordinates.  Two fixed + one free point, with 1 baseline
    /// (3 components) → 3 − 3 = 0 dof.  Need ≥2 baselines or mix with
    /// distances.
    ///
    /// This test: 2 fixed points, 1 free point (3D), with 2 GNSS
    /// baselines (6 components, 3 unknowns → dof = 3).
    #[test]
    fn test_gnss_baseline_3d_triangulation() {
        // P1=(0,0,10), P2=(100,0,20) fixed, P3 at (60,70,15) free.
        let parameters = vec![
            ParameterPrior {
                initial: vec![0.0, 0.0, 10.0],
                fixed: true,
            },
            ParameterPrior {
                initial: vec![100.0, 0.0, 20.0],
                fixed: true,
            },
            ParameterPrior {
                initial: vec![50.0, 50.0, 12.0],
                fixed: false,
            },
        ];

        // True baseline P1→P3: (60, 70, 5).
        // True baseline P2→P3: (−40, 70, −5).
        let observations = vec![
            Observation {
                kind: ObservationKind::GnssBaseline,
                point_indices: vec![0, 2],
                observed: vec![60.0, 70.0, 5.0],
                sigma: vec![0.002, 0.002, 0.005],
                orientation_param: None,
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::GnssBaseline,
                point_indices: vec![1, 2],
                observed: vec![-40.0, 70.0, -5.0],
                sigma: vec![0.002, 0.002, 0.005],
                orientation_param: None,
                covariance: vec![],
            },
        ];

        let result = adjust_least_squares(
            &parameters,
            &observations,
            &AdjustmentConfig::default(),
            &[],
        )
        .expect("GNSS adjustment should succeed");

        let p3 = &result.adjusted[2];
        assert!(
            (p3[0] - 60.0).abs() < 1e-6,
            "E3 = {} (expected 60)",
            p3[0]
        );
        assert!(
            (p3[1] - 70.0).abs() < 1e-6,
            "N3 = {} (expected 70)",
            p3[1]
        );
        assert!(
            (p3[2] - 15.0).abs() < 1e-6,
            "H3 = {} (expected 15)",
            p3[2]
        );
        assert_eq!(result.degrees_of_freedom, 3);
        // Perfect observations → residuals ≈ 0.
        for (i, r) in result.residuals.iter().enumerate() {
            assert!(r.abs() < 1e-6, "residual[{}] = {}", i, r);
        }
    }

    /// GNSS baseline with 2D points (no height component).
    /// The height component defaults to 0 for 2D points.
    #[test]
    fn test_gnss_baseline_2d_points() {
        let parameters = vec![
            ParameterPrior {
                initial: vec![0.0, 0.0],
                fixed: true,
            },
            ParameterPrior {
                initial: vec![100.0, 0.0],
                fixed: true,
            },
            ParameterPrior {
                initial: vec![50.0, 50.0],
                fixed: false,
            },
        ];

        // Baselines: P1→P3 = (60, 70, 0), P2→P3 = (−40, 70, 0).
        // The height component is 0 since 2D points have h=0 by default.
        let observations = vec![
            Observation {
                kind: ObservationKind::GnssBaseline,
                point_indices: vec![0, 2],
                observed: vec![60.0, 70.0, 0.0],
                sigma: vec![0.002, 0.002, 0.005],
                orientation_param: None,
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::GnssBaseline,
                point_indices: vec![1, 2],
                observed: vec![-40.0, 70.0, 0.0],
                sigma: vec![0.002, 0.002, 0.005],
                orientation_param: None,
                covariance: vec![],
            },
        ];

        let result = adjust_least_squares(
            &parameters,
            &observations,
            &AdjustmentConfig::default(),
            &[],
        )
        .expect("GNSS adjustment should succeed");

        let p3 = &result.adjusted[2];
        assert!((p3[0] - 60.0).abs() < 1e-6, "E3 = {}", p3[0]);
        assert!((p3[1] - 70.0).abs() < 1e-6, "N3 = {}", p3[1]);
    }

    /// Mixed network: GNSS baselines + distances in the same adjustment.
    /// This is the real-world scenario where GNSS provides absolute
    /// position and distances provide local geometry.
    #[test]
    fn test_mixed_gnss_and_distance() {
        // P1=(0,0) fixed, P2=(100,0) fixed, P3=(60,70) free.
        let parameters = vec![
            ParameterPrior {
                initial: vec![0.0, 0.0],
                fixed: true,
            },
            ParameterPrior {
                initial: vec![100.0, 0.0],
                fixed: true,
            },
            ParameterPrior {
                initial: vec![50.0, 50.0],
                fixed: false,
            },
        ];

        let d13 = (60.0_f64 * 60.0 + 70.0 * 70.0).sqrt(); // ≈ 92.195
        let d23 = (40.0_f64 * 40.0 + 70.0 * 70.0).sqrt(); // ≈ 80.623

        let observations = vec![
            // 1 GNSS baseline from P1 to P3 (3 components).
            Observation {
                kind: ObservationKind::GnssBaseline,
                point_indices: vec![0, 2],
                observed: vec![60.0, 70.0, 0.0],
                sigma: vec![0.002, 0.002, 0.005],
                orientation_param: None,
                covariance: vec![],
            },
            // 1 distance from P2 to P3 (1 component).
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![1, 2],
                observed: vec![d23],
                sigma: vec![0.005],
                orientation_param: None,
                covariance: vec![],
            },
        ];

        // obs components: 3 + 1 = 4.  unknowns: 2 (E3, N3).  dof = 2.
        let result = adjust_least_squares(
            &parameters,
            &observations,
            &AdjustmentConfig::default(),
            &[],
        )
        .expect("mixed adjustment should succeed");

        let p3 = &result.adjusted[2];
        assert!((p3[0] - 60.0).abs() < 1e-6, "E3 = {}", p3[0]);
        assert!((p3[1] - 70.0).abs() < 1e-6, "N3 = {}", p3[1]);
        assert_eq!(result.degrees_of_freedom, 2);
        assert_eq!(result.residuals.len(), 4);
        assert_eq!(result.redundancy.len(), 4);
        assert_eq!(result.baarda_w.len(), 4);
    }

    /// GNSS baseline with correlated covariance block.
    /// The full 3×3 covariance matrix is provided, and the adjustment
    /// must use it instead of the diagonal sigma values.
    #[test]
    fn test_gnss_baseline_correlated_covariance() {
        let parameters = vec![
            ParameterPrior {
                initial: vec![0.0, 0.0, 0.0],
                fixed: true,
            },
            ParameterPrior {
                initial: vec![100.0, 0.0, 0.0],
                fixed: true,
            },
            ParameterPrior {
                initial: vec![50.0, 50.0, 5.0],
                fixed: false,
            },
        ];

        // True P3 at (60, 70, 10).
        // Baseline P1→P3: (60, 70, 10).
        // Baseline P2→P3: (−40, 70, 10).
        // Add small noise to make σ₀² > 0.
        let observations = vec![
            Observation {
                kind: ObservationKind::GnssBaseline,
                point_indices: vec![0, 2],
                // Add 2 mm bias to ΔE.
                observed: vec![60.002, 70.0, 10.0],
                sigma: vec![0.002, 0.002, 0.005],
                orientation_param: None,
                // Correlated covariance: σ²=4e-6 diag, 1e-6 off-diagonal
                // (correlation coefficient ρ = 0.25).
                covariance: vec![
                    4e-6, 1e-6, 0.0, 1e-6, 4e-6, 0.0, 0.0, 0.0, 25e-6,
                ],
            },
            Observation {
                kind: ObservationKind::GnssBaseline,
                point_indices: vec![1, 2],
                observed: vec![-40.0, 70.0, 10.0],
                sigma: vec![0.002, 0.002, 0.005],
                orientation_param: None,
                covariance: vec![
                    4e-6, 0.0, 0.0, 0.0, 4e-6, 0.0, 0.0, 0.0, 25e-6,
                ],
            },
        ];

        let result = adjust_least_squares(
            &parameters,
            &observations,
            &AdjustmentConfig::default(),
            &[],
        )
        .expect("correlated GNSS adjustment should succeed");

        let p3 = &result.adjusted[2];
        // The adjustment should be pulled slightly toward the biased observation.
        assert!(
            (p3[0] - 60.0).abs() < 0.01,
            "E3 = {} (expected near 60)",
            p3[0]
        );
        // Correlated covariance gives slightly different weighting.
        assert!(
            (p3[1] - 70.0).abs() < 0.001,
            "N3 = {} (expected near 70)",
            p3[1]
        );
        assert!(
            (p3[2] - 10.0).abs() < 0.001,
            "H3 = {} (expected near 10)",
            p3[2]
        );
        assert_eq!(result.degrees_of_freedom, 3);
        // σ₀² > 0 because of the bias.
        assert!(
            result.sigma_0_sq > 0.0,
            "sigma_0_sq = {} (expected > 0)",
            result.sigma_0_sq
        );
    }

    /// GNSS baseline with blunder detection.
    /// A 50 mm error in one component (25× its σ) must be flagged.
    #[test]
    fn test_gnss_baseline_blunder_detection() {
        let parameters = vec![
            ParameterPrior {
                initial: vec![0.0, 0.0, 0.0],
                fixed: true,
            },
            ParameterPrior {
                initial: vec![100.0, 0.0, 0.0],
                fixed: true,
            },
            ParameterPrior {
                initial: vec![0.0, 100.0, 0.0],
                fixed: true,
            },
            ParameterPrior {
                initial: vec![50.0, 50.0, 5.0],
                fixed: false,
            },
        ];

        // True P4 at (60, 70, 10).
        let observations = vec![
            Observation {
                kind: ObservationKind::GnssBaseline,
                point_indices: vec![0, 3],
                // 50 mm blunder in ΔE (25 × 2 mm σ).
                observed: vec![60.050, 70.0, 10.0],
                sigma: vec![0.002, 0.002, 0.005],
                orientation_param: None,
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::GnssBaseline,
                point_indices: vec![1, 3],
                observed: vec![-40.0, 70.0, 10.0],
                sigma: vec![0.002, 0.002, 0.005],
                orientation_param: None,
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::GnssBaseline,
                point_indices: vec![2, 3],
                observed: vec![60.0, -30.0, 10.0],
                sigma: vec![0.002, 0.002, 0.005],
                orientation_param: None,
                covariance: vec![],
            },
        ];

        // 9 components, 3 unknowns → dof = 6.
        let result = adjust_least_squares(
            &parameters,
            &observations,
            &AdjustmentConfig::default(),
            &[],
        )
        .expect("GNSS blunder detection should succeed");

        assert!(
            result.has_flagged_blunder,
            "blunder not flagged in GNSS baseline"
        );

        // The first observation's ΔE component (residuals[0]) should
        // have the largest |w|.
        let max_w_idx = result
            .baarda_w
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| a.abs().partial_cmp(&b.abs()).unwrap())
            .map(|(i, _)| i)
            .unwrap();
        assert_eq!(max_w_idx, 0, "expected component 0 (ΔE of baseline 1) to have the largest |w|");
        assert!(
            result.baarda_w[0].abs() > 3.29,
            "w[0] = {} (expected |w| > 3.29)",
            result.baarda_w[0]
        );
    }

    /// Height difference observation with 1D height parameters.
    /// Two fixed height points, one free.  Two observations → dof = 1.
    #[test]
    fn test_height_difference_1d_parameters() {
        let parameters = vec![
            ParameterPrior {
                initial: vec![100.0],
                fixed: true,
            },
            ParameterPrior {
                initial: vec![103.0],
                fixed: true,
            },
            ParameterPrior {
                initial: vec![107.0],
                fixed: false,
            },
        ];

        // h_to − h_from: P0→P2 = 5, P1→P2 = 2.
        let observations = vec![
            Observation {
                kind: ObservationKind::HeightDifference,
                point_indices: vec![0, 2],
                observed: vec![5.0],
                sigma: vec![0.001],
                orientation_param: None,
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::HeightDifference,
                point_indices: vec![1, 2],
                observed: vec![2.0],
                sigma: vec![0.001],
                orientation_param: None,
                covariance: vec![],
            },
        ];

        let result = adjust_least_squares(
            &parameters,
            &observations,
            &AdjustmentConfig::default(),
            &[],
        )
        .expect("height adjustment should succeed");

        // h2 = 100 + 5 = 105.  (Also = 103 + 2 = 105.)
        assert!(
            (result.adjusted[2][0] - 105.0).abs() < 1e-6,
            "H2 = {} (expected 105)",
            result.adjusted[2][0]
        );
    }

    /// Verify that the covariance field size is validated.
    #[test]
    fn test_observation_covariance_validation() {
        let parameters = vec![
            ParameterPrior {
                initial: vec![0.0, 0.0],
                fixed: true,
            },
            ParameterPrior {
                initial: vec![100.0, 0.0],
                fixed: false,
            },
        ];

        // Wrong covariance size (4 elements instead of 9 for a GNSS baseline).
        let observations = vec![Observation {
            kind: ObservationKind::GnssBaseline,
            point_indices: vec![0, 1],
            observed: vec![100.0, 0.0, 0.0],
            sigma: vec![0.002, 0.002, 0.005],
            orientation_param: None,
            covariance: vec![1.0, 0.0, 0.0, 1.0], // wrong size!
        }];

        let result = adjust_least_squares(
            &parameters,
            &observations,
            &AdjustmentConfig::default(),
            &[],
        );
        assert!(
            matches!(result, Err(AdjustmentError::BadObservationDimension { .. })),
            "expected BadObservationDimension error for wrong covariance size"
        );
    }

    /// Verify that an over-determined GNSS network gives sensible
    /// redundancy numbers that sum to the degrees of freedom.
    #[test]
    fn test_gnss_redundancy_sums_to_dof() {
        let parameters = vec![
            ParameterPrior {
                initial: vec![0.0, 0.0, 0.0],
                fixed: true,
            },
            ParameterPrior {
                initial: vec![100.0, 0.0, 0.0],
                fixed: true,
            },
            ParameterPrior {
                initial: vec![0.0, 100.0, 0.0],
                fixed: true,
            },
            ParameterPrior {
                initial: vec![50.0, 50.0, 5.0],
                fixed: false,
            },
        ];

        // True P4 at (60, 70, 10).
        let observations = vec![
            Observation {
                kind: ObservationKind::GnssBaseline,
                point_indices: vec![0, 3],
                observed: vec![60.0, 70.0, 10.0],
                sigma: vec![0.002, 0.002, 0.005],
                orientation_param: None,
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::GnssBaseline,
                point_indices: vec![1, 3],
                observed: vec![-40.0, 70.0, 10.0],
                sigma: vec![0.002, 0.002, 0.005],
                orientation_param: None,
                covariance: vec![],
            },
            Observation {
                kind: ObservationKind::GnssBaseline,
                point_indices: vec![2, 3],
                observed: vec![60.0, -30.0, 10.0],
                sigma: vec![0.002, 0.002, 0.005],
                orientation_param: None,
                covariance: vec![],
            },
        ];

        // 9 components, 3 unknowns → dof = 6.
        let result = adjust_least_squares(
            &parameters,
            &observations,
            &AdjustmentConfig::default(),
            &[],
        )
        .expect("GNSS adjustment should succeed");

        assert_eq!(result.degrees_of_freedom, 6);
        assert_eq!(result.residuals.len(), 9);
        assert_eq!(result.redundancy.len(), 9);
        assert_eq!(result.baarda_w.len(), 9);

        // All residuals should be ~0 for perfect observations.
        for (i, r) in result.residuals.iter().enumerate() {
            assert!(r.abs() < 1e-6, "residual[{}] = {}", i, r);
        }

        // Redundancy numbers should be non-negative.
        for (i, r) in result.redundancy.iter().enumerate() {
            assert!(
                *r >= -0.01,
                "redundancy[{}] = {} (expected >= 0)",
                i,
                r
            );
        }
    }
}
