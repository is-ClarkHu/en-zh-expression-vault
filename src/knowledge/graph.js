// Knowledge-Graph view — an experimental sibling to the Graph view (retrieve/
// graph.js). Same data (per-word `embedding` similarity + on-demand typed
// relation edges), but three things the plain Graph doesn't do:
//   • a LIVE force simulation (rAF) — nodes are individually draggable and the
//     whole web springs back and settles after you let go (Obsidian-style),
//     instead of a one-shot layout that freezes.
//   • a layer panel of checkboxes — toggle the similarity layer, each typed
//     relation type, edge/word labels, and the legend independently.
//   • a Focus view — click a node to spotlight it + its neighbours and dim the
//     rest (TheBrain/Neo4j-style), without losing the global position.
//
// Physics skeleton = the similarity edges captured at generate time (stable, so
// toggling display layers never reshuffles the layout). Displayed edges are
// recomputed live from the threshold slider. Nothing hits the network at render.

import { getExpressions, getExpressionsByTag, getTags, getEdges, putEdges } from "../db/index.js";
import { cosine } from "../reassign/cluster.js";
import { ensureEmbeddingsFor } from "../reassign/index.js";
import { findRelations, REL_TYPES } from "../ai/relations.js";
import { UI } from "../ui/strings.js";

const REGISTERS = ["slang", "casual", "neutral", "formal", "academic", "technical"];
const PALETTE = [
  "#28514a", "#9a6a2f", "#3a5a7a", "#6a4a6a", "#4a6a3a",
  "#7a4a3a", "#3a6a6a", "#6a5a2a", "#5a3a5a", "#2a5a4a",
];
const REL_STYLE = {
  synonym: { stroke: "#28514a", dash: "" },
  antonym: { stroke: "#9a6a2f", dash: "5 4" },
  progression: { stroke: "#3a7a52", dash: "1 5" },
  collocation: { stroke: "#6a5a9a", dash: "8 5" },
  abbreviation: { stroke: "#3a8a8a", dash: "2 3" },
};
const MAX_LIVE = 150; // above this we skip the O(N²) sim and fall back to a ring
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

function computeEdges(items, threshold) {
  const edges = [];
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const s = cosine(items[i].vec, items[j].vec);
      if (s >= threshold) edges.push({ a: i, b: j, w: s });
    }
  return edges;
}

// One-shot Fruchterman–Reingold, used only to SEED the live sim with a sane
// starting layout (a cold start from random positions looks chaotic).
function seedLayout(n, edges, iterations = 120) {
  const pos = Array.from({ length: n }, () => ({
    x: (Math.random() - 0.5) * W * 0.5 + W / 2,
    y: (Math.random() - 0.5) * H * 0.5 + H / 2,
  }));
  const sim = { n, edges, pos, fixed: new Set(), alpha: 1, k: Math.sqrt((W * H) / Math.max(1, n)) };
  for (let i = 0; i < iterations; i++) { stepSim(sim); sim.alpha *= 0.99; }
  return pos;
}

// A single tick of the live simulation. Same forces as seedLayout, but pulled
// out so the rAF loop and the seed share one implementation. `fixed` nodes (the
// one you're dragging) don't move; `alpha` is the temperature we reheat on drag.
// Long-range repulsion is capped past DMAX: FR's 1/d push is unbounded, so
// disconnected clusters (words in different topics share no edge) otherwise fly
// apart until they jam into the walls. Capping lets clusters separate at medium
// range while gravity keeps the whole cloud centered and on-screen.
const DMAX = 300;

function stepSim(sim) {
  const { pos, edges, fixed, n, k } = sim;
  const disp = pos.map(() => ({ x: 0, y: 0 }));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      let dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
      let d = Math.hypot(dx, dy) || 0.01;
      if (d > DMAX) continue;
      const rep = (k * k) / d, ux = dx / d, uy = dy / d;
      disp[i].x += ux * rep; disp[i].y += uy * rep;
      disp[j].x -= ux * rep; disp[j].y -= uy * rep;
    }
  for (const e of edges) {
    let dx = pos[e.a].x - pos[e.b].x, dy = pos[e.a].y - pos[e.b].y;
    let d = Math.hypot(dx, dy) || 0.01;
    const att = (d * d) / k, ux = dx / d, uy = dy / d;
    disp[e.a].x -= ux * att; disp[e.a].y -= uy * att;
    disp[e.b].x += ux * att; disp[e.b].y += uy * att;
  }
  const max = 12 * sim.alpha + 1;
  for (let i = 0; i < n; i++) {
    if (fixed.has(i)) continue;
    disp[i].x += (W / 2 - pos[i].x) * 0.03; // gravity keeps the cloud centered
    disp[i].y += (H / 2 - pos[i].y) * 0.03;
    const sp = Math.hypot(disp[i].x, disp[i].y) || 0.01;
    const s = (Math.min(sp, max) / sp) * sim.alpha; // cooling → smaller steps → settles
    pos[i].x = Math.max(PAD, Math.min(W - PAD, pos[i].x + disp[i].x * s)); // clamp = safety net
    pos[i].y = Math.max(PAD, Math.min(H - PAD, pos[i].y + disp[i].y * s));
  }
}

function ringLayout(n) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: W / 2 + Math.cos(a) * (W / 2 - PAD), y: H / 2 + Math.sin(a) * (H / 2 - PAD) };
  });
}

// A previous mount's rAF loop must be stopped when we re-enter the view, or it
// keeps stepping a detached scene forever.
let stopActiveLoop = null;

export async function mountKnowledgeGraph(root) {
  if (stopActiveLoop) stopActiveLoop();
  root.innerHTML = "";
  root.append(el("p", "muted", "Knowledge graph (experimental): pick a range, tap Generate. Nodes are draggable and the web springs back live. Use the layer panel to choose what shows."));

  // display options persist across regenerates within this mount
  const opts = {
    similarity: true,
    threshold: 0.5,
    types: Object.fromEntries(REL_TYPES.map((t) => [t, true])),
    edgeLabels: false,
    wordLabels: false,
    legend: true,
    focusMode: false,
  };

  // --- range controls -------------------------------------------------------
  const filterCtl = el("div", "graph-controls");
  const axisSel = el("select");
  for (const [v, label] of [["topic", "Topic"], ["intent", "Intent"], ["register", "Register"], ["recent", "Last N added"]]) {
    const o = el("option", null, label); o.value = v; axisSel.append(o);
  }
  const valueSel = el("select");
  const genBtn = el("button", "btn", "Generate");
  filterCtl.append(el("span", "settings-bar__label", "By"), axisSel, valueSel, genBtn);
  root.append(filterCtl);

  // --- layer panel ----------------------------------------------------------
  const panel = el("div", "kg-panel");
  const mkCheck = (label, checked, onChange, cls) => {
    const wrap = el("label", `kg-check${cls ? " " + cls : ""}`);
    const box = el("input");
    box.type = "checkbox";
    box.checked = checked;
    box.addEventListener("change", () => onChange(box.checked));
    wrap.append(box, document.createTextNode(" " + label));
    return { wrap, box };
  };

  // edges group
  const gEdges = el("div", "kg-panel__group");
  gEdges.append(el("span", "kg-panel__title", "Edges"));
  const simRow = el("div", "kg-panel__row");
  simRow.append(mkCheck("Similarity (vectors)", opts.similarity, (v) => { opts.similarity = v; render(); }).wrap);
  const thr = el("input");
  thr.type = "range"; thr.min = "0.2"; thr.max = "0.9"; thr.step = "0.02"; thr.value = String(opts.threshold);
  const thrVal = el("span", "muted", (+thr.value).toFixed(2));
  thr.addEventListener("input", () => { opts.threshold = +thr.value; thrVal.textContent = opts.threshold.toFixed(2); render(); });
  simRow.append(el("span", "kg-panel__sub", "threshold"), thr, thrVal);
  gEdges.append(simRow);
  const typeRow = el("div", "kg-panel__row");
  for (const t of REL_TYPES) {
    const { wrap } = mkCheck(t, opts.types[t], (v) => { opts.types[t] = v; render(); }, "kg-check--rel");
    // colour the checkbox label to match the edge style
    wrap.style.setProperty("--rel-color", REL_STYLE[t].stroke);
    typeRow.append(wrap);
  }
  gEdges.append(typeRow);

  // display group
  const gShow = el("div", "kg-panel__group");
  gShow.append(el("span", "kg-panel__title", "Show"));
  const showRow = el("div", "kg-panel__row");
  showRow.append(mkCheck("Relation labels", opts.edgeLabels, (v) => { opts.edgeLabels = v; render(); }).wrap);
  showRow.append(mkCheck("Word labels", opts.wordLabels, (v) => { opts.wordLabels = v; render(); }).wrap);
  showRow.append(mkCheck("Legend", opts.legend, (v) => { opts.legend = v; render(); }).wrap);
  gShow.append(showRow);

  // view group (focus mode) + AI classify
  const gView = el("div", "kg-panel__group");
  gView.append(el("span", "kg-panel__title", "View"));
  const viewRow = el("div", "kg-panel__row");
  const focusChk = mkCheck("Focus (spotlight a node's neighbours)", opts.focusMode, (v) => {
    opts.focusMode = v;
    if (!v) state.focusId = null;
    render();
  });
  viewRow.append(focusChk.wrap);
  const classifyBtn = el("button", "btn btn--ghost", "Classify visible (AI)");
  classifyBtn.title = "Ask the deep-dive model to type-classify each visible node against its nearest neighbours, and store the edges.";
  viewRow.append(classifyBtn);
  gView.append(viewRow);

  panel.append(gEdges, gShow, gView);
  root.append(panel);

  const status = el("p", "muted");
  const stage = el("div", "graph__stage");
  const detail = el("div", "graph__detail muted", "Nothing generated yet.");
  root.append(status, stage, detail);

  // --- state ----------------------------------------------------------------
  const state = {
    exprs: [], items: [], pos: [], sim: null, live: false, typed: [],
    view: { k: 1, tx: 0, ty: 0 }, focusId: null,
    els: { nodes: [], sim: [], typed: [] },
    dragI: null, dragMoved: false, panMoved: false,
  };

  // --- value dropdown follows the axis --------------------------------------
  async function fillValues() {
    valueSel.innerHTML = "";
    const axis = axisSel.value;
    if (axis === "recent") {
      for (const n of ["20", "50", "100", "all"]) {
        const o = el("option", null, n === "all" ? "All" : `Last ${n}`); o.value = n; valueSel.append(o);
      }
      return;
    }
    if (axis === "register") {
      const all = await getExpressions();
      const present = REGISTERS.filter((r) => all.some((e) => e.register === r));
      for (const r of present) {
        const o = el("option", null, `${r} (${all.filter((e) => e.register === r).length})`); o.value = r; valueSel.append(o);
      }
      if (!present.length) valueSel.append(el("option", null, "— none —"));
      return;
    }
    const tags = (await getTags(axis)).sort((a, b) => b.member_ids.length - a.member_ids.length);
    for (const t of tags) {
      const o = el("option", null, `${t.name} (${t.member_ids.length})`); o.value = t.name; valueSel.append(o);
    }
    if (!tags.length) valueSel.append(el("option", null, `— no ${axis} tags —`));
  }
  axisSel.addEventListener("change", fillValues);
  await fillValues();

  async function gatherFilter() {
    const axis = axisSel.value, val = valueSel.value;
    if (!val || val.startsWith("—")) return [];
    if (axis === "recent") {
      const all = await getExpressions();
      return val === "all" ? all : all.slice(0, +val);
    }
    if (axis === "register") return (await getExpressions()).filter((e) => e.register === val);
    return getExpressionsByTag(axis, val);
  }

  // --- generate -------------------------------------------------------------
  async function generate(exprs) {
    stopLoop();
    state.focusId = null;
    detail.className = "graph__detail muted";
    detail.textContent = "Click a node to see its card.";
    if (!exprs.length) {
      stage.innerHTML = ""; status.textContent = "";
      stage.append(el("p", "muted", "That range is empty."));
      return;
    }
    status.textContent = "Preparing…";
    try {
      await ensureEmbeddingsFor(exprs, (m) => (status.textContent = m));
    } catch (e) {
      status.textContent = ""; stage.innerHTML = "";
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
    // physics skeleton captured once (stable layout); display edges are live
    const skeleton = live ? computeEdges(items, opts.threshold) : [];
    const pos = live ? seedLayout(withVec.length, skeleton) : ringLayout(withVec.length);
    const sim = live
      ? { n: withVec.length, edges: skeleton, pos, fixed: new Set(), alpha: 0.9, k: Math.sqrt((W * H) / withVec.length), raf: 0 }
      : null;
    const ids = new Set(withVec.map((e) => e.id));
    const typed = (await getEdges()).filter((ed) => ids.has(ed.from_id) && ids.has(ed.to_id));

    state.exprs = withVec; state.items = items; state.pos = pos;
    state.sim = sim; state.live = live; state.typed = typed;
    if (!live) status.textContent = `${withVec.length} nodes — too many for the live sim; showing a static ring. Narrow the range.`;
    render();
    if (live) startLoop();
  }

  // --- rendering (builds the scene from current opts + positions) -----------
  function neighbourSet(edges, typed) {
    // ids reachable from focusId via any currently-visible edge
    const set = new Set([state.focusId]);
    const idOf = (i) => state.exprs[i].id;
    for (const e of edges) {
      if (idOf(e.a) === state.focusId) set.add(idOf(e.b));
      if (idOf(e.b) === state.focusId) set.add(idOf(e.a));
    }
    for (const te of typed) {
      if (te.from_id === state.focusId) set.add(te.to_id);
      if (te.to_id === state.focusId) set.add(te.from_id);
    }
    return set;
  }

  function render() {
    if (!state.exprs.length) return;
    const { exprs, items, pos, live } = state;
    const edges = live && opts.similarity ? computeEdges(items, opts.threshold) : [];
    const typed = state.typed.filter((te) => opts.types[te.type]);
    const idx = new Map(exprs.map((e, i) => [e.id, i]));
    const focusSet = opts.focusMode && state.focusId ? neighbourSet(edges, typed) : null;
    const dimmed = (id) => focusSet && !focusSet.has(id);

    // Node radius scales with degree (visible edges) so hub words stand out — a
    // standard knowledge-graph cue. Range 4–9 keeps the hover rule (r:9) sensible.
    const deg = new Array(exprs.length).fill(0);
    for (const e of edges) { deg[e.a]++; deg[e.b]++; }
    for (const te of typed) { const a = idx.get(te.from_id), b = idx.get(te.to_id); if (a != null) deg[a]++; if (b != null) deg[b]++; }
    const maxDeg = Math.max(1, ...deg);
    const radius = (i) => 4 + Math.round((deg[i] / maxDeg) * 5);

    const topics = [...new Set(exprs.map((e) => e.topics?.[0]).filter(Boolean))];
    const color = (e) => {
      const i = topics.indexOf(e.topics?.[0]);
      return i === -1 ? "#9a988e" : PALETTE[i % PALETTE.length];
    };

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "graph__svg" });
    const vp = svgEl("g", { class: "graph__viewport" });
    svg.append(vp);

    state.els = { nodes: [], sim: [], typed: [] };

    // similarity edges (grey)
    for (const e of edges) {
      const ln = svgEl("line", {
        x1: pos[e.a].x, y1: pos[e.a].y, x2: pos[e.b].x, y2: pos[e.b].y,
        stroke: "currentColor", "stroke-opacity": 0.16, "stroke-width": 1,
      });
      if (dimmed(exprs[e.a].id) || dimmed(exprs[e.b].id)) ln.setAttribute("stroke-opacity", 0.04);
      vp.append(ln);
      state.els.sim.push({ ln, a: e.a, b: e.b });
    }

    // typed relation edges (coloured), over the similarity layer
    for (const te of typed) {
      const a = idx.get(te.from_id), b = idx.get(te.to_id);
      if (a == null || b == null) continue;
      const st = REL_STYLE[te.type] || REL_STYLE.synonym;
      const faded = dimmed(te.from_id) || dimmed(te.to_id);
      const ln = svgEl("line", {
        x1: pos[a].x, y1: pos[a].y, x2: pos[b].x, y2: pos[b].y,
        stroke: st.stroke, "stroke-opacity": faded ? 0.12 : 0.85, "stroke-width": 1.5, "stroke-dasharray": st.dash,
      });
      vp.append(ln);
      let txt = null;
      if (opts.edgeLabels) {
        txt = svgEl("text", {
          x: (pos[a].x + pos[b].x) / 2, y: (pos[a].y + pos[b].y) / 2,
          class: "kg-edge-label", fill: st.stroke, "fill-opacity": faded ? 0.2 : 0.9,
        });
        txt.textContent = te.type;
        vp.append(txt);
      }
      state.els.typed.push({ ln, txt, a, b });
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
      const c = svgEl("circle", { cx: pos[i].x, cy: pos[i].y, r: radius(i), fill: color(ex), class: "graph__node" });
      if (dimmed(ex.id)) c.setAttribute("opacity", 0.18);
      if (state.focusId === ex.id) c.setAttribute("stroke", "#000"), c.setAttribute("stroke-width", 2);
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
      if (live) attachNodeDrag(c, i, svg);
      else c.addEventListener("click", () => onNodeTap(i));
      vp.append(c);

      let t = null;
      if (opts.wordLabels) {
        t = svgEl("text", { x: pos[i].x + 8, y: pos[i].y + 3, class: "kg-word-label" });
        t.textContent = ex.surface;
        if (dimmed(ex.id)) t.setAttribute("opacity", 0.18);
        vp.append(t);
      }
      state.els.nodes.push({ c, t, i });
    }

    canvas.append(svg, tip);
    stage.innerHTML = "";
    stage.append(canvas);
    attachZoomPan(svg, vp);

    // legends
    if (opts.legend) {
      const legend = el("div", "graph__legend");
      topics.forEach((t, i) => {
        const item = el("span", "graph__legend-item");
        const dot = el("span", "graph__swatch");
        dot.style.background = PALETTE[i % PALETTE.length];
        item.append(dot, document.createTextNode(t));
        legend.append(item);
      });
      stage.append(legend);

      const relTypes = [...new Set(typed.map((t) => t.type))];
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
    }

    const focusNote = opts.focusMode ? " · Focus on — click a node to spotlight it" : "";
    stage.append(el("p", "muted", `${exprs.length} nodes · ${edges.length} similarity edges · ${typed.length} typed · scroll to zoom, drag a node to move it${focusNote}`));
  }

  // Write the latest simulation positions into the existing DOM (per-frame; no
  // rebuild). Only coordinates change, so this stays cheap.
  function sync() {
    const p = state.pos;
    for (const e of state.els.sim) {
      e.ln.setAttribute("x1", p[e.a].x); e.ln.setAttribute("y1", p[e.a].y);
      e.ln.setAttribute("x2", p[e.b].x); e.ln.setAttribute("y2", p[e.b].y);
    }
    for (const e of state.els.typed) {
      e.ln.setAttribute("x1", p[e.a].x); e.ln.setAttribute("y1", p[e.a].y);
      e.ln.setAttribute("x2", p[e.b].x); e.ln.setAttribute("y2", p[e.b].y);
      if (e.txt) { e.txt.setAttribute("x", (p[e.a].x + p[e.b].x) / 2); e.txt.setAttribute("y", (p[e.a].y + p[e.b].y) / 2); }
    }
    for (const n of state.els.nodes) {
      n.c.setAttribute("cx", p[n.i].x); n.c.setAttribute("cy", p[n.i].y);
      if (n.t) { n.t.setAttribute("x", p[n.i].x + 8); n.t.setAttribute("y", p[n.i].y + 3); }
    }
  }

  // --- live loop ------------------------------------------------------------
  function tick() {
    const sim = state.sim;
    if (!sim) return;
    stepSim(sim);
    sim.alpha *= 0.985;
    sync();
    sim.raf = sim.alpha > 0.005 ? requestAnimationFrame(tick) : 0;
  }
  function startLoop() {
    const sim = state.sim;
    if (!sim) return;
    if (!sim.raf) sim.raf = requestAnimationFrame(tick);
  }
  function reheat(a = 0.35) {
    const sim = state.sim;
    if (!sim) return;
    sim.alpha = Math.max(sim.alpha, a);
    startLoop();
  }
  function stopLoop() {
    if (state.sim) { cancelAnimationFrame(state.sim.raf); state.sim.raf = 0; }
  }
  stopActiveLoop = stopLoop;

  // --- node drag (live mode) ------------------------------------------------
  const svgLocal = (svg, ev) => {
    const r = svg.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * W, y: ((ev.clientY - r.top) / r.height) * H };
  };
  function attachNodeDrag(circle, i, svg) {
    circle.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation(); // don't let attachZoomPan start a pan
      svg.setPointerCapture(ev.pointerId);
      state.dragI = i; state.dragMoved = false;
      state.sim.fixed.add(i);
      reheat(0.35);
    });
  }
  function onNodeTap(i) {
    const ex = state.exprs[i];
    if (opts.focusMode) { state.focusId = state.focusId === ex.id ? null : ex.id; render(); }
    showDetail(ex);
  }

  // --- zoom / pan (shared viewport; hand-rolled, no d3) ---------------------
  function attachZoomPan(svg, vp) {
    const view = state.view;
    const apply = () => vp.setAttribute("transform", `translate(${view.tx} ${view.ty}) scale(${view.k})`);
    apply();
    const toLocal = (ev) => svgLocal(svg, ev);
    svg.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const m = toLocal(ev);
      const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
      const k = Math.min(8, Math.max(0.5, view.k * factor));
      view.tx = m.x - ((m.x - view.tx) / view.k) * k;
      view.ty = m.y - ((m.y - view.ty) / view.k) * k;
      view.k = k;
      apply();
    }, { passive: false });

    let pan = null;
    svg.addEventListener("pointerdown", (ev) => {
      pan = { x: ev.clientX, y: ev.clientY, tx: view.tx, ty: view.ty };
      state.panMoved = false;
      svg.setPointerCapture(ev.pointerId);
    });
    svg.addEventListener("pointermove", (ev) => {
      // node drag takes priority over panning
      if (state.dragI != null) {
        const loc = toLocal(ev);
        const nx = (loc.x - view.tx) / view.k, ny = (loc.y - view.ty) / view.k;
        const p = state.pos[state.dragI];
        if (Math.hypot(nx - p.x, ny - p.y) > 2) state.dragMoved = true;
        p.x = nx; p.y = ny;
        reheat(0.3);
        sync();
        return;
      }
      if (!pan) return;
      const r = svg.getBoundingClientRect();
      if (Math.hypot(ev.clientX - pan.x, ev.clientY - pan.y) > 4) state.panMoved = true;
      view.tx = pan.tx + ((ev.clientX - pan.x) / r.width) * W;
      view.ty = pan.ty + ((ev.clientY - pan.y) / r.height) * H;
      apply();
    });
    const end = () => {
      if (state.dragI != null) {
        const i = state.dragI;
        state.sim.fixed.delete(i);
        state.dragI = null;
        reheat(0.25);
        if (!state.dragMoved) onNodeTap(i); // a tap, not a drag
      }
      pan = null;
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    svg.addEventListener("dblclick", () => { view.k = 1; view.tx = 0; view.ty = 0; apply(); });
  }

  // --- detail panel + on-demand typed relations -----------------------------
  function showDetail(e) {
    detail.className = "graph__detail";
    detail.innerHTML = "";
    detail.append(el("strong", "candidate__surface", e.surface));
    if (e.register) detail.append(el("span", "candidate__register", ` ${e.register}`));
    if (e.gloss_cn) detail.append(el("div", "candidate__gloss", e.gloss_cn));
    if (e.intent_cn) detail.append(el("div", "candidate__intent", `${UI.intentPrefix}${e.intent_cn}`));

    const relBtn = el("button", "btn btn--ghost", UI.findRelations);
    relBtn.addEventListener("click", async () => {
      relBtn.disabled = true; relBtn.textContent = "…";
      try {
        const found = await classifyOne(e.id);
        render();
        showDetail(e);
        if (!found) detail.append(el("div", "muted", "No strong typed relations found among nearby words."));
      } catch (err) {
        alert(err?.message === "NO_KEY" ? UI.findRelationsNoKey : `${UI.findRelationsFail}: ${err.message || err}`);
      } finally {
        relBtn.disabled = false; relBtn.textContent = UI.findRelations;
      }
    });
    detail.append(relBtn);
  }

  // Classify one node's nearest neighbours into typed relations, store the edges,
  // and refresh state.typed. Returns how many relations were found.
  async function classifyOne(id) {
    const self = state.items.find((it) => it.id === id);
    const expr = state.exprs.find((x) => x.id === id);
    const neighbours = state.items
      .filter((it) => it.id !== id)
      .map((it) => ({ it, s: cosine(self.vec, it.vec) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map(({ it }) => {
        const ex = state.exprs.find((x) => x.id === it.id);
        return { id: it.id, surface: ex.surface, gloss_cn: ex.gloss_cn };
      });
    const rels = await findRelations(expr, neighbours);
    const edges = rels.map((r) => ({
      id: `${id}~${r.to}~${r.type}`, from_id: id, to_id: r.to, type: r.type, source: "ai", confidence: r.confidence,
    }));
    if (edges.length) await putEdges(edges);
    const ids = new Set(state.exprs.map((x) => x.id));
    state.typed = (await getEdges()).filter((ed) => ids.has(ed.from_id) && ids.has(ed.to_id));
    return rels.length;
  }

  // --- wiring ---------------------------------------------------------------
  genBtn.addEventListener("click", async () => {
    genBtn.disabled = true;
    try { await generate(await gatherFilter()); }
    finally { genBtn.disabled = false; }
  });

  classifyBtn.addEventListener("click", async () => {
    if (!state.exprs.length) { alert("Generate a graph first."); return; }
    if (!confirm(`Send ${state.exprs.length} AI requests (one per visible node) to classify typed relations? This uses your deep-dive API key.`)) return;
    classifyBtn.disabled = true;
    const label = classifyBtn.textContent;
    try {
      for (let i = 0; i < state.exprs.length; i++) {
        classifyBtn.textContent = `Classifying ${i + 1}/${state.exprs.length}…`;
        try { await classifyOne(state.exprs[i].id); }
        catch (err) {
          if (err?.message === "NO_KEY") { alert(UI.findRelationsNoKey); break; }
          /* skip transient per-node failures, keep going */
        }
      }
      render();
    } finally {
      classifyBtn.disabled = false; classifyBtn.textContent = label;
    }
  });
}
