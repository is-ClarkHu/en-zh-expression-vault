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
    plugins: standalone ? [viteSingleFile()] : [],
    build: {
      outDir: standalone ? "dist-standalone" : "dist",
      emptyOutDir: true,
    },
  };
});
