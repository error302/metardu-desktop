## 2024-05-24 - [Fix XSS in SVG Rendering]
**Vulnerability:** XSS vulnerability through unsanitized SVG strings rendered using `dangerouslySetInnerHTML` in React components.
**Learning:** React's `dangerouslySetInnerHTML` will execute arbitrary JavaScript embedded within SVG `<script>` tags, event handlers (like `onload`), etc. We must always sanitize raw HTML or SVG strings.
**Prevention:** Use `DOMPurify.sanitize(svgString, { USE_PROFILES: { svg: true } })` to strip malicious elements while retaining safe SVG tags before passing to `dangerouslySetInnerHTML`.
