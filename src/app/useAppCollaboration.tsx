import type * as Monaco from "monaco-editor";
import { useCallback, useEffect, useLayoutEffect } from "react";
import type { HostSharingMode, GitChangedEvent } from "../types";
import { pathForDisplay } from "../pathDisplay";
import {
  bookmarkKey,
  monacoThemeFor,
  normalizeBookmarkLines,
  remapBookmarkLinesForContentChange,
} from "../features/settings/settings";
import {
  blameByLine,
  buildBlameAnnotations,
  inlineBlameText,
  unsavedChangesBlameText,
} from "../features/git/inlineBlame";
import {
  bookmarkLinesEqual,
  clampSelectionToModel,
  editorModelMatchesPath,
  isTextDocument,
  monaco,
} from "./appShared";
import type { AppCtx08 } from "./appContext";

export function useAppCollaboration(ctx: AppCtx08) {
  const {
    activeDocument,
    activePath,
    activePathRef,
    activeTextDocument,
    bookmarkDecorationsRef,
    citationSuggestTimerRef,
    collaboration,
    collaborationAvailable,
    collaborationBindingRef,
    collaborationBindingRequestIdRef,
    collaborationDisplayName,
    collaborationState,
    documentsRef,
    editorActionDisposablesRef,
    editorBlameFetchSeqRef,
    editorBlameLines,
    editorBlameStateRef,
    editorMouseDisposableRef,
    editorMutationOriginRef,
    editorRef,
    editorScrollSyncDisposableRef,
    editorScrollSyncTimerRef,
    fileBlameDecorationsRef,
    fileBlameEnabled,
    inlineBlameDecorationsRef,
    joinAttemptRef,
    joinCollaborationBusy,
    joinTokenDraft,
    latexEditorView,
    loadProject,
    nextEditAdapterRef,
    pdfScrollSyncTimerRef,
    projectId,
    projectIdRef,
    projectName,
    projectPathRef,
    realtimeBlockedDocumentsRef,
    realtimeReadyDocumentsRef,
    requireLegalAcceptance,
    resolvedAppearance,
    saveDocument,
    setBookmarkStore,
    setCollaborationBusy,
    setCollaborationCopied,
    setCollaborationPermissions,
    setCollaborationState,
    setCurrentUserRole,
    setDocuments,
    setEditorBlameLines,
    setIsProjectAdmin,
    setJoinCollaborationBusy,
    setJoinCollaborationError,
    setShareStartError,
    setJoinTokenDraft,
    setJoinWaitingMessage,
    setRealtimeBlockedDocuments,
    setRealtimeReadyDocuments,
    setShareDialogOpen,
    setStatusMessage,
    settings,
    sourceSyncClearTimerRef,
    sourceSyncDecorationsRef,
  } = ctx;

  const disposeCollaborationBinding = useCallback(() => {
    collaborationBindingRequestIdRef.current += 1;
    collaborationBindingRef.current?.destroy();
    collaborationBindingRef.current = null;
  }, []);

  const connectCollaborationBinding = useCallback(
    (editor = editorRef.current) => {
      const document = documentsRef.current.find(
        (item) => item.path === activePathRef.current,
      );
      const token = collaborationState.token;

      if (
        !editor ||
        !document ||
        !isTextDocument(document) ||
        !projectIdRef.current ||
        !collaborationAvailable ||
        !collaborationState.enabled ||
        !token ||
        !editorModelMatchesPath(editor, document.path)
      ) {
        disposeCollaborationBinding();
        return;
      }

      // A project hosted on someone's computer has its own backend address.
      const bindingApiBaseUrl =
        collaborationState.apiBaseUrl ?? collaboration.apiBaseUrl;
      const bindingKey = `${projectIdRef.current}:${document.relativePath}:${token}:${collaborationDisplayName}:${bindingApiBaseUrl}`;
      if (collaborationBindingRef.current?.key === bindingKey) {
        return;
      }

      disposeCollaborationBinding();
      const requestId = ++collaborationBindingRequestIdRef.current;
      setRealtimeReadyDocuments((current) => {
        if (!current.has(document.relativePath)) return current;
        const next = new Set(current);
        next.delete(document.relativePath);
        realtimeReadyDocumentsRef.current = next;
        return next;
      });
      const bindingProjectId = projectIdRef.current;
      void import("../collaboration/MonacoCollaborationBinding").then(
        ({ MonacoCollaborationBinding }) => {
          const currentDocument = documentsRef.current.find(
            (item) => item.path === activePathRef.current,
          );
          if (
            collaborationBindingRequestIdRef.current !== requestId ||
            editorRef.current !== editor ||
            !editorModelMatchesPath(editor, document.path) ||
            projectIdRef.current !== bindingProjectId ||
            currentDocument?.relativePath !== document.relativePath ||
            !collaborationState.enabled ||
            collaborationState.token !== token
          ) {
            return;
          }

          collaborationBindingRef.current = new MonacoCollaborationBinding({
            editor,
            mutationOrigin: editorMutationOriginRef.current,
            projectId: bindingProjectId,
            relativePath: document.relativePath,
            shareToken: token,
            apiBaseUrl: bindingApiBaseUrl,
            clientName: collaborationDisplayName,
            color: collaboration.color,
            emoji: collaboration.emoji,
            onStatusChange: (status) => {
              if (status === "connected") {
                setStatusMessage(
                  `Live collaboration syncing: ${pathForDisplay(document.relativePath)}`,
                );
              } else if (status === "error") {
                setStatusMessage("Live collaboration connection failed.");
              }
            },
            onSynced: () => {
              setRealtimeBlockedDocuments((current) => {
                if (!(document.relativePath in current)) return current;
                const next = { ...current };
                delete next[document.relativePath];
                realtimeBlockedDocumentsRef.current = next;
                return next;
              });
              setRealtimeReadyDocuments((current) => {
                const next = new Set(current).add(document.relativePath);
                realtimeReadyDocumentsRef.current = next;
                return next;
              });
              setStatusMessage(
                `Live collaboration connected: ${pathForDisplay(document.relativePath)}`,
              );
            },
            onConnectionError: (message, status) => {
              if (status && [400, 403, 404, 413, 415].includes(status)) {
                setRealtimeBlockedDocuments((current) => {
                  const next = { ...current, [document.relativePath]: message };
                  realtimeBlockedDocumentsRef.current = next;
                  return next;
                });
                setRealtimeReadyDocuments((current) => {
                  if (!current.has(document.relativePath)) return current;
                  const next = new Set(current);
                  next.delete(document.relativePath);
                  realtimeReadyDocumentsRef.current = next;
                  return next;
                });
                queueMicrotask(disposeCollaborationBinding);
                void window.latexdo
                  .readFile(bindingProjectId, document.relativePath)
                  .then((content) => {
                    if (projectIdRef.current !== bindingProjectId) return;
                    setDocuments((current) => {
                      const next = current.map((item) =>
                        item.relativePath === document.relativePath
                          ? { ...item, content, savedContent: content }
                          : item,
                      );
                      documentsRef.current = next;
                      return next;
                    });
                    setStatusMessage(
                      `Read-only authoritative copy loaded: ${pathForDisplay(document.relativePath)}`,
                    );
                  })
                  .catch((error: unknown) => {
                    setStatusMessage(
                      error instanceof Error
                        ? `Could not reload the authoritative copy: ${error.message}`
                        : "Could not reload the authoritative copy.",
                    );
                  });
              }
              setStatusMessage(`Live collaboration unavailable: ${message}`);
            },
            onPresenceChange: (users) => {
              setCollaborationState((current) => ({ ...current, users }));
            },
            onProjectChanged: (revision) => {
              setCollaborationState((current) =>
                current.revision === revision ? current : { ...current, revision },
              );
            },
          });
        },
      );
    },
    [
      collaboration.apiBaseUrl,
      collaborationDisplayName,
      collaboration.color,
      collaborationAvailable,
      collaborationState.apiBaseUrl,
      collaborationState.enabled,
      collaborationState.token,
      disposeCollaborationBinding,
    ],
  );

  useEffect(() => {
    connectCollaborationBinding();
  }, [
    activePath,
    collaborationState.enabled,
    collaborationState.token,
    connectCollaborationBinding,
    projectId,
  ]);

  useEffect(() => disposeCollaborationBinding, [disposeCollaborationBinding]);

  useEffect(() => {
    realtimeBlockedDocumentsRef.current = {};
    realtimeReadyDocumentsRef.current = new Set();
    setRealtimeBlockedDocuments({});
    setRealtimeReadyDocuments(new Set());
  }, [projectId, collaborationState.token]);

  const applyEditorBlameDecorations = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    if (!editorModelMatchesPath(editor, activePathRef.current)) return;

    const state = editorBlameStateRef.current;
    const now = new Date();

    const inlineDecorations: Monaco.editor.IModelDeltaDecoration[] = [];
    if (state.inlineEnabled && !state.fileBlameEnabled && state.byLine.size) {
      const position = editor.getPosition();
      if (position && position.lineNumber <= model.getLineCount()) {
        const lineNumber = position.lineNumber;
        const blame = state.byLine.get(lineNumber);
        const text = state.dirty
          ? unsavedChangesBlameText()
          : blame
            ? inlineBlameText(blame, now)
            : "";
        if (text) {
          const column = model.getLineMaxColumn(lineNumber);
          inlineDecorations.push({
            range: new monaco.Range(lineNumber, column, lineNumber, column),
            options: {
              after: {
                content: "\u00a0\u00a0\u00a0\u00a0" + text,
                inlineClassName: "git-inline-blame",
                cursorStops: monaco.editor.InjectedTextCursorStops.None,
              },
            },
          });
        }
      }
    }
    inlineBlameDecorationsRef.current = editor.deltaDecorations(
      inlineBlameDecorationsRef.current,
      inlineDecorations,
    );

    const gutterDecorations: Monaco.editor.IModelDeltaDecoration[] = [];
    if (state.fileBlameEnabled && !state.dirty && state.byLine.size) {
      const annotations = buildBlameAnnotations([...state.byLine.values()], now);
      const lineCount = model.getLineCount();
      for (const annotation of annotations) {
        if (annotation.lineNumber > lineCount) continue;
        gutterDecorations.push({
          range: new monaco.Range(annotation.lineNumber, 1, annotation.lineNumber, 1),
          options: {
            before: {
              content: annotation.gutterText + "\u2002",
              inlineClassName: `git-blame-gutter git-blame-heat-${annotation.heatLevel}`,
              cursorStops: monaco.editor.InjectedTextCursorStops.None,
            },
          },
        });
      }
    }
    fileBlameDecorationsRef.current = editor.deltaDecorations(
      fileBlameDecorationsRef.current,
      gutterDecorations,
    );
  }, []);

  const refreshEditorBlame = useCallback(async () => {
    const currentProject = projectIdRef.current;
    const currentPath = activePathRef.current;
    const currentDocument = documentsRef.current.find(
      (document) => document.path === currentPath,
    );
    const sequence = ++editorBlameFetchSeqRef.current;
    if (!currentProject || !currentDocument || !isTextDocument(currentDocument)) {
      setEditorBlameLines([]);
      return;
    }

    try {
      const blame = await window.latexdo.getGitBlame(
        currentProject,
        currentDocument.relativePath,
        {
          kind: "working-tree",
        },
      );
      if (
        sequence === editorBlameFetchSeqRef.current &&
        currentPath === activePathRef.current
      ) {
        setEditorBlameLines(blame);
      }
    } catch {
      if (sequence === editorBlameFetchSeqRef.current) {
        setEditorBlameLines([]);
      }
    }
  }, []);

  useEffect(() => {
    setEditorBlameLines([]);
    void refreshEditorBlame();
  }, [activePath, projectId, refreshEditorBlame]);

  useEffect(() => {
    return window.latexdo.onGitChanged((event: GitChangedEvent) => {
      if (event.projectId === projectIdRef.current) {
        void refreshEditorBlame();
      }
    });
  }, [refreshEditorBlame]);

  useEffect(() => {
    editorBlameStateRef.current = {
      byLine: blameByLine(editorBlameLines),
      dirty: activeTextDocument
        ? activeTextDocument.content !== activeTextDocument.savedContent
        : false,
      inlineEnabled: settings.inlineBlame,
      fileBlameEnabled,
    };
    applyEditorBlameDecorations();
  }, [
    editorBlameLines,
    activeTextDocument,
    settings.inlineBlame,
    fileBlameEnabled,
    applyEditorBlameDecorations,
  ]);

  useEffect(
    () => () => {
      nextEditAdapterRef.current?.dispose();
      nextEditAdapterRef.current = null;
    },
    [],
  );

  const handleEditorChange = useCallback((documentPath: string, value?: string) => {
    const nextContent = value ?? "";
    if (!documentPath) return;
    const previousDocument = documentsRef.current.find(
      (document) => document.path === documentPath,
    );
    if (previousDocument?.content === nextContent) {
      return;
    }

    if (previousDocument && isTextDocument(previousDocument)) {
      const key = bookmarkKey(
        projectPathRef.current || projectIdRef.current,
        previousDocument.relativePath,
      );
      setBookmarkStore((current) => {
        const previousLines = normalizeBookmarkLines(current[key]);
        if (!previousLines.length) {
          return current;
        }

        const remappedLines = remapBookmarkLinesForContentChange(
          previousLines,
          previousDocument.content,
          nextContent,
        );
        if (bookmarkLinesEqual(previousLines, remappedLines)) {
          return current;
        }

        const next = { ...current };
        if (remappedLines.length) {
          next[key] = remappedLines;
        } else {
          delete next[key];
        }
        return next;
      });
    }

    setDocuments((current) => {
      const nextDocuments = current.map((document) =>
        document.path === documentPath
          ? { ...document, content: nextContent }
          : document,
      );
      documentsRef.current = nextDocuments;
      return nextDocuments;
    });
  }, []);

  useLayoutEffect(() => {
    if (latexEditorView !== "code") {
      return;
    }

    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !activeDocument) {
      return;
    }

    if (!editorModelMatchesPath(editor, activeDocument.path)) {
      return;
    }

    if (model.getValue() === activeDocument.content) {
      return;
    }

    const selections = editor.getSelections() ?? [];
    const scrollTop = editor.getScrollTop();
    const scrollLeft = editor.getScrollLeft();

    editorMutationOriginRef.current.run("programmatic", () => {
      editor.executeEdits("latexdo-sync-document", [
        {
          range: model.getFullModelRange(),
          text: activeDocument.content,
          forceMoveMarkers: true,
        },
      ]);
    });

    const updatedModel = editor.getModel();
    if (updatedModel && selections.length) {
      editor.setSelections(
        selections.map((selection) => clampSelectionToModel(updatedModel, selection)),
      );
    }
    editor.setScrollTop(scrollTop);
    editor.setScrollLeft(scrollLeft);
  }, [activeDocument?.content, activeDocument?.path, latexEditorView]);

  const insertLatexBlockAtEditorPosition = useCallback(
    (text: string, position?: Monaco.IPosition | null): boolean => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      const document = documentsRef.current.find(
        (item) => item.path === activePathRef.current,
      );
      if (
        !editor ||
        !model ||
        !document ||
        !editorModelMatchesPath(editor, document.path)
      ) {
        return false;
      }

      const target = position ??
        editor.getPosition() ?? {
          lineNumber: model.getLineCount(),
          column: model.getLineMaxColumn(model.getLineCount()),
        };
      const lineBefore = model
        .getLineContent(target.lineNumber)
        .slice(0, target.column - 1);
      const textToInsert = `${lineBefore.trim() ? "\n" : ""}${text}\n`;
      const startOffset = model.getOffsetAt(target);
      const range = new monaco.Range(
        target.lineNumber,
        target.column,
        target.lineNumber,
        target.column,
      );

      editor.executeEdits("latexdo-insert-block", [
        {
          range,
          text: textToInsert,
          forceMoveMarkers: true,
        },
      ]);
      editor.setPosition(model.getPositionAt(startOffset + textToInsert.length));
      editor.focus();
      return true;
    },
    [],
  );

  const editorTheme = monacoThemeFor(settings.colorTheme, resolvedAppearance);

  useEffect(
    () => () => {
      editorMouseDisposableRef.current?.dispose();
      editorScrollSyncDisposableRef.current?.dispose();
      editorScrollSyncDisposableRef.current = null;
      for (const disposable of editorActionDisposablesRef.current) {
        disposable.dispose();
      }
      editorActionDisposablesRef.current = [];
      if (editorScrollSyncTimerRef.current !== null) {
        window.clearTimeout(editorScrollSyncTimerRef.current);
        editorScrollSyncTimerRef.current = null;
      }
      if (pdfScrollSyncTimerRef.current !== null) {
        window.clearTimeout(pdfScrollSyncTimerRef.current);
        pdfScrollSyncTimerRef.current = null;
      }
      if (citationSuggestTimerRef.current !== null) {
        window.clearTimeout(citationSuggestTimerRef.current);
        citationSuggestTimerRef.current = null;
      }
      if (sourceSyncClearTimerRef.current !== null) {
        window.clearTimeout(sourceSyncClearTimerRef.current);
        sourceSyncClearTimerRef.current = null;
      }
      const editor = editorRef.current;
      if (editor) {
        sourceSyncDecorationsRef.current = editor.deltaDecorations(
          sourceSyncDecorationsRef.current,
          [],
        );
        bookmarkDecorationsRef.current = editor.deltaDecorations(
          bookmarkDecorationsRef.current,
          [],
        );
      }
    },
    [],
  );

  const openProject = async () => {
    if (requireLegalAcceptance()) {
      return;
    }
    try {
      const project = await window.latexdo.openProject();
      if (project) {
        await loadProject(project, true, false);
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Could not open folder.",
      );
    }
  };

  const importOverleafProject = useCallback(
    async (gitUrl: string) => {
      if (requireLegalAcceptance()) {
        return;
      }
      const project = await window.latexdo.importOverleafProject(gitUrl);
      if (project) {
        await loadProject(project, true, false);
        setStatusMessage("Overleaf project fetched locally");
      }
    },
    [loadProject, requireLegalAcceptance],
  );

  const copyToClipboard = async (text: string): Promise<void> => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = globalThis.document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    globalThis.document.body.append(textarea);
    textarea.focus();
    textarea.select();
    globalThis.document.execCommand("copy");
    textarea.remove();
  };

  const refreshCollaborationState = useCallback(
    async (currentProject = projectIdRef.current) => {
      if (!currentProject || !collaborationAvailable) {
        setCollaborationState({ enabled: false, users: [] });
        return;
      }

      try {
        const state = await window.latexdo.getCollaborationState(currentProject);
        setCollaborationState(state);
        if (state.currentUserRole) {
          setCurrentUserRole(state.currentUserRole);
        }
        if (typeof state.isAdmin === "boolean") {
          setIsProjectAdmin(state.isAdmin);
        }
      } catch {
        setCollaborationState({ enabled: false, users: [] });
      }
    },
    [collaborationAvailable],
  );

  // The desktop app shares a project straight from this computer; there the
  // user picks how to share in the dialog before anything is exposed.
  const hostingAvailable = window.latexdo.hostsProjectsLocally === true;

  const openShareDialog = () => {
    if (!hostingAvailable) {
      void createCollaborationLink();
      return;
    }
    setShareDialogOpen(true);
    setJoinCollaborationError("");
    setShareStartError("");
    void refreshCollaborationState();
  };

  const createCollaborationLink = async (mode?: HostSharingMode) => {
    setShareDialogOpen(true);
    setJoinCollaborationError("");
    setShareStartError("");
    const currentProject = projectIdRef.current;
    if (!currentProject) {
      setStatusMessage("Paste a collaboration token or open a project to share.");
      return;
    }

    if (!collaborationAvailable) {
      setStatusMessage("Cloud collaboration is not available in this runtime.");
      return;
    }

    setCollaborationBusy(true);
    try {
      const dirtyDocuments = documentsRef.current.filter(
        (document) => document.content !== document.savedContent,
      );
      await Promise.all(dirtyDocuments.map((document) => saveDocument(document)));

      const state = mode
        ? await window.latexdo.createCollaborationLink(currentProject, {
            mode,
            projectName: projectName || undefined,
          })
        : await window.latexdo.createCollaborationLink(currentProject);
      let activeState = state;

      if (state.token && state.projectId && state.projectId !== currentProject) {
        if (state.hosted) {
          // The shared copy lives on this computer; open it directly.
          await loadProject(
            {
              id: state.projectId,
              rootPath: "",
              name: state.projectName ?? projectName,
            },
            true,
            false,
          );
        } else {
          const opened = await window.latexdo.joinCollaboration(state.token);
          if (opened.pending) {
            throw new Error(opened.message);
          }
          activeState = opened.collaboration;
          await loadProject(opened.project, true, false);
        }
      }

      setCollaborationState(activeState);
      const activeProjectId = activeState.projectId ?? projectIdRef.current;
      if (activeProjectId) {
        await loadCollaborationPermissions(activeProjectId);
      }
      const tokenOrUrl = activeState.token ?? activeState.shareUrl;
      if (activeState.hosted) {
        setStatusMessage(
          activeState.inviteCode
            ? "Sharing started. Copy the invite and send it to your collaborators."
            : "Sharing is starting…",
        );
      } else if (tokenOrUrl) {
        await copyToClipboard(tokenOrUrl);
        setCollaborationCopied(true);
        window.setTimeout(() => setCollaborationCopied(false), 1800);
        setStatusMessage("Collaboration token copied");
      } else {
        setStatusMessage("Collaboration token ready");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not create collaboration link";
      setStatusMessage(message);
      setShareStartError(message);
    } finally {
      setCollaborationBusy(false);
    }
  };

  const regenerateCollaborationLink = async () => {
    const currentProject = collaborationState.projectId ?? projectIdRef.current;
    if (!currentProject) {
      setStatusMessage("Open a shared project to regenerate its link.");
      return;
    }
    if (!collaborationAvailable) {
      setStatusMessage("Cloud collaboration is not available in this runtime.");
      return;
    }

    setCollaborationBusy(true);
    try {
      const state = await window.latexdo.rotateCollaborationLink(currentProject);
      setCollaborationState(state);
      const activeProjectId = state.projectId ?? currentProject;
      await loadCollaborationPermissions(activeProjectId);
      const tokenOrUrl = state.inviteCode ?? state.token ?? state.shareUrl;
      if (tokenOrUrl) {
        await copyToClipboard(tokenOrUrl);
        setCollaborationCopied(true);
        window.setTimeout(() => setCollaborationCopied(false), 1800);
        setStatusMessage(
          "New collaboration link copied. The old link no longer works.",
        );
      } else {
        setStatusMessage("Collaboration link regenerated.");
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Could not regenerate collaboration link",
      );
    } finally {
      setCollaborationBusy(false);
    }
  };

  const cancelJoinCollaboration = useCallback(() => {
    joinAttemptRef.current += 1;
    setJoinWaitingMessage("");
    setJoinCollaborationBusy(false);
  }, []);

  const joinCollaborationFromDialog = async () => {
    const token = joinTokenDraft.trim();
    if (!token || joinCollaborationBusy) {
      return;
    }

    const attempt = ++joinAttemptRef.current;
    setJoinCollaborationBusy(true);
    setJoinCollaborationError("");
    setStatusMessage("Joining collaboration...");
    try {
      let opened = await window.latexdo.joinCollaboration(token);
      // The owner approves newcomers: keep asking until they answer.
      while (opened.pending) {
        if (attempt !== joinAttemptRef.current) return;
        setJoinWaitingMessage(opened.message);
        setStatusMessage(opened.message);
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
        if (attempt !== joinAttemptRef.current) return;
        opened = await window.latexdo.joinCollaboration(token);
      }
      if (attempt !== joinAttemptRef.current) return;
      setCollaborationState(opened.collaboration);
      setJoinTokenDraft("");
      await loadProject(opened.project, true, false);
      setShareDialogOpen(false);
      setStatusMessage("Joined shared project");
      await loadCollaborationPermissions(opened.project.id);
    } catch (error) {
      if (attempt !== joinAttemptRef.current) return;
      const message =
        error instanceof Error ? error.message : "Could not join collaboration";
      setJoinCollaborationError(message);
      setStatusMessage(message);
    } finally {
      if (attempt === joinAttemptRef.current) {
        setJoinWaitingMessage("");
        setJoinCollaborationBusy(false);
      }
    }
  };

  const stopCollaboration = async () => {
    const currentProject = collaborationState.projectId ?? projectIdRef.current;
    if (!currentProject || !collaborationAvailable) return;

    const hosted = Boolean(collaborationState.hosted);
    setCollaborationBusy(true);
    try {
      const state = await window.latexdo.stopCollaboration(currentProject);
      setCollaborationState(state);
      setCollaborationPermissions([]);
      if (!hosted) {
        setStatusMessage("Sharing stopped");
        return;
      }
      // Bring the shared edits home, then go back to the folder they came from.
      const result = await window.latexdo.saveSharedProjectToFolder(currentProject);
      if (result.saved && result.project) {
        await loadProject(result.project, true, false);
        setShareDialogOpen(false);
        setStatusMessage(
          `Sharing stopped. ${result.written ?? 0} changed file(s) saved to your folder.`,
        );
      } else {
        setStatusMessage(
          "Sharing stopped. The shared copy stays open; use Save to my folder to keep its changes.",
        );
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Could not stop sharing",
      );
    } finally {
      setCollaborationBusy(false);
    }
  };

  const saveSharedProjectToFolder = async () => {
    const currentProject = collaborationState.projectId ?? projectIdRef.current;
    if (!currentProject) return;
    setCollaborationBusy(true);
    try {
      const result = await window.latexdo.saveSharedProjectToFolder(currentProject);
      if (result.saved) {
        setStatusMessage(
          `Saved ${result.written ?? 0} changed file(s) to ${result.folder ?? "your folder"}.`,
        );
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Could not save to your folder",
      );
    } finally {
      setCollaborationBusy(false);
    }
  };

  /**
   * Leaves the shared copy: stops sharing if it is on, saves the shared edits
   * into the owner's folder and opens that folder again (with Git and local
   * builds).
   */
  const returnToOwnFolder = async () => {
    const currentProject = collaborationState.projectId ?? projectIdRef.current;
    if (!currentProject) return;
    if (collaborationState.enabled) {
      await stopCollaboration();
      return;
    }
    setCollaborationBusy(true);
    try {
      const result = await window.latexdo.saveSharedProjectToFolder(currentProject);
      if (result.saved && result.project) {
        await loadProject(result.project, true, false);
        setShareDialogOpen(false);
        setStatusMessage(
          `Back in your folder. ${result.written ?? 0} changed file(s) saved from the shared copy.`,
        );
      } else {
        setShareStartError("Could not find your folder. Use Save to my folder first.");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not go back to your folder";
      setStatusMessage(message);
      setShareStartError(message);
    } finally {
      setCollaborationBusy(false);
    }
  };

  const changeCollaborationApproval = async (requireApproval: boolean) => {
    const currentProject = collaborationState.projectId ?? projectIdRef.current;
    if (!currentProject) return;
    try {
      setCollaborationState(
        await window.latexdo.setCollaborationApproval(currentProject, requireApproval),
      );
      setStatusMessage(
        requireApproval
          ? "New people now wait for your approval."
          : "Anyone with the invite can join.",
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Could not change the join setting",
      );
    }
  };

  const resolveCollaborationRequest = async (clientId: string, approve: boolean) => {
    const currentProject = collaborationState.projectId ?? projectIdRef.current;
    if (!currentProject) return;
    try {
      setCollaborationState(
        await window.latexdo.resolveCollaborationRequest(
          currentProject,
          clientId,
          approve,
        ),
      );
      await loadCollaborationPermissions(currentProject);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Could not answer the join request",
      );
    }
  };

  const loadCollaborationPermissions = useCallback(
    async (projectId: string) => {
      if (!collaborationAvailable) return;

      try {
        const result = await window.latexdo.getCollaborationPermissions(projectId);
        setCollaborationPermissions(result.permissions);
        setIsProjectAdmin(result.isAdmin);
        setCurrentUserRole(result.currentUserRole as "admin" | "editor" | "viewer");
      } catch {
        setCollaborationPermissions([]);
        setIsProjectAdmin(false);
        setCurrentUserRole("viewer");
      }
    },
    [collaborationAvailable],
  );

  return {
    connectCollaborationBinding,
    applyEditorBlameDecorations,
    handleEditorChange,
    insertLatexBlockAtEditorPosition,
    editorTheme,
    openProject,
    importOverleafProject,
    copyToClipboard,
    refreshCollaborationState,
    hostingAvailable,
    openShareDialog,
    returnToOwnFolder,
    createCollaborationLink,
    regenerateCollaborationLink,
    cancelJoinCollaboration,
    joinCollaborationFromDialog,
    stopCollaboration,
    saveSharedProjectToFolder,
    changeCollaborationApproval,
    resolveCollaborationRequest,
    loadCollaborationPermissions,
  };
}
