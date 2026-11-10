## 2026-11-10 - Prevent XSS in CrossSectionView
**Vulnerability:** The `CrossSectionView.tsx` component renders raw SVG strings generated from potentially untrusted survey output data via `dangerouslySetInnerHTML` without sanitization, leading to a Cross-Site Scripting (XSS) vulnerability.
**Learning:** Even when generating SVGs internally, if the inputs to the generator are from untrusted sources (e.g. uploaded survey state), the resulting SVG might contain malicious scripts (like `<script>` or `onload` attributes). We must always sanitize raw HTML/SVG before injection.
**Prevention:** Always use `DOMPurify` with appropriate profiles (e.g., `{ USE_PROFILES: { svg: true } }`) before using `dangerouslySetInnerHTML` in React components.
