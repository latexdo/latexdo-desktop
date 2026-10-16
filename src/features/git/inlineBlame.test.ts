import { describe, expect, it } from "vitest";
import type { GitBlameLine } from "../../types";
import {
  blameByLine,
  blameHeatLevel,
  blameHoverMarkdown,
  buildBlameAnnotations,
  fileBlameAuthorMaxLength,
  formatBlameRelativeTime,
  heatLevelCount,
  inlineBlameText,
  isUncommittedBlame,
  unsavedChangesBlameText,
} from "./inlineBlame";

const now = new Date("2026-07-14T12:00:00.000Z");

function blame(overrides: Partial<GitBlameLine> = {}): GitBlameLine {
  return {
    line: 1,
    hash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    shortHash: "a1b2c3d",
    author: "Ada Lovelace",
    authorTime: "2026-07-11T12:00:00.000Z",
    summary: "Improve the preamble",
    ...overrides,
  };
}

function agoIso(milliseconds: number): string {
  return new Date(now.getTime() - milliseconds).toISOString();
}

describe("isUncommittedBlame", () => {
  it("treats an all-zero hash as uncommitted", () => {
    expect(
      isUncommittedBlame(blame({ hash: "0".repeat(40), shortHash: "0000000" })),
    ).toBe(true);
  });

  it("treats a normal hash as committed", () => {
    expect(isUncommittedBlame(blame())).toBe(false);
  });
});

describe("formatBlameRelativeTime", () => {
  it.each([
    { elapsed: 10 * 1000, expected: "just now" },
    { elapsed: 60 * 1000, expected: "a minute ago" },
    { elapsed: 10 * 60 * 1000, expected: "10 minutes ago" },
    { elapsed: 60 * 60 * 1000, expected: "an hour ago" },
    { elapsed: 5 * 60 * 60 * 1000, expected: "5 hours ago" },
    { elapsed: 24 * 60 * 60 * 1000, expected: "yesterday" },
    { elapsed: 3 * 24 * 60 * 60 * 1000, expected: "3 days ago" },
    { elapsed: 8 * 24 * 60 * 60 * 1000, expected: "a week ago" },
    { elapsed: 21 * 24 * 60 * 60 * 1000, expected: "3 weeks ago" },
    { elapsed: 60 * 24 * 60 * 60 * 1000, expected: "2 months ago" },
    { elapsed: 400 * 24 * 60 * 60 * 1000, expected: "a year ago" },
    { elapsed: 3 * 365 * 24 * 60 * 60 * 1000, expected: "3 years ago" },
  ])("formats $expected", ({ elapsed, expected }) => {
    expect(formatBlameRelativeTime(agoIso(elapsed), now)).toBe(expected);
  });

  it("handles unparseable dates", () => {
    expect(formatBlameRelativeTime("", now)).toBe("some time ago");
    expect(formatBlameRelativeTime("not-a-date", now)).toBe("some time ago");
  });

  it("clamps future dates to just now", () => {
    expect(formatBlameRelativeTime(agoIso(-60_000), now)).toBe("just now");
  });
});

describe("blameHeatLevel", () => {
  it("maps ages to increasing heat levels", () => {
    const dayMs = 24 * 60 * 60 * 1000;
    expect(blameHeatLevel(agoIso(60 * 1000), now)).toBe(0);
    expect(blameHeatLevel(agoIso(3 * dayMs), now)).toBe(1);
    expect(blameHeatLevel(agoIso(10 * dayMs), now)).toBe(2);
    expect(blameHeatLevel(agoIso(20 * dayMs), now)).toBe(3);
    expect(blameHeatLevel(agoIso(60 * dayMs), now)).toBe(4);
    expect(blameHeatLevel(agoIso(120 * dayMs), now)).toBe(5);
    expect(blameHeatLevel(agoIso(200 * dayMs), now)).toBe(6);
    expect(blameHeatLevel(agoIso(400 * dayMs), now)).toBe(7);
    expect(blameHeatLevel(agoIso(3 * 365 * dayMs), now)).toBe(8);
    expect(blameHeatLevel(agoIso(10 * 365 * dayMs), now)).toBe(heatLevelCount - 1);
  });

  it("treats unparseable dates as oldest", () => {
    expect(blameHeatLevel("", now)).toBe(heatLevelCount - 1);
  });
});

describe("inlineBlameText", () => {
  it("shows author, relative time and summary", () => {
    expect(inlineBlameText(blame(), now)).toBe(
      "Ada Lovelace, 3 days ago • Improve the preamble",
    );
  });

  it("labels uncommitted lines", () => {
    expect(inlineBlameText(blame({ hash: "0".repeat(40) }), now)).toBe(
      "You • Uncommitted changes",
    );
  });

  it("truncates long summaries", () => {
    const text = inlineBlameText(blame({ summary: "x".repeat(200) }), now);
    expect(text.endsWith("…")).toBe(true);
    expect(text.length).toBeLessThan(140);
  });

  it("falls back when the summary is empty", () => {
    expect(inlineBlameText(blame({ summary: "  " }), now)).toContain(
      "(no commit message)",
    );
  });
});

describe("unsavedChangesBlameText", () => {
  it("labels unsaved buffers", () => {
    expect(unsavedChangesBlameText()).toBe("You • Unsaved changes");
  });
});

describe("blameHoverMarkdown", () => {
  it("includes author, times, hash and summary", () => {
    const markdown = blameHoverMarkdown(blame(), now);
    expect(markdown).toContain("Ada Lovelace");
    expect(markdown).toContain("3 days ago");
    expect(markdown).toContain("`a1b2c3d`");
    expect(markdown).toContain("Improve the preamble");
  });

  it("escapes markdown in author and summary", () => {
    const markdown = blameHoverMarkdown(
      blame({ author: "Eve *bold*", summary: "[link](x) `code`" }),
      now,
    );
    expect(markdown).toContain("\\*bold\\*");
    expect(markdown).toContain("\\[link\\]");
    expect(markdown).not.toContain("[link](x)");
  });

  it("describes uncommitted lines", () => {
    const markdown = blameHoverMarkdown(blame({ hash: "0".repeat(40) }), now);
    expect(markdown).toContain("Uncommitted changes");
  });
});

describe("blameByLine", () => {
  it("indexes blame entries by line number", () => {
    const map = blameByLine([blame({ line: 3 }), blame({ line: 7 })]);
    expect(map.get(3)?.line).toBe(3);
    expect(map.get(7)?.line).toBe(7);
    expect(map.get(1)).toBeUndefined();
  });

  it("ignores invalid line numbers", () => {
    const map = blameByLine([blame({ line: 0 }), blame({ line: -2 })]);
    expect(map.size).toBe(0);
  });
});

describe("buildBlameAnnotations", () => {
  it("builds one annotation per valid blame line", () => {
    const annotations = buildBlameAnnotations(
      [blame({ line: 1 }), blame({ line: 2, hash: "0".repeat(40) })],
      now,
    );

    expect(annotations).toHaveLength(2);
    expect(annotations[0].lineNumber).toBe(1);
    expect(annotations[0].uncommitted).toBe(false);
    expect(annotations[0].heatLevel).toBe(1);
    expect(annotations[1].uncommitted).toBe(true);
    expect(annotations[1].heatLevel).toBe(0);
    expect(annotations[1].gutterText).toContain("Uncommitted");
  });

  it("pads gutter author names to a fixed width", () => {
    const [annotation] = buildBlameAnnotations([blame({ author: "Al" })], now);
    expect(
      annotation.gutterText.startsWith("Al".padEnd(fileBlameAuthorMaxLength)),
    ).toBe(true);
  });

  it("truncates long gutter author names", () => {
    const [annotation] = buildBlameAnnotations(
      [blame({ author: "A very long author name indeed" })],
      now,
    );
    expect(annotation.gutterText).toContain("…");
  });
});
