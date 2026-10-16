import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CitationManager } from "./CitationManager";
import { analyzeCitationLibrary } from "../latex/citationAnalysis";

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

const analysis = analyzeCitationLibrary(
  [
    {
      path: "main.tex",
      content: "We cite \\citep{knuth84,missingKey}.",
    },
    {
      path: "refs.bib",
      content: `
@article{knuth84,
  title = {The TeXbook},
  author = {Donald Knuth},
  year = {1984},
  journal = {Computers and Typesetting},
  doi = {10.1000/texbook}
}
@article{duplicateA,
  title = {Duplicate Work},
  author = {A. Author},
  year = {2020},
  journal = {Journal},
  doi = {10.1000/dup}
}
@article{duplicateB,
  title = {Duplicate Work},
  author = {B. Author},
  year = {2020},
  journal = {Journal},
  doi = {10.1000/dup}
}
@misc{metadataDebt,
  year = {2024}
}
`,
    },
  ],
  2026,
);

describe("CitationManager", () => {
  it("offers unused-entry cleanup and disables it while the scan is incomplete (#247)", () => {
    const onRemoveUnused = vi.fn();
    const { rerender } = render(
      <CitationManager analysis={analysis} onRemoveUnused={onRemoveUnused} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove unused entries" }));
    expect(onRemoveUnused).toHaveBeenCalledOnce();
    rerender(
      <CitationManager analysis={analysis} onRemoveUnused={onRemoveUnused} loading />,
    );
    expect(
      screen.getByRole("button", { name: "Remove unused entries" }),
    ).toBeDisabled();
  });

  beforeEach(() => {
    installClipboardMock();
  });

  it("searches the library and inserts a selected citation command", () => {
    const onInsertCitation = vi.fn();
    render(<CitationManager analysis={analysis} onInsertCitation={onInsertCitation} />);

    fireEvent.change(screen.getByPlaceholderText(/search by key/i), {
      target: { value: "texbook" },
    });
    fireEvent.change(screen.getByLabelText("Citation command"), {
      target: { value: "citet" },
    });

    const card = screen.getByText("knuth84").closest("article");
    expect(card).not.toBeNull();
    fireEvent.click(
      within(card as HTMLElement).getByRole("button", { name: "Insert" }),
    );

    expect(onInsertCitation).toHaveBeenCalledWith("knuth84", "citet");
  });

  it("copies cite commands from the library", async () => {
    const { writeText } = installClipboardMock();
    render(<CitationManager analysis={analysis} />);

    const card = screen.getByText("knuth84").closest("article");
    expect(card).not.toBeNull();
    fireEvent.click(
      within(card as HTMLElement).getByRole("button", { name: /copy cite/i }),
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("\\cite{knuth84}");
    });
    expect(await screen.findByText("Copied knuth84")).toBeVisible();
  });

  it("adds a BibTeX stub for a missing cited key", () => {
    const onAppendBibEntry = vi.fn();
    render(<CitationManager analysis={analysis} onAppendBibEntry={onAppendBibEntry} />);

    fireEvent.click(screen.getByRole("button", { name: "Gaps" }));

    const card = screen.getByText("missingKey").closest("article");
    expect(card).not.toBeNull();
    fireEvent.click(
      within(card as HTMLElement).getByRole("button", { name: /add stub/i }),
    );

    expect(onAppendBibEntry).toHaveBeenCalledWith(
      "refs.bib",
      expect.stringContaining("@article{missingKey,"),
    );
  });

  it("surfaces duplicate and metadata quality issues", () => {
    render(<CitationManager analysis={analysis} />);

    fireEvent.click(screen.getByRole("button", { name: "Quality" }));

    expect(screen.getByText(/DOI: 10.1000\/dup/i)).toBeVisible();
    expect(screen.getAllByText("metadataDebt").length).toBeGreaterThan(1);
    expect(screen.getByText("Missing title")).toBeVisible();
  });

  it("exposes an explicit close button", () => {
    const onClose = vi.fn();
    render(<CitationManager analysis={analysis} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /close citation manager/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers to merge a bibliography spread over several .bib files", () => {
    const onMergeBibFiles = vi.fn();
    const split = analyzeCitationLibrary([
      { path: "main.tex", content: "\\cite{a,b}" },
      { path: "a.bib", content: "@article{a, title = {A}}" },
      { path: "b.bib", content: "@article{b, title = {B}}" },
    ]);
    const { rerender } = render(
      <CitationManager analysis={split} onMergeBibFiles={onMergeBibFiles} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Merge into one .bib" }));
    expect(onMergeBibFiles).toHaveBeenCalledTimes(1);

    rerender(<CitationManager analysis={analysis} onMergeBibFiles={onMergeBibFiles} />);
    expect(screen.queryByRole("button", { name: "Merge into one .bib" })).toBeNull();
  });
});
