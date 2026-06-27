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
import { deepDiveControl } from "../ui/deepdive.js";
import { UI } from "../ui/strings.js";

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

// The "meaning" side — reading, gloss, intent, examples, tags, deep-dive.
function meaningFace(expr) {
  const face = el("div", "flip__content flip__content--meaning");
  if (expr.reading) face.append(el("div", "candidate__reading", expr.reading));
  if (expr.gloss_cn) face.append(el("div", "candidate__gloss", expr.gloss_cn));
  if (expr.intent_cn) face.append(el("div", "candidate__intent", `${UI.intentPrefix}${expr.intent_cn}`));
  if (expr.example_src && expr.example_src.trim() && expr.example_src.trim() !== expr.surface)
    face.append(el("div", "candidate__example", `“${expr.example_src}”`));
  if (expr.example_parallel) face.append(el("div", "candidate__example", `${UI.examplePrefix}${expr.example_parallel}`));
  if (expr.topics?.length) face.append(tagRow("topics", expr.topics));
  if (expr.intents?.length) face.append(tagRow("intents", expr.intents));
  face.append(deepDiveControl(expr, { persist: true }));
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
      root.style.height = `${Math.max(f.scrollHeight, b.scrollHeight)}px`;
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
  const filter = el("select", "review__filter");
  const optAll = el("option", null, "All expressions");
  optAll.value = "";
  filter.append(optAll);
  for (const [axis, tags] of [["topic", topicTags], ["intent", intentTags]]) {
    for (const t of tags) {
      const o = el("option", null, `${axis}: ${t.name} (${t.member_ids.length})`);
      o.value = `${axis}:${t.name}`;
      filter.append(o);
    }
  }
  controls.append(el("span", "settings-bar__label", "Mode"), modeSel, filter);
  root.append(controls);

  const stage = el("div", "review__stage");
  root.append(stage);

  let teardown = null;
  async function poolFromFilter() {
    const v = filter.value;
    if (!v) return getExpressions();
    const [axis, name] = [v.slice(0, v.indexOf(":")), v.slice(v.indexOf(":") + 1)];
    return getExpressionsByTag(axis, name);
  }

  async function render() {
    teardown?.();
    teardown = null;
    stage.innerHTML = "";
    const mode = modeSel.value;
    filter.style.display = mode === "wrong" ? "none" : "";
    if (mode === "browse") teardown = await renderBrowse(stage, await poolFromFilter());
    else if (mode === "test") teardown = await renderTest(stage, await poolFromFilter());
    else teardown = await renderWrong(stage);
  }
  modeSel.addEventListener("change", render);
  filter.addEventListener("change", render);
  render();
}

// --- Browse: flip + shuffle (the calm default) -----------------------------
async function renderBrowse(stage, pool) {
  if (!pool.length) {
    stage.append(el("p", "muted", "Nothing here yet — save some expressions first."));
    return null;
  }
  let lastId = null;
  const slot = el("div");
  const controls = el("div", "review__controls");
  const next = el("button", "btn", "Next ↻");
  next.disabled = pool.length < 2;
  controls.append(next);
  stage.append(slot, controls);

  function pick() {
    if (pool.length <= 1) return pool[0];
    let e;
    do {
      e = pool[Math.floor(Math.random() * pool.length)];
    } while (e.id === lastId);
    return e;
  }
  function draw() {
    const expr = pick();
    lastId = expr.id;
    slot.innerHTML = "";
    const card = createFlip(surfaceFace(expr), meaningFace(expr));
    const hint = el("div", "review-card__hint", "tap to flip");
    card.element.addEventListener("click", (e) => {
      if (e.target.closest(".deepdive, button")) return; // let deep-dive / speak work
      card.flip();
      hint.textContent = card.flipped ? "tap to flip back" : "tap to flip";
      card.fit();
    });
    slot.append(card.element, hint);
    card.fit();
  }
  next.addEventListener("click", draw);
  draw();
  return null;
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
  const hint = el("p", "review-card__hint", "Space: flip · ← forgot · → got it");
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
