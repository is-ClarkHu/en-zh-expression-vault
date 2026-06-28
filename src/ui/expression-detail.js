// Full expression detail (SPEC v3 §2b, §6) — the content shown in the shared
// detail panel / bottom sheet when a card is selected from the grid (retrieve,
// vault, review). One place renders the whole record — surface, reading, gloss,
// intent, examples, tags, the user note, and the deep-dive log — so every view
// opens an identical, complete detail instead of a dead one-liner.

import { speakButton } from "../audio/tts.js";
import { deepDiveControl } from "./deepdive.js";
import { setNote, getExpressions, saveExpression } from "../db/index.js";
import { quickLookup } from "../ai/candidate.js";
import { openDetail } from "./detail-panel.js";
import { UI } from "./strings.js";

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function tagRow(label, tags) {
  const row = el("div", "tags");
  if (label) row.append(el("span", "tags__label", label));
  for (const t of tags) row.append(el("span", "tag", t));
  return row;
}

// The free-text note (SPEC v3 §6b). Editable; persists on change via db.setNote
// (no-op when the expr isn't saved yet — id missing). Mutates expr.note locally
// so re-opening the panel in the same session reflects the edit.
function noteEditor(expr) {
  const wrap = el("div", "detail__note");
  wrap.append(el("div", "detail__note-label", UI.noteLabel));
  const ta = el("textarea", "detail__note-input");
  ta.rows = 2;
  ta.placeholder = UI.notePlaceholder;
  ta.value = expr.note || "";
  ta.addEventListener("change", async () => {
    const v = ta.value.trim();
    expr.note = v || null;
    if (expr.id) await setNote(expr.id, v);
  });
  wrap.append(ta);
  return wrap;
}

// Relation links (SPEC v3 §10): synonym (≈) / antonym (↔) / abbreviation
// (short·full) rendered as tappable chips that NAVIGATE to the sibling card —
// never a silent redirect. The more commonly-used form is marked and shown
// first. Tapping opens the saved sibling, or looks it up (which, per the
// no-redirect rule, returns that exact surface) and offers to save it.
function abbrSide(rel, currentSurface) {
  return rel.surface.length < currentSurface.length ? "short" : "full";
}
function relMark(rel, currentSurface) {
  if (rel.type === "antonym") return "↔";
  if (rel.type === "abbreviation") return abbrSide(rel, currentSurface);
  return "≈";
}

async function navigateRelation(surface) {
  const all = await getExpressions();
  const found = all.find((e) => e.surface.toLowerCase() === surface.toLowerCase());
  if (found) {
    openDetail(expressionDetail(found), { title: found.surface });
    return;
  }
  // Not in the vault yet — look it up (no-redirect returns this surface) and
  // present it with a Save, so the link materialises the sibling card.
  const loading = el("div", "muted", `Looking up “${surface}”…`);
  openDetail(loading, { title: surface });
  try {
    const { candidates } = await quickLookup(surface);
    const cand = candidates[0];
    if (!cand) {
      loading.textContent = `No card returned for “${surface}”.`;
      return;
    }
    const body = el("div");
    body.append(expressionDetail(cand, { editableNote: false }));
    const save = el("button", "btn btn--save", "Save to vault");
    save.addEventListener("click", async () => {
      save.disabled = true;
      await saveExpression(cand);
      save.textContent = "Saved ✓";
    });
    body.append(save);
    openDetail(body, { title: surface });
  } catch (e) {
    loading.className = "error";
    loading.textContent = e?.message === "NO_KEY"
      ? "Add your provider API key in Capture to look this up."
      : `Lookup failed: ${e?.message || e}`;
  }
}

export function relationLinks(relations, currentSurface) {
  const wrap = el("div", "detail__relations");
  wrap.append(el("div", "detail__note-label", "Related"));
  const row = el("div", "rel-links");
  const sorted = [...relations].sort((a, b) => (b.common ? 1 : 0) - (a.common ? 1 : 0));
  for (const rel of sorted) {
    const chip = el("button", `rel-link rel-link--${rel.type}${rel.common ? " rel-link--common" : ""}`);
    chip.append(el("span", "rel-link__mark", relMark(rel, currentSurface)));
    chip.append(el("span", "rel-link__surface", rel.surface));
    if (rel.register) chip.append(el("span", "rel-link__reg", rel.register));
    if (rel.common) chip.append(el("span", "rel-link__common", "common"));
    chip.addEventListener("click", () => navigateRelation(rel.surface));
    row.append(chip);
  }
  wrap.append(row);
  return wrap;
}

// Build the full detail body for one expression. `editableNote` defaults on; pass
// false for transient candidates that aren't in the vault yet.
export function expressionDetail(expr, { editableNote = true } = {}) {
  const root = el("div", "detail");

  const head = el("div", "detail__head");
  head.append(el("span", "detail__surface", expr.surface));
  head.append(speakButton(expr.surface));
  if (expr.pos) head.append(el("span", "candidate__pos", expr.pos));
  if (expr.register) head.append(el("span", "candidate__register", expr.register));
  if (expr.sense_key) head.append(el("span", "candidate__sense", expr.sense_key));
  root.append(head);

  if (expr.reading) root.append(el("div", "candidate__reading", expr.reading));
  if (expr.gloss_cn) root.append(el("div", "candidate__gloss", expr.gloss_cn));
  if (expr.intent_cn) root.append(el("div", "candidate__intent", `${UI.intentPrefix}${expr.intent_cn}`));

  // Source line, then a same-structure parallel example for phrase/pattern cards.
  if (expr.example_src && expr.example_src.trim() && expr.example_src.trim() !== expr.surface)
    root.append(el("div", "candidate__example", `“${expr.example_src}”`));
  if (expr.example_parallel)
    root.append(el("div", "candidate__example", `${UI.examplePrefix}${expr.example_parallel}`));

  if (expr.topics?.length) root.append(tagRow("topics", expr.topics));
  if (expr.intents?.length) root.append(tagRow("intents", expr.intents));

  if (expr.relations?.length) root.append(relationLinks(expr.relations, expr.surface));

  if (editableNote) root.append(noteEditor(expr));

  // Deep-dive log + quick-ask buttons; persist when the card is saved.
  root.append(deepDiveControl(expr, { persist: !!expr.id }));
  return root;
}
