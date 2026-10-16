import { describe, it, expect } from "vitest";
import { analyzeStructure } from "./blocks.js";
import { describeFont } from "./fonts.js";
import { buildLines, type PageLayout, type TextLine } from "./layout.js";
import type { PageContent } from "./model.js";
import { context, glyphs, line, page, stats } from "./__tests__/fixtures.js";
function analyze(lines: TextLine[], options: Partial<PageContent> = {}) {
  const content = page(
    lines.flatMap((l) => l.glyphs),
    options,
  );
  const layout: PageLayout = {
    pageIndex: 0,
    width: 612,
    height: 792,
    lines,
    columns: [{ index: 0, left: 50, right: 562 }],
    bodyLeft: 50,
    bodyRight: 562,
    bodyTop: 50,
    bodyBottom: 742,
  };
  return analyzeStructure([content], [layout], stats, context());
}
const bold = describeFont("b", "CMBX10", 0.001),
  math = describeFont("m", "CMMI10", 0.001),
  mono = describeFont("t", "Courier", 0.001);
describe("PDF logical structure reconstruction", () => {
  it("separates title, affiliations, abstract, numbered headings and references", () => {
    const result = analyze([
      line("Recovering Science", 160, 60, { size: 18, font: bold }),
      line("Ada Lovelace", 160, 100),
      line("University of Computing", 160, 125),
      line("2026", 160, 150),
      line("Abstract", 50, 185, { font: bold }),
      line("We recover structured documents.", 50, 215),
      line("A second abstract paragraph.", 50, 245),
      line("1 Introduction", 50, 280, { size: 12, font: bold }),
      line("Normal body prose.", 50, 315),
      line("1.2 Methods", 50, 350, { size: 11, font: bold }),
      line("Methods prose.", 50, 380),
      line("References", 50, 420, { font: bold }),
      line("[1] Smith. A paper. 2024.", 50, 450),
    ]);
    expect(result.title).toBe("Recovering Science");
    expect(result.authors).toContain("Ada Lovelace");
    expect(result.authors).toContain("University of Computing");
    expect(result.authors).not.toContain("2026");
    expect(result.blocks.find((b) => b.kind === "abstract")).toMatchObject({
      latex: "We recover structured documents.\n\nA second abstract paragraph.",
    });
    expect(result.labels.sections.get("1.2")).toBe("sec:1.2");
    expect(
      result.blocks.find((b) => b.kind === "section" && b.numbering === "1.2"),
    ).toMatchObject({ level: 2, latex: "Methods" });
    expect(result.blocks.at(-1)).toMatchObject({
      kind: "references",
      lines: expect.any(Array),
    });
  });
  it.each([
    ["• first item", "• second item", false],
    ["1) first item", "2) second item", true],
    ["(a) first item", "(b) second item", true],
  ])("recovers %s as a list", (first, second, ordered) => {
    const result = analyze([
      line(first as string, 65, 100),
      line(second as string, 65, 130),
    ]);
    expect(result.blocks).toContainEqual(
      expect.objectContaining({
        kind: "list",
        ordered,
        items: ["first item", "second item"],
      }),
    );
  });
  it("preserves monospaced code and places small footnotes after body text", () => {
    const result = analyze([
      line("for (i = 0; i < 3; i++)", 50, 100, { font: mono }),
      line("print(i);", 50, 112, { font: mono }),
      line("Ordinary prose.", 50, 170),
      line("1 Supporting footnote.", 50, 710, { size: 8 }),
    ]);
    expect(
      result.blocks.some((b) => b.kind === "verbatim" && b.lines[0].includes("for")),
    ).toBe(true);
    expect(result.blocks.at(-1)).toMatchObject({
      kind: "footnote",
      marker: "1",
      latex: "Supporting footnote.",
    });
  });
  it.each(["Theorem", "Lemma", "Proof"])(
    "recognizes a styled %s without treating its prose as a heading",
    (environment) => {
      const leading = glyphs(`${environment} 2. `, 50, 100, { font: bold });
      const rest = glyphs(
        "This proposition holds for every positive integer.",
        50 + leading.length * 5,
        100,
      );
      const lines = buildLines(page([...leading, ...rest]), 10);
      const result = analyze(lines);
      expect(result.blocks).toContainEqual(
        expect.objectContaining({
          kind: "theorem",
          environment: environment.toLowerCase(),
          title: "2",
          latex: expect.stringContaining("positive integer"),
        }),
      );
    },
  );
  it("extracts equation numbers at the right margin without including the number in the formula", () => {
    const expression = glyphs("x+y=z", 190, 100, { font: math });
    const tag = glyphs("(3)", 547, 100);
    const lines = buildLines(page([...expression, ...tag]), 10);
    const result = analyze(lines);
    const equation = result.blocks.find((b) => b.kind === "equation");
    expect(equation).toMatchObject({ numbering: "3", label: "eq:3", confident: true });
    if (equation?.kind === "equation") {
      expect(equation.latex).toContain("x");
      expect(equation.latex).not.toContain("(3)");
    }
    expect(result.labels.equations.get("3")).toBe("eq:3");
  });
  it("claims plot labels inside connected graphics and normalizes roman figure numbers", () => {
    const result = analyze(
      [
        line("axis label", 80, 150),
        line("Figure IV: Measured results", 50, 250),
        line("Caption continuation.", 50, 262),
        line("Body below the figure.", 50, 310),
      ],
      {
        graphics: [
          { pageIndex: 0, kind: "vector", x: 70, y: 100, width: 150, height: 100 },
          { pageIndex: 0, kind: "vector", x: 220, y: 110, width: 100, height: 80 },
          { pageIndex: 0, kind: "vector", x: 500, y: 60, width: 20, height: 20 },
        ],
      },
    );
    const figure = result.blocks.find((b) => b.kind === "figure");
    expect(figure).toMatchObject({
      numbering: "4",
      label: "fig:4",
      caption: expect.stringMatching(/Measured results\s+Caption continuation\./),
      region: expect.objectContaining({ left: 68, right: 322, top: 98, bottom: 202 }),
    });
    expect(result.figureCount).toBe(1);
    expect(
      result.blocks
        .filter((b) => b.kind === "paragraph")
        .map((b) => b.latex)
        .join(" "),
    ).not.toContain("axis label");
  });
  it("finds artwork below captions and refuses tiny decorative graphics", () => {
    const result = analyze([line("Figure 2: Below caption", 50, 100)], {
      graphics: [
        { pageIndex: 0, kind: "vector", x: 60, y: 125, width: 180, height: 70 },
      ],
    });
    expect(result.blocks[0]).toMatchObject({
      kind: "figure",
      region: expect.objectContaining({ top: 123, bottom: 197 }),
    });
    expect(
      analyze([line("Figure 1: Missing artwork", 50, 100)], {
        graphics: [{ pageIndex: 0, kind: "vector", x: 60, y: 50, width: 4, height: 4 }],
      }).blocks[0],
    ).toMatchObject({ kind: "figure", region: null });
  });
  it("reconstructs ruled tables separately from captions and surrounding paragraphs", () => {
    const row = (left: string, right: string, y: number) =>
      buildLines(page([...glyphs(left, 60, y), ...glyphs(right, 250, y)]), 10)[0];
    const lines = [
      line("Table II: Results", 50, 80),
      row("Method", "Score", 115),
      row("Baseline", "0.5", 130),
      row("Ours", "0.9", 145),
      line("Following body text.", 50, 220),
    ];
    const rules = [100, 155].map((y) => ({
      x1: 50,
      x2: 400,
      y1: y,
      y2: y,
      thickness: 1,
      pageIndex: 0,
      horizontal: true,
      vertical: false,
    }));
    const result = analyze(lines, { rules });
    const table = result.blocks.find((b) => b.kind === "table");
    expect(table).toMatchObject({
      numbering: "2",
      label: "tab:2",
      caption: "Results",
      body: expect.stringContaining("tabular"),
    });
    if (table?.kind === "table") expect(table.body).toContain("Baseline");
    expect(result.blocks.at(-1)).toMatchObject({
      kind: "paragraph",
      latex: "Following body text.",
    });
    expect(result.tableCount).toBe(1);
  });
  it("retains captions when an unruled table grid cannot be recovered", () => {
    expect(
      analyze([line("Table 1: Unrecoverable cells", 50, 100)]).blocks[0],
    ).toMatchObject({ kind: "table", caption: "Unrecoverable cells", body: null });
  });
});
