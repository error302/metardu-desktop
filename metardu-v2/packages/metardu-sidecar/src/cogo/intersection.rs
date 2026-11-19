//! Intersection computations — bearing-bearing, bearing-distance, distance-distance.
//!
//! References:
//!   - Davis et al., "Surveying: Theory and Practice," §5.20-5.27
//!   - Allan, A. L., "Mathematics of Surveying," §4
//!   - Schofield & Breach, "Engineering Surveying" Ch. 6

use serde::{Deserialize, Serialize};

/// Error returned by intersection computations.
#[derive(Debug, thiserror::Error)]
pub enum IntersectionError {
    #[error("Bearings are parallel (no intersection)")]
    ParallelBearings,
    #[error("Geometry has no real solution (circles don't intersect)")]
    NoRealSolution,
    #[error("Geometry is ambiguous (two valid solutions; call the *_two_solutions variant)")]
    Ambiguous,
    #[error("Inputs out of range: {0}")]
    OutOfRange(String),
}

/// A 2D point in projected coordinates (easting, northing) in metres.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Point2D {
    pub easting: f64,
    pub northing: f64,
}

impl Point2D {
    pub fn new(e: f64, n: f64) -> Self {
        Self { easting: e, northing: n }
    }

    /// Distance to another point (Pythagoras).
    pub fn distance_to(&self, other: &Point2D) -> f64 {
        let de = other.easting - self.easting;
        let dn = other.northing - self.northing;
        de.hypot(dn)
    }

    /// Bearing from self to other, in decimal degrees clockwise from North.
    pub fn bearing_to(&self, other: &Point2D) -> f64 {
        let de = other.easting - self.easting;
        let dn = other.northing - self.northing;
        // atan2(east, north) gives bearing clockwise from North, in radians.
        // (f64::atan2 takes (y, x) order, so we pass (de, dn) to get
        // clockwise-from-north.)
        let brg = de.atan2(dn);
        // Convert to degrees in [0, 360).
        let mut deg = brg.to_degrees();
        if deg < 0.0 {
            deg += 360.0;
        }
        deg
    }
}

fn validate_point(point: Point2D) -> Result<(), IntersectionError> {
    if !point.easting.is_finite() || !point.northing.is_finite() {
        return Err(IntersectionError::OutOfRange(
            "coordinates must be finite numbers".to_string(),
        ));
    }
    Ok(())
}

fn validate_bearing(bearing_deg: f64) -> Result<f64, IntersectionError> {
    if !bearing_deg.is_finite() || !(0.0..=360.0).contains(&bearing_deg) {
        return Err(IntersectionError::OutOfRange(
            "bearing must be between 0 and 360 degrees clockwise from north".to_string(),
        ));
    }
    Ok(if bearing_deg == 360.0 { 0.0 } else { bearing_deg })
}

fn validate_distance(distance_m: f64, label: &str) -> Result<(), IntersectionError> {
    if !distance_m.is_finite() || distance_m < 0.0 {
        return Err(IntersectionError::OutOfRange(format!(
            "{label} must be a finite non-negative distance in metres"
        )));
    }
    Ok(())
}

/// Forward radiation from a point using a grid/local-plane bearing clockwise
/// from north and a horizontal distance in metres.
pub fn radiation(
    origin: Point2D,
    bearing_deg: f64,
    distance_m: f64,
) -> Result<Point2D, IntersectionError> {
    validate_point(origin)?;
    let bearing = validate_bearing(bearing_deg)?.to_radians();
    validate_distance(distance_m, "radiation distance")?;

    let point = Point2D::new(
        origin.easting + distance_m * bearing.sin(),
        origin.northing + distance_m * bearing.cos(),
    );
    validate_point(point)?;
    Ok(point)
}

/// Offset the midpoint of a straight local-plane segment by a perpendicular
/// distance. `left` is relative to travel from `start` to `end`.
pub fn midpoint_offset(
    start: Point2D,
    end: Point2D,
    offset_m: f64,
    left: bool,
) -> Result<Point2D, IntersectionError> {
    validate_point(start)?;
    validate_point(end)?;
    validate_distance(offset_m, "offset")?;

    let de = end.easting - start.easting;
    let dn = end.northing - start.northing;
    let length = de.hypot(dn);
    if !length.is_finite() || length == 0.0 {
        return Err(IntersectionError::OutOfRange(
            "offset line must have non-zero finite length".to_string(),
        ));
    }

    let side = if left { 1.0 } else { -1.0 };
    let point = Point2D::new(
        (start.easting + end.easting) / 2.0 - side * dn / length * offset_m,
        (start.northing + end.northing) / 2.0 + side * de / length * offset_m,
    );
    validate_point(point)?;
    Ok(point)
}

/// Bearing-bearing intersection.
///
/// Given two points P1, P2 and a bearing from each, find the
/// intersection point.
///
/// Algorithm: solve the two line equations
///   line1: P1 + t1 * (sin brg1, cos brg1)
///   line2: P2 + t2 * (sin brg2, cos brg2)
/// for t1, t2 such that line1 = line2.
///
/// Returns the intersection point, or an error if the bearings are
/// parallel (no intersection) or coincident (infinite intersections).
pub fn bearing_bearing(
    p1: Point2D,
    bearing1_deg: f64,
    p2: Point2D,
    bearing2_deg: f64,
) -> Result<Point2D, IntersectionError> {
    validate_point(p1)?;
    validate_point(p2)?;
    let b1 = validate_bearing(bearing1_deg)?.to_radians();
    let b2 = validate_bearing(bearing2_deg)?.to_radians();

    // Direction vectors (sin brg, cos brg) — note the surveyor convention
    // where bearing is clockwise from North (not the math convention of
    // counter-clockwise from East).
    let d1 = (b1.sin(), b1.cos());
    let d2 = (b2.sin(), b2.cos());

    // Determinant of the 2x2 direction matrix.
    let det = d1.0 * d2.1 - d1.1 * d2.0;
    if det.abs() < 1e-12 {
        return Err(IntersectionError::ParallelBearings);
    }

    // Solve for t1: P1 + t1*d1 = P2 + t2*d2
    //   t1 * d1 - t2 * d2 = P2 - P1
    //   [d1.x  -d2.x] [t1]   [P2.x - P1.x]
    //   [d1.y  -d2.y] [t2] = [P2.y - P1.y]
    let dp = (p2.easting - p1.easting, p2.northing - p1.northing);
    let t1 = (dp.0 * d2.1 - dp.1 * d2.0) / det;
    let t2 = (dp.0 * d1.1 - dp.1 * d1.0) / det;
    if !t1.is_finite() || !t2.is_finite() || t1 < 0.0 || t2 < 0.0 {
        return Err(IntersectionError::OutOfRange(
            "bearing rays do not meet ahead of both occupied points".to_string(),
        ));
    }

    let point = Point2D::new(p1.easting + t1 * d1.0, p1.northing + t1 * d1.1);
    validate_point(point)?;
    Ok(point)
}

/// Bearing-distance intersection.
///
/// From point P1, project a line at bearing1. From point P2, swing an
/// arc of radius `distance_from_p2`. Returns the intersection(s).
///
/// There may be 0, 1, or 2 solutions. By convention we return the
/// solution closer to P1 (the "near" solution). Use
/// `bearing_distance_two_solutions` if you need both.
pub fn bearing_distance(
    p1: Point2D,
    bearing1_deg: f64,
    p2: Point2D,
    distance_from_p2_m: f64,
) -> Result<Point2D, IntersectionError> {
    let solutions = bearing_distance_two_solutions(p1, bearing1_deg, p2, distance_from_p2_m)?;
    // Pick the "forward" solution along the bearing ray from p1.
    // The forward distance is the projection of (solution - p1) onto
    // the bearing direction; we pick the larger one if both are
    // positive, otherwise the positive one. This convention matches
    // Davis et al. §5.24 — the surveyor is shooting FROM p1, so we
    // want the farther intersection (the one they're actually aiming at).
    let b1 = bearing1_deg.to_radians();
    let dir = (b1.sin(), b1.cos());
    let t1 = (solutions.0.easting - p1.easting) * dir.0 + (solutions.0.northing - p1.northing) * dir.1;
    let t2 = (solutions.1.easting - p1.easting) * dir.0 + (solutions.1.northing - p1.northing) * dir.1;

    // Prefer solutions with positive forward distance (in front of p1
    // along the bearing). Among those, pick the farther one.
    if t1 >= 0.0 && t2 >= 0.0 {
        if t1 >= t2 { Ok(solutions.0) } else { Ok(solutions.1) }
    } else if t1 >= 0.0 {
        Ok(solutions.0)
    } else if t2 >= 0.0 {
        Ok(solutions.1)
    } else {
        // Both behind p1 — pick the less-negative one.
        if t1 >= t2 { Ok(solutions.0) } else { Ok(solutions.1) }
    }
}

/// Bearing-distance — returns both intersection points.
pub fn bearing_distance_two_solutions(
    p1: Point2D,
    bearing1_deg: f64,
    p2: Point2D,
    distance_from_p2_m: f64,
) -> Result<(Point2D, Point2D), IntersectionError> {
    validate_point(p1)?;
    validate_point(p2)?;
    let b1 = validate_bearing(bearing1_deg)?.to_radians();
    validate_distance(distance_from_p2_m, "intersection radius")?;
    let dir = (b1.sin(), b1.cos()); // unit direction along bearing from p1

    // Vector from p1 to p2.
    let w = (p2.easting - p1.easting, p2.northing - p1.northing);

    // Project w onto the bearing direction. This is the parameter t at
    // which the perpendicular from p2 hits the line.
    let t_proj = w.0 * dir.0 + w.1 * dir.1;

    // Perpendicular distance from p2 to the line.
    let perp_sq = w.0 * w.0 + w.1 * w.1 - t_proj * t_proj;
    let r_sq = distance_from_p2_m * distance_from_p2_m;
    if perp_sq > r_sq {
        return Err(IntersectionError::NoRealSolution);
    }

    let delta_sq = r_sq - perp_sq;
    if !perp_sq.is_finite() || !r_sq.is_finite() || !delta_sq.is_finite() || delta_sq < 0.0 {
        return Err(IntersectionError::NoRealSolution);
    }
    let delta = delta_sq.sqrt();

    let sol1 = Point2D::new(p1.easting + (t_proj - delta) * dir.0, p1.northing + (t_proj - delta) * dir.1);
    let sol2 = Point2D::new(p1.easting + (t_proj + delta) * dir.0, p1.northing + (t_proj + delta) * dir.1);
    validate_point(sol1)?;
    validate_point(sol2)?;

    Ok((sol1, sol2))
}

/// Distance-distance intersection.
///
/// From P1, swing an arc of radius r1. From P2, swing an arc of
/// radius r2. Returns the intersection(s). By convention returns the
/// "left" solution (to the left of the line P1→P2).
pub fn distance_distance(
    p1: Point2D,
    r1_m: f64,
    p2: Point2D,
    r2_m: f64,
) -> Result<Point2D, IntersectionError> {
    let solutions = distance_distance_two_solutions(p1, r1_m, p2, r2_m)?;
    // Pick the "left" solution by default — convention from surveying
    // textbooks.
    let dx = p2.easting - p1.easting;
    let dy = p2.northing - p1.northing;
    let cross1 = dx * (solutions.0.northing - p1.northing) - dy * (solutions.0.easting - p1.easting);
    if cross1 > 0.0 {
        Ok(solutions.0)
    } else {
        Ok(solutions.1)
    }
}

/// Distance-distance — returns both intersection points.
pub fn distance_distance_two_solutions(
    p1: Point2D,
    r1_m: f64,
    p2: Point2D,
    r2_m: f64,
) -> Result<(Point2D, Point2D), IntersectionError> {
    validate_point(p1)?;
    validate_point(p2)?;
    validate_distance(r1_m, "first intersection radius")?;
    validate_distance(r2_m, "second intersection radius")?;
    let d = p1.distance_to(&p2);
    if !d.is_finite() {
        return Err(IntersectionError::OutOfRange(
            "distance between centers is not finite".to_string(),
        ));
    }

    if d > r1_m + r2_m + 1e-9 {
        return Err(IntersectionError::NoRealSolution); // circles too far apart
    }
    if d < (r1_m - r2_m).abs() - 1e-9 {
        return Err(IntersectionError::NoRealSolution); // one circle inside the other
    }
    if d < 1e-12 {
        return Err(IntersectionError::Ambiguous); // centers coincide
    }

    // Distance from p1 to the foot of the perpendicular (the line
    // connecting the two intersection points).
    let a = (r1_m * r1_m - r2_m * r2_m + d * d) / (2.0 * d);
    // Height of the intersection triangle (perpendicular distance from
    // the p1-p2 line to the intersection points).
    let h_sq = r1_m * r1_m - a * a;
    if !a.is_finite() || !h_sq.is_finite() || h_sq < 0.0 {
        return Err(IntersectionError::NoRealSolution);
    }
    let h = h_sq.sqrt();

    // Unit vector p1 → p2.
    let ux = (p2.easting - p1.easting) / d;
    let uy = (p2.northing - p1.northing) / d;

    // Foot of the perpendicular.
    let fx = p1.easting + a * ux;
    let fy = p1.northing + a * uy;

    // The two intersection points are at (fx ± h*uy, fy ∓ h*ux) —
    // perpendicular to the p1-p2 line.
    let sol1 = Point2D::new(fx + h * uy, fy - h * ux);
    let sol2 = Point2D::new(fx - h * uy, fy + h * ux);
    validate_point(sol1)?;
    validate_point(sol2)?;

    Ok((sol1, sol2))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Bearing-bearing: two lines at right angles from origin should
    /// intersect at (100, 0).
    #[test]
    fn test_bearing_bearing_perpendicular() {
        let p1 = Point2D::new(0.0, 0.0);
        let p2 = Point2D::new(100.0, -100.0);
        // From p1, bearing 90° (East).
        // From p2, bearing 0° (North).
        let intersection = bearing_bearing(p1, 90.0, p2, 0.0).unwrap();
        assert!((intersection.easting - 100.0).abs() < 1e-9, "e = {}", intersection.easting);
        assert!((intersection.northing - 0.0).abs() < 1e-9, "n = {}", intersection.northing);
    }

    /// Parallel bearings must error.
    #[test]
    fn test_bearing_bearing_parallel() {
        let p1 = Point2D::new(0.0, 0.0);
        let p2 = Point2D::new(0.0, 100.0);
        let result = bearing_bearing(p1, 0.0, p2, 0.0);
        assert!(matches!(result, Err(IntersectionError::ParallelBearings)));
    }

    #[test]
    fn test_bearing_bearing_rejects_intersection_behind_a_station() {
        let result = bearing_bearing(
            Point2D::new(0.0, 0.0),
            0.0,
            Point2D::new(10.0, 10.0),
            90.0,
        );
        assert!(matches!(result, Err(IntersectionError::OutOfRange(_))));
    }

    #[test]
    fn test_radiation_known_cardinal_and_diagonal_answers() {
        let north = radiation(Point2D::new(100.0, 200.0), 0.0, 25.0).unwrap();
        assert!((north.easting - 100.0).abs() < 1e-12);
        assert!((north.northing - 225.0).abs() < 1e-12);

        let east = radiation(Point2D::new(100.0, 200.0), 90.0, 25.0).unwrap();
        assert!((east.easting - 125.0).abs() < 1e-12);
        assert!((east.northing - 200.0).abs() < 1e-12);
    }

    #[test]
    fn test_radiation_rejects_invalid_bearing_and_negative_distance() {
        assert!(matches!(
            radiation(Point2D::new(0.0, 0.0), -1.0, 10.0),
            Err(IntersectionError::OutOfRange(_))
        ));
        assert!(matches!(
            radiation(Point2D::new(0.0, 0.0), 0.0, -1.0),
            Err(IntersectionError::OutOfRange(_))
        ));
    }

    #[test]
    fn test_intersections_reject_non_finite_derived_geometry() {
        let distance_result = distance_distance(
            Point2D::new(0.0, 0.0),
            1.0e308,
            Point2D::new(1.0, 0.0),
            1.0e308,
        );
        assert!(distance_result.is_err());

        let bearing_distance_result = bearing_distance(
            Point2D::new(0.0, 0.0),
            90.0,
            Point2D::new(1.0e200, 1.0e200),
            1.0e200,
        );
        assert!(bearing_distance_result.is_err());
    }

    #[test]
    fn test_midpoint_offset_uses_left_and_right_of_direction() {
        let start = Point2D::new(0.0, 0.0);
        let end = Point2D::new(0.0, 100.0);
        let left = midpoint_offset(start, end, 10.0, true).unwrap();
        let right = midpoint_offset(start, end, 10.0, false).unwrap();
        assert!((left.easting + 10.0).abs() < 1e-12);
        assert!((left.northing - 50.0).abs() < 1e-12);
        assert!((right.easting - 10.0).abs() < 1e-12);
        assert!((right.northing - 50.0).abs() < 1e-12);
    }

    #[test]
    fn test_midpoint_offset_rejects_zero_length_lines() {
        let point = Point2D::new(1.0, 2.0);
        assert!(matches!(
            midpoint_offset(point, point, 1.0, true),
            Err(IntersectionError::OutOfRange(_))
        ));
    }

    /// Bearing-distance: from origin at 90° (East), distance 100 from
    /// (50, 0) — should hit (100, 0).
    #[test]
    fn test_bearing_distance_simple() {
        let p1 = Point2D::new(0.0, 0.0);
        let p2 = Point2D::new(50.0, 0.0);
        let result = bearing_distance(p1, 90.0, p2, 50.0).unwrap();
        assert!((result.easting - 100.0).abs() < 1e-9, "e = {}", result.easting);
        assert!((result.northing - 0.0).abs() < 1e-9, "n = {}", result.northing);
    }

    /// Distance-distance: two circles of radius 100 centred at (0,0)
    /// and (100, 0) intersect at (50, ±86.6025).
    #[test]
    fn test_distance_distance_unit() {
        let p1 = Point2D::new(0.0, 0.0);
        let p2 = Point2D::new(100.0, 0.0);
        let (s1, s2) = distance_distance_two_solutions(p1, 100.0, p2, 100.0).unwrap();
        // Both solutions should have easting = 50.
        assert!((s1.easting - 50.0).abs() < 1e-9, "s1.e = {}", s1.easting);
        assert!((s2.easting - 50.0).abs() < 1e-9, "s2.e = {}", s2.easting);
        // Northing ±sqrt(100² - 50²) = ±86.6025...
        let h = (100.0_f64 * 100.0 - 50.0 * 50.0).sqrt();
        assert!((s1.northing.abs() - h).abs() < 1e-9, "s1.n = {}", s1.northing);
        assert!((s2.northing.abs() - h).abs() < 1e-9, "s2.n = {}", s2.northing);
        // s1 and s2 must be mirrored across the x-axis.
        assert!((s1.northing + s2.northing).abs() < 1e-9);
    }

    /// Circles too far apart must error.
    #[test]
    fn test_distance_distance_no_intersection() {
        let p1 = Point2D::new(0.0, 0.0);
        let p2 = Point2D::new(1000.0, 0.0); // 1000 m apart
        let result = distance_distance(p1, 100.0, p2, 100.0);
        assert!(matches!(result, Err(IntersectionError::NoRealSolution)));
    }

    /// Point2D helpers — distance and bearing.
    #[test]
    fn test_point2d_distance_and_bearing() {
        let p1 = Point2D::new(0.0, 0.0);
        let p2 = Point2D::new(100.0, 0.0);
        assert!((p1.distance_to(&p2) - 100.0).abs() < 1e-9);
        assert!((p1.bearing_to(&p2) - 90.0).abs() < 1e-9);

        let p3 = Point2D::new(0.0, 100.0);
        assert!((p1.bearing_to(&p3) - 0.0).abs() < 1e-9);

        let p4 = Point2D::new(-100.0, 0.0);
        assert!((p1.bearing_to(&p4) - 270.0).abs() < 1e-9);
    }
}
