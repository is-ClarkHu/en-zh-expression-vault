// Expression Vault — app entry point + view shell.
//
// Live modules (SPEC §9): capture (§3) → ai candidate card (§4) → db vault (§2)
// → retrieve (§6.1) → graph (§6.1) → review (§6.2) → dashboard (§6.3) → Dropbox
// sync (§7). The shell is a responsive nav (SPEC v2 §6): a persistent left
// sidebar at ≥1024px, an off-canvas drawer with a hamburger below it.

import { mountCapture } from "./capture/qa-box.js";
import { mountRetrieve } from "./retrieve/index.js";
import { mountGraph } from "./retrieve/graph.js";
import { mountReview } from "./review/index.js";
import { mountDashboard } from "./dashboard/index.js";
import { mountSettings } from "./settings/index.js";
import { applyTheme } from "./ui/theme.js";
import { completeAuthFromRedirect, isConnected, pullMerge, syncNow } from "./sync/dropbox.js";

// Line-style nav glyphs (SPEC v2 §9: icon + label, no emoji). One 24×24 path
// set, stroked with currentColor so they inherit the nav's ink/accent state.
const ICONS = {
  capture: '<path d="M5 19.5h14M7 16l8.5-8.5a1.6 1.6 0 0 0-2.3-2.3L4.7 13.7 4 16.7z"/>',
  retrieve: '<circle cx="10.5" cy="10.5" r="6"/><line x1="15" y1="15" x2="20" y2="20"/>',
  graph:
    '<circle cx="6" cy="7" r="2.2"/><circle cx="18" cy="9" r="2.2"/><circle cx="11" cy="17.5" r="2.2"/><line x1="8" y1="7.8" x2="15.8" y2="8.6"/><line x1="6.8" y1="9" x2="10.1" y2="15.4"/><line x1="12.4" y1="16.1" x2="16.4" y2="10.6"/>',
  review:
    '<rect x="3.5" y="7" width="13" height="13.5" rx="2.2"/><path d="M8 7V6a2 2 0 0 1 2-2h8.5a2 2 0 0 1 2 2v11.5a2 2 0 0 1-2 2H17"/>',
  dashboard:
    '<line x1="6" y1="20" x2="6" y2="12.5"/><line x1="12" y1="20" x2="12" y2="5"/><line x1="18" y1="20" x2="18" y2="14.5"/>',
  settings:
    '<circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18"/>',
};
const icon = (id) =>
  `<svg class="nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[id]}</svg>`;

const app = document.querySelector("#app");
app.innerHTML = `
  <aside class="nav" id="nav" aria-label="Primary">
    <div class="nav__brand">Expression Vault</div>
    <nav class="nav__items"></nav>
  </aside>
  <div class="nav__scrim" id="nav-scrim" hidden></div>
  <div class="shell">
    <header class="topbar">
      <button class="topbar__toggle" id="nav-toggle" aria-label="Open navigation" aria-controls="nav" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
      </button>
      <span class="topbar__title">Expression Vault</span>
    </header>
    <main id="view"></main>
  </div>
`;

const view = app.querySelector("#view");
const nav = app.querySelector(".nav__items");
const navPanel = app.querySelector("#nav");
const scrim = app.querySelector("#nav-scrim");
const toggle = app.querySelector("#nav-toggle");

const VIEWS = [
  { id: "capture", label: "Capture", mount: mountCapture },
  { id: "retrieve", label: "Retrieve", mount: mountRetrieve },
  { id: "graph", label: "Graph", mount: mountGraph },
  { id: "review", label: "Review", mount: mountReview },
  { id: "dashboard", label: "Dashboard", mount: mountDashboard },
  { id: "settings", label: "Settings", mount: mountSettings },
];

// Below the sidebar breakpoint the nav is an off-canvas drawer; opening it shows
// the scrim, and tapping the scrim / a nav item / Escape closes it. Above it the
// nav is a persistent sidebar and these no-op (the panel is always visible).
const wide = window.matchMedia("(min-width: 1024px)");
function setDrawer(open) {
  navPanel.classList.toggle("nav--open", open);
  scrim.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
}
toggle.addEventListener("click", () => setDrawer(!navPanel.classList.contains("nav--open")));
scrim.addEventListener("click", () => setDrawer(false));
document.addEventListener("keydown", (e) => e.key === "Escape" && setDrawer(false));
wide.addEventListener("change", () => setDrawer(false)); // drop drawer state when we cross into sidebar

function show(id) {
  const v = VIEWS.find((x) => x.id === id) || VIEWS[0];
  for (const b of nav.children) {
    const on = b.dataset.id === v.id;
    b.classList.toggle("nav__item--on", on);
    if (on) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  setDrawer(false); // picking an item closes the drawer on phones
  v.mount(view);
}

for (const v of VIEWS) {
  const b = document.createElement("button");
  b.className = "nav__item";
  b.dataset.id = v.id;
  b.innerHTML = `${icon(v.id)}<span class="nav__label">${v.label}</span>`;
  b.addEventListener("click", () => show(v.id));
  nav.append(b);
}

// If we returned from a Dropbox OAuth redirect, finish the handshake; then
// auto-sync (full round-trip on a fresh connect, pull-merge otherwise) so you
// open to the latest. Background sync failures are non-fatal — the app still
// works offline against local data.
// Ask the browser to keep our storage (localStorage keys + the IndexedDB vault)
// instead of evicting it — mobile browsers (esp. iOS Safari) otherwise clear a
// tab's storage after ~7 days idle, wiping the vault and the saved API key.
// Best-effort; the surer fix is "Add to Home Screen" (see manifest).
async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    /* not supported — Add to Home Screen still protects storage on iOS */
  }
}

async function init() {
  applyTheme(); // honour the saved appearance choice before first paint
  requestPersistentStorage(); // best-effort, non-blocking
  let justConnected = false;
  try {
    justConnected = await completeAuthFromRedirect();
  } catch (e) {
    alert(`Dropbox connect failed: ${e.message}`);
  }
  try {
    if (justConnected) await syncNow();
    else if (isConnected()) await pullMerge();
  } catch {
    /* offline / transient — proceed with local data */
  }
  show(justConnected ? "dashboard" : "capture");
}

init();
