import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const projectsPanelSource = readFileSync(new URL("../renderer/views/ProjectsPanel.tsx", import.meta.url), "utf8");

describe("project jurisdiction defaults", () => {
  it("starts with no assigned jurisdiction and describes neutral projects", () => {
    expect(projectsPanelSource).toContain('useState("")');
    expect(projectsPanelSource).toContain("Jurisdiction (optional)");
    expect(projectsPanelSource).toContain("Unspecified — neutral project");
    expect(projectsPanelSource).toContain("countryCode: country");
    expect(projectsPanelSource).toContain('p.countryCode || "Not specified"');
    expect(projectsPanelSource).not.toMatch(/setCountry\("KE"\)|countryCode:\s*"KE"/);
  });

  it("uses the canonical configured-country list and clears stale templates on change", () => {
    expect(projectsPanelSource).toContain('import { COUNTRY_OPTIONS, GLOBAL_WGS84_UTM_OPTIONS, projectCrsLabel } from "../countries.js"');
    expect(projectsPanelSource).toContain("COUNTRY_OPTIONS.map((option) =>");
    expect(projectsPanelSource).toContain("setSelectedTemplate(null)");
    expect(projectsPanelSource).toContain("setShowTemplateInfo(null)");
  });

  it("keeps CRS selection independent and explicit for neutral projects", () => {
    expect(projectsPanelSource).toContain("GLOBAL_WGS84_UTM_OPTIONS.map((option) =>");
    expect(projectsPanelSource).toContain("crsSrid: crsSrid ? Number(crsSrid) : undefined");
    expect(projectsPanelSource).toContain("Existing coordinates were not transformed.");
    expect(projectsPanelSource).toContain("Choosing a CRS records metadata only");
    expect(projectsPanelSource).toContain("Other datums and height systems need a verified operation or grid");
  });
});
