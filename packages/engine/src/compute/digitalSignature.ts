import { createHash } from 'crypto'

export function hashDocument(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export function verifyDocumentHash(
  content: string,
  storedHash: string
): boolean {
  return hashDocument(content) === storedHash
}

export function generateVerificationToken(
  documentId: string,
  signedAt: string,
  iskNumber: string
): string {
  const raw = `${documentId}-${signedAt}-${iskNumber}`
  const hash = createHash('sha256').update(raw).digest('hex')
  return hash.substring(0, 12).toUpperCase()
}

export function formatSignatureBlock(sig: {
  surveyorName: string
  iskNumber: string
  firmName: string
  signedAt: string
  documentHash: string
  verificationToken: string
}): string {
  return `
Digitally signed by: ${sig.surveyorName}
ISK Registration No: ${sig.iskNumber}
Firm: ${sig.firmName}
Date signed: ${sig.signedAt}
Document hash: ${sig.documentHash.substring(0, 16)}...
Verification: ${sig.verificationToken}
  `.trim()
}
