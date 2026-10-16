import { describe, it, expect } from "vitest";
import { runNotationChecks, analyzeNotation } from "../notationManager";
import type { NotationManagerSettings } from "../../types";

const full: NotationManagerSettings = {
  enabled: true,
  detectSymbols: true,
  detectConflicts: true,
  detectUndefinedNotation: true,
};

function body(content: string): string {
  return (
    "\\documentclass{article}\n\\begin{document}\n" + content + "\n\\end{document}\n"
  );
}

// ── Symbol detection ─────────────────────────────────────────────────────
const symbolVariants = [
  { text: "$a + b = c$", expected: "a" },
  { text: "$\\alpha \\beta \\gamma$", expected: "\\alpha" },
  { text: "$\\theta \\lambda \\mu$", expected: "\\theta" },
  { text: "$\\mathbb{R}^n$", expected: "\\mathcal{R}" },
  { text: "$\\mathcal{L}$", expected: "mathcal" },
  { text: "$\\hat{y}$", expected: "hat" },
  { text: "$\\tilde{x}$", expected: "tilde" },
  { text: "$\\dot{a}$", expected: "dot" },
  { text: "$x_i$", expected: "x" },
  { text: "$\\sum_{i=1}^n$", expected: "i" },
  { text: "$x_a$", expected: "a" },
  { text: "$\\nabla f$", expected: "f" },
];
describe("Symbol detection — parameterized", () => {
  it.each(symbolVariants)("detects $expected in $text", ({ text, expected }) => {
    const result = analyzeNotation(body(text));
    expect(
      result.some((s) => s.symbol.includes(expected) || s.latex.includes(expected)),
    ).toBe(true);
  });
});

// ── No-math documents ──────────────────────────────────────────────────
const noMathVariants = [
  "Plain text without any math.",
  "\\section{Introduction}Discussion without equations.",
  "\\begin{abstract}Summary.\\end{abstract}\\section{Related}Work.",
  "",
  "   \n\n  ",
];
describe("No-math documents — parameterized", () => {
  it.each(noMathVariants)("returns empty for: %s", (text) => {
    const result = analyzeNotation(body(text));
    expect(result).toHaveLength(0);
  });
});

// ── Empty results trigger warning ────────────────────────────────────────
const emptyDocWarnings = [body("Plain text."), body(""), body("   ")];
describe("Documents without math — parameterized", () => {
  it.each(emptyDocWarnings)("reports nothing for: %s", (doc) => {
    const result = runNotationChecks(doc, full);
    expect(result.diagnostics).toHaveLength(0);
  });
});

// ── Settings toggling ────────────────────────────────────────────────────
describe("Settings toggling — parameterized", () => {
  it("disabling conflict detection removes its diagnostics", () => {
    const doc = body("$x$ $X$");
    const enabled = runNotationChecks(doc, { ...full, detectConflicts: true });
    const disabled = runNotationChecks(doc, { ...full, detectConflicts: false });
    expect(enabled.diagnostics.some((d) => d.message.includes("conflict"))).toBe(true);
    expect(disabled.diagnostics.some((d) => d.message.includes("conflict"))).toBe(
      false,
    );
  });
  it("disabling undefined notation removes its diagnostics", () => {
    const doc = body("$x$");
    const enabled = runNotationChecks(doc, { ...full, detectUndefinedNotation: true });
    const disabled = runNotationChecks(doc, {
      ...full,
      detectUndefinedNotation: false,
    });
    expect(
      enabled.diagnostics.some((d) =>
        d.message.includes("without explicit definition"),
      ),
    ).toBe(true);
    expect(
      disabled.diagnostics.some((d) =>
        d.message.includes("without explicit definition"),
      ),
    ).toBe(false);
  });
});

// ── Math mode variations ─────────────────────────────────────────────────
const mathModes = [
  { text: "$x=5$", desc: "inline" },
  { text: "$$x=5$$", desc: "double-dollar" },
  { text: "\\[x=5\\]", desc: "bracket display" },
  { text: "\\begin{equation}x=5\\end{equation}", desc: "equation env" },
  { text: "\\begin{align}x &= 5\\end{align}", desc: "align env" },
  { text: "\\begin{gather}x = 5\\end{gather}", desc: "gather env" },
];
describe("Math mode detection — parameterized", () => {
  it.each(mathModes)("detects symbols in $desc", ({ text }) => {
    const result = analyzeNotation(body(text));
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── Usage count ──────────────────────────────────────────────────────────
const usageCounts = [
  { text: "$\\theta$ once.", count: 1 },
  { text: "$\\theta$ twice $\\theta$.", count: 2 },
  { text: "$\\theta$ three $\\theta$ times $\\theta$.", count: 3 },
];
describe("Usage count — parameterized", () => {
  it.each(usageCounts)("$count usage(s)", ({ text, count }) => {
    const result = analyzeNotation(body(text));
    const theta = result.find((s) => s.symbol.includes("\\theta"));
    expect(theta?.usageCount).toBe(count);
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────
const edgeCases = [
  { desc: "empty document", doc: body("") },
  {
    desc: "no math",
    doc: body("This paper presents a new method for processing data."),
  },
  { desc: "unicode", doc: body("$∀x∃y$") },
  { desc: "newcommand", doc: body("\\newcommand{\\loss}{\\mathcal{L}} $\\loss$") },
  {
    desc: "long expression",
    doc: body(
      "$\\frac{\\partial L}{\\partial w} = \\frac{1}{n}\\sum_{i=1}^n \\nabla_w \\ell(f(x_i; w), y_i)$",
    ),
  },
];
describe("Edge cases — parameterized", () => {
  it.each(edgeCases)("handles $desc", ({ doc }) => {
    const result = runNotationChecks(doc, full);
    expect(Array.isArray(result.diagnostics)).toBe(true);
    expect(Array.isArray(result.symbols)).toBe(true);
  });
});
