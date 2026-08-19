/**
 * Theme definitions for MetaRDU Desktop.
 *
 * Three themes:
 *   1. Dark (default) — near-black backgrounds, high-contrast text (Linear/Void pattern)
 *   2. Light — white backgrounds, dark text (for outdoor high-ambient-light use)
 *   3. High Contrast — maximum contrast ratio, thicker borders, bold text
 *
 * Each theme is a partial record of CSS custom properties that overrides
 * the :root defaults in metardu-theme.css. The active theme is applied
 * by setting a data-theme attribute on <html> and using CSS selectors.
 */

export type ThemeId = "dark" | "light" | "high-contrast";

export interface ThemeDef {
  id: ThemeId;
  label: string;
  icon: string;
  vars: Record<string, string>;
}

export const THEMES: ThemeDef[] = [
  {
    id: "dark",
    label: "Dark",
    icon: "🌙",
    vars: {
      "--bg-primary": "#08090a",
      "--bg-secondary": "#0f1011",
      "--bg-tertiary": "#1a1b1e",
      "--bg-hover": "#1c1d1f",
      "--bg-active": "#252628",
      "--text-primary": "#ffffff",
      "--text-secondary": "#a1a1aa",
      "--text-tertiary": "#71717a",
      "--text-disabled": "#52525b",
      "--text-inverted": "#08090a",
      "--border-default": "#27272a",
      "--border-strong": "#3f3f46",
      "--accent-primary": "#FF9500",
    },
  },
  {
    id: "light",
    label: "Light",
    icon: "☀️",
    vars: {
      "--bg-primary": "#f8f9fa",
      "--bg-secondary": "#ffffff",
      "--bg-tertiary": "#f1f3f5",
      "--bg-hover": "#e9ecef",
      "--bg-active": "#dee2e6",
      "--text-primary": "#1a1a2e",
      "--text-secondary": "#495057",
      "--text-tertiary": "#868e96",
      "--text-disabled": "#ced4da",
      "--text-inverted": "#ffffff",
      "--border-default": "#dee2e6",
      "--border-strong": "#adb5bd",
      "--accent-primary": "#e67e00",
    },
  },
  {
    id: "high-contrast",
    label: "High Contrast",
    icon: "🔲",
    vars: {
      "--bg-primary": "#000000",
      "--bg-secondary": "#0a0a0a",
      "--bg-tertiary": "#1a1a1a",
      "--bg-hover": "#222222",
      "--bg-active": "#333333",
      "--text-primary": "#ffffff",
      "--text-secondary": "#e0e0e0",
      "--text-tertiary": "#b0b0b0",
      "--text-disabled": "#707070",
      "--text-inverted": "#000000",
      "--border-default": "#555555",
      "--border-strong": "#888888",
      "--accent-primary": "#FF9500",
      "--status-success": "#00ff41",
      "--status-error": "#ff3333",
      "--status-warning": "#ffcc00",
    },
  },
];

/**
 * Apply a theme by setting CSS custom properties on the document root.
 * Also persists the choice to localStorage.
 */
export function applyTheme(id: ThemeId): void {
  const theme = THEMES.find(t => t.id === id);
  if (!theme) return;
  const root = document.documentElement;
  root.setAttribute("data-theme", id);
  // Remove all theme-specific vars first, then apply new ones
  for (const t of THEMES) {
    for (const key of Object.keys(t.vars)) {
      root.style.removeProperty(key);
    }
  }
  for (const [key, val] of Object.entries(theme.vars)) {
    root.style.setProperty(key, val);
  }
  try { localStorage.setItem("metardu-theme", id); } catch { /* SSR */ }
}

/**
 * Load the persisted theme from localStorage, or return "dark" as default.
 */
export function loadPersistedTheme(): ThemeId {
  try {
    const saved = localStorage.getItem("metardu-theme");
    if (saved === "light" || saved === "high-contrast" || saved === "dark") return saved;
  } catch { /* SSR */ }
  return "dark";
}
