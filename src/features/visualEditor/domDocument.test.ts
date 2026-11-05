import { describe, expect, it } from "vitest";
import { parseDocument, serializeDocument } from "./documentModel";
import {
  countWords,
  createIsland,
  emptyParagraph,
  headingCommandForTag,
  headingTag,
  htmlTableToLatex,
  islandHtml,
  looksLikeLatex,
  planPaste,
  renderBlock,
  renderBlocksInto,
  serializeRoot,
  transferBlockMeta,
} from "./domDocument";

const body = String.raw`\maketitle

\begin{abstract}
Short summary.
\end{abstract}

\section*{Intro}\label{sec:intro}
A \textbf{bold} claim \cite{knuth}.

\begin{description}
  \item[Term] Meaning
  \begin{itemize}
    \item nested
  \end{itemize}
\end{description}

\begin{equation}
x
\end{equation}

\newpage
% note
`;

function setup(source = body) {
  const document_ = parseDocument(source);
  const root = document.createElement("div");
  renderBlocksInto(root, document_.blocks, {});
  const read = () =>
    document_.head + serializeRoot(root) + document_.trailing + document_.tail;
  return { root, read, document: document_ };
}

describe("rendering and reading the page", () => {
  it("writes an untouched page back byte for byte", () => {
    const { root, read } = setup();
    expect(read()).toBe(body);
    expect(root.querySelector("h2")!.textContent).toBe("Intro");
    expect(root.querySelector("h2")!.dataset.unnumbered).toBe("true");
    expect(root.querySelector(".vl-abstract p")!.textContent).toBe("Short summary.");
    expect(root.querySelector("li")!.dataset.term).toBe("Term");
    expect(
      Array.from(root.querySelectorAll(".vl-island")).map(
        (island) => (island as HTMLElement).dataset.kind,
      ),
    ).toEqual(["title", "math", "command", "comment"]);
    expect(
      (root.querySelector('[data-kind="command"]') as HTMLElement).dataset.command,
    ).toBe("pagebreak");
  });

  it("regenerates only the blocks that changed", () => {
    const { root, read } = setup();
    root.querySelector("h2")!.textContent = "Introduction";
    root.querySelector(":scope > p")!.append(" More.");
    const li = root.querySelector("li")!;
    li.firstChild!.textContent = "Better";
    root.querySelector(".vl-abstract p")!.textContent = "New summary.";
    expect(read()).toBe(
      body
        .replace("\\section*{Intro}", "\\section*{Introduction}")
        .replace("\\cite{knuth}.", "\\cite{knuth}. More.")
        .replace("\\item[Term] Meaning", "\\item[Term] Better")
        .replace("Short summary.", "New summary."),
    );
  });

  it("gives new blocks a blank line and drops empty ones", () => {
    const { root, read } = setup("Only.\n");
    const extra = document.createElement("p");
    extra.textContent = "Added 50%";
    root.append(
      extra,
      emptyParagraph(),
      document.createTextNode("loose text"),
      document.createElement("br"),
    );
    expect(read()).toBe("Only.\n\nAdded 50\\%\n\nloose text\n");
  });

  it("reads containers, lists and headings the browser creates", () => {
    const root = document.createElement("div");
    root.innerHTML =
      "<div><p>one</p><h3>Two</h3></div><ol><li>a<ul><li>b</li></ul></li></ol><ul><ul><li>x</li></ul></ul><ul></ul>" +
      "<h6>deep</h6><h2></h2><section class='vl-abstract'></section><blockquote>quoted</blockquote>";
    root.append(createIsland("code", "\\foo"), createIsland("code", "  "));
    expect(serializeRoot(root)).toBe(
      [
        "",
        "one",
        "\\subsection{Two}",
        "\\begin{enumerate}\n  \\item a\n  \\begin{itemize}\n    \\item b\n  \\end{itemize}\n\\end{enumerate}",
        "\\begin{itemize}\n  \\item\n  \\begin{itemize}\n    \\item x\n  \\end{itemize}\n\\end{itemize}",
        "\\begin{itemize}\n  \\item\n\\end{itemize}",
        "\\paragraph{deep}",
        "\\begin{abstract}\n\n\\end{abstract}",
        "quoted",
        "\\foo",
      ].join("\n\n"),
    );
  });

  it("keeps a heading's label and number style through a style change", () => {
    const { root, read } = setup("\\section*{Intro}\\label{sec:a}\n");
    const heading = root.querySelector("h2")!;
    const replacement = document.createElement("h3");
    replacement.textContent = "Intro";
    transferBlockMeta(heading, replacement);
    transferBlockMeta(document.createElement("p"), replacement);
    heading.replaceWith(replacement);
    expect(read()).toBe("\\subsection*{Intro}\\label{sec:a}\n");
    const plain = document.createElement("h1");
    plain.textContent = "Chap";
    root.replaceChildren(plain);
    expect(serializeRoot(root)).toBe("\n\n\\chapter{Chap}");
  });

  it("maps heading tags and commands both ways", () => {
    expect(headingTag("subsubsection")).toBe("H4");
    expect(headingCommandForTag("h2")).toBe("section");
    expect(headingCommandForTag("P")).toBeNull();
    const chapter = parseDocument("\\chapter{One}").blocks[0];
    expect(renderBlock(chapter, {}).tagName).toBe("H1");
  });

  it("shows an empty document as one empty paragraph", () => {
    const root = document.createElement("div");
    renderBlocksInto(root, [], {});
    expect(root.innerHTML).toBe("<p><br></p>");
    expect(serializeRoot(root)).toBe("");
  });

  it("counts words outside objects", () => {
    const { root } = setup();
    // Abstract 2, heading 1, paragraph 4, list 2.
    expect(countWords(root)).toBe(9);
  });

  it("builds islands as DOM or HTML", () => {
    const island = createIsland("figure", 'a "b" <c>');
    expect(island.contentEditable).toBe("false");
    const holder = document.createElement("div");
    holder.innerHTML = islandHtml("figure", 'a "b" <c>');
    expect((holder.firstChild as HTMLElement).dataset.source).toBe('a "b" <c>');
  });
});

describe("paste", () => {
  it("keeps formatting from a single pasted paragraph inline", () => {
    expect(
      planPaste(
        '<meta charset="utf-8"><span style="font-weight:700">Bold</span> <a href="javascript:x">bad</a> <a href="https://x.org">ok</a><o:p>w</o:p><script>x</script>',
        "",
        {},
      ),
    ).toEqual({
      html: '<b>Bold</b> bad <a href="https://x.org">ok</a>w',
      inline: true,
    });
  });

  it("turns Word or web HTML into paragraphs, headings, lists and tables", () => {
    const plan = planPaste(
      "<h1>Title</h1><p>One <i>it</i> <u>u</u> <span style='font-style:italic'>s</span></p><ul><li>a<ol><li>b</li></ol></li></ul><table><tr><td>A</td><td><b>B</b></td></tr><tr><td>1</td></tr></table><div><p>nested</p></div><p></p>",
      "",
      {},
    );
    expect(plan.inline).toBe(false);
    expect(plan.html).toContain("<h2>Title</h2>");
    expect(plan.html).toContain("<p>One <i>it</i> <u>u</u> <i>s</i></p>");
    expect(plan.html).toContain("<ul><li>a<ol><li>b</li></ol></li></ul>");
    expect(plan.html).toContain('data-kind="table"');
    expect(plan.html).toContain("<p>nested</p>");
  });

  it("keeps chips and objects copied from this editor", () => {
    const plan = planPaste(
      '<p>See <span class="vl-token vl-token-citation" data-latex="\\cite{k}" title="t">[k]</span></p><div class="vl-island" data-kind="math" data-source="\\[x\\]"></div>',
      "",
      {},
    );
    expect(plan.html).toContain('data-latex="\\cite{k}"');
    expect(plan.html).toContain('data-source="\\[x\\]"');
  });

  it("renders pasted LaTeX instead of escaping it", () => {
    expect(planPaste("", "Some $x$ and \\emph{y}", {})).toMatchObject({ inline: true });
    expect(planPaste("", "Some $x$ and \\emph{y}", {}).html).toContain(
      'data-cmd="emph"',
    );
    const blocks = planPaste("", "\\section{A}\n\nText \\cite{k}", {});
    expect(blocks.inline).toBe(false);
    expect(blocks.html).toContain("<h2>A</h2>");
  });

  it("splits plain text into paragraphs", () => {
    expect(planPaste("", "one line", {})).toEqual({ html: "one line", inline: true });
    expect(planPaste("", "a & b\r\n\r\nc", {})).toEqual({
      html: "<p>a &amp; b</p><p>c</p>",
      inline: false,
    });
    expect(planPaste("", "", {})).toEqual({ html: "", inline: true });
    expect(planPaste("<p></p>", "fallback", {})).toEqual({
      html: "fallback",
      inline: true,
    });
  });

  it("recognises LaTeX source", () => {
    expect(looksLikeLatex("\\section{x}")).toBe(true);
    expect(looksLikeLatex("cost $5 and $6 later")).toBe(true);
    expect(looksLikeLatex("plain words")).toBe(false);
  });

  it("converts an HTML table", () => {
    const holder = document.createElement("div");
    holder.innerHTML = "<table><tr><td>a  b</td><td>c</td></tr></table>";
    expect(htmlTableToLatex(holder.querySelector("table")!)).toContain(
      "    a b & c \\\\\n    \\hline",
    );
    holder.innerHTML = "<table></table>";
    expect(htmlTableToLatex(holder.querySelector("table")!)).toContain(
      "\\begin{tabular}{l}",
    );
  });
});

describe("document round trip helpers", () => {
  it("serializes a parsed document unchanged", () => {
    expect(serializeDocument(parseDocument(body))).toBe(body);
  });
});
