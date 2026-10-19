import type { OnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { emitProductEvent } from "../features/onboarding/core/ProductEvents";
import {
  generateRebuttalLetter,
  isUneditedRebuttalLetter,
  manuscriptTitleFromSource,
  nextRebuttalLetterName,
  rebuttalLetterFileName,
  defaultReviewerName,
} from "../rebuttalGenerator";
import { locateReviewSelection } from "../features/review/reviewAnchor";
import { setCursorPosition } from "../features/editor/cursorStore";
import { createReviewId, rebuttalMacro } from "../features/review/rebuttalSource";
import { escapeLatexText, removeInsertedReviewMarkup } from "../reviewMarkup";
import type { RebuttalItem, ReviewChat } from "../types";
import { formatCitation } from "../latex/citationStyle";
import { getLatexListEnterEdit } from "../latex/listContinuation";
import {
  GenerateStepNextEditModelClient,
  nextEditModelAvailable,
  type NextEditModelClient,
} from "../features/editor/nextEdit/nextEditModelClient";
import {
  registerInlineCompletion,
  registerInlineCompletionKeys,
} from "../features/editor/inlineCompletion/registerInlineCompletion";
import {
  findSeedFromSelection,
  requestFind,
  type FindScope,
} from "../components/FindPanel";
import type * as Monaco from "monaco-editor";

function openFindFromEditor(
  editor: Monaco.editor.IStandaloneCodeEditor,
  scope: FindScope,
) {
  const model = editor.getModel();
  const selection = editor.getSelection();
  requestFind({
    scope,
    query: findSeedFromSelection(
      model && selection && !selection.isEmpty()
        ? model.getValueInRange(selection)
        : "",
    ),
  });
}
import { AiSemanticNextEditPredictor } from "../features/editor/nextEdit/semanticPredictor";
import { installMonacoNextEdit } from "../features/editor/nextEdit/monacoNextEditAdapter";
import { blameHoverMarkdown } from "../features/git/inlineBlame";
import {
  flattenEntries,
  languageFor,
  normalizeRelativePath,
} from "../features/project/projectUtils";
import {
  editorModelMatchesPath,
  isTextDocument,
  monaco,
  offsetFromLineColumn,
} from "./appShared";
import type { AppCtx13 } from "./appContext";
import { reformulatingContextKey } from "../features/ai/reformulationProgress";

export function useAppReviewActions(ctx: AppCtx13) {
  const {
    activeBookmarkLines,
    activeCollaborationReadOnlyMessage,
    activePathRef,
    aiConfig,
    aiIsDesktop,
    allProjectEntries,
    applyBookmarkDecorations,
    applyEditorBlameDecorations,
    applyLatexPrettier,
    applyLatexToolbarCommand,
    askAiAboutSelection,
    blameHoverDisposablesRef,
    cancelReformulation,
    citationSearchPopupRef,
    compile,
    compileEntry,
    connectCollaborationBinding,
    documentsRef,
    editorActionDisposablesRef,
    editorBlameDisposablesRef,
    editorBlameStateRef,
    editorMouseDisposableRef,
    editorMutationOriginRef,
    editorRef,
    editorScrollSyncDisposableRef,
    fileBlameDecorationsRef,
    forwardSyncRef,
    inlineBlameDecorationsRef,
    jumpToBookmark,
    mode,
    nextEditAdapterRef,
    nextEditConfig,
    openCitationSearch,
    openDocument,
    openLinkAtCursor,
    pendingGraphCitationRef,
    applyPendingFigure,
    pendingSourceRef,
    projectEntriesRef,
    projectIdRef,
    rootFileRef,
    projectPathRef,
    rebuttalItems,
    reformulateSelectionWithAi,
    refreshProject,
    revealPendingSource,
    reviewChats,
    saveReviewData,
    scheduleEditorScrollSync,
    setCitationSearchAnchor,
    setDocuments,
    setEditorCursorLine,
    setFileBlameEnabled,
    setRebuttalItems,
    setReviewChats,
    setStatusMessage,
    syncCitationSearchAnchor,
    toggleBookmarkAtCurrentLine,
    triggerCitationCompletionIfNeeded,
    finishCitationInsert,
  } = ctx;

  // The ghost-text provider is registered once per editor mount and
  // asks this ref for a client, so AI setting changes apply immediately.
  const sentenceCompletionClientRef = useRef<NextEditModelClient | null>(null);
  useEffect(() => {
    sentenceCompletionClientRef.current =
      aiConfig.sentenceCompletionEnabled &&
      nextEditModelAvailable(aiConfig, aiIsDesktop)
        ? new GenerateStepNextEditModelClient(aiConfig, nextEditConfig, aiIsDesktop)
        : null;
  }, [aiConfig, aiIsDesktop, nextEditConfig]);

  // The AI selection actions are registered once per editor mount and call
  // the handlers through this ref, so they always see the current AI settings.
  const aiSelectionActionsRef = useRef({
    reformulateSelectionWithAi,
    askAiAboutSelection,
    cancelReformulation,
  });
  aiSelectionActionsRef.current = {
    reformulateSelectionWithAi,
    askAiAboutSelection,
    cancelReformulation,
  };

  // Editor actions live for the whole mount, including document switches.
  const bookmarkActionsRef = useRef({ toggleBookmarkAtCurrentLine, jumpToBookmark });
  bookmarkActionsRef.current = { toggleBookmarkAtCurrentLine, jumpToBookmark };

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
    setEditorCursorLine(editor.getPosition()?.lineNumber ?? null);
    nextEditAdapterRef.current?.dispose();
    nextEditAdapterRef.current = null;
    editorMouseDisposableRef.current?.dispose();
    editorScrollSyncDisposableRef.current?.dispose();
    for (const disposable of editorActionDisposablesRef.current) {
      disposable.dispose();
    }
    for (const disposable of editorBlameDisposablesRef.current) {
      disposable.dispose();
    }
    editorBlameDisposablesRef.current = [
      editor.onDidChangeCursorPosition((event) => {
        setEditorCursorLine(event.position.lineNumber);
        setCursorPosition(event.position.lineNumber, event.position.column);
        applyEditorBlameDecorations();
        triggerCitationCompletionIfNeeded(editor);
      }),
      editor.onDidChangeCursorSelection((event) => {
        if (!event.selection.isEmpty()) {
          emitProductEvent({ type: "editor:selection-created" });
        }
      }),
      editor.onDidChangeModelContent(() => {
        triggerCitationCompletionIfNeeded(editor);
      }),
      editor.onDidChangeModel(() => {
        setEditorCursorLine(editor.getPosition()?.lineNumber ?? null);
        inlineBlameDecorationsRef.current = [];
        fileBlameDecorationsRef.current = [];
        applyEditorBlameDecorations();
        triggerCitationCompletionIfNeeded(editor);
      }),
    ];
    const citationSearchBlurDisposable = editor.onDidBlurEditorWidget?.(() => {
      // Moving focus into the search bar itself must not close it.
      window.setTimeout(() => {
        if (!citationSearchPopupRef.current?.contains(document.activeElement)) {
          setCitationSearchAnchor(null);
        }
      }, 0);
    });
    if (citationSearchBlurDisposable) {
      editorBlameDisposablesRef.current.push(citationSearchBlurDisposable);
    }
    for (const disposable of blameHoverDisposablesRef.current) {
      disposable.dispose();
    }
    blameHoverDisposablesRef.current = [
      "latex",
      "bibtex",
      "asymptote",
      "markdown",
      "json",
      "plaintext",
    ].map((language) =>
      monaco.languages.registerHoverProvider(language, {
        provideHover: (model, position) => {
          if (editorRef.current?.getModel() !== model) return null;
          const state = editorBlameStateRef.current;
          if (state.dirty) return null;
          const blame = state.byLine.get(position.lineNumber);
          if (!blame) return null;
          return {
            range: new monaco.Range(
              position.lineNumber,
              1,
              position.lineNumber,
              model.getLineMaxColumn(position.lineNumber),
            ),
            contents: [{ value: blameHoverMarkdown(blame, new Date()) }],
          };
        },
      }),
    );
    editorActionDisposablesRef.current = [
      // LatexDo AI selection actions — visible only when there is a selection.
      editor.addAction({
        id: "latexdo.ai.reformulateSelection",
        label: "Reformulate with AI",
        contextMenuGroupId: "2_ai",
        contextMenuOrder: 0,
        precondition: "editorHasSelection",
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyR,
        ],
        run: () => {
          void aiSelectionActionsRef.current.reformulateSelectionWithAi();
        },
      }),
      editor.addAction({
        id: "latexdo.ai.askAboutSelection",
        label: "Ask AI about Selection",
        contextMenuGroupId: "2_ai",
        contextMenuOrder: 1,
        precondition: "editorHasSelection",
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyA,
        ],
        run: () => {
          aiSelectionActionsRef.current.askAiAboutSelection();
        },
      }),
      editor.addAction({
        id: "latexdo.ai.cancelReformulation",
        label: "Cancel Reformulation",
        // Only while a reformulation runs, so Escape still dismisses
        // completions, the find widget and everything else Monaco handles.
        precondition: `editorTextFocus && ${reformulatingContextKey}`,
        keybindings: [monaco.KeyCode.Escape],
        run: () => {
          aiSelectionActionsRef.current.cancelReformulation();
        },
      }),
      // Completion items run commands by their global id; editor.addAction
      // would register "<editorId>:<id>", which a suggestion cannot reach.
      // Cmd/Ctrl+F opens LatexDo's find panel (this file or all files)
      // instead of Monaco's in-file widget; Shift adds the whole project.
      editor.addAction({
        id: "latexdo.find",
        label: "Find",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF],
        run: () => openFindFromEditor(editor, "file"),
      }),
      editor.addAction({
        id: "latexdo.findInFiles",
        label: "Find in All Files",
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
        ],
        run: () => openFindFromEditor(editor, "project"),
      }),
      registerInlineCompletion({
        monaco,
        getClient: () => sentenceCompletionClientRef.current,
      }),
      ...registerInlineCompletionKeys(editor, monaco),
      monaco.editor.registerCommand("latexdo.citation.accepted", () =>
        finishCitationInsert(editor),
      ),
      monaco.editor.registerCommand("latexdo.citation.openSearch", () =>
        openCitationSearch(),
      ),
      editor.addAction({
        id: "latexdo.citation.search",
        label: "Search Bibliography",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyC],
        run: () => openCitationSearch(),
      }),
      editor.addAction({
        id: "latexdo.toggleFileBlame",
        label: "Git: Toggle File Blame Annotations",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyB],
        run: () => setFileBlameEnabled((current) => !current),
      }),
      editor.addAction({
        id: "latexdo.toggleBookmark",
        label: "Toggle Bookmark",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.F2],
        run: () => bookmarkActionsRef.current.toggleBookmarkAtCurrentLine(),
      }),
      editor.addAction({
        id: "latexdo.nextBookmark",
        label: "Go to Next Bookmark",
        keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.F2],
        run: () => bookmarkActionsRef.current.jumpToBookmark("next"),
      }),
      editor.addAction({
        id: "latexdo.previousBookmark",
        label: "Go to Previous Bookmark",
        keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.F2],
        run: () => bookmarkActionsRef.current.jumpToBookmark("previous"),
      }),
      editor.addAction({
        id: "latexdo.showCompletionDetails",
        label: "Completion: Show Details",
        keybindings: [monaco.KeyCode.RightArrow],
        precondition:
          "suggestWidgetVisible && suggestWidgetHasFocusedSuggestion && !suggestWidgetDetailsVisible",
        run: (targetEditor) => {
          targetEditor.trigger("keyboard", "toggleSuggestionDetails", null);
        },
      }),
      editor.addAction({
        id: "latexdo.hideCompletionDetails",
        label: "Completion: Hide Details",
        keybindings: [monaco.KeyCode.LeftArrow],
        precondition:
          "suggestWidgetVisible && suggestWidgetHasFocusedSuggestion && suggestWidgetDetailsVisible",
        run: (targetEditor) => {
          targetEditor.trigger("keyboard", "toggleSuggestionDetails", null);
        },
      }),
      editor.addAction({
        id: "latexdo.openLinkAtCursor",
        label: "Open Link at Cursor",
        contextMenuGroupId: "navigation",
        contextMenuOrder: 4,
        run: () => openLinkAtCursor(),
      }),
      editor.addAction({
        id: "latexdo.formatLatexTable",
        label: "Format LaTeX Table",
        contextMenuGroupId: "1_modification",
        contextMenuOrder: 1,
        run: () => applyLatexToolbarCommand("formatTable"),
      }),
      editor.addAction({
        id: "latexdo.prettierLists",
        label: "Tidy Document",
        keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
        contextMenuGroupId: "1_modification",
        contextMenuOrder: 0,
        run: () => applyLatexPrettier(),
      }),
      // Writers expect Cmd/Ctrl+B and +I to format text, as in Overleaf; the
      // keys keep their workbench meaning (Cmd/Ctrl+B: sidebar) outside TeX.
      editor.addAction({
        id: "latexdo.bold",
        label: "Bold",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB],
        precondition: "editorLangId == latex",
        run: () => applyLatexToolbarCommand("bold"),
      }),
      editor.addAction({
        id: "latexdo.italic",
        label: "Italic",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
        precondition: "editorLangId == latex",
        run: () => applyLatexToolbarCommand("italic"),
      }),
      editor.addAction({
        id: "latexdo.continueLatexList",
        label: "Continue or Close LaTeX List",
        keybindings: [monaco.KeyCode.Enter],
        precondition:
          "editorTextFocus && editorLangId == 'latex' && !suggestWidgetVisible",
        run: (targetEditor) => {
          const model = targetEditor.getModel();
          const position = targetEditor.getPosition();
          const selections = targetEditor.getSelections() ?? [];

          if (
            !model ||
            !position ||
            selections.length !== 1 ||
            !selections[0].isEmpty()
          ) {
            targetEditor.trigger("keyboard", "type", { text: "\n" });
            return;
          }

          const edit = getLatexListEnterEdit(
            model.getValue(),
            model.getOffsetAt(position),
          );
          if (!edit) {
            targetEditor.trigger("keyboard", "type", { text: "\n" });
            return;
          }

          const start = model.getPositionAt(edit.startOffset);
          const end = model.getPositionAt(edit.endOffset);
          targetEditor.executeEdits("latex-list-enter", [
            {
              range: new monaco.Range(
                start.lineNumber,
                start.column,
                end.lineNumber,
                end.column,
              ),
              text: edit.text,
              forceMoveMarkers: true,
            },
          ]);

          const cursor = model.getPositionAt(edit.startOffset + edit.cursorOffset);
          targetEditor.setPosition(cursor);
          targetEditor.revealPositionInCenterIfOutsideViewport(cursor);
        },
      }),
    ];
    applyBookmarkDecorations(editor, activeBookmarkLines);
    editorMouseDisposableRef.current = editor.onMouseDown((event) => {
      if (
        event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
        event.target.position &&
        event.event.leftButton &&
        event.event.detail === 1
      ) {
        event.event.preventDefault();
        editor.setPosition(event.target.position);
        bookmarkActionsRef.current.toggleBookmarkAtCurrentLine();
        return;
      }
      if (event.event.detail === 2 && event.target.position) {
        void forwardSyncRef.current?.(event.target.position);
      }
    });
    editorScrollSyncDisposableRef.current = editor.onDidScrollChange((event) => {
      syncCitationSearchAnchor(editor);
      if (event.scrollTopChanged) {
        scheduleEditorScrollSync();
      }
    });
    requestAnimationFrame(() => {
      revealPendingSource();
      triggerCitationCompletionIfNeeded(editor);
    });
    const mountedDocument = documentsRef.current.find(
      (item) => item.path === activePathRef.current,
    );
    if (
      mountedDocument &&
      isTextDocument(mountedDocument) &&
      editorModelMatchesPath(editor, mountedDocument.path)
    ) {
      const semanticPredictor =
        nextEditConfig.semanticEnabled && aiConfig.provider !== "off"
          ? new AiSemanticNextEditPredictor(
              new GenerateStepNextEditModelClient(
                aiConfig,
                nextEditConfig,
                aiIsDesktop,
              ),
            )
          : undefined;
      nextEditAdapterRef.current = installMonacoNextEdit({
        editor,
        monaco,
        documentKey: `${projectIdRef.current || projectPathRef.current || "project"}:${mountedDocument.relativePath}`,
        language: languageFor(mountedDocument.name),
        config: nextEditConfig,
        semanticPredictor,
        mutationOrigin: editorMutationOriginRef.current,
        // One search for repeat edits per pause in typing, not per keystroke.
        patternDebounceMs: 90,
      });
    }
    const pendingCitation = pendingGraphCitationRef.current;
    if (pendingCitation && editorModelMatchesPath(editor, pendingCitation.path)) {
      pendingGraphCitationRef.current = null;
      const model = editor.getModel();
      if (
        !model ||
        model.getValue() !== pendingCitation.content ||
        activeCollaborationReadOnlyMessage
      ) {
        setStatusMessage(
          "The source changed or is read-only. Return to the graph and try the citation again.",
        );
      } else {
        const { plan, key } = pendingCitation;
        const start = model.getPositionAt(plan.rangeStartOffset);
        const end = model.getPositionAt(plan.rangeEndOffset);
        editor.pushUndoStop();
        editor.executeEdits("knowledge-graph", [
          {
            range: new monaco.Range(
              start.lineNumber,
              start.column,
              end.lineNumber,
              end.column,
            ),
            text: plan.text,
            forceMoveMarkers: true,
          },
        ]);
        editor.pushUndoStop();
        setStatusMessage(`Inserted ${formatCitation(plan.command, plan.keys)}.`);
        emitProductEvent({ type: "citation:inserted", key });
      }
    }
    applyPendingFigure(editor);
    connectCollaborationBinding(editor);
    editor.focus();
  };

  const handleAddReviewChat = useCallback(() => {
    const editor = editorRef.current;
    const document = documentsRef.current.find((d) => d.path === activePathRef.current);
    if (!editor || !document || !editorModelMatchesPath(editor, document.path)) {
      setStatusMessage("Open a document before starting a review thread.");
      return;
    }

    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) {
      setStatusMessage("Select text before starting a review thread.");
      return;
    }

    const model = editor.getModel();
    if (!model) {
      setStatusMessage("Could not read the active editor selection.");
      return;
    }

    const selectedText = model.getValueInRange(selection);
    if (!selectedText.trim()) {
      setStatusMessage("Select some text to add a review comment.");
      return;
    }

    const newChat: ReviewChat = {
      id: createReviewId(),
      filePath: document.relativePath,
      selection: {
        startLine: selection.startLineNumber,
        startColumn: selection.startColumn,
        endLine: selection.endLineNumber,
        endColumn: selection.endColumn,
        text: selectedText,
      },
      comments: [],
    };

    setReviewChats((prev) => {
      const next = [...prev, newChat];
      return next;
    });
    setStatusMessage("Started review conversation in sidebar.");
  }, []);

  const handleAddRebuttalToSource = useCallback(() => {
    const editor = editorRef.current;
    const document = documentsRef.current.find((d) => d.path === activePathRef.current);
    const model = editor?.getModel();
    if (
      !editor ||
      !model ||
      !document ||
      !editorModelMatchesPath(editor, document.path)
    ) {
      setStatusMessage("Open a TeX file before adding a rebuttal block.");
      return;
    }

    const selection = editor.getSelection();
    const selectedText = selection ? model.getValueInRange(selection) : "";
    if (!selection || !selectedText.trim()) {
      setStatusMessage("Select the text the reviewer commented on first.");
      return;
    }

    // The comment and answer start empty and are filled in from the sidebar,
    // which keeps the block in the source in step.
    const newItem: RebuttalItem = {
      id: createReviewId(),
      filePath: document.relativePath,
      originalText: selectedText,
      revisedText: selectedText,
      insertedInTex: true,
      reviewerComment: "",
      authorComment: "",
      modificationMade: selectedText,
    };

    editor.executeEdits("rebuttal-mode", [
      {
        range: selection,
        text: rebuttalMacro(newItem),
        forceMoveMarkers: true,
      },
    ]);

    setRebuttalItems((prev) => [
      ...prev,
      { ...newItem, reviewer: prev.at(-1)?.reviewer || defaultReviewerName },
    ]);
    setStatusMessage(
      "Added a rebuttal block. Fill in the comment and your answer in the sidebar.",
    );
  }, []);

  const [rebuttalLetterPath, setRebuttalLetterPath] = useState(rebuttalLetterFileName);

  /** Writes the response letter into the project, opens it and compiles it. */
  const handleGenerateRebuttalLetter = useCallback(async () => {
    const currentProject = projectIdRef.current;
    if (!currentProject) {
      setStatusMessage("Open a project before creating the response letter.");
      return;
    }

    try {
      // The title comes from this paper, never from another project.
      const rootPath = normalizeRelativePath(rootFileRef.current ?? "");
      const openRoot = documentsRef.current.find(
        (document) =>
          isTextDocument(document) &&
          normalizeRelativePath(document.relativePath) === rootPath,
      );
      const rootSource =
        openRoot && isTextDocument(openRoot)
          ? openRoot.content
          : rootPath && (await window.latexdo.fileExists(currentProject, rootPath))
            ? await window.latexdo.readFile(currentProject, rootPath)
            : "";
      const tex = generateRebuttalLetter(rebuttalItems, {
        manuscriptTitle: manuscriptTitleFromSource(rootSource) ?? undefined,
      });

      const projectFiles = new Set(
        flattenEntries(projectEntriesRef.current)
          .filter((entry) => entry.type === "file")
          .map((entry) => normalizeRelativePath(entry.relativePath)),
      );
      let outName = rebuttalLetterFileName;
      if (await window.latexdo.fileExists(currentProject, outName)) {
        const existing = await window.latexdo.readFile(currentProject, outName);
        const openLetter = documentsRef.current.find(
          (document) =>
            isTextDocument(document) &&
            normalizeRelativePath(document.relativePath) === outName,
        );
        const edited =
          !isUneditedRebuttalLetter(existing) ||
          Boolean(
            openLetter &&
            isTextDocument(openLetter) &&
            openLetter.content !== openLetter.savedContent,
          );
        if (
          edited &&
          !window.confirm(
            `You edited ${outName} after it was created.\n\n` +
              "OK: replace it with a new letter (your edits are lost).\n" +
              "Cancel: keep your edited letter and save the new one as a separate file.",
          )
        ) {
          outName = nextRebuttalLetterName((name) => projectFiles.has(name));
        }
      }

      await window.latexdo.writeFile(currentProject, outName, tex);
      await refreshProject(currentProject);
      setRebuttalLetterPath(outName);
      setDocuments((current) => {
        const nextDocuments = current.map((document) =>
          normalizeRelativePath(document.relativePath) === outName
            ? { ...document, content: tex, savedContent: tex }
            : document,
        );
        documentsRef.current = nextDocuments;
        return nextDocuments;
      });
      const entry = flattenEntries(projectEntriesRef.current).find(
        (candidate) =>
          candidate.type === "file" &&
          normalizeRelativePath(candidate.relativePath) === outName,
      );
      if (entry) {
        await openDocument(entry);
        setStatusMessage(
          `Saved the response letter as ${outName} in your project folder.`,
        );
        await compileEntry(entry);
      } else {
        setStatusMessage(
          `Saved the response letter as ${outName} in your project folder.`,
        );
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      setStatusMessage(`Could not create the response letter: ${err}`);
    }
  }, [compileEntry, openDocument, rebuttalItems, refreshProject]);

  const openRebuttalLetter = useCallback(async () => {
    const entry = flattenEntries(projectEntriesRef.current).find(
      (candidate) =>
        candidate.type === "file" &&
        normalizeRelativePath(candidate.relativePath) === rebuttalLetterPath,
    );
    if (entry) await openDocument(entry);
    else setStatusMessage(`${rebuttalLetterPath} is no longer in the project.`);
  }, [openDocument, projectEntriesRef, rebuttalLetterPath, setStatusMessage]);

  const handleAddReviewComment = useCallback(
    (chatId: string, text: string) => {
      setReviewChats((prev) => {
        const next = prev.map((chat) => {
          if (chat.id === chatId) {
            return {
              ...chat,
              comments: [
                ...chat.comments,
                {
                  id: createReviewId(),
                  author: mode === "reviewer" ? "Reviewer" : "Author",
                  text,
                  timestamp: Date.now(),
                },
              ],
            };
          }
          return chat;
        });
        return next;
      });
    },
    [mode],
  );

  const removeReviewChatFromTex = useCallback(
    async (chat: ReviewChat): Promise<boolean> => {
      if (!chat.insertedInTex) {
        return true;
      }

      const currentProject = projectIdRef.current;
      if (!currentProject) {
        setStatusMessage("No project open. Could not remove review markup.");
        return false;
      }

      const normalizedPath = normalizeRelativePath(chat.filePath);
      const openDoc = documentsRef.current.find(
        (document) => normalizeRelativePath(document.relativePath) === normalizedPath,
      );

      let content: string;
      try {
        content =
          openDoc?.content ??
          (await window.latexdo.readFile(currentProject, chat.filePath));
      } catch {
        setStatusMessage("Could not read the file for this review thread.");
        return false;
      }

      const preferredStartIndex =
        offsetFromLineColumn(
          content,
          chat.selection.startLine,
          chat.selection.startColumn,
        ) ?? undefined;
      const removal = removeInsertedReviewMarkup(
        content,
        chat.selection.text,
        preferredStartIndex,
      );

      if (!removal.removed) {
        setStatusMessage(
          "Could not find the inserted review markup in the TeX source.",
        );
        return false;
      }

      if (openDoc) {
        setDocuments((current) => {
          const nextDocuments = current.map((document) =>
            document.path === openDoc.path
              ? { ...document, content: removal.content }
              : document,
          );
          documentsRef.current = nextDocuments;
          return nextDocuments;
        });
      } else {
        try {
          await window.latexdo.writeFile(
            currentProject,
            chat.filePath,
            removal.content,
          );
          void compile();
        } catch {
          setStatusMessage("Could not update the file for this review thread.");
          return false;
        }
      }

      return true;
    },
    [compile, setDocuments],
  );

  const handleDeleteReviewChat = useCallback(
    async (chatId: string) => {
      if (!window.confirm("Delete this review chat?")) return;
      const chat = reviewChats.find((candidate) => candidate.id === chatId);
      if (!chat) return;
      const removedFromTex = await removeReviewChatFromTex(chat);
      // A thread whose markup was edited or removed by hand must stay deletable.
      if (
        !removedFromTex &&
        !window.confirm(
          "The comment for this thread was not found in the TeX source. Delete the thread anyway?",
        )
      ) {
        return;
      }

      setReviewChats((prev) => {
        const next = prev.filter((c) => c.id !== chatId);
        return next;
      });
      setStatusMessage(
        !removedFromTex
          ? "Deleted review thread. Remove its comment from the TeX source if it is still there."
          : chat.insertedInTex
            ? "Deleted review thread and removed it from the TeX source."
            : "Deleted review thread.",
      );
    },
    [removeReviewChatFromTex, reviewChats],
  );

  const handleInsertReviewChatIntoTex = useCallback(
    async (chat: ReviewChat) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) {
        setStatusMessage("No project open.");
        return;
      }
      if (chat.insertedInTex) {
        setStatusMessage("This review thread is already in the TeX source.");
        return;
      }
      const comments = chat.comments.filter((comment) => comment.text.trim());
      if (comments.length === 0) {
        setStatusMessage(
          "Write at least one message before inserting the thread into TeX.",
        );
        return;
      }

      const normalizedPath = normalizeRelativePath(chat.filePath);
      const openDoc = documentsRef.current.find(
        (document) => normalizeRelativePath(document.relativePath) === normalizedPath,
      );
      let content: string;
      try {
        content =
          openDoc?.content ??
          (await window.latexdo.readFile(currentProject, chat.filePath));
      } catch {
        setStatusMessage("Could not read the file for this review thread.");
        return;
      }

      const selectionText = chat.selection.text;
      // Prefer the recorded selection range; fall back to searching for the text.
      let start = -1;
      const candidate = offsetFromLineColumn(
        content,
        chat.selection.startLine,
        chat.selection.startColumn,
      );
      if (candidate !== null) {
        if (
          content.slice(candidate, candidate + selectionText.length) === selectionText
        ) {
          start = candidate;
        }
      }
      if (start === -1) {
        start = content.indexOf(selectionText);
      }
      if (start === -1) {
        setStatusMessage(
          "Could not find the reviewed text in the file — it may have been edited.",
        );
        return;
      }

      const commentLatex = comments
        .map(
          (comment) =>
            `\\textbf{${escapeLatexText(comment.author)}:} ${escapeLatexText(comment.text)}`,
        )
        .join(" \\par ");
      const afterSelection = content.slice(start + selectionText.length);
      const commentPrefix = selectionText.endsWith("\n") ? "" : "\n";
      const commentSuffix = afterSelection.startsWith("\n") ? "" : "\n";
      const nextContent =
        content.slice(0, start) +
        `${selectionText}${commentPrefix}\\latexdoreviewercomment{${commentLatex}}${commentSuffix}` +
        afterSelection;

      if (openDoc) {
        setDocuments((current) => {
          const nextDocuments = current.map((document) =>
            document.path === openDoc.path
              ? { ...document, content: nextContent }
              : document,
          );
          documentsRef.current = nextDocuments;
          return nextDocuments;
        });
      } else {
        await window.latexdo.writeFile(currentProject, chat.filePath, nextContent);
        void compile();
      }

      setReviewChats((prev) => {
        const next = prev.map((existing) =>
          existing.id === chat.id ? { ...existing, insertedInTex: true } : existing,
        );
        return next;
      });
      setStatusMessage(
        "Inserted review thread into the TeX source — it will render on the next compile.",
      );
    },
    [compile, rebuttalItems, saveReviewData],
  );

  const handleJumpToReviewSelection = useCallback(
    async (chat: ReviewChat) => {
      const chatPath = normalizeRelativePath(chat.filePath);
      const entry = allProjectEntries.find(
        (e) => e.type === "file" && normalizeRelativePath(e.relativePath) === chatPath,
      );
      if (!entry) {
        setStatusMessage(`${chat.filePath} is no longer in this project.`);
        return;
      }

      await openDocument(entry);
      const content = documentsRef.current.find(
        (document) => document.path === entry.path,
      )?.content;
      const range =
        content === undefined ? null : locateReviewSelection(content, chat.selection);
      if (content !== undefined && !range) {
        setStatusMessage(
          "The reviewed text was rewritten. Showing where it used to be.",
        );
      }
      const target = range ?? chat.selection;
      if (range && range.startLine !== chat.selection.startLine) {
        // Remember where the passage moved to.
        setReviewChats((prev) =>
          prev.map((existing) =>
            existing.id === chat.id
              ? { ...existing, selection: { ...existing.selection, ...range } }
              : existing,
          ),
        );
      }
      pendingSourceRef.current = {
        path: entry.path,
        line: target.startLine,
        column: target.startColumn,
        endLine: target.endLine,
        endColumn: target.endColumn,
      };
      requestAnimationFrame(() => revealPendingSource());
    },
    [allProjectEntries, openDocument, revealPendingSource],
  );

  return {
    handleEditorMount,
    handleAddReviewChat,
    handleAddRebuttalToSource,
    handleGenerateRebuttalLetter,
    rebuttalLetterPath,
    openRebuttalLetter,
    handleAddReviewComment,
    handleDeleteReviewChat,
    handleInsertReviewChatIntoTex,
    handleJumpToReviewSelection,
  };
}
