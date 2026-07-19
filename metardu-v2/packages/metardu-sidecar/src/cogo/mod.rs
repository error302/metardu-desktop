//! Coordinate Geometry (COGO) — traverse, intersections, offsets, areas.
//!
//! This module is the sidecar's COGO engine. All surveyors' geometric
//! computations live here. Master plan Section 5.2.
//!
//! # Contents
//!   - `traverse.rs` — open and closed traverse computation
//!   - `intersection.rs` — bearing-bearing, bearing-distance, distance-distance
//!   - `area.rs` — planar Shoelace + ellipsoidal area with scale factor
//!
//! # References
//!   - Davis, Raymond E. et al., "Surveying: Theory and Practice," 7th ed.
//!   - Allan, A. L., "Mathematics of Surveying," §3-5
//!   - Schofield & Breach, "Engineering Surveying" Ch. 6
//!   - Kenya Survey Regulations 1994 — closure tolerances

pub mod area;
pub mod intersection;
pub mod traverse;

pub use area::{shoelace_area, ellipsoidal_area, AreaUnit};
pub use intersection::{bearing_bearing, bearing_distance, distance_distance, IntersectionError};
pub use traverse::{bowditch_adjust, transit_adjust, closed_traverse_misclosure, TraverseError, TraverseLeg};
