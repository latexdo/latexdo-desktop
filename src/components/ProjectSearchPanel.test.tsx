import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSearchPanel } from "./ProjectSearchPanel";
import type { ProjectSearchFile } from "../search/projectSearch";

function installClipboardMock() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText,
    },
  });
  return { writeText };
}

const files: ProjectSearchFile[] = [
  {
    path: "main.tex",
    content: "\\section{Intro}\nAlpha beta alpha.\nMethod uses \\cite{smith20}.",
  },
  {
    path: "chapters/method.tex",
    content: "The Alpha method is precise.\nalphabet soup is not a whole word.",
  },
  {
    path: "references.bib",
    content: "@article{smith20,\n  title={Alpha Paper}\n}",
  },
];

describe("ProjectSearchPanel", () => {
  beforeEach(() => {
    installClipboardMock();
  });

  it("searches project files and opens an exact match", async () => {
    const onOpenMatch = vi.fn();
    render(<ProjectSearchPanel files={files} onOpenMatch={onOpenMatch} />);

    fireEvent.change(screen.getByPlaceholderText(/search every project file/i), {
      target: { value: "cite" },
    });

    expect(await screen.findByText(/1 matches in 1 files/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /3:14/i }));

    expect(onOpenMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "main.tex",
        line: 3,
        column: 14,
      }),
    );
  });

  it("supports whole-word and include filters", async () => {
    render(<ProjectSearchPanel files={files} onOpenMatch={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/search every project file/i), {
      target: { value: "alpha" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Word" }));
    fireEvent.change(screen.getByPlaceholderText("*.tex, chapters/**"), {
      target: { value: "chapters/**/*.tex" },
    });

    expect(await screen.findByText(/1 matches in 1 files/i)).toBeVisible();
    expect(screen.getByText("method.tex")).toBeVisible();
    expect(screen.queryByText("main.tex")).not.toBeInTheDocument();
  });

  it("copies formatted results", async () => {
    const { writeText } = installClipboardMock();
    render(<ProjectSearchPanel files={files} onOpenMatch={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/search every project file/i), {
      target: { value: "cite" },
    });

    const summary = await screen.findByText(/1 matches in 1 files/i);
    const summaryRow = summary.closest(".project-search-summary");
    expect(summaryRow).not.toBeNull();
    fireEvent.click(
      within(summaryRow as HTMLElement).getByRole("button", { name: /copy/i }),
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        "main.tex:3:14: Method uses \\cite{smith20}.",
      );
    });
  });

  it("shows invalid regex errors without opening stale results", async () => {
    const onOpenMatch = vi.fn();
    render(<ProjectSearchPanel files={files} onOpenMatch={onOpenMatch} />);

    fireEvent.click(screen.getByRole("button", { name: ".*" }));
    fireEvent.change(screen.getByPlaceholderText(/search every project file/i), {
      target: { value: "(" },
    });

    expect(await screen.findByText(/Invalid regular expression/i)).toBeVisible();
    expect(screen.getByText(/Fix the query/i)).toBeVisible();
    expect(onOpenMatch).not.toHaveBeenCalled();
  });
});

describe("ProjectSearchPanel navigation and filters", () => {
  beforeEach(() => {
    installClipboardMock();
  });

  it("steps through matches with Enter and Shift+Enter and closes on Escape", async () => {
    const onOpenMatch = vi.fn();
    const onClose = vi.fn();
    render(
      <ProjectSearchPanel
        files={files}
        onOpenMatch={onOpenMatch}
        compact
        autoFocus
        initialQuery="alpha"
        activePath="main.tex"
        onClose={onClose}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Find" });
    expect(input).toHaveFocus();
    expect(await screen.findByText("0 of 5")).toBeVisible();

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onOpenMatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "references.bib" }),
    );
    expect(screen.getByText("5 of 5")).toBeVisible();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("1 of 5")).toBeVisible();
    expect(document.querySelector(".project-search-match.current")).toHaveClass(
      "active-file",
    );
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(screen.getByText("5 of 5")).toBeVisible();

    fireEvent.keyDown(input, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("starts at the first match on Enter and does nothing without matches", async () => {
    const onOpenMatch = vi.fn();
    render(<ProjectSearchPanel files={files} onOpenMatch={onOpenMatch} />);
    const input = screen.getByRole("textbox", { name: "Find" });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.change(input, { target: { value: "zzz-none" } });
    expect(await screen.findByText("No results")).toBeVisible();
    expect(screen.getByText(/No matches. Try clearing filters/)).toBeVisible();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpenMatch).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "precise" } });
    expect(await screen.findByText("0 of 1")).toBeVisible();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpenMatch).toHaveBeenCalledWith(
      expect.objectContaining({ path: "chapters/method.tex" }),
    );
  });

  it("clears the query, toggles case and filters, and hides compact filters", async () => {
    render(<ProjectSearchPanel files={files} onOpenMatch={vi.fn()} compact />);
    expect(screen.queryByText("Project Search")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("*.log, draft/**")).not.toBeInTheDocument();
    const filters = screen.getByRole("button", { name: "Search filters" });
    fireEvent.click(filters);
    expect(filters).toHaveAttribute("aria-pressed", "true");
    expect(filters).toHaveClass("active");

    const input = screen.getByRole("textbox", { name: "Find" });
    fireEvent.change(input, { target: { value: "Alpha" } });
    expect(await screen.findByText(/5 matches in 3 files/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Aa" }));
    expect(screen.getByRole("button", { name: "Aa" })).toHaveClass("active");
    expect(await screen.findByText(/3 matches in 3 files/)).toBeVisible();

    fireEvent.change(screen.getByPlaceholderText("*.log, draft/**"), {
      target: { value: "*.bib" },
    });
    expect(await screen.findByText(/2 matches in 2 files/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input).toHaveValue("");
    expect(await screen.findByText("3 searchable files")).toBeVisible();
    fireEvent.click(filters);
    expect(screen.queryByPlaceholderText("*.log, draft/**")).not.toBeInTheDocument();
  });

  it("shows context lines, blank lines and the truncation notice", async () => {
    const many: ProjectSearchFile[] = [
      { path: "big.tex", content: Array.from({ length: 120 }, () => "x").join("\n") },
      { path: "ctx.tex", content: "first\n\nhit here\n\nlast" },
    ];
    const onRefresh = vi.fn();
    render(
      <ProjectSearchPanel files={many} onOpenMatch={vi.fn()} onRefresh={onRefresh} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Rescan project files" }));
    expect(onRefresh).toHaveBeenCalled();
    const [contextSelect, limitSelect] = screen.getAllByRole("combobox");
    fireEvent.change(contextSelect, { target: { value: "1" } });
    fireEvent.change(limitSelect, { target: { value: "100" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Find" }), {
      target: { value: "hit" },
    });
    expect(await screen.findByText(/1 matches in 1 files/)).toBeVisible();
    const contextLines = [...document.querySelectorAll(".project-search-context-line")].map(
      (node) => node.textContent,
    );
    expect(contextLines).toEqual(["2:  ", "4:  "]);

    fireEvent.change(screen.getByRole("textbox", { name: "Find" }), {
      target: { value: "x" },
    });
    expect(await screen.findByText(/Results stopped at 100/)).toBeVisible();
  });

  it("shows the error passed by the caller and a scanning state", () => {
    render(
      <ProjectSearchPanel files={files} onOpenMatch={vi.fn()} loading error="Disk gone" />,
    );
    expect(screen.getByText("Disk gone")).toBeVisible();
    expect(screen.getByText("Searching...")).toBeVisible();
    expect(screen.getByRole("button", { name: "Rescan project files" })).toBeDisabled();
  });

  it("does not copy without a clipboard and resets the Copied label", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { writeText } = installClipboardMock();
      render(<ProjectSearchPanel files={files} onOpenMatch={vi.fn()} initialQuery="cite" />);
      const copy = await screen.findByRole("button", { name: /copy/i });
      fireEvent.click(copy);
      expect(await screen.findByText("Copied")).toBeVisible();
      expect(writeText).toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      expect(await screen.findByRole("button", { name: /^copy$/i })).toBeVisible();

      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      fireEvent.click(screen.getByRole("button", { name: /copy/i }));
      await vi.advanceTimersByTimeAsync(10);
      expect(screen.queryByText("Copied")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
