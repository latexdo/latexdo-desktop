import { describe, expect, it } from "vitest";
import {
  contextAt,
  findSourceWord,
  normalizeWord,
  sourceContextAt,
  sourceTokens,
  textWords,
  wordSimilarity,
} from "./wordMatch";

const words = (source: string) => sourceTokens(source).map((token) => token.norm);

describe("sourceTokens", () => {
  it("reads LaTeX the way the PDF shows it", () => {
    expect(
      words(
        String.raw`\section{Results} See \textbf{bold} text % hidden note
\label{sec:results}as shown in \cite[p.~3]{knuth84} and Figure~\ref{fig:a}.
\begin{figure}[ht]\includegraphics[width=3cm]{plots/a.pdf}\end{figure}`,
      ),
    ).toEqual(["results", "see", "bold", "text", "as", "shown", "in", "and", "figure"]);
  });

  it("joins accent commands into their word", () => {
    const tokens = sourceTokens(
      String.raw`Un caf\'e na\"{\i}ve et {\'e}t\'e, \v{C}apek.`,
    );
    expect(tokens.map((token) => token.norm)).toEqual([
      "un",
      "cafe",
      "naive",
      "et",
      "ete",
      "capek",
    ]);
    // The whole written form is selected, accent commands included.
    expect(tokens[1]).toMatchObject({ text: String.raw`caf\'e`, column: 4, length: 6 });
  });

  it("skips the arguments of definitions across lines", () => {
    expect(
      words(String.raw`\newcommand{\R}{\mathbb{R}}
\usepackage[utf8]{inputenc}
Real words here.`),
    ).toEqual(["real", "words", "here"]);
  });

  it("keeps escaped percent signs and stops at comments", () => {
    expect(words(String.raw`Up 50\% today % not this`)).toEqual(["up", "50", "today"]);
  });
});

describe("normalizeWord", () => {
  it("folds ligatures, accents and case", () => {
    expect(normalizeWord("ﬁddle")).toBe("fiddle");
    expect(normalizeWord("Éléphant")).toBe("elephant");
    expect(normalizeWord("ﬃce")).toBe("ffice");
  });
});

describe("wordSimilarity", () => {
  it("matches words exactly, and halves of hyphenated words", () => {
    expect(wordSimilarity("vexingly", "vexingly")).toBe(2);
    expect(wordSimilarity("vexingly", "vex")).toBe(1);
    expect(wordSimilarity("vexingly", "ingly")).toBe(1);
    expect(wordSimilarity("the", "other")).toBe(0);
    expect(wordSimilarity("other", "the")).toBe(0);
    expect(wordSimilarity("an", "and")).toBe(0);
  });
});

describe("findSourceWord (PDF → source)", () => {
  const source = [
    String.raw`\section{Introduction}`, // 1
    "The cat sat on the mat while the dog", // 2
    "watched the bird on the fence near the", // 3
    "old barn. The end of the story.", // 4
  ].join("\n");

  it("lands on the exact repeated word using its neighbours", () => {
    // The PDF reader clicked the "the" in "near the old barn" (line 3 → 4).
    expect(
      findSourceWord(source, 3, {
        word: "the",
        before: ["bird", "on", "the", "fence", "near"].slice(-4),
        after: ["old", "barn", "the", "end"],
      }),
    ).toEqual({ line: 3, column: 36, length: 3 });
    // ...and the "the" in "the dog".
    expect(
      findSourceWord(source, 2, {
        word: "the",
        before: ["on", "the", "mat", "while"],
        after: ["dog", "watched", "the", "bird"],
      }),
    ).toEqual({ line: 2, column: 30, length: 3 });
  });

  it("corrects SyncTeX lines that are off inside a paragraph", () => {
    // SyncTeX named line 2 but the clicked word is on line 4.
    expect(
      findSourceWord(source, 2, {
        word: "story",
        before: ["the", "end", "of", "the"],
        after: [],
      }),
    ).toEqual({ line: 4, column: 26, length: 5 });
  });

  it("finds words written with markup or accents", () => {
    const text = String.raw`We use \emph{caf\'e} and \textbf{ﬁsh}.`;
    expect(
      findSourceWord(text, 1, { word: "café", before: ["we", "use"], after: ["and"] }),
    ).toEqual({
      line: 1,
      column: 14,
      length: 6,
    });
    expect(
      findSourceWord(text, 1, { word: "fish", before: ["and"], after: [] }),
    ).toMatchObject({
      line: 1,
      column: 34,
    });
  });

  it("finds a word hyphenated across PDF lines", () => {
    expect(
      findSourceWord("How vexingly quick daft zebras jump.", 1, {
        word: "vex",
        before: ["how"],
        after: ["ingly", "quick", "daft"],
      }),
    ).toEqual({ line: 1, column: 5, length: 8 });
  });

  it("returns null when the word is not in this file", () => {
    expect(
      findSourceWord(source, 2, { word: "zebra", before: [], after: [] }),
    ).toBeNull();
  });
});

describe("sourceContextAt (source → PDF)", () => {
  it("gives the word under the cursor with its visible neighbours", () => {
    const text = String.raw`See \cite{x} the quick \textbf{brown} fox jumps.`;
    expect(sourceContextAt(text, 1, 33)).toEqual({
      word: "brown",
      before: ["see", "the", "quick"],
      after: ["fox", "jumps"],
    });
  });

  it("gives nothing on a command or blank space", () => {
    expect(sourceContextAt(String.raw`\section{Intro}`, 1, 3)).toBeNull();
    expect(sourceContextAt("a      b", 1, 5)).toBeNull();
  });

  it("matches PDF word contexts built the same way", () => {
    const pdf = textWords("the quick brown fox");
    const tokens = pdf.map((item) => ({
      word: item.word,
      norm: normalizeWord(item.word),
    }));
    expect(contextAt(tokens, 2)).toEqual({
      word: "brown",
      before: ["the", "quick"],
      after: ["fox"],
    });
  });
});
