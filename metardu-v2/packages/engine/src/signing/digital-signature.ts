/**
 * Digital signature + seal — PKI-based plan signing.
 *
 * Inspired by metardu web's /digital-signature page. Allows a surveyor
 * to digitally sign a generated plan (PDF) with their professional
 * registration number + a cryptographic signature.
 *
 * # How it works
 *
 *   1. The surveyor generates a key pair (private key stays on their
 *      machine, never uploaded)
 *   2. The private key signs the PDF's hash
 *   3. The signature is embedded in the PDF as a metadata field
 *   4. The public key + surveyor registration number are included
 *      as a "digital seal" on the plan
 *   5. Anyone can verify the signature using the public key
 *
 * # Crypto
 *
 * Uses the Web Crypto API (SubtleCrypto) — available in both Node.js
 * (via crypto.webcrypto) and Electron's renderer (via window.crypto).
 * No external crypto library needed.
 *
 * # References
 *
 *   - metardu web /digital-signature page
 *   - PKCS#7 / CMS (Cryptographic Message Syntax)
 *   - PAdES (PDF Advanced Electronic Signature)
 *   - Survey Act Cap. 299 §32 (authentication of plans by the Director)
 */

import type { CountrySurveyConfig } from "@metardu/country-config";

// ─── Types ───────────────────────────────────────────────────────

/** A surveyor's digital identity. */
export interface SurveyorIdentity {
  name: string;
  registrationNumber: string;
  professionalBody: string;
  country: string;
  /** Public key (SPKI format, base64). */
  publicKeyBase64: string;
  /** Key creation date (ISO 8601). */
  keyCreatedAt: string;
}

/** A digital signature on a plan. */
export interface DigitalSignature {
  /** Surveyor identity at time of signing. */
  surveyor: SurveyorIdentity;
  /** Algorithm used (e.g. "RSASSA-PKCS1-v1_5"). */
  algorithm: string;
  /** Signature value (base64). */
  signatureBase64: string;
  /** Hash of the signed content (base64). */
  contentHashBase64: string;
  /** Signing timestamp (ISO 8601). */
  signedAt: string;
  /** What was signed (e.g. "Form 3 PDF — S/12345"). */
  signedContent: string;
}

/** Verification result. */
export interface VerificationResult {
  valid: boolean;
  surveyor: SurveyorIdentity;
  signedAt: string;
  contentHashMatches: boolean;
  signatureValid: boolean;
  error?: string;
}

// ─── Key management ──────────────────────────────────────────────

/**
 * Generate a new RSA key pair for plan signing.
 *
 * The private key MUST be stored securely (OS keychain on desktop,
 * encrypted storage on mobile). The public key is shared with the
 * server and included on every signed plan.
 *
 * @returns { publicKey, privateKey } as CryptoKey objects
 */
export async function generateKeyPair(): Promise<{
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey };
}

/**
 * Export a public key to base64 SPKI format (for storage/sharing).
 */
export async function exportPublicKeyBase64(publicKey: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey("spki", publicKey);
  return bufferToBase64(spki);
}

/**
 * Import a public key from base64 SPKI format.
 */
export async function importPublicKeyBase64(base64: string): Promise<CryptoKey> {
  const spki = base64ToBuffer(base64);
  return crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, true, ["verify"]);
}

/**
 * Export a private key to base64 PKCS8 format (for encrypted storage).
 *
 * WARNING: The returned string is the raw private key. The caller MUST
 * encrypt it before storing anywhere. Never log, transmit, or display
 * this value.
 */
export async function exportPrivateKeyBase64(privateKey: CryptoKey): Promise<string> {
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", privateKey);
  return bufferToBase64(pkcs8);
}

/**
 * Import a private key from base64 PKCS8 format.
 */
export async function importPrivateKeyBase64(base64: string): Promise<CryptoKey> {
  const pkcs8 = base64ToBuffer(base64);
  return crypto.subtle.importKey("pkcs8", pkcs8, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, true, ["sign"]);
}

// ─── Signing ─────────────────────────────────────────────────────

/**
 * Sign a PDF (or any binary content) with the surveyor's private key.
 *
 * @param content The PDF bytes to sign
 * @param privateKey The surveyor's private key
 * @param identity The surveyor's identity (name, reg no, etc.)
 * @param signedContent Description of what's being signed
 * @returns DigitalSignature object
 */
export async function signContent(
  content: Uint8Array,
  privateKey: CryptoKey,
  identity: SurveyorIdentity,
  signedContent: string,
): Promise<DigitalSignature> {
  // Compute SHA-256 hash of the content.
  const hashBuffer = await crypto.subtle.digest("SHA-256", content as unknown as ArrayBuffer);
  const contentHashBase64 = bufferToBase64(hashBuffer);

  // Sign the hash with the private key.
  const signatureBuffer = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    hashBuffer as unknown as ArrayBuffer,
  );
  const signatureBase64 = bufferToBase64(signatureBuffer);

  return {
    surveyor: identity,
    algorithm: "RSASSA-PKCS1-v1_5 + SHA-256",
    signatureBase64,
    contentHashBase64,
    signedAt: new Date().toISOString(),
    signedContent,
  };
}

// ─── Verification ────────────────────────────────────────────────

/**
 * Verify a digital signature against the original content.
 *
 * @param content The original PDF bytes
 * @param signature The digital signature to verify
 * @returns VerificationResult
 */
export async function verifySignature(
  content: Uint8Array,
  signature: DigitalSignature,
): Promise<VerificationResult> {
  try {
    // Recompute the hash.
    const hashBuffer = await crypto.subtle.digest("SHA-256", content as unknown as ArrayBuffer);
    const computedHashBase64 = bufferToBase64(hashBuffer);

    // Check hash matches.
    const contentHashMatches = computedHashBase64 === signature.contentHashBase64;
    if (!contentHashMatches) {
      return {
        valid: false,
        surveyor: signature.surveyor,
        signedAt: signature.signedAt,
        contentHashMatches: false,
        signatureValid: false,
        error: "Content hash mismatch — the document has been modified since signing.",
      };
    }

    // Import the public key.
    const publicKey = await importPublicKeyBase64(signature.surveyor.publicKeyBase64);

    // Verify the signature.
    const signatureBuffer = base64ToBuffer(signature.signatureBase64) as unknown as ArrayBuffer;
    const signatureValid = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      publicKey,
      signatureBuffer,
      hashBuffer as unknown as ArrayBuffer,
    );

    return {
      valid: signatureValid,
      surveyor: signature.surveyor,
      signedAt: signature.signedAt,
      contentHashMatches: true,
      signatureValid,
      error: signatureValid ? undefined : "Signature verification failed.",
    };
  } catch (err) {
    return {
      valid: false,
      surveyor: signature.surveyor,
      signedAt: signature.signedAt,
      contentHashMatches: false,
      signatureValid: false,
      error: (err as Error).message,
    };
  }
}

// ─── Seal rendering ──────────────────────────────────────────────

/**
 * Generate a digital seal text block for inclusion on a plan.
 *
 * This text is placed on the plan (PDF/DXF) in the certification area,
 * replacing the blank "Signed: _______________________" line.
 *
 * Example output:
 *   Digitally signed by: Jane Wanjiru (ISK LS/1234)
 *   Signature ID: aB3xK9...
 *   Signed at: 2026-07-20T15:30:00Z
 *   Hash: SHA-256/7f2a...
 */
export function generateSealText(signature: DigitalSignature): string {
  const sigShort = signature.signatureBase64.substring(0, 16) + "...";
  const hashShort = signature.contentHashBase64.substring(0, 16) + "...";
  return [
    `Digitally signed by: ${signature.surveyor.name} (${signature.surveyor.professionalBody} ${signature.surveyor.registrationNumber})`,
    `Signature ID: ${sigShort}`,
    `Algorithm: ${signature.algorithm}`,
    `Signed at: ${signature.signedAt}`,
    `Content hash: SHA-256/${hashShort}`,
  ].join("\n");
}

/**
 * Create a SurveyorIdentity from a country config + surveyor details.
 */
export function createIdentity(
  country: CountrySurveyConfig,
  name: string,
  registrationNumber: string,
  publicKeyBase64: string,
): SurveyorIdentity {
  return {
    name,
    registrationNumber,
    professionalBody: country.professionalBody.name,
    country: country.countryName,
    publicKeyBase64,
    keyCreatedAt: new Date().toISOString(),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Use global btoa/atob (available in both Node.js 16+ and Electron)
declare const btoa: (s: string) => string;
declare const atob: (s: string) => string;
