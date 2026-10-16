import { useCallback, useEffect } from "react";
import { ensureMetadataIgnore } from "../features/project/metadataIgnore";
import { normalizeLatexDoReviewMarkup, usesLatexDoReviewMacros } from "../reviewMarkup";
import type { OpenDocument, ProjectEntry, RebuttalItem, ReviewChat } from "../types";
import {
  isProjectSearchablePath,
  type ProjectSearchFile,
} from "../search/projectSearch";
import { pathForDisplay } from "../pathDisplay";
import { figureBytesToDataUrl, figurePreviewMimeType } from "../figurePreview";
import {
  bookmarksStorageKey,
  hasProjectTreeLimitEntry,
  projectListOptionsFromSettings,
} from "../features/settings/settings";
import {
  flattenEntries,
  normalizeRelativePath,
} from "../features/project/projectUtils";
import {
  normalizeRebuttalItem,
  removeLegacyReviewPlaceholders,
} from "../features/review/reviewState";
import {
  OpenDocumentOptions,
  isPreviewAssetMimeType,
  isTextDocument,
  reviewSnapshot,
} from "./appShared";
import type { AppCtx02 } from "./appContext";

export function useAppProjectFiles(ctx: AppCtx02) {
  const {
    activePath,
    activePathRef,
    allProjectEntries,
    bookmarkStore,
    documents,
    documentsRef,
    engine,
    engineRef,
    figurePreviewCacheRef,
    hideProjectEntries,
    hideProjectEntriesRef,
    projectEntriesRef,
    projectId,
    projectIdRef,
    projectPath,
    projectPathRef,
    projectSearchRefreshNonce,
    rebuttalItems,
    reviewChats,
    reviewDataReadyRef,
    reviewSaveQueueRef,
    reviewSavedSnapshotRef,
    rootFile,
    rootFileRef,
    setActivePath,
    setCitationLibraryError,
    setCitationLibraryLoading,
    setCitationProjectFiles,
    setDocuments,
    setProjectEntries,
    setProjectSearchError,
    setProjectSearchFiles,
    setProjectSearchLoading,
    setRebuttalItems,
    setReviewChats,
    setStatusMessage,
    settings,
    settingsRef,
  } = ctx;

  useEffect(() => {
    projectIdRef.current = projectId;
    figurePreviewCacheRef.current.clear();
  }, [projectId]);

  useEffect(() => {
    projectPathRef.current = projectPath;
  }, [projectPath]);

  useEffect(() => {
    hideProjectEntriesRef.current = hideProjectEntries;
  }, [hideProjectEntries]);

  useEffect(() => {
    activePathRef.current = activePath;
  }, [activePath]);

  useEffect(() => {
    rootFileRef.current = rootFile;
  }, [rootFile]);

  useEffect(() => {
    engineRef.current = engine;
  }, [engine]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    window.localStorage.setItem(bookmarksStorageKey, JSON.stringify(bookmarkStore));
  }, [bookmarkStore]);

  useEffect(() => {
    if (!projectId || hideProjectEntries) {
      setCitationProjectFiles([]);
      setCitationLibraryError("");
      setCitationLibraryLoading(false);
      return;
    }

    const sourceEntries = allProjectEntries.filter(
      (entry) =>
        entry.type === "file" &&
        (entry.name.endsWith(".tex") || entry.name.endsWith(".bib")),
    );

    if (!sourceEntries.length) {
      setCitationProjectFiles([]);
      setCitationLibraryError("");
      setCitationLibraryLoading(false);
      return;
    }

    let cancelled = false;
    setCitationLibraryLoading(true);

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const openDocuments = new Map(
            documentsRef.current.map((document) => [
              normalizeRelativePath(document.relativePath),
              document.content,
            ]),
          );
          // One unreadable file must not hide the rest of the bibliography.
          const unreadable: string[] = [];
          const reads = await Promise.all(
            sourceEntries.map(async (entry) => {
              const normalizedPath = normalizeRelativePath(entry.relativePath);
              try {
                const content =
                  openDocuments.get(normalizedPath) ??
                  (await window.latexdo.readFile(projectId, entry.relativePath));
                return { path: normalizedPath, content };
              } catch {
                unreadable.push(pathForDisplay(entry.relativePath));
                return null;
              }
            }),
          );
          const files = reads.filter(
            (file): file is { path: string; content: string } => file !== null,
          );

          if (!cancelled) {
            setCitationProjectFiles(files);
            setCitationLibraryError(
              unreadable.length
                ? `Could not read ${unreadable.join(", ")}; citations from ${
                    unreadable.length === 1 ? "it are" : "them are"
                  } missing.`
                : "",
            );
          }
        } catch (error) {
          if (!cancelled) {
            setCitationLibraryError(
              error instanceof Error
                ? error.message
                : "Could not scan project citations",
            );
          }
        } finally {
          if (!cancelled) {
            setCitationLibraryLoading(false);
          }
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [allProjectEntries, documents, hideProjectEntries, projectId]);

  useEffect(() => {
    if (!projectId || hideProjectEntries) {
      setProjectSearchFiles([]);
      setProjectSearchError("");
      setProjectSearchLoading(false);
      return;
    }

    const sourceEntries = allProjectEntries.filter(
      (entry) => entry.type === "file" && isProjectSearchablePath(entry.relativePath),
    );

    if (!sourceEntries.length) {
      setProjectSearchFiles([]);
      setProjectSearchError("");
      setProjectSearchLoading(false);
      return;
    }

    let cancelled = false;
    setProjectSearchLoading(true);

    const timer = window.setTimeout(() => {
      void (async () => {
        const openDocuments = new Map(
          documentsRef.current.map((document) => [
            normalizeRelativePath(document.relativePath),
            document.content,
          ]),
        );
        const reads = await Promise.all(
          sourceEntries.map(async (entry) => {
            const normalizedPath = normalizeRelativePath(entry.relativePath);
            try {
              const content =
                openDocuments.get(normalizedPath) ??
                (await window.latexdo.readFile(projectId, entry.relativePath));
              return {
                file: { path: normalizedPath, content } satisfies ProjectSearchFile,
                error: "",
              };
            } catch (error) {
              return {
                file: null,
                error:
                  error instanceof Error
                    ? `${pathForDisplay(entry.relativePath)}: ${error.message}`
                    : pathForDisplay(entry.relativePath),
              };
            }
          }),
        );

        if (cancelled) {
          return;
        }

        const files = reads
          .map((read) => read.file)
          .filter((file): file is ProjectSearchFile => Boolean(file));
        const failedReads = reads.filter((read) => read.error);
        setProjectSearchFiles(files);
        setProjectSearchError(
          failedReads.length
            ? `Skipped ${failedReads.length} unreadable file${
                failedReads.length === 1 ? "" : "s"
              }.`
            : "",
        );
        setProjectSearchLoading(false);
      })().catch((error) => {
        if (!cancelled) {
          setProjectSearchError(
            error instanceof Error ? error.message : "Could not scan project files.",
          );
          setProjectSearchLoading(false);
        }
      });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    allProjectEntries,
    documents,
    hideProjectEntries,
    projectId,
    projectSearchRefreshNonce,
  ]);

  const refreshProject = useCallback(async (id = projectIdRef.current) => {
    if (!id) {
      return [];
    }
    const entries = await window.latexdo.listProject(
      id,
      projectListOptionsFromSettings(settingsRef.current),
    );
    setProjectEntries(entries);
    if (hasProjectTreeLimitEntry(entries)) {
      setStatusMessage("Project tree was limited. Adjust tree limits in Settings.");
    }
    return entries;
  }, []);

  useEffect(() => {
    if (!projectId || hideProjectEntries) {
      return;
    }
    void refreshProject(projectId);
  }, [
    hideProjectEntries,
    projectId,
    refreshProject,
    settings.projectTreeIgnoredNames,
    settings.projectTreeMaxDepth,
    settings.projectTreeMaxEntries,
  ]);

  const openDocument = useCallback(
    async (
      entry: ProjectEntry,
      targetProject = projectIdRef.current,
      options: OpenDocumentOptions = {},
    ) => {
      if (entry.type !== "file") {
        return;
      }

      const existing = documentsRef.current.find(
        (document) => document.path === entry.path,
      );
      if (existing) {
        setActivePath(entry.path);
        activePathRef.current = entry.path;
        return;
      }

      const assetMimeType = figurePreviewMimeType(entry.relativePath);
      if (isPreviewAssetMimeType(assetMimeType)) {
        try {
          const bytes = await window.latexdo.readAsset(
            targetProject,
            entry.relativePath,
          );
          const assetDataUrl = figureBytesToDataUrl(bytes, assetMimeType);
          const document: OpenDocument = {
            path: entry.path,
            relativePath: entry.relativePath,
            name: entry.name,
            kind: "asset",
            content: "",
            savedContent: "",
            assetMimeType,
            assetDataUrl,
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
          setActivePath(entry.path);
          activePathRef.current = entry.path;
          if (options.announce !== false) {
            setStatusMessage(`Opened ${pathForDisplay(entry.relativePath)}`);
          }
        } catch (error) {
          if (options.announce !== false) {
            setStatusMessage(
              error instanceof Error
                ? error.message
                : `Could not open ${pathForDisplay(entry.relativePath)}`,
            );
          }
        }
        return;
      }

      let content: string;
      try {
        content = await window.latexdo.readFile(targetProject, entry.relativePath);
      } catch (error) {
        if (options.announce !== false) {
          setStatusMessage(
            error instanceof Error
              ? error.message
              : `Could not open ${pathForDisplay(entry.relativePath)}`,
          );
        }
        return;
      }
      const document: OpenDocument = {
        path: entry.path,
        relativePath: entry.relativePath,
        name: entry.name,
        kind: "text",
        content,
        savedContent: content,
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
      setActivePath(entry.path);
      activePathRef.current = entry.path;
      if (options.announce !== false) {
        setStatusMessage(`Opened ${pathForDisplay(entry.relativePath)}`);
      }
    },
    [],
  );

  const resolveProjectDataPath = useCallback((relativePath: string) => {
    return normalizeRelativePath(relativePath).replace(/^\/+/, "");
  }, []);

  const ensurePreambleMacros = (content: string): string => {
    const macroStart = "% --- LatexDo Review & Rebuttal Macros ---";
    const macroEnd = "% ----------------------------------------";
    const macros = String.raw`${macroStart}
\usepackage{xcolor}
\definecolor{LatexDoDiffAdd}{HTML}{1A7F37}
\definecolor{LatexDoDiffRemove}{HTML}{B42318}
\definecolor{LatexDoRule}{HTML}{8C959F}
\makeatletter
\@ifundefined{latexdoBlockTitle}{%
  \long\def\latexdoBlockTitle#1{%
    \par\noindent\textbf{\MakeUppercase{#1}}\par\nobreak\vspace{0.25em}%
  }%
}{}
\@ifundefined{latexdoDiffRemoved}{%
  \long\def\latexdoDiffRemoved#1{%
    \par\noindent{\ttfamily\color{LatexDoDiffRemove}- }{\color{LatexDoDiffRemove}#1}\par%
  }%
}{}
\@ifundefined{latexdoDiffAdded}{%
  \long\def\latexdoDiffAdded#1{%
    \par\noindent{\ttfamily\color{LatexDoDiffAdd}+ }{\color{LatexDoDiffAdd}#1}\par%
  }%
}{}
\@ifundefined{latexdoreviewercomment}{%
  \long\def\latexdoreviewercomment#1{%
    \par\smallskip
    \noindent{\color{LatexDoRule}\rule{2pt}{1.35em}}\hspace{0.65em}%
    \begin{minipage}[t]{0.92\linewidth}%
      \footnotesize\textbf{Reviewer comment.} #1%
    \end{minipage}\par
    \smallskip
  }%
}{}
\@ifundefined{reviewercomment}{%
  \long\def\reviewercomment#1#2{%
    #1\latexdoreviewercomment{#2}%
  }%
}{}
\@ifundefined{rebuttal}{%
  \long\def\rebuttal#1#2#3#4{%
    \par\medskip
    \noindent{\color{LatexDoRule}\rule{\linewidth}{0.4pt}}\par
    \latexdoBlockTitle{Text}#1\par
    \latexdoBlockTitle{Reviewer comment}#2\par
    \latexdoBlockTitle{Author answer}#3\par
    \latexdoBlockTitle{Changes (diff)}
    \latexdoDiffRemoved{#1}
    \latexdoDiffAdded{#4}
    \noindent{\color{LatexDoRule}\rule{\linewidth}{0.4pt}}\par
    \medskip
  }%
}{}
\makeatother
${macroEnd}
`;
    const macroStartIndex = content.indexOf(macroStart);
    if (macroStartIndex !== -1) {
      const macroEndIndex = content.indexOf(macroEnd, macroStartIndex);
      if (macroEndIndex !== -1) {
        return (
          content.slice(0, macroStartIndex) +
          macros +
          content.slice(macroEndIndex + macroEnd.length).replace(/^\n/, "")
        );
      }
    }
    const docStart = content.indexOf("\\begin{document}");
    if (docStart === -1) return macros + content;
    return content.slice(0, docStart) + macros + content.slice(docStart);
  };

  const findProjectEntry = (relativePath: string): ProjectEntry | undefined => {
    const normalizedPath = normalizeRelativePath(relativePath);
    return flattenEntries(projectEntriesRef.current).find(
      (entry) =>
        entry.type === "file" &&
        normalizeRelativePath(entry.relativePath) === normalizedPath,
    );
  };

  const findOpenDocument = (relativePath: string): OpenDocument | undefined => {
    const normalizedPath = normalizeRelativePath(relativePath);
    return documentsRef.current.find(
      (document) => normalizeRelativePath(document.relativePath) === normalizedPath,
    );
  };

  const projectUsesLatexDoReviewMacros = async (
    currentProject: string,
  ): Promise<boolean> => {
    if (
      documentsRef.current.some((document) => usesLatexDoReviewMacros(document.content))
    ) {
      return true;
    }

    const openDocumentPaths = new Set(
      documentsRef.current.map((document) =>
        normalizeRelativePath(document.relativePath),
      ),
    );
    const texEntries = flattenEntries(projectEntriesRef.current).filter(
      (entry) =>
        entry.type === "file" &&
        entry.name.endsWith(".tex") &&
        !openDocumentPaths.has(normalizeRelativePath(entry.relativePath)),
    );

    for (const entry of texEntries) {
      const content = await window.latexdo.readFile(currentProject, entry.relativePath);
      if (usesLatexDoReviewMacros(content)) {
        return true;
      }
    }

    return false;
  };

  const normalizeReviewMarkupForCompile = async (
    currentProject: string,
  ): Promise<Map<string, string>> => {
    const normalizedContents = new Map<string, string>();
    const texEntries = flattenEntries(projectEntriesRef.current).filter(
      (entry) => entry.type === "file" && entry.name.endsWith(".tex"),
    );

    for (const entry of texEntries) {
      const openDocument = findOpenDocument(entry.relativePath);
      const content =
        openDocument?.content ??
        (await window.latexdo.readFile(currentProject, entry.relativePath));
      const normalizedContent = normalizeLatexDoReviewMarkup(content);

      if (normalizedContent !== content) {
        await window.latexdo.writeFile(
          currentProject,
          entry.relativePath,
          normalizedContent,
        );
        normalizedContents.set(
          normalizeRelativePath(entry.relativePath),
          normalizedContent,
        );
      }
    }

    return normalizedContents;
  };

  const saveDocumentsForCompile = async (
    currentProject: string,
    dirtyDocuments: OpenDocument[],
  ): Promise<void> => {
    const rootRelativePath = rootFileRef.current;
    const rootEntry = findProjectEntry(rootRelativePath);
    const rootDocument = findOpenDocument(rootRelativePath);
    const savedContents = await normalizeReviewMarkupForCompile(currentProject);

    const reviewMacrosNeeded = await projectUsesLatexDoReviewMacros(currentProject);
    if (reviewMacrosNeeded && rootEntry) {
      const rootContent =
        savedContents.get(normalizeRelativePath(rootEntry.relativePath)) ??
        rootDocument?.content ??
        (await window.latexdo.readFile(currentProject, rootEntry.relativePath));
      const rootContentWithMacros = ensurePreambleMacros(rootContent);
      if (
        rootContentWithMacros !== rootContent ||
        rootDocument?.content !== rootDocument?.savedContent
      ) {
        await window.latexdo.writeFile(
          currentProject,
          rootEntry.relativePath,
          rootContentWithMacros,
        );
        savedContents.set(
          normalizeRelativePath(rootEntry.relativePath),
          rootContentWithMacros,
        );
      }
    }

    await Promise.all(
      dirtyDocuments
        .filter(
          (document) =>
            isTextDocument(document) &&
            normalizeRelativePath(document.relativePath) !==
              normalizeRelativePath(rootRelativePath),
        )
        .map(async (document) => {
          const normalizedPath = normalizeRelativePath(document.relativePath);
          const content = savedContents.get(normalizedPath) ?? document.content;
          await window.latexdo.writeFile(
            currentProject,
            document.relativePath,
            content,
          );
          savedContents.set(normalizedPath, content);
        }),
    );

    if (
      !reviewMacrosNeeded &&
      rootDocument &&
      rootDocument.content !== rootDocument.savedContent
    ) {
      const normalizedPath = normalizeRelativePath(rootDocument.relativePath);
      const content = savedContents.get(normalizedPath) ?? rootDocument.content;
      await window.latexdo.writeFile(
        currentProject,
        rootDocument.relativePath,
        content,
      );
      savedContents.set(normalizedPath, content);
    }

    if (savedContents.size > 0) {
      setDocuments((current) => {
        const nextDocuments = current.map((document) => {
          const savedContent = savedContents.get(
            normalizeRelativePath(document.relativePath),
          );
          return savedContent === undefined
            ? document
            : { ...document, content: savedContent, savedContent };
        });
        documentsRef.current = nextDocuments;
        return nextDocuments;
      });
    }
  };

  const saveReviewData = useCallback(
    async (chats: ReviewChat[], items: RebuttalItem[]) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) return;
      if (!reviewDataReadyRef.current) {
        // The stored review data never loaded for this project; writing now
        // would overwrite it with a partial view.
        setStatusMessage(
          "Review data could not be loaded — changes are not being saved. Reload the project to retry.",
        );
        return;
      }

      // Serialize writes so a slow earlier save cannot land after (and
      // overwrite) a newer one.
      const write = reviewSaveQueueRef.current.then(async () => {
        await ensureMetadataIgnore(currentProject);
        const data = JSON.stringify({ chats, items }, null, 2);
        const filePath = resolveProjectDataPath(".latexdo/review_data.json");
        await window.latexdo.writeFile(currentProject, filePath, data);
      });
      reviewSaveQueueRef.current = write.catch(() => undefined);
      try {
        await write;
      } catch (e) {
        console.error("Failed to save review data", e);
        setStatusMessage(
          "Could not save review data — your latest review change may be lost. Check your connection and try again.",
        );
      }
    },
    [resolveProjectDataPath],
  );

  const loadReviewData = useCallback(
    async (id: string) => {
      reviewDataReadyRef.current = false;
      try {
        const filePath = resolveProjectDataPath(".latexdo/review_data.json");
        const exists = await window.latexdo.fileExists(id, filePath);
        if (!exists) {
          reviewSavedSnapshotRef.current = reviewSnapshot([], []);
          setReviewChats([]);
          setRebuttalItems([]);
          reviewDataReadyRef.current = true;
          return;
        }
        const content = await window.latexdo.readFile(id, filePath);
        const { chats, items } = JSON.parse(content) as {
          chats: ReviewChat[];
          items: RebuttalItem[];
        };
        const nextItems = (Array.isArray(items) ? items : []).map(
          normalizeRebuttalItem,
        );
        const normalizedChats = removeLegacyReviewPlaceholders(
          Array.isArray(chats) ? chats : [],
        );
        // Cleaned-up legacy data differs from disk, so the save effect rewrites it.
        reviewSavedSnapshotRef.current = normalizedChats.changed
          ? ""
          : reviewSnapshot(normalizedChats.chats, nextItems);
        setReviewChats(normalizedChats.chats);
        setRebuttalItems(nextItems);
        reviewDataReadyRef.current = true;
      } catch (e) {
        // Keep reviewDataReadyRef false: saves are blocked so a transient
        // load failure cannot lead to overwriting the stored review data.
        console.error("Failed to load review data", e);
        reviewSavedSnapshotRef.current = reviewSnapshot([], []);
        setReviewChats([]);
        setRebuttalItems([]);
        setStatusMessage(
          "Could not load saved review data — review changes will not be saved until the project reloads successfully.",
        );
      }
    },
    [resolveProjectDataPath],
  );

  // One place saves review data, from the committed state. Handlers only
  // update state, so a save can never write a stale copy of the other list.
  useEffect(() => {
    const snapshot = reviewSnapshot(reviewChats, rebuttalItems);
    if (snapshot === reviewSavedSnapshotRef.current) return;
    reviewSavedSnapshotRef.current = snapshot;
    void saveReviewData(reviewChats, rebuttalItems);
  }, [rebuttalItems, reviewChats, saveReviewData]);

  return {
    refreshProject,
    openDocument,
    resolveProjectDataPath,
    ensurePreambleMacros,
    saveDocumentsForCompile,
    saveReviewData,
    loadReviewData,
  };
}
