// Retrieve (SPEC §6.1) — the center of gravity. Slice the single vault by axis;
// nothing is partitioned (§0.4). Three axes the db already supports:
//   Intent  (headline)  pick an intent → every expression that serves it (§6.1)
//   Topic               pick a topic   → everything tagged with it
//   Register            slice by slang / casual / … register band
//
// 2D graph view (§6.1) is deferred — it needs embeddings + edges, which the AI
// layer / recluster.py produce later.

import { getExpressions, getTags, getExpressionsByTag } from "../db/index.js";
import { speakButton } from "../audio/tts.js";
import { deepDiveControl } from "../ui/deepdive.js";

const REGISTERS = ["slang", "casual", "neutral", "formal", "academic", "technical"];

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

// Read-only expression card (retrieve is browse, not capture — no Save button).
function resultCard(expr) {
  const card = el("div", "candidate");
  const head = el("div", "candidate__head");
  head.append(el("span", "candidate__surface", expr.surface));
  head.append(speakButton(expr.surface));
  if (expr.register) head.append(el("span", "candidate__register", expr.register));
  if (expr.sense_key) head.append(el("span", "candidate__sense", expr.sense_key));
  card.append(head);
  if (expr.reading) card.append(el("div", "candidate__reading", expr.reading));
  if (expr.gloss_cn) card.append(el("div", "candidate__gloss", expr.gloss_cn));
  if (expr.intent_cn) card.append(el("div", "candidate__intent", `意图：${expr.intent_cn}`));
  if (expr.topics?.length) card.append(tagRow("topics", expr.topics));
  if (expr.intents?.length) card.append(tagRow("intents", expr.intents));
  card.append(deepDiveControl(expr, { persist: true }));
  return card;
}

export async function mountRetrieve(root) {
  root.innerHTML = "";
  root.append(el("p", "muted", "Browse the vault by intent, topic, or register. Pick a chip to pull the material."));

  const axisBar = el("div", "axis-bar");
  const chips = el("div", "chips");
  const results = el("div", "results");
  root.append(axisBar, chips, results);

  const AXES = [
    { id: "intent", label: "By intent" },
    { id: "topic", label: "By topic" },
    { id: "register", label: "By register" },
  ];
  let active = "intent";

  function setResults(nodes, emptyMsg) {
    results.innerHTML = "";
    if (!nodes.length) {
      results.append(el("p", "muted", emptyMsg));
      return;
    }
    for (const n of nodes) results.append(n);
  }

  function show(expressions, label) {
    results.innerHTML = "";
    results.append(el("div", "results__head", `${label} — ${expressions.length}`));
    for (const e of expressions) results.append(resultCard(e));
  }

  // Render the chip row for the active axis, wiring each chip to its slice.
  async function renderChips() {
    chips.innerHTML = "";
    results.innerHTML = "";

    if (active === "register") {
      const all = await getExpressions();
      const counts = Object.fromEntries(REGISTERS.map((r) => [r, 0]));
      for (const e of all) if (e.register in counts) counts[e.register]++;
      const present = REGISTERS.filter((r) => counts[r] > 0);
      if (!present.length) return void setResults([], "Nothing saved yet.");
      for (const reg of present) {
        const chip = chipButton(`${reg} (${counts[reg]})`, async () => {
          await show(all.filter((e) => e.register === reg), reg);
        });
        chips.append(chip);
      }
      return;
    }

    // intent / topic — driven by the live tag index
    const tags = (await getTags(active)).sort((a, b) => b.member_ids.length - a.member_ids.length);
    if (!tags.length) {
      return void setResults([], `No ${active} tags yet — save some expressions first.`);
    }
    for (const tag of tags) {
      const chip = chipButton(`${tag.name} (${tag.member_ids.length})`, async () => {
        const rows = await getExpressionsByTag(active, tag.name);
        await show(rows, tag.name);
      });
      chips.append(chip);
    }
  }

  function chipButton(label, onClick) {
    const b = el("button", "chip", label);
    b.addEventListener("click", () => {
      for (const c of chips.children) c.classList.toggle("chip--on", c === b);
      onClick();
    });
    return b;
  }

  for (const a of AXES) {
    const b = el("button", "axis-tab", a.label);
    if (a.id === active) b.classList.add("axis-tab--on");
    b.addEventListener("click", () => {
      active = a.id;
      for (const t of axisBar.children) t.classList.toggle("axis-tab--on", t === b);
      renderChips();
    });
    axisBar.append(b);
  }

  renderChips();
}
