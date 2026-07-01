// Retrieve (SPEC §6.1, v3 §2d) — the center of gravity, a two-axis master-detail
// BROWSER plus a free-text search:
//   search   type to find expressions across the whole vault (surface/gloss/tags)
//   axis     pick topic / intent / register   (the two-axis space)
//     └ tag list   that axis's tags (alphabetical), with counts   (jp's "class")
//         └ card grid   the expressions under the picked tag        (jp's "list")
// Picking a card opens the shared detail panel (§2b), with Delete. Reading on/off
// + shuffle are study affordances (§2d). The picked range feeds range.js (graph).

import { getExpressions, getTags, deleteExpression } from "../db/index.js";
import { speakButton } from "../audio/tts.js";
import { schedulePush } from "../sync/dropbox.js";
import { openDetail, closeDetail, isDetailOpen } from "../ui/detail-panel.js";
import { expressionDetail } from "../ui/expression-detail.js";
import { setRange, rangeExpressions } from "./range.js";
import { UI } from "../ui/strings.js";

const REGISTERS = ["slang", "casual", "neutral", "formal", "academic", "technical"];
// Scene/corpus soft-labels (D-19) — a non-tag filter axis, like register.
const CORPORA = ["life", "toefl", "gaokao", "cs", "interview"];

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
  root.append(el("p", "muted", "Search, or browse by axis → tag → card. Tap a card for the full detail."));

  let activeAxis = "intent";
  let activeTag = null; // { axis, name } | { register } | null
  let activeBtn = null;
  let searchTerm = "";
  let showReading = false;
  let shuffled = false;
  let selectedEl = null;

  // --- search box -----------------------------------------------------------
  const searchBar = el("div", "retrieve__search");
  const search = el("input");
  search.type = "search";
  search.placeholder = "Search expressions — word, gloss, or tag";
  searchBar.append(search);
  root.append(searchBar);

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
    { id: "corpus", label: "By corpus" },
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
      openCardDetail(expr);
    });
    return card;
  }

  // Detail panel with a Delete action (v3 §6 — retrieve gets delete too).
  function openCardDetail(expr) {
    const body = el("div");
    body.append(expressionDetail(expr));
    const del = el("button", "btn btn--ghost", "Delete");
    del.style.marginTop = "var(--s4)";
    del.addEventListener("click", async () => {
      await deleteExpression(expr.id);
      schedulePush();
      closeDetail();
      refresh(); // counts + grid both change after a delete
    });
    body.append(del);
    openDetail(body, {
      title: expr.surface,
      onClose: () => { selectedEl?.classList.remove("grid-card--on"); selectedEl = null; },
    });
  }

  async function renderGrid() {
    head.textContent = "";
    grid.innerHTML = "";
    let rows, label;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      rows = (await getExpressions()).filter((e) =>
        e.surface.toLowerCase().includes(q) ||
        (e.gloss_cn || "").toLowerCase().includes(q) ||
        (e.intent_cn || "").toLowerCase().includes(q) ||
        (e.topics || []).some((t) => t.toLowerCase().includes(q)) ||
        (e.intents || []).some((t) => t.toLowerCase().includes(q)));
      label = `Search “${searchTerm}”`;
    } else if (activeTag) {
      rows = await rangeExpressions();
      label = activeTag.register || activeTag.corpus || activeTag.name;
    } else {
      grid.append(el("p", "muted", "Pick a tag on the left to see its expressions."));
      return;
    }
    if (shuffled) rows = shuffle(rows);
    head.textContent = `${label} — ${rows.length}`;
    if (!rows.length) {
      grid.append(el("p", "muted", searchTerm ? "No matches." : "Nothing here."));
      return;
    }
    for (const r of rows) grid.append(gridCard(r));
  }

  function selectTag(btn, range, tagState) {
    activeBtn = btn;
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
    activeBtn = null;
    grid.innerHTML = "";
    head.textContent = "";

    if (activeAxis === "register") {
      const all = await getExpressions();
      const counts = Object.fromEntries(REGISTERS.map((r) => [r, 0]));
      for (const e of all) if (e.register in counts) counts[e.register]++;
      const present = REGISTERS.filter((r) => counts[r] > 0); // keep the band order
      if (!present.length) return void grid.append(el("p", "muted", "Nothing saved yet."));
      present.forEach((reg, i) => {
        const b = tagButton(reg, counts[reg]);
        b.addEventListener("click", () => selectTag(b, { kind: "register", name: reg }, { register: reg }));
        tagList.append(b);
        if (i === 0 && !searchTerm) b.click();
      });
      return;
    }

    if (activeAxis === "corpus") { // scene axis (D-19) — same shape as register
      const all = await getExpressions();
      const counts = Object.fromEntries(CORPORA.map((c) => [c, 0]));
      for (const e of all) if (e.corpus in counts) counts[e.corpus]++;
      const present = CORPORA.filter((c) => counts[c] > 0); // keep the defined order
      if (!present.length)
        return void grid.append(el("p", "muted", "No corpus/scene labels yet — save some expressions first."));
      present.forEach((c, i) => {
        const b = tagButton(c, counts[c]);
        b.addEventListener("click", () => selectTag(b, { kind: "corpus", name: c }, { corpus: c }));
        tagList.append(b);
        if (i === 0 && !searchTerm) b.click();
      });
      return;
    }

    // intent / topic — alphabetical (v3 feedback: stable, scannable order)
    const tags = (await getTags(activeAxis)).sort((a, b) => a.name.localeCompare(b.name));
    if (!tags.length) {
      return void grid.append(el("p", "muted", `No ${activeAxis} tags yet — save some expressions first.`));
    }
    tags.forEach((tag, i) => {
      const b = tagButton(tag.name, tag.member_ids.length);
      b.addEventListener("click", () => selectTag(b, { kind: "tag", axis: activeAxis, name: tag.name }, { axis: activeAxis, name: tag.name }));
      tagList.append(b);
      if (i === 0 && !searchTerm) b.click();
    });
  }

  function tagButton(name, count) {
    const b = el("button", "browser__tag");
    b.append(el("span", "browser__tag-name", name));
    b.append(el("span", "browser__tag-count", String(count)));
    return b;
  }

  // Re-render the active view after a mutation (delete): rebuild the tag counts,
  // or re-run the search.
  function refresh() {
    if (searchTerm) renderGrid();
    else renderTags();
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

  search.addEventListener("input", () => {
    searchTerm = search.value.trim();
    if (searchTerm) {
      for (const b of tagList.children) b.classList.remove("browser__tag--on");
      renderGrid();
    } else if (activeBtn) {
      activeBtn.classList.add("browser__tag--on"); // restore the browsed tag
      renderGrid();
    } else {
      renderTags();
    }
  });

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
