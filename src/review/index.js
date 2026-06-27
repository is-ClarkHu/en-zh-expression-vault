// Review (SPEC §6.2) — light, deliberately NOT Anki. No SRS, no timing, no
// mastery score, no wrong-book. Memory sinks in through use, not drilling.
//   Casual browse: a no-pressure shuffle, filterable by tag.
// (Re-encounter-on-use, the other §6.2 mechanism, lives in retrieve/ — meeting a
// saved expression again at the moment you'd reach for it.)

import { getExpressions, getTags, getExpressionsByTag } from "../db/index.js";
import { speakButton, speak } from "../audio/tts.js";
import { deepDiveControl } from "../ui/deepdive.js";

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

export async function mountReview(root) {
  root.innerHTML = "";
  root.append(el("p", "muted", "Casual browse — tap a card to reveal, Next to shuffle. No scores, no schedule."));

  // Tag filter: "All" + every topic/intent tag (with counts).
  const [topicTags, intentTags] = await Promise.all([getTags("topic"), getTags("intent")]);
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
  root.append(filter);

  const stage = el("div", "review__stage");
  const controls = el("div", "review__controls");
  const next = el("button", "btn", "Next ↻");
  controls.append(next);
  root.append(stage, controls);

  let pool = [];
  let lastId = null;

  async function loadPool() {
    const v = filter.value;
    if (!v) pool = await getExpressions();
    else {
      const [axis, name] = [v.slice(0, v.indexOf(":")), v.slice(v.indexOf(":") + 1)];
      pool = await getExpressionsByTag(axis, name);
    }
    lastId = null;
    draw();
  }

  function pick() {
    if (pool.length <= 1) return pool[0];
    let e;
    do {
      e = pool[Math.floor(Math.random() * pool.length)];
    } while (e.id === lastId);
    return e;
  }

  function draw() {
    stage.innerHTML = "";
    if (!pool.length) {
      stage.append(el("p", "muted", "Nothing here yet — save some expressions first."));
      next.disabled = true;
      return;
    }
    next.disabled = pool.length < 2;
    const expr = pick();
    lastId = expr.id;

    // Click to reveal: front = surface; back = meaning + tags.
    const card = el("div", "review-card");
    const front = el("div", "review-card__front");
    front.append(el("span", "review-card__surface", expr.surface));
    front.append(speakButton(expr.surface));
    if (expr.pos) front.append(el("span", "candidate__pos", expr.pos));
    if (expr.register) front.append(el("span", "candidate__register", expr.register));
    const hint = el("div", "review-card__hint", "tap to reveal");

    const back = el("div", "review-card__back");
    if (expr.reading) back.append(el("div", "candidate__reading", expr.reading));
    if (expr.gloss_cn) back.append(el("div", "candidate__gloss", expr.gloss_cn));
    if (expr.intent_cn) back.append(el("div", "candidate__intent", `意图：${expr.intent_cn}`));
    if (expr.sense_key) back.append(el("div", "muted", expr.sense_key));
    if (expr.topics?.length) back.append(tagRow("topics", expr.topics));
    if (expr.intents?.length) back.append(tagRow("intents", expr.intents));
    if (expr.example_src) back.append(el("div", "review-card__src", `"${expr.example_src}"`));
    if (expr.example_parallel) back.append(el("div", "candidate__example", `例：${expr.example_parallel}`));
    back.append(deepDiveControl(expr, { persist: true }));

    card.append(front, hint, back);
    card.addEventListener("click", () => {
      card.classList.add("review-card--revealed");
      hint.remove();
    });
    stage.append(card);
  }

  filter.addEventListener("change", loadPool);
  next.addEventListener("click", draw);
  loadPool();
}
