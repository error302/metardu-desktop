import DOMPurify from 'dompurify';
console.log(DOMPurify.sanitize('<svg><circle cx="50" cy="50" r="40" stroke="green" stroke-width="4" fill="yellow" /></svg>', { USE_PROFILES: { svg: true } }));
