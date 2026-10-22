import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { filterSettings, SettingsShell, type SettingsPage } from "./SettingsShell";

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
    expect(nav).toHaveTextContent(
      "LatexDoGeneralAppearanceEditor and compilerAI AssistantApplicationUpdates",
    );
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

  it("lists the open page's sub-sections and folds them on a second click", () => {
    renderShell();
    const general = screen.getByRole("button", { name: "General" });
    expect(general).toHaveAttribute("aria-expanded", "true");
    const sections = screen.getByRole("group", { name: "General sections" });
    const scrollIntoView = vi.fn();
    const headings = document.querySelectorAll<HTMLElement>(
      ".settings-section-heading",
    );
    headings[1].scrollIntoView = scrollIntoView;
    fireEvent.click(
      within(sections).getByRole("button", { name: "Editor and compiler" }),
    );
    expect(scrollIntoView).toHaveBeenCalled();

    fireEvent.click(general);
    expect(general).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "General sections" })).toBeNull();
  });

  it("jumps to the search box with Cmd/Ctrl+F", () => {
    renderShell();
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(screen.getByRole("searchbox", { name: "Search settings" })).toHaveFocus();
  });
});

describe("SettingsShell navigation details", () => {
  it("falls back to the first page for an unknown id and handles no pages", () => {
    renderShell("missing");
    expect(screen.getByRole("heading", { level: 1, name: "General" })).toBeVisible();
  });

  it("renders nothing to browse when there are no pages", () => {
    render(
      <SettingsShell
        pages={[]}
        activePage="x"
        onSelectPage={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(document.querySelectorAll("[data-settings-page]")).toHaveLength(0);
    fireEvent.scroll(document.querySelector(".settings-list")!);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "any" } });
    expect(screen.getByRole("status")).toHaveTextContent("0 settings found");
  });

  it("scrolls to a page's results when its category is chosen while searching", () => {
    const { onSelectPage } = renderShell();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "updates" } });
    const page = document.querySelector<HTMLElement>(
      '[data-settings-page="application"]',
    )!;
    const scrollIntoView = vi.fn();
    page.scrollIntoView = scrollIntoView;
    fireEvent.click(screen.getByRole("button", { name: /Updates/ }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
    expect(onSelectPage).not.toHaveBeenCalled();
  });

  it("counts several matches and leaves Escape alone when the query is empty", () => {
    renderShell();
    const search = screen.getByRole("searchbox");
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    fireEvent.keyDown(search, { key: "Escape" });
    expect(onWindowKey).toHaveBeenCalled();
    window.removeEventListener("keydown", onWindowKey);
    fireEvent.change(search, { target: { value: "check" } });
    fireEvent.change(search, { target: { value: "r" } });
    expect(screen.getByRole("status").textContent).toMatch(/^\d+ settings found$/);
  });

  it("highlights the sub-section scrolled into view", () => {
    renderShell();
    const list = document.querySelector<HTMLElement>(".settings-list")!;
    const headings = document.querySelectorAll<HTMLElement>(
      ".settings-section-heading",
    );
    list.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    headings[0].getBoundingClientRect = () => ({ top: -100 }) as DOMRect;
    headings[1].getBoundingClientRect = () => ({ top: 20 }) as DOMRect;
    fireEvent.scroll(list);
    const sections = screen.getByRole("group", { name: "General sections" });
    expect(
      within(sections).getByRole("button", { name: "Editor and compiler" }),
    ).toHaveClass("active");
    headings[1].getBoundingClientRect = () => ({ top: 500 }) as DOMRect;
    fireEvent.scroll(list);
    expect(within(sections).getByRole("button", { name: "Appearance" })).toHaveClass(
      "active",
    );
  });

  it("ignores Ctrl with other keys and accepts Ctrl+F", () => {
    renderShell();
    const search = screen.getByRole("searchbox");
    fireEvent.keyDown(window, { key: "g", ctrlKey: true });
    fireEvent.keyDown(window, { key: "f" });
    expect(search).not.toHaveFocus();
    fireEvent.keyDown(window, { key: "F", ctrlKey: true });
    expect(search).toHaveFocus();
  });
});

describe("filterSettings", () => {
  it("searches titles and plain headings in pages without a body wrapper", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <section data-settings-page="a">
        <div class="settings-section-heading">Plain heading</div>
        <div><button title="Secret tooltip">x</button></div>
        <div>Other</div>
      </section>
      <section data-settings-page="b"><div>Nothing</div><div>Else</div></section>`;
    const counts = filterSettings(root, "tooltip");
    expect([...counts]).toEqual([
      ["a", 1],
      ["b", 0],
    ]);
    const [a, b] = root.querySelectorAll<HTMLElement>("section");
    expect(a.hidden).toBe(false);
    expect(a.hasAttribute("data-follows-page")).toBe(false);
    expect(b.hidden).toBe(true);
    expect(filterSettings(root, "plain heading").get("a")).toBe(2);
    filterSettings(root, "");
    expect(b.hidden).toBe(false);
    expect(b.hasAttribute("data-follows-page")).toBe(true);
  });
});
