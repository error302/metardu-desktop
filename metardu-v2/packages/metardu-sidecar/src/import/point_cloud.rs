//! Bounded, read-only inspection of LAS/LAZ headers and declared point records.
//!
//! Record inspection checks declared point and EVLR extents and, for chunked
//! LAZ, its chunk table. It does not prove whole-file conformance, interpret CRS
//! or vertical reference, store source bytes, or classify points. The renderer
//! never supplies a path: Electron main obtains it from the native file picker.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use las::{raw, Builder, Header, PointDataBuilder, Reader, Vlr};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::dispatcher::HandlerError;

const MAX_HEADER_METADATA_BYTES: u64 = 32 * 1024 * 1024;
const MAX_VLR_COUNT: u32 = 100_000;
const MAX_EVLR_COUNT: u32 = 100_000;
const EVLR_HEADER_BYTES: u64 = 60;
const MAX_LAZ_CHUNK_COUNT: u32 = 1_000_000;
const MAX_LAZ_CHUNK_TABLE_BYTES: usize = 32 * 1024 * 1024;
const MAX_RECORD_INSPECTION_JOBS: usize = 16;
const RECORD_INSPECTION_JOB_RETENTION: Duration = Duration::from_secs(30 * 60);
const MAX_ACTIVE_RECORD_INSPECTIONS: usize = 1;

#[derive(Clone)]
struct RecordInspectionJob {
    created_at: Instant,
    cancelled: Arc<AtomicBool>,
    state: Arc<Mutex<RecordInspectionJobState>>,
}

#[derive(Clone)]
enum RecordInspectionJobState {
    Running {
        decoded_point_count: u64,
        declared_point_count: u64,
    },
    Completed(Value),
    Cancelled,
    Failed,
}

static RECORD_INSPECTION_JOBS: OnceLock<Mutex<HashMap<String, RecordInspectionJob>>> =
    OnceLock::new();

fn record_inspection_jobs() -> &'static Mutex<HashMap<String, RecordInspectionJob>> {
    RECORD_INSPECTION_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Deserialize)]
struct InspectParams {
    path: String,
}

/// Inspect header metadata only. Point data is never read or decompressed.
pub async fn handle_point_cloud_header_inspection(params: Value) -> Result<Value, HandlerError> {
    let parsed: InspectParams = serde_json::from_value(params)
        .map_err(|error| HandlerError::InvalidParams(error.to_string()))?;
    let path = PathBuf::from(parsed.path);
    if !path.is_absolute() {
        return Err(HandlerError::InvalidParams(
            "Point-cloud source path must be absolute.".into(),
        ));
    }

    tokio::task::spawn_blocking(move || inspect_header(&path))
        .await
        .map_err(|error| {
            HandlerError::Internal(format!("Point-cloud inspection task failed: {error}"))
        })?
}

/// Decode the header-declared LAS/LAZ point range in bounded batches and report source evidence.
pub async fn handle_point_cloud_record_inspection(params: Value) -> Result<Value, HandlerError> {
    let parsed: InspectParams = serde_json::from_value(params)
        .map_err(|error| HandlerError::InvalidParams(error.to_string()))?;
    let path = PathBuf::from(parsed.path);
    if !path.is_absolute() {
        return Err(HandlerError::InvalidParams(
            "Point-cloud source path must be absolute.".into(),
        ));
    }

    tokio::task::spawn_blocking(move || {
        let never_cancel = AtomicBool::new(false);
        inspect_point_records_controlled(&path, &never_cancel, |_, _| {})
    })
    .await
    .map_err(|error| {
        HandlerError::Internal(format!(
            "Point-cloud record inspection task failed: {error}"
        ))
    })?
}

/// Start a project-scoped, cooperatively cancellable record scan. The host owns
/// the path and exposes only the opaque job ID and compact progress counters.
pub async fn handle_start_point_cloud_record_inspection(
    params: Value,
) -> Result<Value, HandlerError> {
    let parsed: InspectParams = serde_json::from_value(params)
        .map_err(|error| HandlerError::InvalidParams(error.to_string()))?;
    let path = PathBuf::from(parsed.path);
    if !path.is_absolute() {
        return Err(HandlerError::InvalidParams(
            "Point-cloud source path must be absolute.".into(),
        ));
    }

    let job_id = uuid::Uuid::new_v4().to_string();
    let job = RecordInspectionJob {
        created_at: Instant::now(),
        cancelled: Arc::new(AtomicBool::new(false)),
        state: Arc::new(Mutex::new(RecordInspectionJobState::Running {
            decoded_point_count: 0,
            declared_point_count: 0,
        })),
    };
    {
        let mut jobs = record_inspection_jobs()
            .lock()
            .map_err(|_| HandlerError::Internal("Inspection job store is unavailable.".into()))?;
        prune_record_inspection_jobs(&mut jobs);
        let active_count = jobs
            .values()
            .filter(|candidate| {
                candidate
                    .state
                    .lock()
                    .map(|state| matches!(&*state, RecordInspectionJobState::Running { .. }))
                    .unwrap_or(true)
            })
            .count();
        if active_count >= MAX_ACTIVE_RECORD_INSPECTIONS {
            return Err(HandlerError::InvalidParams(
                "A point-cloud record inspection is already running.".into(),
            ));
        }
        while jobs.len() >= MAX_RECORD_INSPECTION_JOBS {
            let oldest_terminal = jobs
                .iter()
                .filter(|(_, candidate)| {
                    candidate
                        .state
                        .lock()
                        .map(|state| !matches!(&*state, RecordInspectionJobState::Running { .. }))
                        .unwrap_or(false)
                })
                .min_by_key(|(_, candidate)| candidate.created_at)
                .map(|(id, _)| id.clone());
            let Some(oldest_terminal) = oldest_terminal else {
                return Err(HandlerError::InvalidParams(
                    "The bounded point-cloud inspection job store is full.".into(),
                ));
            };
            jobs.remove(&oldest_terminal);
        }
        jobs.insert(job_id.clone(), job.clone());
    }

    let worker_job = job.clone();
    tokio::spawn(async move {
        let worker_cancelled = worker_job.cancelled.clone();
        let worker_state = worker_job.state.clone();
        let result = tokio::task::spawn_blocking(move || {
            inspect_point_records_controlled(&path, &worker_cancelled, |decoded, declared| {
                if let Ok(mut state) = worker_state.lock() {
                    *state = RecordInspectionJobState::Running {
                        decoded_point_count: decoded,
                        declared_point_count: declared,
                    };
                }
            })
        })
        .await;

        let terminal_state = match result {
            Ok(Ok(_)) if worker_job.cancelled.load(Ordering::Acquire) => {
                RecordInspectionJobState::Cancelled
            }
            Ok(Ok(report)) => RecordInspectionJobState::Completed(report),
            Ok(Err(_)) if worker_job.cancelled.load(Ordering::Acquire) => {
                RecordInspectionJobState::Cancelled
            }
            Ok(Err(error)) => {
                tracing::warn!(error = %error, "Point-cloud record inspection job failed");
                RecordInspectionJobState::Failed
            }
            Err(error) => {
                tracing::warn!(error = %error, "Point-cloud record inspection task panicked");
                RecordInspectionJobState::Failed
            }
        };
        if let Ok(mut state) = worker_job.state.lock() {
            *state = terminal_state;
        }
    });

    Ok(json!({ "jobId": job_id, "status": "running" }))
}

/// Return compact progress or a compact terminal state for a sidecar-issued job.
pub async fn handle_point_cloud_record_inspection_status(
    params: Value,
) -> Result<Value, HandlerError> {
    let job_id = parse_record_inspection_job_id(&params)?;
    let job = get_record_inspection_job(&job_id)?;
    let state = job
        .state
        .lock()
        .map_err(|_| HandlerError::Internal("Inspection job state is unavailable.".into()))?
        .clone();
    Ok(match state {
        RecordInspectionJobState::Running {
            decoded_point_count,
            declared_point_count,
        } => json!({
            "jobId": job_id,
            "status": if job.cancelled.load(Ordering::Acquire) { "cancelling" } else { "running" },
            "decodedPointCount": decoded_point_count.to_string(),
            "declaredPointCount": declared_point_count.to_string(),
        }),
        RecordInspectionJobState::Completed(report) => json!({
            "jobId": job_id,
            "status": "completed",
            "report": report,
        }),
        RecordInspectionJobState::Cancelled => json!({ "jobId": job_id, "status": "cancelled" }),
        RecordInspectionJobState::Failed => json!({
            "jobId": job_id,
            "status": "failed",
            "message": "Point-cloud inspection failed. The source was not changed and no report was saved.",
        }),
    })
}

/// Request cooperative cancellation between bounded decode batches.
pub async fn handle_cancel_point_cloud_record_inspection(
    params: Value,
) -> Result<Value, HandlerError> {
    let job_id = parse_record_inspection_job_id(&params)?;
    let job = get_record_inspection_job(&job_id)?;
    let accepted = match job.state.lock() {
        Ok(state) if matches!(&*state, RecordInspectionJobState::Running { .. }) => {
            job.cancelled.store(true, Ordering::Release);
            true
        }
        Ok(_) => false,
        Err(_) => {
            return Err(HandlerError::Internal(
                "Inspection job state is unavailable.".into(),
            ))
        }
    };
    Ok(json!({ "jobId": job_id, "accepted": accepted }))
}

fn parse_record_inspection_job_id(params: &Value) -> Result<String, HandlerError> {
    let job_id = params
        .get("jobId")
        .and_then(Value::as_str)
        .ok_or_else(|| HandlerError::InvalidParams("Inspection job ID is required.".into()))?;
    let parsed = uuid::Uuid::parse_str(job_id)
        .map_err(|_| HandlerError::InvalidParams("Inspection job ID is invalid.".into()))?;
    Ok(parsed.to_string())
}

fn get_record_inspection_job(job_id: &str) -> Result<RecordInspectionJob, HandlerError> {
    let jobs = record_inspection_jobs()
        .lock()
        .map_err(|_| HandlerError::Internal("Inspection job store is unavailable.".into()))?;
    jobs.get(job_id)
        .cloned()
        .ok_or_else(|| HandlerError::InvalidParams("Inspection job is unknown or expired.".into()))
}

fn prune_record_inspection_jobs(jobs: &mut HashMap<String, RecordInspectionJob>) {
    jobs.retain(|_, job| {
        let is_running = job
            .state
            .lock()
            .map(|state| matches!(&*state, RecordInspectionJobState::Running { .. }))
            .unwrap_or(true);
        is_running || job.created_at.elapsed() < RECORD_INSPECTION_JOB_RETENTION
    });
}

fn inspect_header(path: &Path) -> Result<Value, HandlerError> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension != "las" && extension != "laz" {
        return Err(HandlerError::InvalidParams(
            "Only LAS and LAZ files can be inspected.".into(),
        ));
    }

    let metadata = std::fs::metadata(path).map_err(|error| {
        HandlerError::InvalidParams(format!("Cannot read selected source file: {error}"))
    })?;
    if !metadata.is_file() {
        return Err(HandlerError::InvalidParams(
            "Selected point-cloud source is not a regular file.".into(),
        ));
    }

    let raw_header = read_bounded_raw_header(path, metadata.len())?;
    let mut header =
        Header::new(File::open(path).map_err(internal_io_error)?).map_err(|error| {
            HandlerError::InvalidParams(format!("LAS/LAZ header could not be read: {error}"))
        })?;

    // las-rs 0.11.2 reads the first EVLR when constructing a Header. Parse the
    // remaining records too, after preflighting all record lengths, so CRS
    // records are not silently missed when a file has multiple EVLRs.
    if let Some(evlr_info) = raw_header.evlr {
        if evlr_info.number_of_evlrs > 1 {
            let mut file = File::open(path).map_err(internal_io_error)?;
            file.seek(SeekFrom::Start(evlr_info.start_of_first_evlr))
                .map_err(internal_io_error)?;
            let mut builder = Builder::from(header);
            builder.evlrs.clear();
            for _ in 0..evlr_info.number_of_evlrs {
                let record = raw::Vlr::read_from(&mut file, true).map_err(|error| {
                    HandlerError::InvalidParams(format!(
                        "LAS/LAZ extended metadata is malformed: {error}"
                    ))
                })?;
                builder.evlrs.push(Vlr::new(record));
            }
            header = builder.into_header().map_err(|error| {
                HandlerError::InvalidParams(format!("LAS/LAZ header is inconsistent: {error}"))
            })?;
        }
    }

    let point_format = header.point_format();
    let bounds = header.bounds();
    let transforms = header.transforms();
    let mut warnings = vec![
        "Header values are source-declared metadata only; point records and whole-file integrity were not checked.".to_string(),
        "CRS record presence is not CRS validation. Units, coordinate epoch, vertical reference, and project compatibility remain unresolved.".to_string(),
        "Inspection is read-only and temporary. The source has not been copied into or attached to a METARDU project.".to_string(),
    ];

    let has_wkt_crs = header.get_wkt_crs_bytes().is_some();
    let wkt_crs = header
        .get_wkt_crs_bytes()
        .and_then(|bytes| std::str::from_utf8(bytes).ok())
        .map(str::to_owned);
    if header.has_crs_vlrs() && !has_wkt_crs {
        match header.get_geotiff_crs() {
            Ok(Some(_)) => {}
            Ok(None) => warnings.push(
                "A CRS record is present, but its encoding could not be identified as WKT or GeoTIFF by the reader.".into(),
            ),
            Err(error) => warnings.push(format!("GeoTIFF CRS metadata could not be decoded: {error}")),
        }
    }
    if has_wkt_crs && wkt_crs.is_none() {
        warnings.push("WKT CRS bytes are present but are not valid UTF-8 text.".into());
    }
    if !header.has_crs_vlrs() {
        warnings.push(
            "No CRS variable-length record was found. Coordinates remain uninterpreted.".into(),
        );
    }
    if let Some(evlr_info) = raw_header.evlr {
        if evlr_info.number_of_evlrs > 0 && extension == "las" {
            warnings.push("The .las extension is paired with extended metadata records; verify the file naming and producer.".into());
        }
    }
    if extension == "laz" && !point_format.is_compressed {
        warnings.push("The .laz extension is paired with an uncompressed point format; verify the file naming and producer.".into());
    }

    let finite_or_null = |value: f64| value.is_finite().then_some(value);
    let bounds_json = json!({
        "min": {
            "x": finite_or_null(bounds.min.x),
            "y": finite_or_null(bounds.min.y),
            "z": finite_or_null(bounds.min.z),
        },
        "max": {
            "x": finite_or_null(bounds.max.x),
            "y": finite_or_null(bounds.max.y),
            "z": finite_or_null(bounds.max.z),
        },
    });
    if [
        bounds.min.x,
        bounds.min.y,
        bounds.min.z,
        bounds.max.x,
        bounds.max.y,
        bounds.max.z,
    ]
    .iter()
    .any(|value| !value.is_finite())
    {
        warnings.push(
            "One or more source-declared bounds are non-finite and are shown as unknown.".into(),
        );
    }

    let return_counts: Vec<Value> = (1_u8..=15)
        .map(|return_number| {
            json!({
                "returnNumber": return_number,
                "headerDeclaredPointCount": header.number_of_points_by_return(return_number).map(|value| value.to_string()),
            })
        })
        .collect();

    let point_format_id = point_format.to_u8().map_err(|error| {
        HandlerError::InvalidParams(format!("Unsupported LAS point format: {error}"))
    })?;

    Ok(json!({
        "format": if point_format.is_compressed { "LAZ" } else { "LAS" },
        "version": header.version().to_string(),
        "headerDeclaredPointCount": header.number_of_points().to_string(),
        "pointFormatId": point_format_id,
        "pointRecordAttributes": {
            "gpsTime": point_format.has_gps_time,
            "rgb": point_format.has_color,
            "nearInfrared": point_format.has_nir,
            "waveform": point_format.has_waveform,
            "extraBytes": point_format.extra_bytes,
        },
        "bounds": bounds_json,
        "coordinateScale": {
            "x": finite_or_null(transforms.x.scale),
            "y": finite_or_null(transforms.y.scale),
            "z": finite_or_null(transforms.z.scale),
        },
        "coordinateOffset": {
            "x": finite_or_null(transforms.x.offset),
            "y": finite_or_null(transforms.y.offset),
            "z": finite_or_null(transforms.z.offset),
        },
        "crsEvidence": {
            "hasAnyCrsRecord": header.has_crs_vlrs(),
            "hasWktCrs": has_wkt_crs,
            "wktCrs": wkt_crs,
            "geoTiffCrsDecoded": header.get_geotiff_crs().is_ok_and(|value| value.is_some()),
        },
        "headerDeclaredPointsByReturn": return_counts,
        "copcInfoRecordPresent": header.copc_info_vlr().is_some(),
        "warnings": warnings,
    }))
}

fn read_bounded_raw_header(path: &Path, file_size: u64) -> Result<raw::Header, HandlerError> {
    let mut file = File::open(path).map_err(internal_io_error)?;
    let header = raw::Header::read_from(&mut file).map_err(|error| {
        HandlerError::InvalidParams(format!("LAS/LAZ fixed header could not be read: {error}"))
    })?;

    if header.header_size < header.version.header_size() {
        return Err(HandlerError::InvalidParams(
            "LAS/LAZ header size is smaller than the declared version requires.".into(),
        ));
    }
    let header_end = u64::from(header.header_size);
    let point_data_offset = u64::from(header.offset_to_point_data);
    if point_data_offset < header_end || point_data_offset > file_size {
        return Err(HandlerError::InvalidParams(
            "LAS/LAZ point-data offset is inconsistent with the file size.".into(),
        ));
    }
    if point_data_offset - header_end > MAX_HEADER_METADATA_BYTES {
        return Err(HandlerError::InvalidParams(format!(
            "LAS/LAZ metadata before the points exceeds the {} MiB inspection limit.",
            MAX_HEADER_METADATA_BYTES / (1024 * 1024)
        )));
    }
    if header.number_of_variable_length_records > MAX_VLR_COUNT {
        return Err(HandlerError::InvalidParams(format!(
            "LAS/LAZ declares more than {MAX_VLR_COUNT} variable-length records."
        )));
    }

    if let Some(evlr) = header.evlr {
        if evlr.number_of_evlrs > MAX_EVLR_COUNT {
            return Err(HandlerError::InvalidParams(format!(
                "LAS/LAZ declares more than {MAX_EVLR_COUNT} extended variable-length records."
            )));
        }
        if evlr.number_of_evlrs > 0 {
            let mut next_record = evlr.start_of_first_evlr;
            let mut total_evlr_bytes = 0_u64;
            for _ in 0..evlr.number_of_evlrs {
                if next_record
                    .checked_add(EVLR_HEADER_BYTES)
                    .is_none_or(|end| end > file_size)
                {
                    return Err(HandlerError::InvalidParams(
                        "LAS/LAZ extended metadata header extends beyond the file.".into(),
                    ));
                }
                file.seek(SeekFrom::Start(next_record))
                    .map_err(internal_io_error)?;
                let mut record_header = [0_u8; EVLR_HEADER_BYTES as usize];
                file.read_exact(&mut record_header).map_err(|error| {
                    HandlerError::InvalidParams(format!(
                        "LAS/LAZ extended metadata header is truncated: {error}"
                    ))
                })?;
                let data_len = u64::from_le_bytes(
                    record_header[20..28]
                        .try_into()
                        .expect("fixed EVLR header slice"),
                );
                let record_len = EVLR_HEADER_BYTES.checked_add(data_len).ok_or_else(|| {
                    HandlerError::InvalidParams(
                        "LAS/LAZ extended metadata length overflows.".into(),
                    )
                })?;
                total_evlr_bytes = total_evlr_bytes.checked_add(record_len).ok_or_else(|| {
                    HandlerError::InvalidParams("LAS/LAZ extended metadata total overflows.".into())
                })?;
                if total_evlr_bytes > MAX_HEADER_METADATA_BYTES {
                    return Err(HandlerError::InvalidParams(format!(
                        "LAS/LAZ extended metadata exceeds the {} MiB inspection limit.",
                        MAX_HEADER_METADATA_BYTES / (1024 * 1024)
                    )));
                }
                next_record = next_record.checked_add(record_len).ok_or_else(|| {
                    HandlerError::InvalidParams(
                        "LAS/LAZ extended metadata offset overflows.".into(),
                    )
                })?;
                if next_record > file_size {
                    return Err(HandlerError::InvalidParams(
                        "LAS/LAZ extended metadata record extends beyond the file.".into(),
                    ));
                }
            }
        }
    }

    Ok(header)
}

fn internal_io_error(error: std::io::Error) -> HandlerError {
    HandlerError::Internal(format!("Point-cloud source I/O failed: {error}"))
}

fn point_cloud_structure(
    path: &Path,
    raw_header: &raw::Header,
    header: &Header,
    file_size: u64,
) -> Result<Value, HandlerError> {
    let point_start = u64::from(raw_header.offset_to_point_data);
    let evlr_extent = read_evlr_extent(path, raw_header, file_size)?;
    let boundary_before_evlrs = evlr_extent.map(|extent| extent.0).unwrap_or(file_size);

    if !header.point_format().is_compressed {
        let point_bytes = header
            .number_of_points()
            .checked_mul(u64::from(raw_header.point_data_record_length))
            .ok_or_else(|| {
                HandlerError::InvalidParams("LAS point-data extent overflows.".into())
            })?;
        let point_end = point_start.checked_add(point_bytes).ok_or_else(|| {
            HandlerError::InvalidParams("LAS point-data end offset overflows.".into())
        })?;
        if point_end > boundary_before_evlrs {
            return Err(HandlerError::InvalidParams(
                "LAS declared point records extend beyond the file or overlap the first EVLR."
                    .into(),
            ));
        }
        let evlr_start = evlr_extent.map(|extent| extent.0);
        let evlr_end = evlr_extent.map(|extent| extent.1);
        let tail_start = evlr_end.unwrap_or(point_end);
        let tail_bytes = file_size.saturating_sub(tail_start);
        let mut structure_warnings = Vec::new();
        if point_end < boundary_before_evlrs {
            structure_warnings.push("Bytes occur after the declared LAS point records and before the EVLR boundary (or end of file); waveform and application-specific payloads are not interpreted.".to_string());
        }
        if tail_bytes > 0 {
            structure_warnings.push(
                "Unclassified bytes remain after the declared EVLR sequence or known LAS point data."
                    .to_string(),
            );
        }
        return Ok(json!({
            "layoutStatus": "bounded",
            "validationScope": "uncompressed point-record extent and declared EVLR sequence only",
            "pointDataStartByte": point_start.to_string(),
            "pointDataEndByte": point_end.to_string(),
            "pointDataByteCount": point_bytes.to_string(),
            "chunkTableStartByte": null,
            "chunkTableEndByte": null,
            "chunkTablePointerStorage": "not_applicable",
            "firstEvlrStartByte": evlr_start.map(|value| value.to_string()),
            "evlrSequenceEndByte": evlr_end.map(|value| value.to_string()),
            "unclassifiedBytesBeforeEvlrs": evlr_start.map(|start| (start - point_end).to_string()),
            "unclassifiedBytesAfterKnownData": tail_bytes.to_string(),
            "warnings": structure_warnings,
        }));
    }

    let laz_vlr = header
        .vlrs()
        .iter()
        .find(|vlr| las::laz::is_laszip_vlr(vlr))
        .ok_or_else(|| {
            HandlerError::InvalidParams("Compressed point format has no LASzip VLR.".into())
        })?;
    let laz_vlr_data = &laz_vlr.data;
    if laz_vlr_data.len() < 32 {
        return Err(HandlerError::InvalidParams(
            "LASzip VLR is shorter than its required fields.".into(),
        ));
    }
    let compressor = u16::from_le_bytes([laz_vlr_data[0], laz_vlr_data[1]]);
    let special_evlr_count = i64::from_le_bytes(
        laz_vlr_data[16..24]
            .try_into()
            .expect("fixed LASzip VLR field slice"),
    );
    let special_evlr_offset = i64::from_le_bytes(
        laz_vlr_data[24..32]
            .try_into()
            .expect("fixed LASzip VLR field slice"),
    );
    let mut warnings = Vec::new();
    if (special_evlr_count, special_evlr_offset) != (-1, -1) {
        warnings.push(
            "LASzip special EVLR references are present; their layout is outside this inspection scope.".to_string(),
        );
    }

    // LAZ compressor 1 is pointwise and has no chunk table. The decoder can
    // still inspect its declared records, but this reader cannot establish the
    // compressed byte end without a chunk table.
    if compressor == 1 {
        warnings.push(
            "Pointwise LAZ has no chunk table; compressed-data end and trailing content were not structurally bounded.".to_string(),
        );
        return Ok(json!({
            "layoutStatus": "incomplete",
            "validationScope": "EVLR byte extents; pointwise compressed-data end is unknown",
            "pointDataStartByte": point_start.to_string(),
            "pointDataEndByte": null,
            "pointDataByteCount": null,
            "chunkTableStartByte": null,
            "chunkTableEndByte": null,
            "chunkTablePointerStorage": "not_applicable",
            "firstEvlrStartByte": evlr_extent.map(|extent| extent.0.to_string()),
            "evlrSequenceEndByte": evlr_extent.map(|extent| extent.1.to_string()),
            "unclassifiedBytesBeforeEvlrs": null,
            "unclassifiedBytesAfterKnownData": null,
            "warnings": warnings,
        }));
    }
    if compressor != 2 && compressor != 3 {
        return Err(HandlerError::InvalidParams(format!(
            "Unsupported LASzip compressor type {compressor}."
        )));
    }

    let laz_vlr = laz::LazVlr::read_from(laz_vlr_data.as_slice()).map_err(|error| {
        HandlerError::InvalidParams(format!("LASzip VLR could not be decoded: {error}"))
    })?;
    let pointer_end = point_start
        .checked_add(8)
        .ok_or_else(|| HandlerError::InvalidParams("LAZ chunk pointer offset overflows.".into()))?;
    if pointer_end > file_size {
        return Err(HandlerError::InvalidParams(
            "LAZ chunk-table pointer extends beyond the file.".into(),
        ));
    }

    let mut file = File::open(path).map_err(internal_io_error)?;
    file.seek(SeekFrom::Start(point_start))
        .map_err(internal_io_error)?;
    let mut pointer_bytes = [0_u8; 8];
    file.read_exact(&mut pointer_bytes).map_err(|error| {
        HandlerError::InvalidParams(format!("LAZ chunk-table pointer is truncated: {error}"))
    })?;
    let point_data_pointer = i64::from_le_bytes(pointer_bytes);
    let (chunk_table_start, pointer_storage) = if point_data_pointer == -1 {
        if file_size < 8 {
            return Err(HandlerError::InvalidParams(
                "LAZ EOF chunk-table pointer is missing.".into(),
            ));
        }
        file.seek(SeekFrom::End(-8)).map_err(internal_io_error)?;
        file.read_exact(&mut pointer_bytes)
            .map_err(internal_io_error)?;
        let eof_pointer = i64::from_le_bytes(pointer_bytes);
        let table_start = u64::try_from(eof_pointer).map_err(|_| {
            HandlerError::InvalidParams("LAZ EOF chunk-table pointer is negative.".into())
        })?;
        (table_start, "end_of_file")
    } else {
        let table_start = u64::try_from(point_data_pointer).map_err(|_| {
            HandlerError::InvalidParams("LAZ chunk-table pointer is negative.".into())
        })?;
        (table_start, "point_data")
    };
    if chunk_table_start < pointer_end || chunk_table_start >= file_size {
        return Err(HandlerError::InvalidParams(
            "LAZ chunk-table offset is outside the compressed point-data extent.".into(),
        ));
    }

    let table_region_end = if pointer_storage == "end_of_file" {
        file_size.saturating_sub(8).min(boundary_before_evlrs)
    } else {
        boundary_before_evlrs
    };
    if chunk_table_start >= table_region_end {
        return Err(HandlerError::InvalidParams(
            "LAZ chunk table starts outside the point-data/metadata boundary.".into(),
        ));
    }
    let available_table_bytes = table_region_end - chunk_table_start;
    let table_read_len = available_table_bytes.min(MAX_LAZ_CHUNK_TABLE_BYTES as u64) as usize;
    let mut table_bytes = vec![0_u8; table_read_len];
    file.seek(SeekFrom::Start(chunk_table_start))
        .map_err(internal_io_error)?;
    file.read_exact(&mut table_bytes).map_err(|error| {
        HandlerError::InvalidParams(format!("LAZ chunk table could not be read: {error}"))
    })?;
    if table_bytes.len() < 8 {
        return Err(HandlerError::InvalidParams(
            "LAZ chunk table header is truncated.".into(),
        ));
    }
    let table_header = &table_bytes[..8];
    let table_version = u32::from_le_bytes(table_header[..4].try_into().unwrap());
    let chunk_count = u32::from_le_bytes(table_header[4..].try_into().unwrap());
    if table_version != 0 {
        return Err(HandlerError::InvalidParams(format!(
            "Unsupported LAZ chunk-table version {table_version}."
        )));
    }
    if chunk_count > MAX_LAZ_CHUNK_COUNT {
        return Err(HandlerError::InvalidParams(format!(
            "LAZ chunk table exceeds the {MAX_LAZ_CHUNK_COUNT}-chunk inspection limit."
        )));
    }
    let mut table_cursor = Cursor::new(table_bytes);
    let declared_points = header.number_of_points();
    if laz_vlr.uses_variable_size_chunks() {
        if u64::from(chunk_count) > declared_points
            || (declared_points == 0 && chunk_count != 0)
            || (declared_points > 0 && chunk_count == 0)
        {
            return Err(HandlerError::InvalidParams(
                "LAZ chunk count is inconsistent with the header-declared point count.".into(),
            ));
        }
    } else {
        let chunk_size = u64::from(laz_vlr.chunk_size());
        if chunk_size == 0 {
            return Err(HandlerError::InvalidParams(
                "LAZ chunk size is zero.".into(),
            ));
        }
        let expected_chunks = declared_points.div_ceil(chunk_size);
        if expected_chunks != u64::from(chunk_count) {
            return Err(HandlerError::InvalidParams(
                "LAZ fixed-size chunk count is inconsistent with the declared points and chunk size.".into(),
            ));
        }
    }

    table_cursor
        .seek(SeekFrom::Start(0))
        .map_err(internal_io_error)?;
    let chunk_table =
        laz::laszip::ChunkTable::read(&mut table_cursor, laz_vlr.uses_variable_size_chunks())
            .map_err(|error| {
                HandlerError::InvalidParams(format!(
                    "LAZ chunk table could not be decoded: {error}"
                ))
            })?;
    if chunk_table.len() != chunk_count as usize {
        return Err(HandlerError::InvalidParams(
            "Decoded LAZ chunk count differs from the chunk-table header.".into(),
        ));
    }
    let table_end = chunk_table_start
        .checked_add(table_cursor.position())
        .ok_or_else(|| HandlerError::InvalidParams("LAZ chunk-table end overflows.".into()))?;
    let mut compressed_bytes = 0_u64;
    let mut chunk_points = 0_u64;
    for entry in &chunk_table {
        compressed_bytes = compressed_bytes
            .checked_add(entry.byte_count)
            .ok_or_else(|| HandlerError::InvalidParams("LAZ chunk byte total overflows.".into()))?;
        if laz_vlr.uses_variable_size_chunks() {
            chunk_points = chunk_points.checked_add(entry.point_count).ok_or_else(|| {
                HandlerError::InvalidParams("LAZ chunk point total overflows.".into())
            })?;
        }
        if entry.byte_count == 0 && entry.point_count > 0 {
            return Err(HandlerError::InvalidParams(
                "LAZ chunk contains points but declares no compressed bytes.".into(),
            ));
        }
    }
    if laz_vlr.uses_variable_size_chunks() && chunk_points != declared_points {
        return Err(HandlerError::InvalidParams(
            "LAZ chunk point totals differ from the header-declared point count.".into(),
        ));
    }
    if declared_points > 0 && compressed_bytes == 0 {
        return Err(HandlerError::InvalidParams(
            "LAZ declares points but its chunk table contains no compressed bytes.".into(),
        ));
    }
    let compressed_start = pointer_end;
    let compressed_end = compressed_start
        .checked_add(compressed_bytes)
        .ok_or_else(|| HandlerError::InvalidParams("LAZ point-data end overflows.".into()))?;
    if compressed_end != chunk_table_start {
        return Err(HandlerError::InvalidParams(
            "LAZ chunks do not end exactly at the declared chunk-table offset.".into(),
        ));
    }
    if table_end > boundary_before_evlrs {
        return Err(HandlerError::InvalidParams(
            "LAZ chunk table overlaps the first EVLR or extends beyond the file.".into(),
        ));
    }
    if (special_evlr_count, special_evlr_offset) != (-1, -1) {
        return Ok(json!({
            "layoutStatus": "incomplete",
            "validationScope": "chunk sequence, chunk table, and ordinary EVLR boundaries; LASzip special EVLR references are not validated",
            "pointDataStartByte": point_start.to_string(),
            "pointDataEndByte": compressed_end.to_string(),
            "pointDataByteCount": (compressed_end - point_start).to_string(),
            "chunkTableStartByte": chunk_table_start.to_string(),
            "chunkTableEndByte": table_end.to_string(),
            "chunkTablePointerStorage": pointer_storage,
            "firstEvlrStartByte": evlr_extent.map(|extent| extent.0.to_string()),
            "evlrSequenceEndByte": evlr_extent.map(|extent| extent.1.to_string()),
            "unclassifiedBytesBeforeEvlrs": evlr_extent.map(|extent| (extent.0 - table_end).to_string()),
            "unclassifiedBytesAfterKnownData": null,
            "warnings": warnings,
        }));
    }

    let evlr_start = evlr_extent.map(|extent| extent.0);
    let evlr_end = evlr_extent.map(|extent| extent.1);
    let tail_start = evlr_end.unwrap_or(table_end);
    let recognized_eof_pointer_bytes = if pointer_storage == "end_of_file" {
        8
    } else {
        0
    };
    if file_size.saturating_sub(tail_start) < recognized_eof_pointer_bytes {
        return Err(HandlerError::InvalidParams(
            "LAZ EOF chunk-table pointer overlaps the EVLR sequence.".into(),
        ));
    }
    if table_end < table_region_end {
        warnings.push(
            "Bytes occur between the LAZ chunk table and EVLR boundary (or end of file); their record types are not interpreted.".into(),
        );
    }
    let unclassified_tail_bytes = file_size
        .saturating_sub(tail_start)
        .saturating_sub(recognized_eof_pointer_bytes);
    if unclassified_tail_bytes > 0 {
        warnings.push(
            "Unclassified bytes remain after the declared EVLR sequence (or known LAZ data)."
                .into(),
        );
    }
    Ok(json!({
        "layoutStatus": "bounded",
        "validationScope": "chunked LAZ point-data extent, chunk-table entries, and declared EVLR sequence only",
        "pointDataStartByte": point_start.to_string(),
        "pointDataEndByte": compressed_end.to_string(),
        "pointDataByteCount": (compressed_end - point_start).to_string(),
        "chunkTableStartByte": chunk_table_start.to_string(),
        "chunkTableEndByte": table_end.to_string(),
        "chunkTablePointerStorage": pointer_storage,
        "firstEvlrStartByte": evlr_start.map(|value| value.to_string()),
        "evlrSequenceEndByte": evlr_end.map(|value| value.to_string()),
        "unclassifiedBytesBeforeEvlrs": evlr_start.map(|start| (start - table_end).to_string()),
        "unclassifiedBytesAfterKnownData": unclassified_tail_bytes.to_string(),
        "warnings": warnings,
    }))
}

fn read_evlr_extent(
    path: &Path,
    raw_header: &raw::Header,
    file_size: u64,
) -> Result<Option<(u64, u64)>, HandlerError> {
    let Some(evlr) = raw_header.evlr else {
        return Ok(None);
    };
    if evlr.number_of_evlrs == 0 {
        return Ok(None);
    }
    let mut file = File::open(path).map_err(internal_io_error)?;
    let start = evlr.start_of_first_evlr;
    let mut next_record = start;
    for _ in 0..evlr.number_of_evlrs {
        if next_record
            .checked_add(EVLR_HEADER_BYTES)
            .is_none_or(|end| end > file_size)
        {
            return Err(HandlerError::InvalidParams(
                "EVLR sequence extends beyond the file.".into(),
            ));
        }
        file.seek(SeekFrom::Start(next_record))
            .map_err(internal_io_error)?;
        let mut record_header = [0_u8; EVLR_HEADER_BYTES as usize];
        file.read_exact(&mut record_header).map_err(|error| {
            HandlerError::InvalidParams(format!("EVLR header is truncated: {error}"))
        })?;
        let data_len = u64::from_le_bytes(record_header[20..28].try_into().unwrap());
        next_record = next_record
            .checked_add(EVLR_HEADER_BYTES)
            .and_then(|offset| offset.checked_add(data_len))
            .ok_or_else(|| HandlerError::InvalidParams("EVLR sequence end overflows.".into()))?;
        if next_record > file_size {
            return Err(HandlerError::InvalidParams(
                "EVLR payload extends beyond the file.".into(),
            ));
        }
    }
    Ok(Some((start, next_record)))
}

const MAX_POINT_BATCH_BYTES: usize = 16 * 1024 * 1024;
const MAX_POINT_BATCH_COUNT: usize = 65_536;

fn inspect_point_records(path: &Path) -> Result<Value, HandlerError> {
    let never_cancel = AtomicBool::new(false);
    inspect_point_records_controlled(path, &never_cancel, |_, _| {})
}

fn inspect_point_records_controlled(
    path: &Path,
    cancelled: &AtomicBool,
    mut report_progress: impl FnMut(u64, u64),
) -> Result<Value, HandlerError> {
    if cancelled.load(Ordering::Acquire) {
        return Err(HandlerError::Internal("Inspection cancelled.".into()));
    }
    // Keep the existing header preflight as the single bounded gate for VLR/EVLR metadata.
    let _header_evidence = inspect_header(path)?;
    let metadata = std::fs::metadata(path).map_err(internal_io_error)?;
    let raw_header = read_bounded_raw_header(path, metadata.len())?;
    let structure_header =
        Header::new(File::open(path).map_err(internal_io_error)?).map_err(|error| {
            HandlerError::InvalidParams(format!("LAS/LAZ header could not be read: {error}"))
        })?;
    let file_structure =
        point_cloud_structure(path, &raw_header, &structure_header, metadata.len())?;
    let mut reader = Reader::from_path(path).map_err(|error| {
        HandlerError::InvalidParams(format!("LAS/LAZ point reader could not be opened: {error}"))
    })?;

    let header = reader.header();
    let declared_point_count = header.number_of_points();
    report_progress(0, declared_point_count);
    let point_format_id = header.point_format().to_u8().map_err(|error| {
        HandlerError::InvalidParams(format!("Unsupported LAS point format: {error}"))
    })?;
    let format = if header.point_format().is_compressed {
        "LAZ"
    } else {
        "LAS"
    };
    let version = header.version().to_string();
    let record_length = PointDataBuilder::new()
        .for_header(header)
        .build()
        .record_len();
    if record_length == 0 {
        return Err(HandlerError::InvalidParams(
            "LAS/LAZ point record length is zero.".into(),
        ));
    }
    let batch_count = (MAX_POINT_BATCH_BYTES / record_length)
        .max(1)
        .min(MAX_POINT_BATCH_COUNT) as u64;
    let mut points = PointDataBuilder::new().for_header(reader.header()).build();

    let mut decoded_point_count = 0_u64;
    let mut class_counts = [0_u64; 256];
    let mut return_counts = [0_u64; 16];
    let mut number_of_returns_counts = [0_u64; 16];
    let mut invalid_return_metadata_count = 0_u64;
    let mut non_finite_coordinate_count = 0_u64;
    let mut minimum = [f64::INFINITY; 3];
    let mut maximum = [f64::NEG_INFINITY; 3];

    loop {
        if cancelled.load(Ordering::Acquire) {
            return Err(HandlerError::Internal("Inspection cancelled.".into()));
        }
        let count = reader
            .fill_points(batch_count, &mut points)
            .map_err(|error| {
                HandlerError::InvalidParams(format!(
                    "LAS/LAZ point decoding failed after {decoded_point_count} records: {error}"
                ))
            })?;
        if count == 0 {
            break;
        }
        decoded_point_count = decoded_point_count.checked_add(count).ok_or_else(|| {
            HandlerError::Internal("Decoded point count overflowed its 64-bit range.".into())
        })?;

        for class_code in points.classification() {
            checked_increment(&mut class_counts[class_code as usize], "classification")?;
        }
        for return_number in points.return_number() {
            checked_increment(&mut return_counts[return_number as usize], "return number")?;
        }
        for number_of_returns in points.number_of_returns() {
            checked_increment(
                &mut number_of_returns_counts[number_of_returns as usize],
                "number of returns",
            )?;
        }
        for (return_number, number_of_returns) in
            points.return_number().zip(points.number_of_returns())
        {
            if return_number == 0 || number_of_returns == 0 || return_number > number_of_returns {
                checked_increment(
                    &mut invalid_return_metadata_count,
                    "invalid return metadata",
                )?;
            }
        }

        for ((x, y), z) in points.x().zip(points.y()).zip(points.z()) {
            if !x.is_finite() || !y.is_finite() || !z.is_finite() {
                checked_increment(&mut non_finite_coordinate_count, "non-finite coordinate")?;
                continue;
            }
            minimum[0] = minimum[0].min(x);
            minimum[1] = minimum[1].min(y);
            minimum[2] = minimum[2].min(z);
            maximum[0] = maximum[0].max(x);
            maximum[1] = maximum[1].max(y);
            maximum[2] = maximum[2].max(z);
        }
        report_progress(decoded_point_count, declared_point_count);
    }

    let class_total = class_counts.iter().try_fold(0_u64, |sum, count| {
        sum.checked_add(*count)
            .ok_or_else(|| HandlerError::Internal("Class count total overflowed.".into()))
    })?;
    if class_total != decoded_point_count {
        return Err(HandlerError::Internal(format!(
            "Point reader returned {decoded_point_count} records but class columns contain {class_total}."
        )));
    }

    let header_count_matches = decoded_point_count == declared_point_count;
    let header = reader.header();
    let header_bounds = header.bounds();
    let has_finite_bounds = decoded_point_count > non_finite_coordinate_count;
    let decoded_bounds = if has_finite_bounds {
        json!({
            "min": { "x": finite_json(minimum[0]), "y": finite_json(minimum[1]), "z": finite_json(minimum[2]) },
            "max": { "x": finite_json(maximum[0]), "y": finite_json(maximum[1]), "z": finite_json(maximum[2]) },
        })
    } else {
        json!({
            "min": { "x": null, "y": null, "z": null },
            "max": { "x": null, "y": null, "z": null },
        })
    };
    let bounds_within_header = if has_finite_bounds
        && [
            header_bounds.min.x,
            header_bounds.min.y,
            header_bounds.min.z,
            header_bounds.max.x,
            header_bounds.max.y,
            header_bounds.max.z,
        ]
        .iter()
        .all(|value| value.is_finite())
    {
        Some(
            minimum[0] >= header_bounds.min.x
                && minimum[1] >= header_bounds.min.y
                && minimum[2] >= header_bounds.min.z
                && maximum[0] <= header_bounds.max.x
                && maximum[1] <= header_bounds.max.y
                && maximum[2] <= header_bounds.max.z,
        )
    } else {
        None
    };

    let classification_counts: Vec<Value> = class_counts
        .iter()
        .enumerate()
        .filter(|(_, count)| **count > 0)
        .map(|(code, count)| {
            json!({
                "code": code,
                "count": count.to_string(),
            })
        })
        .collect();
    let return_count_comparison: Vec<Value> = (1_u8..=15)
        .map(|return_number| {
            let declared = header.number_of_points_by_return(return_number);
            let decoded = return_counts[return_number as usize];
            json!({
                "returnNumber": return_number,
                "headerDeclaredCount": declared.map(|count| count.to_string()),
                "decodedCount": decoded.to_string(),
                "matchesHeader": declared.map(|count| count == decoded),
            })
        })
        .collect();
    let returns_match_header = return_count_comparison
        .iter()
        .all(|entry| entry["matchesHeader"].as_bool().unwrap_or(true));
    let decoded_return_counts: Vec<Value> = (0_u8..=15)
        .filter(|return_number| return_counts[*return_number as usize] > 0)
        .map(|return_number| {
            json!({
                "returnNumber": return_number,
                "count": return_counts[return_number as usize].to_string(),
            })
        })
        .collect();
    let decoded_number_of_returns_counts: Vec<Value> = (0_u8..=15)
        .filter(|count| number_of_returns_counts[*count as usize] > 0)
        .map(|count| {
            json!({
                "numberOfReturns": count,
                "count": number_of_returns_counts[count as usize].to_string(),
            })
        })
        .collect();

    let mut warnings = vec![
        "This scan decodes the point range declared by the LAS/LAZ header. The byte-layout report checks declared point and EVLR boundaries and, for chunked LAZ, chunk-table entries; it does not prove whole-file format conformance.".to_string(),
        "Coordinates are decoded with the source header scale and offset only. CRS, units, epoch, vertical reference, and project compatibility remain unresolved.".to_string(),
        "Classification counts are labels already stored in the source; no classification algorithm was run.".to_string(),
    ];
    if let Some(structure_warnings) = file_structure["warnings"].as_array() {
        warnings.extend(
            structure_warnings
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned),
        );
    }
    if !header_count_matches {
        warnings.push(format!(
            "Decoded point count ({decoded_point_count}) differs from the header-declared count ({declared_point_count})."
        ));
    }
    if !returns_match_header {
        warnings.push(
            "One or more decoded return-number counts differ from the header-declared per-return counts.".into(),
        );
    }
    if invalid_return_metadata_count > 0 {
        warnings.push(format!(
            "{invalid_return_metadata_count} decoded point records have zero or inconsistent return metadata."
        ));
    }
    if non_finite_coordinate_count > 0 {
        warnings.push(format!(
            "{non_finite_coordinate_count} decoded point records have non-finite coordinates and were excluded from the reported bounds."
        ));
    }
    if bounds_within_header == Some(false) {
        warnings.push(
            "One or more decoded coordinates fall outside the header-declared bounds.".into(),
        );
    }
    if !header.point_format().is_extended && class_counts[12] > 0 {
        warnings.push(
            "Legacy point formats may use class code 12 for overlap points; the code is reported as stored and is not reinterpreted.".into(),
        );
    }

    Ok(json!({
        "format": format,
        "version": version,
        "pointFormatId": point_format_id,
        "readerVersion": "las-rs 0.11.2",
        "headerDeclaredPointCount": declared_point_count.to_string(),
        "decodedPointCount": decoded_point_count.to_string(),
        "headerCountMatchesDecoded": header_count_matches,
        "classificationCounts": classification_counts,
        "returnCounts": decoded_return_counts,
        "numberOfReturnsCounts": decoded_number_of_returns_counts,
        "headerReturnCountComparison": return_count_comparison,
        "returnCountsMatchHeader": returns_match_header,
        "invalidReturnMetadataPointCount": invalid_return_metadata_count.to_string(),
        "nonFiniteCoordinatePointCount": non_finite_coordinate_count.to_string(),
        "decodedBounds": decoded_bounds,
        "headerBoundsContainDecodedPoints": bounds_within_header,
        "fileStructure": file_structure,
        "coordinateInterpretation": "source coordinates after LAS scale/offset; CRS, units, epoch, and vertical reference not interpreted",
        "warnings": warnings,
    }))
}

fn checked_increment(count: &mut u64, label: &str) -> Result<(), HandlerError> {
    *count = count.checked_add(1).ok_or_else(|| {
        HandlerError::Internal(format!(
            "Point-cloud {label} count overflowed its 64-bit range."
        ))
    })?;
    Ok(())
}

fn finite_json(value: f64) -> Value {
    if value.is_finite() {
        json!(value)
    } else {
        Value::Null
    }
}

#[cfg(test)]
mod tests {
    use std::fs::File;
    use std::io::Write;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    use las::{Builder, Point, Vlr, Writer};
    use serde_json::json;
    use tempfile::tempdir;

    use super::{
        handle_cancel_point_cloud_record_inspection, handle_point_cloud_record_inspection_status,
        handle_start_point_cloud_record_inspection, inspect_header, inspect_point_records,
        inspect_point_records_controlled, read_bounded_raw_header, record_inspection_jobs,
        RecordInspectionJob, RecordInspectionJobState,
    };
    use crate::dispatcher::HandlerError;

    fn write_fixture(path: &std::path::Path, with_evlrs: bool) {
        let mut builder = Builder::from((1, 4));
        builder.point_format = las::point::Format::new(3).unwrap();
        builder.transforms.x.scale = 0.01;
        builder.transforms.y.scale = 0.02;
        builder.transforms.z.scale = 0.005;
        builder.transforms.x.offset = 500_000.0;
        builder.transforms.y.offset = 6_000_000.0;
        builder.transforms.z.offset = 100.0;
        if with_evlrs {
            builder.evlrs.push(Vlr {
                user_id: "example".into(),
                record_id: 1,
                description: "one".into(),
                data: vec![1, 2, 3],
            });
            // Put CRS evidence only in the second EVLR to prove inspection
            // handles every record rather than only the first EVLR.
            builder.evlrs.push(Vlr {
                user_id: "LASF_Projection".into(),
                record_id: 2112,
                description: "OGC WKT".into(),
                data: b"PROJCRS[\"Example projected CRS\"]".to_vec(),
            });
        } else {
            builder.vlrs.push(Vlr {
                user_id: "LASF_Projection".into(),
                record_id: 2112,
                description: "OGC WKT".into(),
                data: b"PROJCRS[\"Example projected CRS\"]".to_vec(),
            });
        }
        let header = builder.into_header().unwrap();
        let mut writer = Writer::from_path(path, header).unwrap();
        writer
            .write_point(Point {
                x: 500_001.25,
                y: 6_000_002.5,
                z: 101.0,
                return_number: 1,
                number_of_returns: 2,
                classification: las::point::Classification::Ground,
                gps_time: Some(1.0),
                color: Some(las::Color::new(100, 200, 300)),
                ..Default::default()
            })
            .unwrap();
        writer
            .write_point(Point {
                x: 500_003.75,
                y: 6_000_005.0,
                z: 102.0,
                return_number: 2,
                number_of_returns: 2,
                classification: las::point::Classification::Building,
                gps_time: Some(2.0),
                color: Some(las::Color::new(400, 500, 600)),
                ..Default::default()
            })
            .unwrap();
    }

    #[test]
    fn inspects_real_las_header_without_claiming_point_validation() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("survey.las");
        write_fixture(&path, false);

        let before = std::fs::read(&path).unwrap();
        let result = inspect_header(&path).unwrap();
        let after = std::fs::read(&path).unwrap();

        assert_eq!(before, after, "inspection must not modify the source file");
        assert_eq!(result["format"], "LAS");
        assert_eq!(result["version"], "1.4");
        assert_eq!(result["headerDeclaredPointCount"], "2");
        assert_eq!(result["pointFormatId"], 3);
        assert_eq!(result["pointRecordAttributes"]["gpsTime"], true);
        assert_eq!(result["pointRecordAttributes"]["rgb"], true);
        assert_eq!(result["coordinateScale"]["x"], 0.01);
        assert_eq!(result["coordinateOffset"]["y"], 6_000_000.0);
        assert_eq!(result["bounds"]["min"]["x"], 500_001.25);
        assert_eq!(result["bounds"]["max"]["z"], 102.0);
        assert_eq!(result["crsEvidence"]["hasWktCrs"], true);
        assert!(result["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| {
                warning
                    .as_str()
                    .unwrap()
                    .contains("whole-file integrity were not checked")
            }));
    }

    #[test]
    fn inspects_laz_point_format_and_all_evlrs_under_metadata_budget() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("survey.laz");
        write_fixture(&path, true);

        let result = inspect_header(&path).unwrap();
        assert_eq!(result["format"], "LAZ");
        assert_eq!(result["headerDeclaredPointCount"], "2");
        assert_eq!(result["crsEvidence"]["hasWktCrs"], true);

        let mut file = File::open(&path).unwrap();
        let raw = las::raw::Header::read_from(&mut file).unwrap();
        let evlr_count = raw.evlr.unwrap().number_of_evlrs;
        assert_eq!(evlr_count, 2);
    }

    #[test]
    fn scans_las_records_and_reports_classes_returns_and_decoded_bounds() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("survey.las");
        write_fixture(&path, false);
        let before = std::fs::read(&path).unwrap();

        let result = inspect_point_records(&path).unwrap();

        assert_eq!(
            std::fs::read(&path).unwrap(),
            before,
            "inspection must not modify the source file"
        );
        assert_eq!(result["format"], "LAS");
        assert_eq!(result["version"], "1.4");
        assert_eq!(result["headerDeclaredPointCount"], "2");
        assert_eq!(result["decodedPointCount"], "2");
        assert_eq!(result["headerCountMatchesDecoded"], true);
        assert_eq!(result["classificationCounts"][0]["code"], 2);
        assert_eq!(result["classificationCounts"][0]["count"], "1");
        assert_eq!(result["classificationCounts"][1]["code"], 6);
        assert_eq!(result["classificationCounts"][1]["count"], "1");
        assert_eq!(
            result["headerReturnCountComparison"][0]["decodedCount"],
            "1"
        );
        assert_eq!(
            result["headerReturnCountComparison"][1]["decodedCount"],
            "1"
        );
        assert_eq!(result["returnCountsMatchHeader"], true);
        assert_eq!(result["decodedBounds"]["min"]["x"], 500_001.25);
        assert_eq!(result["decodedBounds"]["max"]["z"], 102.0);
        assert_eq!(result["headerBoundsContainDecodedPoints"], true);
        assert_eq!(result["invalidReturnMetadataPointCount"], "0");
        assert_eq!(result["nonFiniteCoordinatePointCount"], "0");
        assert_eq!(result["fileStructure"]["layoutStatus"], "bounded");
        assert_eq!(result["fileStructure"]["pointDataByteCount"], "68");
        assert_eq!(
            result["fileStructure"]["unclassifiedBytesAfterKnownData"],
            "0"
        );
    }

    #[test]
    fn cooperative_cancellation_stops_before_a_report_is_completed() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("cancelled-scan.las");
        write_fixture(&path, false);
        let cancelled = AtomicBool::new(false);
        let mut progress = Vec::new();

        let error = inspect_point_records_controlled(&path, &cancelled, |decoded, declared| {
            progress.push((decoded, declared));
            if decoded > 0 {
                cancelled.store(true, Ordering::Release);
            }
        })
        .unwrap_err();

        assert!(error.to_string().contains("cancelled"));
        assert_eq!(progress.first(), Some(&(0, 2)));
        assert_eq!(progress.last(), Some(&(2, 2)));
    }

    #[tokio::test]
    async fn background_inspection_job_reports_completion_and_rejects_late_cancel() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("job-scan.las");
        write_fixture(&path, false);

        let start = handle_start_point_cloud_record_inspection(json!({
            "path": path.to_string_lossy().to_string()
        }))
        .await
        .unwrap();
        let job_id = start["jobId"].as_str().unwrap().to_owned();

        let report = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let state = handle_point_cloud_record_inspection_status(
                    json!({ "jobId": job_id.as_str() }),
                )
                .await
                .unwrap();
                match state["status"].as_str() {
                    Some("completed") => break state["report"].clone(),
                    Some("failed") => panic!("inspection job failed: {state}"),
                    Some("cancelled") => panic!("inspection job was unexpectedly cancelled"),
                    Some("running" | "cancelling") => {
                        tokio::time::sleep(Duration::from_millis(5)).await
                    }
                    value => panic!("unexpected inspection job status: {value:?}"),
                }
            }
        })
        .await
        .expect("job should reach a terminal state");

        assert_eq!(report["decodedPointCount"], "2");
        let late_cancel =
            handle_cancel_point_cloud_record_inspection(json!({ "jobId": job_id.as_str() }))
                .await
                .unwrap();
        assert_eq!(late_cancel["accepted"], false);

        let active_job_id = uuid::Uuid::new_v4().to_string();
        let active_job = RecordInspectionJob {
            created_at: std::time::Instant::now(),
            cancelled: std::sync::Arc::new(AtomicBool::new(false)),
            state: std::sync::Arc::new(std::sync::Mutex::new(RecordInspectionJobState::Running {
                decoded_point_count: 1,
                declared_point_count: 2,
            })),
        };
        record_inspection_jobs()
            .lock()
            .unwrap()
            .insert(active_job_id.clone(), active_job.clone());
        let duplicate_start = handle_start_point_cloud_record_inspection(json!({
            "path": path.to_string_lossy().to_string()
        }))
        .await
        .unwrap_err();
        assert!(duplicate_start.to_string().contains("already running"));
        assert!(handle_point_cloud_record_inspection_status(json!({
            "jobId": "../../outside.las"
        }))
        .await
        .is_err());
        let cancellation = handle_cancel_point_cloud_record_inspection(json!({
            "jobId": active_job_id.as_str()
        }))
        .await
        .unwrap();
        assert_eq!(cancellation["accepted"], true);
        assert!(active_job.cancelled.load(Ordering::Acquire));
        let cancelling = handle_point_cloud_record_inspection_status(json!({
            "jobId": active_job_id.as_str()
        }))
        .await
        .unwrap();
        assert_eq!(cancelling["status"], "cancelling");
        record_inspection_jobs()
            .lock()
            .unwrap()
            .remove(&active_job_id);
    }

    #[test]
    fn scans_compressed_laz_records_and_reports_their_existing_class_labels() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("survey.laz");
        write_fixture(&path, true);

        let result = inspect_point_records(&path).unwrap();

        assert_eq!(result["format"], "LAZ");
        assert_eq!(result["decodedPointCount"], "2");
        assert_eq!(result["classificationCounts"][0]["code"], 2);
        assert_eq!(result["classificationCounts"][1]["code"], 6);
        assert_eq!(result["returnCountsMatchHeader"], true);
        assert_eq!(result["headerBoundsContainDecodedPoints"], true);
        assert_eq!(result["fileStructure"]["layoutStatus"], "bounded");
        assert_eq!(
            result["fileStructure"]["pointDataEndByte"],
            result["fileStructure"]["chunkTableStartByte"]
        );
        assert_eq!(
            result["fileStructure"]["firstEvlrStartByte"],
            result["fileStructure"]["chunkTableEndByte"]
        );
        assert_eq!(
            result["fileStructure"]["unclassifiedBytesAfterKnownData"],
            "0"
        );
    }

    #[test]
    fn rejects_truncated_las_point_extent_before_record_decoding() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("truncated.las");
        write_fixture(&path, false);
        let raw_header = las::raw::Header::read_from(File::open(&path).unwrap()).unwrap();
        let one_point_end = u64::from(raw_header.offset_to_point_data)
            + u64::from(raw_header.point_data_record_length);
        std::fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(one_point_end)
            .unwrap();

        let error = inspect_point_records(&path).unwrap_err().to_string();
        assert!(
            error.contains("declared point records extend beyond the file"),
            "{error}"
        );
    }

    #[test]
    fn reports_unclassified_las_tail_bytes_without_calling_them_point_records() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("tail.las");
        write_fixture(&path, false);
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        file.write_all(b"TAIL").unwrap();

        let result = inspect_point_records(&path).unwrap();

        assert_eq!(result["decodedPointCount"], "2");
        assert_eq!(result["fileStructure"]["layoutStatus"], "bounded");
        assert_eq!(
            result["fileStructure"]["unclassifiedBytesAfterKnownData"],
            "4"
        );
        assert!(result["fileStructure"]["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| warning
                .as_str()
                .unwrap()
                .contains("Bytes occur after the declared LAS point records")));
    }

    #[test]
    fn rejects_laz_chunk_tables_over_the_bounded_entry_limit_before_reader_open() {
        use std::io::{Read, Seek, SeekFrom};

        let temp = tempdir().unwrap();
        let path = temp.path().join("too_many_chunks.laz");
        write_fixture(&path, false);
        let raw = las::raw::Header::read_from(File::open(&path).unwrap()).unwrap();
        let mut file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .unwrap();
        file.seek(SeekFrom::Start(u64::from(raw.offset_to_point_data)))
            .unwrap();
        let mut pointer = [0_u8; 8];
        file.read_exact(&mut pointer).unwrap();
        let table_start = u64::from_le_bytes(pointer);
        file.seek(SeekFrom::Start(table_start + 4)).unwrap();
        file.write_all(&u32::MAX.to_le_bytes()).unwrap();

        let error = inspect_point_records(&path).unwrap_err().to_string();
        assert!(error.contains("inspection limit"), "{error}");
    }

    #[test]
    fn rejects_unknown_extensions_and_oversized_header_metadata() {
        let temp = tempdir().unwrap();
        let csv = temp.path().join("points.csv");
        File::create(&csv).unwrap().write_all(b"not LAS").unwrap();
        assert!(matches!(
            inspect_header(&csv),
            Err(HandlerError::InvalidParams(_))
        ));

        let mut header = las::raw::Header::default();
        header.offset_to_point_data = (header.header_size as u32) + (32 * 1024 * 1024) + 1;
        let oversized = temp.path().join("oversized.las");
        let mut file = File::create(&oversized).unwrap();
        header.write_to(&mut file).unwrap();
        file.set_len(u64::from(header.offset_to_point_data))
            .unwrap();
        assert!(matches!(
            read_bounded_raw_header(&oversized, std::fs::metadata(&oversized).unwrap().len()),
            Err(HandlerError::InvalidParams(_))
        ));
    }

    #[tokio::test]
    async fn handler_rejects_relative_paths_before_opening_files() {
        let error = super::handle_point_cloud_header_inspection(json!({ "path": "points.las" }))
            .await
            .unwrap_err();
        assert!(matches!(error, HandlerError::InvalidParams(_)));
    }
}
