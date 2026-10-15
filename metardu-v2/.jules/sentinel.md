## 2024-08-24 - [Fix XSS in SVG Rendering]
**Vulnerability:** Found a Cross-Site Scripting (XSS) vulnerability in `CrossSectionView.tsx` where SVG strings were rendered directly into the DOM using `dangerouslySetInnerHTML` without prior sanitization.
**Learning:** React's `dangerouslySetInnerHTML` does not prevent malicious scripts if the HTML string is compromised. SVG strings can contain embedded scripts (e.g. `<script>`) that will execute.
**Prevention:** Always use `DOMPurify` to sanitize raw HTML or SVG strings before rendering them via `dangerouslySetInnerHTML` to prevent XSS.
