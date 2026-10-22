import { describe, expect, it } from "vitest";
import { getLatexCompletionContext } from "./completionContext";

describe("legacy getLatexCompletionContext", () => {
  it("returns a citation context with the range after the opening brace", () => {
    const line = "See \\citep{knuth";
    expect(getLatexCompletionContext(line, line.length + 1)).toEqual({
      type: "citation",
      command: "citep",
      currentText: "knuth",
      rangeStartColumn: 12,
      rangeEndColumn: line.length + 1,
    });
  });

  it("returns a reference context for an empty argument", () => {
    const line = "Fig. \\ref{";
    expect(getLatexCompletionContext(line, line.length + 1)).toEqual({
      type: "reference",
      command: "ref",
      currentText: "",
      rangeStartColumn: line.length + 1,
      rangeEndColumn: line.length + 1,
    });
  });

  it("returns null for other commands and when no argument is open", () => {
    expect(getLatexCompletionContext("\\section{Intro", 15)).toBeNull();
    expect(getLatexCompletionContext("\\cite{a} done", 14)).toBeNull();
    expect(getLatexCompletionContext("plain text", 5)).toBeNull();
  });
});
