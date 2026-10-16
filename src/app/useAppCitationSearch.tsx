import { useCallback } from "react";
import { type CitationSearchAnchor } from "../components/CitationSearchPopup";
import { getLatexCompletionContext } from "../latex/completionContext";
import type { CitationEntry } from "../latex/latexIndex";
import { completionRangeAtPosition, monaco } from "./appShared";
import type { AppCtx06 } from "./appContext";

export function useAppCitationSearch(ctx: AppCtx06) {
  const {
    citationSuggestTimerRef,
    editorRef,
    setCitationSearchAnchor,
    setCitationSearchFocusRequest,
  } = ctx;

  // Keeps the bibliography search bar attached to the citation key being
  // typed, and hides it once the caret leaves the \cite{...} argument.
  const syncCitationSearchAnchor = useCallback((targetEditor = editorRef.current) => {
    const model = targetEditor?.getModel();
    const position = targetEditor?.getPosition();
    let next: CitationSearchAnchor | null = null;
    if (targetEditor && model && position && model.getLanguageId() === "latex") {
      const context = getLatexCompletionContext(
        model.getLineContent(position.lineNumber),
        position.column,
      );
      const domNode = targetEditor.getDomNode?.();
      const visible =
        context?.type === "citation"
          ? targetEditor.getScrolledVisiblePosition?.({
              lineNumber: position.lineNumber,
              column: context.rangeStartColumn,
            })
          : null;
      if (domNode && visible) {
        const rect = domNode.getBoundingClientRect();
        const top = rect.top + visible.top;
        if (top >= rect.top && top + visible.height <= rect.bottom) {
          next = {
            left: Math.round(rect.left + visible.left),
            top: Math.round(top),
            bottom: Math.round(top + visible.height),
          };
        }
      }
    }
    setCitationSearchAnchor((current) =>
      current?.left === next?.left &&
      current?.top === next?.top &&
      current?.bottom === next?.bottom
        ? current
        : next,
    );
  }, []);

  // After a key is accepted the author keeps writing: close the list, cancel
  // the pending re-open, and step over the closing brace when the key ends the
  // argument (\cite{key|} → \cite{key}|). Otherwise the list reopened at once
  // and swallowed Enter, Tab and the arrow keys.
  const finishCitationInsert = useCallback((targetEditor = editorRef.current) => {
    if (citationSuggestTimerRef.current !== null) {
      window.clearTimeout(citationSuggestTimerRef.current);
      citationSuggestTimerRef.current = null;
    }
    const model = targetEditor?.getModel();
    const position = targetEditor?.getPosition();
    if (!targetEditor || !model || !position) return;
    targetEditor.trigger("latexdo-citation", "hideSuggestWidget", {});
    const line = model.getLineContent(position.lineNumber);
    if (line[position.column - 1] === "}") {
      targetEditor.setPosition({
        lineNumber: position.lineNumber,
        column: position.column + 1,
      });
    }
    setCitationSearchAnchor(null);
  }, []);

  const insertCitationFromSearch = useCallback(
    (entry: CitationEntry) => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      const position = editor?.getPosition();
      if (!editor || !model || !position) return;
      const context = getLatexCompletionContext(
        model.getLineContent(position.lineNumber),
        position.column,
      );
      if (context?.type !== "citation") {
        editor.focus();
        return;
      }
      editor.pushUndoStop();
      editor.executeEdits("latexdo-citation-search", [
        {
          range: completionRangeAtPosition(model, position, context),
          text: entry.key,
          forceMoveMarkers: true,
        },
      ]);
      editor.pushUndoStop();
      editor.focus();
      finishCitationInsert(editor);
    },
    [finishCitationInsert],
  );

  const clearCitationSearchFocusRequest = useCallback(() => {
    setCitationSearchFocusRequest(0);
  }, []);

  const openCitationSearch = useCallback(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const position = editor?.getPosition();
    if (!editor || !model || !position || model.getLanguageId() !== "latex") return;
    const context = getLatexCompletionContext(
      model.getLineContent(position.lineNumber),
      position.column,
    );
    if (context?.type !== "citation") {
      // Start a citation at the caret so the picked key has somewhere to go.
      editor.pushUndoStop();
      editor.executeEdits("latexdo-citation-search", [
        {
          range: new monaco.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column,
          ),
          text: "\\cite{}",
          forceMoveMarkers: true,
        },
      ]);
      editor.setPosition({
        lineNumber: position.lineNumber,
        column: position.column + "\\cite{".length,
      });
    }
    syncCitationSearchAnchor(editor);
    setCitationSearchFocusRequest((value) => value + 1);
  }, [syncCitationSearchAnchor]);

  const triggerCitationCompletionIfNeeded = useCallback(
    (targetEditor = editorRef.current) => {
      syncCitationSearchAnchor(targetEditor);
      const model = targetEditor?.getModel();
      const position = targetEditor?.getPosition();
      if (!targetEditor || !model || !position || model.getLanguageId() !== "latex") {
        return;
      }

      const context = getLatexCompletionContext(
        model.getLineContent(position.lineNumber),
        position.column,
      );
      if (context?.type !== "citation") {
        return;
      }

      if (citationSuggestTimerRef.current !== null) {
        window.clearTimeout(citationSuggestTimerRef.current);
      }
      citationSuggestTimerRef.current = window.setTimeout(() => {
        citationSuggestTimerRef.current = null;
        const currentEditor = editorRef.current;
        const currentModel = currentEditor?.getModel();
        const currentPosition = currentEditor?.getPosition();
        if (
          currentEditor !== targetEditor ||
          currentModel !== model ||
          !currentPosition
        ) {
          return;
        }
        const currentContext = getLatexCompletionContext(
          model.getLineContent(currentPosition.lineNumber),
          currentPosition.column,
        );
        if (currentContext?.type === "citation") {
          targetEditor.trigger("latexdo-citation", "editor.action.triggerSuggest", {});
        }
      }, 80);
    },
    [syncCitationSearchAnchor],
  );

  return {
    syncCitationSearchAnchor,
    finishCitationInsert,
    insertCitationFromSearch,
    clearCitationSearchFocusRequest,
    openCitationSearch,
    triggerCitationCompletionIfNeeded,
  };
}
