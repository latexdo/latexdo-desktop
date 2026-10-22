import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TableCanvas from "../TableCanvas";
const cell = (name: string) =>
  screen.getByRole("textbox", { name: `Cell ${name}` }) as HTMLInputElement;
const code = () => document.querySelector(".tikz-code-pre code")!.textContent;
const select = (from: string, to = from) => {
  fireEvent.mouseDown(cell(from).closest("td")!, { button: 0 });
  fireEvent.mouseEnter(cell(to).closest("td")!);
  fireEvent.mouseUp(window);
};
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe("table spreadsheet interactions", () => {
  it("pastes TSV and CSV blocks and sorts data with the header intact", () => {
    render(<TableCanvas />);
    fireEvent.paste(cell("A1"), {
      clipboardData: { getData: () => "Name\tScore\nzebra\t2\nalpha\t1" },
    });
    expect(cell("B3")).toHaveValue("1");
    select("A2");
    fireEvent.click(screen.getByRole("button", { name: "Sort A to Z" }));
    expect(cell("A2")).toHaveValue("alpha");
    expect(cell("A1")).toHaveValue("Name");
    fireEvent.click(screen.getByRole("button", { name: "Sort Z to A" }));
    expect(cell("A2")).toHaveValue("zebra");
    fireEvent.paste(cell("A2"), { clipboardData: { getData: () => "a,b\r\nc,d\r\n" } });
    expect(cell("B3")).toHaveValue("d");
    fireEvent.paste(cell("A1"), { clipboardData: { getData: () => "plain text" } });
    expect(cell("A1")).toHaveValue("Name");
  });
  it("copies and cuts a rectangular selection, then undoes and redoes", () => {
    render(<TableCanvas />);
    fireEvent.paste(cell("A1"), { clipboardData: { getData: () => "a\tb\nc\td" } });
    select("A1", "B2");
    fireEvent.keyDown(cell("A1"), { key: "c", ctrlKey: true });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("a\tb\nc\td");
    fireEvent.keyDown(cell("A1"), { key: "x", ctrlKey: true });
    expect(cell("B2")).toHaveValue("");
    fireEvent.keyDown(cell("A1"), { key: "z", ctrlKey: true });
    expect(cell("B2")).toHaveValue("d");
    fireEvent.keyDown(cell("A1"), { key: "z", ctrlKey: true, shiftKey: true });
    expect(cell("B2")).toHaveValue("");
    fireEvent.keyDown(cell("A1"), { key: "z", ctrlKey: true });
    fireEvent.keyDown(cell("A1"), { key: "y", ctrlKey: true });
    expect(cell("B2")).toHaveValue("");
  });
  it("grows the keyboard selection and clears cells with Delete", () => {
    render(<TableCanvas />);
    fireEvent.change(cell("A1"), { target: { value: "a" } });
    select("A1");
    for (const key of ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "ArrowRight"])
      fireEvent.keyDown(cell("A1"), { key, shiftKey: true });
    expect(screen.getByText("A1:B1")).toBeVisible();
    fireEvent.keyDown(cell("A1"), { key: "Delete" });
    expect(cell("A1")).toHaveValue("");
    fireEvent.keyDown(cell("A1"), { key: "Escape" });
    expect(screen.queryByText("A1:B1")).not.toBeInTheDocument();
  });
  it("moves between cells and adds rows with Enter and Tab", () => {
    render(<TableCanvas />);
    select("A1");
    fireEvent.keyDown(cell("A1"), { key: "ArrowDown" });
    expect(cell("A2")).toHaveFocus();
    fireEvent.keyDown(cell("A2"), { key: "ArrowUp" });
    expect(cell("A1")).toHaveFocus();
    fireEvent.keyDown(cell("A1"), { key: "ArrowRight" });
    expect(cell("B1")).toHaveFocus();
    fireEvent.keyDown(cell("B1"), { key: "ArrowLeft" });
    expect(cell("A1")).toHaveFocus();
    fireEvent.keyDown(cell("A3"), { key: "Enter" });
    expect(cell("A4")).toHaveFocus();
    fireEvent.keyDown(cell("C4"), { key: "Tab" });
    expect(cell("A5")).toHaveFocus();
    fireEvent.keyDown(cell("A5"), { key: "Enter", shiftKey: true });
    expect(cell("A4")).toHaveFocus();
  });
  it("inserts, deletes, transposes, resizes and resets rows and columns", () => {
    render(<TableCanvas />);
    fireEvent.click(screen.getAllByTitle("Insert column to the right")[0]);
    expect(screen.getByLabelText("Cols")).toHaveValue(4);
    fireEvent.click(screen.getAllByTitle("Delete column")[0]);
    fireEvent.click(screen.getByTitle("Add column"));
    fireEvent.click(screen.getAllByTitle("Insert row below")[0]);
    fireEvent.click(screen.getAllByTitle("Delete row")[0]);
    fireEvent.click(screen.getByTitle("Add row"));
    fireEvent.change(screen.getByLabelText("Rows"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Transpose" }));
    expect(screen.getByLabelText("Rows")).toHaveValue(4);
    expect(screen.getByLabelText("Cols")).toHaveValue(2);
    fireEvent.change(screen.getByLabelText("Cols"), { target: { value: "0" } });
    expect(screen.getByLabelText("Cols")).toHaveValue(1);
    fireEvent.click(screen.getByRole("button", { name: "Reset table" }));
    expect(screen.getByLabelText("Rows")).toHaveValue(3);
    expect(screen.getByLabelText("Cols")).toHaveValue(3);
  });
  it("configures LaTeX output, cycles alignment and copies or inserts code", async () => {
    const insert = vi.fn();
    render(<TableCanvas onInsertCode={insert} />);
    fireEvent.change(cell("A1"), { target: { value: "$x$" } });
    select("A1");
    fireEvent.click(screen.getByRole("button", { name: "Italic" }));
    fireEvent.keyDown(cell("A1"), { key: "i", ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    fireEvent.click(screen.getByLabelText("Escape text"));
    fireEvent.click(screen.getByLabelText("Header row"));
    fireEvent.click(screen.getByLabelText("Fit to width"));
    fireEvent.click(screen.getByLabelText("Caption"));
    fireEvent.change(screen.getByPlaceholderText("Caption"), {
      target: { value: "Results" },
    });
    fireEvent.change(screen.getByPlaceholderText("tab:label"), {
      target: { value: "tab:results" },
    });
    for (const name of ["Booktabs", "Rules", "None", "Grid"])
      fireEvent.click(screen.getByRole("radio", { name }));
    for (let i = 0; i < 3; i++)
      fireEvent.click(screen.getAllByTitle(/Aligned .* click to change/)[0]);
    expect(code()).toContain("\\caption{Results}");
    expect(code()).toContain("\\label{tab:results}");
    fireEvent.click(screen.getByTitle("Insert into editor"));
    expect(insert).toHaveBeenCalledWith(code());
    await act(async () => fireEvent.click(screen.getByTitle("Copy to clipboard")));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(code());
    expect(screen.getByText("Copied!")).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByText("Copy")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear cells" }));
    expect(cell("A1")).toHaveValue("");
  });
});
