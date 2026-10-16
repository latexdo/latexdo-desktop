import { describe, it, expect } from "vitest";
import { runPdfComplianceChecks } from "../pdfCompliance";
import type { PdfComplianceSettings } from "../../types";

const full: PdfComplianceSettings = {
  enabled: true,
  checkPageCount: true,
  maxPages: 8,
  checkUnreferencedFigures: true,
  checkUncitedCitations: true,
  checkSectionsWithNoCitations: true,
  checkType3Fonts: true,
  checkAbstractWordCount: true,
  maxAbstractWords: 250,
};

// ── Page count variants ──────────────────────────────────────────────────
const pageCounts = [
  { pages: 8, within: true },
  { pages: 9, within: false },
  { pages: 10, within: false },
  { pages: 20, within: false },
  { pages: 1, within: true },
];
describe("Page count — parameterized", () => {
  it.each(pageCounts)("$pages pages, limit 8 → $within", ({ pages, within }) => {
    const doc = "\\documentclass{article}\\begin{document}Hello.\\end{document}";
    const output = `Output written on paper.pdf (${pages} pages, 1234 bytes).`;
    const result = runPdfComplianceChecks(doc, output, full);
    if (within) {
      expect(
        result.some(
          (d) => d.detail?.includes("exceed") || d.message.includes("exceed"),
        ),
      ).toBe(false);
    } else {
      expect(
        result.some(
          (d) => d.detail?.includes("exceed") || d.message.includes("exceed"),
        ),
      ).toBe(true);
    }
  });
});

// ── Max page variants ────────────────────────────────────────────────────
const maxPageVariants: [number, number, boolean][] = [
  [5, 4, false],
  [5, 5, true],
  [5, 6, true],
  [10, 8, false],
  [10, 10, true],
  [10, 12, true],
];
describe("Page count with custom max — parameterized", () => {
  it.each(maxPageVariants)("pages=%i max=%i → %s", (pages, maxPages, expectWithin) => {
    const doc = "\\documentclass{article}\\begin{document}Hello.\\end{document}";
    const output = `Output written on paper.pdf (${pages} pages, 1234 bytes).`;
    const result = runPdfComplianceChecks(doc, output, {
      ...full,
      maxPages,
      checkPageCount: true,
    });
    expect(
      result.some((d) => d.detail?.includes("exceed") || d.message.includes("exceed")),
    ).toBe(!expectWithin);
  });
});

// ── Figure reference variants ────────────────────────────────────────────
const figureVariants = [
  {
    desc: "no label, one figure",
    doc: "\\documentclass{article}\\begin{document}\\begin{figure}\\caption{A}\\end{figure}\\end{document}",
    hasRefIssue: true,
  },
  {
    desc: "label but no ref",
    doc: "\\documentclass{article}\\begin{document}\\begin{figure}\\label{fig:a}\\caption{A}\\end{figure}\\end{document}",
    hasRefIssue: true,
  },
  {
    desc: "label and ref",
    doc: "\\documentclass{article}\\begin{document}\\begin{figure}\\label{fig:a}\\caption{A}\\end{figure} See \\ref{fig:a}.\\end{document}",
    hasRefIssue: false,
  },
  {
    desc: "multiple figures, one referenced",
    doc: "\\documentclass{article}\\begin{document}\\begin{figure}\\label{fig:a}\\caption{A}\\end{figure}\\begin{figure}\\label{fig:b}\\caption{B}\\end{figure} See \\ref{fig:a}.\\end{document}",
    hasRefIssue: true,
  },
  {
    desc: "all figures referenced",
    doc: "\\documentclass{article}\\begin{document}\\begin{figure}\\label{fig:a}\\caption{A}\\end{figure}\\begin{figure}\\label{fig:b}\\caption{B}\\end{figure} See \\ref{fig:a} and \\ref{fig:b}.\\end{document}",
    hasRefIssue: false,
  },
];
describe("Figure references — parameterized", () => {
  it.each(figureVariants)("$desc", ({ doc, hasRefIssue }) => {
    const result = runPdfComplianceChecks(doc, "", full);
    expect(
      result.some(
        (d) =>
          d.message.includes("never referenced") || d.message.includes("no \\label"),
      ),
    ).toBe(hasRefIssue);
  });
});

// ── Citation variants ────────────────────────────────────────────────────
const citationVariants = [
  {
    desc: "no bib",
    doc: "\\documentclass{article}\\begin{document}Hello.\\end{document}",
    hasUncited: false,
  },
  {
    desc: "one bibitem uncited",
    doc: "\\documentclass{article}\\begin{document}Hello.\\begin{thebibliography}\\bibitem{r1} A.\\end{thebibliography}\\end{document}",
    hasUncited: true,
  },
  {
    desc: "one bibitem cited",
    doc: "\\documentclass{article}\\begin{document}See \\cite{r1}.\\begin{thebibliography}\\bibitem{r1} A.\\end{thebibliography}\\end{document}",
    hasUncited: false,
  },
  {
    desc: "multiple bibitems, some uncited",
    doc: "\\documentclass{article}\\begin{document}See \\cite{r1}.\\begin{thebibliography}\\bibitem{r1} A.\\bibitem{r2} B.\\bibitem{r3} C.\\end{thebibliography}\\end{document}",
    hasUncited: true,
  },
  {
    desc: "all bibitems cited",
    doc: "\\documentclass{article}\\begin{document}See \\cite{r1,r2,r3}.\\begin{thebibliography}\\bibitem{r1} A.\\bibitem{r2} B.\\bibitem{r3} C.\\end{thebibliography}\\end{document}",
    hasUncited: false,
  },
];
describe("Citation checks — parameterized", () => {
  it.each(citationVariants)("$desc", ({ doc, hasUncited }) => {
    const result = runPdfComplianceChecks(doc, "", full);
    expect(result.some((d) => d.message.includes("never cited"))).toBe(hasUncited);
  });
});

// ── Section citation variants ────────────────────────────────────────────
const sectionCiteVariants = [
  {
    desc: "no cites in any section",
    // Results reports the paper's own work, so only Method is flagged.
    doc: "\\documentclass{article}\\begin{document}\\section{Method}Hello.\\section{Results}World.\\end{document}",
    expectedIssues: 1,
  },
  {
    desc: "one section cited",
    doc: "\\documentclass{article}\\begin{document}\\section{Method}See \\cite{r1}.\\section{Results}World.\\end{document}",
    expectedIssues: 0,
  },
  {
    desc: "all sections cited",
    doc: "\\documentclass{article}\\begin{document}\\section{Method}See \\cite{r1}.\\section{Results}See \\cite{r2}.\\end{document}",
    expectedIssues: 0,
  },
];
describe("Section citations — parameterized", () => {
  it.each(sectionCiteVariants)("$desc", ({ doc, expectedIssues }) => {
    const result = runPdfComplianceChecks(doc, "", full);
    const issues = result.filter((d) => d.message.includes("no citations"));
    expect(issues.length).toBe(expectedIssues);
  });
});

// ── Abstract word count variants ─────────────────────────────────────────
const abstractWordVariants = [
  { words: 100, exceeds: false },
  { words: 250, exceeds: false },
  { words: 251, exceeds: true },
  { words: 300, exceeds: true },
  { words: 500, exceeds: true },
];
describe("Abstract word count — parameterized", () => {
  it.each(abstractWordVariants)(
    "$words words → exceeds=$exceeds",
    ({ words, exceeds }) => {
      const content = Array(words).fill("word").join(" ");
      const doc =
        "\\begin{document}\\begin{abstract}" +
        content +
        "\\end{abstract}\\end{document}";
      const result = runPdfComplianceChecks(doc, "", full);
      expect(
        result.some(
          (d) =>
            d.detail?.includes("exceed") ||
            d.message.includes("exceed") ||
            d.message.includes("exceeding"),
        ),
      ).toBe(exceeds);
    },
  );
});

// ── Abstract word count with custom max ──────────────────────────────────
const customAbstractMax = [
  { words: 50, max: 100, exceeds: false },
  { words: 100, max: 100, exceeds: false },
  { words: 101, max: 100, exceeds: true },
  { words: 200, max: 150, exceeds: true },
];
describe("Abstract word count with custom max — parameterized", () => {
  it.each(customAbstractMax)(
    "$words words, max=$max → exceeds=$exceeds",
    ({ words, max, exceeds }) => {
      const content = Array(words).fill("word").join(" ");
      const doc =
        "\\begin{document}\\begin{abstract}" +
        content +
        "\\end{abstract}\\end{document}";
      const result = runPdfComplianceChecks(doc, "", {
        ...full,
        checkAbstractWordCount: true,
        maxAbstractWords: max,
      });
      expect(
        result.some(
          (d) =>
            d.detail?.includes("exceed") ||
            d.message.includes("exceed") ||
            d.message.includes("exceeding"),
        ),
      ).toBe(exceeds);
    },
  );
});

// ── Type 3 font variants ─────────────────────────────────────────────────
const fontVariants = [
  { output: "No type 3 fonts.", found: true },
  { output: "PDF contains Type 3 fonts.", found: true },
  { output: "type 3 font detected", found: true },
  { output: "All fonts are Type 1.", found: false },
];
describe("Type 3 fonts — parameterized", () => {
  it.each(fontVariants)("$output", ({ output, found }) => {
    const result = runPdfComplianceChecks("Content", output, full);
    expect(result.some((d) => d.message.includes("contains"))).toBe(found);
  });
});

// ── Check toggling ──────────────────────────────────────────────────────
const checkToggles: [string, keyof PdfComplianceSettings, string, string][] = [
  [
    "page count",
    "checkPageCount",
    "Output written on paper.pdf (10 pages, 1234 bytes).",
    "page",
  ],
  ["figures", "checkUnreferencedFigures", "", "never referenced"],
  ["uncited", "checkUncitedCitations", "", "never cited"],
  ["section citations", "checkSectionsWithNoCitations", "", "no citations"],
  ["type3 fonts", "checkType3Fonts", "Type 3 fonts.", "Type 3"],
  ["abstract", "checkAbstractWordCount", "", "Abstract"],
];
describe("Check toggling — parameterized", () => {
  it.each(checkToggles)(
    "disabling %s removes its diagnostics",
    (name, setting, output, msgContent) => {
      const doc =
        "\\documentclass{article}\\begin{document}\\begin{abstract}" +
        Array(300).fill("word").join(" ") +
        "\\end{abstract}\\section{Test}Hello.\\begin{figure}\\label{fig:x}\\caption{X}\\end{figure}\\begin{thebibliography}\\bibitem{r1} A.\\end{thebibliography}\\end{document}";
      const enabled = runPdfComplianceChecks(doc, output, { ...full, [setting]: true });
      const disabled = runPdfComplianceChecks(doc, output, {
        ...full,
        [setting]: false,
      });
      expect(
        enabled.some(
          (d) =>
            d.message.includes(msgContent) ||
            (msgContent === "page" && d.message.toLowerCase().includes("page")),
        ),
      ).toBe(true);
      expect(
        disabled.some(
          (d) =>
            d.message.includes(msgContent) ||
            (msgContent === "page" && d.message.toLowerCase().includes("page")),
        ),
      ).toBe(false);
    },
  );
});

// ── Edge case combinations ──────────────────────────────────────────────
const edgeCases = [
  { desc: "empty content and output", content: "", output: "" },
  { desc: "only content", content: "Hi", output: "" },
  {
    desc: "only output",
    content: "",
    output: "Output written on paper.pdf (5 pages).",
  },
  {
    desc: "unicode in content",
    content: "\\documentclass{article}\\begin{document}∀x∃y\\end{document}",
    output: "",
  },
  {
    desc: "very large content",
    content:
      "\\documentclass{article}\\begin{document}" +
      Array(10000).fill("word").join(" ") +
      "\\end{document}",
    output: "",
  },
  {
    desc: "nested section with math",
    content:
      "\\documentclass{article}\\begin{document}\\section{Method $\\theta$}Content.\\end{document}",
    output: "",
  },
];
describe("PDF compliance edge cases — parameterized", () => {
  it.each(edgeCases)("handles $desc", ({ content, output }) => {
    const result = runPdfComplianceChecks(content, output, full);
    expect(Array.isArray(result)).toBe(true);
  });
});
