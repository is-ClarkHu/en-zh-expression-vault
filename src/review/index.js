// Review (SPEC v2 §4) — borrows jp-flashcard's interaction patterns (flip cards,
// self-test, a wrong-item book, simple progress) WITHOUT the coercive SRS: no
// due-date queue, no streaks, no mastery gating. Self-test just shuffles the set
// you pick; answering nudges a lightweight wrong-book counter (db.markReview).
// "Re-encounter on use" stays the passive complement (it lives in retrieve/).
//
//   Browse     no-pressure flip + shuffle, filterable by tag
//   Self-test  recall → flip to check → Known / Unknown, with progress
//   Wrong book the items you've missed, to re-test or clear

import { getExpressions, getTags, getExpressionsByTag, markReview } from "../db/index.js";
import { speakButton } from "../audio/tts.js";
import { openDetail } from "../ui/detail-panel.js";
import { expressionDetail } from "../ui/expression-detail.js";
import { UI } from "../ui/strings.js";

// Reading (pronunciation) visibility is a session toggle shared across cards,
// like jp-flashcard's reading on/off (v3 §2d). Off by default for recall.
let showReading = false;

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

// The "front" of a card — just the surface (+ pos/register), the prompt to recall.
function surfaceFace(expr) {
  const face = el("div", "flip__content");
  const head = el("div", "review-card__front");
  head.append(el("span", "review-card__surface", expr.surface));
  head.append(speakButton(expr.surface));
  if (expr.pos) head.append(el("span", "candidate__pos", expr.pos));
  if (expr.register) head.append(el("span", "candidate__register", expr.register));
  face.append(head);
  return face;
}

// The "meaning" side — reading (when toggled on), gloss, intent, examples, tags.
// Deep-dive + note now live OFF the card in the detail panel (v3 §2b), opened
// with the Details control / D key.
function meaningFace(expr) {
  const face = el("div", "flip__content flip__content--meaning");
  if (showReading && expr.reading) face.append(el("div", "candidate__reading", expr.reading));
  if (expr.gloss_cn) face.append(el("div", "candidate__gloss", expr.gloss_cn));
  if (expr.intent_cn) face.append(el("div", "candidate__intent", `${UI.intentPrefix}${expr.intent_cn}`));
  if (expr.example_src && expr.example_src.trim() && expr.example_src.trim() !== expr.surface)
    face.append(el("div", "candidate__example", `“${expr.example_src}”`));
  if (expr.example_parallel) face.append(el("div", "candidate__example", `${UI.examplePrefix}${expr.example_parallel}`));
  if (expr.topics?.length) face.append(tagRow("topics", expr.topics));
  if (expr.intents?.length) face.append(tagRow("intents", expr.intents));
  return face;
}

// A 3D flip card. front/back are nodes. Returns { element, flip, reset, flipped,
// fit }. fit() sizes the card to its taller face (must be in the DOM first).
function createFlip(frontNode, backNode) {
  const root = el("div", "flip");
  const inner = el("div", "flip__inner");
  const f = el("div", "flip__face flip__face--front");
  const b = el("div", "flip__face flip__face--back");
  f.append(frontNode);
  b.append(backNode);
  inner.append(f, b);
  root.append(inner);
  const api = {
    element: root,
    flipped: false,
    fit() {
      /* fixed-size card now (v3 §2a): height comes from CSS, faces scroll. */
    },
    flip() {
      api.flipped = !api.flipped;
      root.classList.toggle("flip--on", api.flipped);
    },
    reset() {
      api.flipped = false;
      root.classList.remove("flip--on");
    },
  };
  return api;
}

export async function mountReview(root) {
  root.innerHTML = "";
  root.append(el("p", "muted", "Browse, self-test, or work your wrong book. No scores to chase, no schedule — memory sinks in through use."));

  // shared tag filter
  const [topicTags, intentTags] = await Promise.all([getTags("topic"), getTags("intent")]);
  const controls = el("div", "graph-controls");
  const modeSel = el("select");
  for (const [v, label] of [["browse", "Browse"], ["test", "Self-test"], ["wrong", "Wrong book"]]) {
    const o = el("option", null, label);
    o.value = v;
    modeSel.append(o);
  }
  // Scope filter: pick an axis, THEN a tag — instead of one flat dropdown listing
  // every topic+intent tag, which only grows (v3 feedback). Each list stays short
  // and the tag list loads only when an axis is chosen.
  const scopeSel = el("select");
  for (const [v, label] of [["", "All expressions"], ["topic", "By topic"], ["intent", "By intent"]]) {
    const o = el("option", null, label);
    o.value = v;
    scopeSel.append(o);
  }
  const tagSel = el("select", "review__filter");
  function fillTags() {
    tagSel.innerHTML = "";
    const tags = (scopeSel.value === "topic" ? topicTags : scopeSel.value === "intent" ? intentTags : [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const t of tags) {
      const o = el("option", null, `${t.name} (${t.member_ids.length})`);
      o.value = t.name;
      tagSel.append(o);
    }
  }
  controls.append(el("span", "settings-bar__label", "Mode"), modeSel, scopeSel, tagSel);
  root.append(controls);

  const stage = el("div", "review__stage");
  root.append(stage);

  let teardown = null;
  async function poolFromFilter() {
    const axis = scopeSel.value;
    if (!axis || !tagSel.value) return getExpressions();
    return getExpressionsByTag(axis, tagSel.value);
  }

  async function render() {
    teardown?.();
    teardown = null;
    stage.innerHTML = "";
    const mode = modeSel.value;
    const showFilter = mode !== "wrong";
    scopeSel.style.display = showFilter ? "" : "none";
    tagSel.style.display = showFilter && scopeSel.value ? "" : "none";
    if (mode === "browse") teardown = await renderBrowse(stage, await poolFromFilter());
    else if (mode === "test") teardown = await renderTest(stage, await poolFromFilter());
    else teardown = await renderWrong(stage);
  }
  modeSel.addEventListener("change", render);
  scopeSel.addEventListener("change", () => { fillTags(); render(); });
  tagSel.addEventListener("change", render);
  render();
}

// --- Browse: a calm sequential deck — flip, prev/next, shuffle, reading toggle,
// details — with jp-flashcard hotkeys (Space/Enter flip · ←/→ prev/next ·
// S shuffle · R reading · D details). Deep-dive lives in the detail panel (§2b).
async function renderBrowse(stage, pool) {
  if (!pool.length) {
    stage.append(el("p", "muted", "Nothing here yet — save some expressions first."));
    return null;
  }
  let order = pool.slice();
  let idx = 0;

  const slot = el("div");
  const controls = el("div", "review__controls");
  const prev = el("button", "btn btn--ghost", "← Prev");
  const flipBtn = el("button", "btn", "Flip");
  const next = el("button", "btn btn--ghost", "Next →");
  const shuffleBtn = el("button", "btn btn--ghost", "Shuffle");
  const readingBtn = el("button", "btn btn--ghost");
  const detailsBtn = el("button", "btn btn--ghost", "Details");
  prev.disabled = next.disabled = order.length < 2;
  const readingLabel = () => (showReading ? "Reading: on" : "Reading: off");
  readingBtn.textContent = readingLabel();
  readingBtn.classList.toggle("btn--active", showReading);
  controls.append(prev, flipBtn, next, shuffleBtn, readingBtn, detailsBtn);

  const count = el("div", "review-card__hint");
  const hint = el("p", "review-card__hint", "Space: flip · ← prev · → next · S shuffle · R reading · D details");
  stage.append(count, slot, controls, hint);

  let card = null;
  function draw() {
    const expr = order[idx];
    slot.innerHTML = "";
    card = createFlip(surfaceFace(expr), meaningFace(expr));
    card.element.addEventListener("click", (e) => {
      if (e.target.closest("button")) return; // let the speak button work
      card.flip();
    });
    slot.append(card.element);
    count.textContent = `${idx + 1} / ${order.length}`;
  }
  const go = (d) => { idx = (idx + d + order.length) % order.length; draw(); };
  const openDetails = () => openDetail(expressionDetail(order[idx]), { title: order[idx].surface });

  prev.addEventListener("click", () => go(-1));
  next.addEventListener("click", () => go(1));
  flipBtn.addEventListener("click", () => card?.flip());
  detailsBtn.addEventListener("click", openDetails);
  shuffleBtn.addEventListener("click", () => {
    const cur = order[idx];
    order = shuffle(order);
    idx = Math.max(0, order.indexOf(cur));
    draw();
  });
  readingBtn.addEventListener("click", () => {
    showReading = !showReading;
    readingBtn.textContent = readingLabel();
    readingBtn.classList.toggle("btn--active", showReading);
    draw(); // re-render the current card with/without the reading line
  });

  const onKey = (e) => {
    if (e.target.matches("input, textarea, select")) return;
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); card?.flip(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    else if (e.key === "s" || e.key === "S") shuffleBtn.click();
    else if (e.key === "r" || e.key === "R") readingBtn.click();
    else if (e.key === "d" || e.key === "D") openDetails();
  };
  document.addEventListener("keydown", onKey);
  draw();
  return () => document.removeEventListener("keydown", onKey);
}

// --- Self-test: recall → reveal → Known / Unknown --------------------------
async function renderTest(stage, pool) {
  if (!pool.length) {
    stage.append(el("p", "muted", "Nothing to test — save some expressions first."));
    return null;
  }
  let queue = shuffle(pool);
  let index = 0, known = 0, unknown = 0;
  const missed = [];

  const progress = el("div", "review__progress");
  const fill = el("div", "review__progress-fill");
  progress.append(fill);
  const score = el("div", "muted");
  const slot = el("div");
  const actions = el("div", "review__controls");
  const hint = el("p", "review-card__hint", "Space: flip · ← Unknown · → Known");
  stage.append(progress, score, slot, actions, hint);

  let card = null, revealed = false;

  function update() {
    score.textContent = `✓ ${known}  ✗ ${unknown} · ${index}/${queue.length}`;
    fill.style.width = `${(index / queue.length) * 100}%`;
  }
  function reveal() {
    if (!card || revealed) return;
    revealed = true;
    card.flip();
    card.fit();
    renderActions();
  }
  function renderActions() {
    actions.innerHTML = "";
    if (!revealed) {
      const show = el("button", "btn", "Reveal");
      show.addEventListener("click", reveal);
      actions.append(show);
      return;
    }
    const forgot = el("button", "btn btn--ghost", "✗ Forgot");
    const got = el("button", "btn", "✓ Got it");
    forgot.addEventListener("click", () => answer("unknown"));
    got.addEventListener("click", () => answer("known"));
    actions.append(forgot, got);
  }
  async function answer(result) {
    const expr = queue[index];
    if (result === "known") known++;
    else {
      unknown++;
      missed.push(expr);
    }
    await markReview(expr.id, result);
    index++;
    revealed = false;
    if (index >= queue.length) return finish();
    draw();
  }
  function draw() {
    slot.innerHTML = "";
    const expr = queue[index];
    card = createFlip(surfaceFace(expr), meaningFace(expr));
    card.element.addEventListener("click", (e) => {
      if (e.target.closest(".deepdive, button")) return;
      if (!revealed) reveal();
    });
    slot.append(card.element);
    card.fit();
    renderActions();
    update();
  }
  function finish() {
    slot.innerHTML = "";
    actions.innerHTML = "";
    fill.style.width = "100%";
    score.textContent = `✓ ${known}  ✗ ${unknown} · done`;
    const done = el("div", "review-card");
    done.append(el("div", "review-card__surface", "Round done"));
    done.append(el("p", "muted", `Got it: ${known} · Missed: ${unknown}. Misses go to your wrong book.`));
    slot.append(done);
    const again = el("button", "btn btn--ghost", "Shuffle again");
    again.addEventListener("click", () => {
      queue = shuffle(pool);
      index = known = unknown = 0;
      missed.length = 0;
      draw();
    });
    actions.append(again);
    if (missed.length) {
      const retest = el("button", "btn", `Retest ${missed.length} missed`);
      retest.addEventListener("click", () => {
        queue = shuffle(missed.slice());
        index = known = unknown = 0;
        missed.length = 0;
        draw();
      });
      actions.append(retest);
    }
  }

  const onKey = (e) => {
    if (e.key === " ") { e.preventDefault(); reveal(); }
    else if (revealed && e.key === "ArrowLeft") answer("unknown");
    else if (revealed && e.key === "ArrowRight") answer("known");
  };
  document.addEventListener("keydown", onKey);
  draw();
  return () => document.removeEventListener("keydown", onKey);
}

// --- Wrong book: the items you've missed ------------------------------------
async function renderWrong(stage) {
  const all = await getExpressions();
  const wrong = all
    .filter((e) => (e.srs_state?.wrong || 0) > 0)
    .sort((a, b) => (b.srs_state?.last_seen || 0) - (a.srs_state?.last_seen || 0));

  stage.append(el("div", "results__head", `Wrong book — ${wrong.length}`));
  if (!wrong.length) {
    stage.append(el("p", "muted", "Empty — nothing you've missed in self-test. Miss a card and it lands here."));
    return null;
  }
  const test = el("button", "btn", "Self-test these");
  test.addEventListener("click", () => {
    stage.innerHTML = "";
    renderTest(stage, wrong);
  });
  stage.append(test);

  const list = el("div", "results");
  for (const expr of wrong) {
    const card = el("div", "candidate");
    const head = el("div", "candidate__head");
    head.append(el("span", "candidate__surface", expr.surface));
    head.append(speakButton(expr.surface));
    head.append(el("span", "candidate__register", `missed ×${expr.srs_state.wrong}`));
    card.append(head);
    if (expr.gloss_cn) card.append(el("div", "candidate__gloss", expr.gloss_cn));
    const clear = el("button", "btn btn--ghost", "Mark known");
    clear.addEventListener("click", async () => {
      await markReview(expr.id, "known");
      renderWrong((stage.innerHTML = "", stage)); // re-render the wrong book
    });
    card.append(clear);
    list.append(card);
  }
  stage.append(list);
  return null;
}
