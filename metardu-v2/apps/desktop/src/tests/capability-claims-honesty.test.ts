import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RegistryArchiveView } from "../renderer/views/RegistryArchiveView.js";
import { WORKFLOW_STAGES } from "../../../../packages/ui-components/src/panels/AppShell.js";

describe("capability claims stay evidence-based", () => {
  it("does not render fabricated registry records or an inert search action", () => {
    const markup = renderToStaticMarkup(React.createElement(RegistryArchiveView));

    expect(markup).toContain("Registry archive lookup is unavailable");
    expect(markup).not.toContain("KIAMBU/RIRUTA/247");
    expect(markup).not.toContain("Active / Clean Title");
    expect(markup).not.toContain("Search National Registry Archive");
  });

  it("does not promise unverified module counts, certified plans, signing, or portal uploads", () => {
    const stageCopy = WORKFLOW_STAGES.map((stage) => `${stage.name} ${stage.description}`).join(" ");

    expect(stageCopy).toContain("Views available in this build");
    expect(stageCopy).not.toMatch(/40 geomatics modules|Form 4 Certified|RSA-2048|portal upload|Bowditch traverse/i);
  });
});
