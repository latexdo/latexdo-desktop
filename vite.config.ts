import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };
const mathjaxPackageJson = JSON.parse(
  readFileSync(
    new URL("./node_modules/mathjax-full/package.json", import.meta.url),
    "utf8",
  ),
) as { version: string };

function vendorChunk(id: string): string | undefined {
  const moduleId = id.replaceAll("\\", "/");
  if (moduleId.includes("vite/preload-helper")) {
    return "vite-runtime";
  }
  if (!moduleId.includes("/node_modules/")) return undefined;
  if (/\/node_modules\/(?:react|react-dom|scheduler)\//.test(moduleId)) {
    return "react-vendor";
  }
  if (/\/node_modules\/(?:monaco-editor|@monaco-editor\/react)\//.test(moduleId)) {
    return "editor-vendor";
  }
  if (
    /\/node_modules\/(?:yjs|y-indexeddb|y-monaco|y-protocols|lib0)\//.test(moduleId)
  ) {
    return "collaboration-vendor";
  }
  if (/\/node_modules\/(?:pdfjs-dist)\//.test(moduleId)) {
    return "pdf-vendor";
  }
  if (/\/node_modules\/(?:@xterm)\//.test(moduleId)) {
    return "terminal-vendor";
  }
  if (/\/node_modules\/(?:mathjax-full)\//.test(moduleId)) {
    return "math-vendor";
  }
  return undefined;
}

export default defineConfig({
  plugins: [react()],
  base: "./",
  define: {
    __LATEXDO_VERSION__: JSON.stringify(packageJson.version),
    PACKAGE_VERSION: JSON.stringify(mathjaxPackageJson.version),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
