// Settings (SPEC v3 §8) — the one place every bit of config lives, instead of
// scattered across capture and the dashboard:
//   Appearance      light / dark / auto
//   Language        UI English by default (toggle reserved)
//   Providers       per-provider keys + per-scenario routing + embedding
//   Pronunciation   en-US voice + rate + reading-on default
//   Organize        one-click reassign / re-cluster (preview → apply)
//   Sync            Dropbox connect/status + manual export/import
// Each block reuses the existing control-bar styling for consistency.

import { exportVault, importVault } from "../db/index.js";
import { getSettings, setSetting } from "../ai/settings.js";
import { isConnected, beginAuth, disconnect, syncNow, redirectUri, schedulePush } from "../sync/dropbox.js";
import { enUSVoices, speak, isSupported as ttsSupported } from "../audio/tts.js";
import { buildReassignPlan, applyReassignPlan, wordsAddedSince } from "../reassign/index.js";
import { PROVIDERS, SCENARIOS, EMBED_PROVIDERS } from "../ai/provider.js";
import { setTheme } from "../ui/theme.js";

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function section(title, hint, node) {
  const s = el("section", "settings__group");
  s.append(el("h2", null, title));
  if (hint) s.append(el("p", "muted", hint));
  if (node) s.append(node);
  return s;
}

// --- Appearance ------------------------------------------------------------
function appearanceBar() {
  const bar = el("div", "settings-bar");
  bar.append(el("span", "settings-bar__label", "Theme"));
  const sel = el("select", "settings-bar__provider");
  for (const [v, label] of [["auto", "Auto (match system)"], ["light", "Light"], ["dark", "Dark"]]) {
    const o = el("option", null, label);
    o.value = v;
    if ((getSettings().theme || "auto") === v) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener("change", () => setTheme(sel.value));
  bar.append(sel);
  return bar;
}

// --- Language --------------------------------------------------------------
function languageBar() {
  const bar = el("div", "settings-bar");
  bar.append(el("span", "settings-bar__label", "UI language"));
  const sel = el("select", "settings-bar__provider");
  const o = el("option", null, "English");
  o.value = "en";
  o.selected = true;
  sel.append(o);
  sel.disabled = true; // English-only for now; content stays in its own language
  bar.append(sel, el("span", "muted", "Inherently-Chinese content (glosses, your notes) keeps its language."));
  return bar;
}

// --- Providers + routing ---------------------------------------------------
function providersPanel() {
  const wrap = el("section", "settings-bar");
  wrap.append(el("span", "sync-bar__label", "Providers"));
  const grid = el("div", "providers");

  grid.append(el("h3", null, "Keys"));
  for (const p of PROVIDERS) {
    const row = el("div", "providers__row");
    row.append(el("label", "providers__label", p.label));
    const inp = el("input");
    inp.type = "password";
    inp.placeholder = `${p.label} API key`;
    inp.value = (getSettings().apiKeys || {})[p.id] || "";
    inp.addEventListener("change", () => {
      const cur = getSettings();
      setSetting("apiKeys", { ...cur.apiKeys, [p.id]: inp.value.trim() });
    });
    row.append(inp);
    grid.append(row);
  }

  const routeRow = (label, current, list, defaultLabel, onChange) => {
    const row = el("div", "providers__row");
    row.append(el("label", "providers__label", label));
    const sel = el("select");
    if (defaultLabel) {
      const o = el("option", null, defaultLabel);
      o.value = "";
      sel.append(o);
    }
    for (const p of list) {
      const o = el("option", null, p.label);
      o.value = p.id;
      if (p.id === current) o.selected = true;
      sel.append(o);
    }
    sel.addEventListener("change", () => onChange(sel.value));
    row.append(sel);
    return row;
  };

  grid.append(el("h3", null, "Routing"));
  const fallback = getSettings().provider || "claude";
  for (const sc of SCENARIOS) {
    grid.append(
      routeRow(sc.label, (getSettings().scenarioProvider || {})[sc.id] || "", PROVIDERS, `Default (${fallback})`, (v) => {
        const cur = getSettings();
        setSetting("scenarioProvider", { ...cur.scenarioProvider, [sc.id]: v });
      }),
    );
  }
  grid.append(
    routeRow("Embedding", getSettings().embedProvider || "openai", EMBED_PROVIDERS, null, (v) =>
      setSetting("embedProvider", v),
    ),
  );

  wrap.append(grid);
  return wrap;
}

// --- Pronunciation ---------------------------------------------------------
async function pronunciationBar() {
  const wrap = el("div", "sync-bar");
  wrap.append(el("span", "sync-bar__label", "Voice"));
  if (!ttsSupported()) {
    wrap.append(el("span", "muted", "Speech synthesis not available in this browser."));
    return wrap;
  }
  const s = getSettings();
  const select = el("select");
  const voices = await enUSVoices();
  if (!voices.length) {
    wrap.append(el("span", "muted", "No en-US voices found. Add one in System Settings → Spoken Content."));
    return wrap;
  }
  const auto = el("option", null, "Auto (best en-US)");
  auto.value = "";
  select.append(auto);
  for (const v of voices) {
    const o = el("option", null, `${v.name}${v.localService ? "" : " (network)"}`);
    o.value = v.name;
    if (v.name === s.ttsVoice) o.selected = true;
    select.append(o);
  }
  select.addEventListener("change", () => setSetting("ttsVoice", select.value));

  const rate = el("input");
  rate.type = "range";
  rate.min = "0.6";
  rate.max = "1.3";
  rate.step = "0.05";
  rate.value = String(s.ttsRate || 1);
  rate.title = "Speed";
  rate.addEventListener("change", () => setSetting("ttsRate", Number(rate.value)));

  const test = el("button", "btn btn--ghost", "Test voice");
  test.addEventListener("click", () => speak("get shredded"));

  // Reading-on default for review/retrieve (the on/off toggle still lives there).
  const readLabel = el("label", "settings-bar__label");
  const read = el("input");
  read.type = "checkbox";
  read.checked = !!s.readingDefault;
  read.addEventListener("change", () => setSetting("readingDefault", read.checked));
  readLabel.append(read, document.createTextNode(" Show reading by default"));

  wrap.append(select, rate, test, readLabel);
  return wrap;
}

// --- Organize / reassign ---------------------------------------------------
async function reassignBar(root) {
  const wrap = el("section", "settings-bar");
  const since = await wordsAddedSince();
  const last = getSettings().lastReassignedAt;
  const info = el("span", "sync-bar__label", last ? `${since} word(s) added since last reassign` : "Never reassigned");
  const go = el("button", "btn", "Reassign / re-cluster");
  const status = el("span", "muted");
  const panel = el("div", "reassign__panel");

  go.addEventListener("click", async () => {
    go.disabled = true;
    panel.innerHTML = "";
    status.textContent = "Working…";
    try {
      const { preview, applyPlan } = await buildReassignPlan({ onStatus: (m) => (status.textContent = m) });
      status.textContent = "";
      renderReassignPreview(panel, preview, applyPlan, root);
    } catch (e) {
      const msg =
        e.code === "NO_EMBEDDINGS"
          ? e.message
          : e.message === "NO_EMBED_KEY"
            ? "Set an embedding-provider API key (OpenAI/Gemini/Mistral) under Providers first."
            : `Reassign failed: ${e.message}`;
      panel.append(el("p", "error", msg));
    } finally {
      go.disabled = false;
    }
  });

  wrap.append(el("span", "sync-bar__label", "Organize"), info, go, status, panel);
  return wrap;
}

function renderReassignPreview(panel, preview, applyPlan, root) {
  panel.innerHTML = "";
  let changes = 0;
  for (const [axis, label] of [["topic", "Topics"], ["intent", "Intents"]]) {
    const a = preview.axes[axis];
    changes += a.changed + a.moves.length;
    const sec = el("div", "reassign__axis");
    sec.append(el("h3", null, `${label}: ${a.oldCount} → ${a.newCount} classes · ${a.changed} changed · ${a.moves.length} move(s)`));
    const changed = a.classes.filter((c) => c.status !== "kept");
    if (!changed.length) sec.append(el("p", "muted", "No structural changes."));
    for (const c of changed) {
      const row = el("div", "reassign__class");
      row.append(el("span", `reassign__badge reassign__badge--${c.status}`, c.status));
      row.append(el("span", "reassign__name", c.name));
      const sources = (c.from || []).filter((n) => n !== c.name);
      if (c.status !== "new" && sources.length) row.append(el("span", "muted", `← ${sources.join(", ")}`));
      row.append(el("div", "reassign__members muted", c.members.join(" · ")));
      sec.append(row);
    }
    panel.append(sec);
  }

  const actions = el("div", "data-bar");
  if (!changes) {
    panel.append(el("p", "muted", "Already organized — nothing to apply."));
    const ok = el("button", "btn btn--ghost", "Close");
    ok.addEventListener("click", () => (panel.innerHTML = ""));
    actions.append(ok);
    panel.append(actions);
    return;
  }
  const apply = el("button", "btn", "Apply changes");
  apply.addEventListener("click", async () => {
    apply.disabled = true;
    apply.textContent = "Applying…";
    try {
      await applyReassignPlan(applyPlan);
      schedulePush();
      panel.innerHTML = "";
      setSetting("lastReassignedAt", Date.now());
    } catch (e) {
      apply.disabled = false;
      apply.textContent = "Apply changes";
      alert(`Apply failed: ${e.message}`);
    }
  });
  const cancel = el("button", "btn btn--ghost", "Cancel");
  cancel.addEventListener("click", () => (panel.innerHTML = ""));
  actions.append(apply, cancel);
  panel.append(actions);
}

// --- Sync: Dropbox + manual export/import ----------------------------------
function dropboxBar(root) {
  const wrap = el("div", "sync-bar");

  if (!isConnected()) {
    const key = el("input", "sync-bar__key");
    key.type = "password";
    key.placeholder = "Dropbox app key";
    key.value = getSettings().dropboxAppKey || "";
    key.addEventListener("change", () => setSetting("dropboxAppKey", key.value.trim()));

    const connect = el("button", "btn", "Connect Dropbox");
    connect.addEventListener("click", async () => {
      setSetting("dropboxAppKey", key.value.trim());
      try {
        await beginAuth();
      } catch (e) {
        alert(e.message);
      }
    });
    wrap.append(el("span", "sync-bar__label", "Dropbox"), key, connect);
    wrap.append(el("div", "sync-bar__hint muted", `Redirect URI to register in your Dropbox app: ${redirectUri()}`));
    return wrap;
  }

  const status = el("span", "sync-bar__label", "Dropbox connected");
  const sync = el("button", "btn", "Sync now");
  sync.addEventListener("click", async () => {
    sync.disabled = true;
    const orig = sync.textContent;
    sync.textContent = "Syncing…";
    try {
      const r = await syncNow();
      sync.textContent = `Synced ✓ (${r.expressions})`;
    } catch (e) {
      sync.disabled = false;
      sync.textContent = orig;
      alert(`Sync failed: ${e.message}`);
    }
  });
  const off = el("button", "btn btn--ghost", "Disconnect");
  off.addEventListener("click", () => {
    disconnect();
    mountSettings(root);
  });
  wrap.append(status, sync, off);
  return wrap;
}

function dataBar(root) {
  const bar = el("div", "data-bar");

  const exp = el("button", "btn btn--ghost", "Export vault");
  exp.addEventListener("click", async () => {
    const blob = new Blob([JSON.stringify(await exportVault(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `vault-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const file = el("input");
  file.type = "file";
  file.accept = "application/json";
  file.style.display = "none";
  const imp = el("button", "btn btn--ghost", "Import vault");
  imp.addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      await importVault(JSON.parse(await f.text()));
      alert("Vault imported.");
    } catch (e) {
      alert(`Import failed: ${e.message}`);
    }
  });

  bar.append(exp, imp, file);
  return bar;
}

export async function mountSettings(root) {
  root.innerHTML = "";
  root.append(el("h1", null, "Settings"));

  root.append(section("Appearance", null, appearanceBar()));
  root.append(section("Language", null, languageBar()));
  root.append(section("Providers", "Per-provider keys (stored on-device) and which provider runs each AI scenario.", providersPanel()));
  root.append(section("Pronunciation", "Choose the en-US voice used to speak expressions.", await pronunciationBar()));
  root.append(section("Organize", "Re-cluster the whole vault into authoritative topic/intent groups, with a preview before anything changes.", await reassignBar(root)));

  const sync = section("Sync & data", "Connect Dropbox for two-way sync, or export/import the vault as a single file.", dropboxBar(root));
  sync.append(dataBar(root));
  root.append(sync);
}
