## 2025-05-24 - [Cross-Site Scripting (XSS) in CrossSectionView]
**Vulnerability:** Raw SVG strings generated with user data were injected directly into the DOM using `dangerouslySetInnerHTML` in `CrossSectionView.tsx`, leading to potential XSS vulnerabilities if the input contained malicious `<script>` tags or attributes.
**Learning:** React components that render SVG from raw strings must always sanitize the output, even if the primary source seems trusted, to prevent secondary injections.
**Prevention:** Use `DOMPurify` with `{ USE_PROFILES: { svg: true } }` before passing HTML/SVG strings to `dangerouslySetInnerHTML`.
