import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TableCanvas from "../TableCanvas";

const cell = (name: string) => screen.getByRole("textbox", { name: `Cell ${name}` });
const generated = () =>
  document.querySelector(".tikz-code-pre code")!.textContent ?? "";

describe("TableCanvas", () => {
  it("merges a dragged selection, formats it and undoes the change", () => {
    render(<TableCanvas />);
    fireEvent.change(cell("A1"), { target: { value: "Results" } });

    // Drag across the first row, then merge.
    fireEvent.mouseDown(cell("A1").closest("td")!, { button: 0 });
    fireEvent.mouseEnter(cell("C1").closest("td")!);
    fireEvent.mouseUp(window);
    expect(screen.getByText("A1:C1")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Merge/ }));

    expect(generated()).toContain("\\multicolumn{3}{|c|}{\\textbf{Results}}");
    expect(cell("A1").closest("td")).toHaveAttribute("colspan", "3");
    expect(screen.queryByRole("textbox", { name: "Cell B1" })).not.toBeInTheDocument();

    // ⌘B makes the second row's first cell bold.
    fireEvent.change(cell("A2"), { target: { value: "x" } });
    fireEvent.mouseDown(cell("A2").closest("td")!, { button: 0 });
    fireEvent.mouseUp(window);
    fireEvent.keyDown(cell("A2"), { key: "b", metaKey: true });
    expect(generated()).toContain("\\textbf{x}");

    // Undo steps back through bold, typing and the merge.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(generated()).not.toContain("\\textbf{x}");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(generated()).not.toContain("\\multicolumn");
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(generated()).toContain("\\multicolumn");
  });

  it("merges down rows and lists the packages the table needs", () => {
    render(<TableCanvas />);
    fireEvent.mouseDown(cell("A2").closest("td")!, { button: 0 });
    fireEvent.mouseDown(cell("A3").closest("td")!, { button: 0, shiftKey: true });
    fireEvent.mouseUp(window);
    fireEvent.click(screen.getByRole("button", { name: /Merge/ }));
    fireEvent.click(screen.getByLabelText("Striped rows"));

    expect(generated()).toContain("\\multirow{2}{*}{}");
    expect(generated()).toContain("\\cline{2-3}");
    const note = screen.getByText(/Add to your preamble/);
    expect(note).toHaveTextContent("\\usepackage{multirow}");
    expect(note).toHaveTextContent("\\usepackage[table]{xcolor}");
    // Sorting is blocked while merged cells sit below the header.
    expect(screen.getByRole("button", { name: "Sort A to Z" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Unmerge/ }));
    expect(screen.getByRole("button", { name: "Sort A to Z" })).toBeEnabled();
  });
});
