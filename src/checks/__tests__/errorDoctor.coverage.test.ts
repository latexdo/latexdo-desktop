import { describe, expect, it } from "vitest";
import { analyzeCompileOutput } from "../errorDoctor";
import type { ErrorDoctorSettings } from "../../types";

const all: ErrorDoctorSettings = {
  enabled: true,
  explainErrors: true,
  suggestFixes: true,
  autoFixCommon: true,
};

function only(output: string, settings: ErrorDoctorSettings = all) {
  return analyzeCompileOutput(output, "", settings);
}

describe("errorDoctor auto-fixes", () => {
  it("escapes an underscore found near a Missing $ error", () => {
    const result = only("! Missing $ inserted.\n<inserted text>\nl.12 the model_name here");
    expect(result.fixes).toEqual([
      { line: 12, find: "model_name", replace: "model\\_name" },
    ]);
    const fixDiag = result.diagnostics.find((d) => d.code === "auto-fix");
    expect(fixDiag).toMatchObject({
      line: 12,
      severity: "warning",
      message: "Auto-fix available: Missing $ inserted",
      suggestion: 'Replace "model_name" with "model\\_name"',
      replacements: ["model\\_name"],
    });
    const explain = result.diagnostics.find((d) => d.code === "Missing $ inserted");
    expect(explain?.suggestion).toContain("Escape the underscore");
  });

  it("offers no fix for Missing $ without an underscore in context", () => {
    const result = only("! Missing $ inserted.\nl.3 x^2");
    expect(result.fixes).toEqual([]);
  });

  it("closes an unbalanced brace near a runaway argument", () => {
    const result = only("Runaway argument?\n\\section{Intro\nl.7 ");
    expect(result.fixes).toEqual([
      { line: 7, find: "\\section{Intro", replace: "\\section{Intro\n}" },
    ]);
  });

  it("offers no fix for a balanced runaway argument", () => {
    expect(only("Runaway argument?\n\\section{Intro}").fixes).toEqual([]);
  });

  it("skips the fix when auto-fixing is disabled", () => {
    const result = only("! Missing $ inserted.\nmodel_name", { ...all, autoFixCommon: false });
    expect(result.fixes).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not attach suggestions when explanations are off", () => {
    const result = only("! Missing $ inserted.\nplain", {
      ...all,
      explainErrors: false,
      autoFixCommon: false,
    });
    expect(result.diagnostics).toEqual([]);
  });
});

describe("errorDoctor suggestions", () => {
  const suggestionFor = (output: string) => only(output).diagnostics[0]?.suggestion ?? "";

  it("defaults to line 1 when the log has no line marker", () => {
    expect(only("! TeX capacity exceeded, sorry").diagnostics[0].line).toBe(1);
  });

  it.each([
    ["! Missing number, treated as zero.", "empty length arguments"],
    ["! Paragraph ended before \\caption was complete.", "fixes for \\caption:"],
    ["! LaTeX Error: Environment foo undefined. Undefined environment 'alignx'", 'environment "alignx"'],
    ["Undefined environment theorem", 'environment "theorem"'],
    ["! LaTeX Error: Option clash for package xcolor.", 'package "xcolor"'],
    ["! LaTeX Error: Option clash for package", 'package "(unknown)"'],
    ["! Extra \\right.", "\\right)"],
    ["! TeX capacity exceeded, sorry [main memory size=5000000].", "recursive definitions"],
    ["! LaTeX Error: Too many unprocessed floats.", "[htbp]"],
    ["! LaTeX Error: Unknown package \\usepackage{foo}", 'package "foo"'],
    ["! LaTeX Error: Missing package", 'package "(unknown)"'],
    ["! Undefined control sequence.\nl.10 Some text \\bar{x} \\foo", "command \\foo"],
    ["! Undefined control sequence.\nl.10 plain text", "command (unknown)"],
    ["! Undefined control sequence.", "(unknown)"],
  ])("explains %s", (output, expected) => {
    expect(suggestionFor(output)).toContain(expected.replace(/\\\\/g, "\\"));
  });

  it("names the undefined command in the \\newcommand hint", () => {
    expect(suggestionFor("! Undefined control sequence.\nl.3 \\mycmd")).toContain(
      "\\newcommand{\\mycmd}{...}",
    );
  });

  it.each([
    "! Missing number, treated as zero.\nl.4 \\hspace{}",
    "! Paragraph ended before \\textbf was complete.\nl.4",
    "Undefined environment foo\nl.4",
    "Option clash for package x\nl.4",
    "! Missing \\right. inserted.\nl.4",
    "! TeX capacity exceeded\nl.4",
    "! Too many unprocessed floats.\nl.4",
    "! Missing \\begin{document}.\nl.4",
  ])("has no automatic fix for %s", (output) => {
    expect(only(output).fixes).toEqual([]);
  });
});
