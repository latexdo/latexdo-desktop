import { describe, expect, it } from "vitest";
import { parseLatexDoInput, tokenizeCommandLine } from "./commandParser";

describe("commandParser", () => {
  it("tokenizes whitespace and quoted values", () => {
    expect(tokenizeCommandLine('latexdo rebuttal title "My Research Paper"')).toEqual({
      ok: true,
      tokens: ["latexdo", "rebuttal", "title", "My Research Paper"],
    });
  });

  it("supports escaped quotes inside quoted values", () => {
    expect(tokenizeCommandLine('latexdo note "He said \\"yes\\""')).toEqual({
      ok: true,
      tokens: ["latexdo", "note", 'He said "yes"'],
    });
  });

  it("reports unterminated quotes", () => {
    expect(tokenizeCommandLine('latexdo note "unfinished')).toEqual({
      ok: false,
      message: "Unterminated double quote.",
    });
  });

  it("parses latexdo commands case-insensitively", () => {
    expect(parseLatexDoInput("LatexDo theme graphite")).toEqual({
      kind: "latexdo",
      tokens: ["LatexDo", "theme", "graphite"],
      args: ["theme", "graphite"],
    });
  });

  it("leaves ordinary shell commands external", () => {
    expect(parseLatexDoInput("npm test")).toEqual({ kind: "external" });
  });
});
