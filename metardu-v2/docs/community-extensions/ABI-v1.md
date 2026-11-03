# METARDU Desktop Community Module ABI v1

ABI v1 is an execution preview for developers experimenting with community survey tools. It is not yet the stable plugin SDK or project-data API. A surveyor can import a local `.mdplug` package or select a raw `.wasm` module, then provide bounded JSON input explicitly in the Extensions view. Package import validates and stores bytes but never executes them; execution is a separate user action.

## Local `.mdplug` package v1

The current offline package is a ZIP archive with exactly these three root entries: `manifest.json`, `module.wasm`, and `LICENSE.txt`. Nested paths, extra or duplicate entries, encrypted entries, unsupported compression, ZIP64, invalid UTF-8, mismatched sizes, and packages over 9 MiB are rejected. The WebAssembly module is limited to 8 MiB, the manifest to 128 KiB, and the licence text to 64 KiB. The archive is read into bounded memory and no member is extracted to a filesystem path.

The strict manifest declares `format`, `formatVersion`, `abiVersion`, `id`, `version`, `name`, `description`, `publisherName`, `licenseId`, and `moduleSha256`. ABI v1 requires canonical UTF-8 JSON serialized in that schema field order with no extra whitespace.

```json
{"format":"metardu-extension","formatVersion":1,"abiVersion":1,"id":"community.example.point-summary","version":"0.1.0","name":"Point summary","description":"Summarizes explicitly supplied survey points.","publisherName":"Example Community","licenseId":"MIT","moduleSha256":"<64 lowercase hexadecimal characters>"}
```

The host checks the module digest and computes a SHA-256 over the exact package bytes. It stores the package under that digest in Desktop's local app-data directory and rechecks both hashes before listing or running it. The renderer receives only the validated metadata and digest, never the package bytes or storage path.

Publisher and licence fields are claims from the package. ABI v1 has no signature verification, publisher authentication, catalog, package update/removal flow, or stable SDK promise. Local storage and package execution work offline.

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

The UI truncates only the displayed preview for large results; it does not rewrite the result. ABI v1 does not import project files, process LAS/LAZ/COPC datasets, or write project artifacts. JSON is limited to 4 MiB, so a point-cloud classifier cannot pass a real cloud through this interface. Do not use this preview as evidence of survey accuracy or legal acceptance.

## Tiny example

`examples/community-plugins/hello-surveyor.wat` returns a small JSON status object. With WABT installed, compile it using:

```text
wat2wasm examples/community-plugins/hello-surveyor.wat -o hello-surveyor.wasm
```

The example intentionally does no survey computation. It demonstrates only the ABI and host trust envelope.

## Next compatibility gates

Before the ABI is called stable, METARDU needs a reviewed SDK, publisher-signature model, reproducible builds, malformed-module security review, cancellation and resource-isolation strategy, and Windows/macOS/Linux packaging verification. Large point-cloud, raster, and project workflows need explicit host-brokered data APIs with chunking and durable provenance; they must not be smuggled through the small JSON preview contract. A LiDAR extension will also need a separately derived output, named classifier and parameters, retained source integrity, coordinate context, and independent validation before its results can be treated as professional survey work.
