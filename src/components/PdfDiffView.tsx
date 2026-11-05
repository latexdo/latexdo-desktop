import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Columns2,
  Layers,
  LoaderCircle,
  Link2,
  Link2Off,
  ListTree,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { loadPdfForDiff, type LoadedDiffPdf } from "../features/pdfDiff/loadPdfForDiff";
import {
  diffPdfWords,
  type PdfDiffHighlight,
  type PdfDiffHunk,
  type PdfTextDiffResult,
} from "../features/pdfDiff/pdfTextDiff";
import { computePixelDiff, type RgbaImage } from "../features/pdfDiff/pixelDiff";
import type { PdfDiffSource } from "../features/pdfDiff/pdfDiffStore";

export type PdfDiffMode = "side-by-side" | "overlay";

export interface PdfDiffViewProps {
  title: string;
  original: PdfDiffSource;
  modified: PdfDiffSource;
  onClose?: () => void;
  /** Swap the two sides (the host re-renders with them exchanged). */
  onSwap?: () => void;
  initialMode?: PdfDiffMode;
}

type Side = "original" | "modified";

interface LoadedSides {
  original: LoadedDiffPdf | null;
  modified: LoadedDiffPdf | null;
  diff: PdfTextDiffResult;
}

const pageGap = 16;
/** Matches the width of `.pdf-diff-list` in styles.css. */
const hunkListWidth = 280;
const minZoom = 50;
const maxZoom = 250;
/** Largest page width, in device pixels, drawn for the pixel overlay. */
const maxOverlayPixels = 1600;

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

function useNearViewport(ref: RefObject<HTMLElement | null>): boolean {
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
      { root: scrollParent(element), rootMargin: "800px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return near;
}

/** Width available to a page column, so pages can fit it. */
function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

async function renderPageToCanvas(
  document: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  maxPixels = Infinity,
  onTask?: (task: RenderTask) => void,
): Promise<boolean> {
  const page = await document.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const scale = Math.min((cssWidth / base.width) * ratio, maxPixels / base.width);
  const viewport = page.getViewport({ scale });
  const context = canvas.getContext("2d");
  if (!context) return false;
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const task = page.render({ canvasContext: context, viewport });
  onTask?.(task);
  await task.promise;
  return true;
}

function paintPixels(canvas: HTMLCanvasElement, image: RgbaImage): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  if (typeof ImageData === "function") {
    context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
    return;
  }
  const target = context.createImageData?.(image.width, image.height);
  if (!target) return;
  target.data.set(image.data);
  context.putImageData(target, 0, 0);
}

function isCancel(error: unknown): boolean {
  return error instanceof Error && error.name === "RenderingCancelledException";
}

interface DiffPageProps {
  document: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  height: number;
  highlights: PdfDiffHighlight[];
  activeHunk: number | null;
  onSelectHunk: (hunkId: number) => void;
  side: Side;
}

function DiffPage({
  document,
  pageNumber,
  width,
  height,
  highlights,
  activeHunk,
  onSelectHunk,
  side,
}: DiffPageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const near = useNearViewport(containerRef);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!near || !canvas || width <= 0) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    void renderPageToCanvas(document, pageNumber, canvas, width, Infinity, (next) => {
      task = next;
    })
      .then((ok) => {
        if (!cancelled && ok) setDrawn(true);
      })
      .catch((error: unknown) => {
        if (!isCancel(error)) console.warn("PDF compare: page render failed", error);
      });
    return () => {
      cancelled = true;
      (task as RenderTask | null)?.cancel();
    };
  }, [document, near, pageNumber, width]);

  return (
    <div
      ref={containerRef}
      className="pdf-diff-page"
      data-page={pageNumber}
      style={{ width, height }}
    >
      <canvas ref={canvasRef} aria-label={`Page ${pageNumber}`} />
      {!drawn ? <div className="pdf-diff-page-placeholder" aria-hidden="true" /> : null}
      <div className="pdf-diff-marks">
        {highlights.map((mark) => (
          <button
            type="button"
            key={mark.id}
            className={`pdf-diff-mark is-${mark.kind} ${
              activeHunk === mark.hunkId ? "is-active" : ""
            }`}
            data-hunk={mark.hunkId}
            style={{
              left: `${mark.rect.x * 100}%`,
              top: `${mark.rect.y * 100}%`,
              width:
                mark.kind === "insert-point" ? undefined : `${mark.rect.width * 100}%`,
              height: `${mark.rect.height * 100}%`,
            }}
            onClick={() => onSelectHunk(mark.hunkId)}
            title={
              mark.kind === "removed"
                ? "Removed in the newer version"
                : mark.kind === "added"
                  ? "Added in the newer version"
                  : side === "original"
                    ? "Text was added here"
                    : "Text was removed here"
            }
            aria-label={`Change ${mark.hunkId + 1}`}
          />
        ))}
      </div>
      <span className="pdf-diff-page-number">{pageNumber}</span>
    </div>
  );
}

interface OverlayPageProps {
  original: PDFDocumentProxy | null;
  modified: PDFDocumentProxy | null;
  pageNumber: number;
  width: number;
  height: number;
}

function OverlayPage({
  original,
  modified,
  pageNumber,
  width,
  height,
}: OverlayPageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const near = useNearViewport(containerRef);
  const [status, setStatus] = useState<string>("Comparing…");

  useEffect(() => {
    const target = canvasRef.current;
    if (!near || !target || width <= 0) return;
    let cancelled = false;
    const tasks: RenderTask[] = [];
    const draw = async (
      document: PDFDocumentProxy | null,
    ): Promise<RgbaImage | null> => {
      if (!document || pageNumber > document.numPages) return null;
      const canvas = window.document.createElement("canvas");
      await renderPageToCanvas(
        document,
        pageNumber,
        canvas,
        width,
        maxOverlayPixels,
        (task) => tasks.push(task),
      );
      const pixels = canvas
        .getContext("2d")
        ?.getImageData(0, 0, canvas.width, canvas.height);
      return pixels
        ? { width: canvas.width, height: canvas.height, data: pixels.data }
        : null;
    };
    void (async () => {
      try {
        const [before, after] = await Promise.all([draw(original), draw(modified)]);
        if (cancelled) return;
        const blank = (other: RgbaImage | null): RgbaImage => {
          const w = other?.width ?? 1;
          const h = other?.height ?? 1;
          return {
            width: w,
            height: h,
            data: new Uint8ClampedArray(w * h * 4).fill(255),
          };
        };
        const result = computePixelDiff(before ?? blank(after), after ?? blank(before));
        target.width = result.width;
        target.height = result.height;
        paintPixels(target, result);
        setStatus(
          !before
            ? "Only in the newer version"
            : !after
              ? "Only in the older version"
              : result.changedPixels === 0
                ? "No visual change"
                : `${Math.max(0.1, result.changedRatio * 100).toFixed(1)}% of the page changed`,
        );
      } catch (error) {
        if (!isCancel(error) && !cancelled) {
          setStatus("Could not draw this page");
          console.warn("PDF compare: overlay failed", error);
        }
      }
    })();
    return () => {
      cancelled = true;
      tasks.forEach((task) => task.cancel());
    };
  }, [modified, near, original, pageNumber, width]);

  return (
    <div className="pdf-diff-overlay-page-wrap">
      <div
        ref={containerRef}
        className="pdf-diff-page is-overlay"
        data-page={pageNumber}
        style={{ width, height }}
      >
        <canvas ref={canvasRef} aria-label={`Visual difference, page ${pageNumber}`} />
        <span className="pdf-diff-page-number">{pageNumber}</span>
      </div>
      <span className="pdf-diff-overlay-status">{status}</span>
    </div>
  );
}

function pageBoxes(
  loaded: LoadedDiffPdf | null,
  columnWidth: number,
  zoom: number,
): Array<{ width: number; height: number }> {
  if (!loaded) return [];
  const widest = Math.max(...loaded.pageSizes.map((size) => size.width), 1);
  const fit = Math.max(120, columnWidth - 32) / widest;
  const scale = fit * (zoom / 100);
  return loaded.pageSizes.map((size) => ({
    width: Math.round(size.width * scale),
    height: Math.round(size.height * scale),
  }));
}

function pageOffset(boxes: Array<{ height: number }>, pageNumber: number): number {
  let offset = pageGap;
  for (let index = 0; index < pageNumber - 1 && index < boxes.length; index += 1) {
    offset += boxes[index].height + pageGap;
  }
  return offset;
}

/** Page index and fraction through it at a scroll position. */
function positionAt(
  boxes: Array<{ height: number }>,
  scrollTop: number,
): { page: number; fraction: number } {
  let offset = pageGap;
  for (let index = 0; index < boxes.length; index += 1) {
    const end = offset + boxes[index].height + pageGap;
    if (scrollTop < end || index === boxes.length - 1) {
      return {
        page: index + 1,
        fraction: Math.min(1, Math.max(0, (scrollTop - offset) / boxes[index].height)),
      };
    }
    offset = end;
  }
  return { page: 1, fraction: 0 };
}

function summaryText(diff: PdfTextDiffResult): string {
  const count = diff.hunks.length;
  if (!count) return "No text changes";
  return `${count} ${count === 1 ? "change" : "changes"}`;
}

function pagesText(pages: number[]): string {
  if (!pages.length) return "none";
  if (pages.length > 8) return `${pages.slice(0, 8).join(", ")}, …`;
  return pages.join(", ");
}

interface ColumnProps {
  side: Side;
  source: PdfDiffSource;
  loaded: LoadedDiffPdf | null;
  boxes: Array<{ width: number; height: number }>;
  highlights: Map<number, PdfDiffHighlight[]>;
  activeHunk: number | null;
  onSelectHunk: (hunkId: number) => void;
  columnRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}

function DiffColumn({
  side,
  source,
  loaded,
  boxes,
  highlights,
  activeHunk,
  onSelectHunk,
  columnRef,
  onScroll,
}: ColumnProps) {
  return (
    <section
      className={`pdf-diff-column is-${side}`}
      aria-label={`${source.label} PDF`}
    >
      <header className="pdf-diff-column-header">
        <span className={`pdf-diff-side-dot is-${side}`} aria-hidden="true" />
        <strong title={source.label}>{source.label}</strong>
        {source.detail ? <small title={source.detail}>{source.detail}</small> : null}
        {loaded ? (
          <small className="pdf-diff-page-count">
            {loaded.pageSizes.length} {loaded.pageSizes.length === 1 ? "page" : "pages"}
          </small>
        ) : null}
      </header>
      <div className="pdf-diff-scroll" ref={columnRef} onScroll={onScroll}>
        {loaded ? (
          <div
            className="pdf-diff-pages"
            style={{ gap: pageGap, padding: `${pageGap}px 0` }}
          >
            {boxes.map((box, index) => (
              <DiffPage
                key={index + 1}
                document={loaded.document}
                pageNumber={index + 1}
                width={box.width}
                height={box.height}
                highlights={highlights.get(index + 1) ?? []}
                activeHunk={activeHunk}
                onSelectHunk={onSelectHunk}
                side={side}
              />
            ))}
          </div>
        ) : (
          <div className="pdf-diff-empty-side" role="status">
            {source.emptyMessage ?? "No PDF"}
          </div>
        )}
      </div>
    </section>
  );
}

function HunkList({
  hunks,
  activeHunk,
  onSelect,
}: {
  hunks: PdfDiffHunk[];
  activeHunk: number | null;
  onSelect: (hunkId: number) => void;
}) {
  const listRef = useRef<HTMLOListElement | null>(null);
  useEffect(() => {
    if (activeHunk === null) return;
    listRef.current
      ?.querySelector(`[data-hunk-item="${activeHunk}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeHunk]);

  if (!hunks.length) {
    return (
      <p className="pdf-diff-list-empty">
        The text is the same. Use Visual overlay to look for changes in figures, tables
        or layout.
      </p>
    );
  }
  return (
    <ol className="pdf-diff-hunk-list" ref={listRef}>
      {hunks.map((hunk) => (
        <li key={hunk.id}>
          <button
            type="button"
            className={`pdf-diff-hunk is-${hunk.kind} ${
              activeHunk === hunk.id ? "is-active" : ""
            }`}
            data-hunk-item={hunk.id}
            onClick={() => onSelect(hunk.id)}
          >
            <span className="pdf-diff-hunk-meta">
              <span>#{hunk.id + 1}</span>
              <span>
                p. {hunk.originalPage ?? "–"} → {hunk.modifiedPage ?? "–"}
              </span>
            </span>
            <span className="pdf-diff-hunk-text">
              {hunk.contextBefore ? (
                <span className="pdf-diff-context">…{hunk.contextBefore} </span>
              ) : null}
              {hunk.removedText ? <del>{hunk.removedText}</del> : null}
              {hunk.removedText && hunk.addedText ? " " : null}
              {hunk.addedText ? <ins>{hunk.addedText}</ins> : null}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export function PdfDiffView({
  title,
  original,
  modified,
  onClose,
  onSwap,
  initialMode = "side-by-side",
}: PdfDiffViewProps) {
  const [loaded, setLoaded] = useState<LoadedSides | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<PdfDiffMode>(initialMode);
  const [zoom, setZoom] = useState(100);
  const [syncScroll, setSyncScroll] = useState(true);
  const [listOpen, setListOpen] = useState(true);
  const [activeHunk, setActiveHunk] = useState<number | null>(null);
  const originalColumnRef = useRef<HTMLDivElement | null>(null);
  const modifiedColumnRef = useRef<HTMLDivElement | null>(null);
  const overlayColumnRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const programmaticScroll = useRef<Side | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let documents: LoadedDiffPdf[] = [];
    setLoaded(null);
    setError(null);
    setActiveHunk(null);
    void (async () => {
      try {
        const [before, after] = await Promise.all([
          original.data ? loadPdfForDiff(original.data, controller.signal) : null,
          modified.data ? loadPdfForDiff(modified.data, controller.signal) : null,
        ]);
        documents = [before, after].filter((entry): entry is LoadedDiffPdf =>
          Boolean(entry),
        );
        if (controller.signal.aborted) return;
        // Let the loading state paint before the (synchronous) diff runs.
        await new Promise((resolve) => setTimeout(resolve, 0));
        const diff = diffPdfWords(before?.words ?? [], after?.words ?? []);
        if (!controller.signal.aborted)
          setLoaded({ original: before, modified: after, diff });
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? `Could not read the PDFs: ${loadError.message}`
              : "Could not read the PDFs.",
          );
        }
      }
    })();
    return () => {
      controller.abort();
      for (const entry of documents) void entry.document.destroy();
    };
  }, [modified.data, original.data]);

  // The view is always mounted (unlike the columns), so measure it and derive
  // each column's width from the layout.
  const viewWidth = useElementWidth(bodyRef);
  const listWidth = listOpen ? hunkListWidth : 0;
  const columnWidth = viewWidth
    ? Math.max(160, (viewWidth - listWidth) / (mode === "overlay" ? 1 : 2))
    : 480;
  const originalBoxes = useMemo(
    () => pageBoxes(loaded?.original ?? null, columnWidth, zoom),
    [columnWidth, loaded?.original, zoom],
  );
  const modifiedBoxes = useMemo(
    () => pageBoxes(loaded?.modified ?? null, columnWidth, zoom),
    [columnWidth, loaded?.modified, zoom],
  );
  const overlayBoxes = useMemo(() => {
    const count = Math.max(originalBoxes.length, modifiedBoxes.length);
    return Array.from(
      { length: count },
      (_, index) => modifiedBoxes[index] ?? originalBoxes[index],
    );
  }, [modifiedBoxes, originalBoxes]);

  const hunks = useMemo(() => loaded?.diff.hunks ?? [], [loaded]);

  const scrollColumnTo = useCallback(
    (side: Side, page: number | null, y: number) => {
      const column =
        side === "original" ? originalColumnRef.current : modifiedColumnRef.current;
      const boxes = side === "original" ? originalBoxes : modifiedBoxes;
      if (!column || page === null || !boxes.length) return;
      const top =
        pageOffset(boxes, page) +
        y * (boxes[page - 1]?.height ?? 0) -
        column.clientHeight / 3;
      programmaticScroll.current = side;
      column.scrollTo?.({ top: Math.max(0, top), behavior: "smooth" });
      if (!column.scrollTo) column.scrollTop = Math.max(0, top);
      window.setTimeout(() => {
        if (programmaticScroll.current === side) programmaticScroll.current = null;
      }, 600);
    },
    [modifiedBoxes, originalBoxes],
  );

  const selectHunk = useCallback(
    (hunkId: number) => {
      const hunk = hunks[hunkId];
      if (!hunk) return;
      setActiveHunk(hunkId);
      if (mode === "overlay") {
        const column = overlayColumnRef.current;
        const page = hunk.modifiedPage ?? hunk.originalPage;
        if (column && page) {
          column.scrollTop = Math.max(
            0,
            pageOffset(overlayBoxes, page) +
              (hunk.modifiedPage ? hunk.modifiedY : hunk.originalY) *
                (overlayBoxes[page - 1]?.height ?? 0) -
              column.clientHeight / 3,
          );
        }
        return;
      }
      scrollColumnTo("original", hunk.originalPage, hunk.originalY);
      scrollColumnTo("modified", hunk.modifiedPage, hunk.modifiedY);
    },
    [hunks, mode, overlayBoxes, scrollColumnTo],
  );

  const step = useCallback(
    (direction: 1 | -1) => {
      if (!hunks.length) return;
      const next =
        activeHunk === null
          ? direction === 1
            ? 0
            : hunks.length - 1
          : (activeHunk + direction + hunks.length) % hunks.length;
      selectHunk(next);
    },
    [activeHunk, hunks.length, selectHunk],
  );

  const handleScroll = useCallback(
    (from: Side) => {
      if (!syncScroll || mode !== "side-by-side") return;
      if (programmaticScroll.current) return;
      const source =
        from === "original" ? originalColumnRef.current : modifiedColumnRef.current;
      const target =
        from === "original" ? modifiedColumnRef.current : originalColumnRef.current;
      const sourceBoxes = from === "original" ? originalBoxes : modifiedBoxes;
      const targetBoxes = from === "original" ? modifiedBoxes : originalBoxes;
      if (!source || !target || !sourceBoxes.length || !targetBoxes.length) return;
      const { page, fraction } = positionAt(sourceBoxes, source.scrollTop);
      const targetPage = Math.min(page, targetBoxes.length);
      const top =
        pageOffset(targetBoxes, targetPage) +
        fraction * targetBoxes[targetPage - 1].height;
      if (Math.abs(target.scrollTop - top) < 2) return;
      programmaticScroll.current = from === "original" ? "modified" : "original";
      target.scrollTop = top;
      target.scrollLeft = source.scrollLeft;
      requestAnimationFrame(() => {
        programmaticScroll.current = null;
      });
    },
    [mode, modifiedBoxes, originalBoxes, syncScroll],
  );

  useEffect(() => {
    bodyRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "Escape" && onClose) {
        event.preventDefault();
        onClose();
      } else if (event.key === "n" || (event.altKey && event.key === "ArrowDown")) {
        event.preventDefault();
        step(1);
      } else if (event.key === "p" || (event.altKey && event.key === "ArrowUp")) {
        event.preventDefault();
        step(-1);
      }
    };
    body.addEventListener("keydown", onKey);
    return () => body.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  const diff = loaded?.diff;
  const position = activeHunk === null ? "–" : String(activeHunk + 1);

  return (
    <div className="pdf-diff-view" ref={bodyRef} tabIndex={-1} aria-label={title}>
      <div className="pdf-diff-toolbar" role="toolbar" aria-label="PDF comparison">
        <div className="pdf-diff-title" title={title}>
          <ArrowLeftRight size={14} aria-hidden="true" />
          <span>{title}</span>
        </div>
        {diff ? (
          <div className="pdf-diff-summary" aria-live="polite">
            <strong>{summaryText(diff)}</strong>
            <span className="pdf-diff-count is-added">+{diff.stats.addedWords}</span>
            <span className="pdf-diff-count is-removed">
              −{diff.stats.removedWords}
            </span>
            <span className="pdf-diff-pages-changed">
              words · pages {pagesText(diff.stats.changedModifiedPages)}
            </span>
          </div>
        ) : null}
        <div className="pdf-diff-actions">
          <div className="pdf-diff-segmented" role="group" aria-label="View">
            <button
              type="button"
              className={mode === "side-by-side" ? "is-active" : undefined}
              aria-pressed={mode === "side-by-side"}
              onClick={() => setMode("side-by-side")}
              title="Side by side, with text changes highlighted"
            >
              <Columns2 size={14} />
              <span>Side by side</span>
            </button>
            <button
              type="button"
              className={mode === "overlay" ? "is-active" : undefined}
              aria-pressed={mode === "overlay"}
              onClick={() => setMode("overlay")}
              title="Visual overlay: every changed pixel, including figures and layout"
            >
              <Layers size={14} />
              <span>Visual overlay</span>
            </button>
          </div>
          <span className="pdf-diff-divider" aria-hidden="true" />
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={!hunks.length}
            title="Previous change (P)"
            aria-label="Previous change"
          >
            <ArrowUp size={14} />
          </button>
          <span className="pdf-diff-position" aria-label="Current change">
            {position} / {hunks.length}
          </span>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={!hunks.length}
            title="Next change (N)"
            aria-label="Next change"
          >
            <ArrowDown size={14} />
          </button>
          <span className="pdf-diff-divider" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setZoom((value) => Math.max(minZoom, value - 10))}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            className="pdf-diff-zoom"
            onClick={() => setZoom(100)}
            title="Fit width"
          >
            {zoom}%
          </button>
          <button
            type="button"
            onClick={() => setZoom((value) => Math.min(maxZoom, value + 10))}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <ZoomIn size={14} />
          </button>
          {mode === "side-by-side" ? (
            <button
              type="button"
              className={syncScroll ? "is-active" : undefined}
              aria-pressed={syncScroll}
              onClick={() => setSyncScroll((value) => !value)}
              title={
                syncScroll
                  ? "Scroll the two PDFs separately"
                  : "Scroll the two PDFs together"
              }
              aria-label="Synchronize scrolling"
            >
              {syncScroll ? <Link2 size={14} /> : <Link2Off size={14} />}
            </button>
          ) : null}
          <button
            type="button"
            className={listOpen ? "is-active" : undefined}
            aria-pressed={listOpen}
            onClick={() => setListOpen((value) => !value)}
            title="List of changes"
            aria-label="List of changes"
          >
            <ListTree size={14} />
          </button>
          {onSwap ? (
            <button
              type="button"
              onClick={onSwap}
              title="Swap sides"
              aria-label="Swap sides"
            >
              <ArrowLeftRight size={14} />
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              aria-label="Close comparison"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="pdf-diff-state is-error" role="alert">
          {error}
        </div>
      ) : !loaded ? (
        <div className="pdf-diff-state" role="status">
          <LoaderCircle size={18} className="spin" aria-hidden="true" />
          <span>Comparing PDFs…</span>
        </div>
      ) : (
        <div className={`pdf-diff-body ${listOpen ? "with-list" : ""}`}>
          {listOpen ? (
            <aside className="pdf-diff-list" aria-label="Changes">
              <HunkList hunks={hunks} activeHunk={activeHunk} onSelect={selectHunk} />
            </aside>
          ) : null}
          {mode === "side-by-side" ? (
            <div className="pdf-diff-columns">
              <DiffColumn
                side="original"
                source={original}
                loaded={loaded.original}
                boxes={originalBoxes}
                highlights={loaded.diff.originalHighlights}
                activeHunk={activeHunk}
                onSelectHunk={selectHunk}
                columnRef={originalColumnRef}
                onScroll={() => handleScroll("original")}
              />
              <DiffColumn
                side="modified"
                source={modified}
                loaded={loaded.modified}
                boxes={modifiedBoxes}
                highlights={loaded.diff.modifiedHighlights}
                activeHunk={activeHunk}
                onSelectHunk={selectHunk}
                columnRef={modifiedColumnRef}
                onScroll={() => handleScroll("modified")}
              />
            </div>
          ) : (
            <section className="pdf-diff-column is-overlay" aria-label="Visual overlay">
              <header className="pdf-diff-column-header pdf-diff-legend">
                <span className="pdf-diff-legend-item is-removed">
                  Only in {original.label}
                </span>
                <span className="pdf-diff-legend-item is-added">
                  Only in {modified.label}
                </span>
                <span className="pdf-diff-legend-item is-changed">Changed</span>
                <small>Pages are compared by number</small>
              </header>
              <div className="pdf-diff-scroll" ref={overlayColumnRef}>
                <div
                  className="pdf-diff-pages"
                  style={{ gap: pageGap, padding: `${pageGap}px 0` }}
                >
                  {overlayBoxes.map((box, index) => (
                    <OverlayPage
                      key={index + 1}
                      original={loaded.original?.document ?? null}
                      modified={loaded.modified?.document ?? null}
                      pageNumber={index + 1}
                      width={box.width}
                      height={box.height}
                    />
                  ))}
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
