import { describe, it, expect, beforeAll } from "vitest";
import {
  generateKeyPair,
  exportPublicKeyBase64,
  exportPrivateKeyBase64,
  signContent,
  verifySignature,
  signPdf,
  verifyPdf,
  generateSealText,
  createIdentity,
  type SurveyorIdentity,
  type DigitalSignature,
} from "./digital-signature.js";

function makeIdentity(publicKeyBase64: string): SurveyorIdentity {
  return createIdentity(
    {
      countryCode: "KEN",
      countryName: "Kenya",
      timeZoneIANA: "Africa/Nairobi",
      defaultLanguage: "en",
      defaultCurrency: "KES",
      regulatoryBody: "Survey of Kenya — Director of Surveys",
      geodeticFramework: { primarySRID: 21037, projectionZones: [], verticalDatum: "LAT" },
      professionalBody: { name: "ISK", url: "https://www.isk.or.ke/", registrationNumberField: "Practising License No.", registrationPattern: "^ISK/\\d{4,5}$" },
      statutoryDocuments: [],
    } as any,
    "Jane Wanjiru",
    "ISK/LS/1234",
    publicKeyBase64,
  );
}

describe("digital-signature", () => {
  let keyPair: { publicKey: CryptoKey; privateKey: CryptoKey };
  let publicKeyBase64: string;
  let privateKeyBase64: string;
  let identity: SurveyorIdentity;

  beforeAll(async () => {
    keyPair = await generateKeyPair();
    publicKeyBase64 = await exportPublicKeyBase64(keyPair.publicKey);
    privateKeyBase64 = await exportPrivateKeyBase64(keyPair.privateKey);
    identity = makeIdentity(publicKeyBase64);
  });

  describe("key management", () => {
    it("generates an RSA-2048 key pair", () => {
      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();
    });

    it("exports public key as SPKI base64", () => {
      expect(publicKeyBase64).toBeTruthy();
      expect(typeof publicKeyBase64).toBe("string");
      expect(publicKeyBase64.length).toBeGreaterThan(200);
    });

    it("exports private key as PKCS8 base64", () => {
      expect(privateKeyBase64).toBeTruthy();
      expect(typeof privateKeyBase64).toBe("string");
      expect(privateKeyBase64.length).toBeGreaterThan(500);
    });
  });

  describe("signContent / verifySignature round-trip", () => {
    const content = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"

    it("signs content and returns a DigitalSignature", async () => {
      const sig = await signContent(content, keyPair.privateKey, identity, "test content");
      expect(sig.surveyor.name).toBe("Jane Wanjiru");
      expect(sig.algorithm).toContain("SHA-256");
      expect(sig.signatureBase64).toBeTruthy();
      expect(sig.contentHashBase64).toBeTruthy();
      expect(sig.signedAt).toBeTruthy();
      expect(sig.signedContent).toBe("test content");
    });

    it("verifies a valid signature", async () => {
      const sig = await signContent(content, keyPair.privateKey, identity, "test content");
      const result = await verifySignature(content, sig);
      expect(result.valid).toBe(true);
      expect(result.contentHashMatches).toBe(true);
      expect(result.signatureValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("rejects tampered content", async () => {
      const sig = await signContent(content, keyPair.privateKey, identity, "test content");
      const tampered = new Uint8Array([72, 101, 108, 108, 79]); // "HellO"
      const result = await verifySignature(tampered, sig);
      expect(result.valid).toBe(false);
      expect(result.contentHashMatches).toBe(false);
      expect(result.signatureValid).toBe(false);
      expect(result.error).toContain("modified");
    });

    it("rejects wrong-key signature", async () => {
      const sig = await signContent(content, keyPair.privateKey, identity, "test content");
      // Replace with a different public key
      const other = await generateKeyPair();
      const otherPubB64 = await exportPublicKeyBase64(other.publicKey);
      const fakeIdentity = makeIdentity(otherPubB64);
      const fakeSig: DigitalSignature = { ...sig, surveyor: fakeIdentity };
      const result = await verifySignature(content, fakeSig);
      expect(result.valid).toBe(false);
      expect(result.signatureValid).toBe(false);
    });
  });

  describe("signPdf / verifyPdf high-level wrappers", () => {
    const pdfBytes = new Uint8Array([37, 80, 68, 70, 45]); // "%PDF-"

    it("signs PDF bytes via high-level wrapper", async () => {
      const sig = await signPdf(pdfBytes, privateKeyBase64, identity);
      expect(sig.signedContent).toBe("Form 3 statutory PDF");
      expect(sig.signatureBase64).toBeTruthy();
    });

    it("verifies PDF via high-level wrapper", async () => {
      const sig = await signPdf(pdfBytes, privateKeyBase64, identity);
      const result = await verifyPdf(pdfBytes, sig);
      expect(result.valid).toBe(true);
    });

    it("rejects tampered PDF via high-level wrapper", async () => {
      const sig = await signPdf(pdfBytes, privateKeyBase64, identity);
      const tampered = new Uint8Array([37, 80, 68, 70, 42]);
      const result = await verifyPdf(tampered, sig);
      expect(result.valid).toBe(false);
    });
  });

  describe("seal rendering", () => {
    it("generates a seal text block", async () => {
      const content = new Uint8Array([1, 2, 3]);
      const sig = await signContent(content, keyPair.privateKey, identity, "Form 3");
      const seal = generateSealText(sig);
      expect(seal).toContain("Jane Wanjiru");
      expect(seal).toContain("ISK");
      expect(seal).toContain("ISK/LS/1234");
      expect(seal).toContain("SHA-256");
    });
  });

  describe("createIdentity", () => {
    it("creates identity from country config", async () => {
      const id = createIdentity(
        { countryName: "Australia", professionalBody: { name: "SSSI", url: "", registrationNumberField: "", registrationPattern: "" } } as any,
        "Bob Smith",
        "CSPS/12345",
        publicKeyBase64,
      );
      expect(id.name).toBe("Bob Smith");
      expect(id.country).toBe("Australia");
      expect(id.professionalBody).toBe("SSSI");
    });
  });
});
