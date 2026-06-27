// Capture UI (SPEC §3) — the validation slice. Two entries that both end in a
// Save-button candidate card (§0.2), plus a settings bar for the provider/key
// and a list of what's landed in the vault.
//   Entry A: quick-lookup box  (type CN/EN → filled card, no chat)   §3.1
//   Entry B: Q&A box           (raw line + ask → answer + card(s))    §3.2

import { getSettings, setSetting } from "../ai/settings.js";
import { PROVIDERS } from "../ai/provider.js";
import { quickLookup, askAndExtract } from "../ai/candidate.js";
import { getExpressions, saveExpression, deleteExpression } from "../db/index.js";
import { speakButton } from "../audio/tts.js";
import { schedulePush } from "../sync/dropbox.js";
import { renderMarkdownInto } from "../ui/markdown.js";

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
  if (candidate.intent_cn) card.append(el("div", "candidate__intent", `意图：${candidate.intent_cn}`));
  // A same-structure example for phrase/pattern cards, so the pattern's skeleton
  // is visible without repeating the source line.
  if (candidate.example_parallel) card.append(el("div", "candidate__example", `例：${candidate.example_parallel}`));
  if (candidate.topics?.length) card.append(tagRow("topics", candidate.topics));
  if (candidate.intents?.length) card.append(tagRow("intents", candidate.intents));

  const save = el("button", "btn btn--save", "Save");
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      await saveExpression(candidate);
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

  // --- Settings bar: provider + key (local only) ---
  const s = getSettings();
  const bar = el("section", "settings-bar");
  const select = el("select", "settings-bar__provider");
  for (const p of PROVIDERS) {
    const opt = el("option", null, p.label);
    opt.value = p.id;
    if (p.id === s.provider) opt.selected = true;
    select.append(opt);
  }
  const keyInput = el("input", "settings-bar__key");
  keyInput.type = "password";
  keyInput.placeholder = "API key (stored on-device only)";
  keyInput.value = (s.apiKeys && s.apiKeys[s.provider]) || "";

  select.addEventListener("change", () => {
    setSetting("provider", select.value);
    const cur = getSettings();
    keyInput.value = (cur.apiKeys && cur.apiKeys[select.value]) || "";
  });
  keyInput.addEventListener("change", () => {
    const cur = getSettings();
    setSetting("apiKeys", { ...cur.apiKeys, [select.value]: keyInput.value.trim() });
  });
  bar.append(el("span", "settings-bar__label", "Provider"), select, keyInput);
  root.append(bar);

  // --- The two capture entries ---
  const entries = el("div", "entries");
  entries.append(quickLookupEntry(refreshVault));
  entries.append(qaEntry(refreshVault));
  root.append(entries);

  // --- Vault list (what Save lands in) ---
  const vaultSection = el("section", "vault");
  vaultSection.append(el("h2", null, "Vault"));
  const vaultList = el("div", "vault__list");
  vaultSection.append(vaultList);
  root.append(vaultSection);

  async function refreshVault() {
    const rows = await getExpressions();
    vaultList.innerHTML = "";
    if (!rows.length) {
      vaultList.append(el("p", "muted", "Nothing saved yet. Look up or ask, then tap Save."));
      return;
    }
    for (const r of rows) {
      const item = el("div", "vault__item");
      const main = el("div");
      main.append(el("span", "vault__surface", r.surface));
      main.append(speakButton(r.surface));
      if (r.gloss_cn) main.append(el("span", "vault__gloss", r.gloss_cn));
      if (r.intents?.length) main.append(tagRow(null, r.intents));
      item.append(main);
      const del = el("button", "btn btn--ghost", "✕");
      del.title = "Delete";
      del.addEventListener("click", async () => {
        await deleteExpression(r.id);
        schedulePush(); // propagate the delete (tombstone) if connected
        refreshVault();
      });
      item.append(del);
      vaultList.append(item);
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

// Entry A — quick-lookup (§3.1).
function quickLookupEntry(onSave) {
  const panel = el("section", "entry");
  panel.append(el("h2", null, "Quick-lookup"));
  panel.append(el("p", "muted", "Expand vocabulary. Type Chinese or English — get one filled card."));

  const form = el("form", "entry__form");
  const input = el("input", "entry__input");
  input.placeholder = '例如 "紫苏" 或 "perilla"';
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
      out.render(candidates.map((c) => candidateCard(c, onSave)));
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
  raw.placeholder = '原文，例如 "He got absolutely shredded this year"';
  raw.rows = 2;
  const ask = el("input", "entry__input");
  ask.placeholder = "你的问题（可留空）";
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
      out.render(nodes);
    } catch (err) {
      out.status(errMessage(err), "error");
    } finally {
      go.disabled = false;
    }
  });
  return panel;
}
