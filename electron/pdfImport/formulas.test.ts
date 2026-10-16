import { describe, it, expect } from "vitest";
import { reconstructMath, isSafeMath } from "./math.js";
import { renderInline, segmentLine } from "./inline.js";
import { describeFont } from "./fonts.js";
import { buildLines } from "./layout.js";
import type { Glyph, RuleSegment } from "./model.js";
import { glyph, glyphs, line, page, context } from "./__tests__/fixtures.js";
const math = describeFont("m", "CMMI10", 0.001);
const rule = (x1: number, x2: number, y: number): RuleSegment => ({
  x1,
  x2,
  y1: y,
  y2: y,
  thickness: 0.5,
  pageIndex: 0,
  horizontal: true,
  vertical: false,
});
function render(items: Glyph[], rules: RuleSegment[] = [], display = false) {
  const ctx = context().math;
  ctx.rules = rules;
  return { ...reconstructMath(items, ctx, { display }), context: ctx };
}
describe("geometric formula reconstruction", () => {
  it("recovers fractions from numerator, bar and denominator geometry", () => {
    const result = render(
      [
        ...glyphs("ab", 50, 94, { font: math }),
        ...glyphs("cd", 50, 110, { font: math }),
      ],
      [rule(49, 61, 100)],
    );
    expect(result.latex).toBe("\\frac{ab}{cd}");
    expect(result.confidence).toBe(1);
    expect(isSafeMath(result.latex)).toBe(true);
  });
  it.each([false, true])("recovers a radical with degree=%s", (degree) => {
    const items = [
      glyph("√", 50, 100, { font: math, width: 8 }),
      glyph("x", 60, 100, { font: math }),
      ...(degree ? [glyph("3", 48, 93, { size: 6, width: 3 })] : []),
    ];
    expect(render(items, [rule(58, 65, 92)]).latex).toBe(
      degree ? "\\sqrt[3]{x}" : "\\sqrt{x}",
    );
  });
  it("does not mistake a long table rule for a fraction bar", () => {
    const result = render(
      [
        glyph("x", 50, 94, { font: math }),
        glyph("y", 50, 110, { font: math }),
        glyph("z", 120, 100, { font: math }),
      ],
      [rule(49, 121, 100)],
    );
    expect(result.latex).not.toContain("\\frac");
  });
  it("aligns multiline equations on relation symbols", () => {
    const result = render(
      [
        ...glyphs("x=1", 50, 100, { font: math }),
        ...glyphs("y≤2", 50, 125, { font: math }),
        ...glyphs("z", 50, 150, { font: math }),
      ],
      [],
      true,
    );
    expect(result.multiline).toBe(true);
    expect(result.latex).toContain("x &=1");
    expect(result.latex).toContain("y &\\leq");
    expect(result.latex).toContain("& z");
    expect(result.context.packages).toContain("amsmath");
  });
  it.each([
    ["sin", "\\sin"],
    ["argmax", "\\operatorname{argmax}"],
    ["ABC", "\\mathrm{ABC}"],
  ])("recognizes upright word %s", (word, expected) =>
    expect(render(glyphs(word)).latex).toBe(expected),
  );
  it("pairs stretched delimiters while retaining unmatched ones", () => {
    const ext = describeFont("e", "CMEX10", 0.001);
    const result = render([
      glyph("(", 50, 100, { font: ext, size: 15 }),
      glyph("x", 57, 100, { font: math }),
      glyph(")", 64, 100, { font: ext, size: 15 }),
    ]);
    expect(result.latex).toBe("\\left(x\\right)");
    expect(result.context.packages).toContain("amsmath");
    expect(isSafeMath(result.latex)).toBe(true);
    expect(render([glyph("(", 50, 100, { font: ext })]).latex).toBe("(");
  });
  it("keeps operator limits and raised prime marks attached to their atoms", () => {
    const result = render([
      glyph("∑", 50, 100, { font: math, width: 10, size: 15 }),
      glyph("n", 53, 88, { font: math, size: 6, width: 3 }),
      glyph("x", 70, 100, { font: math, size: 15 }),
      glyph("′", 76, 95, { font: math, size: 6, width: 2 }),
    ]);
    expect(result.latex).toContain("\\sum^{n}");
    expect(result.latex).toContain("x'");
  });
  it("attaches overlapping accents and records incomplete accents or unknown symbols for review", () => {
    expect(
      render([
        glyph("x", 50, 100, { font: math, width: 8 }),
        glyph("ˆ", 53, 100, { font: math, width: 3 }),
      ]).latex,
    ).toContain("\\hat{x}");
    const isolated = render([glyph("ˆ", 50, 100, { font: math, width: 3 })]);
    expect(isolated.confidence).toBeLessThan(1);
    const unknown = render([glyph("🙂", 50, 100, { font: math })]);
    expect(unknown.latex).toContain("\\text{🙂}");
    expect(unknown.context.warnings[0]).toContain("No LaTeX equivalent");
  });
  it("preserves intentional mathematical spacing", () => {
    const result = render([
      glyph("x", 50, 100, { font: math }),
      glyph("y", 60, 100, { font: math }),
      glyph("z", 90, 100, { font: math }),
    ]);
    expect(result.latex).toBe("x\\,y \\quad z");
  });
});
describe("mixed PDF text and inline mathematics", () => {
  function mixed(items: Glyph[]) {
    return buildLines(page(items), 10)[0];
  }
  it.each(["(α+2)", "α+2)", "(α+2", ",α+2."])(
    "separates sentence punctuation from %s",
    (text) => {
      const spans = segmentLine(line(text), 10);
      expect(spans.some((s) => s.kind === "math")).toBe(true);
      const mathText = spans
        .filter((s) => s.kind === "math")
        .flatMap((s) => s.glyphs.map((g) => g.text))
        .join("");
      expect(mathText).not.toMatch(/^[,]|[.,]$/);
      const result = renderInline([line(text)], context());
      expect(result.mathSpans).toBe(1);
      expect(result.latex).toContain("\\alpha");
    },
  );
  it("absorbs thin spaces, numbers and script letters into an adjacent formula", () => {
    const current = mixed([
      glyph("α", 50, 100),
      glyph(" ", 55, 100, { width: 2 }),
      glyph("+", 57, 100),
      glyph("2", 62, 100),
      glyph("i", 67, 104, { size: 6, width: 3 }),
    ]);
    const result = renderInline([current], context());
    expect(result.latex).toContain("\\alpha");
    expect(result.latex).toContain("_{i}");
    expect(result.mathSpans).toBe(1);
  });
  it("preserves style boundaries, text scripts and geometric word spaces", () => {
    const current = mixed([
      ...glyphs("Body", 50, 100),
      ...glyphs("bold", 80, 100, { font: describeFont("b", "CMBX10", 0.001) }),
      glyph("2", 105, 95, { size: 6 }),
      glyph("n", 115, 104, { size: 6 }),
    ]);
    const result = renderInline([current], context());
    expect(result.latex).toContain("\\textbf{bold}");
    expect(result.latex).toContain("\\textsuperscript{2}");
    expect(result.latex).toContain("\\textsubscript{n}");
    expect(
      renderInline([mixed([glyph("A", 50), glyph("B", 70)])], context()).latex,
    ).toBe("A B");
  });
  it("keeps inline formulas separated from adjacent words", () => {
    const current = mixed([
      ...glyphs("Let", 50, 100),
      glyph("x", 72, 100, { font: math }),
      ...glyphs("vary", 84, 100),
    ]);
    const result = renderInline([current], context());
    expect(result.latex).toBe("Let $x$ vary");
    expect(result.text).toBe("Let x vary");
  });
  it.each(["TEX", "LATEX"])("recognizes the shifted %s logo", (word) => {
    const items = glyphs(word, 50, 100, { font: math });
    items[word.length - 2].y = 102;
    if (word === "LATEX") items[1].y = 98;
    const current = { ...line(word), glyphs: items, baseline: 100 };
    expect(renderInline([current], context()).latex).toBe(
      word === "TEX" ? "\\TeX{}" : "\\LaTeX{}",
    );
  });
  it("falls back to readable text for formulas that would break compilation", () => {
    const result = renderInline([line("$", 50, 100, { font: math })], context());
    expect(result.lowConfidenceSpans).toBe(1);
    expect(result.latex).toContain("\\$");
  });
});
