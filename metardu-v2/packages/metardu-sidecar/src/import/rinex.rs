//! RINEX epoch parser — body of a RINEX observation file.
//!
//! Called by the TS engine after `parseRinexHeader` has already drained the
//! header. We take the whole file content, skip past `END OF HEADER`, and
//! parse epoch records + their following observation lines per
//! RINEX 3.04 §3 (and RINEX 2.11 for 2.x files). Each epoch contributes one
//! `RinexEpoch` entry with the per-satellite observation rows.
//!
//! We do NOT attempt sky-position or positioning computation here — that's a
//! later GNSS background processing task. The output is a faithful structural
//! parse that the TS engine merges into its `ImportResult.observations`.

use serde::{Deserialize, Serialize};

use crate::dispatcher::HandlerError;

// ─── Public wire types ──────────────────────────────────────────────

/// One parsed RINEX epoch (one epoch record + its observation lines).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RinexEpoch {
    /// Epoch timestamp in ISO 8601 (YYYY-MM-DDTHH:MM:SS).
    pub timestamp: String,
    /// Number of satellites observed at this epoch.
    pub satellite_count: u32,
    /// List of satellite identifiers as written in the RINEX record (e.g. "G01", "R07").
    pub satellites: Vec<String>,
    /// Per-satellite observation rows; each row is a vec of floats matching
    /// the order of the header's `# / TYPES OF OBSERV` line. Missing/blank
    /// observations are represented as `NaN`.
    pub observations: Vec<Vec<f64>>,
    /// Epoch flag from the RINEX record (0 = OK, 1-6 = event flags per spec).
    pub epoch_flag: u8,
}

/// Result of parsing a RINEX observation file body.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RinexEpochResult {
    /// Parsed epochs in file order.
    pub epochs: Vec<RinexEpoch>,
    /// Non-fatal warnings (malformed lines skipped, etc.).
    pub warnings: Vec<String>,
    /// Count of epochs parsed.
    pub epoch_count: usize,
    /// Receiver marker name (echoed from header for correlation).
    pub marker_name: String,
}

// ─── Params for the IPC handler ─────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct RinexEpochsParams {
    /// Full text of the RINEX observation file (header + body).
    pub content: String,
}

// ─── Parser ─────────────────────────────────────────────────────────

/// Parse the body of a RINEX observation file.
///
/// Returns `anyhow::Result` so the async handler wrapper can map errors to
/// `HandlerError::Internal`.
pub fn parse_rinex_epochs(content: &str) -> anyhow::Result<RinexEpochResult> {
    let mut marker_name = String::new();
    let mut obs_types_count: usize = 0;
    let mut obs_types: Vec<String> = Vec::new();

    // Find END OF HEADER (label is in cols 61-80 per RINEX spec).
    let mut header_end_line: Option<usize> = None;
    for (i, raw_line) in content.lines().enumerate() {
        let label = if raw_line.len() >= 60 {
            raw_line[60..].trim().to_string()
        } else {
            String::new()
        };
        let data = if raw_line.len() >= 60 {
            raw_line[..60].to_string()
        } else {
            raw_line.to_string()
        };
        match label.as_str() {
            "MARKER NAME" => marker_name = data.trim().to_string(),
            "# / TYPES OF OBSERV" => {
                let parts: Vec<&str> = data.split_whitespace().collect();
                if let Some(count_str) = parts.first() {
                    if let Ok(c) = count_str.parse::<usize>() {
                        obs_types_count = c;
                    }
                }
                for p in parts.iter().skip(1) {
                    obs_types.push(p.trim().to_string());
                }
            }
            "END OF HEADER" => {
                header_end_line = Some(i);
                break;
            }
            _ => {}
        }
    }

    let header_end = header_end_line
        .ok_or_else(|| anyhow::anyhow!("RINEX file has no END OF HEADER line"))?;

    // Effective observation count per row (header count, else inferred).
    let n_obs = if obs_types.is_empty() {
        obs_types_count
    } else {
        obs_types.len().max(obs_types_count)
    };

    // Walk the body, detecting epoch boundaries.
    let body: Vec<&str> = content.lines().skip(header_end + 1).collect();
    let mut epochs: Vec<RinexEpoch> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    let mut i = 0;
    while i < body.len() {
        let line = body[i];
        if line.is_empty() {
            i += 1;
            continue;
        }
        let is_rinex3_epoch = line.starts_with('>');
        // RINEX 2 epoch lines: 1 space then 2-digit year (e.g. " 25 07 25 ...").
        let is_rinex2_epoch = !is_rinex3_epoch
            && line.len() >= 4
            && line.starts_with(' ')
            && line[1..3].chars().all(|c| c.is_ascii_digit())
            && line.as_bytes().get(3) == Some(&b' ');

        if !is_rinex3_epoch && !is_rinex2_epoch {
            // Comment line or unknown; skip.
            i += 1;
            continue;
        }

        match parse_epoch_record(line, is_rinex3_epoch, &mut warnings, epochs.len() + 1) {
            Ok((epoch, n_sat)) => {
                // Consume the following n_sat observation lines.
                let mut epoch = epoch;
                let mut obs_rows: Vec<Vec<f64>> = Vec::with_capacity(n_sat);
                for s in 0..n_sat {
                    let j = i + 1 + s;
                    if j >= body.len() {
                        warnings.push(format!(
                            "epoch {}: only {}/{} observation lines present",
                            epochs.len() + 1,
                            s,
                            n_sat
                        ));
                        // Fill remaining rows with NaN.
                        for _ in s..n_sat {
                            obs_rows.push(vec![f64::NAN; n_obs.max(1)]);
                        }
                        break;
                    }
                    match parse_obs_line(body[j], n_obs) {
                        Ok(row) => obs_rows.push(row),
                        Err(e) => {
                            warnings.push(format!(
                                "epoch {} satellite {}: {}",
                                epochs.len() + 1,
                                epoch.satellites.get(s).cloned().unwrap_or_default(),
                                e
                            ));
                            obs_rows.push(vec![f64::NAN; n_obs.max(1)]);
                        }
                    }
                }
                epoch.observations = obs_rows;
                // Advance past epoch line + the sat lines we consumed.
                i += 1 + n_sat;
                epochs.push(epoch);
            }
            Err(e) => {
                warnings.push(format!("epoch line parse error: {}", e));
                i += 1;
            }
        }
    }

    let epoch_count = epochs.len();
    Ok(RinexEpochResult {
        epochs,
        warnings,
        epoch_count,
        marker_name,
    })
}

/// Parse an epoch record line into the partial `RinexEpoch` (without obs rows).
/// Returns the epoch + the number of satellites (used by the caller to know
/// how many following obs lines to consume).
fn parse_epoch_record(
    line: &str,
    is_rinex3: bool,
    warnings: &mut Vec<String>,
    epoch_num: usize,
) -> anyhow::Result<(RinexEpoch, usize)> {
    if is_rinex3 {
        // RINEX 3 format: `> YYYY MM DD HH MM SS.sssssss  flag  n_sat  sat1 sat2 ...`
        // Token lengths can vary. We tokenize on whitespace.
        let after_gt = line.trim_start_matches('>');
        let toks: Vec<&str> = after_gt.split_whitespace().collect();
        // Need: y, mo, d, h, mi, sec(.frac), flag, n_sat, then sat IDs.
        if toks.len() < 8 {
            return Err(anyhow::anyhow!(
                "RINEX 3 epoch line: expected >=8 tokens, got {}",
                toks.len()
            ));
        }
        let y: u32 = toks[0].parse().unwrap_or(0);
        let mo: u32 = toks[1].parse().unwrap_or(0);
        let d: u32 = toks[2].parse().unwrap_or(0);
        let h: u32 = toks[3].parse().unwrap_or(0);
        let mi: u32 = toks[4].parse().unwrap_or(0);
        // toks[5] is "ss" or "ss.ssssss" — take the integer part.
        let sec_str = toks[5];
        let s_tok = sec_str.split('.').next().unwrap_or("0");
        let s: u32 = s_tok.parse().unwrap_or(0);
        // toks[6] = epoch flag (0-6), toks[7] = sat count.
        // If toks[5] was a 2-token float split (rare RINEX writers), shift back.
        // We test by trying to parse toks[6] as integer; if it fails, reorder.
        let (flag_idx, count_idx) = if toks.get(6).map(|t| t.parse::<u8>().is_ok()).unwrap_or(false) {
            (6, 7)
        } else {
            (7, 8)
        };
        let epoch_flag = toks.get(flag_idx).and_then(|t| t.parse::<u8>().ok()).unwrap_or(0);
        let n_sat = toks.get(count_idx).and_then(|t| t.parse::<usize>().ok()).unwrap_or(0);
        if n_sat > 120 {
            // Garbage. Most likely we mis-parsed the tokens.
            return Err(anyhow::anyhow!("implausible satellite count {}", n_sat));
        }
        let satellites: Vec<String> = toks.iter().skip(count_idx + 1).take(n_sat)
            .map(|s| s.trim().to_string()).collect();
        if satellites.len() < n_sat {
            warnings.push(format!(
                "epoch {}: declared {} sats but only {} listed",
                epoch_num,
                n_sat,
                satellites.len()
            ));
        }
        let timestamp = format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}", y, mo, d, h, mi, s);
        Ok((
            RinexEpoch {
                timestamp,
                satellite_count: n_sat as u32,
                satellites,
                observations: Vec::new(),
                epoch_flag,
            },
            n_sat,
        ))
    } else {
        // RINEX 2: ` YY MM DD HH MM SS.ssssss  flag  n_sat  s1 s2 ...`
        let trimmed = line.trim_start();
        let toks: Vec<&str> = trimmed.split_whitespace().collect();
        if toks.len() < 8 {
            return Err(anyhow::anyhow!(
                "RINEX 2 epoch line: expected >=8 tokens, got {}",
                toks.len()
            ));
        }
        let two_digit_year: u32 = toks[0].parse().unwrap_or(0);
        let y = if two_digit_year < 80 { 2000 + two_digit_year } else { 1900 + two_digit_year };
        let (mo, d, h, mi): (u32, u32, u32, u32) = (
            toks[1].parse().unwrap_or(0),
            toks[2].parse().unwrap_or(0),
            toks[3].parse().unwrap_or(0),
            toks[4].parse().unwrap_or(0),
        );
        let s_tok = toks[5].split('.').next().unwrap_or("0");
        let s: u32 = s_tok.parse().unwrap_or(0);
        let (flag_idx, count_idx) = if toks.get(6).map(|t| t.parse::<u8>().is_ok()).unwrap_or(false) {
            (6, 7)
        } else {
            (7, 8)
        };
        let epoch_flag = toks.get(flag_idx).and_then(|t| t.parse::<u8>().ok()).unwrap_or(0);
        let n_sat = toks.get(count_idx).and_then(|t| t.parse::<usize>().ok()).unwrap_or(0);
        if n_sat > 36 {
            return Err(anyhow::anyhow!("implausible RINEX 2 satellite count {}", n_sat));
        }
        let satellites: Vec<String> = toks.iter().skip(count_idx + 1).take(n_sat)
            .map(|s| s.trim().to_string()).collect();
        let timestamp = format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}", y, mo, d, h, mi, s);
        Ok((
            RinexEpoch {
                timestamp,
                satellite_count: n_sat as u32,
                satellites,
                observations: Vec::new(),
                epoch_flag,
            },
            n_sat,
        ))
    }
}

/// Parse a per-satellite observation line.
///
/// RINEX 3 obs lines are F14.3 floats concatenated (16-char stride incl. LLI
/// and signal-strength bits), per RINEX 3.04 §3. We attempt whitespace
/// separation first (used by many real-world files) and fall back to
/// fixed-width chunks.
fn parse_obs_line(line: &str, n_obs: usize) -> anyhow::Result<Vec<f64>> {
    if n_obs == 0 {
        return Ok(Vec::new());
    }
    let trimmed = line.trim();
    let ws_split: Vec<&str> = trimmed.split_whitespace().collect();
    if ws_split.len() >= n_obs {
        return Ok(ws_split.iter().take(n_obs)
            .map(|t| t.parse::<f64>().unwrap_or(f64::NAN))
            .collect());
    }
    // Fallback: fixed-width 16-char chunks (14 chars + 2 for LLI/SS).
    let mut row = Vec::with_capacity(n_obs);
    let bytes = line.as_bytes();
    for i in 0..n_obs {
        let chunk_start = i * 16;
        if chunk_start + 14 > bytes.len() {
            row.push(f64::NAN);
            continue;
        }
        let chunk = &line[chunk_start..chunk_start + 14];
        row.push(chunk.trim().parse::<f64>().unwrap_or(f64::NAN));
    }
    Ok(row)
}

// ─── IPC handler wrapper (mirrors gdal::handle_gdal_contour) ─────────

pub async fn handle_rinex_epochs(
    params: serde_json::Value,
) -> std::result::Result<serde_json::Value, HandlerError> {
    let p: RinexEpochsParams = serde_json::from_value(params)
        .map_err(|e| HandlerError::InvalidParams(e.to_string()))?;
    let result = parse_rinex_epochs(&p.content)
        .map_err(|e| HandlerError::Internal(e.to_string()))?;
    serde_json::to_value(result)
        .map_err(|e| HandlerError::Internal(e.to_string()))
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: pad a RINEX header data field to 60 cols then append the label.
    fn pad(data: &str, label: &str) -> String {
        let mut s = String::from(data);
        while s.len() < 60 {
            s.push(' ');
        }
        s.push_str(label);
        s
    }

    fn fixture_rinex3() -> String {
        let mut lines = vec![
            pad("     3.04           OBSERVATION DATA    M (MIXED)", "RINEX VERSION / TYPE"),
            pad("MARKER001", "MARKER NAME"),
            pad("    4    L1    L2    C1    P1", "# / TYPES OF OBSERV"),
            "".to_string() + "                                                            END OF HEADER",
        ];
        // Two epochs × 3 satellites each. Whitespace-separated for parseability.
        lines.push("> 2026  7 25 10 30  0.0000000  0  3 G01 G02 G03".to_string());
        lines.push("  21000000.000  21000000.000  21000000.000  21000000.000".to_string());
        lines.push("  21100000.000  21100000.000  21100000.000  21100000.000".to_string());
        lines.push("  21200000.000  21200000.000  21200000.000  21200000.000".to_string());
        lines.push("> 2026  7 25 10 30 30.0000000  0  3 G01 G02 G03".to_string());
        lines.push("  22000000.000  22000000.000  22000000.000  22000000.000".to_string());
        lines.push("  22100000.000  22100000.000  22100000.000  22100000.000".to_string());
        lines.push("  22200000.000  22200000.000  22200000.000  22200000.000".to_string());
        lines.join("\n")
    }

    #[test]
    fn parses_two_epochs() {
        let result = parse_rinex_epochs(&fixture_rinex3()).expect("parse ok");
        assert_eq!(result.epoch_count, 2, "expected 2 epochs");
        assert_eq!(result.epochs.len(), 2);
        assert_eq!(result.epochs[0].satellite_count, 3);
        assert_eq!(result.epochs[0].satellites, vec!["G01", "G02", "G03"]);
        assert_eq!(result.epochs[0].epoch_flag, 0);
    }

    #[test]
    fn extracts_marker_name() {
        let result = parse_rinex_epochs(&fixture_rinex3()).expect("parse ok");
        assert_eq!(result.marker_name, "MARKER001");
    }

    #[test]
    fn extracts_per_sat_observations() {
        let result = parse_rinex_epochs(&fixture_rinex3()).expect("parse ok");
        assert_eq!(result.epochs[0].observations.len(), 3);
        assert_eq!(result.epochs[0].observations[0].len(), 4);
        // First obs value of first sat should be 21_000_000.
        assert!(!result.epochs[0].observations[0][0].is_nan());
        assert!(result.epochs[0].observations[0][0] > 0.0);
    }

    #[test]
    fn extracts_timestamps() {
        let result = parse_rinex_epochs(&fixture_rinex3()).expect("parse ok");
        assert_eq!(result.epochs[0].timestamp, "2026-07-25T10:30:00");
        assert_eq!(result.epochs[1].timestamp, "2026-07-25T10:30:30");
    }

    #[test]
    fn rejects_missing_end_of_header() {
        let bad = "no header here\njust some data";
        let result = parse_rinex_epochs(bad);
        assert!(result.is_err(), "should error on missing END OF HEADER");
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("END OF HEADER"),
            "error should mention END OF HEADER, got: {}",
            err
        );
    }

    #[test]
    fn handles_empty_body() {
        let empty = format!(
            "{}\n{}\n{}",
            pad("MARKER_X", "MARKER NAME"),
            pad("    0", "# / TYPES OF OBSERV"),
            "                                                            END OF HEADER"
        );
        let result = parse_rinex_epochs(&empty).expect("parse ok");
        assert_eq!(result.epoch_count, 0);
        assert_eq!(result.marker_name, "MARKER_X");
    }

    #[test]
    fn handler_round_trips_json() {
        let content = fixture_rinex3();
        let params = serde_json::json!({ "content": content });
        let v = async_block_on(handle_rinex_epochs(params));
        let parsed: RinexEpochResult = serde_json::from_value(v).expect("round-trip");
        assert_eq!(parsed.epoch_count, 2);
        assert_eq!(parsed.marker_name, "MARKER001");
    }

    #[test]
    fn handler_rejects_bad_params() {
        let res = handle_rinex_epochs(serde_json::json!({}));
        let err = async_block_on_err(res);
        assert_eq!(err.code(), "INVALID_PARAMS");
    }

    #[test]
    fn rinex2_parses_two_digit_year() {
        // Build a RINEX 2 file with two-digit year 25 (= 2025).
        let mut lines = vec![
            pad("     2.11           OBSERVATION DATA    G", "RINEX VERSION / TYPE"),
            pad("MARKER2", "MARKER NAME"),
            pad("    4    L1    L2    C1    P1", "# / TYPES OF OBSERV"),
            "                                                            END OF HEADER".to_string(),
        ];
        lines.push(" 25  7 25 10 30  0.000000  0  2 G01 G02".to_string());
        lines.push("  21000000.000  21000000.000  21000000.000  21000000.000".to_string());
        lines.push("  21100000.000  21100000.000  21100000.000  21100000.000".to_string());
        let r = parse_rinex_epochs(&lines.join("\n")).expect("parse ok");
        assert_eq!(r.epoch_count, 1);
        assert_eq!(r.epochs[0].timestamp, "2025-07-25T10:30:00");
    }

    // Tiny futures executor block — keeps dev-deps minimal.
    fn async_block_on<F>(f: F) -> serde_json::Value
    where
        F: std::future::Future<Output = std::result::Result<serde_json::Value, HandlerError>>,
    {
        // SAFETY: simple single-threaded poll loop.
        use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};
        let mut futokol = Box::pin(f);
        static VTABLE: RawWakerVTable = RawWakerVTable::new(
            |_| RawWaker::new(std::ptr::null(), &VTABLE),
            |_| {},
            |_| {},
            |_| {},
        );
        let waker = unsafe { Waker::from_raw(RawWaker::new(std::ptr::null(), &VTABLE)) };
        let mut ctx = Context::from_waker(&waker);
        loop {
            match futokol.as_mut().poll(&mut ctx) {
                Poll::Ready(res) => match res {
                    Ok(v) => return v,
                    Err(_) => return serde_json::Value::Null,
                },
                Poll::Pending => {}
            }
        }
    }

    fn async_block_on_err<F>(f: F) -> HandlerError
    where
        F: std::future::Future<Output = std::result::Result<serde_json::Value, HandlerError>>,
    {
        use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};
        let mut futokol = Box::pin(f);
        static VTABLE: RawWakerVTable = RawWakerVTable::new(
            |_| RawWaker::new(std::ptr::null(), &VTABLE),
            |_| {},
            |_| {},
            |_| {},
        );
        let waker = unsafe { Waker::from_raw(RawWaker::new(std::ptr::null(), &VTABLE)) };
        let mut ctx = Context::from_waker(&waker);
        loop {
            match futokol.as_mut().poll(&mut ctx) {
                Poll::Ready(res) => match res {
                    Ok(_) => panic!("expected error, got Ok"),
                    Err(e) => return e,
                },
                Poll::Pending => {}
            }
        }
    }
}
