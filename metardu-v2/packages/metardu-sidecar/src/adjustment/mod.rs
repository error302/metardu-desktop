//! Least-squares network adjustment.
//!
//! Implements a parametric (indirect observation) least-squares adjustment
//! with full variance-covariance propagation. This is the sidecar's
//! deepest moat (master plan Section 5.1) — every adjusted coordinate
//! carries its own error ellipse, every observation carries its
//! redundancy number, and Baarda's data-snooping flags blunders BEFORE
//! they get baked into statutory coordinates.
//!
//! # What this is
//!
//! A 1D/2D/3D adjustment engine that takes:
//!   - A set of unknown parameters (e.g. point coordinates)
//!   - A set of observations (distances, directions, azimuths, height
//!     differences, GNSS baseline vectors)
//!   - An a priori stochastic model (sigma per observation, per
//!     instrument class)
//!
//! And produces:
//!   - Adjusted parameter values
//!   - Full variance-covariance matrix of the parameters
//!   - Residuals per observation
//!   - Redundancy numbers per observation (for blunder detection)
//!   - Global chi-square test result
//!   - Per-observation Baarda w-statistic
//!
//! # References
//!   - Mikhail, E. M. & Ackermann, F. (1976), "Observations and Least
//!     Squares," University Press of America — the canonical reference.
//!   - Baarda, W. (1968), "A Testing Procedure for Use in Geodetic
//!     Networks," Netherlands Geodetic Commission, Vol 2 No 5.
//!   - Leick, A. (2004), "GPS Satellite Surveying," 3rd ed., Ch. 4
//!     (for GNSS baseline vector handling).
//!   - Kuang, S. (1996), "Geodetic Network Analysis and Optimal Design,"
//!     Ch. 4 (for reliability theory).
//!
//! # Algorithm
//!
//! Parametric least-squares:
//!   1. Linearize each observation around the current parameter estimate:
//!        L_obs ≈ L_approx(X_0) + A * ΔX    where A is the design matrix.
//!   2. Form the normal equations:
//!        N = Aᵀ * Σ⁻¹ * A          (normal matrix)
//!        u = Aᵀ * Σ⁻¹ * Δl         (constant vector)
//!      where Σ is the observation covariance matrix and Δl is the
//!      misclosure vector (L_obs - L_approx(X_0)).
//!   3. Solve: ΔX = N⁻¹ * u
//!   4. Update: X = X_0 + ΔX
//!   5. Iterate to convergence (for non-linear problems; one iteration
//!      for linear problems).
//!   6. Compute residuals, redundancy numbers, chi-square test, Baarda.
//!
//! # Implemented observation kinds
//!
//! - **Distance** — horizontal slope distance (1 component)
//! - **Direction** — measured direction at a station with an unknown
//!   orientation parameter (1 component)
//! - **Azimuth** — geodetic azimuth between two points (1 component)
//! - **HeightDifference** — leveling observation (1 component)
//! - **GnssBaseline** — 3D GNSS baseline vector with full3×3
//!   covariance block for correlated ΔE/ΔN/ΔH components
//!
//! All kinds support mixed networks (e.g. distances + GNSS baselines
//! in the same adjustment).  The stochastic model is block-diagonal:
//! independent between observations, but fully correlated within each
//! multi-component observation (GNSS baselines).

pub mod linear;
pub mod types;

pub use linear::adjust_least_squares;
pub use linear::AdjustmentConfig;
pub use types::*;
