import { describe, expect, it } from "vitest";
import {
  escapeLatexText,
  latexInlineToHtml,
  plainText,
  serializeInlineChildren,
} from "./inlineLatex";

function roundTrip(latex: string): string {
  const element = document.createElement("p");
  element.innerHTML = latexInlineToHtml(latex);
  return serializeInlineChildren(element);
}

function rendered(latex: string): HTMLElement {
  const element = document.createElement("p");
  element.innerHTML = latexInlineToHtml(latex, {
    renderMath: (tex) => (tex === "bad" ? null : `data:image/svg+xml,${tex}`),
  });
  return element;
}

describe("inline LaTeX", () => {
  it.each([
    "Plain text over\ntwo lines.",
    "\\textbf{bold \\textit{and italic}} and \\emph{emphasis} \\underline{u}",
    "\\texttt{code} x\\textsuperscript{2} H\\textsubscript{2}O \\textsc{Caps}",
    "See \\cite[p.~3]{knuth,lamport} and \\ref{sec:a}, \\eqref{eq} \\label{x}.",
    "\\href{https://example.org}{the \\textbf{site}} \\url{https://a.b}",
    "Math $a^2 + b^2$, $$c$$, \\(d\\), \\[e\\] and a cost of \\$5.",
    "50\\% of A\\&B \\#1 a\\_b \\{x\\} \\textbackslash{} \\textbackslash",
    "Non~breaking, line\\\\break, \\\\[2pt] spaced\\, thin\\ space.",
    "Footnote\\footnote{More \\emph{text}.} and \\LaTeX{} \\today \\ldots",
    "Unknown \\SI{5}{\\metre} \\foo \\bar[opt]{x}{y} {\\bf grouped}",
    "text % a comment\nnext line",
    "Unclosed \\textbf{bold",
    "Lone $ dollar and {unclosed group",
  ])("round-trips %s", (latex) => {
    expect(roundTrip(latex)).toBe(latex);
  });

  it("shows formatting as editable elements", () => {
    const element = rendered("\\textbf{bold} \\emph{em} \\href{https://x.org}{site}");
    expect(element.querySelector("strong")!.textContent).toBe("bold");
    expect(element.querySelector("strong")!.getAttribute("contenteditable")).toBeNull();
    expect(element.querySelector("em")!.dataset.cmd).toBe("emph");
    expect(element.querySelector("a")!.getAttribute("href")).toBe("https://x.org");
  });

  it("shows other LaTeX as atomic tokens with readable labels", () => {
    const element = rendered(
      "\\cite{a, b} \\cite{} \\ref{s} \\ref{} \\label{} \\footnote{Hi} \\LaTeX \\url{} \\foo $x$ $bad$ \\,",
    );
    const labels = Array.from(element.querySelectorAll(".vl-token")).map(
      (token) => token.textContent,
    );
    expect(labels).toEqual([
      "[a, b]",
      "[citation]",
      "#s",
      "reference",
      "label",
      "note",
      "LaTeX",
      "link",
      "\\foo",
      "",
      "bad",
      "\\,",
    ]);
    expect(element.querySelector(".vl-token-math img")!.getAttribute("src")).toBe(
      "data:image/svg+xml,x",
    );
    expect(element.querySelector(".vl-token-footnote")!.getAttribute("title")).toBe(
      "Hi",
    );
    expect(
      Array.from(element.querySelectorAll(".vl-token")).every(
        (token) => token.getAttribute("contenteditable") === "false",
      ),
    ).toBe(true);
  });

  it("escapes what the writer types", () => {
    expect(escapeLatexText("50% & #1 a_b {x} $ ~ ^ \\")).toBe(
      "50\\% \\& \\#1 a\\_b \\{x\\} \\$ \\textasciitilde{} \\textasciicircum{} \\textbackslash{}",
    );
    expect(
      escapeLatexText(`a${String.fromCharCode(0xa0)}b${String.fromCharCode(0x200b)}`),
    ).toBe("a b");
    expect(plainText("\\textbf{A}  \\emph{B}")).toBe("A B");
  });

  it("serializes what browsers produce while editing", () => {
    const element = document.createElement("p");
    element.innerHTML =
      "a <b>bold</b> <i>it</i> <u>u</u> <sup>2</sup> <sub>i</sub> <tt>t</tt> <kbd>k</kbd> <code>c</code>" +
      ' <span style="font-weight: 700">heavy</span> <span style="font-style: italic; text-decoration: underline">both</span>' +
      ' <span style="vertical-align: super">up</span> <span style="vertical-align: sub">down</span>' +
      ' <a href="https://x.org">link</a> <a>nohref</a> <b></b> <img src="x"> <font>f</font>' +
      ' <span data-cmd="textbf">cmd</span>line<br>next<br>';
    expect(serializeInlineChildren(element)).toBe(
      "a \\textbf{bold} \\textit{it} \\underline{u} \\textsuperscript{2} \\textsubscript{i} \\texttt{t} \\texttt{k} \\texttt{c}" +
        " \\textbf{heavy} \\textit{\\underline{both}}" +
        " \\textsuperscript{up} \\textsubscript{down}" +
        " \\href{https://x.org}{link} nohref   f" +
        " \\textbf{cmd}line\\\\\nnext",
    );
    const nested = document.createElement("p");
    nested.innerHTML = "first<div>second</div>";
    expect(serializeInlineChildren(nested)).toBe("first\nsecond");
    expect(
      serializeInlineChildren(document.createComment("x") as unknown as Node),
    ).toBe("");
  });
});
