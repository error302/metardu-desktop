//! Instrument data import — Rust sidecar parsers.
//!
//! The TS engine (`packages/engine/src/import/instrument-import.ts`) handles
//! Leica GSI, Sokkia SDR, and Trimble DC/JOB — those are simple text formats
//! that the engine can parse synchronously. RINEX, however, can be very large
//! and has binary variants (RINEX 3 → Compact RINEX / Hatanaka), so epoch
//! parsing lives here in the sidecar per ADR-0005 invariant A1 (heavy math
//! in Rust).
//!
//! Wire format: the engine calls this via `sidecar.call("import.rinex_epochs", { content })`
//! after the TS layer has already parsed the header. This handler parses only
//! the body (epochs after `END OF HEADER`).
//!
//! References:
//!   - RINEX 3.04: https://files.igs.org/pub/data/format/rinex304.pdf
//!   - RINEX 2.11: https://files.igs.org/pub/data/format/rinex211.txt

pub mod rinex;
pub mod point_cloud;

// Only the handler is needed by the dispatcher; types are reachable via
// `crate::import::rinex::*` from tests.
pub use rinex::handle_rinex_epochs;
pub use point_cloud::{
    handle_point_cloud_header_inspection, handle_point_cloud_record_inspection,
};
