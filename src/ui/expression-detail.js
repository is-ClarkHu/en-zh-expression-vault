// Full expression detail (SPEC v3 §2b, §6) — the content shown in the shared
// detail panel / bottom sheet when a card is selected from the grid (retrieve,
// vault, review). One place renders the whole record — surface, reading, gloss,
// intent, examples, tags, the user note, and the deep-dive log — so every view
// opens an identical, complete detail instead of a dead one-liner.

import { speakButton } from "../audio/tts.js";
import { deepDiveControl } from "./deepdive.js";
import { setNote } from "../db/index.js";
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

  if (editableNote) root.append(noteEditor(expr));

  // Deep-dive log + quick-ask buttons; persist when the card is saved.
  root.append(deepDiveControl(expr, { persist: !!expr.id }));
  return root;
}
