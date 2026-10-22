import { describe, expect, it } from "vitest";
import { visibleEditorLineForSync, visiblePdfPointForSync, wordColumn } from "./sync";

describe("PDF sync helpers", () => {
  it("finds the nearest matching word column", () => {
    expect(wordColumn("alpha beta alpha", "alpha", 12)).toEqual({
      column: 12,
      length: 5,
    });
  });

  it("uses the cursor line when it is visible in the editor", () => {
    expect(
      visibleEditorLineForSync(
        [
          { startLineNumber: 10, endLineNumber: 20 },
          { startLineNumber: 30, endLineNumber: 40 },
        ],
        34,
      ),
    ).toBe(34);
  });

  it("uses the center of the first visible editor range without a visible cursor", () => {
    expect(
      visibleEditorLineForSync([{ startLineNumber: 10, endLineNumber: 20 }], 4),
    ).toBe(15);
  });

  it("picks the visible PDF page nearest the viewport center", () => {
    expect(
      visiblePdfPointForSync(
        { left: 0, top: 0, width: 200, height: 300 },
        [
          { page: 1, left: 20, top: -260, width: 160, height: 240 },
          { page: 2, left: 20, top: 40, width: 160, height: 240 },
        ],
        2,
      ),
    ).toEqual({ page: 2, x: 40, y: 55 });
  });
});

describe("PDF sync helper edge cases", () => {
  it("falls back to the preferred column without a word or match", () => {
    expect(wordColumn("abc", undefined, 0)).toEqual({ column: 1, length: 0 });
    expect(wordColumn("abc", "zzz", 3)).toEqual({ column: 3, length: 0 });
    expect(wordColumn("ab ab", "ab", 1)).toEqual({ column: 1, length: 2 });
  });

  it("uses the middle of the first range or nothing", () => {
    expect(visibleEditorLineForSync([], 3)).toBeNull();
    expect(
      visibleEditorLineForSync([{ startLineNumber: 10, endLineNumber: 20 }], null),
    ).toBe(15);
    expect(
      visibleEditorLineForSync([{ startLineNumber: 10, endLineNumber: 20 }], undefined),
    ).toBe(15);
    expect(
      visibleEditorLineForSync([{ startLineNumber: 10, endLineNumber: 20 }], 99),
    ).toBe(15);
  });

  it("returns no PDF point without pages or with a bad scale", () => {
    const container = { left: 0, top: 0, width: 100, height: 100 };
    expect(visiblePdfPointForSync(container, [], 1)).toBeNull();
    expect(
      visiblePdfPointForSync(
        container,
        [{ page: 1, left: 0, top: 0, width: 10, height: 10 }],
        0,
      ),
    ).toBeNull();
  });

  it("picks the page nearest the centre, even when none is visible", () => {
    const container = { left: 0, top: 0, width: 100, height: 100 };
    const pages = [
      { page: 1, left: 0, top: 500, width: 100, height: 100 },
      { page: 2, left: 0, top: 300, width: 100, height: 100 },
    ];
    expect(visiblePdfPointForSync(container, pages, 2)).toEqual({
      page: 2,
      x: 25,
      y: 0,
    });
    const visible = [
      { page: 1, left: 0, top: -80, width: 100, height: 100 },
      { page: 2, left: 0, top: 30, width: 100, height: 100 },
    ];
    expect(visiblePdfPointForSync(container, visible, 1)?.page).toBe(2);
  });
});

describe("PDF sync page choice", () => {
  it("keeps the earlier page when it is closer to the centre", () => {
    const container = { left: 0, top: 0, width: 100, height: 100 };
    const pages = [
      { page: 1, left: 0, top: 0, width: 100, height: 100 },
      { page: 2, left: 0, top: 90, width: 100, height: 100 },
    ];
    expect(visiblePdfPointForSync(container, pages, 1)).toEqual({
      page: 1,
      x: 50,
      y: 50,
    });
  });
});
