import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const pdfjs = vi.hoisted(() => {
  const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 100 * scale,
      height: 50 * scale,
    }),
    render,
  };
  return {
    render,
    getDocument: vi.fn(() => ({
      promise: Promise.resolve({ getPage: async () => page }),
      destroy: vi.fn(() => Promise.resolve()),
    })),
  };
});

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: pdfjs.getDocument,
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));

import { TikzRenderedPreview } from "./TikzRenderedPreview";

describe("TikzRenderedPreview", () => {
  it("draws the first page of the figure's PDF", async () => {
    render(<TikzRenderedPreview data={new Uint8Array([1])} />);
    const canvas = screen.getByLabelText("Rendered figure") as HTMLCanvasElement;
    await waitFor(() => expect(pdfjs.render).toHaveBeenCalled());
    expect(canvas.style.aspectRatio).toBe("100 / 50");
    expect(canvas.width).toBeGreaterThan(100);
  });

  it("says so when the PDF cannot be displayed", async () => {
    pdfjs.getDocument.mockReturnValueOnce({
      promise: Promise.reject(new Error("bad pdf")),
      destroy: vi.fn(() => Promise.resolve()),
    });
    render(<TikzRenderedPreview data={new Uint8Array([1])} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The figure compiled, but its PDF could not be displayed.",
    );
  });
});
