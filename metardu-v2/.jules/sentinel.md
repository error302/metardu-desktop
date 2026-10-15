## 2024-03-21 - [Cross-Site Scripting (XSS) in CrossSectionView]
**Vulnerability:** Use of `dangerouslySetInnerHTML` with raw un-sanitized HTML (`svgHtml`) in `CrossSectionView.tsx`.
**Learning:** Even when the raw string is constructed from application state rather than direct user input, using `dangerouslySetInnerHTML` without proper sanitization can expose the application to XSS vulnerabilities. React's documentation warns against this due to the potential for malicious code injection.
**Prevention:** Always sanitize raw HTML strings using a library like `DOMPurify` before rendering them with `dangerouslySetInnerHTML`.
