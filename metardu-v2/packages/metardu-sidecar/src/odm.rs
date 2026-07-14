//! OpenDroneMap (ODM) sidecar integration.
//!
//! Provides in-app photogrammetry processing by orchestrating ODM either:
//!   1. As a Docker container (preferred — requires Docker installed)
//!   2. As a native PyInstaller-bundled binary (fallback — ~2GB download)
//!   3. As a shell-out to a system-installed ODM (developer mode)
//!
//! Replaces the v1.0 dependency on an external WebODM server, enabling
//! true offline photogrammetry for field work.
//!
//! The 13-stage aerial pipeline (already in v1.0) is preserved; this module
//! implements stage 4 (photogrammetry processing) locally instead of delegating
//! to an external server.
//!
//! References:
//!   - ODM documentation: https://docs.opendronemap.org/
//!   - ODM Docker image: https://hub.docker.com/r/opendronemap/odm
//!   - ODM configuration: https://docs.opendronemap.org/configuration/

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tokio::process::Command;
use tracing::{info, instrument, warn};

/// ODM processing parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OdmProcessParams {
    /// Path to the directory containing the drone photos (JPEGs).
    pub photos_path: String,
    /// Path to the output directory where ODM will write results.
    pub output_path: String,
    /// Optional: path to a GCP file (ODM gcp_list.txt format) for georeferencing.
    #[serde(default)]
    pub gcp_path: Option<String>,
    /// Orthophoto resolution in cm/px (default 5).
    #[serde(default = "default_ortho_resolution")]
    pub orthophoto_resolution_cm: f64,
    /// DEM resolution in cm/px (default 5).
    #[serde(default = "default_dem_resolution")]
    pub dem_resolution_cm: f64,
    /// Generate DSM (Digital Surface Model). Default true.
    #[serde(default = "default_true")]
    pub dsm: bool,
    /// Generate DTM (Digital Terrain Model). Default true.
    #[serde(default = "default_true")]
    pub dtm: bool,
    /// Contour resolution in meters (default 0.5).
    #[serde(default = "default_contour_resolution")]
    pub contour_resolution_m: f64,
    /// Optional: max concurrency (CPU threads). Default: number of CPUs.
    #[serde(default)]
    pub max_concurrency: Option<u32>,
    /// Optional: feature extraction quality ("low", "medium", "high"). Default "medium".
    #[serde(default = "default_quality")]
    pub feature_quality: String,
    /// Deployment mode: "docker" (preferred), "native" (PyInstaller binary), "shell-out" (system ODM).
    #[serde(default = "default_mode")]
    pub mode: String,
}

fn default_ortho_resolution() -> f64 { 5.0 }
fn default_dem_resolution() -> f64 { 5.0 }
fn default_true() -> bool { true }
fn default_contour_resolution() -> f64 { 0.5 }
fn default_quality() -> String { "medium".to_string() }
fn default_mode() -> String { "docker".to_string() }

/// Result of ODM processing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OdmProcessResult {
    /// True if processing completed successfully.
    pub success: bool,
    /// Processing duration in seconds.
    pub duration_sec: u64,
    /// Number of photos processed.
    pub photo_count: usize,
    /// Path to the generated orthophoto (None if not generated).
    pub orthophoto_path: Option<String>,
    /// Path to the generated DSM (None if not generated).
    pub dsm_path: Option<String>,
    /// Path to the generated DTM (None if not generated).
    pub dtm_path: Option<String>,
    /// Path to the generated point cloud (None if not generated).
    pub point_cloud_path: Option<String>,
    /// Path to the generated contours (None if not generated).
    pub contour_path: Option<String>,
    /// ODM's final status output.
    pub status: String,
    /// Any warnings or notes from ODM.
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// ODM processing progress (streamed during processing).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OdmProgress {
    /// Current stage (e.g., "OpenSfM", "OpenMVS", "ODM")
    pub stage: String,
    /// Progress percentage (0-100)
    pub progress_percent: f64,
    /// Human-readable status message
    pub message: String,
}

/// Process drone photos through OpenDroneMap.
///
/// This is the main entry point, called by the `odm_process` IPC handler.
/// The function blocks until ODM completes (or fails).
#[instrument(skip(params), fields(photos = %params.photos_path, mode = %params.mode))]
pub async fn process_photos(params: OdmProcessParams) -> Result<OdmProcessResult> {
    info!("Starting ODM processing in {} mode", params.mode);

    // Validate inputs
    let photos_path = PathBuf::from(&params.photos_path);
    if !photos_path.exists() {
        return Err(anyhow::anyhow!("Photos directory not found: {}", photos_path.display()));
    }

    let output_path = PathBuf::from(&params.output_path);
    std::fs::create_dir_all(&output_path)
        .with_context(|| format!("Failed to create output directory: {}", output_path.display()))?;

    // Count photos
    let photo_count = count_photos(&photos_path)?;
    if photo_count == 0 {
        return Err(anyhow::anyhow!("No JPEG photos found in {}", photos_path.display()));
    }

    info!(photo_count, "Found photos to process");

    let start = Instant::now();

    let result = match params.mode.as_str() {
        "docker" => process_with_docker(&params, photo_count).await,
        "native" => process_with_native(&params, photo_count).await,
        "shell-out" => process_with_shellout(&params, photo_count).await,
        other => Err(anyhow::anyhow!("Unknown ODM mode: {}. Use 'docker', 'native', or 'shell-out'.", other)),
    };

    let duration_sec = start.elapsed().as_secs();

    match result {
        Ok(mut result) => {
            result.duration_sec = duration_sec;
            result.photo_count = photo_count;
            info!(duration_sec, photo_count, "ODM processing completed successfully");
            Ok(result)
        }
        Err(e) => {
            warn!(error = %e, duration_sec, "ODM processing failed");
            Ok(OdmProcessResult {
                success: false,
                duration_sec,
                photo_count,
                orthophoto_path: None,
                dsm_path: None,
                dtm_path: None,
                point_cloud_path: None,
                contour_path: None,
                status: format!("FAILED: {}", e),
                warnings: vec![],
            })
        }
    }
}

/// Count JPEG photos in a directory.
fn count_photos(path: &PathBuf) -> Result<usize> {
    let mut count = 0;
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name.ends_with(".jpg") || name.ends_with(".jpeg") {
            count += 1;
        }
    }
    Ok(count)
}

/// Process photos using the ODM Docker container.
///
/// Requires Docker to be installed and running. Uses the official
/// opendronemap/odm image from Docker Hub.
async fn process_with_docker(params: &OdmProcessParams, _photo_count: usize) -> Result<OdmProcessResult> {
    // Verify Docker is available
    let docker_check = Command::new("docker")
        .args(["--version"])
        .output()
        .await
        .context("Failed to run 'docker --version'. Is Docker installed?")?;

    if !docker_check.status.success() {
        return Err(anyhow::anyhow!("Docker not available or not running"));
    }

    let docker_version = String::from_utf8_lossy(&docker_check.stdout);
    info!(docker_version = %docker_version.trim(), "Docker available");

    // Build the Docker command
    //   docker run --rm -v <photos>:/datasets/code -v <output>:/outputs opendronemap/odm [options]
    let mut docker_args = vec![
        "run".to_string(),
        "--rm".to_string(),
        "-v".to_string(),
        format!("{}:/datasets/code:ro", params.photos_path),
        "-v".to_string(),
        format!("{}:/outputs", params.output_path),
    ];

    // Add GCP file mount if provided
    if let Some(gcp_path) = &params.gcp_path {
        docker_args.push("-v".to_string());
        docker_args.push(format!("{}:/datasets/code/gcp_list.txt:ro", gcp_path));
        docker_args.push("--gcp".to_string());
        docker_args.push("/datasets/code/gcp_list.txt".to_string());
    }

    // Add ODM options
    docker_args.push("opendronemap/odm".to_string());
    docker_args.push("--project-path".to_string());
    docker_args.push("/datasets".to_string());

    if params.dsm {
        docker_args.push("--dsm".to_string());
    }
    if params.dtm {
        docker_args.push("--dtm".to_string());
    }
    docker_args.push("--orthophoto-resolution".to_string());
    docker_args.push(format!("{:.0}", params.orthophoto_resolution_cm));
    docker_args.push("--dem-resolution".to_string());
    docker_args.push(format!("{:.0}", params.dem_resolution_cm));
    docker_args.push("--contour-resolution".to_string());
    docker_args.push(format!("{:.2}", params.contour_resolution_m));

    if let Some(threads) = params.max_concurrency {
        docker_args.push("--max-concurrency".to_string());
        docker_args.push(threads.to_string());
    }

    docker_args.push("--feature-quality".to_string());
    docker_args.push(params.feature_quality.clone());

    info!(args = ?docker_args, "Running ODM Docker container");

    // Run the Docker container
    let output = Command::new("docker")
        .args(&docker_args)
        .output()
        .await
        .context("Failed to run docker command")?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(anyhow::anyhow!("ODM Docker container failed: {}", stderr));
    }

    // Find output files
    let orthophoto_path = find_output_file(&params.output_path, "odm_orthophoto.tif");
    let dsm_path = find_output_file(&params.output_path, "dsm.tif");
    let dtm_path = find_output_file(&params.output_path, "dtm.tif");
    let point_cloud_path = find_output_file(&params.output_path, "odm_georeferencing.laz");
    let contour_path = find_output_file(&params.output_path, "odm_contours.shp");

    let warnings = parse_odm_warnings(&stderr);

    Ok(OdmProcessResult {
        success: true,
        duration_sec: 0, // Set by caller
        photo_count: 0, // Set by caller
        orthophoto_path,
        dsm_path,
        dtm_path,
        point_cloud_path,
        contour_path,
        status: "COMPLETED".to_string(),
        warnings,
    })
}

/// Process photos using a native PyInstaller-bundled ODM binary.
///
/// Requires the ODM binary to be downloaded separately (~2GB) and placed
/// in the resources/odm/ directory of the MetaRDU installation.
async fn process_with_native(params: &OdmProcessParams, _photo_count: usize) -> Result<OdmProcessResult> {
    // Look for the ODM binary in standard locations
    let possible_paths = [
        "resources/odm/odm",
        "/usr/local/bin/odm",
        "/opt/odm/odm",
        "odm", // On PATH
    ];

    let odm_bin = possible_paths.iter()
        .find(|p| std::path::Path::new(p).exists())
        .ok_or_else(|| anyhow::anyhow!(
            "ODM binary not found. Download it from https://opendronemap.org/ and place in resources/odm/"
        ))?;

    info!(odm_bin, "Using native ODM binary");

    let mut odm_args = vec![
        "--project-path".to_string(),
        params.output_path.clone(),
    ];

    if params.dsm { odm_args.push("--dsm".to_string()); }
    if params.dtm { odm_args.push("--dtm".to_string()); }
    odm_args.push("--orthophoto-resolution".to_string());
    odm_args.push(format!("{:.0}", params.orthophoto_resolution_cm));

    let output = Command::new(odm_bin)
        .args(&odm_args)
        .args([params.photos_path.clone()])
        .output()
        .await
        .context("Failed to run ODM binary")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow::anyhow!("ODM binary failed: {}", stderr));
    }

    let orthophoto_path = find_output_file(&params.output_path, "odm_orthophoto.tif");

    Ok(OdmProcessResult {
        success: true,
        duration_sec: 0,
        photo_count: 0,
        orthophoto_path,
        dsm_path: find_output_file(&params.output_path, "dsm.tif"),
        dtm_path: find_output_file(&params.output_path, "dtm.tif"),
        point_cloud_path: find_output_file(&params.output_path, "odm_georeferencing.laz"),
        contour_path: find_output_file(&params.output_path, "odm_contours.shp"),
        status: "COMPLETED".to_string(),
        warnings: vec![],
    })
}

/// Process photos using a system-installed ODM (developer mode).
///
/// Requires ODM to be installed system-wide (e.g., `pip install opendronemap`).
async fn process_with_shellout(params: &OdmProcessParams, _photo_count: usize) -> Result<OdmProcessResult> {
    let mut odm_args = vec![
        "--project-path".to_string(),
        params.output_path.clone(),
    ];

    if params.dsm { odm_args.push("--dsm".to_string()); }
    if params.dtm { odm_args.push("--dtm".to_string()); }
    odm_args.push("--orthophoto-resolution".to_string());
    odm_args.push(format!("{:.0}", params.orthophoto_resolution_cm));
    odm_args.push(params.photos_path.clone());

    let output = Command::new("odm")
        .args(&odm_args)
        .output()
        .await
        .context("Failed to run 'odm' command. Is ODM installed and on PATH?")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow::anyhow!("ODM failed: {}", stderr));
    }

    Ok(OdmProcessResult {
        success: true,
        duration_sec: 0,
        photo_count: 0,
        orthophoto_path: find_output_file(&params.output_path, "odm_orthophoto.tif"),
        dsm_path: find_output_file(&params.output_path, "dsm.tif"),
        dtm_path: find_output_file(&params.output_path, "dtm.tif"),
        point_cloud_path: find_output_file(&params.output_path, "odm_georeferencing.laz"),
        contour_path: find_output_file(&params.output_path, "odm_contours.shp"),
        status: "COMPLETED".to_string(),
        warnings: vec![],
    })
}

/// Find an output file in the ODM output directory.
///
/// ODM writes to subdirectories like `odm_orthophoto/`, `odm_dem/`, etc.
fn find_output_file(output_path: &str, filename: &str) -> Option<String> {
    // Check subdirectories first (ODM's default output structure)
    let subdirs = ["odm_orthophoto", "odm_dem", "odm_georeferencing", "odm_contours"];
    for subdir in &subdirs {
        let candidate = PathBuf::from(output_path).join(subdir).join(filename);
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    // Check the output directory directly
    let candidate = PathBuf::from(output_path).join(filename);
    if candidate.exists() {
        Some(candidate.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Parse warnings from ODM's stderr output.
fn parse_odm_warnings(stderr: &str) -> Vec<String> {
    let mut warnings = Vec::new();
    for line in stderr.lines() {
        let lower = line.to_lowercase();
        if lower.contains("warning") || lower.contains("deprecated") {
            warnings.push(line.to_string());
        }
    }
    warnings
}

// ─── IPC handler ───────────────────────────────────────────────────

/// IPC handler for `odm_process`.
pub async fn handle_odm_process(
    params: serde_json::Value,
) -> std::result::Result<serde_json::Value, crate::dispatcher::HandlerError> {
    let odm_params: OdmProcessParams = serde_json::from_value(params)
        .map_err(|e| crate::dispatcher::HandlerError::InvalidParams(e.to_string()))?;

    let result = process_photos(odm_params).await
        .map_err(|e| crate::dispatcher::HandlerError::Internal(e.to_string()))?;

    serde_json::to_value(result)
        .map_err(|e| crate::dispatcher::HandlerError::Internal(e.to_string()))
}

// ─── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_odm_process_params_defaults() {
        let json = r#"{
            "photos_path": "/tmp/photos",
            "output_path": "/tmp/output"
        }"#;
        let params: OdmProcessParams = serde_json::from_str(json).unwrap();
        assert_eq!(params.orthophoto_resolution_cm, 5.0);
        assert_eq!(params.dem_resolution_cm, 5.0);
        assert!(params.dsm);
        assert!(params.dtm);
        assert_eq!(params.contour_resolution_m, 0.5);
        assert_eq!(params.feature_quality, "medium");
        assert_eq!(params.mode, "docker");
    }

    #[test]
    fn test_odm_process_params_with_gcp() {
        let json = r#"{
            "photos_path": "/tmp/photos",
            "output_path": "/tmp/output",
            "gcp_path": "/tmp/gcp_list.txt"
        }"#;
        let params: OdmProcessParams = serde_json::from_str(json).unwrap();
        assert_eq!(params.gcp_path, Some("/tmp/gcp_list.txt".to_string()));
    }

    #[test]
    fn test_count_photos_returns_zero_for_empty_directory() {
        let temp = tempfile::tempdir().unwrap();
        let count = count_photos(&temp.path().to_path_buf()).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_count_photos_counts_jpegs() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("photo1.jpg"), b"data").unwrap();
        std::fs::write(temp.path().join("photo2.jpeg"), b"data").unwrap();
        std::fs::write(temp.path().join("readme.txt"), b"data").unwrap();
        std::fs::write(temp.path().join("photo3.JPG"), b"data").unwrap();
        let count = count_photos(&temp.path().to_path_buf()).unwrap();
        assert_eq!(count, 3); // .jpg, .jpeg, .JPG (case-insensitive)
    }

    #[test]
    fn test_count_photos_returns_error_for_nonexistent_path() {
        let result = count_photos(&PathBuf::from("/nonexistent/path"));
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_process_photos_rejects_nonexistent_photos_path() {
        let params = OdmProcessParams {
            photos_path: "/nonexistent/photos".to_string(),
            output_path: "/tmp/output".to_string(),
            gcp_path: None,
            orthophoto_resolution_cm: 5.0,
            dem_resolution_cm: 5.0,
            dsm: true,
            dtm: true,
            contour_resolution_m: 0.5,
            max_concurrency: None,
            feature_quality: "medium".to_string(),
            mode: "docker".to_string(),
        };
        let result = process_photos(params).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not found"));
    }

    #[tokio::test]
    async fn test_process_photos_rejects_empty_photos_directory() {
        let temp = tempfile::tempdir().unwrap();
        let params = OdmProcessParams {
            photos_path: temp.path().to_str().unwrap().to_string(),
            output_path: "/tmp/output".to_string(),
            gcp_path: None,
            orthophoto_resolution_cm: 5.0,
            dem_resolution_cm: 5.0,
            dsm: true,
            dtm: true,
            contour_resolution_m: 0.5,
            max_concurrency: None,
            feature_quality: "medium".to_string(),
            mode: "docker".to_string(),
        };
        let result = process_photos(params).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("No JPEG photos"));
    }

    #[tokio::test]
    async fn test_process_photos_rejects_unknown_mode() {
        let temp = tempfile::tempdir().unwrap();
        // Create a fake photo so we pass the empty-directory check
        std::fs::write(temp.path().join("photo.jpg"), b"data").unwrap();

        let params = OdmProcessParams {
            photos_path: temp.path().to_str().unwrap().to_string(),
            output_path: "/tmp/output".to_string(),
            gcp_path: None,
            orthophoto_resolution_cm: 5.0,
            dem_resolution_cm: 5.0,
            dsm: true,
            dtm: true,
            contour_resolution_m: 0.5,
            max_concurrency: None,
            feature_quality: "medium".to_string(),
            mode: "nonexistent".to_string(),
        };
        // process_photos catches errors and returns a result with success=false
        let result = process_photos(params).await.unwrap();
        assert!(!result.success);
        assert!(result.status.contains("Unknown ODM mode"));
    }

    #[test]
    fn test_find_output_file_returns_none_for_nonexistent() {
        let result = find_output_file("/nonexistent/path", "test.tif");
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_odm_warnings_extracts_warning_lines() {
        let stderr = "INFO: starting\nWARNING: deprecated option\nERROR: something else\nwarning: lower case";
        let warnings = parse_odm_warnings(stderr);
        assert_eq!(warnings.len(), 2); // "WARNING: deprecated" and "warning: lower case"
    }
}
