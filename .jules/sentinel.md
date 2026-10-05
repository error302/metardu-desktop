## 2023-10-05 - Add DOMPurify to mitigate XSS in dangerouslySetInnerHTML
**Vulnerability:** XSS vulnerability through dangerouslySetInnerHTML when rendering dynamically constructed SVG content that uses user-provided offsets, groundElevation, feature, and area properties.
**Learning:** React's dangerouslySetInnerHTML accepts arbitrary HTML. If it contains user-provided data directly embedded into an SVG string without sanitization, an attacker might be able to inject arbitrary JS/HTML that runs in the application context.
**Prevention:** Always sanitize dynamically constructed HTML or SVG strings using DOMPurify with { USE_PROFILES: { svg: true } } before rendering them via dangerouslySetInnerHTML.
