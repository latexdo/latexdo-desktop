import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// The co-author web editor, served by the collaboration Worker itself
// (collaborations/cloudflare), so it calls the server without CORS.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/",
  resolve: {
    alias: [
      {
        // The editor core without Monaco's 80 bundled languages (y-monaco
        // imports "monaco-editor"; LaTeX is registered by the page).
        find: /^monaco-editor$/,
        replacement: fileURLToPath(
          new URL(
            "../../node_modules/monaco-editor/esm/vs/editor/edcore.main.js",
            import.meta.url,
          ),
        ),
      },
    ],
  },
  build: {
    outDir: fileURLToPath(
      new URL("../../collaborations/cloudflare/public", import.meta.url),
    ),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 4096,
  },
  worker: { format: "es" },
});
