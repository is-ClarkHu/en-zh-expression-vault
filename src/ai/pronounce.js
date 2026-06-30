// Proper-noun pronunciation (v4 §1c). Produces a plain-text RESPELLING (e.g.
// "duh-BROYN"), never IPA — so it feeds the Web Speech API directly, with no
// SSML and no cloud TTS (the original IPA→SSML plan died because the browser
// engine accepts plain text only).
//
// Trust comes from MULTI-MODEL CONSENSUS. The v4 step-0 test showed (a) a single
// model's self-reported "is this anglicized" flag wavers (De Bruyne came back
// true/false/true across models) and (b) DeepSeek mis-stresses names
// (soo-BAH-roo), so this path runs on STRONG English-native models only and
// trusts cross-model AGREEMENT over any single self-report:
//   - two strong providers (with keys) agree on the respelling → reliable.
//   - they diverge → the name has no settled US reading; return one reasonable
//     approximation flagged `approximate` (don't make the user pick — there's no
//     "correct" candidate to choose, v4 §1c).
//   - only one strong key configured → single-model result (still usable; just
//     not consensus-backed).

import { callJSON, PRONUNCIATION_PROVIDER_IDS } from "./provider.js";
import { getSettings } from "./settings.js";
import { agree } from "./respelling-match.js";

// Strong, English-native-corpus providers in preference order (shared with the
// Settings routing list). DeepSeek/Moonshot are excluded — verification showed
// them weak on English phonetics.
const STRONG = PRONUNCIATION_PROVIDER_IDS;

// The strong providers that actually have a key, primary first. The per-scenario
// "pronunciation" pick (if it's a strong provider with a key) leads; the rest of
// STRONG follow as consensus partners / fallbacks.
function strongProvidersWithKeys() {
  const s = getSettings();
  const keyed = (pid) => !!(s.apiKeys && s.apiKeys[pid]);
  const primary = s.scenarioProvider?.pronunciation;
  const ordered = [
    ...(primary && STRONG.includes(primary) ? [primary] : []),
    ...STRONG.filter((p) => p !== primary),
  ];
  return [...new Set(ordered)].filter(keyed);
}

const SYSTEM =
  "You give the AMERICAN-ENGLISH pronunciation of a proper noun — how a US " +
  "English speaker actually says the name, NOT the source-language original " +
  "(the US reading of Subaru differs from the Japanese one; the US one is wanted). " +
  "Return ONLY strict JSON: {\"respelling\": string, \"anglicized\": boolean}. " +
  "`respelling` is a plain phonetic spelling with the STRESSED syllable in CAPS, " +
  "e.g. \"duh-BROYN\", \"SOO-buh-roo\", \"SHEV-ruh-LAY\" — plain ASCII letters and " +
  "hyphens only, never IPA. `anglicized` is true if the name has a settled common " +
  "US reading an ordinary TTS dictionary would already have (so TTS can say the " +
  "NAME directly), false for an obscure name TTS would mangle.";

function askProvider(provider, name, identity) {
  const prompt =
    `Name: ${JSON.stringify(name)}` +
    (identity ? `\nWhat it is: ${identity}` : "") +
    `\n\nGive the American-English respelling.`;
  return callJSON(prompt, { provider, scenario: "pronunciation", maxTokens: 200 });
}

// Resolve a name's pronunciation. Returns:
//   { respelling, anglicized, reliable, approximate, sources }
// `reliable` = two strong models agreed. `approximate` = they diverged (no
// settled reading) — show the respelling with a light "approximate" note.
// Best-effort: a failed/blocked call degrades rather than throwing.
export async function pronounce(name, identity = null) {
  const providers = strongProvidersWithKeys();
  if (!providers.length) {
    return { respelling: null, anglicized: null, reliable: false, approximate: false, sources: [] };
  }

  const primary = providers[0];
  let first;
  try {
    first = await askProvider(primary, name, identity);
  } catch {
    return { respelling: null, anglicized: null, reliable: false, approximate: false, sources: [] };
  }

  // Only one strong key → single-model result, no consensus signal.
  if (providers.length < 2) {
    return {
      respelling: first.respelling || null,
      anglicized: !!first.anglicized,
      reliable: false,
      approximate: false,
      sources: [primary],
    };
  }

  const secondary = providers[1];
  let second;
  try {
    second = await askProvider(secondary, name, identity);
  } catch {
    // Consensus partner unavailable → fall back to the primary alone.
    return {
      respelling: first.respelling || null,
      anglicized: !!first.anglicized,
      reliable: false,
      approximate: false,
      sources: [primary],
    };
  }

  const consensus = agree(first.respelling, second.respelling);
  return {
    // On agreement keep the primary's respelling; on divergence still surface the
    // primary's as the single reasonable approximation (v4 §1c: don't make the
    // user pick among near-identical candidates).
    respelling: first.respelling || second.respelling || null,
    // Anglicized only when the models AGREE on the reading AND both flag it
    // settled. Divergence overrides a "settled" self-report: a live De Bruyne /
    // Mbappé run showed both models can claim anglicized=true yet return DIFFERENT
    // respellings — which contradicts "settled". If we trusted that flag, TTS would
    // read the literal name (e.g. "Mbappé", which it mangles) instead of the
    // respelling we already have. So no consensus → read the respelling, not the name.
    anglicized: consensus && !!first.anglicized && !!second.anglicized,
    reliable: consensus,
    approximate: !consensus,
    sources: [primary, secondary],
  };
}
