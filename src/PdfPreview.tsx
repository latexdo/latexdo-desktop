import {
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";
import type { SyncTexBox, SyncTexPdfLocation } from "./types";
import {
  contextAt,
  contextScore,
  normalizeWord,
  textWords,
  wordSimilarity,
  type WordContext,
} from "./features/pdf/wordMatch";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfClickLocation {
  page: number;
  x: number;
  y: number;
  word?: string;
  /** The clicked word's neighbours, to find the exact occurrence in the source. */
  before?: string[];
  after?: string[];
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

/** Pages this far outside the visible area are drawn ahead of scrolling. */
const pagePreloadMargin = "1200px 0px";

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/** True once the page is on screen or about to be; drawing waits for it. */
function useNearViewport(ref: React.RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setNear(entries.some((entry) => entry.isIntersecting)),
      { root: scrollParent(element), rootMargin: pagePreloadMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return near;
}

interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PageWordPart {
  node: Text;
  start: number;
  end: number;
}

interface PageWord {
  word: string;
  norm: string;
  parts: PageWordPart[];
}

/**
 * The words of a rendered page in reading order. A word broken by a hyphen at
 * the end of a PDF line ("vex-" / "ingly") is joined into one.
 */
function pageWords(textLayer: HTMLElement): PageWord[] {
  const words: PageWord[] = [];
  let hyphenPending = false;
  for (const span of textLayer.querySelectorAll("span")) {
    const node = Array.from(span.childNodes).find(
      (child): child is Text => child.nodeType === Node.TEXT_NODE,
    );
    const text = node?.textContent ?? "";
    if (!node || !text) continue;
    const found = textWords(text);
    found.forEach((item, index) => {
      const part = { node, start: item.start, end: item.end };
      const previous = words[words.length - 1];
      if (hyphenPending && index === 0 && previous) {
        previous.word += item.word;
        previous.norm = normalizeWord(previous.word);
        previous.parts.push(part);
      } else {
        words.push({ word: item.word, norm: normalizeWord(item.word), parts: [part] });
      }
      hyphenPending = false;
    });
    const last = found[found.length - 1];
    if (last && /^[-\u00ad\u2010]\s*$/.test(text.slice(last.end))) hyphenPending = true;
    else if (text.trim()) hyphenPending = false;
  }
  return words;
}

function partRect(part: PageWordPart, pageBounds: DOMRect): HighlightRect {
  const range = document.createRange();
  range.setStart(part.node, part.start);
  range.setEnd(part.node, part.end);
  const bounds = range.getBoundingClientRect();
  return {
    left: bounds.left - pageBounds.left,
    top: bounds.top - pageBounds.top,
    width: bounds.width,
    height: bounds.height,
  };
}

/** The word under a click, with its neighbours on the page. */
function wordAtPoint(
  event: React.MouseEvent,
  textLayer: HTMLElement | null,
): WordContext | undefined {
  const element = event.target instanceof Element ? event.target : null;
  const span = element?.closest(".textLayer span");
  if (!(span instanceof HTMLElement) || !textLayer) {
    return undefined;
  }
  const node = Array.from(span.childNodes).find(
    (child): child is Text => child.nodeType === Node.TEXT_NODE,
  );
  if (!node) return undefined;

  const pointDocument = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const range = pointDocument.caretRangeFromPoint?.(event.clientX, event.clientY);
  let offset = range?.startContainer === node ? range.startOffset : -1;
  if (offset < 0) {
    const bounds = span.getBoundingClientRect();
    const ratio =
      bounds.width > 0
        ? Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
        : 0;
    offset = Math.round((node.textContent ?? "").length * ratio);
  }

  const words = pageWords(textLayer);
  let best = -1;
  let bestDistance = Infinity;
  words.forEach((word, index) => {
    for (const part of word.parts) {
      if (part.node !== node) continue;
      const distance =
        offset < part.start
          ? part.start - offset
          : offset > part.end
            ? offset - part.end
            : 0;
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
  });
  return best < 0 ? undefined : contextAt(words, best);
}

function boxRect(box: SyncTexBox, cssScale: number): HighlightRect {
  return {
    left: box.h * cssScale,
    top: (box.v - box.height) * cssScale,
    width: box.width * cssScale,
    height: box.height * cssScale,
  };
}

function distanceToRect(x: number, y: number, rect: HighlightRect): number {
  const dx = Math.max(rect.left - x, 0, x - (rect.left + rect.width));
  const dy = Math.max(rect.top - y, 0, y - (rect.top + rect.height));
  return Math.hypot(dx, dy);
}

/**
 * The exact occurrence of the source word on this page: same word, same
 * neighbours, closest to the lines SyncTeX named.
 */
function findWordHighlight(
  textLayer: HTMLElement,
  pageElement: HTMLElement,
  target: SyncTexPdfLocation,
  cssScale: number,
): HighlightRect | null {
  if (!target.word) return null;
  const wanted = normalizeWord(target.word);
  const context: WordContext = {
    word: target.word,
    before: target.before ?? [],
    after: target.after ?? [],
  };
  const pageBounds = pageElement.getBoundingClientRect();
  const boxes = (
    target.boxes?.length
      ? target.boxes
      : [{ h: target.h, v: target.v, width: target.width, height: target.height }]
  ).map((box) => boxRect(box, cssScale));
  const lineHeight = Math.max(8, ...boxes.map((box) => box.height));
  const words = pageWords(textLayer);
  let best: { score: number; rect: HighlightRect } | null = null;
  words.forEach((word, index) => {
    const similarity = wordSimilarity(word.norm, wanted);
    if (!similarity) return;
    const rect = partRect(word.parts[0]!, pageBounds);
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distance = Math.min(
      ...boxes.map((box) => distanceToRect(centerX, centerY, box)),
    );
    const score =
      similarity * 3 +
      contextScore(words, index, context) * 4 -
      (distance / lineHeight) * 0.5;
    if (!best || score > best.score) best = { score, rect };
  });
  return (best as { rect: HighlightRect } | null)?.rect ?? null;
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
  // Only pages near the visible area are drawn. Every page still gets its
  // size up front, so scrolling and the scrollbar behave as before.
  const nearViewport = useNearViewport(pageRef);

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
        if (!nearViewport) {
          // Free the drawing of a page far away; it is drawn again when needed.
          canvas.width = 0;
          canvas.height = 0;
          return;
        }
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
  }, [cssScale, nearViewport, pageNumber, pdfDocument, rotation]);

  useEffect(() => {
    if (!rendered || target?.page !== pageNumber || !pageRef.current) {
      if (target?.page !== pageNumber) {
        setHighlight(null);
      }
      return;
    }

    const targetX = target.x * cssScale;
    const targetY = target.y * cssScale;
    const exactHighlight = textLayerRef.current
      ? findWordHighlight(textLayerRef.current, pageRef.current, target, cssScale)
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

  const mouseDownRef = useRef<{ x: number; y: number } | null>(null);
  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const start = mouseDownRef.current;
    mouseDownRef.current = null;
    const selection = window.getSelection();
    const dragged =
      start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5;
    const selectedText =
      selection &&
      !selection.isCollapsed &&
      event.currentTarget.contains(selection.anchorNode);
    if (!onNavigate || event.detail > 1 || dragged || selectedText) {
      return;
    }
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const context = wordAtPoint(event, textLayerRef.current);
    onNavigate({
      page: pageNumber,
      x: (event.clientX - bounds.left) / cssScale,
      y: (event.clientY - bounds.top) / cssScale,
      ...(context
        ? { word: context.word, before: context.before, after: context.after }
        : {}),
    });
  };

  return (
    <div
      ref={pageRef}
      className={`pdf-page ${onNavigate ? "pdf-page-interactive" : ""}`}
      data-page-number={pageNumber}
      title={onNavigate ? "Click a word to jump to its TeX source" : undefined}
      onMouseDown={
        onNavigate
          ? (event) => {
              mouseDownRef.current = { x: event.clientX, y: event.clientY };
            }
          : undefined
      }
      onClick={onNavigate ? handleClick : undefined}
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
