import { useCallback, useEffect, useRef } from "react";
import { extensionLaunchTarget } from "../features/extensions/extensionLaunch";
import type { LatexDoExtensionManifest } from "../extensions";
import {
  flattenEntries,
  normalizeRelativePath,
} from "../features/project/projectUtils";
import { isTextDocument } from "./appShared";
import { toolTabIds } from "../features/workspace/toolTabs";
import type { AppCtx17 } from "./appContext";

const tabsStorageKey = "latexdo.session.tabs.v1";
const maxRememberedProjects = 30;

interface SavedTabs {
  open: string[];
  active: string;
  savedAt: number;
}

function readSavedTabs(): Record<string, SavedTabs> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(tabsStorageKey) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSavedTabs(projectPath: string, tabs: SavedTabs): void {
  try {
    const all = { ...readSavedTabs(), [projectPath]: tabs };
    const newest = Object.entries(all)
      .sort((a, b) => (b[1]?.savedAt ?? 0) - (a[1]?.savedAt ?? 0))
      .slice(0, maxRememberedProjects);
    window.localStorage.setItem(
      tabsStorageKey,
      JSON.stringify(Object.fromEntries(newest)),
    );
  } catch {
    // Remembering tabs is a convenience.
  }
}

/**
 * Closing LatexDo must not lose work (#229): unsaved tabs are saved before
 * the window closes, and a project reopens with the tabs it had.
 */
export function useAppSessionRestore(ctx: AppCtx17) {
  const {
    activePath,
    activePathRef,
    documents,
    documentsRef,
    extensionToolAvailability,
    openDocument,
    projectEntries,
    projectId,
    projectPath,
    saveDocument,
    setActivePath,
    setSettingsOpen,
    setSettingsTab,
    setStatusMessage,
    openToolTab,
  } = ctx;
  const restoredProjectRef = useRef<string | null>(null);
  const closingRef = useRef(false);
  const saveDocumentRef = useRef(saveDocument);
  saveDocumentRef.current = saveDocument;

  // Save unsaved tabs, then let the window close.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (closingRef.current) return;
      const unsaved = documentsRef.current.filter(
        (document) =>
          isTextDocument(document) && document.content !== document.savedContent,
      );
      if (!unsaved.length) return;
      event.preventDefault();
      event.returnValue = "";
      // The browser build cannot save before leaving; its prompt is enough.
      if (window.latexdo.runtime !== "desktop") return;
      closingRef.current = true;
      void (async () => {
        try {
          for (const document of unsaved) await saveDocumentRef.current(document);
        } catch (error) {
          closingRef.current = false;
          setStatusMessage(
            `LatexDo stayed open: ${
              error instanceof Error ? error.message : "a file could not be saved"
            }.`,
          );
          return;
        }
        window.close();
      })();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [documentsRef, setStatusMessage]);

  // Reopen the tabs this project had last time, once per project load.
  useEffect(() => {
    if (!projectId || !projectPath || restoredProjectRef.current === projectId) return;
    const entries = flattenEntries(projectEntries);
    if (!entries.length) return;
    restoredProjectRef.current = projectId;
    const saved = readSavedTabs()[projectPath];
    if (!saved?.open?.length) return;
    const byPath = new Map(
      entries
        .filter((entry) => entry.type === "file")
        .map((entry) => [normalizeRelativePath(entry.relativePath), entry]),
    );
    void (async () => {
      for (const relativePath of saved.open) {
        const entry = byPath.get(normalizeRelativePath(relativePath));
        if (
          !entry ||
          documentsRef.current.some((document) => document.path === entry.path)
        )
          continue;
        try {
          await openDocument(entry, projectId, { announce: false });
        } catch {
          // A tab that no longer opens is simply not restored.
        }
      }
      const active = byPath.get(normalizeRelativePath(saved.active));
      if (
        active &&
        documentsRef.current.some((document) => document.path === active.path)
      ) {
        setActivePath(active.path);
        activePathRef.current = active.path;
      }
    })();
  }, [
    activePathRef,
    documentsRef,
    openDocument,
    projectEntries,
    projectId,
    projectPath,
    setActivePath,
  ]);

  // Remember the open tabs as they change.
  useEffect(() => {
    if (!projectPath || restoredProjectRef.current !== projectId) return;
    const open = documents.map((document) => document.relativePath);
    const active =
      documents.find((document) => document.path === activePath)?.relativePath ?? "";
    writeSavedTabs(projectPath, { open, active, savedAt: Date.now() });
  }, [activePath, documents, projectId, projectPath]);

  /** Opens the tool or Settings page an installed extension adds (#225). */
  const openInstalledExtension = useCallback(
    (extension: LatexDoExtensionManifest): boolean => {
      let target = extensionLaunchTarget(extension);
      if (!target) return false;
      // A tool switched off in Settings opens its Settings page instead.
      const toolSettings = {
        tikzConverter: "tikz",
        notationManager: "notation",
        citationManager: "citation",
        tableGenerator: "editor",
      } as const;
      const available = {
        tikzConverter: extensionToolAvailability.tikzConverter,
        notationManager: extensionToolAvailability.notationManager,
        citationManager: extensionToolAvailability.projectBibliography,
        tableGenerator: extensionToolAvailability.tableGenerator,
      };
      if (target.kind === "tool" && !available[target.tool]) {
        target = { kind: "settings", tab: toolSettings[target.tool] };
      }
      if (target.kind === "settings") {
        setSettingsTab(target.tab);
        setSettingsOpen(true);
      } else if (target.tool === "tikzConverter") {
        openToolTab(toolTabIds.tikzConverter);
      } else if (target.tool === "notationManager") {
        openToolTab(toolTabIds.notationManager);
      } else if (target.tool === "citationManager") {
        openToolTab(toolTabIds.citationManager);
      } else {
        openToolTab(toolTabIds.tableGenerator);
      }
      return true;
    },
    [extensionToolAvailability, setSettingsOpen, setSettingsTab, openToolTab],
  );

  return { openInstalledExtension };
}
