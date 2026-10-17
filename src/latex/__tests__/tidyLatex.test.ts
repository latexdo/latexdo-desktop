import { describe, expect, it } from "vitest";
import { tidyLatex } from "../tidyLatex";

const tidy = (lines: string[]) => {
  const once = tidyLatex(lines.join("\n"));
  // Tidying tidy output changes nothing.
  if (once !== null) expect(tidyLatex(once)).toBeNull();
  return once?.split("\n") ?? null;
};

describe("tidyLatex", () => {
  it("lays out a messy paper: headings, lists, figures and blank lines", () => {
    expect(
      tidy([
        "\\documentclass{article}",
        "\\begin{document}",
        "\\maketitle",
        "\\section{Introduction}",
        "\\label{sec:intro}",
        "We study things.   ",
        "",
        "",
        "",
        "Second paragraph.",
        "\\begin{itemize}",
        "",
        "\\item First point",
        "that continues here.",
        "",
        "\\item Second point",
        "\\begin{enumerate}",
        "\\item Nested",
        "\\end{enumerate}",
        "",
        "\\end{itemize}",
        "% Method section",
        "\\section{Method}",
        "\\begin{figure}[t]",
        "\\centering",
        "\\includegraphics{plot}",
        "\\caption{A plot.}",
        "\\end{figure}",
        "\\end{document}",
      ]),
    ).toEqual([
      "\\documentclass{article}",
      "\\begin{document}",
      "\\maketitle",
      "",
      "\\section{Introduction}",
      "\\label{sec:intro}",
      "",
      "We study things.",
      "",
      "Second paragraph.",
      "\\begin{itemize}",
      "    \\item First point",
      "        that continues here.",
      "    \\item Second point",
      "        \\begin{enumerate}",
      "            \\item Nested",
      "        \\end{enumerate}",
      "\\end{itemize}",
      "",
      "% Method section",
      "\\section{Method}",
      "",
      "\\begin{figure}[t]",
      "    \\centering",
      "    \\includegraphics{plot}",
      "    \\caption{A plot.}",
      "\\end{figure}",
      "\\end{document}",
    ]);
  });

  it("moves math, tables and pictures as a block without flattening alignment", () => {
    expect(
      tidy([
        "\\begin{figure}",
        "\\begin{align}",
        "  a &= b \\\\",
        "    &= c",
        "\\end{align}",
        "\\begin{tikzpicture}",
        "\\draw (0,0)",
        "    -- (1,1);",
        "\\end{tikzpicture}",
        "\\end{figure}",
      ]),
    ).toEqual([
      "\\begin{figure}",
      "    \\begin{align}",
      "        a &= b \\\\",
      "          &= c",
      "    \\end{align}",
      "    \\begin{tikzpicture}",
      "        \\draw (0,0)",
      "            -- (1,1);",
      "    \\end{tikzpicture}",
      "\\end{figure}",
    ]);
  });

  it("never touches verbatim-like environments", () => {
    const code = [
      "\\begin{itemize}",
      "    \\item Code:",
      "        \\begin{lstlisting}",
      "def f():   ",
      "",
      "",
      "      return 1",
      "        \\end{lstlisting}",
      "\\end{itemize}",
    ];
    expect(tidyLatex(code.join("\n"))).toBeNull();
  });

  it("ignores environment names inside comments and keeps \\itemsep apart from \\item", () => {
    expect(
      tidy([
        "\\begin{itemize}",
        "\\itemsep 0pt % \\begin{itemize}",
        "\\item One",
        "\\end{itemize}",
        "After.",
      ]),
    ).toEqual([
      "\\begin{itemize}",
      "    \\itemsep 0pt % \\begin{itemize}",
      "    \\item One",
      "\\end{itemize}",
      "After.",
    ]);
  });

  it("keeps the final newline and Windows line endings, and is idempotent", () => {
    const source = "\\section{A}\r\ntext\r\n";
    const once = tidyLatex(source)!;
    expect(once).toBe("\\section{A}\r\n\r\ntext\r\n");
    expect(tidyLatex(once)).toBeNull();
  });

  it("returns null for an already tidy source", () => {
    expect(tidyLatex("\\section{A}\n\nText.\n")).toBeNull();
  });
});
