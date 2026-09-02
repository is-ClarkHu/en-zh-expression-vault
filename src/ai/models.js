// Model tiers (v5) — every provider offers FIVE graded model slots instead of
// one hard-pinned id. The grades are deliberately far apart, so switching tier
// is a real quality/price decision rather than a version bump:
//
//   T1 Frontier  the provider's newest & strongest model — LIVE, re-pointed by
//                "Update models" the day a stronger one ships (Fable 5 → 5.1)
//   T2 Flagship  top of the settled generation
//   T3 Balanced  the everyday workhorse
//   T4 Light     small model, cheap, still capable
//   T5 Fastest   the smallest model still in service — lowest latency & price
//
// Only T1 tracks the frontier. T2–T5 stay pinned exactly where they are for as
// long as the provider keeps serving them; an update only touches them when a
// pin is retired (or collides with T1), and the replacement may be a little
// stronger but never strong enough to reach the tier above it.
//
// Everything the ranking needs is derived from the live model list, so a
// provider shipping a brand-new family still resolves without a code change.

import { getSettings, setSetting } from "./settings.js";

export const TIERS = [
  { key: "t1", label: "T1 · Frontier", live: true, hint: "Newest & strongest — re-pointed on every update." },
  { key: "t2", label: "T2 · Flagship", hint: "Top of the settled generation." },
  { key: "t3", label: "T3 · Balanced", hint: "Everyday workhorse: good enough, much cheaper." },
  { key: "t4", label: "T4 · Light", hint: "Small model — fast and cheap, fine for mechanical work." },
  { key: "t5", label: "T5 · Fastest", hint: "Smallest model still in service — lowest latency." },
];
export const TIER_KEYS = TIERS.map((t) => t.key);
export const LIVE_TIER = TIER_KEYS[0];
export const DEFAULT_TIER = "t2"; // matches the old hard-pinned flagship defaults

// Shipped starting points. These are only the *initial* pins: "Update models"
// re-points T1 at whatever is strongest today and repairs any tier the provider
// has retired, so this table ages gracefully instead of going stale.
export const DEFAULT_CATALOG = {
  claude: {
    t1: "claude-fable-5",
    t2: "claude-opus-5",
    t3: "claude-sonnet-5",
    t4: "claude-sonnet-4-6",
    t5: "claude-haiku-4-5",
  },
  openai: {
    t1: "gpt-5",
    t2: "gpt-4.1",
    t3: "gpt-4.1-mini",
    t4: "gpt-4o",
    t5: "gpt-4o-mini",
  },
  gemini: {
    t1: "gemini-2.5-pro",
    t2: "gemini-2.5-flash",
    t3: "gemini-2.0-flash",
    t4: "gemini-2.5-flash-lite",
    t5: "gemini-2.0-flash-lite",
  },
  // DeepSeek and Moonshot publish short line-ups; the empty slots fill
  // themselves the first time "Update models" reads their live list.
  deepseek: {
    t1: "deepseek-reasoner",
    t2: "deepseek-chat",
    t3: "",
    t4: "",
    t5: "",
  },
  moonshot: {
    t1: "kimi-latest",
    t2: "moonshot-v1-128k",
    t3: "moonshot-v1-32k",
    t4: "moonshot-v1-8k",
    t5: "",
  },
  mistral: {
    t1: "mistral-large-latest",
    t2: "mistral-medium-latest",
    t3: "mistral-small-latest",
    t4: "ministral-8b-latest",
    t5: "ministral-3b-latest",
  },
};

// --- ranking ---------------------------------------------------------------
// A model's score is family band (coarse, provider-specific) + version number +
// a size modifier. Bands are 10 apart *before* the ×10 below, so version and
// size never let a model jump its family — but within a family the newer /
// larger one always wins, which is what the tier repair needs.

const FAMILIES = {
  claude: [
    [/mythos|fable/, 60],
    [/opus/, 50],
    [/sonnet/, 40],
    [/haiku/, 25],
  ],
  openai: [
    [/^gpt-[5-9]/, 60],
    [/^o\d/, 50], // o-series reasoning models
    [/^gpt-4\.\d/, 40],
    [/^gpt-4/, 30],
    [/^gpt-3/, 15],
  ],
  gemini: [
    [/^gemini/, 40], // one family — version + size decide the order
    [/^gemma/, 15],
  ],
  deepseek: [
    [/reasoner|-r\d/, 50],
    [/chat|-v\d/, 35],
    [/coder/, 25],
  ],
  moonshot: [
    [/kimi/, 50],
    [/128k/, 40],
    [/32k/, 30],
    [/8k/, 20],
  ],
  mistral: [
    [/mistral-large|magistral/, 50],
    [/mistral-medium/, 40],
    [/mistral-small|codestral|pixtral/, 30],
    [/ministral|mistral-tiny|mistral-nemo/, 15],
  ],
};

// Size class within a family. First match wins, so the narrower spellings come
// first (flash-lite is a lite, not a flash). The tokens must be delimited —
// a bare /mini/ matches "ge-mini" and would demote every Gemini model.
const SIZE = [
  [/(?:^|[-_])(nano|tiny|3b|1b|4b)\b/, -12],
  [/(?:^|[-_])(mini|lite|small|8b|7b|9b)\b/, -8],
  [/(?:^|[-_])(flash|turbo|instant|haiku)\b/, -4],
  [/(?:^|[-_])(pro|max|ultra|large|reasoner|thinking)\b/, 2],
];

// Version number out of an id: "gpt-4.1" → 4.1, "claude-opus-4-8" → 4.8,
// "claude-fable-5" → 5. Dates, context sizes and parameter counts are stripped
// first so they can't be mistaken for a version.
export function versionOf(id) {
  const s = String(id)
    .toLowerCase()
    .replace(/\b\d{6,}\b/g, " ") // 20251001 date snapshots
    .replace(/\b\d+[kmb]\b/g, " "); // 128k context, 8b params
  let m = s.match(/(\d+)\.(\d+)/);
  // "claude-opus-4-8" → 4.8, but not "gpt-4-0613" (a 4-digit tail is a date).
  if (!m) m = s.match(/[-_](\d{1,2})[-_](\d{1,2})(?!\d)/);
  if (m) return Math.min(Number(m[1]) + Number(m[2]) / 10, 20);
  m = s.match(/(\d+)/);
  return m ? Math.min(Number(m[1]), 20) : 0;
}

export function modelScore(pid, id) {
  if (!id) return -Infinity;
  const s = String(id).toLowerCase();
  let band = 0;
  for (const [re, rank] of FAMILIES[pid] || []) {
    if (re.test(s)) {
      band = rank;
      break;
    }
  }
  let size = 0;
  for (const [re, adj] of SIZE) {
    if (re.test(s)) {
      size = adj;
      break;
    }
  }
  // Previews/experiments rank a hair under an equivalent stable id, so a stable
  // model wins a tie but a genuinely newer preview still wins on version.
  const unstable = /preview|exp\b|-exp|experimental|alpha|beta|nightly/.test(s) ? -0.5 : 0;
  return band * 10 + versionOf(s) + size + unstable;
}

// Non-chat endpoints (embeddings, audio, images, moderation…) share the model
// list and must never be pinned as a chat tier.
const NOT_CHAT =
  /embed|whisper|tts|audio|speech|transcri|dall-?e|imagen|image|video|veo|sora|moderation|rerank|guard|ocr|realtime|davinci|babbage|curie|instruct-\d|search-preview|gemma|aqa/;

export function isChatModel(pid, id) {
  const s = String(id).toLowerCase();
  if (NOT_CHAT.test(s)) return false;
  if (pid === "claude") return s.startsWith("claude-");
  if (pid === "gemini") return s.startsWith("gemini-");
  return true;
}

// --- catalog access --------------------------------------------------------

// The five tiers for a provider: shipped defaults, overlaid with whatever the
// last "Update models" resolved.
export function catalogFor(pid, s = getSettings()) {
  return { ...(DEFAULT_CATALOG[pid] || {}), ...((s.modelCatalog || {})[pid] || {}) };
}

export function tierFor(pid, s = getSettings()) {
  return (s.modelTier && s.modelTier[pid]) || DEFAULT_TIER;
}

// Which model a call on this provider actually uses: an explicit per-provider
// override wins (settings.models — the "Custom…" box), then the chosen tier,
// then the nearest filled tier below it (thin line-ups leave slots empty).
export function resolveModel(pid, s = getSettings()) {
  const pinned = ((s.models && s.models[pid]) || "").trim();
  if (pinned) return pinned;
  const cat = catalogFor(pid, s);
  const from = TIER_KEYS.indexOf(tierFor(pid, s));
  for (let i = Math.max(from, 0); i < TIER_KEYS.length; i++) if (cat[TIER_KEYS[i]]) return cat[TIER_KEYS[i]];
  for (let i = Math.max(from, 0) - 1; i >= 0; i--) if (cat[TIER_KEYS[i]]) return cat[TIER_KEYS[i]];
  return "";
}

// --- live model lists ------------------------------------------------------

const LIST_URL = {
  openai: "https://api.openai.com/v1/models",
  deepseek: "https://api.deepseek.com/v1/models",
  moonshot: "https://api.moonshot.cn/v1/models",
  mistral: "https://api.mistral.ai/v1/models",
};

async function getJSON(url, headers) {
  const res = await fetch(url, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || data?.message || `HTTP ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : `HTTP ${res.status}`);
  }
  return data;
}

const stamp = (v) => (typeof v === "number" ? v : Date.parse(v || "") / 1000 || 0);

// What the provider is serving right now → [{ id, created }] (created is a unix
// second stamp where the provider reports one, else 0).
export async function listModels(pid, key) {
  if (pid === "claude") {
    const data = await getJSON("https://api.anthropic.com/v1/models?limit=100", {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    });
    return (data.data || []).map((m) => ({ id: m.id, created: stamp(m.created_at) }));
  }

  if (pid === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`;
    const data = await getJSON(url, {});
    return (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => ({ id: String(m.name || "").replace(/^models\//, ""), created: 0 }));
  }

  const url = LIST_URL[pid];
  if (!url) throw new Error(`No model list endpoint for "${pid}".`);
  const data = await getJSON(url, { authorization: `Bearer ${key}` });
  return (data.data || data.models || []).map((m) => ({ id: m.id || m.name, created: stamp(m.created) }));
}

// --- the update plan (pure — unit-testable without a network or a browser) --

// Rank the live list against the current five pins and return the next catalog
// plus a human-readable list of what moved.
export function planCatalog(pid, current, live) {
  const next = { ...current };
  const changes = [];
  const pool = (live || []).filter((m) => m && m.id && isChatModel(pid, m.id));
  if (!pool.length) return { catalog: next, changes };

  const served = new Set(pool.map((m) => m.id));
  const stronger = (a, b) => {
    const d = modelScore(pid, b.id) - modelScore(pid, a.id);
    return d !== 0 ? d : (b.created || 0) - (a.created || 0);
  };

  // T1 tracks the frontier: always re-point it at the best model on offer.
  const top = [...pool].sort(stronger)[0];
  if (top && top.id !== next[LIVE_TIER]) {
    changes.push({
      tier: LIVE_TIER,
      from: next[LIVE_TIER] || "",
      to: top.id,
      reason: next[LIVE_TIER] && served.has(next[LIVE_TIER]) ? "newer model available" : "was retired",
    });
    next[LIVE_TIER] = top.id;
  }

  // T2–T5 keep their pin while the provider still serves it. A dead (or now
  // duplicated) pin is replaced by the closest still-served model that stays
  // BELOW the tier above it — a small step up is fine, a grade jump is not.
  for (let i = 1; i < TIER_KEYS.length; i++) {
    const key = TIER_KEYS[i];
    const pinned = next[key];
    const above = next[TIER_KEYS[i - 1]];
    const ceiling = above ? modelScore(pid, above) : Infinity;
    // Ids spoken for by another tier: resolved ones above, still-good pins below.
    const taken = new Set(TIER_KEYS.filter((k) => k !== key).map((k) => next[k]).filter(Boolean));

    if (pinned && served.has(pinned) && !taken.has(pinned) && modelScore(pid, pinned) < ceiling) continue;

    const target = pinned ? modelScore(pid, pinned) : ceiling;
    const candidates = pool.filter((m) => !taken.has(m.id) && modelScore(pid, m.id) < ceiling);
    if (!candidates.length) {
      if (pinned) {
        changes.push({ tier: key, from: pinned, to: "", reason: "retired, no replacement below the tier above" });
        next[key] = "";
      }
      continue;
    }
    // Prefer the closest model at or above the retired one's strength, then the
    // closest below it; newest first on a tie.
    const distance = (m) => {
      const sc = modelScore(pid, m.id);
      return sc >= target ? sc - target : target - sc + 1000;
    };
    candidates.sort((a, b) => distance(a) - distance(b) || (b.created || 0) - (a.created || 0));
    const pick = candidates[0];
    if (pick.id !== pinned) {
      changes.push({
        tier: key,
        from: pinned || "",
        to: pick.id,
        reason: !pinned ? "slot filled" : served.has(pinned) ? "moved up a tier" : "was retired",
      });
      next[key] = pick.id;
    }
  }

  return { catalog: next, changes };
}

// --- update ----------------------------------------------------------------

// Read one provider's live model list and re-resolve its five tiers. Throws
// NO_KEY when that provider has no key on file; network/auth errors surface as
// themselves so the caller can show them per row.
export async function refreshProvider(pid) {
  const s = getSettings();
  const key = (s.apiKeys && s.apiKeys[pid]) || "";
  if (!key) throw new Error("NO_KEY");
  const live = await listModels(pid, key);
  const { catalog, changes } = planCatalog(pid, catalogFor(pid, s), live);
  setSetting("modelCatalog", { ...(getSettings().modelCatalog || {}), [pid]: catalog });
  setSetting("modelsCheckedAt", { ...(getSettings().modelsCheckedAt || {}), [pid]: Date.now() });
  return { catalog, changes, count: live.length };
}
