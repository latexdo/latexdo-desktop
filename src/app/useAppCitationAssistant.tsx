import { useCallback, useRef } from "react";
import { removeUnusedBibliography } from "../features/citations/removeUnusedBibliography";
import type { CitationSearchContext } from "../components/CitationSearchPopup";
import {
  mergeBibliographies,
  retargetBibliographyCommands,
} from "../features/citations/mergeBibliographies";
import {
  citationContextWindow,
  mergeOnlinePapers,
  recentCitationKeys,
} from "../features/citations/citationAssistant";
import { bibtexForPaper } from "../features/graph/scholarlyDiscovery";
import { searchCrossref, searchOpenAlex } from "../features/scholarly/scholarlyClient";
import type { ScholarlyPaper } from "../features/scholarly/scholarlyTypes";
import {
  flattenEntries,
  normalizeRelativePath,
} from "../features/project/projectUtils";
import { getLatexCompletionContext } from "../latex/completionContext";
import type { CitationEntry } from "../latex/latexIndex";
import type { AppCtx16 } from "./appContext";

const recentStorageKey = "latexdo.citations.recent.v1";
const maxRememberedKeys = 12;

function loadRememberedKeys(projectId: string | null): string[] {
  if (!projectId) return [];
  try {
    const stored = JSON.parse(window.localStorage.getItem(recentStorageKey) ?? "{}");
    const keys = stored?.[projectId];
    return Array.isArray(keys) ? keys.filter((key) => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function rememberKeys(projectId: string | null, keys: string[]): void {
  if (!projectId) return;
  try {
    const stored = JSON.parse(window.localStorage.getItem(recentStorageKey) ?? "{}");
    window.localStorage.setItem(
      recentStorageKey,
      JSON.stringify({ ...(stored ?? {}), [projectId]: keys }),
    );
  } catch {
    // History is a convenience; the citation itself is already inserted.
  }
}

/** The citation picker's history, online search and "add from the internet". */
export function useAppCitationAssistant(ctx: AppCtx16) {
  const {
    citationAnalysis,
    citationProjectFiles,
    documentsRef,
    editorRef,
    setDocuments,
    handleAppendBibEntry,
    insertCitationFromSearch,
    projectEntriesRef,
    projectIdRef,
    refreshProject,
    setStatusMessage,
  } = ctx;
  const pickedKeysRef = useRef<{ projectId: string | null; keys: string[] }>({
    projectId: null,
    keys: [],
  });

  const pickedKeys = useCallback((): string[] => {
    const projectId = projectIdRef.current;
    if (pickedKeysRef.current.projectId !== projectId) {
      pickedKeysRef.current = { projectId, keys: loadRememberedKeys(projectId) };
    }
    return pickedKeysRef.current.keys;
  }, [projectIdRef]);

  const rememberPick = useCallback(
    (key: string) => {
      const keys = [key, ...pickedKeys().filter((item) => item !== key)].slice(
        0,
        maxRememberedKeys,
      );
      pickedKeysRef.current = { projectId: projectIdRef.current, keys };
      rememberKeys(projectIdRef.current, keys);
    },
    [pickedKeys, projectIdRef],
  );

  const readCitationContext = useCallback((): CitationSearchContext => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const position = editor?.getPosition();
    if (!model || !position) return { recentKeys: pickedKeys(), sentence: "" };
    const text = model.getValue();
    const offset = model.getOffsetAt(position);
    const typing = getLatexCompletionContext(
      model.getLineContent(position.lineNumber),
      position.column,
    );
    return {
      recentKeys: recentCitationKeys(text, offset, pickedKeys()),
      sentence: citationContextWindow(text, offset),
      query: typing?.type === "citation" ? typing.currentText : "",
    };
  }, [editorRef, pickedKeys]);

  const pickCitation = useCallback(
    (entry: CitationEntry) => {
      rememberPick(entry.key);
      insertCitationFromSearch(entry);
    },
    [insertCitationFromSearch, rememberPick],
  );

  const searchCitationsOnline = useCallback(
    async (query: string, signal: AbortSignal): Promise<ScholarlyPaper[]> => {
      const options = { signal, perProviderLimit: 8 };
      const results = await Promise.allSettled([
        searchCrossref(query, options),
        searchOpenAlex(query, options),
      ]);
      const found = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      if (!found.length) throw new Error("No scholarly index answered.");
      return mergeOnlinePapers(found);
    },
    [],
  );

  const addOnlineCitation = useCallback(
    async (paper: ScholarlyPaper) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) {
        setStatusMessage("Open a project before adding references.");
        return;
      }
      const { key, bibtex } = bibtexForPaper(
        paper,
        citationAnalysis.entries.map((entry) => entry.key),
      );
      const bibFiles = flattenEntries(projectEntriesRef.current).filter(
        (entry) => entry.type === "file" && entry.name.endsWith(".bib"),
      );
      // Prefer the bibliography that already holds most of the references.
      const counts = new Map<string, number>();
      for (const entry of citationAnalysis.entries) {
        const file = normalizeRelativePath(entry.sourceFile);
        counts.set(file, (counts.get(file) ?? 0) + 1);
      }
      const target = [...bibFiles].sort(
        (a, b) =>
          (counts.get(normalizeRelativePath(b.relativePath)) ?? 0) -
          (counts.get(normalizeRelativePath(a.relativePath)) ?? 0),
      )[0];
      try {
        if (target) {
          await handleAppendBibEntry(target.relativePath, bibtex);
        } else {
          await window.latexdo.writeFile(
            currentProject,
            "references.bib",
            `${bibtex}\n`,
          );
          await refreshProject(currentProject);
        }
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Could not add the reference.",
        );
        return;
      }
      pickCitation({ key, type: "article", title: paper.title, sourceFile: "" });
      setStatusMessage(
        target
          ? `Added ${key} to ${target.relativePath} and cited it.`
          : `Created references.bib with ${key} and cited it. Add \\bibliography{references} to your document to print it.`,
      );
    },
    [
      citationAnalysis.entries,
      handleAppendBibEntry,
      pickCitation,
      projectEntriesRef,
      projectIdRef,
      refreshProject,
      setStatusMessage,
    ],
  );

  /** Writes every .bib file of the project into references.bib (#230). */
  const mergeBibliographyFiles = useCallback(async () => {
    const currentProject = projectIdRef.current;
    if (!currentProject) return;
    const openDocuments = new Map(
      documentsRef.current.map((document) => [
        normalizeRelativePath(document.relativePath),
        document.content,
      ]),
    );
    const current = (file: { path: string; content: string }) => ({
      path: file.path,
      content: openDocuments.get(normalizeRelativePath(file.path)) ?? file.content,
    });
    const bibFiles = citationProjectFiles
      .filter((file) => file.path.endsWith(".bib"))
      .map(current);
    if (bibFiles.length < 2) {
      setStatusMessage(
        "This project has only one .bib file; there is nothing to merge.",
      );
      return;
    }
    const target = "references.bib";
    const merged = mergeBibliographies(bibFiles);
    const retargeted = citationProjectFiles
      .filter((file) => file.path.endsWith(".tex"))
      .map(current)
      .flatMap((file) => {
        const next = retargetBibliographyCommands(
          file.content,
          bibFiles.map((bib) => bib.path),
          target,
        );
        return next === null ? [] : [{ path: file.path, content: next }];
      });
    const plural = (count: number, word: string) =>
      `${count} ${word}${count === 1 ? "" : "s"}`;
    const summary = [
      `${merged.entryCount} entries`,
      merged.duplicates.length
        ? `${plural(merged.duplicates.length, "duplicate")} removed`
        : "",
      merged.conflicts.length
        ? `${plural(merged.conflicts.length, "key")} defined differently (the first is kept and noted at the top of the file)`
        : "",
    ]
      .filter(Boolean)
      .join(", ");
    if (
      !window.confirm(
        `Merge ${bibFiles.length} .bib files into ${target}?\n\n${summary}.\n` +
          `${plural(retargeted.length, ".tex file")} will point to ${target}. ` +
          "The old .bib files are kept; delete them when you are happy with the result.",
      )
    ) {
      return;
    }
    try {
      const writes = [{ path: target, content: merged.content }, ...retargeted];
      for (const write of writes) {
        await window.latexdo.writeFile(currentProject, write.path, write.content);
      }
      const written = new Map(
        writes.map((write) => [normalizeRelativePath(write.path), write.content]),
      );
      setDocuments((documents) => {
        const next = documents.map((document) => {
          const content = written.get(normalizeRelativePath(document.relativePath));
          return content === undefined
            ? document
            : { ...document, content, savedContent: content };
        });
        documentsRef.current = next;
        return next;
      });
      await refreshProject(currentProject);
      setStatusMessage(
        `Merged ${bibFiles.length} .bib files into ${target} (${merged.entryCount} entries).`,
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Could not merge the .bib files.",
      );
    }
  }, [
    citationProjectFiles,
    documentsRef,
    projectIdRef,
    refreshProject,
    setDocuments,
    setStatusMessage,
  ]);

  const removeUnusedBibliographyEntries = useCallback(async () => {
    const project = projectIdRef.current;
    if (!project) return;
    try {
      const files = await Promise.all(
        citationProjectFiles.map(async (file) => {
          const open = documentsRef.current.find(
            (document) =>
              normalizeRelativePath(document.relativePath) ===
              normalizeRelativePath(file.path),
          );
          return {
            path: file.path,
            content:
              open?.content ?? (await window.latexdo.readFile(project, file.path)),
          };
        }),
      );
      if (projectIdRef.current !== project) return;
      const changes = removeUnusedBibliography(files);
      if (!changes.length) {
        setStatusMessage(
          "No unused entries can be removed. Entries retained by nocite or bibliography dependencies are kept.",
        );
        return;
      }
      const count = changes.reduce((sum, file) => sum + file.removed.length, 0);
      if (
        !window.confirm(
          `Remove ${count} unused bibliography entries?\n\n${changes.map((file) => `${file.path}: ${file.removed.join(", ")}`).join("\n")}\n\nOriginal files will be backed up in .latexdo/recovery.`,
        )
      )
        return;
      const backup = `.latexdo/recovery/bibliography-${Date.now()}.json`;
      await window.latexdo.writeFile(
        project,
        backup,
        JSON.stringify(
          files.filter((file) => changes.some((change) => change.path === file.path)),
          null,
          2,
        ),
      );
      for (const change of changes) {
        await window.latexdo.writeFile(project, change.path, change.content);
        if (projectIdRef.current !== project) continue;
        setDocuments((documents) => {
          const next = documents.map((document) =>
            normalizeRelativePath(document.relativePath) ===
            normalizeRelativePath(change.path)
              ? { ...document, content: change.content, savedContent: change.content }
              : document,
          );
          documentsRef.current = next;
          return next;
        });
      }
      if (projectIdRef.current === project) {
        await refreshProject(project);
        setStatusMessage(
          `Removed ${count} unused bibliography entries. Backup: ${backup}`,
        );
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Could not remove unused entries.",
      );
    }
  }, [
    citationProjectFiles,
    documentsRef,
    projectIdRef,
    refreshProject,
    setDocuments,
    setStatusMessage,
  ]);

  return {
    removeUnusedBibliographyEntries,
    readCitationContext,
    pickCitation,
    searchCitationsOnline,
    addOnlineCitation,
    mergeBibliographyFiles,
  };
}
