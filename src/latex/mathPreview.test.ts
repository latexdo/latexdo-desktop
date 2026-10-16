import { describe, expect, it } from "vitest";
import { mathPreviewDataUri, parseMathAtPosition } from "./mathPreview";

describe("parseMathAtPosition", () => {
  const text = [
    "Intro text with $E = mc^2$ inline math.",
    "\\begin{equation}",
    "\\frac{a}{b} + \\sqrt{x}",
    "\\end{equation}",
    "Also \\(y_i\\) and \\[z^2\\] forms.",
    "Escaped \\$5 is not math.",
  ].join("\n");

  it("finds inline dollar math", () => {
    const found = parseMathAtPosition(text, 1, 20);
    expect(found?.tex).toBe("E = mc^2");
    expect(found?.display).toBe(false);
    expect(found?.startLine).toBe(1);
    expect(found?.startColumn).toBe(17);
    expect(found?.endColumn).toBe(27);
  });

  it("finds display environments spanning lines", () => {
    const found = parseMathAtPosition(text, 3, 5);
    expect(found?.tex).toBe("\\frac{a}{b} + \\sqrt{x}");
    expect(found?.display).toBe(true);
    expect(found?.startLine).toBe(2);
    expect(found?.endLine).toBe(4);
  });

  it("finds \\(...\\) and \\[...\\] math", () => {
    expect(parseMathAtPosition(text, 5, 9)?.tex).toBe("y_i");
    expect(parseMathAtPosition(text, 5, 9)?.display).toBe(false);
    expect(parseMathAtPosition(text, 5, 21)?.tex).toBe("z^2");
    expect(parseMathAtPosition(text, 5, 21)?.display).toBe(true);
  });

  it("returns null outside math", () => {
    expect(parseMathAtPosition(text, 1, 3)).toBeNull();
    expect(parseMathAtPosition(text, 6, 11)).toBeNull();
  });

  it("handles display dollar math", () => {
    const found = parseMathAtPosition("before $$x + y$$ after", 1, 12);
    expect(found?.tex).toBe("x + y");
    expect(found?.display).toBe(true);
  });

  it("ignores unterminated math", () => {
    expect(parseMathAtPosition("only one $ here", 1, 12)).toBeNull();
  });
});

describe("mathPreviewDataUri", () => {
  it("renders TeX to a themed transparent SVG data URI", () => {
    const uri = mathPreviewDataUri("E = mc^2", false, "#d7dce5");
    expect(uri).toMatch(/^data:image\/svg\+xml/);
    const svg = decodeURIComponent(uri!.split(",")[1]);
    expect(svg).toContain("color:#d7dce5");
    expect(svg).not.toContain("background");
  });

  it("renders display math", () => {
    expect(mathPreviewDataUri("\\frac{a}{b}", true, "#000")).toMatch(
      /^data:image\/svg\+xml/,
    );
  });

  it("returns null for invalid TeX", () => {
    expect(mathPreviewDataUri("\\notarealmacro{", false, "#000")).toBeNull();
  });
});
