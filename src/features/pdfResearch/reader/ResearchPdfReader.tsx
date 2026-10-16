import React from "react";
import {
  Bot,
  BookOpenText,
  Copy,
  Download,
  Highlighter,
  MessageSquareText,
  NotebookPen,
  PanelRight,
  Search,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import PdfPreview, { type PdfPreviewOverlay } from "../../../PdfPreview";
import type { AiConfig } from "../../ai/aiConfig";
import type { AgentContext } from "../../ai/aiTools";
import { useAiAgent } from "../../ai/useAiAgent";
import type { PdfAnnotation } from "../domain/PdfAnnotation";
import type { PdfRect } from "../domain/PdfAnchor";
import type { PdfSelection } from "../domain/PdfSelection";
import type { ResearchContext } from "../domain/ResearchEvidence";
import type { ResearchDocument } from "../domain/ResearchDocument";
import {
  buildResearchPrompt,
  resolvePdfSelectionContext,
} from "../context/ResearchContextService";
import {
  createAnnotationFromSelection,
  deletePdfAnnotation,
  loadPdfAnnotations,
  savePdfAnnotation,
} from "../annotations/AnnotationStore";
import {
  buildPdfReviewText,
  downloadTextFile,
  pdfReviewFileName,
} from "./ResearchReviewExport";

interface ResearchPdfReaderProps {
  document: ResearchDocument;
  data: Uint8Array;
  scale: number;
  rotation?: number;
  config: AiConfig;
  agentContext: AgentContext;
  isDesktop: boolean;
  onOpenSettings: () => void;
}

interface ToolbarState {
  selection: PdfSelection;
  top: number;
  left: number;
}

const textContextWindow = 220;

function makeSelectionId(): string {
  return `pdfsel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function elementFromNode(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function pageElementFromRange(range: Range): HTMLElement | null {
  const fromAncestor = elementFromNode(range.commonAncestorContainer)?.closest(
    ".pdf-page",
  );
  if (fromAncestor instanceof HTMLElement) return fromAncestor;

  const firstRect = Array.from(range.getClientRects()).find(
    (rect) => rect.width > 1 && rect.height > 1,
  );
  if (!firstRect) return null;
  const element = window.document.elementFromPoint(
    firstRect.left + firstRect.width / 2,
    firstRect.top + firstRect.height / 2,
  );
  const fromPoint = element?.closest(".pdf-page");
  return fromPoint instanceof HTMLElement ? fromPoint : null;
}

function rectsForRange(range: Range, pageElement: HTMLElement): PdfRect[] {
  const pageBounds = pageElement.getBoundingClientRect();
  if (pageBounds.width <= 0 || pageBounds.height <= 0) return [];

  return Array.from(range.getClientRects())
    .map((rect) => {
      const left = Math.max(rect.left, pageBounds.left);
      const top = Math.max(rect.top, pageBounds.top);
      const right = Math.min(rect.right, pageBounds.right);
      const bottom = Math.min(rect.bottom, pageBounds.bottom);
      return {
        x: (left - pageBounds.left) / pageBounds.width,
        y: (top - pageBounds.top) / pageBounds.height,
        width: Math.max(0, right - left) / pageBounds.width,
        height: Math.max(0, bottom - top) / pageBounds.height,
      };
    })
    .filter((rect) => rect.width > 0.001 && rect.height > 0.001);
}

function createPdfSelection(
  document: ResearchDocument,
  range: Range,
  selectedText: string,
): PdfSelection | null {
  const pageElement = pageElementFromRange(range);
  if (!pageElement) return null;
  const pageNumber = Number(pageElement.dataset.pageNumber);
  if (!Number.isFinite(pageNumber) || pageNumber <= 0) return null;

  const rects = rectsForRange(range, pageElement);
  if (!rects.length) return null;

  const pageText = normalizedText(
    pageElement.querySelector(".textLayer")?.textContent ??
      pageElement.textContent ??
      "",
  );
  const exact = normalizedText(selectedText);
  const textStart = pageText.indexOf(exact);
  const textEnd = textStart >= 0 ? textStart + exact.length : -1;

  return {
    id: makeSelectionId(),
    documentId: document.id,
    pageNumber,
    text: exact,
    ranges:
      textStart >= 0
        ? [{ pageNumber, start: textStart, end: textEnd }]
        : [{ pageNumber, start: 0, end: exact.length }],
    boundingRects: rects,
    anchor: {
      pageNumber,
      quote: {
        exact,
        prefix:
          textStart > 0
            ? pageText.slice(Math.max(0, textStart - textContextWindow), textStart)
            : undefined,
        suffix:
          textEnd >= 0
            ? pageText.slice(
                textEnd,
                Math.min(pageText.length, textEnd + textContextWindow),
              )
            : undefined,
      },
      textPosition:
        textStart >= 0
          ? { start: textStart, end: Math.max(textStart, textEnd) }
          : undefined,
      geometry: rects,
    },
    contextBefore:
      textStart > 0
        ? pageText.slice(Math.max(0, textStart - textContextWindow), textStart)
        : undefined,
    contextAfter:
      textEnd >= 0
        ? pageText.slice(
            textEnd,
            Math.min(pageText.length, textEnd + textContextWindow),
          )
        : undefined,
    createdAt: Date.now(),
  };
}

function annotationOverlays(
  annotations: PdfAnnotation[],
  focusedAnnotationId: string | null,
): PdfPreviewOverlay[] {
  return annotations.flatMap((annotation) => [
    {
      id: annotation.id,
      pageNumber: annotation.pageNumber,
      rects: annotation.anchor.geometry,
      className: [
        `pdf-annotation-${annotation.type}`,
        `pdf-annotation-${annotation.color ?? "yellow"}`,
        focusedAnnotationId === annotation.id ? "pdf-annotation-focus" : "",
      ]
        .filter(Boolean)
        .join(" "),
      title:
        annotation.type === "note"
          ? annotation.comment || "Research note"
          : annotation.anchor.quote.exact,
    },
  ]);
}

function contextOverlays(context: ResearchContext | null): PdfPreviewOverlay[] {
  if (!context) return [];
  return [
    {
      id: `research-context:${context.primarySource.anchorId}`,
      pageNumber: context.primarySource.pageNumber,
      rects: context.primarySource.boundingRects,
      className: "pdf-annotation-evidence",
      title: "Current AI evidence",
    },
  ];
}

function jumpToAnchor(pageNumber: number, rects: PdfRect[]) {
  const page = window.document.querySelector<HTMLElement>(
    `.pdf-page[data-page-number="${pageNumber}"]`,
  );
  page?.scrollIntoView({ behavior: "smooth", block: "center" });
  if (!page || rects.length === 0) return;
  page.classList.remove("pdf-page-evidence-pulse");
  window.setTimeout(() => page.classList.add("pdf-page-evidence-pulse"), 20);
}

function isResearchAiReady(config: AiConfig, isDesktop: boolean): boolean {
  if (config.provider === "off") return false;
  if (config.provider === "cloud") return config.cloud.credentialConfigured;
  if (!isDesktop) return false;
  if (config.provider === "local") return config.modelDownloaded;
  return true;
}

export const ResearchPdfReader: React.FC<ResearchPdfReaderProps> = ({
  document,
  data,
  scale,
  rotation = 0,
  config,
  agentContext,
  isDesktop,
  onOpenSettings,
}) => {
  const [annotations, setAnnotations] = React.useState<PdfAnnotation[]>(() =>
    loadPdfAnnotations(document.id),
  );
  const [toolbar, setToolbar] = React.useState<ToolbarState | null>(null);
  const [activeContext, setActiveContext] = React.useState<ResearchContext | null>(
    null,
  );
  const [question, setQuestion] = React.useState("");
  const [noteDraft, setNoteDraft] = React.useState("");
  const [noteSelection, setNoteSelection] = React.useState<PdfSelection | null>(null);
  const [focusedAnnotationId, setFocusedAnnotationId] = React.useState<string | null>(
    null,
  );
  const [reviewExportStatus, setReviewExportStatus] = React.useState("");
  const readerRef = React.useRef<HTMLDivElement | null>(null);
  const questionInputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const ready = isResearchAiReady(config, isDesktop);
  const { messages, isRunning, status, send, abort, reset } = useAiAgent(
    config,
    agentContext,
    `research-ai:${document.id}`,
  );

  React.useEffect(() => {
    setAnnotations(loadPdfAnnotations(document.id));
    setToolbar(null);
    setActiveContext(null);
    setQuestion("");
    setNoteDraft("");
    setNoteSelection(null);
    setReviewExportStatus("");
  }, [document.id]);

  const saveAnnotation = React.useCallback((annotation: PdfAnnotation) => {
    savePdfAnnotation(annotation);
    setAnnotations(loadPdfAnnotations(annotation.documentId));
  }, []);

  const removeAnnotation = React.useCallback(
    (annotation: PdfAnnotation) => {
      deletePdfAnnotation(document.id, annotation.id);
      setAnnotations(loadPdfAnnotations(document.id));
    },
    [document.id],
  );

  const resolveSelection = React.useCallback(
    (selection: PdfSelection) => resolvePdfSelectionContext(document, selection),
    [document],
  );

  const handleSelectionCapture = React.useCallback(() => {
    window.setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return;
      }
      const text = normalizedText(selection.toString());
      if (!text) return;
      const range = selection.getRangeAt(0);
      const readerElement = readerRef.current;
      if (
        readerElement &&
        !readerElement.contains(elementFromNode(range.commonAncestorContainer))
      ) {
        return;
      }
      const pdfSelection = createPdfSelection(document, range, text);
      if (!pdfSelection) return;
      const firstRect = Array.from(range.getClientRects()).find(
        (rect) => rect.width > 1 && rect.height > 1,
      );
      setToolbar({
        selection: pdfSelection,
        left: Math.min(
          window.innerWidth - 360,
          Math.max(16, (firstRect?.left ?? 24) + (firstRect?.width ?? 0) / 2),
        ),
        top: Math.max(16, (firstRect?.top ?? 80) - 48),
      });
    }, 0);
  }, [document]);

  const attachSelection = React.useCallback(
    (selection: PdfSelection) => {
      const context = resolveSelection(selection);
      setActiveContext(context);
      setToolbar(null);
      return context;
    },
    [resolveSelection],
  );

  const explainSelection = React.useCallback(
    (selection: PdfSelection) => {
      const context = attachSelection(selection);
      if (!ready) return;
      void send(buildResearchPrompt(context, "explain"), {
        displayText: "Explain this passage",
      });
    },
    [attachSelection, ready, send],
  );

  const askSelection = React.useCallback(
    (selection: PdfSelection) => {
      attachSelection(selection);
      setQuestion("");
    },
    [attachSelection],
  );

  const highlightSelection = React.useCallback(
    (selection: PdfSelection) => {
      const annotation = createAnnotationFromSelection(selection, {
        type: "highlight",
        color: "yellow",
      });
      saveAnnotation(annotation);
      setFocusedAnnotationId(annotation.id);
      setToolbar(null);
      window.getSelection()?.removeAllRanges();
    },
    [saveAnnotation],
  );

  const startNote = React.useCallback(
    (selection: PdfSelection) => {
      setNoteSelection(selection);
      setNoteDraft("");
      setActiveContext(resolvePdfSelectionContext(document, selection));
      setToolbar(null);
    },
    [document],
  );

  const saveNote = React.useCallback(() => {
    if (!noteSelection) return;
    const annotation = createAnnotationFromSelection(noteSelection, {
      type: "note",
      color: "blue",
      comment: noteDraft.trim() || "Research note",
    });
    saveAnnotation(annotation);
    setFocusedAnnotationId(annotation.id);
    setNoteSelection(null);
    setNoteDraft("");
    window.getSelection()?.removeAllRanges();
  }, [noteDraft, noteSelection, saveAnnotation]);

  const submitQuestion = React.useCallback(() => {
    if (!activeContext || !ready || isRunning) return;
    const prompt = buildResearchPrompt(
      activeContext,
      "ask",
      question.trim() || "Explain why this matters.",
    );
    const displayText = question.trim() || "Why does this matter?";
    setQuestion("");
    void send(prompt, { displayText });
  }, [activeContext, isRunning, question, ready, send]);

  const copySelection = React.useCallback(
    (selection: PdfSelection) => {
      const text = `"${selection.text}"\n— ${document.metadata.title || document.name}, p. ${
        selection.pageNumber
      }`;
      void navigator.clipboard?.writeText(text);
      setToolbar(null);
    },
    [document.metadata.title, document.name],
  );

  const generateReview = React.useCallback(() => {
    const fileName = pdfReviewFileName(document);
    downloadTextFile(fileName, buildPdfReviewText(document, annotations));
    setReviewExportStatus(`Generated ${fileName}`);
  }, [annotations, document]);

  const overlays = React.useMemo(
    () => [
      ...annotationOverlays(annotations, focusedAnnotationId),
      ...contextOverlays(activeContext),
    ],
    [activeContext, annotations, focusedAnnotationId],
  );

  const notes = annotations.filter((annotation) => annotation.type === "note");
  const highlights = annotations.filter(
    (annotation) => annotation.type === "highlight",
  );

  return (
    <div
      ref={readerRef}
      className="research-reader"
      onMouseUp={handleSelectionCapture}
      onKeyUp={handleSelectionCapture}
    >
      <div className="research-review-command-strip">
        <div className="research-review-mode">
          <BookOpenText size={17} />
          <div>
            <span>Reader Mode</span>
            <strong>{document.metadata.title || document.name}</strong>
          </div>
        </div>
        <div className="research-review-actions" aria-label="Review tools">
          <button
            type="button"
            disabled={!activeContext}
            onClick={() => questionInputRef.current?.focus()}
          >
            <MessageSquareText size={14} />
            Ask
          </button>
          <button
            type="button"
            disabled={!activeContext || !ready}
            onClick={() => {
              if (!activeContext) return;
              void send(buildResearchPrompt(activeContext, "explain"), {
                displayText: "Explain this passage",
              });
            }}
          >
            <Bot size={14} />
            Explain
          </button>
          <button
            type="button"
            disabled={!toolbar}
            onClick={() => toolbar && highlightSelection(toolbar.selection)}
          >
            <Highlighter size={14} />
            Highlight
          </button>
          <button
            type="button"
            disabled={!toolbar}
            onClick={() => toolbar && startNote(toolbar.selection)}
          >
            <StickyNote size={14} />
            Note
          </button>
          <button
            type="button"
            className="research-review-export"
            disabled={annotations.length === 0}
            onClick={generateReview}
            title="Generate a TXT file from saved notes and highlights only"
          >
            <Download size={14} />
            Generate Review
          </button>
          <span>
            <PanelRight size={13} />
            Research panel open
          </span>
        </div>
      </div>
      <aside className="research-outline" aria-label="Reader navigation">
        <div>
          <p className="reader-mode-label">Reader Mode</p>
          <h2>{document.metadata.title || document.name}</h2>
          <small>External PDF · source material</small>
        </div>
        <div className="research-outline-section">
          <span>Outline</span>
          <button type="button">Abstract</button>
          <button type="button">Introduction</button>
          <button type="button">Methods</button>
          <button type="button">Results</button>
        </div>
        <div className="research-outline-section">
          <span>Notes</span>
          {annotations.length === 0 ? (
            <p>Select text to create highlights and notes.</p>
          ) : (
            annotations.slice(0, 8).map((annotation) => (
              <button
                type="button"
                key={annotation.id}
                className="research-note-jump"
                onClick={() => {
                  setFocusedAnnotationId(annotation.id);
                  jumpToAnchor(annotation.pageNumber, annotation.anchor.geometry);
                }}
              >
                <span>p.{annotation.pageNumber}</span>
                <strong>
                  {annotation.type === "note" ? annotation.comment : "Highlight"}
                </strong>
              </button>
            ))
          )}
        </div>
      </aside>

      <main className="research-pdf-stage" aria-label={`${document.name} reader`}>
        <div className="research-reader-toolbar">
          <div>
            <strong>{document.name}</strong>
            <span>Read, annotate, and ask AI about exact evidence.</span>
          </div>
          <div>
            <span>{highlights.length} highlights</span>
            <span>{notes.length} notes</span>
          </div>
        </div>
        <div className="research-pdf-scroll">
          <PdfPreview
            data={data}
            scale={scale}
            rotation={rotation}
            target={null}
            overlays={overlays}
          />
        </div>
      </main>

      <aside className="research-assistant" aria-label="Research assistant">
        <header>
          <div>
            <Bot size={17} />
            <strong>Research Assistant</strong>
          </div>
          <button
            type="button"
            className="small-icon"
            onClick={reset}
            title="New thread"
          >
            <X size={14} />
          </button>
        </header>

        {activeContext ? (
          <div className="research-context-chip">
            <button
              type="button"
              className="research-context-main"
              onClick={() =>
                jumpToAnchor(
                  activeContext.primarySource.pageNumber,
                  activeContext.primarySource.boundingRects,
                )
              }
            >
              <span>
                {document.name} · p.{activeContext.primarySource.pageNumber}
              </span>
              <q>{activeContext.primarySource.textQuote.slice(0, 180)}</q>
            </button>
            <button
              type="button"
              className="research-context-remove"
              onClick={() => setActiveContext(null)}
              aria-label="Remove PDF context"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <div className="research-assistant-empty">
            <Search size={24} />
            <p>Select text in the PDF, then ask or explain from that exact passage.</p>
          </div>
        )}

        {noteSelection ? (
          <div className="research-note-editor">
            <span>Note on p.{noteSelection.pageNumber}</span>
            <q>{noteSelection.text.slice(0, 120)}</q>
            <textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              placeholder="Write your interpretation, question, or link to your own work..."
              rows={4}
              autoFocus
            />
            <div>
              <button type="button" onClick={() => setNoteSelection(null)}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={saveNote}>
                Save note
              </button>
            </div>
          </div>
        ) : null}

        <div className="research-ai-messages">
          {messages.length === 0 ? (
            <p className="research-ai-hint">
              AI answers stay visually separate from source text. Evidence chips jump
              back to the PDF.
            </p>
          ) : (
            messages.map((message) => (
              <div key={message.id} className={`research-ai-message ${message.role}`}>
                <span>{message.role === "user" ? "You" : "AI"}</span>
                <p>{message.text || (message.pending ? "…" : "")}</p>
                {message.role === "assistant" && activeContext ? (
                  <button
                    type="button"
                    className="research-evidence-link"
                    onClick={() =>
                      jumpToAnchor(
                        activeContext.primarySource.pageNumber,
                        activeContext.primarySource.boundingRects,
                      )
                    }
                  >
                    SOURCE_1 · p.{activeContext.primarySource.pageNumber}
                  </button>
                ) : null}
              </div>
            ))
          )}
          {isRunning && status ? (
            <div className="research-ai-status">{status}</div>
          ) : null}
        </div>

        {!ready ? (
          <div className="research-ai-disabled">
            <p>AI is not ready for Reader Mode.</p>
            <button type="button" onClick={onOpenSettings}>
              Open AI settings
            </button>
          </div>
        ) : null}

        <div className="research-question-box">
          <textarea
            ref={questionInputRef}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={
              activeContext
                ? "Ask about this passage..."
                : "Select source text first..."
            }
            disabled={!activeContext || !ready}
            rows={3}
          />
          {isRunning ? (
            <button type="button" onClick={abort}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={submitQuestion}
              disabled={!activeContext || !ready}
            >
              Ask
            </button>
          )}
        </div>

        <section className="research-annotation-list" aria-label="Annotations">
          <h3>Annotations</h3>
          {reviewExportStatus ? (
            <p className="research-review-export-status">{reviewExportStatus}</p>
          ) : null}
          {annotations.length === 0 ? (
            <p>No annotations yet.</p>
          ) : (
            annotations.map((annotation) => (
              <article key={annotation.id}>
                <button
                  type="button"
                  className="research-annotation-body"
                  onClick={() => {
                    setFocusedAnnotationId(annotation.id);
                    jumpToAnchor(annotation.pageNumber, annotation.anchor.geometry);
                  }}
                >
                  <span>
                    {annotation.type === "note" ? "Note" : "Highlight"} · p.
                    {annotation.pageNumber}
                  </span>
                  <q>{annotation.anchor.quote.exact.slice(0, 120)}</q>
                  {annotation.comment ? <em>{annotation.comment}</em> : null}
                </button>
                <button
                  type="button"
                  className="research-annotation-delete"
                  onClick={() => removeAnnotation(annotation)}
                  aria-label="Delete annotation"
                >
                  <Trash2 size={13} />
                </button>
              </article>
            ))
          )}
        </section>
      </aside>

      {toolbar ? (
        <div
          className="pdf-selection-toolbar"
          style={{ top: toolbar.top, left: toolbar.left }}
          role="toolbar"
          aria-label="PDF selection actions"
          onMouseDown={(event) => event.stopPropagation()}
          onMouseUp={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => askSelection(toolbar.selection)}>
            <MessageSquareText size={14} />
            Ask
          </button>
          <button type="button" onClick={() => explainSelection(toolbar.selection)}>
            <Bot size={14} />
            Explain
          </button>
          <button type="button" onClick={() => highlightSelection(toolbar.selection)}>
            <Highlighter size={14} />
            Highlight
          </button>
          <button type="button" onClick={() => startNote(toolbar.selection)}>
            <StickyNote size={14} />
            Note
          </button>
          <button type="button" onClick={() => copySelection(toolbar.selection)}>
            <Copy size={14} />
            Copy
          </button>
          <button
            type="button"
            aria-label="Close selection toolbar"
            onClick={() => setToolbar(null)}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      <div className="research-reader-footer">
        <NotebookPen size={14} />
        <span>
          Reader Mode keeps external PDFs read-only. Highlights, notes, and AI context
          are stored separately.
        </span>
      </div>
    </div>
  );
};
