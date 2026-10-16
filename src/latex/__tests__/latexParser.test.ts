import { describe, it, expect } from "vitest";
import { parseBibFile } from "../parseBib";
import { parseTexLabels } from "../parseTexLabels";
import { buildLatexIndex } from "../buildLatexIndex";
import type { ProjectFile } from "../buildLatexIndex";

// ── BibTeX entry variants ────────────────────────────────────────────────
const bibVariants = [
  {
    desc: "article",
    content:
      "@article{key1,\nauthor={John Doe},\ntitle={A Paper},\nyear={2020},\njournal={JMLR},\n}",
  },
  {
    desc: "inproceedings",
    content:
      "@inproceedings{key2,\nauthor={Jane Doe},\ntitle={Another Paper},\nyear={2021},\nbooktitle={NeurIPS},\n}",
  },
  {
    desc: "book",
    content:
      "@book{key3,\nauthor={Book Author},\ntitle={The Book},\npublisher={Springer},\nyear={2019},\n}",
  },
  {
    desc: "inbook",
    content:
      "@inbook{key4,\nauthor={Chap Author},\ntitle={Chapter},\nbooktitle={Big Book},\npublisher={Elsevier},\nyear={2018},\n}",
  },
  {
    desc: "phdthesis",
    content:
      "@phdthesis{key5,\nauthor={PhD Student},\ntitle={Thesis Title},\nyear={2022},\nschool={MIT},\n}",
  },
  {
    desc: "techreport",
    content:
      "@techreport{key6,\nauthor={Report Writer},\ntitle={Tech Report},\nyear={2017},\ninstitution={Stanford},\n}",
  },
  {
    desc: "misc with URL",
    content:
      "@misc{key7,\nauthor={Online Author},\ntitle={Online Resource},\nyear={2023},\nurl={https://example.com},\n}",
  },
  {
    desc: "multiple entries",
    content:
      "@article{key1,title={A},author={X},year={2020},journal={Y},}\n@inproceedings{key2,title={B},author={Y},year={2021},booktitle={Z},}",
  },
  {
    desc: "entry with braces in title",
    content:
      "@article{key8,\ntitle={{Braced} Title},\nauthor={Author},\nyear={2020},\njournal={J},\n}",
  },
  {
    desc: "entry with special chars",
    content:
      "@article{key9,\ntitle={Schrödinger's Cat: A {Tale} of $\\Psi$},\nauthor={Über Author},\nyear={2020},\njournal={Nature Physics},\n}",
  },
  {
    desc: "single entry bare",
    content: "@article{key10,title={Minimal},author={Min},year={2000},journal={Min},}",
  },
];
describe("BibTeX parsing — parameterized", () => {
  it.each(bibVariants)("parses $desc", ({ desc, content }) => {
    const entries = parseBibFile(content, "refs.bib");
    expect(entries.length).toBeGreaterThan(0);
    entries.forEach((e) => {
      expect(e.key).toBeTruthy();
      expect(e.type).toBeTruthy();
      expect(e.sourceFile).toBe("refs.bib");
    });
  });
});

// ── BibTeX: empty / edge inputs ─────────────────────────────────────────
const bibEdgeCases = [
  { desc: "empty content", content: "", expected: 0 },
  { desc: "only whitespace", content: "   \n\n  ", expected: 0 },
  { desc: "comment only", content: "% This is a comment", expected: 0 },
  { desc: "malformed entry", content: "@article{key1, title={unclosed", expected: 0 },
  { desc: "no citation key", content: '@string{foo = "bar"}', expected: 0 },
  { desc: "empty tags", content: "@article{key1,}", expected: 1 },
  {
    desc: "very many entries",
    content: Array(100)
      .fill(null)
      .map(
        (_, i) =>
          `@article{k${i},title={T${i}},author={A${i}},year={2020},journal={J},}`,
      )
      .join("\n"),
    expected: 100,
  },
  {
    desc: "unicode in entry key",
    content: "@article{über,title={T},author={A},year={2020},journal={J},}",
  },
];
describe("BibTeX edge cases — parameterized", () => {
  it.each(bibEdgeCases)("handles $desc", ({ content, expected }) => {
    const entries = parseBibFile(content, "test.bib");
    if (expected !== undefined) expect(entries.length).toBe(expected);
    else expect(Array.isArray(entries)).toBe(true);
  });

  it("bounds oversized bibliography input before parsing", () => {
    const oversized = `@article{k,title={${"x".repeat(2 * 1024 * 1024)}}}`;
    expect(parseBibFile(oversized, "oversized.bib")).toEqual([]);
  });
});

// ── BibTeX: specific field values ────────────────────────────────────────
const fieldVariants = [
  {
    desc: "title",
    content: "@article{k,title={My Title},author={A},year={2020},journal={J},}",
    field: "title",
    val: "My Title",
  },
  {
    desc: "author",
    content: "@article{k,title={T},author={John Doe},year={2020},journal={J},}",
    field: "author",
    val: "John Doe",
  },
  {
    desc: "year",
    content: "@article{k,title={T},author={A},year={2020},journal={J},}",
    field: "year",
    val: "2020",
  },
  {
    desc: "journal",
    content: "@article{k,title={T},author={A},year={2020},journal={Nature},}",
    field: "journal",
    val: "Nature",
  },
  {
    desc: "booktitle",
    content: "@inproceedings{k,title={T},author={A},year={2020},booktitle={NeurIPS},}",
    field: "booktitle",
    val: "NeurIPS",
  },
  {
    desc: "publisher",
    content: "@book{k,title={T},author={A},year={2020},publisher={Springer},}",
    field: "publisher",
    val: "Springer",
  },
  {
    desc: "url",
    content: "@misc{k,title={T},author={A},year={2020},url={https://example.com},}",
    field: "url",
    val: "https://example.com",
  },
];
describe("BibTeX field values — parameterized", () => {
  it.each(fieldVariants)("parses $desc = $val", ({ content, field, val }) => {
    const entries = parseBibFile(content, "test.bib");
    expect(entries.length).toBe(1);
    expect((entries[0] as any)[field]).toBe(val);
  });
});

// ── ParseTexLabels variants ──────────────────────────────────────────────
const labelVariants = [
  {
    desc: "figure label",
    content: "\\begin{figure}\\caption{A}\\label{fig:test}\\end{figure}",
    expectedKind: "figure",
  },
  {
    desc: "table label",
    content: "\\begin{table}\\caption{B}\\label{tab:test}\\end{table}",
    expectedKind: "table",
  },
  {
    desc: "equation label",
    content: "\\begin{equation}a+b=c\\label{eq:simple}\\end{equation}",
    expectedKind: "equation",
  },
  {
    desc: "align label",
    content: "\\begin{align}x&=y\\label{eq:align}\\end{align}",
    expectedKind: "equation",
  },
  {
    desc: "section label",
    content: "\\section{Introduction}\\label{sec:intro}",
    expectedKind: "section",
  },
  {
    desc: "subsection label",
    content: "\\subsection{Sub}\\label{subsec:sub}",
    expectedKind: "subsection",
  },
  {
    desc: "theorem label",
    content: "\\begin{theorem}\\label{thm:main}Content.\\end{theorem}",
    expectedKind: "theorem",
  },
  {
    desc: "label with fig: prefix",
    content: "\\label{fig:standalone}",
    expectedKind: "figure",
  },
  {
    desc: "label with tab: prefix",
    content: "\\label{tab:standalone}",
    expectedKind: "table",
  },
  {
    desc: "label with eq: prefix",
    content: "\\label{eq:standalone}",
    expectedKind: "equation",
  },
  {
    desc: "label with sec: prefix",
    content: "\\label{sec:standalone}",
    expectedKind: "section",
  },
  {
    desc: "label with thm: prefix",
    content: "\\label{thm:standalone}",
    expectedKind: "theorem",
  },
  { desc: "unknown label", content: "\\label{unknown}", expectedKind: "unknown" },
  {
    desc: "multiple labels",
    content: "\\label{fig:a}\\label{tab:b}\\label{eq:c}",
    expectedCount: 3,
  },
  {
    desc: "label with caption nearby",
    content: "\\begin{figure}\\caption{My Caption}\\label{fig:cap}\\end{figure}",
    expectedCaption: "My Caption",
  },
  {
    desc: "label with section nearby",
    content: "\\section{Results}\\label{sec:res}",
    expectedTitle: "Results",
  },
  {
    desc: "label after subsection",
    content: "\\subsection{Method Details}\\label{subsec:method}",
    expectedTitle: "Method Details",
  },
  {
    desc: "label in nested env",
    content:
      "\\begin{table}\\begin{tabular}{c}a\\end{tabular}\\caption{Nested}\\label{tab:nested}\\end{table}",
    expectedKind: "table",
  },
  {
    desc: "multiple lines",
    content:
      "\\section{Intro}\n\\label{sec:intro}\nContent.\n\\section{Method}\n\\label{sec:method}\nContent.",
    expectedCount: 2,
  },
];
describe("Label parsing — parameterized", () => {
  it.each(labelVariants)(
    "parses $desc",
    ({ content, expectedKind, expectedCount, expectedCaption, expectedTitle }) => {
      const labels = parseTexLabels(content, "test.tex");
      if (expectedCount !== undefined) expect(labels.length).toBe(expectedCount);
      else if (expectedKind !== undefined) expect(labels[0].kind).toBe(expectedKind);
      if (expectedCaption) expect(labels[0].caption).toBe(expectedCaption);
      if (expectedTitle) expect(labels[0].title).toBe(expectedTitle);
      expect(labels.length).toBeGreaterThan(0);
    },
  );
});

// ── Label edge cases ─────────────────────────────────────────────────────
const labelEdgeCases = [
  { desc: "empty content", content: "", expectedCount: 0 },
  { desc: "no labels", content: "\\section{Intro}Just text here.", expectedCount: 0 },
  // Empty label {} not matched by \label{([^}]+)} — requires at least one char
  { desc: "single char label", content: "\\label{x}", expectedCount: 1 },
  {
    desc: "label with braces inside",
    content: "\\label{fig:{braced}}",
    expectedCount: 1,
  },
  { desc: "label in comment", content: "%\\label{fig:commented}", expectedCount: 1 },
  { desc: "unicode in label", content: "\\label{fig:über}", expectedCount: 1 },
  { desc: "label with dots", content: "\\label{fig.1.a}", expectedCount: 1 },
  {
    desc: "label with colon multiple",
    content: "\\label{fig:sub:part}",
    expectedCount: 1,
  },
  { desc: "label with hyphen dash", content: "\\label{fig-my-test}", expectedCount: 1 },
  {
    desc: "very long content",
    content: Array(100)
      .fill(null)
      .map((_, i) => `\\label{test:${i}}`)
      .join("\n"),
    expectedCount: 100,
  },
];
describe("Label edge cases — parameterized", () => {
  it.each(labelEdgeCases)("handles $desc", ({ content, expectedCount }) => {
    const labels = parseTexLabels(content, "test.tex");
    expect(labels.length).toBe(expectedCount);
  });
});

// ── BuildLatexIndex ──────────────────────────────────────────────────────
const indexVariants = [
  {
    desc: "empty files",
    files: [] as ProjectFile[],
    expected: { citations: [], labels: [] },
  },
  {
    desc: "no bib or tex files",
    files: [{ path: "readme.md", content: "# hello" }],
    expected: { citations: [], labels: [] },
  },
  {
    desc: "single bib file",
    files: [
      {
        path: "refs.bib",
        content: "@article{k,title={T},author={A},year={2020},journal={J},}",
      },
    ],
    expectedCitations: 1,
  },
  {
    desc: "single tex file",
    files: [{ path: "paper.tex", content: "\\section{Intro}\\label{sec:intro}" }],
    expectedLabels: 1,
  },
  {
    desc: "mixed files",
    files: [
      {
        path: "refs.bib",
        content: "@article{k,title={T},author={A},year={2020},journal={J},}",
      },
      { path: "paper.tex", content: "\\section{Intro}\\label{sec:intro}" },
    ],
    expectedCitations: 1,
    expectedLabels: 1,
  },
  {
    desc: "multiple bib files",
    files: [
      {
        path: "refs1.bib",
        content: "@article{k1,title={T1},author={A1},year={2020},journal={J},}",
      },
      {
        path: "refs2.bib",
        content: "@article{k2,title={T2},author={A2},year={2020},journal={J},}",
      },
    ],
    expectedCitations: 2,
  },
  {
    desc: "multiple tex files",
    files: [
      { path: "chap1.tex", content: "\\label{fig:chap1}" },
      { path: "chap2.tex", content: "\\label{fig:chap2}" },
    ],
    expectedLabels: 2,
  },
  {
    desc: "non-matching content",
    files: [{ path: "notes.bib", content: "not bib format" }],
    expectedCitations: 0,
  },
];
describe("BuildLatexIndex — parameterized", () => {
  it.each(indexVariants)(
    "handles $desc",
    ({ desc, files, expectedCitations, expectedLabels }) => {
      const index = buildLatexIndex(files);
      if (expectedCitations !== undefined)
        expect(index.citations.length).toBe(expectedCitations);
      if (expectedLabels !== undefined)
        expect(index.labels.length).toBe(expectedLabels);
      expect(index).toHaveProperty("citations");
      expect(index).toHaveProperty("labels");
    },
  );
});

// ── Large-scale index ──────────────────────────────────────────────────
describe("BuildLatexIndex — large inputs", () => {
  it("handles 500 bib entries", () => {
    const bib = Array(500)
      .fill(null)
      .map(
        (_, i) =>
          `@article{k${i},title={Title ${i}},author={Author ${i}},year={2020},journal={J},}`,
      )
      .join("\n");
    const tex = Array(500)
      .fill(null)
      .map((_, i) => `\\label{fig:${i}}`)
      .join("\n");
    const index = buildLatexIndex([
      { path: "refs.bib", content: bib },
      { path: "paper.tex", content: tex },
    ]);
    expect(index.citations.length).toBe(500);
    expect(index.labels.length).toBe(500);
  });

  it("handles mixed file order", () => {
    const index = buildLatexIndex([
      { path: "paper.tex", content: "\\label{eq:one}\\cite{k}" },
      {
        path: "refs.bib",
        content: "@article{k,title={T},author={A},year={2020},journal={J},}",
      },
      { path: "appendix.tex", content: "\\label{fig:app}" },
      {
        path: "extra.bib",
        content: "@misc{m,title={M},author={B},year={2021},url={https://x.com},}",
      },
    ]);
    expect(index.citations.length).toBe(2);
    expect(index.citedKeys).toEqual(["k"]);
    expect(index.labels.length).toBe(2);
  });
});
