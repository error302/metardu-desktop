//! Types for the least-squares adjustment engine.

use serde::{Deserialize, Serialize};

/// Observation type — determines the linearization form.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum ObservationKind {
    /// Horizontal distance between two points (1D observation, 2 unknowns).
    Distance,
    /// Horizontal direction (angle measured from a reference azimuth).
    /// (Phase 4B — not yet implemented in the linearizer.)
    Direction,
    /// Azimuth from one point to another.
    /// (Phase 4B — not yet implemented.)
    Azimuth,
    /// Elevation difference between two points (1D observation, 1 unknown per point: height).
    /// (Phase 4B — not yet implemented.)
    HeightDifference,
    /// 3D GNSS baseline vector (3 observations per baseline).
    /// (Phase 4C — not yet implemented.)
    GnssBaseline,
}

/// A single observation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Observation {
    pub kind: ObservationKind,
    /// Indices of the points involved, into the parameter vector.
    /// For Distance: [from, to].
    /// For Direction: [from, to] (with the station as a separate config).
    /// For GnssBaseline: [from, to].
    pub point_indices: Vec<usize>,
    /// The observed value(s). For Distance: [d_metres]. For GnssBaseline: [dx, dy, dz].
    pub observed: Vec<f64>,
    /// A priori standard deviation(s) in metres (or metres/metre for baseline components).
    pub sigma: Vec<f64>,
}

/// An a priori estimate of an unknown parameter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParameterPrior {
    /// Initial estimate of the parameter value(s).
    /// For a 2D point: [easting, northing].
    /// For a height: [height].
    pub initial: Vec<f64>,
    /// If Some, this parameter is held fixed (not adjusted). The value
    /// in `initial` is treated as exact.
    pub fixed: bool,
}

/// Result of a least-squares adjustment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdjustmentResult {
    /// Adjusted parameter values (same shape as the input priors).
    pub adjusted: Vec<Vec<f64>>,
    /// Full variance-covariance matrix of the adjusted parameters.
    /// Stored as a flattened row-major matrix of size n×n where n is
    /// the total number of unknown (non-fixed) parameter components.
    pub covariance: Vec<f64>,
    /// Per-observation residuals (observed - adjusted).
    pub residuals: Vec<f64>,
    /// Per-observation redundancy numbers (0 = no contribution, 1 = fully
    /// determined by this observation). Sum across all observations
    /// equals the degrees of freedom.
    pub redundancy: Vec<f64>,
    /// Per-observation Baarda w-statistic. |w| > 3.29 (α=0.001) suggests
    /// a blunder.
    pub baarda_w: Vec<f64>,
    /// A posteriori variance factor (sigma_0²). Should be ≈ 1.0 if the
    /// a priori stochastic model is correct.
    pub sigma_0_sq: f64,
    /// Degrees of freedom (n_observations - n_unknowns).
    pub degrees_of_freedom: usize,
    /// Global chi-square test p-value. p < 0.05 fails the test (the
    /// adjustment doesn't fit the stochastic model).
    pub chi_square_p_value: f64,
    /// True if the global chi-square test passes at α = 0.05.
    pub passes_global_test: bool,
    /// True if any observation has |w| > 3.29 (potential blunder).
    pub has_flagged_blunder: bool,
}

/// Error returned by the adjustment engine.
#[derive(Debug, thiserror::Error)]
pub enum AdjustmentError {
    #[error("No observations provided")]
    NoObservations,
    #[error("No unknown (non-fixed) parameters — nothing to adjust")]
    NoUnknowns,
    #[error("Under-determined system: {observations} observations, {unknowns} unknowns, dof = {dof}")]
    Underdetermined { observations: usize, unknowns: usize, dof: isize },
    #[error("Singular normal matrix — check for free parameters with no constraints")]
    SingularMatrix,
    #[error("Observation {index} references point {point_idx}, but only {n_points} points exist")]
    BadPointIndex { index: usize, point_idx: usize, n_points: usize },
    #[error("Observation {index} has wrong dimensionality for its kind (expected {expected}, got {got})")]
    BadObservationDimension { index: usize, expected: usize, got: usize },
    #[error("Internal: {0}")]
    Internal(String),
}
