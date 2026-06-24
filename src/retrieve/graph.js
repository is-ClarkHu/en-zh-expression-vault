// 2D knowledge-graph view (SPEC §6.1, third retrieval mode). Nodes = expressions
// positioned by an embedding projection, colored by topic; links = edges.
// Nearby nodes cluster visibly; browse by walking relationships.
//
// The projection is PCA-to-2D computed in the browser from the expression
// embeddings (filled by recluster.py). pca2d is a pure function so it can be
// unit-tested off-DOM. Needs embeddings + edges — both produced by recluster.py
// (Dashboard → Export → run tool → Import); shows guidance until they exist.

import { getExpressions, getEdges } from "../db/index.js";

const PALETTE = [
  "#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed",
  "#0891b2", "#db2777", "#65a30d", "#9333ea", "#0d9488",
];

// PCA to 2D via power iteration: top-2 principal components of the mean-centered
// vectors. Returns [[x,y], ...] aligned with the input order.
export function pca2d(vectors) {
  const n = vectors.length;
  if (!n) return [];
  const d = vectors[0].length;

  // mean-center
  const mean = new Array(d).fill(0);
  for (const v of vectors) for (let j = 0; j < d; j++) mean[j] += v[j];
  for (let j = 0; j < d; j++) mean[j] /= n;
  const X = vectors.map((v) => v.map((x, j) => x - mean[j]));

  // first principal component: iterate p ← normalize(Xᵀ(Xp))
  const component = (deflated) => {
    let p = new Array(d).fill(0).map(() => Math.random() - 0.5);
    p = normalize(p);
    for (let it = 0; it < 60; it++) {
      const y = deflated.map((row) => dot(row, p)); // Xp  (n)
      const next = new Array(d).fill(0);
      for (let i = 0; i < n; i++) {
        const yi = y[i];
        const row = deflated[i];
        for (let j = 0; j < d; j++) next[j] += row[j] * yi; // Xᵀy (d)
      }
      p = normalize(next);
    }
    return p;
  };

  const pc1 = component(X);
  // deflate: remove the pc1 direction, then extract pc2
  const X2 = X.map((row) => {
    const proj = dot(row, pc1);
    return row.map((x, j) => x - proj * pc1[j]);
  });
  const pc2 = component(X2);

  return X.map((row) => [dot(row, pc1), dot(row, pc2)]);
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
function normalize(v) {
  const n = Math.sqrt(dot(v, v)) || 1;
  return v.map((x) => x / n);
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}
function svgEl(tag, attrs) {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

// Scale projected coords into the [pad, size-pad] box of each axis.
function fit(coords, w, h, pad) {
  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  const sx = (v) => (maxX === minX ? w / 2 : pad + ((v - minX) / (maxX - minX)) * (w - 2 * pad));
  const sy = (v) => (maxY === minY ? h / 2 : pad + ((v - minY) / (maxY - minY)) * (h - 2 * pad));
  return coords.map((c) => [sx(c[0]), sy(c[1])]);
}

export async function mountGraph(root) {
  root.innerHTML = "";
  root.append(el("p", "muted", "2D map — expressions placed by embedding similarity, linked by relation edges. Hover a node; click to pin its detail."));

  const [expressions, edges] = await Promise.all([getExpressions(), getEdges()]);
  const withVec = expressions.filter((e) => Array.isArray(e.embedding) && e.embedding.length);

  if (withVec.length < 2) {
    root.append(
      el("p", "muted", "Not enough embedded expressions yet. Run the tag pipeline to generate embeddings + edges: Dashboard → Export vault → `python tools/recluster.py --vault <file>` → Import vault."),
    );
    return;
  }

  const coords = fit(pca2d(withVec.map((e) => e.embedding)), 800, 500, 28);
  const pos = new Map(withVec.map((e, i) => [e.id, coords[i]]));

  // color by primary topic
  const topics = [...new Set(withVec.map((e) => e.topics?.[0]).filter(Boolean))];
  const color = (e) => {
    const t = e.topics?.[0];
    const i = topics.indexOf(t);
    return i === -1 ? "#94a3b8" : PALETTE[i % PALETTE.length];
  };

  const svg = svgEl("svg", { viewBox: "0 0 800 500", class: "graph__svg" });

  // edges first (under nodes)
  for (const edge of edges) {
    const a = pos.get(edge.from_id);
    const b = pos.get(edge.to_id);
    if (!a || !b) continue;
    svg.append(svgEl("line", {
      x1: a[0], y1: a[1], x2: b[0], y2: b[1],
      stroke: "currentColor", "stroke-opacity": 0.18, "stroke-width": 1,
    }));
  }

  // nodes
  for (const e of withVec) {
    const [x, y] = pos.get(e.id);
    const c = svgEl("circle", { cx: x, cy: y, r: 6, fill: color(e), class: "graph__node" });
    const title = svgEl("title", {});
    title.textContent = `${e.surface}${e.gloss_cn ? " — " + e.gloss_cn : ""}`;
    c.append(title);
    c.addEventListener("click", () => showDetail(e));
    svg.append(c);
  }
  root.append(svg);

  // legend
  const legend = el("div", "graph__legend");
  for (let i = 0; i < topics.length; i++) {
    const item = el("span", "graph__legend-item");
    const dot = el("span", "graph__swatch");
    dot.style.background = PALETTE[i % PALETTE.length];
    item.append(dot, document.createTextNode(topics[i]));
    legend.append(item);
  }
  root.append(legend);

  const detail = el("div", "graph__detail muted", "Click a node to see its card.");
  root.append(detail);
  function showDetail(e) {
    detail.classList.remove("muted");
    detail.innerHTML = "";
    detail.append(el("strong", null, e.surface));
    if (e.register) detail.append(el("span", "candidate__register", ` ${e.register}`));
    if (e.gloss_cn) detail.append(el("div", null, e.gloss_cn));
    if (e.intent_cn) detail.append(el("div", "muted", `意图：${e.intent_cn}`));
  }
}
