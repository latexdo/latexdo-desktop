import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TableSizePicker } from "./TableSizePicker";

function setup() {
  const onInsert = vi.fn();
  const onAlignColumns = vi.fn();
  render(<TableSizePicker onInsert={onInsert} onAlignColumns={onAlignColumns} />);
  fireEvent.click(screen.getByRole("button", { name: "Insert table" }));
  return { onInsert, onAlignColumns };
}

describe("TableSizePicker", () => {
  it("previews the size under the pointer and inserts it on click", () => {
    const { onInsert } = setup();
    const cell = screen.getByRole("gridcell", { name: "4 by 5 table" });
    fireEvent.pointerEnter(cell);
    expect(screen.getByText("4 × 5 table")).toBeVisible();
    fireEvent.click(cell);
    expect(onInsert).toHaveBeenCalledWith(4, 5);
    expect(screen.queryByRole("dialog", { name: "Insert table" })).toBeNull();
  });

  it("picks the size with the arrow keys and Enter", () => {
    const { onInsert } = setup();
    const grid = screen.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(onInsert).toHaveBeenCalledWith(4, 5);
  });

  it("still aligns the columns of an existing table", () => {
    const { onAlignColumns } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Align columns of the table at cursor" }),
    );
    expect(onAlignColumns).toHaveBeenCalled();
  });

  it("clamps the keyboard selection to the grid and ignores other keys", () => {
    const { onInsert } = setup();
    const grid = screen.getByRole("grid");
    for (let i = 0; i < 5; i += 1) {
      fireEvent.keyDown(grid, { key: "ArrowUp" });
      fireEvent.keyDown(grid, { key: "ArrowLeft" });
    }
    expect(grid).toHaveAttribute("aria-label", "1 by 1 table");
    for (let i = 0; i < 10; i += 1) {
      fireEvent.keyDown(grid, { key: "ArrowDown" });
      fireEvent.keyDown(grid, { key: "ArrowRight" });
    }
    expect(grid).toHaveAttribute("aria-label", "8 by 8 table");
    fireEvent.keyDown(grid, { key: "a" });
    expect(grid).toHaveAttribute("aria-label", "8 by 8 table");
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("closes on Escape and returns focus to the button", () => {
    setup();
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Insert table" })).toBeNull();
    expect(screen.getByRole("button", { name: "Insert table" })).toHaveFocus();
  });

  it("closes on a pointer down outside but not inside", () => {
    setup();
    fireEvent.pointerDown(screen.getByRole("grid"));
    expect(screen.getByRole("dialog", { name: "Insert table" })).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Insert table" }));
    expect(screen.getByRole("dialog", { name: "Insert table" })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Insert table" })).toBeNull();
  });

  it("keeps the popover inside the window near the right edge", () => {
    const onInsert = vi.fn();
    render(<TableSizePicker onInsert={onInsert} onAlignColumns={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Insert table" });
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      left: window.innerWidth - 20,
      bottom: 40,
    } as DOMRect);
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: "Insert table" });
    expect(dialog.style.top).toBe("46px");
    expect(dialog.style.left).toBe(`${window.innerWidth - 172 - 8}px`);
    // A second click toggles it closed.
    fireEvent.click(button);
    expect(screen.queryByRole("dialog", { name: "Insert table" })).toBeNull();
  });
});
