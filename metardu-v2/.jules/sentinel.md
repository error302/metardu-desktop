## 2026-08-28 - Cross-Site Scripting (XSS) in Cross-Section Viewer
**Vulnerability:** The `CrossSectionView` component rendered SVG output generated from data directly via `dangerouslySetInnerHTML` without prior sanitization. The data contained user-controlled/external variables (e.g. `p.feature`).
**Learning:** Using `dangerouslySetInnerHTML` with unsanitized dynamically generated SVGs/HTML based on input opens the door to XSS attacks, even if it's primarily a desktop application, due to the Electron renderer environment.
**Prevention:** Always use `dompurify` (e.g. `DOMPurify.sanitize()`) when passing HTML or SVG strings to `dangerouslySetInnerHTML`, regardless of the source.
