/*
 * The Source Control view, laid out like the one in Visual Studio Code: a
 * Changes section (message box, Commit split button, Staged and Changes
 * groups) above a resizable Graph section of the commit history.
 *
 * Layout, wording and behaviour follow the SCM view and Git extension of
 * Visual Studio Code:
 *
 *   Copyright (c) Microsoft Corporation. All rights reserved.
 *   Licensed under the MIT License.
 *   https://github.com/microsoft/vscode/blob/main/LICENSE.txt
 */

import React from "react";
import type {
  GitChangeEntry,
  GitCommitFile,
  GitGraphCommit,
  GitStatusSummary,
} from "../types";
import type { GitAction, GitRepositoryInfo } from "../../electron/gitActions";
import {
  fileDirectory,
  gitStatusClass,
  gitStatusCode,
  gitStatusLabel,
  type GitChangeArea,
} from "../features/git/gitUi";
import { fileName } from "../features/project/projectUtils";
import { Codicon, fileCodicon, type CodiconName } from "./scm/Codicon";
import { ScmGraph, type CommitFilesState } from "./scm/ScmGraph";

export type ScmGroupId = "merge" | GitChangeArea;

export interface ScmCommitOptions {
  /** Stage every change, then commit (Commit All). */
  all?: boolean;
  amend?: boolean;
  push?: boolean;
  sync?: boolean;
}

export interface ScmGraphView {
  commits: GitGraphCommit[];
  loading: boolean;
  hasMore: boolean;
  refs: string;
  expanded: ReadonlySet<string>;
  files: ReadonlyMap<string, CommitFilesState>;
  revealHash: string | null;
  onLoadMore: () => void;
  onToggle: (commit: GitGraphCommit) => void;
  onOpenFile: (commit: GitGraphCommit, file: GitCommitFile) => void;
  onContextMenu: (commit: GitGraphCommit, x: number, y: number) => void;
  onBranchContextMenu?: (branch: string) => void;
  onChooseRefs: () => void;
  onGoToCurrent: () => void;
  onRefresh: () => void;
}

export interface SourceControlViewProps {
  status: GitStatusSummary | null;
  info: GitRepositoryInfo | null;
  loading: boolean;
  busy: string | null;
  error: string;
  onDismissError: () => void;
  message: string;
  onMessageChange: (message: string) => void;
  /** Previous commit messages, newest first, for ↑ / ↓ in the message box. */
  messageHistory?: () => string[];
  commitState?: "idle" | "busy" | "success" | "error";
  /** Offered only when an assistant is set up. */
  onSuggestMessage?: () => void;
  suggestingMessage?: boolean;
  /** Path of the file whose diff is open, to highlight its row. */
  activeDiff?: { path: string; area: GitChangeArea } | null;
  onCommit: (options?: ScmCommitOptions) => void;
  onAction: (action: GitAction) => void;
  onRefresh: () => void;
  onInit: () => void;
  onPickBranch: () => void;
  onCreateBranch: () => void;
  onDeleteBranch: () => void;
  onPublish: () => void;
  onStash: () => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onDiscard: (path: string) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onDiscardAll: () => void;
  onOpenDiff: (entry: GitChangeEntry, area: GitChangeArea) => void;
  onOpenFile: (path: string) => void;
  onContextMenu: (
    entry: GitChangeEntry,
    area: GitChangeArea,
    x: number,
    y: number,
  ) => void;
  /** The commit graph; without it the Graph section is not shown. */
  graph?: ScmGraphView;
}

const viewModeKey = "latexdo.scm.viewMode";
const graphHeightKey = "latexdo.scm.graphHeight";
const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
const commitKey = isMac ? "⌘Enter" : "Ctrl+Enter";

function readStored<T>(key: string, parse: (value: string | null) => T): T {
  try {
    return parse(window.localStorage.getItem(key));
  } catch {
    return parse(null);
  }
}

function store(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A remembered layout is a convenience.
  }
}

interface TreeFolder {
  name: string;
  path: string;
  folders: TreeFolder[];
  entries: GitChangeEntry[];
}

function buildTree(entries: GitChangeEntry[]): TreeFolder {
  const root: TreeFolder = { name: "", path: "", folders: [], entries: [] };
  for (const entry of entries) {
    const parts = entry.path.split("/");
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      const path = folder.path ? `${folder.path}/${part}` : part;
      let next = folder.folders.find((item) => item.name === part);
      if (!next) {
        next = { name: part, path, folders: [], entries: [] };
        folder.folders.push(next);
      }
      folder = next;
    }
    folder.entries.push(entry);
  }
  const sort = (folder: TreeFolder) => {
    folder.folders.sort((a, b) => a.name.localeCompare(b.name));
    folder.entries.sort((a, b) => a.path.localeCompare(b.path));
    folder.folders.forEach(sort);
  };
  sort(root);
  return root;
}

/** A small icon button, VS Code style: icon only, with a tooltip and a label. */
function IconButton({
  icon,
  label,
  onClick,
  disabled,
  spin,
  className,
  title,
  ...rest
}: {
  icon: CodiconName;
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  spin?: boolean;
  className?: string;
  title?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "title">) {
  return (
    <button
      type="button"
      className={["scm-icon-button", className].filter(Boolean).join(" ")}
      title={title ?? label}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick(event);
      }}
      {...rest}
    >
      <Codicon name={icon} spin={spin} />
    </button>
  );
}

type MenuItem = { label: string; run: () => void; disabled?: boolean } | "separator";

/** A VS Code-style menu: arrow keys, Enter, Escape, closes on outside click. */
function Menu({
  items,
  onClose,
  align = "right",
  label,
}: {
  items: MenuItem[];
  onClose: () => void;
  align?: "left" | "right";
  label: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("mousedown", outside);
    return () => window.removeEventListener("mousedown", outside);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className={`scm-menu ${align}`}
      role="menu"
      aria-label={label}
      onKeyDown={(event) => {
        const buttons = [
          ...(ref.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ) ?? []),
        ];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          buttons[(index + step + buttons.length) % buttons.length]?.focus();
        }
      }}
    >
      {items.map((item, index) =>
        item === "separator" ? (
          <span
            key={`separator-${index}`}
            className="scm-menu-separator"
            role="separator"
          />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

export function SourceControlView(props: SourceControlViewProps) {
  const {
    status,
    info,
    busy,
    error,
    message,
    onMessageChange,
    onCommit,
    onAction,
    graph,
  } = props;
  const [viewMode, setViewMode] = React.useState(() =>
    readStored(viewModeKey, (value) => (value === "tree" ? "tree" : "list")),
  );
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  const [menu, setMenu] = React.useState<"more" | "commit" | null>(null);
  const [changesOpen, setChangesOpen] = React.useState(true);
  const [graphOpen, setGraphOpen] = React.useState(true);
  const [graphHeight, setGraphHeight] = React.useState(() =>
    readStored(graphHeightKey, (value) => {
      const height = Number(value);
      return Number.isFinite(height) && height >= 80 ? height : 260;
    }),
  );
  const historyIndex = React.useRef(-1);
  const messageRef = React.useRef<HTMLTextAreaElement>(null);
  const viewRef = React.useRef<HTMLDivElement>(null);
  const closeMenu = React.useCallback(() => setMenu(null), []);

  React.useEffect(() => store(viewModeKey, viewMode), [viewMode]);
  React.useEffect(() => store(graphHeightKey, String(graphHeight)), [graphHeight]);

  // Let the message box grow with its text, like VS Code's input.
  React.useLayoutEffect(() => {
    const box = messageRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
  }, [message]);

  if (!status?.isRepo) {
    return (
      <div className="scm-view">
        <div className="sidebar-header scm-title">
          <span>Source Control</span>
          <span className="scm-title-actions">
            <IconButton
              icon="refresh"
              label="Refresh source control"
              onClick={props.onRefresh}
              spin={props.loading}
            />
          </span>
        </div>
        <div className="scm-welcome">
          <p>
            {status?.error && !/not a git repository/i.test(status.error)
              ? status.error
              : "This folder is not a Git repository yet. Git keeps every version of your paper and can sync it with GitHub, GitLab or Overleaf."}
          </p>
          <button
            type="button"
            className="scm-primary-button"
            onClick={props.onInit}
            disabled={busy === "init"}
          >
            {busy === "init" ? "Initializing…" : "Initialize Repository"}
          </button>
        </div>
      </div>
    );
  }

  const entries = status.entries;
  const merge = entries.filter((entry) => entry.conflicted);
  const staged = entries.filter((entry) => !entry.conflicted && entry.staged);
  const changes = entries.filter(
    (entry) => !entry.conflicted && (entry.unstaged || entry.untracked),
  );
  const branch = status.branch ?? "HEAD";
  const ahead = status.ahead ?? 0;
  const behind = status.behind ?? 0;
  const hasUpstream = Boolean(status.upstream);
  const working = busy !== null;
  const hasChanges = entries.length > 0;
  const commitState = props.commitState ?? (busy === "commit" ? "busy" : "idle");

  const primary = {
    name: "Commit",
    icon: (commitState === "success"
      ? "pass"
      : commitState === "error"
        ? "error"
        : "check") as CodiconName,
    text:
      commitState === "busy"
        ? "Committing…"
        : commitState === "success"
          ? "Committed"
          : commitState === "error"
            ? "Commit failed"
            : "Commit",
    title: `Commit the staged changes on "${branch}" (${commitKey})`,
    run: () => onCommit(),
  };

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const row = (entry: GitChangeEntry, area: GitChangeArea, depth: number) => {
    const code = entry.conflicted ? "!" : gitStatusCode(entry, area);
    const label = gitStatusLabel(code);
    const active =
      props.activeDiff?.path === entry.path && props.activeDiff.area === area;
    return (
      <div
        key={`${area}:${entry.path}`}
        className={`scm-resource ${gitStatusClass(code)} ${active ? "active" : ""}`}
        style={{ "--scm-depth": depth } as React.CSSProperties}
        onContextMenu={(event) => {
          event.preventDefault();
          props.onContextMenu(entry, area, event.clientX, event.clientY);
        }}
      >
        <button
          type="button"
          className="scm-resource-main"
          aria-label={`Open ${area === "staged" ? "staged" : "working tree"} diff for ${entry.path}`}
          title={`${entry.path} • ${label}`}
          onClick={() => props.onOpenDiff(entry, area)}
          onDoubleClick={() => props.onOpenFile(entry.path)}
        >
          <Codicon name={fileCodicon(entry.path)} className="scm-file-icon" />
          <span className="scm-resource-name">{fileName(entry.path)}</span>
          {viewMode === "list" && entry.path.includes("/") ? (
            <span className="scm-resource-description">
              {fileDirectory(entry.path)}
            </span>
          ) : null}
        </button>
        <span className="scm-resource-actions">
          <IconButton
            icon="go-to-file"
            label={`Open file ${entry.path}`}
            title="Open File"
            onClick={() => props.onOpenFile(entry.path)}
          />
          {area === "staged" ? (
            <IconButton
              icon="remove"
              label={`Unstage ${entry.path}`}
              title="Unstage Changes"
              disabled={busy === `unstage:${entry.path}`}
              onClick={() => props.onUnstage(entry.path)}
            />
          ) : (
            <>
              {!entry.conflicted ? (
                <IconButton
                  icon="discard"
                  label={`Discard ${entry.path}`}
                  title="Discard Changes"
                  disabled={busy === `discard:${entry.path}`}
                  onClick={() => props.onDiscard(entry.path)}
                />
              ) : null}
              <IconButton
                icon="add"
                label={`Stage ${entry.path}`}
                title={entry.conflicted ? "Mark as Resolved (Stage)" : "Stage Changes"}
                disabled={busy === `stage:${entry.path}`}
                onClick={() => props.onStage(entry.path)}
              />
            </>
          )}
        </span>
        <span className="scm-resource-letter" title={label}>
          {code}
        </span>
      </div>
    );
  };

  const tree = (
    folder: TreeFolder,
    area: GitChangeArea,
    depth: number,
  ): React.ReactNode[] => [
    ...folder.folders.flatMap((child) => {
      const id = `${area}:dir:${child.path}`;
      const open = !collapsed.has(id);
      return [
        <button
          key={id}
          type="button"
          className="scm-folder"
          style={{ "--scm-depth": depth } as React.CSSProperties}
          aria-expanded={open}
          onClick={() => toggle(id)}
        >
          <Codicon name={open ? "chevron-down" : "chevron-right"} />
          <span>{child.name}</span>
        </button>,
        ...(open ? tree(child, area, depth + 1) : []),
      ];
    }),
    ...folder.entries.map((entry) => row(entry, area, depth)),
  ];

  const group = (
    id: ScmGroupId,
    title: string,
    list: GitChangeEntry[],
    actions: React.ReactNode,
  ) => {
    if (!list.length) return null;
    const open = !collapsed.has(id);
    const area: GitChangeArea = id === "staged" ? "staged" : "changes";
    return (
      <div className="scm-group" key={id}>
        <div className="scm-group-header">
          <button
            type="button"
            className="scm-group-toggle"
            aria-expanded={open}
            onClick={() => toggle(id)}
          >
            <Codicon name={open ? "chevron-down" : "chevron-right"} />
            <span>{title}</span>
          </button>
          <span className="scm-group-actions">{actions}</span>
          <span className="scm-count" aria-label={`${list.length} files`}>
            {list.length}
          </span>
        </div>
        {open ? (
          <div className="scm-group-body" role="list">
            {viewMode === "tree"
              ? tree(buildTree(list), area, 1)
              : list.map((entry) => row(entry, area, 1))}
          </div>
        ) : null}
      </div>
    );
  };

  const moreItems: MenuItem[] = [
    { label: "Pull", run: () => onAction({ kind: "pull" }), disabled: !hasUpstream },
    { label: "Push", run: () => onAction({ kind: "push" }) },
    { label: "Fetch", run: () => onAction({ kind: "fetch" }) },
    { label: "Checkout to…", run: props.onPickBranch },
    "separator",
    { label: "Commit All", run: () => onCommit({ all: true }), disabled: !hasChanges },
    {
      label: "Undo Last Commit",
      run: () => onAction({ kind: "undo-last-commit" }),
      disabled: !info?.hasCommits,
    },
    "separator",
    { label: "Create Branch…", run: props.onCreateBranch },
    { label: "Delete Branch…", run: props.onDeleteBranch },
    { label: "Publish Branch…", run: props.onPublish, disabled: hasUpstream },
    "separator",
    { label: "Stash (Include Untracked)", run: props.onStash, disabled: !hasChanges },
    {
      label: `Pop Latest Stash${info?.stashCount ? ` (${info.stashCount})` : ""}`,
      run: () => onAction({ kind: "stash-pop" }),
      disabled: !info?.stashCount,
    },
  ];

  const commitItems: MenuItem[] = [
    { label: "Commit Staged", run: () => onCommit(), disabled: !staged.length },
    { label: "Commit All", run: () => onCommit({ all: true }), disabled: !hasChanges },
    { label: "Commit & Push", run: () => onCommit({ push: true }) },
    {
      label: "Commit & Sync",
      run: () => onCommit({ sync: true }),
      disabled: !hasUpstream,
    },
    "separator",
    {
      label: "Commit (Amend)…",
      run: () => onCommit({ amend: true }),
      disabled: !info?.hasCommits,
    },
  ];

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = graphHeight;
    const max = Math.max(120, (viewRef.current?.clientHeight ?? 600) - 140);
    const move = (moveEvent: PointerEvent) =>
      setGraphHeight(
        Math.min(max, Math.max(80, startHeight - (moveEvent.clientY - startY))),
      );
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  return (
    <div className="scm-view" ref={viewRef}>
      <div className="sidebar-header scm-title">
        <span>Source Control</span>
      </div>

      <div className={`scm-changes-pane ${changesOpen ? "open" : ""}`}>
        <div className="scm-pane-header">
          <button
            type="button"
            className="scm-group-toggle"
            aria-expanded={changesOpen}
            onClick={() => setChangesOpen(!changesOpen)}
          >
            <Codicon name={changesOpen ? "chevron-down" : "chevron-right"} />
            <span>Changes</span>
          </button>
          <span className="scm-group-actions">
            <IconButton
              icon={viewMode === "list" ? "list-tree" : "list-flat"}
              label={viewMode === "list" ? "View as Tree" : "View as List"}
              onClick={() => setViewMode(viewMode === "list" ? "tree" : "list")}
            />
            <span className="scm-menu-anchor">
              <IconButton
                icon="ellipsis"
                label="More Source Control actions"
                aria-haspopup="menu"
                aria-expanded={menu === "more"}
                onClick={() => setMenu(menu === "more" ? null : "more")}
              />
              {menu === "more" ? (
                <Menu
                  label="Source Control actions"
                  items={moreItems}
                  onClose={closeMenu}
                />
              ) : null}
            </span>
          </span>
        </div>

        {changesOpen ? (
          <div className="scm-changes-body">
            {error ? (
              <div className="scm-error" role="alert">
                <span>{error}</span>
                <IconButton
                  icon="close"
                  label="Dismiss"
                  onClick={props.onDismissError}
                />
              </div>
            ) : null}

            <div className="scm-repository-toolbar" aria-label="Repository actions">
              <button
                type="button"
                className="scm-branch-button"
                title={`Switch branch (${branch})`}
                aria-label={`Switch branch: ${branch}`}
                onClick={props.onPickBranch}
                disabled={working}
              >
                <Codicon name="git-branch" />
                <span>{branch}</span>
              </button>
              <div className="scm-repository-actions">
                <IconButton
                  icon={hasUpstream ? "sync" : "cloud-upload"}
                  label={hasUpstream ? "Sync Changes" : "Publish Branch"}
                  title={
                    hasUpstream
                      ? `Sync ${behind} incoming and ${ahead} outgoing commits`
                      : `Publish "${branch}"`
                  }
                  disabled={working}
                  onClick={() =>
                    hasUpstream ? onAction({ kind: "sync" }) : props.onPublish()
                  }
                />
                {props.onSuggestMessage ? (
                  <IconButton
                    icon="sparkle"
                    label="Generate commit message"
                    disabled={working || props.suggestingMessage || !hasChanges}
                    onClick={props.onSuggestMessage}
                  />
                ) : null}
                <IconButton
                  icon="repo-pull"
                  label="Pull changes"
                  disabled={working || !hasUpstream}
                  onClick={() => onAction({ kind: "pull" })}
                />
                <IconButton
                  icon="git-compare"
                  label="Checkout to…"
                  disabled={working}
                  onClick={props.onPickBranch}
                />
                <IconButton
                  icon="check"
                  label={`Commit (${commitKey})`}
                  disabled={working || !hasChanges || !message.trim()}
                  onClick={() => onCommit()}
                />
                <IconButton
                  icon="refresh"
                  label="Refresh source control"
                  spin={props.loading}
                  disabled={working}
                  onClick={props.onRefresh}
                />
              </div>
            </div>

            <div className="scm-input">
              <textarea
                ref={messageRef}
                rows={1}
                aria-label="Commit message"
                value={message}
                placeholder={`Message (${commitKey} to commit on "${branch}")`}
                onChange={(event) => {
                  historyIndex.current = -1;
                  onMessageChange(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    if (!working && hasChanges && message.trim()) onCommit();
                    return;
                  }
                  // ↑ at the start of the box recalls earlier messages, as in VS Code.
                  const box = event.currentTarget;
                  const history = props.messageHistory?.() ?? [];
                  if (
                    (event.key === "ArrowUp" || event.key === "ArrowDown") &&
                    history.length &&
                    !event.shiftKey &&
                    (event.key === "ArrowUp"
                      ? box.selectionStart === 0
                      : box.selectionEnd === box.value.length)
                  ) {
                    const next =
                      event.key === "ArrowUp"
                        ? Math.min(history.length - 1, historyIndex.current + 1)
                        : historyIndex.current - 1;
                    if (next === historyIndex.current || next < -1) return;
                    event.preventDefault();
                    historyIndex.current = next;
                    onMessageChange(next < 0 ? "" : history[next]);
                  }
                }}
              />
              {props.onSuggestMessage ? (
                <IconButton
                  icon={props.suggestingMessage ? "loading" : "sparkle"}
                  spin={props.suggestingMessage}
                  className="scm-input-action"
                  label="Suggest a commit message with AI"
                  disabled={props.suggestingMessage || !hasChanges}
                  onClick={props.onSuggestMessage}
                />
              ) : null}
            </div>

            <div className="scm-action-button">
              <button
                type="button"
                className={`scm-primary-button ${commitState}`}
                aria-label={primary.name}
                title={primary.title}
                disabled={
                  working || commitState === "busy" || !hasChanges || !message.trim()
                }
                onClick={primary.run}
              >
                <span>{primary.text}</span>
                <Codicon
                  name={commitState === "busy" ? "loading" : primary.icon}
                  spin={commitState === "busy"}
                />
              </button>
              {primary.name === "Commit" ? (
                <span className="scm-menu-anchor">
                  <button
                    type="button"
                    className="scm-primary-button scm-primary-dropdown"
                    aria-label="More commit actions"
                    aria-haspopup="menu"
                    aria-expanded={menu === "commit"}
                    disabled={working || commitState === "busy"}
                    onClick={() => setMenu(menu === "commit" ? null : "commit")}
                  >
                    <Codicon name="chevron-down" />
                  </button>
                  {menu === "commit" ? (
                    <Menu
                      label="Commit actions"
                      items={commitItems}
                      onClose={closeMenu}
                    />
                  ) : null}
                </span>
              ) : null}
            </div>

            <div className="scm-groups">
              {group("merge", "Merge Changes", merge, null)}
              {group(
                "staged",
                "Staged Changes",
                staged,
                <IconButton
                  icon="remove"
                  label="Unstage all changes"
                  title="Unstage All Changes"
                  disabled={busy === "unstage-all"}
                  onClick={props.onUnstageAll}
                />,
              )}
              {group(
                "changes",
                "Changes",
                changes,
                <>
                  <IconButton
                    icon="discard"
                    label="Discard all unstaged changes"
                    title="Discard All Changes"
                    disabled={busy === "discard-all"}
                    onClick={props.onDiscardAll}
                  />
                  <IconButton
                    icon="add"
                    label="Stage all changes"
                    title="Stage All Changes"
                    disabled={busy === "stage-all"}
                    onClick={props.onStageAll}
                  />
                </>,
              )}
              {!hasChanges ? (
                <p className="scm-clean">
                  No changes on {branch}
                  {hasUpstream ? ` · ${behind}↓ ${ahead}↑` : ""}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {graph ? (
        <>
          {graphOpen && changesOpen ? (
            <div
              className="scm-sash"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize the graph"
              tabIndex={0}
              onPointerDown={startResize}
              onKeyDown={(event) => {
                if (event.key === "ArrowUp") setGraphHeight((height) => height + 20);
                if (event.key === "ArrowDown")
                  setGraphHeight((height) => Math.max(80, height - 20));
              }}
            />
          ) : null}
          <div
            className={`scm-graph-section ${graphOpen ? "open" : ""} ${
              changesOpen ? "" : "fill"
            }`}
            style={graphOpen && changesOpen ? { height: graphHeight } : undefined}
          >
            <div className="scm-pane-header">
              <button
                type="button"
                className="scm-group-toggle"
                aria-expanded={graphOpen}
                aria-label="Graph"
                onClick={() => setGraphOpen(!graphOpen)}
              >
                <Codicon name={graphOpen ? "chevron-down" : "chevron-right"} />
                <span>Graph</span>
              </button>
              <span className="scm-group-actions always">
                <button
                  type="button"
                  className="scm-graph-refs-button"
                  title="Choose the branches shown in the graph"
                  aria-label="Choose the branches shown in the graph"
                  onClick={graph.onChooseRefs}
                >
                  <Codicon name="git-branch" />
                  <span>
                    {graph.refs === "auto"
                      ? "Auto"
                      : graph.refs === "all"
                        ? "All"
                        : graph.refs}
                  </span>
                </button>
                <IconButton
                  icon="target"
                  label="Go to Current Commit"
                  onClick={graph.onGoToCurrent}
                />
                <IconButton
                  icon="repo-fetch"
                  label="Fetch"
                  disabled={working}
                  onClick={() => onAction({ kind: "fetch" })}
                />
                <IconButton
                  icon="repo-pull"
                  label={`Pull${behind ? ` (${behind})` : ""}`}
                  disabled={working || !hasUpstream}
                  onClick={() => onAction({ kind: "pull" })}
                />
                <IconButton
                  icon="repo-push"
                  label={`Push${ahead ? ` (${ahead})` : ""}`}
                  disabled={working}
                  onClick={() => onAction({ kind: "push" })}
                />
                <IconButton
                  icon="refresh"
                  label="Refresh the graph"
                  spin={graph.loading}
                  onClick={graph.onRefresh}
                />
              </span>
            </div>
            {graphOpen ? (
              <ScmGraph
                commits={graph.commits}
                loading={graph.loading}
                hasMore={graph.hasMore}
                onLoadMore={graph.onLoadMore}
                expanded={graph.expanded}
                onToggle={graph.onToggle}
                files={graph.files}
                onOpenFile={graph.onOpenFile}
                onContextMenu={graph.onContextMenu}
                onBranchContextMenu={graph.onBranchContextMenu}
                revealHash={graph.revealHash}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

export type CommitMenuAction =
  | "copy-hash"
  | "copy-message"
  | "branch-at"
  | "tag"
  | "cherry-pick"
  | "revert"
  | "checkout-commit";

/** Actions on one commit of the graph, opened by right-click or its ⋯ button. */
export function CommitContextMenu({
  commit,
  x,
  y,
  onAction,
  onOpen,
  onClose,
}: {
  commit: GitGraphCommit;
  x: number;
  y: number;
  onAction: (kind: CommitMenuAction) => void;
  onOpen: () => void;
  onClose: () => void;
}) {
  const items: MenuItem[] = [
    { label: "Open Changes", run: onOpen },
    { label: "Copy Commit Hash", run: () => onAction("copy-hash") },
    { label: "Copy Commit Message", run: () => onAction("copy-message") },
    "separator",
    { label: "Create Branch…", run: () => onAction("branch-at") },
    { label: "Create Tag…", run: () => onAction("tag") },
    "separator",
    { label: "Checkout (Detached)…", run: () => onAction("checkout-commit") },
    { label: "Cherry Pick…", run: () => onAction("cherry-pick") },
    { label: "Revert Commit…", run: () => onAction("revert") },
  ];
  return (
    <div
      className="scm-floating-menu"
      style={{
        left: Math.min(x, window.innerWidth - 240),
        top: Math.min(y, window.innerHeight - 300),
      }}
    >
      <Menu
        label={`Actions for ${commit.shortHash}`}
        items={items}
        onClose={onClose}
        align="left"
      />
    </div>
  );
}
