// Timeline (v5 §1) — a vertical, day-by-day journal of what entered the vault,
// answering "what did I pick up, and when" better than the Dashboard's flat
// 7-day bar. A left spine with a dot per day; each day node summarises the
// categories touched (intent / topic tags) + a word preview BEFORE you expand,
// so the timeline reads as a story rather than a raw word table. Expanding a day
// reveals that day's cards inline; tapping a card opens the shared detail panel
// (note / view / delete), reusing expression-detail.js and detail-panel.js so
// there's one place that renders a full card and one place that deletes.

import { getExpressions, deleteExpression } from "../db/index.js";
import { speakButton } from "../audio/tts.js";
import { schedulePush } from "../sync/dropbox.js";
import { openDetail, closeDetail } from "../ui/detail-panel.js";
import { expressionDetail } from "../ui/expression-detail.js";
import { UI } from "../ui/strings.js";

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

// Local calendar-day key (not UTC) so "today" matches the user's clock, and the
// label for that key. Grouping on the local day means a word saved at 11pm and
// one saved at 1am the next morning land on different days, as expected.
function dayStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d;
}
function dayKey(ts) {
  const d = dayStart(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function dayLabel(ts) {
  const start = dayStart(ts).getTime();
  const todayStart = dayStart(Date.now()).getTime();
  const diffDays = Math.round((todayStart - start) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  const d = new Date(start);
  const opts = { month: "short", day: "numeric", weekday: "short" };
  // Include the year only when it isn't the current one.
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-US", opts);
}

// Count-ranked unique tag names across a day's expressions (most-used first), so
// the day summary leads with the categories the day was really about.
function rankTags(rows, field) {
  const counts = new Map();
  for (const e of rows) for (const t of e[field] || []) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

// A labelled chip row that caps at `max` names and folds the rest into a "+N"
// chip, so a busy day doesn't spill a wall of tags.
function chipRow(label, names, max = 6) {
  const row = el("div", "tags");
  row.append(el("span", "tags__label", label));
  for (const n of names.slice(0, max)) row.append(el("span", "tag", n));
  if (names.length > max) row.append(el("span", "tag tl-chip--more", `+${names.length - max}`));
  return row;
}

export async function mountTimeline(root) {
  root.innerHTML = "";
  root.append(el("p", "muted", "Your vault as a journal — each day you added words, and what they were about. Tap a day to see its cards."));

  const expanded = new Set(); // dayKeys currently open — preserved across re-render

  const spine = el("div", "timeline");
  root.append(spine);

  // A read-only card for a day's grid; clicking opens the shared detail panel.
  function dayCard(expr, onChange) {
    const card = el("div", "grid-card");
    const h = el("div", "candidate__head");
    h.append(el("span", "candidate__surface", expr.surface));
    h.append(speakButton(expr.surface));
    if (expr.register) h.append(el("span", "candidate__register", expr.register));
    card.append(h);
    if (expr.gloss_cn) card.append(el("div", "candidate__gloss", expr.gloss_cn));
    if (expr.intent_cn) card.append(el("div", "candidate__intent", `${UI.intentPrefix}${expr.intent_cn}`));
    if (expr.intents?.length) {
      const t = el("div", "tags");
      for (const n of expr.intents) t.append(el("span", "tag", n));
      card.append(t);
    }
    card.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      openCardDetail(expr, onChange);
    });
    return card;
  }

  // Detail panel with a Delete action — same contract as Retrieve (v3 §6): one
  // detail component, delete wired per-view so the host can refresh its counts.
  function openCardDetail(expr, onChange) {
    const body = el("div");
    body.append(expressionDetail(expr));
    const del = el("button", "btn btn--ghost", "Delete");
    del.style.marginTop = "var(--s4)";
    del.addEventListener("click", async () => {
      await deleteExpression(expr.id);
      schedulePush();
      closeDetail();
      onChange();
    });
    body.append(del);
    openDetail(body, { title: expr.surface });
  }

  async function render() {
    const all = await getExpressions(); // newest-first by created_at
    spine.innerHTML = "";

    if (!all.length) {
      spine.append(el("p", "muted", "Empty vault — capture and save a few expressions to start your timeline."));
      return;
    }

    // Group into ordered days (newest first). getExpressions already sorts desc,
    // so days come out newest-first and each day's rows stay newest-first.
    const order = [];
    const byDay = new Map();
    for (const e of all) {
      const k = dayKey(e.created_at);
      if (!byDay.has(k)) { byDay.set(k, []); order.push(k); }
      byDay.get(k).push(e);
    }

    for (const k of order) {
      const rows = byDay.get(k);
      const isOpen = expanded.has(k);

      const node = el("div", `tl-node${isOpen ? " tl-node--open" : ""}`);
      const dot = el("div", "tl-node__dot");
      node.append(dot);

      const content = el("div", "tl-node__content");

      // Clickable header: date + count, and the category summary + preview.
      const header = el("button", "tl-node__header");
      header.setAttribute("aria-expanded", String(isOpen));
      const top = el("div", "tl-node__top");
      top.append(el("span", "tl-node__date", dayLabel(rows[0].created_at)));
      top.append(el("span", "tl-node__count", `${rows.length} ${rows.length === 1 ? "word" : "words"}`));
      const chev = el("span", "tl-node__chev");
      chev.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';
      top.append(chev);
      header.append(top);

      const intents = rankTags(rows, "intents");
      const topics = rankTags(rows, "topics");
      if (intents.length) header.append(chipRow("intents", intents));
      if (topics.length) header.append(chipRow("topics", topics));

      // Word preview — the first few surfaces, so the day has a face before it's
      // opened. Hidden once the full grid is showing (it'd be redundant).
      if (!isOpen) {
        const preview = el("div", "tl-node__preview");
        const shown = rows.slice(0, 4);
        preview.append(el("span", "tl-node__preview-words", shown.map((e) => e.surface).join(" · ")));
        if (rows.length > shown.length) preview.append(el("span", "muted", ` +${rows.length - shown.length}`));
        header.append(preview);
      }

      header.addEventListener("click", () => {
        if (expanded.has(k)) expanded.delete(k);
        else expanded.add(k);
        render();
      });
      content.append(header);

      // Expanded: that day's cards inline.
      if (isOpen) {
        const grid = el("div", "card-grid tl-node__grid");
        for (const r of rows) grid.append(dayCard(r, render));
        content.append(grid);
      }

      node.append(content);
      spine.append(node);
    }
  }

  render();
}
