/*
 * The Source Control graph, as in Visual Studio Code: one row per commit with
 * its lanes drawn in SVG behind the text, branch labels, and the files of a
 * commit listed under it when it is opened. Older commits load on scroll.
 *
 * Layout and behaviour follow VS Code's SCM history view (MIT License,
 * Copyright (c) Microsoft Corporation).
 */

import React from "react";
import type { GitCommitDetails, GitCommitFile, GitGraphCommit } from "../../types";
import { gitDiffStatusCode, gitStatusClass } from "../../features/git/gitUi";
import { Codicon, fileCodicon } from "./Codicon";

const rowHeight = 22;
const laneWidth = 12;
/** Lane colours come from the theme: accent first, then the git status hues. */
const laneColors = [
  "var(--accent)",
  "var(--scm-added)",
  "var(--scm-modified)",
  "var(--scm-renamed)",
  "var(--scm-deleted)",
  "var(--color-text-tertiary)",
];

export type CommitFilesState = GitCommitDetails | "loading" | { error: string };

export interface ScmGraphProps {
  commits: GitGraphCommit[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  expanded: ReadonlySet<string>;
  onToggle: (commit: GitGraphCommit) => void;
  files: ReadonlyMap<string, CommitFilesState>;
  onOpenFile: (commit: GitGraphCommit, file: GitCommitFile) => void;
  onContextMenu: (commit: GitGraphCommit, x: number, y: number) => void;
  /** Right-click on a branch label. */
  onBranchContextMenu?: (branch: string) => void;
  /** Scrolls this commit into view when it changes (Go to current). */
  revealHash?: string | null;
}

function laneColor(lane: number): string {
  return laneColors[Math.abs(lane) % laneColors.length];
}

function laneX(lane: number): number {
  return lane * laneWidth + laneWidth / 2;
}

function segmentPath(from: number, to: number, top: number, bottom: number): string {
  if (from === to) return `M ${laneX(from)} ${top} L ${laneX(to)} ${bottom}`;
  const middle = (top + bottom) / 2;
  return `M ${laneX(from)} ${top} C ${laneX(from)} ${middle}, ${laneX(to)} ${middle}, ${laneX(to)} ${bottom}`;
}

function fileDirectory(path: string): string {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : "";
}

function fileBase(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function ScmGraph({
  commits,
  loading,
  hasMore,
  onLoadMore,
  expanded,
  onToggle,
  files,
  onOpenFile,
  onContextMenu,
  onBranchContextMenu,
  revealHash,
}: ScmGraphProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const laneCount = React.useMemo(
    () =>
      commits.reduce(
        (count, commit) =>
          Math.max(
            count,
            commit.lane + 1,
            ...commit.segments.flatMap((segment) => [
              segment.fromLane + 1,
              segment.toLane + 1,
            ]),
          ),
        1,
      ),
    [commits],
  );
  // A commit nobody points to starts at its dot, not at the top of its row.
  const tips = React.useMemo(() => {
    const children = new Set(commits.flatMap((commit) => commit.parents));
    return new Set(
      commits
        .filter((commit) => !children.has(commit.hash))
        .map((commit) => commit.hash),
    );
  }, [commits]);
  const graphWidth = laneCount * laneWidth + 4;

  const loadMoreIfNeeded = React.useCallback(() => {
    const element = scrollRef.current;
    if (!element || !hasMore || loading) return;
    if (
      element.scrollTop + element.clientHeight >=
      element.scrollHeight - rowHeight * 4
    ) {
      onLoadMore();
    }
  }, [hasMore, loading, onLoadMore]);

  React.useEffect(() => {
    if (!revealHash) return;
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-hash="${revealHash}"]`)
      ?.scrollIntoView?.({ block: "center" });
  }, [revealHash]);

  if (!commits.length) {
    return (
      <div className="scm-graph-empty">
        {loading ? "Loading history…" : "No commits yet."}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="scm-graph-scroll"
      role="tree"
      aria-label="Commit graph"
      onScroll={loadMoreIfNeeded}
    >
      {commits.map((commit) => {
        const open = expanded.has(commit.hash);
        const state = files.get(commit.hash);
        const continuing = [
          ...new Set(commit.segments.map((segment) => segment.toLane)),
        ];
        const isTip = tips.has(commit.hash);
        return (
          <React.Fragment key={commit.hash}>
            <div
              className={`scm-graph-row ${open ? "open" : ""} ${commit.isHead ? "head" : ""}`}
              role="treeitem"
              aria-expanded={open}
              aria-label={`${commit.subject}, ${commit.authorName}`}
              tabIndex={0}
              data-hash={commit.hash}
              title={`${commit.shortHash} · ${commit.authorName} · ${new Date(
                commit.authoredAt,
              ).toLocaleString()}\n${commit.subject}`}
              onClick={() => onToggle(commit)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onToggle(commit);
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                onContextMenu(commit, event.clientX, event.clientY);
              }}
            >
              <svg
                className="scm-graph-lanes"
                width={graphWidth}
                height={rowHeight}
                aria-hidden="true"
              >
                {commit.segments.map((segment, index) => {
                  const ownLine = segment.fromLane === commit.lane;
                  return (
                    <path
                      key={index}
                      d={segmentPath(
                        segment.fromLane,
                        segment.toLane,
                        ownLine && isTip ? rowHeight / 2 : 0,
                        rowHeight,
                      )}
                      stroke={laneColor(ownLine ? segment.toLane : segment.fromLane)}
                      strokeWidth={1.5}
                      fill="none"
                    />
                  );
                })}
                {!isTip && !commit.segments.some((s) => s.fromLane === commit.lane) ? (
                  // The last commit of a lane: its line ends at the dot.
                  <path
                    d={`M ${laneX(commit.lane)} 0 L ${laneX(commit.lane)} ${rowHeight / 2}`}
                    stroke={laneColor(commit.lane)}
                    strokeWidth={1.5}
                    fill="none"
                  />
                ) : null}
                <circle
                  cx={laneX(commit.lane)}
                  cy={rowHeight / 2}
                  r={commit.isHead ? 4.5 : 3.5}
                  fill={commit.isHead ? "var(--bg-sidebar)" : laneColor(commit.lane)}
                  stroke={laneColor(commit.lane)}
                  strokeWidth={commit.isHead ? 2 : 1}
                />
              </svg>
              <span className="scm-graph-text">
                <span className="scm-graph-subject">{commit.subject}</span>
                <span className="scm-graph-author">{commit.authorName}</span>
              </span>
              {commit.refs.length ? (
                <span className="scm-graph-refs">
                  {commit.refs
                    .filter((ref) => ref.kind !== "head")
                    .slice(0, 3)
                    .map((ref) => (
                      <span
                        key={`${ref.kind}:${ref.name}`}
                        className={`scm-graph-ref ${ref.kind} ${ref.current ? "current" : ""}`}
                        title={`${ref.kind === "remote-branch" ? "Remote branch" : ref.kind === "tag" ? "Tag" : "Branch"}: ${ref.name}`}
                        onContextMenu={
                          onBranchContextMenu && ref.kind !== "tag"
                            ? (event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                onBranchContextMenu(ref.name);
                              }
                            : undefined
                        }
                      >
                        <Codicon
                          name={
                            ref.kind === "remote-branch"
                              ? "cloud"
                              : ref.kind === "tag"
                                ? "tag"
                                : ref.current
                                  ? "target"
                                  : "git-branch"
                          }
                        />
                        {ref.name}
                      </span>
                    ))}
                </span>
              ) : null}
              <button
                type="button"
                className="scm-graph-more"
                title="More Actions…"
                aria-label={`Actions for ${commit.subject}`}
                onClick={(event) => {
                  event.stopPropagation();
                  const box = event.currentTarget.getBoundingClientRect();
                  onContextMenu(commit, box.left, box.bottom);
                }}
              >
                <Codicon name="ellipsis" />
              </button>
            </div>
            {open ? (
              <div className="scm-graph-files" role="group">
                <svg
                  className="scm-graph-lanes continued"
                  width={graphWidth}
                  height="100%"
                  aria-hidden="true"
                >
                  {continuing.map((lane) => (
                    <line
                      key={lane}
                      x1={laneX(lane)}
                      x2={laneX(lane)}
                      y1={0}
                      y2="100%"
                      stroke={laneColor(lane)}
                      strokeWidth={1.5}
                    />
                  ))}
                </svg>
                {state === undefined || state === "loading" ? (
                  <div
                    className="scm-graph-file muted"
                    style={{ paddingLeft: graphWidth + 8 }}
                  >
                    <Codicon name="loading" spin /> Loading files…
                  </div>
                ) : "error" in state ? (
                  <div
                    className="scm-graph-file muted"
                    style={{ paddingLeft: graphWidth + 8 }}
                  >
                    {state.error}
                  </div>
                ) : (
                  state.changedFiles.map((file) => {
                    const code = gitDiffStatusCode(file.status);
                    return (
                      <button
                        key={`${file.oldPath ?? ""}:${file.path}`}
                        type="button"
                        role="treeitem"
                        className={`scm-graph-file ${gitStatusClass(code)}`}
                        style={{ paddingLeft: graphWidth + 8 }}
                        title={`${file.path} • ${code === "A" ? "Added" : code === "D" ? "Deleted" : code === "R" ? "Renamed" : "Modified"} — open the change`}
                        onClick={() => onOpenFile(commit, file)}
                      >
                        <Codicon name={fileCodicon(file.path)} />
                        <span className="scm-resource-name">{fileBase(file.path)}</span>
                        <span className="scm-resource-description">
                          {file.oldPath
                            ? `${file.oldPath} →`
                            : fileDirectory(file.path)}
                        </span>
                        <span className="scm-resource-letter">{code}</span>
                      </button>
                    );
                  })
                )}
              </div>
            ) : null}
          </React.Fragment>
        );
      })}
      {hasMore ? (
        <button type="button" className="scm-graph-load-more" onClick={onLoadMore}>
          {loading ? <Codicon name="loading" spin /> : null}
          {loading ? "Loading…" : "Load more commits"}
        </button>
      ) : null}
    </div>
  );
}
