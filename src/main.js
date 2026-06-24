// Expression Vault — app entry point.
//
// Current build = the AI-loop validation slice (SPEC §10 best-next-step):
// capture (quick-lookup + Q&A) → live AI candidate card → Save → vault list.
// Remaining modules land on top per SPEC §9:
//   ai/       answer + extract + disambiguate + auto-tag  (§4)   ← live
//   capture/  quick-lookup box + Q&A box                  (§3)   ← live
//   db/       real expression/tags/edges store, sync-friendly (§2) — temp store for now
//   retrieve/ intent reverse-search + topic/register filter + 2D graph (§6.1)
//   review/   light re-encounter + casual browse, no SRS  (§6.2)
//   dashboard/ topic/intent/register distribution         (§6.3)
//   sync/     iCloud single-file sync                      (§7)

import { mountCapture } from "./capture/qa-box.js";

mountCapture(document.querySelector("#app"));
