import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Two build shapes (mirrors the prior flashcard project's convention):
//   default ("npm run build")        — normal Vite build; the local vault lives
//     in IndexedDB / SQLite at runtime (SPEC §0.5), so nothing is fetched.
//   standalone ("--mode standalone") — inlines JS/CSS into one index.html via
//     vite-plugin-singlefile, so the app opens straight from file:// — handy
//     for the eventual thin native shell / Apple packaging (SPEC §0.5).
export default defineConfig(({ mode }) => {
  const standalone = mode === "standalone";
  return {
    base: "./",
    // Only the Dropbox app key is read from .env by the app — it is NOT a secret
    // in the PKCE public-client flow, so it is safe to expose/bundle. LLM keys
    // are deliberately NOT exposed here: they stay in Settings (on-device) so a
    // built/deployed bundle can never contain them.
    envPrefix: ["VITE_", "DROPBOX_APP_KEY"],
    // Pin the dev port so the origin (and thus the Dropbox OAuth redirect URI)
    // stays stable. strictPort fails loudly if 5173 is taken instead of silently
    // drifting to 5174 — which would change the IndexedDB origin and break the
    // registered redirect URI.
    server: { port: 5173, strictPort: true },
    plugins: standalone ? [viteSingleFile()] : [],
    build: {
      outDir: standalone ? "dist-standalone" : "dist",
      emptyOutDir: true,
    },
  };
});
