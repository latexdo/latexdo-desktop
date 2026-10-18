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
});
