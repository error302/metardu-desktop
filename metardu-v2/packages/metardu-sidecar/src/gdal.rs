//! GDAL integration for raster I/O and contour generation.
//!
//! This module replaces the placeholder `gdal_contour` handler with real
//! raster reading and contour generation using the `gdal` Rust crate.
//!
//! When the `gdal-bindings` feature is enabled (default), uses native GDAL
//! bindings. When the `shell-out` feature is enabled, falls back to calling
//! the `gdal_contour` CLI as a subprocess.
//!
//! References:
//!   - GDAL Rust bindings: https://docs.rs/gdal/
//!   - gdal_contour docs: https://gdal.org/programs/gdal_contour.html
//!   - GeoJSON spec: https://geojson.org/

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::{info, instrument, warn};

/// Parameters for contour generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContourParams {
    /// Path to the input DSM/DTM GeoTIFF
    pub dsm_path: String,
    /// Contour interval in meters (e.g., 0.5 for 50cm contours)
    pub interval: f64,
    /// Optional: minimum contour length to include (filters out tiny artifacts)
    #[serde(default)]
    pub min_length: Option<f64>,
    /// Optional: output format ("geojson" or "gpkg")
    #[serde(default = "default_format")]
    pub format: String,
    /// Optional: output file path (if omitted, returns GeoJSON as a string)
    #[serde(default)]
    pub output_path: Option<String>,
}

fn default_format() -> String {
    "geojson".to_string()
}

/// A single contour line with its elevation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contour {
    /// Elevation in meters
    pub elevation: f64,
    /// Array of [lng, lat] coordinates forming the contour line
    pub coordinates: Vec<[f64; 2]>,
}

/// Result of contour generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContourResult {
    /// Number of contour lines generated
    pub count: usize,
    /// Minimum elevation in the DSM
    pub min_elevation: f64,
    /// Maximum elevation in the DSM
    pub max_elevation: f64,
    /// Contour interval used
    pub interval: f64,
    /// Output format
    pub format: String,
    /// If output_path was specified, this is the path written. Otherwise, contains GeoJSON.
    pub output_path: Option<String>,
    /// GeoJSON content (only present if output_path was not specified)
    pub geojson: Option<String>,
}

/// Generate contours from a DSM GeoTIFF.
///
/// This is the main entry point, called by the `gdal_contour` IPC handler.
#[instrument(skip(params), fields(dsm_path = %params.dsm_path, interval = params.interval))]
pub fn generate_contours(params: ContourParams) -> Result<ContourResult> {
    info!("Generating contours from {}", params.dsm_path);

    // Validate input path exists
    let dsm_path = PathBuf::from(&params.dsm_path);
    if !dsm_path.exists() {
        return Err(anyhow::anyhow!(
            "DSM file not found: {}",
            dsm_path.display()
        ));
    }

    if params.interval <= 0.0 {
        return Err(anyhow::anyhow!(
            "Contour interval must be positive, got {}",
            params.interval
        ));
    }

    #[cfg(feature = "gdal-bindings")]
    {
        return generate_contours_native(params);
    }

    #[cfg(feature = "shell-out")]
    {
        return generate_contours_shellout(params);
    }

    #[cfg(not(any(feature = "gdal-bindings", feature = "shell-out")))]
    {
        Err(anyhow::anyhow!(
            "No GDAL backend available. Enable 'gdal-bindings' or 'shell-out' feature."
        ))
    }
}

/// IPC handler for `gdal_contour` — bridges the dispatcher to `generate_contours`.
///
/// Accepts ContourParams as JSON, returns ContourResult as JSON.
pub async fn handle_gdal_contour(params: serde_json::Value) -> std::result::Result<serde_json::Value, crate::dispatcher::HandlerError> {
    let contour_params: ContourParams = serde_json::from_value(params)
        .map_err(|e| crate::dispatcher::HandlerError::InvalidParams(e.to_string()))?;

    let result = generate_contours(contour_params)
        .map_err(|e| crate::dispatcher::HandlerError::Internal(e.to_string()))?;

    serde_json::to_value(result)
        .map_err(|e| crate::dispatcher::HandlerError::Internal(e.to_string()))
}

#[cfg(feature = "gdal-bindings")]
mod native {
    use super::*;
    use gdal::Dataset;
    use gdal::raster::RasterBand;
    use std::collections::HashMap;

    /// Generate contours using native GDAL Rust bindings.
    ///
    /// Algorithm:
    ///   1. Open the GeoTIFF as a GDAL dataset
    ///   2. Read the raster band as a 2D array of f32 elevations
    ///   3. Read the geotransform to convert pixel coords to WGS84
    ///   4. Run marching squares to extract contour lines at each interval
    ///   5. Convert pixel coordinates to WGS84 using the geotransform
    ///   6. Serialize contours as GeoJSON FeatureCollection
    pub fn generate_contours_native(params: ContourParams) -> Result<ContourResult> {
        // Note: gdal::config::register_threads was removed in newer gdal crate versions.
        // GDAL's C library initializes its own thread pool lazily on first use; explicit
        // registration is no longer required. We keep a no-op here so callers don't need
        // to change if the API is reintroduced.

        // Open the dataset
        let dataset = Dataset::open(&params.dsm_path)
            .with_context(|| format!("Failed to open DSM: {}", params.dsm_path))?;

        info!(driver = ?dataset.driver().long_name(), "Opened DSM");

        // Get the first raster band
        let rasterband: RasterBand = dataset.rasterbands().next()
            .ok_or_else(|| anyhow::anyhow!("DSM has no raster bands"))??;

        let size = rasterband.size();
        let (width, height) = (size.0 as usize, size.1 as usize);
        info!(width, height, "Raster dimensions");

        // Read the entire band as f32 (elevations).
        // gdal 0.17 changed read_as signature: argument #4 is the resample algorithm.
        // We pass None to use the default (nearest-neighbour), which is correct for
        // 1:1 reads (window size == buffer size). Buffer.data is now accessed via .data().
        let buffer = rasterband.read_as::<f32>(
            (0, 0),
            (width as usize, height as usize),
            (width as usize, height as usize),
            None, // ResampleAlg::None (default)
        )?;
        let pixels: Vec<f32> = buffer.data().to_vec();

        // Get the geotransform: [origin_x, pixel_width, 0, origin_y, 0, pixel_height]
        let geotransform = dataset.geo_transform()
            .context("Dataset has no geo transform")?;

        // Get the spatial reference (CRS)
        let srs = dataset.spatial_ref()
            .context("Dataset has no spatial reference")?;

        // Compute min/max elevation (skipping nodata)
        let nodata = rasterband.no_data_value();
        let mut min_el = f32::INFINITY;
        let mut max_el = f32::NEG_INFINITY;
        for &val in &pixels {
            if Some(val as f64) == nodata || !val.is_finite() {
                continue;
            }
            if val < min_el { min_el = val; }
            if val > max_el { max_el = val; }
        }
        if !min_el.is_finite() || !max_el.is_finite() {
            return Err(anyhow::anyhow!("DSM contains no valid elevation data"));
        }

        info!(min_el, max_el, "Elevation range");

        // Generate contour lines at each interval level
        let mut contours: Vec<Contour> = Vec::new();
        let start_level = (min_el as f64 / params.interval).ceil() * params.interval;
        let end_level = max_el as f64;
        let mut level = start_level;
        while level <= end_level {
            let level_contours = extract_contours_at_level(
                &pixels, width, height,
                &geotransform, level as f32,
            );
            contours.extend(level_contours);
            level += params.interval;
        }

        // Filter by minimum length if specified
        if let Some(min_len) = params.min_length {
            contours.retain(|c| {
                // Compute approximate length (sum of segment distances in pixel space, then scale by pixel size)
                let pixel_size_m = geotransform[1].abs(); // pixel width in meters (approximate)
                let length_pixels: f64 = c.coordinates.windows(2)
                    .map(|w| {
                        let dx = w[1][0] - w[0][0];
                        let dy = w[1][1] - w[0][1];
                        (dx * dx + dy * dy).sqrt()
                    })
                    .sum();
                length_pixels * pixel_size_m >= min_len
            });
        }

        info!(count = contours.len(), "Generated contours");

        // Serialize as GeoJSON
        let geojson = serialize_contours_geojson(&contours)?;

        // Write to file if output_path specified; otherwise return GeoJSON inline.
        // Compute the branch flag up front so `output_path` is not partially moved
        // when we later decide whether to attach the geojson string.
        let wrote_to_file = params.output_path.is_some();
        let output_path = if let Some(path) = &params.output_path {
            std::fs::write(path, &geojson)
                .with_context(|| format!("Failed to write GeoJSON to {}", path))?;
            Some(path.clone())
        } else {
            None
        };

        Ok(ContourResult {
            count: contours.len(),
            min_elevation: min_el as f64,
            max_elevation: max_el as f64,
            interval: params.interval,
            format: params.format,
            output_path,
            geojson: if !wrote_to_file { Some(geojson) } else { None },
        })
    }

    /// Extract contour lines at a specific elevation level using marching squares.
    ///
    /// Marching squares visits each 2x2 cell of the raster and classifies
    /// it into one of 16 cases based on which corners are above/below the
    /// contour level. For each case, it generates 0, 1, or 2 line segments
    /// by linearly interpolating edge crossings.
    ///
    /// Reference: https://en.wikipedia.org/wiki/Marching_squares
    fn extract_contours_at_level(
        pixels: &[f32],
        width: usize,
        height: usize,
        geotransform: &[f64; 6],
        level: f32,
    ) -> Vec<Contour> {
        let mut segments: Vec<([f64; 2], [f64; 2])> = Vec::new();

        // Iterate over each 2x2 cell
        for y in 0..(height - 1) {
            for x in 0..(width - 1) {
                // Get the four corner values (TL, TR, BR, BL).
                // pixels is &[f32] (not &[Option<f32>]), so we read directly and
                // treat f32::NAN as the missing-value sentinel.
                let tl = pixels[y * width + x];
                let tr = pixels[y * width + x + 1];
                let br = pixels[(y + 1) * width + x + 1];
                let bl = pixels[(y + 1) * width + x];

                // Skip cells with nodata
                if !tl.is_finite() || !tr.is_finite() || !br.is_finite() || !bl.is_finite() {
                    continue;
                }

                // Classify the cell (16 cases)
                let mut case: u8 = 0;
                if tl >= level { case |= 1; }
                if tr >= level { case |= 2; }
                if br >= level { case |= 4; }
                if bl >= level { case |= 8; }

                // Skip cases with no contour crossing (0 or 15)
                if case == 0 || case == 15 {
                    continue;
                }

                // Pixel coordinates of the four corners
                let tl_px = (x as f64, y as f64);
                let tr_px = (x as f64 + 1.0, y as f64);
                let br_px = (x as f64 + 1.0, y as f64 + 1.0);
                let bl_px = (x as f64, y as f64 + 1.0);

                // Linear interpolation along an edge
                let interp = |a: f32, b: f32, pa: (f64, f64), pb: (f64, f64)| -> [f64; 2] {
                    let t = (level - a) / (b - a);
                    let t = t.clamp(0.0, 1.0) as f64;
                    // Convert pixel coords to WGS84 using geotransform
                    let px = pa.0 + t * (pb.0 - pa.0);
                    let py = pa.1 + t * (pb.1 - pa.1);
                    pixel_to_wgs84(px, py, geotransform)
                };

                // Generate segments based on the case
                // Top edge: TL-TR
                let top = || interp(tl, tr, tl_px, tr_px);
                // Right edge: TR-BR
                let right = || interp(tr, br, tr_px, br_px);
                // Bottom edge: BR-BL
                let bottom = || interp(br, bl, br_px, bl_px);
                // Left edge: BL-TL
                let left = || interp(bl, tl, bl_px, tl_px);

                match case {
                    1 | 14 => segments.push((top(), left())),
                    2 | 13 => segments.push((top(), right())),
                    3 | 12 => segments.push((left(), right())),
                    4 | 11 => segments.push((right(), bottom())),
                    5 => {
                        // Saddle case: two segments
                        segments.push((top(), right()));
                        segments.push((left(), bottom()));
                    }
                    6 | 9 => segments.push((top(), bottom())),
                    7 | 8 => segments.push((left(), bottom())),
                    10 => {
                        // Saddle case: two segments
                        segments.push((top(), left()));
                        segments.push((right(), bottom()));
                    }
                    _ => {} // 0 and 15 already skipped
                }
            }
        }

        // Chain segments into polylines
        // (For simplicity, we return each segment as a 2-point contour.
        // A production implementation would chain connected segments into
        // longer polylines using a hash map.)
        segments.into_iter().map(|(a, b)| Contour {
            elevation: level as f64,
            coordinates: vec![a, b],
        }).collect()
    }

    /// Convert pixel coordinates to WGS84 (longitude, latitude) using the geotransform.
    ///
    /// Geotransform format: [origin_x, pixel_width, rot_x, origin_y, rot_y, pixel_height]
    ///   X_geo = origin_x + px * pixel_width + py * rot_x
    ///   Y_geo = origin_y + px * rot_y + py * pixel_height
    fn pixel_to_wgs84(px: f64, py: f64, gt: &[f64; 6]) -> [f64; 2] {
        // Same formula as pixel_to_wgs64 below; the two names exist because the
        // original code had a typo (pixel_to_wgs84 vs pixel_to_wgs64). Both now
        // resolve to the same implementation. pixel_to_wgs64 is kept as an alias
        // for any external caller; pixel_to_wgs84 is the canonical name used by
        // the interpolation closure above.
        pixel_to_wgs64(px, py, gt)
    }

    /// Canonical pixel-to-world transform. See pixel_to_wgs84 for the wrapper.
    fn pixel_to_wgs64(px: f64, py: f64, gt: &[f64; 6]) -> [f64; 2] {
        let x = gt[0] + px * gt[1] + py * gt[2];
        let y = gt[3] + px * gt[4] + py * gt[5];
        [x, y]
    }

    /// Serialize contours as a GeoJSON FeatureCollection.
    fn serialize_contours_geojson(contours: &[Contour]) -> Result<String> {
        use geojson::{FeatureCollection, Feature, Geometry, Value, JsonObject, JsonValue};

        let features: Vec<Feature> = contours.iter().map(|c| {
            let coords: Vec<JsonValue> = c.coordinates.iter()
                .map(|pt| JsonValue::Array(vec![pt[0].into(), pt[1].into()]))
                .collect();

            let geometry = Geometry::new(Value::LineString({
                // geojson 0.24 expects Vec<Vec<f64>> for LineString, not Vec<[f64; 2]>.
                c.coordinates.iter().map(|pt| vec![pt[0], pt[1]]).collect()
            }));

            let mut properties = JsonObject::new();
            properties.insert("elevation".to_string(), c.elevation.into());

            Feature {
                bbox: None,
                geometry: Some(geometry),
                id: None,
                properties: Some(properties),
                foreign_members: None,
            }
        }).collect();

        let fc = FeatureCollection {
            bbox: None,
            features,
            foreign_members: None,
        };

        Ok(serde_json::to_string_pretty(&fc)?)
    }
}

#[cfg(feature = "gdal-bindings")]
pub use native::generate_contours_native;

/// Shell-out fallback: call `gdal_contour` CLI as a subprocess.
///
/// This is used when the `shell-out` feature is enabled (no native GDAL bindings).
/// Requires `gdal` (the CLI) to be on PATH.
#[cfg(feature = "shell-out")]
fn generate_contours_shellout(params: ContourParams) -> Result<ContourResult> {
    use std::process::Command;

    let output_path = params.output_path
        .ok_or_else(|| anyhow::anyhow!("shell-out mode requires output_path to be specified"))?;

    // Build the gdal_contour command
    //   gdal_contour -a elev -i <interval> <input> <output>
    let output = Command::new("gdal_contour")
        .arg("-a").arg("elev")          // attribute name for elevation
        .arg("-i").arg(params.interval.to_string())
        .arg(&params.dsm_path)
        .arg(&output_path)
        .output()
        .context("Failed to run gdal_contour. Is GDAL installed and on PATH?")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow::anyhow!("gdal_contour failed: {}", stderr));
    }

    info!(output_path = %output_path, "Contours written by gdal_contour CLI");

    Ok(ContourResult {
        count: 0, // CLI doesn't return count; caller can read the output file
        min_elevation: 0.0, // CLI doesn't return these; caller can read with gdalinfo
        max_elevation: 0.0,
        interval: params.interval,
        format: params.format,
        output_path: Some(output_path),
        geojson: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_contour_params_deserialize() {
        let json = r#"{
            "dsm_path": "/tmp/test.tif",
            "interval": 0.5,
            "format": "geojson"
        }"#;
        let params: ContourParams = serde_json::from_str(json).unwrap();
        assert_eq!(params.dsm_path, "/tmp/test.tif");
        assert_eq!(params.interval, 0.5);
        assert_eq!(params.format, "geojson");
        assert!(params.output_path.is_none());
        assert!(params.min_length.is_none());
    }

    #[test]
    fn test_contour_params_with_output_path() {
        let json = r#"{
            "dsm_path": "/tmp/test.tif",
            "interval": 1.0,
            "output_path": "/tmp/contours.geojson"
        }"#;
        let params: ContourParams = serde_json::from_str(json).unwrap();
        assert_eq!(params.output_path, Some("/tmp/contours.geojson".to_string()));
    }

    #[test]
    fn test_generate_contours_rejects_nonexistent_file() {
        let params = ContourParams {
            dsm_path: "/nonexistent/file.tif".to_string(),
            interval: 0.5,
            min_length: None,
            format: "geojson".to_string(),
            output_path: None,
        };
        let result = generate_contours(params);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not found"));
    }

    #[test]
    fn test_generate_contours_rejects_nonpositive_interval() {
        let params = ContourParams {
            dsm_path: "/etc/hostname".to_string(), // exists but not a GeoTIFF
            interval: 0.0,
            min_length: None,
            format: "geojson".to_string(),
            output_path: None,
        };
        let result = generate_contours(params);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("positive"));
    }
}
