import { describe, expect, it } from "vitest";
import { diffLines, maxHistoryLines } from "./lineDiff";

const lines = (count: number, label = "line") =>
  Array.from({ length: count }, (_, index) => `${label} ${index + 1}`);

describe("diffLines", () => {
  it("finds nothing in identical text", () => {
    expect(diffLines("a\nb", "a\nb")).toEqual({ hunks: [], added: 0, removed: 0 });
  });

  it("shows a changed line with two lines of context and its line numbers", () => {
    const before = lines(10).join("\n");
    const after = before.replace("line 5", "line five");
    expect(diffLines(before, after)).toEqual({
      added: 1,
      removed: 1,
      hunks: [
        {
          oldStart: 3,
          newStart: 3,
          lines: [" line 3", " line 4", "-line 5", "+line five", " line 6", " line 7"],
        },
      ],
    });
  });

  it("keeps distant changes apart and nearby ones together", () => {
    const before = lines(30);
    const after = [...before];
    after[2] = "changed 3";
    after[5] = "changed 6";
    after[25] = "changed 26";
    const { hunks, added, removed } = diffLines(before.join("\n"), after.join("\n"));
    expect([added, removed]).toEqual([3, 3]);
    expect(hunks.map((hunk) => [hunk.oldStart, hunk.lines.length])).toEqual([
      [1, 10],
      [24, 6],
    ]);
  });

  it("handles insertions at the start and deletions at the end", () => {
    expect(diffLines("b\nc", "a\nb\nc").hunks).toEqual([
      { oldStart: 1, newStart: 1, lines: ["+a", " b", " c"] },
    ]);
    expect(diffLines("a\nb\nc", "a\nb").hunks).toEqual([
      { oldStart: 1, newStart: 1, lines: [" a", " b", "-c"] },
    ]);
  });

  it("finds a minimal script inside the changed part", () => {
    const { hunks, added, removed } = diffLines(
      "x\na\nb\nc\ny",
      "x\na\nB\nc\nnew\ny",
      0,
    );
    expect([added, removed]).toEqual([2, 1]);
    expect(hunks.flatMap((hunk) => hunk.lines)).toEqual(["-b", "+B", "+new"]);
  });

  it("summarizes a huge paste instead of storing all of it", () => {
    const pasted = lines(maxHistoryLines + 100, "pasted").join("\n");
    const { hunks, added } = diffLines("start\nend", `start\n${pasted}\nend`);
    expect(added).toBe(maxHistoryLines + 100);
    const shown = hunks.flatMap((hunk) => hunk.lines);
    expect(shown).toHaveLength(maxHistoryLines + 1);
    expect(shown.at(-1)).toMatch(/^~\d+ more lines$/);
  });
});
