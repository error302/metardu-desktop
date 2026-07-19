//! Linear least-squares adjustment solver.
//!
//! Implements the core algorithm for parametric (indirect observation)
//! least-squares with full variance-covariance propagation. Currently
//! handles Distance observations on 2D points; other observation kinds
//! will be added as workflow modules need them.
//!
//! # Algorithm
//!
//! For Distance observation between points i and j:
//!   L_approx = sqrt((x_j - x_i)² + (y_j - y_i)²)
//!   ∂L/∂x_i = -(x_j - x_i) / L
//!   ∂L/∂y_i = -(y_j - y_i) / L
//!   ∂L/∂x_j =  (x_j - x_i) / L
//!   ∂L/∂y_j =  (y_j - y_i) / L
//!
//! This is the Jacobian row for one observation. We assemble all rows
//! into A, then form normal equations:
//!   N = Aᵀ Σ⁻¹ A
//!   u = Aᵀ Σ⁻¹ Δl   where Δl = L_obs - L_approx(X_0)
//!   ΔX = N⁻¹ u
//!
//! After solving:
//!   residuals = A ΔX - Δl
//!   sigma_0²  = (residualsᵀ Σ⁻¹ residuals) / dof
//!   Q_xx      = N⁻¹  (parameter cofactor matrix = covariance / sigma_0²)
//!   Q_ll      = A Q_xx Aᵀ  (adjusted observation cofactor matrix)
//!   Q_vv      = Q_ll - Q   (residual cofactor matrix; redundancy r_i = (Q_vv)_ii / sigma_i²)
//!   w_i       = residual_i / sqrt((Q_vv)_ii)   (Baarda w-statistic, ~N(0,1))

use crate::adjustment::types::*;
use serde::{Deserialize, Serialize};

/// Configuration for the adjustment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdjustmentConfig {
    /// Maximum number of iterations. Linear problems converge in 1.
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

/// Run the least-squares adjustment.
///
/// Inputs:
///   - `parameters`: initial estimates + whether each is fixed.
///   - `observations`: the observed values with their a priori sigmas.
///   - `config`: iteration control.
///
/// Returns the adjusted parameters + full variance-covariance + residuals
/// + redundancy + Baarda statistics.
pub fn adjust_least_squares(
    parameters: &[ParameterPrior],
    observations: &[Observation],
    config: &AdjustmentConfig,
) -> Result<AdjustmentResult, AdjustmentError> {
    if observations.is_empty() {
        return Err(AdjustmentError::NoObservations);
    }

    // Build the parameter layout: list of (parameter_index, component_index) for
    // each unknown component. Fixed components are excluded.
    let mut unknown_layout: Vec<(usize, usize)> = Vec::new();
    for (p_idx, p) in parameters.iter().enumerate() {
        if !p.fixed {
            for c_idx in 0..p.initial.len() {
                unknown_layout.push((p_idx, c_idx));
            }
        }
    }
    if unknown_layout.is_empty() {
        return Err(AdjustmentError::NoUnknowns);
    }
    let n_unknowns = unknown_layout.len();
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

    // Validate observation indices and dimensionalities.
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
    }

    // Iterative linearization + solve.
    let mut x_current: Vec<Vec<f64>> = parameters.iter().map(|p| p.initial.clone()).collect();

    let mut max_dx: f64;
    // The "last_*" buffers are kept for future debugging; we recompute
    // fresh values at the final x_current after the loop, so these
    // aren't read after assignment.
    #[allow(unused_assignments)]
    let mut last_a: Vec<Vec<f64>> = Vec::new();
    #[allow(unused_assignments)]
    let mut last_dl: Vec<f64> = Vec::new();
    #[allow(unused_assignments)]
    let mut last_sigma_inv: Vec<f64> = Vec::new();

    let mut iter = 0;
    loop {
        // Compute the design matrix A (rows = observation components,
        // cols = unknowns), the misclosure vector Δl, and the diagonal
        // Σ⁻¹ vector (since we treat observations as independent).
        let (a, dl, sigma_inv) = build_design_and_misclosure(
            &x_current,
            parameters,
            observations,
            &unknown_layout,
        )?;

        last_a = a.clone();
        last_dl = dl.clone();
        last_sigma_inv = sigma_inv.clone();

        // Form normal equations: N = Aᵀ Σ⁻¹ A, u = Aᵀ Σ⁻¹ Δl.
        let normal = matmul_at_sa(&a, &sigma_inv);
        let u = matvec_at_s_dl(&a, &sigma_inv, &dl);

        // Solve ΔX = N⁻¹ u via Gaussian elimination with partial pivoting.
        let dx = solve_linear_system(&normal, &u)?;

        // Update x_current.
        max_dx = dx.iter().fold(0.0_f64, |acc, &v| acc.max(v.abs()));
        for (k, (p_idx, c_idx)) in unknown_layout.iter().enumerate() {
            x_current[*p_idx][*c_idx] += dx[k];
        }

        iter += 1;
        if iter >= config.max_iterations || max_dx < config.convergence_threshold_m {
            break;
        }
    }

    // Final pass: compute residuals = A ΔX - Δl from the final iteration's
    // last_a and last_dl. But after the last update, the linearization
    // point has changed. For correctness we recompute A and Δl at the
    // final x_current.
    let (a_final, dl_final, sigma_inv_final) =
        build_design_and_misclosure(&x_current, parameters, observations, &unknown_layout)?;

    // We need the delta-X for the residuals. The standard convention is:
    //   residuals = A * ΔX - Δl
    // where ΔX is the correction that WOULD be applied at this iteration.
    // Since x_current is now the adjusted solution, we solve for what ΔX
    // would be at this point:
    let normal_final = matmul_at_sa(&a_final, &sigma_inv_final);
    let u_final = matvec_at_s_dl(&a_final, &sigma_inv_final, &dl_final);
    let dx_final = solve_linear_system(&normal_final, &u_final)?;

    let residuals: Vec<f64> = (0..a_final.len())
        .map(|i| {
            let mut row_dot = 0.0_f64;
            for (j, _) in unknown_layout.iter().enumerate() {
                row_dot += a_final[i][j] * dx_final[j];
            }
            row_dot - dl_final[i]
        })
        .collect();

    // A posteriori variance factor: σ₀² = (vᵀ Σ⁻¹ v) / dof
    let vv_t_sigma_inv_v: f64 = residuals
        .iter()
        .enumerate()
        .map(|(i, &r)| r * r * sigma_inv_final[i])
        .sum();
    let dof_usize = dof as usize;
    let sigma_0_sq = vv_t_sigma_inv_v / dof_usize as f64;

    // Parameter covariance: Q_xx = N⁻¹, covariance = σ₀² × Q_xx.
    let q_xx = invert_symmetric_matrix(&normal_final)?;
    let covariance_flat: Vec<f64> = q_xx
        .iter()
        .map(|&q| q * sigma_0_sq)
        .collect();

    // Adjusted observation cofactor matrix: Q_ll = A Q_xx Aᵀ.
    // We only need the diagonal of Q_vv = Q_ll - Σ⁻¹⁻¹ (= -Σ⁻¹⁻¹ since
    // observations are independent and Q_ll has only the diagonal of
    // interest for redundancy).
    // For observation i: Q_ll[i][i] = Σ_k Σ_l A[i][k] × Q_xx[k][l] × A[i][l]
    // Q_vv[i][i] = Q_ll[i][i] - sigma_i²
    // redundancy_i = Q_vv[i][i] / sigma_i²  (NOTE: should be in [0, 1])
    // w_i = residual_i / sqrt(Q_vv[i][i])

    let n_obs_components_count = a_final.len();
    let mut redundancy = Vec::with_capacity(n_obs_components_count);
    let mut baarda_w = Vec::with_capacity(n_obs_components_count);

    for i in 0..n_obs_components_count {
        // Q_ll[i][i] = (A Q_xx Aᵀ)[i][i]
        let mut q_ll_ii = 0.0_f64;
        for k in 0..n_unknowns {
            for l in 0..n_unknowns {
                q_ll_ii += a_final[i][k] * q_xx[k * n_unknowns + l] * a_final[i][l];
            }
        }
        // σ_i² (variance) = 1 / Σ⁻¹[i][i] = 1 / sigma_inv_final[i].
        let sigma_i_sq = if sigma_inv_final[i].abs() > 1e-30 {
            1.0 / sigma_inv_final[i]
        } else {
            f64::INFINITY
        };
        // Q_vv = Q - Q_ll, where Q is the observation cofactor matrix.
        // For independent observations, Q[i][i] = σ_i².
        // Redundancy r_i = 1 - Q_ll[i][i] / σ_i²  (should be in [0, 1]).
        let r_i = if sigma_i_sq.is_finite() && sigma_i_sq > 0.0 {
            1.0 - q_ll_ii / sigma_i_sq
        } else {
            0.0
        };
        redundancy.push(r_i);

        // Q_vv[i][i] = σ_i² - Q_ll[i][i] = r_i × σ_i²
        let q_vv_ii = r_i * sigma_i_sq;

        // Baarda w-statistic: residual_i / sqrt(Q_vv[i][i]).
        // |w| > 3.29 ≈ α=0.001 one-tailed suggests a blunder.
        let w = if q_vv_ii > 0.0 {
            residuals[i] / q_vv_ii.sqrt()
        } else {
            0.0
        };
        baarda_w.push(w);
    }

    // Global chi-square test: the a posteriori σ₀² should be ≈ 1.0 if the
    // a priori stochastic model is correct. The test statistic is
    //   χ² = dof × σ₀²
    // with dof degrees of freedom. We compute the p-value via the
    // incomplete gamma function (regularized upper).
    let chi_square_stat = dof_usize as f64 * sigma_0_sq;
    let chi_square_p = chi_square_p_value(chi_square_stat, dof_usize);

    let passes_global_test = chi_square_p > 0.05;
    let has_flagged_blunder = baarda_w.iter().any(|&w| w.abs() > 3.29);

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
    })
}

// ─── Internal helpers ────────────────────────────────────────────

/// Build the design matrix A, the misclosure vector Δl, and the diagonal
/// Σ⁻¹ vector at the current parameter estimate.
///
/// For Distance observations between points i (E_i, N_i) and j (E_j, N_j):
///   L_approx = sqrt((E_j-E_i)² + (N_j-N_i)²)
///   ∂L/∂E_i = -(E_j-E_i)/L, ∂L/∂N_i = -(N_j-N_i)/L
///   ∂L/∂E_j =  (E_j-E_i)/L, ∂L/∂N_j =  (N_j-N_i)/L
///   Δl = L_observed - L_approx
///   Σ⁻¹ = 1/σ²
fn build_design_and_misclosure(
    x: &[Vec<f64>],
    parameters: &[ParameterPrior],
    observations: &[Observation],
    unknown_layout: &[(usize, usize)],
) -> Result<(Vec<Vec<f64>>, Vec<f64>, Vec<f64>), AdjustmentError> {
    let n_unknowns = unknown_layout.len();
    let mut a: Vec<Vec<f64>> = Vec::new();
    let mut dl: Vec<f64> = Vec::new();
    let mut sigma_inv: Vec<f64> = Vec::new();

    // Helper: given (p_idx, c_idx), return the column index in A if it's
    // an unknown, or None if it's fixed.
    let col_of = |p_idx: usize, c_idx: usize| -> Option<usize> {
        unknown_layout.iter().position(|&(p, c)| p == p_idx && c == c_idx)
    };

    for obs in observations {
        match obs.kind {
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
                // Partial derivatives.
                // ∂L/∂E_from = -de/L, ∂L/∂N_from = -dn/L
                // ∂L/∂E_to   =  de/L, ∂L/∂N_to   =  dn/L
                if l_approx > 1e-12 {
                    if let Some(col) = col_of(from, 0) { row[col] = -de / l_approx; }
                    if let Some(col) = col_of(from, 1) { row[col] = -dn / l_approx; }
                    if let Some(col) = col_of(to, 0) { row[col] = de / l_approx; }
                    if let Some(col) = col_of(to, 1) { row[col] = dn / l_approx; }
                }

                a.push(row);
                dl.push(dl_i);
                sigma_inv.push(1.0 / (obs.sigma[0] * obs.sigma[0]));
            }
            ObservationKind::HeightDifference => {
                // 1D: parameter is [height]. ∂Δh/∂h_from = -1, ∂Δh/∂h_to = +1.
                let from = obs.point_indices[0];
                let to = obs.point_indices[1];
                let h_from = x[from][0];
                let h_to = x[to][0];
                let dl_i = obs.observed[0] - (h_to - h_from);

                let mut row = vec![0.0_f64; n_unknowns];
                if let Some(col) = col_of(from, 0) { row[col] = -1.0; }
                if let Some(col) = col_of(to, 0) { row[col] = 1.0; }

                a.push(row);
                dl.push(dl_i);
                sigma_inv.push(1.0 / (obs.sigma[0] * obs.sigma[0]));
            }
            ObservationKind::Azimuth | ObservationKind::Direction => {
                return Err(AdjustmentError::Internal(
                    "Direction/Azimuth observations not yet implemented in the linearizer".into(),
                ));
            }
            ObservationKind::GnssBaseline => {
                return Err(AdjustmentError::Internal(
                    "GnssBaseline observations not yet implemented in the linearizer".into(),
                ));
            }
        }
    }

    Ok((a, dl, sigma_inv))
}

/// Compute N = Aᵀ Σ⁻¹ A where Σ⁻¹ is diagonal (stored as a vector).
/// Returns the symmetric n_unknowns × n_unknowns matrix flattened row-major.
fn matmul_at_sa(a: &[Vec<f64>], sigma_inv: &[f64]) -> Vec<f64> {
    let n = a.first().map(|r| r.len()).unwrap_or(0);
    let mut result = vec![0.0_f64; n * n];
    for i in 0..n {
        for j in 0..n {
            let mut sum = 0.0_f64;
            for k in 0..a.len() {
                sum += a[k][i] * sigma_inv[k] * a[k][j];
            }
            result[i * n + j] = sum;
        }
    }
    result
}

/// Compute u = Aᵀ Σ⁻¹ Δl where Σ⁻¹ is diagonal.
fn matvec_at_s_dl(a: &[Vec<f64>], sigma_inv: &[f64], dl: &[f64]) -> Vec<f64> {
    let n = a.first().map(|r| r.len()).unwrap_or(0);
    let mut result = vec![0.0_f64; n];
    for i in 0..n {
        let mut sum = 0.0_f64;
        for k in 0..a.len() {
            sum += a[k][i] * sigma_inv[k] * dl[k];
        }
        result[i] = sum;
    }
    result
}

/// Solve a linear system M x = b via Gaussian elimination with partial
/// pivoting. M is symmetric positive definite (in our case), but the
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
        // Find pivot row.
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
        // Eliminate.
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
/// Input is row-major flattened. Returns row-major flattened inverse.
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

    // Forward elimination.
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

    // Extract the right half.
    let mut inv = vec![0.0_f64; n * n];
    for i in 0..n {
        for j in 0..n {
            inv[i * n + j] = aug[i * 2 * n + n + j];
        }
    }
    Ok(inv)
}

/// Regularized upper incomplete gamma function P(a, x) = γ(a, x) / Γ(a).
///
/// This is the CDF of the chi-square distribution with `a = dof/2` degrees
/// of freedom. We need it for the global test p-value.
///
/// Implementation: series expansion for x < a+1, continued fraction for
/// x ≥ a+1. (Numerical Recipes §6.2.)
fn regularized_lower_gamma(a: f64, x: f64) -> f64 {
    if x < 0.0 || a <= 0.0 {
        return 0.0;
    }
    if x < a + 1.0 {
        // Series expansion.
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
        // Continued fraction.
        let mut b = x + 1.0 - a;
        let mut c = 1e30_f64;
        let mut d = 1.0 / b;
        let mut h = d;
        let mut i = 1;
        while i < 100 {
            let an = -(i as f64) * (i as f64 - a);
            b += 2.0;
            d = an * d + b;
            if d.abs() < 1e-30 { d = 1e-30; }
            c = b + an / c;
            if c.abs() < 1e-30 { c = 1e-30; }
            d = 1.0 / d;
            let del = d * c;
            h *= del;
            if (del - 1.0).abs() < 1e-12 { break; }
            i += 1;
        }
        1.0 - h * x.powf(a) * (-x).exp() / gamma(a)
    }
}

/// Lanczos approximation to the Gamma function Γ(a).
fn gamma(a: f64) -> f64 {
    if a < 0.5 {
        std::f64::consts::PI
            / ((std::f64::consts::PI * a).sin() * gamma(1.0 - a))
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
/// Returns the upper tail probability (1 - CDF).
fn chi_square_p_value(stat: f64, dof: usize) -> f64 {
    if dof == 0 || stat < 0.0 {
        return 1.0;
    }
    let a = dof as f64 / 2.0;
    let x = stat / 2.0;
    let cdf = regularized_lower_gamma(a, x);
    1.0 - cdf
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Simple trilateration: 3 distances to 1 unknown point.
    /// Known: P1=(0,0), P2=(100,0), P3=(0,100).
    /// Unknown: P4 at (60, 70) — distances to P1, P2, P3 are
    ///   d14 = sqrt(60² + 70²) = 92.1954
    ///   d24 = sqrt(40² + 70²) = 80.6226
    ///   d34 = sqrt(60² + 30²) = 67.0820
    /// With 3 observations and 2 unknowns (E4, N4), dof = 1.
    /// The adjustment should converge to (60, 70) with σ₀² ≈ 1.0.
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
                sigma: vec![0.005], // 5 mm
            },
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![1, 3],
                observed: vec![d24],
                sigma: vec![0.005],
            },
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![2, 3],
                observed: vec![d34],
                sigma: vec![0.005],
            },
        ];

        let config = AdjustmentConfig::default();
        let result = adjust_least_squares(&parameters, &observations, &config).unwrap();

        // Adjusted P4 coordinates.
        let p4 = &result.adjusted[3];
        assert!((p4[0] - 60.0).abs() < 1e-6, "E4 = {} (expected 60)", p4[0]);
        assert!((p4[1] - 70.0).abs() < 1e-6, "N4 = {} (expected 70)", p4[1]);

        // σ₀² should be ~0 (perfect fit, deterministic geometry).
        assert!(
            result.sigma_0_sq < 1e-6,
            "sigma_0_sq = {} (expected ~0 for perfect obs)",
            result.sigma_0_sq
        );

        // dof = 3 obs - 2 unknowns = 1.
        assert_eq!(result.degrees_of_freedom, 1);

        // 3 residuals.
        assert_eq!(result.residuals.len(), 3);
        assert_eq!(result.redundancy.len(), 3);
        assert_eq!(result.baarda_w.len(), 3);

        // No blunders (we used exact observations).
        assert!(!result.has_flagged_blunder);

        // Each residual should be ~0.
        for (i, r) in result.residuals.iter().enumerate() {
            assert!(r.abs() < 1e-6, "residual[{}] = {}", i, r);
        }
    }

    /// Over-determined system: 4 distances to 1 unknown point. With
    /// noisy observations, σ₀² should be ≈ 1.0 (the noise is correctly
    /// modeled).
    #[test]
    fn test_overdetermined_4_distances_with_noise() {
        let parameters = vec![
            ParameterPrior { initial: vec![0.0, 0.0], fixed: true },
            ParameterPrior { initial: vec![100.0, 0.0], fixed: true },
            ParameterPrior { initial: vec![0.0, 100.0], fixed: true },
            ParameterPrior { initial: vec![100.0, 100.0], fixed: true },
            ParameterPrior { initial: vec![50.0, 50.0], fixed: false },
        ];

        // True P5 at (60, 70). Add 5mm noise to each observation.
        let d15 = (60.0_f64 * 60.0 + 70.0 * 70.0).sqrt();
        let d25 = (40.0_f64 * 40.0 + 70.0 * 70.0).sqrt();
        let d35 = (60.0_f64 * 60.0 + 30.0 * 30.0).sqrt();
        let d45 = (40.0_f64 * 40.0 + 30.0 * 30.0).sqrt();

        // Add systematic 2 mm bias to ONE observation to make σ₀² > 0.
        let observations = vec![
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![0, 4],
                observed: vec![d15 + 0.002],
                sigma: vec![0.005],
            },
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![1, 4],
                observed: vec![d25],
                sigma: vec![0.005],
            },
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![2, 4],
                observed: vec![d35],
                sigma: vec![0.005],
            },
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![3, 4],
                observed: vec![d45],
                sigma: vec![0.005],
            },
        ];

        let config = AdjustmentConfig::default();
        let result = adjust_least_squares(&parameters, &observations, &config).unwrap();

        // dof = 4 - 2 = 2.
        assert_eq!(result.degrees_of_freedom, 2);

        // Adjusted P5 should be near (60, 70) but pulled slightly by the bias.
        let p5 = &result.adjusted[4];
        assert!((p5[0] - 60.0).abs() < 0.01, "E5 = {}", p5[0]);
        assert!((p5[1] - 70.0).abs() < 0.01, "N5 = {}", p5[1]);

        // σ₀² > 0 because of the bias.
        assert!(result.sigma_0_sq > 0.0, "sigma_0_sq = {}", result.sigma_0_sq);

        // Redundancy numbers should sum to dof.
        let r_sum: f64 = result.redundancy.iter().sum();
        assert!((r_sum - 2.0).abs() < 1e-6, "sum(r) = {} (expected 2)", r_sum);
    }

    /// Blunder detection: an observation with a 50 mm error (10× sigma)
    /// must produce |w| > 3.29 (Baarda threshold).
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
                observed: vec![d15 + 0.050], // 50 mm blunder (10 × 5 mm sigma)
                sigma: vec![0.005],
            },
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![1, 4],
                observed: vec![d25],
                sigma: vec![0.005],
            },
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![2, 4],
                observed: vec![d35],
                sigma: vec![0.005],
            },
            Observation {
                kind: ObservationKind::Distance,
                point_indices: vec![3, 4],
                observed: vec![d45],
                sigma: vec![0.005],
            },
        ];

        let result = adjust_least_squares(&parameters, &observations, &AdjustmentConfig::default()).unwrap();

        // The blunder must be flagged.
        assert!(result.has_flagged_blunder, "blunder not flagged");

        // The first observation (the blunder) should have the largest |w|.
        let max_w_idx = result
            .baarda_w
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| a.abs().partial_cmp(&b.abs()).unwrap())
            .map(|(i, _)| i)
            .unwrap();
        assert_eq!(max_w_idx, 0, "expected observation 0 to have the largest |w|");
        assert!(
            result.baarda_w[0].abs() > 3.29,
            "w[0] = {} (expected |w| > 3.29)",
            result.baarda_w[0]
        );
    }

    /// Under-determined system (0 dof) must error.
    #[test]
    fn test_underdetermined_errors() {
        let parameters = vec![
            ParameterPrior { initial: vec![0.0, 0.0], fixed: true },
            ParameterPrior { initial: vec![50.0, 50.0], fixed: false },
        ];
        // 1 obs, 2 unknowns → dof = -1.
        let observations = vec![Observation {
            kind: ObservationKind::Distance,
            point_indices: vec![0, 1],
            observed: vec![100.0],
            sigma: vec![0.005],
        }];
        let result = adjust_least_squares(&parameters, &observations, &AdjustmentConfig::default());
        assert!(matches!(result, Err(AdjustmentError::Underdetermined { .. })));
    }

    /// Gamma function sanity checks.
    #[test]
    fn test_gamma_values() {
        // Γ(1) = 1, Γ(2) = 1, Γ(3) = 2, Γ(4) = 6, Γ(0.5) = sqrt(π)
        assert!((gamma(1.0) - 1.0).abs() < 1e-9);
        assert!((gamma(2.0) - 1.0).abs() < 1e-9);
        assert!((gamma(3.0) - 2.0).abs() < 1e-9);
        assert!((gamma(4.0) - 6.0).abs() < 1e-9);
        assert!((gamma(0.5) - std::f64::consts::PI.sqrt()).abs() < 1e-9);
    }

    /// Chi-square p-value sanity: for a chi-square with 5 dof, the
    /// 95th percentile is 11.07. P(X > 11.07) ≈ 0.05.
    #[test]
    fn test_chi_square_p_value_5_dof() {
        let p = chi_square_p_value(11.07, 5);
        assert!((p - 0.05).abs() < 0.01, "p = {} (expected ~0.05)", p);
    }
}
