import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { EditorMode } from "../types";
import { StatusbarModeMenu } from "./StatusbarModeMenu";

function Harness({ onSelect = vi.fn() }: { onSelect?: (mode: EditorMode) => void }) {
  const [mode, setMode] = useState<EditorMode>("author");
  return (
    <footer className="statusbar">
      <StatusbarModeMenu
        mode={mode}
        onSelect={(next) => {
          onSelect(next);
          setMode(next);
        }}
      />
      <span>outside</span>
    </footer>
  );
}

describe("StatusbarModeMenu", () => {
  it("shows the current mode and switches it from the menu", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const button = screen.getByRole("button", { name: "Author mode — change mode" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(screen.getByRole("menu", { name: "Mode" })).toBeInTheDocument();
    const author = screen.getByRole("menuitemradio", { name: /Author/ });
    expect(author).toHaveAttribute("aria-checked", "true");
    expect(author).toHaveFocus();

    fireEvent.click(screen.getByRole("menuitemradio", { name: /Reviewer/ }));
    expect(onSelect).toHaveBeenCalledWith("reviewer");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Reviewer mode — change mode" }),
    ).toHaveFocus();

    // Choosing the current mode just closes the menu.
    fireEvent.click(screen.getByRole("button", { name: /change mode/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Reviewer/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("works from the keyboard", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const button = screen.getByRole("button", { name: /change mode/ });
    fireEvent.keyDown(button, { key: "ArrowDown" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.keyDown(button, { key: "ArrowUp" });
    const menu = screen.getByRole("menu");
    const items = screen.getAllByRole("menuitemradio");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(items[2]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(items[2]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "x" });
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();

    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes when clicking elsewhere, resizing or leaving the window", () => {
    render(<Harness />);
    const button = screen.getByRole("button", { name: /change mode/ });
    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByRole("menu"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByText("outside"));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(button);
    fireEvent(window, new Event("resize"));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(button);
    fireEvent(window, new Event("blur"));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("stays inside the window, just above its button", () => {
    render(<Harness />);
    const button = screen.getByRole("button", { name: /change mode/ });
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      left: window.innerWidth - 40,
      top: window.innerHeight - 22,
    } as DOMRect);
    fireEvent.click(button);
    const menu = screen.getByRole("menu");
    expect(menu.style.bottom).toBe("28px");
    // jsdom has no layout: the menu's assumed width keeps it on screen.
    expect(parseFloat(menu.style.left)).toBeLessThan(window.innerWidth - 40);
    expect(parseFloat(menu.style.left)).toBeGreaterThanOrEqual(8);
  });
});
