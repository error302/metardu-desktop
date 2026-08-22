## 2025-02-23 - [XSS Fix in SVG renderer]
**Vulnerability:** XSS vulnerability found in `CrossSectionView.tsx` where un-escaped user input `p.feature` was concatenated directly into an SVG string and rendered to the DOM using `dangerouslySetInnerHTML`.
**Learning:** SVG elements dynamically generated on the client-side and injected via `dangerouslySetInnerHTML` must sanitize all user inputs using an `escapeHtml` utility to prevent script injection.
**Prevention:** Avoid string concatenations for generating markup, use React JSX natively whenever possible, or strictly sanitize values bound for `dangerouslySetInnerHTML`.
