/**
 * Surveyor's certificate cryptographic seal.
 *
 * Per Master Plan §8 (M3 deliverable): "real RSA cryptographic seal for
 * surveyor's certificate (replaces 'pending' from M2)".
 *
 * Per Survey Regulations 1994 Reg 3(2): every deed plan must bear the
 * surveyor's certificate, signed and sealed. For digital submissions to
 * NLIMS/ArdhiSasa, the signature is an RSA-2048 signature over the
 * SHA-256 hash of the document.
 *
 * Key management:
 *   - On first launch, the app generates an RSA-2048 keypair and stores
 *     it in the user's data directory under `surveyor_keys/`.
 *   - The private key is PEM-encoded and never leaves the machine.
 *   - The public key is embedded in every certificate (PEM).
 *   - The signature is base64-encoded RSA-SHA256.
 *
 * Verification:
 *   - Anyone with the public key can verify the signature against the
 *     document hash.
 *   - NLIMS can store the public key on first submission and verify
 *     all subsequent submissions from the same surveyor.
 */

import { generateKeyPairSync, sign, verify, createSign, createVerify } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import log from 'electron-log/main';

export interface SurveyorKeypair {
  publicKeyPem: string;
  privateKeyPem: string;
  fingerprint: string;  // SHA-256 of the public key, hex
  createdAt: string;
}

export interface SealResult {
  signature: string;       // base64 RSA-SHA256 signature
  publicKeyPem: string;    // PEM-encoded public key
  algorithm: string;       // 'RSA-SHA256'
  keyFingerprint: string;  // SHA-256 of public key
  signedAt: string;        // ISO timestamp
}

export interface VerifyResult {
  valid: boolean;
  algorithm: string;
  keyFingerprint: string;
  verifiedAt: string;
}

const KEY_DIR_NAME = 'surveyor_keys';
const PRIVATE_KEY_FILE = 'surveyor_private.pem';
const PUBLIC_KEY_FILE = 'surveyor_public.pem';
const METADATA_FILE = 'keypair_metadata.json';

function getKeyDir(): string {
  const userDataPath = app.getPath('userData');
  const keyDir = path.join(userDataPath, KEY_DIR_NAME);
  if (!fs.existsSync(keyDir)) {
    fs.mkdirSync(keyDir, { recursive: true });
  }
  return keyDir;
}

/**
 * Generate a new RSA-2048 keypair and store it on disk.
 * Returns the keypair (with private key — keep secure!).
 */
export function generateSurveyorKeypair(): SurveyorKeypair {
  log.info('Generating new RSA-2048 keypair for surveyor certificate sealing…');
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const publicKeyPem = publicKey as string;
  const privateKeyPem = privateKey as string;

  // Compute fingerprint (SHA-256 of the public key DER)
  const crypto = require('node:crypto') as typeof import('node:crypto');
  const pubKeyObj = crypto.createPublicKey(publicKeyPem);
  const pubDer = pubKeyObj.export({ type: 'spki', format: 'der' });
  const fingerprint = crypto.createHash('sha256').update(pubDer).digest('hex');

  const keyDir = getKeyDir();
  fs.writeFileSync(path.join(keyDir, PRIVATE_KEY_FILE), privateKeyPem, { mode: 0o600 });
  fs.writeFileSync(path.join(keyDir, PUBLIC_KEY_FILE), publicKeyPem, { mode: 0o644 });
  const metadata: SurveyorKeypair = {
    publicKeyPem,
    privateKeyPem,
    fingerprint,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(keyDir, METADATA_FILE), JSON.stringify(metadata, null, 2));

  log.info(`Keypair generated. Fingerprint: ${fingerprint.substring(0, 16)}…`);
  return metadata;
}

/**
 * Load the existing surveyor keypair from disk, or generate a new one if none exists.
 */
export function loadOrCreateSurveyorKeypair(): SurveyorKeypair {
  const keyDir = getKeyDir();
  const metadataPath = path.join(keyDir, METADATA_FILE);
  if (fs.existsSync(metadataPath)) {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as SurveyorKeypair;
    log.info(`Loaded existing surveyor keypair (fingerprint: ${metadata.fingerprint.substring(0, 16)}…)`);
    return metadata;
  }
  return generateSurveyorKeypair();
}

/**
 * Sign a document hash with the surveyor's private key.
 *
 * @param documentHash - hex-encoded SHA-256 hash of the document (e.g., PDF)
 * @param keypair - the surveyor's keypair (from loadOrCreateSurveyorKeypair)
 * @returns SealResult with the base64 signature + public key
 */
export function sealDocument(documentHash: string, keypair: SurveyorKeypair): SealResult {
  if (!/^[0-9a-f]{64}$/i.test(documentHash)) {
    throw new Error(`Invalid document hash: expected 64 hex chars (SHA-256), got ${documentHash.length} chars`);
  }
  const signer = createSign('RSA-SHA256');
  signer.update(Buffer.from(documentHash, 'hex'));
  signer.end();
  const signature = signer.sign(keypair.privateKeyPem, 'base64');

  return {
    signature,
    publicKeyPem: keypair.publicKeyPem,
    algorithm: 'RSA-SHA256',
    keyFingerprint: keypair.fingerprint,
    signedAt: new Date().toISOString(),
  };
}

/**
 * Verify a document signature against the surveyor's public key.
 *
 * @param documentHash - hex-encoded SHA-256 hash of the document
 * @param signature - base64 RSA-SHA256 signature
 * @param publicKeyPem - PEM-encoded public key
 * @returns VerifyResult with valid=true if the signature matches
 */
export function verifySeal(
  documentHash: string,
  signature: string,
  publicKeyPem: string,
): VerifyResult {
  if (!/^[0-9a-f]{64}$/i.test(documentHash)) {
    throw new Error(`Invalid document hash: expected 64 hex chars (SHA-256), got ${documentHash.length} chars`);
  }
  const verifier = createVerify('RSA-SHA256');
  verifier.update(Buffer.from(documentHash, 'hex'));
  verifier.end();
  const valid = verifier.verify(publicKeyPem, signature, 'base64');

  // Compute fingerprint of the provided public key for identification
  const crypto = require('node:crypto') as typeof import('node:crypto');
  const pubKeyObj = crypto.createPublicKey(publicKeyPem);
  const pubDer = pubKeyObj.export({ type: 'spki', format: 'der' });
  const fingerprint = crypto.createHash('sha256').update(pubDer).digest('hex');

  return {
    valid,
    algorithm: 'RSA-SHA256',
    keyFingerprint: fingerprint,
    verifiedAt: new Date().toISOString(),
  };
}

/**
 * Generate the full text of the surveyor's certificate per Survey Reg 3(2).
 */
export function generateCertificateText(opts: {
  surveyorName: string;
  surveyorLicense: string;
  firmName?: string;
  surveyDate: string;
  parcelNumber: string;
  lrNumber: string;
  areaText: string;
  precisionRatio: string | number;
  traverseLegs: number;
  adjustmentMethod: string;
}): string {
  const precision = typeof opts.precisionRatio === 'number'
    ? (opts.precisionRatio >= 999999 ? '∞ (perfect closure)' : `1:${opts.precisionRatio}`)
    : opts.precisionRatio;
  return `SURVEOR'S CERTIFICATE
${'='.repeat(60)}

I, ${opts.surveyorName} (License No. ${opts.surveyorLicense}${opts.firmName ? `, ${opts.firmName}` : ''}),
hereby certify that the survey shown on this plan was executed by me
in accordance with the Survey Act (Cap. 299) and the Survey
Regulations 1994.

Survey details:
  Parcel: ${opts.parcelNumber} (LR ${opts.lrNumber})
  Area: ${opts.areaText}
  Survey date: ${opts.surveyDate}
  Traverse: ${opts.traverseLegs} legs, ${opts.adjustmentMethod} adjustment
  Precision: ${precision}

I further certify that the beacons shown on this plan were placed
under my supervision and that the coordinates shown are true and
correct to the best of my knowledge and belief.

Surveyor's signature: _______________________
Date: ${opts.surveyDate}

${'='.repeat(60)}
Digital signature: RSA-SHA256
Sealed by METARDU Desktop v0.1.0
`;
}
