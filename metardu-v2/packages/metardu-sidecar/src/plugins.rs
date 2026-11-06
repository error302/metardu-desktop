//! Restricted runtime for community survey tools.
//!
//! ABI v1 accepts only WebAssembly core modules with no imports. The module
//! receives one JSON value and returns one JSON value through linear memory.
//! It has no WASI, filesystem, network, process, database, instrument, or
//! project-store capability. Results are always wrapped as community draft
//! output by this host.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::OnceLock;
use wasmtime::{Config, Engine, Linker, Module, Store, StoreLimits, StoreLimitsBuilder};

const ABI_VERSION: i32 = 1;
const MAX_MODULE_BYTES: usize = 8 * 1024 * 1024;
const MAX_JSON_BYTES: usize = 4 * 1024 * 1024;
const MAX_MEMORY_BYTES: usize = 64 * 1024 * 1024;
const MAX_TABLE_ELEMENTS: usize = 10_000;
const MAX_FUEL: u64 = 100_000_000;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PluginRunRequest {
    plugin_id: String,
    plugin_version: String,
    module_base64: String,
    input: Value,
}

struct PluginStore {
    limits: StoreLimits,
}

#[derive(Debug)]
enum PluginFailure {
    Invalid(String),
    Execution(String),
}

static ENGINE: OnceLock<Result<Engine, String>> = OnceLock::new();

fn runtime_engine() -> Result<Engine, String> {
    ENGINE
        .get_or_init(|| {
            let mut config = Config::new();
            config.consume_fuel(true);
            Engine::new(&config).map_err(|error| error.to_string())
        })
        .as_ref()
        .map(Clone::clone)
        .map_err(Clone::clone)
}

fn is_valid_plugin_id(value: &str) -> bool {
    let labels: Vec<&str> = value.split('.').collect();
    labels.len() >= 2
        && labels.len() <= 8
        && labels.iter().all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && (label.as_bytes()[0].is_ascii_lowercase()
                    || label.as_bytes()[0].is_ascii_digit())
                && (label.as_bytes()[label.len() - 1].is_ascii_lowercase()
                    || label.as_bytes()[label.len() - 1].is_ascii_digit())
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
}

fn is_valid_version(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'+' | b'-'))
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn run_module(
    request: PluginRunRequest,
    module_bytes: &[u8],
    input_bytes: &[u8],
) -> Result<Value, PluginFailure> {
    if !is_valid_plugin_id(&request.plugin_id) {
        return Err(PluginFailure::Invalid(
            "Plugin ID must use reverse-domain form with lowercase ASCII labels.".into(),
        ));
    }
    if !is_valid_version(&request.plugin_version) {
        return Err(PluginFailure::Invalid(
            "Plugin version must be a short ASCII version identifier.".into(),
        ));
    }
    if module_bytes.len() > MAX_MODULE_BYTES {
        return Err(PluginFailure::Invalid(format!(
            "Plugin module exceeds the {MAX_MODULE_BYTES}-byte limit."
        )));
    }
    if module_bytes.get(..4) != Some(b"\0asm") {
        return Err(PluginFailure::Invalid(
            "Plugin must be a WebAssembly binary module.".into(),
        ));
    }
    if input_bytes.len() > MAX_JSON_BYTES {
        return Err(PluginFailure::Invalid(format!(
            "Plugin input exceeds the {MAX_JSON_BYTES}-byte JSON limit."
        )));
    }

    let engine = runtime_engine().map_err(PluginFailure::Execution)?;
    let module = Module::new(&engine, module_bytes)
        .map_err(|error| PluginFailure::Invalid(format!("Invalid WebAssembly module: {error}")))?;

    if module.imports().next().is_some() {
        return Err(PluginFailure::Invalid(
            "ABI v1 modules cannot import host functions or system interfaces.".into(),
        ));
    }

    let limits = StoreLimitsBuilder::new()
        .memory_size(MAX_MEMORY_BYTES)
        .table_elements(MAX_TABLE_ELEMENTS)
        .instances(1)
        .tables(1)
        .memories(1)
        .trap_on_grow_failure(true)
        .build();
    let mut store = Store::new(&engine, PluginStore { limits });
    store.limiter(|state| &mut state.limits);
    store
        .set_fuel(MAX_FUEL)
        .map_err(|error| PluginFailure::Execution(error.to_string()))?;

    let linker = Linker::new(&engine);
    let instance = linker.instantiate(&mut store, &module).map_err(|error| {
        PluginFailure::Execution(format!("Module initialization trapped: {error}"))
    })?;

    let abi_version = instance
        .get_typed_func::<(), i32>(&mut store, "metardu_plugin_abi_version")
        .and_then(|function| function.call(&mut store, ()))
        .map_err(|error| {
            PluginFailure::Invalid(format!("Missing or invalid ABI version export: {error}"))
        })?;
    if abi_version != ABI_VERSION {
        return Err(PluginFailure::Invalid(format!(
            "Unsupported plugin ABI version {abi_version}; this build supports {ABI_VERSION}."
        )));
    }

    let memory = instance.get_memory(&mut store, "memory").ok_or_else(|| {
        PluginFailure::Invalid("Plugin must export linear memory as `memory`.".into())
    })?;
    let allocate = instance
        .get_typed_func::<i32, i32>(&mut store, "metardu_plugin_alloc")
        .map_err(|error| {
            PluginFailure::Invalid(format!("Missing or invalid allocator export: {error}"))
        })?;
    let run = instance
        .get_typed_func::<(i32, i32), i64>(&mut store, "metardu_plugin_run")
        .map_err(|error| {
            PluginFailure::Invalid(format!("Missing or invalid run export: {error}"))
        })?;

    let input_len = i32::try_from(input_bytes.len())
        .map_err(|_| PluginFailure::Invalid("Plugin input is too large for ABI v1.".into()))?;
    let input_ptr = allocate
        .call(&mut store, input_len)
        .map_err(|error| PluginFailure::Execution(format!("Input allocation trapped: {error}")))?;
    if input_ptr < 0 {
        return Err(PluginFailure::Execution(
            "Plugin allocator returned a negative pointer.".into(),
        ));
    }
    memory
        .write(&mut store, input_ptr as usize, input_bytes)
        .map_err(|error| {
            PluginFailure::Execution(format!("Could not write plugin input: {error}"))
        })?;

    let packed_output = run
        .call(&mut store, (input_ptr, input_len))
        .map_err(|error| {
            PluginFailure::Execution(format!(
                "Plugin trapped or exceeded its fuel budget: {error}"
            ))
        })? as u64;
    let output_ptr = (packed_output >> 32) as u32 as usize;
    let output_len = (packed_output & u32::MAX as u64) as u32 as usize;
    if output_len == 0 || output_len > MAX_JSON_BYTES {
        return Err(PluginFailure::Execution(format!(
            "Plugin output length must be between 1 and {MAX_JSON_BYTES} bytes."
        )));
    }
    let output_end = output_ptr
        .checked_add(output_len)
        .ok_or_else(|| PluginFailure::Execution("Plugin output range overflowed.".into()))?;
    if output_end > memory.data_size(&store) {
        return Err(PluginFailure::Execution(
            "Plugin returned an output range outside its linear memory.".into(),
        ));
    }

    let mut output_bytes = vec![0u8; output_len];
    memory
        .read(&store, output_ptr, &mut output_bytes)
        .map_err(|error| {
            PluginFailure::Execution(format!("Could not read plugin output: {error}"))
        })?;
    let output: Value = serde_json::from_slice(&output_bytes).map_err(|error| {
        PluginFailure::Execution(format!("Plugin output is not valid JSON: {error}"))
    })?;

    Ok(json!({
        "abi_version": ABI_VERSION,
        "claimed_plugin_id": request.plugin_id,
        "plugin_version": request.plugin_version,
        "module_sha256": sha256_hex(module_bytes),
        "input_sha256": sha256_hex(input_bytes),
        "trust_state": "community-draft",
        "output": output,
    }))
}

/// Execute one community module with bounded JSON input and return a
/// host-authored provenance envelope. No module is installed or persisted.
pub fn handle_run(params: Value) -> Result<Value, crate::dispatcher::HandlerError> {
    let request: PluginRunRequest = serde_json::from_value(params)
        .map_err(|error| crate::dispatcher::HandlerError::InvalidParams(error.to_string()))?;

    let max_base64_len = MAX_MODULE_BYTES.div_ceil(3) * 4;
    if request.module_base64.len() > max_base64_len {
        return Err(crate::dispatcher::HandlerError::InvalidParams(format!(
            "Plugin module exceeds the {MAX_MODULE_BYTES}-byte limit."
        )));
    }

    let module_bytes = BASE64.decode(&request.module_base64).map_err(|error| {
        crate::dispatcher::HandlerError::InvalidParams(format!("Invalid module base64: {error}"))
    })?;
    let input_bytes = serde_json::to_vec(&request.input).map_err(|error| {
        crate::dispatcher::HandlerError::InvalidParams(format!(
            "Invalid plugin JSON input: {error}"
        ))
    })?;

    match run_module(request, &module_bytes, &input_bytes) {
        Ok(result) => Ok(result),
        Err(PluginFailure::Invalid(message)) => {
            Err(crate::dispatcher::HandlerError::InvalidParams(message))
        }
        Err(PluginFailure::Execution(message)) => {
            Err(crate::dispatcher::HandlerError::PluginExecution(message))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OK_WAT: &str = r#"
        (module
          (memory (export "memory") 1 2)
          (data (i32.const 64) "{\"ok\":true}")
          (func (export "metardu_plugin_abi_version") (result i32) (i32.const 1))
          (func (export "metardu_plugin_alloc") (param i32) (result i32) (i32.const 1024))
          (func (export "metardu_plugin_run") (param $ptr i32) (param i32) (result i64)
            (local.get $ptr)
            (i32.load8_u)
            (i32.const 123)
            (i32.eq)
            (if (result i64)
              (then (i64.const 274877906955))
              (else (i64.const 274877906955))))
        )
    "#;

    fn request_for(wat_source: &str, input: Value) -> PluginRunRequest {
        PluginRunRequest {
            plugin_id: "community.example.point-summary".into(),
            plugin_version: "0.1.0".into(),
            module_base64: BASE64.encode(wat::parse_str(wat_source).unwrap()),
            input,
        }
    }

    fn execute_test_module(wat_source: &str, input: Value) -> Result<Value, PluginFailure> {
        let request = request_for(wat_source, input);
        let bytes = BASE64.decode(&request.module_base64).unwrap();
        let input_bytes = serde_json::to_vec(&request.input).unwrap();
        run_module(request, &bytes, &input_bytes)
    }

    #[test]
    fn runs_closed_abi_module_and_host_marks_output_as_community_draft() {
        let result = execute_test_module(OK_WAT, json!({ "points": [1, 2] })).unwrap();
        assert_eq!(result["output"], json!({ "ok": true }));
        assert_eq!(result["trust_state"], "community-draft");
        assert_eq!(
            result["claimed_plugin_id"],
            "community.example.point-summary"
        );
        assert_eq!(result["abi_version"], ABI_VERSION);
        assert_eq!(result["module_sha256"].as_str().unwrap().len(), 64);
        assert_eq!(result["input_sha256"].as_str().unwrap().len(), 64);
    }

    #[test]
    fn documented_hello_surveyor_example_runs_under_abi_v1() {
        let example = include_str!("../../../examples/community-plugins/hello-surveyor.wat");
        let result = execute_test_module(example, json!({ "message": "hello" })).unwrap();
        assert_eq!(result["output"], json!({ "ok": true }));
        assert_eq!(result["trust_state"], "community-draft");
    }

    #[test]
    fn sidecar_handler_accepts_the_documented_json_request_shape() {
        let example = include_str!("../../../examples/community-plugins/hello-surveyor.wat");
        let module_bytes = wat::parse_str(example).unwrap();
        let result = handle_run(json!({
            "plugin_id": "community.example.hello-surveyor",
            "plugin_version": "0.1.0",
            "module_base64": BASE64.encode(module_bytes),
            "input": { "message": "hello" },
        }))
        .unwrap();
        assert_eq!(result["trust_state"], "community-draft");
        assert_eq!(
            result["claimed_plugin_id"],
            "community.example.hello-surveyor"
        );
    }

    #[test]
    fn rejects_any_host_or_system_import() {
        let imported = r#"
            (module
              (import "wasi_snapshot_preview1" "fd_write" (func))
              (memory (export "memory") 1)
              (func (export "metardu_plugin_abi_version") (result i32) (i32.const 1))
              (func (export "metardu_plugin_alloc") (param i32) (result i32) (i32.const 1024))
              (func (export "metardu_plugin_run") (param i32 i32) (result i64) (i64.const 274877906955)))
        "#;
        assert!(matches!(
            execute_test_module(imported, json!({})),
            Err(PluginFailure::Invalid(message)) if message.contains("cannot import")
        ));
    }

    #[test]
    fn rejects_wrong_abi_version() {
        let wrong_abi = OK_WAT.replace("(i32.const 1)", "(i32.const 2)");
        assert!(matches!(
            execute_test_module(&wrong_abi, json!({})),
            Err(PluginFailure::Invalid(message)) if message.contains("Unsupported plugin ABI version")
        ));
    }

    #[test]
    fn fuel_budget_traps_an_infinite_plugin_loop() {
        let looping = r#"
            (module
              (memory (export "memory") 1 1)
              (func (export "metardu_plugin_abi_version") (result i32) (i32.const 1))
              (func (export "metardu_plugin_alloc") (param i32) (result i32) (i32.const 1024))
              (func (export "metardu_plugin_run") (param i32 i32) (result i64)
                (loop $forever (br $forever))
                (i64.const 0)))
        "#;
        assert!(matches!(
            execute_test_module(looping, json!({})),
            Err(PluginFailure::Execution(message)) if message.contains("fuel budget")
        ));
    }

    #[test]
    fn rejects_memory_declared_above_the_runtime_limit() {
        let oversized = r#"
            (module
              (memory (export "memory") 1025)
              (func (export "metardu_plugin_abi_version") (result i32) (i32.const 1))
              (func (export "metardu_plugin_alloc") (param i32) (result i32) (i32.const 1024))
              (func (export "metardu_plugin_run") (param i32 i32) (result i64) (i64.const 274877906955)))
        "#;
        assert!(matches!(
            execute_test_module(oversized, json!({})),
            Err(PluginFailure::Execution(message)) if message.contains("memory")
        ));
    }

    #[test]
    fn rejects_tables_declared_above_the_runtime_limit() {
        let oversized = r#"
            (module
              (table 10001 funcref)
              (memory (export "memory") 1)
              (func (export "metardu_plugin_abi_version") (result i32) (i32.const 1))
              (func (export "metardu_plugin_alloc") (param i32) (result i32) (i32.const 1024))
              (func (export "metardu_plugin_run") (param i32 i32) (result i64) (i64.const 274877906955)))
        "#;
        assert!(matches!(
            execute_test_module(oversized, json!({})),
            Err(PluginFailure::Execution(message)) if message.contains("table")
        ));
    }

    #[test]
    fn rejects_output_outside_guest_memory() {
        let bad_pointer = OK_WAT.replace("274877906955", "562949953421323");
        assert!(matches!(
            execute_test_module(&bad_pointer, json!({})),
            Err(PluginFailure::Execution(message)) if message.contains("outside its linear memory")
        ));
    }

    #[test]
    fn rejects_invalid_plugin_identity() {
        let mut request = request_for(OK_WAT, json!({}));
        request.plugin_id = "Unknown Country!".into();
        let bytes = BASE64.decode(&request.module_base64).unwrap();
        let input_bytes = serde_json::to_vec(&request.input).unwrap();
        assert!(matches!(
            run_module(request, &bytes, &input_bytes),
            Err(PluginFailure::Invalid(message)) if message.contains("reverse-domain")
        ));
    }

    #[test]
    fn rejects_non_json_output() {
        let bad_json = OK_WAT.replace("{\\\"ok\\\":true}", "not-json!!!");
        assert!(matches!(
            execute_test_module(&bad_json, json!({})),
            Err(PluginFailure::Execution(message)) if message.contains("not valid JSON")
        ));
    }
}
