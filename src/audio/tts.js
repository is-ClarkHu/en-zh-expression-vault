// Pronunciation (SPEC §8, v3 §7) — system TTS via the Web Speech API. Default to a
// clean General American / US-West-Coast voice and keep the OS's NOVELTY voices out
// of the way: macOS ships "Albert", "Zarvox", "Bubbles", "Bad News"… all tagged
// en-US, and picking the raw-first en-US voice landed on one of those — that was
// the "weird/useless pronunciation" (v3 item 7). We now rank voices by quality and
// hide the novelties, so the common word gets one clean read. The user can still
// override via Settings (ttsVoice); the picker (v3 §8) shows the same ranked list.
//
// Proper nouns (player/country names) that TTS mangles (§8) are out of scope
// here; the AI-filled `reading` (IPA) stays visible on the card as a fallback.

import { getSettings } from "../ai/settings.js";

export const isSupported = () => "speechSynthesis" in window;

let cache = [];

// macOS novelty / robotic voices that are tagged en-US but read everything wrong.
// Lower-cased exact names; matched against the voice name's leading token too so
// "Albert" matches whether or not the OS appends a qualifier.
const NOVELTY = new Set([
  "albert", "bad news", "bahh", "bells", "boing", "bubbles", "cellos", "deranged",
  "good news", "hysterical", "jester", "junior", "kathy", "organ", "pipe organ",
  "princess", "ralph", "fred", "superstar", "trinoids", "whisper", "wobble", "zarvox",
]);

// General-American voices to prefer when the user hasn't chosen one, best first.
// Samantha is the classic macOS GA voice; Aaron/Nicky are the modern Siri-class
// (US) voices; the Google/Microsoft entries cover Chrome and Edge/Windows.
const PREFERRED = [
  "samantha", "ava", "allison", "susan", "nicky", "aaron", "zoe",
  "google us english", "microsoft aria", "microsoft jenny", "microsoft guy",
];

const isEnUS = (v) => (v.lang || "").toLowerCase().replace("_", "-").startsWith("en-us");
const baseName = (v) => (v.name || "").toLowerCase().trim();
const isNovelty = (v) => {
  const n = baseName(v);
  return NOVELTY.has(n) || NOVELTY.has(n.split(/[\s(]/)[0]);
};

// Higher = better. Preferred GA names rank first (by their order), then
// enhanced/premium quality, then local (offline, lower-latency) voices.
function score(v) {
  const n = baseName(v);
  let s = 0;
  const pref = PREFERRED.findIndex((p) => n === p || n.startsWith(p));
  if (pref !== -1) s += 1000 - pref * 10;
  if (/enhanced|premium|neural|natural/.test(n)) s += 200;
  if (v.localService) s += 50;
  if (v.default) s += 5;
  return s;
}

// getVoices() is empty until the engine loads them; wait for voiceschanged once.
function loadVoices() {
  return new Promise((resolve) => {
    if (!isSupported()) return resolve([]);
    const have = speechSynthesis.getVoices();
    if (have.length) return resolve(have);
    speechSynthesis.addEventListener("voiceschanged", () => resolve(speechSynthesis.getVoices()), { once: true });
  });
}

// en-US voices worth offering: novelties dropped, ranked best-first. Used by the
// Settings voice picker (v3 §8) and by the default pick below.
export async function enUSVoices() {
  cache = await loadVoices();
  return cache
    .filter((v) => isEnUS(v) && !isNovelty(v))
    .sort((a, b) => score(b) - score(a));
}

function pickVoice() {
  const name = getSettings().ttsVoice;
  if (name) {
    const chosen = cache.find((v) => v.name === name);
    if (chosen) return chosen; // explicit user choice wins, even if it's a novelty
  }
  // No (valid) choice → the best clean GA voice available.
  const ranked = cache
    .filter((v) => isEnUS(v) && !isNovelty(v))
    .sort((a, b) => score(b) - score(a));
  return ranked[0] || cache.find(isEnUS) || cache[0] || null;
}

export async function speak(text) {
  if (!text || !isSupported()) return;
  if (!cache.length) await loadVoices();
  speechSynthesis.cancel(); // interrupt anything already speaking
  const u = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  } else {
    u.lang = "en-US";
  }
  u.rate = getSettings().ttsRate || 1;
  speechSynthesis.speak(u);
}

// A small speaker button that speaks `text`. Stops click propagation so it works
// inside clickable cards (e.g. the review flip card) without triggering them.
// Line-style SVG glyph (SPEC v2 §9: no emoji).
const SPEAKER_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a8 8 0 0 1 0 11"/></svg>';

export function speakButton(text) {
  const b = document.createElement("button");
  b.className = "btn--speak";
  b.type = "button";
  b.innerHTML = SPEAKER_SVG;
  b.title = "Pronounce";
  b.setAttribute("aria-label", "Pronounce");
  if (!isSupported()) b.disabled = true;
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    speak(text);
  });
  return b;
}
