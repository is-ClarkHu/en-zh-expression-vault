// The live AI processing (SPEC §4) — the highest-uncertainty link, validated
// first (SPEC §10). Two entries, both ending in fully-filled candidate card(s):
//   quickLookup(term)         — Entry A: expand vocabulary, no conversation (§3.1)
//   askAndExtract(input, ask) — Entry B: "I don't understand", answer + extract (§3.2)
//
// Both return candidates shaped like the `expression` core object (SPEC §2.1).
// The AI fills the semantic fields; the app stamps id / timestamps on Save.

import { callJSON } from "./provider.js";

// The card fields the AI is responsible for. Kept in one place so both prompts
// describe the same contract (and so the schema can tighten later).
const CARD_FIELDS = `{
  "surface": string,        // the expression as written, e.g. "get shredded" / "perilla"
  "kind": "word" | "phrase" | "pattern",
  "pos": "noun"|"verb"|"adj"|"adv"|"prep"|"conj"|"phrase"|"pattern", // part of speech; use "phrase"/"pattern" for multi-word items
  "reading": string|null,   // IPA, e.g. "/pəˈrɪlə/"; null if not useful
  "gloss_cn": string,       // concise Chinese gloss
  "intent_cn": string,      // the communicative intent in Chinese, e.g. "形容某人很强壮"
  "register": "slang"|"casual"|"neutral"|"formal"|"academic"|"technical",
  "sense_key": string|null, // short disambiguator when the surface is polysemous, e.g. "buff:gym"
  "example_parallel": string|null, // ONLY for kind phrase/pattern: one NEW example reusing the same word/pattern, NOT identical to the source line (scenario may differ); null for a bare word
  "topics": string[],       // topic tags, e.g. ["gym","fitness"]
  "intents": string[]       // intent tags, e.g. ["describe-strong"]
}`;

const RULES = `Rules:
- Choose the sense that fits the context; for a polyseme give sense_key + the sense-correct gloss/register (e.g. "buff" gym-sense, not game-sense).
- pos: the part of speech; for a multi-word expression use "phrase" or "pattern" (matching kind).
- example_parallel: only when kind is "phrase" or "pattern" — write one natural English example that reuses the same structure with DIFFERENT content (e.g. "on his way to get shredded" → "on her way to ace the exam"); it must not repeat the source line. For a bare word, set it to null.
- topics/intents: 1-3 short lowercase-kebab tags each, inferred from context.
- gloss_cn and intent_cn are in Chinese; everything else stays as specified.
- Respond with ONLY a JSON object. No markdown, no commentary.`;

function quickLookupPrompt(term) {
  return `You expand a Chinese speaker's English vocabulary. They typed a term (Chinese or English); return the single best English expression to bank, as a filled candidate card.

Term: ${JSON.stringify(term)}

${RULES}

Return: { "candidates": [ ${CARD_FIELDS} ] }   // usually exactly one card`;
}

function askExtractPrompt(input, ask) {
  return `A Chinese speaker is learning English and doesn't understand something. Answer their question, then extract the keep-worthy English expression(s) from the raw input as filled candidate cards. One sentence may yield several; a single slang word yields one with the right sense.

Raw input: ${JSON.stringify(input)}
Their question: ${JSON.stringify(ask || "What does this mean, and what's worth keeping?")}

${RULES}

Return: { "answer": string,  // the explanation they read, in Chinese
          "candidates": [ ${CARD_FIELDS}, ... ] }`;
}

// Normalize whatever the model returns into clean candidate objects, dropping
// anything missing a surface. example_src records the raw input that produced it.
function normalize(candidates, exampleSrc) {
  if (!Array.isArray(candidates)) return [];
  return candidates
    .filter((c) => c && typeof c.surface === "string" && c.surface.trim())
    .map((c) => {
      const kind = c.kind || "word";
      return {
        surface: c.surface.trim(),
        kind,
        pos: c.pos || null,
        reading: c.reading || null,
        gloss_cn: c.gloss_cn || "",
        intent_cn: c.intent_cn || "",
        register: c.register || "neutral",
        sense_key: c.sense_key || null,
        // example_parallel only applies to multi-word items; drop it for bare words
        example_parallel: kind === "word" ? null : c.example_parallel || null,
        topics: Array.isArray(c.topics) ? c.topics : [],
        intents: Array.isArray(c.intents) ? c.intents : [],
        example_src: exampleSrc,
      };
    });
}

// Entry A — quick-lookup (§3.1). No conversation; returns { candidates }.
export async function quickLookup(term) {
  const data = await callJSON(quickLookupPrompt(term));
  return { candidates: normalize(data.candidates, term) };
}

// Entry B — Q&A (§3.2). Returns { answer, candidates }. Each candidate carries
// the originating exchange as qa_log (SPEC §2.1) so it travels with the saved
// card for deep-dives and re-encounters.
export async function askAndExtract(input, ask) {
  const data = await callJSON(askExtractPrompt(input, ask));
  const answer = typeof data.answer === "string" ? data.answer : "";
  const qa = { q: ask || input, a: answer };
  return {
    answer,
    candidates: normalize(data.candidates, input).map((c) => ({ ...c, qa_log: [qa] })),
  };
}
