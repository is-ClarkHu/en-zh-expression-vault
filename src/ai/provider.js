// Multi-provider LLM call layer (browser-direct; the key is the user's own,
// stored locally). Vendored from prior flashcard work and adapted (SPEC §10:
// "AI provider/caching layer" is reused, not rewritten).
//
// Providers: claude (Anthropic), openai, gemini, and OpenAI-compatible ones
// (deepseek, moonshot, mistral). Some providers may block direct browser CORS;
// if so, switch provider or run a batch path. Defaults favor quality — these
// are interactive, you-want-it-good calls.
//
// On top of the raw text call this exposes callJSON(), which asks for a strict
// JSON object and parses it. We stay provider-agnostic (prompt-for-JSON +
// tolerant parse) so all six providers work; provider-native structured output
// (Anthropic output_config, OpenAI response_format) can be layered on later.

import { getSettings } from "./settings.js";
import { getCached, setCached } from "../db/index.js";

export const PROVIDERS = [
  { id: "claude", label: "Claude", defaultModel: "claude-opus-4-8" },
  { id: "openai", label: "ChatGPT", defaultModel: "gpt-4o" },
  { id: "gemini", label: "Gemini", defaultModel: "gemini-2.5-pro" },
  { id: "deepseek", label: "DeepSeek", defaultModel: "deepseek-chat" },
  { id: "moonshot", label: "Moonshot", defaultModel: "moonshot-v1-32k" },
  { id: "mistral", label: "Mistral", defaultModel: "mistral-large-latest" },
];

const OPENAI_COMPAT = {
  openai: "https://api.openai.com/v1/chat/completions",
  deepseek: "https://api.deepseek.com/v1/chat/completions",
  moonshot: "https://api.moonshot.cn/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
};

export function providerMeta(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
}

async function postJSON(url, headers, body) {
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || data?.message || `HTTP ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : `HTTP ${res.status}`);
  }
  return data;
}

async function callProvider(pid, key, model, prompt, { system, maxTokens = 1024 } = {}) {
  if (pid === "claude") {
    const data = await postJSON(
      "https://api.anthropic.com/v1/messages",
      {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      {
        model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: prompt }],
      },
    );
    return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  }

  if (pid === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const data = await postJSON(
      url,
      { "content-type": "application/json" },
      {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      },
    );
    const parts = data?.candidates?.[0]?.content?.parts || [];
    return parts.map((p) => p.text || "").join("").trim();
  }

  // OpenAI-compatible: openai / deepseek / moonshot / mistral
  const url = OPENAI_COMPAT[pid];
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const data = await postJSON(
    url,
    { "content-type": "application/json", authorization: `Bearer ${key}` },
    { model, max_tokens: maxTokens, messages },
  );
  return (data?.choices?.[0]?.message?.content || "").trim();
}

// Resolve the active provider config and run one text completion. Identical
// (provider, model, system, prompt) calls are served from the local cache so a
// repeated lookup / ask / deep-dive doesn't re-bill the user's key (SPEC §10).
export async function callText(prompt, opts = {}) {
  const s = getSettings();
  const pid = s.provider || "claude";
  const key = (s.apiKeys && s.apiKeys[pid]) || "";
  if (!key) throw new Error("NO_KEY");
  const model = (s.models && s.models[pid]) || providerMeta(pid).defaultModel;

  const cacheKey = `${pid}:${model}:${opts.system || ""}:${prompt}`;
  const cached = await getCached(cacheKey);
  if (cached != null) return cached;

  const text = await callProvider(pid, key, model, prompt, opts);
  if (!text) throw new Error("Empty response");
  await setCached(cacheKey, text);
  return text;
}

// Pull the first JSON object/array out of a model reply (tolerates ```json
// fences and stray prose around it).
function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) throw new Error("No JSON found in response");
  // Walk to the matching closing bracket so trailing prose is ignored.
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < body.length; i++) {
    if (body[i] === open) depth++;
    else if (body[i] === close && --depth === 0) {
      return JSON.parse(body.slice(start, i + 1));
    }
  }
  throw new Error("Unterminated JSON in response");
}

// Ask for a strict JSON object and parse it. maxTokens defaults higher than the
// text path since a candidate card with several fields needs the room.
export async function callJSON(prompt, opts = {}) {
  const text = await callText(prompt, { maxTokens: 1500, ...opts });
  return extractJSON(text);
}
