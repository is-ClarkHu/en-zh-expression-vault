// One-click global reassign (SPEC v2 §8) — the headline of 2.0. Live tags are a
// provisional draft (§7); this re-derives the AUTHORITATIVE grouping over the
// whole vault at once: per axis it embeds every word, clusters by similarity
// (create / merge / split / keep, data-driven count, singletons allowed), maps
// the result back onto the old tags for stable naming, and previews every change
// before a single write. Apply is one transaction; re-running on unchanged data
// is a no-op (idempotent).
//
// Compute lives in the browser off the stored per-word embeddings; the only
// network is the embedding API (for words missing a vector) + auto-naming.

import { getExpressions, getTags, setEmbedding, applyReassign } from "../db/index.js";
import { embedTexts, callText, callJSON } from "../ai/provider.js";
import { getSettings, setSetting } from "../ai/settings.js";
import { planAxis } from "./cluster.js";

const AXES = [
  ["topic", "topics"],
  ["intent", "intents"],
];
// Conservative default for OpenAI text-embedding-3-small (same-topic ≈ 0.5,
// near-duplicate ≈ 0.73): merges genuine synonyms, leaves the rest as singletons.
export const DEFAULT_THRESHOLD = 0.58;

const wordText = (e) => `${e.surface}${e.gloss_cn ? " — " + e.gloss_cn : ""}`;
const hasVec = (e) => Array.isArray(e.embedding) && e.embedding.length > 0;
const hasTag = (e, field) => Array.isArray(e[field]) && e[field].length > 0;

const kebab = (s) =>
  (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "group";
const uniqueName = (name, used) => {
  let n = name, i = 2;
  while (used.has(n)) n = `${name}-${i++}`;
  return n;
};

// Words saved since the last reassign — the "backlog" the UI surfaces.
export async function wordsAddedSince() {
  const since = getSettings().lastReassignedAt || 0;
  const rows = await getExpressions();
  // Proper nouns don't participate in reassign (v4 §1b), so they don't count
  // toward the "words added since" backlog nudge.
  return rows.filter((e) => e.kind !== "proper_noun" && (e.created_at || 0) > since).length;
}

// Compute + store embeddings for any words in `list` missing one. Mutates the
// passed objects in place (sets .embedding) so the caller can use them straight
// away. Returns count embedded. Shared by reassign (whole vault) and the graph
// (just the selected range).
export async function ensureEmbeddingsFor(list, onStatus) {
  const missing = list.filter((e) => !hasVec(e));
  if (!missing.length) return 0;
  onStatus?.(`Embedding ${missing.length} word(s)…`);
  const vecs = await embedTexts(missing.map(wordText));
  let n = 0;
  for (let i = 0; i < missing.length; i++) {
    if (Array.isArray(vecs[i]) && vecs[i].length) {
      await setEmbedding(missing[i].id, vecs[i]);
      missing[i].embedding = vecs[i];
      n++;
    }
  }
  return n;
}

// Embed one freshly-saved word (SPEC v2 §11: one short request per save, the
// vector is never recomputed). Best-effort — a missing key / CORS just defers it
// to the next reassign or graph generate, which fill embeddings on demand.
export async function embedExpression(expr) {
  if (expr.kind === "proper_noun") return; // names aren't clustered (v4 §1b) — no vector
  try {
    const [vec] = await embedTexts([wordText(expr)]);
    if (Array.isArray(vec) && vec.length) await setEmbedding(expr.id, vec);
  } catch {
    /* deferred */
  }
}

// LLM auto-name for a new/split class; falls back to a kebab of a member so a
// failed/blocked naming call never blocks the reassign.
async function autoName(axis, surfaces, onStatus) {
  const sample = surfaces.slice(0, 8).join(", ");
  const example = axis === "intent" ? "describe-strong" : "hair-transplant";
  onStatus?.(`Naming a ${axis} group…`);
  try {
    const txt = await callText(
      `These English expressions share one ${axis} group: ${sample}.\nGive one short lowercase-kebab-case ${axis} tag for the group (e.g. "${example}"). Reply with ONLY the tag.`,
      { maxTokens: 24, scenario: "reassign" },
    );
    const name = (txt || "").trim().toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().split(/\s+/)[0];
    if (name) return name;
  } catch {
    /* naming is best-effort */
  }
  return kebab(surfaces[0] || axis);
}

const tagId = (axis, name) => `${axis}:${name}`;
function provenance(axis, c) {
  const base = { name: c.name, members: c.members, prev_tag_id: null, merged_from: null, split_from: null };
  if (c.status === "kept") return { ...base, prev_tag_id: tagId(axis, c.from[0]) };
  if (c.status === "merged")
    return { ...base, prev_tag_id: tagId(axis, c.from[0]), merged_from: c.from.map((n) => tagId(axis, n)) };
  if (c.status === "split")
    return { ...base, prev_tag_id: tagId(axis, c.from[0]), split_from: tagId(axis, c.from[0]) };
  return base; // new
}

// LLM-driven grouping (v3): instead of embedding-cosine connected-components
// (which only merges near-duplicates), the AI reads the whole axis at once — each
// word with its Chinese gloss and current tag — and returns a clean taxonomy,
// assigning EVERY word to one group. This groups thematically the way a person
// would (hairline / hair transplant / hairwork → "hair"; biceps / calves /
// triceps → "muscles"), which the cosine threshold could never reach. Returns
// clusters (id arrays) + a parallel array of the AI's group names.
async function groupByLLM(axis, members, field, onStatus) {
  const list = members
    .map((e, i) => `${i + 1}. ${e.surface}${e.gloss_cn ? ` (${e.gloss_cn})` : ""}${e[field]?.length ? ` [now: ${e[field].join(", ")}]` : ""}`)
    .join("\n");
  const guidance = axis === "topic"
    ? `Group by BROAD SUBJECT AREA. Prefer FEWER, LARGER groups over many fine ones. Put every word sharing a main theme or head-noun in ONE group, even when their exact function differs:
- "hairline", "hair transplant", "hairwork", "plugs" all concern HAIR → one "hair" group (do NOT split off "cosmetic-procedures").
- every muscle name ("biceps","calves","triceps","quadriceps","hamstrings","deltoids","pecs") → one "muscles" group (do NOT split "leg-muscles" vs others).
Never split a single theme into sub-functions. A word stands alone ONLY if it truly shares a theme with nothing else.`
    : `Group by COMMUNICATIVE INTENT — what the speaker is doing (e.g. describe-strong, name-body-part, give-instruction, end-activity). Prefer fewer, broader intents; merge near-duplicates.`;
  onStatus?.(`Grouping ${members.length} word(s) by ${axis}…`);

  const prompt = `Organize a Chinese learner's English vocabulary by ${axis}. ${guidance}

Assign EVERY item below to exactly one ${axis} group. Reuse a current tag name when it still fits; MERGE clearly-related or near-duplicate tags into one well-named group. Group names: short lowercase-kebab-case. Bias toward MERGING related words rather than creating new narrow groups.

Items:
${list}

Return ONLY JSON: { "assignments": [ { "n": <item number>, "group": "<kebab-name>" } ] } — exactly one entry per item.`;

  const data = await callJSON(prompt, { scenario: "reassign", maxTokens: Math.min(8000, 500 + members.length * 25) });
  const groups = new Map(); // name -> [ids]
  for (const a of data.assignments || []) {
    const e = members[(a.n || 0) - 1];
    const name = kebab(a.group);
    if (!e || !name) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(e.id);
  }
  // Any item the AI skipped becomes its own group (keep its current tag, else a
  // kebab of the surface) so nothing is silently dropped.
  const assigned = new Set([...groups.values()].flat());
  for (const e of members) {
    if (assigned.has(e.id)) continue;
    const name = kebab(e[field]?.[0] || e.surface);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(e.id);
  }
  return { clusters: [...groups.values()], names: [...groups.keys()] };
}

// Build the full reassign preview + an apply-ready plan, without writing anything.
// Grouping is LLM-driven (no embeddings needed); the kept/merged/split/new diff,
// provenance, moves, and preview are reused from the embedding path.
export async function buildReassignPlan({ onStatus } = {}) {
  const all = await getExpressions();
  const surf = (id) => all.find((e) => e.id === id)?.surface || id;

  const preview = { axes: {} };
  const applyPlan = {};

  for (const [axis, field] of AXES) {
    const oldTags = await getTags(axis);
    const members = all.filter((e) => hasTag(e, field));
    if (!members.length) {
      preview.axes[axis] = { oldCount: oldTags.length, newCount: 0, changed: 0, moves: [], classes: [] };
      applyPlan[axis] = [];
      continue;
    }

    const { clusters, names } = await groupByLLM(axis, members, field, onStatus);
    const plan = planAxis(clusters, oldTags.map((t) => ({ name: t.name, member_ids: t.member_ids })));

    // Use the AI's name for restructured groups; keep the old name for groups that
    // are unchanged (status "kept"), so stable tags don't churn needlessly.
    const used = new Set();
    const classes = plan.map((cls, i) => {
      const proposed = cls.status === "kept" ? cls.name : (names[i] || cls.name || kebab(surf(cls.members[0])));
      const name = uniqueName(proposed, used);
      used.add(name);
      return { ...cls, name };
    });
    applyPlan[axis] = classes.map((c) => provenance(axis, c));

    // Word moves: any word whose authoritative class differs from its old tag(s).
    const oldOf = new Map();
    for (const t of oldTags) for (const id of t.member_ids) oldOf.set(id, [...(oldOf.get(id) || []), t.name]);
    const moves = [];
    for (const c of classes)
      for (const id of c.members) {
        const from = oldOf.get(id) || [];
        if (!(from.length === 1 && from[0] === c.name)) moves.push({ surface: surf(id), from, to: c.name });
      }

    preview.axes[axis] = {
      oldCount: oldTags.length,
      newCount: classes.length,
      changed: classes.filter((c) => c.status !== "kept").length,
      moves,
      classes: classes.map((c) => ({ name: c.name, status: c.status, from: c.from, members: c.members.map(surf) })),
    };
  }
  return { preview, applyPlan };
}

// Commit a previously-built plan and stamp the reassign time.
export async function applyReassignPlan(applyPlan) {
  await applyReassign(applyPlan);
  setSetting("lastReassignedAt", Date.now());
}
