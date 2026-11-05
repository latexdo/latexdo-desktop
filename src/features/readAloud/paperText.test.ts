import { describe, expect, it } from "vitest";
import {
  defaultPaperTextOptions,
  isEquationLine,
  paperSentences,
  rotateRect,
  splitSentences,
  toSpokenText,
  type PaperPage,
  type PaperTextItem,
} from "./paperText";

/** One text item per line, laid out top to bottom like a typeset page. */
function page(
  pageNumber: number,
  lines: Array<string | { text: string; size?: number; gap?: number }>,
): PaperPage {
  let y = 760;
  const items: PaperTextItem[] = [];
  for (const line of lines) {
    const {
      text,
      size = 10,
      gap = 0,
    } = typeof line === "string" ? { text: line } : line;
    y -= 12 + gap;
    items.push({
      str: text,
      transform: [size, 0, 0, size, 72, y],
      width: text.length * size * 0.5,
      height: size,
      hasEOL: true,
    });
  }
  return { pageNumber, viewBox: [0, 0, 612, 792], items };
}

const spoken = (pages: PaperPage[], options = defaultPaperTextOptions) =>
  paperSentences(pages, options).map((sentence) => sentence.spoken);

describe("paperSentences", () => {
  it("joins hyphenated line breaks and reads sentence by sentence", () => {
    const result = spoken([
      page(1, [
        "We study the exam-",
        "ple problem in detail. It is hard, but",
        "tractable.",
      ]),
    ]);
    expect(result).toEqual([
      "We study the example problem in detail.",
      "It is hard, but tractable.",
    ]);
  });

  it("keeps abbreviations inside one sentence and says them in full", () => {
    const result = spoken([
      page(1, [
        "As shown in Fig. 2 and by Smith et al. (2020), models e.g. transformers",
        "work well.",
      ]),
    ]);
    expect(result).toEqual([
      "As shown in Figure 2 and by Smith et al (2020), models for example, transformers work well.",
    ]);
  });

  it("reads headings on their own and marks new paragraphs", () => {
    const sentences = paperSentences([
      page(1, [
        { text: "1 Introduction", size: 12 },
        "Deep models are popular. They are big.",
        { text: "A new paragraph starts here.", gap: 10 },
      ]),
    ]);
    expect(sentences.map((s) => [s.kind, s.paragraphStart, s.spoken])).toEqual([
      ["heading", true, "1 Introduction."],
      ["text", true, "Deep models are popular."],
      ["text", false, "They are big."],
      ["text", true, "A new paragraph starts here."],
    ]);
  });

  it("drops page numbers, equations, and everything after the references", () => {
    const result = spoken([
      page(1, ["7", "The loss is", "L = − Σ log p(y|x) (1)", "minimised by SGD.", "8"]),
      page(2, [{ text: "References", size: 12 }, "[1] A. Author. A paper. 2020."]),
    ]);
    expect(result).toEqual(["The loss is, minimised by SGD."]);
  });

  it("keeps equations and references when asked to", () => {
    const result = spoken(
      [
        page(1, [
          "x = y + 1",
          { text: "References", size: 12 },
          "A. Author wrote a paper.",
        ]),
      ],
      { ...defaultPaperTextOptions, skipEquations: false, skipReferences: false },
    );
    expect(result).toContain("References.");
    expect(result).toContain("A. Author wrote a paper.");
  });

  it("records where each sentence is on the page", () => {
    const [sentence] = paperSentences([page(1, ["One short sentence."])]);
    expect(sentence.page).toBe(1);
    expect(sentence.rects).toHaveLength(1);
    const [rect] = sentence.rects;
    expect(rect.x).toBeCloseTo(72 / 612, 2);
    expect(rect.y).toBeGreaterThan(0);
    expect(rect.y + rect.height).toBeLessThan(0.1);
    expect(rect.width).toBeGreaterThan(0.1);
  });

  it("continues a sentence across a page break", () => {
    const result = spoken([
      page(1, ["This sentence starts here and"]),
      page(2, ["ends on the next page."]),
    ]);
    expect(result).toEqual(["This sentence starts here and ends on the next page."]);
  });
});

describe("toSpokenText", () => {
  it("removes numeric and author-year citations", () => {
    expect(
      toSpokenText(
        "Transformers [3, 7–9] beat RNNs (Vaswani et al., 2017; Doe, 2019a).",
        defaultPaperTextOptions,
      ),
    ).toBe("Transformers beat RNNs.");
  });

  it("keeps citations when asked to", () => {
    expect(
      toSpokenText("See [3].", { ...defaultPaperTextOptions, skipCitations: false }),
    ).toBe("See [3].");
  });

  it("speaks symbols and drops links", () => {
    expect(
      toSpokenText(
        "Accuracy ≈ 90% ± 2 at https://example.com/x.",
        defaultPaperTextOptions,
      ),
    ).toBe("Accuracy approximately 90% plus or minus 2 at");
  });

  it("returns nothing for text without words", () => {
    expect(toSpokenText("— · —", defaultPaperTextOptions)).toBe("");
  });
});

describe("splitSentences", () => {
  it("does not split after a short numbered fragment", () => {
    const text = "Results improve. See Sec. 4 for details.";
    expect(splitSentences(text).map(([a, b]) => text.slice(a, b))).toEqual([
      "Results improve.",
      "See Sec. 4 for details.",
    ]);
  });
});

describe("isEquationLine", () => {
  it("tells formulas from prose", () => {
    expect(isEquationLine("f(x) = ∑ w_i x_i + b (2)")).toBe(true);
    expect(isEquationLine("0.91 0.87 0.78")).toBe(true);
    expect(isEquationLine("where w is the learning rate")).toBe(false);
  });
});

describe("rotateRect", () => {
  const rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.05 };
  it("maps a rectangle onto a rotated page", () => {
    expect(rotateRect(rect, 0)).toEqual(rect);
    expect(rotateRect(rect, 90)).toEqual({ x: 0.75, y: 0.1, width: 0.05, height: 0.3 });
    const half = rotateRect(rect, 180);
    expect(half.x).toBeCloseTo(0.6);
    expect(half.y).toBeCloseTo(0.75);
    const quarter = rotateRect(rect, 270);
    expect(quarter.x).toBeCloseTo(0.2);
    expect(quarter.y).toBeCloseTo(0.6);
    expect([quarter.width, quarter.height]).toEqual([0.05, 0.3]);
  });
});
