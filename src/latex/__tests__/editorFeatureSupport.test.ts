import { describe, expect, it } from "vitest";
import {
  buildLatexFoldingRanges,
  extractLatexOutline,
  findLatexDocumentLinkAtOffset,
  findLatexDocumentLinks,
  formatLatexDocumentLayout,
  formatLatexListIndentation,
  formatLatexTableAtOffset,
  latexCommandSnippets,
} from "../editorFeatureSupport";

describe("editor feature support", () => {
  it("detects LaTeX href/url commands and literal web links", () => {
    const source = [
      "\\href{https://latexdo.org/downloads/}{downloads}",
      "See \\url{www.example.com} and https://example.org/docs.",
    ].join("\n");

    const links = findLatexDocumentLinks(source);

    expect(links.map((link) => link.url)).toEqual([
      "https://latexdo.org/downloads/",
      "https://www.example.com",
      "https://example.org/docs",
    ]);
    expect(
      findLatexDocumentLinkAtOffset(source, source.indexOf("downloads")),
    ).toMatchObject({ url: "https://latexdo.org/downloads/" });
  });

  it("builds folding ranges for sections, environments, and comment blocks", () => {
    const source = [
      "% first",
      "% second",
      "\\section{Intro}",
      "Text",
      "\\begin{figure}",
      "\\caption{A}",
      "\\end{figure}",
      "\\section{Next}",
      "More",
    ].join("\n");

    const ranges = buildLatexFoldingRanges(source);

    expect(ranges).toContainEqual({ start: 1, end: 2, kind: "comment" });
    expect(ranges).toContainEqual({ start: 3, end: 7, kind: "region" });
    expect(ranges).toContainEqual({ start: 5, end: 7, kind: "region" });
  });

  it("extracts a live document outline", () => {
    const outline = extractLatexOutline(
      "\\section{Intro}\n\\subsection{Method}\n\\begin{figure}\n\\end{figure}",
    );

    expect(outline.map((item) => [item.detail, item.label, item.line])).toEqual([
      ["\\section", "Intro", 1],
      ["\\subsection", "Method", 2],
      ["\\begin{figure}", "figure", 3],
    ]);
  });

  it("formats the surrounding tabular block at the cursor", () => {
    const source = [
      "\\begin{tabular}{lrr}",
      "Name & Value & Note \\\\",
      "Longer name & 2 & ok \\\\",
      "\\end{tabular}",
    ].join("\n");

    const result = formatLatexTableAtOffset(source, source.indexOf("Value"));

    expect(result?.text).toContain("Name        & Value & Note \\\\");
    expect(result?.text).toContain("Longer name & 2     & ok \\\\");
  });

  it("formats LaTeX list item indentation", () => {
    const source = [
      "\\subsection{Units}",
      "\\begin{itemize}",
      "\\item Use SI units.",
      "\\item Avoid mixing units.",
      "\\end{itemize}",
    ].join("\n");

    expect(formatLatexListIndentation(source)).toBe(
      [
        "\\subsection{Units}",
        "\\begin{itemize}",
        "    \\item Use SI units.",
        "    \\item Avoid mixing units.",
        "\\end{itemize}",
      ].join("\n"),
    );
  });

  it("formats nested LaTeX lists by depth", () => {
    const source = [
      "\\begin{enumerate}",
      "\\item Parent",
      "\\begin{itemize}",
      "\\item Child",
      "\\end{itemize}",
      "\\end{enumerate}",
    ].join("\n");

    expect(formatLatexListIndentation(source)).toBe(
      [
        "\\begin{enumerate}",
        "    \\item Parent",
        "    \\begin{itemize}",
        "        \\item Child",
        "    \\end{itemize}",
        "\\end{enumerate}",
      ].join("\n"),
    );
  });

  it("adds structural spacing after LaTeX headings", () => {
    const source = [
      "\\subsection{The Oracle Gap}",
      "Suppose a repository has buggy revision $B$ and fixed revision $F$.",
    ].join("\n");

    expect(formatLatexDocumentLayout(source)).toBe(
      [
        "\\subsection{The Oracle Gap}",
        "",
        "Suppose a repository has buggy revision $B$ and fixed revision $F$.",
      ].join("\n"),
    );
  });

  it("adds structural spacing before headings that follow prose", () => {
    const source = [
      "This paragraph closes the previous idea.",
      "\\section{Next Idea}",
      "The next idea starts here.",
    ].join("\n");

    expect(formatLatexDocumentLayout(source)).toBe(
      [
        "This paragraph closes the previous idea.",
        "",
        "\\section{Next Idea}",
        "",
        "The next idea starts here.",
      ].join("\n"),
    );
  });

  it("formats list indentation and heading spacing together", () => {
    const source = [
      "\\subsection{Units}",
      "\\begin{itemize}",
      "\\item Use SI units.",
      "\\end{itemize}",
    ].join("\n");

    expect(formatLatexDocumentLayout(source)).toBe(
      [
        "\\subsection{Units}",
        "",
        "\\begin{itemize}",
        "    \\item Use SI units.",
        "\\end{itemize}",
      ].join("\n"),
    );
  });

  it("includes production snippets for wizards, tables, formulas, and Asymptote", () => {
    const labels = new Set(latexCommandSnippets.map((snippet) => snippet.label));

    expect([...labels]).toEqual(
      expect.arrayContaining(["beamer", "letter", "tabular", "array", "asy"]),
    );
    expect(latexCommandSnippets.length).toBeGreaterThan(50);
  });
});
