// Dashboard (SPEC §6.3) — the shape of the vault at a glance: topic / intent /
// register distribution, tag counts per axis, edge count, and recent growth.
// Pure reads over the db; doubles as a sanity check that capture → live tagging
// is producing a healthy organization layer.

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

const REGISTERS = ["slang", "casual", "neutral", "formal", "academic", "technical"];

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

  // Stat cards
  const stats = el("div", "stats");
  stats.append(statCard("Expressions", expressions.length));
  stats.append(statCard("Topics", topicTags.length));
  stats.append(statCard("Intents", intentTags.length));
  stats.append(statCard("Edges", edges.length));
  root.append(stats);

  // Register distribution (fixed band order, only those present)
  const regCounts = REGISTERS.map((name) => ({
    name,
    count: expressions.filter((e) => e.register === name).length,
  })).filter((r) => r.count > 0);
  root.append(section("Register", barList(regCounts, "No register data.")));

  // Top topics / intents by membership
  const topBy = (tags) =>
    tags
      .map((t) => ({ name: t.name, count: t.member_ids.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  root.append(section("Top topics", barList(topBy(topicTags), "No topic tags yet.")));
  root.append(section("Top intents", barList(topBy(intentTags), "No intent tags yet.")));

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
