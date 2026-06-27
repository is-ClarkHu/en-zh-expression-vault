// Retrieve (SPEC §6.1, v3 §2d) — the center of gravity, now a two-axis
// master-detail BROWSER (replacing the flat dropdown / chip cloud):
//   axis   pick topic / intent / register   (the two-axis space)
//     └ tag list   that axis's tags, with counts                (jp's "class")
//         └ card grid   the expressions under the picked tag      (jp's "list")
// Picking a card opens the shared detail panel (§2b). Reading on/off + shuffle
// are study affordances ported from jp (§2d). Whatever range is picked here is
// written to the shared range model (range.js), the same one the graph reads.

import { getExpressions, getTags } from "../db/index.js";
import { speakButton } from "../audio/tts.js";
import { openDetail, closeDetail, isDetailOpen } from "../ui/detail-panel.js";
import { expressionDetail } from "../ui/expression-detail.js";
import { setRange, rangeExpressions } from "./range.js";
import { UI } from "../ui/strings.js";

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
function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function mountRetrieve(root) {
  root.innerHTML = "";
  root.append(el("p", "muted", "Browse by axis → tag → card. Pick a tag to pull its expressions; tap a card for the full detail."));

  let activeAxis = "intent";
  let activeTag = null; // { axis, name } | { register } | null
  let showReading = false;
  let shuffled = false;
  let selectedEl = null;

  // --- layout: side (axis tabs + tag list) | main (toolbar + card grid) ---
  const browser = el("div", "browser");
  const side = el("aside", "browser__side");
  const axisBar = el("div", "axis-bar");
  const tagList = el("div", "browser__tags");
  side.append(axisBar, tagList);

  const main = el("section", "browser__main");
  const toolbar = el("div", "browser__toolbar");
  const head = el("div", "results__head");
  const spacer = el("div");
  spacer.style.flex = "1";
  const shuffleBtn = el("button", "btn btn--ghost", "Shuffle");
  const readingBtn = el("button", "btn btn--ghost", "Reading: off");
  toolbar.append(head, spacer, shuffleBtn, readingBtn);
  const grid = el("div", "card-grid");
  main.append(toolbar, grid);

  browser.append(side, main);
  root.append(browser);

  const AXES = [
    { id: "intent", label: "By intent" },
    { id: "topic", label: "By topic" },
    { id: "register", label: "By register" },
  ];

  // A read-only expression card for the grid; clicking opens the detail panel.
  function gridCard(expr) {
    const card = el("div", "grid-card");
    const h = el("div", "candidate__head");
    h.append(el("span", "candidate__surface", expr.surface));
    h.append(speakButton(expr.surface));
    if (expr.register) h.append(el("span", "candidate__register", expr.register));
    card.append(h);
    if (showReading && expr.reading) card.append(el("div", "candidate__reading", expr.reading));
    if (expr.gloss_cn) card.append(el("div", "candidate__gloss", expr.gloss_cn));
    if (expr.intent_cn) card.append(el("div", "candidate__intent", `${UI.intentPrefix}${expr.intent_cn}`));
    if (expr.intents?.length) card.append(tagRow(null, expr.intents));
    card.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      selectedEl?.classList.remove("grid-card--on");
      selectedEl = card;
      card.classList.add("grid-card--on");
      openDetail(expressionDetail(expr), {
        title: expr.surface,
        onClose: () => { selectedEl?.classList.remove("grid-card--on"); selectedEl = null; },
      });
    });
    return card;
  }

  async function renderGrid() {
    head.textContent = "";
    grid.innerHTML = "";
    if (!activeTag) {
      grid.append(el("p", "muted", "Pick a tag on the left to see its expressions."));
      return;
    }
    let rows = await rangeExpressions();
    if (shuffled) rows = shuffle(rows);
    const label = activeTag.register || activeTag.name;
    head.textContent = `${label} — ${rows.length}`;
    if (!rows.length) {
      grid.append(el("p", "muted", "Nothing here."));
      return;
    }
    for (const r of rows) grid.append(gridCard(r));
  }

  function selectTag(btn, range, tagState) {
    for (const b of tagList.children) b.classList.toggle("browser__tag--on", b === btn);
    activeTag = tagState;
    setRange(range); // feed the shared range model (graph reads the same)
    if (isDetailOpen()) closeDetail();
    selectedEl = null;
    renderGrid();
  }

  async function renderTags() {
    tagList.innerHTML = "";
    activeTag = null;
    grid.innerHTML = "";
    head.textContent = "";

    if (activeAxis === "register") {
      const all = await getExpressions();
      const counts = Object.fromEntries(REGISTERS.map((r) => [r, 0]));
      for (const e of all) if (e.register in counts) counts[e.register]++;
      const present = REGISTERS.filter((r) => counts[r] > 0);
      if (!present.length) return void grid.append(el("p", "muted", "Nothing saved yet."));
      present.forEach((reg, i) => {
        const b = tagButton(reg, counts[reg]);
        b.addEventListener("click", () => selectTag(b, { kind: "register", name: reg }, { register: reg }));
        tagList.append(b);
        if (i === 0) b.click(); // auto-open the first so the grid is never empty
      });
      return;
    }

    const tags = (await getTags(activeAxis)).sort((a, b) => b.member_ids.length - a.member_ids.length);
    if (!tags.length) {
      return void grid.append(el("p", "muted", `No ${activeAxis} tags yet — save some expressions first.`));
    }
    tags.forEach((tag, i) => {
      const b = tagButton(tag.name, tag.member_ids.length);
      b.addEventListener("click", () => selectTag(b, { kind: "tag", axis: activeAxis, name: tag.name }, { axis: activeAxis, name: tag.name }));
      tagList.append(b);
      if (i === 0) b.click();
    });
  }

  function tagButton(name, count) {
    const b = el("button", "browser__tag");
    b.append(el("span", "browser__tag-name", name));
    b.append(el("span", "browser__tag-count", String(count)));
    return b;
  }

  for (const a of AXES) {
    const b = el("button", "axis-tab", a.label);
    if (a.id === activeAxis) b.classList.add("axis-tab--on");
    b.addEventListener("click", () => {
      activeAxis = a.id;
      for (const t of axisBar.children) t.classList.toggle("axis-tab--on", t === b);
      renderTags();
    });
    axisBar.append(b);
  }

  shuffleBtn.addEventListener("click", () => {
    shuffled = !shuffled;
    shuffleBtn.classList.toggle("btn--active", shuffled);
    renderGrid();
  });
  readingBtn.addEventListener("click", () => {
    showReading = !showReading;
    readingBtn.textContent = showReading ? "Reading: on" : "Reading: off";
    readingBtn.classList.toggle("btn--active", showReading);
    renderGrid();
  });

  renderTags();
}
