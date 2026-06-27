// Lightweight settings store (localStorage). The full settings UI + IndexedDB
// persistence arrive later; this gives the app one place to read/write the AI
// provider config. Keys are the user's own and stay on-device (SPEC §0.5, §7).

const KEY = "ev-settings";

const DEFAULTS = {
  provider: "claude", // fallback LLM when a scenario has no explicit pick
  apiKeys: {}, // per-provider keys, local only: { claude, openai, deepseek, ... }
  models: {}, // optional per-provider model overrides
  // Per-scenario provider routing (SPEC v2 §12): each AI scenario picks its own
  // provider, falling back to `provider` when unset. enrich/reassign want the
  // cheap one, deep-dive the strong one. Embedding has its own setting below.
  scenarioProvider: {}, // { enrich, deepdive, reassign } → provider id
  embedProvider: "openai", // which provider computes embeddings (reassign §8 / graph §11)
  embedModels: {}, // optional per-provider embedding-model overrides
  lastReassignedAt: 0, // when the global reassign last ran (local UI hint, §8)
  dropboxAppKey: "", // Dropbox app key (client id) for sync — not a secret (PKCE)
  ttsVoice: "", // chosen Web Speech voice name ("" = auto-pick an en-US voice)
  ttsRate: 1, // speech rate 0.5–1.5
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
