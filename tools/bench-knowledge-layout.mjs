#!/usr/bin/env node
// Measures the Knowledge Graph layout (src/knowledge/layout.js) on the demo
// vault, off-DOM: seedLayout, then the live loop the view runs (alpha 0.9,
// ×0.985 per tick until < 0.005), with similarity edges at cosine ≥ 0.5.
//
//   node tools/bench-knowledge-layout.mjs [seed]
//
// Per range it prints how many nodes end up clamped against a wall, how many sit
// within 14px of another node (overlap), and the share of the drawable area the
// layout's bounding box covers.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const L = await import(path.join(ROOT, "src/knowledge/layout.js"));
const vault = JSON.parse(fs.readFileSync(path.join(ROOT, "data/sample/vault.json"), "utf8"));

// Seeded Math.random so a run is repeatable (seedLayout scatters randomly).
let state = Number(process.argv[2] || 7);
Math.random = () => ((state = (state * 16807) % 2147483647) / 2147483647);

const cosine = (a, b) => {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return d / Math.sqrt(x * y);
};
const edgesOf = (rows) => {
  const e = [];
  for (let i = 0; i < rows.length; i++)
    for (let j = i + 1; j < rows.length; j++) if (cosine(rows[i].embedding, rows[j].embedding) >= 0.5) e.push({ a: i, b: j });
  return e;
};

function measure(rows) {
  const n = rows.length, edges = edgesOf(rows);
  const pos = L.seedLayout(n, edges);
  const sim = { n, edges, pos, fixed: new Set(), alpha: 0.9, k: Math.sqrt((L.W * L.H) / n) };
  while (sim.alpha > 0.005) { L.stepSim(sim); sim.alpha *= 0.985; }
  const { W, H, PAD } = L;
  const wall = pos.filter((p) => p.x <= PAD + 1 || p.x >= W - PAD - 1 || p.y <= PAD + 1 || p.y >= H - PAD - 1).length;
  let overlap = 0;
  for (let i = 0; i < n; i++) {
    let m = Infinity;
    for (let j = 0; j < n; j++) if (i !== j) m = Math.min(m, Math.hypot(pos[i].x - pos[j].x, pos[i].y - pos[j].y));
    if (m < 14) overlap++;
  }
  const xs = pos.map((p) => p.x), ys = pos.map((p) => p.y);
  const fill = ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))) / ((W - 2 * PAD) * (H - 2 * PAD));
  return `wall ${wall}/${n} · overlap ${overlap}/${n} · fill ${fill.toFixed(2)}`;
}

const ex = vault.expressions;
const ranges = {
  "all": ex,
  "last 50": ex.slice(0, 50),
  "register casual": ex.filter((e) => e.register === "casual"),
  "register slang": ex.filter((e) => e.register === "slang"),
  "intent describe-sleep": ex.filter((e) => e.intents.includes("describe-sleep")),
};
const seed = state;
for (const [name, rows] of Object.entries(ranges)) {
  state = seed;
  console.log(name.padEnd(22), measure(rows));
}
