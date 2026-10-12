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
    expect(projectsPanelSource).toContain('import { COUNTRY_OPTIONS } from "../countries.js"');
    expect(projectsPanelSource).toContain("COUNTRY_OPTIONS.map((option) =>");
    expect(projectsPanelSource).toContain("setSelectedTemplate(null)");
    expect(projectsPanelSource).toContain("setShowTemplateInfo(null)");
  });
});
