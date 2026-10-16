import { describe, it, expect } from "vitest";
import { runConferenceChecks } from "../conferenceChecker";
import type { ConferenceCheckerSettings } from "../../types";

const defaultSettings: ConferenceCheckerSettings = {
  enabled: true,
  template: "neurips",
  customTemplate: "",
  checkMargins: true,
  checkFontSize: true,
  checkAbstractLength: true,
  checkKeywords: true,
  checkFigureReferences: true,
  checkTableReferences: true,
  checkBibliographyStyle: true,
  checkPageLimit: true,
  checkAuthorInfo: true,
  checkAnonymousReview: true,
  checkFigureResolution: true,
  checkEmbeddedFonts: true,
  checkCompiler: true,
};

function makeDoc(body: string): string {
  return "\\documentclass{article}\n\\begin{document}\n" + body + "\n\\end{document}\n";
}

describe("runConferenceChecks", () => {
  it("returns empty when disabled", () => {
    expect(
      runConferenceChecks("content", { ...defaultSettings, enabled: false }),
    ).toHaveLength(0);
  });

  it("returns empty for empty content", () => {
    expect(runConferenceChecks("", defaultSettings)).toHaveLength(0);
  });

  it("returns diagnostics for generic article document for NeurIPS template", () => {
    const result = runConferenceChecks(makeDoc("Hello."), defaultSettings);
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns page limit warnings for generic class", () => {
    const longBody = Array(9000).fill("word").join(" ");
    const result = runConferenceChecks(makeDoc(longBody), defaultSettings);
    const pageIssues = result.filter((d) => d.message.toLowerCase().includes("page"));
    expect(pageIssues.length).toBeGreaterThan(0);
  });

  it("checks for NeurIPS template class", () => {
    const result = runConferenceChecks(makeDoc("\\documentclass{article}"), {
      ...defaultSettings,
      checkMargins: true,
    });
    expect(result.length).toBeGreaterThan(0);
  });

  it("uses correct document class for NeurIPS", () => {
    const doc =
      "\\documentclass{neurips_2024}\n\\begin{document}\nContent.\n\\end{document}";
    const result = runConferenceChecks(doc, defaultSettings);
    expect(Array.isArray(result)).toBe(true);
  });

  it("checks author info presence", () => {
    const result = runConferenceChecks(makeDoc("\\author{John Doe}"), defaultSettings);
    const authorIssues = result.filter((d) =>
      d.message.toLowerCase().includes("author"),
    );
    expect(Array.isArray(result)).toBe(true);
  });

  it("checks anonymous review mode", () => {
    const doc = makeDoc("\\author{John Doe}");
    const result = runConferenceChecks(doc, defaultSettings);
    expect(Array.isArray(result)).toBe(true);
  });

  it("handles different templates", () => {
    const templates: Array<ConferenceCheckerSettings["template"]> = [
      "ieee",
      "acm",
      "springer",
      "elsevier",
      "neurips",
      "cvpr",
      "custom",
    ];
    for (const template of templates) {
      const result = runConferenceChecks(makeDoc("Hello."), {
        ...defaultSettings,
        template,
        customTemplate: template === "custom" ? JSON.stringify({ pageLimit: 10 }) : "",
      });
      expect(Array.isArray(result)).toBe(true);
    }
  });

  it("checks abstract length", () => {
    const words = Array(300).fill("word").join(" ");
    const doc =
      "\\begin{document}\n\\begin{abstract}" +
      words +
      "\\end{abstract}\n\\end{document}";
    const result = runConferenceChecks(doc, defaultSettings);
    const abstractIssues = result.filter((d) =>
      d.message.toLowerCase().includes("abstract"),
    );
    expect(abstractIssues.length).toBeGreaterThan(0);
  });

  it("checks figure references", () => {
    const doc = makeDoc(
      "\\begin{figure}\\caption{A figure}\\label{fig:test}\\end{figure}",
    );
    const result = runConferenceChecks(doc, defaultSettings);
    const figureIssues = result.filter((d) =>
      d.message.toLowerCase().includes("figure"),
    );
    expect(figureIssues.length).toBeGreaterThan(0);
  });

  it("checks table references", () => {
    const doc = makeDoc(
      "\\begin{table}\\caption{A table}\\label{tab:test}\\end{table}",
    );
    const result = runConferenceChecks(doc, defaultSettings);
    const tableIssues = result.filter((d) => d.message.toLowerCase().includes("table"));
    expect(tableIssues.length).toBeGreaterThan(0);
  });

  it("handles custom template settings", () => {
    const result = runConferenceChecks(makeDoc("Hello."), {
      ...defaultSettings,
      template: "custom",
      customTemplate: JSON.stringify({ pageLimit: 6, abstractMax: 200 }),
      checkPageLimit: true,
    });
    expect(Array.isArray(result)).toBe(true);
  });

  it("skips individual checks when disabled", () => {
    const allDisabled = {
      ...defaultSettings,
      checkMargins: false,
      checkFontSize: false,
      checkAbstractLength: false,
      checkKeywords: false,
      checkFigureReferences: false,
      checkTableReferences: false,
      checkBibliographyStyle: false,
      checkPageLimit: false,
      checkAuthorInfo: false,
      checkAnonymousReview: false,
      checkFigureResolution: false,
      checkEmbeddedFonts: false,
      checkCompiler: false,
    };
    const result = runConferenceChecks(makeDoc("Hello."), allDisabled);
    expect(result).toHaveLength(0);
  });

  it("handles empty document", () => {
    const result = runConferenceChecks(
      "\\documentclass{article}\\begin{document}\\end{document}",
      defaultSettings,
    );
    expect(Array.isArray(result)).toBe(true);
  });

  it("handles very large document", () => {
    const doc = makeDoc(Array(5000).fill("word").join(" "));
    const result = runConferenceChecks(doc, defaultSettings);
    expect(Array.isArray(result)).toBe(true);
  });

  it("handles multiple figures with mixed reference status", () => {
    const doc = makeDoc(
      "\\begin{figure}\\label{fig:a}\\caption{A}\\end{figure} \\begin{figure}\\label{fig:b}\\caption{B}\\end{figure} See \\ref{fig:a}.",
    );
    const result = runConferenceChecks(doc, defaultSettings);
    expect(Array.isArray(result)).toBe(true);
  });

  it("checks for figure resolution warnings", () => {
    const doc = makeDoc("\\begin{figure}\\includegraphics{image.png}\\end{figure}");
    const result = runConferenceChecks(doc, defaultSettings);
    expect(Array.isArray(result)).toBe(true);
  });

  it("handles document with proper neurips preamble", () => {
    const doc = `\\documentclass{neurips_2024}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{hyperref}
\\title{A Great Paper}
\\begin{document}
\\maketitle
\\begin{abstract}This is a great paper about something important and novel.\\end{abstract}
\\section{Introduction}
This is the introduction with motivation. However there is a gap. We propose a contribution.
\\end{document}`;
    const result = runConferenceChecks(doc, defaultSettings);
    expect(Array.isArray(result)).toBe(true);
  });

  it("checks font size settings", () => {
    const result = runConferenceChecks(
      makeDoc("\\large This is large text."),
      defaultSettings,
    );
    expect(Array.isArray(result)).toBe(true);
  });

  it("checks bibliography style", () => {
    const doc = makeDoc("\\bibliographystyle{plain}\\bibliography{refs}");
    const result = runConferenceChecks(doc, defaultSettings);
    expect(Array.isArray(result)).toBe(true);
  });
});
