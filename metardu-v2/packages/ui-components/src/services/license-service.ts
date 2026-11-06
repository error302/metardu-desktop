/**
 * Desktop authorization boundary.
 *
 * No license issuer is configured in this build. Local storage and renderer
 * state cannot establish an entitlement, device binding, or offline lease.
 */

import { useState, useEffect, useCallback } from "react";

export type LicenseTier = "Unconfigured" | "free" | "pro" | "team" | "firm" | "enterprise";
export type LicenseStatus = "UNCONFIGURED" | "ACTIVE" | "OFFLINE_GRACE" | "EXPIRED" | "UNAUTHENTICATED";

export interface LicenseInfo {
  isAuthenticated: boolean;
  userEmail: string | null;
  accountName: string | null;
  tier: LicenseTier;
  status: LicenseStatus;
  machineId: string;
  leaseExpiresAt: string; // ISO date
  daysRemainingOffline: number;
  signedTokenHash: string;
  serverUrl: string;
  maxSeats: number;
  activeSeat: number;
  features: {
    gnssPpk: boolean;
    lsa3d: boolean;
    dronePhotogrammetry: boolean;
    cadFieldToFinish: boolean;
    landRegistryLodgement: boolean;
  };
}

const EVENT_NAME = "metardu:license:changed";

function getUnconfiguredLicense(): LicenseInfo {
  return {
    isAuthenticated: false,
    userEmail: null,
    accountName: null,
    tier: "Unconfigured",
    status: "UNCONFIGURED",
    machineId: "NOT_REGISTERED",
    leaseExpiresAt: "",
    daysRemainingOffline: 0,
    signedTokenHash: "NOT_VERIFIED",
    serverUrl: "",
    maxSeats: 0,
    activeSeat: 0,
    features: {
      gnssPpk: false,
      lsa3d: false,
      dronePhotogrammetry: false,
      cadFieldToFinish: false,
      landRegistryLodgement: false,
    },
  };
}

export function loadLicenseInfo(): LicenseInfo {
  // Deliberately ignore legacy localStorage leases: a renderer-local record
  // cannot prove that an issuer signed or renewed an entitlement.
  return getUnconfiguredLicense();
}

function publishUnconfiguredState(): LicenseInfo {
  const info = getUnconfiguredLicense();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: info }));
  }
  return info;
}

export async function signInWithWebAccount(): Promise<LicenseInfo> {
  throw new Error("Shared METARDU account verification is not connected. No credentials were accepted or saved.");
}

export async function refreshOfflineLease(): Promise<LicenseInfo> {
  throw new Error("Offline lease renewal is unavailable until a license issuer is configured.");
}

export function signOutWebAccount(): LicenseInfo {
  return publishUnconfiguredState();
}

export function useLicense(): {
  license: LicenseInfo;
  signIn: () => Promise<LicenseInfo>;
  refreshLease: () => Promise<LicenseInfo>;
  signOut: () => LicenseInfo;
} {
  const [license, setLicense] = useState<LicenseInfo>(loadLicenseInfo);

  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<LicenseInfo>;
      setLicense(customEvent.detail?.status === "UNCONFIGURED" ? customEvent.detail : loadLicenseInfo());
    };

    window.addEventListener(EVENT_NAME, handleUpdate);
    return () => window.removeEventListener(EVENT_NAME, handleUpdate);
  }, []);

  const signIn = useCallback(() => signInWithWebAccount(), []);

  const refresh = useCallback(() => {
    return refreshOfflineLease();
  }, []);

  const logout = useCallback(() => {
    const unconfigured = signOutWebAccount();
    setLicense(unconfigured);
    return unconfigured;
  }, []);

  return {
    license,
    signIn,
    refreshLease: refresh,
    signOut: logout,
  };
}
