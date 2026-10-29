//! Bounded, read-only inspection of LAS and LAZ file headers.
//!
//! This module deliberately does not read point records, verify a whole file,
//! store the source in a project, or classify points. The renderer never
//! supplies a path: the Electron main process obtains it from the native file
//! picker and invokes this handler directly.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use las::{raw, Builder, Header, PointDataBuilder, Reader, Vlr};
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

    tokio::task::spawn_blocking(move || inspect_point_records(&path))
        .await
        .map_err(|error| {
            HandlerError::Internal(format!(
                "Point-cloud record inspection task failed: {error}"
            ))
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

const MAX_POINT_BATCH_BYTES: usize = 16 * 1024 * 1024;
const MAX_POINT_BATCH_COUNT: usize = 65_536;

fn inspect_point_records(path: &Path) -> Result<Value, HandlerError> {
    // Keep the existing header preflight as the single bounded gate for VLR/EVLR metadata.
    let _header_evidence = inspect_header(path)?;
    let mut reader = Reader::from_path(path).map_err(|error| {
        HandlerError::InvalidParams(format!("LAS/LAZ point reader could not be opened: {error}"))
    })?;

    let header = reader.header();
    let declared_point_count = header.number_of_points();
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
        "This scan decodes the point range declared by the LAS/LAZ header; it does not validate trailing bytes or prove whole-file format conformance.".to_string(),
        "Coordinates are decoded with the source header scale and offset only. CRS, units, epoch, vertical reference, and project compatibility remain unresolved.".to_string(),
        "Classification counts are labels already stored in the source; no classification algorithm was run.".to_string(),
    ];
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

    use las::{Builder, Point, Vlr, Writer};
    use serde_json::json;
    use tempfile::tempdir;

    use super::{inspect_header, inspect_point_records, read_bounded_raw_header};
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
    }

    #[test]
    fn rejects_truncated_las_point_records_after_reporting_the_read_position() {
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
            error.contains("point decoding failed after 1 records"),
            "{error}"
        );
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
