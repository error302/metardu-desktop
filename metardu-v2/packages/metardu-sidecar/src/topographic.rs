//! Planar Delaunay triangulation for topographic surface drafts.
//!
//! This module only connects the supplied horizontal coordinates. It does
//! not transform a CRS, adjust observations, or establish survey accuracy.

use crate::dispatcher::HandlerError;
use serde::Deserialize;
use serde_json::Value;
use spade::{DelaunayTriangulation, HasPosition, Point2, Triangulation};
use std::collections::HashSet;

/// Resource ceiling for one interactive desktop surface request.
pub const MAX_TOPOGRAPHIC_TIN_POINTS: usize = 100_000;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BuildTinRequest {
    points: Vec<TinPoint>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TinPoint {
    easting: f64,
    northing: f64,
    elevation: f64,
}

#[derive(Clone, Copy, Debug)]
struct IndexedPoint {
    position: Point2<f64>,
    input_index: usize,
}

impl HasPosition for IndexedPoint {
    type Scalar = f64;

    fn position(&self) -> Point2<Self::Scalar> {
        self.position
    }
}

/// Build a stable Delaunay triangle list whose indices reference input order.
fn triangulate(points: &[TinPoint]) -> Result<Vec<[usize; 3]>, String> {
    if points.len() < 3 {
        return Err(format!(
            "At least 3 points are required to build a TIN; received {}.",
            points.len()
        ));
    }
    if points.len() > MAX_TOPOGRAPHIC_TIN_POINTS {
        return Err(format!(
            "Topographic TIN supports at most {MAX_TOPOGRAPHIC_TIN_POINTS} points per request; received {}.",
            points.len()
        ));
    }

    let mut positions = HashSet::with_capacity(points.len());
    let mut min_x = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_y = f64::NEG_INFINITY;

    for (index, point) in points.iter().enumerate() {
        if !point.easting.is_finite() || !point.northing.is_finite() || !point.elevation.is_finite()
        {
            return Err(format!(
                "Point at input index {index} contains a non-finite coordinate or elevation."
            ));
        }

        // Normalize signed zero because -0.0 and +0.0 are the same position.
        let x = if point.easting == 0.0 {
            0.0
        } else {
            point.easting
        };
        let y = if point.northing == 0.0 {
            0.0
        } else {
            point.northing
        };
        if !positions.insert((x.to_bits(), y.to_bits())) {
            return Err(format!(
                "Duplicate horizontal position at input index {index}; resolve duplicate survey points before triangulation."
            ));
        }

        min_x = min_x.min(point.easting);
        max_x = max_x.max(point.easting);
        min_y = min_y.min(point.northing);
        max_y = max_y.max(point.northing);
    }

    if !(max_x - min_x).is_finite() || !(max_y - min_y).is_finite() {
        return Err("Coordinate range is too large for finite planar triangulation.".to_string());
    }

    let vertices = points
        .iter()
        .enumerate()
        .map(|(input_index, point)| IndexedPoint {
            position: Point2::new(point.easting, point.northing),
            input_index,
        })
        .collect();

    // The stable bulk loader keeps vertex data associated with input order
    // while using robust predicates for Delaunay topology decisions.
    let triangulation: DelaunayTriangulation<IndexedPoint> =
        DelaunayTriangulation::bulk_load_stable(vertices)
            .map_err(|error| format!("Delaunay triangulation rejected the input: {error:?}"))?;

    if triangulation.num_vertices() != points.len() {
        return Err("Triangulation did not preserve every input point.".to_string());
    }
    if triangulation.num_inner_faces() == 0 {
        return Err(
            "The supplied horizontal points are collinear; no TIN can be built.".to_string(),
        );
    }

    let mut triangles = Vec::with_capacity(triangulation.num_inner_faces());
    for face in triangulation.inner_faces() {
        let vertices = face.vertices();
        let mut triangle = vertices.map(|vertex| vertex.data().input_index);

        // Rotate without reversing orientation, then sort faces so output is
        // independent of the triangulation iterator's internal face order.
        let smallest = triangle
            .iter()
            .enumerate()
            .min_by_key(|(_, index)| *index)
            .map(|(position, _)| position)
            .expect("triangles always have three vertices");
        triangle.rotate_left(smallest);
        triangles.push(triangle);
    }
    triangles.sort_unstable();

    Ok(triangles)
}

/// Sidecar JSON-RPC handler for `topographic.build_tin`.
pub async fn handle_build_tin(params: Value) -> Result<Value, HandlerError> {
    let request: BuildTinRequest = serde_json::from_value(params)
        .map_err(|error| HandlerError::InvalidParams(error.to_string()))?;
    let triangles = triangulate(&request.points).map_err(HandlerError::InvalidParams)?;
    Ok(serde_json::json!({ "triangles": triangles }))
}

#[cfg(test)]
mod tests {
    use super::{triangulate, TinPoint, MAX_TOPOGRAPHIC_TIN_POINTS};

    fn point(easting: f64, northing: f64, elevation: f64) -> TinPoint {
        TinPoint {
            easting,
            northing,
            elevation,
        }
    }

    fn grid(width: usize, height: usize) -> Vec<TinPoint> {
        (0..width)
            .flat_map(|x| (0..height).map(move |y| point(x as f64, y as f64, (x + y) as f64)))
            .collect()
    }

    #[test]
    fn builds_one_triangle_from_three_points() {
        let triangles = triangulate(&[
            point(0.0, 0.0, 10.0),
            point(10.0, 0.0, 11.0),
            point(5.0, 10.0, 12.0),
        ])
        .unwrap();
        assert_eq!(triangles, vec![[0, 1, 2]]);
    }

    #[test]
    fn regular_square_grid_has_known_face_count() {
        let triangles = triangulate(&grid(5, 5)).unwrap();
        assert_eq!(triangles.len(), 32);
        assert!(triangles.iter().flatten().all(|index| *index < 25));
    }

    #[test]
    fn cocircular_grid_output_is_repeatable() {
        let points = grid(8, 8);
        assert_eq!(triangulate(&points).unwrap(), triangulate(&points).unwrap());
    }

    #[test]
    fn near_collinear_finite_points_keep_their_triangle() {
        let triangles = triangulate(&[
            point(0.0, 0.0, 1.0),
            point(1_000_000.0, 0.0, 2.0),
            point(2_000_000.0, 0.000_001, 3.0),
        ])
        .unwrap();
        assert_eq!(triangles.len(), 1);
    }

    #[test]
    fn distinct_positions_below_one_tenth_of_a_millimetre_are_not_rounded_away() {
        let triangles = triangulate(&[
            point(0.0, 0.0, 1.0),
            point(1.0, 0.0, 2.0),
            point(0.0, 0.000_01, 3.0),
        ])
        .unwrap();
        assert_eq!(triangles.len(), 1);
    }

    #[test]
    fn rejects_non_finite_coordinates_and_elevations() {
        assert!(triangulate(&[
            point(0.0, 0.0, 1.0),
            point(1.0, 0.0, 2.0),
            point(f64::NAN, 1.0, 3.0),
        ])
        .unwrap_err()
        .contains("non-finite"));
        assert!(triangulate(&[
            point(0.0, 0.0, 1.0),
            point(1.0, 0.0, 2.0),
            point(0.0, 1.0, f64::INFINITY),
        ])
        .unwrap_err()
        .contains("non-finite"));
    }

    #[test]
    fn rejects_duplicate_horizontal_positions_without_deduplication() {
        let error = triangulate(&[
            point(0.0, 0.0, 1.0),
            point(1.0, 0.0, 2.0),
            point(0.0, 1.0, 3.0),
            point(-0.0, 0.0, 99.0),
        ])
        .unwrap_err();
        assert!(error.contains("Duplicate horizontal position"));
    }

    #[test]
    fn rejects_collinear_points() {
        let error = triangulate(&[
            point(0.0, 0.0, 1.0),
            point(1.0, 1.0, 2.0),
            point(2.0, 2.0, 3.0),
        ])
        .unwrap_err();
        assert!(error.contains("collinear"));
    }

    #[test]
    fn triangulates_ten_thousand_point_grid_and_preserves_input_indices() {
        let points = grid(100, 100);
        let triangles = triangulate(&points).unwrap();
        assert_eq!(triangles.len(), 19_602);
        assert!(triangles
            .iter()
            .flatten()
            .all(|index| *index < points.len()));
    }

    #[test]
    fn rejects_point_count_over_documented_resource_limit() {
        let points = grid(MAX_TOPOGRAPHIC_TIN_POINTS / 2 + 1, 2);
        let error = triangulate(&points).unwrap_err();
        assert!(error.contains("supports at most 100000 points"));
    }
}
