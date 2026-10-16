import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
