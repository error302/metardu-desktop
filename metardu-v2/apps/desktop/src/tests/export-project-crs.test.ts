import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const exportPanelSource = readFileSync(new URL("../renderer/views/ExportPanel.tsx", import.meta.url), "utf8");

describe("project CRS export safety", () => {
  it("blocks export when the recorded CRS differs from the jurisdiction CRS used by exporters", () => {
    expect(exportPanelSource).toContain("const countryPrimarySrid = countryProfile?.config.geodeticFramework.primarySRID");
    expect(exportPanelSource).toContain("if (countryPrimarySrid !== activeProject.crsSrid)");
    expect(exportPanelSource).toContain("Exporting would mislabel the coordinates.");
  });

  it("passes a matching explicit project CRS to the main-process WGS84 operation", () => {
    expect(exportPanelSource).toContain("...(activeProject?.crsSrid !== undefined ? { crsSrid: activeProject.crsSrid } : {})");
  });
});
