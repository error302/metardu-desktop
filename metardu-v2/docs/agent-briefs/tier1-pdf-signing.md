# Tier 1 #4 — Digital Signature on Statutory PDFs

**Task ID:** tier1-pdf-signing
**Agent:** Main (session 2026-07-25)
**Pace:** One task per turn
**Scope:** ONE PR — wire the existing `digital-signature.ts` (Web Crypto RSASSA-PKCS1-v1_5 SHA-256) into the Electron rendering pipeline: keypair management, sign Form 3 PDF, verify signature, per-country `signaturePolicy` config. No Rust sidecar changes.

## Problem

- `digital-signature.ts` (307 LOC) provides working RSASSA-PKCS1-v1_5 SHA-256 signing/verification via Web Crypto API but has **zero consumers** — no UI, no tests, no IPC handler.
- `Form3Output.pdfBytes` is a raw `Uint8Array` from pdf-lib — ready for signing.
- `StatutoryDocSpec.requiresProfessionalSeal` is already per-country but has **no `signaturePolicy`** field.
- The Form 3 renderer shows `"Signed: _______________________"` as a blank placeholder — no actual signature block.

## Goal

A surveyor can:
1. Render a Form 3 PDF → click **Sign** (or via `g y` keyboard shortcut).
2. The signing panel shows: generate keypair (Web Crypto), save private key, paste existing key, surveyor identity (name, ISK reg no).
3. Click **Sign PDF** → engine calls `signContent(pdfBytes, privateKey, identity)` → returns `DigitalSignature` (base64, detached).
4. Renderer displays verification status: ✅ Valid / ❌ Invalid + content hash match + surveyor identity.
5. Save `.sig` file alongside the PDF.
6. Verify: load `.pdf` + `.sig` → re-invoke `verifySignature` → render result.

## Non-Goals (deferred)

- PAdES PDF byte-rewriting (embedding CMS into AcroForm signature field) — deferred to Tier 3.
- CMS/PKCS#7 container wrapping (detached hash signature is the standard for now; CMS upgrade is a drop-in per ADR-0005 A1 since it stays on the TS engine side).
- Qualified e-signature certificates (eTSDA/QSCD) — self-signed Web Crypto keypairs at this tier.
- Installer code signing (the release-checklist's "Code signing (future)" section is about Windows/macOS binary signing — different problem).

## Invariants

- **ADR-0005 A1** — Heavy math (TIN, geodetic projection, RINEX epoch parsing) lives in the Rust sidecar. RSA signing of a ~200-byte SHA-256 hash is trivial and stays on the TS/Electron side.
- **AGENT.md §7** — No guessing at regulatory formats. Signature verification uses SHA-256 + RSASSA-PKCS1-v1_5 per FIPS 186-5. Country `signaturePolicy` in `country-config` is the authoritative reference.
- **AGENT.md §10** — One task = one scoped brief = one PR.
- **AGENT.md §4** — Verification must paste verbatim terminal output.

## Architecture

Follow the existing `projectToWgs84` injected-callback pattern (same as `integration/types.ts:149-153`):

```ts
// digital-signature.ts — add two convenience wrappers:
export async function signPdf(
  pdfBytes: Uint8Array,
  privateKeyBase64: string,
  identity: SurveyorIdentity,
): Promise<DigitalSignature>;  // delegates to existing signContent()

export async function verifyPdf(
  pdfBytes: Uint8Array,
  signature: DigitalSignature,
): Promise<VerificationResult>;  // delegates to existing verifySignature()
```

The Electron main process wires the `signPdf` / `verifyPdf` calls directly via the engine — no sidecar IPC needed (Web Crypto is synchronous in terms of CPU but async in terms of browser threading).

## Implementation Plan

### Step 1 — Extend digital-signature.ts (engine)

**File:** `packages/engine/src/signing/digital-signature.ts`

Add two exported wrapper functions on top of the existing module:

- `signPdf(pdfBytes, privateKeyBase64, identity)`: imports private key via `importPrivateKeyBase64`, calls `signContent`, returns the `DigitalSignature`.
- `verifyPdf(pdfBytes, signature)`: calls `verifySignature`, returns the `VerificationResult`.

Also add inline `#[cfg(test)]` (vitest) tests for both wrappers.

### Step 2 — Add `signaturePolicy` to country-config

**File:** `packages/country-config/src/types.ts`

Add to `StatutoryDocSpec`:
```ts
/** Per-document signature policy (required when requiresProfessionalSeal is true). */
signaturePolicy?: SignaturePolicy;
```

New top-level interface:
```ts
export interface SignaturePolicy {
  containerFormat: "detached" | "cms-pkcs7-detached" | "pades-baseline";
  allowedAlgorithms: Array<"rsa-sha256" | "ecdsa-p256-sha256">;
  minimumKeyBits: number;
  allowSelfSignedCerts: boolean;
  /** Where the signed artifact lives relative to the PDF. */
  artifactStorage: "sidecar-file" | "embedded-in-pdf";
}
```

**Files to modify:** each per-country config in `countries/*.ts` — for every doc with `requiresProfessionalSeal: true`, add:
```ts
signaturePolicy: {
  containerFormat: "detached",
  allowedAlgorithms: ["rsa-sha256"],
  minimumKeyBits: 2048,
  allowSelfSignedCerts: true,
  artifactStorage: "sidecar-file",
},
```

### Step 3 — Re-export from engine index.ts

Add `signPdf` and `verifyPdf` to the signing re-export block at `packages/engine/src/index.ts:335-349`.

### Step 4 — Electron IPC

No new sidecar methods needed. Add two handlers in `apps/desktop/src/main/index.ts:registerIpcHandlers()` that call the engine directly:

```ts
ipcMain.handle("metardu:signing:sign", async (_event, pdfBytesBase64: string, privateKeyBase64: string, surveyor) => {
  return signPdf(Buffer.from(pdfBytesBase64, 'base64'), privateKeyBase64, surveyor);
});
ipcMain.handle("metardu:signing:verify", async (_event, pkcs7Base64: string, pdfBytesBase64: string) => {
  return verifyPdf(Buffer.from(pdfBytesBase64, 'base64'), /* ... */);
});
```

Add `signing` namespace to `apps/desktop/src/preload/index.ts:metarduApi`.

Add `signing.rinex_epochs` to the ALLOWED_METHODS set (already there from T1#3 — we don't need new entries there; signing is a direct engine call not a sidecar IPC call. But preload exposes it via `window.metardu.signing.sign`/`verify`).

### Step 5 — UI: SigningPanel

**File:** `apps/desktop/src/renderer/views/SigningPanel.tsx` (new, ~300 LOC)

Mirror ExportPanel/ImportPanel structure:
- Named export `SigningPanel`, registered via lazy import in `main.tsx`.
- Surveyor identity fields (name, registration number, professional body, country).
- Keypair management: "Generate Keypair" (calls `generateKeyPair` engine), "Save Private Key" (downloads base64), "Load Private Key" (paste base64 textarea).
- "Sign PDF" button → reads PDF bytes (from current Form 3 render or file picker), calls `window.metardu.signing.sign(...)`, displays signature base64 + verification status.
- Verification panel: paste signature + pick PDF → calls `verify` → renders ✅/❌ with surveyor identity + content hash match.
- "Save signature" → downloads `.sig` file (JSON-wrapped base64).

**Files to modify:**

- `packages/ui-components/src/panels/AppShell.tsx`:
  - Add `"signing"` to `ViewId`.
  - Add `{ id: "signing", label: "Signing", icon: PenTool, category: "Surveying", shortcut: "g y" }` to NAV.
  - Add `y: "signing"` to keyboard map.
- `apps/desktop/src/renderer/main.tsx`:
  - Add `const SigningPanel = lazy(() => import("./views/SigningPanel.js").then(m => ({ default: m.SigningPanel })));`
  - Add `case "signing": return <SigningPanel />;`

### Step 6 — Tests & Verification

- `packages/engine/src/signing/tests/digital-signature.test.ts` — new file (or extend existing digital-signature.ts with inline tests).
- Test `signPdf` round-trip: generate keypair → sign PDF bytes → verify → expect `valid: true`.
- Test `verifyPdf` with tampered PDF → expect `valid: false`.
- Country config: verify `signaturePolicy` is present on all docs with `requiresProfessionalSeal: true`.

```powershell
# Engine
cd metardu-v2\packages\engine; npx tsc --noEmit
npx vitest run src/signing/tests/digital-signature.test.ts

# Country-config rebuild (to regenerate dist/ with new types)
cd metardu-v2\packages\country-config; npm run build

# Desktop
cd metardu-v2\apps\desktop; npx tsc --noEmit
```

## Exit Criteria

- [ ] `npx tsc --noEmit` (engine) — 0 errors.
- [ ] `npx tsc --noEmit` (desktop) — 0 errors.
- [ ] Signing round-trip test passes (generate → sign → verify = valid).
- [ ] `g y` keyboard shortcut opens Signing panel.
- [ ] Pick a Form 3 PDF → generate keypair → sign → verification shows ✅.
- [ ] Tampered PDF verification shows ❌ with `contentHashMatches: false`.
- [ ] `signaturePolicy` present in all country configs where `requiresProfessionalSeal: true`.
- [ ] Worklog entry appended with verbatim terminal output.
