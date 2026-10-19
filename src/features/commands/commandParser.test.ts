import { describe, expect, it } from "vitest";
import {
  isLatexDoCommandLine,
  isPotentialLatexDoCommandPrefix,
  parseLatexDoInput,
  tokenizeCommandLine,
} from "./commandParser";

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

describe("commandParser edge cases", () => {
  it("keeps a trailing backslash literally", () => {
    expect(tokenizeCommandLine("latexdo path\\")).toEqual({
      ok: true,
      tokens: ["latexdo", "path\\"],
    });
  });

  it("names the unterminated single quote", () => {
    expect(tokenizeCommandLine("latexdo note 'oops")).toEqual({
      ok: false,
      message: "Unterminated single quote.",
    });
  });

  it("returns a parse error result for bad quoting", () => {
    expect(parseLatexDoInput('latexdo "x')).toEqual({
      kind: "error",
      result: { ok: false, message: "Unterminated double quote." },
    });
  });

  it("classifies empty and foreign input as external", () => {
    expect(parseLatexDoInput("   ")).toEqual({ kind: "external" });
    expect(parseLatexDoInput("git status")).toEqual({ kind: "external" });
    expect(parseLatexDoInput("LatexDo build now")).toEqual({
      kind: "latexdo",
      tokens: ["LatexDo", "build", "now"],
      args: ["build", "now"],
    });
  });
});

describe("command line detection", () => {
  it.each([
    ["latexdo", true],
    ["  LATEXDO build", true],
    ["latexdoo", false],
    ["ls", false],
  ])("isLatexDoCommandLine(%j) -> %s", (input, expected) => {
    expect(isLatexDoCommandLine(input)).toBe(expected);
  });

  it.each([
    ["", true],
    ["  lat", true],
    ["latexdo", true],
    ["latexdo build", true],
    ["latexdox", false],
    ["git", false],
  ])("isPotentialLatexDoCommandPrefix(%j) -> %s", (input, expected) => {
    expect(isPotentialLatexDoCommandPrefix(input)).toBe(expected);
  });
});
