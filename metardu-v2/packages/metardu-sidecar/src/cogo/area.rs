//! Area computations — planar Shoelace + ellipsoidal area with scale factor.
//!
//! References:
//!   - Bradberd, R. M. (1982), "A Note on the Area of a Polygon,"
//!     Surveying and Mapping 42(3): 363-366.
//!   - Snyder, "Map Projections — A Working Manual" USGS PP-1395, §14
//!     (scale factor and true-area corrections)
//!   - Karney, C. F. F. (2013), "Algorithms for geodesics," J. Geodesy
//!     87(1): 43-55 (for the ellipsoidal area via geographiclib)

use serde::{Deserialize, Serialize};

/// Unit of the returned area value.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum AreaUnit {
    SquareMetres,
    Hectares,
    Acres,
}

impl AreaUnit {
    pub fn convert_from_sq_metres(self, sq_metres: f64) -> f64 {
        match self {
            AreaUnit::SquareMetres => sq_metres,
            AreaUnit::Hectares => sq_metres / 10_000.0,
            AreaUnit::Acres => sq_metres / 4_046.856_422_4,
        }
    }
}

/// Shoelace area of a planar polygon.
///
/// Input: Vec<(easting, northing)> in metres, in order around the
/// polygon (CW or CCW — the absolute value is returned).
///
/// Algorithm:
///   A = 0.5 * |Σ (x_i * y_{i+1} - x_{i+1} * y_i)|
///
/// The polygon is implicitly closed (last point connects to first).
///
/// This is the planar area on the projection plane. For statutory
/// cadastral work, you usually want the ellipsoidal (ground) area —
/// see `ellipsoidal_area`.
pub fn shoelace_area(points: &[(f64, f64)]) -> f64 {
    if points.len() < 3 {
        return 0.0;
    }
    let n = points.len();
    let mut sum = 0.0_f64;
    for i in 0..n {
        let j = (i + 1) % n;
        sum += points[i].0 * points[j].1 - points[j].0 * points[i].1;
    }
    (sum / 2.0).abs()
}

/// Ellipsoidal ("true ground") area from a planar polygon area.
///
/// Multiplies the planar area by the combined scale factor (CSF) to
/// recover the ground area. The CSF is:
///   CSF = grid_scale_factor × height_scale_factor
/// where:
///   grid_scale_factor is the point scale factor at the polygon centroid
///   height_scale_factor = (R + h) / R  ≈ 1 + h / R
///   R is the radius of curvature (Gauss-Krüger mean radius at the centroid latitude)
///   h is the orthometric height of the polygon
///
/// For UTM at the equator at sea level, CSF ≈ 0.9996 (the central
/// meridian scale). At 1500 m elevation (Nairobi), CSF ≈ 0.9996 × 1.000235
/// = 0.9998 — a 0.02% correction. For a 1 ha parcel this is ~2 m²,
/// which is well above statutory tolerance.
///
/// Inputs:
///   - planar_area_sq_m: the area from shoelace_area
///   - mean_latitude_deg: latitude of the polygon centroid
///   - mean_height_m: mean orthometric height of the polygon
///   - point_scale_factor: the grid scale factor at the centroid
///     (from the projection — for UTM, typically 0.9996 at the CM
///     and increasing with distance)
///   - ellipsoid: the reference ellipsoid (WGS84, Clarke 1866, etc.)
///
/// Returns: ground area in square metres.
pub fn ellipsoidal_area(
    planar_area_sq_m: f64,
    mean_latitude_deg: f64,
    mean_height_m: f64,
    point_scale_factor: f64,
    ellipsoid: &crate::geodesy::ecef::Ellipsoid,
) -> f64 {
    let lat = mean_latitude_deg.to_radians();
    let a = ellipsoid.semi_major_a;
    let e2 = ellipsoid.e2();

    // Radius of curvature in the prime vertical at the centroid latitude.
    let n = a / (1.0 - e2 * lat.sin() * lat.sin()).sqrt();

    // Radius of curvature in the meridian.
    let m = a * (1.0 - e2) / (1.0 - e2 * lat.sin() * lat.sin()).powi(3).sqrt();

    // Gauss-Krüger mean radius at this latitude.
    let r = (m * n).sqrt();

    // Height scale factor: ground length / ellipsoid length = (R + h) / R.
    let height_scale = (r + mean_height_m) / r;

    // Combined scale factor: grid / ground.
    let csf = point_scale_factor * height_scale;

    // Ground area = planar area / CSF² (areas scale as the square of lengths).
    planar_area_sq_m / (csf * csf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geodesy::datums;

    /// A 100m × 100m square has area 10,000 m² = 1 ha.
    #[test]
    fn test_shoelace_square() {
        let pts = vec![
            (0.0, 0.0),
            (100.0, 0.0),
            (100.0, 100.0),
            (0.0, 100.0),
        ];
        let area = shoelace_area(&pts);
        assert!((area - 10_000.0).abs() < 1e-9, "area = {}", area);
    }

    /// A right triangle with legs 100m has area 5000 m².
    #[test]
    fn test_shoelace_triangle() {
        let pts = vec![
            (0.0, 0.0),
            (100.0, 0.0),
            (0.0, 100.0),
        ];
        let area = shoelace_area(&pts);
        assert!((area - 5_000.0).abs() < 1e-9, "area = {}", area);
    }

    /// Clockwise vs counterclockwise must give the same absolute area.
    #[test]
    fn test_shoelace_orientation_independence() {
        let cw = vec![
            (0.0, 0.0),
            (0.0, 100.0),
            (100.0, 100.0),
            (100.0, 0.0),
        ];
        let ccw = vec![
            (0.0, 0.0),
            (100.0, 0.0),
            (100.0, 100.0),
            (0.0, 100.0),
        ];
        assert!((shoelace_area(&cw) - shoelace_area(&ccw)).abs() < 1e-9);
    }

    /// A degenerate "polygon" with 2 points has zero area.
    #[test]
    fn test_shoelace_degenerate() {
        assert_eq!(shoelace_area(&[(0.0, 0.0), (100.0, 100.0)]), 0.0);
        assert_eq!(shoelace_area(&[(0.0, 0.0)]), 0.0);
        assert_eq!(shoelace_area(&[]), 0.0);
    }

    /// Area unit conversions.
    #[test]
    fn test_area_unit_conversions() {
        let sq_m = 10_000.0_f64;
        assert!((AreaUnit::SquareMetres.convert_from_sq_metres(sq_m) - 10_000.0).abs() < 1e-9);
        assert!((AreaUnit::Hectares.convert_from_sq_metres(sq_m) - 1.0).abs() < 1e-9);
        // 1 ha ≈ 2.471 acres
        assert!((AreaUnit::Acres.convert_from_sq_metres(sq_m) - 2.471_05).abs() < 1e-3);
    }

    /// Ellipsoidal area correction: at 1500 m elevation with UTM scale
    /// factor 0.9996, the ground area should be larger than the planar
    /// area by ~0.04% (CSF² ≈ 0.9996² × 1.000235² ≈ 0.99884, so
    /// ground/planar ≈ 1.00116).
    #[test]
    fn test_ellipsoidal_area_nairobi_elevation() {
        let planar = 10_000.0_f64; // 1 ha on the UTM grid
        let ground = ellipsoidal_area(
            planar,
            -1.286_389,         // Nairobi latitude
            1_500.0,            // Nairobi elevation
            0.9996,             // UTM central meridian scale factor
            &datums::CLARKE_1866,
        );
        // Ground should be slightly larger than planar (correction ~0.1%).
        assert!(ground > planar, "ground {} should exceed planar {}", ground, planar);
        let correction_pct = (ground - planar) / planar * 100.0;
        assert!(
            correction_pct > 0.01 && correction_pct < 0.5,
            "correction {}% out of expected range",
            correction_pct
        );
    }

    /// At sea level on the central meridian, ground area ≈ planar area
    /// (CSF ≈ 1).
    #[test]
    fn test_ellipsoidal_area_sea_level_central_meridian() {
        let planar = 10_000.0_f64;
        let ground = ellipsoidal_area(
            planar,
            0.0,        // equator
            0.0,        // sea level
            1.0,        // unity scale factor (NOT 0.9996 — test only)
            &datums::WGS84,
        );
        assert!((ground - planar).abs() < 1e-6, "ground = {}, planar = {}", ground, planar);
    }
}
