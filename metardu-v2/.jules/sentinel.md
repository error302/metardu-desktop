## 2025-05-25 - XSS via SVG in excessively dynamic content
**Vulnerability:** XSS vulnerability through usage of `dangerouslySetInnerHTML` on un-sanitized string values generated dynamically for SVGs.
**Learning:** Even when SVGs are generated dynamically based on application state, it's necessary to sanitize the resulting string to prevent any untrusted values from creating `<script>` tags or malicious attributes. SVGs can embed scripts, so unsanitized interpolation within an SVG string is dangerous if rendered directly.
**Prevention:** Always use DOMPurify when passing dynamically generated HTML or SVG strings to `dangerouslySetInnerHTML` in React components.
