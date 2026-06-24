// Expression Vault — app entry point + view shell.
//
// Live modules (SPEC §9): capture (§3) → ai candidate card (§4) → db vault (§2)
// → retrieve (§6.1). Remaining: 2D graph (needs embeddings/edges), review (§6.2),
// dashboard (§6.3), recluster.py (§5), iCloud sync (§7).

import { mountCapture } from "./capture/qa-box.js";
import { mountRetrieve } from "./retrieve/index.js";
import { mountGraph } from "./retrieve/graph.js";
import { mountReview } from "./review/index.js";
import { mountDashboard } from "./dashboard/index.js";
import { completeAuthFromRedirect } from "./sync/dropbox.js";

const app = document.querySelector("#app");
app.innerHTML = `
  <header class="app__header">
    <h1>Expression Vault</h1>
    <nav class="app__nav"></nav>
  </header>
  <main id="view"></main>
`;

const view = app.querySelector("#view");
const nav = app.querySelector(".app__nav");

const VIEWS = [
  { id: "capture", label: "Capture", mount: mountCapture },
  { id: "retrieve", label: "Retrieve", mount: mountRetrieve },
  { id: "graph", label: "Graph", mount: mountGraph },
  { id: "review", label: "Review", mount: mountReview },
  { id: "dashboard", label: "Dashboard", mount: mountDashboard },
];

function show(id) {
  const v = VIEWS.find((x) => x.id === id) || VIEWS[0];
  for (const b of nav.children) b.classList.toggle("app__tab--on", b.dataset.id === v.id);
  v.mount(view);
}

for (const v of VIEWS) {
  const b = document.createElement("button");
  b.className = "app__tab";
  b.textContent = v.label;
  b.dataset.id = v.id;
  b.addEventListener("click", () => show(v.id));
  nav.append(b);
}

// If we returned from a Dropbox OAuth redirect, finish the handshake first, then
// land on Dashboard (where the sync controls live); otherwise start on Capture.
async function init() {
  let justConnected = false;
  try {
    justConnected = await completeAuthFromRedirect();
  } catch (e) {
    alert(`Dropbox connect failed: ${e.message}`);
  }
  show(justConnected ? "dashboard" : "capture");
}

init();
