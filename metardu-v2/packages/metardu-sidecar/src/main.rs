//! MetaRDU Sidecar — main entrypoint.
//!
//! Reads length-prefixed JSON requests from stdin, dispatches them to
//! registered handlers, and writes length-prefixed JSON responses to stdout.
//! All logging goes to stderr to avoid corrupting the protocol.
//!
//! Shutdown: on EOF from stdin (renderer closed), exits cleanly with code 0.

mod adjustment;
mod cogo;
mod compute_handlers;
mod dispatcher;
mod gdal;
mod geodesy;
mod mavsdk;
mod ml;
mod odm;
mod protocol;

use anyhow::Result;
use protocol::{read_message, write_message, Response};
use std::io::{self, BufReader, BufWriter, Write};
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing to stderr only. JSON output for machine-parseable logs.
    // Overridable via RUST_LOG env var (e.g., RUST_LOG=debug).
    tracing_subscriber::fmt()
        .with_writer(io::stderr)
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with_target(false)
        .init();

    info!(
        version = env!("CARGO_PKG_VERSION"),
        "MetaRDU sidecar starting up"
    );

    // Use buffered I/O for throughput.
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = BufWriter::new(stdout.lock());

    let dispatcher = dispatcher::Dispatcher::new();

    // Main loop: read request, dispatch, write response, repeat.
    loop {
        let req = match read_message(&mut reader) {
            Ok(Some(req)) => req,
            Ok(None) => {
                // EOF on stdin — renderer closed the connection. Shut down cleanly.
                info!("stdin EOF received, shutting down");
                break;
            }
            Err(e) => {
                error!(error = %e, "Failed to read message");
                // Don't crash — try to send an error response if we can.
                // If writing also fails, then exit.
                let resp = Response::err("unknown".into(), "READ_ERROR", &e.to_string());
                if let Err(write_err) = write_message(&mut writer, &resp) {
                    error!(error = %write_err, "Failed to write error response, exiting");
                    break;
                }
                continue;
            }
        };

        info!(method = %req.method, id = %req.id, "dispatching request");
        let resp = dispatcher.dispatch(req).await;

        if let Err(e) = write_message(&mut writer, &resp) {
            error!(error = %e, "Failed to write response, exiting");
            break;
        }
    }

    // Flush any buffered output before exiting.
    writer.flush()?;
    info!("MetaRDU sidecar shut down cleanly");
    Ok(())
}
