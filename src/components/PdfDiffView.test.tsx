import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedDiffPdf } from "../features/pdfDiff/loadPdfForDiff";
import type { PdfDiffWord } from "../features/pdfDiff/pdfTextDiff";
import { PdfDiffView } from "./PdfDiffView";

const loader = vi.hoisted(() => ({
  loadPdfForDiff: vi.fn(),
}));

vi.mock("../features/pdfDiff/loadPdfForDiff", () => loader);

function word(text: string, page: number, index: number, line = 0): PdfDiffWord {
  return {
    text,
    key: text,
    page,
    line,
    boxes: [
      {
        page,
        rect: {
          x: 0.1 + index * 0.08,
          y: 0.1 + line * 0.03,
          width: 0.07,
          height: 0.02,
        },
      },
    ],
  };
}

function words(text: string, page = 1): PdfDiffWord[] {
  return text.split(" ").map((entry, index) => word(entry, page, index));
}

function fakeDocument(pages: number) {
  const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  return {
    numPages: pages,
    destroy: vi.fn(() => Promise.resolve()),
    getPage: vi.fn(async () => ({
      getViewport: ({ scale }: { scale: number }) => ({
        width: 600 * scale,
        height: 800 * scale,
      }),
      render,
    })),
    render,
  };
}

function loaded(text: string, pages = 1): LoadedDiffPdf {
  return {
    document: fakeDocument(pages) as unknown as LoadedDiffPdf["document"],
    words: words(text),
    pageSizes: Array.from({ length: pages }, () => ({ width: 600, height: 800 })),
  };
}

const originalBytes = new Uint8Array([1]);
const modifiedBytes = new Uint8Array([2]);

function setup(
  props: Partial<Parameters<typeof PdfDiffView>[0]> = {},
  texts: [string, string] = ["we show a fast method", "we show a robust fast approach"],
) {
  loader.loadPdfForDiff.mockImplementation(async (data: Uint8Array) =>
    data === originalBytes ? loaded(texts[0], 2) : loaded(texts[1], 2),
  );
  const onClose = vi.fn();
  const view = render(
    <PdfDiffView
      title="main.pdf (HEAD) ↔ main.pdf (Working Tree)"
      original={{ label: "HEAD", detail: "abc1234 · Ada", data: originalBytes }}
      modified={{ label: "Working Tree", data: modifiedBytes }}
      onClose={onClose}
      {...props}
    />,
  );
  return { ...view, onClose };
}

beforeEach(() => {
  loader.loadPdfForDiff.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PdfDiffView", () => {
  it("summarises the word changes and lists each one", async () => {
    setup();
    expect(screen.getByText("Comparing PDFs…")).toBeInTheDocument();
    expect(await screen.findByText("2 changes")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("−1")).toBeInTheDocument();
    const list = screen.getByRole("complementary", { name: "Changes" });
    const items = within(list).getAllByRole("button");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("robust");
    expect(within(items[1]).getByText("method").tagName).toBe("DEL");
    expect(within(items[1]).getByText("approach").tagName).toBe("INS");
    // Both versions are shown with their labels and page counts.
    expect(screen.getByRole("region", { name: "HEAD PDF" })).toHaveTextContent(
      "abc1234 · Ada",
    );
    expect(screen.getAllByText("2 pages")).toHaveLength(2);
  });

  it("highlights removed and added words on the pages", async () => {
    const { container } = setup();
    await screen.findByText("2 changes");
    const original = container.querySelector(".pdf-diff-column.is-original")!;
    const modified = container.querySelector(".pdf-diff-column.is-modified")!;
    expect(original.querySelectorAll(".pdf-diff-mark.is-removed")).toHaveLength(1);
    expect(original.querySelectorAll(".pdf-diff-mark.is-insert-point")).toHaveLength(1);
    expect(modified.querySelectorAll(".pdf-diff-mark.is-added")).toHaveLength(2);
    const mark = modified.querySelector<HTMLElement>(".pdf-diff-mark.is-added")!;
    expect(mark.style.left).toMatch(/%$/);
    expect(mark).toHaveAttribute("title", "Added in the newer version");
    expect(original.querySelector(".pdf-diff-mark.is-insert-point")).toHaveAttribute(
      "title",
      "Text was added here",
    );
  });

  it("steps through the changes with the buttons and keys", async () => {
    const { container, onClose } = setup();
    await screen.findByText("2 changes");
    const position = screen.getByLabelText("Current change");
    expect(position).toHaveTextContent("– / 2");
    fireEvent.click(screen.getByRole("button", { name: "Next change" }));
    expect(position).toHaveTextContent("1 / 2");
    expect(
      container.querySelectorAll(".pdf-diff-mark.is-active").length,
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Next change" }));
    expect(position).toHaveTextContent("2 / 2");
    fireEvent.click(screen.getByRole("button", { name: "Next change" }));
    expect(position).toHaveTextContent("1 / 2");
    fireEvent.click(screen.getByRole("button", { name: "Previous change" }));
    expect(position).toHaveTextContent("2 / 2");

    const view = container.querySelector(".pdf-diff-view")!;
    fireEvent.keyDown(view, { key: "n" });
    expect(position).toHaveTextContent("1 / 2");
    fireEvent.keyDown(view, { key: "p" });
    expect(position).toHaveTextContent("2 / 2");
    fireEvent.keyDown(view, { key: "ArrowDown", altKey: true });
    expect(position).toHaveTextContent("1 / 2");
    fireEvent.keyDown(view, { key: "ArrowUp", altKey: true });
    expect(position).toHaveTextContent("2 / 2");
    fireEvent.keyDown(view, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("starts from the last change when going backwards first", async () => {
    setup();
    await screen.findByText("2 changes");
    fireEvent.click(screen.getByRole("button", { name: "Previous change" }));
    expect(screen.getByLabelText("Current change")).toHaveTextContent("2 / 2");
  });

  it("selects a change from the list or from a highlight", async () => {
    const { container } = setup();
    await screen.findByText("2 changes");
    const list = screen.getByRole("complementary", { name: "Changes" });
    fireEvent.click(within(list).getAllByRole("button")[1]);
    expect(within(list).getAllByRole("button")[1]).toHaveClass("is-active");
    fireEvent.click(container.querySelector('.pdf-diff-mark[data-hunk="0"]')!);
    expect(within(list).getAllByRole("button")[0]).toHaveClass("is-active");
  });

  it("keeps the two columns scrolled together unless unlinked", async () => {
    const { container } = setup();
    await screen.findByText("2 changes");
    const [left, right] = Array.from(
      container.querySelectorAll<HTMLElement>(".pdf-diff-scroll"),
    );
    left.scrollTop = 900;
    fireEvent.scroll(left);
    expect(right.scrollTop).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Synchronize scrolling" }));
    right.scrollTop = 0;
    left.scrollTop = 1200;
    fireEvent.scroll(left);
    expect(right.scrollTop).toBe(0);
  });

  it("zooms, hides the list and swaps sides", async () => {
    const onSwap = vi.fn();
    const { container } = setup({ onSwap });
    await screen.findByText("2 changes");
    const page = () => container.querySelector<HTMLElement>(".pdf-diff-page")!;
    const width = parseFloat(page().style.width);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(parseFloat(page().style.width)).toBeGreaterThan(width);
    expect(screen.getByTitle("Fit width")).toHaveTextContent("110%");
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByTitle("Fit width")).toHaveTextContent("90%");
    fireEvent.click(screen.getByTitle("Fit width"));
    expect(screen.getByTitle("Fit width")).toHaveTextContent("100%");

    fireEvent.click(screen.getByRole("button", { name: "List of changes" }));
    expect(
      screen.queryByRole("complementary", { name: "Changes" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Swap sides" }));
    expect(onSwap).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close comparison" }));
  });

  it("explains when the text is identical", async () => {
    setup({}, ["same words", "same words"]);
    expect(await screen.findByText("No text changes")).toBeInTheDocument();
    expect(screen.getByText(/The text is the same/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next change" })).toBeDisabled();
  });

  it("shows a version without a PDF as empty", async () => {
    loader.loadPdfForDiff.mockResolvedValue(loaded("new text"));
    render(
      <PdfDiffView
        title="added.pdf"
        original={{
          label: "Empty",
          data: null,
          emptyMessage: "This version has no PDF.",
        }}
        modified={{ label: "Index", data: modifiedBytes }}
      />,
    );
    expect(await screen.findByText("This version has no PDF.")).toBeInTheDocument();
    expect(screen.getByText("1 change")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Close comparison" }),
    ).not.toBeInTheDocument();
  });

  it("reports PDFs that cannot be read", async () => {
    loader.loadPdfForDiff.mockRejectedValue(new Error("Invalid PDF structure"));
    render(
      <PdfDiffView
        title="broken"
        original={{ label: "A", data: originalBytes }}
        modified={{ label: "B", data: modifiedBytes }}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not read the PDFs: Invalid PDF structure",
    );
  });

  it("draws a pixel overlay of each page in visual mode", async () => {
    const { container } = setup();
    await screen.findByText("2 changes");
    fireEvent.click(screen.getByRole("button", { name: /Visual overlay/ }));
    expect(screen.getByRole("button", { name: /Visual overlay/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Only in HEAD")).toBeInTheDocument();
    expect(container.querySelectorAll(".pdf-diff-page.is-overlay")).toHaveLength(2);
    // The test canvas returns blank pixels for both versions.
    await waitFor(() =>
      expect(screen.getAllByText("No visual change")).toHaveLength(2),
    );
    // Choosing a change scrolls the overlay instead of the columns.
    fireEvent.click(screen.getByRole("button", { name: "Next change" }));
    expect(screen.getByLabelText("Current change")).toHaveTextContent("1 / 2");
    fireEvent.click(screen.getByRole("button", { name: /Side by side/ }));
    expect(container.querySelector(".pdf-diff-columns")).toBeInTheDocument();
  });

  it("marks overlay pages that exist in only one version", async () => {
    loader.loadPdfForDiff.mockImplementation(async (data: Uint8Array) =>
      data === originalBytes ? loaded("a", 1) : loaded("a", 2),
    );
    render(
      <PdfDiffView
        title="t"
        original={{ label: "A", data: originalBytes }}
        modified={{ label: "B", data: modifiedBytes }}
        initialMode="overlay"
      />,
    );
    expect(await screen.findByText("Only in the newer version")).toBeInTheDocument();
  });

  it("releases the PDFs when it closes", async () => {
    const documents: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
    loader.loadPdfForDiff.mockImplementation(async () => {
      const result = loaded("x");
      documents.push(
        result.document as unknown as { destroy: ReturnType<typeof vi.fn> },
      );
      return result;
    });
    const { unmount } = render(
      <PdfDiffView
        title="t"
        original={{ label: "A", data: originalBytes }}
        modified={{ label: "B", data: modifiedBytes }}
      />,
    );
    await screen.findByText("No text changes");
    await act(async () => unmount());
    expect(documents).toHaveLength(2);
    expect(
      documents.every((document) => document.destroy.mock.calls.length === 1),
    ).toBe(true);
  });
});
