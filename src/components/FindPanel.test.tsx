import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FindPanel, findSeedFromSelection, requestFind } from "./FindPanel";

const files = [
  { path: "main.tex", content: "Intro text.\nThe method works.\nThe method scales." },
  { path: "chapters/related.tex", content: "Prior method by Smith." },
];

function renderPanel() {
  const onOpenMatch = vi.fn();
  const onClosed = vi.fn();
  render(
    <FindPanel
      files={files}
      activeFile={files[0]}
      onOpenMatch={onOpenMatch}
      onClosed={onClosed}
    />,
  );
  return { onOpenMatch, onClosed };
}

describe("FindPanel", () => {
  it("opens with Cmd/Ctrl+F on the current file and steps through matches", () => {
    const { onOpenMatch } = renderPanel();
    expect(screen.queryByRole("dialog", { name: "Find" })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    const input = screen.getByRole("textbox", { name: "Find" });
    expect(input).toHaveFocus();
    expect(screen.getByRole("radio", { name: "This file" })).toBeChecked();

    fireEvent.change(input, { target: { value: "method" } });
    expect(screen.getByText("0 of 2")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpenMatch).toHaveBeenLastCalledWith(expect.objectContaining({ line: 2 }));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpenMatch).toHaveBeenLastCalledWith(expect.objectContaining({ line: 3 }));
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onOpenMatch).toHaveBeenLastCalledWith(expect.objectContaining({ line: 2 }));
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
  });

  it("searches every file in the All files scope and closes with Escape", () => {
    const { onClosed } = renderPanel();
    act(() => requestFind({ scope: "project", query: "method" }));
    expect(screen.getByRole("radio", { name: "All files" })).toBeChecked();
    expect(screen.getByText("0 of 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "This file" }));
    expect(screen.getByText("0 of 2")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Find" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Find" })).not.toBeInTheDocument();
    expect(onClosed).toHaveBeenCalled();
  });

  it("only seeds the query from short single-line selections", () => {
    expect(findSeedFromSelection("method")).toBe("method");
    expect(findSeedFromSelection("two\nlines")).toBe("");
    expect(findSeedFromSelection("x".repeat(201))).toBe("");
    expect(findSeedFromSelection(null)).toBe("");
    expect(findSeedFromSelection(undefined)).toBe("");
  });

  it("ignores other shortcuts and opens the project scope with Shift", () => {
    renderPanel();
    fireEvent.keyDown(window, { key: "g", ctrlKey: true });
    fireEvent.keyDown(window, { key: "f" });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true, altKey: true });
    expect(screen.queryByRole("dialog", { name: "Find" })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "F", ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("radio", { name: "All files" })).toBeChecked();
  });

  it("keeps the previous scope and query when reopened without details", () => {
    renderPanel();
    act(() => requestFind({ scope: "project", query: "method" }));
    act(() => {
      window.dispatchEvent(new CustomEvent("latexdo:open-find"));
    });
    expect(screen.getByRole("radio", { name: "All files" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Find" })).toHaveValue("method");
  });

  it("finds nothing in this file without an open document and closes from the button", () => {
    const onClosed = vi.fn();
    render(
      <FindPanel files={files} activeFile={null} onOpenMatch={vi.fn()} onClosed={onClosed} />,
    );
    act(() => requestFind({ query: "method" }));
    expect(screen.queryByText("0 of 2")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close find" }));
    expect(screen.queryByRole("dialog", { name: "Find" })).not.toBeInTheDocument();
    expect(onClosed).toHaveBeenCalled();
  });
});
