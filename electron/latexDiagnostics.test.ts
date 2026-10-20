import { describe, expect, it } from "vitest";
import { analyzeLatexDiagnostic, rankLatexDiagnostics } from "./latexDiagnostics.js";

function analyze(message: string, content: string, line = 1) {
  return analyzeLatexDiagnostic({ file: "main.tex", line, column: 1, severity: "error", message }, content, "");
}

describe("actionable LaTeX diagnostic explanations", () => {
  it.each([
    ["Double subscript.", "$x_a_b$", "_", "Two subscripts"],
    ["There's no line here to end.", "\\\\", "\\\\", "Forced line break"],
    ["Lonely \\item", "\\item A", "\\item", "List item"],
    ["Citation `missing' undefined", "\\cite{missing}", "missing", "Citation key"],
    ["Reference `sec:a' undefined", "\\ref{sec:a}", "sec:a", "Reference label"],
    ["Unicode character — (U+2014)", "a—b", "—", "Unsupported Unicode"],
    ["Environment equaton undefined", "\\begin{equaton}", "\\begin{equaton}", "Unknown LaTeX environment"],
  ])("locates and explains %s", (message, source, token, title) => {
    const result = analyze(message, source);
    expect(result.highlightText).toBe(token);
    expect(result.title).toContain(title);
    expect(result.sourceLine).toBe(source);
  });
  it.each([
    ["There's no line here to end.", "\\\\", ""],
    ["Unicode character — (U+2014)", "—", "---"],
    ["Environment equaton undefined", "\\begin{equaton}", "\\begin{equation}"],
  ])("offers a bounded replacement for %s", (message, source, replacement) => {
    expect(analyze(message, source).fixes).toContainEqual(expect.objectContaining({ expectedText: source, replacement, line: 1, column: 1 }));
  });
  it.each([
    ["File `custom.cls' not found.", "\\documentclass{custom}", "Document class"],
    ["File `refs.bib' not found.", "\\bibliography{refs}", "Bibliography file"],
    ["Argument of \\foo has an extra }", "\\foo{x}}", "Unbalanced braces"],
    ["Missing } inserted.", "\\textbf{open", "Missing closing brace"],
  ])("explains %s", (message, source, title) => {
    expect(analyze(message, source).title).toContain(title);
  });
  it.each(["\\(", "\\[", "$$"])('tracks unmatched %s math across balanced earlier expressions', delimiter => {
    const content = "\\(closed\\) \\[also closed\\] $$closed$$ % ignore $\n" + delimiter + "open\n";
    const result = analyze("Missing $ inserted.", content, 3);
    expect(result.highlightText).toBe(delimiter);
    expect(result.line).toBe(2);
    expect(result.title).toBe("Math mode was opened but never closed");
  });
  it("ignores escaped delimiters and comments when locating missing braces", () => {
    const source = "\\{literal\\} % {comment\n\\textbf{open\n";
    expect(analyze("Missing } inserted.", source, 3)).toMatchObject({ line: 2, highlightText: "{" });
    expect(analyze("Missing } inserted.", "balanced {ok} % ignored {", 1).highlightText).toBeUndefined();
    expect(analyze("Too many }", "balanced {ok} % ignored }", 1).title).toBe("Unexpected closing brace");
  });
  it("ranks exact errors above unlocated errors without hiding independent failures", () => {
    const diagnostics = rankLatexDiagnostics([
      { file: "a.tex", line: 1, column: 1, severity: "error", message: "Other error" },
      { file: "b.tex", line: 2, column: 4, severity: "error", message: "Precise error", locationAccuracy: "exact" },
    ]);
    expect(diagnostics[1]).toMatchObject({ priority: 80, isPrimary: true, isCascade: false });
    expect(diagnostics[0].isCascade).toBe(false);
  });
});
