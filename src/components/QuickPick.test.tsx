import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuickPick, type QuickPickItem, type QuickPickRequest } from "./QuickPick";

const items: QuickPickItem[] = [
  { id: "sep-local", label: "Local", separator: true },
  { id: "main", label: "main", description: "current", icon: <i data-testid="icon" /> },
  {
    id: "dev",
    label: "dev",
    detail: "2 ahead",
    buttons: [{ id: "delete", label: "Delete", icon: <b>x</b> }],
  },
  { id: "sep-remote", label: "Remote", separator: true },
  { id: "origin", label: "origin/main" },
  { id: "sep-empty", label: "Tags", separator: true },
];

function pick(overrides: Partial<QuickPickRequest> = {}) {
  const request: QuickPickRequest = {
    placeholder: "Select a branch",
    items,
    onAccept: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<QuickPick request={request} />);
  return { request, input: screen.getByPlaceholderText(request.placeholder) };
}

const selected = () => screen.getByRole("option", { selected: true }).textContent;

describe("QuickPick list", () => {
  it("shows items with icons, descriptions, details and drops trailing separators", () => {
    pick({ title: "Checkout" });
    expect(screen.getByRole("dialog", { name: "Checkout" })).toBeVisible();
    expect(screen.getByText("Checkout")).toHaveClass("quick-pick-title");
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByText("current")).toHaveClass("quick-pick-description");
    expect(screen.getByText("2 ahead")).toHaveClass("quick-pick-detail");
    expect(screen.getByText("Local")).toHaveClass("quick-pick-separator");
    expect(screen.queryByText("Tags")).toBeNull();
    expect(selected()).toContain("main");
  });

  it("names the dialog after the placeholder without a title", () => {
    pick();
    expect(screen.getByRole("dialog", { name: "Select a branch" })).toBeVisible();
  });

  it("filters by label and description, hiding empty sections", () => {
    const { input } = pick();
    fireEvent.change(input, { target: { value: "CURRENT" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "maincurrent",
    ]);
    expect(screen.queryByText("Remote")).toBeNull();
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByText("No matching results")).toBeVisible();
  });

  it("moves the highlight with the arrow keys, wrapping around, and by hovering", () => {
    const { input } = pick();
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(selected()).toBe("origin/main");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(selected()).toContain("main");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(selected()).toContain("dev");
    fireEvent.mouseEnter(screen.getByText("origin/main").closest('[role="option"]')!);
    expect(selected()).toBe("origin/main");
    fireEvent.keyDown(input, { key: "x" });
    expect(selected()).toBe("origin/main");
  });

  it("keeps the highlight at zero when nothing matches", () => {
    const { input, request } = pick();
    fireEvent.change(input, { target: { value: "zzz" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(request.onAccept).not.toHaveBeenCalled();
  });

  it("accepts with Enter or a click", () => {
    const { input, request } = pick();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(request.onAccept).toHaveBeenLastCalledWith(items[1], "");
    fireEvent.click(screen.getByText("origin/main"));
    expect(request.onAccept).toHaveBeenLastCalledWith(items[4], "");
  });

  it("presses inline buttons without accepting the row", () => {
    const { request } = pick();
    fireEvent.click(screen.getByRole("button", { name: "Delete dev" }));
    expect(request.onAccept).toHaveBeenCalledTimes(1);
    expect(request.onAccept).toHaveBeenCalledWith(items[2], "", "delete");
  });

  it("presses the context button on right click only where the item has it", () => {
    const { request } = pick({ contextButton: "delete" });
    const dev = screen.getByText("dev").closest('[role="option"]')!;
    expect(fireEvent.contextMenu(dev)).toBe(false);
    expect(request.onAccept).toHaveBeenCalledWith(items[2], "", "delete");
    expect(fireEvent.contextMenu(screen.getByText("origin/main"))).toBe(true);
    expect(request.onAccept).toHaveBeenCalledTimes(1);
  });

  it("ignores right clicks without a context button", () => {
    const { request } = pick();
    fireEvent.contextMenu(screen.getByText("dev"));
    expect(request.onAccept).not.toHaveBeenCalled();
  });

  it("cancels on Escape and on a backdrop click but not inside the dialog", () => {
    const { input, request } = pick();
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(request.onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(request.onCancel).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(request.onCancel).toHaveBeenCalledTimes(2);
  });

  it("scrolls the highlighted item into view", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const { input } = pick();
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });
});

describe("QuickPick text input", () => {
  it("prefills, validates and only accepts valid input", () => {
    const { input, request } = pick({
      items: undefined,
      value: "bad name",
      validate: (value) => (value.includes(" ") ? "No spaces allowed" : null),
    });
    expect(input).toHaveValue("bad name");
    expect(input).not.toHaveAttribute("role");
    expect(input).toHaveClass("invalid");
    expect(screen.getByText("No spaces allowed")).toHaveClass("invalid");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(request.onAccept).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "feature" } });
    expect(screen.getByText(/Press 'Enter' to confirm/)).toBeVisible();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(request.onAccept).toHaveBeenCalledWith(null, "feature");
  });

  it("accepts any value without a validator", () => {
    const { input, request } = pick({ items: undefined });
    expect(input).toHaveValue("");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(request.onAccept).toHaveBeenCalledWith(null, "");
  });
});
