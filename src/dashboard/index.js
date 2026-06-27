// Dashboard (SPEC §6.3) — the shape of the vault at a glance: topic / intent /
// register distribution, tag counts per axis, edge count, and recent growth.
// Pure reads over the db; doubles as a sanity check that capture → live tagging
// is producing a healthy organization layer.

import { getExpressions, getTags, getEdges, exportVault, importVault } from "../db/index.js";
import { getSettings, setSetting } from "../ai/settings.js";
import { isConnected, beginAuth, disconnect, syncNow, redirectUri, schedulePush } from "../sync/dropbox.js";
import { enUSVoices, speak, isSupported as ttsSupported } from "../audio/tts.js";
import { buildReassignPlan, applyReassignPlan, wordsAddedSince } from "../reassign/index.js";

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function statCard(label, value) {
  const c = el("div", "stat");
  c.append(el("div", "stat__value", String(value)));
  c.append(el("div", "stat__label", label));
  return c;
}

// A labelled horizontal bar list: [{ name, count }], scaled to the max count.
function barList(rows, emptyMsg) {
  const wrap = el("div", "bars");
  if (!rows.length) {
    wrap.append(el("p", "muted", emptyMsg));
    return wrap;
  }
  const max = Math.max(...rows.map((r) => r.count)) || 1;
  for (const r of rows) {
    const row = el("div", "bar");
    row.append(el("span", "bar__name", r.name));
    const track = el("div", "bar__track");
    const fill = el("div", "bar__fill");
    fill.style.width = `${Math.round((r.count / max) * 100)}%`;
    track.append(fill);
    row.append(track);
    row.append(el("span", "bar__count", String(r.count)));
    wrap.append(row);
  }
  return wrap;
}

function section(title, node) {
  const s = el("section", "dash__section");
  s.append(el("h2", null, title));
  s.append(node);
  return s;
}

const REGISTERS = ["slang", "casual", "neutral", "formal", "academic", "technical"];

// Single-file vault export/import (SPEC §7) — the seam recluster.py plugs into:
// download JSON → run tools/recluster.py → import it back (last-write-wins merge).
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
      mountDashboard(root); // re-render with merged data
    } catch (e) {
      alert(`Import failed: ${e.message}`);
    }
  });

  bar.append(exp, imp, file);
  return bar;
}

// Dropbox auto-sync (SPEC §7). Connect once (PKCE), then "Sync now" does a full
// two-way last-write-wins round-trip. Manual export/import above stays as the
// universal fallback.
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
    wrap.append(el("span", "sync-bar__label", "Sync"), key, connect);
    // Tell the self-hoster exactly which redirect URI to register.
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
      mountDashboard(root); // refresh counts after merge
    } catch (e) {
      sync.disabled = false;
      sync.textContent = orig;
      alert(`Sync failed: ${e.message}`);
    }
  });
  const off = el("button", "btn btn--ghost", "Disconnect");
  off.addEventListener("click", () => {
    disconnect();
    mountDashboard(root);
  });
  wrap.append(status, sync, off);
  return wrap;
}

// Pronunciation voice picker (SPEC §8) — choose among the OS's en-US voices.
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

  wrap.append(select, rate, test);
  return wrap;
}

// One-click global reassign (SPEC v2 §8): re-cluster the whole vault, preview
// every create/merge/split + word move, apply only on confirm. Live tags are a
// provisional draft; this re-derives the authoritative grouping.
async function reassignBar(root) {
  const wrap = el("section", "settings-bar");
  const since = await wordsAddedSince();
  const last = getSettings().lastReassignedAt;
  const info = el(
    "span",
    "sync-bar__label",
    last ? `${since} word(s) added since last reassign` : "Never reassigned",
  );
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
            ? "Set an embedding-provider API key (OpenAI/Gemini/Mistral) under Provider first."
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
      const sources = (c.from || []).filter((n) => n !== c.name); // drop the kept name itself
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
      mountDashboard(root);
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

export async function mountDashboard(root) {
  root.innerHTML = "";
  root.append(el("p", "muted", "The shape of your vault — distributions, tag counts, growth."));
  root.append(dataBar(root));
  root.append(await reassignBar(root));
  root.append(dropboxBar(root));
  root.append(await pronunciationBar());

  const [expressions, topicTags, intentTags, edges] = await Promise.all([
    getExpressions(),
    getTags("topic"),
    getTags("intent"),
    getEdges(),
  ]);

  if (!expressions.length) {
    root.append(el("p", "muted", "Empty vault — capture and save a few expressions first."));
    return;
  }

  // Stat cards
  const stats = el("div", "stats");
  stats.append(statCard("Expressions", expressions.length));
  stats.append(statCard("Topics", topicTags.length));
  stats.append(statCard("Intents", intentTags.length));
  stats.append(statCard("Edges", edges.length));
  root.append(stats);

  // Register distribution (fixed band order, only those present)
  const regCounts = REGISTERS.map((name) => ({
    name,
    count: expressions.filter((e) => e.register === name).length,
  })).filter((r) => r.count > 0);
  root.append(section("Register", barList(regCounts, "No register data.")));

  // Top topics / intents by membership
  const topBy = (tags) =>
    tags
      .map((t) => ({ name: t.name, count: t.member_ids.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  root.append(section("Top topics", barList(topBy(topicTags), "No topic tags yet.")));
  root.append(section("Top intents", barList(topBy(intentTags), "No intent tags yet.")));

  // Recent growth — saves per day, last 7 days (oldest → newest)
  const day = 86400000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const growth = [];
  for (let i = 6; i >= 0; i--) {
    const start = today.getTime() - i * day;
    const count = expressions.filter((e) => e.created_at >= start && e.created_at < start + day).length;
    const label = i === 0 ? "today" : new Date(start).toISOString().slice(5, 10);
    growth.push({ name: label, count });
  }
  root.append(section("Saved in the last 7 days", barList(growth, "No recent activity.")));
}
