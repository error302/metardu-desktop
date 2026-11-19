// Standalone validation of the LCC (2SP) functions that live in
// metardu-v2/packages/metardu-sidecar/src/geodesy/projection.rs.
//
// The full sidecar crate cannot compile on this machine (gdal-sys needs
// gdal_i.lib, a Windows GDAL dev prerequisite unrelated to this change),
// so this file mirrors the LCC implementation verbatim (only the
// Ellipsoid struct is inlined) and validates it with `rustc` directly.
//
// Run: rustc --edition 2021 scripts/standalone_lcc_check.rs -o /tmp/lcc && /tmp/lcc

#[derive(Debug, Clone, Copy)]
pub struct Ellipsoid {
    pub name: &'static str,
    pub semi_major_a: f64,
    pub inverse_flattening: f64,
}

pub const WGS84: Ellipsoid = Ellipsoid { name: "WGS84", semi_major_a: 6_378_137.0, inverse_flattening: 298.257_223_563 };
pub const CLARKE_1866: Ellipsoid = Ellipsoid { name: "Clarke 1866", semi_major_a: 6_378_206.4, inverse_flattening: 294.978_698_2 };
pub const GRS80: Ellipsoid = Ellipsoid { name: "GRS80", semi_major_a: 6_378_137.0, inverse_flattening: 298.257_222_101 };

// ─── Lambert Conformal Conic (2SP) — mirrors projection.rs ────────

pub struct LCCParams {
    pub standard_parallel_1_deg: f64,
    pub standard_parallel_2_deg: f64,
    pub latitude_of_origin_deg: f64,
    pub central_meridian_deg: f64,
    pub false_easting_m: f64,
    pub false_northing_m: f64,
    pub ellipsoid: Ellipsoid,
}

fn lcc_m(phi: f64, e2: f64) -> f64 {
    let sin_phi = phi.sin();
    phi.cos() / (1.0 - e2 * sin_phi * sin_phi).sqrt()
}

fn lcc_t(phi: f64, e2: f64) -> f64 {
    let e = e2.sqrt();
    let sin_phi = phi.sin();
    (std::f64::consts::FRAC_PI_4 - phi / 2.0).tan()
        / ((1.0 - e * sin_phi) / (1.0 + e * sin_phi)).powf(e / 2.0)
}

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

    let n = if (phi1 - phi2).abs() < 1e-12 {
        phi1.sin()
    } else {
        (m1.ln() - m2.ln()) / (t1.ln() - t2.ln())
    };
    let f_val = m1 / (n * t1.powf(n));
    let rho = a * f_val * t.powf(n);
    let rho0 = a * f_val * t0.powf(n);
    let theta = n * (lam - lam0);

    let easting = params.false_easting_m + rho * theta.sin();
    let northing = params.false_northing_m + rho0 - rho * theta.cos();
    (easting, northing)
}

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

    let dx = easting - params.false_easting_m;
    let dy = rho0 - (northing - params.false_northing_m);
    let rho = n.signum() * (dx * dx + dy * dy).sqrt();
    // Snyder eq. 14-11 is θ = atan2(E−FE, ρ₀−(N−FN)), valid only for
    // ρ > 0 (n > 0). Southern zones have n < 0 ⇒ ρ < 0, so the raw atan2
    // returns θ ∓ π (a ~280° longitude error). Scaling both arms by
    // sign(n) fixes the quadrant for every n (mirrors projection.rs).
    let theta = (n.signum() * dx).atan2(n.signum() * dy);
    let t = (rho / (a * f_val)).powf(1.0 / n);

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
    let lam = lam0 + theta / n;
    (phi.to_degrees(), lam.to_degrees())
}

fn main() {
    // 1. EPSG GN7-2 §1.3.2.1 worked example (NAD27 / Texas South Central, ftUS).
    const FTUS_TO_M: f64 = 1200.0 / 3937.0;
    let params = LCCParams {
        standard_parallel_1_deg: 28.0 + 23.0 / 60.0,
        standard_parallel_2_deg: 30.0 + 17.0 / 60.0,
        latitude_of_origin_deg: 27.0 + 50.0 / 60.0,
        central_meridian_deg: -99.0,
        false_easting_m: 2_000_000.0 * FTUS_TO_M,
        false_northing_m: 0.0,
        ellipsoid: CLARKE_1866,
    };
    let (e, n) = lambert_conformal_conic_forward(28.5, -96.0, &params);
    let (e_ft, n_ft) = (e / FTUS_TO_M, n / FTUS_TO_M);
    println!("EPSG example: E={e_ft:.2} ftUS (exp 2,963,503.91), N={n_ft:.2} ftUS (exp 254,759.80)");
    assert!((e_ft - 2_963_503.91).abs() < 0.05, "EPSG easting mismatch");
    assert!((n_ft - 254_759.80).abs() < 0.05, "EPSG northing mismatch");
    let (lat, lon) = lambert_conformal_conic_inverse(e, n, &params);
    assert!((lat - 28.5).abs() < 1e-9 && (lon + 96.0).abs() < 1e-9, "EPSG inverse drift");
    println!("EPSG example inverse: lat={lat:.9} lon={lon:.9} — PASS");

    // 2. US SPCS metre zones (values from scripts/verify_lcc.py).
    let cases: Vec<(LCCParams, f64, f64, f64, f64, &str)> = vec![
        (
            LCCParams {
                standard_parallel_1_deg: 27.0 + 50.0 / 60.0,
                standard_parallel_2_deg: 31.0 + 53.0 / 60.0,
                latitude_of_origin_deg: 27.0 + 50.0 / 60.0,
                central_meridian_deg: -99.0,
                false_easting_m: 600_000.0,
                false_northing_m: 4_000_000.0,
                ellipsoid: GRS80,
            },
            29.4241, -98.4936, 649_111.0529, 4_176_348.9526, "TX South Central",
        ),
        (
            LCCParams {
                standard_parallel_1_deg: 34.0 + 2.0 / 60.0,
                standard_parallel_2_deg: 35.0 + 28.0 / 60.0,
                latitude_of_origin_deg: 33.0 + 30.0 / 60.0,
                central_meridian_deg: -118.0,
                false_easting_m: 2_000_000.0,
                false_northing_m: 500_000.0,
                ellipsoid: GRS80,
            },
            34.0522, -118.2437, 1_977_499.7214, 561_280.6456, "California zone 5",
        ),
        (
            LCCParams {
                standard_parallel_1_deg: 40.0 + 40.0 / 60.0,
                standard_parallel_2_deg: 41.0 + 2.0 / 60.0,
                latitude_of_origin_deg: 40.0 + 10.0 / 60.0,
                central_meridian_deg: -74.0,
                false_easting_m: 300_000.0,
                false_northing_m: 0.0,
                ellipsoid: GRS80,
            },
            40.7128, -74.006, 299_493.0052, 60_645.8178, "New York Long Island",
        ),
    ];
    for (p, lat, lon, e_exp, n_exp, name) in cases {
        let (e, n) = lambert_conformal_conic_forward(lat, lon, &p);
        let ok_e = (e - e_exp).abs() < 0.01;
        let ok_n = (n - n_exp).abs() < 0.01;
        let (lat_b, lon_b) = lambert_conformal_conic_inverse(e, n, &p);
        let ok_rt = (lat_b - lat).abs() < 1e-9 && (lon_b - lon).abs() < 1e-9;
        println!(
            "{name}: E={e:.4} (exp {e_exp}) N={n:.4} (exp {n_exp}) forward={} roundtrip={}",
            ok_e && ok_n,
            ok_rt
        );
        assert!(ok_e && ok_n, "{name} forward mismatch");
        assert!(ok_rt, "{name} round-trip drift");
    }

    // 3. Round-trip sweep across each zone's domain.
    let sweep = vec![
        (LCCParams { standard_parallel_1_deg: 27.833_333_333, standard_parallel_2_deg: 31.883_333_333, latitude_of_origin_deg: 27.833_333_333, central_meridian_deg: -99.0, false_easting_m: 600_000.0, false_northing_m: 4_000_000.0, ellipsoid: GRS80 }, 25.0, -107.0, 37.0, -93.0),
        (LCCParams { standard_parallel_1_deg: 34.033_333_333, standard_parallel_2_deg: 35.466_666_667, latitude_of_origin_deg: 33.5, central_meridian_deg: -118.0, false_easting_m: 2_000_000.0, false_northing_m: 500_000.0, ellipsoid: GRS80 }, 32.5, -121.0, 37.5, -114.0),
        (LCCParams { standard_parallel_1_deg: 40.666_666_667, standard_parallel_2_deg: 41.033_333_333, latitude_of_origin_deg: 40.166_666_667, central_meridian_deg: -74.0, false_easting_m: 300_000.0, false_northing_m: 0.0, ellipsoid: GRS80 }, 40.3, -74.5, 41.3, -73.0),
    ];
    for (p, lat_min, lon_min, lat_max, lon_max) in sweep {
        let lat_step = (lat_max - lat_min) / 5.0;
        let lon_step = (lon_max - lon_min) / 5.0;
        let mut i = 0.0;
        while i <= 5.0 {
            let mut j = 0.0;
            while j <= 5.0 {
                let lat = lat_min + lat_step * i;
                let lon = lon_min + lon_step * j;
                let (e, n) = lambert_conformal_conic_forward(lat, lon, &p);
                let (lat_b, lon_b) = lambert_conformal_conic_inverse(e, n, &p);
                assert!((lat_b - lat).abs() < 1e-9 && (lon_b - lon).abs() < 1e-9, "sweep drift at ({lat},{lon})");
                j += 1.0;
            }
            i += 1.0;
        }
    }
    println!("Round-trip sweeps (3 zones × 36 pts): PASS");

    // 4. Edge cases: negative n and the degenerate φ₁=φ₂ single-parallel
    //    branch. Expected values from scripts/verify_lcc.py (independent
    //    Python reference). The negative-n inverse previously returned
    //    θ ∓ π ≈ 280° of longitude error; the sign(n) atan2 fix below is
    //    what makes these pass.
    let edge_cases: Vec<(LCCParams, f64, f64, f64, f64, &str)> = vec![
        // Southern 2SP (35°S / 45°S) — n ≈ −0.6436 < 0.
        (
            LCCParams {
                standard_parallel_1_deg: -35.0,
                standard_parallel_2_deg: -45.0,
                latitude_of_origin_deg: -35.0,
                central_meridian_deg: 120.0,
                false_easting_m: 0.0,
                false_northing_m: 10_000_000.0,
                ellipsoid: GRS80,
            },
            -40.0, 122.0, 170_125.7707, 9_444_543.9277, "Southern 2SP (n<0)",
        ),
        // Equatorial straddle (5°N / 15°S) — n ≈ −0.0876, small |n|.
        (
            LCCParams {
                standard_parallel_1_deg: 5.0,
                standard_parallel_2_deg: -15.0,
                latitude_of_origin_deg: -5.0,
                central_meridian_deg: 30.0,
                false_easting_m: 500_000.0,
                false_northing_m: 1_000_000.0,
                ellipsoid: GRS80,
            },
            -8.0, 33.0, 826_173.6312, 672_348.5418, "Equatorial straddle (n<0)",
        ),
        // Single parallel 34°N — degenerate φ₁=φ₂ branch, n > 0.
        (
            LCCParams {
                standard_parallel_1_deg: 34.0,
                standard_parallel_2_deg: 34.0,
                latitude_of_origin_deg: 0.0,
                central_meridian_deg: -96.0,
                false_easting_m: 0.0,
                false_northing_m: 0.0,
                ellipsoid: GRS80,
            },
            35.0, -95.0, 91_300.6176, 4_093_336.2213, "Single parallel 34N",
        ),
        // Single parallel 34°S — degenerate branch, n < 0.
        (
            LCCParams {
                standard_parallel_1_deg: -34.0,
                standard_parallel_2_deg: -34.0,
                latitude_of_origin_deg: -30.0,
                central_meridian_deg: 150.0,
                false_easting_m: 0.0,
                false_northing_m: 10_000_000.0,
                ellipsoid: GRS80,
            },
            -35.0, 152.0, 182_592.5387, 9_443_377.9337, "Single parallel 34S (n<0)",
        ),
    ];
    for (p, lat, lon, e_exp, n_exp, name) in edge_cases {
        let (e, n) = lambert_conformal_conic_forward(lat, lon, &p);
        let ok_fwd = (e - e_exp).abs() < 0.01 && (n - n_exp).abs() < 0.01;
        let (lat_b, lon_b) = lambert_conformal_conic_inverse(e, n, &p);
        let ok_rt = (lat_b - lat).abs() < 1e-9 && (lon_b - lon).abs() < 1e-9;
        println!(
            "{name}: E={e:.4} N={n:.4} forward={} roundtrip={}",
            ok_fwd,
            ok_rt
        );
        assert!(ok_fwd, "{name} forward mismatch");
        assert!(ok_rt, "{name} round-trip drift");
    }
    println!("LCC edge cases (4 zones, negative-n + degenerate parallel): PASS");
    println!("ALL LCC CHECKS PASSED");
}
