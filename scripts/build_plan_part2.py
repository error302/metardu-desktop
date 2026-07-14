"""
Content for chapters 1-6 of the MetaRDU Desktop Upgrade Plan.
This module is imported by the main builder script.
"""

from reportlab.platypus import Paragraph, Spacer, PageBreak, Table, TableStyle, KeepTogether
from reportlab.lib import colors
from reportlab.lib.units import inch

# Import setup from part1
import sys, os
sys.path.insert(0, '/home/z/my-project/scripts')
from build_plan_part1 import (
    H1, H2, H3, BODY, BODY_NO_INDENT, BULLET, META,
    TABLE_HEADER_STYLE, TABLE_CELL_STYLE, TABLE_CELL_CENTER,
    ACCENT, ACCENT_2, HEADER_FILL, TEXT_PRIMARY, TEXT_MUTED,
    CARD_BG, TABLE_STRIPE, BORDER, SEM_SUCCESS, SEM_WARNING, SEM_ERROR, SEM_INFO,
    AVAILABLE_W, add_heading, add_major_section, add_subsection, add_subsubsection,
    make_table, callout, safe_keep_together,
)


def build_chapter_1():
    """Chapter 1: Executive Summary"""
    story = []
    story.extend(add_major_section("Chapter 1: Executive Summary"))

    story.append(Paragraph(
        "MetaRDU Desktop v1.0 is a credible, well-architected surveyor's office tool that consumes drone photogrammetry outputs and produces statutory survey deliverables for the Kenyan market. However, the product has a critical identity gap that this upgrade plan resolves. Despite its name suggesting drone mission planning, the current codebase contains zero flight planning math, zero camera footprint calculations, zero waypoint generation, zero MAVLink or MAVSDK integration, and zero in-app photogrammetry processing. The drone-related functionality that does exist is confined to Ground Control Point (GCP) management, a pipeline orchestrator that delegates all heavy lifting to external tools, and placeholder implementations for contour generation and feature extraction that return synthetic data. This plan transforms MetaRDU Desktop into a true production-grade drone survey workstation over a nine-month, three-phase upgrade.",
        BODY
    ))

    story.append(Paragraph(
        "The upgrade strategy is sequenced to deliver value continuously rather than as a single big-bang release. Phase 1 (Months 1-3, codenamed Stabilize &amp; Extend) hardens the existing Electron shell with zod-validated IPC contracts, wires the five P0 math features into the UI, adds a complete flight planning engine with camera footprint math and lawnmower waypoint generation, integrates GDAL bindings to replace placeholder contour and feature extraction code, and stands up code-signing infrastructure plus a bug bounty program. Phase 2 (Months 4-6, codenamed Connect &amp; Process) introduces the MAVSDK-Rust sidecar for live drone telemetry and mission upload, bundles OpenDroneMap as a local photogrammetry sidecar so processing works offline, and launches a closed beta program with five or more real Kenyan surveyors. Phase 3 (Months 7-9, codenamed Migrate &amp; ML) executes the Tauri 2.x migration, adds ONNX-based machine learning feature extraction for building and road footprint delineation, produces three tutorial videos, and ships the public v2.0 release.",
        BODY
    ))

    story.append(Paragraph(
        "The scope spans five drone capabilities (flight planning, live drone link, in-app photogrammetry, real raster I/O, and ML feature extraction), five drone platform families (DJI, ArduPilot/PX4, Autel EVO, senseFly eBee, and generic KML/KMZ), and six math standards (ASPRS 2014, NMAS 1947, ISO 19157, RDM 1.1 / Cap. 299, FGDC-STD-007.3, and ICSM SP1). The architecture decision to migrate from Electron to Tauri 2.x is gated to Phase 3, after the Rust sidecar pattern has been proven on the existing Electron shell. This sequencing minimizes migration risk by validating the Rust integration story on a known-good foundation before committing to the full shell rewrite. The binary is expected to shrink from approximately 150 megabytes to under 15 megabytes, idle memory from 350 megabytes to under 120 megabytes, and cold start from 2.4 seconds to under 1.2 seconds.",
        BODY
    ))

    story.append(Spacer(1, 6))
    story.append(callout(
        "Headline Metrics",
        "Binary size 150 MB to 10 MB. Drone capabilities 0 to 5 (flight planning, live drone link, in-app photogrammetry, real raster I/O, ML feature extraction). Math standards 5 to 6 (adds ISO 19157). Production readiness gates 0 to 3 (midpoint Reality Check, pre-launch Reality Check, closed beta sign-off). Total budget: $0 to $109 USD per year (zero-cost path using SignPath Foundation, GitHub Releases, volunteer beta, and community bug bounty; optional $99 Apple Developer ID when revenue allows)."
    ))
    story.append(Spacer(1, 14))

    story.append(Paragraph(
        "The engineering methodology borrows the twelve-agent roster and sequential-handoff workflow from the msitarzewski/agency-agents repository. Each phase activates a specific subset of agents: Phase 0 begins with the Codebase Onboarding Engineer producing a factual map of the current architecture; Phase 1 adds the Software Architect, Desktop App Engineer, Spatial Data Engineer, and Drone/Reality Mapping agents; Phase 2 adds the Web GIS Developer, 3D &amp; Scene Developer, and GIS QA Engineer; Phase 3 adds the Test Automation Engineer, Security Architect, Application Security Engineer, and Reality Checker. The Reality Checker runs twice as a quality gate: once at the midpoint of Phase 2 to decide whether to proceed to Phase 3 or pivot, and once before the public v2.0 release as a GO/NO-GO decision requiring evidence per criterion.",
        BODY
    ))

    story.append(Paragraph(
        "Risks are significant but manageable. The Tauri migration is the largest single risk because it requires re-testing all 118 IPC handlers and replacing the native better-sqlite3 binding with rusqlite. The mitigation is to execute the migration only after the Rust sidecar pattern is proven in Phase 1 and 2, and to maintain a parallel Electron release branch throughout Phase 3 so the team can roll back if the Tauri build fails to stabilize. The OpenDroneMap sidecar is the second largest risk because it adds a Docker or PyInstaller dependency that may be too heavy for low-end field laptops. The mitigation is to make photogrammetry an optional feature with a clear system-requirements check, and to keep the external WebODM server integration as a fallback for high-end users.",
        BODY
    ))

    return story


def build_chapter_2():
    """Chapter 2: Current State Assessment"""
    story = []
    story.extend(add_major_section("Chapter 2: Current State Assessment"))

    story.append(Paragraph(
        "MetaRDU Desktop v1.0.0 was tagged in July 2026 as the first desktop release of the metardu codebase, which originally shipped as a Next.js browser application. The desktop rewrite was motivated by severe performance bottlenecks in the browser version, including repeated out-of-memory failures during Next.js production builds on 4 GB sandboxes, server-side compute offload via BullMQ and Redis that added latency to every correction call, an absolute dependency on an external WebODM server for any drone photogrammetry work, and a sprawling operational stack of Docker, Caddy, nginx, Cloudflare Tunnel, PM2, and a Python FastAPI worker. The desktop rewrite collapses this entire stack into a single Electron binary backed by SQLite with SpatiaLite, eliminating the network round-trip for every compute operation and enabling true offline field work.",
        BODY
    ))

    story.append(add_subsection("2.1 Tech Stack"))
    story.append(Paragraph(
        "The current stack is Electron 31 wrapping a React 18 renderer with OpenLayers 10 for 2D map rendering and three.js for 3D point cloud visualization. The backend is the Electron main process running Node.js 20, with better-sqlite3 providing synchronous access to a local SQLite database extended with SpatiaLite for spatial indexing. The compute engine lives in a separate workspace package, @metardu/engine, which is pure TypeScript and reuses approximately 95% of the upstream metardu web codebase verbatim. Inter-process communication uses Electron's contextBridge with 118 registered IPC handlers across 25 namespaces, every one wrapped with rate-limiting at 120 calls per minute per channel, idempotency for concurrent writes, structured error envelopes, and observability metrics for slow-computation detection.",
        BODY
    ))

    story.append(Paragraph(
        "The codebase is substantial: 490 TypeScript source files, approximately 145,971 lines of code, 86 test files with 1,259 engine tests passing at 100% and 75% branch coverage, and 31 acceptance and smoke scripts. Five Architecture Decision Records (ADRs 001 through 005) document the major design choices. The CI pipeline runs on GitHub Actions across a three-OS matrix of Ubuntu, Windows, and macOS with fail-fast disabled. Packaging produces Windows NSIS and MSIX installers, macOS DMG for x64 and arm64, and Linux .deb and AppImage. Auto-update is configured via electron-updater pointing at GitHub Releases, though code-signing certificates have not yet been purchased and the auto-update channel has never been verified against a real minor version bump.",
        BODY
    ))

    story.append(add_subsection("2.2 Three Surveying Verticals"))
    story.append(Paragraph(
        "The product covers three surveying verticals that map directly to the Kenyan regulatory framework. Cadastral surveying implements Bowditch and Transit traverse closure with precision evaluation per Survey Act Cap. 299, generates Form No. 4 deed plan PDFs in A1 through A4 sizes, exports NLIMS and ArdhiSasa JSON with schema validation, produces a nine-sheet statutory computation workbook in Excel, generates mutation forms for subdivision and amalgamation, and applies an RSA-2048 cryptographic surveyor certificate seal to every deliverable. Topographic surveying implements breakline-aware constrained Delaunay TIN claiming 50,000 points in 100 milliseconds, marching-triangle contours at any interval, RINEX 2/3/4 import, LAS/LAZ point cloud import, DXF export with a 61-layer Survey of Kenya registry, LandXML 1.2/GeoJSON/Shapefile export, a feature coding library of 70 codes across 10 categories, and a GIS QA Report with PASS, CONDITIONAL, or FAIL verdicts.",
        BODY
    ))

    story.append(Paragraph(
        "Engineering surveying implements horizontal and vertical curve design including clothoid spiral transitions, superelevation computation, leveling by rise and fall plus height of collimation with 10 times the square root of K millimeter closure per RDM 1.1, cross-section volume by both prismoidal and end-area methods, mass-haul diagram optimization, AASHTO pavement design with ESA and layer structure, slope analysis via IDW interpolation and classification, staking table generation, road reserve compliance checking, as-built survey comparison, and machine-control export in seven formats including LandXML, DXF, Trimble, Leica, Topcon, generic, and stakeout CSV. The math engine is genuinely strong and well-cited to standard surveying literature including Snyder USGS Professional Paper 1395, Ghilani and Wolf Adjustment Computations, Basak, Schofield and Breach, AASHTO, and RDM 1.3.",
        BODY
    ))

    story.append(add_subsection("2.3 Drone Capabilities: Present vs Absent"))
    story.append(Paragraph(
        "The drone-related code in v1.0 is the weakest part of the product, despite the metardu brand suggesting a drone focus. A full ripgrep of the codebase for MAVLink, MAVSDK, DroneKit, and related identifiers returned zero matches, confirming that no drone protocol integration exists. The drone-imagery.ts module is explicitly documented as a downstream consumer: METARDU does not process drone photos, that is OpenDroneMap or Pix4D's job, and instead METARDU takes the outputs of those tools and turns them into statutory survey deliverables. The aerial-pipeline.ts orchestrator models a 13-stage pipeline but stages 3 (drone capture) and 4 (photogrammetry processing) are marked external and not executed by METARDU. The contour generation function returns synthetic concentric circles, and the feature extraction function returns 10 hardcoded square building footprints and one horizontal road line.",
        BODY
    ))

    strengths_gaps_data = [
        ['Strength', 'Status', 'Gap', 'Status'],
        ['Cassini-Soldner projection (1,922 LOC, exact to D6)', 'Full', 'No MAVLink/MAVSDK/DroneKit integration', 'Missing'],
        ['Helmert datum transform (Gauss-Newton, 726 LOC)', 'Full', 'No flight planning or camera footprint math', 'Missing'],
        ['Least Squares Adjustment (3,560 LOC, parametric+robust+network)', 'Full', 'No waypoint generation or mission export', 'Missing'],
        ['Clothoid spiral (522 LOC, full set-out)', 'Full', 'No in-app photogrammetry (delegated to ODM)', 'Missing'],
        ['TIN with breaklines + marching-triangle contours', 'Full', 'No GDAL bindings (contour gen returns synthetic data)', 'Placeholder'],
        ['GCP manager (4 export formats, residual verification)', 'Full', 'Feature extraction returns hardcoded squares', 'Placeholder'],
        ['Aerial pipeline orchestrator (13 stages)', 'Full', '118 IPC handlers use any type, no zod validation', 'Weak'],
        ['RSA-2048 cryptographic surveyor seal', 'Full', '5 P0 math features not wired to UI', 'Gap'],
        ['1259/1259 engine tests, 75% branch coverage', 'Full', 'No Playwright E2E tests', 'Missing'],
        ['3-OS CI matrix on GitHub Actions', 'Full', 'Code-signing certs not purchased', 'Blocked'],
    ]
    story.append(Spacer(1, 6))
    story.append(make_table(strengths_gaps_data, [0.42, 0.10, 0.38, 0.10]))
    story.append(Spacer(1, 14))

    story.append(add_subsection("2.4 Critical Gaps Summary"))
    story.append(Paragraph(
        "The single most misleading gap is the drone-imagery module. Its function signatures look production-ready but the implementations return synthetic data without warning the user. A surveyor who imports a real Digital Surface Model and invokes generateContoursFromDSM will receive concentric circle polygons that look plausible on a map but have no relationship to the actual terrain. This is worse than a missing feature because it produces confidently wrong output. The fix in Phase 1 is to integrate GDAL bindings via the gdal-async Node package or by shelling out to gdal_contour, gdal_calc.py, and gdal_rasterize as child processes, and to replace the synthetic return values with real raster I/O. Until this lands, the contour and feature extraction functions are explicitly marked as not safe for production use.",
        BODY
    ))

    story.append(Paragraph(
        "The second critical gap is the IPC validation surface. All 118 handlers accept input typed as any, which means malformed payloads from the renderer can crash the privileged main process or, worse, execute arbitrary file system operations. The zod validation library is already a dependency but is not used in the IPC layer. The fix in Phase 1 is to define one zod schema per IPC channel and to validate every input on the privileged side before any business logic runs. This is also a security gate because the renderer is, in the Desktop App Engineer agent's words, a browser tab with delusions of grandeur, and every IPC channel must be treated as a public API surface with the narrowest possible verb exposed.",
        BODY
    ))

    story.append(Paragraph(
        "The third critical gap is the absence of the five P0 math features from the UI. The engine has full implementations of Least Squares Adjustment, error ellipses with covariance propagation, Cassini to UTM bidirectional conversion, grid-to-ground distance correction, and clothoid transition curves, but none of these are exposed in the React components. The traverse panel only offers Bowditch, the road design UI lacks clothoid entry and exit spirals required by RDM 1.1 for design speeds above 50 kilometers per hour, and the coordinate converter only handles one direction. The fix in Phase 1 is to wire each of these engine modules to a UI component, with property-based tests guarding the math against numerical regressions.",
        BODY
    ))

    return story


def build_chapter_3():
    """Chapter 3: Vision, Goals, and Success Metrics"""
    story = []
    story.extend(add_major_section("Chapter 3: Vision, Goals, and Success Metrics"))

    story.append(Paragraph(
        "The product vision for MetaRDU Desktop v2.0 is to be a production-grade, Tauri-based drone survey workstation that combines flight planning, live drone operations, in-app photogrammetry, and statutory survey deliverables for the Kenyan surveying industry, with a clear architectural path to pan-African and global expansion. The vision is deliberately narrow in scope (Kenya first, country packs later) and broad in capability (every step of the drone survey workflow from mission planning to sealed deed plan in one application). This dual focus on depth over breadth is what differentiates MetaRDU from general-purpose GIS tools like QGIS and from drone-specific tools like Pix4D or DroneDeploy, none of which produce statutory Kenyan survey deliverables.",
        BODY
    ))

    story.append(add_subsection("3.1 Five Strategic Goals"))
    story.append(Paragraph(
        "Goal G1 is to migrate the desktop shell from Electron to Tauri 2.x with a Rust backend for heavy compute, shrinking the binary from approximately 150 megabytes to under 15 megabytes, reducing idle memory from 350 to under 120 megabytes, and enabling true native performance for TIN computation, point cloud processing, and MAVLink telemetry parsing. Goal G2 is to add five drone capabilities that are currently absent: flight planning with camera footprint and waypoint generation, live drone link via MAVSDK-Rust, in-app photogrammetry via an OpenDroneMap sidecar, real raster I/O via GDAL bindings, and ML feature extraction via ONNX Runtime. Goal G3 is to support five drone platform families: DJI Mavic, Mini, and Phantom via KMZ waypoint export; ArduPilot and PX4 via MAVLink mission upload; Autel EVO via KMZ; senseFly eBee via eMotion XML; and any platform via generic KML.",
        BODY
    ))

    story.append(Paragraph(
        "Goal G4 is to comply with six math standards: ASPRS Positional Accuracy Standards 2014 for remote sensing Class I, II, and III RMSE thresholds; NMAS 1947 legacy 90% circular error of 1/30 inch; ISO 19157 geographic information data quality elements; RDM 1.1 and Survey Act Cap. 299 for Kenya-specific compliance; FGDC-STD-007.3 NSSDA for future USA expansion; and ICSM SP1 for future Australia and New Zealand expansion. Goal G5 is to achieve full production readiness with code-signing certificates on all three platforms, a closed beta with at least 10 real Kenyan surveyors, a security bug bounty program, three tutorial videos, and a staged auto-update rollout with rollback capability.",
        BODY
    ))

    story.append(add_subsection("3.2 Success Metrics"))
    story.append(Paragraph(
        "Each goal has three to five measurable Key Performance Indicators with target values and a defined measurement method. The table below summarizes the full success metrics dashboard that will be tracked weekly throughout the nine-month upgrade. Metrics in bold are gating criteria for the public v2.0 release: failure to meet any gating metric triggers a release block and a root-cause analysis at the weekly project review.",
        BODY
    ))

    metrics_data = [
        ['Goal', 'KPI', 'Target', 'Measurement'],
        ['G1 Tauri', 'Binary size', '< 15 MB', 'electron-builder / tauri build output size'],
        ['G1 Tauri', 'Idle memory', '< 120 MB', 'Activity Monitor / Task Manager after 5 min idle'],
        ['G1 Tauri', 'Cold start', '< 1.2 s', 'time-to-first-paint benchmark on M1 MacBook Air'],
        ['G1 Tauri', 'IPC handler migration', '118 / 118 re-tested', 'Playwright E2E coverage of every IPC channel'],
        ['G2 Drone', 'Flight planning accuracy', 'GSD within 1% of spec', 'Property-based test vs known camera sensors'],
        ['G2 Drone', 'MAVLink telemetry latency', '< 200 ms p95', 'MAVSDK-Rust ping over USB serial'],
        ['G2 Drone', 'Photogrammetry success rate', '> 90%', 'ODM sidecar on 100-photo test dataset'],
        ['G2 Drone', 'GDAL contour correctness', 'RMSE < 0.5 m vs survey', 'Compare generated contours to field-surveyed breaklines'],
        ['G2 Drone', 'ML building footprint IoU', '> 0.65', 'OpenCities AI test set evaluation'],
        ['G3 Platforms', 'DJI KMZ validation', '100% pass DJI Pilot', 'Manual upload to DJI Pilot 2 app'],
        ['G3 Platforms', 'ArduPilot .waypoints', '100% pass QGC', 'Mission Planner + QGroundControl import test'],
        ['G4 Math', 'ASPRS Class I compliance', 'RMSE_x,y < 7.5 cm', 'GCP residual check on test dataset'],
        ['G4 Math', 'ISO 19157 completeness', '100% pass', 'GIS QA Engineer automated topology check'],
        ['G4 Math', 'RDM 1.1 levelling closure', '10 sqrt(K) mm', 'Property-based test on synthetic networks'],
        ['G5 Release', 'Code-signing verification', 'SmartScreen + Gatekeeper pass', 'Manual download test on clean Win + macOS'],
        ['G5 Release', 'Beta surveyor sign-off', '>= 7 of 10 NPS > 8', 'Structured feedback form after 2-week trial'],
        ['G5 Release', 'Auto-update success rate', '> 99% over 1 minor bump', 'electron-updater / Tauri updater metrics'],
        ['G5 Release', 'Crash-free sessions', '>= 99.5%', 'Sentry crash reporting over 7-day window'],
    ]
    story.append(Spacer(1, 6))
    story.append(make_table(metrics_data, [0.13, 0.32, 0.22, 0.33]))
    story.append(Spacer(1, 14))

    story.append(Paragraph(
        "The measurement cadence is weekly for engineering metrics (binary size, idle memory, IPC coverage, MAVLink latency, photogrammetry success rate), biweekly for product metrics (beta surveyor feedback, NPS, tutorial completion rates), and at every phase gate for release metrics (code-signing verification, auto-update success rate, crash-free sessions). The Reality Checker agent runs a full evidence audit at the Phase 2 midpoint and at the pre-launch gate, requiring screenshots, test outputs, and beta surveyor testimonials for every gating metric before issuing a GO verdict.",
        BODY
    ))

    return story


def build_chapter_4():
    """Chapter 4: Architecture Decisions (ADRs 006-012)"""
    story = []
    story.extend(add_major_section("Chapter 4: Architecture Decisions (ADRs 006-012)"))

    story.append(Paragraph(
        "Seven new Architecture Decision Records govern the upgrade. Each follows the Status, Context, Decision, Consequences template established by ADRs 001 through 005 in the existing codebase. Every decision names what is given up, because there are no solutions, only trade-offs. The full ADR markdown files will be committed to the docs/adrs/ directory of the metardu-desktop repository as the first deliverable of Phase 1, and these summaries are the executive overview.",
        BODY
    ))

    story.append(add_subsection("4.1 ADR-006: Rust Sidecar Strategy (Phase 1-2)"))
    story.append(Paragraph(
        "<b>Status:</b> Accepted. <b>Context:</b> Heavy compute operations including TIN generation, point cloud octree traversal, GDAL raster math, MAVLink message parsing, and OpenSfM feature matching are CPU-bound and benefit from native code. The current TypeScript implementations work but are 5 to 20 times slower than equivalent Rust code on benchmarks. A full Tauri migration in Phase 1 would be high-risk because all 118 IPC handlers would need re-testing simultaneously. <b>Decision:</b> Keep the Electron shell for Phases 1 and 2, but extract heavy compute into a Rust binary called via a length-prefixed JSON protocol over stdin and stdout. The sidecar is bundled as a platform-specific binary in the resources/ directory and spawned as a child process at app startup. <b>Consequences:</b> Adds one build target (Rust) to the toolchain, requires cross-compilation for Windows, macOS, and Linux, and introduces a process boundary that adds approximately 2 milliseconds of latency per call. The upside is that the Rust code is reusable when Tauri migration happens in Phase 3, making that migration substantially easier.",
        BODY
    ))

    story.append(add_subsection("4.2 ADR-007: Tauri 2.x Migration (Phase 3)"))
    story.append(Paragraph(
        "<b>Status:</b> Accepted, deferred to Phase 3. <b>Context:</b> ADR-001 chose Electron for v1.0 because 95% of the upstream metardu TypeScript code could be reused verbatim, minimizing time to v1.0. The downside is a 150 megabyte binary, 350 megabyte idle memory, and a Chromium dependency that adds attack surface. Tauri 2.x uses the system WebView (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux), shrinking the binary to under 15 megabytes and idle memory to under 120 megabytes. <b>Decision:</b> Migrate the shell to Tauri 2.x in Phase 3, after the Rust sidecar pattern is proven. Replace better-sqlite3 with rusqlite, replace electron-updater with tauri-plugin-updater, and replace electron-builder with tauri-cli bundling. The @metardu/engine TypeScript package is reused verbatim because it is framework-agnostic. <b>Consequences:</b> Two-month migration timeline, re-testing all 118 IPC handlers as Tauri commands, and a parallel Electron release branch must be maintained as a rollback path. The upside is a 10x smaller binary, native performance, and a significantly smaller attack surface.",
        BODY
    ))

    story.append(add_subsection("4.3 ADR-008: Drone Protocol Stack"))
    story.append(Paragraph(
        "<b>Status:</b> Accepted. <b>Context:</b> Five drone platforms must be supported. DJI dominates the consumer and prosumer market with Mavic, Mini, and Phantom lines. ArduPilot and PX4 dominate the open-source autopilot market on Pixhawk hardware. Autel EVO is a smaller but growing DJI alternative. senseFly eBee is the leading fixed-wing survey drone. Generic KML/KMZ covers any other platform. <b>Decision:</b> Implement mission export in five formats: DJI KMZ using the wpml XML schema consumed by DJI Pilot 2 and Litchi; ArduPilot .waypoints using the QGC WPL 110 text format consumed by Mission Planner and QGroundControl; Autel EVO KMZ (subset of DJI format); senseFly eMotion XML; and generic KML using the KML 2.2 Point geometry with ExtendedData for altitude and speed. Live telemetry uses MAVSDK-Rust for ArduPilot and PX4 only; DJI live telemetry requires the DJI Cloud API which is out of scope for v2.0 and deferred to v2.1. <b>Consequences:</b> Five export code paths to maintain, but each is well-documented by the respective vendor. The MAVSDK-Rust sidecar is the only live telemetry channel in v2.0.",
        BODY
    ))

    story.append(add_subsection("4.4 ADR-009: Photogrammetry Sidecar (OpenDroneMap)"))
    story.append(Paragraph(
        "<b>Status:</b> Accepted. <b>Context:</b> The original metardu web app delegated all photogrammetry to an external WebODM server, which silently no-ops if the WEBODM_URL environment variable is unset. This is a hard ceiling for field work in Kenya where internet connectivity is unreliable. OpenDroneMap is the leading open-source photogrammetry engine and can run locally. <b>Decision:</b> Bundle ODM as a local sidecar in Phase 2. The preferred deployment is a Docker container spawned on-demand by the desktop app, with a fallback to a PyInstaller-bundled native ODM binary for systems without Docker. The existing 13-stage aerial pipeline orchestrator is preserved and updated to invoke the local ODM sidecar instead of an external server. <b>Consequences:</b> Adds a Docker or 2-gigabyte native binary dependency. Minimum system requirement is raised to 16 GB RAM and 50 GB free disk for photogrammetry work. The feature is gated behind a system-requirements check and can be skipped on low-end machines, with a clear external-WebODM fallback maintained.",
        BODY
    ))

    story.append(add_subsection("4.5 ADR-010: GDAL Integration"))
    story.append(Paragraph(
        "<b>Status:</b> Accepted. <b>Context:</b> The current contour generation and feature extraction functions are placeholders that return synthetic data. Real raster I/O requires GDAL, the de facto standard open-source geospatial library. The Node.js ecosystem has two options: gdal-async provides native Node bindings, or shell out to gdal_contour, gdal_calc.py, and gdal_rasterize as child processes. <b>Decision:</b> Use gdal-async as the primary integration in Phase 1, with a shell-out fallback for operations not covered by the bindings (specifically gdal_contour and gdal_rasterize). GDAL is bundled as a platform-specific binary in resources/gdal/ to avoid the system dependency hell that has historically plagued GDAL deployments. <b>Consequences:</b> Adds approximately 80 megabytes to the binary per platform. The contour generation function in drone-imagery.ts is rewritten to call gdal_contour on real GeoTIFF inputs, and the synthetic concentric circle return is removed entirely. Feature extraction remains a placeholder until ML integration in Phase 3.",
        BODY
    ))

    story.append(add_subsection("4.6 ADR-011: ML Pipeline (ONNX Runtime)"))
    story.append(Paragraph(
        "<b>Status:</b> Accepted, Phase 3. <b>Context:</b> Building footprint extraction, road centerline extraction, and change detection from orthophotos are high-value features that differentiate MetaRDU from competitors. The leading approach is to use pre-trained models from the OpenCities AI initiative or the Microsoft Building Footprints project, run inference locally via ONNX Runtime, and post-process the output into GeoJSON polygons. <b>Decision:</b> Use ONNX Runtime as the inference engine with pre-trained U-Net or Mask R-CNN models. The Rust sidecar hosts the ONNX Runtime via the ort crate, accepting orthophoto tiles as input and returning polygon coordinates as output. Models are bundled in resources/models/ and are approximately 200 megabytes per model. <b>Consequences:</b> Adds 200 megabytes per model to the binary, but only the building footprint model is bundled by default; road and change-detection models are downloadable on demand. Inference latency is approximately 5 seconds per 512 by 512 pixel tile on an M1 MacBook Air, which is acceptable for batch processing but too slow for real-time use.",
        BODY
    ))

    story.append(add_subsection("4.7 ADR-012: IPC Validation (Zod Schemas)"))
    story.append(Paragraph(
        "<b>Status:</b> Accepted, Phase 1 P0. <b>Context:</b> All 118 IPC handlers in v1.0 accept input typed as any, which is a critical security and reliability gap. The zod validation library is already a dependency but is not used in the IPC layer. Malformed payloads from the renderer can crash the privileged main process or execute unintended file system operations. <b>Decision:</b> Define one zod schema per IPC channel in a new packages/ipc-schemas/ workspace. Every handler validates input against its schema before any business logic runs, and returns a structured 400 error on validation failure. The preload.ts file is regenerated from the schemas to give the renderer end-to-end type safety. <b>Consequences:</b> Adds approximately 2 milliseconds of validation overhead per IPC call, which is negligible. The renderer-to-main contract becomes the single source of truth, eliminating an entire class of runtime type errors. The security posture improves because every privileged operation is now gated by an explicit allowlist of inputs.",
        BODY
    ))

    return story


def build_chapter_5():
    """Chapter 5: Phased Roadmap"""
    story = []
    story.extend(add_major_section("Chapter 5: Phased Roadmap (3 Phases × 3 Months)"))

    story.append(Paragraph(
        "The upgrade is sequenced as three phases of three months each, with each phase shipping a tagged release to the closed beta channel. The sequencing prioritizes risk reduction: the highest-risk architectural change (Tauri migration) is deferred to Phase 3, after the Rust sidecar pattern has been proven on the existing Electron shell in Phases 1 and 2. The lowest-risk, highest-value features (flight planning, GDAL, zod validation) ship first in Phase 1 to demonstrate progress to stakeholders and to give the closed beta surveyors something concrete to test in Phase 2. The full Gantt-style timeline is summarized in the table below, followed by detailed deliverables, milestones, exit criteria, and the active agent roster for each phase.",
        BODY
    ))

    gantt_data = [
        ['Work Stream', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9'],
        ['zod IPC validation', 'X', 'X', '', '', '', '', '', '', ''],
        ['P0 math features in UI', 'X', 'X', '', '', '', '', '', '', ''],
        ['Flight planning engine', '', 'X', 'X', '', '', '', '', '', ''],
        ['GDAL bindings', '', 'X', 'X', '', '', '', '', '', ''],
        ['Code-signing setup', '', '', 'X', '', '', '', '', '', ''],
        ['MAVSDK-Rust sidecar', '', '', '', 'X', 'X', '', '', '', ''],
        ['ODM photogrammetry sidecar', '', '', '', 'X', 'X', 'X', '', '', ''],
        ['Closed beta program', '', '', '', '', 'X', 'X', '', '', ''],
        ['Tauri 2.x migration', '', '', '', '', '', '', 'X', 'X', 'X'],
        ['ML feature extraction', '', '', '', '', '', '', '', 'X', 'X'],
        ['Tutorial videos', '', '', '', '', '', '', '', 'X', 'X'],
        ['Public v2.0 release', '', '', '', '', '', '', '', '', 'X'],
    ]
    story.append(Spacer(1, 6))
    story.append(make_table(gantt_data, [0.30, 0.078, 0.078, 0.078, 0.078, 0.078, 0.078, 0.078, 0.078, 0.078]))
    story.append(Spacer(1, 14))

    story.append(add_subsection("5.1 Phase 1: Stabilize &amp; Extend (Months 1-3)"))
    story.append(Paragraph(
        "Phase 1 hardens the existing Electron shell and adds the highest-value missing features. The deliverables are: a packages/ipc-schemas/ workspace with zod schemas for all 118 IPC handlers, validated and tested; the five P0 math features wired into the UI (LSA in traverse panel, error ellipses on adjusted coordinates, Cassini to UTM bidirectional converter, grid-to-ground distance correction, clothoid transition curves in road design); a new flight planning module in @metardu/engine with camera footprint math, GSD calculation, lawnmower waypoint generation, terrain-aware flight height from DTM, and mission export in five formats (DJI KMZ, ArduPilot .waypoints, MAVLink, Litchi CSV, senseFly eMotion XML); GDAL bindings via gdal-async with the contour generation function rewritten to use real gdal_contour; code-signing certificates purchased and configured for Windows EV and Apple Developer ID with notarization; and a bug bounty program launched on GitHub Security Advisories.",
        BODY
    ))

    story.append(Paragraph(
        "The milestone cadence is monthly. Month 1 ends with the zod schemas complete and the first two P0 math features shipped. Month 2 ends with all five P0 math features shipped, the flight planning engine complete with camera footprint and waypoint generation, and GDAL bindings integrated. Month 3 ends with the five mission export formats complete, code-signing verified on Windows and macOS, and the bug bounty program live. The exit criteria for Phase 1 are: 100% IPC handler zod coverage with property-based tests passing, all five P0 math features accepted by a GIS QA Engineer review, flight planning produces correct GSD within 1% of spec on a test camera sensor database, GDAL contour generation matches field-surveyed breaklines within 0.5 meters RMSE, and code-signed builds pass SmartScreen and Gatekeeper on clean installations.",
        BODY
    ))

    story.append(Paragraph(
        "The active agent roster for Phase 1 is: Codebase Onboarding Engineer (Month 1 only, produces the factual architecture map), Software Architect (full phase, owns ADRs 006 through 012), Desktop App Engineer (full phase, owns zod IPC validation and code-signing), Spatial Data Engineer (Months 2-3, owns GDAL integration), Drone/Reality Mapping agent (Months 2-3, owns flight planning math and mission export), and GIS QA Engineer (Month 3 only, runs the math and GDAL acceptance gates). The Reality Checker is not active in Phase 1 because no release ships to external users; the phase gate is a Code Reviewer agent review of every PR.",
        BODY
    ))

    story.append(add_subsection("5.2 Phase 2: Connect &amp; Process (Months 4-6)"))
    story.append(Paragraph(
        "Phase 2 adds live drone connectivity and in-app photogrammetry, and launches the closed beta. The deliverables are: a MAVSDK-Rust sidecar binary that connects to ArduPilot and PX4 autopilots over USB serial or UDP, streaming live telemetry including HEARTBEAT, ATTITUDE, GPS_RAW_INT, and BATTERY_STATUS messages; a Tauri-compatible mission upload pipeline that converts the internal mission representation to MAVLink MAV_CMD_NAV_WAYPOINT messages and uploads them to the connected drone; an OpenDroneMap sidecar bundled as a Docker container with a PyInstaller fallback for systems without Docker, integrated into the existing 13-stage aerial pipeline; the aerial pipeline orchestrator updated to invoke the local ODM sidecar instead of an external WebODM server; and a closed beta program with five or more real Kenyan surveyors, structured feedback forms, and weekly office hours.",
        BODY
    ))

    story.append(Paragraph(
        "The exit criteria for Phase 2 are: MAVLink telemetry latency under 200 milliseconds p95 over USB serial on a Pixhawk 4 test drone; mission upload succeeds on at least three different ArduPilot and PX4 firmware versions; ODM sidecar completes a 100-photo test dataset with a success rate above 90%; the closed beta program has at least seven of ten surveyors reporting a Net Promoter Score above 8 after a two-week trial; and the Reality Checker midpoint gate issues a GO verdict with evidence per criterion. If the Reality Checker issues a NO-GO at midpoint, the team pivots to addressing the flagged issues before proceeding to Phase 3.",
        BODY
    ))

    story.append(Paragraph(
        "The active agent roster for Phase 2 adds: Web GIS Developer (owns the live telemetry dashboard UI), 3D &amp; Scene Developer (owns the ODM point cloud viewer integration), and the Reality Checker (runs the midpoint gate at end of Month 6). The Drone/Reality Mapping agent continues from Phase 1 and owns the MAVSDK-Rust sidecar. The Test Automation Engineer joins in Month 6 to stand up the Playwright E2E suite for the new live drone link and photogrammetry journeys, using deterministic mock MAVLink and ODM responses to avoid flakiness.",
        BODY
    ))

    story.append(add_subsection("5.3 Phase 3: Migrate &amp; ML (Months 7-9)"))
    story.append(Paragraph(
        "Phase 3 executes the Tauri migration, adds ML feature extraction, and ships the public v2.0 release. The deliverables are: a Tauri 2.x shell with all 118 IPC handlers migrated from Electron contextBridge to Tauri commands, with the @metardu/engine TypeScript package reused verbatim and the better-sqlite3 binding replaced with rusqlite; the Rust sidecar from Phase 1 and 2 absorbed into the main Tauri binary because Tauri is already Rust; an ONNX Runtime ML pipeline for building footprint extraction using a pre-trained U-Net model, with the Rust ort crate hosting inference and returning GeoJSON polygons; road centerline extraction using a separate pre-trained model; change detection between two orthophoto epochs; three tutorial videos of approximately 10 minutes each covering the cadastral, topographic, and drone survey workflows; and the public v2.0.0 release tagged on GitHub with auto-generated changelog, download page, and social announcement.",
        BODY
    ))

    story.append(Paragraph(
        "The exit criteria for Phase 3 are: binary size under 15 megabytes on all three platforms; idle memory under 120 megabytes; cold start under 1.2 seconds on an M1 MacBook Air; all 118 IPC handlers pass the Playwright E2E suite on Tauri; ML building footprint extraction achieves an Intersection over Union above 0.65 on the OpenCities AI test set; the closed beta surveyors from Phase 2 sign off on the Tauri build after a one-week trial; the Reality Checker pre-launch gate issues a GO verdict; and the first staged rollout at 1% adoption maintains a crash-free session rate above 99.5% over a 7-day window before expanding to 10% and then 100%.",
        BODY
    ))

    story.append(Paragraph(
        "The active agent roster for Phase 3 adds: the Security Architect and Application Security Engineer (run the threat model on the new Tauri IPC boundary and the ML inference pipeline), the Test Automation Engineer (full phase, owns the Tauri migration E2E suite), the DevOps Automator (owns the staged rollout and the auto-update verification), the Performance Benchmarker (verifies the footprint budgets), the Technical Writer (owns the tutorial video scripts and the v2.0 release notes), and the Reality Checker (runs the pre-launch GO/NO-GO gate). The SRE agent is on standby for the first 72 hours after the public v2.0 release to handle any incidents.",
        BODY
    ))

    return story


def build_chapter_6():
    """Chapter 6: Drone Survey Module Deep Dive"""
    story = []
    story.extend(add_major_section("Chapter 6: Drone Survey Module Deep Dive"))

    story.append(Paragraph(
        "This chapter is the technical specification for the five drone capabilities added across Phases 1, 2, and 3. Each section covers the math, the data flow, the file formats, and the integration points with the existing @metardu/engine and the Electron or Tauri shell. The math is presented with explicit formulas so that the GIS QA Engineer can verify correctness against standard references including Colomina and Molina 2014, ASPRS 2014, and the relevant ISO standards.",
        BODY
    ))

    story.append(add_subsection("6.1 Flight Planning Math"))
    story.append(Paragraph(
        "Flight planning computes the mission parameters required to achieve a target Ground Sample Distance (GSD) and image overlap, given a camera sensor specification and a survey area polygon. The fundamental relationship is GSD equals the sensor pixel size multiplied by the altitude above ground, divided by the focal length. Equivalently, GSD equals the sensor width divided by the image width in pixels, multiplied by the altitude, divided by the focal length. The camera footprint on the ground is the image footprint width equals the altitude multiplied by the sensor width divided by the focal length, and the image footprint height equals the altitude multiplied by the sensor height divided by the focal length. These two formulas are the foundation of every other flight planning calculation.",
        BODY
    ))

    story.append(Paragraph(
        "The lawnmower waypoint generation algorithm takes the survey area polygon, the target GSD, the front overlap percentage, the side overlap percentage, and the camera sensor specification, and produces a list of waypoints. The line spacing is the image footprint height multiplied by one minus the side overlap, expressed as a decimal. The photo spacing along a flight line is the image footprint width multiplied by one minus the front overlap. The flight lines are oriented along the longest dimension of the survey area bounding box to minimize the number of turns, which are the most battery-expensive maneuver. Terrain-aware flight height adjusts the altitude above ground at each waypoint using a Digital Terrain Model, so that the GSD remains constant over rolling terrain. This requires a DTM raster input and adds approximately 15% to the flight time compared to a flat-terrain flight.",
        BODY
    ))

    story.append(Paragraph(
        "Battery and flight time estimation uses the drone's published cruise speed, the published battery capacity, and a 20% safety margin. The total flight time is the sum of the straight-line distance divided by cruise speed plus 10 seconds per turn for deceleration, rotation, and acceleration. The number of batteries required is the total flight time divided by the usable battery time, rounded up. The usable battery time is the published flight time at the cruise speed and the mission altitude, multiplied by 0.8 for the safety margin. For a typical DJI Mavic 3 Enterprise at 75 meters altitude, 8 meters per second cruise speed, 75% front overlap, and 65% side overlap, a 50-hectare survey requires approximately 18 minutes of flight time and one battery.",
        BODY
    ))

    cam_data = [
        ['Parameter', 'Symbol', 'Formula', 'Example (Mavic 3 Enterprise)'],
        ['Sensor width', 'Sw', 'Spec', '17.9 mm'],
        ['Sensor height', 'Sh', 'Spec', '13.0 mm'],
        ['Image width', 'Iw', 'Spec', '5280 px'],
        ['Image height', 'Ih', 'Spec', '3956 px'],
        ['Focal length', 'f', 'Spec', '12.0 mm'],
        ['Altitude AGL', 'H', 'User input', '75 m'],
        ['Pixel size', 'ps', 'Sw / Iw', '0.00339 mm'],
        ['GSD', 'g', 'ps × H / f', '2.12 cm/px'],
        ['Footprint width', 'Fw', 'H × Sw / f', '111.9 m'],
        ['Footprint height', 'Fh', 'H × Sh / f', '81.3 m'],
        ['Front overlap', 'P_front', 'User input', '75%'],
        ['Side overlap', 'P_side', 'User input', '65%'],
        ['Photo spacing', 'd_photo', 'Fw × (1 - P_front)', '28.0 m'],
        ['Line spacing', 'd_line', 'Fh × (1 - P_side)', '28.5 m'],
    ]
    story.append(Spacer(1, 6))
    story.append(make_table(cam_data, [0.27, 0.10, 0.30, 0.33]))
    story.append(Spacer(1, 14))

    story.append(add_subsection("6.2 Mission Export Formats"))
    story.append(Paragraph(
        "Five mission export formats are implemented in Phase 1. The DJI KMZ format uses the wpml XML schema consumed by DJI Pilot 2 and Litchi. The KMZ is a ZIP archive containing a mission.kml file with the waypoint coordinates, altitudes, speeds, and actions, plus a template.kml file with the mission metadata. The ArduPilot .waypoints format is the QGC WPL 110 text format, with one line per waypoint containing the index, coordinate type (0 for MAV_CMD_NAV_WAYPOINT, 16 for MAV_CMD_NAV_RETURN_TO_LAUNCH), latitude, longitude, altitude, and parameters. This format is consumed by Mission Planner and QGroundControl. The MAVLink mission upload uses the MAVSDK-Rust sidecar to send MISSION_ITEM messages to the connected drone, with each waypoint as a separate MISSION_ITEM containing the target coordinate, altitude, and MAV_CMD_NAV_WAYPOINT command.",
        BODY
    ))

    story.append(Paragraph(
        "The Litchi CSV format is a simple comma-separated file with columns for latitude, longitude, altitude (relative to ground), gimbal pitch, gimbal yaw, and photo action. The senseFly eMotion XML format is a proprietary XML schema with a Mission element containing Waypoint children, each with Position (latitude, longitude, altitude Above Sea Level), PhotoAction, and TriggerDistance elements. The generic KML format uses the KML 2.2 specification with Point geometry for each waypoint and ExtendedData elements for altitude, speed, and action metadata, allowing import into any GIS application. Each export format is tested by round-tripping: generate a mission, export, re-import, and verify the waypoints match within 1 centimeter of horizontal error and 0.1 meters of vertical error.",
        BODY
    ))

    story.append(add_subsection("6.3 Live Drone Link (MAVSDK-Rust Sidecar)"))
    story.append(Paragraph(
        "The live drone link uses a Rust sidecar built on the MAVSDK-Rust crate, which provides a high-level API over the MAVLink binary protocol. The sidecar connects to ArduPilot and PX4 autopilots over USB serial (typically /dev/ttyACM0 on Linux, COM3 on Windows) or UDP (typically 14550 for telemetry radios). The sidecar exposes a JSON-over-stdin/stdout protocol to the Electron or Tauri main process, with messages for connect, disconnect, start_telemetry_stream, upload_mission, start_mission, and rtl (Return to Launch). The telemetry stream is pushed from the sidecar to the main process at 5 Hz for HEARTBEAT and BATTERY_STATUS, and at 10 Hz for ATTITUDE and GPS_RAW_INT, matching the typical autopilot broadcast rates.",
        BODY
    ))

    story.append(Paragraph(
        "The React renderer subscribes to the telemetry stream via an IPC event listener and updates a live dashboard with the drone's position, altitude, battery percentage, voltage, current, heading, GPS fix type, satellite count, and flight mode. The mission upload pipeline serializes the internal mission representation to MAVLink MISSION_ITEM messages, sends them to the drone via the MAVSDK mission.upload_mission API, and verifies the upload by reading back the mission count. The start_mission command arms the drone (with a confirmation dialog in the UI for safety) and triggers the MAV_CMD_MISSION_START command. The RTL command sends the MAV_CMD_NAV_RETURN_TO_LAUNCH command, which initiates an automatic return to the launch point at the configured RTL altitude. All commands that affect drone state require a two-step confirmation in the UI: a click to arm, followed by a 5-second hold-to-confirm button, to prevent accidental activation.",
        BODY
    ))

    story.append(add_subsection("6.4 In-app Photogrammetry (ODM Sidecar)"))
    story.append(Paragraph(
        "The in-app photogrammetry replaces the external WebODM server dependency with a local OpenDroneMap sidecar. The preferred deployment is a Docker container spawned on-demand by the desktop app, using the official opendronemap/odm image. The desktop app mounts the photo directory as a volume, writes a JSON configuration file with the processing options (orthophoto-resolution, dem-resolution, dsm, dtm, contour-resolution), and starts the container. Progress is streamed back via Docker's log API and displayed in the UI as a progress bar with the current stage name. On completion, the orthophoto, DSM, DTM, point cloud, and contour files are imported into the MetaRDU dataset registry using the existing drone-imagery.ts import pipeline.",
        BODY
    ))

    story.append(Paragraph(
        "For systems without Docker, a PyInstaller-bundled native ODM binary is provided as a fallback. This binary is approximately 2 gigabytes in size and includes a bundled Python runtime, the ODM Python code, and all required native dependencies (OpenSfM, OpenMVS, PDAL, GDAL, etc.). The binary is downloadable from the MetaRDU website as an optional component during installation. The minimum system requirement for photogrammetry work is 16 GB of RAM and 50 GB of free disk space, and a system-requirements check at startup gates the feature. The existing external WebODM server integration is preserved as a third option for high-end users who prefer cloud processing, so the user has three choices: local Docker, local native, or external server.",
        BODY
    ))

    story.append(add_subsection("6.5 ML Feature Extraction (ONNX Runtime)"))
    story.append(Paragraph(
        "The ML feature extraction pipeline runs in Phase 3 and uses the ONNX Runtime via the Rust ort crate, hosted in the Tauri main process. Three models are supported: building footprint extraction using a U-Net model pre-trained on the OpenCities AI dataset, road centerline extraction using a separate U-Net model trained on the SpaceNet 2 dataset, and change detection between two orthophoto epochs using a Siamese network. The default installation bundles only the building footprint model (approximately 200 megabytes); the road and change-detection models are downloadable on demand from the MetaRDU website.",
        BODY
    ))

    story.append(Paragraph(
        "The inference pipeline accepts an orthophoto GeoTIFF as input, tiles it into 512 by 512 pixel chunks with a 64-pixel overlap to avoid boundary artifacts, runs each tile through the model, and stitches the predictions back together. Post-processing converts the predicted mask into GeoJSON polygons by tracing the mask contours using the OpenCV findContours algorithm, simplifying the polygons with the Douglas-Peucker algorithm, and filtering out polygons smaller than 10 square meters (noise) or larger than 10,000 square meters (likely errors). The output is a GeoJSON file with one polygon per building, ready for import into the MetaRDU parcel registry. Inference latency is approximately 5 seconds per 512 by 512 pixel tile on an M1 MacBook Air, so a 100-hectare survey at 5 centimeter per pixel GSD (approximately 200 million pixels, or 800 tiles) takes about 70 minutes of compute time, which is acceptable for batch processing but explicitly not real-time.",
        BODY
    ))

    return story
