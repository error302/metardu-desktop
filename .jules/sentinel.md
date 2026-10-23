## 2024-05-24 - [XSS via dynamically generated SVG rendered via dangerouslySetInnerHTML]
**Vulnerability:** XSS vulnerability in CrossSectionView where an unsanitized dynamically generated SVG string was passed directly to dangerouslySetInnerHTML. An attacker could inject malicious scripts through manipulated cross-section data, leading to arbitrary code execution.
**Learning:** React's dangerouslySetInnerHTML is a potential XSS vector, especially when the content is constructed dynamically, as done with the SVG generation for the cross-section view.
**Prevention:** Always sanitize dynamically constructed markup strings before using them in dangerouslySetInnerHTML. We used DOMPurify with { USE_PROFILES: { svg: true } } to securely sanitize the SVG content.
