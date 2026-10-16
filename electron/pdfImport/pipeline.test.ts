import { describe, expect, it } from "vitest";
import {
  describeFont,
  normalizeFontFamily,
  isMathFont,
  isExtensionFont,
  mathAlphabetCommand,
} from "./fonts.js";
import { glyphBox, glyphsBox, median, mode, unionBox } from "./model.js";
import {
  buildLines,
  computeDocumentStats,
  detectColumnSplits,
  layoutPages,
  lineText,
  orderLines,
  removeRunningHeadFoot,
} from "./layout.js";
import {
  escapeText,
  normalizeTextRun,
  repairGlyphText,
  mathSymbolFor,
  packagesForSymbols,
} from "./symbols.js";
import { renderInline } from "./inline.js";
import { reconstructMath, isSafeMath } from "./math.js";
import {
  parseBibliography,
  parseReference,
  renderBibFile,
  splitEntries,
  type Reference,
} from "./bibliography.js";
import { mapOutsideMath, rewriteReferences } from "./references.js";
import { reconstructTable, tableLikelihood } from "./tables.js";
import { analyzeStructure, type Block } from "./blocks.js";
import { renderDocument, type RenderOptions } from "./render.js";
import { glyph, glyphs, page, line, context, stats } from "./__tests__/fixtures.js";

const labels = () => ({
  sections: new Map([["1", "sec:intro"]]),
  figures: new Map([["2", "fig:plot"]]),
  tables: new Map([["3", "tab:results"]]),
  equations: new Map([["4", "eq:main"]]),
});
const reference = (key = "smith2020", marker: string | null = "1"): Reference => ({
  key,
  marker,
  year: "2020",
  authorSurnames: ["Smith"],
  raw: "Smith. A study. 2020.",
  entryType: "article",
  fields: { author: "Smith", title: "A study", year: "2020" },
  parsed: true,
});

describe("PDF fonts and geometry", () => {
  it.each([
    ["ABCDEF+CMMI10", "variable", null],
    ["CMMIB10", "variable", "bm"],
    ["CMSY10", "symbol", null],
    ["CMEX10", "extension", null],
    ["MSBM10", "blackboard", "mathbb"],
    ["EUFM10", "fraktur", "mathfrak"],
    ["RSFS10", "calligraphic", "mathcal"],
    ["CMSS10", "sansMath", "mathsf"],
    ["CMTT10", "monoMath", "mathtt"],
    ["CMR10", "text", "mathrm"],
    ["CMBX10", "text", "mathbf"],
    ["CMTI10", "text", null],
  ])("classifies %s without mistaking text for math", (name, role, command) => {
    const font = describeFont("f", name, 0.001);
    expect(font.mathRole).toBe(role);
    expect(mathAlphabetCommand(font)).toBe(command);
    expect(isMathFont(font)).toBe(!["text", "sansMath", "monoMath"].includes(role!));
    expect(isExtensionFont(font)).toBe(role === "extension");
    expect(font.designSize).toBe(10);
  });
  it("normalizes subsets and falls back for unrecognized font metadata", () => {
    expect(normalizeFontFamily("ABCDEF+Times_New Roman.ttf")).toBe("TIMESNEWROMAN");
    expect(describeFont("Arial-BoldItalic", "", 0)).toMatchObject({
      bold: true,
      italic: true,
      serif: false,
      glyphScale: 0.001,
      designSize: null,
    });
    expect(describeFont("f", "CMR99", 0.001).designSize).toBeNull();
    expect(describeFont("", "", 0).family).toBe("UNKNOWN");
  });
  it("computes robust size statistics without mutating source arrays", () => {
    expect(median([])).toBe(0);
    expect(median([1, 5, 3])).toBe(3);
    expect(median([2, 4])).toBe(3);
    expect(mode([])).toBe(0);
    expect(mode([10, 10, 12])).toBe(10);
    expect(mode([1, 3])).toBe(2);
    expect(glyphBox(glyph("A"))).toEqual({
      left: 50,
      right: 55,
      top: 92.5,
      bottom: 102.5,
    });
    expect(glyphsBox([glyph("A"), glyph("B", 60, 120)])).toEqual({
      left: 50,
      right: 65,
      top: 92.5,
      bottom: 122.5,
    });
    expect(
      unionBox([
        { left: 1, right: 4, top: 2, bottom: 6 },
        { left: -1, right: 8, top: 3, bottom: 4 },
      ]),
    ).toEqual({ left: -1, right: 8, top: 2, bottom: 6 });
  });
  it("orders unsorted glyphs and attaches superscripts to their source line", () => {
    const lines = buildLines(
      page([glyph("2", 56, 96, { size: 6 }), glyph("y", 50, 130), glyph("x", 50, 100)]),
      10,
    );
    expect(lines).toHaveLength(2);
    expect(lineText(lines[0])).toBe("x2");
    expect(lineText(lines[1])).toBe("y");
    expect(buildLines(page(), 10)).toEqual([]);
  });
  it("detects the central gutter and reads left column before right column", () => {
    const items = Array.from({ length: 15 }, (_, i) => [
      ...glyphs("Left column text", 50, 100 + i * 12),
      ...glyphs("Right column text", 330, 105 + i * 12),
    ]).flat();
    const result = layoutPages([page(items)]);
    expect(result.stats.bodySize).toBe(10);
    expect(result.layouts[0].columns).toHaveLength(2);
    expect(result.layouts[0].lines[0].column).toBe(0);
    const ordered = orderLines(result.layouts[0].lines, 2);
    expect(ordered.findIndex((l) => l.column === 1)).toBeGreaterThan(0);
    expect(detectColumnSplits([], 612, 10)).toEqual([]);
  });
  it("handles empty and scanned pages without non-finite document statistics", () => {
    const result = layoutPages([page([], { scanned: true })]);
    expect(result.layouts).toHaveLength(1);
    expect(Number.isFinite(result.stats.bodySize)).toBe(true);
    expect(computeDocumentStats([], []).bodySize).toBeGreaterThan(0);
    expect(removeRunningHeadFoot([], stats)).toEqual({ pageLines: [], removed: 0 });
  });
});

describe("PDF text, mathematics and symbols", () => {
  it("escapes TeX control characters and normalizes ligatures", () => {
    expect(escapeText("a_b%&#${}\\")).toContain("\\_");
    expect(escapeText("a_b%&#${}\\")).toContain("\\textbackslash{}");
    expect(normalizeTextRun("ﬁ ﬂ ﬀ")).toBe("fi fl ff");
    expect(mathSymbolFor("α")?.latex).toContain("alpha");
    expect(mathSymbolFor("∑")?.latex).toContain("sum");
    expect(mathSymbolFor("🙂")).toBeNull();
    expect(repairGlyphText(describeFont("t", "Helvetica", 0.001), 104, "hello")).toBe(
      "hello",
    );
    expect(packagesForSymbols(["\\llbracket x \\rrbracket"])).toContain("stmaryrd");
  });
  it("restores paragraph hyphenation and inline emphasis", () => {
    const result = renderInline(
      [line("inter-", 50, 100), line("national study", 50, 112)],
      context(),
    );
    expect(result.text).toContain("international study");
    const bold = renderInline(
      [line("Bold", 50, 100, { font: describeFont("b", "CMBX10", 0.001) })],
      context(),
    );
    expect(bold.latex).toContain("\\textbf{Bold}");
    expect(renderInline([], context())).toMatchObject({ latex: "", text: "" });
  });
  it.each(["CMR10", "CMTI10", "CMBX10", "CMCSC10", "CMTT10"])(
    "renders %s text without losing visible characters",
    (name) => {
      const output = renderInline(
        [line("Text & 20%", 50, 100, { font: describeFont("f", name, 0.001) })],
        context(),
      );
      expect(output.text).toContain("Text");
      expect(output.latex).toContain("\\&");
      expect(output.latex).toContain("\\%");
    },
  );
  it("recovers baseline expressions and scripts from glyph positions", () => {
    const font = describeFont("m", "CMMI10", 0.001);
    const result = reconstructMath(
      [
        glyph("x", 50, 100, { font }),
        glyph("2", 56, 95, { size: 6, font }),
        glyph("+", 63, 100, { font }),
        glyph("y", 70, 100, { font }),
      ],
      context().math,
    );
    expect(result.latex).toContain("x^{2}");
    expect(result.latex).toContain("+");
    expect(isSafeMath(result.latex)).toBe(true);
    expect(reconstructMath([], context().math)).toEqual({
      latex: "",
      confidence: 1,
      multiline: false,
    });
    const sub = reconstructMath(
      [glyph("x", 50, 100, { font }), glyph("i", 56, 104, { size: 6, font })],
      context().math,
    );
    expect(sub.latex).toContain("_{i}");
  });
  it.each(["α+β=γ", "∑x≤∞", "sin(x)", "[x]", "∫f(x)", "√x"])(
    "renders a recognizable safe formula for %s",
    (expression) => {
      const result = reconstructMath(
        glyphs(expression, 50, 100, { font: describeFont("m", "CMMI10", 0.001) }),
        context().math,
      );
      expect(result.latex.length).toBeGreaterThan(0);
      expect(isSafeMath(result.latex)).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    },
  );
  it.each([
    ["x^{2}", true],
    ["{x", false],
    ["x}", false],
    ["$x$", false],
    ["\\left(x", false],
    ["\\left(x\\right)", true],
    ["\\{x\\}", true],
  ])("validates balanced formula %s", (latex, safe) =>
    expect(isSafeMath(latex as string)).toBe(safe),
  );
});

describe("PDF citations and bibliography", () => {
  it("extracts numeric references, DOI, arXiv metadata and stable unique keys", () => {
    const used = new Set<string>();
    const first = parseReference(
      [
        line(
          "[1] John Smith. A study. Journal 12(3): 10-20. 2020. doi:10.1234/example",
        ),
      ],
      used,
    );
    expect(first.marker).toBe("1");
    expect(first.fields).toMatchObject({
      year: "2020",
      doi: "10.1234/example",
      volume: "12",
      number: "3",
      pages: "10--20",
    });
    const second = parseReference(
      [line("[2] John Smith. A study. 2020. arXiv:2001.12345")],
      used,
    );
    expect(second.fields.eprint).toBe("2001.12345");
    expect(second.key).not.toBe(first.key);
    const bib = renderBibFile([first, second]);
    expect(bib).toContain(`{${first.key},`);
    expect(bib).toContain("archivePrefix = {arXiv}");
    expect(
      parseBibliography([
        line("[1] John Smith. A study. 2020."),
        line("[2] Ada Doe. A book. 2019.", 50, 112),
      ]),
    ).toHaveLength(2);
    expect(splitEntries([])).toEqual([]);
  });
  it.each([
    "Smith (2020). A Book. 2nd edition. Springer. https://example.org/book",
    "Jane Doe. In Proceedings of the Conference. 2019. pp. 20–30, vol. 2, no. 4.",
    "Alice. PhD thesis. University. 2021.",
    "A reference with no recognized author or year",
  ])("retains bibliographic content even when metadata is incomplete: %s", (text) => {
    const parsed = parseReference([line(text)], new Set());
    expect(parsed.raw).toBe(text);
    expect(parsed.key).not.toBe("");
    expect(renderBibFile([parsed])).toContain(parsed.key);
  });
  it("rewrites only known numeric citations and preserves protected math", () => {
    const refs = [reference("a", "1"), reference("b", "2"), reference("c", "3")];
    const result = rewriteReferences(
      "See [1-3], [1]--[3], [9], [3-1], [1-99] and $[1]$. \\cite{a}",
      labels(),
      refs,
    );
    expect(result.latex).toContain("\\cite{a,b,c}");
    expect(result.latex).toContain("[9]");
    expect(result.latex).toContain("$[1]$");
    expect(result.stats.citations).toBe(2);
    expect(result.stats.unresolvedCitations).toBe(1);
  });
  it("supports author-year citations and restores figure, section and equation references", () => {
    const result = rewriteReferences(
      "Smith (2020) agrees (Smith et al., 2020). Figure 2, Table 3, Section 1, Equation (4), Figure 99.",
      labels(),
      [reference("smith2020", null)],
    );
    expect(result.latex).toContain("\\citet{smith2020}");
    expect(result.latex).toContain("\\citep{smith2020}");
    expect(result.latex).toContain("Figure~\\ref{fig:plot}");
    expect(result.latex).toContain("Equation~\\eqref{eq:main}");
    expect(result.latex).toContain("Figure 99");
    expect(result.stats.authorYear).toBe(true);
    expect(rewriteReferences("Unknown (2010)", labels(), []).latex).toBe(
      "Unknown (2010)",
    );
  });
  it("does not rewrite commands or verbatim regions", () => {
    expect(
      mapOutsideMath(
        "hello $x$ \\url{hello} \\begin{verbatim}hello\\end{verbatim}",
        (s) => s.replaceAll("hello", "world"),
      ),
    ).toBe("world $x$ \\url{hello} \\begin{verbatim}hello\\end{verbatim}");
  });
});

describe("PDF tables and document assembly", () => {
  it("reconstructs an aligned data grid rather than treating it as prose", () => {
    const rows = [0, 1, 2].map((i) => {
      const g = [
        ...glyphs(i === 0 ? "Name" : `Row${i}`, 50, 100 + i * 16),
        ...glyphs(i === 0 ? "Count" : `${i * 10}`, 180, 100 + i * 16),
      ];
      const built = buildLines(page(g), 10);
      return { ...built[0], glyphs: g, right: 205 };
    });
    const output = reconstructTable(rows, [], context());
    expect(output).toMatchObject({ columnCount: 2, rowCount: 3 });
    expect(output?.latex).toContain("Name & Count");
    expect(tableLikelihood(rows, 10)).toBeGreaterThan(0.7);
    expect(reconstructTable([], [], context())).toBeNull();
    expect(tableLikelihood([], 10)).toBe(0);
    expect(
      reconstructTable(
        [line("ordinary text"), line("more text", 50, 120)],
        [],
        context(),
      ),
    ).toBeNull();
  });
  function options(blocks: Block[] = []): RenderOptions {
    return {
      stats: { ...stats },
      geometry: {
        paper: "letterpaper",
        widthPt: 612,
        heightPt: 792,
        left: 50,
        right: 50,
        top: 50,
        bottom: 50,
      },
      structure: {
        blocks,
        labels: labels(),
        title: "Paper",
        authors: "Ada",
        lowConfidenceMath: 0,
        figureCount: 0,
        tableCount: 0,
        usedPackages: new Set(),
      },
      references: [],
      sourceAssetPath: "assets/source.pdf",
      bibStem: null,
      authorYearCitations: false,
      reportLines: ["Recovered\nwith review"],
    };
  }
  it("renders every structural block with appropriate packages and review markers", () => {
    const blocks: Block[] = [
      { kind: "title", latex: "Recovered Title" },
      { kind: "authors", latex: "Ada Doe" },
      { kind: "abstract", latex: "Summary" },
      {
        kind: "section",
        numbering: null,
        level: 1,
        latex: "Introduction",
        label: "sec:intro",
        starred: false,
      },
      {
        kind: "section",
        numbering: null,
        level: 2,
        latex: "Details",
        label: null,
        starred: true,
      },
      {
        kind: "section",
        numbering: null,
        level: 3,
        latex: "Method",
        label: null,
        starred: false,
      },
      { kind: "paragraph", latex: "Body" },
      {
        kind: "equation",
        latex: "x=1",
        numbering: "1",
        label: "eq:one",
        confident: false,
        multiline: false,
      },
      {
        kind: "equation",
        latex: "y=2",
        numbering: null,
        label: null,
        confident: true,
        multiline: false,
      },
      {
        kind: "equation",
        latex: "x&=1\\\\y&=2",
        numbering: "2",
        label: "eq:two",
        confident: true,
        multiline: true,
      },
      { kind: "list", level: 0, ordered: true, items: ["First", "Second\ncontinued"] },
      { kind: "list", level: 0, ordered: false, items: ["Bullet"] },
      {
        kind: "figure",
        numbering: null,
        caption: "Plot",
        label: "fig:plot",
        spanning: true,
        region: { pageIndex: 0, left: 50, right: 562, top: 200, bottom: 300 },
      },
      {
        kind: "figure",
        numbering: null,
        caption: "Missing",
        label: null,
        spanning: false,
        region: null,
      },
      {
        kind: "table",
        numbering: null,
        caption: "Results",
        label: "tab:results",
        spanning: true,
        body: "\\begin{tabular}{l}\\toprule A\\end{tabular}",
      },
      {
        kind: "table",
        numbering: null,
        caption: "Lost grid",
        label: null,
        spanning: false,
        body: null,
      },
      { kind: "theorem", environment: "theorem", title: "Useful", latex: "True" },
      { kind: "theorem", environment: "proof", title: "", latex: "Done" },
      { kind: "verbatim", lines: ["code"] },
      { kind: "footnote", marker: "1", latex: "Note" },
      { kind: "footnote", marker: "*", latex: "Other note" },
      { kind: "references", lines: [] },
    ];
    const input = options(blocks);
    input.stats.columnCount = 2;
    input.structure.usedPackages = new Set(["amsmath", "amssymb", "bm"]);
    input.references = [reference()];
    const latex = renderDocument(input);
    for (const name of ["amsthm", "graphicx", "array", "booktabs", "verbatim", "bm"])
      expect(latex).toContain(`\\usepackage{${name}}`);
    expect(latex).toContain("\\title{Recovered Title}");
    expect(latex).toContain("\\begin{figure*}");
    expect(latex).toContain("TODO(pdf import)");
    expect(latex).toContain("\\begin{thebibliography}");
    expect(latex).toContain("page=1,trim=50pt 492pt 50pt 200pt");
    expect(latex).toContain("\\end{document}");
    expect(latex.match(/\\usepackage\{amsmath\}/g)).toHaveLength(1);
  });
  it.each([10, 11, 12])(
    "uses source typography at %s points and custom geometry",
    (size) => {
      const input = options();
      input.stats.bodySize = size;
      input.geometry.paper = "custom";
      input.bibStem = "references";
      input.references = [reference()];
      input.authorYearCitations = true;
      const latex = renderDocument(input);
      expect(latex).toContain(`\\documentclass[${size}pt]`);
      expect(latex).toContain("paperwidth=612pt");
      expect(latex).toContain("\\bibliographystyle{plainnat}");
      expect(latex).toContain("\\bibliography{references}");
    },
  );
  it("recognizes a simple paper's title, section and prose through the complete layout pipeline", () => {
    const source = page([
      ...glyphs("A Research Paper", 170, 60, {
        size: 20,
        font: describeFont("title", "CMBX12", 0.001),
      }),
      ...glyphs("Ada Doe", 250, 90),
      ...glyphs("1 Introduction", 50, 140, {
        size: 14,
        font: describeFont("heading", "CMBX10", 0.001),
      }),
      ...Array.from({ length: 8 }, (_, i) =>
        glyphs("This is the body of our research paper.", 50, 170 + i * 12),
      ).flat(),
    ]);
    const { layouts, stats: documentStats } = layoutPages([source]);
    const structure = analyzeStructure([source], layouts, documentStats, context());
    expect(structure.blocks.some((b) => b.kind === "paragraph")).toBe(true);
    expect(structure.blocks.some((b) => b.kind === "section")).toBe(true);
    const input = options();
    input.structure = structure;
    input.stats = documentStats;
    expect(renderDocument(input)).toContain("research paper");
  });
});
