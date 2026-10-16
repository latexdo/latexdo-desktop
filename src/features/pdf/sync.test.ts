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
