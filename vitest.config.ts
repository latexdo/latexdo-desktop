import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Preserve the original coverage gate while measuring the full codebase.
const originalCoverageScope = `{
electron/diagnostics.ts,
src/RendererErrorBoundary.tsx,
src/checks/*.ts,
src/components/!(MonacoEditor).tsx,
src/latex/!(registerLatexCompletions).ts,
src/rendererDiagnostics.ts,
src/utils/*.ts
}`.replace(/\s/g, "");

const recentCoverageThresholds = Object.fromEntries(
  [
    "electron/pdfImport/bibliography.ts",
    "src/features/scholarly/scholarlyClient.ts",
    "src/latex/citationCompletion.ts",
  ].map((file) => [
    file,
    { lines: 95, functions: 95, branches: 95, statements: 95 },
  ]),
);

export default defineConfig({
  plugins: [
    react(),
    {
      name: "legacy-bibtex-coverage-resolution",
      resolveId(source) {
        // This legacy source dependency is not installed. Keep its import intact
        // so V8 can count the unexecuted source without pretending it is tested.
        if (source === "bibtex-parse-js") return { id: source, external: true };
      },
    },
  ],
  // Vite's default transform filter omits the Electron .cts preload.
  esbuild: { include: /\.(?:[jt]sx?|[cm][jt]s)$/ },
  resolve: {
    alias: [
      {
        find: /^monaco-editor$/,
        replacement: fileURLToPath(
          new URL(
            "./node_modules/monaco-editor/esm/vs/editor/editor.api.js",
            import.meta.url,
          ),
        ),
      },
    ],
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    // The App suite mounts the whole workspace; under a full parallel run the
    // 5 s default times out at random.
    testTimeout: 20_000,
    // The same applies to the set-up of the Electron main-process suites.
    hookTimeout: 30_000,
    include: [
      "{src,electron,collaborations,scripts,latexdo,web}/**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}",
    ],
    // The Cloudflare server has its own end-to-end suite (node --test) that
    // runs against a live server.
    exclude: ["**/node_modules/**", "collaborations/cloudflare/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: [
        "{src,electron,collaborations,scripts,latexdo}/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}",
      ],
      exclude: [
        "**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}",
        "**/__tests__/**",
        "**/*.d.{ts,mts,cts}",
        "**/node_modules/**",
        "src/test-setup.ts",
        "scripts/test-*",
        "scripts/run-packaged-app-tests.mjs",
        // A separate Workers project with its own typecheck and test suite.
        "collaborations/cloudflare/**",
      ],
      thresholds: {
        // Production modules changed in 1ed42dc: enforce the target for each
        // module, so a well-covered file cannot conceal another's regression.
        ...recentCoverageThresholds,
        // Baseline for all source, including previously unmeasured files.
        lines: 43,
        functions: 45,
        branches: 38,
        statements: 42,
        [originalCoverageScope]: {
          lines: 79,
          functions: 82,
          branches: 66,
          statements: 78,
        },
      },
    },
  },
});
