import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsShell, type SettingsPage } from "./SettingsShell";

const pages: SettingsPage[] = [
  {
    id: "editor",
    title: "General",
    group: "LatexDo",
    content: (
      <>
        <div className="settings-section-heading">
          <strong>Appearance</strong>
        </div>
        <label className="settings-row">
          <strong>Mode</strong>
          <select aria-label="Appearance">
            <option>Light</option>
            <option>Dark</option>
          </select>
        </label>
        <div className="settings-section-heading">
          <strong>Editor and compiler</strong>
        </div>
        <label className="settings-row">
          <strong>Minimap</strong>
          <input type="checkbox" />
        </label>
        <label className="settings-row">
          <strong>Word wrap</strong>
          <input type="checkbox" />
        </label>
      </>
    ),
  },
  {
    id: "ai",
    title: "AI Assistant",
    group: "LatexDo",
    content: (
      <div className="ai-settings-panel">
        <div className="settings-section-heading">
          <strong>Context access</strong>
        </div>
        <label className="settings-row">
          <strong>Project files</strong>
          <input type="checkbox" />
        </label>
      </div>
    ),
  },
  {
    id: "application",
    title: "Updates",
    group: "Application",
    content: (
      <label className="settings-row">
        <strong>Check for updates automatically</strong>
        <input type="checkbox" />
      </label>
    ),
  },
];

function renderShell(activePage = "editor") {
  const onSelectPage = vi.fn();
  const onClose = vi.fn();
  render(
    <SettingsShell
      pages={pages}
      activePage={activePage}
      onSelectPage={onSelectPage}
      onClose={onClose}
    />,
  );
  return { onSelectPage, onClose };
}

describe("SettingsShell", () => {
  it("lists categories by group and shows one page at a time", () => {
    const { onSelectPage, onClose } = renderShell();
    const nav = screen.getByRole("navigation", { name: "Settings categories" });
    expect(nav).toHaveTextContent("LatexDoGeneralAI AssistantApplicationUpdates");
    expect(screen.getByRole("heading", { level: 1, name: "General" })).toBeVisible();
    expect(screen.queryByText("Project files")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "General" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.click(screen.getByRole("button", { name: "Updates" }));
    expect(onSelectPage).toHaveBeenCalledWith("application");
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("searches every page and keeps only the matching settings", () => {
    renderShell();
    const search = screen.getByRole("searchbox", { name: "Search settings" });

    fireEvent.change(search, { target: { value: "minimap" } });
    expect(screen.getByText("Minimap")).toBeVisible();
    expect(screen.getByText("Word wrap").closest("label")).not.toBeVisible();
    expect(screen.getByText("Appearance", { selector: "strong" })).not.toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("1 setting found");
    // Pages without a match are hidden and their category is dimmed.
    expect(document.querySelector('[data-settings-page="ai"]')).not.toBeVisible();
    expect(screen.getByRole("button", { name: "AI Assistant" })).toBeDisabled();

    // Option labels count too, and a matching heading keeps its whole group.
    fireEvent.change(search, { target: { value: "dark" } });
    expect(screen.getByText("Mode")).toBeVisible();
    fireEvent.change(search, { target: { value: "context access" } });
    expect(screen.getByText("Project files")).toBeVisible();
    expect(screen.getByRole("button", { name: /AI Assistant/ })).toHaveTextContent("1");

    fireEvent.change(search, { target: { value: "nothing like this" } });
    expect(screen.getByText(/No settings match/)).toBeVisible();

    // Escape clears the search and brings back the chosen page.
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(screen.getByText("Word wrap")).toBeVisible();
    expect(screen.queryByText("Project files")).not.toBeInTheDocument();
  });

  it("jumps to the search box with Cmd/Ctrl+F", () => {
    renderShell();
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(screen.getByRole("searchbox", { name: "Search settings" })).toHaveFocus();
  });
});
