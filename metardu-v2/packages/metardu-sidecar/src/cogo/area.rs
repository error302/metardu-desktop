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

/// Bound quadratic self-intersection work at the untrusted IPC boundary.
pub const MAX_PLANAR_POLYGON_VERTICES: usize = 5_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlanarEdgeMetrics {
    /// Bearing in decimal degrees clockwise from the positive northing axis.
    pub bearing_deg: f64,
    pub distance_m: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlanarPolygonMetrics {
    /// Area on the supplied planar metre grid. This is not ground area.
    pub planar_area_sq_m: f64,
    pub perimeter_m: f64,
    pub edges: Vec<PlanarEdgeMetrics>,
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum PolygonError {
    #[error("Polygon must contain at least three distinct vertices")]
    TooFewVertices,
    #[error("Polygon exceeds the maximum of 5000 vertices")]
    TooManyVertices,
    #[error("Polygon coordinates must be finite numbers")]
    NonFiniteCoordinate,
    #[error("Polygon contains a zero-length edge or repeated adjacent vertex")]
    ZeroLengthEdge,
    #[error("Polygon ring self-intersects")]
    SelfIntersection,
    #[error("Polygon has zero planar area")]
    Degenerate,
    #[error("Polygon metric result is outside the finite numeric range")]
    NonFiniteResult,
}

fn cross(a: (f64, f64), b: (f64, f64), c: (f64, f64)) -> f64 {
    (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0)
}

fn on_segment(a: (f64, f64), b: (f64, f64), p: (f64, f64)) -> bool {
    p.0 >= a.0.min(b.0)
        && p.0 <= a.0.max(b.0)
        && p.1 >= a.1.min(b.1)
        && p.1 <= a.1.max(b.1)
}

fn segments_intersect(a: (f64, f64), b: (f64, f64), c: (f64, f64), d: (f64, f64)) -> bool {
    let o1 = cross(a, b, c);
    let o2 = cross(a, b, d);
    let o3 = cross(c, d, a);
    let o4 = cross(c, d, b);

    if !o1.is_finite() || !o2.is_finite() || !o3.is_finite() || !o4.is_finite() {
        return true;
    }
    if ((o1 > 0.0 && o2 < 0.0) || (o1 < 0.0 && o2 > 0.0))
        && ((o3 > 0.0 && o4 < 0.0) || (o3 < 0.0 && o4 > 0.0))
    {
        return true;
    }
    (o1 == 0.0 && on_segment(a, b, c))
        || (o2 == 0.0 && on_segment(a, b, d))
        || (o3 == 0.0 && on_segment(c, d, a))
        || (o4 == 0.0 && on_segment(c, d, b))
}

/// Validate a simple planar ring and return its grid-plane area, perimeter,
/// and per-edge bearings/distances. Inputs are easting/northing metres.
pub fn planar_polygon_metrics(points: &[(f64, f64)]) -> Result<PlanarPolygonMetrics, PolygonError> {
    if points.len() > MAX_PLANAR_POLYGON_VERTICES {
        return Err(PolygonError::TooManyVertices);
    }
    let mut ring = points.to_vec();
    if ring.len() > 3 && ring.first() == ring.last() {
        ring.pop();
    }
    if ring.len() < 3 {
        return Err(PolygonError::TooFewVertices);
    }
    if ring.iter().any(|(e, n)| !e.is_finite() || !n.is_finite()) {
        return Err(PolygonError::NonFiniteCoordinate);
    }

    let count = ring.len();
    let mut edges = Vec::with_capacity(count);
    let mut perimeter_m = 0.0;
    for i in 0..count {
        let a = ring[i];
        let b = ring[(i + 1) % count];
        let de = b.0 - a.0;
        let dn = b.1 - a.1;
        let distance_m = de.hypot(dn);
        if !distance_m.is_finite() {
            return Err(PolygonError::NonFiniteResult);
        }
        if distance_m == 0.0 {
            return Err(PolygonError::ZeroLengthEdge);
        }
        perimeter_m += distance_m;
        let bearing_deg = de.atan2(dn).to_degrees().rem_euclid(360.0);
        edges.push(PlanarEdgeMetrics { bearing_deg, distance_m });
    }
    if !perimeter_m.is_finite() {
        return Err(PolygonError::NonFiniteResult);
    }

    for i in 0..count {
        let i_next = (i + 1) % count;
        for j in (i + 1)..count {
            let j_next = (j + 1) % count;
            if i == j || i_next == j || j_next == i {
                continue;
            }
            if segments_intersect(ring[i], ring[i_next], ring[j], ring[j_next]) {
                return Err(PolygonError::SelfIntersection);
            }
        }
    }

    let planar_area_sq_m = shoelace_area(&ring);
    if !planar_area_sq_m.is_finite() {
        return Err(PolygonError::NonFiniteResult);
    }
    if planar_area_sq_m == 0.0 {
        return Err(PolygonError::Degenerate);
    }

    Ok(PlanarPolygonMetrics { planar_area_sq_m, perimeter_m, edges })
}

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
    let origin = points[0];
    let mut sum = 0.0_f64;
    let mut compensation = 0.0_f64;
    for i in 0..n {
        let j = (i + 1) % n;
        let xi = points[i].0 - origin.0;
        let yi = points[i].1 - origin.1;
        let xj = points[j].0 - origin.0;
        let yj = points[j].1 - origin.1;
        let cross = xi * yj - xj * yi;
        let corrected = cross - compensation;
        let next = sum + corrected;
        compensation = (next - sum) - corrected;
        sum = next;
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

    #[test]
    fn test_planar_metrics_are_translation_invariant_for_large_grid_offsets() {
        let points = [
            (500_000.0, 9_500_000.0),
            (500_100.0, 9_500_000.0),
            (500_100.0, 9_500_100.0),
            (500_000.0, 9_500_100.0),
        ];
        let metrics = planar_polygon_metrics(&points).unwrap();
        assert!((metrics.planar_area_sq_m - 10_000.0).abs() < 1e-9);
        assert!((metrics.perimeter_m - 400.0).abs() < 1e-9);
        assert!((metrics.edges[0].bearing_deg - 90.0).abs() < 1e-12);
    }

    #[test]
    fn test_planar_metrics_accept_an_explicit_closing_vertex() {
        let metrics = planar_polygon_metrics(&[
            (0.0, 0.0),
            (10.0, 0.0),
            (10.0, 10.0),
            (0.0, 10.0),
            (0.0, 0.0),
        ])
        .unwrap();
        assert!((metrics.planar_area_sq_m - 100.0).abs() < 1e-12);
        assert_eq!(metrics.edges.len(), 4);
    }

    #[test]
    fn test_planar_metrics_reject_self_intersection_zero_edges_and_non_finite_values() {
        assert_eq!(
            planar_polygon_metrics(&[(0.0, 0.0), (10.0, 10.0), (0.0, 10.0), (10.0, 0.0)]),
            Err(PolygonError::SelfIntersection)
        );
        assert_eq!(
            planar_polygon_metrics(&[(0.0, 0.0), (10.0, 0.0), (10.0, 0.0), (0.0, 10.0)]),
            Err(PolygonError::ZeroLengthEdge)
        );
        assert_eq!(
            planar_polygon_metrics(&[
                (0.0, 0.0),
                (10.0, 0.0),
                (0.0, f64::INFINITY),
            ]),
            Err(PolygonError::NonFiniteCoordinate)
        );
    }

    #[test]
    fn test_planar_metrics_reject_polygon_over_vertex_limit() {
        let points = vec![(0.0, 0.0); MAX_PLANAR_POLYGON_VERTICES + 1];
        assert_eq!(planar_polygon_metrics(&points), Err(PolygonError::TooManyVertices));
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
