## 2024-10-14 - XSS in dangerouslySetInnerHTML
**Vulnerability:** XSS vulnerability in React component rendering unsanitized user-generated SVG strings using dangerouslySetInnerHTML.
**Learning:** SVG strings generated using user inputs (e.g. feature names) can contain malicious scripts. Using DOMPurify to sanitize the SVG string before rendering mitigates this risk.
**Prevention:** Always use DOMPurify to sanitize HTML/SVG content before setting it via dangerouslySetInnerHTML. If the content is an SVG, pass `{ USE_PROFILES: { svg: true } }`.
