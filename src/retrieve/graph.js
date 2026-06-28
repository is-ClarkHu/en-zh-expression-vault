// 2D knowledge-graph view (SPEC v2 §10/§11). A browse view, not a batch export:
// it reads IndexedDB directly — pick a range, tap Generate, and the graph renders
// on the spot. There is no export/import detour.
//
// Per-word `embedding` is the only pre-stored thing (computed at save, §11). For
// the small graphs you actually browse, BOTH the edges and the layout are computed
// live in the browser from those vectors — no network at render time:
//   • edges  = pairwise cosine ≥ a threshold (a live slider, so density is tunable)
//   • layout = a light hand-rolled force simulation with a hard iteration cap
// Large ranges (> MAX_LIVE) skip the O(N²) edge/force work (slowness avoided, not
// a hard cap) and fall back to a quick ring of nodes.
//
// Two range modes (§10): Filter (by topic / intent / register / last-N — the
// common case) and Lasso (drag a box over a global thumbnail to grab a patch).

import { getExpressions, getExpressionsByTag, getTags, getEdges, putEdges } from "../db/index.js";
import { cosine } from "../reassign/cluster.js";
import { ensureEmbeddingsFor } from "../reassign/index.js";
import { findRelations } from "../ai/relations.js";
import { setRange, getRange } from "./range.js";
import { UI } from "../ui/strings.js";

const REGISTERS = ["slang", "casual", "neutral", "formal", "academic", "technical"];
const PALETTE = [
  "#28514a", "#9a6a2f", "#3a5a7a", "#6a4a6a", "#4a6a3a",
  "#7a4a3a", "#3a6a6a", "#6a5a2a", "#5a3a5a", "#2a5a4a",
];
// Typed-relation edge styling (SPEC §2.3). Restrained, distinct per type.
const REL_STYLE = {
  synonym: { stroke: "#28514a", dash: "" },
  antonym: { stroke: "#9a6a2f", dash: "5 4" },
  progression: { stroke: "#3a7a52", dash: "1 5" },
  collocation: { stroke: "#6a5a9a", dash: "8 5" },
  abbreviation: { stroke: "#3a8a8a", dash: "2 3" }, // full ↔ short form (v3 §10b)
};
const MAX_LIVE = 150; // above this we skip live O(N²) edges + force layout
const W = 800, H = 520, PAD = 28;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const svgEl = (tag, attrs) => {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
const hasVec = (e) => Array.isArray(e.embedding) && e.embedding.length > 0;

// Pairwise cosine over a few-dozen nodes is trivial (30 nodes ≈ 435 compares).
function computeEdges(items, threshold) {
  const edges = [];
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const s = cosine(items[i].vec, items[j].vec);
      if (s >= threshold) edges.push({ a: i, b: j, w: s });
    }
  return edges;
}

// Hand-rolled Fruchterman–Reingold force layout with a hard iteration cap — the
// in-browser equivalent of a capped d3 forceSimulation, no dependency. Returns
// [{x,y}] in input order. Edges are index pairs.
function forceLayout(n, edges, iterations = 300) {
  const pos = Array.from({ length: n }, () => ({
    x: (Math.random() - 0.5) * W * 0.5 + W / 2,
    y: (Math.random() - 0.5) * H * 0.5 + H / 2,
  }));
  if (n < 2) return pos;
  const k = Math.sqrt((W * H) / n); // ideal node distance
  for (let it = 0; it < iterations; it++) {
    const t = 1 - it / iterations; // cooling
    const disp = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
        let d = Math.hypot(dx, dy) || 0.01;
        const rep = (k * k) / d;
        const ux = dx / d, uy = dy / d;
        disp[i].x += ux * rep; disp[i].y += uy * rep;
        disp[j].x -= ux * rep; disp[j].y -= uy * rep;
      }
    for (const e of edges) {
      let dx = pos[e.a].x - pos[e.b].x, dy = pos[e.a].y - pos[e.b].y;
      let d = Math.hypot(dx, dy) || 0.01;
      const att = (d * d) / k;
      const ux = dx / d, uy = dy / d;
      disp[e.a].x -= ux * att; disp[e.a].y -= uy * att;
      disp[e.b].x += ux * att; disp[e.b].y += uy * att;
    }
    const max = 12 * t + 1;
    for (let i = 0; i < n; i++) {
      disp[i].x += (W / 2 - pos[i].x) * 0.012; // gravity to center
      disp[i].y += (H / 2 - pos[i].y) * 0.012;
      const sp = Math.hypot(disp[i].x, disp[i].y) || 0.01;
      const s = Math.min(sp, max) / sp;
      pos[i].x += disp[i].x * s;
      pos[i].y += disp[i].y * s;
    }
  }
  return pos;
}

// Quick ring placement for ranges too big to force-lay-out interactively.
function ringLayout(n) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: W / 2 + Math.cos(a) * (W / 2 - PAD), y: H / 2 + Math.sin(a) * (H / 2 - PAD) };
  });
}

function fit(pos) {
  const xs = pos.map((p) => p.x), ys = pos.map((p) => p.y);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  const sx = (v) => (maxX === minX ? W / 2 : PAD + ((v - minX) / (maxX - minX)) * (W - 2 * PAD));
  const sy = (v) => (maxY === minY ? H / 2 : PAD + ((v - minY) / (maxY - minY)) * (H - 2 * PAD));
  return pos.map((p) => ({ x: sx(p.x), y: sy(p.y) }));
}

// Scroll/pinch to zoom, drag to pan — a small hand-rolled equivalent of d3.zoom
// (the project avoids the dependency, like the force layout). Transforms a <g>
// viewport so nodes/edges move together; the view persists on `state` so the
// threshold slider's redraw keeps your zoom. Returns whether the last gesture
// was a pan (so a node click can be ignored after a drag).
function attachZoomPan(svg, vp, state) {
  const view = state._view || (state._view = { k: 1, tx: 0, ty: 0 });
  const apply = () => vp.setAttribute("transform", `translate(${view.tx} ${view.ty}) scale(${view.k})`);
  apply();
  const toLocal = (ev) => {
    const r = svg.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * W, y: ((ev.clientY - r.top) / r.height) * H };
  };
  svg.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const m = toLocal(ev);
    const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    const k = Math.min(8, Math.max(0.5, view.k * factor));
    view.tx = m.x - ((m.x - view.tx) / view.k) * k; // keep the point under the cursor fixed
    view.ty = m.y - ((m.y - view.ty) / view.k) * k;
    view.k = k;
    apply();
  }, { passive: false });

  let pan = null;
  svg.addEventListener("pointerdown", (ev) => {
    pan = { x: ev.clientX, y: ev.clientY, tx: view.tx, ty: view.ty };
    state._panMoved = false;
    svg.setPointerCapture(ev.pointerId);
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!pan) return;
    const r = svg.getBoundingClientRect();
    if (Math.hypot(ev.clientX - pan.x, ev.clientY - pan.y) > 4) state._panMoved = true;
    view.tx = pan.tx + ((ev.clientX - pan.x) / r.width) * W;
    view.ty = pan.ty + ((ev.clientY - pan.y) / r.height) * H;
    apply();
  });
  const end = () => { pan = null; };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("dblclick", () => { view.k = 1; view.tx = 0; view.ty = 0; apply(); }); // reset
}

export async function mountGraph(root) {
  root.innerHTML = "";
  root.append(el("p", "muted", "Map the vault: pick a range, tap Generate. Edges and layout are computed live from each word's embedding — drag the threshold to tune how densely they connect."));

  // --- range controls -------------------------------------------------------
  const modeBar = el("div", "axis-bar");
  const filterTab = el("button", "axis-tab axis-tab--on", "Filter");
  const lassoTab = el("button", "axis-tab", "Lasso");
  modeBar.append(filterTab, lassoTab);
  root.append(modeBar);

  const filterCtl = el("div", "graph-controls");
  const axisSel = el("select");
  for (const [v, label] of [["topic", "Topic"], ["intent", "Intent"], ["register", "Register"], ["recent", "Last N added"]]) {
    const o = el("option", null, label);
    o.value = v;
    axisSel.append(o);
  }
  const valueSel = el("select");
  const genBtn = el("button", "btn", "Generate");
  filterCtl.append(el("span", "settings-bar__label", "By"), axisSel, valueSel, genBtn);
  root.append(filterCtl);

  const lassoCtl = el("div", "graph-controls");
  lassoCtl.hidden = true;
  lassoCtl.append(el("span", "muted", "Drag a box over the thumbnail to select a patch — releasing generates it."));
  const lassoInfo = el("span", "muted");
  const lassoStage = el("div", "graph__thumb");
  lassoCtl.append(lassoInfo, lassoStage);
  root.append(lassoCtl);

  // threshold slider (acts live once a graph is generated)
  const thrWrap = el("div", "graph-controls");
  const thr = el("input");
  thr.type = "range";
  thr.min = "0.2"; thr.max = "0.9"; thr.step = "0.02"; thr.value = "0.5";
  const thrVal = el("span", "muted", thr.value);
  thrWrap.append(el("span", "settings-bar__label", "Edge threshold"), thr, thrVal);
  root.append(thrWrap);

  const status = el("p", "muted");
  const stage = el("div", "graph__stage");
  const detail = el("div", "graph__detail muted", "Nothing generated yet.");
  root.append(status, stage, detail);

  let current = null; // { exprs, items, pos }

  // --- value dropdown follows the axis --------------------------------------
  async function fillValues() {
    valueSel.innerHTML = "";
    const axis = axisSel.value;
    if (axis === "recent") {
      for (const n of ["20", "50", "100", "all"]) {
        const o = el("option", null, n === "all" ? "All" : `Last ${n}`);
        o.value = n;
        valueSel.append(o);
      }
      return;
    }
    if (axis === "register") {
      const all = await getExpressions();
      const present = REGISTERS.filter((r) => all.some((e) => e.register === r));
      for (const r of present) {
        const o = el("option", null, `${r} (${all.filter((e) => e.register === r).length})`);
        o.value = r;
        valueSel.append(o);
      }
      if (!present.length) valueSel.append(el("option", null, "— none —"));
      return;
    }
    const tags = (await getTags(axis)).sort((a, b) => b.member_ids.length - a.member_ids.length);
    for (const t of tags) {
      const o = el("option", null, `${t.name} (${t.member_ids.length})`);
      o.value = t.name;
      valueSel.append(o);
    }
    if (!tags.length) valueSel.append(el("option", null, `— no ${axis} tags —`));
  }
  axisSel.addEventListener("change", fillValues);
  await fillValues();

  // If retrieve already focused a slice, default the graph filter to the same
  // one (the shared range model — range.js), so the selection carries over.
  async function preselectFromRange() {
    const r = getRange();
    if (!r || r.kind === "all" || r.kind === "ids") return;
    if (r.kind === "tag") axisSel.value = r.axis;
    else axisSel.value = r.kind; // "register" | "recent"
    await fillValues();
    const want = r.kind === "recent" ? String(r.n) : r.name;
    if ([...valueSel.options].some((o) => o.value === want)) valueSel.value = want;
  }
  await preselectFromRange();

  async function gatherFilter() {
    const axis = axisSel.value, val = valueSel.value;
    if (!val || val.startsWith("—")) return [];
    if (axis === "recent") {
      const all = await getExpressions(); // already newest-first
      return val === "all" ? all : all.slice(0, +val);
    }
    if (axis === "register") return (await getExpressions()).filter((e) => e.register === val);
    return getExpressionsByTag(axis, val);
  }

  // The current filter selection as a shared-range descriptor (range.js).
  function filterRange() {
    const axis = axisSel.value, val = valueSel.value;
    if (!val || val.startsWith("—")) return null;
    if (axis === "recent") return val === "all" ? { kind: "all" } : { kind: "recent", n: +val };
    if (axis === "register") return { kind: "register", name: val };
    return { kind: "tag", axis, name: val };
  }

  // --- generate from a set of expressions -----------------------------------
  async function generate(exprs, range) {
    if (range) setRange(range); // share the focused slice with retrieve (range.js)
    detail.className = "graph__detail muted";
    detail.textContent = "Click a node to see its card.";
    if (!exprs.length) {
      stage.innerHTML = "";
      status.textContent = "";
      stage.append(el("p", "muted", "That range is empty."));
      return;
    }
    status.textContent = "Preparing…";
    try {
      await ensureEmbeddingsFor(exprs, (m) => (status.textContent = m));
    } catch (e) {
      status.textContent = "";
      stage.innerHTML = "";
      stage.append(el("p", "error", e.message === "NO_EMBED_KEY"
        ? "Set an embedding-provider API key (OpenAI/Gemini/Mistral) under Provider first."
        : `Couldn't compute embeddings: ${e.message}`));
      return;
    }
    const withVec = exprs.filter(hasVec);
    status.textContent = "";
    if (withVec.length < 2) {
      stage.innerHTML = "";
      stage.append(el("p", "muted", "Need at least two embedded words to draw a graph."));
      return;
    }
    const items = withVec.map((e) => ({ id: e.id, vec: e.embedding }));
    const live = withVec.length <= MAX_LIVE;
    const edges0 = live ? computeEdges(items, +thr.value) : [];
    const pos = fit(live ? forceLayout(withVec.length, edges0) : ringLayout(withVec.length));
    const ids = new Set(withVec.map((e) => e.id));
    const typed = (await getEdges()).filter((ed) => ids.has(ed.from_id) && ids.has(ed.to_id));
    current = { exprs: withVec, items, pos, live, typed };
    if (!live) status.textContent = `${withVec.length} nodes — too many for live edges; showing the node cloud. Narrow the range for connections.`;
    draw(+thr.value);
  }

  // Redraw from stored positions; only edges depend on the threshold, so the
  // slider is instant and never reshuffles the layout.
  function draw(threshold) {
    if (!current) return;
    const { exprs, items, pos, live } = current;
    const edges = live ? computeEdges(items, threshold) : [];

    const topics = [...new Set(exprs.map((e) => e.topics?.[0]).filter(Boolean))];
    const color = (e) => {
      const i = topics.indexOf(e.topics?.[0]);
      return i === -1 ? "#9a988e" : PALETTE[i % PALETTE.length];
    };

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "graph__svg" });
    const vp = svgEl("g", { class: "graph__viewport" }); // everything zoom/pan moves together
    svg.append(vp);
    for (const e of edges) {
      vp.append(svgEl("line", {
        x1: pos[e.a].x, y1: pos[e.a].y, x2: pos[e.b].x, y2: pos[e.b].y,
        stroke: "currentColor", "stroke-opacity": 0.16, "stroke-width": 1,
      }));
    }
    // typed relation edges (on-demand AI), drawn over the similarity layer
    const idx = new Map(exprs.map((e, i) => [e.id, i]));
    for (const te of current.typed || []) {
      const a = idx.get(te.from_id), b = idx.get(te.to_id);
      if (a == null || b == null) continue;
      const st = REL_STYLE[te.type] || REL_STYLE.synonym;
      vp.append(svgEl("line", {
        x1: pos[a].x, y1: pos[a].y, x2: pos[b].x, y2: pos[b].y,
        stroke: st.stroke, "stroke-opacity": 0.85, "stroke-width": 1.5, "stroke-dasharray": st.dash,
      }));
    }

    // The SVG sits in a positioned canvas so the hover tooltip can overlay it.
    const canvas = el("div", "graph__canvas");
    const tip = el("div", "graph__tooltip");
    tip.hidden = true;
    const placeTip = (ev) => {
      const r = canvas.getBoundingClientRect();
      tip.style.left = `${ev.clientX - r.left + 12}px`;
      tip.style.top = `${ev.clientY - r.top + 12}px`;
    };

    for (let i = 0; i < exprs.length; i++) {
      const ex = exprs[i];
      const c = svgEl("circle", { cx: pos[i].x, cy: pos[i].y, r: 6, fill: color(ex), class: "graph__node" });
      c.addEventListener("mouseenter", (ev) => {
        tip.innerHTML = "";
        const h = el("div", "graph__tip-head");
        h.append(el("span", "graph__tip-surface", ex.surface));
        if (ex.pos) h.append(el("span", "graph__tip-pos", ex.pos));
        tip.append(h);
        if (ex.gloss_cn) tip.append(el("div", "graph__tip-gloss", ex.gloss_cn));
        const tags = [...(ex.topics || []), ...(ex.intents || [])].slice(0, 3);
        if (tags.length) tip.append(el("div", "graph__tip-tags", tags.join(" · ")));
        tip.hidden = false;
        placeTip(ev);
      });
      c.addEventListener("mousemove", placeTip);
      c.addEventListener("mouseleave", () => { tip.hidden = true; });
      c.addEventListener("click", () => { if (!current._panMoved) showDetail(ex); });
      vp.append(c);
    }
    canvas.append(svg, tip);
    stage.innerHTML = "";
    stage.append(canvas);
    attachZoomPan(svg, vp, current);

    const legend = el("div", "graph__legend");
    topics.forEach((t, i) => {
      const item = el("span", "graph__legend-item");
      const dot = el("span", "graph__swatch");
      dot.style.background = PALETTE[i % PALETTE.length];
      item.append(dot, document.createTextNode(t));
      legend.append(item);
    });
    stage.append(legend);

    // legend for any typed relations present
    const relTypes = [...new Set((current.typed || []).map((t) => t.type))];
    if (relTypes.length) {
      const rl = el("div", "graph__legend");
      for (const t of relTypes) {
        const item = el("span", "graph__legend-item");
        const sw = el("span", "graph__rel-swatch");
        sw.style.borderTopColor = (REL_STYLE[t] || REL_STYLE.synonym).stroke;
        sw.style.borderTopStyle = (REL_STYLE[t] || REL_STYLE.synonym).dash ? "dashed" : "solid";
        item.append(sw, document.createTextNode(t));
        rl.append(item);
      }
      stage.append(rl);
    }
    stage.append(el("p", "muted", `${exprs.length} nodes · ${edges.length} edges at cosine ≥ ${threshold.toFixed(2)} · scroll to zoom, drag to pan, double-click to reset`));
  }

  function showDetail(e) {
    detail.className = "graph__detail";
    detail.innerHTML = "";
    detail.append(el("strong", "candidate__surface", e.surface));
    if (e.register) detail.append(el("span", "candidate__register", ` ${e.register}`));
    if (e.gloss_cn) detail.append(el("div", "candidate__gloss", e.gloss_cn));
    if (e.intent_cn) detail.append(el("div", "candidate__intent", `${UI.intentPrefix}${e.intent_cn}`));

    // On-demand typed relations: one AI call classifying this word's nearest
    // neighbours (antonym/progression/collocation/synonym), stored as edges and
    // drawn over the graph — no network at render, similarity stays live (v2 §11).
    const relBtn = el("button", "btn btn--ghost", UI.findRelations);
    relBtn.addEventListener("click", async () => {
      relBtn.disabled = true;
      relBtn.textContent = "…";
      try {
        const self = current.items.find((it) => it.id === e.id);
        const neighbours = current.items
          .filter((it) => it.id !== e.id)
          .map((it) => ({ it, s: cosine(self.vec, it.vec) }))
          .sort((a, b) => b.s - a.s)
          .slice(0, 8)
          .map(({ it }) => {
            const ex = current.exprs.find((x) => x.id === it.id);
            return { id: it.id, surface: ex.surface, gloss_cn: ex.gloss_cn };
          });
        const rels = await findRelations(e, neighbours);
        const edges = rels.map((r) => ({
          id: `${e.id}~${r.to}~${r.type}`,
          from_id: e.id,
          to_id: r.to,
          type: r.type,
          source: "ai",
          confidence: r.confidence,
        }));
        await putEdges(edges);
        const ids = new Set(current.exprs.map((x) => x.id));
        current.typed = (await getEdges()).filter((ed) => ids.has(ed.from_id) && ids.has(ed.to_id));
        draw(+thr.value);
        showDetail(e);
        if (!rels.length) detail.append(el("div", "muted", "No strong typed relations found among nearby words."));
      } catch (err) {
        alert(err?.message === "NO_KEY" ? UI.findRelationsNoKey : `${UI.findRelationsFail}: ${err.message || err}`);
      } finally {
        relBtn.disabled = false;
        relBtn.textContent = UI.findRelations;
      }
    });
    detail.append(relBtn);
  }

  thr.addEventListener("input", () => {
    thrVal.textContent = (+thr.value).toFixed(2);
    draw(+thr.value);
  });
  genBtn.addEventListener("click", async () => {
    genBtn.disabled = true;
    try {
      await generate(await gatherFilter(), filterRange());
    } finally {
      genBtn.disabled = false;
    }
  });

  // --- mode switch + lasso --------------------------------------------------
  let thumbState = null; // { exprs, pos } over all embedded words
  function setMode(lasso) {
    filterTab.classList.toggle("axis-tab--on", !lasso);
    lassoTab.classList.toggle("axis-tab--on", lasso);
    filterCtl.hidden = lasso;
    lassoCtl.hidden = !lasso;
    if (lasso && !thumbState) buildThumb();
  }
  filterTab.addEventListener("click", () => setMode(false));
  lassoTab.addEventListener("click", () => setMode(true));

  async function buildThumb() {
    lassoStage.innerHTML = "";
    lassoStage.append(el("p", "muted", "Preparing thumbnail…"));
    const all = await getExpressions();
    try {
      await ensureEmbeddingsFor(all, (m) => (lassoStage.firstChild.textContent = m));
    } catch (e) {
      lassoStage.innerHTML = "";
      lassoStage.append(el("p", "error", `Couldn't embed: ${e.message}`));
      return;
    }
    const withVec = all.filter(hasVec);
    if (withVec.length < 2) {
      lassoStage.innerHTML = "";
      lassoStage.append(el("p", "muted", "Not enough embedded words yet."));
      return;
    }
    const items = withVec.map((e) => ({ id: e.id, vec: e.embedding }));
    const edges = withVec.length <= MAX_LIVE ? computeEdges(items, 0.5) : [];
    const pos = fit(forceLayout(withVec.length, edges, 140)); // lighter for a thumbnail
    thumbState = { exprs: withVec, pos };
    drawThumb();
  }

  function drawThumb() {
    const { exprs, pos } = thumbState;
    lassoStage.innerHTML = "";
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "graph__svg graph__svg--thumb" });
    for (let i = 0; i < exprs.length; i++)
      svg.append(svgEl("circle", { cx: pos[i].x, cy: pos[i].y, r: 4, fill: "#9a988e" }));
    const box = svgEl("rect", { class: "graph__lasso", x: 0, y: 0, width: 0, height: 0, hidden: "" });
    svg.append(box);
    lassoStage.append(svg);

    // drag a selection box in SVG coords
    let start = null;
    const toSvg = (ev) => {
      const r = svg.getBoundingClientRect();
      return { x: ((ev.clientX - r.left) / r.width) * W, y: ((ev.clientY - r.top) / r.height) * H };
    };
    svg.addEventListener("pointerdown", (ev) => {
      start = toSvg(ev);
      box.removeAttribute("hidden");
      svg.setPointerCapture(ev.pointerId);
    });
    const inBox = (x0, y0, x1, y1) => exprs.filter((_, i) => pos[i].x >= x0 && pos[i].x <= x1 && pos[i].y >= y0 && pos[i].y <= y1);
    svg.addEventListener("pointermove", (ev) => {
      if (!start) return;
      const p = toSvg(ev);
      const x0 = Math.min(start.x, p.x), y0 = Math.min(start.y, p.y);
      const x1 = Math.max(start.x, p.x), y1 = Math.max(start.y, p.y);
      box.setAttribute("x", x0);
      box.setAttribute("y", y0);
      box.setAttribute("width", x1 - x0);
      box.setAttribute("height", y1 - y0);
      lassoInfo.textContent = `${inBox(x0, y0, x1, y1).length} selected`; // live feedback
    });
    svg.addEventListener("pointerup", (ev) => {
      if (!start) return;
      const p = toSvg(ev);
      const x0 = Math.min(start.x, p.x), x1 = Math.max(start.x, p.x);
      const y0 = Math.min(start.y, p.y), y1 = Math.max(start.y, p.y);
      start = null;
      box.setAttribute("hidden", "");
      const picked = inBox(x0, y0, x1, y1);
      lassoInfo.textContent = picked.length ? `${picked.length} selected` : "Nothing in that box — try again.";
      if (picked.length) generate(picked, { kind: "ids", ids: picked.map((e) => e.id), label: "Lasso patch" });
    });
  }
}
