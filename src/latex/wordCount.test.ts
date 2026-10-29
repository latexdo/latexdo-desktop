import { describe, expect, it } from "vitest";
import { countLatexWords } from "./wordCount";

describe("source word counts", () => {
  it("counts nested headings inclusively without duplicating the total", () => {
    const result = countLatexWords(String.raw`\begin{abstract}Two words.\end{abstract}
\chapter{First}Intro text.
\section{Methods}Three more words.
\subsection{Data}Two words.
\section{Results}Done.
\chapter{Last}End.`);
    expect(result.total).toBe(16);
    expect(result.abstract).toBe(2);
    expect(result.sections.map((s) => [s.title, s.words])).toEqual([
      ["Abstract", 2],
      ["First", 12],
      ["Methods", 7],
      ["Data", 3],
      ["Results", 2],
      ["Last", 2],
    ]);
  });

  it("keeps formatted prose, captions, footnotes and table text", () => {
    const result =
      countLatexWords(String.raw`\abstract{A \textbf{nested \emph{bold} word}.}
\caption{Two words}\footnote{A note}
\begin{tabular}{ll}one & two \\ three & four\end{tabular}
\href{https://example.com}{Visible link} \hyperref[key]{Another link}`);
    expect(result.abstract).toBe(4);
    expect(result.total).toBe(16);
  });

  it("excludes metadata, math, code, bibliography and commented headings", () => {
    const result = countLatexWords(String.raw`\documentclass{article}
\title{Ignored title}\begin{document}
Visible % hidden words \section{Fake}
text \cite[p. 20]{key} \ref{another} \input{chapter}
$x+y$ $$display math$$ \(inline math\) \[display math\]
\begin{align}x &= y\end{align}
\begin{lstlisting}\section{Fake code}\end{lstlisting}
\verb|hidden code| \includegraphics[width=5cm]{image}
\begin{thebibliography}{9}\bibitem{key}Hidden entry\end{thebibliography}
\end{document}Ignored trailer`);
    expect(result.total).toBe(2);
    expect(result.sections).toEqual([]);
  });

  it("handles starred, optional and multiline headings with correct locations", () => {
    const result = countLatexWords(String.raw`before
  \section*[Short]{Long
title} Body.
\subsection{Child} Text.`);
    expect(result.sections[0]).toMatchObject({
      title: "Long title",
      line: 2,
      column: 3,
      words: 5,
    });
    expect(result.sections[1].words).toBe(2);
    expect(result.total).toBe(6);
  });

  it("counts Unicode, apostrophes and hyphenated words and preserves escaped percent", () => {
    expect(
      countLatexWords(
        String.raw`café caf\'{e} naïve user's state-of-the-art 42 50\% done`,
      ).total,
    ).toBe(8);
  });

  it("ignores macro definitions instead of counting their bodies", () => {
    expect(
      countLatexWords(String.raw`\newcommand{\foo}[1]{Hidden #1}
\def\bar#1{Other hidden text} Visible text`).total,
    ).toBe(2);
  });

  it("counts unfinished abstract prose while typing", () => {
    const result = countLatexWords(
      String.raw`\begin{abstract}Some \textbf{unfinished text`,
    );
    expect(result.abstract).toBe(3);
    expect(result.total).toBe(3);
    expect(countLatexWords("\\").total).toBe(0);
  });
});
