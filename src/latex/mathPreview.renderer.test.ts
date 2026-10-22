import { describe, expect, it, vi } from "vitest";

const rendered = vi.hoisted(() => ({ markup: "" }));
vi.mock("mathjax-full/js/adaptors/liteAdaptor.js", () => ({
  liteAdaptor: () => ({ innerHTML: () => rendered.markup }),
}));
vi.mock("mathjax-full/js/handlers/html.js", () => ({ RegisterHTMLHandler: vi.fn() }));
vi.mock("mathjax-full/js/mathjax.js", () => ({
  mathjax: { document: () => ({ convert: () => ({}) }) },
}));

import { mathPreviewDataUri } from "./mathPreview";

describe("mathPreviewDataUri renderer output checks", () => {
  it("rejects output that is not an SVG", () => {
    rendered.markup = "<span>oops</span>";
    expect(mathPreviewDataUri("x", false, "#000")).toBeNull();
  });

  it("rejects SVG output that carries a MathJax error marker", () => {
    rendered.markup = '<svg data-mjx-error="bad"></svg>';
    expect(mathPreviewDataUri("x", false, "#000")).toBeNull();
  });

  it("pins the colour on clean SVG output", () => {
    rendered.markup = '<svg width="1"></svg>';
    const uri = mathPreviewDataUri("x", true, "#123456");
    expect(decodeURIComponent(uri!.split(",")[1])).toBe(
      '<svg style="color:#123456;" width="1"></svg>',
    );
  });
});
