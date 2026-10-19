import { describe, expect, it } from "vitest";
import { describeFont } from "./fonts.js";
import { renderInline, segmentLine } from "./inline.js";
import type { Glyph } from "./model.js";
import type { TextLine } from "./layout.js";
import { context, glyph, glyphs } from "./__tests__/fixtures.js";

const math = describeFont("m", "CMMI10", 0.001);
const bold = describeFont("b", "CMBX10", 0.001);

function textLine(items: Glyph[], extra: Partial<TextLine> = {}): TextLine {
  return {
    pageIndex: 0,
    glyphs: items,
    baseline: 100,
    size: 10,
    left: 0,
    right: 500,
    top: 90,
    bottom: 102,
    column: 0,
    spanning: false,
    ...extra,
  };
}

function kinds(items: Glyph[]) {
  return segmentLine(textLine(items), 10).map((span) => [
    span.kind,
    span.glyphs.map((g) => g.text).join(""),
  ]);
}

describe("segmentLine", () => {
  it("returns nothing for an empty line", () => {
    expect(segmentLine(textLine([]), 10)).toEqual([]);
  });

  it.each([
    ["letterlike", "ℝ"],
    ["arrow", "→"],
    ["angle bracket", "⟨"],
    ["n-ary operator", "⨀"],
  ])("treats %s symbols from a text font as maths", (_name, symbol) => {
    expect(kinds([...glyphs("ab", 10), glyph(symbol, 40)])).toEqual([
      ["text", "ab"],
      ["math", symbol],
    ]);
  });

  it("does not absorb a wide space or anything after it", () => {
    expect(
      kinds([glyph("α", 50), glyph(" ", 55, 100, { width: 8 }), glyph("2", 63)]),
    ).toEqual([
      ["math", "α"],
      ["text", " 2"],
    ]);
  });

  it("does not absorb an empty glyph", () => {
    expect(kinds([glyph("α", 50), glyph("", 55)])).toEqual([
      ["math", "α"],
      ["text", ""],
    ]);
  });

  it("does not absorb digits far from the formula", () => {
    expect(kinds([glyph("α", 50), glyph("2", 70)])).toEqual([
      ["math", "α"],
      ["text", "2"],
    ]);
  });

  it("gives a space left at a formula edge back to the sentence", () => {
    expect(
      kinds([glyph("α", 50), glyph(" ", 55, 100, { width: 2 }), glyph(",", 57)]),
    ).toEqual([
      ["math", "α"],
      ["text", " ,"],
    ]);
  });
});

describe("renderInline", () => {
  it("drops styling around a run with no visible text", () => {
    const result = renderInline(
      [textLine([glyph("a", 50), glyph("", 55, 100, { font: bold }), glyph("b", 55)])],
      context(),
    );
    expect(result.latex).toBe("ab");
    expect(result.latex).not.toContain("\\textbf");
  });

  it("reconstructs unshifted logo letters as ordinary maths", () => {
    const tex = renderInline([textLine(glyphs("TEX", 50, 100, { font: math }))], context());
    expect(tex.latex).not.toContain("\\TeX");
    expect(tex.mathSpans).toBe(1);

    const items = glyphs("LATEX", 50, 100, { font: math });
    items[3].y = 102;
    const latex = renderInline([textLine(items)], context());
    expect(latex.latex).not.toContain("\\LaTeX");
    expect(latex.mathSpans).toBe(1);
  });

  it("joins lines when the next line has no visible glyphs", () => {
    const result = renderInline(
      [textLine(glyphs("pre-", 50)), textLine([glyph(" ", 50)])],
      context(),
    );
    expect(result.latex).toBe("pre-\n");
    expect(result.text).toBe("pre-");
  });

  it("joins a word hyphenated across lines", () => {
    const result = renderInline(
      [textLine(glyphs("exam-", 50)), textLine(glyphs("ple", 50, 112), { baseline: 112 })],
      context(),
    );
    expect(result.text).toBe("example");
  });

  it("handles formulas on pages without rules and with zero-size glyphs", () => {
    const result = renderInline(
      [textLine([glyph("x", 50, 100, { font: math, size: 0 })], { pageIndex: 3 })],
      context(),
    );
    expect(result.latex).toBe("$x$");
    expect(result.mathSpans).toBe(1);
  });

  it("separates a formula that directly follows a word", () => {
    const result = renderInline(
      [textLine([...glyphs("ab", 50), glyph("x", 60, 100, { font: math })])],
      context(),
    );
    expect(result.latex).toBe("ab $x$");
  });

  it("counts low-confidence formulas", () => {
    const result = renderInline(
      [
        textLine(
          [0, 1, 2, 3].map((i) => glyph("ˆ", 50 + i * 20, 100, { font: math, width: 3 })),
        ),
      ],
      context(),
    );
    expect(result.mathSpans).toBe(1);
    expect(result.lowConfidenceSpans).toBe(1);
  });
});
