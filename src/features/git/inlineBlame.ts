import type { GitBlameLine } from "../../types";

export const inlineBlameSummaryMaxLength = 80;
export const fileBlameAuthorMaxLength = 18;

/** Number of heatmap buckets, newest (0) to oldest (heatLevelCount - 1). */
export const heatLevelCount = 10;

const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;

const heatAgeBracketsMs = [
  day,
  7 * day,
  14 * day,
  30 * day,
  90 * day,
  180 * day,
  365 * day,
  2 * 365 * day,
  4 * 365 * day,
];

export interface BlameAnnotation {
  lineNumber: number;
  inlineText: string;
  gutterText: string;
  hoverMarkdown: string;
  heatLevel: number;
  uncommitted: boolean;
}

export function isUncommittedBlame(line: GitBlameLine): boolean {
  return /^0+$/.test(line.hash);
}

export function formatBlameRelativeTime(isoDate: string, now: Date): string {
  const timestamp = Date.parse(isoDate);
  if (!Number.isFinite(timestamp)) {
    return "some time ago";
  }

  const elapsed = Math.max(0, now.getTime() - timestamp);
  if (elapsed < 45 * 1000) return "just now";
  if (elapsed < 90 * 1000) return "a minute ago";

  const minutes = Math.round(elapsed / minute);
  if (minutes < 45) return `${minutes} minutes ago`;
  if (minutes < 90) return "an hour ago";

  const hours = Math.round(elapsed / hour);
  if (hours < 22) return `${hours} hours ago`;

  const days = Math.round(elapsed / day);
  if (days <= 1) return "yesterday";
  if (days < 7) return `${days} days ago`;

  const weeks = Math.round(days / 7);
  if (weeks < 5) return weeks === 1 ? "a week ago" : `${weeks} weeks ago`;

  const months = Math.round(days / 30);
  if (months < 12) return months <= 1 ? "a month ago" : `${months} months ago`;

  const years = Math.round(days / 365);
  return years <= 1 ? "a year ago" : `${years} years ago`;
}

export function blameHeatLevel(isoDate: string, now: Date): number {
  const timestamp = Date.parse(isoDate);
  if (!Number.isFinite(timestamp)) {
    return heatLevelCount - 1;
  }

  const age = Math.max(0, now.getTime() - timestamp);
  for (let level = 0; level < heatAgeBracketsMs.length; level += 1) {
    if (age < heatAgeBracketsMs[level]) {
      return level;
    }
  }
  return heatLevelCount - 1;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+\-.!<>|])/g, "\\$1");
}

function formatBlameAbsoluteDate(isoDate: string): string {
  const timestamp = Date.parse(isoDate);
  if (!Number.isFinite(timestamp)) {
    return "unknown date";
  }
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

export function inlineBlameText(line: GitBlameLine, now: Date): string {
  if (isUncommittedBlame(line)) {
    return "You • Uncommitted changes";
  }

  const relative = formatBlameRelativeTime(line.authorTime, now);
  const summary = truncate(
    line.summary.trim() || "(no commit message)",
    inlineBlameSummaryMaxLength,
  );
  return `${line.author}, ${relative} • ${summary}`;
}

export function unsavedChangesBlameText(): string {
  return "You • Unsaved changes";
}

export function fileBlameGutterText(line: GitBlameLine, now: Date): string {
  if (isUncommittedBlame(line)) {
    return `${"Uncommitted".padEnd(fileBlameAuthorMaxLength)} just now`;
  }

  const author = truncate(line.author, fileBlameAuthorMaxLength).padEnd(
    fileBlameAuthorMaxLength,
  );
  return `${author} ${formatBlameRelativeTime(line.authorTime, now)}`;
}

export function blameHoverMarkdown(line: GitBlameLine, now: Date): string {
  if (isUncommittedBlame(line)) {
    return "**Uncommitted changes**\n\nThis line has not been committed yet.";
  }

  const relative = formatBlameRelativeTime(line.authorTime, now);
  const absolute = formatBlameAbsoluteDate(line.authorTime);
  const summary = escapeMarkdown(line.summary.trim() || "(no commit message)");
  const author = escapeMarkdown(line.author);

  return [
    `**${author}** — ${relative} (${absolute})`,
    "",
    `\`${line.shortHash}\` ${summary}`,
  ].join("\n");
}

export function blameByLine(lines: GitBlameLine[]): Map<number, GitBlameLine> {
  const byLine = new Map<number, GitBlameLine>();
  for (const line of lines) {
    if (Number.isInteger(line.line) && line.line >= 1) {
      byLine.set(line.line, line);
    }
  }
  return byLine;
}

export function buildBlameAnnotations(
  lines: GitBlameLine[],
  now: Date,
): BlameAnnotation[] {
  return lines
    .filter((line) => Number.isInteger(line.line) && line.line >= 1)
    .map((line) => {
      const uncommitted = isUncommittedBlame(line);
      return {
        lineNumber: line.line,
        inlineText: inlineBlameText(line, now),
        gutterText: fileBlameGutterText(line, now),
        hoverMarkdown: blameHoverMarkdown(line, now),
        heatLevel: uncommitted ? 0 : blameHeatLevel(line.authorTime, now),
        uncommitted,
      };
    });
}
