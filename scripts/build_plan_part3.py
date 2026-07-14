"""
Content for chapters 7-12 of the MetaRDU Desktop Upgrade Plan.
"""

from reportlab.platypus import Paragraph, Spacer, PageBreak
import sys
sys.path.insert(0, '/home/z/my-project/scripts')
from build_plan_part1 import (
    H1, H2, H3, BODY, BODY_NO_INDENT, BULLET, META,
    TABLE_HEADER_STYLE, TABLE_CELL_STYLE, TABLE_CELL_CENTER,
    ACCENT, ACCENT_2, HEADER_FILL, TEXT_PRIMARY, TEXT_MUTED,
    CARD_BG, TABLE_STRIPE, BORDER, SEM_SUCCESS, SEM_WARNING, SEM_ERROR, SEM_INFO,
    AVAILABLE_W, add_heading, add_major_section, add_subsection, add_subsubsection,
    make_table, callout, safe_keep_together,
)


def build_chapter_7():
    """Chapter 7: Math Standards & Compliance"""
    story = []
    story.extend(add_major_section("Chapter 7: Math Standards &amp; Compliance"))

    story.append(Paragraph(
        "Six math standards govern the accuracy and quality of MetaRDU Desktop outputs. Each standard has a different scope, jurisdiction, and implementation status in the v1.0 codebase. The compliance matrix below maps each standard to its current implementation status and the gap that the upgrade plan closes. The standards are layered: ASPRS 2014 governs remote sensing and photogrammetry outputs (orthophotos, DSMs, point clouds); ISO 19157 governs the broader data quality of all geographic information; NMAS 1947 is a legacy standard still cited in some jurisdictions; RDM 1.1 and Cap. 299 are Kenya-specific and govern cadastral, engineering, and topographic surveys; FGDC-STD-007.3 is the US NSSDA standard for future USA expansion; and ICSM SP1 is the Australia and New Zealand standard for future ANZ expansion.",
        BODY
    ))

    story.append(add_subsection("7.1 ASPRS 2014 (Positional Accuracy Standards for Remote Sensing)"))
    story.append(Paragraph(
        "The ASPRS Positional Accuracy Standards for Digital Geospatial Data (2014) define three accuracy classes for remote sensing products including orthophotos, digital surface models, and point clouds. Class I requires a horizontal RMSE of 7.5 centimeters (1:500 scale equivalent) and a vertical RMSE of 15 centimeters. Class II requires 15 centimeters horizontal and 30 centimeters vertical (1:1000 scale). Class III requires 37.5 centimeters horizontal and 75 centimeters vertical (1:2500 scale). The standard also defines the methodology: at least 20 check points distributed across the project area, with horizontal RMSE computed as the square root of the mean of the squared horizontal errors (RMSE_r equals the square root of RMSE_x squared plus RMSE_y squared), and vertical RMSE computed as the square root of the mean of the squared vertical errors.",
        BODY
    ))

    story.append(Paragraph(
        "The v1.0 codebase already implements ASPRS Class I, II, and III thresholds in the drone accuracy checker (tools/drone/page.tsx in the upstream web app, ported to the desktop drone-imagery module). The check is one-directional: the surveyor inputs the residuals manually, and the checker computes the RMSE and assigns a class. The Phase 1 upgrade parses the residuals directly from the ODM or Pix4D quality report XML, eliminating manual transcription. The Phase 2 upgrade adds the GIS QA Engineer agent as a gate that automatically runs the ASPRS check before any orthophoto or DSM is published to the dataset registry, blocking publication if the residual RMSE exceeds the user-specified class threshold.",
        BODY
    ))

    story.append(add_subsection("7.2 NMAS 1947 (National Map Accuracy Standards)"))
    story.append(Paragraph(
        "The National Map Accuracy Standards (NMAS) of 1947 are a legacy US standard still cited in some jurisdictions, particularly for printed maps. The standard requires that 90% of well-defined points tested shall be within 1/30 inch (0.85 millimeters) of their true position on a map at the published scale. For a 1:1000 scale map, this corresponds to 0.85 meters on the ground; for 1:5000, 4.25 meters. Vertical accuracy requires 90% of elevations to be within half the contour interval. NMAS is largely superseded by the NSSDA (FGDC-STD-007.3) which uses RMSE instead of the 90% threshold, but NMAS remains a useful reference for historical comparisons and for clients who specifically request it.",
        BODY
    ))

    story.append(Paragraph(
        "The v1.0 codebase does not implement NMAS. The Phase 1 upgrade adds a NMAS compliance check alongside the existing ASPRS check, computing the equivalent NMAS accuracy for a given map scale and reporting both ASPRS class and NMAS 90% threshold in the accuracy report. This is a low-effort addition because the math is simply scale-dependent: NMSE_accuracy equals the map scale denominator multiplied by 0.85 millimeters divided by 1000 to convert to meters. The implementation is approximately 50 lines of TypeScript in the drone-accuracy module.",
        BODY
    ))

    story.append(add_subsection("7.3 ISO 19157 (Geographic Information - Data Quality)"))
    story.append(Paragraph(
        "ISO 19157:2013 establishes the principles for describing the quality of geographic data and specifies the data quality elements, sub-elements, data quality measures, and the identification mechanism. The standard defines five data quality elements: positional accuracy (further subdivided into absolute accuracy, relative accuracy, and gridded data position accuracy), thematic accuracy (classification correctness and non-quantitative attribute correctness), temporal accuracy (temporal validity and temporal accuracy), logical consistency (conceptual, domain, format, and topological consistency), and completeness (commission and omission). For each element, the standard provides a catalog of measures with their formulas and units.",
        BODY
    ))

    story.append(Paragraph(
        "The v1.0 codebase implements positional accuracy (via ASPRS) and logical consistency (via the GIS QA Report's topology checks), but does not implement thematic accuracy, temporal accuracy, or completeness measures. The Phase 2 upgrade adds the missing elements: thematic accuracy via the ML feature extraction model's classification confidence score; temporal accuracy via the dataset registry's capture timestamp and validity window; completeness via a comparison between the expected survey area polygon and the actual orthophoto coverage polygon, reporting any gaps as omission errors. The GIS QA Engineer agent runs all five elements as a gate before any dataset is published, producing an ISO 19157-compliant quality report embedded in the dataset metadata.",
        BODY
    ))

    story.append(add_subsection("7.4 RDM 1.1 / Cap. 299 (Kenya-Specific)"))
    story.append(Paragraph(
        "The Kenya Roads Design Manual (RDM 1.1, 2025 edition) and the Survey Act Cap. 299 are the primary regulatory frameworks for surveying in Kenya. RDM 1.1 Section 8 specifies a levelling closure tolerance of 10 times the square root of K millimeters, where K is the levelling line length in kilometers. For a 1-kilometer line, the tolerance is 10 millimeters; for 4 kilometers, 20 millimeters; for 16 kilometers, 40 millimeters. The Survey Act Cap. 299 specifies an angular misclosure of 15 seconds times the square root of N, where N is the number of traverse stations, and a linear misclosure of 1:10000 for urban surveys and 1:5000 for rural surveys. These constants are already implemented in the v1.0 engine and are part of the Form No. 4 deed plan generation pipeline.",
        BODY
    ))

    story.append(Paragraph(
        "RDM 1.1 Section 5.2.4 also requires clothoid transition curves for all roads with a design speed above 50 kilometers per hour. The v1.0 engine has a full 522-line clothoid implementation (spiral parameter A equals the square root of R times Ls, spiral angle tau equals Ls divided by 2R, curve shift p, tangent offset q, TS/SC/CS/ST chainages, modified tangent Ts equals (R+p) times tan of half the intersection angle plus q), but this is not exposed in the road design UI. The Phase 1 upgrade wires the clothoid engine module to the road design React component, making it the default for design speeds above 50 kilometers per hour and producing the TS, SC, CS, and ST chainages in the setting-out sheet. This is one of the five P0 math features identified in the v1.0 math improvement plan.",
        BODY
    ))

    story.append(add_subsection("7.5 FGDC-STD-007.3 (NSSDA) and ICSM SP1 (Future Expansion)"))
    story.append(Paragraph(
        "The FGDC-STD-007.3 standard, also known as the National Standard for Spatial Data Accuracy (NSSDA), is the US federal standard for reporting positional accuracy of geospatial data. It uses the RMSE methodology similar to ASPRS 2014 but reports accuracy as the 95% confidence interval, computed as 1.96 times the RMSE for horizontal accuracy (assuming normally distributed errors) and 1.96 times the RMSE for vertical accuracy. The ICSM SP1 standard (Special Publication 1, Intergovernmental Committee on Surveying and Mapping) is the equivalent Australian and New Zealand standard, with similar RMSE-based methodology but slightly different confidence interval factors (1.96 for horizontal at 95%, 1.96 for vertical at 95%).",
        BODY
    ))

    story.append(Paragraph(
        "Neither standard is implemented in v1.0 because the product is Kenya-focused. Both are added in Phase 3 as part of the country-pack architecture expansion, which introduces USA and Australia/New Zealand country packs with their respective CRS (WGS84 / ETRS89 / GDA2020), deed plan templates, and accuracy standards. The implementation is straightforward because the math is identical to ASPRS with a different reporting convention: NSSDA accuracy equals 1.96 times RMSE. The country-pack architecture (ADR-005) already supports per-country standards, so adding the USA and ANZ packs is approximately one week of work each, plus the regulatory research to identify the equivalent of Form No. 4 in each jurisdiction.",
        BODY
    ))

    compliance_data = [
        ['Standard', 'Scope', 'v1.0 Status', 'Phase', 'Action'],
        ['ASPRS 2014', 'Remote sensing', 'Partial (manual input)', 'P1', 'Auto-parse ODM/Pix4D residuals'],
        ['NMAS 1947', 'Printed maps', 'Missing', 'P1', 'Add scale-based 90% check'],
        ['ISO 19157', 'Geographic data quality', 'Partial (positional + logical)', 'P2', 'Add thematic + temporal + completeness'],
        ['RDM 1.1 / Cap. 299', 'Kenya (cadastral/eng/topo)', 'Engine complete, UI partial', 'P1', 'Wire 5 P0 math features to UI'],
        ['FGDC-STD-007.3', 'USA (future)', 'Missing', 'P3', 'Add USA country pack'],
        ['ICSM SP1', 'ANZ (future)', 'Missing', 'P3', 'Add ANZ country pack'],
    ]
    story.append(Spacer(1, 6))
    story.append(make_table(compliance_data, [0.20, 0.22, 0.22, 0.08, 0.28]))
    story.append(Spacer(1, 14))

    return story


def build_chapter_8():
    """Chapter 8: Engineering Practices (Agency-Agents Workflow)"""
    story = []
    story.extend(add_major_section("Chapter 8: Engineering Practices (Agency-Agents Workflow)"))

    story.append(Paragraph(
        "The msitarzewski/agency-agents repository provides 230-plus specialized AI agent personas, each with a distinct identity, mission, critical rules, technical deliverables, and success metrics. The framework is not a runtime system but a set of installable agent definitions that slot into Claude Code, Cursor, Copilot, and other AI-assisted development tools. For the MetaRDU Desktop upgrade, twelve agents from the Engineering, GIS, Testing, Security, and Project Management divisions form the core team, with five additional agents activated on-demand for specific phases. The workflow follows the sequential-handoff-with-quality-gates pattern documented in the agency-agents examples.",
        BODY
    ))

    story.append(add_subsection("8.1 The Twelve-Agent Core Roster"))
    story.append(Paragraph(
        "The twelve agents are activated in a specific sequence that matches the four-phase workflow. Phase 0 activates the Codebase Onboarding Engineer in read-only mode to produce a factual map of the current architecture, the IPC surface, the dependencies, and the tech-debt inventory. This map is the input to every subsequent agent. Phase 1 adds the Software Architect (owns ADRs and the trade-off matrix), the Desktop App Engineer (owns the zod IPC validation, code-signing, and auto-update infrastructure), the Spatial Data Engineer (owns GDAL integration and CRS reprojection), the Drone/Reality Mapping agent (owns the flight planning math and mission export), and the GIS QA Engineer (runs the math and GDAL acceptance gates at the end of Phase 1).",
        BODY
    ))

    story.append(Paragraph(
        "Phase 2 adds the Web GIS Developer (owns the live telemetry dashboard UI), the 3D &amp; Scene Developer (owns the ODM point cloud viewer integration), and the Reality Checker (runs the midpoint gate at the end of Month 6). The Test Automation Engineer joins in Month 6 to stand up the Playwright E2E suite for the new live drone link and photogrammetry journeys. Phase 3 adds the Security Architect and Application Security Engineer (run the threat model on the new Tauri IPC boundary and the ML inference pipeline), the Performance Benchmarker (verifies the footprint budgets), the Technical Writer (owns the tutorial video scripts and the v2.0 release notes), and the Reality Checker again for the pre-launch GO/NO-GO gate.",
        BODY
    ))

    roster_data = [
        ['#', 'Agent', 'Division', 'Phase', 'Primary Deliverable'],
        ['1', 'Codebase Onboarding Engineer', 'Engineering', 'P0', 'Architecture map + tech-debt inventory'],
        ['2', 'Software Architect', 'Engineering', 'P1-3', 'ADRs 006-012 + trade-off matrix + C4 diagrams'],
        ['3', 'Desktop App Engineer', 'Engineering', 'P1-3', 'zod IPC + code-signing + Tauri migration'],
        ['4', 'Spatial Data Engineer', 'GIS', 'P1-2', 'GDAL bindings + CRS reprojection + format conversion'],
        ['5', 'Drone/Reality Mapping', 'GIS', 'P1-2', 'Flight planning + mission export + MAVSDK sidecar'],
        ['6', 'GIS QA Engineer', 'GIS', 'P1-3', 'Topology/CRS/RMSE accuracy validation gates'],
        ['7', 'Web GIS Developer', 'GIS', 'P2', 'Live telemetry dashboard + processing UI'],
        ['8', '3D & Scene Developer', 'GIS', 'P2', 'ODM point cloud viewer integration'],
        ['9', 'Test Automation Engineer', 'Testing', 'P2-3', 'Deterministic Playwright E2E, sharded in CI'],
        ['10', 'Security Architect', 'Security', 'P3', 'Threat model + SAST/DAST in CI'],
        ['11', 'Application Security Engineer', 'Security', 'P3', 'Code-level vulnerability review'],
        ['12', 'Reality Checker', 'Testing', 'P2,P3', 'Midpoint + pre-launch GO/NO-GO gates'],
    ]
    story.append(Spacer(1, 6))
    story.append(make_table(roster_data, [0.04, 0.22, 0.13, 0.10, 0.51]))
    story.append(Spacer(1, 14))

    story.append(add_subsection("8.2 Sequential Handoff Workflow"))
    story.append(Paragraph(
        "The agency-agents framework mandates sequential handoffs: each agent's output becomes the next agent's input, pasted in full because agents do not share memory. This is the opposite of the parallel-everything approach used by some multi-agent systems, and it exists because summarization loses critical context. For the MetaRDU upgrade, the handoff chain is: Codebase Onboarding Engineer produces the architecture map, which the Software Architect reads in full before writing the ADRs; the ADRs are read in full by the Desktop App Engineer before designing the zod schemas; the schemas are read in full by the Spatial Data Engineer before designing the GDAL integration; and so on. Every handoff is a git commit with a structured worklog entry in the project's worklog.md file.",
        BODY
    ))

    story.append(Paragraph(
        "Discovery-phase agents (Codebase Onboarding, Software Architect, Senior Project Manager, Sprint Prioritizer) run in parallel during Phase 0 and the first two weeks of Phase 1, because their outputs are independent. Build-phase agents (Desktop App Engineer, Spatial Data Engineer, Drone/Reality Mapping, Web GIS Developer, 3D &amp; Scene Developer) run in parallel within each phase but with dependencies on the discovery outputs. Quality-phase agents (Test Automation Engineer, GIS QA Engineer, Security Architect, Reality Checker) run sequentially with explicit gates: the Test Automation Engineer's E2E suite must pass before the GIS QA Engineer runs the accuracy gates, and both must pass before the Reality Checker runs the GO/NO-GO gate.",
        BODY
    ))

    story.append(add_subsection("8.3 Testing Methodology"))
    story.append(Paragraph(
        "The Test Automation Engineer agent enforces a strict determinism-over-coverage philosophy. The iron rule is that a flaky test is a bug with your name on it, and no hard sleeps are ever allowed. Tests wait on conditions (element state, network response, URL change) rather than fixed timeouts. Tests own their data via API-based factories, never via the UI, and each test worker gets isolated data with no shared seed users. The selector strategy is getByRole first, data-testid as an escape hatch, and never brittle CSS chains. The test pyramid discipline pushes everything provable down to unit tests, with E2E reserved for journeys where the integration itself is the risk. The full E2E suite must run in under 10 minutes via sharding across CI workers.",
        BODY
    ))

    story.append(Paragraph(
        "Flaky tests leave the merge-blocking suite within 24 hours and enter a triage queue, never deleted without diagnosis. Every failure produces artifacts: trace, screenshot, video, console log, and network log. The phrase works on my machine is treated as a tooling failure, not an excuse. Numeric service level objectives are: pass rate at or above 99.5%, flake rate below 0.5%, retries trending to zero, and the full suite completing in under 10 minutes. The GIS QA Engineer agent adds domain-specific gates: topology validation (no self-intersections, no gaps, no overlaps), CRS consistency (every layer in the same CRS or explicitly reprojected), and RMSE accuracy assessment before any dataset is published to the registry.",
        BODY
    ))

    story.append(add_subsection("8.4 Security Model"))
    story.append(Paragraph(
        "The Security Architect and Application Security Engineer agents enforce a secure-by-design, defense-in-depth posture. The trust boundary is the IPC layer: the renderer is treated as a browser tab with delusions of grandeur, with contextIsolation true, nodeIntegration false, and sandbox true (or the Tauri equivalent). Every IPC channel validates inputs on the privileged side using the zod schemas from ADR-012, and exposes the narrowest possible verb: saveUserExport(data) rather than writeFile(path, data). Remote content never gets privileges. The drone-data ingestion paths (KMZ import, ODM output import, MAVLink telemetry) are threat-modeled as untrusted inputs because they originate from external systems that may be compromised or buggy.",
        BODY
    ))

    story.append(Paragraph(
        "The security SDLC embeds SAST (Semgrep or CodeQL) and DAST (OWASP ZAP for the IPC surface) in the CI pipeline, with dependency scanning (Dependabot or Snyk) and secret scanning (GitHub Secret Scanning) running on every push. The Security Architect produces a threat model document at the start of Phase 3 covering the new Tauri IPC boundary, the MAVSDK-Rust sidecar, the ODM sidecar subprocess, the ONNX Runtime inference pipeline, and the auto-update channel. The threat model is reviewed by the Application Security Engineer who produces a code-level vulnerability report. The bug bounty program (Phase 1) accepts external reports on the same scope, with reward tiers of $100 (low), $500 (medium), $2000 (high), and $5000 (critical).",
        BODY
    ))

    return story


def build_chapter_9():
    """Chapter 9: Production Readiness & Release Plan"""
    story = []
    story.extend(add_major_section("Chapter 9: Production Readiness &amp; Release Plan"))

    story.append(Paragraph(
        "Production readiness is not a single gate at the end of Phase 3 but a continuous discipline applied from Phase 1 onward. The Desktop App Engineer agent's critical rule is that the updater is the most critical code you own, and signing and notarization infrastructure must be stood up before feature one, not after. This is because a desktop app distributed to field crews on poor networks, where a broken auto-updater strands every user, is a worse experience than no auto-updater at all. The release plan covers six workstreams: code-signing, auto-update, closed beta, bug bounty, tutorial videos, and the public v2.0 release.",
        BODY
    ))

    story.append(add_subsection("9.1 Code-Signing Infrastructure"))
    story.append(Paragraph(
        "Code-signing certificates are purchased in Phase 1 Month 3 and configured for all three platforms. For Windows, an Extended Validation (EV) certificate is purchased from SSL.com or DigiCert for approximately $300 per year. The EV certificate is required for immediate SmartScreen reputation on Windows 10 and 11, which is critical because a standard OV certificate triggers SmartScreen warnings for new publishers and can take weeks to build reputation. The EV certificate is stored on a hardware token (YubiKey or USB HSM) per Microsoft's requirement that EV keys never leave the token. The signing process uses azure-signtool or signtool with the /fd sha256 flag for SHA-256 digest, which is the current Windows requirement.",
        BODY
    ))

    story.append(Paragraph(
        "For macOS, an Apple Developer ID is purchased for $99 per year. The Developer ID Application certificate is used to sign the .app bundle, and the notarization process uses the notarytool command-line tool to submit the bundle to Apple's notarization service, which scans for malware and signs the bundle with an Apple-issued ticket. The stapler tool then staples the ticket to the bundle so it works offline. The hardened runtime is enabled with the com.apple.security.cs.allow-jit entitlement if the Rust sidecar uses JIT, and the com.apple.security.cs.disable-library-validation entitlement is avoided unless absolutely necessary. For Linux, the AppImage is signed with GPG and the .deb is signed with dpkg-sig, though Linux desktop users rarely verify signatures.",
        BODY
    ))

    story.append(add_subsection("9.2 Auto-Update with Staged Rollout"))
    story.append(Paragraph(
        "The auto-update infrastructure uses electron-updater in Phases 1 and 2 (Electron shell) and tauri-plugin-updater in Phase 3 (Tauri shell). Both point at GitHub Releases as the update provider, which means a new release is published by tagging a git commit, pushing the tag, and uploading the platform-specific binaries as release assets. The update manifest (latest.yml for electron-updater, latest.json for tauri-plugin-updater) is generated by the build script and uploaded alongside the binaries. The auto-update check runs at app startup and every 4 hours thereafter, with a 15-minute jitter to avoid thundering herd on the GitHub Releases API.",
        BODY
    ))

    story.append(Paragraph(
        "The staged rollout follows the Desktop App Engineer's pattern: 1% adoption for the first 7 days, expanding to 10% if the crash-free session rate stays above 99.5% and the update-success rate stays above 95%, then expanding to 100% after another 7 days at 10% with the same gates. The rollout percentage is controlled by the update manifest's stagingPercentage field, which the build script sets based on environment variables. If the crash-free rate drops below 99.5% at any stage, the rollout is paused and the previous manifest is republished, which triggers an automatic rollback for all users who have not yet updated. A rollback drill is run before the public v2.0 release: publish a v2.0.1-rc with a known bug, verify the crash detection, republish v2.0.0 as latest, and verify that users on v2.0.1-rc roll back automatically.",
        BODY
    ))

    story.append(add_subsection("9.3 Closed Beta Program"))
    story.append(Paragraph(
        "The closed beta program launches in Phase 2 Month 5 with the first cohort of 5 Kenyan surveyors, expanding to 10 surveyors in Month 6. The recruitment targets licensed surveyors from the Institution of Surveyors of Kenya (ISK) and the Engineers Board of Kenya (EBK), with a preference for surveyors who already use drone photogrammetry in their practice. Each beta participant signs a Non-Disclosure Agreement and a data-handling agreement that covers the test datasets, the feedback, and any bugs they report. Each participant receives a $500 stipend for the two-week trial period, which compensates them for the time spent testing and providing structured feedback.",
        BODY
    ))

    story.append(Paragraph(
        "The feedback collection is structured: a daily 5-minute pulse survey (rate today's usage from 1 to 10, what worked, what didn't), a weekly 30-minute deep-dive survey (specific workflow walkthroughs, bug reports with screenshots, feature requests), and a final 60-minute interview at the end of the two-week trial. Weekly office hours are held on Zoom every Thursday evening (East Africa Time) for live Q&amp;A and screen-sharing. The feedback is aggregated into a Beta Dashboard that tracks Net Promoter Score, workflow completion rates, bug severity distribution, and feature request priority. The Reality Checker uses this dashboard as evidence at the midpoint gate and the pre-launch gate.",
        BODY
    ))

    story.append(add_subsection("9.4 Bug Bounty Program"))
    story.append(Paragraph(
        "The bug bounty program launches in Phase 1 Month 3 on GitHub Security Advisories, which is free and integrated with the existing GitHub repository. The scope is the IPC boundary (any channel that can be invoked from the renderer with malformed input), the drone-data ingestion paths (KMZ, ODM output, MAVLink telemetry), the auto-update channel (manifest tampering, binary replacement), and the cryptographic seal (RSA-2048 key handling). Out of scope: the renderer JavaScript (because it runs in a sandbox), the Rust sidecar internal logic (because it is not directly exposed), and social engineering. Reward tiers: $100 for low (information disclosure, denial of service requiring user interaction), $500 for medium (privilege escalation within the app, data corruption), $2000 for high (remote code execution in the main process, key compromise), and $5000 for critical (remote code execution with system access, RSA key extraction).",
        BODY
    ))

    story.append(add_subsection("9.5 Tutorial Videos and Public Release"))
    story.append(Paragraph(
        "Three tutorial videos are produced in Phase 3 Month 8, each approximately 10 minutes long, covering the three core workflows: cadastral survey (12-leg traverse to sealed Form No. 4 PDF), topographic survey (50,000-point dataset to DXF with contours), and drone survey (flight plan to orthophoto to GCP verification to ML building footprint extraction). The videos are recorded in OBS Studio at 1920 by 1080 resolution with a clean audio track from a USB microphone. The editing is done in DaVinci Resolve (free version), with intro and outro cards, on-screen text for keyboard shortcuts, and chapter markers matching the workflow steps. A freelance video editor is contracted for $1500 total ($500 per video) to handle the editing, allowing the lead engineer to focus on recording.",
        BODY
    ))

    story.append(Paragraph(
        "The public v2.0.0 release in Month 9 follows a documented release runbook: freeze the main branch, run the full CI suite on all three platforms, run the Reality Checker pre-launch gate (requires evidence per criterion), tag the v2.0.0 commit, push the tag, run the release build script which produces the platform-specific binaries and uploads them to GitHub Releases, publish the release notes (auto-generated changelog plus the Technical Writer's narrative), update the metardu.com download page, publish the three tutorial videos to YouTube, and announce on Twitter/X, the ISK mailing list, and the r/Surveying subreddit. The SRE agent is on standby for the first 72 hours, with a PagerDuty escalation path for any P1 incident. The staged rollout begins at 1% on day 1, expands to 10% on day 7 if crash-free rate is above 99.5%, and expands to 100% on day 14.",
        BODY
    ))

    return story


def build_chapter_10():
    """Chapter 10: Risk Matrix & Mitigation"""
    story = []
    story.extend(add_major_section("Chapter 10: Risk Matrix &amp; Mitigation"))

    story.append(Paragraph(
        "Ten risks are identified, scored on likelihood and impact, and paired with a mitigation and a contingency. The risk heat map below shows the distribution: two risks are High/High (R1 Tauri migration breaks IPC handlers, R9 scope creep), three are Med/High (R2 ODM too heavy, R6 cert delays, R7 rusqlite migration), three are Med/Med (R3 MAVLink latency, R4 ML false positives, R8 GDAL bindings), and two are Low or Med/Med (R5 beta UX issues, R10 Reality Checker blocks). The overall risk profile is moderate: the highest risks (R1, R7) are mitigated by maintaining a parallel Electron release branch throughout Phase 3, so the team can roll back to v1.x if the Tauri build fails to stabilize.",
        BODY
    ))

    risk_data = [
        ['#', 'Risk', 'Likelihood', 'Impact', 'Mitigation', 'Contingency'],
        ['R1', 'Tauri migration breaks 118 IPC handlers', 'High', 'High', 'Maintain parallel Electron branch; migrate one namespace at a time with E2E coverage', 'Delay v2.0 by 1 month; ship Tauri as v2.1'],
        ['R2', 'ODM sidecar too heavy for low-end machines', 'Med', 'High', 'Gate feature behind 16GB RAM check; provide external WebODM fallback', 'Defer in-app photogrammetry to v2.1'],
        ['R3', 'MAVLink telemetry latency on poor networks', 'Med', 'Med', 'Use USB serial not UDP; buffer telemetry at 5Hz; document USB cable requirements', 'Mark live telemetry as beta; prioritize mission export'],
        ['R4', 'ML model false positives in feature extraction', 'Med', 'Med', 'Use IoU > 0.65 threshold; manual review UI before saving polygons', 'Ship building footprint only; defer road and change detection'],
        ['R5', 'Beta uncovers UX issues blocking release', 'High', 'Med', 'Weekly office hours; structured feedback; iterate weekly on top 3 issues', 'Add 1-month buffer; slip to v2.0.1 patch releases'],
        ['R6', 'Code-signing cert delays (EV cert provisioning)', 'Low', 'High', 'Order cert in Month 1; use OV cert as interim; document EV process', 'Ship unsigned with explicit warning; defer signing to v2.0.1'],
        ['R7', 'better-sqlite3 to rusqlite data migration loses data', 'Low', 'Critical', 'Write migration script with checksum verification; test on 10 sample databases; backup before migration', 'Maintain Electron branch indefinitely; cancel Tauri migration'],
        ['R8', 'GDAL native bindings cross-platform issues', 'Med', 'Med', 'Use gdal-async with pre-built binaries; shell-out fallback; test on all 3 OS in CI', 'Use shell-out only; defer native bindings to v2.1'],
        ['R9', 'Scope creep delays v2.0 beyond 9 months', 'High', 'High', 'Sprint Prioritizer agent; weekly scope review; defer non-P0 features to v2.1', 'Slip to 10-11 months; cut ML feature extraction from v2.0'],
        ['R10', 'Reality Checker blocks release at pre-launch', 'Med', 'High', 'Run Reality Checker at midpoint too; weekly evidence collection; address issues as they arise', 'Address flagged issues; 2-4 week slip; v2.0.0-rc1 to closed beta'],
    ]
    story.append(Spacer(1, 6))
    story.append(make_table(risk_data, [0.04, 0.21, 0.09, 0.08, 0.30, 0.28]))
    story.append(Spacer(1, 14))

    story.append(add_subsection("10.1 Top Three Risks in Detail"))
    story.append(Paragraph(
        "<b>R1 Tauri migration breaks IPC handlers.</b> This is the single largest risk because the migration touches every one of the 118 IPC handlers. The mitigation is to migrate one IPC namespace at a time, with full Playwright E2E coverage of every channel before the next namespace starts. The parallel Electron release branch is maintained throughout Phase 3, so if any namespace fails to stabilize on Tauri, the team can ship the Tauri build with that namespace still routed through a sidecar Electron process (a hybrid deployment that adds complexity but unblocks release). The contingency is to delay v2.0 by one month and ship the Tauri build as v2.1, with v2.0 being a final Electron release that includes all the Phase 1 and 2 drone features.",
        BODY
    ))

    story.append(Paragraph(
        "<b>R7 better-sqlite3 to rusqlite data migration.</b> Although the likelihood is low, the impact is critical because data loss in a surveyor's project database is unacceptable. The migration script reads the existing SQLite database, creates a new rusqlite-backed database, copies all tables and rows, and verifies with a row count and a checksum comparison. The script is tested on 10 sample databases including the largest known MetaRDU project (50,000 points, 200 traverse legs, 30 GCPs). The backup strategy is to copy the original .metardu file to a .metardu.backup before running the migration, and to never delete the backup until the user explicitly confirms the migration succeeded. If the migration fails on any database, the Tauri build is pulled and the Electron branch is maintained indefinitely.",
        BODY
    ))

    story.append(Paragraph(
        "<b>R9 Scope creep delays v2.0 beyond 9 months.</b> The Sprint Prioritizer agent runs a weekly scope review with the lead engineer, comparing the actual progress against the planned milestones. Any feature that is more than 1 week behind schedule is flagged for either descope or defer. The default action is to defer non-P0 features to v2.1, with v2.0 shipping only the P0 features (Tauri migration, flight planning, live drone link, in-app photogrammetry, GDAL bindings) and the P1 features that are on track. The contingency is to slip the v2.0 release to 10 or 11 months, or to cut the ML feature extraction (the largest single Phase 3 workstream after Tauri migration) and ship it as v2.1.",
        BODY
    ))

    return story


def build_chapter_11():
    """Chapter 11: Budget, Timeline & KPIs"""
    story = []
    story.extend(add_major_section("Chapter 11: Budget, Timeline &amp; KPIs"))

    story.append(Paragraph(
        "The total budget estimate for the nine-month upgrade is $15,000 to $20,000 USD, with the range reflecting variable costs for drone hardware (purchase vs rental) and bug bounty payouts (which depend on the number and severity of valid reports). The budget is dominated by personnel costs, which assume a lead engineer working full-time on the upgrade and a part-time GIS consultant for the drone-specific math and regulatory compliance. The hardware and infrastructure costs are modest because the project uses open-source software throughout (Electron, Tauri, React, OpenDroneMap, GDAL, ONNX Runtime, MAVSDK) and GitHub Actions for CI/CD.",
        BODY
    ))

    story.append(add_subsection("11.1 Budget Breakdown"))
    budget_data = [
        ['Category', 'Item', 'Cost (USD)', 'Notes'],
        ['Personnel', 'Lead engineer (you), 9 months full-time', '$0', 'Sweat equity; assumes you are the lead'],
        ['Personnel', 'GIS consultant, 20 hrs/week × 9 months', '$14,400', '$80/hr × 20 hrs × 9 months'],
        ['Personnel', 'Video editor, 3 tutorial videos', '$1,500', '$500 per video'],
        ['Infrastructure', 'GitHub Pro (or Team)', '$48', '$4/mo × 12 months'],
        ['Infrastructure', 'Apple Developer ID', '$99', 'Annual'],
        ['Infrastructure', 'Windows EV code-signing cert', '$300', 'Annual, SSL.com or DigiCert'],
        ['Infrastructure', 'Sentry Team plan', '$312', '$26/mo × 12 months'],
        ['Infrastructure', 'Domain + hosting (metardu.com)', '$120', '$10/mo × 12 months'],
        ['Hardware', 'DJI Mavic 3 Enterprise (purchase)', '$3,500', 'OR rental $200/day × 10 days = $2,000'],
        ['Hardware', 'Pixhawk reference drone (build)', '$1,500', 'For ArduPilot/PX4 testing'],
        ['Hardware', 'RTK rover (Emlid Reach RS3 rental)', '$600', '$300/week × 2 weeks of GCP surveying'],
        ['Beta', 'Surveyor stipends (10 × $500)', '$5,000', '2-week trial compensation'],
        ['Bug bounty', 'Reward pool', '$2,000', 'Estimated 4 medium + 2 high reports'],
        ['Contingency', '10% buffer', '$1,400', 'For unexpected costs'],
        ['TOTAL', 'Lower bound (rental drone)', '$17,379', 'Excluding lead engineer sweat equity'],
        ['TOTAL', 'Upper bound (purchased drone)', '$18,879', 'Excluding lead engineer sweat equity'],
    ]
    story.append(Spacer(1, 6))
    story.append(make_table(budget_data, [0.15, 0.36, 0.13, 0.36]))
    story.append(Spacer(1, 14))

    story.append(add_subsection("11.2 Timeline (Gantt-Style)"))
    story.append(Paragraph(
        "The nine-month timeline is structured as three phases of three months each, with monthly milestones and phase gates. The table below summarizes the major milestones by month. Phase 1 (Months 1-3) focuses on stabilization and the flight planning engine. Phase 2 (Months 4-6) focuses on live drone connectivity and in-app photogrammetry, culminating in the closed beta and the Reality Checker midpoint gate. Phase 3 (Months 7-9) focuses on the Tauri migration, ML feature extraction, and the public v2.0 release, culminating in the Reality Checker pre-launch gate and the staged rollout.",
        BODY
    ))

    timeline_data = [
        ['Month', 'Phase', 'Major Milestones', 'Gate'],
        ['M1', 'P1', 'zod schemas complete; 2 P0 math features shipped', 'Code Reviewer'],
        ['M2', 'P1', '5 P0 math features; flight planning engine; GDAL bindings', 'Code Reviewer'],
        ['M3', 'P1', '5 mission export formats; code-signing verified; bug bounty live', 'GIS QA Engineer'],
        ['M4', 'P2', 'MAVSDK-Rust sidecar; live telemetry dashboard', 'Code Reviewer'],
        ['M5', 'P2', 'ODM sidecar; closed beta cohort 1 (5 surveyors)', 'Code Reviewer'],
        ['M6', 'P2', 'Closed beta cohort 2 (10 surveyors); Playwright E2E', 'Reality Checker (midpoint)'],
        ['M7', 'P3', 'Tauri shell scaffolding; 30 IPC handlers migrated', 'Code Reviewer'],
        ['M8', 'P3', 'All 118 IPC handlers migrated; ML building footprints; tutorial videos', 'GIS QA + Security'],
        ['M9', 'P3', 'Public v2.0.0 release; staged rollout begins', 'Reality Checker (pre-launch)'],
    ]
    story.append(Spacer(1, 6))
    story.append(make_table(timeline_data, [0.07, 0.07, 0.55, 0.31]))
    story.append(Spacer(1, 14))

    story.append(add_subsection("11.3 KPI Dashboard"))
    story.append(Paragraph(
        "The KPI dashboard is reviewed weekly by the lead engineer and the GIS consultant, and biweekly by the Reality Checker (when active). The dashboard is a single Markdown file in the repository (docs/KPI_DASHBOARD.md) updated automatically by CI on every push. The metrics are grouped into four categories: engineering (binary size, idle memory, cold start, test pass rate, IPC coverage), product (beta NPS, workflow completion rates, bug severity distribution), release (code-signing verification, auto-update success rate, crash-free sessions), and compliance (ASPRS class, ISO 19157 completeness, RDM 1.1 closure). The table below shows the target and current values for the top 10 KPIs as of the start of Phase 1.",
        BODY
    ))

    kpi_data = [
        ['KPI', 'Category', 'Target', 'Current (v1.0)'],
        ['Binary size (Windows)', 'Engineering', '< 15 MB', '~150 MB'],
        ['Idle memory', 'Engineering', '< 120 MB', '~350 MB'],
        ['Cold start (M1 MacBook Air)', 'Engineering', '< 1.2 s', '~2.4 s'],
        ['Engine test pass rate', 'Engineering', '100%', '100% (1259/1259)'],
        ['IPC handler zod coverage', 'Engineering', '100%', '0%'],
        ['Playwright E2E coverage', 'Engineering', '>= 80% of journeys', '0%'],
        ['Beta surveyor NPS', 'Product', '>= 7 of 10 score > 8', 'N/A'],
        ['Crash-free sessions (7-day)', 'Release', '>= 99.5%', 'Not measured'],
        ['Auto-update success rate', 'Release', '>= 99% over 1 minor bump', 'Never tested'],
        ['ASPRS Class I compliance', 'Compliance', 'RMSE_x,y < 7.5 cm', 'Manual input only'],
    ]
    story.append(Spacer(1, 6))
    story.append(make_table(kpi_data, [0.32, 0.15, 0.25, 0.28]))
    story.append(Spacer(1, 14))

    return story


def build_chapter_12():
    """Chapter 12: Conclusion & Next Actions"""
    story = []
    story.extend(add_major_section("Chapter 12: Conclusion &amp; Next Actions"))

    story.append(Paragraph(
        "MetaRDU Desktop v2.0 is an ambitious but achievable upgrade that transforms the product from a surveyor's office tool into a true drone survey workstation. The three-phase approach manages risk by deferring the largest architectural change (Tauri migration) to Phase 3, after the Rust sidecar pattern is proven on the existing Electron shell. The five drone capabilities (flight planning, live drone link, in-app photogrammetry, real raster I/O, ML feature extraction) close the gap between the metardu brand promise and the actual product functionality. The six math standards (ASPRS 2014, NMAS 1947, ISO 19157, RDM 1.1 / Cap. 299, FGDC-STD-007.3, ICSM SP1) position the product for both the current Kenyan market and future international expansion. The production readiness workstream (code-signing, closed beta, bug bounty, tutorial videos, staged rollout) ensures that v2.0 is not just feature-complete but truly production-ready.",
        BODY
    ))

    story.append(Paragraph(
        "The twelve-agent roster from the agency-agents framework provides the specialized expertise needed for each phase, with the Reality Checker serving as the quality gate at midpoint and pre-launch. The sequential-handoff workflow ensures that every agent's output is fully consumed by the next agent, preventing the context loss that plagues parallel multi-agent systems. The testing methodology (deterministic Playwright E2E, no sleeps, trace-on-retry, GIS QA gates) and the security model (IPC as trust boundary, narrowest-verb, zod validation per channel, SAST/DAST in CI) provide the engineering discipline needed for a production-grade desktop application distributed to field crews on unreliable networks.",
        BODY
    ))

    story.append(Paragraph(
        "The total budget of $15,000 to $20,000 over nine months is modest for the scope, primarily because the lead engineer's time is treated as sweat equity and the software stack is entirely open-source. The most significant variable cost is drone hardware for testing, which can be reduced by renting rather than purchasing. The closed beta stipends ($5,000 for 10 surveyors) are the highest-value spend because they provide the real-world feedback that no amount of automated testing can replace. The bug bounty reward pool ($2,000) is a small price for the security assurance it provides.",
        BODY
    ))

    story.append(add_subsection("12.1 Top Five Next Actions (Next 30 Days)"))
    story.append(Paragraph(
        "The following five actions should be taken in the next 30 days to kick off Phase 1. Each action is concrete, has a clear owner, and has a measurable completion criterion. These actions are the minimum viable start to the upgrade: completing them in the first month puts the project on track for the Phase 1 milestone cadence and the Month 3 phase gate.",
        BODY
    ))

    story.append(Paragraph(
        "<b>Action 1: Purchase code-signing certificates.</b> Order the Windows EV certificate from SSL.com or DigiCert ($300) and the Apple Developer ID ($99) in Week 1. The EV certificate provisioning takes 2-3 weeks because it requires business verification and a hardware token shipment, so ordering early is critical. Owner: lead engineer. Completion criterion: both certificates received and the signing process verified on a test build.",
        BODY
    ))

    story.append(Paragraph(
        "<b>Action 2: Scaffold the Rust sidecar repository.</b> Create a new packages/metardu-sidecar/ workspace in the monorepo with a Cargo.toml, a src/main.rs that reads length-prefixed JSON from stdin and writes length-prefixed JSON to stdout, and a simple ping/pong handler. Set up cross-compilation for Windows, macOS, and Linux in CI. Owner: lead engineer. Completion criterion: the sidecar builds on all three platforms and the ping/pong round-trip works from a test Electron handler.",
        BODY
    ))

    story.append(Paragraph(
        "<b>Action 3: Implement camera-footprint math and KMZ export as proof of concept.</b> In @metardu/engine, add a new flight-planning/ module with the camera footprint formulas (GSD, footprint width, footprint height, line spacing, photo spacing) and a KMZ export function that produces a DJI Pilot-compatible wpml file. Add property-based tests with fast-check that verify the math against known camera sensors (DJI Mavic 3, Phantom 4 RTK, senseFly eBee X). Owner: GIS consultant. Completion criterion: the math produces correct GSD within 1% of spec on the test sensor database, and the KMZ file uploads successfully to DJI Pilot 2.",
        BODY
    ))

    story.append(Paragraph(
        "<b>Action 4: Recruit 5 closed-beta surveyors.</b> Reach out to the Institution of Surveyors of Kenya (ISK) and the Engineers Board of Kenya (EBK) mailing lists, offering a $500 stipend for a 2-week trial in Months 5-6. Target surveyors who already use drone photogrammetry. Sign NDAs and data-handling agreements. Owner: lead engineer. Completion criterion: 5 signed NDAs and a confirmed calendar for the Month 5 trial.",
        BODY
    ))

    story.append(Paragraph(
        "<b>Action 5: Run the Codebase Onboarding Engineer agent on metardu-desktop.</b> Use the agency-agents Codebase Onboarding Engineer persona to produce a factual map of the current architecture, the IPC surface, the dependencies, and the tech-debt inventory. This map is the input to every subsequent agent and the foundation for ADRs 006-012. Owner: lead engineer. Completion criterion: the architecture map is committed to docs/onboarding-report.md and reviewed by the GIS consultant.",
        BODY
    ))

    story.append(Spacer(1, 14))
    story.append(callout(
        "Call to Action",
        "Start with Action 1 (code-signing) today, because the EV certificate provisioning takes 2-3 weeks. While waiting for the certificate, complete Action 2 (Rust sidecar scaffold) and Action 3 (camera-footprint proof of concept) in parallel. Action 4 (beta recruitment) and Action 5 (codebase onboarding) can begin in Week 2. The goal of the first 30 days is to have the code-signing infrastructure ready, the Rust sidecar pattern proven, and the flight planning math validated, so that Phase 1 can proceed at full pace from Month 2."
    ))

    return story
