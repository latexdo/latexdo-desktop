import {
  BookOpenText,
  Box,
  FilePlus2,
  Lock,
  MessageCircle,
  MessageSquare,
  Play,
  Sigma,
  Waypoints,
  Table2,
} from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { isAlwaysOnCollaborationServer } from "../collaboration/collaborationApi";
import { productConfig } from "../productConfig";
import type {
  ImportedProjectEntry,
  OpenProject,
  OpenDocument,
  ProjectEntry,
} from "../types";
import { pathForDisplay } from "../pathDisplay";
import { figureBytesToDataUrl } from "../figurePreview";
import {
  storeCollaborationDisplayName,
  type WelcomeTemplate,
} from "../features/settings/settings";
import {
  createPathInDirectory,
  fileName,
  flattenEntries,
  isImagePath,
  latexFigureCode,
  latexReferenceForProjectFile,
  normalizeRelativePath,
} from "../features/project/projectUtils";
import {
  collaborationProjectReconciliationMs,
  pdfImportStatsSummary,
} from "./appShared";
import type { AppCtx09 } from "./appContext";

export function useAppProjectCreation(ctx: AppCtx09) {
  const {
    projectEntriesRef,
    activeDocumentIsLatex,
    activePath,
    activePathRef,
    collaborationAvailable,
    collaborationState,
    createDialog,
    createPath,
    defaultCreateRelativePath,
    documentsRef,
    editorPathBeforeWelcomeRef,
    editorRef,
    hideProjectEntries,
    hideProjectEntriesRef,
    hostingAvailable,
    insertLatexBlockAtEditorPosition,
    loadCollaborationPermissions,
    loadProject,
    openDocument,
    paperReviewImporting,
    pdfReviewInputRef,
    projectId,
    projectIdRef,
    refreshCollaborationState,
    refreshProject,
    requireLegalAcceptance,
    rootFileRef,
    setActivePath,
    setCollaborationDisplayName,
    setCollaborationState,
    setCreateDialog,
    setCreateError,
    setCreatePath,
    setCreating,
    setCurrentUserRole,
    setDocuments,
    setDocxImporting,
    setIsProjectAdmin,
    setMarkdownImporting,
    setMode,
    setPaperReviewImporting,
    setPdfImporting,
    setPreviewVisible,
    setRootFile,
    setStatusMessage,
    setTemplateCreating,
    setWelcomeOpen,
    standalonePdfReviewActiveRef,
    templateCreating,
  } = ctx;

  const handleUpdatePermission = useCallback(
    async (update: { clientId: string; role: "admin" | "editor" | "viewer" }) => {
      const currentProject = projectIdRef.current;
      if (!currentProject || !collaborationAvailable) return;

      try {
        await window.latexdo.updateCollaborationPermission(currentProject, update);
        await loadCollaborationPermissions(currentProject);
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Failed to update permission",
        );
      }
    },
    [collaborationAvailable, loadCollaborationPermissions],
  );

  const handleRemoveCollaborator = useCallback(
    async (clientId: string) => {
      const currentProject = projectIdRef.current;
      if (!currentProject || !collaborationAvailable) return;

      try {
        await window.latexdo.removeCollaborator(currentProject, clientId);
        await loadCollaborationPermissions(currentProject);
        // Removing someone retires the invite they hold; show the new one.
        await refreshCollaborationState(currentProject);
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Failed to remove collaborator",
        );
      }
    },
    [collaborationAvailable, loadCollaborationPermissions, refreshCollaborationState],
  );

  const handleCollaborationDisplayNameChange = useCallback((value: string) => {
    const nextName = storeCollaborationDisplayName(value);
    setCollaborationDisplayName(nextName);
  }, []);

  const createProject = async () => {
    try {
      const project = await window.latexdo.createProject();
      if (project) {
        await loadProject(project, true, false);
        setStatusMessage("Project created");
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Could not create project",
      );
    }
  };

  const createResearchSpace = async () => {
    if (requireLegalAcceptance()) {
      return;
    }
    try {
      setStatusMessage("Creating Research Space...");
      const project = await window.latexdo.createResearchSpace();
      if (project) {
        await loadProject(project, true, false);
        setStatusMessage("Research Space ready");
      } else {
        setStatusMessage(`Welcome to ${productConfig.shortName}`);
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Could not create Research Space",
      );
    }
  };

  const createProjectFromTemplate = async (template: WelcomeTemplate) => {
    if (templateCreating) return;

    setTemplateCreating(template.id);
    setStatusMessage(`Creating ${template.name} project...`);
    try {
      const project = await window.latexdo.createProject({
        folderName: template.name,
      });
      if (!project) {
        return;
      }

      await window.latexdo.writeFile(project.id, "main.tex", template.mainTex);
      if (template.bibTex) {
        await window.latexdo.writeFile(project.id, "references.bib", template.bibTex);
      }

      await loadProject(project, true, false);
      setStatusMessage(`${template.name} project created`);
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : `Could not create ${template.name} project`,
      );
    } finally {
      setTemplateCreating(null);
    }
  };

  useEffect(() => {
    if (!projectId || hideProjectEntries) {
      setCollaborationState({ enabled: false, users: [] });
      return;
    }

    void refreshCollaborationState(projectId);
  }, [hideProjectEntries, projectId, refreshCollaborationState]);

  // Someone added, moved or deleted a shared file: show the new tree. The
  // server's revision arrives live (open documents) and with presence pings.
  const seenRevision = useRef<{ projectId: string | null; revision: number | null }>({
    projectId: null,
    revision: null,
  });
  useEffect(() => {
    const revision = collaborationState.revision;
    if (!projectId || typeof revision !== "number") return;
    const seen = seenRevision.current;
    const changed = seen.projectId === projectId && seen.revision !== revision;
    seenRevision.current = { projectId, revision };
    if (changed) void refreshProject(projectId).catch(() => undefined);
  }, [collaborationState.revision, projectId, refreshProject]);

  useEffect(() => {
    if (!hostingAvailable) return;
    // The internet link comes up (or drops) in the background.
    return window.latexdo.onHostSharingChanged((status) => {
      setCollaborationState((current) =>
        current.hosted ? { ...current, host: status } : current,
      );
      if (status.phase !== "starting") {
        void refreshCollaborationState();
      }
    });
  }, [hostingAvailable, refreshCollaborationState]);

  useEffect(() => {
    if (
      !projectId ||
      !collaborationAvailable ||
      !collaborationState.enabled ||
      hideProjectEntries
    ) {
      return;
    }

    let cancelled = false;
    const sendPresence = async () => {
      try {
        const active = documentsRef.current.find(
          (document) => document.path === activePathRef.current,
        );
        const state = await window.latexdo.updateCollaborationPresence(
          projectId,
          active?.relativePath ?? null,
        );
        if (!cancelled) {
          setCollaborationState(state);
          if (state.currentUserRole) {
            setCurrentUserRole(state.currentUserRole);
          }
          if (typeof state.isAdmin === "boolean") {
            setIsProjectAdmin(state.isAdmin);
          }
        }
      } catch {
        // Presence is opportunistic; editing should keep working offline.
      }
    };

    void sendPresence();
    // Open documents carry presence live; the always-on server is pinged less
    // often so a free account's daily allowance goes further.
    const interval = window.setInterval(
      () => void sendPresence(),
      isAlwaysOnCollaborationServer(collaborationState.apiBaseUrl) ? 30_000 : 8000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    activePath,
    collaborationAvailable,
    collaborationState.apiBaseUrl,
    collaborationState.enabled,
    hideProjectEntries,
    projectId,
  ]);

  useEffect(() => {
    if (
      !projectId ||
      !collaborationAvailable ||
      !collaborationState.enabled ||
      hideProjectEntries
    ) {
      return;
    }

    let cancelled = false;
    let requestInFlight = false;
    const reconcileProjectTree = async () => {
      if (requestInFlight || document.visibilityState === "hidden") {
        return;
      }
      requestInFlight = true;
      try {
        await refreshProject(projectId);
      } catch {
        // Reconciliation is opportunistic; Yjs remains the live document channel.
      } finally {
        if (!cancelled) {
          requestInFlight = false;
        }
      }
    };

    const reconcileWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void reconcileProjectTree();
      }
    };
    const interval = window.setInterval(
      () => void reconcileProjectTree(),
      collaborationProjectReconciliationMs,
    );
    window.addEventListener("focus", reconcileWhenVisible);
    document.addEventListener("visibilitychange", reconcileWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", reconcileWhenVisible);
      document.removeEventListener("visibilitychange", reconcileWhenVisible);
    };
  }, [
    collaborationAvailable,
    collaborationState.enabled,
    hideProjectEntries,
    projectId,
    refreshProject,
  ]);

  const renderTemplateIcon = (template: WelcomeTemplate) => {
    switch (template.id) {
      case "beamer":
        return <Play size={17} />;
      case "board-report":
        return <Table2 size={17} />;
      case "business-proposal":
        return <Waypoints size={17} />;
      case "policy-document":
        return <Lock size={17} />;
      case "technical-brief":
        return <Box size={17} />;
      case "letter":
        return <MessageCircle size={17} />;
      case "research":
        return <BookOpenText size={17} />;
      case "notes":
        return <Sigma size={17} />;
      case "response":
        return <MessageSquare size={17} />;
      case "article":
      default:
        return <FilePlus2 size={17} />;
    }
  };

  const openCreateDialog = (type: "file" | "folder") => {
    if (!projectId || hideProjectEntries) {
      setStatusMessage("Create or open a project before adding files.");
      return;
    }
    setCreatePath(defaultCreateRelativePath(type));
    setCreateError("");
    setCreateDialog(type);
  };

  const openCreateDialogInDirectory = useCallback(
    (type: "file" | "folder", entry: ProjectEntry) => {
      if (entry.type !== "directory") {
        return;
      }
      setCreatePath(
        createPathInDirectory(
          entry.relativePath,
          type === "file" ? "chapter.tex" : "chapters",
        ),
      );
      setCreateError("");
      setCreateDialog(type);
    },
    [],
  );

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const relativePath = createPath.trim();
    if (!projectId || !createDialog || !relativePath) {
      setCreateError("Enter a name or path.");
      return;
    }

    setCreating(true);
    setCreateError("");
    try {
      if (createDialog === "file") {
        const createdPath = await window.latexdo.createFile(projectId, relativePath);
        const entries = await refreshProject(projectId);
        const entry = flattenEntries(entries).find(
          (item) =>
            normalizeRelativePath(item.relativePath) ===
            normalizeRelativePath(createdPath),
        );
        if (!entry) {
          throw new Error("The file was created but could not be opened.");
        }
        await openDocument(entry);
        setStatusMessage(`Created ${pathForDisplay(relativePath)}`);
      } else {
        await window.latexdo.createFolder(projectId, relativePath);
        await refreshProject(projectId);
        setStatusMessage(`Created folder ${pathForDisplay(relativePath)}`);
      }
      setCreateDialog(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Could not create ${createDialog}`;
      setCreateError(message.replace(/^Error invoking remote method '[^']+': /, ""));
    } finally {
      setCreating(false);
    }
  };

  const importExternalFilePaths = useCallback(
    async (
      sourcePaths: string[],
      destinationDirectory: string,
    ): Promise<ImportedProjectEntry[]> => {
      const currentProject = projectIdRef.current;
      const uniquePaths = [...new Set(sourcePaths.filter(Boolean))];
      if (!currentProject) {
        setStatusMessage("Open a project before importing files.");
        return [];
      }
      if (uniquePaths.length === 0) {
        setStatusMessage("File drop import is available in the desktop app.");
        return [];
      }

      try {
        const imported = await window.latexdo.importExternalFiles(
          currentProject,
          destinationDirectory,
          uniquePaths,
        );
        await refreshProject(currentProject);
        setStatusMessage(
          imported.length === 1
            ? `Imported ${pathForDisplay(imported[0].relativePath)}`
            : `Imported ${imported.length} items`,
        );
        return imported;
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Could not import dropped files.",
        );
        return [];
      }
    },
    [refreshProject],
  );

  const importExternalFiles = useCallback(
    async (files: File[], destination: ProjectEntry | null) => {
      const sourcePaths = window.latexdo.getDroppedFilePaths(files);
      const destinationDirectory = normalizeRelativePath(
        destination?.relativePath ?? "",
      ).replace(/\/+$/, "");
      await importExternalFilePaths(sourcePaths, destinationDirectory);
    },
    [importExternalFilePaths],
  );

  const chooseImportFiles = useCallback(
    async (destination: ProjectEntry | null) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) {
        setStatusMessage("Open a project before importing files.");
        return;
      }

      const destinationDirectory = normalizeRelativePath(
        destination?.relativePath ?? "",
      ).replace(/\/+$/, "");

      try {
        const imported = await window.latexdo.chooseImportExternalFiles(
          currentProject,
          destinationDirectory,
        );
        if (imported.length === 0) {
          return;
        }
        await refreshProject(currentProject);
        setStatusMessage(
          imported.length === 1
            ? `Imported ${pathForDisplay(imported[0].relativePath)}`
            : `Imported ${imported.length} items`,
        );
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Could not import files.",
        );
      }
    },
    [refreshProject],
  );

  const openPdfFileForReview = useCallback(
    async (file: File) => {
      setPaperReviewImporting(true);
      standalonePdfReviewActiveRef.current = true;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const document: OpenDocument = {
          path: `local-pdf://${encodeURIComponent(file.name)}#${Date.now()}`,
          relativePath: file.name,
          name: file.name,
          kind: "asset",
          content: "",
          savedContent: "",
          assetMimeType: "application/pdf",
          assetDataUrl: figureBytesToDataUrl(bytes, "application/pdf"),
          assetBytes: bytes,
          assetSizeBytes: bytes.byteLength,
        };
        setDocuments((current) => {
          if (current.some((item) => item.path === document.path)) {
            documentsRef.current = current;
            return current;
          }
          const nextDocuments = [...current, document];
          documentsRef.current = nextDocuments;
          return nextDocuments;
        });
        setActivePath(document.path);
        activePathRef.current = document.path;
        setWelcomeOpen(false);
        setPreviewVisible(false);
        setMode("author");
        setStatusMessage(`Reviewing ${pathForDisplay(file.name)} in Reader Mode.`);
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Could not open the selected PDF.",
        );
      } finally {
        setPaperReviewImporting(false);
      }
    },
    [setWelcomeOpen],
  );

  const reviewPaper = useCallback(() => {
    if (paperReviewImporting || requireLegalAcceptance()) {
      return;
    }

    setStatusMessage("Choose a PDF file to review in Reader Mode...");
    pdfReviewInputRef.current?.click();
  }, [paperReviewImporting, requireLegalAcceptance]);

  const insertImageReference = useCallback(
    (entry: ProjectEntry) => {
      if (!activeDocumentIsLatex) {
        setStatusMessage("Open a LaTeX file before inserting image code.");
        return;
      }
      if (!isImagePath(entry.relativePath)) {
        setStatusMessage("Choose an image file to insert LaTeX image code.");
        return;
      }
      const inserted = insertLatexBlockAtEditorPosition(
        latexFigureCode(entry.relativePath),
      );
      if (inserted) {
        setStatusMessage(
          `Inserted image code for ${pathForDisplay(entry.relativePath)}`,
        );
      }
    },
    [activeDocumentIsLatex, insertLatexBlockAtEditorPosition],
  );

  const copyRelativePath = useCallback(async (entry: ProjectEntry) => {
    try {
      await navigator.clipboard.writeText(entry.relativePath);
      setStatusMessage(`Copied ${pathForDisplay(entry.relativePath)}`);
    } catch {
      setStatusMessage("Could not copy the relative path.");
    }
  }, []);

  const openImportedTexDocument = useCallback(
    async (
      result: { relativePath: string; project?: OpenProject },
      currentProject?: string,
    ) => {
      const targetProject = result.project?.id ?? currentProject;
      if (!targetProject) {
        throw new Error("Import did not return a project.");
      }

      if (result.project && result.project.id !== currentProject) {
        await loadProject(result.project, false, false);
      }

      const entries = await refreshProject(targetProject);
      const importedEntry = flattenEntries(entries).find(
        (entry) =>
          entry.type === "file" &&
          normalizeRelativePath(entry.relativePath) ===
            normalizeRelativePath(result.relativePath),
      );

      if (!importedEntry) {
        throw new Error(
          `Imported file ${pathForDisplay(result.relativePath)} was not found.`,
        );
      }

      if (!importedEntry.name.toLowerCase().endsWith(".tex")) {
        throw new Error(
          `Imported file ${pathForDisplay(result.relativePath)} is not a TeX file.`,
        );
      }

      await openDocument(importedEntry, targetProject);
      setWelcomeOpen(false);
      setRootFile(importedEntry.relativePath);
      rootFileRef.current = importedEntry.relativePath;
    },
    [loadProject, openDocument, refreshProject],
  );

  /**
   * A file dragged from the project tree into the editor (#228): a .tex
   * document gets the matching \input, \includegraphics, \bibliography or
   * \usepackage line; anything else opens in its own tab. Ordinary text drags
   * inside the editor are left to Monaco.
   */
  const dropProjectFileInEditor = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      const dragged = event.dataTransfer.getData("text/plain");
      const entry = dragged
        ? flattenEntries(projectEntriesRef.current).find(
            (candidate) => candidate.type === "file" && candidate.path === dragged,
          )
        : undefined;
      if (!entry) return;
      event.preventDefault();
      event.stopPropagation();
      const code = activeDocumentIsLatex
        ? latexReferenceForProjectFile(entry.relativePath)
        : null;
      if (!code) {
        await openDocument(entry);
        return;
      }
      const editor = editorRef.current;
      const dropPosition =
        editor?.getTargetAtClientPoint(event.clientX, event.clientY)?.position ??
        editor?.getPosition() ??
        null;
      if (insertLatexBlockAtEditorPosition(code, dropPosition)) {
        setStatusMessage(
          `Inserted a reference to ${pathForDisplay(entry.relativePath)}`,
        );
      }
    },
    [activeDocumentIsLatex, insertLatexBlockAtEditorPosition, openDocument],
  );

  const handleEditorFileDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length === 0) {
        await dropProjectFileInEditor(event);
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (!activeDocumentIsLatex) {
        setStatusMessage("Drop images into a LaTeX file to insert image code.");
        return;
      }

      const droppedPaths = window.latexdo.getDroppedFilePaths(files);
      const sourcePaths = droppedPaths.filter(isImagePath);
      if (sourcePaths.length === 0) {
        // Other files are copied into the project and opened.
        if (!projectIdRef.current || !droppedPaths.length) {
          setStatusMessage("Open a project before dropping files into the editor.");
          return;
        }
        const imported = await importExternalFilePaths(droppedPaths, "");
        const firstFile = imported.find((entry) => entry.type === "file");
        const openable = firstFile
          ? flattenEntries(await refreshProject()).find(
              (entry) =>
                entry.type === "file" &&
                normalizeRelativePath(entry.relativePath) ===
                  normalizeRelativePath(firstFile.relativePath),
            )
          : undefined;
        if (openable) await openDocument(openable);
        return;
      }

      const currentProject = projectIdRef.current;
      if (!currentProject) {
        setStatusMessage("Open a project before importing images.");
        return;
      }

      await window.latexdo.createFolder(currentProject, "figures").catch(() => {
        // Existing folder or unavailable folder creation is handled by the import step.
      });
      const imported = await importExternalFilePaths(sourcePaths, "figures");
      const importedImages = imported.filter(
        (entry) => entry.type === "file" && isImagePath(entry.relativePath),
      );
      if (importedImages.length === 0) {
        return;
      }

      const editor = editorRef.current;
      const dropPosition =
        editor?.getTargetAtClientPoint(event.clientX, event.clientY)?.position ??
        editor?.getPosition() ??
        null;
      const code = importedImages
        .map((entry) => latexFigureCode(entry.relativePath))
        .join("\n\n");
      if (insertLatexBlockAtEditorPosition(code, dropPosition)) {
        setStatusMessage(
          importedImages.length === 1
            ? `Inserted image code for ${pathForDisplay(importedImages[0].relativePath)}`
            : `Inserted ${importedImages.length} image figures`,
        );
      }
    },
    [
      activeDocumentIsLatex,
      dropProjectFileInEditor,
      importExternalFilePaths,
      insertLatexBlockAtEditorPosition,
      openDocument,
      refreshProject,
    ],
  );

  const importDocx = useCallback(async () => {
    if (typeof window.latexdo.importDocx !== "function") {
      setStatusMessage(
        "DOCX import is not loaded in this app window. Restart the dev app and try again.",
      );
      return;
    }

    const currentProject =
      projectIdRef.current && !hideProjectEntriesRef.current
        ? projectIdRef.current
        : undefined;
    if (!currentProject) {
      setWelcomeOpen(true);
    }

    setDocxImporting(true);
    try {
      const result = await window.latexdo.importDocx(currentProject);
      if (!result) {
        return;
      }

      await openImportedTexDocument(result, currentProject);

      const converterName =
        result.converter === "pandoc" ? "Pandoc" : "built-in importer";
      const mediaSummary = result.mediaFiles.length
        ? ` with ${result.mediaFiles.length} media file${
            result.mediaFiles.length === 1 ? "" : "s"
          }`
        : "";
      const warningSummary = result.warnings.length ? ` ${result.warnings[0]}` : "";
      setStatusMessage(
        `Imported ${fileName(result.sourcePath)} to ${pathForDisplay(result.relativePath)} via ${converterName}${mediaSummary}.${warningSummary}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not import DOCX.";
      if (
        message.includes("No handler registered") ||
        message.includes("importDocx is not a function")
      ) {
        setStatusMessage("Restart the LatexDo app to finish loading DOCX import.");
        return;
      }
      setStatusMessage(message.replace(/^Error invoking remote method '[^']+': /, ""));
    } finally {
      setDocxImporting(false);
    }
  }, [openImportedTexDocument]);

  const importMarkdown = useCallback(async () => {
    if (typeof window.latexdo.importMarkdown !== "function") {
      setStatusMessage(
        "Markdown import is not loaded in this app window. Restart the dev app and try again.",
      );
      return;
    }

    const currentProject =
      projectIdRef.current && !hideProjectEntriesRef.current
        ? projectIdRef.current
        : undefined;
    if (!currentProject) {
      setWelcomeOpen(true);
    }

    setMarkdownImporting(true);
    try {
      const result = await window.latexdo.importMarkdown(currentProject);
      if (!result) return;

      await openImportedTexDocument(result, currentProject);

      const converterName =
        result.converter === "pandoc" ? "Pandoc" : "built-in converter";
      const warningSummary = result.warnings.length ? ` ${result.warnings[0]}` : "";
      setStatusMessage(
        `Imported ${fileName(result.sourcePath)} to ${pathForDisplay(result.relativePath)} via ${converterName}.${warningSummary}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not import Markdown.";
      if (
        message.includes("No handler registered") ||
        message.includes("importMarkdown is not a function")
      ) {
        setStatusMessage("Restart the LatexDo app to finish loading Markdown import.");
        return;
      }
      setStatusMessage(message.replace(/^Error invoking remote method '[^']+': /, ""));
    } finally {
      setMarkdownImporting(false);
    }
  }, [openImportedTexDocument]);

  const importPdf = useCallback(async () => {
    if (typeof window.latexdo.importPdf !== "function") {
      setStatusMessage(
        "PDF import is not loaded in this app window. Restart the dev app and try again.",
      );
      return;
    }

    const currentProject =
      projectIdRef.current && !hideProjectEntriesRef.current
        ? projectIdRef.current
        : undefined;
    if (!currentProject) {
      setWelcomeOpen(true);
    }

    setPdfImporting(true);
    try {
      const result = await window.latexdo.importPdf(currentProject);
      if (!result) return;

      await openImportedTexDocument(result, currentProject);

      const warningSummary = result.warnings.length ? ` ${result.warnings[0]}` : "";
      setStatusMessage(
        `Reconstructed ${fileName(result.sourcePath)} to ${pathForDisplay(
          result.relativePath,
        )} with ${pdfImportStatsSummary(result.stats)}.${warningSummary}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not import PDF.";
      if (
        message.includes("No handler registered") ||
        message.includes("importPdf is not a function")
      ) {
        setStatusMessage("Restart the LatexDo app to finish loading PDF import.");
        return;
      }
      setStatusMessage(message.replace(/^Error invoking remote method '[^']+': /, ""));
    } finally {
      setPdfImporting(false);
    }
  }, [openImportedTexDocument]);

  const closeDocument = (path: string) => {
    const currentDocuments = documentsRef.current;
    const target = currentDocuments.find((document) => document.path === path);
    if (
      target &&
      target.content !== target.savedContent &&
      !window.confirm(`Close ${target.name} without saving?`)
    ) {
      return;
    }
    const index = currentDocuments.findIndex((document) => document.path === path);
    const nextDocuments = currentDocuments.filter((document) => document.path !== path);
    documentsRef.current = nextDocuments;
    setDocuments(nextDocuments);
    if (activePathRef.current === path) {
      const nextPath =
        nextDocuments[Math.min(index, nextDocuments.length - 1)]?.path ?? "";
      setActivePath(nextPath);
      activePathRef.current = nextPath;
    }
  };

  const showWelcomePage = () => {
    if (activePathRef.current) {
      editorPathBeforeWelcomeRef.current = activePathRef.current;
    }
    setWelcomeOpen(true);
    setActivePath("");
    activePathRef.current = "";
    setStatusMessage(`Welcome to ${productConfig.shortName}`);
  };

  return {
    handleUpdatePermission,
    handleRemoveCollaborator,
    handleCollaborationDisplayNameChange,
    createProject,
    createResearchSpace,
    createProjectFromTemplate,
    renderTemplateIcon,
    openCreateDialog,
    openCreateDialogInDirectory,
    submitCreate,
    importExternalFiles,
    chooseImportFiles,
    openPdfFileForReview,
    reviewPaper,
    insertImageReference,
    copyRelativePath,
    handleEditorFileDrop,
    importDocx,
    importMarkdown,
    importPdf,
    closeDocument,
    showWelcomePage,
  };
}
