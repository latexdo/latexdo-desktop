/*
 * A line diff for the change history: which lines one edit removed and added,
 * with a little context, as compact hunks. Myers' algorithm runs only on the
 * part between the unchanged start and end, which for an edit is small.
 */

import type { HistoryHunk } from "../../types";

/** Unchanged lines kept around each change. */
export const historyContextLines = 2;
/** Lines kept per change; a huge paste is summarized past this. */
export const maxHistoryLines = 400;
/** Beyond this many differences, the middle is shown as replaced outright. */
const maxEditDistance = 2000;

type Op = { kind: " " | "-" | "+"; text: string };

function splitLines(text: string): string[] {
  return text.split("\n");
}

/** Shortest edit script between two short arrays (Myers), or null if too far apart. */
function myers(a: readonly string[], b: readonly string[]): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;
  let v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d += 1) {
    if (d > maxEditDistance) return null;
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
          ? v[offset + k + 1]!
          : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        return backtrack(trace, a, b, offset, d);
      }
    }
    v = v.slice();
  }
  return null;
}

function backtrack(
  trace: Int32Array[],
  a: readonly string[],
  b: readonly string[],
  offset: number,
  depth: number,
): Op[] {
  const ops: Op[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = depth; d > 0; d -= 1) {
    const v = trace[d]!;
    const k = x - y;
    const prevK =
      k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? k + 1 : k - 1;
    const prevX = v[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ kind: " ", text: a[x - 1]! });
      x -= 1;
      y -= 1;
    }
    if (x === prevX) ops.push({ kind: "+", text: b[y - 1]! });
    else ops.push({ kind: "-", text: a[x - 1]! });
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    ops.push({ kind: " ", text: a[x - 1]! });
    x -= 1;
    y -= 1;
  }
  return ops.reverse();
}

export interface LineDiff {
  hunks: HistoryHunk[];
  added: number;
  removed: number;
}

/** The lines `after` changed relative to `before`, as hunks with context. */
export function diffLines(
  before: string,
  after: string,
  context = historyContextLines,
): LineDiff {
  if (before === after) return { hunks: [], added: 0, removed: 0 };
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const middleA = a.slice(start, endA);
  const middleB = b.slice(start, endB);
  const middle = myers(middleA, middleB) ?? [
    ...middleA.map((text): Op => ({ kind: "-", text })),
    ...middleB.map((text): Op => ({ kind: "+", text })),
  ];
  const ops: Op[] = [
    ...a.slice(0, start).map((text): Op => ({ kind: " ", text })),
    ...middle,
    ...a.slice(endA).map((text): Op => ({ kind: " ", text })),
  ];

  // Line numbers before and after each op.
  const oldAt: number[] = [];
  const newAt: number[] = [];
  let oldLine = 1;
  let newLine = 1;
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    oldAt.push(oldLine);
    newAt.push(newLine);
    if (op.kind !== "+") oldLine += 1;
    if (op.kind !== "-") newLine += 1;
    if (op.kind === "+") added += 1;
    if (op.kind === "-") removed += 1;
  }

  // Changes at most 2 × context unchanged lines apart share one hunk.
  const changed = ops.flatMap((op, index) => (op.kind === " " ? [] : [index]));
  const hunks: HistoryHunk[] = [];
  let group = 0;
  while (group < changed.length) {
    let last = group;
    while (
      last + 1 < changed.length &&
      changed[last + 1]! - changed[last]! - 1 <= 2 * context
    ) {
      last += 1;
    }
    const from = Math.max(0, changed[group]! - context);
    const to = Math.min(ops.length - 1, changed[last]! + context);
    hunks.push({
      oldStart: oldAt[from]!,
      newStart: newAt[from]!,
      lines: ops.slice(from, to + 1).map((op) => `${op.kind}${op.text}`),
    });
    group = last + 1;
  }
  return { hunks: capLines(hunks), added, removed };
}

/** Keeps a change readable and small: past the cap, lines are summarized. */
function capLines(hunks: HistoryHunk[]): HistoryHunk[] {
  let budget = maxHistoryLines;
  const capped: HistoryHunk[] = [];
  for (const hunk of hunks) {
    if (budget <= 0) break;
    if (hunk.lines.length <= budget) {
      capped.push(hunk);
      budget -= hunk.lines.length;
      continue;
    }
    const kept = hunk.lines.slice(0, budget);
    kept.push(`~${hunk.lines.length - budget} more lines`);
    capped.push({ ...hunk, lines: kept });
    budget = 0;
  }
  const dropped = hunks.length - capped.length;
  if (dropped > 0 && capped.length) {
    capped[capped.length - 1]!.lines.push(
      `~${dropped} more ${dropped === 1 ? "place" : "places"} changed`,
    );
  }
  return capped;
}
