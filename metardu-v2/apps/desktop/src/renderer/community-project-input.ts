import {
  COMMUNITY_PLUGIN_JSON_VALUE_SCHEMA,
  MAX_COMMUNITY_PLUGIN_INPUT_BYTES,
} from "@metardu/ipc-schemas";
import type { StoredProject } from "./useProjectStore.js";

export interface CommunityProjectOutputInput {
  json: string;
  byteLength: number;
  sourceView: string;
  surveyType: string;
  declaredCountryCode: string;
}

export type CommunityProjectOutputInputResult =
  | { ok: true; value: CommunityProjectOutputInput }
  | { ok: false; message: string };

/** Build a small, explicit, local-only JSON input from the current saved project output. */
export function buildCommunityProjectOutputInput(
  project: Pick<StoredProject, "countryCode" | "crsSrid" | "coordinateContext" | "coordinateContextStatus" | "output" | "sourceView" | "surveyType">,
): CommunityProjectOutputInputResult {
  if (project.output === null || project.output === undefined) {
    return { ok: false, message: "The active project has no saved workflow output to provide." };
  }

  const input = {
    schema: "metardu-project-output-input/v1",
    context: {
      surveyType: project.surveyType,
      sourceView: project.sourceView,
      declaredCountryCode: project.countryCode,
      declaredHorizontalCrsSrid: project.crsSrid ?? null,
      declaredCoordinateContext: project.coordinateContext ?? null,
      coordinateContextState: project.coordinateContextStatus === "invalid"
        ? "invalid"
        : project.coordinateContext
          ? "declared"
          : "not-declared",
    },
    output: project.output,
  };

  const validation = COMMUNITY_PLUGIN_JSON_VALUE_SCHEMA.safeParse(input);
  if (!validation.success) {
    return {
      ok: false,
      message: `The saved project output cannot be passed as bounded extension input: ${validation.error.issues[0]?.message ?? "invalid JSON value"}`,
    };
  }

  try {
    const json = JSON.stringify(input);
    if (json === undefined) return { ok: false, message: "The saved project output could not be serialized as JSON." };
    const byteLength = new TextEncoder().encode(json).byteLength;
    if (byteLength > MAX_COMMUNITY_PLUGIN_INPUT_BYTES) {
      return { ok: false, message: "The saved project output exceeds the 4 MiB extension input limit. No partial data was loaded." };
    }
    return {
      ok: true,
      value: {
        json,
        byteLength,
        sourceView: project.sourceView,
        surveyType: project.surveyType,
        declaredCountryCode: project.countryCode,
      },
    };
  } catch {
    return { ok: false, message: "The saved project output could not be serialized as bounded JSON." };
  }
}
