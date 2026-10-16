import type * as Monaco from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";
import {
  figureInsertionText,
  preambleEditFor,
  prepareTikzSnippet,
  safeFigureOffset,
  tikzRequirements,
  withPreambleEdit,
} from "../features/tikz/tikzSnippet";
import {
  isToolTab,
  toolTabIds,
  toolTabKey,
  type ToolTabId,
  type ToolTabKey,
} from "../features/workspace/toolTabs";
import { normalizeRelativePath } from "../features/project/projectUtils";
import { editorModelMatchesPath, isTextDocument, monaco } from "./appShared";
import type { AppCtx10 } from "./appContext";

type CodeEditor = Monaco.editor.IStandaloneCodeEditor;

export interface FigureInsertResult {
  ok: boolean;
  message: string;
  /** Preamble lines that were added, in the file itself or in the root file. */
  preambleLines: string[];
}

/**
 * Tools as workspace tabs (TikZ and the extension tools), and one path for
 * every figure that lands in a document — from the canvas, the image tracer or
 * the AI — so each one gets its packages and libraries and a place where it
 * compiles.
 */
export function useAppTikzFigures(ctx: AppCtx10) {
  const latest = useRef(ctx);
  latest.current = ctx;
  const {
    activePath,
    citationManagerOpen,
    extensionDetailsId,
    extensionToolAvailability,
    notationManagerOpen,
    tableCanvasOpen,
    tikzCanvasOpen,
    tikzConverterOpen,
  } = ctx;
  const toolOpen: Record<ToolTabKey, boolean> = {
    tikzCanvas: tikzCanvasOpen,
    tikzConverter: tikzConverterOpen && extensionToolAvailability.tikzConverter,
    tableGenerator: tableCanvasOpen && extensionToolAvailability.tableGenerator,
    notationManager: notationManagerOpen && extensionToolAvailability.notationManager,
    citationManager:
      citationManagerOpen && extensionToolAvailability.projectBibliography,
    extensionDetails: Boolean(extensionDetailsId),
  };

  /** The document to come back to, with its cursor and scroll position. */
  const returnTargetRef = useRef<{
    path: string;
    position: Monaco.IPosition | null;
    viewState: Monaco.editor.ICodeEditorViewState | null;
  }>({ path: "", position: null, viewState: null });
  /** Work that waits for a document's editor to mount (after leaving a tab). */
  const pendingRunRef = useRef<{
    path: string;
    run: (editor: CodeEditor) => void;
  } | null>(null);

  const goTo = useCallback((path: string) => {
    const { setActivePath, activePathRef } = latest.current;
    setActivePath(path);
    activePathRef.current = path;
  }, []);

  const rememberReturnTarget = useCallback(() => {
    const { activePathRef, documentsRef, editorRef } = latest.current;
    const current = activePathRef.current;
    if (!current || isToolTab(current)) return;
    const document = documentsRef.current.find((item) => item.path === current);
    if (!document) return;
    const editor = editorRef.current;
    const live =
      isTextDocument(document) && editor && editorModelMatchesPath(editor, current);
    returnTargetRef.current = {
      path: current,
      position: live ? editor.getPosition() : null,
      viewState: live ? editor.saveViewState() : null,
    };
  }, []);

  const leaveToolTab = useCallback(() => {
    const { documentsRef } = latest.current;
    const documents = documentsRef.current;
    goTo(
      documents.find((item) => item.path === returnTargetRef.current.path)?.path ??
        documents[0]?.path ??
        "",
    );
  }, [goTo]);

  const setToolOpen = useCallback((key: ToolTabKey, open: boolean) => {
    const {
      setCitationManagerOpen,
      setExtensionDetailsId,
      setNotationManagerOpen,
      setTableCanvasOpen,
      setTikzCanvasOpen,
      setTikzConverterOpen,
    } = latest.current;
    ({
      tikzCanvas: setTikzCanvasOpen,
      tikzConverter: setTikzConverterOpen,
      tableGenerator: setTableCanvasOpen,
      notationManager: setNotationManagerOpen,
      citationManager: setCitationManagerOpen,
      // Opened with an id by openExtensionDetails; here it can only close.
      extensionDetails: (isOpen: boolean) => {
        if (!isOpen) setExtensionDetailsId("");
      },
    })[key](open);
  }, []);

  const openToolTab = useCallback(
    (id: ToolTabId) => {
      const key = toolTabKey(id);
      if (!key) return;
      rememberReturnTarget();
      setToolOpen(key, true);
      goTo(id);
    },
    [goTo, rememberReturnTarget, setToolOpen],
  );

  const closeToolTab = useCallback(
    (id: ToolTabId) => {
      const key = toolTabKey(id);
      if (!key) return;
      setToolOpen(key, false);
      if (latest.current.activePathRef.current === id) leaveToolTab();
    },
    [leaveToolTab, setToolOpen],
  );

  /** Shows an extension's details page in the editor area, like VS Code. */
  const openExtensionDetails = useCallback(
    (extensionId: string) => {
      latest.current.setExtensionDetailsId(extensionId);
      openToolTab(toolTabIds.extensionDetails);
    },
    [openToolTab],
  );

  /** Activity bar button: opens the tab, or goes back to the document from it. */
  const toggleToolTab = useCallback(
    (id: ToolTabId) => {
      if (latest.current.activePathRef.current === id) leaveToolTab();
      else openToolTab(id);
    },
    [leaveToolTab, openToolTab],
  );

  // A tab whose tool was closed elsewhere (Ctrl+W, extension disabled) hands
  // the workspace back to a document instead of an empty pane.
  const activeKey = toolTabKey(activePath);
  const activeToolClosed = activeKey !== null && !toolOpen[activeKey];
  useEffect(() => {
    if (activeToolClosed) leaveToolTab();
  }, [activeToolClosed, leaveToolTab]);

  /**
   * Runs `run` in a .tex document from a tool tab: the one the tab was opened
   * from (or the main file), once its editor is back, cursor restored.
   */
  const runInReturnDocument = useCallback(
    (run: (editor: CodeEditor) => void): boolean => {
      const { activePathRef, documentsRef, editorRef, rootFile, setStatusMessage } =
        latest.current;
      const current = activePathRef.current;
      const editor = editorRef.current;
      const currentDocument = documentsRef.current.find(
        (item) => item.path === current,
      );
      // Already in a document (e.g. the AI chat beside it): run right away.
      if (
        editor &&
        isTextDocument(currentDocument) &&
        currentDocument.name.endsWith(".tex") &&
        editorModelMatchesPath(editor, current)
      ) {
        run(editor);
        return true;
      }
      const texDocuments = documentsRef.current.filter(
        (document) => isTextDocument(document) && document.name.endsWith(".tex"),
      );
      const target =
        texDocuments.find(
          (document) => document.path === returnTargetRef.current.path,
        ) ??
        texDocuments.find(
          (document) =>
            normalizeRelativePath(document.relativePath) ===
            normalizeRelativePath(rootFile),
        ) ??
        texDocuments[0];
      if (!target) {
        setStatusMessage("Open a .tex file first.");
        return false;
      }
      if (returnTargetRef.current.path !== target.path) {
        returnTargetRef.current = {
          path: target.path,
          position: null,
          viewState: null,
        };
      }
      pendingRunRef.current = { path: target.path, run };
      goTo(target.path);
      return true;
    },
    [goTo],
  );

  /** Called when the editor mounts: restores the cursor, then runs waiting work. */
  const applyPendingFigure = useCallback((editor: CodeEditor) => {
    const back = returnTargetRef.current;
    if (back.path && editorModelMatchesPath(editor, back.path)) {
      if (back.viewState) editor.restoreViewState(back.viewState);
      else if (back.position) editor.setPosition(back.position);
      returnTargetRef.current = { path: back.path, position: null, viewState: null };
    }
    const pending = pendingRunRef.current;
    if (!pending || !editorModelMatchesPath(editor, pending.path)) return;
    pendingRunRef.current = null;
    pending.run(editor);
  }, []);

  /** Writes the editor's text into the document list now, so a compile sees it. */
  const syncDocumentContent = useCallback((path: string, content: string) => {
    const { documentsRef, setDocuments } = latest.current;
    const update = (documents: typeof documentsRef.current) =>
      documents.map((document) =>
        document.path === path ? { ...document, content } : document,
      );
    documentsRef.current = update(documentsRef.current);
    setDocuments((current) => {
      const next = update(current);
      documentsRef.current = next;
      return next;
    });
  }, []);

  /** Adds preamble lines to the root file when the figure goes into a chapter. */
  const patchRootPreamble = useCallback(
    async (
      requirements: ReturnType<typeof tikzRequirements>,
      snippetLines: string[],
    ): Promise<string[] | null> => {
      const { documentsRef, projectIdRef, rootFile } = latest.current;
      const rootPath = normalizeRelativePath(rootFile);
      const open = documentsRef.current.find(
        (document) =>
          isTextDocument(document) &&
          normalizeRelativePath(document.relativePath) === rootPath,
      );
      if (open && isTextDocument(open)) {
        const edit = preambleEditFor(open.content, requirements, snippetLines);
        if (!edit) return null;
        if (edit.text)
          syncDocumentContent(open.path, withPreambleEdit(open.content, edit));
        return edit.lines;
      }
      const project = projectIdRef.current;
      if (!project) return null;
      try {
        const content = await window.latexdo.readFile(project, rootFile);
        const edit = preambleEditFor(content, requirements, snippetLines);
        if (!edit) return null;
        if (edit.text) {
          await window.latexdo.writeFile(
            project,
            rootFile,
            withPreambleEdit(content, edit),
          );
        }
        return edit.lines;
      } catch {
        return null;
      }
    },
    [syncDocumentContent],
  );

  /**
   * Puts TikZ code into the editor: at the cursor (moved into the document
   * body when it sits in the preamble) or over the selection. The preamble gets
   * what the figure needs in the same undo step, and the figure is selected.
   */
  const insertFigureInEditor = useCallback(
    async (
      editor: CodeEditor,
      code: string,
      mode: "cursor" | "selection",
      position?: Monaco.IPosition | null,
    ): Promise<FigureInsertResult> => {
      const { activeCollaborationReadOnlyMessage, activePathRef } = latest.current;
      const model = editor.getModel();
      if (!model)
        return { ok: false, message: "Open a .tex file first.", preambleLines: [] };
      if (activeCollaborationReadOnlyMessage) {
        return {
          ok: false,
          message: activeCollaborationReadOnlyMessage,
          preambleLines: [],
        };
      }
      const prepared = prepareTikzSnippet(code);
      if (!prepared.body.trim()) {
        return {
          ok: false,
          message: "There is no figure to insert.",
          preambleLines: [],
        };
      }
      const requirements = tikzRequirements(prepared.body);
      const text = model.getValue();

      let start: number;
      let end: number;
      let insertText: string;
      const selection = editor.getSelection();
      if (mode === "selection" && selection && !selection.isEmpty()) {
        start = model.getOffsetAt(selection.getStartPosition());
        end = model.getOffsetAt(selection.getEndPosition());
        insertText = prepared.body;
      } else {
        const cursor = position
          ? model.validatePosition(position)
          : (editor.getPosition() ?? model.getPositionAt(text.length));
        start = end = safeFigureOffset(text, model.getOffsetAt(cursor));
        insertText = figureInsertionText(text, start, prepared.body);
      }

      let preamble = preambleEditFor(text, requirements, prepared.preambleLines);
      if (preamble && preamble.offset > start && preamble.offset < end) preamble = null;
      const rangeAt = (from: number, to: number) => {
        const a = model.getPositionAt(from);
        const b = model.getPositionAt(to);
        return new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column);
      };
      const edits: Monaco.editor.IIdentifiedSingleEditOperation[] = [];
      if (preamble?.text) {
        edits.push({
          range: rangeAt(preamble.offset, preamble.offset),
          text: preamble.text,
        });
      }
      edits.push({
        range: rangeAt(start, end),
        text: insertText,
        forceMoveMarkers: true,
      });

      editor.pushUndoStop();
      editor.executeEdits("latexdo-tikz", edits);
      editor.pushUndoStop();

      const shift =
        preamble?.text && preamble.offset <= start ? preamble.text.length : 0;
      const bodyStart = start + shift + insertText.indexOf(prepared.body);
      const first = model.getPositionAt(bodyStart);
      const last = model.getPositionAt(bodyStart + prepared.body.length);
      // Cursor at the top of the figure, so the PDF jumps to where it begins.
      editor.setSelection(
        new monaco.Selection(
          last.lineNumber,
          last.column,
          first.lineNumber,
          first.column,
        ),
      );
      editor.revealRangeInCenterIfOutsideViewport(
        new monaco.Range(first.lineNumber, 1, last.lineNumber, 1),
        monaco.editor.ScrollType.Smooth,
      );
      const path = activePathRef.current;
      if (editorModelMatchesPath(editor, path))
        syncDocumentContent(path, model.getValue());

      let preambleLines = preamble?.lines ?? [];
      let message = "Figure inserted.";
      if (!preamble) {
        const rootLines = await patchRootPreamble(requirements, prepared.preambleLines);
        if (rootLines === null) {
          const needed = requirements.packages.join(", ");
          message = needed
            ? `Figure inserted. Load ${needed} in your main file's preamble.`
            : message;
        } else {
          preambleLines = rootLines;
        }
      }
      if (preambleLines.length) {
        message = `Figure inserted; added ${preambleLines.join(" ")} to the preamble.`;
      }
      return { ok: true, message, preambleLines };
    },
    [patchRootPreamble, syncDocumentContent],
  );

  /** Compiles and scrolls the PDF to the cursor, which sits on the new figure. */
  const showFigureInPreview = useCallback(async () => {
    const { compile, handleEditorCursorToPdf, setPreviewVisible } = latest.current;
    setPreviewVisible(true);
    const result = await compile();
    if (result?.ok) await handleEditorCursorToPdf();
    return result;
  }, []);

  /** Insert a figure from a tab or the chat, then compile and show it. */
  const insertFigure = useCallback(
    (code: string) =>
      runInReturnDocument((editor) => {
        void insertFigureInEditor(editor, code, "cursor").then((result) => {
          latest.current.setStatusMessage(result.message);
          if (result.ok) void showFigureInPreview();
        });
      }),
    [insertFigureInEditor, runInReturnDocument, showFigureInPreview],
  );

  /** Plain LaTeX from a tool tab (a table), on lines of its own at the cursor. */
  const insertTextFromTool = useCallback(
    (code: string) =>
      runInReturnDocument((editor) => {
        const model = editor.getModel();
        if (!model) return;
        const text = model.getValue();
        const position = editor.getPosition() ?? model.getPositionAt(text.length);
        const offset = model.getOffsetAt(position);
        const insert = figureInsertionText(text, offset, code);
        editor.pushUndoStop();
        editor.executeEdits("latexdo-tool", [
          {
            range: new monaco.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column,
            ),
            text: insert,
            forceMoveMarkers: true,
          },
        ]);
        editor.pushUndoStop();
        editor.focus();
        latest.current.setStatusMessage("Inserted.");
      }),
    [runInReturnDocument],
  );

  return {
    insertFigure,
    insertFigureFromTool: insertFigure,
    insertTextFromTool,
    runInReturnDocument,
    openToolTab,
    closeToolTab,
    toggleToolTab,
    openExtensionDetails,
    toolTabOpen: toolOpen,
    toolReturnPath: () => returnTargetRef.current.path,
    insertFigureInEditor,
    applyPendingFigure,
    showFigureInPreview,
  };
}
