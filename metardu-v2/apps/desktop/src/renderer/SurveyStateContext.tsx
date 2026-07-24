/**
 * Survey State Context — shared state layer that lets survey views
 * store their workflow output, which the ExportPanel reads.
 *
 * Replaces the demo data in ExportPanel with real survey data from
 * whatever the surveyor last computed in any workflow view.
 *
 * # Architecture
 *
 *   ┌─────────────────────────────────────────────┐
 *   │  SurveyStateProvider (wraps the entire app)  │
 *   │     ↓                                        │
 *   │  useSurveyState() hook                       │
 *   │     ↓                                        │
 *   │  TopographicView → setSurveyOutput(output)   │
 *   │  EngineeringView → setSurveyOutput(output)   │
 *   │  SettingOutView → setSurveyOutput(output)    │
 *   │  SectionalView → setSurveyOutput(output)     │
 *   │     ↓                                        │
 *   │  ExportPanel → const { output } = useSurveyState()
 *   └─────────────────────────────────────────────┘
 *
 * The context stores the most recent survey output from any view +
 * metadata about which view produced it (so the ExportPanel can show
 * "Exporting: Topographic Survey from TopographicView").
 */

import React, { createContext, useContext, useState, useCallback, type ReactNode } from "react";

/**
 * The survey output stored in context. This is the `SurveyOutput` union
 * type from the engine — but we keep it as `unknown` here to avoid
 * coupling the renderer to the engine's type system (which would pull
 * the entire engine into the renderer bundle).
 */
export interface SurveyState {
  /** The most recent workflow output from any view. */
  output: unknown;
  /** Which survey type produced this output (from detectSurveyType). */
  surveyType: string;
  /** Which view produced this output (e.g., "TopographicView"). */
  sourceView: string;
  /** When the output was set (ISO 8601 timestamp). */
  timestamp: string;
  /** The country code used when running the workflow. */
  countryCode: string;
}

interface SurveyStateContextValue {
  /** Current survey state, or null if no survey has been run yet. */
  state: SurveyState | null;
  /** Set the current survey output. Called by workflow views. */
  setSurveyOutput: (output: unknown, surveyType: string, sourceView: string, countryCode: string) => void;
  /** Clear the current survey state. */
  clear: () => void;
}

const SurveyStateContext = createContext<SurveyStateContextValue | null>(null);

/**
 * Provider component — wraps the app so all views + ExportPanel share
 * the same survey state.
 */
export const SurveyStateProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, setState] = useState<SurveyState | null>(null);

  const setSurveyOutput = useCallback(
    (output: unknown, surveyType: string, sourceView: string, countryCode: string) => {
      setState({
        output,
        surveyType,
        sourceView,
        timestamp: new Date().toISOString(),
        countryCode,
      });
    },
    [],
  );

  const clear = useCallback(() => setState(null), []);

  return (
    <SurveyStateContext.Provider value={{ state, setSurveyOutput, clear }}>
      {children}
    </SurveyStateContext.Provider>
  );
};

/**
 * Hook for accessing the survey state. Must be used inside a
 * SurveyStateProvider.
 *
 * @example
 * // In a workflow view:
 * const { setSurveyOutput } = useSurveyState();
 * const result = runTopographicWorkflow({ ... });
 * setSurveyOutput(result, "topographic", "TopographicView", "KE");
 *
 * // In ExportPanel:
 * const { state } = useSurveyState();
 * if (state) { export(state.output, ...); }
 */
export function useSurveyState(): SurveyStateContextValue {
  const ctx = useContext(SurveyStateContext);
  if (!ctx) {
    throw new Error("useSurveyState must be used inside a SurveyStateProvider");
  }
  return ctx;
}
