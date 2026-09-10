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
mod import;
mod instrument;
mod mavsdk;
mod ml;
mod odm;
mod protocol;

use anyhow::Result;
use protocol::{read_message, write_message, write_notification, Notification, Response};
use std::io::{self, BufReader, BufWriter, Write};
use tokio::sync::broadcast;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

/// Channel for background instrument threads to push notifications to the
/// main stdout writer. The main loop selects between stdin reads and
/// broadcast receiver, writing any notifications to stdout.
pub type NotificationSender = broadcast::Sender<Notification>;
pub type NotificationReceiver = broadcast::Receiver<Notification>;

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
    let stdout = io::stdout();
    let mut writer = BufWriter::new(stdout.lock());

    // Broadcast channel for streaming notifications (instrument events).
    let (notif_tx, _) = broadcast::channel::<Notification>(256);
    let mut notif_rx = notif_tx.subscribe();

    let dispatcher = dispatcher::Dispatcher::new(notif_tx.clone());

    let (req_tx, mut req_rx) = tokio::sync::mpsc::channel::<Result<Option<protocol::Request>>>(32);
    tokio::task::spawn_blocking(move || {
        let stdin = io::stdin();
        let mut reader = BufReader::new(stdin.lock());
        loop {
            match read_message(&mut reader) {
                Ok(Some(req)) => {
                    if req_tx.blocking_send(Ok(Some(req))).is_err() {
                        break;
                    }
                }
                Ok(None) => {
                    let _ = req_tx.blocking_send(Ok(None)); // Signal EOF
                    break;
                }
                Err(e) => {
                    if req_tx.blocking_send(Err(e)).is_err() {
                        break;
                    }
                }
            }
        }
    });

    // Main loop: read request, dispatch, write response, and forward
    // any streaming notifications to stdout.
    loop {
        tokio::select! {
            // Branch 1: incoming request from the main process.
            req_opt = req_rx.recv() => {
                match req_opt {
                    Some(Ok(Some(req))) => {
                        info!(method = %req.method, id = %req.id, "dispatching request");
                        let resp = dispatcher.dispatch(req).await;
                        if let Err(e) = write_message(&mut writer, &resp) {
                            error!(error = %e, "Failed to write response, exiting");
                            break;
                        }
                    }
                    Some(Ok(None)) => {
                        info!("stdin EOF received, shutting down");
                        drop(notif_tx);
                        break;
                    }
                    Some(Err(e)) => {
                        error!(error = %e, "Failed to read message");
                        let resp = Response::err("unknown".into(), "READ_ERROR", &e.to_string());
                        if let Err(write_err) = write_message(&mut writer, &resp) {
                            error!(error = %write_err, "Failed to write error response, exiting");
                            break;
                        }
                    }
                    None => {
                        // req_rx closed
                        break;
                    }
                }
            }
            // Branch 2: streaming notification from a background instrument thread.
            notif_result = notif_rx.recv() => {
                match notif_result {
                    Ok(notif) => {
                        if let Err(e) = write_notification(&mut writer, &notif) {
                            error!(error = %e, "Failed to write notification, exiting");
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        warn!(dropped = n, "Notification receiver lagged, dropped notifications");
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        // All senders dropped — background tasks done. Continue
                        // processing requests until stdin EOF.
                    }
                }
            }
        }
    }

    // Flush any buffered output before exiting.
    writer.flush()?;
    info!("MetaRDU sidecar shut down cleanly");
    Ok(())
}
