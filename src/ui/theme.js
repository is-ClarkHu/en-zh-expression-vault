// Appearance / theme (SPEC v3 §8). The stylesheet defaults to following the OS
// (prefers-color-scheme); a manual choice sets `data-theme` on <html>, which the
// CSS honours over the media query. "auto" clears it and returns to the OS.

import { getSettings, setSetting } from "../ai/settings.js";

export function applyTheme(theme = getSettings().theme) {
  const t = theme || "auto";
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

export function setTheme(value) {
  setSetting("theme", value);
  applyTheme(value);
}
