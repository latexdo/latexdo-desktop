import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PdfPreview from "./PdfPreview";

const pdfjsMock = vi.hoisted(() => {
  type MockPdfPage = {
    getViewport: (options: { scale: number; rotation?: number }) => {
      width: number;
      height: number;
    };
    render: () => { promise: Promise<void>; cancel: ReturnType<typeof vi.fn> };
    getTextContent: () => Promise<{ items: unknown[] }>;
  };

  type MockPdfDocument = {
    numPages: number;
    destroy: ReturnType<typeof vi.fn>;
    getPage: (pageNumber: number) => Promise<MockPdfPage>;
  };

  type LoadingTask = {
    promise: Promise<MockPdfDocument>;
    resolve: (document: MockPdfDocument) => void;
    reject: (error: unknown) => void;
    destroy: ReturnType<typeof vi.fn>;
  };

  const tasks: LoadingTask[] = [];

  return {
    tasks,
    createDocument: (_label: string, pages = 1): MockPdfDocument => {
      const pageMap = new Map<number, MockPdfPage>();
      return {
        numPages: pages,
        destroy: vi.fn(() => Promise.resolve()),
        getPage: vi.fn(async (pageNumber) => {
          let page = pageMap.get(pageNumber);
          if (!page) {
            page = {
              getViewport: vi.fn(() => ({ width: 100, height: 200 })),
              render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
              getTextContent: async () => ({ items: [] }),
            };
            pageMap.set(pageNumber, page);
          }
          return page;
        }),
      };
    },
    getDocument: vi.fn(() => {
      let resolveTask: LoadingTask["resolve"] = () => {};
      let rejectTask: LoadingTask["reject"] = () => {};
      const promise = new Promise<MockPdfDocument>((resolve, reject) => {
        resolveTask = resolve;
        rejectTask = reject;
      });
      const task: LoadingTask = {
        promise,
        resolve: resolveTask,
        reject: rejectTask,
        destroy: vi.fn(() => Promise.resolve()),
      };
      tasks.push(task);
      return task;
    }),
    TextLayer: class {
      render = vi.fn(() => Promise.resolve());
      cancel = vi.fn();
    },
  };
});

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  TextLayer: pdfjsMock.TextLayer,
  getDocument: pdfjsMock.getDocument,
}));

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "pdf.worker.js",
}));

function renderPreview(data: Uint8Array) {
  return render(
    <PdfPreview data={data} scale={100} target={null} onNavigate={vi.fn()} />,
  );
}

describe("PdfPreview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  });
  beforeEach(() => {
    pdfjsMock.tasks.splice(0);
    pdfjsMock.getDocument.mockClear();
  });

  it("highlights a matched word and retains page-local annotation overlays", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    const data = new Uint8Array([1]);
    const props = { data, scale: 100, target: null };
    const h = render(<PdfPreview {...props} />);
    const documentProxy = pdfjsMock.createDocument("highlight", 2);
    pdfjsMock.tasks[0].resolve(documentProxy);
    await screen.findByText("2");
    await act(async () => {});
    const page = h.container.querySelector(".pdf-page")!;
    const layer = page.querySelector(".textLayer")!;
    layer.innerHTML = "<span>before hyphen-</span><span>ated after</span><span></span>";
    const bounds = {
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 60,
      bottom: 32,
      width: 50,
      height: 12,
      toJSON: () => ({}),
    };
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => bounds,
    });
    const target = {
      page: 1,
      x: 10,
      y: 32,
      h: 10,
      v: 32,
      width: 50,
      height: 12,
      word: "hyphenated",
      before: ["before"],
      after: ["after"],
      boxes: [{ h: 10, v: 32, width: 50, height: 12 }],
    };
    h.rerender(
      <PdfPreview
        {...props}
        target={target}
        overlays={[
          {
            id: "note",
            pageNumber: 2,
            title: "Review note",
            rects: [{ x: 5, y: 10, width: 20, height: 30 }],
          },
        ]}
      />,
    );
    await waitFor(() =>
      expect(h.container.querySelector(".pdf-sync-highlight")).toHaveStyle({
        left: "10px",
        top: "20px",
        width: "50px",
      }),
    );
    expect(screen.getByTitle("Review note")).toBeVisible();
    h.rerender(
      <PdfPreview {...props} target={{ ...target, page: 2, word: "absent" }} />,
    );
    await waitFor(() =>
      expect(h.container.querySelectorAll(".pdf-sync-highlight")).toHaveLength(1),
    );
    expect(page.querySelector(".pdf-sync-highlight")).toBeNull();
  });
  it.each([new Error("Broken PDF"), "unknown"])(
    "reports loading errors",
    async (error) => {
      renderPreview(new Uint8Array([1]));
      pdfjsMock.tasks[0].reject(error);
      expect(
        await screen.findByText(
          error instanceof Error ? error.message : "Could not load PDF",
        ),
      ).toBeVisible();
    },
  );
  it("destroys late-loading documents after unmount", async () => {
    const h = renderPreview(new Uint8Array([1]));
    const task = pdfjsMock.tasks[0];
    h.unmount();
    expect(task.destroy).toHaveBeenCalledOnce();
    const late = pdfjsMock.createDocument("late");
    await act(async () => task.resolve(late));
    expect(late.destroy).toHaveBeenCalledOnce();
  });
  it("navigates to the clicked word on a single click without hijacking text selection", async () => {
    const onNavigate = vi.fn();
    render(
      <PdfPreview
        data={new Uint8Array([1])}
        scale={100}
        target={null}
        onNavigate={onNavigate}
      />,
    );
    pdfjsMock.tasks[0].resolve(pdfjsMock.createDocument("click"));
    const page = await screen.findByTitle("Click a word to jump to its TeX source");
    const span = document.createElement("span");
    span.textContent = "First exact word then last";
    page.querySelector(".textLayer")!.append(span);
    const node = span.firstChild!;
    const range = document.createRange();
    range.setStart(node, 7);
    range.collapse(true);
    Object.defineProperty(document, "caretRangeFromPoint", {
      configurable: true,
      value: () => range,
    });
    try {
      fireEvent.mouseDown(span, { clientX: 42, clientY: 84 });
      fireEvent.click(span, { clientX: 42, clientY: 84, detail: 1 });
      expect(onNavigate).toHaveBeenCalledOnce();
      expect(onNavigate).toHaveBeenCalledWith({
        page: 1,
        x: 42,
        y: 84,
        word: "exact",
        before: ["first"],
        after: ["word", "then", "last"],
      });
      onNavigate.mockClear();
      fireEvent.mouseDown(span, { clientX: 42, clientY: 84 });
      fireEvent.click(span, { clientX: 100, clientY: 84, detail: 1 });
      expect(onNavigate).not.toHaveBeenCalled();
      range.setEnd(node, 10);
      window.getSelection()!.addRange(range);
      fireEvent.click(span, { clientX: 42, clientY: 84, detail: 1 });
      expect(onNavigate).not.toHaveBeenCalled();
    } finally {
      window.getSelection()!.removeAllRanges();
      Reflect.deleteProperty(document, "caretRangeFromPoint");
    }
  });

  it("keeps the current PDF mounted while refreshed data is loading", async () => {
    const { rerender } = renderPreview(new Uint8Array([1]));

    expect(screen.getByText(/Loading PDF/)).toBeInTheDocument();
    const firstDocument = pdfjsMock.createDocument("first");
    pdfjsMock.tasks[0].resolve(firstDocument);

    await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
    expect(screen.queryByText(/Loading PDF/)).not.toBeInTheDocument();

    rerender(
      <PdfPreview
        data={new Uint8Array([2])}
        scale={100}
        target={null}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Loading PDF/)).not.toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(firstDocument.destroy).not.toHaveBeenCalled();

    const secondDocument = pdfjsMock.createDocument("second");
    pdfjsMock.tasks[1].resolve(secondDocument);

    await waitFor(() => expect(firstDocument.destroy).toHaveBeenCalledTimes(1));
  });

  it("passes rotation into pdf.js viewports", async () => {
    render(
      <PdfPreview
        data={new Uint8Array([1])}
        scale={125}
        rotation={90}
        target={null}
        onNavigate={vi.fn()}
      />,
    );

    const document = pdfjsMock.createDocument("rotated");
    pdfjsMock.tasks[0].resolve(document);

    await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
    const page = await document.getPage(1);
    // The page label renders before the page is drawn, which happens after
    // getPage() resolves in an effect, so wait for the viewport call.
    await waitFor(() =>
      expect(page.getViewport).toHaveBeenCalledWith({ scale: 1.25, rotation: 90 }),
    );
  });
});
