//! Baseline covariance estimation from satellite geometry.
//!
//! Given satellite elevation/azimuth angles observed at two GNSS receivers
//! forming a baseline, this module computes a correlated 3x3 covariance
//! matrix (sigma_E, sigma_N, sigma_H) weighted by PDOP.
//!
//! The model:
//!   1. Build the geometry matrix H from satellite elevation/azimuth angles
//!   2. Compute the cofactor matrix Q = (H^T H)^-1
//!   3. Extract PDOP, HDOP, VDOP from the diagonal of Q
//!   4. Estimate UERE (User Equivalent Range Error) from signal statistics
//!   5. Baseline covariance = sigma_0^2 * Q_baseline where Q_baseline
//!      accounts for the differencing of two receivers (common satellites
//!      reduce correlated errors).
//!
//! References:
//!   - Hofmann-Wellenhof et al., "GNSS — GPS, GLONASS, Galileo & Beyond", 2008
//!   - Leick, "GPS Satellite Surveying", 4th ed., Chapter 5
//!   - Rizos, "Principles and Practice of GPS Surveying", 1997

use serde::{Deserialize, Serialize};

// ─── Input types ──────────────────────────────────────────────────────

/// A single satellite observation at one receiver.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SatelliteObs {
    /// Satellite ID (e.g., "G01", "R07", "E14").
    pub satellite_id: String,
    /// Elevation angle in degrees (0 = horizon, 90 = zenith).
    pub elevation_deg: f64,
    /// Azimuth angle in degrees (0 = north, 90 = east).
    pub azimuth_deg: f64,
    /// Signal-to-noise ratio in dB-Hz (optional, used for weighting).
    #[serde(default)]
    pub snr_dbhz: Option<f64>,
}

/// Satellite observations at one receiver for a single epoch.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceiverGeometry {
    /// Receiver name or marker ID.
    pub receiver_id: String,
    /// Satellites observed at this receiver.
    pub satellites: Vec<SatelliteObs>,
}

/// Parameters for baseline covariance estimation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaselineCovarianceParams {
    /// Geometry at the "from" receiver.
    pub from_receiver: ReceiverGeometry,
    /// Geometry at the "to" receiver.
    pub to_receiver: ReceiverGeometry,
    /// Optional: nominal UERE in metres (default: 0.6m for RTK, 3.0m for SPP).
    #[serde(default)]
    pub uere_m: Option<f64>,
    /// Optional: elevation mask in degrees (default: 10).
    #[serde(default)]
    pub elevation_mask_deg: Option<f64>,
    /// Optional: ionospheric correction factor (0-1, default 0.25 for dual-freq).
    #[serde(default)]
    pub iono_correction_factor: Option<f64>,
    /// Optional: tropospheric correction factor (0-1, default 0.25).
    #[serde(default)]
    pub tropo_correction_factor: Option<f64>,
    /// Optional: whether this is an RTK baseline (default: true).
    /// RTK baselines have much better UERE due to carrier-phase corrections.
    #[serde(default)]
    pub is_rtk: Option<bool>,
}

// ─── Output types ─────────────────────────────────────────────────────

/// Result of baseline covariance estimation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaselineCovarianceResult {
    /// The 3x3 covariance matrix stored as a flat row-major vector.
    /// Order: [var_E, cov_EN, cov_EH, cov_NE, var_N, cov_NH, cov_HE, cov_HN, var_H]
    pub covariance: Vec<f64>,
    /// PDOP at the from receiver.
    pub pdop_from: f64,
    /// PDOP at the to receiver.
    pub pdop_to: f64,
    /// Average PDOP for the baseline.
    pub pdop_avg: f64,
    /// HDOP at the from receiver.
    pub hdop_from: f64,
    /// HDOP at the to receiver.
    pub hdop_to: f64,
    /// VDOP at the from receiver.
    pub vdop_from: f64,
    /// VDOP at the to receiver.
    pub vdop_to: f64,
    /// Number of common satellites used.
    pub common_satellites: usize,
    /// Number of satellites at "from" receiver.
    pub sats_from: usize,
    /// Number of satellites at "to" receiver.
    pub sats_to: usize,
    /// Estimated sigma_E (metres).
    pub sigma_e: f64,
    /// Estimated sigma_N (metres).
    pub sigma_n: f64,
    /// Estimated sigma_H (metres).
    pub sigma_h: f64,
    /// Correlation coefficient between E and N components.
    pub correlation_en: f64,
    /// Estimated baseline quality: "excellent", "good", "moderate", "poor".
    pub quality: String,
    /// Warnings (e.g., few common satellites, poor geometry).
    pub warnings: Vec<String>,
}

// ─── Core computation ─────────────────────────────────────────────────

/// Elevation angle in degrees to radians.
fn deg_to_rad(d: f64) -> f64 {
    d * std::f64::consts::PI / 180.0
}

/// Build the geometry matrix H for a single receiver.
///
/// Each row corresponds to one satellite:
///   H_row = [-cos(azi)*cos(ele), -sin(azi)*cos(ele), -sin(ele)]
///
/// This gives the partial derivatives of the range with respect to
/// the receiver position in local ENU coordinates.
fn build_geometry_matrix(sats: &[SatelliteObs], mask_deg: f64) -> Vec<Vec<f64>> {
    let mut h = Vec::new();
    for sat in sats {
        if sat.elevation_deg < mask_deg {
            continue;
        }
        let ele = deg_to_rad(sat.elevation_deg);
        let azi = deg_to_rad(sat.azimuth_deg);
        let cos_ele = ele.cos();
        let sin_ele = ele.sin();
        // ENU geometry: direction cosines from receiver to satellite
        h.push(vec![
            -azi.sin() * cos_ele, // dRange/dE
            -azi.cos() * cos_ele, // dRange/dN
            -sin_ele,             // dRange/dH
        ]);
    }
    h
}

/// Multiply H^T * H for a geometry matrix.
fn hth_multiply(h: &[Vec<f64>]) -> Vec<Vec<f64>> {
    if h.is_empty() {
        return vec![vec![0.0; 3]; 3];
    }
    let n_cols = h[0].len();
    let mut result = vec![vec![0.0; n_cols]; n_cols];
    for i in 0..n_cols {
        for j in 0..n_cols {
            let mut sum = 0.0;
            for row in h {
                sum += row[i] * row[j];
            }
            result[i][j] = sum;
        }
    }
    result
}

/// Invert a 3x3 matrix. Returns None if singular.
fn invert_3x3(m: &[[f64; 3]; 3]) -> Option<[[f64; 3]; 3]> {
    let a = m[0][0];
    let b = m[0][1];
    let c = m[0][2];
    let d = m[1][0];
    let e = m[1][1];
    let f = m[1][2];
    let g = m[2][0];
    let h = m[2][1];
    let k = m[2][2];

    let det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);

    if det.abs() < 1e-15 {
        return None;
    }

    let inv_det = 1.0 / det;
    Some([
        [
            (e * k - f * h) * inv_det,
            (c * h - b * k) * inv_det,
            (b * f - c * e) * inv_det,
        ],
        [
            (f * g - d * k) * inv_det,
            (a * k - c * g) * inv_det,
            (c * d - a * f) * inv_det,
        ],
        [
            (d * h - e * g) * inv_det,
            (b * g - a * h) * inv_det,
            (a * e - b * d) * inv_det,
        ],
    ])
}

/// Compute DOP values from a 3x3 cofactor matrix Q.
fn compute_dop(q: &[[f64; 3]; 3]) -> (f64, f64, f64) {
    // PDOP = sqrt(q_ee + q_nn + q_hh)
    let pdop = (q[0][0] + q[1][1] + q[2][2]).sqrt();
    // HDOP = sqrt(q_ee + q_nn)
    let hdop = (q[0][0] + q[1][1]).sqrt();
    // VDOP = sqrt(q_hh)
    let vdop = q[2][2].sqrt();
    (pdop, hdop, vdop)
}

/// Compute DOP from a geometry matrix H.
fn compute_dop_from_h(h: &[Vec<f64>]) -> (f64, f64, f64, [[f64; 3]; 3]) {
    let hth = hth_multiply(h);
    let hth_arr = [
        [hth[0][0], hth[0][1], hth[0][2]],
        [hth[1][0], hth[1][1], hth[1][2]],
        [hth[2][0], hth[2][1], hth[2][2]],
    ];
    if let Some(q) = invert_3x3(&hth_arr) {
        let (pdop, hdop, vdop) = compute_dop(&q);
        (pdop, hdop, vdop, q)
    } else {
        (99.0, 99.0, 99.0, [[0.0; 3]; 3])
    }
}

/// SNR-weighted elevation factor.
/// Satellites with higher elevation and SNR get lower weight (less noise).
/// Weight = sin^2(ele) * (snr/40)^2 if SNR available, else sin^2(ele).
fn sat_weight(sat: &SatelliteObs) -> f64 {
    let ele_factor = deg_to_rad(sat.elevation_deg).sin().powi(2);
    if let Some(snr) = sat.snr_dbhz {
        let snr_factor = (snr / 40.0).powi(2).min(4.0); // cap at 4x
        ele_factor * snr_factor
    } else {
        ele_factor
    }
}

/// Estimate UERE based on receiver type and corrections applied.
fn estimate_uere(is_rtk: bool, iono_factor: f64, tropo_factor: f64) -> f64 {
    // Base UERE components (metres, 1-sigma)
    let (orbit_err, clock_err, multi_path): (f64, f64, f64) = if is_rtk {
        // RTK: carrier-phase residuals, orbit/clock from corrections
        (0.01, 0.01, 0.005)
    } else {
        // SPP: broadcast ephemeris, single-frequency
        (0.5, 0.3, 0.5)
    };

    let iono_err = if is_rtk {
        // Dual-freq ionosphere-free: ~1mm residual
        0.001
    } else {
        // Klobuchar model: ~5m residual, reduced by correction factor
        5.0 * (1.0 - iono_factor).max(0.01)
    };

    let tropo_err = if is_rtk {
        // Saastamoinen + VMF1: ~1cm residual
        0.01
    } else {
        // Standard troposphere: ~2.3m residual, reduced by correction factor
        2.3 * (1.0 - tropo_factor).max(0.01)
    };

    // Total UERE = sqrt(sum of squares)
    (orbit_err.powi(2) + clock_err.powi(2) + multi_path.powi(2)
        + iono_err.powi(2)
        + tropo_err.powi(2))
    .sqrt()
}

/// Main entry point: estimate baseline covariance from satellite geometry.
pub fn estimate_baseline_covariance(params: &BaselineCovarianceParams) -> BaselineCovarianceResult {
    let mask = params.elevation_mask_deg.unwrap_or(10.0);
    let is_rtk = params.is_rtk.unwrap_or(true);
    let iono_factor = params.iono_correction_factor.unwrap_or(0.25);
    let tropo_factor = params.tropo_correction_factor.unwrap_or(0.25);
    let uere = params.uere_m.unwrap_or_else(|| estimate_uere(is_rtk, iono_factor, tropo_factor));

    // Build geometry matrices for each receiver
    let h_from = build_geometry_matrix(&params.from_receiver.satellites, mask);
    let h_to = build_geometry_matrix(&params.to_receiver.satellites, mask);

    let sats_from = h_from.len();
    let sats_to = h_to.len();

    // Compute DOP for each receiver
    let (pdop_from, hdop_from, vdop_from, _q_from) = compute_dop_from_h(&h_from);
    let (pdop_to, hdop_to, vdop_to, _q_to) = compute_dop_from_h(&h_to);
    let pdop_avg = (pdop_from + pdop_to) / 2.0;

    // Find common satellites (same constellation + PRN at both receivers)
    let sats_from_set: std::collections::HashSet<&str> = params
        .from_receiver
        .satellites
        .iter()
        .filter(|s| s.elevation_deg >= mask)
        .map(|s| s.satellite_id.as_str())
        .collect();
    let sats_to_set: std::collections::HashSet<&str> = params
        .to_receiver
        .satellites
        .iter()
        .filter(|s| s.elevation_deg >= mask)
        .map(|s| s.satellite_id.as_str())
        .collect();
    let common_sats: Vec<&str> = sats_from_set
        .intersection(&sats_to_set)
        .copied()
        .collect();
    let common_count = common_sats.len();

    let mut warnings = Vec::new();

    if common_count < 4 {
        warnings.push(format!(
            "Only {} common satellites — need at least 4 for reliable baseline",
            common_count
        ));
    }

    if pdop_avg > 6.0 {
        warnings.push(format!(
            "High average PDOP ({:.1}) — poor satellite geometry",
            pdop_avg
        ));
    }

    if sats_from < 5 || sats_to < 5 {
        warnings.push(format!(
            "Few satellites: {} at FROM, {} at TO",
            sats_from, sats_to
        ));
    }

    // Build differenced geometry matrix using only common satellites
    // For a baseline, we differenced observations: the geometry matrix
    // for the baseline uses common satellites with their geometry at
    // both receivers.
    let mut h_diff: Vec<Vec<f64>> = Vec::new();
    for sat_id in &common_sats {
        // Find this satellite at both receivers
        let obs_from = params
            .from_receiver
            .satellites
            .iter()
            .find(|s| s.satellite_id == *sat_id);
        let obs_to = params
            .to_receiver
            .satellites
            .iter()
            .find(|s| s.satellite_id == *sat_id);

        if let (Some(of), Some(ot)) = (obs_from, obs_to) {
            let ele_f = deg_to_rad(of.elevation_deg);
            let azi_f = deg_to_rad(of.azimuth_deg);
            let ele_t = deg_to_rad(ot.elevation_deg);
            let azi_t = deg_to_rad(ot.azimuth_deg);

            // Average geometry for the baseline (common mode)
            let avg_ele = (ele_f + ele_t) / 2.0;
            let avg_azi = (azi_f + azi_t) / 2.0;

            // SNR-weighted geometry
            let w = (sat_weight(of) + sat_weight(ot)) / 2.0;

            h_diff.push(vec![
                -avg_azi.sin() * avg_ele.cos() * w,
                -avg_azi.cos() * avg_ele.cos() * w,
                -avg_ele.sin() * w,
            ]);
        }
    }

    // Compute cofactor matrix for the baseline
    let hth = hth_multiply(&h_diff);
    let hth_arr = [
        [hth[0][0], hth[0][1], hth[0][2]],
        [hth[1][0], hth[1][1], hth[1][2]],
        [hth[2][0], hth[2][1], hth[2][2]],
    ];

    let (sigma_e, sigma_n, sigma_h, covariance, correlation_en) =
        if let Some(q) = invert_3x3(&hth_arr) {
            // For differenced baselines, the variance is reduced by the
            // differencing: sigma_baseline^2 = 2 * sigma_single^2 for
            // independent receivers, but common satellites reduce this.
            // The reduction factor depends on the fraction of common satellites.
            let differencing_factor = if common_count > 0 {
                // Common-mode reduction: between 1/sqrt(n_common) and sqrt(2)
                // For RTK baselines, the factor is close to 1 (full correction)
                if is_rtk {
                    1.0
                } else {
                    // For SPP: sqrt(2) * (1 - common_fraction * 0.5)
                    let common_fraction = common_count as f64
                        / (sats_from.max(sats_to) as f64).max(1.0);
                    (2.0_f64).sqrt() * (1.0 - common_fraction * 0.5)
                }
            } else {
                (2.0_f64).sqrt()
            };

            let se = (q[0][0]).sqrt() * uere * differencing_factor;
            let sn = (q[1][1]).sqrt() * uere * differencing_factor;
            let sh = (q[2][2]).sqrt() * uere * differencing_factor;

            // Build full 3x3 covariance matrix
            let cov = vec![
                q[0][0] * uere * uere * differencing_factor.powi(2),
                q[0][1] * uere * uere * differencing_factor.powi(2),
                q[0][2] * uere * uere * differencing_factor.powi(2),
                q[1][0] * uere * uere * differencing_factor.powi(2),
                q[1][1] * uere * uere * differencing_factor.powi(2),
                q[1][2] * uere * uere * differencing_factor.powi(2),
                q[2][0] * uere * uere * differencing_factor.powi(2),
                q[2][1] * uere * uere * differencing_factor.powi(2),
                q[2][2] * uere * uere * differencing_factor.powi(2),
            ];

            // Correlation coefficient between E and N
            let corr_en = if se > 1e-10 && sn > 1e-10 {
                cov[1] / (se * sn)
            } else {
                0.0
            };

            (se, sn, sh, cov, corr_en)
        } else {
            // Singular matrix — fall back to PDOP-based estimation
            let base_sigma = uere * pdop_avg;
            let cov = vec![
                base_sigma.powi(2) * 0.4,
                0.0,
                0.0,
                0.0,
                base_sigma.powi(2) * 0.4,
                0.0,
                0.0,
                0.0,
                base_sigma.powi(2) * 0.6,
            ];
            (base_sigma * 0.63, base_sigma * 0.63, base_sigma * 0.77, cov, 0.0)
        };

    // Quality assessment
    let quality = if pdop_avg < 2.0 && common_count >= 8 {
        "excellent"
    } else if pdop_avg < 3.5 && common_count >= 6 {
        "good"
    } else if pdop_avg < 6.0 && common_count >= 4 {
        "moderate"
    } else {
        "poor"
    };

    BaselineCovarianceResult {
        covariance,
        pdop_from,
        pdop_to,
        pdop_avg,
        hdop_from,
        hdop_to,
        vdop_from,
        vdop_to,
        common_satellites: common_count,
        sats_from,
        sats_to,
        sigma_e,
        sigma_n,
        sigma_h,
        correlation_en,
        quality: quality.to_string(),
        warnings,
    }
}

// ─── IPC handler ──────────────────────────────────────────────────────

use crate::dispatcher::HandlerError;

pub async fn handle_estimate_baseline_covariance(
    params: serde_json::Value,
) -> Result<serde_json::Value, HandlerError> {
    let p: BaselineCovarianceParams = serde_json::from_value(params)
        .map_err(|e| HandlerError::InvalidParams(e.to_string()))?;

    let result = estimate_baseline_covariance(&p);
    serde_json::to_value(result)
        .map_err(|e| HandlerError::Internal(e.to_string()))
}

/// Batch estimation: estimate covariance for multiple baselines at once.
/// Each baseline is identified by from/to receiver IDs, and the params
/// contain all receiver geometries keyed by receiver ID.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchCovarianceParams {
    /// All receiver geometries, keyed by receiver ID.
    pub receivers: std::collections::HashMap<String, ReceiverGeometry>,
    /// Baselines to estimate, each identified by (from_id, to_id).
    pub baselines: Vec<(String, String)>,
    /// Optional: UERE override for all baselines.
    #[serde(default)]
    pub uere_m: Option<f64>,
    /// Optional: elevation mask override.
    #[serde(default)]
    pub elevation_mask_deg: Option<f64>,
    /// Optional: RTK flag override.
    #[serde(default)]
    pub is_rtk: Option<f64>,
}

pub async fn handle_batch_estimate_covariance(
    params: serde_json::Value,
) -> Result<serde_json::Value, HandlerError> {
    let p: BatchCovarianceParams = serde_json::from_value(params)
        .map_err(|e| HandlerError::InvalidParams(e.to_string()))?;

    let mut results = Vec::new();
    for (from_id, to_id) in &p.baselines {
        let from_recv = p.receivers.get(from_id).ok_or_else(|| {
            HandlerError::InvalidParams(format!("Unknown receiver: {}", from_id))
        })?;
        let to_recv = p.receivers.get(to_id).ok_or_else(|| {
            HandlerError::InvalidParams(format!("Unknown receiver: {}", to_id))
        })?;

        let cov_params = BaselineCovarianceParams {
            from_receiver: from_recv.clone(),
            to_receiver: to_recv.clone(),
            uere_m: p.uere_m,
            elevation_mask_deg: p.elevation_mask_deg,
            iono_correction_factor: None,
            tropo_correction_factor: None,
            is_rtk: p.is_rtk.map(|v| v > 0.5),
        };

        let result = estimate_baseline_covariance(&cov_params);
        results.push(serde_json::json!({
            "from": from_id,
            "to": to_id,
            "result": serde_json::to_value(result).unwrap_or_default(),
        }));
    }

    serde_json::to_value(serde_json::json!({ "baselines": results }))
        .map_err(|e| HandlerError::Internal(e.to_string()))
}

// ─── Tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_sat(id: &str, ele: f64, azi: f64) -> SatelliteObs {
        SatelliteObs {
            satellite_id: id.to_string(),
            elevation_deg: ele,
            azimuth_deg: azi,
            snr_dbhz: Some(42.0),
        }
    }

    fn make_receiver(id: &str, sats: Vec<SatelliteObs>) -> ReceiverGeometry {
        ReceiverGeometry {
            receiver_id: id.to_string(),
            satellites: sats,
        }
    }

    #[test]
    fn test_basic_estimation_with_good_geometry() {
        // 8 GPS satellites well-distributed across the sky
        let from_sats = vec![
            make_sat("G01", 75.0, 0.0),   // near zenith
            make_sat("G03", 45.0, 45.0),  // NE
            make_sat("G06", 30.0, 90.0),  // E
            make_sat("G09", 20.0, 135.0), // SE
            make_sat("G12", 35.0, 180.0), // S
            make_sat("G15", 25.0, 225.0), // SW
            make_sat("G18", 40.0, 270.0), // W
            make_sat("G21", 50.0, 315.0), // NW
        ];
        let to_sats = from_sats.clone();

        let params = BaselineCovarianceParams {
            from_receiver: make_receiver("STN_A", from_sats),
            to_receiver: make_receiver("STN_B", to_sats),
            uere_m: Some(0.005), // RTK-quality: 5mm UERE
            elevation_mask_deg: Some(10.0),
            iono_correction_factor: None,
            tropo_correction_factor: None,
            is_rtk: Some(true),
        };

        let result = estimate_baseline_covariance(&params);

        // Should have 8 common satellites
        assert_eq!(result.common_satellites, 8);

        // PDOP should be reasonable (< 3 for good geometry)
        assert!(
            result.pdop_from < 3.0,
            "PDOP from should be < 3, got {}",
            result.pdop_from
        );
        assert!(
            result.pdop_to < 3.0,
            "PDOP to should be < 3, got {}",
            result.pdop_to
        );

        // Sigma values should be in mm range for RTK
        assert!(
            result.sigma_e < 0.01,
            "sigma_E should be < 10mm, got {}",
            result.sigma_e
        );
        assert!(
            result.sigma_n < 0.015,
            "sigma_N should be < 15mm, got {}",
            result.sigma_n
        );
        assert!(
            result.sigma_h < 0.02,
            "sigma_H should be < 20mm, got {}",
            result.sigma_h
        );

        // Covariance matrix should be 9 elements
        assert_eq!(result.covariance.len(), 9);

        // Covariance should be symmetric (within floating point)
        let rel_err = (result.covariance[1] - result.covariance[3]).abs()
            / result.covariance[1].abs().max(1e-15);
        assert!(
            rel_err < 1e-10,
            "Covariance should be symmetric, off-diag rel err: {}",
            rel_err
        );

        // Quality should be excellent or good
        assert!(
            result.quality == "excellent" || result.quality == "good",
            "Quality should be excellent or good, got {}",
            result.quality
        );

        // No warnings for good geometry
        assert!(
            result.warnings.is_empty(),
            "Should have no warnings, got {:?}",
            result.warnings
        );
    }

    #[test]
    fn test_poor_geometry_generates_warnings() {
        // Only 2 satellites — way too few
        let from_sats = vec![make_sat("G01", 15.0, 90.0), make_sat("G03", 25.0, 270.0)];
        let to_sats = from_sats.clone();

        let params = BaselineCovarianceParams {
            from_receiver: make_receiver("A", from_sats),
            to_receiver: make_receiver("B", to_sats),
            uere_m: Some(0.005),
            elevation_mask_deg: Some(10.0),
            iono_correction_factor: None,
            tropo_correction_factor: None,
            is_rtk: Some(true),
        };

        let result = estimate_baseline_covariance(&params);

        assert_eq!(result.common_satellites, 2);
        assert!(!result.warnings.is_empty(), "Should have warnings for few sats");
        assert_eq!(result.quality, "poor");
    }

    #[test]
    fn test_no_common_satellites() {
        let from_sats = vec![make_sat("G01", 45.0, 0.0), make_sat("G03", 60.0, 90.0)];
        let to_sats = vec![make_sat("R05", 45.0, 180.0), make_sat("E10", 60.0, 270.0)];

        let params = BaselineCovarianceParams {
            from_receiver: make_receiver("A", from_sats),
            to_receiver: make_receiver("B", to_sats),
            uere_m: Some(0.005),
            elevation_mask_deg: Some(10.0),
            iono_correction_factor: None,
            tropo_correction_factor: None,
            is_rtk: Some(true),
        };

        let result = estimate_baseline_covariance(&params);

        assert_eq!(result.common_satellites, 0);
        assert!(!result.warnings.is_empty());
        assert_eq!(result.quality, "poor");
    }

    #[test]
    fn test_spp_vs_rtk_uere() {
        let sats = vec![
            make_sat("G01", 75.0, 0.0),
            make_sat("G03", 45.0, 45.0),
            make_sat("G06", 30.0, 90.0),
            make_sat("G09", 20.0, 135.0),
            make_sat("G12", 35.0, 180.0),
            make_sat("G15", 25.0, 225.0),
        ];

        let rtk_params = BaselineCovarianceParams {
            from_receiver: make_receiver("A", sats.clone()),
            to_receiver: make_receiver("B", sats.clone()),
            uere_m: None,
            elevation_mask_deg: Some(10.0),
            iono_correction_factor: None,
            tropo_correction_factor: None,
            is_rtk: Some(true),
        };

        let spp_params = BaselineCovarianceParams {
            from_receiver: make_receiver("A", sats.clone()),
            to_receiver: make_receiver("B", sats),
            uere_m: None,
            elevation_mask_deg: Some(10.0),
            iono_correction_factor: None,
            tropo_correction_factor: None,
            is_rtk: Some(false),
        };

        let rtk_result = estimate_baseline_covariance(&rtk_params);
        let spp_result = estimate_baseline_covariance(&spp_params);

        // RTK should have much smaller sigmas than SPP
        assert!(
            rtk_result.sigma_e < spp_result.sigma_e,
            "RTK sigma_E ({}) should be < SPP sigma_E ({})",
            rtk_result.sigma_e,
            spp_result.sigma_e
        );
        assert!(
            rtk_result.sigma_h < spp_result.sigma_h,
            "RTK sigma_H ({}) should be < SPP sigma_H ({})",
            rtk_result.sigma_h,
            spp_result.sigma_h
        );
    }

    #[test]
    fn test_snr_weighting() {
        let sats_high_snr = vec![
            make_sat("G01", 45.0, 0.0),
            make_sat("G03", 45.0, 90.0),
            make_sat("G06", 45.0, 180.0),
            make_sat("G09", 45.0, 270.0),
        ];

        let mut sats_low_snr = sats_high_snr.clone();
        for s in &mut sats_low_snr {
            s.snr_dbhz = Some(20.0); // much weaker signal
        }

        let params_high = BaselineCovarianceParams {
            from_receiver: make_receiver("A", sats_high_snr.clone()),
            to_receiver: make_receiver("B", sats_high_snr),
            uere_m: Some(0.005),
            elevation_mask_deg: Some(10.0),
            iono_correction_factor: None,
            tropo_correction_factor: None,
            is_rtk: Some(true),
        };

        let params_low = BaselineCovarianceParams {
            from_receiver: make_receiver("A", sats_low_snr.clone()),
            to_receiver: make_receiver("B", sats_low_snr),
            uere_m: Some(0.005),
            elevation_mask_deg: Some(10.0),
            iono_correction_factor: None,
            tropo_correction_factor: None,
            is_rtk: Some(true),
        };

        let result_high = estimate_baseline_covariance(&params_high);
        let result_low = estimate_baseline_covariance(&params_low);

        // High SNR should give better (smaller) sigma
        assert!(
            result_high.sigma_e <= result_low.sigma_e,
            "High SNR sigma_E ({}) should be <= low SNR sigma_E ({})",
            result_high.sigma_e,
            result_low.sigma_e
        );
    }

    #[test]
    fn test_elevation_mask_filters_low_sats() {
        let mut sats = vec![
            make_sat("G01", 75.0, 0.0),
            make_sat("G03", 45.0, 90.0),
            make_sat("G06", 5.0, 180.0),  // Below 10deg mask
            make_sat("G09", 3.0, 270.0),  // Below 10deg mask
        ];

        let params = BaselineCovarianceParams {
            from_receiver: make_receiver("A", sats.clone()),
            to_receiver: make_receiver("B", sats.clone()),
            uere_m: Some(0.005),
            elevation_mask_deg: Some(10.0),
            iono_correction_factor: None,
            tropo_correction_factor: None,
            is_rtk: Some(true),
        };

        let result = estimate_baseline_covariance(&params);

        // Only 2 sats above mask -> should warn about few common
        assert_eq!(result.common_satellites, 2);
        assert!(!result.warnings.is_empty());
    }

    #[test]
    fn test_handler_rejects_bad_params() {
        let result = async_block_on(handle_estimate_baseline_covariance(
            serde_json::json!({}),
        ));
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code(), "INVALID_PARAMS");
    }

    #[test]
    fn test_handler_round_trips_json() {
        let from_sats = vec![
            make_sat("G01", 75.0, 0.0),
            make_sat("G03", 45.0, 45.0),
            make_sat("G06", 30.0, 90.0),
            make_sat("G09", 20.0, 135.0),
            make_sat("G12", 35.0, 180.0),
            make_sat("G15", 25.0, 225.0),
        ];

        let params = serde_json::json!({
            "from_receiver": {
                "receiver_id": "STN_A",
                "satellites": from_sats.iter().map(|s| serde_json::json!({
                    "satellite_id": s.satellite_id,
                    "elevation_deg": s.elevation_deg,
                    "azimuth_deg": s.azimuth_deg,
                    "snr_dbhz": s.snr_dbhz,
                })).collect::<Vec<_>>()
            },
            "to_receiver": {
                "receiver_id": "STN_B",
                "satellites": from_sats.iter().map(|s| serde_json::json!({
                    "satellite_id": s.satellite_id,
                    "elevation_deg": s.elevation_deg,
                    "azimuth_deg": s.azimuth_deg,
                    "snr_dbhz": s.snr_dbhz,
                })).collect::<Vec<_>>()
            },
            "uere_m": 0.005,
            "is_rtk": true
        });

        let result = async_block_on(handle_estimate_baseline_covariance(params));
        assert!(result.is_ok(), "handler should succeed");

        let val = result.unwrap();
        assert!(val["covariance"].is_array());
        assert_eq!(val["covariance"].as_array().unwrap().len(), 9);
        assert!(val["common_satellites"].as_u64().unwrap() >= 4);
        assert!(val["quality"].as_str().unwrap() != "poor");
    }

    // Tiny futures executor
    fn async_block_on<F>(f: F) -> Result<serde_json::Value, HandlerError>
    where
        F: std::future::Future<Output = Result<serde_json::Value, HandlerError>>,
    {
        use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};
        let mut fut = Box::pin(f);
        static VTABLE: RawWakerVTable = RawWakerVTable::new(
            |_| RawWaker::new(std::ptr::null(), &VTABLE),
            |_| {},
            |_| {},
            |_| {},
        );
        let waker = unsafe { Waker::from_raw(RawWaker::new(std::ptr::null(), &VTABLE)) };
        let mut ctx = Context::from_waker(&waker);
        loop {
            match fut.as_mut().poll(&mut ctx) {
                Poll::Ready(res) => return res,
                Poll::Pending => {}
            }
        }
    }
}
