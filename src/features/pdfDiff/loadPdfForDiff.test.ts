import { describe, expect, it, vi } from "vitest";

const pdfjs = vi.hoisted(() => {
  const pages = [
    [
      { str: "A careful compar-", transform: [10, 0, 0, 10, 50, 700], width: 102 },
      { str: "ison", transform: [10, 0, 0, 10, 50, 686], width: 24 },
      { type: "marked-content" },
    ],
    [{ str: "Next page", transform: [10, 0, 0, 10, 50, 700], width: 54 }],
  ];
  const destroy = vi.fn(() => Promise.resolve());
  const document = {
    numPages: pages.length,
    getPage: vi.fn(async (pageNumber: number) => ({
      getViewport: () => ({
        width: 600,
        height: 800,
        scale: 1,
        transform: [1, 0, 0, -1, 0, 800],
      }),
      getTextContent: async () => ({ items: pages[pageNumber - 1] }),
    })),
  };
  return {
    destroy,
    document,
    getDocument: vi.fn(() => ({ promise: Promise.resolve(document), destroy })),
  };
});

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: pdfjs.getDocument,
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));

import { loadPdfForDiff } from "./loadPdfForDiff";

describe("loadPdfForDiff", () => {
  it("reads every page's words and sizes, joining hyphenation", async () => {
    const data = new Uint8Array([1, 2, 3]);
    const result = await loadPdfForDiff(data);
    expect(result.words.map((word) => [word.key, word.page])).toEqual([
      ["A", 1],
      ["careful", 1],
      ["comparison", 1],
      ["Next", 2],
      ["page", 2],
    ]);
    expect(result.pageSizes).toEqual([
      { width: 600, height: 800 },
      { width: 600, height: 800 },
    ]);
    // pdf.js gets a copy, so the caller's bytes survive the worker transfer.
    const passed = (
      pdfjs.getDocument.mock.calls[0] as unknown as [{ data: Uint8Array }]
    )[0].data;
    expect(passed).not.toBe(data);
    expect([...passed]).toEqual([1, 2, 3]);
  });

  it("stops and destroys the task when aborted", async () => {
    const controller = new AbortController();
    const pending = loadPdfForDiff(new Uint8Array([1]), controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow("Aborted");
    expect(pdfjs.destroy).toHaveBeenCalled();
  });
});
