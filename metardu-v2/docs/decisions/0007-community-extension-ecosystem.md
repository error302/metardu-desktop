# ADR-0007: A community extension ecosystem for survey workflows

**Status:** Accepted product and security direction; runtime implementation pending
**Date:** 29 October 2026
**Supersedes:** The blanket rejection of an in-app plugin ecosystem in ADR-0005; ADR-0005's survey-compute-first scope and GIS integration decisions remain in force.

## Context

Surveyors work with different instruments, data formats, project types, local conventions, and specialist calculations. A fixed set of built-in workflows cannot cover every useful tool or every local practice. The user wants METARDU Desktop to remain a standalone survey workspace while allowing the community to add tools, similar to QGIS's extensibility.

ADR-0005 correctly keeps METARDU from trying to reproduce a general GIS or CAD product, but its blanket rejection of an in-app extension ecosystem no longer fits this product direction. Community extensions can broaden survey work without turning the core into a general cartography application. QGIS, CAD, GNSS post-processing, photogrammetry, and other specialist products remain integration partners.

The existing desktop security model is a hard constraint: renderer code is sandboxed, and privileged functions pass through a curated preload bridge. Community code must not be able to read arbitrary project files, bypass the Rust computation authority, install native binaries, or label its own output as verified.

## Decision

METARDU Desktop will grow a versioned, capability-scoped extension API. The architecture is ABI-first and will support portable WebAssembly components through a host-controlled interface. Wasmtime is the runtime candidate for a prototype; the runtime version and exact Component Model/WASI profile must be pinned only after cross-platform packaging, quotas, and threat-model checks pass.

The app will not load community JavaScript, Python, native libraries, Electron extensions, or arbitrary `import()` modules into the renderer or main process. Extensions do not receive `ipcRenderer`, database handles, unrestricted filesystem paths, process access, or ambient network access.

### Extension contributions

The versioned SDK may expose these extension points:

1. **Project tools and analysis steps** that consume a surveyor-selected, read-only project snapshot and return a new derived artifact.
2. **Import and export adapters** for additional field-book, CAD, GIS, instrument, photogrammetry, and exchange formats.
3. **Instrument adapters** through a separately permissioned host broker; plugins do not open serial, Bluetooth, USB, or network sockets directly.
4. **Workflow commands, declarative forms, project templates, and visualization overlays** rendered by METARDU's trusted UI primitives.
5. **Reference-data and jurisdiction packs** carrying explicit source, coverage, epoch, units, version, checksum, licence, and review state.

The contribution interface stays inside surveying and project delivery. It does not add general-purpose GIS editing, a new statutory authority, or another source of core geodetic math. Extensions may request approved sidecar operations through typed host interfaces; any extension-provided algorithm remains attributed to its publisher and is not presented as a METARDU-validated method without separate evidence.

### Execution and permission model

- Each executable extension is a WebAssembly component with a versioned WIT contract and a manifest declaring its identity, publisher, version, compatible SDK, entry points, licence, required capabilities, and checksums.
- The host gives a component no filesystem, environment, process, or network access by default. Data access is limited to the selected inputs passed through the SDK. Additional capabilities require a user-visible grant, have a narrow scope, and can be revoked.
- Components receive bounded execution time, memory, and input/output sizes. The app can cancel or terminate a component that exceeds its budget.
- The extension host validates each input and output against versioned schemas. It writes results only as new project artifacts through the project engine; it cannot mutate source observations or bypass project history.
- UI contributions are declarative in the first SDK. No extension-provided script executes in the privileged Electron renderer.

### Package and offline model

- The installable package is a versioned `.mdplug` archive containing a manifest, WebAssembly component, declared resources, licence, and integrity metadata. The installer rejects undeclared executable content and unsafe archive paths.
- Extensions may be installed from a reviewed catalog or imported from a local file. Catalog access is optional; installation and compute workflows remain available offline.
- Each project records the extension ID, exact version, package digest, SDK version, granted capabilities, input artifact IDs, and output artifact IDs used to create derived work. A missing extension leaves prior artifacts readable and marks recomputation unavailable.
- Updates are explicit and project-pinned. The app never silently substitutes a newer extension version into an existing computation.

### Trust and surveying evidence

Publisher identity, code review, method validation, and statutory acceptance are separate facts and must have separate labels:

| State | What METARDU may claim |
|---|---|
| Community | Publisher supplied the extension; method and outputs are unreviewed by METARDU. |
| Publisher signature verified | Package integrity and publisher identity match the signature; this does not validate the surveying method. |
| METARDU reviewed | The declared compatibility and security review passed; no claim of legal acceptance or survey accuracy follows from this state. |
| Method or jurisdiction reviewed | Only the named method, area, reference data, version, and workflow have the recorded review evidence. This does not generalize to other countries or uses. |

New community computations default to **Community / Draft**. An extension cannot promote its own outputs to Checked, Approved, survey-grade, or statutory. Only METARDU-owned validation rules and review records can assign those states. A paid subscription does not change an extension's trust state.

Country packs follow `docs/invariants.md`: statutory content requires current primary source documents, clause-level provenance, and applicable fixture review. A user-created pack can be used as a declared project convention, but it cannot be presented as an officially accepted jurisdiction pack merely because it installed successfully.

### Relationship to existing architecture decisions

- ADR-0001 remains in force: Rust sidecar owns numerically sensitive surveying computation, TypeScript orchestrates workflows, and Electron hosts the app.
- ADR-0003 remains in force: the renderer has no direct IPC. The extension host receives only explicitly implemented, typed capabilities; plugin IDs are not arbitrary IPC method names.
- ADR-0005 remains in force for the survey-compute-first position and downstream GIS/CAD integration. This ADR supersedes only its blanket rejection of a METARDU-hosted community extension ecosystem.
- No ninth survey type is introduced; extension tools contribute to the existing supported survey types unless the product owner explicitly changes that invariant.

## Delivery sequence

1. Define the SDK schemas, manifest, output/provenance contract, trust labels, threat model, and extension package format.
2. Prototype the component host with a harmless example tool; prove isolation, quotas, cancellation, package validation, and Windows/macOS/Linux packaging before enabling third-party execution.
3. Ship declarative project tools, forms, import/export adapters, and visualization contributions behind the stable SDK.
4. Add selected-data analysis components with no ambient capabilities and durable project provenance.
5. Add separately permissioned instrument and reference-data capabilities after their platform and evidence contracts are complete.
6. Publish the developer kit, sample extensions, contribution guide, compatibility policy, security reporting path, and optional catalog governance.

No runtime, package catalog, automatic update, or third-party code execution is claimed by this ADR. Each implementation step requires a scoped task brief and evidence that its security, offline, provenance, and cross-platform requirements work.

## Alternatives considered

- **Load JavaScript or Python plugins directly in Electron.** Rejected: extensions would share a process and UI surface with trusted code, making it difficult to restrict file, network, IPC, and project access.
- **Allow native plugins.** Rejected: native code defeats the portable sandbox and adds OS-specific distribution and code-signing risk.
- **Keep all capabilities in the METARDU core.** Rejected: it prevents the community from adapting the app to long-tail instruments, formats, and specialist survey workflows.
- **Turn the core into a general GIS/CAD editor.** Rejected: this duplicates mature specialist tools and weakens the survey-computation focus. The extension system remains survey-domain oriented.
- **Treat a publisher signature as a quality certificate.** Rejected: signing establishes package integrity and publisher identity, not mathematical correctness, legal compliance, or field accuracy.

## References

- `docs/invariants.md` sections A1, A4, A5, B1-B3, C1-C3, D3.
- ADR-0001, ADR-0003, ADR-0005.
- [WebAssembly Component Model](https://component-model.bytecodealliance.org/).
- [Running components with Wasmtime](https://component-model.bytecodealliance.org/running-components/wasmtime.html).
- [Wasmtime WASI filesystem capability documentation](https://docs.wasmtime.dev/c-api/wasi_8h.html).
