import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitDiffSession } from "../types";
import { GitPdfDiffPane } from "./GitPdfDiffPane";

vi.mock("./PdfDiffView", () => ({
  PdfDiffView: (props: {
    title: string;
    original: { label: string };
    modified: { label: string };
  }) => (
    <div data-testid="view">
      {props.title}: {props.original.label} → {props.modified.label}
    </div>
  ),
}));

const readGitRevisionPdf = vi.fn();

const session: GitDiffSession = {
  id: "s1",
  relativePath: "paper.pdf",
  originalRef: { kind: "index" },
  modifiedRef: { kind: "working-tree" },
  originalContent: "",
  modifiedContent: "",
  originalLabel: "Index",
  modifiedLabel: "Working Tree",
  status: "modified",
  language: "plaintext",
  binary: true,
};

beforeEach(() => {
  (window as unknown as { latexdo: unknown }).latexdo = { readGitRevisionPdf };
  readGitRevisionPdf.mockReset();
});

describe("GitPdfDiffPane", () => {
  it("shows both versions of a tracked PDF", async () => {
    readGitRevisionPdf.mockResolvedValue(new Uint8Array([1]));
    render(<GitPdfDiffPane projectId="p1" session={session} />);
    expect(screen.getByText("Reading both versions of the PDF…")).toBeInTheDocument();
    expect(await screen.findByTestId("view")).toHaveTextContent(
      "paper.pdf (Index) ↔ paper.pdf (Working Tree): Index → Working Tree",
    );
  });

  it("reports a version that cannot be read", async () => {
    readGitRevisionPdf.mockRejectedValue(
      new Error("This PDF is too large to compare."),
    );
    render(<GitPdfDiffPane projectId="p1" session={session} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This PDF is too large to compare.",
    );
  });

  it("has a fallback message for unknown failures", async () => {
    readGitRevisionPdf.mockRejectedValue("boom");
    render(<GitPdfDiffPane projectId="p1" session={session} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not read the PDF versions.",
    );
  });
});
