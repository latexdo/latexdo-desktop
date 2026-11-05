import { describe, expect, it } from "vitest";
import {
  diffPdfWords,
  joinHyphenatedWords,
  mergeBoxes,
  normalizeWordKey,
  stripPageFurniture,
  wordsFromTextItems,
  type PdfDiffWord,
  type PdfViewportLike,
} from "./pdfTextDiff";

// A 600×800 page with pdf.js's usual flip of the y axis.
const viewport: PdfViewportLike = {
  width: 600,
  height: 800,
  scale: 1,
  transform: [1, 0, 0, -1, 0, 800],
};

function item(
  str: string,
  x: number,
  baselineFromBottom: number,
  width = str.length * 6,
) {
  return { str, transform: [10, 0, 0, 10, x, baselineFromBottom], width, height: 10 };
}

/** Words on one page, one line per entry, for diff tests. */
function page(lines: string[], pageNumber = 1, firstLine = 0): PdfDiffWord[] {
  return wordsFromTextItems(
    lines.map((text, index) => item(text, 50, 700 - index * 14)),
    viewport,
    pageNumber,
    firstLine,
  ).words;
}

describe("normalizeWordKey", () => {
  it("folds ligatures, quotes and dashes but keeps case", () => {
    expect(normalizeWordKey("\ufb01nd")).toBe("find");
    expect(normalizeWordKey("\u201cquoted\u201d")).toBe('"quoted"');
    expect(normalizeWordKey("1\u20132")).toBe("1-2");
    expect(normalizeWordKey("soft\u00adhyphen")).toBe("softhyphen");
    expect(normalizeWordKey("Word")).not.toBe(normalizeWordKey("word"));
  });
});

describe("wordsFromTextItems", () => {
  it("splits items into words with page-relative boxes", () => {
    const { words, nextLine } = wordsFromTextItems(
      [item("Hello world", 60, 700, 66), item("   ", 0, 0)],
      viewport,
      3,
      5,
    );
    expect(words.map((word) => word.text)).toEqual(["Hello", "world"]);
    expect(words.every((word) => word.page === 3 && word.line === 5)).toBe(true);
    expect(nextLine).toBe(6);
    const [hello, world] = words.map((word) => word.boxes[0].rect);
    expect(hello.x).toBeCloseTo(60 / 600);
    expect(hello.width).toBeCloseTo(30 / 600);
    expect(world.x).toBeCloseTo((60 + 36) / 600);
    // Baseline 100px from the top, so the box sits just above it.
    expect(hello.y).toBeLessThan(100 / 800);
    expect(hello.y + hello.height).toBeGreaterThan(100 / 800);
  });

  it("starts a new line when the baseline moves", () => {
    const words = page(["first line", "second line"]);
    expect(words.map((word) => word.line)).toEqual([0, 0, 1, 1]);
  });

  it("skips items without a usable transform", () => {
    expect(
      wordsFromTextItems([{ str: "x", transform: [], width: 1 }], viewport, 1).words,
    ).toEqual([]);
  });
});

describe("joinHyphenatedWords", () => {
  it("joins a word hyphenated across lines", () => {
    const words = joinHyphenatedWords(page(["a compar-", "ison of"]));
    expect(words.map((word) => word.key)).toEqual(["a", "comparison", "of"]);
    expect(words[1].boxes).toHaveLength(2);
  });

  it("keeps real hyphens and capitalised continuations", () => {
    expect(
      joinHyphenatedWords(page(["state-of-the-art", "Methods"])).map((w) => w.key),
    ).toEqual(["state-of-the-art", "Methods"]);
    expect(joinHyphenatedWords(page(["non-", "Linear"])).map((w) => w.key)).toEqual([
      "non-",
      "Linear",
    ]);
  });
});

describe("mergeBoxes", () => {
  it("merges neighbours on a line and keeps other lines apart", () => {
    const merged = mergeBoxes([
      { page: 1, rect: { x: 0.1, y: 0.1, width: 0.05, height: 0.02 } },
      { page: 1, rect: { x: 0.16, y: 0.1, width: 0.05, height: 0.02 } },
      { page: 1, rect: { x: 0.1, y: 0.2, width: 0.05, height: 0.02 } },
      { page: 2, rect: { x: 0.1, y: 0.2, width: 0.05, height: 0.02 } },
    ]);
    expect(merged).toHaveLength(3);
    expect(merged[0].rect.x).toBeCloseTo(0.1);
    expect(merged[0].rect.width).toBeCloseTo(0.11);
  });
});

describe("diffPdfWords", () => {
  it("reports no hunks for identical text", () => {
    const words = page(["same text here"]);
    const result = diffPdfWords(words, words);
    expect(result.hunks).toEqual([]);
    expect(result.stats).toMatchObject({ addedWords: 0, removedWords: 0 });
  });

  it("finds added, removed and changed words with highlights", () => {
    const original = page(["We show a fast method.", "It works well."]);
    const modified = page(["We show a robust fast method.", "It works."]);
    const result = diffPdfWords(original, modified);
    expect(
      result.hunks.map((hunk) => [hunk.kind, hunk.removedText, hunk.addedText]),
    ).toEqual([
      ["added", "", "robust"],
      ["changed", "works well.", "works."],
    ]);
    expect(result.stats.addedWords).toBe(2);
    expect(result.stats.removedWords).toBe(2);
    const added = result.modifiedHighlights.get(1)!;
    expect(added.some((mark) => mark.kind === "added" && mark.hunkId === 0)).toBe(true);
    // The original side marks where the inserted word goes.
    expect(
      result.originalHighlights.get(1)!.find((mark) => mark.hunkId === 0)!.kind,
    ).toBe("insert-point");
    expect(result.hunks[0]).toMatchObject({ originalPage: 1, modifiedPage: 1 });
    expect(result.hunks[0].contextBefore).toBe("We show a");
  });

  it("tracks pages that changed when text moves to another page", () => {
    const original = [...page(["Intro text"], 1), ...page(["Old ending"], 2, 1)];
    const modified = [...page(["Intro text"], 1), ...page(["New ending"], 2, 1)];
    const result = diffPdfWords(original, modified);
    expect(result.stats.changedOriginalPages).toEqual([2]);
    expect(result.stats.changedModifiedPages).toEqual([2]);
    expect(result.hunks[0]).toMatchObject({
      kind: "changed",
      removedText: "Old",
      addedText: "New",
    });
  });

  it("ignores reflowed hyphenation", () => {
    const original = joinHyphenatedWords(page(["a careful compar-", "ison"]));
    const modified = joinHyphenatedWords(page(["a careful", "comparison"]));
    expect(diffPdfWords(original, modified).hunks).toEqual([]);
  });
});

describe("stripPageFurniture", () => {
  /** A page whose lines are spread from the top (y 0.05) to the bottom. */
  function sheet(
    pageNumber: number,
    lines: string[],
    firstLine: number,
  ): PdfDiffWord[] {
    return wordsFromTextItems(
      lines.map((text, index) => item(text, 50, 760 - index * 60)),
      viewport,
      pageNumber,
      firstLine,
    ).words;
  }

  it("drops page numbers and running headers but keeps the body", () => {
    const words = [
      ...sheet(1, ["Draft paper", "Body one", "1"], 0),
      ...sheet(2, ["Draft paper", "Body two", "ii"], 10),
      ...sheet(3, ["Draft paper", "Body three", "- 3 -"], 20),
    ];
    expect(stripPageFurniture(words).map((word) => word.text)).toEqual([
      "Body",
      "one",
      "Body",
      "two",
      "Body",
      "three",
    ]);
  });

  it("keeps edge lines that are content", () => {
    const words = [
      ...sheet(1, ["Introduction", "Body", "did"], 0),
      ...sheet(2, ["Results", "Body", "Conclusion 2."], 10),
    ];
    expect(stripPageFurniture(words)).toHaveLength(words.length);
    // A single page cannot have a repeated header.
    expect(stripPageFurniture(sheet(1, ["Header", "Body"], 0))).toHaveLength(2);
    expect(stripPageFurniture([])).toEqual([]);
  });

  it("stops a moved page break from showing the page number as a change", () => {
    const before = [...sheet(1, ["a b c", "1"], 0), ...sheet(2, ["d e", "2"], 10)];
    const after = [...sheet(1, ["new a b", "1"], 0), ...sheet(2, ["c d e", "2"], 10)];
    const result = diffPdfWords(stripPageFurniture(before), stripPageFurniture(after));
    expect(result.hunks.map((hunk) => [hunk.removedText, hunk.addedText])).toEqual([
      ["", "new"],
    ]);
  });
});
