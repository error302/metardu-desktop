//! MetaRDU Sidecar — length-prefixed JSON protocol over stdin/stdout.
//!
//! Wire format:
//!   <4-byte big-endian length><UTF-8 JSON payload>
//!
//! Each message is a `Request` envelope:
//!   { "id": "<uuid>", "method": "<handler_name>", "params": <any json> }
//!
//! Response is a `Response` envelope:
//!   { "id": "<uuid>", "ok": true,  "result": <any json> }
//!   { "id": "<uuid>", "ok": false, "error": { "code": "<str>", "message": "<str>" } }
//!
//! Logs go to stderr only (never stdout), so they don't corrupt the protocol.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};
use tracing::{debug, error, info, instrument};

/// Unique request identifier (string, not UUID yet — keep deps minimal).
pub type RequestId = String;

/// Incoming request envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    pub id: RequestId,
    pub method: String,
    #[serde(default = "default_params")]
    pub params: serde_json::Value,
}

fn default_params() -> serde_json::Value {
    serde_json::Value::Null
}

/// Outgoing response envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Response {
    pub id: RequestId,
    #[serde(flatten)]
    pub payload: ResponsePayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ResponsePayload {
    Ok { ok: bool, result: serde_json::Value },
    Err { ok: bool, error: ErrorPayload },
}

impl Response {
    pub fn ok(id: RequestId, result: serde_json::Value) -> Self {
        Response {
            id,
            payload: ResponsePayload::Ok { ok: true, result },
        }
    }

    pub fn err(id: RequestId, code: &str, message: &str) -> Self {
        Response {
            id,
            payload: ResponsePayload::Err {
                ok: false,
                error: ErrorPayload {
                    code: code.to_string(),
                    message: message.to_string(),
                },
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
}

/// Read a single length-prefixed message from the given reader.
///
/// Format: 4-byte big-endian length prefix + UTF-8 JSON payload.
pub fn read_message<R: Read>(reader: &mut R) -> Result<Option<Request>> {
    let mut len_buf = [0u8; 4];

    // Read exactly 4 bytes for the length prefix. If we hit EOF on the very
    // first byte, return None to signal graceful shutdown.
    match reader.read_exact(&mut len_buf[0..1]) {
        Ok(_) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(anyhow::anyhow!("Failed to read length prefix: {}", e)),
    }
    reader.read_exact(&mut len_buf[1..4])?;

    let len = u32::from_be_bytes(len_buf) as usize;

    // Sanity check: reject implausibly large messages (>256 MB) to prevent
    // memory exhaustion attacks from a compromised renderer.
    const MAX_MESSAGE_BYTES: usize = 256 * 1024 * 1024;
    if len > MAX_MESSAGE_BYTES {
        return Err(anyhow::anyhow!(
            "Message too large: {} bytes (max {})",
            len,
            MAX_MESSAGE_BYTES
        ));
    }

    let mut payload = vec![0u8; len];
    reader.read_exact(&mut payload)?;

    let req: Request = serde_json::from_slice(&payload)
        .context("Failed to deserialize request JSON")?;

    Ok(Some(req))
}

/// Write a single length-prefixed message to the given writer.
pub fn write_message<W: Write>(writer: &mut W, resp: &Response) -> Result<()> {
    let payload = serde_json::to_vec(resp).context("Failed to serialize response JSON")?;

    let len = payload.len() as u32;
    writer.write_all(&len.to_be_bytes())?;
    writer.write_all(&payload)?;
    writer.flush()?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_round_trip_ok_response() {
        let resp = Response::ok("req-1".into(), serde_json::json!({ "pong": true }));

        let mut buf = Vec::new();
        write_message(&mut buf, &resp).unwrap();

        // First 4 bytes = length prefix
        let len = u32::from_be_bytes(buf[0..4].try_into().unwrap()) as usize;
        assert_eq!(len, buf.len() - 4);

        let parsed: Response = serde_json::from_slice(&buf[4..]).unwrap();
        assert_eq!(parsed.id, "req-1");
        match parsed.payload {
            ResponsePayload::Ok { ok, result } => {
                assert!(ok);
                assert_eq!(result["pong"], true);
            }
            _ => panic!("expected Ok variant"),
        }
    }

    #[test]
    fn test_round_trip_err_response() {
        let resp = Response::err("req-2".into(), "METHOD_NOT_FOUND", "Unknown method: foo");

        let mut buf = Vec::new();
        write_message(&mut buf, &resp).unwrap();

        let parsed: Response = serde_json::from_slice(&buf[4..]).unwrap();
        assert_eq!(parsed.id, "req-2");
        match parsed.payload {
            ResponsePayload::Err { ok, error } => {
                assert!(!ok);
                assert_eq!(error.code, "METHOD_NOT_FOUND");
                assert_eq!(error.message, "Unknown method: foo");
            }
            _ => panic!("expected Err variant"),
        }
    }

    #[test]
    fn test_read_message_eof_returns_none() {
        let mut empty = Cursor::new(Vec::new());
        let result = read_message(&mut empty).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_read_message_oversized_rejected() {
        // Claim 1 GB payload but provide no bytes
        let mut bad = Cursor::new(vec![0x40, 0x00, 0x00, 0x00]); // 1 GB
        let result = read_message(&mut bad);
        assert!(result.is_err());
        let msg = format!("{}", result.unwrap_err());
        assert!(msg.contains("too large"), "msg = {}", msg);
    }

    #[test]
    fn test_request_deserialize_with_null_params() {
        let json = r#"{"id":"x","method":"ping"}"#;
        let req: Request = serde_json::from_str(json).unwrap();
        assert_eq!(req.id, "x");
        assert_eq!(req.method, "ping");
        assert!(req.params.is_null());
    }

    #[test]
    fn test_request_deserialize_with_object_params() {
        let json = r#"{"id":"y","method":"echo","params":{"msg":"hello"}}"#;
        let req: Request = serde_json::from_str(json).unwrap();
        assert_eq!(req.id, "y");
        assert_eq!(req.method, "echo");
        assert_eq!(req.params["msg"], "hello");
    }
}
