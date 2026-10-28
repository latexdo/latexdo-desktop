import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LayoutMenu } from "./LayoutMenu";

afterEach(cleanup);

function renderMenu() {
  const props = {
    mode: "split" as const,
    focusMode: false,
    sidebarVisible: true,
    panelVisible: false,
    onSelectMode: vi.fn(),
    onToggleFocusMode: vi.fn(),
    onToggleSidebar: vi.fn(),
    onTogglePanel: vi.fn(),
    onResetSizes: vi.fn(),
  };
  render(<LayoutMenu {...props} />);
  return props;
}

describe("LayoutMenu", () => {
  it("opens, marks the current layout and closes after a choice", () => {
    const props = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Layout options" }));
    expect(screen.getByRole("menuitemradio", { name: /Split view/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      screen.getByRole("menuitemcheckbox", { name: /Bottom panel/ }),
    ).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("menuitemradio", { name: /PDF only/ }));
    expect(props.onSelectMode).toHaveBeenCalledWith("pdf");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("runs the toggles and reset", () => {
    const props = renderMenu();
    const open = () =>
      fireEvent.click(screen.getByRole("button", { name: "Layout options" }));
    open();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Focus mode/ }));
    open();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Sidebar/ }));
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset pane sizes/ }));
    expect(props.onToggleFocusMode).toHaveBeenCalled();
    expect(props.onToggleSidebar).toHaveBeenCalled();
    expect(props.onResetSizes).toHaveBeenCalled();
  });

  it("closes on Escape and on an outside click, and moves focus with arrows", () => {
    renderMenu();
    const button = screen.getByRole("button", { name: "Layout options" });
    fireEvent.click(button);
    const menu = screen.getByRole("menu");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitemradio", { name: /Split view/ }),
    );
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("menuitemradio", { name: /Editor only/ }),
    );
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
