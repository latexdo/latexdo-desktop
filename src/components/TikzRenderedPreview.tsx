import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** The figure as LaTeX drew it: the first page of the compiled PDF. */
export function TikzRenderedPreview({ data }: { data: Uint8Array }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    setFailed(false);
    const loading = getDocument({ data: data.slice() });
    void (async () => {
      try {
        const document: PDFDocumentProxy = await loading.promise;
        if (cancelled) return;
        const page = await document.getPage(1);
        const base = page.getViewport({ scale: 1 });
        // Shown at up to twice its natural size, so draw it that sharp.
        const ratio = (window.devicePixelRatio || 1) * 2;
        const viewport = page.getViewport({ scale: ratio });
        const context = canvas.getContext("2d");
        if (!context || cancelled) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.aspectRatio = `${base.width} / ${base.height}`;
        canvas.style.maxWidth = `${Math.max(base.width * 2, 240)}px`;
        task = page.render({ canvasContext: context, viewport });
        await task.promise;
      } catch (error) {
        if (
          !cancelled &&
          !(error instanceof Error && error.name === "RenderingCancelledException")
        ) {
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
      (task as RenderTask | null)?.cancel();
      void loading.destroy();
    };
  }, [data]);

  return failed ? (
    <p className="tikz-render-message" role="alert">
      The figure compiled, but its PDF could not be displayed.
    </p>
  ) : (
    <canvas
      ref={canvasRef}
      className="tikz-render-canvas"
      aria-label="Rendered figure"
    />
  );
}
