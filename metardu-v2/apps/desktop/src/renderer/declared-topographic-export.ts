/** Narrow native-DXF path; other exporters retain their jurisdiction guard.
 * This checks the saved declaration only. The engine validates geometry again.
 */
export function canExportDeclaredTopographicDxf(format: string, output: unknown, projectSrid: number, outputWgs84: boolean): boolean {
  if (format !== "dxf" || outputWgs84 || !Number.isSafeInteger(projectSrid) || projectSrid <= 0 || !output || typeof output !== "object") return false;
  const saved = output as Record<string, unknown>;
  if (saved.evidenceStatus !== "computed-draft-unadjusted" || !saved.tin || !Array.isArray(saved.contours)) return false;
  const context = saved.coordinateContext as Record<string, unknown> | undefined;
  return !!context && context.horizontalCrsEpsg === projectSrid && context.horizontalUnits === "m"
    && context.referenceStatus === "user-declared-unverified"
    && typeof context.horizontalCrsLabel === "string" && !!context.horizontalCrsLabel.trim()
    && typeof context.verticalReference === "string" && !!context.verticalReference.trim();
}
