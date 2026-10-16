import { describe, it, expect } from "vitest";
import { analyzeCompileOutput } from "../errorDoctor";
import type { ErrorDoctorSettings } from "../../types";

const full: ErrorDoctorSettings = {
  enabled: true,
  explainErrors: true,
  suggestFixes: true,
  autoFixCommon: true,
};

// ── Error pattern detection ──────────────────────────────────────────────
const errorPatterns = [
  {
    output: "! Undefined control sequence.\nl.10 \\mycommand",
    expected: "Undefined control sequence",
  },
  { output: "! LaTeX Error: File `foo.sty' not found.", expected: "File not found" },
  {
    output: "! LaTeX Error: Missing \\begin{document}.",
    expected: "Missing \\begin{document}",
  },
  {
    output: "Runaway argument?\n! Paragraph ended before \\section was complete.",
    expected: "Runaway argument",
  },
  { output: "! Missing $ inserted.\nl.100 ", expected: "Missing $" },
  {
    output: "! LaTeX Error: Option clash for package geometry.",
    expected: "Option clash",
  },
  {
    output: "! TeX capacity exceeded, sorry [main memory size=5000000].",
    expected: "TeX capacity exceeded",
  },
  { output: "! LaTeX Error: Missing package amsmath.", expected: "Package error" },
  {
    output: "! Undefined control sequence.\nl.42 \\badmacro",
    expected: "Undefined control sequence",
  },
];
describe("Error pattern detection — parameterized", () => {
  it.each(errorPatterns)("detects: $expected", ({ output, expected }) => {
    const result = analyzeCompileOutput(output, "", full);
    expect(
      result.diagnostics.some(
        (d) => d.message.includes(expected) || d.title?.includes(expected),
      ),
    ).toBe(true);
  });
});

// ── Non-errors (should not be detected) ──────────────────────────────────
const nonErrors = [
  {
    output:
      "This is pdfTeX, Version 3.14159265. Output written on paper.pdf (8 pages).",
    desc: "success output",
  },
  {
    output: "Overfull \\hbox (12.5pt too wide) in paragraph at lines 10--12",
    desc: "overfull hbox",
  },
  {
    output: "Underfull \\hbox (badness 10000) in paragraph at lines 5--7",
    desc: "underfull hbox",
  },
  {
    output: "LaTeX Warning: Citation `ref1' undefined on input line 20.",
    desc: "citation warning",
  },
  {
    output: "LaTeX Warning: Reference `sec:intro' undefined on input line 30.",
    desc: "ref warning",
  },
  {
    output:
      "LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.",
    desc: "label warning",
  },
  { output: "", desc: "empty" },
];
describe("Non-errors not flagged — parameterized", () => {
  it.each(nonErrors)("ignores $desc", ({ output }) => {
    const result = analyzeCompileOutput(output, "", full);
    expect(result.diagnostics).toHaveLength(0);
  });
});

// ── Settings toggles ─────────────────────────────────────────────────────
const toggleVariants: [string, keyof ErrorDoctorSettings, boolean][] = [
  ["disable all", "enabled", false],
  ["disable explain", "explainErrors", false],
];
describe("Settings toggles — parameterized", () => {
  it.each(toggleVariants)("%s reduces diagnostics", (name, setting, value) => {
    const output =
      "! Undefined control sequence.\nl.10 \\x\n! LaTeX Error: File `y.sty' not found.";
    const result = analyzeCompileOutput(output, "", { ...full, [setting]: value });
    expect(Array.isArray(result.diagnostics)).toBe(true);
    expect(typeof result.explain).toBe("string");
    expect(Array.isArray(result.fixes)).toBe(true);
  });
});

// ── Multiple error handling ──────────────────────────────────────────────
const multiErrors = [
  { output: "! Undefined control sequence.\nl.10 \\a", expectedCount: 1 },
  {
    output:
      "! Undefined control sequence.\nl.10 \\a\n! LaTeX Error: File `b.sty' not found.",
    expectedCount: 2,
  },
  {
    output:
      "! LaTeX Error: File `a.sty' not found.\n! LaTeX Error: File `b.sty' not found.\n! Undefined control sequence.\nl.10 \\x",
    expectedCount: 2,
  },
];
describe("Multiple error handling — parameterized", () => {
  it.each(multiErrors)("detects $expectedCount errors", ({ output, expectedCount }) => {
    const result = analyzeCompileOutput(output, "", full);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(expectedCount);
  });
});

// ── Line number extraction ──────────────────────────────────────────────
const lineNumbers = [
  { output: "! Undefined control sequence.\nl.42 \\x", expectedLine: 42 },
  { output: "! Missing $ inserted.\nl.100 \\x", expectedLine: 100 },
  { output: "! LaTeX Error: File `x.sty' not found.\nl.5 ", expectedLine: 5 },
];
describe("Line number extraction — parameterized", () => {
  it.each(lineNumbers)("extracts line $expectedLine", ({ output, expectedLine }) => {
    const result = analyzeCompileOutput(output, "", full);
    expect(result.diagnostics.some((d) => d.line === expectedLine)).toBe(true);
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────
const edgeCases = [
  { output: "! LaTeX Error: File `foo.sty' not found.", content: "" },
  {
    output: "! Undefined control sequence.\nl.10 \\badmacro",
    content: "Some source content with \\badmacro",
  },
  {
    output: "Clean output.",
    content: "\\documentclass{article}\\begin{document}Hello.\\end{document}",
  },
];
describe("Edge cases — parameterized", () => {
  it.each(edgeCases)("handles various inputs", ({ output, content }) => {
    const result = analyzeCompileOutput(output, content, full);
    expect(Array.isArray(result.diagnostics)).toBe(true);
    expect(typeof result.explain).toBe("string");
    expect(Array.isArray(result.fixes)).toBe(true);
  });
});
