// Typed knowledge-graph relations (SPEC §2.3). Cosine similarity (computed live
// in the graph, v2 §11) can't tell an antonym from a synonym — antonyms sit
// CLOSE in embedding space — so the typed relations need AI judgement. This runs
// on demand for one expression against its nearest neighbours (one call, routed
// to the deep-dive provider), and the result is stored as edges the graph reads
// without any render-time network.

import { callJSON } from "./provider.js";

export const REL_TYPES = ["synonym", "antonym", "progression", "collocation"];

// expr: the focus expression. neighbours: [{id, surface, gloss_cn}] (its nearest
// vault words). Returns [{ to, type, confidence }] for the real relations found.
export async function findRelations(expr, neighbours) {
  if (!neighbours.length) return [];
  const list = neighbours
    .map((n, i) => `${i + 1}. ${n.surface}${n.gloss_cn ? ` (${n.gloss_cn})` : ""}`)
    .join("\n");
  const prompt = `For the English expression "${expr.surface}"${expr.gloss_cn ? ` (${expr.gloss_cn})` : ""}, classify its relation to each candidate below. Use exactly one of:
- synonym: same meaning / interchangeable
- antonym: opposite meaning
- progression: same idea at a different intensity or a sequential step (e.g. tired → exhausted)
- collocation: words that habitually go together
- none: no strong relation

Candidates:
${list}

Return ONLY JSON: { "relations": [ { "n": number, "type": "synonym"|"antonym"|"progression"|"collocation"|"none", "confidence": number } ] }`;

  const data = await callJSON(prompt, { scenario: "deepdive" });
  const out = [];
  for (const r of data.relations || []) {
    const nb = neighbours[(r.n || 0) - 1];
    if (nb && REL_TYPES.includes(r.type)) {
      out.push({ to: nb.id, type: r.type, confidence: typeof r.confidence === "number" ? r.confidence : null });
    }
  }
  return out;
}
