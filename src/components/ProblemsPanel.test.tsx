import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Diagnostic } from "../types";
import { ProblemsPanel, diagnosticSummary } from "./ProblemsPanel";

const diagnostics: Diagnostic[] = [
  {
    file: "content/intro.tex",
    line: 20,
    column: 4,
    severity: "warning",
    message: 'Acronym "API" used without definition',
    detail: '"API" is used before it is spelled out.',
    category: "Acronyms",
  },
  {
    file: "main.tex",
    line: 3,
    column: 1,
    severity: "error",
    message: "Undefined control sequence",
    source: "latex",
    isPrimary: true,
  },
  {
    file: "main.tex",
    line: 9,
    column: 2,
    severity: "warning",
    message: "Possible typo",
    source: "proofread",
    replacements: ["the"],
  },
];

function renderPanel() {
  const handlers = {
    onOpen: vi.fn(),
    onApplyFix: vi.fn(),
    onApplyReplacement: vi.fn(),
  };
  render(<ProblemsPanel diagnostics={diagnostics} rootFile="main.tex" {...handlers} />);
  return handlers;
}

describe("ProblemsPanel", () => {
  it("decodes encoded file names like the project tree", () => {
    render(
      <ProblemsPanel
        diagnostics={[
          {
            file: "My%20Chapters/My%20Draft.tex",
            line: 1,
            column: 1,
            severity: "warning",
            message: "Possible typo",
          },
        ]}
        rootFile="main.tex"
        onOpen={vi.fn()}
        onApplyFix={vi.fn()}
        onApplyReplacement={vi.fn()}
      />,
    );
    expect(screen.getByText("My Draft.tex")).toBeVisible();
    expect(screen.getByText("My Chapters")).toBeVisible();
    expect(screen.queryByText(/%20/)).not.toBeInTheDocument();
  });

  it("groups findings by file, errors first, with one line per finding", () => {
    renderPanel();
    const files = screen
      .getAllByRole("treeitem")
      .filter((item) => item.classList.contains("problems-file"));
    expect(files.map((item) => item.textContent)).toEqual([
      "main.tex2",
      "intro.texcontent1",
    ]);
    expect(screen.getByText("Unknown LaTeX command")).toBeVisible();
    expect(screen.getByText("Root cause")).toBeVisible();
    expect(screen.getByText("Ln 20, Col 4")).toBeVisible();
  });

  it("jumps to the source and reveals details and fixes on click", () => {
    const handlers = renderPanel();
    fireEvent.click(screen.getByText("Possible typo"));
    expect(handlers.onOpen).toHaveBeenCalledWith(diagnostics[2]);
    fireEvent.click(screen.getByRole("button", { name: "Replace with “the”" }));
    expect(handlers.onApplyReplacement).toHaveBeenCalledWith(diagnostics[2]);
  });

  it("filters by severity, check and text", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    expect(screen.queryByText("Possible typo")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "1" }));

    fireEvent.change(screen.getByLabelText("Check"), {
      target: { value: "Acronyms" },
    });
    expect(screen.queryByText("Unknown LaTeX command")).toBeNull();

    fireEvent.change(screen.getByLabelText("Check"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("Filter problems"), {
      target: { value: "typo" },
    });
    expect(screen.getAllByRole("treeitem")).toHaveLength(2);
  });

  it("shows plain messages instead of generic LaTeX headlines", () => {
    expect(
      diagnosticSummary({
        file: "a.tex",
        line: 1,
        column: 1,
        severity: "warning",
        message: "Overfull \\hbox",
      }),
    ).toBe("Overfull \\hbox");
  });
});
