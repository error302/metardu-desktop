import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadLicenseInfo,
  refreshOfflineLease,
  signInWithWebAccount,
  signOutWebAccount,
} from "../../../../packages/ui-components/src/services/license-service.js";

describe("desktop license boundary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not trust a legacy localStorage lease", () => {
    const getItem = vi.fn(() => JSON.stringify({
      isAuthenticated: true,
      tier: "Professional",
      status: "ACTIVE",
      daysRemainingOffline: 30,
      signedTokenHash: "ED25519-SIG-FAKE",
    }));
    vi.stubGlobal("window", { localStorage: { getItem, setItem: vi.fn() } });

    const license = loadLicenseInfo();

    expect(getItem).not.toHaveBeenCalled();
    expect(license.isAuthenticated).toBe(false);
    expect(license.status).toBe("UNCONFIGURED");
    expect(license.tier).toBe("Unconfigured");
    expect(license.daysRemainingOffline).toBe(0);
    expect(license.signedTokenHash).toBe("NOT_VERIFIED");
    expect(Object.values(license.features).every((enabled) => !enabled)).toBe(true);
  });

  it("rejects sign-in and lease renewal without an issuer", async () => {
    await expect(signInWithWebAccount())
      .rejects.toThrow("Shared METARDU account verification is not connected");
    await expect(refreshOfflineLease())
      .rejects.toThrow("Offline lease renewal is unavailable");
  });

  it("returns only an unconfigured state on sign-out", () => {
    const license = signOutWebAccount();

    expect(license.isAuthenticated).toBe(false);
    expect(license.status).toBe("UNCONFIGURED");
    expect(license.userEmail).toBeNull();
    expect(license.signedTokenHash).toBe("NOT_VERIFIED");
  });
});
