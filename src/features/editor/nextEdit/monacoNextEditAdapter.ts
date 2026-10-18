import type * as Monaco from "monaco-editor";
import { EditorMutationOrigin } from "../../../collaboration/editProvenance";
import { originForContentChange, normalizeContentChangeEvent } from "./editNormalizer";
import { NextEditController } from "./nextEditController";
import type {
  DocumentSnapshot,
  NextEditCandidate,
  NextEditConfig,
  SemanticNextEditPredictor,
  SupportedNextEditLanguage,
} from "./nextEditTypes";

export interface InstallMonacoNextEditOptions {
  editor: Monaco.editor.IStandaloneCodeEditor;
  monaco: typeof Monaco;
  documentKey: string;
  language: string;
  config: NextEditConfig;
  controller?: NextEditController;
  semanticPredictor?: SemanticNextEditPredictor;
  mutationOrigin?: EditorMutationOrigin;
  now?: () => number;
  /** See NextEditControllerOptions.patternDebounceMs. */
  patternDebounceMs?: number;
}

export interface MonacoNextEditAdapter {
  readonly controller: NextEditController;
  acceptVisibleSuggestion(): boolean;
  dispose(): void;
}

const nextEditVisibleContextKey = "latexdoNextEditVisible";
const acceptActionId = "latexdo.nextEdit.accept";
const dismissActionId = "latexdo.nextEdit.dismiss";

export function installMonacoNextEdit({
  editor,
  monaco,
  documentKey,
  language,
  config,
  controller,
  semanticPredictor,
  mutationOrigin = new EditorMutationOrigin(),
  now = () => Date.now(),
  patternDebounceMs,
}: InstallMonacoNextEditOptions): MonacoNextEditAdapter {
  const activeController =
    controller ??
    new NextEditController({
      now,
      semanticPredictor,
      semanticEnabled: config.semanticEnabled,
      patternDebounceMs,
    });
  const model = editor.getModel();
  let currentModel = model;
  let currentText = model?.getValue() ?? "";
  let currentRevision = model?.getVersionId() ?? 0;
  let disposed = false;
  let decorations: Monaco.editor.IEditorDecorationsCollection | null =
    editor.createDecorationsCollection();
  const visibleKey = editor.createContextKey<boolean>(nextEditVisibleContextKey, false);
  const disposables: Monaco.IDisposable[] = [];

  function snapshotFor(
    text = currentText,
    revision = currentRevision,
  ): DocumentSnapshot {
    return {
      documentKey,
      revision,
      text,
      language: supportedLanguage(language),
    };
  }

  // Drawn after the event that changed it: cursor and content events can fire
  // while Monaco is applying decorations, and nested deltaDecorations fail.
  let renderQueued = false;
  function scheduleRender(): void {
    if (renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => {
      renderQueued = false;
      render(activeController.getSuggestion());
    });
  }

  /** Whether the cursor is on the lines the suggestion changes. */
  function cursorNear(
    targetModel: Monaco.editor.ITextModel,
    candidate: NextEditCandidate,
  ): boolean {
    const line = editor.getPosition()?.lineNumber ?? 0;
    return (
      line >= targetModel.getPositionAt(candidate.startOffset).lineNumber &&
      line <= targetModel.getPositionAt(candidate.endOffset).lineNumber
    );
  }

  function render(candidate: NextEditCandidate | null): void {
    if (disposed) return;
    if (!candidate || !validateCandidateAgainstModel(candidate)) {
      decorations?.set([]);
      visibleKey.set(false);
      return;
    }

    const targetModel = editor.getModel();
    if (!targetModel) {
      decorations?.set([]);
      visibleKey.set(false);
      return;
    }

    const near = cursorNear(targetModel, candidate);
    const cursorLine = editor.getPosition()?.lineNumber ?? 1;
    const targetLine = targetModel.getPositionAt(candidate.startOffset).lineNumber;
    decorations?.set([
      decorationForCandidate(monaco, targetModel, candidate),
      tabHintDecoration(monaco, targetModel, candidate, near),
      gutterDecoration(monaco, targetLine, "latexdo-next-edit-gutter"),
      // Away from the edit, an arrow at the cursor points to it, as in Copilot.
      ...(near
        ? []
        : [
            gutterDecoration(
              monaco,
              cursorLine,
              targetLine < cursorLine
                ? "latexdo-next-edit-jump-up"
                : "latexdo-next-edit-jump-down",
            ),
          ]),
    ]);
    visibleKey.set(true);
  }

  function refreshModelSnapshot(): void {
    currentModel = editor.getModel();
    currentText = currentModel?.getValue() ?? "";
    currentRevision = currentModel?.getVersionId() ?? currentRevision + 1;
    activeController.onDocumentChanged(snapshotFor());
    scheduleRender();
  }

  /**
   * Tab, as in Copilot: away from the suggestion it jumps there first; on the
   * suggestion's lines it applies it.
   */
  function jumpOrAccept(): boolean {
    const candidate = activeController.getSuggestion();
    const targetModel = editor.getModel();
    if (!candidate || !targetModel || !validateCandidateAgainstModel(candidate)) {
      return false;
    }
    if (cursorNear(targetModel, candidate)) return acceptVisibleSuggestion();
    const start = targetModel.getPositionAt(candidate.startOffset);
    editor.setPosition(start);
    editor.revealPositionInCenterIfOutsideViewport(start);
    scheduleRender();
    return true;
  }

  function acceptVisibleSuggestion(): boolean {
    const candidate = activeController.getSuggestion();
    if (!candidate || !validateCandidateAgainstModel(candidate)) {
      return false;
    }
    const accepted = activeController.acceptSuggestion();
    if (!accepted || !validateCandidateAgainstModel(accepted)) {
      return false;
    }

    const targetModel = editor.getModel();
    if (!targetModel) return false;
    const range = rangeForOffsets(
      monaco,
      targetModel,
      accepted.startOffset,
      accepted.endOffset,
    );
    mutationOrigin.run("next-edit", () => {
      editor.pushUndoStop();
      editor.executeEdits("latexdo.nextEdit.accept", [
        {
          range,
          text: accepted.replacementText,
          forceMoveMarkers: true,
        },
      ]);
      editor.pushUndoStop();
    });

    const cursor = targetModel.getPositionAt(
      accepted.startOffset + accepted.replacementText.length,
    );
    editor.setPosition(cursor);
    editor.revealPositionInCenterIfOutsideViewport(cursor);
    return true;
  }

  function validateCandidateAgainstModel(candidate: NextEditCandidate): boolean {
    const targetModel = editor.getModel();
    if (!targetModel) return false;
    if (candidate.documentKey !== documentKey) return false;
    if (candidate.basedOnRevision !== currentRevision) return false;
    if (candidate.startOffset < 0 || candidate.endOffset < candidate.startOffset) {
      return false;
    }
    if (candidate.endOffset > targetModel.getValueLength()) return false;
    const range = rangeForOffsets(
      monaco,
      targetModel,
      candidate.startOffset,
      candidate.endOffset,
    );
    return targetModel.getValueInRange(range) === candidate.expectedText;
  }

  const unsubscribeSuggestion = activeController.subscribeSuggestionChanged(() =>
    scheduleRender(),
  );
  disposables.push({
    dispose: unsubscribeSuggestion,
  });

  if (currentModel && config.enabled) {
    activeController.onDocumentChanged(snapshotFor());
  }

  disposables.push(
    editor.onDidChangeModelContent((event) => {
      const targetModel = editor.getModel();
      if (!targetModel || targetModel !== currentModel || !config.enabled) return;

      const beforeText = currentText;
      const afterText = targetModel.getValue();
      const revisionBefore = currentRevision;
      const revisionAfter = targetModel.getVersionId();
      const explicitOrigin = mutationOrigin.current();
      const origin = originForContentChange(event, explicitOrigin);
      currentText = afterText;
      currentRevision = revisionAfter;
      activeController.onDocumentChanged(snapshotFor(afterText, revisionAfter));

      const cursorOffset = editorPositionOffset(targetModel, editor.getPosition());
      const edits = normalizeContentChangeEvent({
        documentKey,
        revisionBefore,
        revisionAfter,
        beforeText,
        afterText,
        event,
        origin,
        cursorOffsetAfter: cursorOffset,
        timestamp: now(),
      });
      for (const edit of edits) {
        activeController.observeEdit(edit);
      }
      scheduleRender();
    }),
    editor.onDidChangeCursorPosition((event) => {
      const targetModel = editor.getModel();
      if (!targetModel) return;
      activeController.onCursorMoved(targetModel.getOffsetAt(event.position));
      scheduleRender();
    }),
    editor.onDidChangeCursorSelection((event) => {
      const targetModel = editor.getModel();
      if (!targetModel) return;
      activeController.onSelectionChanged(
        targetModel.getOffsetAt(event.selection.getStartPosition()),
        targetModel.getOffsetAt(event.selection.getEndPosition()),
      );
      scheduleRender();
    }),
    editor.onDidChangeModel(() => {
      decorations?.clear();
      decorations = editor.createDecorationsCollection();
      refreshModelSnapshot();
    }),
    editor.addAction({
      id: acceptActionId,
      label: "Go to or Accept Next Edit Suggestion",
      keybindings: [monaco.KeyCode.Tab],
      // Ghost text at the cursor has Tab first.
      precondition:
        "editorTextFocus && latexdoNextEditVisible && !inlineSuggestionVisible && !suggestWidgetVisible && !renameInputVisible && !inSnippetMode",
      run: () => {
        jumpOrAccept();
      },
    }),
    editor.addAction({
      id: dismissActionId,
      label: "Dismiss Next Edit Suggestion",
      keybindings: [monaco.KeyCode.Escape],
      precondition:
        "editorTextFocus && latexdoNextEditVisible && !suggestWidgetVisible && !renameInputVisible",
      run: () => {
        activeController.dismissSuggestion("explicit");
        render(null);
      },
    }),
  );

  return {
    controller: activeController,
    acceptVisibleSuggestion,
    dispose() {
      if (disposed) return;
      disposed = true;
      activeController.dismissSuggestion("disposed");
      for (const disposable of disposables) {
        disposable.dispose();
      }
      decorations?.clear();
      decorations = null;
      visibleKey.reset();
      if (!controller) activeController.dispose();
    },
  };
}

function decorationForCandidate(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  candidate: NextEditCandidate,
): Monaco.editor.IModelDeltaDecoration {
  const range = rangeForOffsets(
    monaco,
    model,
    candidate.startOffset,
    candidate.endOffset,
  );
  const targetOptions =
    candidate.startOffset === candidate.endOffset
      ? {}
      : {
          className: "latexdo-next-edit-remove",
        };
  const preview = injectedPreview(candidate);
  const previewOptions =
    preview.length === 0
      ? {}
      : {
          after: {
            content: preview,
            inlineClassName: "latexdo-next-edit-add",
            cursorStops: monaco.editor.InjectedTextCursorStops.None,
          },
        };

  return {
    range,
    options: {
      ...targetOptions,
      ...previewOptions,
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      zIndex: 20,
      showIfCollapsed: true,
    },
  };
}

/**
 * The "Tab" hint sits at the end of the edited line, after everything on it,
 * like VS Code's next-edit hint. Attached to the preview it landed mid-line,
 * between the suggested text and the rest of the sentence, and a pure deletion
 * had no hint at all.
 */
function tabHintDecoration(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  candidate: NextEditCandidate,
  near: boolean,
): Monaco.editor.IModelDeltaDecoration {
  const text = model.getValue();
  const lineBreak = text.indexOf("\n", candidate.endOffset);
  const lineEnd = model.getPositionAt(lineBreak < 0 ? text.length : lineBreak);
  return {
    range: new monaco.Range(
      lineEnd.lineNumber,
      lineEnd.column,
      lineEnd.lineNumber,
      lineEnd.column,
    ),
    options: {
      after: {
        content: near ? "Tab to accept" : "Tab to go here",
        inlineClassName: "latexdo-next-edit-tab-hint",
        cursorStops: monaco.editor.InjectedTextCursorStops.None,
      },
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      zIndex: 20,
      showIfCollapsed: true,
    },
  };
}

function gutterDecoration(
  monaco: typeof Monaco,
  lineNumber: number,
  className: string,
): Monaco.editor.IModelDeltaDecoration {
  return {
    range: new monaco.Range(lineNumber, 1, lineNumber, 1),
    options: { linesDecorationsClassName: className },
  };
}

function injectedPreview(candidate: NextEditCandidate): string {
  return candidate.replacementText
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

function rangeForOffsets(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  startOffset: number,
  endOffset: number,
): Monaco.Range {
  const start = model.getPositionAt(startOffset);
  const end = model.getPositionAt(endOffset);
  return new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);
}

function editorPositionOffset(
  model: Monaco.editor.ITextModel,
  position: Monaco.IPosition | null,
): number {
  return position ? model.getOffsetAt(position) : 0;
}

function supportedLanguage(language: string): SupportedNextEditLanguage {
  if (language === "latex" || language === "bibtex") return language;
  return "text";
}
