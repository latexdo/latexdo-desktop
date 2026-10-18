import type * as Monaco from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";
import type { Diagnostic, DiagnosticFix } from "../types";
import { findLatexDocumentLinkAtOffset } from "../latex/editorFeatureSupport";
import { applyTextFix, diagnosticMarkerMessage } from "../features/editor/diagnostics";
import { normalizeBookmarkLines } from "../features/settings/settings";
import {
  fileName,
  flattenEntries,
  normalizeRelativePath,
} from "../features/project/projectUtils";
import {
  buildProofreadingRequest,
  supportsProofreading,
} from "../features/proofreading/proofreading";
import { editorModelMatchesPath, monaco } from "./appShared";
import type { AppCtx05 } from "./appContext";

export function useAppEditorDecorations(ctx: AppCtx05) {
  const {
    activeBookmarkKey,
    activeBookmarkLines,
    activeDocument,
    activePath,
    activePathRef,
    activeSidebar,
    activeTextDocument,
    bookmarkDecorationsRef,
    citationManagerOpen,
    closeActiveTab,
    closedTabPathsRef,
    compile,
    createDialog,
    defaultCreateRelativePath,
    diagnostics,
    documentsRef,
    editorRef,
    gitContextMenu,
    legalAcceptanceRequired,
    notationManagerOpen,
    openDocument,
    pendingSourceRef,
    projectEntriesRef,
    projectIdRef,
    proofreadingSettings,
    reopenClosedTabArmedRef,
    spellCheckerSettings,
    revealPendingSource,
    reviewChats,
    saveActiveAndCompile,
    setActivePath,
    setBookmarkStore,
    setCitationManagerOpen,
    setCreateDialog,
    setCreateError,
    setCreatePath,
    setDocuments,
    setEditorCursorLine,
    setGitContextMenu,
    setNotationManagerOpen,
    setProofreadingError,
    setProofreadingLoading,
    setProofreadingResult,
    setSettingsOpen,
    setSidebarVisible,
    setStatusMessage,
    setTableCanvasOpen,
    setWelcomeOpen,
    settings,
    settingsOpen,
    sidebarVisible,
    tableCanvasOpen,
  } = ctx;

  const applyDiagnosticReplacement = useCallback((diagnostic: Diagnostic) => {
    if (
      !diagnostic.replacements?.length ||
      !diagnostic.file ||
      diagnostic.source !== "proofread"
    ) {
      return;
    }

    const targetPath = normalizeRelativePath(diagnostic.file);
    const replacement = diagnostic.replacements[0] ?? "";

    setDocuments((current) => {
      const nextDocuments = current.map((document) => {
        if (normalizeRelativePath(document.relativePath) !== targetPath) {
          return document;
        }

        const lines = document.content.split("\n");
        const lineIndex = Math.max(0, diagnostic.line - 1);
        const line = lines[lineIndex];
        if (line === undefined) {
          return document;
        }

        const startColumn = Math.max(0, diagnostic.column - 1);
        const endColumn = Math.max(
          startColumn,
          (diagnostic.endLine === diagnostic.line
            ? (diagnostic.endColumn ?? diagnostic.column)
            : diagnostic.column) - 1,
        );

        lines[lineIndex] =
          line.slice(0, startColumn) + replacement + line.slice(endColumn);

        return {
          ...document,
          content: lines.join("\n"),
        };
      });
      documentsRef.current = nextDocuments;
      return nextDocuments;
    });
    setStatusMessage(`Applied suggestion: ${replacement}`);
  }, []);

  const applyLatexDiagnosticFix = useCallback(
    async (diagnostic: Diagnostic, fix: DiagnosticFix) => {
      const currentProject = projectIdRef.current;
      if (!currentProject || !diagnostic.file) {
        return;
      }

      const targetPath = normalizeRelativePath(diagnostic.file);
      const entry = flattenEntries(projectEntriesRef.current).find(
        (item) =>
          item.type === "file" &&
          normalizeRelativePath(item.relativePath) === targetPath,
      );
      if (!entry) {
        setStatusMessage(`Could not find ${diagnostic.file} in this project`);
        return;
      }

      const openDocumentState = documentsRef.current.find(
        (document) => normalizeRelativePath(document.relativePath) === targetPath,
      );
      const content =
        openDocumentState?.content ??
        (await window.latexdo.readFile(currentProject, entry.relativePath));
      const updatedContent = applyTextFix(content, fix);
      if (updatedContent === null) {
        setStatusMessage(
          "The source changed after this analysis. Compile again before applying the fix.",
        );
        return;
      }

      await window.latexdo.writeFile(
        currentProject,
        entry.relativePath,
        updatedContent,
      );

      if (openDocumentState) {
        const nextDocuments = documentsRef.current.map((document) =>
          document.path === openDocumentState.path
            ? {
                ...document,
                content: updatedContent,
                savedContent: updatedContent,
              }
            : document,
        );
        documentsRef.current = nextDocuments;
        setDocuments(nextDocuments);
        setActivePath(openDocumentState.path);
        activePathRef.current = openDocumentState.path;
      } else {
        await openDocument(entry);
      }

      pendingSourceRef.current = {
        path: entry.path,
        line: fix.line,
        column: fix.column,
        endLine: fix.endLine,
        endColumn: Math.max(fix.column, fix.column + fix.replacement.length),
      };
      setWelcomeOpen(false);
      requestAnimationFrame(() => revealPendingSource());
      setStatusMessage(`Applied fix: ${fix.title}. Recompiling...`);
      await compile();
    },
    [compile, openDocument, revealPendingSource],
  );

  const runProofreading = useCallback(async () => {
    const document = documentsRef.current.find(
      (item) => item.path === activePathRef.current,
    );
    if (!document || !supportsProofreading(document.name)) {
      setProofreadingResult(null);
      return;
    }

    setProofreadingLoading(true);
    setProofreadingError("");
    try {
      const editor = editorRef.current;
      const model = editor?.getModel();
      const position = editor?.getPosition();
      const cursorOffset =
        model &&
        position &&
        document.path === activePathRef.current &&
        editorModelMatchesPath(editor ?? null, document.path)
          ? model.getOffsetAt(position)
          : 0;
      const request = buildProofreadingRequest(document.content, cursorOffset);
      const result = await window.latexdo.proofreadDocument(
        document.relativePath,
        request.content,
        request.options,
      );
      setProofreadingResult(result);
      if (result.error) {
        setProofreadingError(result.error);
      } else {
        setStatusMessage(result.output);
      }
    } catch (error) {
      setProofreadingResult(null);
      setProofreadingError(
        error instanceof Error ? error.message : "Proofreading request failed",
      );
    } finally {
      setProofreadingLoading(false);
    }
  }, []);

  useEffect(() => {
    if (
      !activeTextDocument ||
      !supportsProofreading(activeTextDocument.name) ||
      !proofreadingSettings?.enabled
    ) {
      setProofreadingLoading(false);
      setProofreadingResult(null);
      return;
    }

    const timeout = window.setTimeout(() => {
      void runProofreading().catch(() => {});
    }, 650);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    activeTextDocument?.content,
    activeTextDocument?.name,
    activeTextDocument?.relativePath,
    proofreadingSettings?.enabled,
    proofreadingSettings?.language,
    proofreadingSettings?.motherTongue,
    proofreadingSettings?.picky,
    proofreadingSettings?.serverUrl,
    // A dictionary change hides or shows spelling matches.
    spellCheckerSettings?.customWords,
    runProofreading,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (legalAcceptanceRequired) {
        if (event.key === "Escape") {
          event.preventDefault();
        }
        return;
      }
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveActiveAndCompile();
      }
      if (modifier && event.key === "Enter") {
        event.preventDefault();
        void compile();
      }
      if (modifier && event.key.toLowerCase() === "b" && !event.defaultPrevented) {
        event.preventDefault();
        setSidebarVisible((visible) => !visible);
      }
      if (modifier && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setCreatePath(defaultCreateRelativePath("file"));
        setCreateError("");
        setCreateDialog("file");
      }
      if (event.key === "Escape") {
        if (event.defaultPrevented) {
          return;
        }
        const hasClosableSurface =
          createDialog !== null || settingsOpen || gitContextMenu !== null;
        if (hasClosableSurface) {
          event.preventDefault();
          setCreateDialog(null);
          setSettingsOpen(false);
          setGitContextMenu(null);
          return;
        }
        if (activeSidebar === "ai" && sidebarVisible) {
          event.preventDefault();
          setSidebarVisible(false);
        }
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeSidebar,
    citationManagerOpen,
    compile,
    createDialog,
    defaultCreateRelativePath,
    gitContextMenu,
    legalAcceptanceRequired,
    notationManagerOpen,
    saveActiveAndCompile,
    settingsOpen,
    sidebarVisible,
    tableCanvasOpen,
  ]);

  useEffect(() => {
    const handleCloseTabKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (
        !modifier ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "w"
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      closeActiveTab();
    };

    window.addEventListener("keydown", handleCloseTabKeyDown, true);
    return () => window.removeEventListener("keydown", handleCloseTabKeyDown, true);
  }, [closeActiveTab]);

  const reopenClosedTab = useCallback(() => {
    const entries = flattenEntries(projectEntriesRef.current);
    while (closedTabPathsRef.current.length) {
      const path = closedTabPathsRef.current.pop() as string;
      if (documentsRef.current.some((document) => document.path === path)) {
        continue;
      }
      const entry = entries.find((item) => item.path === path);
      if (entry) {
        void openDocument(entry);
        return true;
      }
    }
    return false;
  }, [openDocument]);

  // Cmd/Ctrl+Z right after closing a tab reopens it (repeat to walk back
  // through earlier closes); any other key or click returns Cmd/Ctrl+Z to
  // normal undo. Cmd/Ctrl+Shift+T reopens the last closed tab at any time.
  useEffect(() => {
    const disarm = () => {
      reopenClosedTabArmedRef.current = false;
    };
    const handleReopenKeyDown = (event: KeyboardEvent) => {
      if (["Meta", "Control", "Shift", "Alt"].includes(event.key)) {
        return;
      }
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const isUndo = modifier && !event.altKey && !event.shiftKey && key === "z";
      const isReopen = modifier && !event.altKey && event.shiftKey && key === "t";
      // Cmd/Ctrl+W is the close itself, which just armed the reopen.
      if (modifier && !event.altKey && !event.shiftKey && key === "w") {
        return;
      }
      if ((isUndo && reopenClosedTabArmedRef.current) || isReopen) {
        if (reopenClosedTab()) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
      disarm();
    };

    window.addEventListener("keydown", handleReopenKeyDown, true);
    window.addEventListener("pointerdown", disarm, true);
    return () => {
      window.removeEventListener("keydown", handleReopenKeyDown, true);
      window.removeEventListener("pointerdown", disarm, true);
    };
  }, [reopenClosedTab]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!activeDocument || !editor) {
      return;
    }
    const model = editor.getModel();
    if (!model || !editorModelMatchesPath(editor, activeDocument.path)) {
      return;
    }
    const relevantDiagnostics = diagnostics.filter(
      (diagnostic) =>
        !diagnostic.file ||
        diagnostic.file === activeDocument.relativePath ||
        fileName(diagnostic.file) === activeDocument.name,
    );
    const lineCount = model.getLineCount();
    monaco.editor.setModelMarkers(
      model,
      "latexdo",
      relevantDiagnostics.map((diagnostic) => {
        const startLineNumber = Math.min(Math.max(1, diagnostic.line), lineCount);
        const endLineNumber = Math.min(
          Math.max(startLineNumber, diagnostic.endLine ?? startLineNumber),
          lineCount,
        );
        const startLineMaxColumn = model.getLineMaxColumn(startLineNumber);
        const endLineMaxColumn = model.getLineMaxColumn(endLineNumber);
        const startColumn = Math.min(
          Math.max(1, diagnostic.column),
          startLineMaxColumn,
        );
        const rawEndColumn = diagnostic.endColumn ?? startColumn + 1;
        const endColumn =
          endLineNumber === startLineNumber
            ? Math.min(
                Math.max(startColumn + 1, rawEndColumn),
                Math.max(startColumn + 1, startLineMaxColumn),
              )
            : Math.min(Math.max(1, rawEndColumn), endLineMaxColumn);
        const reportedLineNumber = diagnostic.reportedLine
          ? Math.min(Math.max(1, diagnostic.reportedLine), lineCount)
          : undefined;
        const reportedColumn = reportedLineNumber
          ? Math.min(
              Math.max(1, diagnostic.reportedColumn ?? 1),
              model.getLineMaxColumn(reportedLineNumber),
            )
          : undefined;

        return {
          startLineNumber,
          startColumn,
          endLineNumber,
          endColumn,
          message: diagnosticMarkerMessage(diagnostic),
          source:
            diagnostic.locationAccuracy === "exact"
              ? "LatexDo analysis"
              : "LaTeX compiler",
          code: diagnostic.code,
          relatedInformation:
            reportedLineNumber && diagnostic.reportedLine !== diagnostic.line
              ? [
                  {
                    resource: model.uri,
                    startLineNumber: reportedLineNumber,
                    startColumn: reportedColumn ?? 1,
                    endLineNumber: reportedLineNumber,
                    endColumn: (reportedColumn ?? 1) + 1,
                    message:
                      "LaTeX stopped here after the earlier root-cause token left the document structure invalid.",
                  },
                ]
              : undefined,
          severity:
            diagnostic.severity === "error"
              ? monaco.MarkerSeverity.Error
              : monaco.MarkerSeverity.Warning,
        };
      }),
    );
  }, [activeDocument, diagnostics]);

  const applyBookmarkDecorations = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor, lines: number[]) => {
      const model = editor.getModel();
      if (!model) {
        bookmarkDecorationsRef.current = [];
        return;
      }
      const lineCount = model.getLineCount();
      const decorations = normalizeBookmarkLines(lines)
        .filter((line) => line <= lineCount)
        .map((line) => ({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: "latexdo-bookmark-line",
            glyphMarginClassName: "latexdo-bookmark-glyph",
            glyphMarginHoverMessage: { value: "Click to remove bookmark" },
            overviewRuler: {
              color: "#f5c542",
              position: monaco.editor.OverviewRulerLane.Center,
            },
            stickiness:
              monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        }));

      bookmarkDecorationsRef.current = editor.deltaDecorations(
        bookmarkDecorationsRef.current,
        decorations,
      );
    },
    [],
  );

  const activeBookmarkLinesFromEditor = useCallback(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (
      !editor ||
      !model ||
      !activeDocument ||
      !editorModelMatchesPath(editor, activeDocument.path) ||
      bookmarkDecorationsRef.current.length === 0
    ) {
      return activeBookmarkLines;
    }

    const lines = bookmarkDecorationsRef.current
      .map((decorationId) => model.getDecorationRange(decorationId)?.startLineNumber)
      .filter((line): line is number => typeof line === "number");
    return normalizeBookmarkLines(lines.length ? lines : activeBookmarkLines);
  }, [activeBookmarkLines, activeDocument]);

  const writeActiveBookmarkLines = useCallback(
    (lines: number[]) => {
      if (!activeBookmarkKey) {
        return;
      }
      const normalized = normalizeBookmarkLines(lines);
      setBookmarkStore((current) => {
        const next = { ...current };
        if (normalized.length) {
          next[activeBookmarkKey] = normalized;
        } else {
          delete next[activeBookmarkKey];
        }
        return next;
      });
    },
    [activeBookmarkKey],
  );

  const toggleBookmarkAtCurrentLine = useCallback(() => {
    const editor = editorRef.current;
    const position = editor?.getPosition();
    if (
      !editor ||
      !position ||
      !activeDocument ||
      !editorModelMatchesPath(editor, activeDocument.path)
    ) {
      setStatusMessage("Open a document before adding bookmarks.");
      return;
    }

    const currentLines = activeBookmarkLinesFromEditor();
    const exists = currentLines.includes(position.lineNumber);
    const nextLines = exists
      ? currentLines.filter((line) => line !== position.lineNumber)
      : [...currentLines, position.lineNumber];
    setEditorCursorLine(position.lineNumber);
    writeActiveBookmarkLines(nextLines);
    setStatusMessage(
      exists
        ? `Removed bookmark at line ${position.lineNumber}`
        : `Bookmarked line ${position.lineNumber}`,
    );
    editor.focus();
  }, [activeBookmarkLinesFromEditor, activeDocument, writeActiveBookmarkLines]);

  const jumpToBookmark = useCallback(
    (direction: "next" | "previous") => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (
        !editor ||
        !model ||
        !activeDocument ||
        !editorModelMatchesPath(editor, activeDocument.path)
      ) {
        setStatusMessage("Open a document before using bookmarks.");
        return;
      }

      const lines = activeBookmarkLinesFromEditor().filter(
        (line) => line <= model.getLineCount(),
      );
      if (!lines.length) {
        setStatusMessage("No bookmarks in this file.");
        return;
      }

      const currentLine = editor.getPosition()?.lineNumber ?? 1;
      const targetLine =
        direction === "next"
          ? (lines.find((line) => line > currentLine) ?? lines[0])
          : ([...lines].reverse().find((line) => line < currentLine) ??
            lines[lines.length - 1]);

      editor.setPosition({ lineNumber: targetLine, column: 1 });
      editor.revealLineInCenter(targetLine, monaco.editor.ScrollType.Smooth);
      editor.focus();
      setStatusMessage(`Opened bookmark at line ${targetLine}`);
    },
    [activeBookmarkLinesFromEditor, activeDocument],
  );

  const openLinkAtCursor = useCallback(async () => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const position = editor?.getPosition();
    if (
      !editor ||
      !model ||
      !position ||
      !activeDocument ||
      !editorModelMatchesPath(editor, activeDocument.path)
    ) {
      setStatusMessage("Place the cursor on a link first.");
      return;
    }

    const link = findLatexDocumentLinkAtOffset(
      model.getValue(),
      model.getOffsetAt(position),
    );
    if (!link) {
      setStatusMessage("No LaTeX link at the cursor.");
      return;
    }

    await window.latexdo.openExternalUrl(link.url);
    setStatusMessage(`Opened ${link.url}`);
  }, [activeDocument]);

  const revealOutlineLine = useCallback(
    (line: number, column: number) => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (
        !editor ||
        !model ||
        !activeDocument ||
        !editorModelMatchesPath(editor, activeDocument.path)
      ) {
        return;
      }
      const safeLine = Math.min(Math.max(1, line), model.getLineCount());
      const safeColumn = Math.min(
        Math.max(1, column),
        model.getLineMaxColumn(safeLine),
      );
      editor.setPosition({ lineNumber: safeLine, column: safeColumn });
      editor.revealLineInCenter(safeLine, monaco.editor.ScrollType.Smooth);
      editor.focus();
    },
    [activeDocument],
  );

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !activePath || !editorModelMatchesPath(editor, activePath)) {
      setEditorCursorLine(null);
      return;
    }
    setEditorCursorLine(editor.getPosition()?.lineNumber ?? null);
  }, [activePath]);

  useEffect(() => {
    const editor = editorRef.current;
    if (
      !editor ||
      !activeDocument ||
      !editorModelMatchesPath(editor, activeDocument.path)
    ) {
      return;
    }
    applyBookmarkDecorations(editor, activeBookmarkLines);
  }, [activeBookmarkLines, activeDocument, applyBookmarkDecorations]);

  const reviewDecorationsRef = useRef<string[]>([]);

  useEffect(() => {
    const editor = editorRef.current;
    if (
      !editor ||
      !activeDocument ||
      !editorModelMatchesPath(editor, activeDocument.path)
    ) {
      return;
    }

    const relevantChats = reviewChats.filter(
      (chat) => chat.filePath === activeDocument.relativePath,
    );
    const decorations = relevantChats.flatMap((chat) => {
      const firstComment = chat.comments[0]?.text.trim();
      const hoverMessage = {
        value: firstComment ? `Review thread: ${firstComment}` : "Review thread",
      };

      return [
        {
          range: new monaco.Range(
            chat.selection.startLine,
            chat.selection.startColumn,
            chat.selection.endLine,
            chat.selection.endColumn,
          ),
          options: {
            isWholeLine: false,
            inlineClassName: "review-comment-decoration",
            stickiness:
              monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
            hoverMessage,
          },
        },
        {
          range: new monaco.Range(
            chat.selection.startLine,
            1,
            chat.selection.startLine,
            1,
          ),
          options: {
            isWholeLine: true,
            glyphMarginClassName: "review-comment-glyph",
            glyphMargin: { position: monaco.editor.GlyphMarginLane.Center },
            stickiness:
              monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
            glyphMarginHoverMessage: hoverMessage,
          },
        },
      ];
    });

    reviewDecorationsRef.current = editor.deltaDecorations(
      reviewDecorationsRef.current,
      decorations,
    );
  }, [activeDocument, reviewChats]);

  const latexDecorationsRef = useRef<string[]>([]);

  const updateLatexDecorations = useCallback(() => {
    const editor = editorRef.current;
    if (
      !editor ||
      !activeDocument ||
      !activeDocument.content ||
      !editorModelMatchesPath(editor, activeDocument.path)
    ) {
      return;
    }

    if (settings.showRawLatex) {
      latexDecorationsRef.current = editor.deltaDecorations(
        latexDecorationsRef.current,
        [],
      );
      return;
    }

    const model = editor.getModel();
    if (!model) return;

    const ranges: Monaco.editor.IModelDeltaDecoration[] = [];
    const text = activeDocument.content;

    for (const match of text.matchAll(/\\(?:[a-zA-Z]+|\S)|%/g)) {
      const startOffset = match.index!;
      const command = match[0];

      let preText = text.slice(0, startOffset);
      let startLine = 1;
      let lastNewline = -1;
      while (true) {
        const nl = preText.indexOf("\n", lastNewline + 1);
        if (nl === -1 || nl >= startOffset) break;
        startLine++;
        lastNewline = nl;
      }
      let startCol = startOffset - (lastNewline + 1) + 1;

      let endOffset = startOffset + command.length;

      if (command === "%") {
        const nl = text.indexOf("\n", startOffset);
        endOffset = nl === -1 ? text.length : nl;
      } else if (command.startsWith("\\")) {
        const nextChar = text[endOffset];
        if (nextChar === "[") {
          let depth = 1;
          let i = endOffset + 1;
          while (i < text.length && depth > 0) {
            if (text[i] === "[") depth++;
            else if (text[i] === "]") depth--;
            i++;
          }
          endOffset = i;
        }
        if (text[endOffset] === "{") {
          let depth = 1;
          let i = endOffset + 1;
          while (i < text.length && depth > 0) {
            if (text[i] === "{") depth++;
            else if (text[i] === "}") depth--;
            i++;
          }
          endOffset = i;
        }
      }

      let endLine = startLine;
      let endCol = startCol;
      for (let i = startOffset; i < endOffset; i++) {
        if (text[i] === "\n") {
          endLine++;
          endCol = 1;
        } else {
          endCol++;
        }
      }

      ranges.push({
        range: new monaco.Range(startLine, startCol, endLine, endCol),
        options: {
          inlineClassName: "latex-command-hidden",
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      });
    }

    latexDecorationsRef.current = editor.deltaDecorations(
      latexDecorationsRef.current,
      ranges,
    );
  }, [activeDocument, settings.showRawLatex]);

  useEffect(() => {
    updateLatexDecorations();
  }, [updateLatexDecorations]);

  const mathPreviewForegrounds: Record<string, string> = {
    graphite: "#d7dce5",
    midnight: "#dce8f8",
    forest: "#e1ebe5",
    sepia: "#eee4d4",
    studio: "#1f2937",
    paper: "#252a31",
  };

  return {
    applyDiagnosticReplacement,
    applyLatexDiagnosticFix,
    runProofreading,
    applyBookmarkDecorations,
    toggleBookmarkAtCurrentLine,
    jumpToBookmark,
    openLinkAtCursor,
    revealOutlineLine,
    mathPreviewForegrounds,
  };
}
