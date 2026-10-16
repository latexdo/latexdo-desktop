import {
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";
import type { SyncTexPdfLocation } from "./types";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfClickLocation {
  page: number;
  x: number;
  y: number;
  word?: string;
}

export interface PdfPreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfPreviewOverlay {
  id: string;
  pageNumber: number;
  rects: PdfPreviewRect[];
  className?: string;
  title?: string;
}

interface PdfPreviewProps {
  data: Uint8Array;
  scale: number;
  rotation?: number;
  target: SyncTexPdfLocation | null;
  onNavigate?: (location: PdfClickLocation) => void;
  overlays?: PdfPreviewOverlay[];
}

interface PdfPageProps {
  document: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  rotation: number;
  target: SyncTexPdfLocation | null;
  onNavigate?: (location: PdfClickLocation) => void;
  overlays: PdfPreviewOverlay[];
}

interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const wordPattern = /[\p{L}\p{N}_'-]+/gu;

function wordsIn(text: string): Array<{ word: string; start: number; end: number }> {
  return Array.from(text.matchAll(wordPattern), (match) => ({
    word: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function wordAtPoint(event: React.MouseEvent): string | undefined {
  const element = event.target instanceof Element ? event.target : null;
  const span = element?.closest(".textLayer span");
  if (!(span instanceof HTMLElement)) {
    return undefined;
  }

  const text = span.textContent ?? "";
  const words = wordsIn(text);
  if (!words.length) {
    return undefined;
  }

  const pointDocument = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const range = pointDocument.caretRangeFromPoint?.(event.clientX, event.clientY);
  let offset = -1;
  if (range?.startContainer.nodeType === Node.TEXT_NODE) {
    offset = range.startOffset;
  }

  if (offset < 0) {
    const bounds = span.getBoundingClientRect();
    const ratio =
      bounds.width > 0
        ? Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
        : 0;
    offset = Math.round(text.length * ratio);
  }

  return (
    words.find(({ start, end }) => offset >= start && offset <= end)?.word ??
    words.reduce((nearest, word) =>
      Math.abs((word.start + word.end) / 2 - offset) <
      Math.abs((nearest.start + nearest.end) / 2 - offset)
        ? word
        : nearest,
    ).word
  );
}

function findWordHighlight(
  textLayer: HTMLElement,
  pageElement: HTMLElement,
  word: string,
  targetX: number,
  targetY: number,
): HighlightRect | null {
  const pageBounds = pageElement.getBoundingClientRect();
  let best:
    | {
        distance: number;
        rect: HighlightRect;
      }
    | undefined;

  for (const span of textLayer.querySelectorAll("span")) {
    const textNode = Array.from(span.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE,
    );
    const text = textNode?.textContent ?? "";
    let start = text.indexOf(word);

    while (textNode && start >= 0) {
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + word.length);
      const bounds = range.getBoundingClientRect();
      const rect = {
        left: bounds.left - pageBounds.left,
        top: bounds.top - pageBounds.top,
        width: bounds.width,
        height: bounds.height,
      };
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distance = Math.hypot(centerX - targetX, centerY - targetY);

      if (!best || distance < best.distance) {
        best = { distance, rect };
      }
      start = text.indexOf(word, start + word.length);
    }
  }

  return best?.rect ?? null;
}

function PdfPage({
  document: pdfDocument,
  pageNumber,
  scale,
  rotation,
  target,
  onNavigate,
  overlays,
}: PdfPageProps) {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [rendered, setRendered] = useState(false);
  const [highlight, setHighlight] = useState<HighlightRect | null>(null);
  const cssScale = scale / 100;

  useEffect(() => {
    const pageElement = pageRef.current;
    const canvas = canvasRef.current;
    const textLayerElement = textLayerRef.current;
    if (!pageElement || !canvas || !textLayerElement) {
      return;
    }

    let cancelled = false;
    let renderTask: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    setRendered(false);
    setHighlight(null);
    textLayerElement.replaceChildren();

    void pdfDocument
      .getPage(pageNumber)
      .then(async (page) => {
        if (cancelled) {
          return;
        }

        const viewport = page.getViewport({ scale: cssScale, rotation });
        const outputScale = window.devicePixelRatio || 1;
        pageElement.style.width = `${viewport.width}px`;
        pageElement.style.height = `${viewport.height}px`;
        pageElement.style.setProperty("--scale-factor", String(cssScale));
        pageElement.style.setProperty("--total-scale-factor", String(cssScale));
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const canvasContext = canvas.getContext("2d");
        if (!canvasContext) {
          throw new Error("Could not create the PDF canvas context.");
        }

        renderTask = page.render({
          canvasContext,
          viewport,
          transform:
            outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        textLayer = new TextLayer({
          textContentSource: await page.getTextContent(),
          container: textLayerElement,
          viewport,
        });

        await Promise.all([renderTask.promise, textLayer.render()]);
        if (!cancelled) {
          setRendered(true);
        }
      })
      .catch((error: unknown) => {
        if (
          !cancelled &&
          (error as { name?: string }).name !== "RenderingCancelledException"
        ) {
          console.error(`Could not render PDF page ${pageNumber}`, error);
        }
      });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [cssScale, pageNumber, pdfDocument, rotation]);

  useEffect(() => {
    if (!rendered || target?.page !== pageNumber || !pageRef.current) {
      if (target?.page !== pageNumber) {
        setHighlight(null);
      }
      return;
    }

    const targetX = target.x * cssScale;
    const targetY = target.y * cssScale;
    const exactHighlight =
      target.word && textLayerRef.current
        ? findWordHighlight(
            textLayerRef.current,
            pageRef.current,
            target.word,
            targetX,
            targetY,
          )
        : null;
    setHighlight(
      exactHighlight ?? {
        left: Math.max(0, targetX - 4),
        top: Math.max(0, targetY - Math.max(10, target.height * cssScale)),
        width: Math.max(8, Math.min(120, target.width * cssScale)),
        height: Math.max(12, target.height * cssScale),
      },
    );
    pageRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [cssScale, pageNumber, rendered, target]);

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onNavigate) {
      return;
    }
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    onNavigate({
      page: pageNumber,
      x: (event.clientX - bounds.left) / cssScale,
      y: (event.clientY - bounds.top) / cssScale,
      word: wordAtPoint(event),
    });
  };

  return (
    <div
      ref={pageRef}
      className={`pdf-page ${onNavigate ? "pdf-page-interactive" : ""}`}
      data-page-number={pageNumber}
      title={onNavigate ? "Double-click to jump to source" : undefined}
      onDoubleClick={onNavigate ? handleDoubleClick : undefined}
    >
      <canvas ref={canvasRef} />
      <div ref={textLayerRef} className="textLayer" />
      {overlays.length ? (
        <div className="pdf-user-annotation-layer" aria-hidden="true">
          {overlays.flatMap((overlay) =>
            overlay.rects.map((rect, rectIndex) => (
              <div
                key={`${overlay.id}:${rectIndex}`}
                className={`pdf-user-annotation ${overlay.className ?? ""}`}
                title={overlay.title}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.width * 100}%`,
                  height: `${rect.height * 100}%`,
                }}
              />
            )),
          )}
        </div>
      ) : null}
      {highlight ? (
        <div
          className="pdf-sync-highlight"
          style={{
            left: highlight.left,
            top: highlight.top,
            width: highlight.width,
            height: highlight.height,
          }}
        />
      ) : null}
      <span className="pdf-page-number">{pageNumber}</span>
    </div>
  );
}

export default function PdfPreview({
  data,
  scale,
  rotation = 0,
  target,
  onNavigate,
  overlays = [],
}: PdfPreviewProps) {
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const pdfDocumentRef = useRef<PDFDocumentProxy | null>(null);

  useEffect(() => {
    const loadingTask = getDocument({ data: data.slice() });
    let active = true;
    let loadedDocument: PDFDocumentProxy | null = null;
    setError("");

    void loadingTask.promise
      .then((document) => {
        loadedDocument = document;
        if (active) {
          const previousDocument = pdfDocumentRef.current;
          if (previousDocument && previousDocument !== document) {
            void previousDocument.destroy();
          }
          pdfDocumentRef.current = document;
          setPdfDocument(document);
        } else {
          void document.destroy();
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : "Could not load PDF",
          );
        }
      });

    return () => {
      active = false;
      if (!loadedDocument) {
        void loadingTask.destroy();
      }
    };
  }, [data]);

  useEffect(
    () => () => {
      const currentDocument = pdfDocumentRef.current;
      pdfDocumentRef.current = null;
      if (currentDocument) {
        void currentDocument.destroy();
      }
    },
    [],
  );

  if (error) {
    return <div className="pdf-error">{error}</div>;
  }
  if (!pdfDocument) {
    return <div className="pdf-loading">Loading PDF…</div>;
  }

  return (
    <div className="pdf-document">
      {Array.from({ length: pdfDocument.numPages }, (_, index) => (
        <PdfPage
          key={index + 1}
          document={pdfDocument}
          pageNumber={index + 1}
          scale={scale}
          rotation={rotation}
          target={target}
          onNavigate={onNavigate}
          overlays={overlays.filter((overlay) => overlay.pageNumber === index + 1)}
        />
      ))}
    </div>
  );
}
