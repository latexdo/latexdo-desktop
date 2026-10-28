import { useCallback, useEffect } from "react";
import { emitProductEvent } from "../features/onboarding/core/ProductEvents";
import type { CompileResult, OpenProject, OpenDocument, ProjectEntry } from "../types";
import { pathForDisplay } from "../pathDisplay";
import {
  buildAutoCompileSignature,
  hasProjectTreeLimitEntry,
  projectListOptionsFromSettings,
} from "../features/settings/settings";
import {
  fileName,
  flattenEntries,
  formatDuration,
} from "../features/project/projectUtils";
import { compilerSetupIssue, isTextDocument, rememberClosedTab } from "./appShared";
import type { AppCtx03 } from "./appContext";
import { toolTabKey } from "../features/workspace/toolTabs";

export function useAppProjectLifecycle(ctx: AppCtx03) {
  const {
    activeDocument,
    activePathRef,
    allProjectEntries,
    autoCompileSignature,
    browserAutoOpenRef,
    collaborationState,
    closedTabPathsRef,
    compileRunIdRef,
    compiling,
    currentUserRole,
    documents,
    documentsRef,
    editorPathBeforeWelcomeRef,
    engineRef,
    ensurePreambleMacros,
    gitDiffReturnPathRef,
    gitDiffSessionIdRef,
    gitDiffSessionRef,
    gitFileHistoryPathRef,
    hasVisibleProject,
    hideProjectEntriesRef,
    lastAutoCompileSignatureRef,
    legalAcceptanceRequired,
    loadReviewData,
    openDocument,
    pdfPathRef,
    projectIdRef,
    projectPathRef,
    realtimeBlockedDocumentsRef,
    reopenClosedTabArmedRef,
    realtimeReadyDocumentsRef,
    refreshProject,
    rootFile,
    rootFileExists,
    rootFileRef,
    saveDocumentsForCompile,
    scheduleGitRefreshRef,
    setActivePanel,
    setActivePath,
    setActiveResearchSpace,
    setCompileJobCount,
    setCompileProgress,
    setCompileResult,
    setDocuments,
    setGitBlameLines,
    setGitCommitDetails,
    setGitCommitParentHash,
    setGitDiffSession,
    setGitFileHistory,
    setGitFileHistoryPath,
    setGitRepoHistory,
    setGitStatus,
    setHideProjectEntries,
    setLastPdfLocation,
    setPanelHeight,
    setPanelVisible,
    setPdfData,
    setPdfTarget,
    setPreviewVisible,
    setProjectDisplayName,
    setProjectEntries,
    setProjectId,
    setProjectPath,
    setRootFile,
    setSelectedGitCommitHash,
    setStatusMessage,
    setTikzCanvasOpen,
    setTikzConverterOpen,
    setTableCanvasOpen,
    setNotationManagerOpen,
    setCitationManagerOpen,
    setExtensionDetailsId,
    setWelcomeOpen,
    settings,
    settingsRef,
    showBlankWorkspace,
    showWelcome,
    standalonePdfReviewActiveRef,
    welcomeOpen,
  } = ctx;

  const generateRebuttalFile = useCallback(async () => {
    const currentProject = projectIdRef.current;
    if (!currentProject || !rootFile) return;

    try {
      const rebuttalRoot = rootFile.replace(/\.tex$/, "-rebuttal.tex");
      const entry = allProjectEntries.find((e) => e.relativePath === rootFile);
      if (!entry) return;

      let content = documentsRef.current.find((d) => d.path === entry.path)?.content;
      if (content === undefined) {
        content = await window.latexdo.readFile(currentProject, entry.relativePath);
      }

      content = ensurePreambleMacros(content);
      await window.latexdo.writeFile(currentProject, rebuttalRoot, content);
      setStatusMessage(`Generated rebuttal version: ${rebuttalRoot}`);
      await refreshProject(currentProject);
    } catch (e) {
      setStatusMessage("Failed to generate rebuttal file.");
    }
  }, [allProjectEntries, refreshProject, rootFile]);

  const loadProject = useCallback(
    async (project: OpenProject, openFirstDocument = false, hideEntries = false) => {
      setStatusMessage("Loading project…");
      setProjectId(project.id);
      projectIdRef.current = project.id;
      setProjectPath(project.rootPath);
      projectPathRef.current = project.rootPath;
      setProjectDisplayName(project.name || fileName(project.rootPath) || "Project");
      setActiveResearchSpace(project.researchSpace ?? null);
      setHideProjectEntries(hideEntries);
      setDocuments([]);
      documentsRef.current = [];
      setActivePath("");
      activePathRef.current = "";
      setGitStatus(null);
      setGitDiffSession(null);
      gitDiffSessionRef.current = null;
      gitDiffSessionIdRef.current = "";
      setGitBlameLines([]);
      setGitRepoHistory(null);
      setGitFileHistory(null);
      setGitFileHistoryPath(null);
      gitFileHistoryPathRef.current = "";
      setSelectedGitCommitHash(null);
      setGitCommitDetails(null);
      setGitCommitParentHash("");
      setWelcomeOpen(true);
      setCompileResult(null);
      setPdfData(null);
      setPdfTarget(null);
      setLastPdfLocation(null);
      pdfPathRef.current = "";
      lastAutoCompileSignatureRef.current = "";

      const entries = await window.latexdo.listProject(
        project.id,
        projectListOptionsFromSettings(settingsRef.current),
      );
      setProjectEntries(entries);
      const treeLimited = hasProjectTreeLimitEntry(entries);
      if (treeLimited) {
        setStatusMessage("Project tree was limited. Adjust tree limits in Settings.");
      }
      await loadReviewData(project.id);
      const allFiles = flattenEntries(entries);
      const main =
        allFiles.find(
          (entry) => entry.type === "file" && entry.relativePath === "main.tex",
        ) ??
        allFiles.find((entry) => entry.type === "file" && entry.name.endsWith(".tex"));

      if (main) {
        setRootFile(main.relativePath);
        rootFileRef.current = main.relativePath;
        if (openFirstDocument) {
          await openDocument(main, project.id);
        }
      }
      setStatusMessage(
        treeLimited
          ? "Project tree was limited. Adjust tree limits in Settings."
          : "Ready",
      );
    },
    [loadReviewData, openDocument],
  );

  useEffect(() => {
    const runtime = (window.latexdo as typeof window.latexdo & { runtime?: string })
      .runtime;
    if (
      legalAcceptanceRequired ||
      !["browser", "cloud", "desktop"].includes(runtime ?? "") ||
      browserAutoOpenRef.current
    ) {
      return;
    }

    browserAutoOpenRef.current = true;
    // A deliberately opened window must not inherit the last local or cloud project.
    if (runtime === "desktop" && window.latexdo.startWithEmptyWorkspace) return;
    void (async () => {
      try {
        // On the desktop: a file opened from Finder first, then a shared
        // cloud project, else the folder that was open when LatexDo last
        // closed (#229).
        const project =
          runtime === "desktop"
            ? ((await window.latexdo.openRequestedProject?.()) ??
              (await window.latexdo.restoreCloudProject()) ??
              (await window.latexdo.reopenLastProject?.()) ??
              null)
            : await window.latexdo.openProject();
        if (standalonePdfReviewActiveRef.current) {
          return;
        }
        if (project) {
          await loadProject(project, true, false);
        }
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? error.message
            : "Could not open the browser workspace.",
        );
      }
    })();
  }, [legalAcceptanceRequired, loadProject]);

  const saveDocument = useCallback(
    async (document: OpenDocument) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) {
        return;
      }
      if (!isTextDocument(document)) {
        setStatusMessage(
          `${pathForDisplay(document.relativePath)} is a preview and does not need saving.`,
        );
        return;
      }
      if (
        collaborationState.enabled &&
        collaborationState.token &&
        (currentUserRole === "viewer" ||
          Boolean(realtimeBlockedDocumentsRef.current[document.relativePath]) ||
          !realtimeReadyDocumentsRef.current.has(document.relativePath))
      ) {
        throw new Error(
          realtimeBlockedDocumentsRef.current[document.relativePath] ||
            (currentUserRole === "viewer"
              ? "Viewer access cannot save changes."
              : "Wait for secure collaboration sync before saving."),
        );
      }
      await window.latexdo.writeFile(
        currentProject,
        document.relativePath,
        document.content,
      );
      // Mark only what was written: edits typed during the write stay unsaved.
      setDocuments((current) => {
        const nextDocuments = current.map((item) =>
          item.path === document.path
            ? { ...item, savedContent: document.content }
            : item,
        );
        documentsRef.current = nextDocuments;
        return nextDocuments;
      });
      scheduleGitRefreshRef.current();
      setStatusMessage(`Saved ${pathForDisplay(document.relativePath)}`);
    },
    [collaborationState.enabled, collaborationState.token, currentUserRole],
  );

  const compile = useCallback(async (): Promise<CompileResult | null> => {
    const currentProject = projectIdRef.current;
    if (!currentProject || hideProjectEntriesRef.current) {
      setStatusMessage("Create or open a project before compiling.");
      emitProductEvent({ type: "compile:failed" });
      return null;
    }

    const compileRunId = compileRunIdRef.current + 1;
    compileRunIdRef.current = compileRunId;
    const activeCompileDocument = documentsRef.current.find(
      (document) => document.path === activePathRef.current,
    );
    const asymptoteDocument =
      activeCompileDocument && activeCompileDocument.name.endsWith(".asy")
        ? activeCompileDocument
        : null;
    lastAutoCompileSignatureRef.current = buildAutoCompileSignature(
      documentsRef.current,
      currentProject,
      rootFileRef.current,
      engineRef.current,
    );
    setCompileJobCount((count) => count + 1);
    setCompileProgress(0);
    setStatusMessage(
      asymptoteDocument
        ? `Compiling ${pathForDisplay(asymptoteDocument.relativePath)} with Asymptote...`
        : `Compiling ${pathForDisplay(rootFileRef.current)} in the background...`,
    );
    try {
      const result = asymptoteDocument
        ? await (async () => {
            if (asymptoteDocument.content !== asymptoteDocument.savedContent) {
              await window.latexdo.writeFile(
                currentProject,
                asymptoteDocument.relativePath,
                asymptoteDocument.content,
              );
              setDocuments((current) => {
                const nextDocuments = current.map((document) =>
                  document.path === asymptoteDocument.path
                    ? { ...document, savedContent: asymptoteDocument.content }
                    : document,
                );
                documentsRef.current = nextDocuments;
                return nextDocuments;
              });
            }
            return window.latexdo.compileAsymptote({
              projectId: currentProject,
              relativePath: asymptoteDocument.relativePath,
            });
          })()
        : await (async () => {
            const dirtyDocuments = documentsRef.current.filter(
              (document) => document.content !== document.savedContent,
            );
            await saveDocumentsForCompile(currentProject, dirtyDocuments);

            return window.latexdo.compile({
              projectId: currentProject,
              rootFile: rootFileRef.current,
              engine: engineRef.current,
            });
          })();

      const isLatestCompile = compileRunId === compileRunIdRef.current;
      if (isLatestCompile) {
        setCompileResult(result);
        if (result.ok) {
          setCompileProgress(100);
          emitProductEvent({ type: "compile:succeeded" });
        } else {
          emitProductEvent({ type: "compile:failed" });
        }
      }

      if (result.ok && result.pdfPath) {
        const bytes = await window.latexdo.readPdf(currentProject, result.pdfPath);
        if (isLatestCompile) {
          pdfPathRef.current = result.pdfPath;
          setPdfData(new Uint8Array(bytes));
          setPdfTarget(null);
          setLastPdfLocation(null);
          setPreviewVisible(true);
          setStatusMessage(
            asymptoteDocument
              ? `Built ${pathForDisplay(asymptoteDocument.relativePath)} in ${formatDuration(
                  result.durationMs,
                )}`
              : `Built successfully in ${formatDuration(result.durationMs)}`,
          );
        }
      } else {
        if (isLatestCompile) {
          pdfPathRef.current = "";
          setPdfTarget(null);
          setLastPdfLocation(null);
          setPanelVisible(true);
          setActivePanel(result.diagnostics.length ? "problems" : "output");
          if (compilerSetupIssue(result)) {
            setPanelHeight((height) => Math.max(height, 300));
          }
          setStatusMessage(result.error ?? "Compilation failed");
        }
      }
      return result;
    } catch (error) {
      if (compileRunId === compileRunIdRef.current) {
        pdfPathRef.current = "";
        setPdfTarget(null);
        setLastPdfLocation(null);
        setPanelVisible(true);
        setActivePanel("output");
        setStatusMessage(error instanceof Error ? error.message : "Compilation failed");
        emitProductEvent({ type: "compile:failed" });
      }
      return null;
    } finally {
      setCompileJobCount((count) => Math.max(0, count - 1));
    }
  }, []);

  const cancelCompile = useCallback(async () => {
    const currentProject = projectIdRef.current;
    if (!currentProject || !compiling) {
      return;
    }

    compileRunIdRef.current += 1;
    try {
      const canceled = await window.latexdo.cancelCompile(currentProject);
      setStatusMessage(
        canceled ? "Canceling compile..." : "No active compile to cancel.",
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Could not cancel compile.",
      );
    }
  }, [compiling]);

  const saveActiveAndCompile = useCallback(async () => {
    const document = documentsRef.current.find(
      (item) => item.path === activePathRef.current,
    );
    if (document) {
      await saveDocument(document);
    }
    await compile();
  }, [compile, saveDocument]);

  const closeActiveTab = useCallback(() => {
    const currentPath = activePathRef.current;
    // Tool tabs close their tool; the tab hook then returns to a document.
    const toolKey = toolTabKey(currentPath);
    if (toolKey) {
      ({
        tikzCanvas: setTikzCanvasOpen,
        tikzConverter: setTikzConverterOpen,
        tableGenerator: setTableCanvasOpen,
        notationManager: setNotationManagerOpen,
        citationManager: setCitationManagerOpen,
        extensionDetails: () => setExtensionDetailsId(""),
      })[toolKey](false);
      return;
    }

    if (currentPath) {
      const currentDocuments = documentsRef.current;
      const target = currentDocuments.find((document) => document.path === currentPath);
      if (
        target &&
        target.content !== target.savedContent &&
        !window.confirm(`Close ${target.name} without saving?`)
      ) {
        return;
      }

      const index = currentDocuments.findIndex(
        (document) => document.path === currentPath,
      );
      const nextDocuments = currentDocuments.filter(
        (document) => document.path !== currentPath,
      );
      documentsRef.current = nextDocuments;
      setDocuments(nextDocuments);
      if (target) {
        rememberClosedTab(closedTabPathsRef, reopenClosedTabArmedRef, target.path);
      }

      const nextPath =
        nextDocuments[Math.min(index, nextDocuments.length - 1)]?.path ?? "";
      setActivePath(nextPath);
      activePathRef.current = nextPath;
      setStatusMessage(
        target ? `Closed ${pathForDisplay(target.relativePath)}` : "Closed active tab",
      );
      return;
    }

    if (gitDiffSessionRef.current && !welcomeOpen) {
      setGitDiffSession(null);
      gitDiffSessionRef.current = null;
      setGitBlameLines([]);
      gitDiffSessionIdRef.current = "";

      const returnPath = gitDiffReturnPathRef.current;
      const nextPath = documentsRef.current.some(
        (document) => document.path === returnPath,
      )
        ? returnPath
        : (documentsRef.current[0]?.path ?? "");
      setActivePath(nextPath);
      activePathRef.current = nextPath;
      setStatusMessage("Closed diff tab");
      return;
    }

    if (welcomeOpen) {
      setWelcomeOpen(false);
      if (hideProjectEntriesRef.current) {
        setActivePath("");
        activePathRef.current = "";
        setPreviewVisible(false);
        setStatusMessage("Closed Welcome");
        return;
      }

      const previousEditorPath = editorPathBeforeWelcomeRef.current;
      const nextPath =
        documentsRef.current.find((document) => document.path === previousEditorPath)
          ?.path ??
        documentsRef.current[0]?.path ??
        "";
      setActivePath(nextPath);
      activePathRef.current = nextPath;
      setStatusMessage("Closed Welcome");
    }
  }, [setGitBlameLines, setGitDiffSession, welcomeOpen]);

  const downloadPdf = useCallback(async () => {
    const currentProject = projectIdRef.current;
    const activeDownloadDocument = documentsRef.current.find(
      (document) => document.path === activePathRef.current,
    );
    const downloadingAsymptote = Boolean(activeDownloadDocument?.name.endsWith(".asy"));
    if (!currentProject || (!rootFileExists && !downloadingAsymptote)) {
      return;
    }

    try {
      const sourceIsDirty = documentsRef.current.some(
        (document) => document.content !== document.savedContent,
      );
      let pdfPath = pdfPathRef.current;

      if (!pdfPath || sourceIsDirty) {
        const result = await compile();
        pdfPath = result?.ok ? (result.pdfPath ?? "") : "";
      }
      if (!pdfPath) {
        setStatusMessage("Compile successfully before downloading the PDF");
        return;
      }

      const bytes = await window.latexdo.readPdf(currentProject, pdfPath);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const link = document.createElement("a");
      const downloadName = downloadingAsymptote
        ? fileName(activeDownloadDocument?.relativePath ?? "figure.asy").replace(
            /\.asy$/i,
            ".pdf",
          )
        : fileName(rootFileRef.current).replace(/\.tex$/i, ".pdf");

      link.href = url;
      link.download = downloadName;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatusMessage(`Downloaded ${downloadName}`);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Could not download the PDF",
      );
    }
  }, [compile, rootFileExists]);

  const compileEntry = useCallback(
    async (entry: ProjectEntry) => {
      if (entry.type !== "file" || !entry.name.endsWith(".tex")) {
        return;
      }

      setRootFile(entry.relativePath);
      rootFileRef.current = entry.relativePath;
      setWelcomeOpen(false);
      setStatusMessage(`Using ${pathForDisplay(entry.relativePath)} as the main file`);
      await compile();
    },
    [compile],
  );

  useEffect(() => {
    const hasDirtyDocuments = documents.some(
      (document) => document.content !== document.savedContent,
    );

    if (
      !hasVisibleProject ||
      !settings.livePreview ||
      !activeDocument ||
      !rootFileExists ||
      !hasDirtyDocuments ||
      compiling ||
      showWelcome ||
      showBlankWorkspace
    ) {
      return;
    }
    if (autoCompileSignature === lastAutoCompileSignatureRef.current) {
      return;
    }

    const timeout = window.setTimeout(() => {
      lastAutoCompileSignatureRef.current = autoCompileSignature;
      void compile();
    }, 100);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    activeDocument,
    autoCompileSignature,
    compile,
    compiling,
    documents,
    hasVisibleProject,
    rootFileExists,
    settings.livePreview,
    showBlankWorkspace,
    showWelcome,
  ]);

  return {
    loadProject,
    saveDocument,
    compile,
    cancelCompile,
    saveActiveAndCompile,
    closeActiveTab,
    downloadPdf,
    compileEntry,
  };
}
