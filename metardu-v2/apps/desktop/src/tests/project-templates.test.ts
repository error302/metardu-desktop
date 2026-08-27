/**
 * Tests for project templates — verifies template structure, completeness,
 * and helper functions.
 */

import { describe, it, expect } from "vitest";
import {
  PROJECT_TEMPLATES,
  getTemplatesForCountry,
  getTemplateById,
  getTemplateCountryCodes,
} from "../renderer/project-templates.js";

describe("Project templates", () => {
  it("has 10 templates defined across supported markets", () => {
    expect(PROJECT_TEMPLATES).toHaveLength(10);
  });

  it("all templates have unique IDs", () => {
    const ids = PROJECT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all templates have required fields", () => {
    for (const tmpl of PROJECT_TEMPLATES) {
      expect(tmpl.id).toBeTruthy();
      expect(tmpl.name).toBeTruthy();
      expect(tmpl.description).toBeTruthy();
      expect(tmpl.icon).toBeTruthy();
      expect(tmpl.countryCode).toBeTruthy();
      expect(tmpl.surveyType).toBeTruthy();
      expect(tmpl.views.length).toBeGreaterThan(0);
      expect(tmpl.statutoryNotes.length).toBeGreaterThan(0);
    }
  });

  it("all templates have at least one required view", () => {
    for (const tmpl of PROJECT_TEMPLATES) {
      const required = tmpl.views.filter((v) => v.required);
      expect(required.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("all view viewIds are non-empty strings", () => {
    for (const tmpl of PROJECT_TEMPLATES) {
      for (const view of tmpl.views) {
        expect(view.viewId).toBeTruthy();
        expect(view.label).toBeTruthy();
        expect(view.purpose).toBeTruthy();
      }
    }
  });

  it("fee defaults have non-negative values", () => {
    for (const tmpl of PROJECT_TEMPLATES) {
      expect(tmpl.feeDefaults.areaHa).toBeGreaterThanOrEqual(0);
      expect(tmpl.feeDefaults.beaconCount).toBeGreaterThanOrEqual(0);
      expect(tmpl.feeDefaults.traverseKm).toBeGreaterThanOrEqual(0);
      expect(tmpl.feeDefaults.terrainIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it("all templates cover the supported markets", () => {
    const codes = new Set(PROJECT_TEMPLATES.map((t) => t.countryCode));
    expect([...codes].sort()).toEqual(["AU", "DE", "GB", "KE", "ZA"]);
  });

  describe("getTemplatesForCountry", () => {
    it("returns all Kenya templates for KE", () => {
      expect(getTemplatesForCountry("KE")).toHaveLength(6);
    });

    it("returns empty array for unsupported country", () => {
      expect(getTemplatesForCountry("US")).toHaveLength(0);
    });
  });

  describe("getTemplateById", () => {
    it("returns the correct template", () => {
      const tmpl = getTemplateById("ke-subdivision");
      expect(tmpl).toBeDefined();
      expect(tmpl!.name).toBe("Subdivision");
    });

    it("returns undefined for non-existent ID", () => {
      expect(getTemplateById("nonexistent")).toBeUndefined();
    });
  });

  describe("getTemplateCountryCodes", () => {
    it("returns all supported market codes", () => {
      expect(getTemplateCountryCodes().sort()).toEqual(["AU", "DE", "GB", "KE", "ZA"]);
    });
  });
});
