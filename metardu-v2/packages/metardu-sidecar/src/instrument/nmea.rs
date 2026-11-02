//! NMEA 0183 sentence parser for GNSS receivers.
//!
//! Parses the seven most important NMEA sentence types used in surveying:
//!   - GGA: Global Positioning System Fix Data (position + fix quality)
//!   - GSA: Satellites and DOP (DOP values + satellite list)
//!   - GSV: Satellites in View (sky visibility + signal strength)
//!   - RMC: Recommended Minimum (position + speed + course)
//!   - VTG: Track made good and Ground speed
//!   - ZDA: Time and Date
//!   - GST: Pseudorange Error Statistics (receiver-specific accuracy)
//!
//! References:
//!   - NMEA 0183 Standard v4.10
//!   - IEC 61162-1
//!   - u-blox GNSS receiver interface spec (for GST)
//!   - Leica GS18 NMEA output spec

use serde::{Deserialize, Serialize};

// ─── Parsed Types ────────────────────────────────────────────────

/// A single parsed NMEA sentence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NmeaSentence {
    /// Talker ID (e.g., "GP" = GPS, "GL" = GLONASS, "GA" = Galileo, "GN" = combined).
    pub talker: String,
    /// Sentence type (e.g., "GGA", "GSA", "GSV").
    pub sentence_type: String,
    /// UTC timestamp (hhmmss.sss format).
    pub timestamp: String,
    /// Raw sentence for debugging.
    pub raw: String,
    /// Parsed data, varies by sentence type.
    pub data: NmeaData,
}

/// Parsed NMEA data, keyed by sentence type.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum NmeaData {
    GGA(GGAData),
    GSA(GSAData),
    GSV(GSVData),
    RMC(RMCData),
    VTG(VTGData),
    ZDA(ZDAData),
    GST(GSTData),
    Unknown { fields: Vec<String> },
}

/// GGA — Global Positioning System Fix Data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GGAData {
    /// UTC time (hhmmss.sss).
    pub time: String,
    /// Latitude in decimal degrees (positive north), when supplied and valid.
    pub latitude: Option<f64>,
    pub lat_dir: Option<String>,
    /// Longitude in decimal degrees (positive east), when supplied and valid.
    pub longitude: Option<f64>,
    pub lon_dir: Option<String>,
    /// Fix quality (0=none, 1=GPS, 2=DGPS, 4=RTK fixed, 5=RTK float, 9=SBAS).
    pub fix_quality: Option<u8>,
    /// Number of satellites used in fix.
    pub satellite_count: Option<u8>,
    /// Horizontal Dilution of Precision.
    pub hdop: Option<f64>,
    /// Raw GGA altitude above mean sea level; interpret only with `altitude_units`.
    pub altitude: Option<f64>,
    /// Unit token supplied by the receiver; never defaulted.
    pub altitude_units: Option<String>,
    /// Raw GGA geoid separation; interpret only with `geoid_units`.
    pub geoid_separation: Option<f64>,
    /// Unit token supplied by the receiver; never defaulted.
    pub geoid_units: Option<String>,
    /// DGPS age (seconds, null if not DGPS).
    pub dgps_age: Option<f64>,
    /// DGPS station ID.
    pub dgps_station: Option<String>,
}

/// GSA — Satellites and DOP.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GSAData {
    /// Auto selection (M=manual, A=auto).
    pub mode: Option<String>,
    /// Fix type (1=none, 2=2D, 3=3D).
    pub fix_type: Option<u8>,
    /// Satellite PRN numbers used in fix (up to 12).
    pub satellites_used: Vec<String>,
    /// PDOP.
    pub pdop: Option<f64>,
    /// HDOP.
    pub hdop: Option<f64>,
    /// VDOP.
    pub vdop: Option<f64>,
}

/// GSV — Satellites in View.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GSVData {
    /// Total number of GSV sentences in this group.
    pub total_sentences: u8,
    /// This sentence number (1-based).
    pub sentence_number: u8,
    /// Total satellites in view.
    pub satellites_in_view: u8,
    /// Satellite data for this sentence (up to 4 per sentence).
    pub satellites: Vec<GSVSatellite>,
}

/// A single satellite in a GSV sentence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GSVSatellite {
    /// PRN number.
    pub prn: u8,
    /// Elevation (degrees, 0-90).
    pub elevation: u8,
    /// Azimuth (degrees, 0-359).
    pub azimuth: u16,
    /// Signal-to-noise ratio (dB-Hz, 0 if not tracked).
    pub snr: u8,
    /// Talker ID prefix to determine constellation (G=GPS, R=GLONASS, E=Galileo, etc.).
    pub constellation: String,
}

/// RMC — Recommended Minimum.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RMCData {
    /// UTC time.
    pub time: String,
    /// Status (A=active/valid, V=void/invalid).
    pub status: String,
    /// Latitude (DDMM.MMMMM).
    pub latitude: f64,
    pub lat_dir: String,
    /// Longitude (DDDMM.MMMMM).
    pub longitude: f64,
    pub lon_dir: String,
    /// Speed over ground (knots).
    pub speed_knots: f64,
    /// Track made good (degrees true).
    pub course_deg: f64,
    /// Date (DDMMYY).
    pub date: String,
    /// Magnetic variation (degrees, E/W).
    pub mag_variation: Option<f64>,
    pub mag_var_dir: Option<String>,
}

/// VTG — Track Made Good and Ground Speed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VTGData {
    /// Course over ground (degrees true).
    pub course_true: f64,
    /// Course over ground (degrees magnetic).
    pub course_magnetic: Option<f64>,
    /// Speed over ground (knots).
    pub speed_knots: f64,
    /// Speed over ground (km/h).
    pub speed_kmh: f64,
}

/// ZDA — Time and Date.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZDAData {
    /// UTC time (hhmmss.ss).
    pub time: String,
    /// Day (01-31).
    pub day: u8,
    /// Month (01-12).
    pub month: u8,
    /// Year (e.g., 2026).
    pub year: u16,
    /// Local zone offset hours.
    pub local_zone_hours: Option<i8>,
    /// Local zone offset minutes.
    pub local_zone_minutes: Option<u8>,
}

/// GST — Pseudorange Error Statistics (u-blox / Septentrio specific).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GSTData {
    /// UTC time.
    pub time: String,
    /// RMS value of the pseudorange residuals (meters).
    pub rms_range: f64,
    /// Standard deviation of the semi-major axis of error ellipse (meters).
    pub std_major: f64,
    /// Standard deviation of the semi-minor axis of error ellipse (meters).
    pub std_minor: f64,
    /// Orientation of the semi-major axis (degrees, clockwise from north).
    pub azimuth_major: f64,
    /// Standard deviation of latitude error (meters).
    pub std_latitude: f64,
    /// Standard deviation of longitude error (meters).
    pub std_longitude: f64,
    /// Standard deviation of height error (meters).
    pub std_height: f64,
}

// ─── NMEA Parser ─────────────────────────────────────────────────

/// Parse a single NMEA sentence string (including the $ prefix and *checksum).
/// Returns None if the sentence is malformed or checksum fails.
pub fn parse_nmea(sentence: &str) -> Option<NmeaSentence> {
    let sentence = sentence.trim();

    // Must start with $
    if !sentence.starts_with('$') {
        return None;
    }

    let body = &sentence[1..];

    // Split at * for checksum
    let (payload, checksum_hex) = if let Some(star_pos) = body.find('*') {
        (&body[..star_pos], &body[star_pos + 1..])
    } else {
        (body, "")
    };

    // Verify checksum (XOR of all chars between $ and *)
    if !checksum_hex.is_empty() {
        let expected_checksum = payload.bytes().fold(0u8, |acc, b| acc ^ b);
        let provided = u8::from_str_radix(checksum_hex, 16).ok();
        if Some(expected_checksum) != provided {
            return None;
        }
    }

    // Split fields
    let fields: Vec<&str> = payload.split(',').collect();
    if fields.len() < 2 {
        return None;
    }

    // Talker ID + sentence type (e.g., "GPGGA" → talker="GP", type="GGA")
    let talker_sentence = fields[0];
    if !talker_sentence.is_ascii() || talker_sentence.len() < 5 {
        return None;
    }
    let talker = talker_sentence[..2].to_string();
    let sentence_type = talker_sentence[2..].to_string();

    let timestamp = if fields.len() > 1 {
        fields[1].to_string()
    } else {
        String::new()
    };

    let data = match sentence_type.as_str() {
        "GGA" => parse_gga(&fields)?,
        "GSA" => parse_gsa(&fields)?,
        "GSV" => parse_gsv(&fields, &talker),
        "RMC" => parse_rmc(&fields, &talker),
        "VTG" => parse_vtg(&fields),
        "ZDA" => parse_zda(&fields),
        "GST" => parse_gst(&fields),
        _ => NmeaData::Unknown {
            fields: fields.iter().map(|s| s.to_string()).collect(),
        },
    };

    Some(NmeaSentence {
        talker,
        sentence_type,
        timestamp,
        raw: sentence.to_string(),
        data,
    })
}

/// Parse a stream of NMEA sentences (one per line). Handles both \r\n and \n.
pub fn parse_nmea_stream(data: &str) -> Vec<NmeaSentence> {
    data.lines().filter_map(|line| parse_nmea(line)).collect()
}

// ─── Individual sentence parsers ──────────────────────────────────

fn parse_gga(fields: &[&str]) -> Option<NmeaData> {
    if fields.len() < 15 {
        return None;
    }

    let time = fields.get(1).map(|s| s.to_string()).unwrap_or_default();
    let (latitude, lat_dir) =
        parse_gga_coordinate(fields.get(2).copied(), fields.get(3).copied(), 2, 90)?;
    let (longitude, lon_dir) =
        parse_gga_coordinate(fields.get(4).copied(), fields.get(5).copied(), 3, 180)?;
    if latitude.is_some() != longitude.is_some() {
        return None;
    }

    let fix_quality = parse_optional_u8(fields.get(6).copied())?;
    if fix_quality.is_some_and(|quality| quality > 9) {
        return None;
    }
    let satellite_count = parse_optional_u8(fields.get(7).copied())?;
    if satellite_count.is_some_and(|count| count > 99) {
        return None;
    }
    let hdop = parse_optional_f64(fields.get(8).copied())?;
    if hdop.is_some_and(|value| value < 0.0) {
        return None;
    }
    let altitude = parse_optional_f64(fields.get(9).copied())?;
    let altitude_units = optional_token(fields.get(10).copied());
    let geoid_separation = parse_optional_f64(fields.get(11).copied())?;
    let geoid_units = optional_token(fields.get(12).copied());
    let dgps_age = parse_optional_f64(fields.get(13).copied())?;
    if dgps_age.is_some_and(|value| value < 0.0) {
        return None;
    }
    let dgps_station = optional_token(fields.get(14).copied());

    Some(NmeaData::GGA(GGAData {
        time,
        latitude,
        lat_dir,
        longitude,
        lon_dir,
        fix_quality,
        satellite_count,
        hdop,
        altitude,
        altitude_units,
        geoid_separation,
        geoid_units,
        dgps_age,
        dgps_station,
    }))
}

fn parse_gsa(fields: &[&str]) -> Option<NmeaData> {
    if fields.len() < 18 {
        return None;
    }

    let mode = optional_token(fields.get(1).copied());
    let fix_type = parse_optional_u8(fields.get(2).copied())?;
    if fix_type.is_some_and(|value| !(1..=3).contains(&value)) {
        return None;
    }
    let mut satellites_used = Vec::new();
    for i in 3..=14 {
        if let Some(raw_prn) = fields
            .get(i)
            .copied()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            if !raw_prn.bytes().all(|byte| byte.is_ascii_digit()) {
                return None;
            }
            if raw_prn.bytes().any(|byte| byte != b'0') {
                satellites_used.push(raw_prn.to_string());
            }
        }
    }
    let pdop = parse_optional_f64(fields.get(15).copied())?;
    let hdop = parse_optional_f64(fields.get(16).copied())?;
    let vdop = parse_optional_f64(fields.get(17).copied())?;
    if [pdop, hdop, vdop]
        .into_iter()
        .flatten()
        .any(|value| value < 0.0)
    {
        return None;
    }

    Some(NmeaData::GSA(GSAData {
        mode,
        fix_type,
        satellites_used,
        pdop,
        hdop,
        vdop,
    }))
}

fn parse_gsv(fields: &[&str], talker: &str) -> NmeaData {
    let total_sentences = fields.get(1).and_then(|s| s.parse().ok()).unwrap_or(1);
    let sentence_number = fields.get(2).and_then(|s| s.parse().ok()).unwrap_or(1);
    let satellites_in_view = fields.get(3).and_then(|s| s.parse().ok()).unwrap_or(0);

    let mut satellites = Vec::new();
    let constellation = talker_to_constellation(talker);

    // Each GSV sentence has up to 4 satellites, starting at field index 4
    for i in 0..4 {
        let base = 4 + i * 4;
        if fields.len() <= base {
            break;
        }
        let prn = fields.get(base).and_then(|s| s.parse().ok()).unwrap_or(0);
        if prn == 0 {
            continue;
        }
        let elevation = fields
            .get(base + 1)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let azimuth = fields
            .get(base + 2)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let snr = fields
            .get(base + 3)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);

        satellites.push(GSVSatellite {
            prn,
            elevation,
            azimuth,
            snr,
            constellation: constellation.clone(),
        });
    }

    NmeaData::GSV(GSVData {
        total_sentences,
        sentence_number,
        satellites_in_view,
        satellites,
    })
}

fn parse_rmc(fields: &[&str], talker: &str) -> NmeaData {
    let time = fields.get(1).map(|s| s.to_string()).unwrap_or_default();
    let status = fields.get(2).map(|s| s.to_string()).unwrap_or_default();
    let (lat, lat_dir) = parse_coord(fields.get(3), fields.get(4));
    let (lon, lon_dir) = parse_coord(fields.get(5), fields.get(6));
    let speed_knots = fields.get(7).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let course_deg = fields.get(8).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let date = fields.get(9).map(|s| s.to_string()).unwrap_or_default();
    let mag_variation = fields.get(10).and_then(|s| s.parse().ok());
    let mag_var_dir = fields
        .get(11)
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());

    NmeaData::RMC(RMCData {
        time,
        status,
        latitude: lat,
        lat_dir,
        longitude: lon,
        lon_dir,
        speed_knots,
        course_deg,
        date,
        mag_variation,
        mag_var_dir,
    })
}

fn parse_vtg(fields: &[&str]) -> NmeaData {
    let course_true = fields.get(1).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let course_magnetic = fields.get(3).and_then(|s| s.parse().ok());
    let speed_knots = fields.get(5).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let speed_kmh = fields.get(7).and_then(|s| s.parse().ok()).unwrap_or(0.0);

    NmeaData::VTG(VTGData {
        course_true,
        course_magnetic,
        speed_knots,
        speed_kmh,
    })
}

fn parse_zda(fields: &[&str]) -> NmeaData {
    let time = fields.get(1).map(|s| s.to_string()).unwrap_or_default();
    let day = fields.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
    let month = fields.get(3).and_then(|s| s.parse().ok()).unwrap_or(0);
    let year = fields.get(4).and_then(|s| s.parse().ok()).unwrap_or(0);
    let local_zone_hours = fields.get(5).and_then(|s| s.parse().ok());
    let local_zone_minutes = fields.get(6).and_then(|s| s.parse().ok());

    NmeaData::ZDA(ZDAData {
        time,
        day,
        month,
        year,
        local_zone_hours,
        local_zone_minutes,
    })
}

fn parse_gst(fields: &[&str]) -> NmeaData {
    let time = fields.get(1).map(|s| s.to_string()).unwrap_or_default();
    let rms_range = fields.get(2).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let std_major = fields.get(3).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let std_minor = fields.get(4).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let azimuth_major = fields.get(5).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let std_latitude = fields.get(6).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let std_longitude = fields.get(7).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let std_height = fields.get(8).and_then(|s| s.parse().ok()).unwrap_or(0.0);

    NmeaData::GST(GSTData {
        time,
        rms_range,
        std_major,
        std_minor,
        azimuth_major,
        std_latitude,
        std_longitude,
        std_height,
    })
}

// ─── Helpers ──────────────────────────────────────────────────────

fn optional_token(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn parse_optional_f64(value: Option<&str>) -> Option<Option<f64>> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Some(None);
    };
    let unsigned = value
        .strip_prefix('+')
        .or_else(|| value.strip_prefix('-'))
        .unwrap_or(value);
    let mut has_digit = false;
    let mut has_decimal_point = false;
    for byte in unsigned.bytes() {
        if byte.is_ascii_digit() {
            has_digit = true;
        } else if byte == b'.' && !has_decimal_point {
            has_decimal_point = true;
        } else {
            return None;
        }
    }
    if !has_digit {
        return None;
    }
    let parsed = value.parse::<f64>().ok()?;
    parsed.is_finite().then_some(Some(parsed))
}

fn parse_optional_u8(value: Option<&str>) -> Option<Option<u8>> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Some(None);
    };
    if !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    value.parse::<u8>().ok().map(Some)
}

/// Parse one GGA coordinate field. Empty value and direction together mean unavailable.
fn parse_gga_coordinate(
    value: Option<&str>,
    direction: Option<&str>,
    degree_digits: usize,
    maximum_degrees: u16,
) -> Option<(Option<f64>, Option<String>)> {
    let value = value.unwrap_or("").trim();
    let direction = direction.unwrap_or("").trim();
    if value.is_empty() {
        return direction.is_empty().then_some((None, None));
    }

    let (integer, fraction) = match value.split_once('.') {
        Some((integer, fraction)) if !fraction.is_empty() && !fraction.contains('.') => {
            (integer, fraction)
        }
        Some(_) => return None,
        None => (value, "0"),
    };
    if integer.len() != degree_digits + 2
        || !integer.bytes().all(|byte| byte.is_ascii_digit())
        || !fraction.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }

    let degrees = integer[..degree_digits].parse::<u16>().ok()?;
    let minutes = format!("{}.{}", &integer[degree_digits..], fraction)
        .parse::<f64>()
        .ok()?;
    if degrees > maximum_degrees || minutes >= 60.0 || (degrees == maximum_degrees && minutes > 0.0)
    {
        return None;
    }

    let negative = match direction {
        "N" | "E" => false,
        "S" | "W" => true,
        _ => return None,
    };
    if (degree_digits == 2 && !matches!(direction, "N" | "S"))
        || (degree_digits == 3 && !matches!(direction, "E" | "W"))
    {
        return None;
    }

    let decimal = f64::from(degrees) + minutes / 60.0;
    Some((
        Some(if negative { -decimal } else { decimal }),
        Some(direction.to_string()),
    ))
}

/// Parse NMEA coordinate (DDMM.MMMMM + N/S or DDDMM.MMMMM + E/W) to decimal degrees.
fn parse_coord(val: Option<&&str>, dir: Option<&&str>) -> (f64, String) {
    let coord_str = val.unwrap_or(&"");
    let dir_str = dir.unwrap_or(&"").to_string();

    if coord_str.is_empty() {
        return (0.0, dir_str);
    }

    // NMEA format: DDMM.MMMMM or DDDMM.MMMMM
    let parts: Vec<&str> = coord_str.split('.').collect();
    let integer_part = parts.first().copied().unwrap_or("0");

    // Split degrees and minutes
    let (deg_str, min_str) = if integer_part.len() > 4 {
        // Longitude: DDDMM.MMMMM → 3 degrees + 2+ minutes
        let (d, m) = integer_part.split_at(3);
        (d, format!("{}.{}", m, parts.get(1).copied().unwrap_or("0")))
    } else {
        // Latitude: DDMM.MMMMM → 2 degrees + 2+ minutes
        let (d, m) = integer_part.split_at(2);
        (d, format!("{}.{}", m, parts.get(1).copied().unwrap_or("0")))
    };

    let degrees: f64 = deg_str.parse().unwrap_or(0.0);
    let minutes: f64 = min_str.parse().unwrap_or(0.0);

    let mut decimal = degrees + minutes / 60.0;

    // Apply direction
    if dir_str == "S" || dir_str == "W" {
        decimal = -decimal;
    }

    (decimal, dir_str)
}

/// Map talker ID to constellation name.
fn talker_to_constellation(talker: &str) -> String {
    match talker {
        "GP" => "GPS".to_string(),
        "GL" => "GLONASS".to_string(),
        "GA" => "Galileo".to_string(),
        "GB" | "BD" => "BeiDou".to_string(),
        "GQ" => "QZSS".to_string(),
        "GI" => "IRNSS".to_string(),
        "GN" => "Multi".to_string(),
        "GA" => "Galileo".to_string(),
        _ => "Unknown".to_string(),
    }
}

// ─── Tests ────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_gga_rtk_fixed() {
        // Nairobi: 1°17'S, 36°49'E, RTK fixed, 12 satellites
        let sentence =
            "$GPGGA,061530.00,0117.12345,S,03649.67890,E,4,12,0.8,1612.5,M,-34.2,M,1.0,1234*XX";
        // Compute correct checksum
        let payload =
            "GPGGA,061530.00,0117.12345,S,03649.67890,E,4,12,0.8,1612.5,M,-34.2,M,1.0,1234";
        let checksum = payload.bytes().fold(0u8, |acc, b| acc ^ b);
        let valid_sentence = format!("${}*{:02X}", payload, checksum);

        let parsed = parse_nmea(&valid_sentence).unwrap();
        assert_eq!(parsed.talker, "GP");
        assert_eq!(parsed.sentence_type, "GGA");

        if let NmeaData::GGA(gga) = parsed.data {
            assert_eq!(gga.fix_quality, Some(4)); // RTK fixed
            assert_eq!(gga.satellite_count, Some(12));
            assert!((gga.hdop.unwrap() - 0.8).abs() < 0.01);
            assert!((gga.altitude.unwrap() - 1612.5).abs() < 0.1);
            assert_eq!(gga.altitude_units.as_deref(), Some("M"));
            assert_eq!(gga.geoid_separation, Some(-34.2));
            assert_eq!(gga.geoid_units.as_deref(), Some("M"));
            assert!(gga.latitude.unwrap() < 0.0);
            assert!(gga.longitude.unwrap() > 0.0);
        } else {
            panic!("Expected GGA data");
        }
    }

    #[test]
    fn test_gga_preserves_missing_fields_and_explicit_zero() {
        let no_fix_fields = [
            "GPGGA",
            "061530.00",
            "",
            "",
            "",
            "",
            "0",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
        ];
        let no_fix = parse_nmea(&format!("${}", no_fix_fields.join(","))).unwrap();
        if let NmeaData::GGA(gga) = no_fix.data {
            assert_eq!(gga.fix_quality, Some(0));
            assert_eq!(gga.latitude, None);
            assert_eq!(gga.longitude, None);
            assert_eq!(gga.lat_dir, None);
            assert_eq!(gga.lon_dir, None);
            assert_eq!(gga.satellite_count, None);
            assert_eq!(gga.hdop, None);
            assert_eq!(gga.altitude, None);
            assert_eq!(gga.altitude_units, None);
            assert_eq!(gga.geoid_separation, None);
            assert_eq!(gga.geoid_units, None);
            assert_eq!(gga.dgps_age, None);
            assert_eq!(gga.dgps_station, None);
        } else {
            panic!("Expected GGA data");
        }

        let zero_fields = [
            "GPGGA",
            "061530.00",
            "0000.0000",
            "N",
            "00000.0000",
            "E",
            "1",
            "0",
            "0.0",
            "0.0",
            "M",
            "0.0",
            "M",
            "0.0",
            "0",
        ];
        let zero = parse_nmea(&format!("${}", zero_fields.join(","))).unwrap();
        if let NmeaData::GGA(gga) = zero.data {
            assert_eq!(gga.latitude, Some(0.0));
            assert_eq!(gga.longitude, Some(0.0));
            assert_eq!(gga.satellite_count, Some(0));
            assert_eq!(gga.hdop, Some(0.0));
            assert_eq!(gga.altitude, Some(0.0));
            assert_eq!(gga.geoid_separation, Some(0.0));
            assert_eq!(gga.dgps_age, Some(0.0));
            assert_eq!(gga.altitude_units.as_deref(), Some("M"));
            assert_eq!(gga.geoid_units.as_deref(), Some("M"));
        } else {
            panic!("Expected GGA data");
        }
    }

    #[test]
    fn test_gga_rejects_malformed_numeric_and_partial_coordinates() {
        let mut fields = vec![
            "GPGGA",
            "061530.00",
            "0117.12345",
            "S",
            "03649.67890",
            "E",
            "4",
            "12",
            "bad",
            "1612.5",
            "M",
            "-34.2",
            "M",
            "1.0",
            "1234",
        ];
        assert!(parse_nmea(&format!("${}", fields.join(","))).is_none());

        fields[8] = "0.8";
        fields[2] = "9960.0";
        assert!(parse_nmea(&format!("${}", fields.join(","))).is_none());

        fields[2] = "0117.12345";
        fields[4] = "";
        fields[5] = "";
        assert!(parse_nmea(&format!("${}", fields.join(","))).is_none());

        fields[4] = "03649.67890";
        fields[5] = "N";
        assert!(parse_nmea(&format!("${}", fields.join(","))).is_none());
    }

    #[test]
    fn test_integer_nmea_fields_reject_signed_tokens() {
        assert_eq!(parse_optional_u8(Some("0")), Some(Some(0)));
        assert_eq!(parse_optional_u8(Some("+1")), None);
        assert_eq!(parse_optional_u8(Some("-1")), None);
    }

    #[test]
    fn test_non_ascii_talker_is_rejected_without_panicking() {
        assert!(parse_nmea("$éPGGA,061530.00,,,,,0,,,,,,,,").is_none());
    }

    #[test]
    fn test_parse_gsa() {
        let sentence = "$GPGSA,M,3,01,12,07,24,29,31,05,18,21,,,,2.1,1.2,1.7*XX";
        let payload = "GPGSA,M,3,01,12,07,24,29,31,05,18,21,,,,2.1,1.2,1.7";
        let checksum = payload.bytes().fold(0u8, |acc, b| acc ^ b);
        let valid = format!("${}*{:02X}", payload, checksum);

        let parsed = parse_nmea(&valid).unwrap();
        if let NmeaData::GSA(gsa) = parsed.data {
            assert_eq!(gsa.fix_type, Some(3)); // 3D fix
            assert_eq!(gsa.satellites_used.len(), 9);
            assert!((gsa.pdop.unwrap() - 2.1).abs() < 0.01);
            assert!((gsa.hdop.unwrap() - 1.2).abs() < 0.01);
            assert!((gsa.vdop.unwrap() - 1.7).abs() < 0.01);
        } else {
            panic!("Expected GSA data");
        }
    }

    #[test]
    fn test_gsa_preserves_empty_dop_and_zero_values() {
        let fields = [
            "GPGSA", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
        ];
        let parsed = parse_nmea(&format!("${}", fields.join(","))).unwrap();
        if let NmeaData::GSA(gsa) = parsed.data {
            assert_eq!(gsa.mode, None);
            assert_eq!(gsa.fix_type, None);
            assert_eq!(gsa.pdop, None);
            assert_eq!(gsa.hdop, None);
            assert_eq!(gsa.vdop, None);
        } else {
            panic!("Expected GSA data");
        }

        let mut zero_fields = vec!["GPGSA", "A", "1"];
        zero_fields.extend(std::iter::repeat("").take(12));
        zero_fields.extend(["0.0", "0.0", "0.0"]);
        let parsed = parse_nmea(&format!("${}", zero_fields.join(","))).unwrap();
        if let NmeaData::GSA(gsa) = parsed.data {
            assert_eq!(gsa.fix_type, Some(1));
            assert_eq!(gsa.pdop, Some(0.0));
            assert_eq!(gsa.hdop, Some(0.0));
            assert_eq!(gsa.vdop, Some(0.0));
        } else {
            panic!("Expected GSA data");
        }
    }

    #[test]
    fn test_gsa_rejects_malformed_dop() {
        let mut fields = vec!["GPGSA", "A", "3", "01"];
        fields.extend(std::iter::repeat("").take(11));
        fields.extend(["not-a-number", "1.0", "1.0"]);
        assert!(parse_nmea(&format!("${}", fields.join(","))).is_none());
    }

    #[test]
    fn test_parse_gsv_satellites() {
        let sentence = "$GPGSV,3,1,12,01,45,120,42,12,72,045,38,07,30,200,40,24,15,310,35*XX";
        let payload = "GPGSV,3,1,12,01,45,120,42,12,72,045,38,07,30,200,40,24,15,310,35";
        let checksum = payload.bytes().fold(0u8, |acc, b| acc ^ b);
        let valid = format!("${}*{:02X}", payload, checksum);

        let parsed = parse_nmea(&valid).unwrap();
        if let NmeaData::GSV(gsv) = parsed.data {
            assert_eq!(gsv.total_sentences, 3);
            assert_eq!(gsv.sentence_number, 1);
            assert_eq!(gsv.satellites_in_view, 12);
            assert_eq!(gsv.satellites.len(), 4);
            assert_eq!(gsv.satellites[0].prn, 1);
            assert_eq!(gsv.satellites[0].elevation, 45);
            assert_eq!(gsv.satellites[0].azimuth, 120);
            assert_eq!(gsv.satellites[0].snr, 42);
        } else {
            panic!("Expected GSV data");
        }
    }

    #[test]
    fn test_parse_rmc() {
        // RMC format: time, status, lat, lat_dir, lon, lon_dir, speed, course, date, mag_var, mag_var_dir, mode
        let payload = "GNRMC,061530.00,A,0117.12345,S,03649.67890,E,0.5,45.2,190826,,,A";
        let checksum = payload.bytes().fold(0u8, |acc, b| acc ^ b);
        let valid = format!("${}*{:02X}", payload, checksum);

        let parsed = parse_nmea(&valid).unwrap();
        assert_eq!(parsed.talker, "GN");
        if let NmeaData::RMC(rmc) = parsed.data {
            assert_eq!(rmc.status, "A");
            assert!((rmc.speed_knots - 0.5).abs() < 0.01);
            assert_eq!(rmc.date, "190826");
        } else {
            panic!("Expected RMC data");
        }
    }

    #[test]
    fn test_checksum_failure() {
        // Bad checksum
        let parsed = parse_nmea(
            "$GPGGA,061530.00,0117.12345,S,03649.67890,E,4,12,0.8,1612.5,M,-34.2,M,1.0,1234*FF",
        );
        assert!(parsed.is_none());
    }

    #[test]
    fn test_parse_nmea_stream() {
        // Build a stream with valid checksums
        let gga_payload =
            "GPGGA,061530.00,0117.12345,S,03649.67890,E,4,12,0.8,1612.5,M,-34.2,M,1.0,1234";
        let gga_cs = gga_payload.bytes().fold(0u8, |acc, b| acc ^ b);
        let gsa_payload = "GPGSA,M,3,01,12,07,24,29,31,05,18,21,,,,2.1,1.2,1.7";
        let gsa_cs = gsa_payload.bytes().fold(0u8, |acc, b| acc ^ b);
        let stream = format!(
            "${}*{:02X}\r\n${}*{:02X}\r\n\r\n",
            gga_payload, gga_cs, gsa_payload, gsa_cs
        );
        let parsed = parse_nmea_stream(&stream);
        assert!(parsed.len() >= 2); // At least GGA and GSA should parse
    }

    #[test]
    fn test_latitude_longitude_conversion() {
        // DDMM.MMMMM format
        let (lat, _) = parse_coord(Some(&"0117.12345"), Some(&"S"));
        // 1 degree + 17.12345 minutes = 1 + 17.12345/60 ≈ 1.2853908
        assert!((lat - (-1.2853908)).abs() < 0.00001);

        let (lon, _) = parse_coord(Some(&"03649.67890"), Some(&"E"));
        // 36 degrees + 49.67890 minutes = 36 + 49.67890/60 ≈ 36.82798
        assert!((lon - 36.82798).abs() < 0.00001);
    }
}
