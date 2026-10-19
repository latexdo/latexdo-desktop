import { describe, it, expect } from "vitest";
import { runNotationChecks, analyzeNotation } from "../notationManager";
import type { NotationManagerSettings } from "../../types";

const defaultSettings: NotationManagerSettings = {
  enabled: true,
  detectSymbols: true,
  detectConflicts: true,
  detectUndefinedNotation: true,
};

function makeDoc(body: string): string {
  return "\\documentclass{article}\n\\begin{document}\n" + body + "\n\\end{document}\n";
}

describe("analyzeNotation", () => {
  it("extracts simple math symbols", () => {
    const doc = makeDoc("The loss is $\\mathcal{L}$.");
    const result = analyzeNotation(doc);
    expect(result.some((s) => s.symbol.includes("\\mathcal{L}"))).toBe(true);
  });

  it("extracts Greek letters", () => {
    const doc = makeDoc("Set $\\theta$ as threshold.");
    const result = analyzeNotation(doc);
    expect(result.some((s) => s.symbol.includes("\\theta"))).toBe(true);
  });

  it("extracts variables from display math", () => {
    const doc = makeDoc("Equation: \\[f(x) = \\lambda x\\]");
    const result = analyzeNotation(doc);
    expect(result.some((s) => s.symbol.includes("\\lambda"))).toBe(true);
  });

  it("extracts symbols from equation environment", () => {
    const doc = makeDoc("\\begin{equation} E = mc^2 \\end{equation}");
    const result = analyzeNotation(doc);
    expect(result.length).toBeGreaterThan(0);
  });

  it("reports first use line", () => {
    const doc =
      "\\begin{document}\n\\section{Intro}\nThe term $\\lambda$ is used.\n\\end{document}";
    const result = analyzeNotation(doc);
    const lambda = result.find((s) => s.symbol.includes("\\lambda"));
    expect(lambda).toBeDefined();
  });

  it("reports usage count", () => {
    const doc = makeDoc("$\\theta$ and $\\theta$ and $\\theta$.");
    const result = analyzeNotation(doc);
    const theta = result.find((s) => s.symbol.includes("\\theta"));
    expect(theta?.usageCount).toBe(3);
  });

  it("returns empty for document with no math", () => {
    const doc = makeDoc("Plain text without any math symbols whatsoever.");
    const result = analyzeNotation(doc);
    expect(result).toHaveLength(0);
  });

  it("handles large math expressions", () => {
    const doc = makeDoc("$\\alpha$ and $\\beta$ appear together.");
    const result = analyzeNotation(doc);
    expect(result.some((s) => s.symbol.includes("\\alpha"))).toBe(true);
    expect(result.some((s) => s.symbol.includes("\\beta"))).toBe(true);
  });
});

describe("runNotationChecks", () => {
  it("returns empty when disabled", () => {
    const result = runNotationChecks("content", { ...defaultSettings, enabled: false });
    expect(result.diagnostics).toHaveLength(0);
  });

  it("returns empty for empty content", () => {
    const result = runNotationChecks("", defaultSettings);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("returns warnings for undefined symbols", () => {
    const doc = makeDoc("The value of $\\theta$ is important.");
    const result = runNotationChecks(doc, defaultSettings);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("returns symbols alongside diagnostics", () => {
    const doc = makeDoc("Using $\\lambda$ and $\\theta$ together.");
    const result = runNotationChecks(doc, defaultSettings);
    expect(result.symbols).toBeDefined();
    expect(result.symbols.length).toBeGreaterThan(0);
  });

  it("handles equations and text mixed", () => {
    const doc = makeDoc(
      "The $\\alpha$ and $\\beta$ are hyperparameters. The loss $\\mathcal{L}$ is minimized.",
    );
    const result = runNotationChecks(doc, defaultSettings);
    expect(result.symbols.length).toBeGreaterThanOrEqual(3);
  });

  it("handles content with no math", () => {
    const doc = makeDoc(
      "This is a plain text paper without any math equations or symbols whatsoever.",
    );
    const result = runNotationChecks(doc, defaultSettings);
    // A paper without math is not a problem to report.
    expect(result.diagnostics).toHaveLength(0);
    expect(result.symbols).toHaveLength(0);
  });

  it("tracks first-use section", () => {
    const doc =
      "\\documentclass{article}\n\\begin{document}\n\\section{Method}\nWe use $\\phi$.\n\\section{Results}\nThe $\\phi$ is tuned.\n\\end{document}";
    const result = runNotationChecks(doc, defaultSettings);
    const phi = result.symbols.find((s) => s.symbol === "\\phi");
    expect(phi?.firstUseSection).toContain("Method");
  });

  it("skips symbol check when detectSymbols is disabled", () => {
    const doc = makeDoc("$\\theta$ appears.");
    const result = runNotationChecks(doc, { ...defaultSettings, detectSymbols: false });
    const noMathDiags = result.diagnostics.filter((d) =>
      d.message.includes("No mathematical notation"),
    );
    expect(noMathDiags).toHaveLength(0);
  });

  it("skips conflict detection when detectConflicts is disabled", () => {
    const result = runNotationChecks("$\\theta$ and $\\vartheta$ and $x$", {
      ...defaultSettings,
      detectConflicts: false,
    });
    const conflictDiags = result.diagnostics.filter((d) =>
      d.message.includes("conflict"),
    );
    expect(conflictDiags).toHaveLength(0);
  });

  it("skips undefined detection when detectUndefinedNotation is disabled", () => {
    const result = runNotationChecks("$\\theta$", {
      ...defaultSettings,
      detectUndefinedNotation: false,
    });
    const undefinedDiags = result.diagnostics.filter((d) =>
      d.message.includes("without explicit definition"),
    );
    expect(undefinedDiags).toHaveLength(0);
  });
});

describe("analyzeNotation coverage edge cases", () => {
  it("attributes first use to the last chapter when there are no sections", () => {
    const doc = makeDoc("\\chapter{Intro}\nSome $q$ here.\n\\chapter{Methods}\nThen $z$.");
    const result = analyzeNotation(doc);
    expect(result.find((s) => s.symbol === "q")?.firstUseSection).toBe("Intro");
    expect(result.find((s) => s.symbol === "z")?.firstUseSection).toBe("Methods");
  });

  it("keeps subscript and superscript together", () => {
    const result = analyzeNotation(makeDoc("We use $x_1^2$."));
    expect(result.some((s) => s.symbol.replace(/\s/g, "") === "x_1^2")).toBe(true);
  });

  it("marks a symbol defined when a later use follows a definition", () => {
    const doc = makeDoc(
      "First $w$ appears.\n" +
        "x".repeat(120) +
        "\n\\begin{definition} Let $w$ be a weight. \\end{definition}",
    );
    const w = analyzeNotation(doc).find((s) => s.symbol === "w")!;
    expect(w.usageCount).toBe(2);
    expect(w.defined).toBe(true);
    expect(w.definitionLine).toBe(5);
    expect(w.firstUseLine).toBe(3);
  });
});
