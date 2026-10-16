import { describe, it, expect } from "vitest";
import {
  getLatexCommandCompletionRange,
  getLatexCompletionContext,
} from "../completionContext";

// ── Citation command variants ────────────────────────────────────────────
const citeCommands = [
  "cite",
  "citep",
  "citet",
  "citealp",
  "parencite",
  "textcite",
  "autocite",
  "footcite",
];
const citeTests = citeCommands.flatMap((cmd) => [
  {
    desc: `\\${cmd}{} at end`,
    line: `\\${cmd}{}`,
    col: `\\${cmd}{`.length + 1,
    type: "citation" as const,
    text: "",
  },
  {
    desc: `\\${cmd}{ref1}`,
    line: `\\${cmd}{ref1}`,
    col: `\\${cmd}{ref1`.length + 1,
    type: "citation" as const,
    text: "ref1",
  },
  {
    desc: `\\${cmd}{key with spaces}`,
    line: `\\${cmd}{key with spaces}`,
    col: `\\${cmd}{key with spaces`.length + 1,
    type: "citation" as const,
    text: "key with spaces",
  },
]);
describe("Citation command context — parameterized", () => {
  it.each(citeTests)("$desc", ({ line, col, type, text }) => {
    const result = getLatexCompletionContext(line, col);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.type).toBe(type);
      expect(result.currentText).toBe(text);
    }
  });
});

// ── Reference command variants ───────────────────────────────────────────
const refCommands = ["ref", "eqref", "autoref", "cref", "Cref", "pageref"];
const refTests = refCommands.flatMap((cmd) => [
  {
    desc: `\\${cmd}{} at end`,
    line: `\\${cmd}{}`,
    col: `\\${cmd}{`.length + 1,
    type: "reference" as const,
    text: "",
  },
  {
    desc: `\\${cmd}{sec:intro}`,
    line: `\\${cmd}{sec:intro}`,
    col: `\\${cmd}{sec:intro`.length + 1,
    type: "reference" as const,
    text: "sec:intro",
  },
  {
    desc: `\\${cmd}{fig:overview}`,
    line: `\\${cmd}{fig:overview}`,
    col: `\\${cmd}{fig:overview`.length + 1,
    type: "reference" as const,
    text: "fig:overview",
  },
]);
describe("Reference command context — parameterized", () => {
  it.each(refTests)("$desc", ({ line, col, type, text }) => {
    const result = getLatexCompletionContext(line, col);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.type).toBe(type);
      expect(result.currentText).toBe(text);
    }
  });
});

// ── Null returns (no match) ──────────────────────────────────────────────
const nullCases = [
  { desc: "empty line", line: "", col: 1 },
  { desc: "no backslash", line: "cite{ref1}", col: 6 },
  { desc: "no brace", line: "\\cite", col: 5 },
  { desc: "not a known command", line: "\\unknown{arg}", col: 10 },
  { desc: "just backslash", line: "\\", col: 2 },
  { desc: "brace but no command", line: "{arg}", col: 4 },
  { desc: "unknown command with brace", line: "\\foo{bar}", col: 7 },
  { desc: "cursor before brace", line: "\\cite{ref1}", col: 5 },
  {
    desc: "unclosed optional argument",
    line: "\\cite[see",
    col: "\\cite[see".length + 1,
  },
];
describe("Null (no match) — parameterized", () => {
  it.each(nullCases)("returns null for $desc", ({ line, col }) => {
    expect(getLatexCompletionContext(line, col)).toBeNull();
  });
});

// ── Range calculation ────────────────────────────────────────────────────
const rangeTests = [
  {
    desc: "simple cite",
    cmd: "cite",
    arg: "ref1",
    line: "\\cite{ref1}",
    type: "citation" as const,
  },
  {
    desc: "simple ref",
    cmd: "eqref",
    arg: "eq:loss",
    line: "\\eqref{eq:loss}",
    type: "reference" as const,
  },
  {
    desc: "multi-char cmd",
    cmd: "textcite",
    arg: "author99",
    line: "\\textcite{author99}",
    type: "citation" as const,
  },
];
describe("Range calculation — parameterized", () => {
  it.each(rangeTests)("$desc: $line", ({ line, arg, type, cmd }) => {
    const col = line.indexOf("}") + 1;
    const result = getLatexCompletionContext(line, col);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.type).toBe(type);
      expect(result.rangeStartColumn).toBe(line.indexOf(`\\${cmd}`) + cmd.length + 3);
      expect(result.rangeEndColumn).toBe(col);
      expect(result.currentText).toBe(arg);
    }
  });
});

describe("Command completion range", () => {
  it("replaces the whole LaTeX command prefix including the backslash", () => {
    const result = getLatexCommandCompletionRange("\\sec", "\\sec".length + 1);

    expect(result).toEqual({
      currentText: "sec",
      rangeStartColumn: 1,
      rangeEndColumn: 5,
    });
  });

  it("supports an empty command after a backslash", () => {
    const result = getLatexCommandCompletionRange("Text \\", "Text \\".length + 1);

    expect(result).toEqual({
      currentText: "",
      rangeStartColumn: 6,
      rangeEndColumn: 7,
    });
  });

  it("does not match a command when the cursor has moved into an argument", () => {
    expect(
      getLatexCommandCompletionRange("\\cite{sm", "\\cite{sm".length + 1),
    ).toBeNull();
  });
});

describe("Argument completion range", () => {
  it("replaces only the current citation key after a comma", () => {
    const line = "\\cite{known, Sm";
    const result = getLatexCompletionContext(line, line.length + 1);

    expect(result).toMatchObject({
      type: "citation",
      currentText: "Sm",
      rangeStartColumn: "\\cite{known, ".length + 1,
      rangeEndColumn: line.length + 1,
    });
  });

  it("supports citation commands with optional arguments", () => {
    const line = "\\cite[see][p. 5]{Sm";
    const result = getLatexCompletionContext(line, line.length + 1);

    expect(result).toMatchObject({
      type: "citation",
      currentText: "Sm",
      rangeStartColumn: "\\cite[see][p. 5]{".length + 1,
      rangeEndColumn: line.length + 1,
    });
  });
});

// ── Partial typing ───────────────────────────────────────────────────────
const partialTests = [
  {
    desc: "single char typed",
    cmd: "cite",
    partial: "r",
    line: "\\cite{r",
    type: "citation" as const,
  },
  {
    desc: "mid-typing",
    cmd: "ref",
    partial: "fig:tes",
    line: "\\ref{fig:tes",
    type: "reference" as const,
  },
  {
    desc: "multi-char cmd partial",
    cmd: "autocite",
    partial: "keywor",
    line: "\\autocite{keywor",
    type: "citation" as const,
  },
];
describe("Partial typing — parameterized", () => {
  it.each(partialTests)("$desc", ({ line, type, partial }) => {
    const result = getLatexCompletionContext(line, line.length + 1);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.type).toBe(type);
      expect(result.currentText).toBe(partial);
    }
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────
const edgeCases = [
  { desc: "unicode in cite key", line: "\\cite{über}", col: "\\cite{übe".length + 1 },
  { desc: "numbers only", line: "\\cite{12345}", col: "\\cite{1234".length + 1 },
  { desc: "hyphen in key", line: "\\ref{sec-intro}", col: "\\ref{sec-intr".length + 1 },
  { desc: "underscore in key", line: "\\cite{my_ref}", col: "\\cite{my_re".length + 1 },
  { desc: "dot in key", line: "\\ref{fig.1}", col: "\\ref{fig.".length + 1 },
  {
    desc: "colon in key",
    line: "\\cite{doi:10.1000/test}",
    col: "\\cite{doi:10.1000/tes".length + 1,
  },
  { desc: "forward slash in key", line: "\\ref{sec/2}", col: "\\ref{sec/".length + 1 },
  {
    desc: "very long key",
    line: "\\cite{" + "a".repeat(100) + "}",
    col: ("\\cite{" + "a".repeat(80) + "").length + 1,
  },
  {
    desc: "empty cite with following text",
    line: "\\cite{} and then some",
    col: "\\cite{}".length,
  },
  { desc: "command at line start", line: "\\cite{ref1}", col: "\\cite{ref".length + 1 },
  {
    desc: "command at end of text",
    line: "text \\cite{ref1}",
    col: "text \\cite{ref1}".length + 1,
  },
  {
    desc: "command with trailing space",
    line: "\\cite{ref1} ",
    col: "\\cite{ref1}".length + 1,
  },
  {
    desc: "multiple braces after",
    line: "\\cite{ref1}}}}}",
    col: "\\cite{re".length + 1,
  },
];
describe("Edge cases — parameterized", () => {
  it.each(edgeCases)("handles $desc", ({ line, col }) => {
    const result = getLatexCompletionContext(line, col);
    if (result) {
      expect(["citation", "reference"]).toContain(result.type);
      expect(typeof result.currentText).toBe("string");
      expect(typeof result.rangeStartColumn).toBe("number");
      expect(typeof result.rangeEndColumn).toBe("number");
    }
  });
});
