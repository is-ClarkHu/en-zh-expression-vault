// Dashboard (SPEC §6.3) — the shape of the vault at a glance: topic / intent /
// register distribution, tag counts per axis, edge count, and recent growth.
// Pure reads over the db; doubles as a sanity check that capture → live tagging
// is producing a healthy organization layer. (All config now lives in Settings.)

import { getExpressions, getTags, getEdges } from "../db/index.js";

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function statCard(label, value) {
  const c = el("div", "stat");
  c.append(el("div", "stat__value", String(value)));
  c.append(el("div", "stat__label", label));
  return c;
}

// A labelled horizontal bar list: [{ name, count }], scaled to the max count.
function barList(rows, emptyMsg) {
  const wrap = el("div", "bars");
  if (!rows.length) {
    wrap.append(el("p", "muted", emptyMsg));
    return wrap;
  }
  const max = Math.max(...rows.map((r) => r.count)) || 1;
  for (const r of rows) {
    const row = el("div", "bar");
    row.append(el("span", "bar__name", r.name));
    const track = el("div", "bar__track");
    const fill = el("div", "bar__fill");
    fill.style.width = `${Math.round((r.count / max) * 100)}%`;
    track.append(fill);
    row.append(track);
    row.append(el("span", "bar__count", String(r.count)));
    wrap.append(row);
  }
  return wrap;
}

function section(title, node) {
  const s = el("section", "dash__section");
  s.append(el("h2", null, title));
  s.append(node);
  return s;
}

const PALETTE = ["#365fae", "#3a8a8a", "#9a6a2f", "#5a7a3a", "#7a4a6a", "#9a5a3a"];

// One horizontal bar split into proportional, colour-coded segments + a legend —
// for a composition (register mix, kind mix) rather than a ranking.
function stackedBar(rows, emptyMsg) {
  const present = rows.filter((r) => r.count > 0);
  const total = present.reduce((s, r) => s + r.count, 0);
  const wrap = el("div");
  if (!total) {
    wrap.append(el("p", "muted", emptyMsg));
    return wrap;
  }
  const bar = el("div", "stacked");
  const legend = el("div", "dash__legend");
  present.forEach((r, i) => {
    const seg = el("div", "stacked__seg");
    seg.style.width = `${(r.count / total) * 100}%`;
    seg.style.background = PALETTE[i % PALETTE.length];
    seg.title = `${r.name}: ${r.count}`;
    bar.append(seg);
    const item = el("span", "dash__legend-item");
    const sw = el("span", "dash__swatch");
    sw.style.background = PALETTE[i % PALETTE.length];
    item.append(sw, document.createTextNode(`${r.name} · ${r.count}`));
    legend.append(item);
  });
  wrap.append(bar, legend);
  return wrap;
}

// Bucket tag member-counts so the spread (singletons vs. fuller tags) is visible
// — the health signal behind the relatedness work (singletons are fine; what
// matters is whether tags fill out).
function tagSizeBuckets(tags) {
  const buckets = [
    { name: "1 (singleton)", lo: 1, hi: 1 },
    { name: "2–3", lo: 2, hi: 3 },
    { name: "4–6", lo: 4, hi: 6 },
    { name: "7+", lo: 7, hi: Infinity },
  ];
  return buckets.map((b) => ({
    name: b.name,
    count: tags.filter((t) => t.member_ids.length >= b.lo && t.member_ids.length <= b.hi).length,
  }));
}

const REGISTERS = ["slang", "casual", "neutral", "formal", "academic", "technical"];
const KINDS = ["word", "phrase", "pattern"];
const hasVec = (e) => Array.isArray(e.embedding) && e.embedding.length > 0;

export async function mountDashboard(root) {
  root.innerHTML = "";
  root.append(el("p", "muted", "The shape of your vault — distributions, tag counts, growth."));

  const [expressions, topicTags, intentTags, edges] = await Promise.all([
    getExpressions(),
    getTags("topic"),
    getTags("intent"),
    getEdges(),
  ]);

  if (!expressions.length) {
    root.append(el("p", "muted", "Empty vault — capture and save a few expressions first."));
    return;
  }

  // Stat cards (auto-fit grid, so the count can flex)
  const embedded = expressions.filter(hasVec).length;
  const stats = el("div", "stats");
  stats.append(statCard("Expressions", expressions.length));
  stats.append(statCard("Embedded", `${embedded}/${expressions.length}`));
  stats.append(statCard("Topics", topicTags.length));
  stats.append(statCard("Intents", intentTags.length));
  stats.append(statCard("Edges", edges.length));
  root.append(stats);

  // Register mix + kind mix — compositions, as proportional stacked bars
  const regCounts = REGISTERS.map((name) => ({ name, count: expressions.filter((e) => e.register === name).length }));
  root.append(section("Register mix", stackedBar(regCounts, "No register data.")));

  const kindCounts = KINDS.map((name) => ({ name, count: expressions.filter((e) => (e.kind || "word") === name).length }));
  root.append(section("Kind", stackedBar(kindCounts, "No data.")));

  // Top topics / intents by membership
  const topBy = (tags) =>
    tags
      .map((t) => ({ name: t.name, count: t.member_ids.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  root.append(section("Top topics", barList(topBy(topicTags), "No topic tags yet.")));
  root.append(section("Top intents", barList(topBy(intentTags), "No intent tags yet.")));

  // Tag-size spread (singletons vs fuller tags) per axis
  const tagSize = el("div");
  tagSize.append(el("h3", "dash__subhead", "Topics"));
  tagSize.append(barList(tagSizeBuckets(topicTags).filter((b) => b.count > 0), "No topic tags."));
  tagSize.append(el("h3", "dash__subhead", "Intents"));
  tagSize.append(barList(tagSizeBuckets(intentTags).filter((b) => b.count > 0), "No intent tags."));
  root.append(section("Tag sizes", tagSize));

  // Relation links carried on cards, by type (synonym / antonym / abbreviation)
  const relCounts = {};
  for (const e of expressions) for (const r of e.relations || []) relCounts[r.type] = (relCounts[r.type] || 0) + 1;
  const relRows = Object.entries(relCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  root.append(section("Relations on cards", barList(relRows, "No relation links yet — they appear as you save cards with synonyms/abbreviations.")));

  // Recent growth — saves per day, last 7 days (oldest → newest)
  const day = 86400000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const growth = [];
  for (let i = 6; i >= 0; i--) {
    const start = today.getTime() - i * day;
    const count = expressions.filter((e) => e.created_at >= start && e.created_at < start + day).length;
    const label = i === 0 ? "today" : new Date(start).toISOString().slice(5, 10);
    growth.push({ name: label, count });
  }
  root.append(section("Saved in the last 7 days", barList(growth, "No recent activity.")));
}
