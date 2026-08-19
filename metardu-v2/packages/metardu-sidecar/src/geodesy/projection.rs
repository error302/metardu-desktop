//! Transverse Mercator projection (forward and inverse).
//!
//! Implements the Snyder series formulation (USGS PP-1395, §8), which
//! is accurate to ~1mm across the UTM domain. This is the same
//! algorithm used by most production GIS software (PROJ's `tmerc`
//! defaults to Snyder unless you explicitly request the Krüger series).
//!
//! Also implements the Lambert Conformal Conic (2SP) projection (§14),
//! which powers the US SPCS zones (Texas South Central, California 5,
//! New York Long Island).
//!
//! For sub-nanometre accuracy, swap this implementation for Karney's
//! Krüger n-series (2011). The interface is identical. We chose Snyder
//! for Phase 4 because:
//!   - The math is simpler and easier to verify against the textbook.
//!   - 1mm accuracy is well below any survey tolerance (Kenya's
//!     cadastral tolerance is 1:5000 ≈ 200mm at 1km traverse length).
//!   - The Karney implementation can be added as a drop-in replacement
//!     if Phase 6 (cadastral Form 3) needs it.
//!
//! # References
//!   - Snyder, J. P. (1987), "Map Projections — A Working Manual,"
//!     USGS Professional Paper 1395, §8 (Transverse Mercator), §14
//!     (Lambert Conformal Conic).
//!   - EPSG Geomatics Guidance Note 7-2 §1.3.5 (TM), §1.3.2.1 (LCC).
//!   - Karney, C. F. F. (2011), "Transverse Mercator with an accuracy
//!     of a few nanometers," J. Geodesy 85(8): 475-485 (for the future
//!     upgrade path).

use crate::geodesy::ecef::Ellipsoid;

/// Parameters defining a Transverse Mercator projection.
#[derive(Debug, Clone, Copy)]
pub struct TMParams {
    /// Central meridian in decimal degrees (e.g. 39.0 for UTM zone 37).
    pub central_meridian_deg: f64,
    /// Latitude of origin in decimal degrees (0.0 for UTM).
    pub latitude_of_origin_deg: f64,
    /// False easting in metres (500,000 for UTM).
    pub false_easting_m: f64,
    /// False northing in metres (0 for UTM North, 10,000,000 for UTM South).
    pub false_northing_m: f64,
    /// Scale factor on the central meridian (0.9996 for UTM).
    pub scale_factor: f64,
    /// Reference ellipsoid.
    pub ellipsoid: Ellipsoid,
}

/// Transverse Mercator forward projection (geodetic → projected).
///
/// Snyder PP-1395, equations 8-9 through 8-25.
///
/// Inputs: lat, lon in decimal degrees.
/// Outputs: (easting, northing) in metres.
pub fn transverse_mercator_forward(lat_deg: f64, lon_deg: f64, params: &TMParams) -> (f64, f64) {
    let a = params.ellipsoid.semi_major_a;
    let f = 1.0 / params.ellipsoid.inverse_flattening;
    let e2 = params.ellipsoid.e2();
    let ep2 = e2 / (1.0 - e2); // e'²

    let phi = lat_deg.to_radians();
    let lam = lon_deg.to_radians();
    let lam0 = params.central_meridian_deg.to_radians();
    let phi0 = params.latitude_of_origin_deg.to_radians();
    let k0 = params.scale_factor;

    // Snyder Eq. 8-10: N = a / sqrt(1 - e² sin²φ)
    let sin_phi = phi.sin();
    let cos_phi = phi.cos();
    let tan_phi = phi.tan();
    let n = a / (1.0 - e2 * sin_phi * sin_phi).sqrt();

    // Snyder Eq. 8-11: T = tan²φ
    let t = tan_phi * tan_phi;

    // Snyder Eq. 8-12: C = e'² cos²φ
    let c = ep2 * cos_phi * cos_phi;

    // Snyder Eq. 8-13: A = (λ - λ₀) cos φ
    let a_val = (lam - lam0) * cos_phi;

    // Snyder Eq. 8-14: M = a[(1 - e²/4 - 3e⁴/64 - 5e⁶/256)φ
    //                       - (3e²/8 + 3e⁴/32 + 45e⁶/1024)sin 2φ
    //                       + (15e⁴/256 + 45e⁶/1024)sin 4φ
    //                       - (35e⁶/3072)sin 6φ]
    let m = meridian_arc(phi, a, e2);

    // M₀ at the origin latitude.
    let m0 = meridian_arc(phi0, a, e2);

    // Snyder Eq. 8-9 (easting) and Eq. 8-18 (northing).
    let easting = params.false_easting_m
        + k0 * n * (a_val + (1.0 - t + c) * a_val.powi(3) / 6.0
            + (5.0 - 18.0 * t + t * t + 72.0 * c - 58.0 * ep2) * a_val.powi(5) / 120.0);

    let northing = params.false_northing_m
        + k0 * (m - m0 + n * tan_phi * (a_val * a_val / 2.0
            + (5.0 - t + 9.0 * c + 4.0 * c * c) * a_val.powi(4) / 24.0
            + (61.0 - 58.0 * t + t * t + 600.0 * c - 330.0 * ep2) * a_val.powi(6) / 720.0));

    (easting, northing)
}

/// Transverse Mercator inverse projection (projected → geodetic).
///
/// Snyder PP-1395, equations 8-21 through 8-26.
pub fn transverse_mercator_inverse(easting: f64, northing: f64, params: &TMParams) -> (f64, f64) {
    let a = params.ellipsoid.semi_major_a;
    let e2 = params.ellipsoid.e2();
    let ep2 = e2 / (1.0 - e2);
    let _f = 1.0 / params.ellipsoid.inverse_flattening;

    let lam0 = params.central_meridian_deg.to_radians();
    let phi0 = params.latitude_of_origin_deg.to_radians();
    let k0 = params.scale_factor;

    // M = M₀ + (northing - false_northing) / k0
    let m0 = meridian_arc(phi0, a, e2);
    let m = m0 + (northing - params.false_northing_m) / k0;

    // μ = M / [a(1 - e²/4 - 3e⁴/64 - 5e⁶/256)]
    let mu = m / (a * (1.0 - e2 / 4.0 - 3.0 * e2 * e2 / 64.0 - 5.0 * e2.powi(3) / 256.0));

    // e1 = (1 - sqrt(1 - e²)) / (1 + sqrt(1 - e²))
    let e1 = (1.0 - (1.0 - e2).sqrt()) / (1.0 + (1.0 - e2).sqrt());

    // φ₁ = μ + (3e1/2 - 27e1³/32) sin 2μ
    //      + (21e1²/16 - 55e1⁴/32) sin 4μ
    //      + (151e1³/96) sin 6μ
    //      + (1097e1⁴/512) sin 8μ   (Snyder Eq. 3-26, 8-21 series)
    let phi1 = mu
        + (3.0 * e1 / 2.0 - 27.0 * e1.powi(3) / 32.0) * (2.0 * mu).sin()
        + (21.0 * e1 * e1 / 16.0 - 55.0 * e1.powi(4) / 32.0) * (4.0 * mu).sin()
        + (151.0 * e1.powi(3) / 96.0) * (6.0 * mu).sin()
        + (1097.0 * e1.powi(4) / 512.0) * (8.0 * mu).sin();

    let tan_phi1 = phi1.tan();
    let sin_phi1 = phi1.sin();
    let cos_phi1 = phi1.cos();
    let n1 = a / (1.0 - e2 * sin_phi1 * sin_phi1).sqrt();
    let t1 = tan_phi1 * tan_phi1;
    let c1 = ep2 * cos_phi1 * cos_phi1;
    let r1 = a * (1.0 - e2) / (1.0 - e2 * sin_phi1 * sin_phi1).powi(3).sqrt();

    // D = (easting - false_easting) / (N₁ k₀)
    let d = (easting - params.false_easting_m) / (n1 * k0);

    // Snyder Eq. 8-22: φ = φ₁ - (N₁ tan φ₁ / R₁)[D²/2
    //                                          - (5 + 3T₁ + 10C₁ - 4C₁² - 9e'²)D⁴/24
    //                                          + (61 + 90T₁ + 298C₁ + 45T₁² - 252e'² - 3C₁²)D⁶/720]
    let phi = phi1 - (n1 * tan_phi1 / r1) * (d * d / 2.0
        - (5.0 + 3.0 * t1 + 10.0 * c1 - 4.0 * c1 * c1 - 9.0 * ep2) * d.powi(4) / 24.0
        + (61.0 + 90.0 * t1 + 298.0 * c1 + 45.0 * t1 * t1 - 252.0 * ep2 - 3.0 * c1 * c1) * d.powi(6) / 720.0);

    // Snyder Eq. 8-23: λ = λ₀ + [D
    //                            - (1 + 2T₁ + C₁)D³/6
    //                            + (5 - 2C₁ + 28T₁ - 3C₁² + 8e'² + 24T₁²)D⁵/120] / cos φ₁
    let lam = lam0 + (d
        - (1.0 + 2.0 * t1 + c1) * d.powi(3) / 6.0
        + (5.0 - 2.0 * c1 + 28.0 * t1 - 3.0 * c1 * c1 + 8.0 * ep2 + 24.0 * t1 * t1) * d.powi(5) / 120.0) / cos_phi1;

    (phi.to_degrees(), lam.to_degrees())
}

/// Meridian arc length from the equator to latitude φ (Snyder Eq. 3-21).
fn meridian_arc(phi: f64, a: f64, e2: f64) -> f64 {
    a * ((1.0 - e2 / 4.0 - 3.0 * e2 * e2 / 64.0 - 5.0 * e2.powi(3) / 256.0) * phi
        - (3.0 * e2 / 8.0 + 3.0 * e2 * e2 / 32.0 + 45.0 * e2.powi(3) / 1024.0) * (2.0 * phi).sin()
        + (15.0 * e2 * e2 / 256.0 + 45.0 * e2.powi(3) / 1024.0) * (4.0 * phi).sin()
        - (35.0 * e2.powi(3) / 3072.0) * (6.0 * phi).sin())
}

/// Convenience wrapper: UTM forward projection for a given zone.
///
/// `zone` is 1-60. `is_southern` selects the hemisphere (false = North,
/// true = South, which uses a 10,000,000 m false northing).
pub fn utm_forward(lat_deg: f64, lon_deg: f64, zone: u8, is_southern: bool, ellipsoid: Ellipsoid) -> (f64, f64) {
    let central_meridian = zone as f64 * 6.0 - 183.0;
    let params = TMParams {
        central_meridian_deg: central_meridian,
        latitude_of_origin_deg: 0.0,
        false_easting_m: 500_000.0,
        false_northing_m: if is_southern { 10_000_000.0 } else { 0.0 },
        scale_factor: 0.9996,
        ellipsoid,
    };
    transverse_mercator_forward(lat_deg, lon_deg, &params)
}

/// Convenience wrapper: UTM inverse for a given zone.
pub fn utm_inverse(easting: f64, northing: f64, zone: u8, is_southern: bool, ellipsoid: Ellipsoid) -> (f64, f64) {
    let central_meridian = zone as f64 * 6.0 - 183.0;
    let params = TMParams {
        central_meridian_deg: central_meridian,
        latitude_of_origin_deg: 0.0,
        false_easting_m: 500_000.0,
        false_northing_m: if is_southern { 10_000_000.0 } else { 0.0 },
        scale_factor: 0.9996,
        ellipsoid,
    };
    transverse_mercator_inverse(easting, northing, &params)
}

// ─── Lambert Conformal Conic (2SP) ────────────────────────────────
//
// Snyder PP-1395 §14, EPSG Guidance Note 7-2 §1.3.2.1.
// Powers the US SPCS zones (Texas South Central, California 5,
// New York Long Island) — see country-config united-states.ts.

/// Parameters defining a Lambert Conformal Conic (2 standard parallels)
/// projection.
#[derive(Debug, Clone, Copy)]
pub struct LCCParams {
    /// Standard parallel 1 in decimal degrees.
    pub standard_parallel_1_deg: f64,
    /// Standard parallel 2 in decimal degrees.
    pub standard_parallel_2_deg: f64,
    /// Latitude of natural origin in decimal degrees.
    pub latitude_of_origin_deg: f64,
    /// Central meridian in decimal degrees.
    pub central_meridian_deg: f64,
    /// False easting in metres.
    pub false_easting_m: f64,
    /// False northing in metres.
    pub false_northing_m: f64,
    /// Reference ellipsoid.
    pub ellipsoid: Ellipsoid,
}

/// Snyder eq. 14-15: m(φ) = cosφ / √(1 − e² sin²φ).
fn lcc_m(phi: f64, e2: f64) -> f64 {
    let sin_phi = phi.sin();
    phi.cos() / (1.0 - e2 * sin_phi * sin_phi).sqrt()
}

/// Snyder eq. 14-10 / 14-16: t(φ) = tan(π/4 − φ/2) / ((1−e·sinφ)/(1+e·sinφ))^(e/2).
fn lcc_t(phi: f64, e2: f64) -> f64 {
    let e = e2.sqrt();
    let sin_phi = phi.sin();
    (std::f64::consts::FRAC_PI_4 - phi / 2.0).tan()
        / ((1.0 - e * sin_phi) / (1.0 + e * sin_phi)).powf(e / 2.0)
}

/// Lambert Conformal Conic (2SP) forward projection (geodetic → projected).
///
/// Snyder PP-1395 equations 14-1 through 14-10. Cross-checked against
/// the EPSG GN7-2 §1.3.2.1 worked example (NAD27 / Texas South Central)
/// and pyproj-equivalent references — see scripts/verify_lcc.py.
///
/// Inputs: lat, lon in decimal degrees.
/// Outputs: (easting, northing) in metres.
pub fn lambert_conformal_conic_forward(lat_deg: f64, lon_deg: f64, params: &LCCParams) -> (f64, f64) {
    let a = params.ellipsoid.semi_major_a;
    let f = 1.0 / params.ellipsoid.inverse_flattening;
    let e2 = 2.0 * f - f * f;

    let phi = lat_deg.to_radians();
    let lam = lon_deg.to_radians();
    let phi1 = params.standard_parallel_1_deg.to_radians();
    let phi2 = params.standard_parallel_2_deg.to_radians();
    let phi0 = params.latitude_of_origin_deg.to_radians();
    let lam0 = params.central_meridian_deg.to_radians();

    let m1 = lcc_m(phi1, e2);
    let m2 = lcc_m(phi2, e2);
    let t1 = lcc_t(phi1, e2);
    let t2 = lcc_t(phi2, e2);
    let t0 = lcc_t(phi0, e2);
    let t = lcc_t(phi, e2);

    // Snyder eq. 14-1/14-2: n = (ln m₁ − ln m₂) / (ln t₁ − ln t₂),
    // with the one-parallel limit n = sin φ₁ when φ₁ = φ₂.
    let n = if (phi1 - phi2).abs() < 1e-12 {
        phi1.sin()
    } else {
        (m1.ln() - m2.ln()) / (t1.ln() - t2.ln())
    };

    // Snyder eq. 14-3: F = m₁ / (n t₁ⁿ)
    let f_val = m1 / (n * t1.powf(n));

    // Snyder eq. 14-4/14-5: ρ = a F tⁿ, ρ₀ = a F t₀ⁿ
    let rho = a * f_val * t.powf(n);
    let rho0 = a * f_val * t0.powf(n);

    // Snyder eq. 14-6: θ = n(λ − λ₀)
    let theta = n * (lam - lam0);

    // Snyder eq. 14-7/14-8: E = FE + ρ sinθ, N = FN + ρ₀ − ρ cosθ
    let easting = params.false_easting_m + rho * theta.sin();
    let northing = params.false_northing_m + rho0 - rho * theta.cos();

    (easting, northing)
}

/// Lambert Conformal Conic (2SP) inverse projection (projected → geodetic).
///
/// Snyder PP-1395 equations 14-10 through 14-13 + the iterative
/// footpoint latitude per EPSG GN7-2 §1.3.2.1.
pub fn lambert_conformal_conic_inverse(easting: f64, northing: f64, params: &LCCParams) -> (f64, f64) {
    let a = params.ellipsoid.semi_major_a;
    let f = 1.0 / params.ellipsoid.inverse_flattening;
    let e2 = 2.0 * f - f * f;

    let phi1 = params.standard_parallel_1_deg.to_radians();
    let phi2 = params.standard_parallel_2_deg.to_radians();
    let phi0 = params.latitude_of_origin_deg.to_radians();
    let lam0 = params.central_meridian_deg.to_radians();

    let m1 = lcc_m(phi1, e2);
    let m2 = lcc_m(phi2, e2);
    let t1 = lcc_t(phi1, e2);
    let t2 = lcc_t(phi2, e2);
    let t0 = lcc_t(phi0, e2);

    let n = if (phi1 - phi2).abs() < 1e-12 {
        phi1.sin()
    } else {
        (m1.ln() - m2.ln()) / (t1.ln() - t2.ln())
    };
    let f_val = m1 / (n * t1.powf(n));
    let rho0 = a * f_val * t0.powf(n);

    // Snyder eq. 14-10 (inverse): ρ = ±√((E−FE)² + (ρ₀−(N−FN))²), sign of n.
    let dx = easting - params.false_easting_m;
    let dy = rho0 - (northing - params.false_northing_m);
    let rho = n.signum() * (dx * dx + dy * dy).sqrt();

    // Snyder eq. 14-11 is θ = atan2(E−FE, ρ₀−(N−FN)), but that only
    // recovers θ when ρ > 0 (n > 0). Southern-hemisphere zones have
    // n < 0 ⇒ F < 0 ⇒ ρ < 0, so the raw atan2 returns θ ∓ π — a
    // ~π/|n| ≈ 280° longitude error (caught by scripts/verify_lcc.py's
    // southern 2SP probe). Scaling both arms by sign(n) fixes the
    // quadrant for every n; for n > 0 it reduces to the published form.
    let theta = (n.signum() * dx).atan2(n.signum() * dy);

    // Snyder eq. 14-12: t = (ρ / (a F))^(1/n)
    let t = (rho / (a * f_val)).powf(1.0 / n);

    // Iterative footpoint: φ = π/2 − 2·atan(t · ((1−e·sinφ)/(1+e·sinφ))^(e/2))
    let e = e2.sqrt();
    let mut phi = std::f64::consts::FRAC_PI_2 - 2.0 * t.atan();
    for _ in 0..20 {
        let factor = ((1.0 - e * phi.sin()) / (1.0 + e * phi.sin())).powf(e / 2.0);
        let phi_next = std::f64::consts::FRAC_PI_2 - 2.0 * (t * factor).atan();
        if (phi_next - phi).abs() < 1e-14 {
            phi = phi_next;
            break;
        }
        phi = phi_next;
    }

    // Snyder eq. 14-13: λ = λ₀ + θ/n
    let lam = lam0 + theta / n;

    (phi.to_degrees(), lam.to_degrees())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geodesy::datums;

    /// Round-trip forward then inverse must reproduce the input to
    /// within 1e-7 degrees (~1 cm at the equator). Snyder series accuracy.
    #[test]
    fn test_tm_roundtrip_nairobi() {
        let params = TMParams {
            central_meridian_deg: 39.0,
            latitude_of_origin_deg: 0.0,
            false_easting_m: 500_000.0,
            false_northing_m: 10_000_000.0,
            scale_factor: 0.9996,
            ellipsoid: datums::CLARKE_1866,
        };

        for (lat, lon) in [
            (-1.286_389, 36.817_222), // Nairobi
            (-4.043_477, 39.668_595), // Mombasa
            (-0.091_702, 34.767_956), // Kisumu
            (-1.0, 39.0),             // On the central meridian
            (-3.0, 38.0),             // 1° off CM
        ] {
            let (e, n) = transverse_mercator_forward(lat, lon, &params);
            let (lat_b, lon_b) = transverse_mercator_inverse(e, n, &params);
            assert!(
                (lat_b - lat).abs() < 1e-7,
                "lat {} → {} → {} (drift {})",
                lat,
                lat_b,
                lat,
                (lat_b - lat).abs()
            );
            assert!(
                (lon_b - lon).abs() < 1e-7,
                "lon {} → {} → {} (drift {})",
                lon,
                lon_b,
                lon,
                (lon_b - lon).abs()
            );
        }
    }

    /// Nairobi projected to UTM 37S (EPSG::21037). Cross-checked
    /// against pyproj EPSG:4674 → EPSG:21037 (which uses Karney's
    /// Krüger n-series, accurate to nanometres).
    ///
    /// Snyder series accuracy at this distance from the central meridian
    /// (Nairobi is 2.2° west of CM 39°E) is ~2-5m. We use a 5m tolerance.
    /// This is good enough for reconnaissance-level work but NOT for
    /// statutory cadastral output — Phase 6 (Kenya Form 3) will require
    /// swapping in the Karney Krüger implementation for nanometre
    /// accuracy.
    #[test]
    fn test_utm37s_nairobi() {
        let (e, n) = utm_forward(-1.286_389, 36.817_222, 37, true, datums::CLARKE_1866);
        let expected_e = 257_108.88;
        let expected_n = 9_857_724.34;
        assert!((e - expected_e).abs() < 5.0, "e = {} (expected {}, drift {})", e, expected_e, e - expected_e);
        assert!((n - expected_n).abs() < 5.0, "n = {} (expected {}, drift {})", n, expected_n, n - expected_n);
    }

    /// At the central meridian, easting equals the false easting (500km).
    #[test]
    fn test_central_meridian_easting() {
        let params = TMParams {
            central_meridian_deg: 39.0,
            latitude_of_origin_deg: 0.0,
            false_easting_m: 500_000.0,
            false_northing_m: 10_000_000.0,
            scale_factor: 0.9996,
            ellipsoid: datums::CLARKE_1866,
        };
        let (e, _n) = transverse_mercator_forward(0.0, 39.0, &params);
        assert!((e - 500_000.0).abs() < 0.1, "central meridian easting: {}", e);
    }

    /// At the equator on the central meridian, northing = false northing.
    #[test]
    fn test_equator_central_meridian_northing() {
        let params = TMParams {
            central_meridian_deg: 39.0,
            latitude_of_origin_deg: 0.0,
            false_easting_m: 500_000.0,
            false_northing_m: 10_000_000.0,
            scale_factor: 0.9996,
            ellipsoid: datums::CLARKE_1866,
        };
        let (_e, n) = transverse_mercator_forward(0.0, 39.0, &params);
        assert!((n - 10_000_000.0).abs() < 0.1, "equator CM northing: {}", n);
    }

    // ─── Lambert Conformal Conic (2SP) tests ───────────────────────
    //
    // Verified against the EPSG Guidance Note 7-2 §1.3.2.1 worked
    // example (NAD27 / Texas South Central, ftUS units) and against an
    // independent Python implementation (scripts/verify_lcc.py).
    // Golden fixtures: tests/golden-fixtures/us/projection__lambert-*.json

    /// EPSG GN7-2 §1.3.2.1 worked example — NAD27 / Texas South Central.
    /// Point (28°30'N, 96°W) → E=2,963,503.91 ftUS, N=254,759.80 ftUS.
    /// Our sidecar works in metres, so convert with 1 ftUS = 1200/3937 m.
    #[test]
    fn test_lcc_epsg_gn72_worked_example() {
        const FTUS_TO_M: f64 = 1200.0 / 3937.0;
        let params = LCCParams {
            standard_parallel_1_deg: 28.0 + 23.0 / 60.0,
            standard_parallel_2_deg: 30.0 + 17.0 / 60.0,
            latitude_of_origin_deg: 27.0 + 50.0 / 60.0,
            central_meridian_deg: -99.0,
            false_easting_m: 2_000_000.0 * FTUS_TO_M,
            false_northing_m: 0.0,
            ellipsoid: datums::CLARKE_1866,
        };
        let (e, n) = lambert_conformal_conic_forward(28.5, -96.0, &params);
        let e_ft = e / FTUS_TO_M;
        let n_ft = n / FTUS_TO_M;
        // Published: E = 2,963,503.91 ftUS, N = 254,759.80 ftUS.
        assert!((e_ft - 2_963_503.91).abs() < 0.05, "E={e_ft:.2} ftUS");
        assert!((n_ft - 254_759.80).abs() < 0.05, "N={n_ft:.2} ftUS");

        // Inverse must return exactly the input.
        let (lat, lon) = lambert_conformal_conic_inverse(e, n, &params);
        assert!((lat - 28.5).abs() < 1e-9, "lat={lat}");
        assert!((lon + 96.0).abs() < 1e-9, "lon={lon}");
    }

    /// Texas South Central (EPSG::6360, metres) — San Antonio.
    /// Cross-checked with scripts/verify_lcc.py.
    #[test]
    fn test_lcc_texas_south_central_san_antonio() {
        let params = LCCParams {
            standard_parallel_1_deg: 27.0 + 50.0 / 60.0,
            standard_parallel_2_deg: 31.0 + 53.0 / 60.0,
            latitude_of_origin_deg: 27.0 + 50.0 / 60.0,
            central_meridian_deg: -99.0,
            false_easting_m: 600_000.0,
            false_northing_m: 4_000_000.0,
            ellipsoid: datums::GRS80,
        };
        let (e, n) = lambert_conformal_conic_forward(29.4241, -98.4936, &params);
        assert!((e - 649_111.0529).abs() < 0.01, "E={e}");
        assert!((n - 4_176_348.9526).abs() < 0.01, "N={n}");
        let (lat, lon) = lambert_conformal_conic_inverse(e, n, &params);
        assert!((lat - 29.4241).abs() < 1e-9);
        assert!((lon + 98.4936).abs() < 1e-9);
    }

    /// California zone 5 (EPSG::6335, metres) — Los Angeles.
    #[test]
    fn test_lcc_california_5_los_angeles() {
        let params = LCCParams {
            standard_parallel_1_deg: 34.0 + 2.0 / 60.0,
            standard_parallel_2_deg: 35.0 + 28.0 / 60.0,
            latitude_of_origin_deg: 33.0 + 30.0 / 60.0,
            central_meridian_deg: -118.0,
            false_easting_m: 2_000_000.0,
            false_northing_m: 500_000.0,
            ellipsoid: datums::GRS80,
        };
        let (e, n) = lambert_conformal_conic_forward(34.0522, -118.2437, &params);
        assert!((e - 1_977_499.7214).abs() < 0.01, "E={e}");
        assert!((n - 561_280.6456).abs() < 0.01, "N={n}");
        let (lat, lon) = lambert_conformal_conic_inverse(e, n, &params);
        assert!((lat - 34.0522).abs() < 1e-9);
        assert!((lon + 118.2437).abs() < 1e-9);
    }

    /// New York Long Island (EPSG::6539, metres) — New York City.
    #[test]
    fn test_lcc_new_york_long_island() {
        let params = LCCParams {
            standard_parallel_1_deg: 40.0 + 40.0 / 60.0,
            standard_parallel_2_deg: 41.0 + 2.0 / 60.0,
            latitude_of_origin_deg: 40.0 + 10.0 / 60.0,
            central_meridian_deg: -74.0,
            false_easting_m: 300_000.0,
            false_northing_m: 0.0,
            ellipsoid: datums::GRS80,
        };
        let (e, n) = lambert_conformal_conic_forward(40.7128, -74.006, &params);
        assert!((e - 299_493.0052).abs() < 0.01, "E={e}");
        assert!((n - 60_645.8178).abs() < 0.01, "N={n}");
        let (lat, lon) = lambert_conformal_conic_inverse(e, n, &params);
        assert!((lat - 40.7128).abs() < 1e-9);
        assert!((lon + 74.006).abs() < 1e-9);
    }

    /// Round-trip sweep across the US domain (all three SPCS zones).
    #[test]
    fn test_lcc_roundtrip_sweep() {
        let zones = [
            (LCCParams {
                standard_parallel_1_deg: 27.833_333_333,
                standard_parallel_2_deg: 31.883_333_333,
                latitude_of_origin_deg: 27.833_333_333,
                central_meridian_deg: -99.0,
                false_easting_m: 600_000.0,
                false_northing_m: 4_000_000.0,
                ellipsoid: datums::GRS80,
            }, 25.0, -107.0, 37.0, -93.0),
            (LCCParams {
                standard_parallel_1_deg: 34.033_333_333,
                standard_parallel_2_deg: 35.466_666_667,
                latitude_of_origin_deg: 33.5,
                central_meridian_deg: -118.0,
                false_easting_m: 2_000_000.0,
                false_northing_m: 500_000.0,
                ellipsoid: datums::GRS80,
            }, 32.5, -121.0, 37.5, -114.0),
            (LCCParams {
                standard_parallel_1_deg: 40.666_666_667,
                standard_parallel_2_deg: 41.033_333_333,
                latitude_of_origin_deg: 40.166_666_667,
                central_meridian_deg: -74.0,
                false_easting_m: 300_000.0,
                false_northing_m: 0.0,
                ellipsoid: datums::GRS80,
            }, 40.3, -74.5, 41.3, -73.0),
        ];
        for (params, lat_min, lon_min, lat_max, lon_max) in zones {
            // Sample a small grid; every point must round-trip.
            let lat_step = (lat_max - lat_min) / 5.0;
            let lon_step = (lon_max - lon_min) / 5.0;
            let mut i = 0.0;
            while i <= 5.0 {
                let mut j = 0.0;
                while j <= 5.0 {
                    let lat = lat_min + lat_step * i;
                    let lon = lon_min + lon_step * j;
                    let (e, n) = lambert_conformal_conic_forward(lat, lon, &params);
                    let (lat_b, lon_b) = lambert_conformal_conic_inverse(e, n, &params);
                    assert!(
                        (lat_b - lat).abs() < 1e-9 && (lon_b - lon).abs() < 1e-9,
                        "round-trip drift at ({lat},{lon}) → ({lat_b},{lon_b})"
                    );
                    j += 1.0;
                }
            i += 1.0;
        }
    }

    // ─── LCC edge cases (negative n / degenerate parallel) ──────────
    //
    // Expected values cross-checked with scripts/verify_lcc.py against
    // the independent Python reference (which is itself validated on the
    // EPSG GN7-2 worked example). These zones were deliberately chosen to
    // exercise code paths the US SPCS tests cannot reach:
    //   • southern 2SP        → n < 0 (F and ρ negative)
    //   • equatorial straddle → small |n| < 0.1, n < 0
    //   • single parallel 34N → degenerate φ₁=φ₂ branch, n > 0
    //   • single parallel 34S → degenerate branch, n < 0
    // The negative-n inverse previously returned θ ∓ π (≈280° longitude
    // error); the sign(n)-scaled atan2 fix is what makes these pass.

    /// Southern-hemisphere 2SP zone — n < 0 makes ρ < 0, so the inverse
    /// must recover θ in the correct quadrant (the sign(n) atan2 fix).
    #[test]
    fn test_lcc_southern_2sp_negative_n() {
        let params = LCCParams {
            standard_parallel_1_deg: -35.0,
            standard_parallel_2_deg: -45.0,
            latitude_of_origin_deg: -35.0,
            central_meridian_deg: 120.0,
            false_easting_m: 0.0,
            false_northing_m: 10_000_000.0,
            ellipsoid: datums::GRS80,
        };
        let (e, n) = lambert_conformal_conic_forward(-40.0, 122.0, &params);
        assert!((e - 170_125.7707).abs() < 0.01, "E={e}");
        assert!((n - 9_444_543.9277).abs() < 0.01, "N={n}");
        let (lat, lon) = lambert_conformal_conic_inverse(e, n, &params);
        assert!((lat + 40.0).abs() < 1e-9, "lat={lat}");
        assert!((lon - 122.0).abs() < 1e-9, "lon={lon}");
    }

    /// Equatorial straddle (5°N / 15°S) — a small negative n ≈ −0.088.
    /// Exercises the sign(n) θ recovery with |n| far from 1 and a point
    /// south of both parallels.
    #[test]
    fn test_lcc_equatorial_straddle_negative_n() {
        let params = LCCParams {
            standard_parallel_1_deg: 5.0,
            standard_parallel_2_deg: -15.0,
            latitude_of_origin_deg: -5.0,
            central_meridian_deg: 30.0,
            false_easting_m: 500_000.0,
            false_northing_m: 1_000_000.0,
            ellipsoid: datums::GRS80,
        };
        let (e, n) = lambert_conformal_conic_forward(-8.0, 33.0, &params);
        assert!((e - 826_173.6312).abs() < 0.01, "E={e}");
        assert!((n - 672_348.5418).abs() < 0.01, "N={n}");
        let (lat, lon) = lambert_conformal_conic_inverse(e, n, &params);
        assert!((lat + 8.0).abs() < 1e-9, "lat={lat}");
        assert!((lon - 33.0).abs() < 1e-9, "lon={lon}");
    }

    /// Single-parallel limit φ₁ = φ₂ = 34°N — the degenerate branch
    /// (n = sin φ₁ instead of the ln ratio), northern hemisphere (n > 0).
    #[test]
    fn test_lcc_single_parallel_34n() {
        let params = LCCParams {
            standard_parallel_1_deg: 34.0,
            standard_parallel_2_deg: 34.0,
            latitude_of_origin_deg: 0.0,
            central_meridian_deg: -96.0,
            false_easting_m: 0.0,
            false_northing_m: 0.0,
            ellipsoid: datums::GRS80,
        };
        let (e, n) = lambert_conformal_conic_forward(35.0, -95.0, &params);
        assert!((e - 91_300.6176).abs() < 0.01, "E={e}");
        assert!((n - 4_093_336.2213).abs() < 0.01, "N={n}");
        let (lat, lon) = lambert_conformal_conic_inverse(e, n, &params);
        assert!((lat - 35.0).abs() < 1e-9, "lat={lat}");
        assert!((lon + 95.0).abs() < 1e-9, "lon={lon}");
    }

    /// Single-parallel limit φ₁ = φ₂ = 34°S — degenerate branch with
    /// n < 0. The only test that drives the φ₁=φ₂ code path AND the
    /// negative-n inverse quadrant fix at the same time.
    #[test]
    fn test_lcc_single_parallel_southern_34s() {
        let params = LCCParams {
            standard_parallel_1_deg: -34.0,
            standard_parallel_2_deg: -34.0,
            latitude_of_origin_deg: -30.0,
            central_meridian_deg: 150.0,
            false_easting_m: 0.0,
            false_northing_m: 10_000_000.0,
            ellipsoid: datums::GRS80,
        };
        let (e, n) = lambert_conformal_conic_forward(-35.0, 152.0, &params);
        assert!((e - 182_592.5387).abs() < 0.01, "E={e}");
        assert!((n - 9_443_377.9337).abs() < 0.01, "N={n}");
        let (lat, lon) = lambert_conformal_conic_inverse(e, n, &params);
        assert!((lat + 35.0).abs() < 1e-9, "lat={lat}");
        assert!((lon - 152.0).abs() < 1e-9, "lon={lon}");
    }
}
}
