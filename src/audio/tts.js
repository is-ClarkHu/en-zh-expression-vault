// Pronunciation (SPEC §8) — system TTS via the Web Speech API. Targets
// General American (en-US); the user picks among the en-US voices their OS
// offers (quality varies — macOS "premium/enhanced" voices sound best once
// downloaded in System Settings → Accessibility → Spoken Content).
//
// Proper nouns (player/country names) that TTS mangles (§8) are out of scope
// here; the AI-filled `reading` (IPA) stays visible on the card as a fallback.

import { getSettings } from "../ai/settings.js";

export const isSupported = () => "speechSynthesis" in window;

let cache = [];

// getVoices() is empty until the engine loads them; wait for voiceschanged once.
function loadVoices() {
  return new Promise((resolve) => {
    if (!isSupported()) return resolve([]);
    const have = speechSynthesis.getVoices();
    if (have.length) return resolve(have);
    speechSynthesis.addEventListener("voiceschanged", () => resolve(speechSynthesis.getVoices()), { once: true });
  });
}

// en-US voices, local/high-quality first.
export async function enUSVoices() {
  cache = await loadVoices();
  return cache
    .filter((v) => (v.lang || "").toLowerCase().replace("_", "-").startsWith("en-us"))
    .sort((a, b) => Number(b.localService) - Number(a.localService));
}

function pickVoice() {
  const name = getSettings().ttsVoice;
  return (
    cache.find((v) => v.name === name) ||
    cache.find((v) => (v.lang || "").toLowerCase().replace("_", "-").startsWith("en-us")) ||
    cache[0] ||
    null
  );
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

// A small 🔊 button that speaks `text`. Stops click propagation so it works
// inside clickable cards (e.g. the review flip card) without triggering them.
export function speakButton(text) {
  const b = document.createElement("button");
  b.className = "btn--speak";
  b.type = "button";
  b.textContent = "🔊";
  b.title = "Pronounce";
  if (!isSupported()) b.disabled = true;
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    speak(text);
  });
  return b;
}
