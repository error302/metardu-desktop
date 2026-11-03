//! Bounded, read-only inspection of LAS/LAZ headers and declared point records.
//!
//! Record inspection checks the declared VLR sequence, point and EVLR extents,
//! and, for chunked LAZ, its chunk table. It does not prove whole-file
//! conformance, interpret CRS or vertical reference, store source bytes, or
//! classify points. The renderer never supplies a path: Electron main obtains
//! it from the native file picker.

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
const VLR_HEADER_BYTES: u64 = 54;
const EVLR_HEADER_BYTES: u64 = 60;
const MAX_LAZ_CHUNK_COUNT: u32 = 1_000_000;
const MAX_LAZ_CHUNK_TABLE_BYTES: usize = 32 * 1024 * 1024;
const MAX_RECORD_INSPECTION_JOBS: usize = 16;
const RECORD_INSPECTION_JOB_RETENTION: Duration = Duration::from_secs(30 * 60);
const MAX_ACTIVE_RECORD_INSPECTIONS: usize = 1;
const MAX_POINT_CHUNK_STREAMS: usize = 8;
const POINT_CHUNK_STREAM_RETENTION: Duration = Duration::from_secs(30 * 60);
const MAX_ACTIVE_POINT_CHUNK_STREAMS: usize = 1;
const MAX_POINT_CHUNK_POINTS: u64 = 2_048;

struct BoundedRawHeader {
    raw: raw::Header,
    vlr_extent: VlrExtent,
}

#[derive(Clone, Copy)]
struct VlrExtent {
    start: u64,
    end: u64,
    count: u32,
    unclassified_bytes_before_points: u64,
    gap_is_all_zero: Option<bool>,
}

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

#[derive(Clone)]
struct PointCloudChunkStreamJob {
    created_at: Instant,
    cancelled: Arc<AtomicBool>,
    read_pending: Arc<AtomicBool>,
    commands: tokio::sync::mpsc::UnboundedSender<PointCloudChunkStreamCommand>,
    state: Arc<Mutex<PointCloudChunkStreamState>>,
}

struct PointCloudChunkReadPendingGuard(Arc<AtomicBool>);

impl Drop for PointCloudChunkReadPendingGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

enum PointCloudChunkStreamCommand {
    Read(tokio::sync::oneshot::Sender<Result<Value, String>>),
    Cancel,
}

#[derive(Clone)]
enum PointCloudChunkStreamState {
    Opening,
    Running {
        decoded_point_count: u64,
        declared_point_count: u64,
    },
    Cancelling {
        decoded_point_count: u64,
        declared_point_count: u64,
    },
    Completed {
        decoded_point_count: u64,
        declared_point_count: u64,
    },
    Cancelled,
    Failed(String),
}

static POINT_CLOUD_CHUNK_STREAM_JOBS: OnceLock<Mutex<HashMap<String, PointCloudChunkStreamJob>>> =
    OnceLock::new();

fn point_cloud_chunk_stream_jobs() -> &'static Mutex<HashMap<String, PointCloudChunkStreamJob>> {
    POINT_CLOUD_CHUNK_STREAM_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
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

/// Open a bounded sequential point stream for trusted host processing. The
/// Electron main process supplies the private managed path; the renderer does
/// not call this method directly.
pub async fn handle_start_point_cloud_chunk_stream(params: Value) -> Result<Value, HandlerError> {
    let parsed: InspectParams = serde_json::from_value(params)
        .map_err(|error| HandlerError::InvalidParams(error.to_string()))?;
    let path = PathBuf::from(parsed.path);
    if !path.is_absolute() {
        return Err(HandlerError::InvalidParams(
            "Point-cloud source path must be absolute.".into(),
        ));
    }

    let stream_id = uuid::Uuid::new_v4().to_string();
    let (command_tx, command_rx) = tokio::sync::mpsc::unbounded_channel();
    let job = PointCloudChunkStreamJob {
        created_at: Instant::now(),
        cancelled: Arc::new(AtomicBool::new(false)),
        read_pending: Arc::new(AtomicBool::new(false)),
        commands: command_tx,
        state: Arc::new(Mutex::new(PointCloudChunkStreamState::Opening)),
    };
    {
        let mut jobs = point_cloud_chunk_stream_jobs().lock().map_err(|_| {
            HandlerError::Internal("Point-cloud chunk stream store is unavailable.".into())
        })?;
        prune_point_cloud_chunk_stream_jobs(&mut jobs);
        let active_count = jobs
            .values()
            .filter(|candidate| {
                candidate
                    .state
                    .lock()
                    .map(|state| {
                        matches!(
                            &*state,
                            PointCloudChunkStreamState::Opening
                                | PointCloudChunkStreamState::Running { .. }
                                | PointCloudChunkStreamState::Cancelling { .. }
                        )
                    })
                    .unwrap_or(true)
            })
            .count();
        if active_count >= MAX_ACTIVE_POINT_CHUNK_STREAMS {
            return Err(HandlerError::InvalidParams(
                "A point-cloud chunk stream is already running.".into(),
            ));
        }
        while jobs.len() >= MAX_POINT_CHUNK_STREAMS {
            let oldest_terminal = jobs
                .iter()
                .filter(|(_, candidate)| {
                    candidate
                        .state
                        .lock()
                        .map(|state| {
                            matches!(
                                &*state,
                                PointCloudChunkStreamState::Completed { .. }
                                    | PointCloudChunkStreamState::Cancelled
                                    | PointCloudChunkStreamState::Failed(_)
                            )
                        })
                        .unwrap_or(false)
                })
                .min_by_key(|(_, candidate)| candidate.created_at)
                .map(|(id, _)| id.clone());
            let Some(oldest_terminal) = oldest_terminal else {
                return Err(HandlerError::InvalidParams(
                    "The bounded point-cloud chunk stream store is full.".into(),
                ));
            };
            jobs.remove(&oldest_terminal);
        }
        jobs.insert(stream_id.clone(), job.clone());
    }

    let worker_cancelled = job.cancelled.clone();
    let worker_state = job.state.clone();
    let (opened_tx, opened_rx) = tokio::sync::oneshot::channel();
    tokio::task::spawn_blocking(move || {
        run_point_cloud_chunk_stream(path, worker_cancelled, worker_state, command_rx, opened_tx)
    });

    match opened_rx.await {
        Ok(Ok(metadata)) => {
            schedule_point_cloud_chunk_stream_expiration(job.clone());
            Ok(json!({
                "streamId": stream_id,
                "status": "running",
                "metadata": metadata,
            }))
        }
        Ok(Err(message)) => {
            if let Ok(mut jobs) = point_cloud_chunk_stream_jobs().lock() {
                jobs.remove(&stream_id);
            }
            Err(HandlerError::InvalidParams(message))
        }
        Err(_) => {
            if let Ok(mut jobs) = point_cloud_chunk_stream_jobs().lock() {
                jobs.remove(&stream_id);
            }
            Err(HandlerError::Internal(
                "Point-cloud chunk stream could not be initialized.".into(),
            ))
        }
    }
}

/// Read one source-order chunk. The sidecar retains the reader between calls.
pub async fn handle_read_point_cloud_chunk(params: Value) -> Result<Value, HandlerError> {
    let stream_id = parse_point_cloud_chunk_stream_id(&params)?;
    let job = get_point_cloud_chunk_stream_job(&stream_id)?;
    let state = job
        .state
        .lock()
        .map_err(|_| {
            HandlerError::Internal("Point-cloud chunk stream state is unavailable.".into())
        })?
        .clone();
    if let Some(terminal) = point_cloud_chunk_stream_terminal_value(&state) {
        return Ok(terminal);
    }
    if job.cancelled.load(Ordering::Acquire) {
        return Ok(json!({ "status": "cancelling" }));
    }
    if job
        .read_pending
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(HandlerError::InvalidParams(
            "A point-cloud chunk read is already pending for this stream.".into(),
        ));
    }
    let _pending_read = PointCloudChunkReadPendingGuard(job.read_pending.clone());

    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
    if job
        .commands
        .send(PointCloudChunkStreamCommand::Read(reply_tx))
        .is_err()
    {
        return Err(HandlerError::Internal(
            "Point-cloud chunk stream is no longer available.".into(),
        ));
    }
    let reply = reply_rx.await;
    match reply {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(message)) => Err(HandlerError::InvalidParams(message)),
        Err(_) => Err(HandlerError::Internal(
            "Point-cloud chunk stream stopped before returning a chunk.".into(),
        )),
    }
}

/// Return counters and terminal state without transferring point records.
pub async fn handle_point_cloud_chunk_stream_status(params: Value) -> Result<Value, HandlerError> {
    let stream_id = parse_point_cloud_chunk_stream_id(&params)?;
    let job = get_point_cloud_chunk_stream_job(&stream_id)?;
    let state = job
        .state
        .lock()
        .map_err(|_| {
            HandlerError::Internal("Point-cloud chunk stream state is unavailable.".into())
        })?
        .clone();
    if let Some(terminal) = point_cloud_chunk_stream_terminal_value(&state) {
        return Ok(terminal);
    }
    Ok(match state {
        PointCloudChunkStreamState::Opening => json!({ "status": "opening" }),
        PointCloudChunkStreamState::Running {
            decoded_point_count,
            declared_point_count,
        } => json!({
            "status": "running",
            "decodedPointCount": decoded_point_count.to_string(),
            "declaredPointCount": declared_point_count.to_string(),
        }),
        PointCloudChunkStreamState::Cancelling {
            decoded_point_count,
            declared_point_count,
        } => json!({
            "status": "cancelling",
            "decodedPointCount": decoded_point_count.to_string(),
            "declaredPointCount": declared_point_count.to_string(),
        }),
        _ => unreachable!("terminal states return before this match"),
    })
}

/// Stop a stream between bounded point reads and discard any queued request.
pub async fn handle_cancel_point_cloud_chunk_stream(params: Value) -> Result<Value, HandlerError> {
    let stream_id = parse_point_cloud_chunk_stream_id(&params)?;
    let job = get_point_cloud_chunk_stream_job(&stream_id)?;
    let mut state = job.state.lock().map_err(|_| {
        HandlerError::Internal("Point-cloud chunk stream state is unavailable.".into())
    })?;
    match &*state {
        PointCloudChunkStreamState::Completed { .. }
        | PointCloudChunkStreamState::Cancelled
        | PointCloudChunkStreamState::Failed(_) => return Ok(json!({ "accepted": false })),
        PointCloudChunkStreamState::Cancelling { .. } => return Ok(json!({ "accepted": true })),
        PointCloudChunkStreamState::Opening | PointCloudChunkStreamState::Running { .. } => {}
    }
    job.cancelled.store(true, Ordering::Release);
    if let PointCloudChunkStreamState::Running {
        decoded_point_count,
        declared_point_count,
    } = &*state
    {
        *state = PointCloudChunkStreamState::Cancelling {
            decoded_point_count: *decoded_point_count,
            declared_point_count: *declared_point_count,
        };
    }
    job.commands
        .send(PointCloudChunkStreamCommand::Cancel)
        .map_err(|_| {
            HandlerError::Internal("Point-cloud chunk stream is no longer available.".into())
        })?;
    Ok(json!({ "accepted": true }))
}

fn parse_point_cloud_chunk_stream_id(params: &Value) -> Result<String, HandlerError> {
    let stream_id = params
        .get("streamId")
        .and_then(Value::as_str)
        .ok_or_else(|| HandlerError::InvalidParams("Point-cloud stream ID is required.".into()))?;
    let parsed = uuid::Uuid::parse_str(stream_id)
        .map_err(|_| HandlerError::InvalidParams("Point-cloud stream ID is invalid.".into()))?;
    Ok(parsed.to_string())
}

fn get_point_cloud_chunk_stream_job(
    stream_id: &str,
) -> Result<PointCloudChunkStreamJob, HandlerError> {
    point_cloud_chunk_stream_jobs()
        .lock()
        .map_err(|_| {
            HandlerError::Internal("Point-cloud chunk stream store is unavailable.".into())
        })?
        .get(stream_id)
        .cloned()
        .ok_or_else(|| {
            HandlerError::InvalidParams("Point-cloud chunk stream is unknown or expired.".into())
        })
}

fn prune_point_cloud_chunk_stream_jobs(jobs: &mut HashMap<String, PointCloudChunkStreamJob>) {
    let now = Instant::now();
    jobs.retain(|_, job| {
        if now.duration_since(job.created_at) < POINT_CHUNK_STREAM_RETENTION {
            return true;
        }
        let Ok(state) = job.state.lock() else {
            return false;
        };
        let active = matches!(
            &*state,
            PointCloudChunkStreamState::Opening
                | PointCloudChunkStreamState::Running { .. }
                | PointCloudChunkStreamState::Cancelling { .. }
        );
        drop(state);
        if active && !job.cancelled.swap(true, Ordering::AcqRel) {
            let _ = job.commands.send(PointCloudChunkStreamCommand::Cancel);
        }
        active
    });
}

fn schedule_point_cloud_chunk_stream_expiration(job: PointCloudChunkStreamJob) {
    tokio::spawn(async move {
        tokio::time::sleep(POINT_CHUNK_STREAM_RETENTION).await;
        let should_cancel = if let Ok(mut state) = job.state.lock() {
            match &*state {
                PointCloudChunkStreamState::Opening => true,
                PointCloudChunkStreamState::Running {
                    decoded_point_count,
                    declared_point_count,
                } => {
                    *state = PointCloudChunkStreamState::Cancelling {
                        decoded_point_count: *decoded_point_count,
                        declared_point_count: *declared_point_count,
                    };
                    true
                }
                PointCloudChunkStreamState::Cancelling { .. } => true,
                PointCloudChunkStreamState::Completed { .. }
                | PointCloudChunkStreamState::Cancelled
                | PointCloudChunkStreamState::Failed(_) => false,
            }
        } else {
            false
        };
        if should_cancel && !job.cancelled.swap(true, Ordering::AcqRel) {
            let _ = job.commands.send(PointCloudChunkStreamCommand::Cancel);
        }
    });
}

fn point_cloud_chunk_stream_terminal_value(state: &PointCloudChunkStreamState) -> Option<Value> {
    match state {
        PointCloudChunkStreamState::Completed {
            decoded_point_count,
            declared_point_count,
        } => Some(json!({
            "status": "completed",
            "decodedPointCount": decoded_point_count.to_string(),
            "declaredPointCount": declared_point_count.to_string(),
        })),
        PointCloudChunkStreamState::Cancelled => Some(json!({ "status": "cancelled" })),
        PointCloudChunkStreamState::Failed(message) => Some(json!({
            "status": "failed",
            "message": message,
        })),
        PointCloudChunkStreamState::Opening
        | PointCloudChunkStreamState::Running { .. }
        | PointCloudChunkStreamState::Cancelling { .. } => None,
    }
}

fn run_point_cloud_chunk_stream(
    path: PathBuf,
    cancelled: Arc<AtomicBool>,
    state: Arc<Mutex<PointCloudChunkStreamState>>,
    mut commands: tokio::sync::mpsc::UnboundedReceiver<PointCloudChunkStreamCommand>,
    opened: tokio::sync::oneshot::Sender<Result<Value, String>>,
) {
    let open_result = (|| -> Result<_, String> {
        inspect_header(&path).map_err(|error| error.to_string())?;
        let reader = Reader::from_path(&path)
            .map_err(|error| format!("LAS/LAZ point reader could not be opened: {error}"))?;
        let header = reader.header();
        let declared_point_count = header.number_of_points();
        let point_format_id = header
            .point_format()
            .to_u8()
            .map_err(|error| format!("Unsupported LAS point format: {error}"))?;
        let version = header.version().to_string();
        let has_extra_bytes = header
            .vlrs()
            .iter()
            .chain(header.evlrs().iter())
            .any(|vlr| vlr.user_id == "LASF_Spec" && vlr.record_id == 4);
        let has_waveform_data = matches!(point_format_id, 4 | 5 | 9 | 10);
        let point_data = PointDataBuilder::new().for_header(header).build();
        let gps_time_present = point_data.gps_time().is_some();
        let rgb_present = point_data.rgb().is_some();
        let nir_present = point_data.nir().is_some();
        let metadata = json!({
            "format": if header.point_format().is_compressed { "LAZ" } else { "LAS" },
            "version": version,
            "pointFormatId": point_format_id,
            "declaredPointCount": declared_point_count.to_string(),
            "maxPointsPerChunk": MAX_POINT_CHUNK_POINTS,
            "coordinateInterpretation": "LAS scale and offset applied to X/Y/Z; CRS, units, epoch and vertical reference are not interpreted.",
            "supportedDimensions": [
                "pointIndex", "x", "y", "z", "intensity", "classification",
                "returnNumber", "numberOfReturns", "scanAngleDegrees", "userData",
                "pointSourceId", "gpsTime", "rgb", "nir"
            ],
            "optionalDimensionsPresent": {
                "gpsTime": gps_time_present,
                "rgb": rgb_present,
                "nir": nir_present,
                "extraBytes": has_extra_bytes,
                "waveformPackets": has_waveform_data
            },
            "omittedDimensions": ["LAS point-format flags", "Extra Bytes payload values", "waveform packet data"],
        });
        Ok((reader, declared_point_count, metadata))
    })();

    let (mut reader, declared_point_count, metadata) = match open_result {
        Ok(value) => value,
        Err(message) => {
            if let Ok(mut state) = state.lock() {
                *state = PointCloudChunkStreamState::Failed(message.clone());
            }
            let _ = opened.send(Err(message));
            return;
        }
    };

    if let Ok(mut state) = state.lock() {
        *state = PointCloudChunkStreamState::Running {
            decoded_point_count: 0,
            declared_point_count,
        };
    }
    if opened.send(Ok(metadata)).is_err() {
        cancelled.store(true, Ordering::Release);
        if let Ok(mut state) = state.lock() {
            *state = PointCloudChunkStreamState::Cancelled;
        }
        return;
    }

    let mut points = PointDataBuilder::new().for_header(reader.header()).build();
    let mut decoded_point_count = 0_u64;
    let mut chunk_index = 0_u64;
    loop {
        let Some(command) = commands.blocking_recv() else {
            cancelled.store(true, Ordering::Release);
            if let Ok(mut state) = state.lock() {
                *state = PointCloudChunkStreamState::Cancelled;
            }
            return;
        };
        match command {
            PointCloudChunkStreamCommand::Cancel => {
                cancelled.store(true, Ordering::Release);
                if let Ok(mut state) = state.lock() {
                    *state = PointCloudChunkStreamState::Cancelled;
                }
                return;
            }
            PointCloudChunkStreamCommand::Read(reply) => {
                if cancelled.load(Ordering::Acquire) {
                    if let Ok(mut state) = state.lock() {
                        *state = PointCloudChunkStreamState::Cancelled;
                    }
                    let _ = reply.send(Ok(json!({ "status": "cancelled" })));
                    return;
                }

                let count = match reader.fill_points(MAX_POINT_CHUNK_POINTS, &mut points) {
                    Ok(count) => count,
                    Err(error) => {
                        let message = format!("LAS/LAZ point decoding failed: {error}");
                        if let Ok(mut state) = state.lock() {
                            *state = PointCloudChunkStreamState::Failed(message.clone());
                        }
                        let _ = reply.send(Ok(json!({ "status": "failed", "message": message })));
                        return;
                    }
                };
                if count == 0 {
                    if decoded_point_count != declared_point_count {
                        let message = format!(
                            "Decoded {decoded_point_count} points but the source header declares {declared_point_count}."
                        );
                        if let Ok(mut state) = state.lock() {
                            *state = PointCloudChunkStreamState::Failed(message.clone());
                        }
                        let _ = reply.send(Ok(json!({ "status": "failed", "message": message })));
                        return;
                    }
                    if let Ok(mut state) = state.lock() {
                        *state = PointCloudChunkStreamState::Completed {
                            decoded_point_count,
                            declared_point_count,
                        };
                    }
                    let _ = reply.send(Ok(json!({
                        "status": "completed",
                        "decodedPointCount": decoded_point_count.to_string(),
                        "declaredPointCount": declared_point_count.to_string(),
                    })));
                    return;
                }
                let Some(next_count) = decoded_point_count.checked_add(count) else {
                    let message = "Decoded point count overflowed its 64-bit range.".to_string();
                    if let Ok(mut state) = state.lock() {
                        *state = PointCloudChunkStreamState::Failed(message.clone());
                    }
                    let _ = reply.send(Ok(json!({ "status": "failed", "message": message })));
                    return;
                };
                if next_count > declared_point_count {
                    let message =
                        "The LAS/LAZ reader decoded beyond the source header-declared point count."
                            .to_string();
                    if let Ok(mut state) = state.lock() {
                        *state = PointCloudChunkStreamState::Failed(message.clone());
                    }
                    let _ = reply.send(Ok(json!({ "status": "failed", "message": message })));
                    return;
                }
                if count > MAX_POINT_CHUNK_POINTS {
                    let message = "The LAS/LAZ reader returned a chunk larger than the configured point limit.".to_string();
                    if let Ok(mut state) = state.lock() {
                        *state = PointCloudChunkStreamState::Failed(message.clone());
                    }
                    let _ = reply.send(Ok(json!({ "status": "failed", "message": message })));
                    return;
                }
                if cancelled.load(Ordering::Acquire) {
                    if let Ok(mut state) = state.lock() {
                        *state = PointCloudChunkStreamState::Cancelled;
                    }
                    let _ = reply.send(Ok(json!({ "status": "cancelled" })));
                    return;
                }

                let first_point_index = decoded_point_count;
                let points_value =
                    match point_cloud_chunk_points_value(&points, first_point_index, count) {
                        Ok(value) => value,
                        Err(message) => {
                            if let Ok(mut state) = state.lock() {
                                *state = PointCloudChunkStreamState::Failed(message.clone());
                            }
                            let _ =
                                reply.send(Ok(json!({ "status": "failed", "message": message })));
                            return;
                        }
                    };
                decoded_point_count = next_count;
                if let Ok(mut state) = state.lock() {
                    *state = PointCloudChunkStreamState::Running {
                        decoded_point_count,
                        declared_point_count,
                    };
                }
                let value = json!({
                    "status": "chunk",
                    "chunkIndex": chunk_index.to_string(),
                    "firstPointIndex": first_point_index.to_string(),
                    "decodedPointCount": decoded_point_count.to_string(),
                    "declaredPointCount": declared_point_count.to_string(),
                    "points": points_value,
                });
                chunk_index = chunk_index.saturating_add(1);
                if reply.send(Ok(value)).is_err() {
                    cancelled.store(true, Ordering::Release);
                    if let Ok(mut state) = state.lock() {
                        *state = PointCloudChunkStreamState::Cancelled;
                    }
                    return;
                }
            }
        }
    }
}

fn point_cloud_chunk_points_value(
    points: &las::PointData,
    first_point_index: u64,
    count: u64,
) -> Result<Value, String> {
    let xs: Vec<f64> = points.x().collect();
    let ys: Vec<f64> = points.y().collect();
    let zs: Vec<f64> = points.z().collect();
    let intensities: Vec<u16> = points.intensity().collect();
    let classifications: Vec<u8> = points.classification().collect();
    let return_numbers: Vec<u8> = points.return_number().collect();
    let number_of_returns: Vec<u8> = points.number_of_returns().collect();
    let scan_angles: Vec<f32> = points.scan_angle_degrees().collect();
    let user_data: Vec<u8> = points.user_data().collect();
    let point_source_ids: Vec<u16> = points.point_source_id().collect();
    let gps_times: Option<Vec<f64>> = points.gps_time().map(Iterator::collect);
    let colors: Option<Vec<(u16, u16, u16)>> = points.rgb().map(Iterator::collect);
    let nir_values: Option<Vec<u16>> = points.nir().map(Iterator::collect);
    let expected =
        usize::try_from(count).map_err(|_| "Point chunk count is too large.".to_string())?;
    let lengths = [
        xs.len(),
        ys.len(),
        zs.len(),
        intensities.len(),
        classifications.len(),
        return_numbers.len(),
        number_of_returns.len(),
        scan_angles.len(),
        user_data.len(),
        point_source_ids.len(),
    ];
    if lengths.iter().any(|length| *length != expected)
        || gps_times
            .as_ref()
            .is_some_and(|values| values.len() != expected)
        || colors
            .as_ref()
            .is_some_and(|values| values.len() != expected)
        || nir_values
            .as_ref()
            .is_some_and(|values| values.len() != expected)
    {
        return Err("The LAS/LAZ reader returned inconsistent point dimension lengths.".into());
    }
    let mut result = Vec::with_capacity(expected);
    for offset in 0..expected {
        let point_index = first_point_index
            .checked_add(offset as u64)
            .ok_or_else(|| "Point index overflowed its 64-bit range.".to_string())?;
        let gps_time = gps_times
            .as_ref()
            .and_then(|values| values.get(offset))
            .copied()
            .filter(|value| value.is_finite());
        let color = colors.as_ref().and_then(|values| values.get(offset));
        let nir = nir_values.as_ref().and_then(|values| values.get(offset));
        result.push(json!({
            "pointIndex": point_index.to_string(),
            "x": finite_json(xs[offset]),
            "y": finite_json(ys[offset]),
            "z": finite_json(zs[offset]),
            "intensity": intensities[offset],
            "classification": classifications[offset],
            "returnNumber": return_numbers[offset],
            "numberOfReturns": number_of_returns[offset],
            "scanAngleDegrees": scan_angles[offset],
            "userData": user_data[offset],
            "pointSourceId": point_source_ids[offset],
            "gpsTime": gps_time,
            "rgb": color.map(|(red, green, blue)| json!({ "red": red, "green": green, "blue": blue })),
            "nir": nir,
        }));
    }
    Ok(Value::Array(result))
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

    let bounded_header = read_bounded_raw_header(path, metadata.len())?;
    let raw_header = &bounded_header.raw;
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

fn read_bounded_raw_header(path: &Path, file_size: u64) -> Result<BoundedRawHeader, HandlerError> {
    let mut file = File::open(path).map_err(internal_io_error)?;
    let header = raw::Header::read_from(&mut file).map_err(|error| {
        HandlerError::InvalidParams(format!("LAS/LAZ fixed header could not be read: {error}"))
    })?;

    // las-rs 0.11.2 models LAS 1.0 through 1.4. Its generic header-size
    // calculation treats future minor versions as 1.4, so reject them before
    // any 1.4 offsets or fields can be interpreted as authoritative.
    if header.version.major != 1 || header.version.minor > 4 {
        return Err(HandlerError::InvalidParams(format!(
            "LAS/LAZ version {} is not supported by this reader; supported versions are 1.0 through 1.4.",
            header.version,
        )));
    }

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
    let vlr_extent = read_vlr_extent(path, &header, file_size)?;

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

    Ok(BoundedRawHeader {
        raw: header,
        vlr_extent,
    })
}

fn read_vlr_extent(
    path: &Path,
    raw_header: &raw::Header,
    file_size: u64,
) -> Result<VlrExtent, HandlerError> {
    let start = u64::from(raw_header.header_size);
    let point_data_start = u64::from(raw_header.offset_to_point_data);
    let mut next_record = start;
    let mut file = File::open(path).map_err(internal_io_error)?;

    for _ in 0..raw_header.number_of_variable_length_records {
        let record_header_end = next_record
            .checked_add(VLR_HEADER_BYTES)
            .ok_or_else(|| HandlerError::InvalidParams("VLR header offset overflows.".into()))?;
        if record_header_end > point_data_start || record_header_end > file_size {
            return Err(HandlerError::InvalidParams(
                "LAS/LAZ declared VLR header extends beyond the point-data offset or file size."
                    .into(),
            ));
        }

        file.seek(SeekFrom::Start(next_record))
            .map_err(internal_io_error)?;
        let mut record_header = [0_u8; VLR_HEADER_BYTES as usize];
        file.read_exact(&mut record_header).map_err(|error| {
            HandlerError::InvalidParams(format!("LAS/LAZ VLR header is truncated: {error}"))
        })?;
        let data_len = u64::from(u16::from_le_bytes([record_header[20], record_header[21]]));
        next_record = record_header_end
            .checked_add(data_len)
            .ok_or_else(|| HandlerError::InvalidParams("VLR payload offset overflows.".into()))?;
        if next_record > point_data_start || next_record > file_size {
            return Err(HandlerError::InvalidParams(
                "LAS/LAZ declared VLR payload extends beyond the point-data offset or file size."
                    .into(),
            ));
        }
    }

    let unclassified_bytes_before_points = point_data_start - next_record;
    let gap_is_all_zero = if unclassified_bytes_before_points == 0 {
        None
    } else {
        Some(read_gap_is_all_zero(
            &mut file,
            next_record,
            unclassified_bytes_before_points,
        )?)
    };

    Ok(VlrExtent {
        start,
        end: next_record,
        count: raw_header.number_of_variable_length_records,
        unclassified_bytes_before_points,
        gap_is_all_zero,
    })
}

fn read_gap_is_all_zero(
    file: &mut File,
    start: u64,
    byte_count: u64,
) -> Result<bool, HandlerError> {
    const BUFFER_BYTES: usize = 8 * 1024;

    file.seek(SeekFrom::Start(start))
        .map_err(internal_io_error)?;
    let mut remaining = byte_count;
    let mut buffer = [0_u8; BUFFER_BYTES];
    while remaining > 0 {
        let chunk_len = remaining.min(BUFFER_BYTES as u64) as usize;
        file.read_exact(&mut buffer[..chunk_len]).map_err(|error| {
            HandlerError::InvalidParams(format!(
                "LAS/LAZ bytes between the VLR sequence and point data are truncated: {error}"
            ))
        })?;
        if buffer[..chunk_len].iter().any(|byte| *byte != 0) {
            return Ok(false);
        }
        remaining -= chunk_len as u64;
    }
    Ok(true)
}

fn internal_io_error(error: std::io::Error) -> HandlerError {
    HandlerError::Internal(format!("Point-cloud source I/O failed: {error}"))
}

fn point_cloud_structure(
    path: &Path,
    raw_header: &raw::Header,
    header: &Header,
    vlr_extent: VlrExtent,
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
        add_vlr_gap_warning(&mut structure_warnings, &vlr_extent);
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
            "validationScope": "declared VLR sequence, uncompressed point-record extent, and declared EVLR sequence only",
            "variableLengthRecords": vlr_extent_json(&vlr_extent),
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

    let mut laz_vlrs = header
        .vlrs()
        .iter()
        .filter(|vlr| las::laz::is_laszip_vlr(vlr));
    let laz_vlr = laz_vlrs.next().ok_or_else(|| {
        HandlerError::InvalidParams("Compressed point format has no LASzip VLR.".into())
    })?;
    if laz_vlrs.next().is_some() {
        return Err(HandlerError::InvalidParams(
            "Compressed point format must contain exactly one LASzip VLR.".into(),
        ));
    }
    let laz_vlr_data = &laz_vlr.data;
    const LAZ_VLR_FIXED_BYTES: usize = 34;
    const LAZ_ITEM_BYTES: usize = 6;
    if laz_vlr_data.len() < LAZ_VLR_FIXED_BYTES {
        return Err(HandlerError::InvalidParams(
            "LASzip VLR is shorter than its required fields.".into(),
        ));
    }
    let item_count = usize::from(u16::from_le_bytes(
        laz_vlr_data[32..34]
            .try_into()
            .expect("validated LASzip VLR fixed fields"),
    ));
    let expected_vlr_bytes = item_count
        .checked_mul(LAZ_ITEM_BYTES)
        .and_then(|items_bytes| LAZ_VLR_FIXED_BYTES.checked_add(items_bytes))
        .ok_or_else(|| {
            HandlerError::InvalidParams("LASzip VLR item-table length overflows.".into())
        })?;
    if laz_vlr_data.len() != expected_vlr_bytes {
        return Err(HandlerError::InvalidParams(format!(
            "LASzip VLR declares {item_count} item records and must contain exactly {expected_vlr_bytes} data bytes; found {}.",
            laz_vlr_data.len()
        )));
    }
    let laz_vlr = laz::LazVlr::read_from(laz_vlr_data.as_slice()).map_err(|error| {
        HandlerError::InvalidParams(format!("LASzip VLR could not be decoded: {error}"))
    })?;
    let laz_point_record_bytes = laz_vlr
        .items()
        .iter()
        .try_fold(0_u64, |total, item| {
            total.checked_add(u64::from(item.size()))
        })
        .ok_or_else(|| HandlerError::InvalidParams("LASzip item byte total overflows.".into()))?;
    if laz_point_record_bytes != u64::from(raw_header.point_data_record_length) {
        return Err(HandlerError::InvalidParams(format!(
            "LASzip item records describe {laz_point_record_bytes} point bytes, but the LAS header declares {}.",
            raw_header.point_data_record_length
        )));
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
    add_vlr_gap_warning(&mut warnings, &vlr_extent);
    if (special_evlr_count, special_evlr_offset) != (-1, -1) {
        warnings.push(
            "LASzip special EVLR references are non-default; LAZ 1.4 reserves these fields as unused, and their layout is outside this inspection scope.".to_string(),
        );
    }

    let point_format_id = header.point_format().to_u8().map_err(|error| {
        HandlerError::InvalidParams(format!("Compressed point format is invalid: {error}"))
    })?;
    match compressor {
        1 | 2 if point_format_id <= 5 => {}
        3 if (6..=10).contains(&point_format_id) => {}
        1 | 2 => {
            return Err(HandlerError::InvalidParams(format!(
                "LASzip compressor {compressor} is incompatible with point format {point_format_id}."
            )));
        }
        3 => {
            return Err(HandlerError::InvalidParams(format!(
                "LASzip compressor 3 is incompatible with point format {point_format_id}."
            )));
        }
        _ => {}
    }

    // LAZ pointwise streams have no chunk table or arithmetic end marker. The
    // enclosing point-data block still ends at the first ordinary EVLR (or
    // EOF when there are no EVLRs); do not present that block boundary as the
    // exact final byte consumed by the decoder.
    if compressor == 1 {
        let special_evlr_refs_present = (special_evlr_count, special_evlr_offset) != (-1, -1);
        let pointwise_region = if special_evlr_refs_present {
            None
        } else {
            let byte_count = boundary_before_evlrs
                .checked_sub(point_start)
                .ok_or_else(|| {
                    HandlerError::InvalidParams(
                        "Pointwise LAZ block boundary precedes point data.".into(),
                    )
                })?;
            Some((boundary_before_evlrs, byte_count))
        };
        warnings.push(
            "Pointwise LAZ has no chunk table or arithmetic-stream end marker. The enclosing block ends at the first EVLR or end of file; its exact decoder end and any residual bytes inside that block cannot be separated.".to_string(),
        );
        return Ok(json!({
            "layoutStatus": if pointwise_region.is_some() { "bounded" } else { "incomplete" },
            "validationScope": "declared VLR and EVLR extents and the enclosing pointwise LAZ block boundary; the arithmetic-stream end is not marked",
            "variableLengthRecords": vlr_extent_json(&vlr_extent),
            "pointDataStartByte": point_start.to_string(),
            "pointDataEndByte": null,
            "pointDataByteCount": null,
            "pointDataRegionEndByte": pointwise_region.map(|region| region.0.to_string()),
            "pointDataRegionByteCount": pointwise_region.map(|region| region.1.to_string()),
            "pointDataRegionBoundary": pointwise_region.map(|_| {
                if evlr_extent.is_some() {
                    "first_evlr"
                } else {
                    "end_of_file"
                }
            }),
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
            "validationScope": "declared VLR sequence, chunk sequence, chunk table, and ordinary EVLR boundaries; LASzip special EVLR references are not validated",
            "variableLengthRecords": vlr_extent_json(&vlr_extent),
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
        "validationScope": "declared VLR sequence, chunked LAZ point-data extent, chunk-table entries, and declared EVLR sequence only",
        "variableLengthRecords": vlr_extent_json(&vlr_extent),
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

fn add_vlr_gap_warning(warnings: &mut Vec<String>, extent: &VlrExtent) {
    match extent.gap_is_all_zero {
        Some(true) => warnings.push(format!(
            "{} zero-filled bytes occur between the declared VLR sequence and point data; their meaning is not interpreted.",
            extent.unclassified_bytes_before_points
        )),
        Some(false) => warnings.push(format!(
            "{} unclassified bytes occur between the declared VLR sequence and point data; their contents are not interpreted.",
            extent.unclassified_bytes_before_points
        )),
        None => {}
    }
}

fn vlr_extent_json(extent: &VlrExtent) -> Value {
    json!({
        "declaredCount": extent.count,
        "sequenceStartByte": extent.start.to_string(),
        "sequenceEndByte": extent.end.to_string(),
        "unclassifiedBytesBeforePointData": extent.unclassified_bytes_before_points.to_string(),
        "gapBytesAllZero": extent.gap_is_all_zero,
    })
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
    let bounded_header = read_bounded_raw_header(path, metadata.len())?;
    let structure_header =
        Header::new(File::open(path).map_err(internal_io_error)?).map_err(|error| {
            HandlerError::InvalidParams(format!("LAS/LAZ header could not be read: {error}"))
        })?;
    let file_structure = point_cloud_structure(
        path,
        &bounded_header.raw,
        &structure_header,
        bounded_header.vlr_extent,
        metadata.len(),
    )?;
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
    let source_header_extrema = [
        header_bounds.min.x,
        header_bounds.min.y,
        header_bounds.min.z,
        header_bounds.max.x,
        header_bounds.max.y,
        header_bounds.max.z,
    ];
    let decoded_extrema = [
        minimum[0], minimum[1], minimum[2], maximum[0], maximum[1], maximum[2],
    ];
    let bounds_within_header =
        if has_finite_bounds && source_header_extrema.iter().all(|value| value.is_finite()) {
            Some(
                less_than_or_equal_with_representation_tolerance(header_bounds.min.x, minimum[0])
                    && less_than_or_equal_with_representation_tolerance(
                        header_bounds.min.y,
                        minimum[1],
                    )
                    && less_than_or_equal_with_representation_tolerance(
                        header_bounds.min.z,
                        minimum[2],
                    )
                    && less_than_or_equal_with_representation_tolerance(
                        maximum[0],
                        header_bounds.max.x,
                    )
                    && less_than_or_equal_with_representation_tolerance(
                        maximum[1],
                        header_bounds.max.y,
                    )
                    && less_than_or_equal_with_representation_tolerance(
                        maximum[2],
                        header_bounds.max.z,
                    ),
            )
        } else {
            None
        };
    let header_bounds_match_decoded_extrema = decoded_extrema_match_header(
        header_count_matches,
        decoded_point_count,
        non_finite_coordinate_count,
        source_header_extrema,
        decoded_extrema,
    );

    let classification_lookup = classification_lookup_from_header(header);
    let classification_counts: Vec<Value> = class_counts
        .iter()
        .enumerate()
        .filter(|(_, count)| **count > 0)
        .map(|(code, count)| {
            let (standard_meaning, interpretation) =
                las14_classification_meaning(&version, point_format_id, code as u8);
            let source_description = classification_lookup
                .labels
                .as_ref()
                .and_then(|labels| labels[code].as_ref());
            json!({
                "code": code,
                "count": count.to_string(),
                "standardMeaning": standard_meaning,
                "interpretation": interpretation,
                "sourceDescription": source_description,
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
        "This scan decodes the point range declared by the LAS/LAZ header. The byte-layout report checks declared VLR, point, and EVLR boundaries and, for chunked LAZ, chunk-table entries; it does not prove whole-file format conformance.".to_string(),
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
    if header_bounds_match_decoded_extrema == Some(false) {
        warnings.push(
            "Decoded coordinate extrema do not match the LAS header-declared min/max values within the floating-point representation tolerance.".into(),
        );
    }
    if !header.point_format().is_extended && class_counts[12] > 0 {
        warnings.push("For LAS 1.4 legacy point formats 0-5, class code 12 means Overlap Points; this class label is not a check of how the producer assigned it.".into());
    }
    if classification_lookup.status == "invalid_or_ambiguous" {
        warnings.push("A LASF_Spec classification lookup record is malformed or duplicated; its descriptions were ignored.".into());
    } else if classification_lookup.status == "valid" {
        warnings.push("Classification lookup descriptions are source-provided labels; domain-profile meaning and classification correctness are not validated.".into());
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
        "classificationInterpretation": {
            "standardScheme": if version == "1.4" { Some("ASPRS LAS 1.4 R16 base classes") } else { None },
            "pointFormatFamily": if version == "1.4" && point_format_id <= 5 { Some("legacy") } else if version == "1.4" { Some("modern") } else { None },
            "classificationLookupVlrStatus": classification_lookup.status,
            "domainProfileStatus": "not_interpreted",
        },
        "returnCounts": decoded_return_counts,
        "numberOfReturnsCounts": decoded_number_of_returns_counts,
        "headerReturnCountComparison": return_count_comparison,
        "returnCountsMatchHeader": returns_match_header,
        "invalidReturnMetadataPointCount": invalid_return_metadata_count.to_string(),
        "nonFiniteCoordinatePointCount": non_finite_coordinate_count.to_string(),
        "decodedBounds": decoded_bounds,
        "headerBoundsContainDecodedPoints": bounds_within_header,
        "headerBoundsMatchDecodedExtrema": header_bounds_match_decoded_extrema,
        "fileStructure": file_structure,
        "coordinateInterpretation": "source coordinates after LAS scale/offset; CRS, units, epoch, and vertical reference not interpreted",
        "warnings": warnings,
    }))
}

fn decoded_extrema_match_header(
    declared_count_matches: bool,
    decoded_point_count: u64,
    non_finite_coordinate_count: u64,
    header_extrema: [f64; 6],
    decoded_extrema: [f64; 6],
) -> Option<bool> {
    if !declared_count_matches || non_finite_coordinate_count > 0 {
        return None;
    }
    if header_extrema.iter().any(|value| !value.is_finite()) {
        return None;
    }
    if decoded_point_count == 0 {
        return Some(header_extrema.iter().all(|value| *value == 0.0));
    }
    if decoded_extrema.iter().any(|value| !value.is_finite()) {
        return None;
    }

    Some(
        header_extrema
            .iter()
            .zip(decoded_extrema.iter())
            .all(|(header, decoded)| within_float64_representation_tolerance(*header, *decoded)),
    )
}

fn less_than_or_equal_with_representation_tolerance(lower: f64, upper: f64) -> bool {
    lower <= upper || within_float64_representation_tolerance(lower, upper)
}

fn within_float64_representation_tolerance(left: f64, right: f64) -> bool {
    if left == right {
        return true;
    }
    let magnitude = left.abs().max(right.abs()).max(1.0);
    let tolerance = 4.0 * f64::EPSILON * magnitude;
    (left - right).abs() <= tolerance
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

struct ClassificationLookup {
    status: &'static str,
    labels: Option<Vec<Option<String>>>,
}

fn classification_lookup_from_header(header: &Header) -> ClassificationLookup {
    let records: Vec<&Vlr> = header
        .vlrs()
        .iter()
        .filter(|vlr| vlr.user_id == "LASF_Spec" && vlr.record_id == 0)
        .collect();
    match records.as_slice() {
        [] => ClassificationLookup {
            status: "absent",
            labels: None,
        },
        [record] => match parse_classification_lookup_data(&record.data) {
            Ok(labels) => ClassificationLookup {
                status: "valid",
                labels: Some(labels),
            },
            Err(_) => ClassificationLookup {
                status: "invalid_or_ambiguous",
                labels: None,
            },
        },
        _ => ClassificationLookup {
            status: "invalid_or_ambiguous",
            labels: None,
        },
    }
}

fn parse_classification_lookup_data(data: &[u8]) -> Result<Vec<Option<String>>, &'static str> {
    const ENTRY_BYTES: usize = 16;
    const ENTRY_COUNT: usize = 256;
    if data.len() != ENTRY_BYTES * ENTRY_COUNT {
        return Err("classification lookup must contain 256 fixed-size entries");
    }

    let mut labels: Vec<Option<String>> = vec![None; ENTRY_COUNT];
    let mut seen = [false; ENTRY_COUNT];
    for entry in data.chunks_exact(ENTRY_BYTES) {
        let code = entry[0] as usize;
        if seen[code] {
            return Err("classification lookup contains a duplicate class number");
        }
        seen[code] = true;

        let description = &entry[1..ENTRY_BYTES];
        let text_end = description
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(description.len());
        let text = &description[..text_end];
        if text
            .iter()
            .any(|byte| !byte.is_ascii_graphic() && *byte != b' ')
        {
            return Err("classification lookup contains non-printable or non-ASCII text");
        }
        let label = String::from_utf8(text.to_vec())
            .map_err(|_| "classification lookup text is not valid ASCII")?
            .trim_end()
            .to_owned();
        if !label.is_empty() {
            labels[code] = Some(label);
        }
    }

    if seen.iter().any(|present| !present) {
        return Err("classification lookup is missing a class number");
    }
    Ok(labels)
}

/// Apply only the LAS 1.4 base class table. LAS 1.4 R16's official change
/// summary does not change these tables; names from source lookup records and
/// domain profiles remain separate, explicitly unvalidated metadata.
fn las14_classification_meaning(
    version: &str,
    point_format_id: u8,
    code: u8,
) -> (Option<&'static str>, &'static str) {
    if version != "1.4" {
        return (None, "raw_only");
    }

    if point_format_id <= 5 {
        let meaning = match code {
            0 => Some("Created, never classified"),
            1 => Some("Unclassified"),
            2 => Some("Ground"),
            3 => Some("Low vegetation"),
            4 => Some("Medium vegetation"),
            5 => Some("High vegetation"),
            6 => Some("Building"),
            7 => Some("Low point (noise)"),
            8 => Some("Model key-point"),
            9 => Some("Water"),
            12 => Some("Overlap points"),
            10..=11 | 13..=31 => Some("Reserved in the LAS 1.4 legacy class table"),
            _ => None,
        };
        let interpretation = match code {
            10..=11 | 13..=31 => "reserved",
            0..=9 | 12 => "standard",
            _ => "raw_only",
        };
        return (meaning, interpretation);
    }

    let meaning = match code {
        0 => Some("Created, never classified"),
        1 => Some("Unclassified"),
        2 => Some("Ground"),
        3 => Some("Low vegetation"),
        4 => Some("Medium vegetation"),
        5 => Some("High vegetation"),
        6 => Some("Building"),
        7 => Some("Low point (noise)"),
        9 => Some("Water"),
        10 => Some("Rail"),
        11 => Some("Road surface"),
        13 => Some("Wire - guard (shield)"),
        14 => Some("Wire - conductor (phase)"),
        15 => Some("Transmission tower"),
        16 => Some("Wire-structure connector"),
        17 => Some("Bridge deck"),
        18 => Some("High noise"),
        19 => Some("Overhead structure"),
        20 => Some("Ignored ground"),
        21 => Some("Snow"),
        22 => Some("Temporal exclusion"),
        8 | 12 | 23..=38 => Some("Reserved in the LAS 1.4 base class table"),
        39..=63 => {
            Some("Base-reserved code; a domain-profile definition requires separate validation")
        }
        _ => None,
    };
    let interpretation = match code {
        8 | 12 | 23..=38 => "reserved",
        39..=63 => "profile_dependent",
        64..=u8::MAX => "user_defined",
        _ => "standard",
    };
    (meaning, interpretation)
}

#[cfg(test)]
mod tests {
    use std::fs::File;
    use std::io::Write;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    use las::{Builder, Point, Vlr, Writer};
    use serde_json::{json, Value};
    use tempfile::tempdir;

    use super::{
        classification_lookup_from_header, decoded_extrema_match_header,
        handle_cancel_point_cloud_chunk_stream, handle_cancel_point_cloud_record_inspection,
        handle_point_cloud_chunk_stream_status, handle_point_cloud_record_inspection_status,
        handle_read_point_cloud_chunk, handle_start_point_cloud_chunk_stream,
        handle_start_point_cloud_record_inspection, inspect_header, inspect_point_records,
        inspect_point_records_controlled, las14_classification_meaning,
        less_than_or_equal_with_representation_tolerance, parse_classification_lookup_data,
        point_cloud_chunk_stream_jobs, read_bounded_raw_header, record_inspection_jobs,
        within_float64_representation_tolerance, RecordInspectionJob, RecordInspectionJobState,
        MAX_POINT_CHUNK_POINTS, VLR_HEADER_BYTES,
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

    fn write_many_point_fixture(path: &std::path::Path, point_count: u64) {
        let mut builder = Builder::from((1, 4));
        builder.point_format = las::point::Format::new(3).unwrap();
        builder.transforms.x.scale = 0.01;
        builder.transforms.y.scale = 0.01;
        builder.transforms.z.scale = 0.01;
        builder.transforms.x.offset = 500_000.0;
        builder.transforms.y.offset = 6_000_000.0;
        builder.transforms.z.offset = 100.0;
        let mut writer = Writer::from_path(path, builder.into_header().unwrap()).unwrap();
        for index in 0..point_count {
            writer
                .write_point(Point {
                    x: 500_000.0 + index as f64 * 0.01,
                    y: 6_000_000.0 + index as f64 * 0.02,
                    z: 100.0 + index as f64 * 0.005,
                    intensity: (index % 65_536) as u16,
                    return_number: 1,
                    number_of_returns: 1,
                    classification: las::point::Classification::Ground,
                    gps_time: Some(index as f64),
                    color: Some(las::Color::new(100, 200, 300)),
                    ..Default::default()
                })
                .unwrap();
        }
    }

    fn laz_vlr_data_offset(bytes: &[u8]) -> usize {
        let header_size = u16::from_le_bytes(bytes[94..96].try_into().unwrap()) as usize;
        let vlr_count = u32::from_le_bytes(bytes[100..104].try_into().unwrap());
        let mut cursor = header_size;
        for _ in 0..vlr_count {
            let record_header = &bytes[cursor..cursor + VLR_HEADER_BYTES as usize];
            let user_id = String::from_utf8_lossy(&record_header[2..18])
                .trim_end_matches('\0')
                .trim()
                .to_owned();
            let record_id = u16::from_le_bytes(record_header[18..20].try_into().unwrap());
            let data_len = u16::from_le_bytes(record_header[20..22].try_into().unwrap()) as usize;
            if user_id == "laszip encoded" && record_id == 22_204 {
                return cursor + VLR_HEADER_BYTES as usize;
            }
            cursor += VLR_HEADER_BYTES as usize + data_len;
        }
        panic!("generated LAZ fixture has no LASzip VLR");
    }

    fn truncate_laz_vlr_payload(bytes: &mut Vec<u8>, new_length: usize) {
        let data_offset = laz_vlr_data_offset(bytes);
        let header_offset = data_offset - VLR_HEADER_BYTES as usize;
        let old_length = usize::from(u16::from_le_bytes(
            bytes[header_offset + 20..header_offset + 22]
                .try_into()
                .unwrap(),
        ));
        assert!(new_length < old_length);
        let removed_length = old_length - new_length;
        bytes.drain(data_offset + new_length..data_offset + old_length);
        bytes[header_offset + 20..header_offset + 22]
            .copy_from_slice(&(new_length as u16).to_le_bytes());
        let point_data_offset = u32::from_le_bytes(bytes[96..100].try_into().unwrap());
        bytes[96..100].copy_from_slice(&(point_data_offset - removed_length as u32).to_le_bytes());
    }

    fn rewrite_single_chunk_as_pointwise_laz(path: &std::path::Path, with_evlrs: bool) {
        write_fixture(path, with_evlrs);
        let chunked_report = inspect_point_records(path).unwrap();
        let structure = &chunked_report["fileStructure"];
        assert_eq!(structure["layoutStatus"], "bounded");
        let point_start = structure["pointDataStartByte"]
            .as_str()
            .unwrap()
            .parse::<usize>()
            .unwrap();
        let table_start = structure["chunkTableStartByte"]
            .as_str()
            .unwrap()
            .parse::<usize>()
            .unwrap();
        let table_end = structure["chunkTableEndByte"]
            .as_str()
            .unwrap()
            .parse::<usize>()
            .unwrap();
        assert!(table_start >= point_start + 8);
        assert!(table_end >= table_start);
        if with_evlrs {
            assert_eq!(structure["unclassifiedBytesBeforeEvlrs"], "0");
        } else {
            assert_eq!(structure["unclassifiedBytesAfterKnownData"], "0");
        }

        let chunked = std::fs::read(path).unwrap();
        let eof_pointer_bytes = if structure["chunkTablePointerStorage"] == "end_of_file" {
            8
        } else {
            0
        };
        let retained_end = chunked.len() - eof_pointer_bytes;
        assert!(table_end <= retained_end);
        let mut pointwise = Vec::with_capacity(chunked.len());
        pointwise.extend_from_slice(&chunked[..point_start]);
        pointwise.extend_from_slice(&chunked[point_start + 8..table_start]);
        pointwise.extend_from_slice(&chunked[table_end..retained_end]);

        let removed_before_evlr = 8 + table_end - table_start;
        if let Some(old_evlr_start) = structure["firstEvlrStartByte"].as_str() {
            let old_evlr_start = old_evlr_start.parse::<u64>().unwrap();
            assert!(old_evlr_start >= table_end as u64);
            let new_evlr_start = old_evlr_start - removed_before_evlr as u64;
            pointwise[235..243].copy_from_slice(&new_evlr_start.to_le_bytes());
        }

        let laz_vlr_data = laz_vlr_data_offset(&pointwise);
        pointwise[laz_vlr_data..laz_vlr_data + 2].copy_from_slice(&1_u16.to_le_bytes());
        std::fs::write(path, pointwise).unwrap();
    }

    fn insert_bytes_before_point_data(path: &std::path::Path, inserted: &[u8]) {
        let mut bytes = std::fs::read(path).unwrap();
        let point_data_start = u32::from_le_bytes(bytes[96..100].try_into().unwrap()) as usize;
        bytes.splice(point_data_start..point_data_start, inserted.iter().copied());
        let shifted_start = u32::try_from(point_data_start + inserted.len()).unwrap();
        bytes[96..100].copy_from_slice(&shifted_start.to_le_bytes());
        std::fs::write(path, bytes).unwrap();
    }

    fn replace_header_f64(path: &std::path::Path, byte_offset: usize, value: f64) {
        let mut bytes = std::fs::read(path).unwrap();
        bytes[byte_offset..byte_offset + 8].copy_from_slice(&value.to_le_bytes());
        std::fs::write(path, bytes).unwrap();
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
    fn rejects_las_1_5_before_interpreting_it_as_a_las_1_4_header() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("future-version.las");
        write_fixture(&path, false);

        // LAS public-header version minor is byte 25. Keep all other fixture
        // bytes unchanged so this exercises the version gate itself.
        let mut bytes = std::fs::read(&path).unwrap();
        bytes[25] = 5;
        std::fs::write(&path, bytes).unwrap();

        let error = inspect_header(&path).unwrap_err();
        assert!(error
            .to_string()
            .contains("LAS/LAZ version 1.5 is not supported"));
        assert!(error
            .to_string()
            .contains("supported versions are 1.0 through 1.4"));
    }

    #[test]
    fn rejects_vlr_payload_that_crosses_point_data_offset_before_header_decode() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("vlr-crosses-points.las");
        write_fixture(&path, false);

        let mut bytes = std::fs::read(&path).unwrap();
        let header_size = u16::from_le_bytes(bytes[94..96].try_into().unwrap()) as usize;
        bytes[header_size + 20..header_size + 22].copy_from_slice(&u16::MAX.to_le_bytes());
        let malformed_source = bytes.clone();
        std::fs::write(&path, bytes).unwrap();

        let error = inspect_header(&path).unwrap_err().to_string();
        assert!(
            error.contains("VLR payload extends beyond the point-data offset"),
            "{error}"
        );
        assert_eq!(std::fs::read(&path).unwrap(), malformed_source);
    }

    #[test]
    fn reports_zero_filled_bytes_between_vlrs_and_points_as_unclassified() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("zero-gap.las");
        write_fixture(&path, false);
        insert_bytes_before_point_data(&path, &[0, 0, 0]);

        let report = inspect_point_records(&path).unwrap();
        assert_eq!(report["decodedPointCount"], "2");
        assert_eq!(
            report["fileStructure"]["variableLengthRecords"]["declaredCount"],
            1
        );
        assert_eq!(
            report["fileStructure"]["variableLengthRecords"]["unclassifiedBytesBeforePointData"],
            "3"
        );
        assert_eq!(
            report["fileStructure"]["variableLengthRecords"]["gapBytesAllZero"],
            true
        );
        assert!(report["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| {
                warning.as_str().unwrap().contains(
                    "zero-filled bytes occur between the declared VLR sequence and point data",
                )
            }));
    }

    #[test]
    fn reports_nonzero_bytes_between_vlrs_and_points_without_interpreting_them() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("nonzero-gap.las");
        write_fixture(&path, false);
        insert_bytes_before_point_data(&path, b"EXT");

        let report = inspect_point_records(&path).unwrap();
        assert_eq!(report["decodedPointCount"], "2");
        assert_eq!(
            report["fileStructure"]["variableLengthRecords"]["unclassifiedBytesBeforePointData"],
            "3"
        );
        assert_eq!(
            report["fileStructure"]["variableLengthRecords"]["gapBytesAllZero"],
            false
        );
        assert!(report["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| {
                warning.as_str().unwrap().contains(
                    "unclassified bytes occur between the declared VLR sequence and point data",
                )
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
        assert_eq!(
            result["classificationCounts"][0]["standardMeaning"],
            "Ground"
        );
        assert_eq!(result["classificationCounts"][1]["code"], 6);
        assert_eq!(result["classificationCounts"][1]["count"], "1");
        assert_eq!(
            result["classificationCounts"][1]["standardMeaning"],
            "Building"
        );
        assert_eq!(
            result["classificationInterpretation"]["standardScheme"],
            "ASPRS LAS 1.4 R16 base classes"
        );
        assert_eq!(
            result["classificationInterpretation"]["pointFormatFamily"],
            "legacy"
        );
        assert_eq!(
            result["classificationInterpretation"]["classificationLookupVlrStatus"],
            "absent"
        );
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
        assert_eq!(result["headerBoundsMatchDecodedExtrema"], true);
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
    fn detects_stale_header_extrema_even_when_they_still_contain_the_decoded_points() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("stale-header-extrema.las");
        write_fixture(&path, false);
        // LAS 1.4 header Max X is a coordinate value at byte offset 179.
        replace_header_f64(&path, 179, 500_004.0);
        let before = std::fs::read(&path).unwrap();

        let result = inspect_point_records(&path).unwrap();

        assert_eq!(
            std::fs::read(&path).unwrap(),
            before,
            "inspection must not modify the source file"
        );
        assert_eq!(result["headerBoundsContainDecodedPoints"], true);
        assert_eq!(result["headerBoundsMatchDecodedExtrema"], false);
        assert!(result["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| {
                warning
                    .as_str()
                    .unwrap()
                    .contains("do not match the LAS header-declared min/max")
            }));
    }

    #[test]
    fn header_extrema_comparison_uses_only_a_small_binary64_representation_tolerance() {
        let coordinate = 6_000_000.0_f64;
        let adjacent = f64::from_bits(coordinate.to_bits() + 1);

        assert!(within_float64_representation_tolerance(
            coordinate, adjacent
        ));
        assert!(!within_float64_representation_tolerance(
            coordinate,
            coordinate + 0.01
        ));
        assert!(less_than_or_equal_with_representation_tolerance(
            adjacent, coordinate
        ));
    }

    #[test]
    fn header_extrema_comparison_requires_complete_finite_points_and_zero_empty_bounds() {
        let empty_bounds = [0.0; 6];
        let decoded_empty = [
            f64::INFINITY,
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ];
        assert_eq!(
            decoded_extrema_match_header(true, 0, 0, empty_bounds, decoded_empty),
            Some(true)
        );
        assert_eq!(
            decoded_extrema_match_header(true, 0, 0, [1.0, 0.0, 0.0, 0.0, 0.0, 0.0], decoded_empty),
            Some(false)
        );
        assert_eq!(
            decoded_extrema_match_header(false, 1, 0, [0.0; 6], [0.0; 6]),
            None
        );
        assert_eq!(
            decoded_extrema_match_header(true, 1, 1, [0.0; 6], [0.0; 6]),
            None
        );
    }

    #[test]
    fn applies_class_meanings_only_for_supported_las_14_point_format_family() {
        assert_eq!(
            las14_classification_meaning("1.4", 3, 12),
            (Some("Overlap points"), "standard")
        );
        assert_eq!(
            las14_classification_meaning("1.4", 6, 12),
            (Some("Reserved in the LAS 1.4 base class table"), "reserved")
        );
        assert_eq!(
            las14_classification_meaning("1.4", 6, 11),
            (Some("Road surface"), "standard")
        );
        assert_eq!(
            las14_classification_meaning("1.4", 6, 42),
            (
                Some(
                    "Base-reserved code; a domain-profile definition requires separate validation"
                ),
                "profile_dependent"
            )
        );
        assert_eq!(
            las14_classification_meaning("1.4", 6, 64),
            (None, "user_defined")
        );
        assert_eq!(
            las14_classification_meaning("1.3", 3, 2),
            (None, "raw_only")
        );
    }

    #[test]
    fn reports_source_lookup_label_separately_from_las_standard_meaning() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("class-lookup.las");
        let mut data = vec![0_u8; 256 * 16];
        for code in 0_u16..=255 {
            data[code as usize * 16] = code as u8;
        }
        data[2 * 16 + 1..2 * 16 + 13].copy_from_slice(b"Ground point");

        let mut builder = Builder::from((1, 4));
        builder.point_format = las::point::Format::new(3).unwrap();
        builder.vlrs.push(Vlr {
            user_id: "LASF_Spec".into(),
            record_id: 0,
            description: "Classification Lookup".into(),
            data,
        });
        let mut writer = Writer::from_path(&path, builder.into_header().unwrap()).unwrap();
        writer
            .write_point(Point {
                x: 1.0,
                y: 2.0,
                z: 3.0,
                return_number: 1,
                number_of_returns: 1,
                classification: las::point::Classification::Ground,
                gps_time: Some(1.0),
                color: Some(las::Color::new(100, 200, 300)),
                ..Default::default()
            })
            .unwrap();
        drop(writer);

        let report = inspect_point_records(&path).unwrap();
        assert_eq!(
            report["classificationInterpretation"]["classificationLookupVlrStatus"],
            "valid"
        );
        assert_eq!(report["classificationCounts"][0]["code"], 2);
        assert_eq!(
            report["classificationCounts"][0]["standardMeaning"],
            "Ground"
        );
        assert_eq!(
            report["classificationCounts"][0]["sourceDescription"],
            "Ground point"
        );
    }

    #[test]
    fn parses_only_complete_unique_ascii_classification_lookup_records() {
        let mut data = vec![0_u8; 256 * 16];
        for code in 0_u16..=255 {
            let offset = code as usize * 16;
            data[offset] = code as u8;
        }
        data[64 * 16 + 1..64 * 16 + 12].copy_from_slice(b"Tree canopy");

        let parsed = parse_classification_lookup_data(&data).unwrap();
        assert_eq!(parsed[64].as_deref(), Some("Tree canopy"));
        assert_eq!(parsed[63], None);

        let mut duplicate = data.clone();
        duplicate[0] = 64;
        assert!(parse_classification_lookup_data(&duplicate).is_err());
        assert!(parse_classification_lookup_data(&data[..data.len() - 1]).is_err());

        let mut non_ascii = data;
        non_ascii[64 * 16 + 1] = 0xFF;
        assert!(parse_classification_lookup_data(&non_ascii).is_err());
    }

    #[test]
    fn reads_only_one_complete_classification_lookup_vlr() {
        let mut data = vec![0_u8; 256 * 16];
        for code in 0_u16..=255 {
            data[code as usize * 16] = code as u8;
        }
        data[64 * 16 + 1..64 * 16 + 12].copy_from_slice(b"Tree canopy");
        let mut builder = Builder::from((1, 4));
        builder.vlrs.push(Vlr {
            user_id: "LASF_Spec".into(),
            record_id: 0,
            description: "Classification Lookup".into(),
            data,
        });
        let header = builder.into_header().unwrap();

        let lookup = classification_lookup_from_header(&header);
        assert_eq!(lookup.status, "valid");
        assert_eq!(lookup.labels.unwrap()[64].as_deref(), Some("Tree canopy"));

        let mut duplicate_builder = Builder::from((1, 4));
        for _ in 0..2 {
            duplicate_builder.vlrs.push(Vlr {
                user_id: "LASF_Spec".into(),
                record_id: 0,
                description: "Classification Lookup".into(),
                data: {
                    let mut data = vec![0_u8; 256 * 16];
                    for code in 0_u16..=255 {
                        data[code as usize * 16] = code as u8;
                    }
                    data[64 * 16 + 1..64 * 16 + 12].copy_from_slice(b"Tree canopy");
                    data
                },
            });
        }
        let duplicate_lookup =
            classification_lookup_from_header(&duplicate_builder.into_header().unwrap());
        assert_eq!(duplicate_lookup.status, "invalid_or_ambiguous");
        assert!(duplicate_lookup.labels.is_none());

        let mut evlr_builder = Builder::from((1, 4));
        evlr_builder.evlrs.push(Vlr {
            user_id: "LASF_Spec".into(),
            record_id: 0,
            description: "Classification Lookup".into(),
            data: vec![0_u8; 256 * 16],
        });
        let evlr_lookup = classification_lookup_from_header(&evlr_builder.into_header().unwrap());
        assert_eq!(evlr_lookup.status, "absent");
        assert!(evlr_lookup.labels.is_none());
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

    #[tokio::test]
    async fn host_chunk_stream_is_bounded_ordered_cancellable_and_read_only() {
        point_cloud_chunk_stream_jobs().lock().unwrap().clear();
        let temp = tempdir().unwrap();
        let las_path = temp.path().join("stream.las");
        write_fixture(&las_path, false);
        let las_bytes_before = std::fs::read(&las_path).unwrap();
        let las_start = handle_start_point_cloud_chunk_stream(json!({
            "path": las_path.to_string_lossy().to_string()
        }))
        .await
        .unwrap();
        let las_stream_id = las_start["streamId"].as_str().unwrap().to_owned();
        assert_eq!(
            las_start["metadata"]["maxPointsPerChunk"],
            MAX_POINT_CHUNK_POINTS
        );
        assert_eq!(
            las_start["metadata"]["coordinateInterpretation"],
            "LAS scale and offset applied to X/Y/Z; CRS, units, epoch and vertical reference are not interpreted."
        );
        assert_eq!(
            las_start["metadata"]["optionalDimensionsPresent"]["gpsTime"],
            true
        );
        assert_eq!(
            las_start["metadata"]["optionalDimensionsPresent"]["rgb"],
            true
        );

        let las_job = super::get_point_cloud_chunk_stream_job(&las_stream_id).unwrap();
        las_job.read_pending.store(true, Ordering::Release);
        let overlapping_read = handle_read_point_cloud_chunk(json!({
            "streamId": las_stream_id.as_str()
        }))
        .await
        .unwrap_err();
        assert!(overlapping_read.to_string().contains("already pending"));
        las_job.read_pending.store(false, Ordering::Release);

        let first_las_chunk =
            handle_read_point_cloud_chunk(json!({ "streamId": las_stream_id.as_str() }))
                .await
                .unwrap();
        assert_eq!(first_las_chunk["status"], "chunk");
        assert_eq!(first_las_chunk["chunkIndex"], "0");
        assert_eq!(first_las_chunk["firstPointIndex"], "0");
        assert_eq!(first_las_chunk["decodedPointCount"], "2");
        assert_eq!(first_las_chunk["points"].as_array().unwrap().len(), 2);
        assert_eq!(first_las_chunk["points"][0]["pointIndex"], "0");
        assert_eq!(first_las_chunk["points"][0]["x"], 500_001.25);
        assert_eq!(first_las_chunk["points"][0]["y"], 6_000_002.5);
        assert_eq!(first_las_chunk["points"][0]["z"], 101.0);
        assert_eq!(first_las_chunk["points"][0]["classification"], 2);
        assert_eq!(first_las_chunk["points"][0]["returnNumber"], 1);
        assert_eq!(first_las_chunk["points"][0]["numberOfReturns"], 2);
        assert_eq!(first_las_chunk["points"][0]["gpsTime"], 1.0);
        assert_eq!(first_las_chunk["points"][0]["rgb"]["red"], 100);
        assert_eq!(first_las_chunk["points"][1]["pointIndex"], "1");
        assert_eq!(first_las_chunk["points"][1]["classification"], 6);
        let las_complete =
            handle_read_point_cloud_chunk(json!({ "streamId": las_stream_id.as_str() }))
                .await
                .unwrap();
        assert_eq!(las_complete["status"], "completed");
        assert_eq!(las_complete["decodedPointCount"], "2");
        assert_eq!(std::fs::read(&las_path).unwrap(), las_bytes_before);
        assert_eq!(
            handle_cancel_point_cloud_chunk_stream(json!({ "streamId": las_stream_id.as_str() }))
                .await
                .unwrap()["accepted"],
            false
        );
        assert!(handle_point_cloud_chunk_stream_status(json!({
            "streamId": "../../outside.las"
        }))
        .await
        .is_err());

        let laz_path = temp.path().join("stream.laz");
        write_fixture(&laz_path, true);
        let laz_start = handle_start_point_cloud_chunk_stream(json!({
            "path": laz_path.to_string_lossy().to_string()
        }))
        .await
        .unwrap();
        assert_eq!(laz_start["metadata"]["format"], "LAZ");
        let laz_stream_id = laz_start["streamId"].as_str().unwrap().to_owned();
        let laz_chunk =
            handle_read_point_cloud_chunk(json!({ "streamId": laz_stream_id.as_str() }))
                .await
                .unwrap();
        assert_eq!(laz_chunk["status"], "chunk");
        assert_eq!(laz_chunk["points"][0]["x"], 500_001.25);
        assert_eq!(laz_chunk["points"][1]["classification"], 6);
        assert_eq!(
            handle_read_point_cloud_chunk(json!({ "streamId": laz_stream_id.as_str() }))
                .await
                .unwrap()["status"],
            "completed"
        );

        let many_path = temp.path().join("many-points.las");
        write_many_point_fixture(&many_path, MAX_POINT_CHUNK_POINTS + 3);
        let many_bytes_before = std::fs::read(&many_path).unwrap();
        let many_start = handle_start_point_cloud_chunk_stream(json!({
            "path": many_path.to_string_lossy().to_string()
        }))
        .await
        .unwrap();
        let many_stream_id = many_start["streamId"].as_str().unwrap().to_owned();
        let bounded_chunk =
            handle_read_point_cloud_chunk(json!({ "streamId": many_stream_id.as_str() }))
                .await
                .unwrap();
        assert_eq!(
            bounded_chunk["points"].as_array().unwrap().len(),
            MAX_POINT_CHUNK_POINTS as usize
        );
        assert_eq!(bounded_chunk["firstPointIndex"], "0");
        assert_eq!(
            bounded_chunk["points"][MAX_POINT_CHUNK_POINTS as usize - 1]["pointIndex"],
            "2047"
        );
        let final_chunk =
            handle_read_point_cloud_chunk(json!({ "streamId": many_stream_id.as_str() }))
                .await
                .unwrap();
        assert_eq!(final_chunk["status"], "chunk");
        assert_eq!(final_chunk["firstPointIndex"], "2048");
        assert_eq!(final_chunk["points"].as_array().unwrap().len(), 3);
        assert_eq!(final_chunk["points"][2]["pointIndex"], "2050");
        assert_eq!(
            handle_read_point_cloud_chunk(json!({ "streamId": many_stream_id.as_str() }))
                .await
                .unwrap()["status"],
            "completed"
        );
        assert_eq!(std::fs::read(&many_path).unwrap(), many_bytes_before);

        let mismatch_path = temp.path().join("count-mismatch.las");
        write_fixture(&mismatch_path, false);
        let mut mismatch_bytes = std::fs::read(&mismatch_path).unwrap();
        mismatch_bytes[107..111].copy_from_slice(&3_u32.to_le_bytes());
        mismatch_bytes[247..255].copy_from_slice(&3_u64.to_le_bytes());
        std::fs::write(&mismatch_path, mismatch_bytes).unwrap();
        match handle_start_point_cloud_chunk_stream(json!({
            "path": mismatch_path.to_string_lossy().to_string()
        }))
        .await
        {
            Err(_) => {}
            Ok(start) => {
                let mismatch_id = start["streamId"].as_str().unwrap().to_owned();
                let first =
                    handle_read_point_cloud_chunk(json!({ "streamId": mismatch_id.as_str() }))
                        .await
                        .unwrap();
                let terminal = if first["status"] == "chunk" {
                    handle_read_point_cloud_chunk(json!({ "streamId": mismatch_id.as_str() }))
                        .await
                        .unwrap()
                } else {
                    first
                };
                assert_eq!(terminal["status"], "failed");
            }
        }

        let cancel_start = handle_start_point_cloud_chunk_stream(json!({
            "path": las_path.to_string_lossy().to_string()
        }))
        .await
        .unwrap();
        let cancel_id = cancel_start["streamId"].as_str().unwrap().to_owned();
        assert_eq!(
            handle_cancel_point_cloud_chunk_stream(json!({ "streamId": cancel_id.as_str() }))
                .await
                .unwrap()["accepted"],
            true
        );
        let cancelled = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let status = handle_point_cloud_chunk_stream_status(
                    json!({ "streamId": cancel_id.as_str() }),
                )
                .await
                .unwrap();
                if status["status"] == "cancelled" {
                    break status;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("chunk stream should stop after cancellation");
        assert_eq!(cancelled["status"], "cancelled");
        assert_eq!(
            handle_read_point_cloud_chunk(json!({ "streamId": cancel_id.as_str() }))
                .await
                .unwrap()["status"],
            "cancelled"
        );

        let active_start = handle_start_point_cloud_chunk_stream(json!({
            "path": las_path.to_string_lossy().to_string()
        }))
        .await
        .unwrap();
        let active_id = active_start["streamId"].as_str().unwrap().to_owned();
        let duplicate = handle_start_point_cloud_chunk_stream(json!({
            "path": las_path.to_string_lossy().to_string()
        }))
        .await
        .unwrap_err();
        assert!(duplicate.to_string().contains("already running"));
        handle_cancel_point_cloud_chunk_stream(json!({ "streamId": active_id.as_str() }))
            .await
            .unwrap();
        point_cloud_chunk_stream_jobs().lock().unwrap().clear();
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
    fn rejects_laz_vlr_item_count_that_does_not_match_its_record_data() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("bad-item-count.laz");
        write_fixture(&path, false);
        let mut bytes = std::fs::read(&path).unwrap();
        let laz_vlr_data = laz_vlr_data_offset(&bytes);
        bytes[laz_vlr_data + 32..laz_vlr_data + 34].copy_from_slice(&0_u16.to_le_bytes());
        std::fs::write(&path, bytes).unwrap();

        let error = inspect_point_records(&path).unwrap_err().to_string();
        assert!(
            error.contains("must contain exactly 34 data bytes"),
            "{error}"
        );
    }

    #[test]
    fn rejects_truncated_laszip_fixed_fields_before_pointwise_layout_reporting() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("truncated-laszip-fixed-fields.laz");
        write_fixture(&path, false);
        let mut bytes = std::fs::read(&path).unwrap();
        truncate_laz_vlr_payload(&mut bytes, 33);
        std::fs::write(&path, bytes).unwrap();

        let error = inspect_point_records(&path).unwrap_err().to_string();
        assert!(
            error.contains("shorter than its required fields"),
            "{error}"
        );
    }

    #[test]
    fn rejects_truncated_laszip_item_record_before_pointwise_layout_reporting() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("truncated-laszip-item-record.laz");
        write_fixture(&path, false);
        let mut bytes = std::fs::read(&path).unwrap();
        let data_offset = laz_vlr_data_offset(&bytes);
        let header_offset = data_offset - VLR_HEADER_BYTES as usize;
        let data_length = usize::from(u16::from_le_bytes(
            bytes[header_offset + 20..header_offset + 22]
                .try_into()
                .unwrap(),
        ));
        let item_count = u16::from_le_bytes(
            bytes[data_offset + 32..data_offset + 34]
                .try_into()
                .unwrap(),
        );
        assert!(item_count > 0);
        truncate_laz_vlr_payload(&mut bytes, data_length - 1);
        std::fs::write(&path, bytes).unwrap();

        let error = inspect_point_records(&path).unwrap_err().to_string();
        assert!(error.contains("must contain exactly"), "{error}");
        assert!(error.contains("item records"), "{error}");
    }

    #[test]
    fn rejects_laz_item_sizes_that_do_not_match_the_declared_point_record_length() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("bad-item-size.laz");
        write_fixture(&path, false);
        let mut bytes = std::fs::read(&path).unwrap();
        let laz_vlr_data = laz_vlr_data_offset(&bytes);
        let item_size_offset = laz_vlr_data + 36;
        let original_size = u16::from_le_bytes(
            bytes[item_size_offset..item_size_offset + 2]
                .try_into()
                .unwrap(),
        );
        bytes[item_size_offset..item_size_offset + 2]
            .copy_from_slice(&original_size.saturating_add(1).to_le_bytes());
        std::fs::write(&path, bytes).unwrap();

        let error = inspect_point_records(&path).unwrap_err().to_string();
        assert!(
            error.contains("point bytes, but the LAS header declares"),
            "{error}"
        );
    }

    #[test]
    fn rejects_multiple_laszip_vlrs_in_a_compressed_source() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("duplicate-laszip-vlr.laz");
        write_fixture(&path, false);
        let mut bytes = std::fs::read(&path).unwrap();
        let header_size = u16::from_le_bytes(bytes[94..96].try_into().unwrap()) as usize;
        let vlr_count = u32::from_le_bytes(bytes[100..104].try_into().unwrap());
        let mut cursor = header_size;
        let mut duplicate_header = None;
        for _ in 0..vlr_count {
            let record_header = &bytes[cursor..cursor + VLR_HEADER_BYTES as usize];
            let user_id = String::from_utf8_lossy(&record_header[2..18])
                .trim_end_matches('\0')
                .trim()
                .to_owned();
            let record_id = u16::from_le_bytes(record_header[18..20].try_into().unwrap());
            let data_len = u16::from_le_bytes(record_header[20..22].try_into().unwrap()) as usize;
            if user_id != "laszip encoded" || record_id != 22_204 {
                duplicate_header = Some(cursor);
                break;
            }
            cursor += VLR_HEADER_BYTES as usize + data_len;
        }
        let duplicate_header = duplicate_header.expect("fixture has another VLR to duplicate");
        bytes[duplicate_header + 2..duplicate_header + 18].copy_from_slice(b"laszip encoded\0\0");
        bytes[duplicate_header + 18..duplicate_header + 20]
            .copy_from_slice(&22_204_u16.to_le_bytes());
        std::fs::write(&path, bytes).unwrap();

        let error = inspect_point_records(&path).unwrap_err().to_string();
        assert!(error.contains("exactly one LASzip VLR"), "{error}");
    }

    #[test]
    fn rejects_laz_compressor_incompatible_with_point_format() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("bad-compressor-point-format.laz");
        write_fixture(&path, false);
        let mut bytes = std::fs::read(&path).unwrap();
        let laz_vlr_data = laz_vlr_data_offset(&bytes);
        bytes[laz_vlr_data..laz_vlr_data + 2].copy_from_slice(&3_u16.to_le_bytes());
        std::fs::write(&path, bytes).unwrap();

        let error = inspect_point_records(&path).unwrap_err().to_string();
        assert!(error.contains("incompatible with point format"), "{error}");
    }

    #[test]
    fn reports_pointwise_laz_region_boundary_without_inventing_stream_end() {
        for with_evlrs in [false, true] {
            let temp = tempdir().unwrap();
            let path = temp.path().join("pointwise.laz");
            rewrite_single_chunk_as_pointwise_laz(&path, with_evlrs);

            let result = inspect_point_records(&path).unwrap();
            let structure = &result["fileStructure"];
            let point_start = structure["pointDataStartByte"]
                .as_str()
                .unwrap()
                .parse::<u64>()
                .unwrap();
            let region_end = if with_evlrs {
                assert_eq!(structure["pointDataRegionBoundary"], "first_evlr");
                assert_eq!(
                    structure["pointDataRegionEndByte"],
                    structure["firstEvlrStartByte"]
                );
                structure["firstEvlrStartByte"]
                    .as_str()
                    .unwrap()
                    .parse::<u64>()
                    .unwrap()
            } else {
                assert_eq!(structure["pointDataRegionBoundary"], "end_of_file");
                assert_eq!(
                    structure["pointDataRegionEndByte"],
                    std::fs::metadata(&path).unwrap().len().to_string()
                );
                std::fs::metadata(&path).unwrap().len()
            };

            assert_eq!(result["format"], "LAZ");
            assert_eq!(result["decodedPointCount"], "2");
            assert_eq!(structure["layoutStatus"], "bounded");
            assert_eq!(structure["pointDataEndByte"], Value::Null);
            assert_eq!(structure["pointDataByteCount"], Value::Null);
            assert_eq!(
                structure["pointDataRegionByteCount"],
                (region_end - point_start).to_string()
            );
            assert_eq!(structure["unclassifiedBytesBeforeEvlrs"], Value::Null);
            assert_eq!(structure["unclassifiedBytesAfterKnownData"], Value::Null);
            assert!(structure["warnings"]
                .as_array()
                .unwrap()
                .iter()
                .any(|warning| warning
                    .as_str()
                    .unwrap()
                    .contains("no chunk table or arithmetic-stream end marker")));
        }
    }

    #[test]
    fn does_not_claim_pointwise_laz_boundary_with_special_evlr_references() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("special-evlr.laz");
        rewrite_single_chunk_as_pointwise_laz(&path, false);
        let mut bytes = std::fs::read(&path).unwrap();
        let laz_vlr_data = laz_vlr_data_offset(&bytes);
        bytes[laz_vlr_data + 16..laz_vlr_data + 24].copy_from_slice(&0_i64.to_le_bytes());
        bytes[laz_vlr_data + 24..laz_vlr_data + 32].copy_from_slice(&0_i64.to_le_bytes());
        std::fs::write(&path, bytes).unwrap();

        let result = inspect_point_records(&path).unwrap();
        let structure = &result["fileStructure"];
        assert_eq!(result["decodedPointCount"], "2");
        assert_eq!(structure["layoutStatus"], "incomplete");
        assert_eq!(structure["pointDataRegionEndByte"], Value::Null);
        assert_eq!(structure["pointDataRegionByteCount"], Value::Null);
        assert_eq!(structure["pointDataRegionBoundary"], Value::Null);
        assert!(structure["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| warning
                .as_str()
                .unwrap()
                .contains("special EVLR references are non-default")));
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
