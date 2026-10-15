## 2024-11-06 - [XSS Fix]
**Vulnerability:** XSS vulnerability in dangerouslySetInnerHTML
**Learning:** We must sanitize HTML before rendering it via dangerouslySetInnerHTML.
**Prevention:** Always use DOMPurify to sanitize HTML before rendering it via dangerouslySetInnerHTML.
