import { describe, expect, it } from "vitest";
import {
  isLearnableEdit,
  normalizeContentChangeEvent,
  originForContentChange,
} from "./editNormalizer";

function normalize(args: {
  before: string;
  after: string;
  rangeOffset: number;
  rangeLength: number;
  text: string;
  origin?: "user" | "next-edit" | "programmatic";
}) {
  return normalizeContentChangeEvent({
    documentKey: "project:main.tex",
    revisionBefore: 1,
    revisionAfter: 2,
    beforeText: args.before,
    afterText: args.after,
    event: {
      changes: [
        {
          rangeOffset: args.rangeOffset,
          rangeLength: args.rangeLength,
          text: args.text,
        },
      ],
    },
    origin: args.origin ?? "user",
    timestamp: 100,
  });
}

describe("editNormalizer", () => {
  it("normalizes a replacement", () => {
    const before = "old_name appears";
    const edits = normalize({
      before,
      after: "new_name appears",
      rangeOffset: 0,
      rangeLength: "old_name".length,
      text: "new_name",
    });

    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      oldText: "old_name",
      newText: "new_name",
      startOffsetBefore: 0,
      endOffsetBefore: 8,
      origin: "user",
    });
    expect(isLearnableEdit(edits[0], { language: "latex" })).toBe(true);
  });

  it("normalizes a deletion", () => {
    const edits = normalize({
      before: "remove me please",
      after: " please",
      rangeOffset: 0,
      rangeLength: "remove me".length,
      text: "",
    });

    expect(edits[0]?.oldText).toBe("remove me");
    expect(edits[0]?.newText).toBe("");
  });

  it("normalizes an insertion", () => {
    const edits = normalize({
      before: "alpha\nbeta",
      after: "alpha;\nbeta",
      rangeOffset: "alpha".length,
      rangeLength: 0,
      text: ";",
    });

    expect(edits[0]?.oldText).toBe("");
    expect(edits[0]?.newText).toBe(";");
    expect(edits[0]?.beforeContext).toBe("alpha");
    expect(edits[0]?.afterContext).toBe("\nbeta");
  });

  it("preserves multi-line replacement text", () => {
    const before = "A\nB\nC";
    const edits = normalize({
      before,
      after: "A\nBB\nCC",
      rangeOffset: 2,
      rangeLength: 3,
      text: "BB\nCC",
    });

    expect(edits[0]?.oldText).toBe("B\nC");
    expect(edits[0]?.newText).toBe("BB\nCC");
  });

  it("orders multiple Monaco changes from document start to end", () => {
    const before = "foo bar baz";
    const edits = normalizeContentChangeEvent({
      documentKey: "project:main.tex",
      revisionBefore: 1,
      revisionAfter: 2,
      beforeText: before,
      afterText: "FOO bar BAZ",
      event: {
        changes: [
          { rangeOffset: 8, rangeLength: 3, text: "BAZ" },
          { rangeOffset: 0, rangeLength: 3, text: "FOO" },
        ],
      },
      origin: "user",
      timestamp: 100,
    });

    expect(edits.map((edit) => edit.oldText)).toEqual(["foo", "baz"]);
  });

  it("ignores full model flush and EOL-only events", () => {
    expect(
      normalizeContentChangeEvent({
        documentKey: "project:main.tex",
        revisionBefore: 1,
        revisionAfter: 2,
        beforeText: "old",
        afterText: "new",
        event: {
          isFlush: true,
          changes: [{ rangeOffset: 0, rangeLength: 3, text: "new" }],
        },
        origin: "user",
      }),
    ).toEqual([]);
    expect(
      normalizeContentChangeEvent({
        documentKey: "project:main.tex",
        revisionBefore: 1,
        revisionAfter: 2,
        beforeText: "a\n",
        afterText: "a\r\n",
        event: {
          isEolChange: true,
          changes: [{ rangeOffset: 0, rangeLength: 2, text: "a\r\n" }],
        },
        origin: "user",
      }),
    ).toEqual([]);
  });

  it("classifies undo and redo before learning", () => {
    expect(originForContentChange({ changes: [], isUndoing: true }, null)).toBe("undo");
    expect(originForContentChange({ changes: [], isRedoing: true }, null)).toBe("redo");
    expect(originForContentChange({ changes: [] }, "programmatic")).toBe(
      "programmatic",
    );
  });

  it("rejects programmatic and next-edit origins for learning", () => {
    const programmatic = normalize({
      before: "foo",
      after: "bar",
      rangeOffset: 0,
      rangeLength: 3,
      text: "bar",
      origin: "programmatic",
    })[0];
    const nextEdit = normalize({
      before: "foo",
      after: "bar",
      rangeOffset: 0,
      rangeLength: 3,
      text: "bar",
      origin: "next-edit",
    })[0];

    expect(isLearnableEdit(programmatic, { language: "latex" })).toBe(false);
    expect(isLearnableEdit(nextEdit, { language: "latex" })).toBe(false);
  });

  it("uses Monaco-compatible UTF-16 offsets for Unicode text", () => {
    const before = "a😀 old";
    const offset = before.indexOf("old");
    const edits = normalize({
      before,
      after: "a😀 new",
      rangeOffset: offset,
      rangeLength: 3,
      text: "new",
    });

    expect(edits[0]?.oldText).toBe("old");
    expect(edits[0]?.startOffsetBefore).toBe(4);
  });

  it("preserves CRLF context", () => {
    const before = "one\r\ntwo\r\nthree";
    const offset = before.indexOf("two");
    const edits = normalize({
      before,
      after: "one\r\nTWO\r\nthree",
      rangeOffset: offset,
      rangeLength: 3,
      text: "TWO",
    });

    expect(edits[0]?.beforeContext.endsWith("\r\n")).toBe(true);
    expect(edits[0]?.afterContext.startsWith("\r\n")).toBe(true);
  });

  it("rejects huge paste-style edits", () => {
    const edits = normalize({
      before: "x",
      after: "x".repeat(700),
      rangeOffset: 0,
      rangeLength: 1,
      text: "x".repeat(700),
    });

    expect(isLearnableEdit(edits[0], { language: "latex" })).toBe(false);
  });
});
