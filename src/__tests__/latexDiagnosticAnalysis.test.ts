import { expect, it } from "vitest";
import {
  analyzeLatexDiagnostic,
  rankLatexDiagnostics,
} from "../../electron/latexDiagnostics";

it("passes the diagnostic location and suggested-fix regression corpus", async () => {
  const fixturePath = new URL(
    "../../scripts/test-latex-diagnostics.ts",
    import.meta.url,
  ).pathname;
  await import(fixturePath);
});

it("handles empty compiler output and keeps ranking deterministic", () => {
  expect(rankLatexDiagnostics([])).toEqual([]);
  const diagnostic = {
    file: "main.tex",
    line: 1,
    column: 1,
    severity: "error" as const,
    message: "Unexpected compiler failure",
    source: "latex" as const,
  };
  const result = analyzeLatexDiagnostic(diagnostic, "", "");
  expect(result).toMatchObject({ line: 1, column: 1, locationAccuracy: "line" });
  const ranked = rankLatexDiagnostics([{ ...diagnostic, ...result }]);
  expect(ranked[0]).toMatchObject({
    message: diagnostic.message,
    isPrimary: true,
    isCascade: false,
  });
});
