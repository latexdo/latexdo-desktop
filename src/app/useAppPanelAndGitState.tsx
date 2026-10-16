import type * as Monaco from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type CitationSearchAnchor } from "../components/CitationSearchPopup";
import { loadPaneLayout } from "../features/layout/paneLayout";
import { productConfig } from "../productConfig";
import { appVersion } from "../appVersion";
import type { PdfClickLocation } from "../PdfPreview";
import {
  researchDocumentId,
  type ResearchDocument,
} from "../features/pdfResearch/domain/ResearchDocument";
import { buildEnterpriseComplianceReport } from "../features/enterprise/enterprise";
import type {
  CollaborationState,
  CollaboratorPermission,
  Diagnostic,
  EditorMode,
  Engine,
  GitBlameLine,
  GitDiffSession,
  OpenDocument,
  ProjectEntry,
  RebuttalItem,
  ReviewChat,
  SyncTexPdfLocation,
  UpdateAttemptResolution,
  UpdateCheckResult,
  UpdateDownloadProgress,
  WhatsNewResult,
} from "../types";
import type { ErrorDoctorResult } from "../checks/errorDoctor";
import type { MonacoCollaborationBinding } from "../collaboration/MonacoCollaborationBinding";
import { EditorMutationOrigin } from "../collaboration/editProvenance";
import {
  analyzeCitationLibrary,
  type CitationProjectFile,
} from "../latex/citationAnalysis";
import { type CitationInsertionPlan } from "../latex/citationInsertion";
import {
  buildKnowledgeGraph,
  type KnowledgeGraphParams,
} from "../features/graph/knowledgeGraph";
import {
  knowledgeGraphTabId,
  defaultGraphViewState,
  type GraphViewFilter,
} from "../features/graph/graphWorkspace";
import { isToolTab } from "../features/workspace/toolTabs";
import { type LatexDoExtensionSnippet } from "../extensions";
import type { CitationEntry } from "../latex/latexIndex";
import { extractLatexOutline } from "../latex/editorFeatureSupport";
import { type MonacoNextEditAdapter } from "../features/editor/nextEdit/monacoNextEditAdapter";
import { createLatexDoCommandService } from "../features/commands/commandExecutor";
import type { LatexDoCommandContext } from "../features/commands/commandTypes";
import {
  bookmarkKey,
  buildAutoCompileSignature,
  defaultSettings,
  loadBookmarkStore,
  loadCollaborationDisplayName,
  loadKnowledgeGraphParams,
  storeKnowledgeGraphParams,
  normalizeBookmarkLines,
  type AppSettings,
  type BookmarkStore,
} from "../features/settings/settings";
import { useGit } from "../features/git/useGit";
import {
  createPathInDirectory,
  fileName,
  flattenEntries,
  languageFor,
  normalizeRelativePath,
} from "../features/project/projectUtils";
import { useCompile } from "../features/compile/useCompile";
import { useProofreading } from "../features/proofreading/useProofreading";
import {
  PanelKind,
  PendingSourceLocation,
  compilerSetupIssue,
  editorModelMatchesPath,
  isTextDocument,
} from "./appShared";
import type { AppCtx01 } from "./appContext";

export function useAppPanelAndGitState(ctx: AppCtx01) {
  const {
    activeDocument,
    activePath,
    activeResearchSpace,
    citationProjectFiles,
    documents,
    engine,
    enterpriseState,
    hideProjectEntries,
    initialWorkspaceFlags,
    installedExtensionSnippets,
    previewVisible,
    projectDisplayName,
    projectEntries,
    projectId,
    projectPath,
    rootFile,
    setActivePath,
    setEngine,
    setSettings,
    setStatusMessage,
    settings,
    welcomeOpen,
  } = ctx;

  const {
    pdfComplianceDiagnostics,
    setPdfComplianceDiagnostics,
    compileResult,
    setCompileResult,
    setCompileJobCount,
    compileProgress,
    setCompileProgress,
    compiling,
  } = useCompile();
  const [panelVisible, setPanelVisible] = useState(
    () => initialWorkspaceFlags.panelVisible,
  );
  const [activePanel, setActivePanel] = useState<PanelKind>("problems");
  const [terminalStarted, setTerminalStarted] = useState(false);
  const [panelHeight, setPanelHeight] = useState(200);
  const {
    gitStatus,
    setGitStatus,
    gitLoading,
    setGitLoading,
    gitCommitMessage,
    setGitCommitMessage,
    gitActionBusy,
    setGitActionBusy,
    gitDiffSession,
    setGitDiffSession,
    gitBlameLines,
    setGitBlameLines,
    gitRepoHistory,
    setGitRepoHistory,
    setGitFileHistory,
    gitFileHistoryPath,
    setGitFileHistoryPath,
    selectedGitCommitHash,
    setSelectedGitCommitHash,
    gitCommitDetails,
    setGitCommitDetails,
    gitCommitParentHash,
    setGitCommitParentHash,
    collapsedGitGroups,
    setCollapsedGitGroups,
    gitContextMenu,
    setGitContextMenu,
    modifiedFiles,
    stagedGitEntries,
    unstagedGitEntries,
    stagedGitGroups,
    unstagedGitGroups,
    gitRepositoryCommits,
    gitFileCommits,
  } = useGit();
  const [editorBlameLines, setEditorBlameLines] = useState<GitBlameLine[]>([]);
  const [fileBlameEnabled, setFileBlameEnabled] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [updateProgress, setUpdateProgress] = useState<UpdateDownloadProgress | null>(
    null,
  );
  const [updateAttemptStatus, setUpdateAttemptStatus] =
    useState<UpdateAttemptResolution | null>(null);
  const [whatsNew, setWhatsNew] = useState<WhatsNewResult | null>(null);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatingNow, setUpdatingNow] = useState(false);
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(
    null,
  );
  const {
    spellCheckerSettings,
    setSpellCheckerSettings,
    spellCheckerLoading,
    setSpellCheckerLoading,
    spellCheckerError,
    setSpellCheckerError,
    spellCheckerWordDraft,
    setSpellCheckerWordDraft,
    spellCheckerLanguageQuery,
    setSpellCheckerLanguageQuery,
    proofreadingSettings,
    setProofreadingSettings,
    proofreadingResult,
    setProofreadingResult,
    proofreadingLoading,
    setProofreadingLoading,
    proofreadingError,
    setProofreadingError,
    filteredSpellCheckerLanguages,
  } = useProofreading();
  const [assistantDiagnostics, setAssistantDiagnostics] = useState<Diagnostic[]>([]);
  const [, setErrorDoctorResult] = useState<ErrorDoctorResult | null>(null);
  const [collaborationState, setCollaborationState] = useState<CollaborationState>({
    enabled: false,
    users: [],
  });
  const [collaborationPermissions, setCollaborationPermissions] = useState<
    CollaboratorPermission[]
  >([]);
  const [isProjectAdmin, setIsProjectAdmin] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState<"admin" | "editor" | "viewer">(
    "viewer",
  );
  const [collaborationDisplayName, setCollaborationDisplayName] = useState(
    loadCollaborationDisplayName,
  );
  const [collaborationBusy, setCollaborationBusy] = useState(false);
  const [collaborationCopied, setCollaborationCopied] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [joinTokenDraft, setJoinTokenDraft] = useState("");
  const [joinCollaborationBusy, setJoinCollaborationBusy] = useState(false);
  const [joinCollaborationError, setJoinCollaborationError] = useState("");
  const [joinWaitingMessage, setJoinWaitingMessage] = useState("");
  // Bumped to abandon a join that is still waiting for the owner's approval.
  const joinAttemptRef = useRef(0);
  const [realtimeBlockedDocuments, setRealtimeBlockedDocuments] = useState<
    Record<string, string>
  >({});
  const [realtimeReadyDocuments, setRealtimeReadyDocuments] = useState<Set<string>>(
    () => new Set(),
  );
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [pdfTarget, setPdfTarget] = useState<SyncTexPdfLocation | null>(null);
  const [lastPdfLocation, setLastPdfLocation] = useState<PdfClickLocation | null>(null);
  const [pdfScale, setPdfScale] = useState(100);
  const [pdfRotation, setPdfRotation] = useState(0);
  const [bookmarkStore, setBookmarkStore] = useState<BookmarkStore>(loadBookmarkStore);
  const [editorCursorLine, setEditorCursorLine] = useState<number | null>(null);
  const [gitPanelTab, setGitPanelTab] = useState<"changes" | "history">("changes");
  const [initialPaneLayout] = useState(loadPaneLayout);
  const [splitPercent, setSplitPercent] = useState(initialPaneLayout.splitPercent);
  const [sidebarWidths, setSidebarWidths] = useState<Record<string, number>>(
    initialPaneLayout.sidebarWidths,
  );
  const [latexEditorView, setLatexEditorView] = useState<"code" | "visual">("code");
  const [mode, setMode] = useState<EditorMode>("author");
  const [reviewChats, setReviewChats] = useState<ReviewChat[]>([]);
  const [rebuttalItems, setRebuttalItems] = useState<RebuttalItem[]>([]);
  const reviewDataReadyRef = useRef(false);
  // The review data last written to (or read from) disk, to save only real changes.
  const reviewSavedSnapshotRef = useRef("");
  const rebuttalSourceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const reviewSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const editorMouseDisposableRef = useRef<Monaco.IDisposable | null>(null);
  const editorScrollSyncDisposableRef = useRef<Monaco.IDisposable | null>(null);
  const editorActionDisposablesRef = useRef<Monaco.IDisposable[]>([]);
  const pdfSurfaceRef = useRef<HTMLDivElement | null>(null);
  const documentsRef = useRef<OpenDocument[]>([]);
  const projectEntriesRef = useRef<ProjectEntry[]>([]);
  const citationProjectFilesRef = useRef<CitationProjectFile[]>([]);
  const citationEntriesRef = useRef<CitationEntry[]>([]);
  const citationEntriesByKeyRef = useRef<Map<string, CitationEntry>>(new Map());
  const citationCitedKeysRef = useRef<Set<string>>(new Set());
  const projectIdRef = useRef("");
  const projectPathRef = useRef("");
  const hideProjectEntriesRef = useRef(true);
  const activePathRef = useRef("");
  const editorPathBeforeWelcomeRef = useRef("");
  const settingsRef = useRef(settings);
  const rootFileRef = useRef(rootFile);
  const engineRef = useRef(engine);
  const pdfPathRef = useRef("");
  const pdfDataRef = useRef<Uint8Array | null>(null);
  const pdfScaleRef = useRef(pdfScale);
  const pdfReviewInputRef = useRef<HTMLInputElement | null>(null);
  const forwardSyncRef = useRef<((position: Monaco.Position) => Promise<void>) | null>(
    null,
  );
  const citationSuggestTimerRef = useRef<number | null>(null);
  const [citationSearchAnchor, setCitationSearchAnchor] =
    useState<CitationSearchAnchor | null>(null);
  const [citationSearchFocusRequest, setCitationSearchFocusRequest] = useState(0);
  const citationSearchPopupRef = useRef<HTMLDivElement>(null);
  const editorScrollSyncTimerRef = useRef<number | null>(null);
  const pdfScrollSyncTimerRef = useRef<number | null>(null);
  const editorScrollSyncRunIdRef = useRef(0);
  const pdfScrollSyncRunIdRef = useRef(0);
  const suppressEditorScrollSyncUntilRef = useRef(0);
  const suppressPdfScrollSyncUntilRef = useRef(0);
  const lastEditorScrollSyncKeyRef = useRef("");
  const lastPdfScrollSyncKeyRef = useRef("");
  const latexDoCommandService = useMemo(() => {
    const context: LatexDoCommandContext = {
      getSettings: () => settingsRef.current,
      updateSetting: (key, value) => {
        setSettings((current) => {
          const next = { ...current, [key]: value } as AppSettings;
          settingsRef.current = next;
          return next;
        });

        if (key === "defaultEngine") {
          const nextEngine = value as Engine;
          setEngine(nextEngine);
          engineRef.current = nextEngine;
        }
      },
      resetSetting: (key) => {
        const value = defaultSettings[key];
        setSettings((current) => {
          const next = { ...current, [key]: value } as AppSettings;
          settingsRef.current = next;
          return next;
        });

        if (key === "defaultEngine") {
          setEngine(defaultSettings.defaultEngine);
          engineRef.current = defaultSettings.defaultEngine;
        }
      },
      setStatusMessage,
      getVersion: () => appVersion,
    };

    return createLatexDoCommandService(context);
  }, [setSettings]);

  useEffect(() => {
    if (latexEditorView === "visual") {
      editorRef.current = null;
    }
  }, [latexEditorView]);
  const pendingSourceRef = useRef<PendingSourceLocation | null>(null);
  const sourceSyncDecorationsRef = useRef<string[]>([]);
  const sourceSyncClearTimerRef = useRef<number | null>(null);
  const bookmarkDecorationsRef = useRef<string[]>([]);
  const backwardSyncRunIdRef = useRef(0);
  const lastAutoCompileSignatureRef = useRef("");
  const compileRunIdRef = useRef(0);
  const figurePreviewCacheRef = useRef<Map<string, string>>(new Map());
  const browserAutoOpenRef = useRef(false);
  const standalonePdfReviewActiveRef = useRef(false);
  const gitDiffSessionRef = useRef<GitDiffSession | null>(null);
  const gitDiffSessionIdRef = useRef("");
  const gitDiffReturnPathRef = useRef("");
  const gitFileHistoryPathRef = useRef("");
  const gitRefreshTimerRef = useRef<number | null>(null);
  const gitRowClickTimerRef = useRef<number | null>(null);
  const editorBlameStateRef = useRef<{
    byLine: Map<number, GitBlameLine>;
    dirty: boolean;
    inlineEnabled: boolean;
    fileBlameEnabled: boolean;
  }>({ byLine: new Map(), dirty: false, inlineEnabled: true, fileBlameEnabled: false });
  const inlineBlameDecorationsRef = useRef<string[]>([]);
  const fileBlameDecorationsRef = useRef<string[]>([]);
  const editorBlameFetchSeqRef = useRef(0);
  const editorBlameDisposablesRef = useRef<Monaco.IDisposable[]>([]);
  const blameHoverDisposablesRef = useRef<Monaco.IDisposable[]>([]);
  const collaborationBindingRef = useRef<MonacoCollaborationBinding | null>(null);
  const collaborationBindingRequestIdRef = useRef(0);
  const nextEditAdapterRef = useRef<MonacoNextEditAdapter | null>(null);
  const editorMutationOriginRef = useRef(new EditorMutationOrigin());
  const realtimeBlockedDocumentsRef = useRef<Record<string, string>>({});
  const realtimeReadyDocumentsRef = useRef<Set<string>>(new Set());
  const scheduleGitRefreshRef = useRef<() => void>(() => {});
  const installedExtensionSnippetsRef = useRef<LatexDoExtensionSnippet[]>([]);
  const runtime = (window.latexdo as typeof window.latexdo & { runtime?: string })
    .runtime;
  const collaborationAvailable = runtime === "cloud" || runtime === "desktop";

  const activeTextDocument = isTextDocument(activeDocument) ? activeDocument : null;
  const activeDocumentIsAssetPreview = activeDocument?.kind === "asset";
  const activeResearchDocument = useMemo<ResearchDocument | null>(() => {
    if (
      !activeDocument ||
      activeDocument.kind !== "asset" ||
      activeDocument.assetMimeType !== "application/pdf"
    ) {
      return null;
    }
    const title = fileName(activeDocument.relativePath).replace(/\.pdf$/i, "");
    return {
      id: researchDocumentId(projectId || projectPath, activeDocument.path),
      projectId: projectId || undefined,
      name: activeDocument.name,
      source: {
        type: projectId ? "project-file" : "uploaded",
        fileId: activeDocument.path,
        relativePath: activeDocument.relativePath,
      },
      metadata: {
        title,
      },
      processing: {
        status: "rendering",
        message:
          "Rendering PDF now; text extraction and AI context resolve as you read.",
      },
      permissions: {
        canAnnotate: true,
        canExport: true,
      },
    };
  }, [activeDocument, projectId, projectPath]);
  const activeDocumentIsLatex = activeTextDocument
    ? languageFor(activeTextDocument.name) === "latex"
    : false;
  const activeDocumentIsAsymptote = activeTextDocument
    ? languageFor(activeTextDocument.name) === "asymptote"
    : false;
  const activeBookmarkKey = activeTextDocument
    ? bookmarkKey(projectPath || projectId, activeTextDocument.relativePath)
    : "";
  const activeBookmarkLines = useMemo(
    () =>
      normalizeBookmarkLines(activeBookmarkKey ? bookmarkStore[activeBookmarkKey] : []),
    [activeBookmarkKey, bookmarkStore],
  );
  const currentLineHasBookmark =
    editorCursorLine !== null && activeBookmarkLines.includes(editorCursorLine);
  const activeCollaborationReadOnlyMessage =
    activeTextDocument && collaborationState.enabled && collaborationState.token
      ? currentUserRole === "viewer"
        ? "Viewer access: this shared document is read-only."
        : realtimeBlockedDocuments[activeTextDocument.relativePath]
          ? realtimeBlockedDocuments[activeTextDocument.relativePath]
          : !realtimeReadyDocuments.has(activeTextDocument.relativePath)
            ? "Connecting securely before editing is enabled."
            : ""
      : "";
  const documentOutline = useMemo(
    () =>
      activeTextDocument && activeDocumentIsLatex
        ? extractLatexOutline(activeTextDocument.content)
        : [],
    [activeDocumentIsLatex, activeTextDocument],
  );
  const hasVisibleProject = Boolean(projectId) && !hideProjectEntries;
  const showWelcome = welcomeOpen && !activePath;
  const showBlankWorkspace = hideProjectEntries && !welcomeOpen && !activePath;
  const knowledgeGraphActive = activePath === knowledgeGraphTabId;
  const toolTabActive = isToolTab(activePath);
  const showEmptyEditor =
    !showWelcome &&
    !activeDocument &&
    !gitDiffSession &&
    !knowledgeGraphActive &&
    !toolTabActive;
  const previewShown =
    previewVisible &&
    !showWelcome &&
    !showBlankWorkspace &&
    !gitDiffSession &&
    !knowledgeGraphActive &&
    !toolTabActive;
  const projectName = hasVisibleProject
    ? projectDisplayName || fileName(projectPath) || "Project"
    : "No Folder";
  const defaultCreateRelativePath = useCallback(
    (type: "file" | "folder") => {
      const baseName = type === "file" ? "chapter.tex" : "chapters";
      if (!activeResearchSpace || hideProjectEntries) {
        return baseName;
      }
      const root =
        activeResearchSpace.folders.find((folder) => folder.kind === "paper") ??
        activeResearchSpace.folders[0];
      return root ? createPathInDirectory(root.name, baseName) : baseName;
    },
    [activeResearchSpace, hideProjectEntries],
  );
  const exportEnterpriseReport = useCallback(() => {
    const report = buildEnterpriseComplianceReport(enterpriseState, {
      projectName,
      activeDocumentPath: activeTextDocument?.relativePath,
    });
    const blob = new Blob([report.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const downloadName = productConfig.shortName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    link.href = url;
    link.download = `${downloadName || "latexdo-pro"}-enterprise-compliance.md`;
    link.click();
    URL.revokeObjectURL(url);
    setStatusMessage("Enterprise compliance report exported");
  }, [activeTextDocument?.relativePath, enterpriseState, projectName]);
  const activeCollaborators = collaborationState.users;
  const collaboratorCount = activeCollaborators.length;
  const shareButtonLabel = collaborationBusy
    ? "Sharing..."
    : collaborationCopied
      ? "Copied"
      : collaborationState.enabled
        ? `${Math.max(collaboratorCount, 1)} live`
        : "Share";
  const shareButtonTitle = collaborationState.enabled
    ? "Open sharing"
    : projectId
      ? "Share project"
      : "Join shared project";
  const shareButtonDisabled = collaborationBusy || joinCollaborationBusy;
  // One list for everything the app found. Error Doctor re-reads the same
  // compiler log as compileResult (with less precise locations), so its
  // findings would only duplicate compiler errors here.
  const diagnostics = useMemo(
    () => [
      ...(compileResult?.diagnostics ?? []),
      ...(proofreadingResult?.diagnostics ?? []),
      ...assistantDiagnostics,
      ...pdfComplianceDiagnostics,
    ],
    [
      compileResult?.diagnostics,
      proofreadingResult?.diagnostics,
      assistantDiagnostics,
      pdfComplianceDiagnostics,
    ],
  );
  const errors = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  const warnings = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "warning",
  ).length;
  const primaryDiagnostic = useMemo(
    () =>
      compileResult?.diagnostics.find((diagnostic) => diagnostic.isPrimary) ??
      compileResult?.diagnostics.find(
        (diagnostic) => diagnostic.severity === "error",
      ) ??
      null,
    [compileResult?.diagnostics],
  );
  const activeCompilerSetupIssue = useMemo(
    () => compilerSetupIssue(compileResult),
    [compileResult],
  );
  const cascadingErrors = useMemo(
    () =>
      compileResult?.diagnostics.filter((diagnostic) => diagnostic.isCascade).length ??
      0,
    [compileResult?.diagnostics],
  );
  const texFiles = useMemo(
    () =>
      flattenEntries(projectEntries).filter(
        (entry) => entry.type === "file" && entry.name.endsWith(".tex"),
      ),
    [projectEntries],
  );
  const allProjectEntries = useMemo(
    () => flattenEntries(projectEntries),
    [projectEntries],
  );
  const citationAnalysis = useMemo(
    () => analyzeCitationLibrary(citationProjectFiles),
    [citationProjectFiles],
  );
  const [knowledgeGraphParams, setKnowledgeGraphParams] =
    useState<KnowledgeGraphParams>(loadKnowledgeGraphParams);
  const knowledgeGraph = useMemo(
    () =>
      buildKnowledgeGraph(
        citationAnalysis.entries,
        citationAnalysis.citedKeys,
        knowledgeGraphParams,
      ),
    [citationAnalysis, knowledgeGraphParams],
  );
  const citationEntriesByKey = useMemo(
    () => new Map(citationAnalysis.entries.map((entry) => [entry.key, entry])),
    [citationAnalysis],
  );
  const citationCitedKeySet = useMemo(
    () => new Set(citationAnalysis.citedKeys),
    [citationAnalysis.citedKeys],
  );
  useEffect(() => {
    citationProjectFilesRef.current = citationProjectFiles;
  }, [citationProjectFiles]);
  useEffect(() => {
    citationEntriesRef.current = citationAnalysis.entries;
  }, [citationAnalysis.entries]);
  useEffect(() => {
    citationEntriesByKeyRef.current = citationEntriesByKey;
  }, [citationEntriesByKey]);
  useEffect(() => {
    citationCitedKeysRef.current = new Set(citationAnalysis.citedKeys);
  }, [citationAnalysis.citedKeys]);
  const [knowledgeGraphOpen, setKnowledgeGraphOpen] = useState(false);
  const [graphFilter, setGraphFilter] = useState<GraphViewFilter>({
    keys: null,
    label: "All bibliography entries",
  });
  const [graphViewState, setGraphViewState] = useState(defaultGraphViewState);
  const graphViewStateRef = useRef(graphViewState);
  useEffect(() => {
    graphViewStateRef.current = graphViewState;
  }, [graphViewState]);
  const [aiTabTargets, setAiTabTargets] = useState<Record<string, string>>({});
  const pendingGraphCitationRef = useRef<{
    path: string;
    content: string;
    key: string;
    plan: CitationInsertionPlan;
  } | null>(null);
  const graphReturnPathRef = useRef("");
  const graphOpenRef = useRef(false);
  const graphFilterRef = useRef(graphFilter);
  useEffect(() => {
    graphFilterRef.current = graphFilter;
  }, [graphFilter]);
  const graphSourceRef = useRef<{
    path: string;
    content: string;
    offset: number;
    selection: string;
  } | null>(null);
  const openKnowledgeGraph = () => {
    if (activePath && activePath !== knowledgeGraphTabId)
      graphReturnPathRef.current = activePath;
    const editor = editorRef.current;
    const model = editor?.getModel();
    const position = editor?.getPosition();
    if (
      activeTextDocument?.name.endsWith(".tex") &&
      model &&
      position &&
      editorModelMatchesPath(editor, activePath)
    ) {
      const selection = editor?.getSelection();
      graphSourceRef.current = {
        path: activePath,
        content: model.getValue(),
        offset: model.getOffsetAt(position),
        selection: selection ? model.getValueInRange(selection) : "",
      };
    }
    graphOpenRef.current = true;
    setKnowledgeGraphOpen(true);
    setActivePath(knowledgeGraphTabId);
    activePathRef.current = knowledgeGraphTabId;
  };
  const closeKnowledgeGraph = () => {
    graphOpenRef.current = false;
    setKnowledgeGraphOpen(false);
    if (knowledgeGraphActive) {
      const next =
        documents.find((doc) => doc.path === graphReturnPathRef.current)?.path ??
        documents[0]?.path ??
        "";
      setActivePath(next);
      activePathRef.current = next;
    }
  };
  useEffect(() => {
    graphOpenRef.current = false;
    graphSourceRef.current = null;
    pendingGraphCitationRef.current = null;
    setGraphViewState(defaultGraphViewState);
    setKnowledgeGraphOpen(false);
    setGraphFilter({ keys: null, label: "All bibliography entries" });
    setAiTabTargets({});
  }, [projectId]);
  useEffect(() => {
    storeKnowledgeGraphParams(knowledgeGraphParams);
  }, [knowledgeGraphParams]);
  const rootFileExists = useMemo(
    () =>
      hasVisibleProject &&
      allProjectEntries.some(
        (entry) =>
          entry.type === "file" &&
          normalizeRelativePath(entry.relativePath) === normalizeRelativePath(rootFile),
      ),
    [allProjectEntries, hasVisibleProject, rootFile],
  );
  const autoCompileSignature = useMemo(
    () => buildAutoCompileSignature(documents, projectId, rootFile, engine),
    [documents, engine, projectId, rootFile],
  );

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    installedExtensionSnippetsRef.current = installedExtensionSnippets;
  }, [installedExtensionSnippets]);

  useEffect(() => {
    projectEntriesRef.current = projectEntries;
  }, [projectEntries]);

  useEffect(() => {
    pdfDataRef.current = pdfData;
    lastEditorScrollSyncKeyRef.current = "";
    lastPdfScrollSyncKeyRef.current = "";
  }, [pdfData]);

  useEffect(() => {
    pdfScaleRef.current = pdfScale;
  }, [pdfScale]);

  return {
    pdfComplianceDiagnostics,
    setPdfComplianceDiagnostics,
    compileResult,
    setCompileResult,
    setCompileJobCount,
    compileProgress,
    setCompileProgress,
    compiling,
    panelVisible,
    setPanelVisible,
    activePanel,
    setActivePanel,
    terminalStarted,
    setTerminalStarted,
    panelHeight,
    setPanelHeight,
    gitStatus,
    setGitStatus,
    gitLoading,
    setGitLoading,
    gitCommitMessage,
    setGitCommitMessage,
    gitActionBusy,
    setGitActionBusy,
    gitDiffSession,
    setGitDiffSession,
    gitBlameLines,
    setGitBlameLines,
    gitRepoHistory,
    setGitRepoHistory,
    setGitFileHistory,
    gitFileHistoryPath,
    setGitFileHistoryPath,
    selectedGitCommitHash,
    setSelectedGitCommitHash,
    gitCommitDetails,
    setGitCommitDetails,
    gitCommitParentHash,
    setGitCommitParentHash,
    collapsedGitGroups,
    setCollapsedGitGroups,
    gitContextMenu,
    setGitContextMenu,
    modifiedFiles,
    stagedGitEntries,
    unstagedGitEntries,
    stagedGitGroups,
    unstagedGitGroups,
    gitRepositoryCommits,
    gitFileCommits,
    editorBlameLines,
    setEditorBlameLines,
    fileBlameEnabled,
    setFileBlameEnabled,
    updateInfo,
    setUpdateInfo,
    updateProgress,
    setUpdateProgress,
    updateAttemptStatus,
    setUpdateAttemptStatus,
    whatsNew,
    setWhatsNew,
    whatsNewOpen,
    setWhatsNewOpen,
    checkingUpdates,
    setCheckingUpdates,
    updatingNow,
    setUpdatingNow,
    dismissedUpdateVersion,
    setDismissedUpdateVersion,
    spellCheckerSettings,
    setSpellCheckerSettings,
    spellCheckerLoading,
    setSpellCheckerLoading,
    spellCheckerError,
    setSpellCheckerError,
    spellCheckerWordDraft,
    setSpellCheckerWordDraft,
    spellCheckerLanguageQuery,
    setSpellCheckerLanguageQuery,
    proofreadingSettings,
    setProofreadingSettings,
    proofreadingResult,
    setProofreadingResult,
    proofreadingLoading,
    setProofreadingLoading,
    proofreadingError,
    setProofreadingError,
    filteredSpellCheckerLanguages,
    assistantDiagnostics,
    setAssistantDiagnostics,
    setErrorDoctorResult,
    collaborationState,
    setCollaborationState,
    collaborationPermissions,
    setCollaborationPermissions,
    isProjectAdmin,
    setIsProjectAdmin,
    currentUserRole,
    setCurrentUserRole,
    collaborationDisplayName,
    setCollaborationDisplayName,
    collaborationBusy,
    setCollaborationBusy,
    collaborationCopied,
    setCollaborationCopied,
    shareDialogOpen,
    setShareDialogOpen,
    joinTokenDraft,
    setJoinTokenDraft,
    joinCollaborationBusy,
    setJoinCollaborationBusy,
    joinCollaborationError,
    setJoinCollaborationError,
    joinWaitingMessage,
    setJoinWaitingMessage,
    joinAttemptRef,
    setRealtimeBlockedDocuments,
    setRealtimeReadyDocuments,
    pdfData,
    setPdfData,
    pdfTarget,
    setPdfTarget,
    lastPdfLocation,
    setLastPdfLocation,
    pdfScale,
    setPdfScale,
    pdfRotation,
    setPdfRotation,
    bookmarkStore,
    setBookmarkStore,
    setEditorCursorLine,
    gitPanelTab,
    setGitPanelTab,
    splitPercent,
    setSplitPercent,
    sidebarWidths,
    setSidebarWidths,
    latexEditorView,
    setLatexEditorView,
    mode,
    setMode,
    reviewChats,
    setReviewChats,
    rebuttalItems,
    setRebuttalItems,
    reviewDataReadyRef,
    reviewSavedSnapshotRef,
    rebuttalSourceQueueRef,
    reviewSaveQueueRef,
    editorRef,
    editorMouseDisposableRef,
    editorScrollSyncDisposableRef,
    editorActionDisposablesRef,
    pdfSurfaceRef,
    documentsRef,
    projectEntriesRef,
    citationProjectFilesRef,
    citationEntriesRef,
    citationEntriesByKeyRef,
    citationCitedKeysRef,
    projectIdRef,
    projectPathRef,
    hideProjectEntriesRef,
    activePathRef,
    editorPathBeforeWelcomeRef,
    settingsRef,
    rootFileRef,
    engineRef,
    pdfPathRef,
    pdfDataRef,
    pdfScaleRef,
    pdfReviewInputRef,
    forwardSyncRef,
    citationSuggestTimerRef,
    citationSearchAnchor,
    setCitationSearchAnchor,
    citationSearchFocusRequest,
    setCitationSearchFocusRequest,
    citationSearchPopupRef,
    editorScrollSyncTimerRef,
    pdfScrollSyncTimerRef,
    editorScrollSyncRunIdRef,
    pdfScrollSyncRunIdRef,
    suppressEditorScrollSyncUntilRef,
    suppressPdfScrollSyncUntilRef,
    lastEditorScrollSyncKeyRef,
    lastPdfScrollSyncKeyRef,
    latexDoCommandService,
    pendingSourceRef,
    sourceSyncDecorationsRef,
    sourceSyncClearTimerRef,
    bookmarkDecorationsRef,
    backwardSyncRunIdRef,
    lastAutoCompileSignatureRef,
    compileRunIdRef,
    figurePreviewCacheRef,
    browserAutoOpenRef,
    standalonePdfReviewActiveRef,
    gitDiffSessionRef,
    gitDiffSessionIdRef,
    gitDiffReturnPathRef,
    gitFileHistoryPathRef,
    gitRefreshTimerRef,
    gitRowClickTimerRef,
    editorBlameStateRef,
    inlineBlameDecorationsRef,
    fileBlameDecorationsRef,
    editorBlameFetchSeqRef,
    editorBlameDisposablesRef,
    blameHoverDisposablesRef,
    collaborationBindingRef,
    collaborationBindingRequestIdRef,
    nextEditAdapterRef,
    editorMutationOriginRef,
    realtimeBlockedDocumentsRef,
    realtimeReadyDocumentsRef,
    scheduleGitRefreshRef,
    installedExtensionSnippetsRef,
    collaborationAvailable,
    activeTextDocument,
    activeDocumentIsAssetPreview,
    activeResearchDocument,
    activeDocumentIsLatex,
    activeDocumentIsAsymptote,
    activeBookmarkKey,
    activeBookmarkLines,
    currentLineHasBookmark,
    activeCollaborationReadOnlyMessage,
    documentOutline,
    hasVisibleProject,
    showWelcome,
    showBlankWorkspace,
    knowledgeGraphActive,
    toolTabActive,
    showEmptyEditor,
    previewShown,
    projectName,
    defaultCreateRelativePath,
    exportEnterpriseReport,
    shareButtonLabel,
    shareButtonTitle,
    shareButtonDisabled,
    diagnostics,
    errors,
    warnings,
    primaryDiagnostic,
    activeCompilerSetupIssue,
    cascadingErrors,
    texFiles,
    allProjectEntries,
    citationAnalysis,
    knowledgeGraphParams,
    setKnowledgeGraphParams,
    knowledgeGraph,
    citationEntriesByKey,
    citationCitedKeySet,
    knowledgeGraphOpen,
    graphFilter,
    setGraphFilter,
    graphViewState,
    setGraphViewState,
    graphViewStateRef,
    aiTabTargets,
    setAiTabTargets,
    pendingGraphCitationRef,
    graphOpenRef,
    graphFilterRef,
    graphSourceRef,
    openKnowledgeGraph,
    closeKnowledgeGraph,
    rootFileExists,
    autoCompileSignature,
  };
}
