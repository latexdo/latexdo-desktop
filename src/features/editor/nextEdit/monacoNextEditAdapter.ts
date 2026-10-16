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
}: InstallMonacoNextEditOptions): MonacoNextEditAdapter {
  const activeController =
    controller ??
    new NextEditController({
      now,
      semanticPredictor,
      semanticEnabled: config.semanticEnabled,
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

    decorations?.set([
      decorationForCandidate(monaco, targetModel, candidate),
      tabHintDecoration(monaco, targetModel, candidate),
    ]);
    visibleKey.set(true);
  }

  function refreshModelSnapshot(): void {
    currentModel = editor.getModel();
    currentText = currentModel?.getValue() ?? "";
    currentRevision = currentModel?.getVersionId() ?? currentRevision + 1;
    activeController.onDocumentChanged(snapshotFor());
    render(activeController.getSuggestion());
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

  const unsubscribeSuggestion = activeController.subscribeSuggestionChanged(render);
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
      render(activeController.getSuggestion());
    }),
    editor.onDidChangeCursorPosition((event) => {
      const targetModel = editor.getModel();
      if (!targetModel) return;
      activeController.onCursorMoved(targetModel.getOffsetAt(event.position));
      render(activeController.getSuggestion());
    }),
    editor.onDidChangeCursorSelection((event) => {
      const targetModel = editor.getModel();
      if (!targetModel) return;
      activeController.onSelectionChanged(
        targetModel.getOffsetAt(event.selection.getStartPosition()),
        targetModel.getOffsetAt(event.selection.getEndPosition()),
      );
      render(activeController.getSuggestion());
    }),
    editor.onDidChangeModel(() => {
      decorations?.clear();
      decorations = editor.createDecorationsCollection();
      refreshModelSnapshot();
    }),
    editor.addAction({
      id: acceptActionId,
      label: "Accept Next Edit Suggestion",
      keybindings: [monaco.KeyCode.Tab],
      precondition:
        "editorTextFocus && latexdoNextEditVisible && !suggestWidgetVisible && !renameInputVisible && !inSnippetMode",
      run: () => {
        acceptVisibleSuggestion();
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
        content: "Tab",
        inlineClassName: "latexdo-next-edit-tab-hint",
        cursorStops: monaco.editor.InjectedTextCursorStops.None,
      },
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      zIndex: 20,
      showIfCollapsed: true,
    },
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
