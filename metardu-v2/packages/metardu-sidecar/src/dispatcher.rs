//! MetaRDU Sidecar — method dispatch table.
//!
//! Each handler is an async function that takes `serde_json::Value` params
//! and returns `Result<serde_json::Value, HandlerError>`.

use crate::protocol::{Request, Response};
use serde_json::Value;
use std::collections::HashMap;
use tracing::{instrument, warn};

/// Handler error type — converted into a `Response::err` payload.
#[derive(Debug, thiserror::Error)]
pub enum HandlerError {
    #[error("Method not found: {0}")]
    MethodNotFound(String),

    #[error("Invalid params: {0}")]
    InvalidParams(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Not implemented yet: {0}")]
    NotImplemented(String),
}

impl HandlerError {
    pub fn code(&self) -> &'static str {
        match self {
            HandlerError::MethodNotFound(_) => "METHOD_NOT_FOUND",
            HandlerError::InvalidParams(_) => "INVALID_PARAMS",
            HandlerError::Internal(_) => "INTERNAL_ERROR",
            HandlerError::NotImplemented(_) => "NOT_IMPLEMENTED",
        }
    }
}

/// Boxed async handler function.
pub type Handler = Box<
    dyn Fn(Value) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Value, HandlerError>> + Send>>
        + Send
        + Sync,
>;

/// Registry of method name -> handler function.
pub struct Dispatcher {
    handlers: HashMap<String, Handler>,
}

impl Dispatcher {
    pub fn new() -> Self {
        let mut d = Dispatcher {
            handlers: HashMap::new(),
        };
        d.register_builtins();
        // Register list_methods separately (after builtins, so method_names() returns a complete list)
        let names = d.method_names();
        d.register("list_methods", move |_params: Value| {
            let names = names.clone();
            async move { Ok(serde_json::json!({ "methods": names })) }
        });
        d
    }

    /// Register a handler by name.
    pub fn register<F, Fut>(&mut self, name: &str, handler: F)
    where
        F: Fn(Value) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = Result<Value, HandlerError>> + Send + 'static,
    {
        self.handlers.insert(
            name.to_string(),
            Box::new(move |params| Box::pin(handler(params))),
        );
    }

    /// Dispatch a request to its handler, returning a Response.
    #[instrument(skip(self, req), fields(req_id = %req.id, method = %req.method))]
    pub async fn dispatch(&self, req: Request) -> Response {
        match self.handlers.get(&req.method) {
            Some(handler) => match handler(req.params.clone()).await {
                Ok(result) => Response::ok(req.id, result),
                Err(e) => {
                    warn!(method = %req.method, error = %e, "handler returned error");
                    Response::err(req.id, e.code(), &e.to_string())
                }
            },
            None => {
                warn!(method = %req.method, "method not found");
                Response::err(
                    req.id,
                    HandlerError::MethodNotFound(req.method.clone()).code(),
                    &HandlerError::MethodNotFound(req.method.clone()).to_string(),
                )
            }
        }
    }

    /// Register the built-in handlers (ping, echo, version, list_methods).
    fn register_builtins(&mut self) {
        // ping — health check. Returns { pong: true, ts: <unix_ms> }
        self.register("ping", |_params: Value| async move {
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            Ok(serde_json::json!({ "pong": true, "ts": ts }))
        });

        // echo — returns the params verbatim. Useful for testing the protocol.
        self.register("echo", |params: Value| async move {
            Ok(serde_json::json!({ "echoed": params }))
        });

        // version — returns sidecar version info.
        self.register("version", |_params: Value| async move {
            Ok(serde_json::json!({
                "name": env!("CARGO_PKG_NAME"),
                "version": env!("CARGO_PKG_VERSION"),
                "rust_version": "1.x",
            }))
        });

        // ---- Phase 2: MAVLink handlers (use MockDroneLink) ----
        // In production, these would use MavsdkDroneLink backed by the real mavsdk crate.

        self.register("mavlink_connect", |params: Value| async move {
            crate::mavsdk::handle_mavlink_connect(params, crate::mavsdk::get_drone_link()).await
        });

        self.register("mavlink_disconnect", |params: Value| async move {
            crate::mavsdk::handle_mavlink_disconnect(params, crate::mavsdk::get_drone_link()).await
        });

        self.register("mavlink_get_telemetry", |params: Value| async move {
            crate::mavsdk::handle_mavlink_get_telemetry(params, crate::mavsdk::get_drone_link()).await
        });

        self.register("mavlink_upload_mission", |params: Value| async move {
            crate::mavsdk::handle_mavlink_upload_mission(params, crate::mavsdk::get_drone_link()).await
        });

        self.register("mavlink_start_mission", |params: Value| async move {
            crate::mavsdk::handle_mavlink_start_mission(params, crate::mavsdk::get_drone_link()).await
        });

        self.register("mavlink_rtl", |params: Value| async move {
            crate::mavsdk::handle_mavlink_rtl(params, crate::mavsdk::get_drone_link()).await
        });

        self.register("mavlink_arm", |params: Value| async move {
            crate::mavsdk::handle_mavlink_arm(params, crate::mavsdk::get_drone_link()).await
        });

        self.register("mavlink_disarm", |params: Value| async move {
            crate::mavsdk::handle_mavlink_disarm(params, crate::mavsdk::get_drone_link()).await
        });

        self.register("odm_process", |params: Value| async move {
            crate::odm::handle_odm_process(params).await
        });

        // ---- Phase 3 placeholders ----

        self.register("ml_extract_buildings", |_params: Value| async move {
            Err(HandlerError::NotImplemented(
                "ONNX Runtime ML pipeline lands in Phase 3".into(),
            ))
        });

        // ---- GDAL contour generation (Phase 1 Month 2 — IMPLEMENTED) ----
        // Replaces the placeholder with real raster I/O via the gdal crate.
        self.register("gdal_contour", |params: Value| async move {
            crate::gdal::handle_gdal_contour(params).await
        });
    }

    /// Returns the list of all registered method names.
    /// Called by the `list_methods` handler, which must be defined separately
    /// to avoid borrow-checker issues with closures capturing `self`.
    pub fn method_names(&self) -> Vec<String> {
        let mut names: Vec<String> = self.handlers.keys().cloned().collect();
        names.sort();
        names.push("list_methods".to_string()); // list_methods itself
        names
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_ping_handler() {
        let d = Dispatcher::new();
        let req = Request {
            id: "test-1".into(),
            method: "ping".into(),
            params: Value::Null,
        };
        let resp = d.dispatch(req).await;
        assert_eq!(resp.id, "test-1");
        match resp.payload {
            crate::protocol::ResponsePayload::Ok { ok, result } => {
                assert!(ok);
                assert_eq!(result["pong"], true);
                assert!(result["ts"].as_u64().unwrap() > 0);
            }
            _ => panic!("expected Ok"),
        }
    }

    #[tokio::test]
    async fn test_echo_handler() {
        let d = Dispatcher::new();
        let req = Request {
            id: "test-2".into(),
            method: "echo".into(),
            params: serde_json::json!({ "msg": "hello" }),
        };
        let resp = d.dispatch(req).await;
        match resp.payload {
            crate::protocol::ResponsePayload::Ok { ok, result } => {
                assert!(ok);
                assert_eq!(result["echoed"]["msg"], "hello");
            }
            _ => panic!("expected Ok"),
        }
    }

    #[tokio::test]
    async fn test_unknown_method_returns_error() {
        let d = Dispatcher::new();
        let req = Request {
            id: "test-3".into(),
            method: "nonexistent".into(),
            params: Value::Null,
        };
        let resp = d.dispatch(req).await;
        match resp.payload {
            crate::protocol::ResponsePayload::Err { ok, error } => {
                assert!(!ok);
                assert_eq!(error.code, "METHOD_NOT_FOUND");
            }
            _ => panic!("expected Err"),
        }
    }

    #[tokio::test]
    async fn test_list_methods_includes_builtins() {
        let d = Dispatcher::new();
        let req = Request {
            id: "test-4".into(),
            method: "list_methods".into(),
            params: Value::Null,
        };
        let resp = d.dispatch(req).await;
        match resp.payload {
            crate::protocol::ResponsePayload::Ok { result, .. } => {
                let methods: Vec<String> = serde_json::from_value(result["methods"].clone()).unwrap();
                assert!(methods.contains(&"ping".to_string()));
                assert!(methods.contains(&"echo".to_string()));
                assert!(methods.contains(&"version".to_string()));
                assert!(methods.contains(&"list_methods".to_string()));
            }
            _ => panic!("expected Ok"),
        }
    }

    #[tokio::test]
    async fn test_mavlink_connect_with_mock_drone_link() {
        let d = Dispatcher::new();
        let req = Request {
            id: "test-5".into(),
            method: "mavlink_connect".into(),
            params: serde_json::json!({
                "connection_url": "udp://:14540",
                "baud_rate": 115200,
                "timeout_sec": 10
            }),
        };
        let resp = d.dispatch(req).await;
        match resp.payload {
            crate::protocol::ResponsePayload::Ok { ok, result } => {
                assert!(ok);
                assert_eq!(result["connected"], true);
            }
            _ => panic!("expected Ok"),
        }
    }

    #[tokio::test]
    async fn test_odm_process_validates_params() {
        let d = Dispatcher::new();
        let req = Request {
            id: "test-odm".into(),
            method: "odm_process".into(),
            params: Value::Null, // Missing required params
        };
        let resp = d.dispatch(req).await;
        match resp.payload {
            crate::protocol::ResponsePayload::Err { ok, error } => {
                assert!(!ok);
                assert_eq!(error.code, "INVALID_PARAMS");
            }
            _ => panic!("expected Err"),
        }
    }
}
