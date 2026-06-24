// Lightweight settings store (localStorage). The full settings UI + IndexedDB
// persistence arrive later; this gives the app one place to read/write the AI
// provider config. Keys are the user's own and stay on-device (SPEC §0.5, §7).

const KEY = "ev-settings";

const DEFAULTS = {
  provider: "claude", // which LLM powers ask / quick-lookup
  apiKeys: {}, // per-provider keys, local only: { claude, openai, deepseek, ... }
  models: {}, // optional per-provider model overrides
  dropboxAppKey: "", // Dropbox app key (client id) for sync — not a secret (PKCE)
};

export function getSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setSetting(key, value) {
  const s = getSettings();
  s[key] = value;
  localStorage.setItem(KEY, JSON.stringify(s));
  return s;
}
