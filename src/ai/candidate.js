// The live AI processing (SPEC §4) — the highest-uncertainty link, validated
// first (SPEC §10). Two entries, both ending in fully-filled candidate card(s):
//   quickLookup(term)         — Entry A: expand vocabulary, no conversation (§3.1)
//   askAndExtract(input, ask) — Entry B: "I don't understand", answer + extract (§3.2)
//
// Both return candidates shaped like the `expression` core object (SPEC §2.1).
// The AI fills the semantic fields; the app stamps id / timestamps on Save.

import { callJSON } from "./provider.js";
import { getTags } from "../db/index.js";

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
  "intents": string[],      // intent tags, e.g. ["describe-strong"]
  "relations": [            // related EXPRESSIONS shown as tappable links — NEVER substitutes for "surface"
    { "type": "synonym"|"antonym"|"abbreviation", "surface": string, "register": "slang"|"casual"|"neutral"|"formal"|"academic"|"technical", "common": boolean }
  ]
}`;

const RULES = `Rules:
- Choose the sense that fits the context; for a polyseme give sense_key + the sense-correct gloss/register (e.g. "buff" gym-sense, not game-sense).
- pos: the part of speech; for a multi-word expression use "phrase" or "pattern" (matching kind).
- example_parallel: only when kind is "phrase" or "pattern" — write one natural English example that reuses the same structure with DIFFERENT content (e.g. "on his way to get shredded" → "on her way to ace the exam"); it must not repeat the source line. For a bare word, set it to null.
- kind "pattern": the surface MUST be the abstract, reusable SKELETON with a placeholder, e.g. "engage one's [body part]" — NEVER a concrete sentence. Put a concrete instance with its Chinese in example_parallel, e.g. "engage your core — 收紧核心". The skeleton is the card's identity; the example is just one instance of it.
- topics/intents: 1-3 short lowercase-kebab tags each, inferred from context. REUSE an existing tag from the list below whenever one genuinely fits (so synonymous concepts share a tag instead of splitting); mint a NEW tag only when none matches. Do not force unrelated items into an existing tag — a new tag, even a one-off, is correct when nothing fits.
- NEVER substitute the surface: return the card for the EXACT term given, even if a more common or "more correct" form exists (e.g. "knee pit" stays "knee pit" with register casual — do NOT return "back of the knee"). Put any near-meaning or short/long forms in "relations" instead, never by swapping the surface.
- relations: related expressions the user can jump to — synonym (same meaning), antonym (opposite), or abbreviation (the SAME word's full↔short form, e.g. biceps↔bis, session↔sesh, repetitions↔reps). Give each its register; set "common": true on whichever form people use more in this context. Use [] when there are none.
- gloss_cn and intent_cn are in Chinese; everything else stays as specified.
- Respond with ONLY a JSON object. No markdown, no commentary.`;

// Show the model the tags already in the vault so it reuses them rather than
// inventing a near-synonym each time (SPEC v2 §7 reuse-first; live tags are a
// provisional draft the §8 reassign later re-derives). "(none yet)" on an empty
// vault — the first words legitimately mint the starting tags.
async function existingTagsBlock() {
  const [topics, intents] = await Promise.all([getTags("topic"), getTags("intent")]);
  const fmt = (tags) =>
    tags.length ? tags.map((t) => t.name).sort().join(", ") : "(none yet)";
  return `Existing tags already in the vault (prefer reusing these):
- topics: ${fmt(topics)}
- intents: ${fmt(intents)}`;
}

function quickLookupPrompt(term, existingTags) {
  return `You expand a Chinese speaker's English vocabulary. They typed a term (Chinese or English); return the single best English expression to bank, as a filled candidate card.

Term: ${JSON.stringify(term)}

${existingTags}

${RULES}

Return: { "candidates": [ ${CARD_FIELDS} ] }   // usually exactly one card`;
}

function askExtractPrompt(input, ask, existingTags) {
  return `A Chinese speaker is learning English and doesn't understand something. Answer their question, then extract the keep-worthy English expression(s) from the raw input as filled candidate cards. One sentence may yield several; a single slang word yields one with the right sense.

Raw input: ${JSON.stringify(input)}
Their question: ${JSON.stringify(ask || "What does this mean, and what's worth keeping?")}

${existingTags}

${RULES}
- If the capture is about HOW A WORD IS USED — a reusable usage pattern (e.g. asking about "engage your core" to learn the "engage + body part" usage) — return TWO candidate cards so the user can choose: (1) an abstract PATTERN card (kind "pattern", surface = the skeleton like "engage one's [body part]", example_parallel = a concrete instance with its Chinese), AND (2) the literal PHRASE card (kind "phrase", surface = the exact phrase). For ordinary captures that are not about a word's reusable usage, just return the normal card(s).

Return: { "answer": string,  // the explanation they read, in Chinese
          "candidates": [ ${CARD_FIELDS}, ... ] }`;
}

// Entry C — idiomatic box (§5): a Chinese intent the speaker can't render
// naturally → several idiomatic English renderings + the reusable keywords as
// candidate cards (the input-side feeder for intent reverse-search).
function idiomaticPrompt(input, existingTags) {
  return `A Chinese speaker knows what they want to say in Chinese but can't produce idiomatic English. Given their Chinese sentence/intent:
1. Give several idiomatic English renderings of the WHOLE thing, most natural first, each with its register and a short Chinese note on nuance/when to use it.
2. Extract the reusable KEYWORDS (the pieces worth banking) as filled candidate cards.

Chinese input: ${JSON.stringify(input)}

${existingTags}

${RULES}

Return: {
  "renderings": [ { "en": string, "register": "slang"|"casual"|"neutral"|"formal"|"academic"|"technical", "note_cn": string|null } ],
  "candidates": [ ${CARD_FIELDS}, ... ]
}`;
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
        // related expressions as links, never substitutes (v3 §10). Keep only the
        // three link kinds with a surface; default register/common defensively.
        relations: Array.isArray(c.relations)
          ? c.relations
              .filter((r) => r && typeof r.surface === "string" && r.surface.trim())
              .map((r) => ({
                type: ["synonym", "antonym", "abbreviation"].includes(r.type) ? r.type : "synonym",
                surface: r.surface.trim(),
                register: r.register || null,
                common: !!r.common,
              }))
          : [],
        example_src: exampleSrc,
      };
    });
}

// Entry A — quick-lookup (§3.1). No conversation; returns { candidates }.
export async function quickLookup(term) {
  const data = await callJSON(quickLookupPrompt(term, await existingTagsBlock()), { scenario: "enrich" });
  return { candidates: normalize(data.candidates, term) };
}

// Entry C — idiomatic (§5). Returns { renderings, candidates }.
export async function idiomatic(input) {
  const data = await callJSON(idiomaticPrompt(input, await existingTagsBlock()), { scenario: "enrich" });
  const renderings = Array.isArray(data.renderings)
    ? data.renderings
        .filter((r) => r && typeof r.en === "string" && r.en.trim())
        .map((r) => ({ en: r.en.trim(), register: r.register || "neutral", note_cn: r.note_cn || null }))
    : [];
  return { renderings, candidates: normalize(data.candidates, input) };
}

// Entry B — Q&A (§3.2). Returns { answer, candidates }. Each candidate carries
// the originating exchange as qa_log (SPEC §2.1) so it travels with the saved
// card for deep-dives and re-encounters.
export async function askAndExtract(input, ask) {
  const data = await callJSON(askExtractPrompt(input, ask, await existingTagsBlock()), { scenario: "enrich" });
  const answer = typeof data.answer === "string" ? data.answer : "";
  const qa = { q: ask || input, a: answer };
  return {
    answer,
    candidates: normalize(data.candidates, input).map((c) => ({ ...c, qa_log: [qa] })),
  };
}
