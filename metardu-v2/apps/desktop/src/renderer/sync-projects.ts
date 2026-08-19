/**
 * sync-projects.ts — pure mapping between the ProjectStore and the sync
 * client's SyncProject wire shape.
 *
 * Extracted out of SyncPanel so the planSheet-in-payload guarantee is
 * unit-testable: a project's remembered statutory print-plan settings
 * (sheet size, orientation, scale mode) must ride along in the sync
 * payload so they survive a push/pull round-trip and are available to
 * the web app. This module has no React/Electron imports — it can be
 * tested in isolation (apps/desktop/src/tests/sync-projects.test.ts).
 */

import type { PlanSheetSettings } from "../main/project-store-core.js";

/** The subset of a stored project the sync payload is built from. */
export interface StoredForSync {
  id: string;
  name: string;
  description?: string;
  countryCode: string;
  surveyType: string;
  sourceView: string;
  output: unknown;
  planSheet?: PlanSheetSettings;
  updatedAt: string;
}

/** The SyncProject wire shape (mirror of the engine's SyncProject). */
export interface SyncProjectWire {
  id: string;
  name: string;
  description?: string;
  countryCode: string;
  surveyType: string;
  updatedAt: string;
  version: number;
  data: Record<string, unknown>;
}

/**
 * Build a SyncProject from a stored ProjectStore project.
 *
 * The stored id is stable (created once, updated by id), so re-pushing
 * the same project updates the remote copy (PUT) instead of creating
 * duplicates (POST). `savedVersion` is the version the server last
 * returned — passing it keeps SyncClient on PUT after the first push.
 *
 * planSheet rides in the payload so a project's remembered print
 * settings (sheet size/orientation/scale) survive sync — they're
 * restored locally on the next session and available to web.
 */
export function projectFromStored(
  stored: StoredForSync,
  savedVersion: number,
): SyncProjectWire {
  return {
    id: stored.id,
    name: stored.name,
    description: stored.description,
    countryCode: stored.countryCode,
    surveyType: stored.surveyType,
    updatedAt: stored.updatedAt,
    version: savedVersion,
    data: {
      output: stored.output,
      sourceView: stored.sourceView,
      ...(stored.planSheet ? { planSheet: stored.planSheet } : {}),
    },
  };
}
