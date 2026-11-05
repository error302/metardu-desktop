## 2024-05-15 - [XSS] Unsanitized SVG rendering in dangerouslySetInnerHTML
**Vulnerability:** dangerouslySetInnerHTML used directly with raw SVG string output.
**Learning:** Even internally generated SVG components should be sanitized when rendered via dangerouslySetInnerHTML to prevent potential XSS vectors if data flows change.
**Prevention:** Always use DOMPurify.sanitize with { USE_PROFILES: { svg: true } } when rendering raw SVG via dangerouslySetInnerHTML.
