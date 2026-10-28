import { describe, expect, it } from "vitest";
import {
  countDocumentWords,
  isProseWordContext,
  matchTypedCase,
  rankWordCompletions,
  sortDictionary,
  type DictionaryWord,
} from "./wordCompletion";

const dictionary = sortDictionary(
  (
    [
      ["the", 0],
      ["that", 0],
      ["this", 0],
      ["theory", 1],
      ["thermal", 2],
      ["result", 0],
      ["results", 0],
      ["resilient", 3],
      ["money", 0],
    ] as const
  ).map(([word, tier]): DictionaryWord => ({ word, key: word, tier })),
);

const words = (typed: string, text = "", limit?: number) =>
  rankWordCompletions(typed, countDocumentWords(text), dictionary, limit).map(
    (suggestion) => suggestion.word,
  );

describe("countDocumentWords", () => {
  it("counts prose words and skips commands, keys, math and comments", () => {
    const counts = countDocumentWords(
      String.raw`\section{Robust results} Robust models \cite{smith2020} \label{sec:intro}
\begin{figure} $x_{embedding}$ % hidden remark
\textbf{robust} state-of-the-art`,
    );
    expect(counts.get("Robust")).toBe(2);
    expect(counts.get("robust")).toBe(1);
    expect(counts.get("results")).toBe(1);
    expect(counts.get("state")).toBe(1);
    for (const skipped of [
      "section",
      "textbf",
      "smith",
      "intro",
      "figure",
      "embedding",
      "hidden",
    ])
      expect(counts.has(skipped)).toBe(false);
    // Too short to be worth completing.
    expect(counts.has("of")).toBe(false);
  });

  it("keeps accented words whole", () => {
    expect([...countDocumentWords("réseau naïve").keys()]).toEqual(["réseau", "naïve"]);
  });
});

describe("isProseWordContext", () => {
  const at = (line: string) => isProseWordContext(line, line.length + 1);
  it("accepts prose, including the prose arguments of formatting commands", () => {
    expect(at("We show that the resu")).toBe(true);
    expect(at(String.raw`\textbf{signific`)).toBe(true);
    expect(at(String.raw`\section{Introduc`)).toBe(true);
    expect(at(String.raw`as \cite{a} shows, the mod`)).toBe(true);
    expect(at("the cost is $x$ and the res")).toBe(true);
  });
  it("rejects command names, key arguments and inline math", () => {
    expect(at(String.raw`\sect`)).toBe(false);
    expect(at(String.raw`\cite{smi`)).toBe(false);
    expect(at(String.raw`\citep[p.~2]{smi`)).toBe(false);
    expect(at(String.raw`see \ref{sec:resu`)).toBe(false);
    expect(at(String.raw`\begin{equa`)).toBe(false);
    expect(at(String.raw`\usepackage{amsm`)).toBe(false);
    expect(at("where $x + alph")).toBe(false);
    expect(at(String.raw`where \(x + alph`)).toBe(false);
    expect(at(String.raw`cost \$5 and the res`)).toBe(true);
  });
});

describe("matchTypedCase", () => {
  it("follows the typed case but keeps words with their own capitals", () => {
    expect(matchTypedCase("result", "re")).toBe("result");
    expect(matchTypedCase("result", "Re")).toBe("Result");
    expect(matchTypedCase("result", "RE")).toBe("RESULT");
    expect(matchTypedCase("LaTeX", "la")).toBe("LaTeX");
  });
});

describe("rankWordCompletions", () => {
  it("needs two typed letters and never offers the typed word itself", () => {
    expect(words("t")).toEqual([]);
    expect(words("the")).toEqual(["theory", "thermal"]);
  });

  it("puts project words first by use, then common dictionary words", () => {
    expect(words("res", "resilient resilient resolution")).toEqual([
      "resilient",
      "resolution",
      "result",
      "results",
    ]);
  });

  it("ranks dictionary words by how common they are, then by length", () => {
    expect(words("th")).toEqual(["the", "that", "this", "theory", "thermal"]);
  });

  it("matches what was typed case-insensitively and adapts the case", () => {
    expect(words("Th", "", 3)).toEqual(["The", "That", "This"]);
    expect(words("RES", "", 2)).toEqual(["RESULT", "RESULTS"]);
  });

  it("treats a capital at the start of a sentence as the ordinary word", () => {
    expect(words("th", "The model. The data.", 1)).toEqual(["the"]);
    expect(words("mo", "We use Monaco and Monaco.", 2)).toEqual(["Monaco", "money"]);
  });

  it("does not list a word twice and respects the limit", () => {
    expect(words("res", "result result", 10)).toEqual([
      "result",
      "results",
      "resilient",
    ]);
    expect(words("th", "", 2)).toHaveLength(2);
  });
});
