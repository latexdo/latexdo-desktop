import type {
  GitChangeEntry,
  GitCommitFile,
  GitDiffSession,
  GitDiscardResult,
} from "../../types";
import { pathForDisplay } from "../../pathDisplay";
import { fileName } from "../project/projectUtils";

export type GitChangeArea = "staged" | "changes";

export interface GitContextMenuState {
  entry: GitChangeEntry;
  area: GitChangeArea;
  x: number;
  y: number;
}

export interface GitChangeGroupStatus {
  code: string;
  label: string;
  className: string;
  count: number;
}

export interface GitChangeGroup {
  id: string;
  domId: string;
  directory: string;
  label: string;
  entries: GitChangeEntry[];
  statusCounts: GitChangeGroupStatus[];
}

export function gitDisplayPath(filePath: string): string {
  const displayPath = filePath.includes(" -> ")
    ? (filePath.split(" -> ").pop() ?? filePath)
    : filePath;
  return pathForDisplay(displayPath);
}

export function fileDirectory(filePath: string): string {
  const displayPath = gitDisplayPath(filePath);
  const parts = displayPath.split(/[/\\]/);
  parts.pop();
  return parts.join("/") || ".";
}

export function gitStatusCode(entry: GitChangeEntry, area: GitChangeArea): string {
  const status = area === "staged" ? entry.indexStatus : entry.worktreeStatus;
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "untracked":
      return "U";
    case "conflicted":
      return "!";
    case "type-changed":
      return "T";
    case "modified":
    case "unmodified":
    default:
      return "M";
  }
}

export function gitStatusLabel(code: string): string {
  switch (code) {
    case "A":
      return "Added";
    case "D":
      return "Deleted";
    case "R":
      return "Renamed";
    case "C":
      return "Copied";
    case "U":
      return "Untracked";
    case "!":
      return "Conflict";
    case "T":
      return "Type changed";
    case "M":
    default:
      return "Modified";
  }
}

export function gitDiffTabLabel(session: GitDiffSession): string {
  const name = fileName(session.relativePath);
  return `${name} (${session.originalLabel}) ↔ ${name} (${session.modifiedLabel})`;
}

export function formatGitDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(timestamp);
}

export function gitStatusClass(code: string): string {
  switch (code) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
    case "C":
      return "renamed";
    case "U":
      return "untracked";
    case "!":
      return "conflict";
    case "T":
      return "type-changed";
    case "M":
    default:
      return "modified";
  }
}

const gitStatusSortOrder = new Map(
  ["!", "M", "A", "D", "R", "C", "T", "U"].map((code, index) => [code, index]),
);

export function gitChangeGroupLabel(directory: string): string {
  return directory === "." ? "Project root" : directory;
}

export function gitChangeGroupDomId(area: GitChangeArea, directory: string): string {
  const safeDirectory = directory
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return `scm-${area}-group-${safeDirectory || "root"}`;
}

export function compareGitChangeEntries(
  left: GitChangeEntry,
  right: GitChangeEntry,
): number {
  return gitDisplayPath(left.path).localeCompare(
    gitDisplayPath(right.path),
    undefined,
    {
      numeric: true,
      sensitivity: "base",
    },
  );
}

export function compareGitChangeDirectories(left: string, right: string): number {
  if (left === right) return 0;
  if (left === ".") return -1;
  if (right === ".") return 1;
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function summarizeGitChangeStatuses(
  entries: GitChangeEntry[],
  area: GitChangeArea,
): GitChangeGroupStatus[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const code = gitStatusCode(entry, area);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(
      ([left], [right]) =>
        (gitStatusSortOrder.get(left) ?? 99) - (gitStatusSortOrder.get(right) ?? 99) ||
        left.localeCompare(right),
    )
    .map(([code, count]) => ({
      code,
      count,
      label: gitStatusLabel(code),
      className: gitStatusClass(code),
    }));
}

export function groupGitChanges(
  entries: GitChangeEntry[],
  area: GitChangeArea,
): GitChangeGroup[] {
  const byDirectory = new Map<string, GitChangeEntry[]>();
  for (const entry of entries) {
    const directory = fileDirectory(entry.path);
    const groupEntries = byDirectory.get(directory);
    if (groupEntries) {
      groupEntries.push(entry);
    } else {
      byDirectory.set(directory, [entry]);
    }
  }

  return [...byDirectory.entries()]
    .sort(([left], [right]) => compareGitChangeDirectories(left, right))
    .map(([directory, groupEntries]) => ({
      id: `${area}:${directory}`,
      domId: gitChangeGroupDomId(area, directory),
      directory,
      label: gitChangeGroupLabel(directory),
      entries: [...groupEntries].sort(compareGitChangeEntries),
      statusCounts: summarizeGitChangeStatuses(groupEntries, area),
    }));
}

export function gitDiffStatusCode(status: GitCommitFile["status"]): string {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "modified":
    default:
      return "M";
  }
}

export function gitDiscardStatusMessage(
  result: GitDiscardResult,
  successMessage: string,
): string {
  if (!result.discarded) {
    return "Discard canceled.";
  }
  return result.recoveryPatch
    ? `${successMessage}. Recovery patch saved at ${result.recoveryPatch}`
    : successMessage;
}
