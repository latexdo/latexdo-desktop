/*
 * Cmd/Ctrl+F: one find panel for the current file and the whole project, with
 * every project-search feature (case, whole word, regex, include/exclude,
 * context, copy). Cmd/Ctrl+Shift+F opens it on the whole project. Enter and
 * Shift+Enter step through the matches; Escape closes it.
 */

import React from "react";
import { X } from "lucide-react";
import { ProjectSearchPanel } from "./ProjectSearchPanel";
import type { ProjectSearchFile, ProjectSearchMatch } from "../search/projectSearch";

export type FindScope = "file" | "project";

const openFindEvent = "latexdo:open-find";

interface OpenFindDetail {
  scope?: FindScope;
  query?: string;
}

/** Opens the find panel from anywhere (editor actions, menus, shortcuts). */
export function requestFind(detail: OpenFindDetail = {}): void {
  window.dispatchEvent(new CustomEvent<OpenFindDetail>(openFindEvent, { detail }));
}

/** A selection only seeds the query when it is a short single line. */
export function findSeedFromSelection(selection: string | null | undefined): string {
  const text = selection ?? "";
  return text && !text.includes("\n") && text.length <= 200 ? text : "";
}

interface FindPanelProps {
  /** Every searchable project file. */
  files: ProjectSearchFile[];
  /** The open document, with its live (possibly unsaved) content. */
  activeFile: ProjectSearchFile | null;
  loading?: boolean;
  error?: string;
  onOpenMatch: (match: ProjectSearchMatch) => void;
  onRefresh?: () => void;
  /** Called after closing, e.g. to give focus back to the editor. */
  onClosed?: () => void;
}

export function FindPanel({
  files,
  activeFile,
  loading,
  error,
  onOpenMatch,
  onRefresh,
  onClosed,
}: FindPanelProps) {
  const [state, setState] = React.useState<{
    scope: FindScope;
    query: string;
    nonce: number;
  } | null>(null);

  React.useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenFindDetail>).detail ?? {};
      setState((current) => ({
        scope: detail.scope ?? current?.scope ?? "file",
        query: detail.query || current?.query || "",
        nonce: (current?.nonce ?? 0) + 1,
      }));
    };
    // Outside the editor (which has its own Cmd/Ctrl+F action) the same keys
    // open the panel instead of the browser's page search.
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      requestFind({
        scope: event.shiftKey ? "project" : undefined,
        query: findSeedFromSelection(window.getSelection()?.toString()),
      });
    };
    window.addEventListener(openFindEvent, onOpen);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(openFindEvent, onOpen);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  if (!state) return null;
  const close = () => {
    setState(null);
    onClosed?.();
  };
  const scopedFiles = state.scope === "file" ? (activeFile ? [activeFile] : []) : files;

  return (
    <section className="find-panel" role="dialog" aria-label="Find">
      <header className="find-panel-header">
        <div className="find-panel-scope" role="radiogroup" aria-label="Search in">
          {(
            [
              ["file", "This file"],
              ["project", "All files"],
            ] as const
          ).map(([scope, label]) => (
            <button
              key={scope}
              type="button"
              role="radio"
              aria-checked={state.scope === scope}
              className={state.scope === scope ? "active" : ""}
              onClick={() => setState((current) => current && { ...current, scope })}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="small-icon"
          onClick={close}
          title="Close (Escape)"
          aria-label="Close find"
        >
          <X size={14} />
        </button>
      </header>
      <ProjectSearchPanel
        key={state.nonce}
        compact
        autoFocus
        initialQuery={state.query}
        placeholder={state.scope === "file" ? "Find in this file" : "Find in all files"}
        files={scopedFiles}
        loading={state.scope === "project" && loading}
        error={state.scope === "project" ? error : ""}
        activePath={activeFile?.path}
        onOpenMatch={onOpenMatch}
        onRefresh={onRefresh}
        onClose={close}
      />
    </section>
  );
}
