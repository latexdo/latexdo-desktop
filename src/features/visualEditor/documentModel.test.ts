import { describe, expect, it } from "vitest";
import {
  abstractSource,
  blockTemplates,
  figureWidth,
  headingSource,
  listSource,
  mathPreviewTex,
  mathSource,
  parseDocument,
  parseFigure,
  parseHeadingLine,
  parseTable,
  readTitleParts,
  serializeDocument,
  setFigureCaption,
  setFigureImage,
  setFigureWidth,
  setTableCaption,
  setTableRows,
  setTitlePart,
  splitMath,
} from "./documentModel";

const paper = String.raw`\documentclass{article}
\usepackage{graphicx}
\title{A Study}
\author{Ada}
\begin{document}
\maketitle

\begin{abstract}
We study things.

Second abstract paragraph.
\end{abstract}

\section{Introduction}\label{sec:intro}
This is the \textbf{first} paragraph
spread over two lines with \cite{knuth}.

% a comment
% another
\begin{itemize}
  \item First point
  \begin{enumerate}
    \item Nested
  \end{enumerate}
  \item Second point
\end{itemize}

\begin{equation}
  E = mc^2 \label{eq:e}
\end{equation}

\begin{figure}[ht]
  \centering
  \includegraphics[width=0.5\linewidth]{figures/plot}
  \caption{A plot}
  \label{fig:plot}
\end{figure}

\begin{table}[ht]
  \centering
  \begin{tabular}{l|c}
    \toprule
    A & B \\
    \midrule
    1 & 2 \\
    \bottomrule
  \end{tabular}
  \caption{Numbers}
\end{table}

\begin{tikzpicture}
  \draw (0,0) -- (1,1);
\end{tikzpicture}

\newpage
\bibliography{refs}
\end{document}
`;

describe("parseDocument", () => {
  it("round-trips a whole paper byte for byte", () => {
    const document = parseDocument(paper);
    expect(serializeDocument(document)).toBe(paper);
    expect(document.head.endsWith("\\begin{document}\n")).toBe(true);
    expect(document.tail).toBe("\\end{document}\n");
    expect(document.blocks.map((block) => block.data.kind)).toEqual([
      "title",
      "abstract",
      "heading",
      "paragraph",
      "comment",
      "list",
      "math",
      "figure",
      "table",
      "code",
      "command",
      "command",
    ]);
  });

  it("normalizes line endings and handles files without a document environment", () => {
    const document = parseDocument("\\section{A}\r\nText\r\n");
    expect(document.head).toBe("");
    expect(serializeDocument(document)).toBe("\\section{A}\nText\n");
    expect(serializeDocument(parseDocument(""))).toBe("");
  });

  it("keeps unclosed environments and stray ends as code", () => {
    for (const source of [
      "\\begin{itemize}\n  \\item x",
      "\\begin{equation}\nx",
      "\\[\nx",
      "\\end{center}",
    ]) {
      const document = parseDocument(source);
      expect(document.blocks[0].data.kind).toBe("code");
      expect(serializeDocument(document)).toBe(source);
    }
  });

  it("reads list structure and refuses lists it cannot edit safely", () => {
    const document = parseDocument(
      "\\begin{description}[style=nextline]\n  \\item[Term] Meaning\n  continued\n\\end{description}",
    );
    const list = document.blocks[0].data;
    expect(list).toMatchObject({
      kind: "list",
      list: {
        environment: "description",
        options: "[style=nextline]",
        items: [{ label: "Term", content: "Meaning\ncontinued", children: [] }],
      },
    });
    for (const source of [
      "\\begin{itemize}\ntext before items\n\\end{itemize}",
      "\\begin{itemize}\n  \\item a\n  \\begin{center}x\\end{center}\n\\end{itemize}",
      "\\begin{itemize} \\item inline \\end{itemize}",
      "\\begin{itemize}{weird}\n  \\item a\n\\end{itemize}",
    ]) {
      expect(parseDocument(source).blocks[0].data.kind).toBe("code");
    }
  });
});

describe("headings", () => {
  it("parses headings with nested braces and labels", () => {
    expect(
      parseHeadingLine("\\section*{The \\emph{Big} Idea}\\label{sec:big}"),
    ).toEqual({
      kind: "heading",
      command: "section",
      star: true,
      text: "The \\emph{Big} Idea",
      label: "sec:big",
    });
    expect(parseHeadingLine("\\section{A} extra")).toBeNull();
    expect(parseHeadingLine("\\section[short]{Long}")).toBeNull();
    expect(parseHeadingLine("\\textbf{x}")).toBeNull();
    expect(parseHeadingLine("\\section{A}\\ref{b}")).toBeNull();
    expect(
      headingSource({
        kind: "heading",
        command: "subsection",
        star: false,
        text: "T",
        label: "",
      }),
    ).toBe("\\subsection{T}");
  });
});

describe("lists and abstracts", () => {
  it("writes lists back with nesting and labels", () => {
    expect(
      listSource({
        environment: "itemize",
        options: "",
        indent: "",
        items: [
          {
            content: "One\nmore",
            children: [
              {
                environment: "enumerate",
                options: "",
                indent: "",
                items: [{ content: "", children: [] }],
              },
            ],
          },
          { content: "Two", label: "x", children: [] },
        ],
      }),
    ).toBe(
      [
        "\\begin{itemize}",
        "  \\item One",
        "  more",
        "  \\begin{enumerate}",
        "    \\item",
        "  \\end{enumerate}",
        "  \\item[x] Two",
        "\\end{itemize}",
      ].join("\n"),
    );
    expect(abstractSource(["A", "B"])).toBe(
      "\\begin{abstract}\nA\n\nB\n\\end{abstract}",
    );
  });
});

describe("math", () => {
  it("splits display math and prepares it for preview", () => {
    const parts = splitMath(
      "\\begin{align}\n  a &= b \\label{x} \\nonumber\n\\end{align}",
    )!;
    expect(parts.environment).toBe("align");
    expect(mathPreviewTex(parts)).toBe("\\begin{aligned}  a &= b  \\end{aligned}");
    expect(mathSource(parts, "c")).toBe("\\begin{align}\nc\n\\end{align}");
    expect(mathPreviewTex(splitMath("\\[\nx\n\\]")!)).toBe("x");
    expect(mathPreviewTex(splitMath("\\begin{gather*}\nx\n\\end{gather*}")!)).toContain(
      "gathered",
    );
    expect(splitMath("\\begin{equation} x \\end{equation}")).toBeNull();
    expect(splitMath("\\begin{equation}\nx\n\\end{align}")).toBeNull();
    expect(splitMath("x\ny")).toBeNull();
  });
});

describe("figures", () => {
  const figure = parseDocument(paper).blocks.find(
    (block) => block.data.kind === "figure",
  )!.source;

  it("reads the image, size, caption and label", () => {
    expect(parseFigure(figure)).toMatchObject({
      imagePath: "figures/plot",
      options: "width=0.5\\linewidth",
      caption: "A plot",
      label: "fig:plot",
    });
    expect(figureWidth("width=0.5\\linewidth")).toBe(0.5);
    expect(figureWidth("width=\\textwidth")).toBe(1);
    expect(figureWidth("scale=2")).toBeNull();
    expect(
      parseFigure(
        "\\begin{figure}\n\\includegraphics{a}\\includegraphics{b}\n\\end{figure}",
      ),
    ).toBeNull();
    expect(
      parseFigure(
        "\\begin{figure}\n\\begin{subfigure}\\includegraphics{a}\\end{subfigure}\n\\end{figure}",
      ),
    ).toBeNull();
  });

  it("edits only what changed", () => {
    const captioned = setFigureCaption(figure, "A \\emph{better} plot");
    expect(captioned).toBe(figure.replace("{A plot}", "{A \\emph{better} plot}"));
    const resized = setFigureWidth(figure, 0.8);
    expect(resized).toContain("\\includegraphics[width=0.8\\linewidth]{figures/plot}");
    expect(setFigureImage(figure, "figures/new.png")).toContain("{figures/new.png}");
    const bare = "\\begin{figure}\n  \\includegraphics{a.png}\n\\end{figure}";
    expect(setFigureWidth(bare, 0.5)).toContain(
      "\\includegraphics[width=0.5\\linewidth]{a.png}",
    );
    expect(setFigureCaption(bare, "New")).toBe(
      "\\begin{figure}\n  \\includegraphics{a.png}\n  \\caption{New}\n\\end{figure}",
    );
    expect(setFigureCaption(bare, "")).toBe(bare);
    expect(
      setFigureWidth(
        "\\begin{figure}\n\\includegraphics[scale=2, angle=90]{a}\n\\end{figure}",
        0.3,
      ),
    ).toContain("[width=0.3\\linewidth, angle=90]");
  });
});

describe("tables", () => {
  const table = parseDocument(paper).blocks.find(
    (block) => block.data.kind === "table",
  )!.source;

  it("reads rows, rules and the caption", () => {
    const parts = parseTable(table)!;
    expect(parts.columns).toBe(2);
    expect(parts.rows).toEqual([
      { cells: ["A", "B"], rulesBefore: ["\\toprule"] },
      { cells: ["1", "2"], rulesBefore: ["\\midrule"] },
    ]);
    expect(parts.trailingRules).toEqual(["\\bottomrule"]);
    expect(parts.caption).toBe("Numbers");
    expect(parseTable(blockTemplates.table)!.rows).toHaveLength(3);
  });

  it("refuses tables it cannot edit cell by cell", () => {
    for (const body of [
      "\\multicolumn{2}{c}{x} \\\\",
      "a & b & c \\\\",
      "a \\cline{1-2} \\\\",
    ]) {
      expect(parseTable(`\\begin{tabular}{ll}\n${body}\n\\end{tabular}`)).toBeNull();
    }
    expect(parseTable("\\begin{tabular}{*{3}{l}}\na\\\\\n\\end{tabular}")).toBeNull();
    expect(parseTable("no table")).toBeNull();
  });

  it("writes edited cells, new rows and new columns", () => {
    const parts = parseTable(table)!;
    const rows = parts.rows.map((row) => ({ ...row, cells: [...row.cells, "new"] }));
    rows.push({ cells: ["3", "4", "5"], rulesBefore: [] });
    const next = setTableRows(table, rows, parts.trailingRules, 3);
    expect(next).toContain("\\begin{tabular}{l|cl}");
    expect(next).toContain("    A & B & new \\\\");
    expect(next).toContain("    3 & 4 & 5 \\\\\n    \\bottomrule\n  \\end{tabular}");
    expect(parseTable(next)!.columns).toBe(3);
    const fewer = setTableRows(
      next,
      parseTable(next)!.rows.map((row) => ({ ...row, cells: row.cells.slice(0, 1) })),
      [],
      1,
    );
    expect(parseTable(fewer)!.columns).toBe(1);
    expect(setTableCaption(table, "Better")).toContain("\\caption{Better}");
    expect(
      setTableCaption("\\begin{tabular}{l}\na\n\\end{tabular}", "x"),
    ).not.toContain("caption");
  });
});

describe("title", () => {
  it("reads and edits title, author and date in the preamble", () => {
    const head = "\\documentclass{article}\n\\title{A}\n\\begin{document}\n";
    expect(readTitleParts(head)).toEqual({ title: "A", author: null, date: null });
    expect(setTitlePart(head, "title", "B")).toContain("\\title{B}");
    expect(setTitlePart(head, "author", "Ada")).toBe(
      "\\documentclass{article}\n\\title{A}\n\\author{Ada}\n\\begin{document}\n",
    );
  });
});
