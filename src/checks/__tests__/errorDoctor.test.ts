import { describe, it, expect } from "vitest";
import { analyzeCompileOutput } from "../errorDoctor";
import type { ErrorDoctorSettings } from "../../types";

const defaultSettings: ErrorDoctorSettings = {
  enabled: true,
  explainErrors: true,
  suggestFixes: true,
  autoFixCommon: true,
};

describe("analyzeCompileOutput", () => {
  it("returns empty when disabled", () => {
    const result = analyzeCompileOutput("output", "content", {
      ...defaultSettings,
      enabled: false,
    });
    expect(result.diagnostics).toHaveLength(0);
  });

  it("returns empty for empty output", () => {
    const result = analyzeCompileOutput("", "content", defaultSettings);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("detects undefined control sequence", () => {
    const output = "! Undefined control sequence.\nl.10 \\unknowncmd\n?";
    const result = analyzeCompileOutput(output, "\\unknowncmd", defaultSettings);
    expect(
      result.diagnostics.some((d) => d.message.includes("Undefined control sequence")),
    ).toBe(true);
  });

  it("detects file not found error", () => {
    const output = "! LaTeX Error: File `nonexistent.sty' not found.";
    const result = analyzeCompileOutput(output, "", defaultSettings);
    expect(result.diagnostics.some((d) => d.message.includes("File"))).toBe(true);
  });

  it("detects missing begin document", () => {
    const output = "! LaTeX Error: Missing \\begin{document}.";
    const result = analyzeCompileOutput(output, "", defaultSettings);
    expect(result.diagnostics.some((d) => d.message.includes("Missing"))).toBe(true);
  });

  it("detects runaway argument", () => {
    const output =
      "Runaway argument?\n! Paragraph ended before \\section was complete.";
    const result = analyzeCompileOutput(output, "", defaultSettings);
    expect(result.diagnostics.some((d) => d.message.includes("Runaway"))).toBe(true);
  });

  it("does not detect overfull hbox (not in error patterns)", () => {
    const output = "Overfull \\hbox (12.5pt too wide) in paragraph at lines 10--12";
    const result = analyzeCompileOutput(output, "", defaultSettings);
    expect(result.diagnostics.some((d) => d.message.includes("Overfull"))).toBe(false);
  });

  it("does not detect underfull hbox (not in error patterns)", () => {
    const output = "Underfull \\hbox (badness 10000) in paragraph at lines 5--7";
    const result = analyzeCompileOutput(output, "", defaultSettings);
    expect(result.diagnostics.some((d) => d.message.includes("Underfull"))).toBe(false);
  });

  it("handles output with no errors", () => {
    const output = "This is pdfTeX. Output written on paper.pdf (8 pages).";
    const result = analyzeCompileOutput(output, "content", defaultSettings);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("provides suggestions when suggestFixes is enabled", () => {
    const output = "! Undefined control sequence.\nl.10 \\unknowncmd";
    const result = analyzeCompileOutput(output, "\\unknowncmd", defaultSettings);
    const withSuggestion = result.diagnostics.filter((d) => d.suggestion);
    expect(withSuggestion.length).toBeGreaterThan(0);
  });

  it("returns empty diagnostics when explainErrors is disabled", () => {
    const output = "! Undefined control sequence.\nl.10 \\unknowncmd";
    const result = analyzeCompileOutput(output, "\\unknowncmd", {
      ...defaultSettings,
      explainErrors: false,
    });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("handles multiple errors in output", () => {
    const output = [
      "! Undefined control sequence.\nl.10 \\unknowncmd",
      "! LaTeX Error: File `x.sty' not found.",
    ].join("\n");
    const result = analyzeCompileOutput(output, "", defaultSettings);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("returns fixes array even when empty", () => {
    const output = "Clean output.";
    const result = analyzeCompileOutput(output, "content", defaultSettings);
    expect(Array.isArray(result.fixes)).toBe(true);
  });

  it("returns explain string even when empty", () => {
    const output = "Clean output.";
    const result = analyzeCompileOutput(output, "content", defaultSettings);
    expect(typeof result.explain).toBe("string");
  });
});
