import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  parseLatexToVisualBlocks,
  serializeVisualLatexBlocks,
  VisualLatexEditor,
} from "./VisualLatexEditor";

describe("VisualLatexEditor", () => {
  it("round-trips common LaTeX blocks without losing labels or list structure", () => {
    const source = [
      "\\documentclass{article}",
      "\\begin{document}",
      "",
      "\\section{Introduction}\\label{sec:intro}",
      "This is the first paragraph.",
      "",
      "\\begin{itemize}",
      "  \\item First point",
      "  \\item Second point",
      "\\end{itemize}",
      "",
      "\\end{document}",
      "",
    ].join("\n");

    expect(serializeVisualLatexBlocks(parseLatexToVisualBlocks(source))).toBe(source);
  });

  it("writes heading edits back to LaTeX source", () => {
    const onChange = vi.fn();
    render(
      <VisualLatexEditor
        content={"\\subsection{Old Title}\\label{sec:old}\nBody"}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("subsection title"), {
      target: { value: "Related Work" },
    });

    expect(onChange).toHaveBeenLastCalledWith(
      "\\subsection{Related Work}\\label{sec:old}\nBody",
    );
  });

  it("writes list item edits back to itemize blocks", () => {
    const onChange = vi.fn();
    render(
      <VisualLatexEditor
        content={"\\begin{itemize}\n  \\item First\n\\end{itemize}"}
        onChange={onChange}
      />,
    );

    const item = screen.getByLabelText("List item");
    item.textContent = "Updated point";
    fireEvent.input(item);

    expect(onChange).toHaveBeenLastCalledWith(
      "\\begin{itemize}\n  \\item Updated point\n\\end{itemize}",
    );
  });

  it("hides source-only LaTeX wrappers from the visual writing surface", () => {
    render(
      <VisualLatexEditor
        content={[
          "\\documentclass{article}",
          "\\usepackage{graphicx}",
          "\\begin{document}",
          "\\section{Intro}",
          "People can write here.",
          "\\end{document}",
        ].join("\n")}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByText(/\\documentclass/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\\begin\{document\}/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("section title")).toHaveValue("Intro");
    expect(screen.getByText("People can write here.")).toBeVisible();
  });

  it("renders common inline LaTeX as readable visual tokens", () => {
    render(
      <VisualLatexEditor
        content={"Use {\\LaTeX} with \\cite{smith2026} and $E=mc^2$."}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("LaTeX")).toBeVisible();
    expect(screen.getByText("[smith2026]")).toBeVisible();
    expect(screen.getByText("E=mc^2")).toBeVisible();
    expect(screen.queryByText(/\\cite/)).not.toBeInTheDocument();
  });

  it("writes normal visual paragraph edits back as plain LaTeX text", () => {
    const onChange = vi.fn();
    render(<VisualLatexEditor content={"Original paragraph."} onChange={onChange} />);

    const paragraph = screen.getByLabelText("Paragraph");
    paragraph.textContent = "AT&T uses 100% renewable energy.";
    fireEvent.input(paragraph);

    expect(onChange).toHaveBeenLastCalledWith("AT\\&T uses 100\\% renewable energy.");
  });
});

describe("visual source preservation",()=>{
 it.each(["equation","equation*","align","align*","gather","gather*"])("round-trips and edits %s math",environment=>{
  const onChange=vi.fn();const source=`\\begin{${environment}}\nx^2\n\\end{${environment}}`;
  expect(serializeVisualLatexBlocks(parseLatexToVisualBlocks(source))).toBe(source);render(<VisualLatexEditor content={source} onChange={onChange}/>);fireEvent.change(screen.getByLabelText("Equation"),{target:{value:"y^2\nz^2"}});expect(onChange).toHaveBeenLastCalledWith(`\\begin{${environment}}\ny^2\nz^2\n\\end{${environment}}`);
 });
 it.each(["\\begin{itemize}\n  \\item Unclosed","\\begin{equation}\nx^2","\\[\nx^2"])("preserves incomplete environments as raw source: %s",source=>{
  const blocks=parseLatexToVisualBlocks(source);expect(blocks[0].type).toBe("raw");expect(serializeVisualLatexBlocks(blocks)).toBe(source);render(<VisualLatexEditor content={source} onChange={vi.fn()}/>);expect(screen.getByLabelText("Advanced LaTeX preserved in source")).toBeVisible();
 });
 it("normalizes line endings, empty input, multiline lists and display math",()=>{
  expect(parseLatexToVisualBlocks("")).toEqual([{type:"paragraph",text:""}]);const source="\\paragraph*{Note}\r\n\\[\r\nx+y\r\n\\]\r\n\\begin{enumerate}\r\n  \\item First\r\n  continued\r\n  \\item Second\r\n\\end{enumerate}";expect(serializeVisualLatexBlocks(parseLatexToVisualBlocks(source))).toBe(source.replaceAll("\r\n","\n"));expect(parseLatexToVisualBlocks("\\begin{itemize}\n\\end{itemize}")).toEqual([{type:"list",environment:"itemize",items:[""]}]);
 });
 it("preserves inline tokens when serializing DOM edits",()=>{
  const onChange=vi.fn();const source="\\LaTeX \\LaTeX{} \\ref{sec:a} \\eqref{} \\label{x} \\label{} \\href{https://example.org}{Website} \\url{https://example.org} \\cite{} \\textbf{bold} \\textit{italic} \\emph{emphasis} \\texttt{code} \\textsuperscript{up} \\textsubscript{down} \\%";
  render(<VisualLatexEditor content={source} onChange={onChange}/>);const paragraph=screen.getByLabelText("Paragraph");fireEvent.input(paragraph);expect(onChange).toHaveBeenLastCalledWith(source);expect(screen.getByText("Website")).toBeVisible();expect(screen.getByText("bold").tagName).toBe("STRONG");
 });
 it("serializes multiline pasted DOM, escaping literal special characters",()=>{
  const onChange=vi.fn();render(<VisualLatexEditor content="text" onChange={onChange}/>);const paragraph=screen.getByLabelText("Paragraph");paragraph.innerHTML="a<br><div>b</div><p></p><span>c</span><!-- ignored -->";paragraph.append(document.createTextNode("\\%&#_$"));fireEvent.input(paragraph);expect(onChange).toHaveBeenLastCalledWith("a\n\nb\nc\\textbackslash{}\\%\\&\\#\\_\\$");
 });
 it("updates external source and pastes only plain text at the selection",()=>{
  const onChange=vi.fn();const h=render(<VisualLatexEditor content="before" onChange={onChange}/>);h.rerender(<VisualLatexEditor content="after" onChange={onChange}/>);const paragraph=screen.getByLabelText("Paragraph");expect(paragraph.textContent).toBe("after");const range=document.createRange();range.selectNodeContents(paragraph);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);fireEvent.paste(paragraph,{clipboardData:{getData:()=>"<b>literal</b>"}});expect(paragraph.textContent).toBe("<b>literal</b>");expect(paragraph.querySelector("b")).toBeNull();selection.removeAllRanges();fireEvent.paste(paragraph,{clipboardData:{getData:()=>"ignored"}});expect(paragraph.textContent).toBe("<b>literal</b>");
 });
 it("renders ordered lists and read-only fields",()=>{
  render(<VisualLatexEditor content={"\\section{Title}\n\\begin{enumerate}\n  \\item One\n  \\item Two\n\\end{enumerate}"} readOnly onChange={vi.fn()}/>);expect(screen.getByLabelText("section title")).toHaveAttribute("readonly");expect(screen.getAllByLabelText("List item")[0]).toHaveAttribute("contenteditable","false");expect(document.querySelector("ol")).not.toBeNull();
 });
});
