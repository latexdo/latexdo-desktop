import { useMemo, useRef, type CSSProperties, type KeyboardEvent } from "react";
import type { GitGraphCommit } from "../types";

const defaultLaneWidth = 18;
const defaultRowHeight = 28;
const laneColors = [
  "#73a7ff",
  "#6ecb93",
  "#e2b86b",
  "#d98bc8",
  "#6fc7cf",
  "#ee8b78",
  "#a9a0ef",
  "#a5bd68",
];

export interface GitGraphProps {
  commits: GitGraphCommit[];
  selectedHash?: string | null;
  onSelectCommit: (commit: GitGraphCommit) => void;
  className?: string;
  loading?: boolean;
  emptyMessage?: string;
  rowHeight?: number;
  laneWidth?: number;
  formatTimestamp?: (authoredAt: string) => string;
}

function relativeTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }

  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const absoluteSeconds = Math.abs(seconds);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 365 * 24 * 60 * 60],
    ["month", 30 * 24 * 60 * 60],
    ["week", 7 * 24 * 60 * 60],
    ["day", 24 * 60 * 60],
    ["hour", 60 * 60],
    ["minute", 60],
  ];
  const [unit, divisor] = units.find(
    ([, candidate]) => absoluteSeconds >= candidate,
  ) ?? ["second", 1];

  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    Math.round(seconds / divisor),
    unit,
  );
}

function laneColor(lane: number): string {
  return laneColors[Math.abs(lane) % laneColors.length];
}

function normalizeCommit(commit: GitGraphCommit): GitGraphCommit | null {
  const raw = commit as Partial<GitGraphCommit>;
  if (typeof raw.hash !== "string" || !raw.hash) {
    return null;
  }

  const refs = Array.isArray(raw.refs)
    ? raw.refs
        .filter((ref) => ref && typeof ref.name === "string")
        .map((ref) => ({
          name: ref.name,
          kind:
            ref.kind === "head" ||
            ref.kind === "local-branch" ||
            ref.kind === "remote-branch" ||
            ref.kind === "tag"
              ? ref.kind
              : "local-branch",
          current: Boolean(ref.current),
        }))
    : [];
  const lane = Number.isFinite(raw.lane) ? (raw.lane ?? 0) : 0;
  const segments = Array.isArray(raw.segments)
    ? raw.segments
        .filter(
          (segment) =>
            Number.isFinite(segment?.fromLane) && Number.isFinite(segment?.toLane),
        )
        .map((segment) => ({
          fromLane: segment.fromLane,
          toLane: segment.toLane,
          kind:
            segment.kind === "merge-left" ||
            segment.kind === "merge-right" ||
            segment.kind === "vertical"
              ? segment.kind
              : segment.fromLane === segment.toLane
                ? "vertical"
                : segment.toLane < segment.fromLane
                  ? "merge-left"
                  : "merge-right",
        }))
    : [];

  return {
    hash: raw.hash,
    shortHash:
      typeof raw.shortHash === "string" && raw.shortHash
        ? raw.shortHash
        : raw.hash.slice(0, 8),
    parents: Array.isArray(raw.parents)
      ? raw.parents.filter((parent): parent is string => typeof parent === "string")
      : [],
    subject:
      typeof raw.subject === "string" && raw.subject ? raw.subject : "Untitled commit",
    authorName:
      typeof raw.authorName === "string" && raw.authorName ? raw.authorName : "Unknown",
    authorEmail: typeof raw.authorEmail === "string" ? raw.authorEmail : "",
    authoredAt: typeof raw.authoredAt === "string" ? raw.authoredAt : "",
    refs,
    lane,
    segments,
    isHead:
      Boolean(raw.isHead) || refs.some((ref) => ref.current || ref.kind === "head"),
  };
}

function graphLaneCount(commits: GitGraphCommit[]): number {
  let maximumLane = 0;
  for (const commit of commits) {
    maximumLane = Math.max(maximumLane, commit.lane);
    for (const segment of commit.segments) {
      maximumLane = Math.max(maximumLane, segment.fromLane, segment.toLane);
    }
  }
  return maximumLane + 1;
}

function segmentPath(
  fromLane: number,
  toLane: number,
  rowHeight: number,
  laneWidth: number,
): string {
  const fromX = fromLane * laneWidth + laneWidth / 2;
  const toX = toLane * laneWidth + laneWidth / 2;
  if (fromLane === toLane) {
    return `M ${fromX} 0 L ${toX} ${rowHeight}`;
  }

  const midpoint = rowHeight / 2;
  return `M ${fromX} 0 C ${fromX} ${midpoint}, ${toX} ${midpoint}, ${toX} ${rowHeight}`;
}

function commitHasHeadRef(commit: GitGraphCommit): boolean {
  return commit.isHead || commit.refs.some((ref) => ref.current || ref.kind === "head");
}

export function GitGraph({
  commits,
  selectedHash,
  onSelectCommit,
  className,
  loading = false,
  emptyMessage = "No commits available.",
  rowHeight = defaultRowHeight,
  laneWidth = defaultLaneWidth,
  formatTimestamp = relativeTimestamp,
}: GitGraphProps) {
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const normalizedCommits = useMemo(
    () =>
      commits
        .map(normalizeCommit)
        .filter((commit): commit is GitGraphCommit => Boolean(commit)),
    [commits],
  );
  const laneCount = useMemo(
    () => graphLaneCount(normalizedCommits),
    [normalizedCommits],
  );
  const graphWidth = Math.max(laneWidth, laneCount * laneWidth);
  const selectedIndex = normalizedCommits.findIndex(
    (commit) => commit.hash === selectedHash,
  );
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0;

  const focusCommit = (index: number) => {
    const next = normalizedCommits[index];
    if (!next) return;
    onSelectCommit(next);
    rowRefs.current.get(next.hash)?.focus();
  };

  const handleRowKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown")
      nextIndex = Math.min(normalizedCommits.length - 1, index + 1);
    if (event.key === "ArrowUp") nextIndex = Math.max(0, index - 1);
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = normalizedCommits.length - 1;

    if (nextIndex !== null) {
      event.preventDefault();
      focusCommit(nextIndex);
    }
  };

  if (loading) {
    return (
      <div
        className={["git-graph-empty git-graph-state", className]
          .filter(Boolean)
          .join(" ")}
      >
        Loading commit graph...
      </div>
    );
  }

  if (!normalizedCommits.length) {
    return (
      <div
        className={["git-graph-empty git-graph-state", className]
          .filter(Boolean)
          .join(" ")}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      className={["git-graph", className].filter(Boolean).join(" ")}
      role="listbox"
      aria-label="Repository commit graph"
      style={{ "--graph-width": `${graphWidth}px` } as CSSProperties}
    >
      {normalizedCommits.map((commit, index) => {
        const selected = commit.hash === selectedHash;
        const timestamp = formatTimestamp(commit.authoredAt);
        const isHead = commitHasHeadRef(commit);

        return (
          <button
            key={commit.hash}
            ref={(node) => {
              if (node) rowRefs.current.set(commit.hash, node);
              else rowRefs.current.delete(commit.hash);
            }}
            type="button"
            role="option"
            aria-selected={selected}
            className={`git-graph-row${selected ? " selected" : ""}`}
            tabIndex={index === tabbableIndex ? 0 : -1}
            onClick={() => onSelectCommit(commit)}
            onKeyDown={(event) => handleRowKeyDown(event, index)}
            title={`${commit.shortHash} - ${commit.subject}`}
            style={{ height: rowHeight }}
          >
            <svg
              className="git-graph-lanes"
              width={graphWidth}
              height={rowHeight}
              viewBox={`0 0 ${graphWidth} ${rowHeight}`}
              aria-hidden="true"
            >
              {commit.segments.map((segment, segmentIndex) => (
                <path
                  key={`${segment.fromLane}:${segment.toLane}:${segment.kind}:${segmentIndex}`}
                  className={`git-graph-segment ${segment.kind}`}
                  d={segmentPath(
                    segment.fromLane,
                    segment.toLane,
                    rowHeight,
                    laneWidth,
                  )}
                  fill="none"
                  stroke={laneColor(segment.fromLane)}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              <circle
                className={`git-graph-dot${isHead ? " head" : ""}`}
                cx={commit.lane * laneWidth + laneWidth / 2}
                cy={rowHeight / 2}
                r={isHead ? 5.5 : 4}
                fill={laneColor(commit.lane)}
                stroke="var(--bg-canvas, #181b22)"
                strokeWidth={isHead ? 2 : 1.5}
              />
            </svg>

            <span className="git-graph-message-cell">
              {commit.refs.length ? (
                <span className="git-ref-labels">
                  {commit.refs.map((ref) => (
                    <span
                      key={`${ref.kind}:${ref.name}`}
                      className={`git-ref-label git-graph-ref ${ref.kind}${
                        ref.current ? " current" : ""
                      }`}
                      data-kind={ref.kind}
                      title={`${ref.kind.replaceAll("-", " ")}: ${ref.name}`}
                    >
                      {ref.name}
                    </span>
                  ))}
                </span>
              ) : null}
              <span className="git-graph-message git-graph-subject">
                {commit.subject}
              </span>
            </span>
            <span className="git-graph-author" title={commit.authorEmail}>
              {commit.authorName}
            </span>
            <time
              className="git-graph-time"
              dateTime={commit.authoredAt}
              title={commit.authoredAt}
            >
              {timestamp}
            </time>
          </button>
        );
      })}
    </div>
  );
}
