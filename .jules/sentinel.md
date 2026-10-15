## 2024-05-25 - XSS in SVG via dangerouslySetInnerHTML
**Vulnerability:** XSS vulnerability in `CrossSectionView.tsx` where raw SVG strings were rendered directly using `dangerouslySetInnerHTML`.
**Learning:** SVG strings generated on the client can contain malicious payloads if user input or feature strings are included. Using `dangerouslySetInnerHTML` with raw HTML/SVG is dangerous without sanitization.
**Prevention:** Use `DOMPurify.sanitize(rawSvg, { USE_PROFILES: { svg: true } })` before passing SVG HTML to `dangerouslySetInnerHTML` to prevent XSS.
