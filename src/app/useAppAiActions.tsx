import { useCallback, useMemo, useRef } from "react";
import { emitProductEvent } from "../features/onboarding/core/ProductEvents";
import { layoutPresetFlags, type LayoutPreset } from "../features/ai/aiConfig";
import { abortGeneration } from "../features/ai/aiClient";
import type { AgentContext, EditProposal } from "../features/ai/aiTools";
import { isAiReady } from "../features/ai/aiConfig";
import {
  captureEditorSelection,
  newReformulationRequestId,
  performReformulation,
  buildReformulationProposal,
  validateSelectionForReformulation,
  validateSnapshotRange,
  type AiSelectionSnapshot,
  type AiComposerSelectionContext,
} from "../features/ai/selectionAi";
import type {
  ProofreadingSettings,
  ProjectEntry,
  SpellCheckerSettings,
} from "../types";
import { analyzeCitationLibrary, citationKeysInText } from "../latex/citationAnalysis";
import { recommendCitations } from "../features/graph/citationRecommender";
import { planCitationInsertion } from "../latex/citationInsertion";
import { formatCitation, resolveCitationStyle } from "../latex/citationStyle";
import { planScholarlyDiscoveryWithAi } from "../features/graph/aiDiscoveryPlanner";
import {
  knowledgeGraphTabId,
  defaultGraphViewState,
  readPaperSources,
  relatedBibliography,
} from "../features/graph/graphWorkspace";
import { rankedCitationCompletions } from "../latex/citationCompletion";
import { normalizeRelativePath } from "../features/project/projectUtils";
import {
  SidebarView,
  editorModelMatchesPath,
  getNearbyCitationContext,
  isTextDocument,
  monaco,
} from "./appShared";
import type { AppCtx10 } from "./appContext";
import { useAppTikzFigures } from "./useAppTikzFigures";
import { containsTikz } from "../features/tikz/tikzSnippet";
import {
  showReformulationProgress,
  type ReformulationProgress,
} from "../features/ai/reformulationProgress";
import { tikzCanvasTabId } from "../features/tikz/tikzWorkspace";
import { toolTabKey, toolTabLabels } from "../features/workspace/toolTabs";

function compileSummary(result: Awaited<ReturnType<AppCtx10["compile"]>>) {
  return {
    ok: Boolean(result?.ok),
    log: result?.output ?? "",
    diagnostics: (result?.diagnostics ?? []).map(
      (d) => `${d.severity} ${d.file}:${d.line} — ${d.message}`,
    ),
  };
}

export function useAppAiActions(ctx: AppCtx10) {
  const {
    activationWorkspaceSnapshotRef,
    activeAiSidebarApiRef,
    activePanel,
    activePathRef,
    activeSidebar,
    activeTextDocument,
    aiConfig,
    aiIsDesktop,
    citationAnalysis,
    citationProjectFilesRef,
    compile,
    compileResult,
    documents,
    documentsRef,
    editorRef,
    graphFilterRef,
    graphOpenRef,
    graphSourceRef,
    graphViewStateRef,
    hasVisibleProject,
    knowledgeGraph,
    knowledgeGraphOpen,
    latexEditorView,
    panelVisible,
    pendingGraphCitationRef,
    previewVisible,
    projectId,
    projectIdRef,
    projectName,
    reformulationCancelledRef,
    reformulationInFlightRef,
    reformulationRequestIdRef,
    rootFile,
    setActivePanel,
    setActivePath,
    setActiveSidebar,
    setGraphFilter,
    setGraphViewState,
    setLatexEditorView,
    setPanelVisible,
    setPreviewVisible,
    setProofreadingError,
    setProofreadingSettings,
    setSettings,
    setSidebarVisible,
    setSpellCheckerError,
    setSpellCheckerLoading,
    setSpellCheckerSettings,
    setSpellCheckerWordDraft,
    setStatusMessage,
    sidebarVisible,
  } = ctx;
  const tikzFigures = useAppTikzFigures(ctx);
  const { insertFigureInEditor } = tikzFigures;

  const loadSpellCheckerSettings = useCallback(async () => {
    setSpellCheckerLoading(true);
    setSpellCheckerError("");

    try {
      const nextSettings = await window.latexdo.getSpellCheckerSettings();
      setSpellCheckerSettings(nextSettings);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not load spell checker settings";
      setSpellCheckerError(
        message.replace(/^Error invoking remote method '[^']+': /, ""),
      );
    } finally {
      setSpellCheckerLoading(false);
    }
  }, []);

  const saveSpellCheckerSettings = useCallback(
    async (
      nextSettings: SpellCheckerSettings,
      successMessage?: string,
      options?: { clearWordDraft?: boolean },
    ) => {
      setSpellCheckerLoading(true);
      setSpellCheckerError("");
      try {
        const saved = await window.latexdo.updateSpellCheckerSettings(nextSettings);
        setSpellCheckerSettings(saved);
        if (options?.clearWordDraft) {
          setSpellCheckerWordDraft("");
        }
        if (successMessage) {
          setStatusMessage(successMessage);
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Could not save spell checker settings";
        setSpellCheckerError(
          message.replace(/^Error invoking remote method '[^']+': /, ""),
        );
      } finally {
        setSpellCheckerLoading(false);
      }
    },
    [],
  );

  const loadProofreadingSettings = useCallback(async () => {
    setProofreadingError("");
    try {
      const nextSettings = await window.latexdo.getProofreadingSettings();
      setProofreadingSettings(nextSettings);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not load proofreading settings";
      setProofreadingError(
        message.replace(/^Error invoking remote method '[^']+': /, ""),
      );
    }
  }, []);

  const saveProofreadingSettings = useCallback(
    async (nextSettings: ProofreadingSettings, successMessage?: string) => {
      setProofreadingError("");
      try {
        const saved = await window.latexdo.updateProofreadingSettings(nextSettings);
        setProofreadingSettings(saved);
        if (successMessage) {
          setStatusMessage(successMessage);
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Could not save proofreading settings";
        setProofreadingError(
          message.replace(/^Error invoking remote method '[^']+': /, ""),
        );
      }
    },
    [],
  );

  const openSidebar = useCallback((view: SidebarView) => {
    setSidebarVisible(true);
    setActiveSidebar(view);
  }, []);

  // --- AI agent integration -------------------------------------------------
  const applyAgentEdit = useCallback(
    async (proposal: EditProposal) => {
      const editor = editorRef.current;
      // Figures go through the TikZ path: preamble packages, a safe place in
      // the body, and the figure left selected for follow-up fixes.
      if (
        editor &&
        proposal.kind !== "replace-file" &&
        containsTikz(proposal.newText)
      ) {
        const result = await insertFigureInEditor(
          editor,
          proposal.newText,
          proposal.kind === "replace-selection" ? "selection" : "cursor",
        );
        if (!result.ok) throw new Error(result.message);
        setStatusMessage(result.message);
        return;
      }
      if (proposal.kind === "replace-selection" && editor) {
        const selection = editor.getSelection();
        if (selection) {
          editor.executeEdits("ai-agent", [
            { range: selection, text: proposal.newText },
          ]);
          editor.focus();
        }
        return;
      }
      if (proposal.kind === "insert-at-cursor" && editor) {
        const position = editor.getPosition();
        if (position) {
          editor.executeEdits("ai-agent", [
            {
              range: {
                startLineNumber: position.lineNumber,
                startColumn: position.column,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
              },
              text: proposal.newText,
            },
          ]);
          editor.focus();
        }
        return;
      }
      // replace-file
      if (proposal.path === activeTextDocument?.relativePath && editor?.getModel()) {
        editor.getModel()?.setValue(proposal.newText);
      } else if (projectId) {
        await window.latexdo.writeFile(projectId, proposal.path, proposal.newText);
      }
    },
    [activeTextDocument, insertFigureInEditor, projectId],
  );

  // --- Selection → AI workflows (reformulate / ask about selection) -------

  /**
   * Apply a validated reformulation proposal. Verifies the snapshot range still
   * matches the original text before mutating, so a slow asynchronous AI
   * response can never overwrite newer user work.
   */
  const applyAiSelectionProposal = useCallback(
    (snapshot: AiSelectionSnapshot, newText: string) => {
      const editor = editorRef.current;
      if (!editor || !validateSnapshotRange(editor, snapshot)) {
        setStatusMessage(
          "The selected text changed while the AI suggestion was being generated. Please select it again and retry.",
        );
        return;
      }
      const model = editor.getModel();
      if (!model) return;
      const range = new monaco.Range(
        snapshot.range.startLineNumber,
        snapshot.range.startColumn,
        snapshot.range.endLineNumber,
        snapshot.range.endColumn,
      );
      editor.pushUndoStop();
      editor.executeEdits("latexdo-ai-reformulate", [
        { range, text: newText, forceMoveMarkers: true },
      ]);
      // Reveal + focus the replacement as one undoable operation.
      const position = editor.getPosition();
      if (position) {
        editor.revealRangeInCenterIfOutsideViewport(
          new monaco.Range(
            Math.max(1, position.lineNumber - 2),
            1,
            position.lineNumber + 3,
            1,
          ),
          monaco.editor.ScrollType.Smooth,
        );
      }
      editor.focus();
      setStatusMessage("Reformulation applied.");
      emitProductEvent({ type: "ai:reformulation-applied" });
    },
    [setStatusMessage],
  );

  const reformulationProgressRef = useRef<ReformulationProgress | null>(null);

  /** Cancel an in-flight reformulation (Escape or the popup's Cancel button). */
  const cancelReformulation = useCallback(() => {
    if (!reformulationInFlightRef.current) return;
    reformulationCancelledRef.current = true;
    reformulationProgressRef.current?.dispose();
    reformulationProgressRef.current = null;
    if (reformulationRequestIdRef.current) {
      void abortGeneration(reformulationRequestIdRef.current);
    }
    setStatusMessage("Reformulation cancelled.");
  }, [setStatusMessage]);

  /** Reformulate the selected text via the AI provider, then ask for approval. */
  const reformulateSelectionWithAi = useCallback(async () => {
    const editor = editorRef.current;
    const snapshot = captureEditorSelection(
      editor,
      activeTextDocument?.relativePath ?? null,
    );
    if (!snapshot) {
      setStatusMessage("Select text to reformulate.");
      return;
    }
    if (!isAiReady(aiConfig, aiIsDesktop)) {
      setStatusMessage(
        "AI is not configured. Open AI settings and choose a provider first.",
      );
      return;
    }
    if (reformulationInFlightRef.current) {
      setStatusMessage("A reformulation is already in progress.");
      return;
    }
    const sizeError = validateSelectionForReformulation(snapshot);
    if (sizeError) {
      setStatusMessage(sizeError);
      return;
    }

    reformulationInFlightRef.current = true;
    reformulationCancelledRef.current = false;
    const requestId = newReformulationRequestId();
    reformulationRequestIdRef.current = requestId;
    setStatusMessage("Reformulating selection…");
    const progress = editor
      ? showReformulationProgress(editor, monaco, snapshot.range, cancelReformulation)
      : null;
    reformulationProgressRef.current = progress;
    try {
      const { step } = await performReformulation(
        aiConfig,
        snapshot,
        (text) => progress?.append(text),
        requestId,
      );
      progress?.dispose();
      if (reformulationCancelledRef.current) {
        setStatusMessage("Reformulation cancelled.");
        return;
      }
      if (step.type === "text" && step.truncated) {
        setStatusMessage(
          "The rewrite was cut off before it finished. Select a shorter passage and try again.",
        );
        return;
      }
      if (step.type === "error") {
        setStatusMessage(`Could not reformulate the selection: ${step.content}`);
        return;
      }
      const proposal = buildReformulationProposal(snapshot, step.content);
      if (!proposal) {
        setStatusMessage("Could not reformulate the selection: empty result.");
        return;
      }

      // Surface the proposal in the active AI chat's approval UI.
      const api = activeAiSidebarApiRef.current;
      let approved = false;
      if (api) {
        openSidebar("ai");
        approved = await api.proposeEdit(proposal);
      }
      if (!approved) {
        setStatusMessage("Reformulation declined. No changes made.");
        return;
      }
      applyAiSelectionProposal(snapshot, proposal.newText);
    } catch (error) {
      setStatusMessage(
        `Could not reformulate the selection: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      progress?.dispose();
      if (reformulationProgressRef.current === progress) {
        reformulationProgressRef.current = null;
      }
      reformulationInFlightRef.current = false;
      reformulationRequestIdRef.current = null;
    }
  }, [
    activeTextDocument,
    aiConfig,
    aiIsDesktop,
    openSidebar,
    setStatusMessage,
    applyAiSelectionProposal,
    cancelReformulation,
  ]);

  /** Attach the current selection to the active AI chat for user-directed questions. */
  const askAiAboutSelection = useCallback(() => {
    const editor = editorRef.current;
    const snapshot = captureEditorSelection(
      editor,
      activeTextDocument?.relativePath ?? null,
    );
    if (!snapshot) {
      setStatusMessage("Select text to ask AI about.");
      return;
    }
    openSidebar("ai");
    const selectionContext: AiComposerSelectionContext = {
      type: "editor-selection",
      filePath: snapshot.filePath,
      text: snapshot.text,
      startLine: snapshot.range.startLineNumber,
      endLine: snapshot.range.endLineNumber,
    };
    // Defer one frame so the sidebar finishes mounting before we focus.
    requestAnimationFrame(() => {
      activeAiSidebarApiRef.current?.appendSelectionContext(selectionContext);
      emitProductEvent({ type: "ai:selection-attached" });
    });
  }, [activeTextDocument, openSidebar, setStatusMessage]);

  const insertCitationKey = (key: string) => {
    const source = graphSourceRef.current;
    const document = documentsRef.current.find((doc) => doc.path === source?.path);
    if (!source || !document || document.content !== source.content) {
      setStatusMessage(
        "Open a .tex tab, place the cursor, then return to the graph to insert a citation.",
      );
      return;
    }
    const style = resolveCitationStyle({
      selectedText: source.selection,
      nearbyText: source.content.slice(
        Math.max(0, source.offset - 1200),
        source.offset + 1200,
      ),
      activeFilePath: document.relativePath,
      activeDocumentText: source.content,
      usages: citationAnalysis.usages,
    });
    const plan = planCitationInsertion(source.content, source.offset, style.command, [
      key,
    ]);
    if (!plan) {
      setStatusMessage("This reference is already cited near the cursor.");
      return;
    }
    pendingGraphCitationRef.current = {
      path: document.path,
      content: source.content,
      key,
      plan,
    };
    setActivePath(document.path);
    activePathRef.current = document.path;
  };

  const recommendCitationsForSelection = () => {
    const text = graphSourceRef.current?.selection.trim();
    if (!text) {
      setStatusMessage(
        "Select a sentence or paragraph in a .tex tab, then open the graph.",
      );
      return;
    }
    const recommendations = recommendCitations(text, citationAnalysis.entries, {
      citedKeys: citationKeysInText(text),
      limit: 12,
    });
    setGraphFilter({
      keys: recommendations.map((rec) => rec.key),
      label: "Related to selected text (metadata matches)",
    });
  };

  const planKnowledgeGraphDiscoveryWithAi = useCallback(
    (
      graph: typeof knowledgeGraph,
      entries: typeof citationAnalysis.entries,
      signal: AbortSignal,
    ) =>
      planScholarlyDiscoveryWithAi({
        graph,
        entries,
        config: aiConfig,
        isDesktop: aiIsDesktop,
        signal,
      }),
    [aiConfig, aiIsDesktop],
  );

  const flattenProjectFiles = useCallback((entries: ProjectEntry[]): string[] => {
    const out: string[] = [];
    const walk = (list: ProjectEntry[]) => {
      for (const entry of list) {
        if (entry.type === "directory") {
          if (entry.children) walk(entry.children);
        } else {
          out.push(entry.relativePath);
        }
      }
    };
    walk(entries);
    return out;
  }, []);

  const agentContext = useMemo<AgentContext>(
    () => ({
      hasProject: () => hasVisibleProject,
      projectName: () => (hasVisibleProject ? projectName || "Project" : ""),
      activeFilePath: () => activeTextDocument?.relativePath ?? null,
      listFiles: async () => {
        if (!hasVisibleProject || !projectId) return [];
        const entries = await window.latexdo.listProject(projectId);
        return flattenProjectFiles(entries);
      },
      readFile: (path) =>
        hasVisibleProject && projectId
          ? window.latexdo.readFile(projectId, path)
          : Promise.reject(new Error("No project open")),
      writeFile: async (path, content) => {
        if (!hasVisibleProject || !projectId) throw new Error("No project open");
        await window.latexdo.writeFile(projectId, path, content);
      },
      documentText: () =>
        editorRef.current?.getModel()?.getValue() ?? activeTextDocument?.content ?? "",
      selection: () => {
        const editor = editorRef.current;
        const selection = editor?.getSelection();
        const text =
          selection && editor
            ? (editor.getModel()?.getValueInRange(selection) ?? "")
            : "";
        return { text, hasSelection: text.trim().length > 0 };
      },
      applyEdit: applyAgentEdit,
      compile: async () => compileSummary(await compile()),
      showFigure: async () => compileSummary(await tikzFigures.showFigureInPreview()),
      runChecks: async (kind) => {
        const diagnostics = compileResult?.diagnostics ?? [];
        if (!diagnostics.length) {
          return `The '${kind}' checker found no compile-level issues. Open the Problems panel for the full built-in ${kind} report.`;
        }
        return (
          `Current diagnostics (also feeding the ${kind} checker):\n` +
          diagnostics
            .slice(0, 30)
            .map((d) => `- ${d.severity} ${d.file}:${d.line} — ${d.message}`)
            .join("\n")
        );
      },
      insertCitation: async (query) => {
        const editor = editorRef.current;
        const model = editor?.getModel();
        const documentText = model?.getValue() ?? activeTextDocument?.content ?? "";
        const style = resolveCitationStyle({
          selectedText: query,
          nearbyText: getNearbyCitationContext(editor),
          activeFilePath: activeTextDocument?.relativePath ?? null,
          activeDocumentText: documentText,
          usages: citationAnalysis.usages,
        });
        const entry = rankedCitationCompletions(citationAnalysis.entries, query)[0];
        if (!entry) {
          return JSON.stringify({
            citationStyle: style,
            recommendation: null,
            message: `No bibliography entry matched "${query}". Add it to a .bib file first.`,
          });
        }
        return JSON.stringify({
          citationStyle: style,
          recommendation: {
            key: entry.key,
            citation: formatCitation(style.command, [entry.key]),
            title: entry.title,
            author: entry.author ?? entry.editor,
            year: entry.year,
            venue:
              entry.journal ??
              entry.booktitle ??
              entry.publisher ??
              entry.school ??
              entry.institution,
            sourceFile: entry.sourceFile,
          },
        });
      },
      recommendCitations: async (passage) => {
        const editor = editorRef.current;
        const model = editor?.getModel();
        const documentText = model?.getValue() ?? activeTextDocument?.content ?? "";
        const style = resolveCitationStyle({
          selectedText: passage,
          nearbyText: getNearbyCitationContext(editor),
          activeFilePath: activeTextDocument?.relativePath ?? null,
          activeDocumentText: documentText,
          usages: citationAnalysis.usages,
        });
        const recommendations = recommendCitations(passage, citationAnalysis.entries, {
          citedKeys: citationKeysInText(passage),
          limit: 12,
        });
        return JSON.stringify({
          citationStyle: style,
          recommendations: recommendations.map((rec) => ({
            key: rec.key,
            citation: formatCitation(style.command, [rec.key]),
            score: rec.score,
            alreadyCited: rec.alreadyCited,
            title: rec.entry.title,
            author: rec.entry.author ?? rec.entry.editor,
            year: rec.entry.year,
            venue:
              rec.entry.journal ??
              rec.entry.booktitle ??
              rec.entry.publisher ??
              rec.entry.school ??
              rec.entry.institution,
            reasons: rec.reasons,
          })),
        });
      },
      // Edits flow through Monaco (visible + undoable); a diff-approval UI is a
      // planned follow-up, so for now we apply and rely on undo.
      requestApproval: async () => true,
    }),
    [
      projectName,
      hasVisibleProject,
      activeTextDocument,
      projectId,
      compileResult,
      compile,
      applyAgentEdit,
      tikzFigures,
      flattenProjectFiles,
      citationAnalysis,
    ],
  );

  const contextForWorkspaceTab = (tabId: string): AgentContext => {
    const target = documents.find((doc) => doc.path === tabId);
    const graphTarget = tabId === knowledgeGraphTabId && knowledgeGraphOpen;
    const textTarget = isTextDocument(target) ? target : null;
    const currentTarget = () => documentsRef.current.find((doc) => doc.path === tabId);
    const targetEditor = () => {
      const editor = editorRef.current;
      return textTarget &&
        activePathRef.current === tabId &&
        editorModelMatchesPath(editor, tabId)
        ? editor
        : null;
    };
    const read = async (path: string) => {
      if (!projectId || projectIdRef.current !== projectId)
        throw new Error(
          "The project changed. Send a new request in the current project.",
        );
      const open = documentsRef.current.find(
        (doc) =>
          normalizeRelativePath(doc.relativePath) === normalizeRelativePath(path),
      );
      return open && isTextDocument(open)
        ? open.content
        : window.latexdo.readFile(projectId, path);
    };
    const requireGraph = () => {
      if (!graphTarget || !graphOpenRef.current || projectIdRef.current !== projectId)
        throw new Error("Choose the Knowledge Graph tab in the current project first.");
      if (!aiConfig.access.currentEditor || !aiConfig.access.bibliography)
        throw new Error(
          "Current editor and Bibliography access is disabled in AI settings.",
        );
    };
    return {
      ...agentContext,
      workspaceTab: () =>
        graphTarget
          ? { id: tabId, label: "Knowledge Graph", kind: "knowledge-graph" }
          : target
            ? {
                id: tabId,
                label: target.relativePath,
                kind: textTarget ? "document" : "other",
              }
            : {
                id: tabId,
                label:
                  tabId === "workspace:welcome"
                    ? "Welcome"
                    : tabId === tikzCanvasTabId
                      ? "TikZ drawing (answer with a ```latex figure the user can insert)"
                      : toolTabKey(tabId)
                        ? toolTabLabels[toolTabKey(tabId)!]
                        : tabId === "workspace:diff"
                          ? "Git diff"
                          : "Closed or unavailable tab",
                kind: "other",
              },
      activeFilePath: () =>
        textTarget && currentTarget() ? textTarget.relativePath : null,
      documentText: () =>
        textTarget
          ? (targetEditor()?.getModel()?.getValue() ?? currentTarget()?.content ?? "")
          : "",
      selection: () => {
        const editor = targetEditor();
        const selection = editor?.getSelection();
        const text = selection
          ? (editor?.getModel()?.getValueInRange(selection) ?? "")
          : "";
        return { text, hasSelection: Boolean(text.trim()) };
      },
      readFile: read,
      applyEdit: async (proposal) => {
        if (
          proposal.kind !== "replace-file" &&
          (!targetEditor() || proposal.path !== textTarget?.relativePath)
        ) {
          throw new Error(
            "The target document is no longer active. Select it and retry the edit.",
          );
        }
        if (proposal.kind === "replace-selection") {
          const editor = targetEditor();
          const selection = editor?.getSelection();
          if (
            !selection ||
            editor?.getModel()?.getValueInRange(selection) !== proposal.oldText
          )
            throw new Error("The selection changed. Select the text again and retry.");
        }
        await applyAgentEdit(proposal);
      },
      getKnowledgeGraph: graphTarget
        ? async (offset) => {
            requireGraph();
            return JSON.stringify({
              paperPath: rootFile,
              filter: graphFilterRef.current,
              view: graphViewStateRef.current,
              totalEntries: knowledgeGraph.nodes.length,
              entries: knowledgeGraph.nodes.slice(offset, offset + 200),
              nextOffset:
                offset + 200 < knowledgeGraph.nodes.length ? offset + 200 : null,
            });
          }
        : undefined,
      filterKnowledgeGraph: graphTarget
        ? async (request) => {
            requireGraph();
            // Rebuild from the latest unsaved bibliography buffers as well as scanned files.
            const files = citationProjectFilesRef.current.map((file) => ({
              ...file,
              content:
                documentsRef.current.find((doc) => doc.relativePath === file.path)
                  ?.content ?? file.content,
            }));
            const library = analyzeCitationLibrary(files);
            let keys: string[] | null = null;
            let label = "All bibliography entries";
            let evidence: ReturnType<typeof relatedBibliography> = [];
            if (request.mode === "related") {
              if (!aiConfig.access.projectFiles)
                throw new Error(
                  "Project files access is disabled in AI settings. Enable it to match references against your paper.",
                );
              const path = request.paperPath || rootFile;
              if (!path)
                throw new Error("Choose the root paper or specify paper_path first.");
              const paper = await readPaperSources(path, read);
              evidence = relatedBibliography(paper, library.entries);
              keys = evidence.map((entry) => entry.key);
              label = `Related to ${path} (citations and metadata)`;
            } else if (request.mode === "cited") {
              keys = library.citedKeys;
              label = "Cited in project";
            } else if (request.mode === "query") {
              const query = request.query!.trim().toLowerCase();
              keys = library.entries
                .filter((entry) =>
                  [
                    entry.key,
                    entry.title,
                    entry.author,
                    entry.editor,
                    entry.year,
                    entry.journal,
                    entry.booktitle,
                    entry.abstract,
                    entry.keywords,
                  ]
                    .join(" ")
                    .toLowerCase()
                    .includes(query),
                )
                .map((entry) => entry.key);
              label = `Matching “${request.query}”`;
            } else if (request.mode === "keys") {
              keys = [
                ...new Set(
                  request
                    .keys!.split(",")
                    .map((key) => key.trim())
                    .filter(Boolean),
                ),
              ];
              const known = new Set(library.entries.map((entry) => entry.key));
              const unknown = keys.filter((key) => !known.has(key));
              if (unknown.length)
                throw new Error(
                  `Unknown bibliography keys: ${unknown.join(", ")}. Inspect the graph first.`,
                );
              label = "AI-selected entries";
            }
            requireGraph();
            graphViewStateRef.current = defaultGraphViewState;
            setGraphViewState(defaultGraphViewState);
            graphFilterRef.current = { keys, label };
            setGraphFilter({ keys, label });
            // Keep other tab choices intact; the result is waiting in the graph tab.
            return JSON.stringify({
              applied: true,
              label,
              count: keys?.length ?? library.entries.length,
              keys,
              evidence,
            });
          }
        : undefined,
    };
  };

  const applyLayoutPreset = useCallback(
    (preset: LayoutPreset) => {
      const flags = layoutPresetFlags[preset];
      setSidebarVisible(flags.sidebarVisible);
      setPreviewVisible(flags.previewVisible);
      setPanelVisible(flags.panelVisible);
      setSettings((current) => ({ ...current, minimap: flags.minimap }));
    },
    [setSettings],
  );

  const prepareActivationTutorial = useCallback(() => {
    // The tour operates on the real project. A synthetic main.tex must never
    // replace open buffers: saving/compiling it could overwrite the user's file.
    activationWorkspaceSnapshotRef.current = {
      sidebarVisible,
      activeSidebar,
      previewVisible,
      panelVisible,
      activePanel,
      latexEditorView,
    };
    setLatexEditorView("code");
    setSidebarVisible(true);
    setActiveSidebar("ai");
    setPreviewVisible(true);
    setPanelVisible(false);
    setStatusMessage("Interactive tour: use an open TeX project to try the actions.");
  }, [
    activePanel,
    activeSidebar,
    panelVisible,
    previewVisible,
    sidebarVisible,
    latexEditorView,
  ]);

  const restoreActivationWorkspace = useCallback(() => {
    const snapshot = activationWorkspaceSnapshotRef.current;
    if (!snapshot) return;
    activationWorkspaceSnapshotRef.current = null;
    setSidebarVisible(snapshot.sidebarVisible);
    setActiveSidebar(snapshot.activeSidebar);
    setPreviewVisible(snapshot.previewVisible);
    setPanelVisible(snapshot.panelVisible);
    setActivePanel(snapshot.activePanel);
    setLatexEditorView(snapshot.latexEditorView);
    setStatusMessage("You are ready to work.");
  }, []);

  return {
    ...tikzFigures,
    loadSpellCheckerSettings,
    saveSpellCheckerSettings,
    loadProofreadingSettings,
    saveProofreadingSettings,
    openSidebar,
    reformulateSelectionWithAi,
    cancelReformulation,
    askAiAboutSelection,
    insertCitationKey,
    recommendCitationsForSelection,
    planKnowledgeGraphDiscoveryWithAi,
    agentContext,
    contextForWorkspaceTab,
    applyLayoutPreset,
    prepareActivationTutorial,
    restoreActivationWorkspace,
  };
}
