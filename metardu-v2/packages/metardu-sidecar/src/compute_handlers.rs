//! IPC handler wrappers for the geodesy, COGO, and adjustment modules.
//!
//! Each handler:
//!   1. Deserializes the JSON params into a typed struct (Serde validates
//!      shape — invalid params return HandlerError::InvalidParams).
//!   2. Calls the underlying geodesy/COGO/adjustment function.
//!   3. Serializes the result back to JSON.
//!
//! The TypeScript engine's ipc-schemas package provides client-side zod
//! validation BEFORE the call reaches the sidecar; Serde is the
//! defense-in-depth layer.

use crate::adjustment::{adjust_least_squares, AdjustmentConfig, Observation, ParameterPrior};
use crate::cogo::area::{ellipsoidal_area, shoelace_area, AreaUnit};
use crate::cogo::intersection::{bearing_bearing, bearing_distance, distance_distance, Point2D};
use crate::cogo::traverse::{bowditch_adjust, closed_traverse_misclosure, transit_adjust, TraverseLeg};
use crate::dispatcher::HandlerError;
use crate::geodesy::ecef::{ecef_to_geodetic, geodetic_to_ecef, ECEF, Ellipsoid};
use crate::geodesy::helmert::{helmert_transform, HelmertParams, TransformConvention};
use crate::geodesy::projection::{
    transverse_mercator_forward, transverse_mercator_inverse, utm_forward, utm_inverse, TMParams,
};
use crate::geodesy::datums;
use serde::{Deserialize, Serialize};

// ─── Geodesy: ECEF ↔ geodetic ────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct GeodeticToEcefParams {
    pub lat: f64,
    pub lon: f64,
    pub height: f64,
    /// Ellipsoid name: "WGS84", "CLARKE_1866", "GRS80". Defaults to WGS84.
    #[serde(default = "default_ellipsoid_name")]
    pub ellipsoid: String,
}

fn default_ellipsoid_name() -> String {
    "WGS84".to_string()
}

fn lookup_ellipsoid(name: &str) -> Result<Ellipsoid, HandlerError> {
    match name {
        "WGS84" => Ok(datums::WGS84),
        "CLARKE_1866" => Ok(datums::CLARKE_1866),
        "GRS80" => Ok(datums::GRS80),
        other => Err(HandlerError::InvalidParams(format!(
            "Unknown ellipsoid: {}. Supported: WGS84, CLARKE_1866, GRS80",
            other
        ))),
    }
}

pub async fn handle_geodetic_to_ecef(
    params: serde_json::Value,
) -> Result<serde_json::Value, HandlerError> {
    let p: GeodeticToEcefParams = serde_json::from_value(params)
        .map_err(|e| HandlerError::InvalidParams(e.to_string()))?;
    let ell = lookup_ellipsoid(&p.ellipsoid)?;
    let ecef = geodetic_to_ecef(p.lat, p.lon, p.height, &ell);
    Ok(serde_json::to_value(ecef).map_err(|e| HandlerError::Internal(e.to_string()))?)
}

#[derive(Debug, Deserialize)]
pub struct EcefToGeodeticParams {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    #[serde(default = "default_ellipsoid_name")]
    pub ellipsoid: String,
}

pub async fn handle_ecef_to_geodetic(
    params: serde_json::Value,
) -> Result<serde_json::Value, HandlerError> {
    let p: EcefToGeodeticParams = serde_json::from_value(params)
        .map_err(|e| HandlerError::InvalidParams(e.to_string()))?;
    let ell = lookup_ellipsoid(&p.ellipsoid)?;
    let ecef = ECEF { x: p.x, y: p.y, z: p.z };
    let geo = ecef_to_geodetic(&ecef, &ell);
    Ok(serde_json::to_value(geo).map_err(|e| HandlerError::Internal(e.to_string()))?)
}

// ─── Geodesy: Helmert ────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct HelmertTransformParams {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub tx: f64,
    pub ty: f64,
    pub tz: f64,
    pub rx_arcsec: f64,
    pub ry_arcsec: f64,
    pub rz_arcsec: f64,
    pub scale_ppm: f64,
    /// "PositionVector" or "CoordinateFrame". Defaults to PositionVector.
    #[serde(default = "default_convention")]
    pub convention: String,
}

fn default_convention() -> String {
    "PositionVector".to_string()
}

pub async fn handle_helmert_transform(
    params: serde_json::Value,
) -> Result<serde_json::Value, HandlerError> {
    let p: HelmertTransformParams = serde_json::from_value(params)
        .map_err(|e| HandlerError::InvalidParams(e.to_string()))?;
    let convention = match p.convention.as_str() {
        "PositionVector" => TransformConvention::PositionVector,
        "CoordinateFrame" => TransformConvention::CoordinateFrame,
        other => return Err(HandlerError::InvalidParams(format!(
            "Unknown convention: {}. Use 'PositionVector' or 'CoordinateFrame'", other
        ))),
    };
    let helmert_params = HelmertParams {
        tx: p.tx, ty: p.ty, tz: p.tz,
        rx_arcsec: p.rx_arcsec, ry_arcsec: p.ry_arcsec, rz_arcsec: p.rz_arcsec,
        scale_ppm: p.scale_ppm,
        convention,
    };
    let input = ECEF { x: p.x, y: p.y, z: p.z };
    let result = helmert_transform(&input, &helmert_params);
    Ok(serde_json::to_value(result).map_err(|e| HandlerError::Internal(e.to_string()))?)
}

// ─── Geodesy: Transverse Mercator ────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct TmForwardParams {
    pub lat: f64,
    pub lon: f64,
    pub central_meridian_deg: f64,
    pub latitude_of_origin_deg: f64,
    pub false_easting_m: f64,
    pub false_northing_m: f64,
    pub scale_factor: f64,
    #[serde(default = "default_ellipsoid_name")]
    pub ellipsoid: String,
}

pub async fn handle_tm_forward(
    params: serde_json::Value,
) -> Result<serde_json::Value, HandlerError> {
    let p: TmForwardParams = serde_json::from_value(params)
        .map_err(|e| HandlerError::InvalidParams(e.to_string()))?;
    let ell = lookup_ellipsoid(&p.ellipsoid)?;
    let tm = TMParams {
        central_meridian_deg: p.central_meridian_deg,
        latitude_of_origin_deg: p.latitude_of_origin_deg,
        false_easting_m: p.false_easting_m,
        false_northing_m: p.false_northing_m,
        scale_factor: p.scale_factor,
        ellipsoid: ell,
    };
    let (e, n) = transverse_mercator_forward(p.lat, p.lon, &tm);
    Ok(serde_json::json!({ "easting": e, "northing": n }))
}

#[derive(Debug, Deserialize)]
pub struct TmInverseParams {
    pub easting: f64,
    pub northing: f64,
    pub central_meridian_deg: f64,
    pub latitude_of_origin_deg: f64,
    pub false_easting_m: f64,
    pub false_northing_m: f64,
    pub scale_factor: f64,
    #[serde(default = "default_ellipsoid_name")]
    pub ellipsoid: String,
}

pub async fn handle_tm_inverse(
    params: serde_json::Value,
) -> Result<serde_json::Value, HandlerError> {
    let p: TmInverseParams = serde_json::from_value(params)
        .map_err(|e| HandlerError::InvalidParams(e.to_string()))?;
    let ell = lookup_ellipsoid(&p.ellipsoid)?;
    let tm = TMParams {
        central_meridian_deg: p.central_meridian_deg,
        latitude_of_origin_deg: p.latitude_of_origin_deg,
        false_easting_m: p.false_easting_m,
        false_northing_m: p.false_northing_m,
        scale_factor: p.scale_factor,
        ellipsoid: ell,
    };
    let (lat, lon) = transverse_mercator_inverse(p.easting, p.northing, &tm);
    Ok(serde_json::json!({ "lat": lat, "lon": lon }))
}

#[derive(Debug, Deserialize)]
pub struct UtmForwardParams {
    pub lat: f64,
    pub lon: f64,
    pub zone: u8,
    pub is_southern: bool,
    #[serde(default = "default_ellipsoid_name")]
    pub ellipsoid: String,
}

pub async fn handle_utm_forward(
    params: serde_json::Value,
) -> Result<serde_json::Value, HandlerError> {
    let p: UtmForwardParams = serde_json::from_value(params)
        .map_err(|e| HandlerError::InvalidParams(e.to_string()))?;
    let ell = lookup_ellipsoid(&p.ellipsoid)?;
    let (e, n) = utm_forward(p.lat, p.lon, p.zone, p.is_southern, ell);
    Ok(serde_json::json!({ "easting": e, "northing": n }))
}

#[derive(Debug, Deserialize)]
pub struct UtmInverseParams {
    pub easting: f64,
    pub northing: f64,
    pub zone: u8,
    pub is_southern: bool,
    #[serde(default = "default_ellipsoid_name")]
    pub ellipsoid: String,
}

pub async fn handle_utm_inverse(
    params: serde_json::Value,
) -> Result<serde_json::Value, HandlerError> {
    let p: UtmInverseParams = serde_json::from_value(params)
        .map_err(|e| HandlerError::InvalidParams(e.to_string()))?;
    let ell = lookup_ellipsoid(&p.ellipsoid)?;
    let (lat, lon) = utm_inverse(p.easting, p.northing, p.zone, p.is_southern, ell);
    Ok(serde_json::json!({ "lat": lat, "lon": lon }))
}

// ─── COGO: Traverse ──────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct TraverseMisclosureParams {
    pub legs: Vec<TraverseLegInput>,
}

#[derive(Debug, Deserialize)]
pub struct TraverseLegInput {
    pub bearing_deg: f64,
    pub distance_m: f64,
}

pub async fn handle_traverse_misclosure(
    params: serde_json::Value,
) -> Result<serde_json::Value, HandlerError> {
    let p: TraverseMisclosureParams = serde_json::from_value(params)
        .map_err(|e| HandlerError::InvalidParams(e.to_string()))?;
    let legs: Vec<TraverseLeg> = p
        .legs
        .into_iter()
        .map(|l| TraverseLeg { bearing_deg: l.bearing_deg, distance_m: l.distance_m })
        .collect();
    let (de, dn, total, misc) = closed_traverse_misclosure(&legs)
        .map_err(|e| HandlerError::Internal(e.to_string()))?;
    Ok(serde_json::json!({
        "delta_easting_m": de,
        "delta_northing_m": dn,
        "total_length_m": total,
        "misclosure_m": misc,
        "ratio": if misc > 0.0 { total / misc } else { f64::INFINITY },
        "within_cadastral_tolerance": misc == 0.0 || total / misc >= 5000.0,
    }))
}

pub async fn handle_bowditch_adjust(
    params: serde_json::Value,
) -> Result<serde_json::Value, HandlerError> {
    let p: TraverseMisclosureParams = serde_json::from_value(params)
        .map_err(|e| HandlerError::InvalidParams(e.to_string()))?;
    let legs: Vec<TraverseLeg> = p
        .legs
        .into_iter()
        .map(|l| TraverseLeg { bearing_deg: l.bearing_deg, distance_m: l.distance_m })
        .collect();
    let result = bowditch_adjust(&legs)
        .map_err(|e| HandlerError::Internal(e.to_string()))?;
    Ok(serde_json::to_value(result).map_err(|e| HandlerError::Internal(e.to_string()))?)
}

pub async fn handle_transit_adjust(
    params: serde_json::Value,
) -> Result<serde_json::Value, HandlerError> {
    let p: TraverseMisclosureParams = serde_json::from_value(params)
        .map_err(|e| HandlerError::InvalidParams(e.to_string()))?;
    let legs: Vec<TraverseLeg> = p
        .legs
        .into_iter()
        .map(|l| TraverseLeg { bearing_deg: l.bearing_deg, distance_m: l.distance_m })
        .collect();
    let result = transit_adjust(&legs)
        .map_err(|e| HandlerError::Internal(e.to_string()))?;
    Ok(serde_json::to_value(result).map_err(|e| HandlerError::Internal(e.to_string()))?)
}

// ─── COGO: Intersection ──────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BearingBearingParams {
    pub p1: PointInput,
    pub bearing1_deg: f64,
    pub p2: PointInput,
    pub bearing2_deg: f64,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PointInput {
    pub easting: f64,
    pub northing: f64,
}

pub async fn handle_bearing_bearing(
    params: serde_json::Value,
) -> Result<serde_json::Value, HandlerError> {
    let p: BearingBearingParams = serde_json::from_value(params)
        .map_err(|e| HandlerError::InvalidParams(e.to_string()))?;
    let p1 = Point2D::new(p.p1.easting, p.p1.northing);
    let p2 = Point2D::new(p.p2.easting, p.p2.northing);
    let result = bearing_bearing(p1, p.bearing1_deg, p2, p.bearing2_deg)
        .map_err(|e| HandlerError::Internal(e.to_string()))?;
    Ok(serde_json::json!({ "easting": result.easting, "northing": result.northing }))
}

#[derive(Debug, Deserialize)]
pub struct BearingDistanceParams {
    pub p1: PointInput,
    pub bearing1_deg: f64,
    pub p2: PointInput,
    pub distance_from_p2_m: f64,
}

pub async fn handle_bearing_distance(
    params: serde_json::Value,
) -> Result<serde_json::Value, HandlerError> {
    let p: BearingDistanceParams = serde_json::from_value(params)
        .map_err(|e| HandlerError::InvalidParams(e.to_string()))?;
    let p1 = Point2D::new(p.p1.easting, p.p1.northing);
    let p2 = Point2D::new(p.p2.easting, p.p2.northing);
    let result = bearing_distance(p1, p.bearing1_deg, p2, p.distance_from_p2_m)
        .map_err(|e| HandlerError::Internal(e.to_string()))?;
    Ok(serde_json::json!({ "easting": result.easting, "northing": result.northing }))
}

#[derive(Debug, Deserialize)]
pub struct DistanceDistanceParams {
    pub p1: PointInput,
    pub r1_m: f64,
    pub p2: PointInput,
    pub r2_m: f64,
}

pub async fn handle_distance_distance(
    params: serde_json::Value,
) -> Result<serde_json::Value, HandlerError> {
    let p: DistanceDistanceParams = serde_json::from_value(params)
        .map_err(|e| HandlerError::InvalidParams(e.to_string()))?;
    let p1 = Point2D::new(p.p1.easting, p.p1.northing);
    let p2 = Point2D::new(p.p2.easting, p.p2.northing);
    let result = distance_distance(p1, p.r1_m, p2, p.r2_m)
        .map_err(|e| HandlerError::Internal(e.to_string()))?;
    Ok(serde_json::json!({ "easting": result.easting, "northing": result.northing }))
}

// ─── COGO: Area ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct AreaParams {
    pub points: Vec<(f64, f64)>,
    /// Optional: compute ellipsoidal area. If omitted, returns planar
    /// Shoelace only.
    pub ellipsoidal: Option<EllipsoidalAreaParams>,
}

#[derive(Debug, Deserialize)]
pub struct EllipsoidalAreaParams {
    pub mean_latitude_deg: f64,
    pub mean_height_m: f64,
    pub point_scale_factor: f64,
    #[serde(default = "default_ellipsoid_name")]
    pub ellipsoid: String,
}

pub async fn handle_area(
    params: serde_json::Value,
) -> Result<serde_json::Value, HandlerError> {
    let p: AreaParams = serde_json::from_value(params)
        .map_err(|e| HandlerError::InvalidParams(e.to_string()))?;
    let planar = shoelace_area(&p.points);
    let mut result = serde_json::json!({
        "planar_area_sq_m": planar,
        "planar_area_ha": AreaUnit::Hectares.convert_from_sq_metres(planar),
        "planar_area_acres": AreaUnit::Acres.convert_from_sq_metres(planar),
    });
    if let Some(ell) = p.ellipsoidal {
        let ellipsoid = lookup_ellipsoid(&ell.ellipsoid)?;
        let ground = ellipsoidal_area(
            planar,
            ell.mean_latitude_deg,
            ell.mean_height_m,
            ell.point_scale_factor,
            &ellipsoid,
        );
        result["ground_area_sq_m"] = serde_json::json!(ground);
        result["ground_area_ha"] = serde_json::json!(AreaUnit::Hectares.convert_from_sq_metres(ground));
        result["ground_area_acres"] = serde_json::json!(AreaUnit::Acres.convert_from_sq_metres(ground));
    }
    Ok(result)
}

// ─── Adjustment ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct AdjustmentParams {
    pub parameters: Vec<ParameterPrior>,
    pub observations: Vec<Observation>,
    #[serde(default)]
    pub config: AdjustmentConfig,
}

pub async fn handle_adjustment_run(
    params: serde_json::Value,
) -> Result<serde_json::Value, HandlerError> {
    let p: AdjustmentParams = serde_json::from_value(params)
        .map_err(|e| HandlerError::InvalidParams(e.to_string()))?;
    let result = adjust_least_squares(&p.parameters, &p.observations, &p.config)
        .map_err(|e| HandlerError::Internal(e.to_string()))?;
    Ok(serde_json::to_value(result).map_err(|e| HandlerError::Internal(e.to_string()))?)
}
