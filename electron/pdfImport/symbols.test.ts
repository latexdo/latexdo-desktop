import { describe, expect, it } from "vitest";
import { describeFont } from "./fonts.js";
import {
  escapeText,
  mathSymbolFor,
  normalizeTextRun,
  repairGlyphText,
} from "./symbols.js";
describe("PDF glyph repair and LaTeX escaping", () => {
  it.each([
    ["CMMI10", 11, "α"],
    ["CMSY10", 0, "−"],
    ["CMEX10", 0, "("],
    ["CMEX10", 0x30, ""],
    ["LMMathItalic10", 11, "α"],
    ["LMMathSymbols10", 0, "−"],
    ["LMMathExtension10", 0, "("],
  ])("repairs %s slot %s", (name, code, expected) => {
    const font = describeFont("f", name as string, 0.001);
    expect(repairGlyphText(font, code as number, "\ufffd")).toBe(expected);
  });
  it("preserves usable Unicode except in authoritative extension fonts", () => {
    expect(repairGlyphText(describeFont("f", "CMMI10", 0.001), 11, "a")).toBe("a");
    expect(repairGlyphText(describeFont("f", "CMEX10", 0.001), 0, "a")).toBe("(");
    for (const value of ["", "\u0001", "\u007f", "\ue001", "\u{f0001}"])
      expect(repairGlyphText(describeFont("f", "Arial", 0.001), 255, value)).toBe("");
  });
  it("expands ligatures, preserves nonbreaking spaces and removes invisible glyphs", () => {
    expect(normalizeTextRun("ﬀﬁﬂﬃﬄﬅﬆ\u00a0x\u00ad\u200b\ufeff")).toBe(
      "fffiflffifflstst~x",
    );
  });
  it.each([
    ["\\", "\\textbackslash{}"],
    ["{", "\\{"],
    ["}", "\\}"],
    ["$", "\\$"],
    ["&", "\\&"],
    ["%", "\\%"],
    ["#", "\\#"],
    ["_", "\\_"],
    ["^", "\\textasciicircum{}"],
    ["~", "~"],
    ["<", "\\textless{}"],
    [">", "\\textgreater{}"],
    ["|", "\\textbar{}"],
    ["—", "---"],
    ["©", "\\copyright{}"],
  ])("escapes text %s", (input, expected) => expect(escapeText(input)).toBe(expected));
  it.each([
    ["+", "+", "bin"],
    ["-", "-", "bin"],
    ["*", "*", "bin"],
    ["/", "/", "ord"],
    ["<", "<", "rel"],
    [">", ">", "rel"],
    ["!", "!", "close"],
    ["?", "?", "punct"],
    [".", ".", "punct"],
    ["'", "'", "ord"],
    ["|", "\\mid", "rel"],
    ["%", "\\%", "ord"],
    ["&", "\\&", "ord"],
    ["#", "\\#", "ord"],
    ["$", "\\$", "ord"],
    ["_", "\\_", "ord"],
    ["@", "@", "ord"],
    [" ", "\\,", "ord"],
    ["\u00a0", "\\,", "ord"],
    ["a", "a", "ord"],
    ["Z", "Z", "ord"],
    ["9", "9", "ord"],
    ["α", "\\alpha", "ord"],
  ])("classifies math %s", (input, latex, mathClass) =>
    expect(mathSymbolFor(input)).toMatchObject({ latex, mathClass }),
  );
  it("does not invent LaTeX for unknown or empty symbols", () => {
    expect(mathSymbolFor("")).toBeNull();
    expect(mathSymbolFor("🙂")).toBeNull();
  });
});
