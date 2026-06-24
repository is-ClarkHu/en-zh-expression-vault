// Expression Vault — app entry point.
//
// Boots the shell only. Real features land module by module per SPEC §9:
//   capture/  quick-lookup box + Q&A box  (§3)
//   ai/       answer + extract + disambiguate + auto-tag + candidate card  (§4)
//   db/       expression / tags / edges store, sync-friendly  (§2)
//   retrieve/ intent reverse-search + topic/register filter + 2D graph  (§6.1)
//   review/   light re-encounter + casual browse, no SRS  (§6.2)
//   dashboard/ topic/intent/register distribution  (§6.3)
//   sync/     iCloud single-file sync  (§7)

const app = document.querySelector("#app");

app.innerHTML = `
  <main class="shell">
    <h1>Expression Vault</h1>
    <p class="tagline">
      A private, topic-and-intent-organized vault of English expressions.
    </p>
    <p class="status">Scaffold running. Features land module by module (SPEC §10).</p>
  </main>
`;
