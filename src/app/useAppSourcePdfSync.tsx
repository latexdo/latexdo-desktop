import type * as Monaco from "monaco-editor";
import { useCallback, useEffect, useMemo } from "react";
import type { PdfClickLocation } from "../PdfPreview";
import { emitProductEvent } from "../features/onboarding/core/ProductEvents";
import { sourceContextAt } from "../features/pdf/wordMatch";
import type {
  ConferenceTemplate,
  Diagnostic,
  OpenDocument,
  ProjectEntry,
  SyncTexSourceLocation,
} from "../types";
import { runConferenceChecks } from "../checks/conferenceChecker";
import { runCitationChecks } from "../checks/citationAssistant";
import { runStructureChecks } from "../checks/structureAssistant";
import { runReproducibilityChecks } from "../checks/reproducibility";
import { runAcronymChecks } from "../checks/acronymManager";
import { analyzeCompileOutput } from "../checks/errorDoctor";
import { runNotationChecks } from "../checks/notationManager";
import { runPdfComplianceChecks } from "../checks/pdfCompliance";
import { loadPaperSource, paperLineOrigin } from "../checks/paperSource";
import { type ProjectSearchMatch } from "../search/projectSearch";
import { pathForDisplay } from "../pathDisplay";
import {
  flattenEntries,
  joinRelativePath,
  normalizeRelativePath,
} from "../features/project/projectUtils";
import {
  type VisiblePdfPageRect,
  visibleEditorLineForSync,
  visiblePdfPointForSync,
} from "../features/pdf/sync";
import {
  SourceRevealOptions,
  editorModelMatchesPath,
  monaco,
  sourceSelectionRange,
} from "./appShared";
import type { AppCtx04 } from "./appContext";

export function useAppSourcePdfSync(ctx: AppCtx04) {
  const {
    activeDocument,
    activePathRef,
    allProjectEntries,
    assistantDiagnostics,
    backwardSyncRunIdRef,
    compile,
    compileResult,
    documentsRef,
    editorRef,
    editorScrollSyncRunIdRef,
    editorScrollSyncTimerRef,
    forwardSyncRef,
    lastEditorScrollSyncKeyRef,
    lastPdfLocation,
    lastPdfScrollSyncKeyRef,
    openDocument,
    pdfDataRef,
    pdfPathRef,
    pdfScaleRef,
    pdfScrollSyncRunIdRef,
    pdfScrollSyncTimerRef,
    pdfSurfaceRef,
    pdfTarget,
    pendingSourceRef,
    projectEntries,
    projectEntriesRef,
    projectIdRef,
    projectPathRef,
    refreshProject,
    rootFile,
    rootFileRef,
    saveDocument,
    setActivePath,
    setAssistantDiagnostics,
    setCompileResult,
    setDocuments,
    setErrorDoctorResult,
    setLastPdfLocation,
    setPdfComplianceDiagnostics,
    setPdfData,
    setPdfTarget,
    setPreviewVisible,
    setRootFile,
    setStatusMessage,
    setWelcomeOpen,
    settings,
    sourceSyncClearTimerRef,
    sourceSyncDecorationsRef,
    suppressEditorScrollSyncUntilRef,
    suppressPdfScrollSyncUntilRef,
  } = ctx;

  // Paper checks read the whole paper from the root file, following \input
  // and \include, so a finding in content/intro.tex points at that file.
  const readPaperFile = useCallback(
    async (relativePath: string): Promise<string | null> => {
      const wanted = normalizeRelativePath(relativePath);
      const open = documentsRef.current.find(
        (doc) => normalizeRelativePath(doc.relativePath) === wanted,
      );
      if (open) return open.content;
      const projectId = projectIdRef.current;
      if (!projectId) return null;
      try {
        return await window.latexdo.readFile(projectId, wanted);
      } catch {
        return null;
      }
    },
    [documentsRef, projectIdRef],
  );

  useEffect(() => {
    // Paper checks read the whole paper from the root file, so they run for
    // any open project — whichever tab (a .bib, a PDF, a tool) is in front.
    const doc =
      activeDocument?.content && /\.(tex|ltx)$/i.test(activeDocument.relativePath)
        ? activeDocument
        : null;
    if (!doc && !projectIdRef.current) {
      setAssistantDiagnostics([]);
      setPdfComplianceDiagnostics([]);
      return;
    }
    let cancelled = false;
    const compileOutput = compileResult?.output ?? "";
    const timer = setTimeout(() => {
      void (async () => {
        const fromRoot = await loadPaperSource(rootFileRef.current, readPaperFile);
        if (cancelled) return;
        // Without a readable root (a lone file), check the open document.
        if (!fromRoot.text.trim() && !doc) return;
        const source =
          fromRoot.text.trim() || !doc
            ? fromRoot
            : await loadPaperSource(doc.relativePath, async (path) =>
                normalizeRelativePath(path) === normalizeRelativePath(doc.relativePath)
                  ? doc.content
                  : readPaperFile(path),
              );
        if (cancelled) return;
        const content = source.text;
        const locate = (diagnostic: Diagnostic): Diagnostic => {
          const origin = paperLineOrigin(source, diagnostic.line);
          return origin
            ? { ...diagnostic, file: origin.file, line: origin.line }
            : { ...diagnostic, file: doc?.relativePath ?? rootFileRef.current };
        };
        const tag =
          (category: string) =>
          (diagnostic: Diagnostic): Diagnostic => ({ ...diagnostic, category });
        const all: Diagnostic[] = [];
        if (settings.conferenceCheckerEnabled) {
          all.push(
            ...runConferenceChecks(content, {
              ...settings,
              // PDF compliance owns the abstract word count; one finding, not two.
              checkAbstractLength:
                settings.checkAbstractLength &&
                !(settings.pdfComplianceEnabled && settings.checkAbstractWordCount),
              enabled: true,
              template: settings.conferenceTemplate as ConferenceTemplate,
              customTemplate: settings.conferenceChecker_customTemplate,
            }).map(tag("Venue")),
          );
        }
        if (settings.citationAssistantEnabled) {
          all.push(
            ...runCitationChecks(content, { ...settings, enabled: true }).map(
              tag("Citations"),
            ),
          );
        }
        if (settings.structureAssistantEnabled) {
          all.push(
            ...runStructureChecks(content, { ...settings, enabled: true }).map(
              tag("Structure"),
            ),
          );
        }
        if (settings.reproducibilityEnabled) {
          all.push(
            ...runReproducibilityChecks(content, { ...settings, enabled: true }).map(
              tag("Reproducibility"),
            ),
          );
        }
        if (settings.acronymManagerEnabled) {
          all.push(
            ...runAcronymChecks(content, { ...settings, enabled: true }).map(
              tag("Acronyms"),
            ),
          );
        }
        if (settings.notationManagerEnabled) {
          const result = runNotationChecks(content, {
            ...settings,
            enabled: true,
            detectSymbols: settings.detectNotation,
            detectConflicts: settings.detectNotationConflicts,
          });
          all.push(...result.diagnostics.map(tag("Notation")));
        }
        setAssistantDiagnostics(all.map(locate));
        setPdfComplianceDiagnostics(
          settings.pdfComplianceEnabled
            ? runPdfComplianceChecks(content, compileOutput, {
                ...settings,
                enabled: true,
              })
                .map(tag("Submission"))
                .map(locate)
            : [],
        );
      })();
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    activeDocument?.content,
    activeDocument?.path,
    compileResult?.output,
    readPaperFile,
    rootFile,
    settings.pdfComplianceEnabled,
    settings.checkPageCount,
    settings.maxPages,
    settings.checkUnreferencedFigures,
    settings.checkUncitedCitations,
    settings.checkSectionsWithNoCitations,
    settings.checkType3Fonts,
    settings.checkAbstractWordCount,
    settings.maxAbstractWords,
    settings.conferenceCheckerEnabled,
    settings.citationAssistantEnabled,
    settings.structureAssistantEnabled,
    settings.reproducibilityEnabled,
    settings.acronymManagerEnabled,
    settings.checkMargins,
    settings.checkFontSize,
    settings.checkAbstractLength,
    settings.checkKeywords,
    settings.checkFigureReferences,
    settings.checkTableReferences,
    settings.checkBibliographyStyle,
    settings.checkPageLimit,
    settings.checkAuthorInfo,
    settings.checkAnonymousReview,
    settings.checkFigureResolution,
    settings.checkEmbeddedFonts,
    settings.checkCompiler,
    settings.detectMissingCitations,
    settings.detectUnusedEntries,
    settings.detectDuplicateReferences,
    settings.detectBrokenLinks,
    settings.suggestCitationKeys,
    settings.importMetadataSources,
    settings.warnOldCitations,
    settings.checkAbstractStructure,
    settings.checkIntroductionStructure,
    settings.checkRelatedWorkLength,
    settings.checkMethodReproducibility,
    settings.checkResultsDiscussion,
    settings.checkConclusionClaims,
    settings.conferenceTemplate,
    settings.conferenceChecker_customTemplate,
    settings.checkCodeLink,
    settings.checkDatasetLink,
    settings.checkLicenseMentioned,
    settings.checkHyperparameters,
    settings.checkHardwareDetails,
    settings.checkRandomSeeds,
    settings.checkEvaluationMetrics,
    settings.checkUndefinedAcronym,
    settings.checkDuplicateDefinition,
    settings.checkUnusedAcronym,
    settings.checkConflictingDefinitions,
    settings.notationManagerEnabled,
    settings.detectNotation,
    settings.detectNotationConflicts,
    settings.detectUndefinedNotation,
  ]);

  const structureDiagnostics = useMemo(
    () => assistantDiagnostics.filter((d) => d.source === "structure-assistant"),
    [assistantDiagnostics],
  );

  useEffect(() => {
    if (!settings.errorDoctorEnabled || !compileResult?.output) {
      setErrorDoctorResult(null);
      return;
    }
    const content = activeDocument?.content ?? "";
    const result = analyzeCompileOutput(compileResult.output, content, {
      ...settings,
      enabled: true,
    });
    setErrorDoctorResult(result);
  }, [
    compileResult?.output,
    settings.errorDoctorEnabled,
    settings.explainErrors,
    settings.suggestFixes,
    settings.autoFixCommon,
    activeDocument?.content,
  ]);

  /**
   * Moves an entry into `destination`, or renames it in place when `newName`
   * is given (rename is a move within the same folder).
   */
  const moveEntry = useCallback(
    async (sourcePath: string, destination: ProjectEntry | null, newName?: string) => {
      const currentProject = projectIdRef.current;
      if (
        !currentProject ||
        (destination !== null && destination.type !== "directory")
      ) {
        return;
      }

      const sourceEntry = flattenEntries(projectEntriesRef.current).find(
        (entry) => entry.path === sourcePath,
      );
      if (!sourceEntry) {
        setStatusMessage("The dragged item could not be found.");
        return;
      }

      const sourceRelativePath = normalizeRelativePath(sourceEntry.relativePath);
      const sourceParent = sourceRelativePath.includes("/")
        ? sourceRelativePath.slice(0, sourceRelativePath.lastIndexOf("/"))
        : "";
      const renaming = newName !== undefined;
      const targetName = renaming ? newName.trim() : sourceEntry.name;
      const destinationDirectory = renaming
        ? sourceParent
        : normalizeRelativePath(destination?.relativePath ?? "").replace(/\/+$/, "");

      if (renaming && (!targetName || /[\\/]/.test(targetName))) {
        setStatusMessage("Enter a name without slashes.");
        return;
      }
      if (renaming && targetName === sourceEntry.name) {
        return;
      }
      if (!renaming && destinationDirectory === sourceParent) {
        setStatusMessage(
          `${sourceEntry.name} is already in ${
            destinationDirectory || "the project root"
          }`,
        );
        return;
      }

      if (
        destination &&
        (destination.path === sourceEntry.path ||
          normalizeRelativePath(destination.path).startsWith(
            `${normalizeRelativePath(sourceEntry.path)}/`,
          ))
      ) {
        setStatusMessage("A folder cannot be moved into itself.");
        return;
      }

      const destinationRelativePath = destinationDirectory
        ? joinRelativePath(destinationDirectory, targetName)
        : targetName;

      try {
        const sourcePrefix = `${sourceRelativePath}/`;
        const dirtySourceDocuments = documentsRef.current.filter(
          (document) =>
            (normalizeRelativePath(document.relativePath) === sourceRelativePath ||
              normalizeRelativePath(document.relativePath).startsWith(sourcePrefix)) &&
            document.content !== document.savedContent,
        );
        for (const document of dirtySourceDocuments) {
          await saveDocument(document);
        }

        const movedRelativePath = await window.latexdo.moveEntry(
          currentProject,
          sourceEntry.relativePath,
          destinationRelativePath,
        );
        const nextRelativePath = normalizeRelativePath(movedRelativePath);
        const nextPrefix = `${nextRelativePath}/`;
        const sourceAbsolutePath = normalizeRelativePath(sourceEntry.path);
        const projectRoot = projectPathRef.current;
        const absoluteSeparator = projectRoot.includes("\\") ? "\\" : "/";
        const joinAbsolutePath = (base: string, suffix: string): string =>
          `${base.replace(/[\\/]+$/, "")}${absoluteSeparator}${suffix.replaceAll(
            "/",
            absoluteSeparator,
          )}`;
        const nextPath = joinAbsolutePath(projectRoot, nextRelativePath);

        const moveDocument = (document: OpenDocument): OpenDocument => {
          const relativePath = normalizeRelativePath(document.relativePath);
          if (
            relativePath !== sourceRelativePath &&
            !relativePath.startsWith(sourcePrefix)
          ) {
            return document;
          }

          const relativeSuffix =
            relativePath === sourceRelativePath
              ? ""
              : relativePath.slice(sourcePrefix.length);
          const absolutePath = normalizeRelativePath(document.path);
          const absoluteSuffix =
            absolutePath === sourceAbsolutePath
              ? ""
              : absolutePath.slice(sourceAbsolutePath.length + 1);
          return {
            ...document,
            path: absoluteSuffix
              ? joinAbsolutePath(nextPath, absoluteSuffix)
              : nextPath,
            relativePath: relativeSuffix
              ? `${nextPrefix}${relativeSuffix}`
              : nextRelativePath,
          };
        };

        const nextDocuments = documentsRef.current.map(moveDocument);
        documentsRef.current = nextDocuments;
        setDocuments(nextDocuments);

        const normalizedActivePath = normalizeRelativePath(activePathRef.current);
        if (
          normalizedActivePath === sourceAbsolutePath ||
          normalizedActivePath.startsWith(`${sourceAbsolutePath}/`)
        ) {
          const activeSuffix =
            normalizedActivePath === sourceAbsolutePath
              ? ""
              : normalizedActivePath.slice(sourceAbsolutePath.length + 1);
          const movedActivePath = activeSuffix
            ? joinAbsolutePath(nextPath, activeSuffix)
            : nextPath;
          setActivePath(movedActivePath);
          activePathRef.current = movedActivePath;
        }

        const currentRootFile = normalizeRelativePath(rootFileRef.current);
        if (
          currentRootFile === sourceRelativePath ||
          currentRootFile.startsWith(sourcePrefix)
        ) {
          const rootSuffix =
            currentRootFile === sourceRelativePath
              ? ""
              : currentRootFile.slice(sourcePrefix.length);
          const movedRootFile = rootSuffix
            ? `${nextPrefix}${rootSuffix}`
            : nextRelativePath;
          setRootFile(movedRootFile);
          rootFileRef.current = movedRootFile;
        }

        setCompileResult(null);
        setPdfData(null);
        setPdfTarget(null);
        setLastPdfLocation(null);
        pdfPathRef.current = "";
        await refreshProject(currentProject);
        setStatusMessage(
          renaming
            ? `Renamed ${sourceEntry.name} to ${targetName}`
            : `Moved ${sourceEntry.name} to ${
                destination?.relativePath || "the project root"
              }`,
        );
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? error.message
            : renaming
              ? "Could not rename the file"
              : "Could not move the file",
        );
      }
    },
    [refreshProject, saveDocument],
  );

  /** Copies an entry into `destination` (or the project root), never overwriting. */
  const copyEntry = useCallback(
    async (sourcePath: string, destination: ProjectEntry | null) => {
      const currentProject = projectIdRef.current;
      if (
        !currentProject ||
        (destination !== null && destination.type !== "directory")
      ) {
        return;
      }
      const allEntries = flattenEntries(projectEntriesRef.current);
      const sourceEntry = allEntries.find((entry) => entry.path === sourcePath);
      if (!sourceEntry) {
        setStatusMessage("The copied item no longer exists.");
        return;
      }
      const destinationDirectory = normalizeRelativePath(
        destination?.relativePath ?? "",
      ).replace(/\/+$/, "");
      const taken = new Set(
        allEntries.map((entry) => normalizeRelativePath(entry.relativePath)),
      );
      const inDestination = (name: string) =>
        destinationDirectory ? joinRelativePath(destinationDirectory, name) : name;
      const dot = sourceEntry.type === "file" ? sourceEntry.name.lastIndexOf(".") : -1;
      const stem = dot > 0 ? sourceEntry.name.slice(0, dot) : sourceEntry.name;
      const extension = dot > 0 ? sourceEntry.name.slice(dot) : "";
      let targetName = sourceEntry.name;
      for (let index = 1; taken.has(inDestination(targetName)); index += 1) {
        targetName = `${stem} copy${index > 1 ? ` ${index}` : ""}${extension}`;
      }

      try {
        const dirty = documentsRef.current.find(
          (document) =>
            document.path === sourceEntry.path &&
            document.content !== document.savedContent,
        );
        if (dirty) await saveDocument(dirty);
        await window.latexdo.copyEntry(
          currentProject,
          sourceEntry.relativePath,
          inDestination(targetName),
        );
        await refreshProject(currentProject);
        setStatusMessage(
          `Copied ${sourceEntry.name} as ${pathForDisplay(inDestination(targetName))}`,
        );
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Could not copy the file",
        );
      }
    },
    [refreshProject, saveDocument],
  );

  /** Moves an entry to the system Trash after asking, and closes its open tabs. */
  const deleteEntry = useCallback(
    async (entry: ProjectEntry) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) return;
      const kind = entry.type === "directory" ? "folder" : "file";
      if (
        !window.confirm(
          `Move the ${kind} "${entry.name}" to the Trash?\n\nYou can restore it from the Trash.`,
        )
      ) {
        return;
      }
      try {
        await window.latexdo.trashEntry(currentProject, entry.relativePath);
        const removedPath = normalizeRelativePath(entry.path);
        const isRemoved = (path: string) => {
          const normalized = normalizeRelativePath(path);
          return normalized === removedPath || normalized.startsWith(`${removedPath}/`);
        };
        const nextDocuments = documentsRef.current.filter(
          (document) => !isRemoved(document.path),
        );
        if (nextDocuments.length !== documentsRef.current.length) {
          documentsRef.current = nextDocuments;
          setDocuments(nextDocuments);
          if (isRemoved(activePathRef.current)) {
            const nextActive = nextDocuments[0]?.path ?? "";
            setActivePath(nextActive);
            activePathRef.current = nextActive;
          }
        }
        await refreshProject(currentProject);
        setStatusMessage(`Moved ${entry.name} to the Trash`);
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Could not delete the file",
        );
      }
    },
    [refreshProject],
  );

  const revealPendingSource = useCallback((options: SourceRevealOptions = {}) => {
    const pending = pendingSourceRef.current;
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!pending || !editor || !model) {
      return false;
    }

    if (
      normalizeRelativePath(model.uri.fsPath) !== normalizeRelativePath(pending.path)
    ) {
      return false;
    }

    const range = sourceSelectionRange(model, pending);
    if (options.select !== false) {
      editor.setSelection(range);
    }
    editor.revealRangeInCenter(range, monaco.editor.ScrollType.Smooth);
    if ((options.focus ?? pending.focus) !== false) {
      editor.focus();
    }

    if (options.highlight !== false) {
      if (sourceSyncClearTimerRef.current !== null) {
        window.clearTimeout(sourceSyncClearTimerRef.current);
        sourceSyncClearTimerRef.current = null;
      }
      sourceSyncDecorationsRef.current = editor.deltaDecorations(
        sourceSyncDecorationsRef.current,
        [
          {
            range,
            options: {
              className: "source-sync-highlight",
              stickiness:
                monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
              hoverMessage: { value: "PDF inverse search target" },
            },
          },
        ],
      );
      sourceSyncClearTimerRef.current = window.setTimeout(() => {
        const currentEditor = editorRef.current;
        if (currentEditor) {
          sourceSyncDecorationsRef.current = currentEditor.deltaDecorations(
            sourceSyncDecorationsRef.current,
            [],
          );
        } else {
          sourceSyncDecorationsRef.current = [];
        }
        sourceSyncClearTimerRef.current = null;
      }, 1800);
    }

    pendingSourceRef.current = null;
    return true;
  }, []);

  const handleForwardSync = useCallback(
    async (position: Monaco.Position) => {
      const document = documentsRef.current.find(
        (item) => item.path === activePathRef.current,
      );
      if (!document || !document.name.endsWith(".tex")) {
        return;
      }

      const model = editorRef.current?.getModel();
      if (!editorModelMatchesPath(editorRef.current, document.path)) {
        return;
      }
      // The word under the cursor and its neighbours, to find it in the PDF.
      const context = model
        ? sourceContextAt(model.getValue(), position.lineNumber, position.column)
        : null;
      let pdfPath = pdfPathRef.current;
      const sourceIsDirty = documentsRef.current.some(
        (item) => item.content !== item.savedContent,
      );

      if (!pdfPath || sourceIsDirty) {
        const result = await compile();
        pdfPath = result?.ok ? (result.pdfPath ?? "") : "";
      }
      if (!pdfPath) {
        setStatusMessage("Compile successfully before synchronizing the PDF");
        return;
      }

      try {
        const location = await window.latexdo.forwardSyncTex(
          projectIdRef.current,
          pdfPath,
          document.relativePath,
          position.lineNumber,
          position.column,
        );
        if (!location) {
          setStatusMessage("No PDF location was found for this source position");
          return;
        }

        setPreviewVisible(true);
        suppressPdfScrollSyncUntilRef.current = Date.now() + 900;
        setPdfTarget({
          ...location,
          word: context?.word,
          before: context?.before,
          after: context?.after,
        });
        setStatusMessage(
          `Showing ${pathForDisplay(document.name)}:${position.lineNumber} in PDF`,
        );
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Could not synchronize PDF",
        );
      }
    },
    [compile, setDocuments],
  );
  forwardSyncRef.current = handleForwardSync;

  const handleEditorCursorToPdf = useCallback(async () => {
    const editor = editorRef.current;
    const position = editor?.getPosition();
    if (!position) {
      setStatusMessage("Place the cursor in a TeX file before synchronizing the PDF");
      return;
    }
    const document = documentsRef.current.find(
      (item) => item.path === activePathRef.current,
    );
    if (
      !document ||
      !document.name.endsWith(".tex") ||
      !editorModelMatchesPath(editor ?? null, document.path)
    ) {
      setStatusMessage("Place the cursor in a TeX file before synchronizing the PDF");
      return;
    }

    await handleForwardSync(position);
  }, [handleForwardSync]);

  const handleBackwardSync = useCallback(
    async (pdfLocation: PdfClickLocation) => {
      const pdfPath = pdfPathRef.current;
      if (!pdfPath) {
        setStatusMessage("Compile successfully before using PDF inverse search");
        return;
      }

      const syncRunId = backwardSyncRunIdRef.current + 1;
      backwardSyncRunIdRef.current = syncRunId;
      const sourceIsDirty = documentsRef.current.some(
        (document) => document.content !== document.savedContent,
      );
      setStatusMessage("Finding source location from PDF...");

      try {
        const location: SyncTexSourceLocation | null =
          await window.latexdo.backwardSyncTex(
            projectIdRef.current,
            pdfPath,
            pdfLocation.page,
            pdfLocation.x,
            pdfLocation.y,
          );
        if (syncRunId !== backwardSyncRunIdRef.current) {
          return;
        }
        if (!location) {
          setStatusMessage(
            "No source location was found. Compile again if the PDF is stale.",
          );
          return;
        }

        const normalizedFile = normalizeRelativePath(location.file);
        const entry = flattenEntries(projectEntries).find(
          (item) =>
            item.type === "file" &&
            normalizeRelativePath(item.relativePath) === normalizedFile,
        );
        if (!entry) {
          setStatusMessage(`Could not open ${location.file}`);
          return;
        }

        pendingSourceRef.current = {
          path: entry.path,
          line: location.line,
          column: location.column,
          word: pdfLocation.word,
          before: pdfLocation.before,
          after: pdfLocation.after,
        };
        await openDocument(entry);
        setWelcomeOpen(false);
        suppressEditorScrollSyncUntilRef.current = Date.now() + 900;
        requestAnimationFrame(() => {
          suppressEditorScrollSyncUntilRef.current = Date.now() + 900;
          revealPendingSource();
        });
        setStatusMessage(
          sourceIsDirty
            ? `Opened ${pathForDisplay(entry.relativePath)}:${location.line} from PDF. Compile if the jump looks stale.`
            : `Opened ${pathForDisplay(entry.relativePath)}:${location.line} from PDF`,
        );
        emitProductEvent({ type: "synctex:navigated" });
      } catch (error) {
        if (syncRunId !== backwardSyncRunIdRef.current) {
          return;
        }
        setStatusMessage(
          error instanceof Error ? error.message : "Could not synchronize source",
        );
      }
    },
    [openDocument, projectEntries, revealPendingSource],
  );

  const handlePdfPointToSource = useCallback(async () => {
    const location = pdfTarget ?? lastPdfLocation;
    if (!location) {
      setStatusMessage("Show the editor cursor in the PDF or click a PDF point first");
      return;
    }

    await handleBackwardSync(location);
  }, [handleBackwardSync, lastPdfLocation, pdfTarget]);

  const revealSourceFromScrollSync = useCallback(
    async (location: SyncTexSourceLocation, syncRunId: number) => {
      const normalizedFile = normalizeRelativePath(location.file);
      const entry = flattenEntries(projectEntriesRef.current).find(
        (item) =>
          item.type === "file" &&
          normalizeRelativePath(item.relativePath) === normalizedFile,
      );
      if (!entry) {
        return;
      }

      pendingSourceRef.current = {
        path: entry.path,
        line: location.line,
        column: location.column,
      };
      await openDocument(entry, projectIdRef.current, { announce: false });
      if (syncRunId !== pdfScrollSyncRunIdRef.current) {
        return;
      }

      setWelcomeOpen(false);
      suppressEditorScrollSyncUntilRef.current = Date.now() + 900;
      requestAnimationFrame(() => {
        if (syncRunId !== pdfScrollSyncRunIdRef.current) {
          return;
        }
        suppressEditorScrollSyncUntilRef.current = Date.now() + 900;
        revealPendingSource({
          focus: false,
          highlight: false,
          select: false,
        });
      });
    },
    [openDocument, revealPendingSource],
  );

  const performEditorScrollSync = useCallback(async () => {
    if (Date.now() < suppressEditorScrollSyncUntilRef.current) {
      return;
    }

    const currentProject = projectIdRef.current;
    const pdfPath = pdfPathRef.current;
    if (!currentProject || !pdfPath || !pdfDataRef.current) {
      return;
    }

    const editor = editorRef.current;
    const model = editor?.getModel();
    const document = documentsRef.current.find(
      (item) => item.path === activePathRef.current,
    );
    if (
      !editor ||
      !model ||
      !document ||
      !document.name.endsWith(".tex") ||
      !editorModelMatchesPath(editor, document.path)
    ) {
      return;
    }

    const lineNumber = visibleEditorLineForSync(
      editor.getVisibleRanges(),
      editor.getPosition()?.lineNumber,
    );
    if (lineNumber === null) {
      return;
    }

    const editorPosition = editor.getPosition();
    const column =
      editorPosition?.lineNumber === lineNumber
        ? editorPosition.column
        : Math.max(1, Math.floor(model.getLineMaxColumn(lineNumber) / 2));
    const syncKey = `${document.relativePath}:${pdfPath}:${lineNumber}:${column}`;
    if (syncKey === lastEditorScrollSyncKeyRef.current) {
      return;
    }
    lastEditorScrollSyncKeyRef.current = syncKey;

    const syncRunId = editorScrollSyncRunIdRef.current + 1;
    editorScrollSyncRunIdRef.current = syncRunId;

    try {
      const context = sourceContextAt(model.getValue(), lineNumber, column);
      const location = await window.latexdo.forwardSyncTex(
        currentProject,
        pdfPath,
        document.relativePath,
        lineNumber,
        column,
      );
      if (syncRunId !== editorScrollSyncRunIdRef.current || !location) {
        return;
      }

      suppressPdfScrollSyncUntilRef.current = Date.now() + 900;
      setPdfTarget({
        ...location,
        word: context?.word,
        before: context?.before,
        after: context?.after,
      });
    } catch {
      // Scroll sync is opportunistic: no compiled SyncTeX match means no movement.
    }
  }, []);

  const scheduleEditorScrollSync = useCallback(() => {
    if (editorScrollSyncTimerRef.current !== null) {
      return;
    }

    editorScrollSyncTimerRef.current = window.setTimeout(() => {
      editorScrollSyncTimerRef.current = null;
      void performEditorScrollSync();
    }, 160);
  }, [performEditorScrollSync]);

  const performPdfScrollSync = useCallback(async () => {
    if (Date.now() < suppressPdfScrollSyncUntilRef.current) {
      return;
    }

    const currentProject = projectIdRef.current;
    const pdfPath = pdfPathRef.current;
    const surface = pdfSurfaceRef.current;
    if (!currentProject || !pdfPath || !pdfDataRef.current || !surface) {
      return;
    }

    const pages = Array.from(surface.querySelectorAll<HTMLElement>(".pdf-page"))
      .map((pageElement) => {
        const page = Number(pageElement.dataset.pageNumber);
        const rect = pageElement.getBoundingClientRect();
        return Number.isFinite(page) && page > 0
          ? {
              page,
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            }
          : null;
      })
      .filter((page): page is VisiblePdfPageRect => page !== null);
    const point = visiblePdfPointForSync(
      surface.getBoundingClientRect(),
      pages,
      pdfScaleRef.current / 100,
    );
    if (!point) {
      return;
    }

    const syncKey = `${pdfPath}:${point.page}:${Math.round(point.x)}:${Math.round(
      point.y,
    )}`;
    if (syncKey === lastPdfScrollSyncKeyRef.current) {
      return;
    }
    lastPdfScrollSyncKeyRef.current = syncKey;

    const syncRunId = pdfScrollSyncRunIdRef.current + 1;
    pdfScrollSyncRunIdRef.current = syncRunId;

    try {
      const location = await window.latexdo.backwardSyncTex(
        currentProject,
        pdfPath,
        point.page,
        point.x,
        point.y,
      );
      if (syncRunId !== pdfScrollSyncRunIdRef.current || !location) {
        return;
      }

      await revealSourceFromScrollSync(location, syncRunId);
    } catch {
      // Keep manual scrolling normal when SyncTeX cannot resolve this point.
    }
  }, [revealSourceFromScrollSync]);

  const schedulePdfScrollSync = useCallback(() => {
    if (pdfScrollSyncTimerRef.current !== null) {
      return;
    }

    pdfScrollSyncTimerRef.current = window.setTimeout(() => {
      pdfScrollSyncTimerRef.current = null;
      void performPdfScrollSync();
    }, 160);
  }, [performPdfScrollSync]);

  const handleOpenProjectSearchMatch = useCallback(
    async (match: ProjectSearchMatch, options: { focus?: boolean } = {}) => {
      const entry = allProjectEntries.find(
        (item) =>
          item.type === "file" &&
          normalizeRelativePath(item.relativePath) ===
            normalizeRelativePath(match.path),
      );
      if (!entry) {
        setStatusMessage(`${match.path} is no longer in this project.`);
        return;
      }

      pendingSourceRef.current = {
        path: entry.path,
        line: match.line,
        column: match.column,
        endLine: match.line,
        endColumn: match.endColumn,
        focus: options.focus,
      };
      setWelcomeOpen(false);
      await openDocument(entry);
      requestAnimationFrame(() => {
        revealPendingSource();
      });
      setStatusMessage(`Opened ${match.path}:${match.line}:${match.column}`);
    },
    [allProjectEntries, openDocument, revealPendingSource],
  );

  return {
    structureDiagnostics,
    moveEntry,
    copyEntry,
    deleteEntry,
    revealPendingSource,
    handleEditorCursorToPdf,
    handleBackwardSync,
    handlePdfPointToSource,
    scheduleEditorScrollSync,
    schedulePdfScrollSync,
    handleOpenProjectSearchMatch,
  };
}
