//! Types for the least-squares adjustment engine.

use serde::{Deserialize, Serialize};

/// Observation type — determines the linearization form.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
pub enum ObservationKind {
    /// Horizontal distance between two points (1D observation, 2 unknowns).
    #[default]
    Distance,
    /// Horizontal direction (angle measured from a reference azimuth).
    /// Each station has an unknown orientation (the zero-direction of the
    /// instrument setup) which is solved alongside the coordinates.
    Direction,
    /// Geodetic azimuth from one point to another (1D observation).
    Azimuth,
    /// Elevation difference between two points (1D observation).
    HeightDifference,
    /// 3D GNSS baseline vector between two points.
    /// Observed: [dE, dN, dH] in metres.  The three components are
    /// correlated through satellite geometry and atmosphere, so the
    /// observation carries a full 3×3 covariance block.
    GnssBaseline,
}

/// A single observation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Observation {
    pub kind: ObservationKind,
    /// Indices of the points involved, into the parameter vector.
    /// For Distance/Azimuth/Direction/HeightDifference: [from, to].
    /// For GnssBaseline: [from, to].
    pub point_indices: Vec<usize>,
    /// The observed value(s).
    ///   Distance:            [d_metres]
    ///   Direction:           [direction_radians]
    ///   Azimuth:             [azimuth_radians]
    ///   HeightDifference:    [dh_metres]
    ///   GnssBaseline:        [dE, dN, dH] metres
    pub observed: Vec<f64>,
    /// A priori standard deviation(s) in the same unit as observed.
    /// For GnssBaseline: [sigma_dE, sigma_dN, sigma_dH].
    pub sigma: Vec<f64>,
    /// For `Direction` observations only: index into the adjustment's
    /// `orientation_parameters` list identifying this station's unknown
    /// orientation (the reference azimuth of the instrument setup).
    /// Ignored for all other observation kinds. `None` is rejected for
    /// `Direction` observations.
    #[serde(default)]
    pub orientation_param: Option<usize>,
    /// Full variance-covariance matrix for this observation, stored as a
    /// flattened row-major vector of size `observed.len()²`.
    ///
    /// For single-component observations this is typically left empty;
    /// the solver derives a diagonal covariance from `sigma`.
    ///
    /// For multi-component observations like `GnssBaseline` (3×3), this
    /// encodes the correlation between the baseline components.  When
    /// non-empty, the `sigma` field is ignored for this observation.
    #[serde(default)]
    pub covariance: Vec<f64>,
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
    /// Adjusted station orientation values (radians), one per entry in the
    /// input `orientation_parameters` (free orientations only; fixed ones
    /// echo their input). Empty when no orientations were supplied.
    #[serde(default)]
    pub adjusted_orientations: Vec<f64>,
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
