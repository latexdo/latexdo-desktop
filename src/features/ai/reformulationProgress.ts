// A small popup at the selection while "Reformulate with AI" is generating:
// a spinner, the rewrite streaming in, and a Cancel button. The selection is
// tinted so it is clear which text is being rewritten.

import type * as Monaco from "monaco-editor";

type MonacoNamespace = typeof Monaco;

export interface ReformulationProgress {
  /** Appends streamed text from the model. */
  append(text: string): void;
  /** Removes the popup and the selection tint. */
  dispose(): void;
}

const previewChars = 220;

/**
 * True while a reformulation is generating. Escape cancels it only then;
 * otherwise Escape must reach Monaco, e.g. to dismiss inline completions.
 */
export const reformulatingContextKey = "latexdoReformulating";

export function showReformulationProgress(
  editor: Monaco.editor.IStandaloneCodeEditor,
  monaco: MonacoNamespace,
  range: Monaco.IRange,
  onCancel: () => void,
): ReformulationProgress {
  const node = document.createElement("div");
  node.className = "latexdo-reformulate-progress";
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  node.innerHTML = `
    <div class="latexdo-reformulate-progress-head">
      <span class="latexdo-reformulate-progress-spinner" aria-hidden="true"></span>
      <span class="latexdo-reformulate-progress-label">Reformulating with AI…</span>
      <button type="button" class="latexdo-reformulate-progress-cancel" title="Cancel (Esc)">Cancel</button>
    </div>
    <div class="latexdo-reformulate-progress-preview" hidden></div>`;
  const preview = node.querySelector<HTMLDivElement>(
    ".latexdo-reformulate-progress-preview",
  )!;
  const cancel = node.querySelector<HTMLButtonElement>(
    ".latexdo-reformulate-progress-cancel",
  )!;
  // Keep the editor's selection and focus while the button is pressed.
  cancel.addEventListener("mousedown", (event) => event.preventDefault());
  cancel.addEventListener("click", () => onCancel());

  const widget: Monaco.editor.IContentWidget = {
    getId: () => "latexdo.reformulate.progress",
    getDomNode: () => node,
    getPosition: () => ({
      position: { lineNumber: range.startLineNumber, column: range.startColumn },
      preference: [
        monaco.editor.ContentWidgetPositionPreference.ABOVE,
        monaco.editor.ContentWidgetPositionPreference.BELOW,
      ],
    }),
  };
  editor.addContentWidget(widget);
  const reformulating = editor.createContextKey<boolean>(
    reformulatingContextKey,
    false,
  );
  reformulating.set(true);

  const tint = editor.createDecorationsCollection([
    {
      range,
      options: {
        className: "latexdo-reformulating-range",
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    },
  ]);

  let text = "";
  let disposed = false;
  return {
    append(chunk) {
      if (disposed || !chunk) return;
      text += chunk;
      const shown = text.replace(/\s+/g, " ").trim();
      if (!shown) return;
      preview.hidden = false;
      preview.textContent =
        shown.length > previewChars ? `…${shown.slice(-previewChars)}` : shown;
      editor.layoutContentWidget(widget);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      editor.removeContentWidget(widget);
      tint.clear();
      reformulating.set(false);
    },
  };
}
