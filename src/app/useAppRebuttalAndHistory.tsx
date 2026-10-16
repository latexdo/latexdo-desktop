import { defaultReviewerName } from "../rebuttalGenerator";
import { useCallback, useEffect } from "react";
import {
  DEFAULT_SPLIT_PERCENT,
  MIN_PREVIEW_WIDTH,
  MIN_SOURCE_WIDTH,
  SPLIT_HANDLE_WIDTH,
  clampSidebarWidth,
  savePaneLayout,
  splitPercentAt,
  startPaneDrag,
} from "../features/layout/paneLayout";
import { type CitationInsertCommand } from "../components/CitationManager";
import {
  createReviewId,
  rebuttalMacro,
  removeRebuttalMacro,
  updateRebuttalMacro,
} from "../features/review/rebuttalSource";
import type { RebuttalItem } from "../types";
import { planCitationInsertion } from "../latex/citationInsertion";
import { formatCitation } from "../latex/citationStyle";
import { pathForDisplay } from "../pathDisplay";
import {
  flattenEntries,
  normalizeRelativePath,
} from "../features/project/projectUtils";
import {
  formatUpdateDate,
  formatUpdateLocation,
  updateIdentity,
} from "../features/pdf/updateFormatting";
import { editorModelMatchesPath, isTextDocument, monaco } from "./appShared";
import type { AppCtx14 } from "./appContext";

export function useAppRebuttalAndHistory(ctx: AppCtx14) {
  const {
    activePathRef,
    activeSidebar,
    activeTextDocument,
    aiSidebarExpanded,
    allProjectEntries,
    dismissedUpdateVersion,
    documentsRef,
    editorPreviewRef,
    editorRef,
    panelHeight,
    previewShown,
    projectEntriesRef,
    projectId,
    projectIdRef,
    rebuttalItems,
    rebuttalSourceQueueRef,
    refreshProject,
    setActivePath,
    setCitationProjectFiles,
    setDocuments,
    setPanelHeight,
    setRebuttalItems,
    setSidebarWidths,
    setSplitPercent,
    setStatusMessage,
    setWelcomeOpen,
    showBlankWorkspace,
    showWelcome,
    sidebarWidths,
    splitPercent,
    updateInfo,
    updateProgress,
  } = ctx;

  /**
   * Applies `transform` to the file holding a rebuttal block. Without a known
   * file, the open documents are searched. False when no file changed.
   */
  const rewriteRebuttalSource = useCallback(
    async (
      filePath: string | undefined,
      transform: (content: string) => string | null,
    ): Promise<boolean> => {
      const targetPath = filePath ? normalizeRelativePath(filePath) : null;
      for (const openDoc of documentsRef.current) {
        if (targetPath && normalizeRelativePath(openDoc.relativePath) !== targetPath) {
          continue;
        }
        const nextContent = transform(openDoc.content);
        if (nextContent === null) {
          if (targetPath) return false;
          continue;
        }
        setDocuments((current) => {
          const nextDocuments = current.map((document) =>
            document.path === openDoc.path
              ? { ...document, content: nextContent }
              : document,
          );
          documentsRef.current = nextDocuments;
          return nextDocuments;
        });
        return true;
      }

      const currentProject = projectIdRef.current;
      if (!filePath || !currentProject) return false;
      try {
        const nextContent = transform(
          await window.latexdo.readFile(currentProject, filePath),
        );
        if (nextContent === null) return false;
        await window.latexdo.writeFile(currentProject, filePath, nextContent);
        return true;
      } catch {
        return false;
      }
    },
    [setDocuments],
  );

  const handleAddRebuttalItem = useCallback(() => {
    const newItem: RebuttalItem = {
      id: createReviewId(),
      originalText: "",
      revisedText: "",
      insertedInTex: false,
      reviewerComment: "",
      authorComment: "",
      modificationMade: "",
    };
    // A new comment usually comes from the same reviewer as the last one.
    setRebuttalItems((prev) => [
      ...prev,
      { ...newItem, reviewer: prev.at(-1)?.reviewer || defaultReviewerName },
    ]);
  }, []);

  const handleInsertRebuttalItemIntoTex = useCallback(
    (id: string) => {
      const item = rebuttalItems.find((candidate) => candidate.id === id);
      if (!item || item.insertedInTex) return;
      const editor = editorRef.current;
      const document = documentsRef.current.find(
        (d) => d.path === activePathRef.current,
      );
      const model = editor?.getModel();
      if (
        !editor ||
        !model ||
        !document ||
        !editorModelMatchesPath(editor, document.path)
      ) {
        setStatusMessage("Open a TeX file before inserting a rebuttal block.");
        return;
      }
      const selection = editor.getSelection();
      const selectedText = selection ? model.getValueInRange(selection) : "";
      if (!selection || !selectedText.trim()) {
        setStatusMessage("Select the text this rebuttal item is about first.");
        return;
      }

      const revisedText = (item.revisedText ?? item.modificationMade) || selectedText;
      const next: RebuttalItem = {
        ...item,
        filePath: document.relativePath,
        originalText: selectedText,
        revisedText,
        modificationMade: revisedText,
        insertedInTex: true,
      };
      editor.executeEdits("rebuttal-mode", [
        { range: selection, text: rebuttalMacro(next), forceMoveMarkers: true },
      ]);
      setRebuttalItems((prev) =>
        prev.map((candidate) => (candidate.id === id ? next : candidate)),
      );
      setStatusMessage("Inserted the rebuttal item into the TeX source.");
    },
    [rebuttalItems],
  );

  const handleUpdateRebuttalItem = useCallback(
    (id: string, updates: Partial<RebuttalItem>) => {
      const previous = rebuttalItems.find((item) => item.id === id);
      if (!previous) return;
      const next = { ...previous, ...updates };
      setRebuttalItems((prev) => prev.map((item) => (item.id === id ? next : item)));
      if (!previous.insertedInTex) return;

      // Keep the block in the source in step with the sidebar. Edits to a
      // file that is not open are queued so they apply in order.
      rebuttalSourceQueueRef.current = rebuttalSourceQueueRef.current.then(async () => {
        const updated = await rewriteRebuttalSource(previous.filePath, (content) =>
          updateRebuttalMacro(content, previous, next),
        );
        if (!updated) {
          setStatusMessage(
            "This item's \\rebuttal block was changed in the source, so the sidebar no longer updates it. Edit the block in the TeX file.",
          );
        }
      });
    },
    [rebuttalItems, rewriteRebuttalSource],
  );

  const handleDeleteRebuttalItem = useCallback(
    (id: string) => {
      const item = rebuttalItems.find((candidate) => candidate.id === id);
      if (!item) return;
      if (
        !window.confirm(
          item.insertedInTex
            ? "Delete this rebuttal item? Its block in the TeX source is replaced by the revised text."
            : "Delete this rebuttal item?",
        )
      ) {
        return;
      }
      setRebuttalItems((prev) => prev.filter((candidate) => candidate.id !== id));
      if (!item.insertedInTex) return;

      rebuttalSourceQueueRef.current = rebuttalSourceQueueRef.current.then(async () => {
        const removed = await rewriteRebuttalSource(item.filePath, (content) =>
          removeRebuttalMacro(content, item),
        );
        setStatusMessage(
          removed
            ? "Deleted the rebuttal item and kept the revised text in the source."
            : "Deleted the rebuttal item. Its block was not found in the source; remove it there if it is still present.",
        );
      });
    },
    [rebuttalItems, rewriteRebuttalSource],
  );

  const handleInsertNotationCode = useCallback((code: string) => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const document = documentsRef.current.find(
      (item) => item.path === activePathRef.current,
    );
    if (
      !editor ||
      !model ||
      !document ||
      !editorModelMatchesPath(editor, document.path) ||
      !document.name.endsWith(".tex")
    ) {
      setStatusMessage("Open a .tex document before inserting math.");
      return;
    }

    const selection = editor.getSelection();
    const selectedText =
      selection && !selection.isEmpty() ? model.getValueInRange(selection).trim() : "";
    const isInlineSnippet = code === "$x$";
    const insertText = selectedText
      ? code.replace("x = y", selectedText).replace("$x$", `$${selectedText}$`)
      : code;
    const position = editor.getPosition();
    const lineNumber = position?.lineNumber ?? model.getLineCount();
    const column = position?.column ?? model.getLineLength(lineNumber) + 1;
    editor.executeEdits("notation-manager", [
      {
        range:
          selection && !selection.isEmpty()
            ? selection
            : new monaco.Range(lineNumber, column, lineNumber, column),
        text: isInlineSnippet ? insertText : `\n${insertText}\n`,
        forceMoveMarkers: true,
      },
    ]);
    editor.focus();
    setStatusMessage("Inserted notation snippet.");
  }, []);

  const handleInsertCitationCode = useCallback(
    (key: string, command: CitationInsertCommand) => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      const document = documentsRef.current.find(
        (item) => item.path === activePathRef.current,
      );
      if (
        !editor ||
        !model ||
        !document ||
        !editorModelMatchesPath(editor, document.path) ||
        !document.name.endsWith(".tex")
      ) {
        setStatusMessage("Open a .tex document before inserting a citation.");
        return;
      }

      const citation = formatCitation(command, [key]);
      const selection = editor.getSelection();
      const selectedText =
        selection && !selection.isEmpty() ? model.getValueInRange(selection) : "";
      const position = editor.getPosition();
      const lineNumber = position?.lineNumber ?? model.getLineCount();
      const column = position?.column ?? model.getLineLength(lineNumber) + 1;
      const range =
        selection && !selection.isEmpty()
          ? selection
          : new monaco.Range(lineNumber, column, lineNumber, column);
      const selectedPlan = selectedText
        ? planCitationInsertion(selectedText, selectedText.length, command, [key])
        : null;
      const cursorPlan =
        !selectedText && position
          ? planCitationInsertion(
              model.getValue(),
              model.getOffsetAt(position),
              command,
              [key],
            )
          : null;
      if (selectedText && !selectedPlan) {
        setStatusMessage(`Already cited in the selection: ${citation}`);
        return;
      }
      if (!selectedText && !cursorPlan) {
        setStatusMessage(`Already cited near the cursor: ${citation}`);
        return;
      }
      const cursorStart = cursorPlan
        ? model.getPositionAt(cursorPlan.rangeStartOffset)
        : null;
      const cursorEnd = cursorPlan
        ? model.getPositionAt(cursorPlan.rangeEndOffset)
        : null;
      const cursorRange =
        cursorStart && cursorEnd && !selectedText
          ? new monaco.Range(
              cursorStart.lineNumber,
              cursorStart.column,
              cursorEnd.lineNumber,
              cursorEnd.column,
            )
          : range;
      const text =
        selectedText && selectedPlan
          ? selectedText.slice(0, selectedPlan.rangeStartOffset) +
            selectedPlan.text +
            selectedText.slice(selectedPlan.rangeEndOffset)
          : (cursorPlan?.text ?? citation);
      editor.executeEdits("citation-manager", [
        {
          range: cursorRange,
          text,
          forceMoveMarkers: true,
        },
      ]);
      editor.focus();
      setStatusMessage(
        `Inserted ${formatCitation(
          (selectedPlan ?? cursorPlan)?.command ?? command,
          (selectedPlan ?? cursorPlan)?.keys ?? [key],
        )}`,
      );
    },
    [],
  );

  const handleAppendBibEntry = useCallback(
    async (targetFile: string, bibtex: string) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) {
        setStatusMessage("Open a project before editing BibTeX.");
        return;
      }

      const normalizedTarget = normalizeRelativePath(targetFile);
      const entry = flattenEntries(projectEntriesRef.current).find(
        (item) =>
          item.type === "file" &&
          normalizeRelativePath(item.relativePath) === normalizedTarget,
      );
      if (!entry) {
        setStatusMessage(`Could not find ${targetFile}`);
        return;
      }

      try {
        const openDocumentState = documentsRef.current.find(
          (document) =>
            normalizeRelativePath(document.relativePath) === normalizedTarget,
        );
        const currentContent =
          openDocumentState?.content ??
          (await window.latexdo.readFile(currentProject, entry.relativePath));
        const nextContent = `${currentContent.replace(/\s*$/, "")}\n\n${bibtex}\n`;

        await window.latexdo.writeFile(currentProject, entry.relativePath, nextContent);

        if (openDocumentState) {
          setDocuments((current) => {
            const nextDocuments = current.map((document) =>
              document.path === openDocumentState.path
                ? { ...document, content: nextContent, savedContent: nextContent }
                : document,
            );
            documentsRef.current = nextDocuments;
            return nextDocuments;
          });
        }

        setCitationProjectFiles((current) => {
          const found = current.some(
            (file) => normalizeRelativePath(file.path) === normalizedTarget,
          );
          if (found) {
            return current.map((file) =>
              normalizeRelativePath(file.path) === normalizedTarget
                ? { ...file, content: nextContent }
                : file,
            );
          }
          return [...current, { path: normalizedTarget, content: nextContent }];
        });

        await refreshProject(currentProject);
        setStatusMessage(`Added BibTeX stub to ${pathForDisplay(entry.relativePath)}`);
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Could not update BibTeX file",
        );
      }
    },
    [refreshProject],
  );

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const container = editorPreviewRef.current;
    if (!container) return;
    startPaneDrag(event, (clientX) => {
      const rect = container.getBoundingClientRect();
      setSplitPercent(splitPercentAt(clientX, rect.left, rect.width));
    });
  };
  const nudgeSplit = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const container = editorPreviewRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const step = event.shiftKey ? 64 : 16;
    const currentX = rect.left + (splitPercent / 100) * rect.width;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setSplitPercent(
        splitPercentAt(
          currentX + (event.key === "ArrowLeft" ? -step : step),
          rect.left,
          rect.width,
        ),
      );
    } else if (event.key === "Home" || event.key === "Enter") {
      event.preventDefault();
      setSplitPercent(DEFAULT_SPLIT_PERCENT);
    }
  };

  // Each sidebar view remembers its own width; the AI view keeps a separate
  // width for its expanded state.
  const sidebarWidthKey =
    activeSidebar === "ai" && aiSidebarExpanded ? "ai-expanded" : activeSidebar;
  const sidebarCustomWidth = sidebarWidths[sidebarWidthKey];
  const sidebarWidthStyle: React.CSSProperties | undefined =
    sidebarCustomWidth === undefined
      ? undefined
      : {
          width: sidebarCustomWidth,
          minWidth: 0,
          flex: `0 0 ${sidebarCustomWidth}px`,
        };
  const setSidebarWidth = (width: number) => {
    setSidebarWidths((current) => ({
      ...current,
      [sidebarWidthKey]: clampSidebarWidth(width, window.innerWidth),
    }));
  };
  const resetSidebarWidth = () => {
    setSidebarWidths((current) => {
      const next = { ...current };
      delete next[sidebarWidthKey];
      return next;
    });
  };
  const startSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const sidebar = event.currentTarget.previousElementSibling;
    if (!(sidebar instanceof HTMLElement)) return;
    const sidebarLeft = sidebar.getBoundingClientRect().left;
    startPaneDrag(event, (clientX) => setSidebarWidth(clientX - sidebarLeft));
  };
  const nudgeSidebar = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const sidebar = event.currentTarget.previousElementSibling;
    if (!(sidebar instanceof HTMLElement)) return;
    const step = event.shiftKey ? 64 : 16;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setSidebarWidth(
        sidebar.getBoundingClientRect().width +
          (event.key === "ArrowLeft" ? -step : step),
      );
    } else if (event.key === "Home" || event.key === "Enter") {
      event.preventDefault();
      resetSidebarWidth();
    }
  };

  useEffect(() => {
    savePaneLayout({ splitPercent, sidebarWidths });
  }, [sidebarWidths, splitPercent]);

  useEffect(() => {
    if (!previewShown) return;
    const container = editorPreviewRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const resizeObserver = new ResizeObserver(([entry]) => {
      const totalWidth = entry.contentRect.width;
      if (totalWidth <= 0) return;
      const maxSourceWidth = totalWidth - MIN_PREVIEW_WIDTH - SPLIT_HANDLE_WIDTH;
      if (maxSourceWidth <= MIN_SOURCE_WIDTH) return;
      const currentSourceWidth = (splitPercent / 100) * totalWidth;
      if (currentSourceWidth > maxSourceWidth) {
        setSplitPercent((maxSourceWidth / totalWidth) * 100);
      }
      if (currentSourceWidth < MIN_SOURCE_WIDTH) {
        setSplitPercent((MIN_SOURCE_WIDTH / totalWidth) * 100);
      }
    });
    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
    };
  }, [previewShown, splitPercent]);

  const startPanelResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = panelHeight;
    const handleMove = (moveEvent: PointerEvent) => {
      const mainArea = document.querySelector(".main-area")!;
      const maxHeight = mainArea.clientHeight - 100;
      const delta = startY - moveEvent.clientY;
      setPanelHeight(Math.max(80, Math.min(maxHeight, startHeight + delta)));
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const availableUpdateVersion = updateInfo?.updateAvailable
    ? updateIdentity(updateInfo)
    : null;
  const updateBannerVisible = Boolean(
    availableUpdateVersion && availableUpdateVersion !== dismissedUpdateVersion,
  );
  const updatePublishedLabel = formatUpdateDate(updateInfo?.publishedAt);
  const updateCheckedLabel = formatUpdateDate(updateInfo?.checkedAt);
  const updateLocationLabel = formatUpdateLocation(updateInfo?.releaseUrl);
  const currentBuildVersion =
    updateProgress?.currentVersion ?? updateInfo?.currentVersion ?? "Unknown";

  return {
    handleAddRebuttalItem,
    handleInsertRebuttalItemIntoTex,
    handleUpdateRebuttalItem,
    handleDeleteRebuttalItem,
    handleInsertNotationCode,
    handleInsertCitationCode,
    handleAppendBibEntry,
    startResize,
    nudgeSplit,
    sidebarWidthStyle,
    resetSidebarWidth,
    startSidebarResize,
    nudgeSidebar,
    startPanelResize,
    availableUpdateVersion,
    updateBannerVisible,
    updatePublishedLabel,
    updateCheckedLabel,
    updateLocationLabel,
    currentBuildVersion,
  };
}
