import { describe, expect, it } from "vitest";
import {
  contextUnchanged,
  insertAtContext,
  insertAtCurrentCursor,
} from "./textInsertion";

describe("textInsertion", () => {
  it("inserts into an empty field", () => {
    const result = insertAtContext(
      { value: "", selectionStart: 0, selectionEnd: 0 },
      "hello",
    );
    expect(result).toEqual({ value: "hello", cursor: 5 });
  });

  it("inserts at the beginning of text", () => {
    const result = insertAtContext(
      { value: "world", selectionStart: 0, selectionEnd: 0 },
      "hello ",
    );
    expect(result).toEqual({ value: "hello world", cursor: 6 });
  });

  it("inserts in the middle (Hello |world → Hello beautiful world)", () => {
    const result = insertAtContext(
      { value: "Hello world", selectionStart: 6, selectionEnd: 6 },
      "beautiful ",
    );
    expect(result).toEqual({ value: "Hello beautiful world", cursor: 16 });
  });

  it("inserts at the end of text", () => {
    const result = insertAtContext(
      { value: "Hello world", selectionStart: 11, selectionEnd: 11 },
      "!",
    );
    expect(result).toEqual({ value: "Hello world!", cursor: 12 });
  });

  it("never glues words when the transcript has no trailing space", () => {
    // STT output rarely ships with spaces around it; the spacer adds what's
    // needed without touching whitespace already present.
    const result = insertAtContext(
      { value: "Hello world", selectionStart: 6, selectionEnd: 6 },
      "beautiful",
    );
    expect(result).toEqual({ value: "Hello beautiful world", cursor: 15 });
  });

  it("does not double a space that the transcript already provides", () => {
    const result = insertAtContext(
      { value: "foo bar", selectionStart: 4, selectionEnd: 4 },
      "quick ",
    );
    expect(result).toEqual({ value: "foo quick bar", cursor: 10 });
  });

  it("replaces a selected range (Hello [old] world → Hello new world)", () => {
    const result = insertAtContext(
      { value: "Hello old world", selectionStart: 6, selectionEnd: 9 },
      "new",
    );
    expect(result).toEqual({ value: "Hello new world", cursor: 9 });
  });

  it("replaces a multi-line selection", () => {
    const value = "line one\nold old\nline three";
    const start = value.indexOf("old");
    const result = insertAtContext(
      { value, selectionStart: start, selectionEnd: start + "old old".length },
      "fresh",
    );
    expect(result.value).toBe("line one\nfresh\nline three");
    expect(result.cursor).toBe("line one\nfresh".length);
  });

  it("preserves Unicode (λ, Arabic, emoji) around the cursor", () => {
    const value = "eigenvalue ε\u00A0λ 结束 الأستمرارية";
    const at = value.indexOf("结束");
    const result = insertAtContext(
      { value, selectionStart: at, selectionEnd: at },
      " and ",
    );
    expect(result.value).toBe("eigenvalue ε\u00A0λ  and 结束 الأستمرارية");
  });

  it("preserves LaTeX around the cursor", () => {
    const value = "We define $\\lambda$ as the gradient.";
    const at = value.indexOf(" as ");
    const result = insertAtContext(
      { value, selectionStart: at, selectionEnd: at },
      " parameter ",
    );
    expect(result.value).toBe("We define $\\lambda$ parameter  as the gradient.");
  });

  it("clamps out-of-range selection offsets", () => {
    const result = insertAtContext(
      { value: "hi", selectionStart: 99, selectionEnd: 99 },
      "!",
    );
    expect(result).toEqual({ value: "hi!", cursor: 3 });
  });

  it("detects whether the captured context is still intact", () => {
    const context = { value: "Hello world", selectionStart: 6, selectionEnd: 6 };
    expect(contextUnchanged(context, "Hello world")).toBe(true);
    expect(contextUnchanged(context, "Hello world!")).toBe(false);
    expect(contextUnchanged(context, "")).toBe(false);
  });

  it("can insert at the current cursor when content changed", () => {
    const result = insertAtCurrentCursor("typed meanwhile", 15, 15, " voice");
    expect(result.value).toBe("typed meanwhile voice");
    expect(result.cursor).toBe(21);
    const replace = insertAtCurrentCursor("abc", 1, 2, "-x-");
    expect(replace.value).toBe("a-x-c");
  });
});
