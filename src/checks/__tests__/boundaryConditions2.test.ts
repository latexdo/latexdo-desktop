import { describe, it, expect } from "vitest";
import { runPdfComplianceChecks } from "../pdfCompliance";
import { runCitationChecks } from "../citationAssistant";
import { runAcronymChecks } from "../acronymManager";
import type {
  PdfComplianceSettings,
  CitationAssistantSettings,
  AcronymManagerSettings,
} from "../../types";

const P: PdfComplianceSettings = {
  enabled: true,
  maxPages: 8,
  maxAbstractWords: 250,
  checkPageCount: true,
  checkUnreferencedFigures: true,
  checkUncitedCitations: true,
  checkSectionsWithNoCitations: true,
  checkType3Fonts: true,
  checkAbstractWordCount: true,
};
const C: CitationAssistantSettings = {
  enabled: true,
  detectMissingCitations: true,
  detectUnusedEntries: true,
  detectDuplicateReferences: true,
  detectBrokenLinks: true,
  suggestCitationKeys: true,
  importMetadataSources: true,
  warnOldCitations: true,
};
const A: AcronymManagerSettings = {
  enabled: true,
  checkUndefinedAcronym: true,
  checkDuplicateDefinition: true,
  checkUnusedAcronym: true,
  checkConflictingDefinitions: true,
};

function doc(b: string): string {
  return "\\documentclass{article}\n\\begin{document}\n" + b + "\n\\end{document}\n";
}

// ── Section citation boundary ────────────────────────────────────────────
describe("Section citations", () => {
  const cases: [string, string, number][] = [
    ["no sections", "Content.", 0],
    ["1 section no cite", "\\section{A}B", 1],
    ["1 section with cite", "\\section{A}\\cite{r1}B", 0],
    ["2 sections no cites", "\\section{A}B\\section{C}D", 2],
    ["2 sections 1 cite", "\\section{A}\\cite{r1}B\\section{C}D", 1],
    ["2 sections 2 cites", "\\section{A}\\cite{r1}B\\section{C}\\cite{r2}D", 0],
    ["3 sections 1 cite", "\\section{A}\\cite{r1}B\\section{C}D\\section{E}F", 2],
    [
      "3 sections 2 cites",
      "\\section{A}\\cite{r1}B\\section{C}\\cite{r2}D\\section{E}F",
      1,
    ],
    [
      "3 sections 3 cites",
      "\\section{A}\\cite{r1}B\\section{C}\\cite{r2}D\\section{E}\\cite{r3}F",
      0,
    ],
  ];
  it.each(cases)("%s = %i issues", (desc, body, expected) => {
    expect(
      runPdfComplianceChecks(doc(body), "", P).filter((d) =>
        d.message.includes("no citations"),
      ).length,
    ).toBe(expected);
  });
});

// ── Figure reference boundary ────────────────────────────────────────────
describe("Figure references", () => {
  const cases: [string, string, boolean][] = [
    ["no figures", "Hi.", false],
    ["1 figure no label", "\\begin{figure}\\caption{A}\\end{figure}", false],
    [
      "1 figure label no ref",
      "\\begin{figure}\\label{fig:a}\\caption{A}\\end{figure}",
      true,
    ],
    [
      "1 figure with ref",
      "\\begin{figure}\\label{fig:a}\\caption{A}\\end{figure} See \\ref{fig:a}.",
      false,
    ],
    [
      "2 figs unreffed",
      "\\begin{figure}\\caption{A}\\end{figure}\\begin{figure}\\caption{B}\\end{figure}",
      false,
    ],
    [
      "2 figs 1 reffed",
      "\\begin{figure}\\label{fig:a}\\caption{A}\\end{figure}\\begin{figure}\\label{fig:b}\\caption{B}\\end{figure} See \\ref{fig:a}.",
      true,
    ],
    [
      "2 figs both reffed",
      "\\begin{figure}\\label{fig:a}\\caption{A}\\end{figure}\\begin{figure}\\label{fig:b}\\caption{B}\\end{figure} See \\ref{fig:a} and \\ref{fig:b}.",
      false,
    ],
  ];
  it.each(cases)("%s → issues=%s", (desc, body, expected) => {
    expect(
      runPdfComplianceChecks(doc(body), "", P).some((d) =>
        d.message.includes("never referenced"),
      ),
    ).toBe(expected);
  });
});

// ── Page count boundary ─────────────────────────────────────────────────
describe("Page count", () => {
  const cases: [number, boolean][] = [
    [0, false],
    [1, false],
    [7, false],
    [8, false],
    [9, true],
    [10, true],
    [100, true],
  ];
  it.each(cases)("pages=%i exceeds=%s", (pages, exceeds) => {
    expect(
      runPdfComplianceChecks(
        doc("Hi."),
        `Output written on paper.pdf (${pages} pages).`,
        P,
      ).some((d) => d.detail?.includes("exceed")),
    ).toBe(exceeds);
  });
});

// ── Abstract word count boundary ─────────────────────────────────────────
describe("Abstract word count", () => {
  const cases: [number, boolean][] = [
    [0, false],
    [1, false],
    [100, false],
    [200, false],
    [250, false],
    [251, true],
    [300, true],
    [500, true],
  ];
  it.each(cases)("words=%i exceeds=%s", (words, exceeds) => {
    const body = Array(words).fill("word").join(" ");
    expect(
      runPdfComplianceChecks(
        doc("\\begin{abstract}" + body + "\\end{abstract}"),
        "",
        P,
      ).some((d) => d.detail?.includes("exceed")),
    ).toBe(exceeds);
  });
});

// ── Custom max page ──────────────────────────────────────────────────────
describe("Custom max page", () => {
  const cases: [number, number, boolean][] = [
    [5, 4, true],
    [5, 5, false],
    [5, 6, false],
    [10, 8, true],
    [10, 10, false],
    [10, 12, false],
    [0, 8, false],
    [1, 1, false],
    [100, 100, false],
    [101, 100, true],
  ];
  it.each(cases)("pages=%i max=%i exceeds=%s", (pages, max, exceeds) => {
    expect(
      runPdfComplianceChecks(
        doc("Hi."),
        `Output written on paper.pdf (${pages} pages).`,
        { ...P, maxPages: max },
      ).some((d) => d.detail?.includes("exceed")),
    ).toBe(exceeds);
  });
});

// ── Acronym detection boundary ──────────────────────────────────────────
describe("Acronym detection boundary", () => {
  const cases: [string, string, boolean][] = [
    ["The is common", "The quick brown fox.", false],
    ["And is common", "And then we proceed.", false],
    ["CNN is technical", "CNN is a neural network.", true],
    ["GPU is well known", "GPU acceleration helps.", false],
    ["RAM is well known", "RAM is memory.", false],
    ["BERT is technical", "BERT language model.", true],
  ];
  it.each(cases)("%s", (desc, text, shouldFlag) => {
    expect(
      runAcronymChecks(doc(text), A).filter((d) =>
        d.message.includes("used without definition"),
      ).length > 0,
    ).toBe(shouldFlag);
  });
});

// ── Acronym definition vs usage ──────────────────────────────────────────
describe("Acronym definition vs usage", () => {
  const cases: [string, string, boolean][] = [
    ["defined and used", "ABC (Apple Byte Computer) ABC used again.", false],
    ["defined not used", "Apple Byte Computer (ABC) Other content.", true],
  ];
  it.each(cases)("%s", (desc, text, hasUnused) => {
    expect(
      runAcronymChecks(doc(text), A).filter((d) =>
        d.message.includes("never used again"),
      ).length > 0,
    ).toBe(hasUnused);
  });
});
