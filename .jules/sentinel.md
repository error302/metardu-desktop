## 2026-10-11 - [XSS via Unsanitized SVG rendering in React]
**Vulnerability:** React components rendering raw SVG strings using `dangerouslySetInnerHTML` without sanitization allow XSS if the SVG data originates from or is influenced by untrusted survey output.
**Learning:** SVG strings often contain script tags or event handlers. Using standard DOMPurify is not enough; we must pass `{ USE_PROFILES: { svg: true } }` to retain necessary SVG formatting while stripping malicious elements.
**Prevention:** Always sanitize any dynamically generated HTML/SVG passed to `dangerouslySetInnerHTML`. Ensure the `svg` profile is explicitly enabled when working with SVG strings to preserve visualization functionality while maintaining security.
