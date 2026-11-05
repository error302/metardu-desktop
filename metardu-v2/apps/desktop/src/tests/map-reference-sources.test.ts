import { describe, expect, it } from "vitest";
import {
  createNetherlandsCadastralReferenceLayer,
  NETHERLANDS_CADASTRAL_REFERENCE,
} from "../renderer/map-reference-sources.js";
import {
  PUBLIC_MAP_CONTENT_SECURITY_POLICY,
  publicMapReferenceCspPlugin,
} from "../../../../scripts/public-map-reference-csp-plugin.js";

describe("curated public map reference sources", () => {
  it("declares the official PDOK WMS and its reference-only limits", () => {
    expect(NETHERLANDS_CADASTRAL_REFERENCE).toMatchObject({
      id: "nl-kadaster-cadastral-reference-v5",
      jurisdiction: "Netherlands",
      custodian: "Kadaster, delivered via PDOK",
      serviceType: "WMS",
      license: "CC BY; required credit: CC-BY Kadaster NL",
      projectStored: false,
      includedInExports: false,
      usableForSurveyComputation: false,
    });
    expect(NETHERLANDS_CADASTRAL_REFERENCE.serviceUrl).toMatch(/^https:\/\/service\.pdok\.nl\//);
    expect(NETHERLANDS_CADASTRAL_REFERENCE.useLimit).toContain("Do not derive exact boundary positions");
    expect(NETHERLANDS_CADASTRAL_REFERENCE.refreshStatement).toContain("does not expose a per-feature timestamp");
  });

  it("creates a hidden, attributed WMS layer so no provider requests occur before opt-in", () => {
    const layer = createNetherlandsCadastralReferenceLayer();
    const source = layer.getSource();

    expect(layer.getVisible()).toBe(false);
    expect(layer.getZIndex()).toBe(1);
    expect(source?.getUrls()).toEqual([NETHERLANDS_CADASTRAL_REFERENCE.serviceUrl]);
    expect(source?.getParams()).toMatchObject({
      LAYERS: "KadastraleGrens",
      VERSION: "1.3.0",
      FORMAT: "image/png",
      TRANSPARENT: true,
    });
  });

  it("allows only named map image origins and keeps renderer connections self-only", () => {
    const imagePolicy = PUBLIC_MAP_CONTENT_SECURITY_POLICY.match(/img-src ([^;]+)/)?.[1]?.split(" ") ?? [];
    const connectPolicy = PUBLIC_MAP_CONTENT_SECURITY_POLICY.match(/connect-src ([^;]+)/)?.[1];
    const html = publicMapReferenceCspPlugin().transformIndexHtml?.("<html><head></head><body></body></html>");

    expect(imagePolicy).toContain("https://service.pdok.nl");
    expect(imagePolicy.every((source) => !source.includes("*"))).toBe(true);
    expect(imagePolicy).not.toContain("https:");
    expect(connectPolicy).toBe("'self'");
    expect(html).toContain('http-equiv="Content-Security-Policy"');
  });
});
