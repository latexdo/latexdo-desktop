import { useCallback, useEffect } from "react";
import { emitProductEvent } from "../features/onboarding/core/ProductEvents";
import type { Diagnostic, GitChangeEntry, GitChangedEvent } from "../types";
import { pathForDisplay } from "../pathDisplay";
import {
  formatLatexDocumentLayout,
  formatLatexTableAtOffset,
} from "../latex/editorFeatureSupport";
import { diagnosticLocationLabel } from "../features/editor/diagnostics";
import { gitDiscardStatusMessage, type GitChangeArea } from "../features/git/gitUi";
import {
  fileName,
  flattenEntries,
  languageFor,
  normalizeRelativePath,
} from "../features/project/projectUtils";
import {
  updateCheckIntervalMs,
  updateRecheckOnFocusMs,
} from "../features/pdf/updateFormatting";
import {
  LatexToolbarCommand,
  clampSelectionToModel,
  editorModelMatchesPath,
  ipcErrorMessage,
  isTextDocument,
  monaco,
} from "./appShared";
import type { AppCtx12 } from "./appContext";

export function useAppGitNavigation(ctx: AppCtx12) {
  const {
    reloadOpenDocumentsFromDisk,
    unstagedGitEntries,
    activateGitDiffSession,
    activeDocument,
    activePath,
    activePathRef,
    activeSidebar,
    allProjectEntries,
    checkForUpdates,
    closeGitDiffSession,
    documents,
    documentsRef,
    editorPathBeforeWelcomeRef,
    editorRef,
    gitContextMenu,
    gitFileHistoryPathRef,
    gitRefreshTimerRef,
    gitRowClickTimerRef,
    hideProjectEntries,
    openDocument,
    openWhatsNewDialog,
    pendingSourceRef,
    previewShown,
    projectEntries,
    projectEntriesRef,
    projectId,
    projectIdRef,
    refreshGitData,
    refreshProject,
    revealPendingSource,
    rootFileRef,
    scheduleGitRefresh,
    setActivePath,
    setCollapsedGitGroups,
    setCompileProgress,
    setDocuments,
    setGitActionBusy,
    setGitCommitDetails,
    setGitCommitParentHash,
    setGitContextMenu,
    setGitFileHistory,
    setGitFileHistoryPath,
    setGitPanelTab,
    setPreviewVisible,
    setSelectedGitCommitHash,
    setStatusMessage,
    setUpdateAttemptStatus,
    setUpdateInfo,
    setUpdateProgress,
    setWelcomeOpen,
    setWhatsNew,
    setWhatsNewOpen,
    showWelcome,
  } = ctx;

  const discardAllGitEntries = useCallback(async () => {
    const currentProject = projectIdRef.current;
    if (!currentProject) return;

    setGitActionBusy("discard-all");
    try {
      const discardedPaths = unstagedGitEntries.map((entry) => entry.path);
      const result = await window.latexdo.discardAllGit(currentProject);
      if (!result.discarded) {
        setStatusMessage("Discard canceled.");
        return;
      }
      closeGitDiffSession();
      await reloadOpenDocumentsFromDisk({
        paths: discardedPaths,
        includeUnsaved: true,
      });
      await refreshProject(currentProject);
      await refreshGitData();
      setStatusMessage(
        gitDiscardStatusMessage(result, "Discarded all unstaged changes"),
      );
    } catch (error) {
      setStatusMessage(ipcErrorMessage(error, "Could not discard the changes"));
    } finally {
      setGitActionBusy(null);
    }
  }, [
    closeGitDiffSession,
    refreshGitData,
    refreshProject,
    reloadOpenDocumentsFromDisk,
    unstagedGitEntries,
  ]);

  const openGitCommitDetails = useCallback(async (hash: string) => {
    const currentProject = projectIdRef.current;
    if (!currentProject) return;

    setSelectedGitCommitHash(hash);
    setGitPanelTab("history");
    setGitActionBusy(`commit:${hash}`);
    try {
      const details = await window.latexdo.getGitCommitDetails(currentProject, hash);
      setGitCommitDetails(details);
      setGitCommitParentHash(details.parents[0] ?? "");
    } finally {
      setGitActionBusy(null);
    }
  }, []);

  const openGitCommitRevisionDiff = useCallback(
    async (hash: string, relativePath: string, parentHash?: string) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) return;

      setGitActionBusy(`commit-diff:${hash}:${relativePath}`);
      try {
        const snapshot = await window.latexdo.getGitCommitFileDiff(
          currentProject,
          relativePath,
          hash,
          parentHash || undefined,
        );
        await activateGitDiffSession(snapshot);
        setStatusMessage(
          `Opened ${pathForDisplay(relativePath)} at ${hash.slice(0, 7)}`,
        );
      } finally {
        setGitActionBusy(null);
      }
    },
    [activateGitDiffSession],
  );

  useEffect(() => {
    if (!projectId) return;
    scheduleGitRefresh();
  }, [activeSidebar, projectId, scheduleGitRefresh]);

  useEffect(() => {
    setCollapsedGitGroups(new Set());
  }, [projectId]);

  useEffect(() => {
    const nextPath = activeDocument?.relativePath;
    if (!nextPath) return;
    setGitFileHistoryPath(nextPath);
    gitFileHistoryPathRef.current = nextPath;
    if (activeSidebar === "sourceControl" && projectId) {
      scheduleGitRefresh();
    }
  }, [activeDocument?.relativePath, activeSidebar, projectId, scheduleGitRefresh]);

  useEffect(() => {
    const handleFocus = () => scheduleGitRefresh();
    window.addEventListener("focus", handleFocus);
    const disposeGitWatcher = window.latexdo.onGitChanged((event: GitChangedEvent) => {
      if (event.projectId === projectIdRef.current) {
        scheduleGitRefresh();
      }
    });
    return () => {
      window.removeEventListener("focus", handleFocus);
      disposeGitWatcher();
      if (gitRefreshTimerRef.current !== null) {
        window.clearTimeout(gitRefreshTimerRef.current);
        gitRefreshTimerRef.current = null;
      }
      if (gitRowClickTimerRef.current !== null) {
        window.clearTimeout(gitRowClickTimerRef.current);
        gitRowClickTimerRef.current = null;
      }
    };
  }, [scheduleGitRefresh]);

  useEffect(() => {
    if (!gitContextMenu) return;
    const closeContextMenu = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".scm-context-menu")) return;
      setGitContextMenu(null);
    };
    const closeContextMenuFromKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setGitContextMenu(null);
    };
    window.addEventListener("pointerdown", closeContextMenu);
    window.addEventListener("keydown", closeContextMenuFromKey);
    return () => {
      window.removeEventListener("pointerdown", closeContextMenu);
      window.removeEventListener("keydown", closeContextMenuFromKey);
    };
  }, [gitContextMenu]);

  useEffect(() => {
    return window.latexdo.onUpdateProgress((progress) => {
      setUpdateProgress(progress);
      setUpdateInfo((current) => ({
        currentVersion: progress.currentVersion,
        latestVersion: progress.latestVersion ?? current?.latestVersion ?? null,
        releaseUrl: current?.releaseUrl ?? null,
        updateAvailable:
          progress.status === "confirmed" ? false : (current?.updateAvailable ?? false),
        automaticInstallAvailable: current?.automaticInstallAvailable,
        publishedAt: current?.publishedAt,
        channel: current?.channel,
        manifestUrl: current?.manifestUrl,
        checkedAt: current?.checkedAt,
        error: progress.status === "error" ? progress.message : current?.error,
      }));
      if (progress.status === "restarting") {
        setStatusMessage("Restarting LatexDo to finish the update.");
      } else if (progress.status === "installing") {
        setStatusMessage("Installing LatexDo update.");
      } else if (progress.status === "error" && progress.message) {
        setStatusMessage(progress.message);
      }
    });
  }, []);

  useEffect(() => {
    window.latexdo.lastUpdateStatus().then((status) => {
      setUpdateAttemptStatus(status);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.latexdo.getWhatsNew().then((result) => {
      if (cancelled) return;
      setWhatsNew(result);
      if (result.shouldPresent) {
        setWhatsNewOpen(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return window.latexdo.onWhatsNewOpen(() => {
      void openWhatsNewDialog();
    });
  }, [openWhatsNewDialog]);

  useEffect(() => {
    return window.latexdo.onCompileProgress((payload) => {
      if (payload.projectId !== projectIdRef.current) {
        return;
      }
      setCompileProgress((current) => Math.max(current, payload.progress));
    });
  }, []);

  useEffect(() => {
    let lastCheck = Date.now();
    const check = () => {
      lastCheck = Date.now();
      void checkForUpdates({ silent: true });
    };
    check();
    const interval = window.setInterval(check, updateCheckIntervalMs);
    // Reopening LatexDo (e.g. from the Dock, where the app keeps running with
    // no window) counts as opening it: check again unless we just did.
    const recheckOnReturn = () => {
      if (document.visibilityState === "hidden") return;
      if (Date.now() - lastCheck >= updateRecheckOnFocusMs) check();
    };
    window.addEventListener("focus", recheckOnReturn);
    document.addEventListener("visibilitychange", recheckOnReturn);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", recheckOnReturn);
      document.removeEventListener("visibilitychange", recheckOnReturn);
    };
  }, [checkForUpdates]);

  const togglePreview = async () => {
    if (previewShown) {
      setPreviewVisible(false);
      return;
    }

    setPreviewVisible(true);
    if (!showWelcome) {
      return;
    }

    const rootEntry =
      flattenEntries(projectEntries).find(
        (entry) => entry.type === "file" && entry.relativePath === rootFileRef.current,
      ) ??
      flattenEntries(projectEntries).find(
        (entry) => entry.type === "file" && entry.name.endsWith(".tex"),
      );

    if (rootEntry) {
      await openDocument(rootEntry);
    } else {
      setWelcomeOpen(false);
    }
  };

  const closeWelcomePage = () => {
    setWelcomeOpen(false);
    if (hideProjectEntries) {
      setActivePath("");
      activePathRef.current = "";
      setPreviewVisible(false);
      return;
    }
    if (!activePath) {
      const previousEditorPath = editorPathBeforeWelcomeRef.current;
      const nextPath =
        documents.find((document) => document.path === previousEditorPath)?.path ??
        documents[0]?.path ??
        "";
      setActivePath(nextPath);
      activePathRef.current = nextPath;
    }
  };

  const openDiagnostic = async (diagnostic: Diagnostic) => {
    const targetDiagnosticPath = normalizeRelativePath(
      diagnostic.file || rootFileRef.current,
    );
    if (!targetDiagnosticPath) {
      return;
    }

    const entry = flattenEntries(projectEntriesRef.current).find(
      (item) =>
        item.type === "file" &&
        (normalizeRelativePath(item.relativePath) === targetDiagnosticPath ||
          item.name === fileName(targetDiagnosticPath)),
    );
    if (!entry) {
      setStatusMessage(`Could not locate ${targetDiagnosticPath} in the open project`);
      return;
    }

    pendingSourceRef.current = {
      path: entry.path,
      line: Math.max(1, diagnostic.line),
      column: Math.max(1, diagnostic.column),
      endLine: diagnostic.endLine,
      endColumn: diagnostic.endColumn,
      word: undefined,
    };

    await openDocument(entry);
    requestAnimationFrame(() => {
      revealPendingSource();
    });
    setStatusMessage(
      `Opened ${diagnosticLocationLabel(diagnostic, rootFileRef.current)}`,
    );
  };

  const openGitFile = useCallback(
    async (relativePath: string) => {
      let entry = allProjectEntries.find(
        (item) => item.type === "file" && item.relativePath === relativePath,
      );
      if (!entry) {
        const refreshedEntries = await refreshProject();
        entry = flattenEntries(refreshedEntries).find(
          (item) => item.type === "file" && item.relativePath === relativePath,
        );
      }
      if (!entry) {
        setStatusMessage(
          `${pathForDisplay(relativePath)} is not present in the working tree.`,
        );
        return;
      }
      await openDocument(entry);
    },
    [allProjectEntries, openDocument, refreshProject],
  );

  const openGitDiffEditor = useCallback(
    async (entry: GitChangeEntry, area: GitChangeArea) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) return;

      setGitActionBusy(`editor-diff:${area}:${entry.path}`);
      try {
        const session = await window.latexdo.getGitEditorDiff(
          currentProject,
          entry.path,
          area,
        );
        await activateGitDiffSession(session);
        setStatusMessage(
          `Opened ${session.originalLabel} ↔ ${session.modifiedLabel} for ${entry.path}`,
        );
      } finally {
        setGitActionBusy(null);
      }
    },
    [activateGitDiffSession],
  );

  const revealGitFile = useCallback(async (relativePath: string) => {
    const currentProject = projectIdRef.current;
    if (!currentProject) return;
    try {
      await window.latexdo.revealGitFile(currentProject, relativePath);
      setStatusMessage(`Revealed ${pathForDisplay(relativePath)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(`Could not reveal ${pathForDisplay(relativePath)}: ${message}`);
    }
  }, []);

  const copyGitPath = useCallback(async (relativePath: string) => {
    await navigator.clipboard?.writeText(relativePath);
    setStatusMessage(`Copied ${pathForDisplay(relativePath)}`);
  }, []);

  const openGitFileHistory = useCallback(async (relativePath: string) => {
    const currentProject = projectIdRef.current;
    if (!currentProject) return;
    gitFileHistoryPathRef.current = relativePath;
    setGitFileHistoryPath(relativePath);
    setGitPanelTab("history");
    const history = await window.latexdo.getGitHistory(currentProject, relativePath);
    setGitFileHistory(history);
  }, []);

  const applyLatexPrettier = useCallback(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const document = documentsRef.current.find((d) => d.path === activePathRef.current);
    if (
      !document ||
      !isTextDocument(document) ||
      languageFor(document.name) !== "latex"
    ) {
      setStatusMessage("Open a TeX file to run Prettier.");
      return;
    }

    const modelMatchesActiveDocument =
      Boolean(editor && model) && editorModelMatchesPath(editor, document.path);
    const sourceText = modelMatchesActiveDocument
      ? model!.getValue()
      : document.content;
    const formatted = formatLatexDocumentLayout(sourceText);
    if (!formatted) {
      setStatusMessage("Prettier found no layout changes.");
      editor?.focus();
      return;
    }

    if (modelMatchesActiveDocument && editor && model) {
      const selections = editor.getSelections() ?? [];
      editor.pushUndoStop();
      editor.executeEdits("latexdo-prettier", [
        {
          range: model.getFullModelRange(),
          text: formatted,
          forceMoveMarkers: true,
        },
      ]);

      editor.pushUndoStop();
      const updatedModel = editor.getModel();
      if (updatedModel && selections.length) {
        editor.setSelections(
          selections.map((selection) => clampSelectionToModel(updatedModel, selection)),
        );
      }
      editor.focus();
    }

    setDocuments((current) => {
      const nextDocuments = current.map((openDocument) =>
        openDocument.path === document.path && isTextDocument(openDocument)
          ? { ...openDocument, content: formatted }
          : openDocument,
      );
      documentsRef.current = nextDocuments;
      return nextDocuments;
    });
    setStatusMessage("Prettier formatted LaTeX document layout.");
    emitProductEvent({ type: "format:applied" });
  }, []);

  const applyLatexToolbarCommand = useCallback((command: LatexToolbarCommand) => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const document = documentsRef.current.find((d) => d.path === activePathRef.current);
    if (
      !editor ||
      !model ||
      !document ||
      !editorModelMatchesPath(editor, document.path) ||
      languageFor(document.name) !== "latex"
    ) {
      setStatusMessage("Open a TeX file to use formatting controls.");
      return;
    }

    const selection = editor.getSelection();
    if (!selection) return;

    if (command === "formatTable") {
      const position = editor.getPosition() ?? selection.getStartPosition();
      const result = formatLatexTableAtOffset(
        model.getValue(),
        model.getOffsetAt(position),
      );
      if (!result) {
        setStatusMessage("Place the cursor inside a tabular, array, or longtable.");
        return;
      }

      const start = model.getPositionAt(result.startOffset);
      const end = model.getPositionAt(result.endOffset);
      const range = new monaco.Range(
        start.lineNumber,
        start.column,
        end.lineNumber,
        end.column,
      );
      editor.executeEdits("latex-table-format", [
        {
          range,
          text: result.text,
          forceMoveMarkers: true,
        },
      ]);
      editor.setSelection(range);
      editor.revealRangeInCenter(range, monaco.editor.ScrollType.Smooth);
      editor.focus();
      setStatusMessage("Formatted LaTeX table columns.");
      emitProductEvent({ type: "format:applied" });
      return;
    }

    const selectedText = model.getValueInRange(selection);
    const hasSelection = !selection.isEmpty() && selectedText.length > 0;

    const replaceSelection = (
      text: string,
      selectStartOffset: number | null,
      selectEndOffset: number | null,
      status: string,
    ) => {
      const startOffset = model.getOffsetAt(selection.getStartPosition());
      editor.executeEdits("latex-toolbar", [
        {
          range: selection,
          text,
          forceMoveMarkers: true,
        },
      ]);

      if (selectStartOffset !== null && selectEndOffset !== null) {
        const start = model.getPositionAt(startOffset + selectStartOffset);
        const end = model.getPositionAt(startOffset + selectEndOffset);
        editor.setSelection(
          new monaco.Selection(
            start.lineNumber,
            start.column,
            end.lineNumber,
            end.column,
          ),
        );
      } else {
        const end = model.getPositionAt(startOffset + text.length);
        editor.setPosition(end);
      }

      editor.focus();
      setStatusMessage(status);
    };

    const wrapInline = (
      before: string,
      after: string,
      fallback: string,
      status: string,
    ) => {
      const inner = hasSelection ? selectedText : fallback;
      replaceSelection(
        `${before}${inner}${after}`,
        before.length,
        before.length + inner.length,
        status,
      );
    };

    const wrapBlock = (
      before: string,
      after: string,
      fallback: string,
      status: string,
    ) => {
      const inner = hasSelection ? selectedText : fallback;
      replaceSelection(
        `${before}${inner}${after}`,
        before.length,
        before.length + inner.length,
        status,
      );
    };

    const insertList = (environment: "itemize" | "enumerate") => {
      const fallback = "Item";
      const lines = hasSelection
        ? selectedText
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
        : [fallback];
      const body = lines.map((line) => `\t\\item ${line}`).join("\n");
      const text = `\\begin{${environment}}\n${body}\n\\end{${environment}}\n`;
      const firstItemOffset = `\\begin{${environment}}\n\t\\item `.length;
      replaceSelection(
        text,
        hasSelection ? null : firstItemOffset,
        hasSelection ? null : firstItemOffset + fallback.length,
        `Inserted ${environment} list.`,
      );
    };

    switch (command) {
      case "bold":
        wrapInline("\\textbf{", "}", "bold text", "Inserted bold text.");
        break;
      case "italic":
        wrapInline("\\emph{", "}", "emphasized text", "Inserted italic text.");
        break;
      case "underline":
        wrapInline("\\underline{", "}", "underlined text", "Inserted underline.");
        break;
      case "math":
        wrapInline("$", "$", "x", "Inserted inline math.");
        break;
      case "section":
        wrapInline("\\section{", "}\n", "Section title", "Inserted section.");
        break;
      case "subsection":
        wrapInline("\\subsection{", "}\n", "Subsection title", "Inserted subsection.");
        break;
      case "equation":
        wrapBlock(
          "\\begin{equation}\n",
          "\n\\end{equation}\n",
          "E = mc^2",
          "Inserted equation block.",
        );
        break;
      case "itemize":
        insertList("itemize");
        break;
      case "enumerate":
        insertList("enumerate");
        break;
      case "cite":
        wrapInline("\\cite{", "}", "key", "Inserted citation command.");
        emitProductEvent({ type: "citation:inserted" });
        break;
      case "ref":
        wrapInline("\\ref{", "}", "label", "Inserted reference command.");
        break;
      case "href":
        if (hasSelection) {
          replaceSelection(
            `\\href{url}{${selectedText}}`,
            "\\href{".length,
            "\\href{url".length,
            "Inserted link command.",
          );
        } else {
          wrapInline("\\href{url}{", "}", "link text", "Inserted link command.");
        }
        break;
    }
  }, []);

  return {
    discardAllGitEntries,
    openGitCommitDetails,
    openGitCommitRevisionDiff,
    togglePreview,
    closeWelcomePage,
    openDiagnostic,
    openGitFile,
    openGitDiffEditor,
    revealGitFile,
    copyGitPath,
    openGitFileHistory,
    applyLatexPrettier,
    applyLatexToolbarCommand,
  };
}
