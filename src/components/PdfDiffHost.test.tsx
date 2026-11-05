import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closePdfDiff,
  getPdfDiffRequest,
  openPdfDiff,
} from "../features/pdfDiff/pdfDiffStore";
import { RevisionCompileError } from "../features/pdfDiff/revisionSources";
import { PdfDiffHost } from "./PdfDiffHost";

vi.mock("./PdfDiffView", () => ({
  PdfDiffView: (props: {
    title: string;
    original: { label: string };
    modified: { label: string };
    onClose: () => void;
    onSwap: () => void;
  }) => (
    <div data-testid="pdf-diff-view">
      <span>{props.title}</span>
      <span data-testid="sides">
        {props.original.label} → {props.modified.label}
      </span>
      <button onClick={props.onSwap}>swap</button>
      <button onClick={props.onClose}>close</button>
    </div>
  ),
}));

const head = "a".repeat(40);
const older = "b".repeat(40);

const latexdo = {
  getGitHistory: vi.fn(),
  pickPdfForComparison: vi.fn(),
  compileGitRevisionPdf: vi.fn(),
  readGitRevisionPdf: vi.fn(),
};

const context = {
  projectId: "p1",
  rootFile: "main.tex",
  engine: "pdflatex" as const,
  currentPdf: new Uint8Array([7]),
};

function commit(hash: string, subject: string, isHead = false) {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents: [],
    subject,
    authorName: "Ada",
    authorEmail: "ada@example.invalid",
    authoredAt: "2026-01-01T00:00:00Z",
    refs: [],
    lane: 0,
    segments: [],
    isHead,
  };
}

beforeEach(() => {
  (window as unknown as { latexdo: unknown }).latexdo = latexdo;
  latexdo.getGitHistory.mockResolvedValue({
    scope: "repo",
    target: null,
    commits: [
      commit(head, "Polish the introduction", true),
      commit(older, `A very long subject ${"x".repeat(80)}`),
    ],
  });
  latexdo.compileGitRevisionPdf.mockResolvedValue({
    ok: true,
    pdf: new Uint8Array([1]),
    output: "",
    cached: true,
    skipped: [],
  });
});

afterEach(() => {
  act(() => closePdfDiff());
  vi.clearAllMocks();
});

describe("PdfDiffHost", () => {
  it("renders nothing until a comparison is requested", () => {
    const { container } = render(<PdfDiffHost context={context} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("defaults to the last commit against the current PDF and compares them", async () => {
    render(<PdfDiffHost context={context} />);
    act(() => openPdfDiff({ kind: "picker" }));
    expect(
      screen.getByRole("dialog", { name: "Compare PDF Versions" }),
    ).toBeInTheDocument();
    const older = screen.getByLabelText("Older") as HTMLSelectElement;
    await waitFor(() => expect(older.value).toBe(`commit:${head}`));
    expect(screen.getByLabelText("Newer")).toHaveValue("current");
    expect(
      screen.getAllByText(/aaaaaaa · Polish the introduction \(HEAD\)/),
    ).toHaveLength(2);
    expect(screen.getAllByText(/bbbbbbb · A very long subject x+…/)).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(await screen.findByTestId("pdf-diff-view")).toHaveTextContent(
      "aaaaaaa ↔ Current PDF",
    );
    expect(latexdo.compileGitRevisionPdf).toHaveBeenCalledWith(
      { projectId: "p1", rootFile: "main.tex", engine: "pdflatex" },
      { kind: "commit", hash: head },
    );
    fireEvent.click(screen.getByText("swap"));
    expect(screen.getByTestId("sides")).toHaveTextContent("Current PDF → aaaaaaa");
    fireEvent.click(screen.getByText("close"));
    expect(getPdfDiffRequest()).toBeNull();
  });

  it("offers staged changes, another commit and files on disk", async () => {
    latexdo.pickPdfForComparison.mockResolvedValueOnce({
      name: "submitted.pdf",
      data: new Uint8Array([3]),
    });
    latexdo.pickPdfForComparison.mockResolvedValueOnce(null);
    render(<PdfDiffHost context={context} />);
    act(() => openPdfDiff({ kind: "picker" }));
    const older = screen.getByLabelText("Older") as HTMLSelectElement;
    await waitFor(() => expect(older.value).toBe(`commit:${head}`));

    fireEvent.change(older, { target: { value: "index" } });
    expect(older.value).toBe("index");
    fireEvent.change(older, { target: { value: `commit:${"b".repeat(40)}` } });
    expect(older.value).toBe(`commit:${"b".repeat(40)}`);

    const newer = screen.getByLabelText("Newer") as HTMLSelectElement;
    fireEvent.change(newer, { target: { value: "file" } });
    await waitFor(() =>
      expect(screen.getByText("File: submitted.pdf")).toBeInTheDocument(),
    );
    expect(newer.value).toBe("file");
    // Cancelling the file dialog keeps the earlier choice.
    fireEvent.change(newer, { target: { value: "file" } });
    await waitFor(() => expect(newer).not.toBeDisabled());
    expect(newer.value).toBe("file");

    fireEvent.click(screen.getByRole("button", { name: "Swap older and newer" }));
    expect(older.value).toBe("file");
    expect(newer.value).toBe(`commit:${"b".repeat(40)}`);

    fireEvent.change(newer, { target: { value: "current" } });
    expect(newer.value).toBe("current");
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(await screen.findByTestId("sides")).toHaveTextContent(
      "submitted.pdf → Current PDF",
    );
  });

  it("compares two files on disk without a project", async () => {
    latexdo.pickPdfForComparison
      .mockResolvedValueOnce({ name: "v1.pdf", data: new Uint8Array([1]) })
      .mockResolvedValueOnce({ name: "v2.pdf", data: new Uint8Array([2]) });
    render(<PdfDiffHost context={null} />);
    act(() => openPdfDiff({ kind: "picker" }));
    expect(screen.queryByText(/Staged changes/)).not.toBeInTheDocument();
    for (const option of screen.getAllByRole("option", {
      name: "Current PDF (compile first)",
    })) {
      expect(option).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Older"), { target: { value: "file" } });
    await screen.findByText("File: v1.pdf");
    fireEvent.change(screen.getByLabelText("Newer"), { target: { value: "file" } });
    await screen.findByText("File: v2.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(await screen.findByTestId("sides")).toHaveTextContent("v1.pdf → v2.pdf");
    expect(latexdo.getGitHistory).not.toHaveBeenCalled();
  });

  it("closes the picker with Cancel, Escape or a click outside", async () => {
    latexdo.getGitHistory.mockRejectedValue(new Error("not a repository"));
    render(<PdfDiffHost context={context} />);
    act(() => openPdfDiff({ kind: "picker" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(getPdfDiffRequest()).toBeNull();

    act(() => openPdfDiff({ kind: "picker" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(getPdfDiffRequest()).toBeNull();

    act(() => openPdfDiff({ kind: "picker" }));
    fireEvent.mouseDown(document.querySelector(".modal-backdrop")!);
    expect(getPdfDiffRequest()).toBeNull();

    act(() => openPdfDiff({ kind: "picker" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(getPdfDiffRequest()).toBeNull();
  });

  it("shows progress, then the compiler log and a retry when a build fails", async () => {
    let attempt = 0;
    const load = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1)
        throw new RevisionCompileError("HEAD: did not compile", "! Missing $");
      if (attempt === 2) throw "unexpected";
      return {
        original: { label: "HEAD", data: new Uint8Array([1]) },
        modified: { label: "Now", data: new Uint8Array([2]) },
      };
    });
    render(<PdfDiffHost context={context} />);
    act(() =>
      openPdfDiff({
        kind: "compare",
        title: "PDF: HEAD ↔ Now",
        loadingMessage: "Compiling…",
        load,
      }),
    );
    expect(screen.getByText("Compiling…")).toBeInTheDocument();
    expect(await screen.findByText("HEAD: did not compile")).toBeInTheDocument();
    expect(screen.getByText("! Missing $")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByText("Could not prepare the PDFs.")).toBeInTheDocument();
    expect(screen.queryByText("Compiler output")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByTestId("sides")).toHaveTextContent("HEAD → Now");
  });

  it("uses a default loading message and closes from the loading state", () => {
    render(<PdfDiffHost context={context} />);
    act(() =>
      openPdfDiff({
        kind: "compare",
        title: "t",
        load: () => new Promise(() => undefined),
      }),
    );
    expect(screen.getByText("Preparing the PDFs…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close comparison" }));
    expect(getPdfDiffRequest()).toBeNull();
  });

  it("closes the comparison when the project changes", () => {
    const { rerender } = render(<PdfDiffHost context={context} />);
    act(() => openPdfDiff({ kind: "picker" }));
    rerender(<PdfDiffHost context={{ ...context, projectId: "p2" }} />);
    expect(getPdfDiffRequest()).toBeNull();
    closePdfDiff();
  });
});
