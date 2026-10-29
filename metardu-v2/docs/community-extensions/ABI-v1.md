# METARDU Desktop Community Module ABI v1

ABI v1 is an execution preview for developers experimenting with community survey tools. It is not yet the stable plugin SDK, package format, or project-data API. A user must select a `.wasm` module locally and provide its JSON input explicitly in the Extensions preview.

## Core module contract

The module must be a WebAssembly core module and export exactly the functions and memory listed below. ABI v1 rejects every import; there is no WASI, filesystem, network, process, database, project, or instrument capability.

| Export | Signature | Contract |
|---|---|---|
| `memory` | WebAssembly memory | One exported linear memory. Maximum 64 MiB. |
| `metardu_plugin_abi_version` | `() -> i32` | Return `1`. |
| `metardu_plugin_alloc` | `(i32 byte_length) -> i32 pointer` | Return a non-negative byte offset with enough writable memory for the input. |
| `metardu_plugin_run` | `(i32 input_pointer, i32 input_length) -> i64` | Read UTF-8 JSON input and return packed output pointer and length. |

The returned `i64` packs the unsigned output pointer in the high 32 bits and the unsigned byte length in the low 32 bits:

```text
packed = (u64(output_pointer) << 32) | u64(output_length)
```

The host writes the serialized input JSON at the pointer returned by `metardu_plugin_alloc`, then calls `metardu_plugin_run`. The output range must be inside exported memory and contain one non-empty UTF-8 JSON value. The module must not retain the input pointer after the call.

## Host limits and result handling

- Module file: at most 8 MiB.
- JSON input and output: at most 4 MiB each.
- Linear memory: at most 64 MiB; one memory and at most one table.
- Tables: at most 10,000 elements.
- Execution: at most 100,000,000 Wasmtime fuel units per run.
- Selected module bytes stay in Desktop's main-process memory for up to 15 minutes, with at most five selections cached. Restarting Desktop clears this cache.
- The host returns the claimed plugin ID and version, module and input SHA-256 digests, ABI version, output JSON, and `community-draft` trust state.
- The ID is user-entered and is **not** publisher authentication. The hash proves which bytes were executed; it does not validate the algorithm.

The UI truncates only the displayed preview for large results; it does not rewrite the result. ABI v1 does not import project files, process LAS/LAZ/COPC datasets, install packages, or write project artifacts. Do not use this preview as evidence of survey accuracy or legal acceptance.

## Tiny example

`examples/community-plugins/hello-surveyor.wat` returns a small JSON status object. With WABT installed, compile it using:

```text
wat2wasm examples/community-plugins/hello-surveyor.wat -o hello-surveyor.wasm
```

The example intentionally does no survey computation. It demonstrates only the ABI and host trust envelope.

## Next compatibility gates

Before the ABI is called stable or a plugin store is introduced, METARDU needs a reviewed SDK, package manifest and signature model, reproducible builds, malformed-module security review, cancellation and resource-isolation strategy, and Windows/macOS/Linux packaging verification. Large point-cloud, raster, and project workflows need explicit host-brokered data APIs with chunking and provenance; they must not be smuggled through the small JSON preview contract.
