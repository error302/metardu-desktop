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
    """Chapter 9: Production Readiness & Release Plan (Zero-Budget Edition)"""
    story = []
    story.extend(add_major_section("Chapter 9: Production Readiness &amp; Release Plan"))

    story.append(Paragraph(
        "Production readiness on a zero-budget is not only possible, it is the path that most successful open-source desktop applications have taken. VS Code, Obsidian (in its early days), Blender, and countless Electron and Tauri apps shipped for years using free code-signing alternatives, community bug bounties, and volunteer beta testers. The principle is to trade money for time and community: every paid infrastructure component has a free equivalent that costs more in setup effort but produces an equally production-ready result. The Desktop App Engineer agent's critical rule still applies: the auto-updater is the most critical code you own, and it must be tested before launch. What changes is how we achieve trusted distribution, not whether we achieve it.",
        BODY
    ))

    story.append(add_subsection("9.1 Code-Signing on Zero Budget"))
    story.append(Paragraph(
        "Code-signing is the hardest problem to solve for free, because the certificate authorities (DigiCert, SSL.com, Sectigo) charge real money for the trust they provide. However, three free or near-free paths exist, and the right choice depends on the platform. For Windows, the primary path is <b>SignPath Foundation</b>, a non-profit that provides free code-signing certificates to open-source projects. The application requires a public GitHub repository with an OSI-approved license (MetaRDU Desktop is MIT licensed, which qualifies), a maintained release history, and a clear description of the project. Approval takes 1-2 weeks. Once approved, SignPath integrates directly with GitHub Actions via their app, signing every release build automatically with a certificate that SmartScreen recognizes. This eliminates the Windows EV certificate cost entirely.",
        BODY
    ))

    story.append(Paragraph(
        "The fallback for Windows, if SignPath approval is delayed or rejected, is a <b>self-signed certificate</b> generated locally via PowerShell's New-SelfSignedCertificate cmdlet. The signed binary will trigger a SmartScreen warning ('Windows protected your PC') on first run, which users bypass by clicking 'More info' then 'Run anyway'. This is the same warning that hundreds of indie games and open-source tools live with, and it does not prevent installation. The mitigation is documentation: the metardu.com download page and the README must include screenshots showing exactly how to bypass SmartScreen, with clear language explaining that the warning appears because the app is not signed by a paid certificate authority, not because it is malware. Over time, as download volume grows, SmartScreen reputation builds organically and the warning disappears, typically after a few thousand downloads with a low report rate.",
        BODY
    ))

    story.append(Paragraph(
        "For macOS, the situation is different. Apple does not offer a free code-signing path for distributed applications, and there is no equivalent of SignPath for macOS. The realistic options are: <b>Option A</b> (recommended when budget allows) is the Apple Developer ID at $99 per year, which is the only way to notarize the app and avoid the 'unidentified developer' Gatekeeper warning. <b>Option B</b> (zero-cost) is to skip notarization entirely and document the bypass: macOS users right-click the app, select 'Open', and confirm the dialog, or run <code>xattr -d com.apple.quarantine /Applications/MetaRDU.app</code> in Terminal. This is the path that many open-source macOS apps take, including Inkscape and Audacity in their early years. <b>Option C</b> is to distribute via Homebrew Cask, where the Homebrew community accepts unsigned apps with appropriate caveats. The plan assumes Option B for the initial v2.0 release, with Option A as the first priority once MetaRDU generates any revenue.",
        BODY
    ))

    story.append(Paragraph(
        "For Linux, code-signing is free and always has been. The AppImage is signed with a self-generated GPG key (gpg --gen-key), the public key is published to a keyserver, and the AppImage checksum is published alongside the download. The .deb package is signed with dpkg-sig using the same GPG key. Linux desktop users who care about verification can import the GPG key and verify the signature, but most users rely on the package manager's checksum verification. This is the standard Linux distribution model and requires zero budget.",
        BODY
    ))

    story.append(callout(
        "Code-Signing Decision Summary",
        "Windows: SignPath Foundation (FREE, 1-2 week approval) as primary; self-signed + SmartScreen bypass docs as fallback. macOS: skip notarization for v2.0 (FREE); document the right-click Open workaround; upgrade to Apple Developer ID ($99/yr) as first priority once revenue exists. Linux: self-generated GPG key (FREE). Total code-signing cost for v2.0 launch: $0."
    ))

    story.append(add_subsection("9.2 Auto-Update with Staged Rollout"))
    story.append(Paragraph(
        "The auto-update infrastructure is free because it uses GitHub Releases as the update provider, which is free for public repositories. electron-updater (Phases 1-2) and tauri-plugin-updater (Phase 3) both support GitHub Releases natively, requiring only a GitHub personal access token with repo permissions stored as a CI secret. A new release is published by tagging a git commit, pushing the tag, and letting GitHub Actions build and upload the platform-specific binaries as release assets. The update manifest (latest.yml or latest.json) is generated by the build script and uploaded alongside the binaries. The auto-update check runs at app startup and every 4 hours, with a 15-minute jitter to avoid thundering herd on the GitHub Releases API.",
        BODY
    ))

    story.append(Paragraph(
        "The staged rollout follows the Desktop App Engineer's pattern: 1% adoption for the first 7 days, expanding to 10% if the crash-free session rate stays above 99.5% and the update-success rate stays above 95%, then expanding to 100% after another 7 days at 10% with the same gates. The rollout percentage is controlled by the update manifest's stagingPercentage field. If the crash-free rate drops below 99.5% at any stage, the rollout is paused and the previous manifest is republished, triggering an automatic rollback for users who have not yet updated. A rollback drill is run before the public v2.0 release: publish a v2.0.1-rc with a known bug, verify the crash detection via Sentry (free tier), republish v2.0.0 as latest, and verify that users on v2.0.1-rc roll back automatically. The entire auto-update infrastructure costs $0.",
        BODY
    ))

    story.append(add_subsection("9.3 Closed Beta Program (Volunteer-Based)"))
    story.append(Paragraph(
        "The closed beta program runs on volunteer participation rather than paid stipends. This is how most open-source beta programs operate, and it produces equally valuable feedback when the product solves a real problem for the testers. The recruitment targets two groups: <b>licensed surveyors from the Institution of Surveyors of Kenya (ISK) and the Engineers Board of Kenya (EBK)</b> who already use drone photogrammetry and would benefit from a free surveyor's office tool, and <b>surveying students at the University of Nairobi, JKUAT, and the Technical University of Kenya</b> who want to learn modern surveying software and are willing to test in exchange for early access and a mention in the acknowledgments. The compensation is a free perpetual MetaRDU license when v2.0 launches (which costs nothing to grant) and public contributor credit in the release notes.",
        BODY
    ))

    story.append(Paragraph(
        "The feedback collection is structured exactly as in a paid beta: a daily 5-minute pulse survey via Google Forms (free), a weekly 30-minute deep-dive survey, and a final 60-minute interview. Weekly office hours are held on Zoom (free tier, 40-minute meetings) or Jitsi Meet (free, unlimited) every Thursday evening East Africa Time. The feedback is aggregated into a Beta Dashboard built in Notion (free) or a simple Markdown file in the repository, tracking Net Promoter Score, workflow completion rates, bug severity distribution, and feature request priority. The Reality Checker uses this dashboard as evidence at the midpoint gate and the pre-launch gate. The target is 5 surveyors in Month 5 and 10 surveyors in Month 6, recruited through ISK's WhatsApp groups, the r/Surveying subreddit, and direct outreach to surveying firms in Nairobi. Total cost: $0.",
        BODY
    ))

    story.append(add_subsection("9.4 Bug Bounty Program (Community-Based)"))
    story.append(Paragraph(
        "The bug bounty program launches in Phase 1 Month 3 on GitHub Security Advisories, which is free and integrated with the existing GitHub repository. The scope is the IPC boundary (any channel that can be invoked from the renderer with malformed input), the drone-data ingestion paths (KMZ, ODM output, MAVLink telemetry), the auto-update channel (manifest tampering, binary replacement), and the cryptographic seal (RSA-2048 key handling). Out of scope: the renderer JavaScript (sandboxed), the Rust sidecar internal logic (not directly exposed), and social engineering. Because there is no cash reward pool, the rewards are non-cash: public acknowledgment in the release notes and Hall of Fame, a contributor credit in the repository, and a free MetaRDU Pro license when a paid tier launches. Most security researchers who report on open-source projects do so for the credit and the portfolio value, not for the cash.",
        BODY
    ))

    story.append(Paragraph(
        "The program is also listed on <b>Huntr.dev</b>, a free bug bounty platform specifically for open-source projects that handles triage and disclosure at no cost to the maintainer. Huntr.dev has a community of researchers who actively test OSS projects for free, and the platform provides a managed disclosure workflow that complies with CVE numbering and responsible disclosure timelines. This is a significantly better option than self-managing reports via GitHub Security Advisories alone, and it costs nothing. The combination of GitHub Security Advisories (for direct reports) and Huntr.dev (for community discovery) provides comprehensive coverage without any cash outlay.",
        BODY
    ))

    story.append(add_subsection("9.5 Tutorial Videos (DIY) and Public Release"))
    story.append(Paragraph(
        "Three tutorial videos are produced in Phase 3 Month 8, each approximately 10 minutes long, covering the three core workflows: cadastral survey (12-leg traverse to sealed Form No. 4 PDF), topographic survey (50,000-point dataset to DXF with contours), and drone survey (flight plan to orthophoto to GCP verification to ML building footprint extraction). The videos are recorded in OBS Studio (free, open-source) at 1920 by 1080 resolution with audio from any USB microphone or the laptop's built-in mic. The editing is done in DaVinci Resolve (free version, professional-grade) or CapCut (free, simpler). The lead engineer records and edits the videos personally, which takes approximately 8 hours per video including script writing, recording, editing, and review. Total cost: $0, plus 24 hours of the lead engineer's time.",
        BODY
    ))

    story.append(Paragraph(
        "The public v2.0.0 release in Month 9 follows a documented release runbook: freeze the main branch, run the full CI suite on all three platforms (free via GitHub Actions for public repos), run the Reality Checker pre-launch gate (requires evidence per criterion), tag the v2.0.0 commit, push the tag, let GitHub Actions build and upload the platform-specific binaries to GitHub Releases, publish the release notes, update the download page on Cloudflare Pages (free) or GitHub Pages (free), publish the three tutorial videos to YouTube (free), and announce on Twitter/X (free), the ISK mailing list (free), and the r/Surveying subreddit (free). The staged rollout begins at 1% on day 1, expands to 10% on day 7 if crash-free rate is above 99.5%, and expands to 100% on day 14. Crash monitoring uses Sentry's free Developer tier (5,000 errors per month), which is sufficient for a beta release with a few hundred users.",
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
        ['R6', 'Code-signing infrastructure setup (SignPath application, self-signed fallback)', 'Med', 'Med', 'Apply to SignPath Foundation in Month 1 (free, 1-2 weeks); self-signed cert as fallback with documented SmartScreen bypass; macOS ships unsigned with right-click Open docs', 'Ship unsigned with explicit warning on all platforms; defer signing to when revenue allows Apple Developer ID ($99/yr)'],
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
    """Chapter 11: Budget, Timeline & KPIs (Zero-Budget Edition)"""
    story = []
    story.extend(add_major_section("Chapter 11: Budget, Timeline &amp; KPIs"))

    story.append(Paragraph(
        "The total budget for the nine-month upgrade is $0 to $109 USD per year, depending on whether you choose to purchase the Apple Developer ID. Every other line item in the original $15,000 to $20,000 budget has a free equivalent that is equally production-ready. The principle is that the original budget assumed a paid GIS consultant, paid video editor, paid beta stipends, paid bug bounty rewards, paid code-signing certificates, paid Sentry, and paid drone hardware. Each of these has a free alternative: the GIS consultant is replaced by the agency-agents personas plus community Q&amp;A on r/Surveying and GIS StackExchange; the video editor is replaced by the lead engineer using OBS Studio and DaVinci Resolve; the beta stipends are replaced by volunteer participation from surveyors who want early access; the bug bounty rewards are replaced by public acknowledgment and contributor credit; the code-signing certificates are replaced by SignPath Foundation for Windows and self-signing for macOS and Linux; Sentry is replaced by its free Developer tier; and the drone hardware is replaced by the ArduPilot SITL simulator plus a partnership with a local drone surveying firm.",
        BODY
    ))

    story.append(add_subsection("11.1 Budget Breakdown (Zero-Cost Path)"))
    budget_data = [
        ['Category', 'Item', 'Cost (USD/yr)', 'Free Alternative Used'],
        ['Personnel', 'Lead engineer (you), 9 months full-time', '$0', 'Sweat equity; this is the entire investment'],
        ['Personnel', 'GIS consultant', '$0', 'Replaced by agency-agents personas + r/Surveying + GIS StackExchange'],
        ['Personnel', 'Video editor', '$0', 'DIY with OBS Studio (free) + DaVinci Resolve (free)'],
        ['Infrastructure', 'GitHub (public repo)', '$0', 'Free for public repos; unlimited CI minutes for OSS'],
        ['Infrastructure', 'Sentry error monitoring', '$0', 'Free Developer tier: 5,000 errors/month'],
        ['Infrastructure', 'Domain + hosting', '$0 to $10', 'GitHub Pages (free) or Cloudflare Pages (free); .com domain optional at $10/yr via Cloudflare'],
        ['Code-signing', 'Windows (SignPath Foundation)', '$0', 'Free for OSS projects; 1-2 week approval'],
        ['Code-signing', 'Windows fallback (self-signed)', '$0', 'SmartScreen warning documented in README'],
        ['Code-signing', 'macOS (Apple Developer ID)', '$0 or $99', 'OPTIONAL: $99/yr for notarization; OR free with documented right-click Open bypass'],
        ['Code-signing', 'Linux (GPG self-signed)', '$0', 'Standard Linux distribution model'],
        ['Auto-update', 'GitHub Releases hosting', '$0', 'Free for public repos'],
        ['Hardware', 'Drone for testing', '$0', 'ArduPilot SITL simulator (free, tests all MAVLink code); DJI Assistant 2 simulator (free, tests DJI waypoint formats)'],
        ['Hardware', 'Drone partnership', '$0', 'Partner with local surveying firm: they provide hardware + test data, you provide free MetaRDU licenses'],
        ['Beta', 'Surveyor stipends', '$0', 'Volunteer participation; compensated with free perpetual license + contributor credit'],
        ['Bug bounty', 'Cash rewards', '$0', 'GitHub Security Advisories (free) + Huntr.dev (free); rewards are public acknowledgment + Hall of Fame'],
        ['TOTAL', 'Zero-cost path (no Apple Developer ID)', '$0/yr', 'All free alternatives; SmartScreen + Gatekeeper warnings documented'],
        ['TOTAL', 'Minimum-viable paid path', '$10-109/yr', 'Domain ($10) + optional Apple Developer ID ($99)'],
    ]
    story.append(Spacer(1, 6))
    story.append(make_table(budget_data, [0.13, 0.27, 0.13, 0.47]))
    story.append(Spacer(1, 14))

    story.append(add_subsection("11.2 Trade-offs of the Zero-Cost Path"))
    story.append(Paragraph(
        "The zero-cost path is not free in the sense of zero effort; it is free in the sense of zero cash. The trade-offs are: (1) the lead engineer spends more time on infrastructure setup (SignPath application, SmartScreen documentation, video editing) that a paid budget would outsource; (2) Windows users see a SmartScreen warning on first install, which reduces conversion by approximately 10-15% until reputation builds (typically 2-3 months after launch with steady download volume); (3) macOS users must right-click and Open the app on first launch, which is documented but adds friction; (4) the bug bounty program receives fewer reports than a paid program, because cash rewards attract professional researchers who would otherwise skip open-source projects; (5) the beta program may take longer to recruit volunteers than paid participants, though the feedback quality is often higher because volunteers are genuinely interested in the product.",
        BODY
    ))

    story.append(Paragraph(
        "None of these trade-offs are release-blockers. Hundreds of successful open-source desktop apps, including Inkscape, Audacity, OBS Studio, and VS Code in its early days, shipped with these same trade-offs and grew into mainstream adoption. The key is to treat the paid budget items as upgrade targets: once MetaRDU generates revenue (through a Pro tier, consulting, or grants), the first $99 pays for the Apple Developer ID (eliminating the macOS friction), the next $300 pays for a Windows EV cert or Azure Trusted Signing subscription (eliminating the SmartScreen warning), and the next $2,000 funds a bug bounty reward pool. Each paid upgrade directly improves conversion and security posture, and each can be justified by the revenue it unlocks.",
        BODY
    ))

    story.append(add_subsection("11.3 Timeline (Gantt-Style)"))
    story.append(Paragraph(
        "The nine-month timeline is structured as three phases of three months each, with monthly milestones and phase gates. The table below summarizes the major milestones by month. Phase 1 (Months 1-3) focuses on stabilization and the flight planning engine. Phase 2 (Months 4-6) focuses on live drone connectivity and in-app photogrammetry, culminating in the closed beta and the Reality Checker midpoint gate. Phase 3 (Months 7-9) focuses on the Tauri migration, ML feature extraction, and the public v2.0 release, culminating in the Reality Checker pre-launch gate and the staged rollout.",
        BODY
    ))

    timeline_data = [
        ['Month', 'Phase', 'Major Milestones', 'Gate'],
        ['M1', 'P1', 'zod schemas complete; 2 P0 math features; SignPath application submitted', 'Code Reviewer'],
        ['M2', 'P1', '5 P0 math features; flight planning engine; GDAL bindings', 'Code Reviewer'],
        ['M3', 'P1', '5 mission export formats; SignPath approved; bug bounty on Huntr.dev', 'GIS QA Engineer'],
        ['M4', 'P2', 'MAVSDK-Rust sidecar; live telemetry dashboard; SITL testing', 'Code Reviewer'],
        ['M5', 'P2', 'ODM sidecar; closed beta cohort 1 (5 volunteer surveyors)', 'Code Reviewer'],
        ['M6', 'P2', 'Closed beta cohort 2 (10 surveyors); Playwright E2E', 'Reality Checker (midpoint)'],
        ['M7', 'P3', 'Tauri shell scaffolding; 30 IPC handlers migrated', 'Code Reviewer'],
        ['M8', 'P3', 'All 118 IPC handlers migrated; ML building footprints; DIY tutorial videos', 'GIS QA + Security'],
        ['M9', 'P3', 'Public v2.0.0 release; staged rollout begins', 'Reality Checker (pre-launch)'],
    ]
    story.append(Spacer(1, 6))
    story.append(make_table(timeline_data, [0.07, 0.07, 0.55, 0.31]))
    story.append(Spacer(1, 14))

    story.append(add_subsection("11.4 KPI Dashboard"))
    story.append(Paragraph(
        "The KPI dashboard is reviewed weekly by the lead engineer, and biweekly by the Reality Checker (when active). The dashboard is a single Markdown file in the repository (docs/KPI_DASHBOARD.md) updated automatically by CI on every push. The metrics are grouped into four categories: engineering (binary size, idle memory, cold start, test pass rate, IPC coverage), product (beta NPS, workflow completion rates, bug severity distribution), release (code-signing verification, auto-update success rate, crash-free sessions), and compliance (ASPRS class, ISO 19157 completeness, RDM 1.1 closure). The table below shows the target and current values for the top 10 KPIs as of the start of Phase 1.",
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
        ['Beta surveyor NPS (volunteers)', 'Product', '>= 7 of 10 score > 8', 'N/A'],
        ['Crash-free sessions (7-day)', 'Release', '>= 99.5%', 'Not measured'],
        ['Auto-update success rate', 'Release', '>= 99% over 1 minor bump', 'Never tested'],
        ['ASPRS Class I compliance', 'Compliance', 'RMSE_x,y < 7.5 cm', 'Manual input only'],
    ]
    story.append(Spacer(1, 6))
    story.append(make_table(kpi_data, [0.32, 0.15, 0.25, 0.28]))
    story.append(Spacer(1, 14))

    return story


def build_chapter_12():
    """Chapter 12: Conclusion & Next Actions (Zero-Budget Edition)"""
    story = []
    story.extend(add_major_section("Chapter 12: Conclusion &amp; Next Actions"))

    story.append(Paragraph(
        "MetaRDU Desktop v2.0 is an ambitious but achievable upgrade that transforms the product from a surveyor's office tool into a true drone survey workstation, and it can be delivered for $0 to $109 per year. The three-phase approach manages risk by deferring the largest architectural change (Tauri migration) to Phase 3, after the Rust sidecar pattern is proven on the existing Electron shell. The five drone capabilities (flight planning, live drone link, in-app photogrammetry, real raster I/O, ML feature extraction) close the gap between the metardu brand promise and the actual product functionality. The six math standards (ASPRS 2014, NMAS 1947, ISO 19157, RDM 1.1 / Cap. 299, FGDC-STD-007.3, ICSM SP1) position the product for both the current Kenyan market and future international expansion. The production readiness workstream (SignPath Foundation code-signing, volunteer closed beta, community bug bounty, DIY tutorial videos, staged rollout on GitHub Releases) ensures that v2.0 is not just feature-complete but truly production-ready, without requiring any upfront capital.",
        BODY
    ))

    story.append(Paragraph(
        "The twelve-agent roster from the agency-agents framework provides the specialized expertise that a solo developer cannot afford to hire, with the Reality Checker serving as the quality gate at midpoint and pre-launch. The sequential-handoff workflow ensures that every agent's output is fully consumed by the next agent, preventing the context loss that plagues parallel multi-agent systems. The testing methodology (deterministic Playwright E2E, no sleeps, trace-on-retry, GIS QA gates) and the security model (IPC as trust boundary, narrowest-verb, zod validation per channel, SAST/DAST in CI) provide the engineering discipline needed for a production-grade desktop application distributed to field crews on unreliable networks. These are free methodologies that produce paid-tier quality.",
        BODY
    ))

    story.append(Paragraph(
        "The total budget of $0 to $109 per year is not a compromise; it is a legitimate production-readiness strategy that has been proven by hundreds of successful open-source desktop applications. The trade-offs are well-understood: SmartScreen warnings on Windows for the first 2-3 months, Gatekeeper bypass on macOS, and volunteer-based beta feedback instead of paid stipends. None of these are release-blockers. The key insight is that code-signing certificates, paid bug bounties, and paid beta stipends are optimization levers, not prerequisites. Once MetaRDU generates revenue, each paid upgrade directly improves conversion and security posture, and each can be justified by the revenue it unlocks. The first $99 (Apple Developer ID) eliminates the macOS friction; the next $300 (Windows EV cert or Azure Trusted Signing) eliminates the SmartScreen warning; the next $2,000 funds a bug bounty reward pool. Every dollar spent after launch is a dollar earned back through higher conversion.",
        BODY
    ))

    story.append(add_subsection("12.1 Top Five Next Actions (Next 30 Days, Zero Cost)"))
    story.append(Paragraph(
        "The following five actions should be taken in the next 30 days to kick off Phase 1. Each action is concrete, has a clear owner, costs $0, and has a measurable completion criterion. These actions are the minimum viable start to the upgrade: completing them in the first month puts the project on track for the Phase 1 milestone cadence and the Month 3 phase gate.",
        BODY
    ))

    story.append(Paragraph(
        "<b>Action 1: Apply to SignPath Foundation (free Windows code-signing).</b> Visit signpath.org/foundation, submit the application for the metardu-desktop repository (MIT licensed, public on GitHub), and provide the project description and release history. Approval takes 1-2 weeks. While waiting, generate a self-signed certificate via PowerShell's New-SelfSignedCertificate cmdlet as a fallback, and write the SmartScreen bypass documentation (with screenshots) for the README and the future download page. Owner: lead engineer. Completion criterion: SignPath application submitted, self-signed cert generated, SmartScreen bypass docs committed to docs/INSTALL.md.",
        BODY
    ))

    story.append(Paragraph(
        "<b>Action 2: Scaffold the Rust sidecar repository.</b> Create a new packages/metardu-sidecar/ workspace in the monorepo with a Cargo.toml, a src/main.rs that reads length-prefixed JSON from stdin and writes length-prefixed JSON to stdout, and a simple ping/pong handler. Set up cross-compilation for Windows, macOS, and Linux in GitHub Actions CI (free for public repos). Owner: lead engineer. Completion criterion: the sidecar builds on all three platforms via CI and the ping/pong round-trip works from a test Electron handler.",
        BODY
    ))

    story.append(Paragraph(
        "<b>Action 3: Implement camera-footprint math and KMZ export as proof of concept.</b> In @metardu/engine, add a new flight-planning/ module with the camera footprint formulas (GSD = pixel_size times altitude divided by focal_length, footprint width, footprint height, line spacing, photo spacing) and a KMZ export function that produces a DJI Pilot-compatible wpml file. Add property-based tests with fast-check that verify the math against known camera sensors (DJI Mavic 3, Phantom 4 RTK, senseFly eBee X) using published spec sheets. Owner: lead engineer, with the Drone/Reality Mapping agent persona from agency-agents as a reference. Completion criterion: the math produces correct GSD within 1% of spec on the test sensor database, and the KMZ file structure validates against the DJI wpml schema.",
        BODY
    ))

    story.append(Paragraph(
        "<b>Action 4: Recruit 5 volunteer closed-beta surveyors.</b> Reach out to the Institution of Surveyors of Kenya (ISK) WhatsApp groups, the r/Surveying subreddit, and surveying students at the University of Nairobi, JKUAT, and the Technical University of Kenya. Offer a free perpetual MetaRDU license and public contributor credit in exchange for a 2-week trial in Months 5-6. Sign simple NDAs (use a free template from docracy.com or docsketch.com). Owner: lead engineer. Completion criterion: 5 signed NDAs and a confirmed calendar for the Month 5 trial.",
        BODY
    ))

    story.append(Paragraph(
        "<b>Action 5: Run the Codebase Onboarding Engineer agent on metardu-desktop.</b> Use the agency-agents Codebase Onboarding Engineer persona to produce a factual map of the current architecture, the IPC surface, the dependencies, and the tech-debt inventory. This map is the input to every subsequent agent and the foundation for ADRs 006-012. The agent persona is a free markdown file that you install into your AI coding assistant (Claude Code, Cursor, GitHub Copilot, etc.). Owner: lead engineer. Completion criterion: the architecture map is committed to docs/onboarding-report.md.",
        BODY
    ))

    story.append(Spacer(1, 14))
    story.append(callout(
        "Call to Action (Zero Cost)",
        "Start with Action 1 (SignPath Foundation application) today, because approval takes 1-2 weeks and there is no reason to wait. While waiting, complete Action 2 (Rust sidecar scaffold) and Action 3 (camera-footprint proof of concept) in parallel, both of which require only your time and a computer. Action 4 (volunteer beta recruitment) and Action 5 (codebase onboarding) can begin in Week 2. The goal of the first 30 days is to have the code-signing infrastructure in progress, the Rust sidecar pattern proven, and the flight planning math validated, all for $0. None of these actions require any cash outlay. The only paid item in the entire plan is the optional $99 Apple Developer ID, and that can wait until MetaRDU generates its first dollar of revenue."
    ))

    return story
