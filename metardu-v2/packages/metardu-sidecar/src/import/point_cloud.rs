//! Bounded, read-only inspection of LAS and LAZ file headers.
//!
//! This module deliberately does not read point records, verify a whole file,
//! store the source in a project, or classify points. The renderer never
//! supplies a path: the Electron main process obtains it from the native file
//! picker and invokes this handler directly.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use las::{raw, Builder, Header, Vlr};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::dispatcher::HandlerError;

const MAX_HEADER_METADATA_BYTES: u64 = 32 * 1024 * 1024;
const MAX_VLR_COUNT: u32 = 100_000;
const MAX_EVLR_COUNT: u32 = 100_000;
const EVLR_HEADER_BYTES: u64 = 60;

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

#[cfg(test)]
mod tests {
    use std::fs::File;
    use std::io::Write;

    use las::{Builder, Point, Vlr, Writer};
    use serde_json::json;
    use tempfile::tempdir;

    use super::{inspect_header, read_bounded_raw_header};
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
