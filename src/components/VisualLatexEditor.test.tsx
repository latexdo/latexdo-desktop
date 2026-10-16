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
