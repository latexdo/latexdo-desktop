import { describe, expect, it } from "vitest";
import {
  MAX_PROOFREAD_CHARS,
  buildProofreadingRequest,
  findProofreadingChunkRange,
  supportsProofreading,
  uniqueWords,
} from "./proofreading";

describe("findProofreadingChunkRange", () => {
  it("returns the whole document when it fits", () => {
    expect(findProofreadingChunkRange("short text", 3)).toEqual({
      start: 0,
      end: 10,
      truncated: false,
    });
  });

  it("snaps to the surrounding paragraph boundaries", () => {
    const content = "aaaa aaaa\n\nbbbb bbbb\n\ncccc cccc";
    const range = findProofreadingChunkRange(content, 13, 20);
    expect(content.slice(range.start, range.end)).toBe("bbbb bbbb");
    expect(range.truncated).toBe(true);
  });

  it("ends on a line break when no paragraph end is in reach", () => {
    const content = "line one\nline two\nline three\nline four";
    const range = findProofreadingChunkRange(content, 2, 20);
    expect(content.slice(range.start, range.end)).toBe("line one\nline two");
  });

  it("cuts at the limit when there is no usable line break", () => {
    const content = "x".repeat(50);
    expect(findProofreadingChunkRange(content, 25, 10)).toEqual({
      start: 20,
      end: 30,
      truncated: true,
    });
  });

  it("clamps targets outside the document", () => {
    const content = "y".repeat(30);
    expect(findProofreadingChunkRange(content, -5, 10)).toMatchObject({
      start: 0,
      end: 10,
    });
    expect(findProofreadingChunkRange(content, 99, 10)).toMatchObject({
      start: 20,
      end: 30,
    });
  });

  it("falls back to a raw window when the chunk is only whitespace", () => {
    const content = " ".repeat(30);
    expect(findProofreadingChunkRange(content, 12, 10)).toEqual({
      start: 12,
      end: 22,
      truncated: true,
    });
  });
});

describe("buildProofreadingRequest", () => {
  it("sends short documents as is", () => {
    expect(buildProofreadingRequest("hello", 0)).toEqual({ content: "hello" });
  });

  it("sends a chunk with its position in the original document", () => {
    const paragraph = "word ".repeat(Math.ceil(MAX_PROOFREAD_CHARS / 10)).trim();
    const content = `${paragraph}\n\nsecond\n\n${paragraph}`;
    const target = paragraph.length + 4;
    const request = buildProofreadingRequest(content, target);
    expect(request.options).toMatchObject({
      originalTextLength: content.length,
      truncated: true,
    });
    expect(request.content.length).toBeLessThanOrEqual(MAX_PROOFREAD_CHARS);
    expect(request.content.startsWith("second")).toBe(true);
    expect(request.options?.baseLine).toBe(3);
    expect(request.options?.baseColumn).toBe(1);
  });
});

describe("uniqueWords", () => {
  it("trims, drops blanks and removes duplicates in order", () => {
    expect(uniqueWords([" foo", "bar", "foo ", "", "  "])).toEqual(["foo", "bar"]);
  });
});

describe("supportsProofreading", () => {
  it.each([
    ["paper.tex", true],
    ["README.MD", true],
    ["notes.txt", true],
    ["refs.bib", false],
    ["Makefile", false],
  ])("%s → %s", (name, expected) => {
    expect(supportsProofreading(name)).toBe(expected);
  });
});
