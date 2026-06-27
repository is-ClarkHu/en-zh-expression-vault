// Capture UI (SPEC §3) — the validation slice. Two entries that both end in a
// Save-button candidate card (§0.2), plus a settings bar for the provider/key
// and a list of what's landed in the vault.
//   Entry A: quick-lookup box  (type CN/EN → filled card, no chat)   §3.1
//   Entry B: Q&A box           (raw line + ask → answer + card(s))    §3.2

import { getSettings, setSetting } from "../ai/settings.js";
import { PROVIDERS } from "../ai/provider.js";
import { quickLookup, askAndExtract, idiomatic } from "../ai/candidate.js";
import { getExpressions, saveExpression, deleteExpression, getExpressionsByTag } from "../db/index.js";
import { speakButton } from "../audio/tts.js";
import { schedulePush } from "../sync/dropbox.js";
import { renderMarkdownInto } from "../ui/markdown.js";
import { UI } from "../ui/strings.js";
import { embedExpression } from "../reassign/index.js";
import { openDetail, closeDetail, isDetailOpen } from "../ui/detail-panel.js";
import { expressionDetail } from "../ui/expression-detail.js";

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

// One candidate card with a Save button (§0.2). onSave gets the candidate and
// is told whether it was the last card so the panel can clear itself.
function candidateCard(candidate, onSave) {
  const card = el("div", "candidate");
  const head = el("div", "candidate__head");
  head.append(el("span", "candidate__surface", candidate.surface));
  head.append(speakButton(candidate.surface));
  if (candidate.pos) head.append(el("span", "candidate__pos", candidate.pos));
  head.append(el("span", "candidate__register", candidate.register));
  if (candidate.sense_key) head.append(el("span", "candidate__sense", candidate.sense_key));
  card.append(head);

  if (candidate.reading) card.append(el("div", "candidate__reading", candidate.reading));
  if (candidate.gloss_cn) card.append(el("div", "candidate__gloss", candidate.gloss_cn));
  if (candidate.intent_cn) card.append(el("div", "candidate__intent", `${UI.intentPrefix}${candidate.intent_cn}`));
  // A same-structure example for phrase/pattern cards, so the pattern's skeleton
  // is visible without repeating the source line.
  if (candidate.example_parallel) card.append(el("div", "candidate__example", `${UI.examplePrefix}${candidate.example_parallel}`));
  if (candidate.topics?.length) card.append(tagRow("topics", candidate.topics));
  if (candidate.intents?.length) card.append(tagRow("intents", candidate.intents));

  const save = el("button", "btn btn--save", "Save");
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      const saved = await saveExpression(candidate);
      embedExpression(saved); // compute this word's vector once (SPEC v2 §11), best-effort
      save.textContent = "Saved ✓";
      schedulePush(); // auto-sync if Dropbox connected
      await onSave?.();
    } catch (e) {
      save.disabled = false;
      save.textContent = "Save failed — retry";
    }
  });
  card.append(save);
  return card;
}

export function mountCapture(root) {
  root.innerHTML = "";

  root.append(el("p", "muted", "Capture — quick-lookup or ask, then Save the cards worth keeping."));

  // --- Settings bar: the enrich provider + its key (per-scenario routing lives
  // on the Dashboard — this is the quick path for the provider capture uses). ---
  const s = getSettings();
  const enrichOf = (st) => (st.scenarioProvider && st.scenarioProvider.enrich) || st.provider || "claude";
  const bar = el("section", "settings-bar");
  const select = el("select", "settings-bar__provider");
  for (const p of PROVIDERS) {
    const opt = el("option", null, p.label);
    opt.value = p.id;
    if (p.id === enrichOf(s)) opt.selected = true;
    select.append(opt);
  }
  const keyInput = el("input", "settings-bar__key");
  keyInput.type = "password";
  keyInput.placeholder = UI.apiKeyPlaceholder;
  keyInput.value = (s.apiKeys && s.apiKeys[enrichOf(s)]) || "";

  select.addEventListener("change", () => {
    const cur = getSettings();
    setSetting("scenarioProvider", { ...cur.scenarioProvider, enrich: select.value });
    keyInput.value = (cur.apiKeys && cur.apiKeys[select.value]) || "";
  });
  keyInput.addEventListener("change", () => {
    const cur = getSettings();
    setSetting("apiKeys", { ...cur.apiKeys, [select.value]: keyInput.value.trim() });
  });
  bar.append(el("span", "settings-bar__label", UI.enrichProvider), select, keyInput);
  root.append(bar);

  // --- The three capture entries ---
  const entries = el("div", "entries");
  entries.append(quickLookupEntry(refreshVault));
  entries.append(qaEntry(refreshVault));
  entries.append(idiomaticEntry(refreshVault));
  root.append(entries);

  // --- Recent grid (what Save lands in) — a BOUNDED set of the latest cards, not
  // the whole history (v3 §6a); fixed-size cards that open the shared detail panel
  // on click instead of dead one-liners (§6c, §12). Browse everything in Retrieve. ---
  const RECENT_LIMIT = 12;
  const vaultSection = el("section", "vault");
  vaultSection.append(el("h2", null, "Recent"));
  const vaultList = el("div", "card-grid");
  const vaultMore = el("p", "muted");
  vaultSection.append(vaultList, vaultMore);
  root.append(vaultSection);

  let selectedEl = null;

  // Open the full detail of a saved expression in the side panel / bottom sheet.
  function openExpr(expr, cardEl) {
    selectedEl?.classList.remove("grid-card--on");
    selectedEl = cardEl;
    cardEl.classList.add("grid-card--on");
    const body = el("div");
    body.append(expressionDetail(expr));
    const del = el("button", "btn btn--ghost", "Delete");
    del.style.marginTop = "var(--s4)";
    del.addEventListener("click", async () => {
      await deleteExpression(expr.id);
      schedulePush(); // propagate the delete (tombstone) if connected
      closeDetail();
      refreshVault();
    });
    body.append(del);
    openDetail(body, {
      title: expr.surface,
      onClose: () => {
        selectedEl?.classList.remove("grid-card--on");
        selectedEl = null;
      },
    });
  }

  async function refreshVault() {
    const all = await getExpressions();
    vaultList.innerHTML = "";
    vaultMore.textContent = "";
    if (!all.length) {
      if (isDetailOpen()) closeDetail();
      vaultList.append(el("p", "muted", "Nothing saved yet. Look up or ask, then tap Save."));
      return;
    }
    const rows = all.slice(0, RECENT_LIMIT); // bounded recent set (v3 §6a)
    if (all.length > RECENT_LIMIT)
      vaultMore.textContent = `Showing the ${RECENT_LIMIT} most recent of ${all.length} — browse all by topic/intent in Retrieve.`;
    for (const r of rows) {
      const card = el("div", "grid-card");
      const head = el("div", "candidate__head");
      head.append(el("span", "candidate__surface", r.surface));
      head.append(speakButton(r.surface));
      if (r.register) head.append(el("span", "candidate__register", r.register));
      card.append(head);
      if (r.gloss_cn) card.append(el("div", "candidate__gloss", r.gloss_cn));
      if (r.intents?.length) card.append(tagRow(null, r.intents));
      card.addEventListener("click", (e) => {
        if (e.target.closest("button")) return; // let the speak button work
        openExpr(r, card);
      });
      vaultList.append(card);
    }
  }
  refreshVault();
}

// Shared status/result rendering for an entry panel.
function makeOutput() {
  const out = el("div", "entry__out");
  return {
    node: out,
    status(msg, cls = "muted") {
      out.innerHTML = "";
      out.append(el("p", cls, msg));
    },
    clear() {
      out.innerHTML = "";
    },
    render(nodes) {
      out.innerHTML = "";
      for (const n of nodes) out.append(n);
    },
  };
}

function errMessage(e) {
  if (e?.message === "NO_KEY") return "Add your provider API key in the bar above first.";
  return `Error: ${e?.message || e}`;
}

// Re-encounter on use (SPEC §6.2): surface expressions you've ALREADY saved that
// share an intent with what you just looked up — you meet them again at the very
// moment you'd reach for them. Returns a node, or null if there's nothing yet.
async function relatedBlock(candidates) {
  const intents = [...new Set(candidates.flatMap((c) => c.intents || []))];
  if (!intents.length) return null;
  const seen = new Map();
  for (const it of intents) for (const e of await getExpressionsByTag("intent", it)) seen.set(e.id, e);
  const rows = [...seen.values()];
  if (!rows.length) return null;
  const box = el("div", "related");
  box.append(el("div", "entry__cards-label", UI.relatedLabel));
  for (const e of rows.slice(0, 10)) {
    const r = el("div", "related__item");
    r.append(el("span", "related__surface", e.surface));
    r.append(speakButton(e.surface));
    if (e.gloss_cn) r.append(el("span", "vault__gloss", e.gloss_cn));
    box.append(r);
  }
  return box;
}

// Entry A — quick-lookup (§3.1).
function quickLookupEntry(onSave) {
  const panel = el("section", "entry");
  panel.append(el("h2", null, "Quick-lookup"));
  panel.append(el("p", "muted", "Expand vocabulary. Type Chinese or English — get one filled card."));

  const form = el("form", "entry__form");
  const input = el("input", "entry__input");
  input.placeholder = UI.quickLookupPlaceholder;
  const go = el("button", "btn", "Look up");
  go.type = "submit";
  form.append(input, go);
  panel.append(form);

  const out = makeOutput();
  panel.append(out.node);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const term = input.value.trim();
    if (!term) return;
    out.status("Looking up…");
    go.disabled = true;
    try {
      const { candidates } = await quickLookup(term);
      if (!candidates.length) return out.status("No candidate returned. Try rephrasing.");
      const nodes = candidates.map((c) => candidateCard(c, onSave));
      const rel = await relatedBlock(candidates);
      if (rel) nodes.push(rel);
      out.render(nodes);
    } catch (err) {
      out.status(errMessage(err), "error");
    } finally {
      go.disabled = false;
    }
  });
  return panel;
}

// Entry B — Q&A (§3.2).
function qaEntry(onSave) {
  const panel = el("section", "entry");
  panel.append(el("h2", null, "Q&A"));
  panel.append(el("p", "muted", "Don't understand something? Drop the raw line and ask — get an explanation + card(s)."));

  const form = el("form", "entry__form entry__form--col");
  const raw = el("textarea", "entry__textarea");
  raw.placeholder = UI.qaSourcePlaceholder;
  raw.rows = 2;
  const ask = el("input", "entry__input");
  ask.placeholder = UI.qaQuestionPlaceholder;
  const go = el("button", "btn", "Ask");
  go.type = "submit";
  form.append(raw, ask, go);
  panel.append(form);

  const out = makeOutput();
  panel.append(out.node);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = raw.value.trim();
    if (!input) return;
    out.status("Asking…");
    go.disabled = true;
    try {
      const { answer, candidates } = await askAndExtract(input, ask.value.trim());
      const nodes = [];
      if (answer) {
        const a = el("div", "answer");
        a.append(el("div", "answer__label", "Answer"));
        a.append(renderMarkdownInto(el("div", "answer__body"), answer));
        nodes.push(a);
      }
      if (candidates.length) {
        nodes.push(el("div", "entry__cards-label", "Keep-worthy:"));
        nodes.push(...candidates.map((c) => candidateCard(c, onSave)));
      } else {
        nodes.push(el("p", "muted", "No keep-worthy expression extracted."));
      }
      const rel = await relatedBlock(candidates);
      if (rel) nodes.push(rel);
      out.render(nodes);
    } catch (err) {
      out.status(errMessage(err), "error");
    } finally {
      go.disabled = false;
    }
  });
  return panel;
}

// Entry C — idiomatic box (§5). Type a Chinese intent → idiomatic English
// renderings (ranked, with register + nuance note) plus keyword candidate cards.
function idiomaticEntry(onSave) {
  const panel = el("section", "entry entry--wide");
  panel.append(el("h2", null, "Idiomatic"));
  panel.append(el("p", "muted", "Know the Chinese but not the natural English? Type the intent — get idiomatic renderings + keyword cards."));

  const form = el("form", "entry__form entry__form--col");
  const raw = el("textarea", "entry__textarea");
  raw.placeholder = UI.idiomaticPlaceholder;
  raw.rows = 2;
  const go = el("button", "btn", UI.idiomaticButton);
  go.type = "submit";
  form.append(raw, go);
  panel.append(form);

  const out = makeOutput();
  panel.append(out.node);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = raw.value.trim();
    if (!input) return;
    out.status("Working…");
    go.disabled = true;
    try {
      const { renderings, candidates } = await idiomatic(input);
      const nodes = [];
      if (renderings.length) {
        const box = el("div", "renderings");
        box.append(el("div", "entry__cards-label", "Idiomatic renderings:"));
        for (const r of renderings) {
          const item = el("div", "rendering");
          const line = el("div", "rendering__line");
          line.append(el("span", "rendering__en", r.en));
          line.append(speakButton(r.en));
          if (r.register) line.append(el("span", "candidate__register", r.register));
          item.append(line);
          if (r.note_cn) item.append(el("div", "rendering__note", r.note_cn));
          box.append(item);
        }
        nodes.push(box);
      }
      if (candidates.length) {
        nodes.push(el("div", "entry__cards-label", "Keyword cards:"));
        nodes.push(...candidates.map((c) => candidateCard(c, onSave)));
      }
      if (!nodes.length) return out.status("No renderings returned. Try rephrasing.");
      const rel = await relatedBlock(candidates);
      if (rel) nodes.push(rel);
      out.render(nodes);
    } catch (err) {
      out.status(errMessage(err), "error");
    } finally {
      go.disabled = false;
    }
  });
  return panel;
}
