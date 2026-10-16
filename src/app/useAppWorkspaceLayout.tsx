import { normalizeRelativePath } from "../features/project/projectUtils";
import { useCallback, useEffect } from "react";
import { isAiConfigured } from "../components/AiSidebar";
import { emitProductEvent } from "../features/onboarding/core/ProductEvents";
import type { TourStep } from "../features/onboarding/core/TourTypes";
import {
  layoutPresetInfo,
  type AiConfig,
  type LayoutPreset,
} from "../features/ai/aiConfig";
import type { GitDiffSession } from "../types";
import { pathForDisplay } from "../pathDisplay";
import { gitDiscardStatusMessage } from "../features/git/gitUi";
import { reconcileDiffRefresh } from "../features/git/diffRefresh";
import { uniqueWords } from "../features/proofreading/proofreading";
import { updateIdentity } from "../features/pdf/updateFormatting";
import { PanelKind, ipcErrorMessage, isTextDocument } from "./appShared";
import type { AppCtx11 } from "./appContext";
import { useAppScm } from "./useAppScm";

export function useAppWorkspaceLayout(ctx: AppCtx11) {
  const {
    closeDocument,
    setDocuments,
    activePathRef,
    aiConfig,
    aiIsDesktop,
    applyLayoutPreset,
    askAiAboutSelection,
    closeActiveTab,
    compile,
    defaultCreateRelativePath,
    documentsRef,
    editorRef,
    gitCommitMessage,
    gitDiffReturnPathRef,
    gitDiffSession,
    gitDiffSessionIdRef,
    gitDiffSessionRef,
    gitFileHistoryPathRef,
    gitRefreshTimerRef,
    handleEditorCursorToPdf,
    importDocx,
    importMarkdown,
    importPdf,
    loadProofreadingSettings,
    loadSpellCheckerSettings,
    openProject,
    pdfData,
    projectIdRef,
    refreshProject,
    requireLegalAcceptance,
    saveSpellCheckerSettings,
    scheduleGitRefreshRef,
    setActivationTourLaunchNonce,
    setActivePanel,
    setActivePath,
    setActiveSidebar,
    setAiConfig,
    setAiWizardOpen,
    setCheckingUpdates,
    setCreateDialog,
    setCreateError,
    setCreatePath,
    setDismissedUpdateVersion,
    setGitActionBusy,
    setGitBlameLines,
    setGitCommitMessage,
    setGitDiffSession,
    setGitFileHistory,
    setGitLoading,
    setGitRepoHistory,
    setGitStatus,
    setLatexEditorView,
    setPanelVisible,
    setPreviewVisible,
    setProofreadingError,
    setSettingsOpen,
    setSidebarVisible,
    setSpellCheckerError,
    setSpellCheckerLanguageQuery,
    setSpellCheckerSettings,
    setSpellCheckerWordDraft,
    setStatusMessage,
    setTerminalStarted,
    setUpdateAttemptStatus,
    setUpdateInfo,
    setUpdateProgress,
    setUpdatingNow,
    setWelcomeOpen,
    setWhatsNew,
    setWhatsNewOpen,
    spellCheckerSettings,
    spellCheckerWordDraft,
    updateInfo,
    welcomeOpen,
  } = ctx;

  const revealActivationStep = useCallback((step: TourStep) => {
    if (step.id === "editor") {
      setLatexEditorView("code");
    }
    if (step.id === "ask-ai") {
      setLatexEditorView("code");
      setSidebarVisible(true);
      setActiveSidebar("ai");
    }
    if (["compile", "pdf-navigation"].includes(step.id)) {
      setPreviewVisible(true);
    }
  }, []);

  /** Select the first line matching `accepts`, searching from the cursor. */
  const selectActivationLine = (accepts: (text: string) => boolean): boolean => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return false;
    const lineCount = model.getLineCount();
    const from = editor.getPosition()?.lineNumber ?? 1;
    for (let offset = 0; offset < lineCount; offset += 1) {
      const line = ((from - 1 + offset) % lineCount) + 1;
      if (!accepts(model.getLineContent(line).trim())) continue;
      editor.setSelection({
        startLineNumber: line,
        startColumn: model.getLineFirstNonWhitespaceColumn(line) || 1,
        endLineNumber: line,
        endColumn: model.getLineMaxColumn(line),
      });
      editor.revealLineInCenter(line);
      editor.focus();
      return true;
    }
    return false;
  };

  const selectActivationSentence = (): boolean =>
    selectActivationLine((text) => /^[A-Za-z].{7,}/.test(text)) ||
    selectActivationLine((text) => text.length > 0);

  // "Show me" in the tour: perform the step in the user's real workspace.
  // It must never edit the document.
  const showActivationStep = (step: TourStep) => {
    const editor = editorRef.current;
    if (step.id === "compile") void compile();
    else if (step.id === "pdf-navigation") {
      if (pdfData) void handleEditorCursorToPdf();
    } else if (step.id === "ask-ai") {
      if (!isAiConfigured(aiConfig, aiIsDesktop)) return;
      if (editor?.getSelection()?.isEmpty() ?? true) selectActivationSentence();
      askAiAboutSelection();
    }
  };

  const chooseWorkspacePreset = useCallback(
    (preset: LayoutPreset) => {
      setAiConfig((current) => ({ ...current, layoutPreset: preset }));
      applyLayoutPreset(preset);
      const presetName =
        layoutPresetInfo.find((item) => item.id === preset)?.name ?? "Workspace";
      setStatusMessage(`${presetName} workspace layout applied.`);
    },
    [applyLayoutPreset],
  );

  const completeAiSetup = useCallback(
    (config: AiConfig) => {
      setAiConfig(config);
      setAiWizardOpen(false);
      applyLayoutPreset(config.layoutPreset);
      setActivationTourLaunchNonce((nonce) => nonce + 1);
      setStatusMessage(
        config.userName
          ? `Welcome, ${config.userName}. LatexDo setup complete.`
          : "LatexDo setup complete.",
      );
    },
    [applyLayoutPreset],
  );

  const toggleSpellCheckerEnabled = useCallback(
    (enabled: boolean) => {
      if (!spellCheckerSettings) {
        return;
      }

      void saveSpellCheckerSettings(
        {
          ...spellCheckerSettings,
          enabled,
        },
        enabled ? "Spell checker enabled" : "Spell checker disabled",
      );
    },
    [saveSpellCheckerSettings, spellCheckerSettings],
  );

  const toggleSpellCheckerLanguage = useCallback(
    (language: string) => {
      if (!spellCheckerSettings || spellCheckerSettings.usesSystemLanguage) {
        return;
      }

      const selected = spellCheckerSettings.languages.includes(language);
      const nextLanguages = selected
        ? spellCheckerSettings.languages.filter((entry) => entry !== language)
        : [...spellCheckerSettings.languages, language];

      if (!nextLanguages.length) {
        setSpellCheckerError("Select at least one spell-check language.");
        return;
      }

      void saveSpellCheckerSettings(
        {
          ...spellCheckerSettings,
          languages: nextLanguages,
        },
        `Spell checker languages updated`,
      );
    },
    [saveSpellCheckerSettings, spellCheckerSettings],
  );

  const addSpellCheckerWord = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (!spellCheckerSettings) {
        return;
      }

      const word = spellCheckerWordDraft.trim();
      if (!word) {
        setSpellCheckerError("Enter a word to add.");
        return;
      }

      const customWords = uniqueWords([...spellCheckerSettings.customWords, word]);
      if (customWords.length === spellCheckerSettings.customWords.length) {
        setSpellCheckerWordDraft("");
        setSpellCheckerError("");
        setStatusMessage(`"${word}" is already in the dictionary`);
        return;
      }

      void saveSpellCheckerSettings(
        {
          ...spellCheckerSettings,
          customWords,
        },
        `Added "${word}" to the dictionary`,
        { clearWordDraft: true },
      );
    },
    [saveSpellCheckerSettings, spellCheckerSettings, spellCheckerWordDraft],
  );

  const removeSpellCheckerWord = useCallback(
    (word: string) => {
      if (!spellCheckerSettings) {
        return;
      }

      void saveSpellCheckerSettings(
        {
          ...spellCheckerSettings,
          customWords: spellCheckerSettings.customWords.filter(
            (entry) => entry !== word,
          ),
        },
        `Removed "${word}" from the dictionary`,
      );
    },
    [saveSpellCheckerSettings, spellCheckerSettings],
  );

  const clearSpellCheckerWords = useCallback(() => {
    if (!spellCheckerSettings?.customWords.length) {
      return;
    }
    const count = spellCheckerSettings.customWords.length;
    if (
      !window.confirm(
        `Remove all ${count} custom word${count === 1 ? "" : "s"} from the dictionary?`,
      )
    ) {
      return;
    }

    void saveSpellCheckerSettings(
      { ...spellCheckerSettings, customWords: [] },
      "Removed all custom words from the dictionary",
    );
  }, [saveSpellCheckerSettings, spellCheckerSettings]);

  useEffect(() => {
    void loadSpellCheckerSettings();
    void loadProofreadingSettings();
  }, [loadProofreadingSettings, loadSpellCheckerSettings]);

  useEffect(() => {
    // Words added from the editor's context menu land here too.
    return window.latexdo.onSpellCheckerSettingsChanged((settings) => {
      setSpellCheckerSettings(settings);
    });
  }, []);

  useEffect(() => {
    return window.latexdo.onOpenSpellCheckerSettings(() => {
      if (requireLegalAcceptance()) {
        return;
      }
      setSpellCheckerLanguageQuery("");
      setSpellCheckerWordDraft("");
      setSpellCheckerError("");
      setProofreadingError("");
      setSettingsOpen(true);
      void loadSpellCheckerSettings();
      void loadProofreadingSettings();
    });
  }, [loadProofreadingSettings, loadSpellCheckerSettings, requireLegalAcceptance]);

  useEffect(() => {
    return window.latexdo.onOpenProjectMenu(() => {
      void openProject();
    });
  }, []);

  useEffect(() => {
    return window.latexdo.onCreateFileMenu(() => {
      if (requireLegalAcceptance()) {
        return;
      }
      setCreatePath(defaultCreateRelativePath("file"));
      setCreateError("");
      setCreateDialog("file");
    });
  }, [defaultCreateRelativePath, requireLegalAcceptance]);

  useEffect(() => {
    return window.latexdo.onCreateFolderMenu(() => {
      if (requireLegalAcceptance()) {
        return;
      }
      setCreatePath(defaultCreateRelativePath("folder"));
      setCreateError("");
      setCreateDialog("folder");
    });
  }, [defaultCreateRelativePath, requireLegalAcceptance]);

  useEffect(() => {
    return window.latexdo.onImportDocxMenu(() => {
      if (requireLegalAcceptance()) {
        return;
      }
      void importDocx();
    });
  }, [importDocx, requireLegalAcceptance]);

  useEffect(() => {
    return window.latexdo.onImportMarkdownMenu(() => {
      if (requireLegalAcceptance()) {
        return;
      }
      void importMarkdown();
    });
  }, [importMarkdown, requireLegalAcceptance]);

  useEffect(() => {
    return window.latexdo.onImportPdfMenu(() => {
      if (requireLegalAcceptance()) {
        return;
      }
      void importPdf();
    });
  }, [importPdf, requireLegalAcceptance]);

  useEffect(() => {
    return window.latexdo.onCloseTabMenu(() => {
      if (requireLegalAcceptance()) {
        return;
      }
      closeActiveTab();
    });
  }, [closeActiveTab, requireLegalAcceptance]);

  const toggleSidebar = () => {
    setSidebarVisible((visible) => !visible);
  };

  const togglePanel = () => {
    setPanelVisible((visible) => !visible);
  };

  const openPanel = useCallback((panel: PanelKind) => {
    if (panel === "terminal") {
      setTerminalStarted(true);
    }
    setPanelVisible(true);
    setActivePanel(panel);
    if (panel === "problems") {
      emitProductEvent({ type: "problems:opened" });
    }
  }, []);

  const refreshGitStatus = useCallback(async () => {
    const currentProject = projectIdRef.current;
    if (!currentProject) {
      setGitStatus(null);
      return;
    }

    setGitLoading(true);
    try {
      const status = await window.latexdo.getGitStatus(currentProject);
      setGitStatus(status);
    } finally {
      setGitLoading(false);
    }
  }, []);

  const refreshGitHistories = useCallback(async () => {
    const currentProject = projectIdRef.current;
    if (!currentProject) {
      setGitRepoHistory(null);
      setGitFileHistory(null);
      return;
    }

    const currentDocument = documentsRef.current.find(
      (document) => document.path === activePathRef.current,
    );
    const targetPath =
      gitFileHistoryPathRef.current || currentDocument?.relativePath || "";
    try {
      const [repositoryHistory, fileHistory] = await Promise.all([
        window.latexdo.getGitHistory(currentProject),
        targetPath
          ? window.latexdo.getGitHistory(currentProject, targetPath)
          : Promise.resolve(null),
      ]);
      setGitRepoHistory(repositoryHistory);
      setGitFileHistory(fileHistory);
    } catch {
      setGitRepoHistory(null);
      setGitFileHistory(null);
    }
  }, []);

  const refreshOpenGitDiff = useCallback(async () => {
    const currentProject = projectIdRef.current;
    const currentSession = gitDiffSessionRef.current;
    if (!currentProject || !currentSession) return;

    const area =
      currentSession.modifiedRef.kind === "index"
        ? "staged"
        : currentSession.modifiedRef.kind === "working-tree"
          ? "changes"
          : null;
    if (!area) return;

    try {
      const refreshedSession = await window.latexdo.getGitEditorDiff(
        currentProject,
        currentSession.relativePath,
        area,
      );
      if (
        projectIdRef.current !== currentProject ||
        gitDiffSessionRef.current !== currentSession
      )
        return;
      const nextSession = reconcileDiffRefresh(currentSession, refreshedSession);
      if (nextSession === currentSession) return;
      gitDiffSessionRef.current = nextSession;
      gitDiffSessionIdRef.current = nextSession.id;
      setGitDiffSession(nextSession);
      const blame =
        refreshedSession.binary || refreshedSession.tooLarge
          ? []
          : await window.latexdo.getGitBlame(
              currentProject,
              refreshedSession.relativePath,
              refreshedSession.modifiedRef,
            );
      if (gitDiffSessionRef.current === nextSession) {
        setGitBlameLines(blame);
      }
    } catch {
      // The revision may disappear after a stage/commit; the explicit operation closes it.
    }
  }, []);

  const refreshGitData = useCallback(async () => {
    await Promise.all([
      refreshGitStatus(),
      refreshGitHistories(),
      refreshOpenGitDiff(),
    ]);
  }, [refreshGitHistories, refreshGitStatus, refreshOpenGitDiff]);

  const scheduleGitRefresh = useCallback(() => {
    if (gitRefreshTimerRef.current !== null) {
      window.clearTimeout(gitRefreshTimerRef.current);
    }
    gitRefreshTimerRef.current = window.setTimeout(() => {
      gitRefreshTimerRef.current = null;
      void refreshGitData();
    }, 150);
  }, [refreshGitData]);
  scheduleGitRefreshRef.current = scheduleGitRefresh;

  const closeGitDiffSession = useCallback(
    (restoreDocument = true) => {
      const diffWasActive = !activePathRef.current && !welcomeOpen;
      setGitDiffSession(null);
      gitDiffSessionRef.current = null;
      setGitBlameLines([]);
      gitDiffSessionIdRef.current = "";
      if (!restoreDocument || !diffWasActive) return;

      const returnPath = gitDiffReturnPathRef.current;
      const nextPath = documentsRef.current.some(
        (document) => document.path === returnPath,
      )
        ? returnPath
        : (documentsRef.current[0]?.path ?? "");
      setActivePath(nextPath);
      activePathRef.current = nextPath;
    },
    [welcomeOpen],
  );

  const activateGitDiffSession = useCallback(async (session: GitDiffSession) => {
    const currentProject = projectIdRef.current;
    if (!currentProject) return;

    if (activePathRef.current) {
      gitDiffReturnPathRef.current = activePathRef.current;
    }
    gitDiffSessionIdRef.current = session.id;
    gitDiffSessionRef.current = session;
    setGitDiffSession(session);
    setGitBlameLines([]);
    setWelcomeOpen(false);
    setActivePath("");
    activePathRef.current = "";

    if (session.modifiedRef.kind === "empty" || session.binary || session.tooLarge) {
      return;
    }
    try {
      const blame = await window.latexdo.getGitBlame(
        currentProject,
        session.relativePath,
        session.modifiedRef,
      );
      if (gitDiffSessionIdRef.current === session.id) {
        setGitBlameLines(blame);
      }
    } catch {
      if (gitDiffSessionIdRef.current === session.id) {
        setGitBlameLines([]);
      }
    }
  }, []);

  const checkForUpdates = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setCheckingUpdates(true);
      setUpdateProgress(null);
    }
    try {
      const result = await window.latexdo.checkForUpdates();
      setUpdateInfo(result);
      if (result.error) {
        if (!options?.silent) setStatusMessage(`Update check failed: ${result.error}`);
      } else if (result.updateAvailable && result.latestVersion) {
        setDismissedUpdateVersion((current) =>
          current && current !== updateIdentity(result) ? null : current,
        );
        setStatusMessage(`LatexDo ${result.latestVersion} is available.`);
      } else if (!options?.silent) {
        setStatusMessage(`LatexDo ${result.currentVersion} is up to date.`);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not check for updates.";
      setUpdateInfo((current) => ({
        currentVersion: current?.currentVersion ?? "Unknown",
        latestVersion: current?.latestVersion ?? null,
        releaseUrl: current?.releaseUrl ?? null,
        updateAvailable: false,
        checkedAt: new Date().toISOString(),
        error: message,
      }));
      if (!options?.silent) {
        setStatusMessage(message);
      }
    } finally {
      if (!options?.silent) {
        setCheckingUpdates(false);
      }
    }
  }, []);

  const updateNow = useCallback(async () => {
    setUpdatingNow(true);
    setUpdateAttemptStatus(null);
    setUpdateProgress((current) => ({
      status: "checking",
      currentVersion:
        updateInfo?.currentVersion ?? current?.currentVersion ?? "Unknown",
      latestVersion: updateInfo?.latestVersion ?? current?.latestVersion ?? null,
      fileName: null,
      fileLabel: null,
      transferredBytes: 0,
      totalBytes: null,
      percent: null,
      message: "Checking for the latest build",
    }));
    try {
      const result = await window.latexdo.updateNow();
      setUpdateInfo(result);

      if (result.error) {
        setUpdateProgress((current) =>
          current
            ? { ...current, status: "error", message: result.error }
            : {
                status: "error",
                currentVersion: result.currentVersion,
                latestVersion: result.latestVersion,
                fileName: null,
                fileLabel: null,
                transferredBytes: 0,
                totalBytes: null,
                percent: null,
                message: result.error,
              },
        );
        setStatusMessage(result.error);
        return;
      }

      if (!result.updateAvailable) {
        setUpdateProgress({
          status: "done",
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          fileName: null,
          fileLabel: null,
          transferredBytes: 0,
          totalBytes: null,
          percent: null,
          message: `Current build ${result.currentVersion} is up to date.`,
        });
        setStatusMessage(`LatexDo ${result.currentVersion} is up to date.`);
        return;
      }

      if (result.opened && result.latestVersion) {
        const manualDownload = result.manualDownload === true;
        const quitScheduled = result.quitScheduled === true;
        setUpdateProgress((current) => ({
          status: result.restartScheduled
            ? "restarting"
            : quitScheduled
              ? "installing"
              : manualDownload
                ? "done"
                : "opening",
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          fileName: current?.fileName ?? null,
          fileLabel: current?.fileLabel ?? null,
          transferredBytes: current?.transferredBytes ?? 1,
          totalBytes: current?.totalBytes ?? 1,
          percent: current?.percent ?? 100,
          message: result.restartScheduled
            ? "Restarting LatexDo"
            : quitScheduled
              ? "Installing update"
              : manualDownload
                ? "Opened downloads page"
                : "Opened installer",
        }));
        setStatusMessage(
          result.restartScheduled
            ? `Restarting LatexDo to finish ${result.latestVersion}.`
            : quitScheduled
              ? `Installing LatexDo ${result.latestVersion}. LatexDo will quit while the updater finishes.`
              : manualDownload
                ? `Opened LatexDo ${result.latestVersion} downloads.`
                : `Opened LatexDo ${result.latestVersion} installer.`,
        );
      } else if (result.latestVersion) {
        setUpdateProgress((current) => ({
          status: "error",
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          fileName: current?.fileName ?? null,
          fileLabel: current?.fileLabel ?? null,
          transferredBytes: current?.transferredBytes ?? 1,
          totalBytes: current?.totalBytes ?? 1,
          percent: current?.percent ?? 100,
          message: `Update failed: the installer for LatexDo ${result.latestVersion} did not start.`,
        }));
        setStatusMessage(
          `Update failed: the installer for LatexDo ${result.latestVersion} did not start.`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not start the update.";
      setUpdateProgress((current) =>
        current
          ? { ...current, status: "error", message }
          : {
              status: "error",
              currentVersion: updateInfo?.currentVersion ?? "Unknown",
              latestVersion: updateInfo?.latestVersion ?? null,
              fileName: null,
              fileLabel: null,
              transferredBytes: 0,
              totalBytes: null,
              percent: null,
              message,
            },
      );
      setStatusMessage(message);
    } finally {
      setUpdatingNow(false);
    }
  }, [updateInfo?.currentVersion, updateInfo?.latestVersion]);

  const openWhatsNewDialog = useCallback(async () => {
    const result = await window.latexdo.getWhatsNew();
    setWhatsNew(result);
    setWhatsNewOpen(true);
  }, []);

  const closeWhatsNewDialog = useCallback(() => {
    setWhatsNew((current) => {
      if (current?.shouldPresent) {
        void window.latexdo.markWhatsNewPresented(current.toVersion);
        return { ...current, shouldPresent: false };
      }
      return current;
    });
    setWhatsNewOpen(false);
  }, []);

  const viewFullReleaseNotes = useCallback(() => {
    void window.latexdo.openReleaseNotesPage();
  }, []);

  const stageGitEntry = useCallback(
    async (relativePath: string) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) return;

      setGitActionBusy(`stage:${relativePath}`);
      try {
        await window.latexdo.stageGitFile(currentProject, relativePath);
        if (
          gitDiffSessionIdRef.current &&
          gitDiffSession?.relativePath === relativePath
        ) {
          closeGitDiffSession();
        }
        await refreshGitData();
        setStatusMessage(`Staged ${pathForDisplay(relativePath)}`);
      } catch (error) {
        setStatusMessage(ipcErrorMessage(error, "Could not stage the file"));
      } finally {
        setGitActionBusy(null);
      }
    },
    [closeGitDiffSession, gitDiffSession?.relativePath, refreshGitData],
  );

  const unstageGitEntry = useCallback(
    async (relativePath: string) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) return;

      setGitActionBusy(`unstage:${relativePath}`);
      try {
        await window.latexdo.unstageGitFile(currentProject, relativePath);
        if (
          gitDiffSessionIdRef.current &&
          gitDiffSession?.relativePath === relativePath
        ) {
          closeGitDiffSession();
        }
        await refreshGitData();
        setStatusMessage(`Unstaged ${pathForDisplay(relativePath)}`);
      } catch (error) {
        setStatusMessage(ipcErrorMessage(error, "Could not unstage the file"));
      } finally {
        setGitActionBusy(null);
      }
    },
    [closeGitDiffSession, gitDiffSession?.relativePath, refreshGitData],
  );

  /** Commits what is staged; true when the commit was made. */
  const commitGitChanges = useCallback(async (): Promise<boolean> => {
    const currentProject = projectIdRef.current;
    if (!currentProject) return false;

    setGitActionBusy("commit");
    try {
      await window.latexdo.commitGit(currentProject, gitCommitMessage);
      setGitCommitMessage("");
      closeGitDiffSession();
      await refreshGitData();
      setStatusMessage("Created commit");
      return true;
    } catch (error) {
      setStatusMessage(ipcErrorMessage(error, "Git commit failed"));
      return false;
    } finally {
      setGitActionBusy(null);
    }
  }, [closeGitDiffSession, gitCommitMessage, refreshGitData]);

  /**
   * Re-reads open tabs from disk after Git or another program changed the
   * files (#239, #226). Tabs with unsaved edits are left alone unless
   * `includeUnsaved` is set, as it is after a discard; tabs whose file is gone
   * are closed.
   */
  const reloadOpenDocumentsFromDisk = useCallback(
    async (options: { paths?: readonly string[]; includeUnsaved?: boolean } = {}) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) return;
      const wanted = options.paths
        ? new Set(options.paths.map(normalizeRelativePath))
        : null;
      const targets = documentsRef.current.filter(
        (document) =>
          isTextDocument(document) &&
          (!wanted || wanted.has(normalizeRelativePath(document.relativePath))) &&
          (options.includeUnsaved || document.content === document.savedContent),
      );
      const results = await Promise.all(
        targets.map(async (document) => {
          try {
            const content = await window.latexdo.readFile(
              currentProject,
              document.relativePath,
            );
            return { document, content, missing: false };
          } catch {
            const exists = await window.latexdo
              .fileExists(currentProject, document.relativePath)
              .catch(() => true);
            return { document, content: null, missing: !exists };
          }
        }),
      );
      if (projectIdRef.current !== currentProject) return;
      const reloaded = new Map(
        results.flatMap((result) =>
          result.content !== null &&
          (result.content !== result.document.content ||
            result.content !== result.document.savedContent)
            ? [[result.document.path, result.content] as const]
            : [],
        ),
      );
      const missing = results
        .filter((result) => result.missing)
        .map((result) => result.document.path);
      if (reloaded.size || missing.length) {
        setDocuments((documents) => {
          const next = documents.map((document) => {
            const content = reloaded.get(document.path);
            if (content !== undefined)
              return { ...document, content, savedContent: content };
            // A deleted file closes without a "close without saving?" prompt.
            return missing.includes(document.path)
              ? { ...document, savedContent: document.content }
              : document;
          });
          documentsRef.current = next;
          return next;
        });
      }
      for (const path of missing) closeDocument(path);
    },
    [closeDocument, setDocuments],
  );

  /** The Source Control refresh button: files, open tabs and Git state. */
  const refreshSourceControl = useCallback(async () => {
    const currentProject = projectIdRef.current;
    if (!currentProject) return;
    try {
      await refreshProject(currentProject);
      await reloadOpenDocumentsFromDisk();
      await refreshGitData();
      setStatusMessage("Source control refreshed");
    } catch (error) {
      setStatusMessage(ipcErrorMessage(error, "Could not refresh source control"));
    }
  }, [refreshGitData, refreshProject, reloadOpenDocumentsFromDisk]);

  /**
   * After a terminal command (git pull, a script, latexmk…) the files may
   * have changed underneath the app (#226). Unsaved tabs are never touched.
   */
  const refreshAfterTerminalCommand = useCallback(async () => {
    const currentProject = projectIdRef.current;
    if (!currentProject) return;
    try {
      await refreshProject(currentProject);
      await reloadOpenDocumentsFromDisk();
    } catch {
      // The next command or a manual refresh tries again.
    }
    scheduleGitRefresh();
  }, [refreshProject, reloadOpenDocumentsFromDisk, scheduleGitRefresh]);

  const discardGitEntry = useCallback(
    async (relativePath: string) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) return;

      setGitActionBusy(`discard:${relativePath}`);
      try {
        const result = await window.latexdo.discardGitFile(
          currentProject,
          relativePath,
        );
        if (!result.discarded) {
          setStatusMessage("Discard canceled.");
          return;
        }
        // Without this the tab keeps the discarded text, and the next save
        // or compile writes it straight back.
        await reloadOpenDocumentsFromDisk({
          paths: [relativePath],
          includeUnsaved: true,
        });
        await refreshProject(currentProject);
        if (gitDiffSession?.relativePath === relativePath) {
          closeGitDiffSession();
        }
        await refreshGitData();
        setStatusMessage(
          gitDiscardStatusMessage(
            result,
            `Discarded changes in ${pathForDisplay(relativePath)}`,
          ),
        );
      } catch (error) {
        setStatusMessage(ipcErrorMessage(error, "Could not discard the changes"));
      } finally {
        setGitActionBusy(null);
      }
    },
    [
      closeGitDiffSession,
      gitDiffSession?.relativePath,
      refreshGitData,
      refreshProject,
      reloadOpenDocumentsFromDisk,
    ],
  );

  const stageAllGitEntries = useCallback(async () => {
    const currentProject = projectIdRef.current;
    if (!currentProject) return;

    setGitActionBusy("stage-all");
    try {
      await window.latexdo.stageAllGit(currentProject);
      closeGitDiffSession();
      await refreshGitData();
      setStatusMessage("Staged all changes");
    } catch (error) {
      setStatusMessage(ipcErrorMessage(error, "Could not stage the changes"));
    } finally {
      setGitActionBusy(null);
    }
  }, [closeGitDiffSession, refreshGitData]);

  const unstageAllGitEntries = useCallback(async () => {
    const currentProject = projectIdRef.current;
    if (!currentProject) return;

    setGitActionBusy("unstage-all");
    try {
      await window.latexdo.unstageAllGit(currentProject);
      closeGitDiffSession();
      await refreshGitData();
      setStatusMessage("Unstaged all changes");
    } catch (error) {
      setStatusMessage(ipcErrorMessage(error, "Could not unstage the changes"));
    } finally {
      setGitActionBusy(null);
    }
  }, [closeGitDiffSession, refreshGitData]);

  const scm = useAppScm(ctx, {
    refreshGitData,
    reloadOpenDocumentsFromDisk,
    closeGitDiffSession,
    commitGitChanges,
  });

  return {
    ...scm,
    revealActivationStep,
    showActivationStep,
    chooseWorkspacePreset,
    completeAiSetup,
    toggleSpellCheckerEnabled,
    toggleSpellCheckerLanguage,
    addSpellCheckerWord,
    removeSpellCheckerWord,
    clearSpellCheckerWords,
    toggleSidebar,
    togglePanel,
    openPanel,
    refreshGitData,
    reloadOpenDocumentsFromDisk,
    refreshSourceControl,
    refreshAfterTerminalCommand,
    scheduleGitRefresh,
    closeGitDiffSession,
    activateGitDiffSession,
    checkForUpdates,
    updateNow,
    openWhatsNewDialog,
    closeWhatsNewDialog,
    viewFullReleaseNotes,
    stageGitEntry,
    unstageGitEntry,
    commitGitChanges,
    discardGitEntry,
    stageAllGitEntries,
    unstageAllGitEntries,
  };
}
