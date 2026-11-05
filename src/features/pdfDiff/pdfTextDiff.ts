import { diffSequences } from "./sequenceDiff";

/** A box on a page, as fractions (0–1) of the page width and height. */
export interface PdfDiffRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfDiffBox {
  page: number;
  rect: PdfDiffRect;
}

export interface PdfDiffWord {
  text: string;
  /** What the diff compares: the text with typographic variants folded. */
  key: string;
  page: number;
  line: number;
  boxes: PdfDiffBox[];
}

/** The minimal slice of a pdf.js text item this module reads. */
export interface PdfTextItemLike {
  str: string;
  transform: number[];
  width: number;
  height?: number;
}

export interface PdfViewportLike {
  width: number;
  height: number;
  scale: number;
  transform: number[];
}

export type PdfDiffHunkKind = "added" | "removed" | "changed";

export interface PdfDiffHunk {
  id: number;
  kind: PdfDiffHunkKind;
  removedText: string;
  addedText: string;
  removedCount: number;
  addedCount: number;
  /** Page of the change in each version (where it is, or would be). */
  originalPage: number | null;
  modifiedPage: number | null;
  /** Vertical position (0–1) of the change on that page, for scrolling. */
  originalY: number;
  modifiedY: number;
  /** A few unchanged words before the change, to show it in context. */
  contextBefore: string;
}

export type PdfDiffHighlightKind = "removed" | "added" | "insert-point";

export interface PdfDiffHighlight {
  id: string;
  hunkId: number;
  kind: PdfDiffHighlightKind;
  page: number;
  rect: PdfDiffRect;
}

export interface PdfTextDiffStats {
  addedWords: number;
  removedWords: number;
  originalWords: number;
  modifiedWords: number;
  changedOriginalPages: number[];
  changedModifiedPages: number[];
}

export interface PdfTextDiffResult {
  hunks: PdfDiffHunk[];
  originalHighlights: Map<number, PdfDiffHighlight[]>;
  modifiedHighlights: Map<number, PdfDiffHighlight[]>;
  stats: PdfTextDiffStats;
}

const typographicFolds: Array<[RegExp, string]> = [
  [/[\u2018\u2019\u201a\u201b\u2032]/g, "'"],
  [/[\u201c\u201d\u201e\u201f\u2033]/g, '"'],
  [/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-"],
  [/\u2026/g, "..."],
  // Soft hyphen, zero-width space/joiners and BOM (alternation, not a class,
  // so joiners are not read as part of a combined character).
  [/\u00ad|\u200b|\u200c|\u200d|\ufeff/g, ""],
];

/**
 * The comparison key of a PDF word. NFKC splits ligatures (ﬁ → fi) and folds
 * full-width forms; quotes and dashes that fonts encode differently compare
 * equal. Case and punctuation still count as changes.
 */
export function normalizeWordKey(text: string): string {
  let key = text.normalize("NFKC");
  for (const [pattern, replacement] of typographicFolds) {
    key = key.replace(pattern, replacement);
  }
  return key;
}

function multiply(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * The words of one page with their boxes, in content-stream order (which for
 * LaTeX output is reading order). `firstLine` numbers lines across pages.
 */
export function wordsFromTextItems(
  items: readonly PdfTextItemLike[],
  viewport: PdfViewportLike,
  page: number,
  firstLine = 0,
): { words: PdfDiffWord[]; nextLine: number } {
  const words: PdfDiffWord[] = [];
  let line = firstLine;
  let lastBaseline: number | null = null;
  let lastRight = -Infinity;
  let lastHeight = 0;

  for (const item of items) {
    if (!item.str || !/\S/.test(item.str) || item.transform?.length !== 6) continue;
    const tx = multiply(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]) || (item.height ?? 0) * viewport.scale;
    if (!(fontHeight > 0)) continue;
    const left = tx[4];
    const baseline = tx[5];
    const totalWidth = Math.max(0, item.width * viewport.scale);

    const newLine =
      lastBaseline === null ||
      Math.abs(baseline - lastBaseline) > Math.max(fontHeight, lastHeight) * 0.55 ||
      left < lastRight - fontHeight * 2;
    if (newLine && lastBaseline !== null) line += 1;
    lastBaseline = baseline;
    lastHeight = fontHeight;

    const length = item.str.length;
    for (const match of item.str.matchAll(/\S+/g)) {
      const start = match.index ?? 0;
      const text = match[0];
      const x = left + (totalWidth * start) / length;
      const width = (totalWidth * text.length) / length;
      const top = baseline - fontHeight * 0.82;
      words.push({
        text,
        key: normalizeWordKey(text),
        page,
        line,
        boxes: [
          {
            page,
            rect: {
              x: clamp01(x / viewport.width),
              y: clamp01(top / viewport.height),
              width: clamp01(width / viewport.width),
              height: clamp01((fontHeight * 1.08) / viewport.height),
            },
          },
        ],
      });
    }
    lastRight = left + totalWidth;
  }

  return { words, nextLine: line + 1 };
}

/**
 * Removes page furniture: page numbers and running headers or footers. They
 * are not content, and because they sit between the pages' text a page break
 * that moves by one word would otherwise show them as removed and re-added.
 *
 * Only the first and last line of a page are considered. A line is furniture
 * when it is just a page number (arabic or roman), or when the same text (with
 * numbers ignored) is at the same height on at least half the pages.
 */
export function stripPageFurniture(words: readonly PdfDiffWord[]): PdfDiffWord[] {
  interface Line {
    page: number;
    line: number;
    text: string;
    y: number;
  }
  const lines = new Map<string, Line>();
  const pageLines = new Map<number, Line[]>();
  for (const word of words) {
    const id = `${word.page}:${word.line}`;
    let entry = lines.get(id);
    if (!entry) {
      entry = {
        page: word.page,
        line: word.line,
        text: "",
        y: word.boxes[0]?.rect.y ?? 0,
      };
      lines.set(id, entry);
      const list = pageLines.get(word.page) ?? [];
      list.push(entry);
      pageLines.set(word.page, list);
    }
    entry.text = entry.text ? `${entry.text} ${word.key}` : word.key;
  }
  const pageCount = pageLines.size;
  if (pageCount === 0) return [...words];

  const edgeLines: Line[] = [];
  for (const list of pageLines.values()) {
    edgeLines.push(list[0]);
    if (list.length > 1) edgeLines.push(list[list.length - 1]);
  }
  // Arabic, or a well-formed roman numeral (so "did" or "dim" do not count).
  const pageNumber =
    /^[-([]?\s*(?:\d{1,4}|(?=[ivxlcdm])m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3}))\s*[-)\]]?$/i;
  const repeatKey = (line: Line) =>
    `${line.text.replace(/\d+/g, "#")}@${Math.round(line.y * 50)}`;
  const repeats = new Map<string, Set<number>>();
  for (const line of edgeLines) {
    const key = repeatKey(line);
    const pages = repeats.get(key) ?? new Set<number>();
    pages.add(line.page);
    repeats.set(key, pages);
  }
  const furniture = new Set<string>();
  for (const line of edgeLines) {
    const pages = repeats.get(repeatKey(line))!.size;
    const repeated = pageCount >= 2 && pages >= 2 && pages >= pageCount / 2;
    if (pageNumber.test(line.text) || repeated) {
      furniture.add(`${line.page}:${line.line}`);
    }
  }
  return words.filter((word) => !furniture.has(`${word.page}:${word.line}`));
}

/**
 * Joins words LaTeX hyphenated across a line break ("compar-" + "ison"), so a
 * paragraph that reflows does not show its hyphenation as a change.
 */
export function joinHyphenatedWords(words: readonly PdfDiffWord[]): PdfDiffWord[] {
  const joined: PdfDiffWord[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const next = words[index + 1];
    if (
      next &&
      word.text.length > 2 &&
      /\p{L}-$/u.test(word.text) &&
      next.line !== word.line &&
      /^\p{Ll}/u.test(next.text)
    ) {
      const text = word.text.slice(0, -1) + next.text;
      joined.push({
        text,
        key: normalizeWordKey(text),
        page: word.page,
        line: word.line,
        boxes: [...word.boxes, ...next.boxes],
      });
      index += 1;
      continue;
    }
    joined.push(word);
  }
  return joined;
}

function sameLineAdjacent(left: PdfDiffRect, right: PdfDiffRect): boolean {
  const verticalOverlap =
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  const gap = right.x - (left.x + left.width);
  return (
    verticalOverlap > Math.min(left.height, right.height) * 0.5 &&
    gap > -left.height &&
    gap < Math.max(left.height, right.height) * 1.5
  );
}

/** Union of word boxes that sit next to each other on one line. */
export function mergeBoxes(boxes: readonly PdfDiffBox[]): PdfDiffBox[] {
  const merged: PdfDiffBox[] = [];
  for (const box of boxes) {
    const last = merged[merged.length - 1];
    if (last && last.page === box.page && sameLineAdjacent(last.rect, box.rect)) {
      const x = Math.min(last.rect.x, box.rect.x);
      const y = Math.min(last.rect.y, box.rect.y);
      last.rect = {
        x,
        y,
        width: Math.max(last.rect.x + last.rect.width, box.rect.x + box.rect.width) - x,
        height:
          Math.max(last.rect.y + last.rect.height, box.rect.y + box.rect.height) - y,
      };
      continue;
    }
    merged.push({ page: box.page, rect: { ...box.rect } });
  }
  return merged;
}

/** Where an insertion would go in the other version, drawn as a caret. */
function insertPoint(words: readonly PdfDiffWord[], index: number): PdfDiffBox | null {
  const before = words[index - 1];
  if (before) {
    const box = before.boxes[before.boxes.length - 1];
    return {
      page: box.page,
      rect: {
        x: box.rect.x + box.rect.width,
        y: box.rect.y,
        width: 0,
        height: box.rect.height,
      },
    };
  }
  const after = words[index];
  if (after) {
    const box = after.boxes[0];
    return {
      page: box.page,
      rect: { x: box.rect.x, y: box.rect.y, width: 0, height: box.rect.height },
    };
  }
  return null;
}

function addHighlight(
  target: Map<number, PdfDiffHighlight[]>,
  highlight: PdfDiffHighlight,
): void {
  const list = target.get(highlight.page);
  if (list) list.push(highlight);
  else target.set(highlight.page, [highlight]);
}

function joinText(words: readonly PdfDiffWord[], limit = 400): string {
  const text = words.map((word) => word.text).join(" ");
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * Word-level diff of two PDFs' text, like `git diff --word-diff`, with the
 * boxes to highlight on each version's pages.
 */
export function diffPdfWords(
  original: readonly PdfDiffWord[],
  modified: readonly PdfDiffWord[],
): PdfTextDiffResult {
  const ops = diffSequences(
    original.map((word) => word.key),
    modified.map((word) => word.key),
  );
  const hunks: PdfDiffHunk[] = [];
  const originalHighlights = new Map<number, PdfDiffHighlight[]>();
  const modifiedHighlights = new Map<number, PdfDiffHighlight[]>();
  const changedOriginal = new Set<number>();
  const changedModified = new Set<number>();
  let addedWords = 0;
  let removedWords = 0;

  for (let index = 0; index < ops.length; index += 1) {
    if (ops[index].kind === "equal") continue;
    // A run of delete/insert ops between two equal runs is one change.
    let end = index;
    while (end + 1 < ops.length && ops[end + 1].kind !== "equal") end += 1;
    // Ops are contiguous, so the run spans from its first op to its last.
    const { aStart, bStart } = ops[index];
    const { aEnd, bEnd } = ops[end];
    index = end;

    const removed = original.slice(aStart, aEnd);
    const added = modified.slice(bStart, bEnd);
    const id = hunks.length;
    const kind: PdfDiffHunkKind = removed.length
      ? added.length
        ? "changed"
        : "removed"
      : "added";
    removedWords += removed.length;
    addedWords += added.length;

    const removedBoxes = mergeBoxes(removed.flatMap((word) => word.boxes));
    const addedBoxes = mergeBoxes(added.flatMap((word) => word.boxes));
    const originalMarks = removedBoxes.length
      ? removedBoxes
      : [insertPoint(original, aStart)].filter((box): box is PdfDiffBox =>
          Boolean(box),
        );
    const modifiedMarks = addedBoxes.length
      ? addedBoxes
      : [insertPoint(modified, bStart)].filter((box): box is PdfDiffBox =>
          Boolean(box),
        );

    originalMarks.forEach((box, boxIndex) => {
      changedOriginal.add(box.page);
      addHighlight(originalHighlights, {
        id: `o${id}-${boxIndex}`,
        hunkId: id,
        kind: removedBoxes.length ? "removed" : "insert-point",
        page: box.page,
        rect: box.rect,
      });
    });
    modifiedMarks.forEach((box, boxIndex) => {
      changedModified.add(box.page);
      addHighlight(modifiedHighlights, {
        id: `m${id}-${boxIndex}`,
        hunkId: id,
        kind: addedBoxes.length ? "added" : "insert-point",
        page: box.page,
        rect: box.rect,
      });
    });

    hunks.push({
      id,
      kind,
      removedText: joinText(removed),
      addedText: joinText(added),
      removedCount: removed.length,
      addedCount: added.length,
      originalPage: originalMarks[0]?.page ?? null,
      modifiedPage: modifiedMarks[0]?.page ?? null,
      originalY: originalMarks[0]?.rect.y ?? 0,
      modifiedY: modifiedMarks[0]?.rect.y ?? 0,
      contextBefore: joinText(original.slice(Math.max(0, aStart - 4), aStart), 80),
    });
  }

  return {
    hunks,
    originalHighlights,
    modifiedHighlights,
    stats: {
      addedWords,
      removedWords,
      originalWords: original.length,
      modifiedWords: modified.length,
      changedOriginalPages: [...changedOriginal].sort((a, b) => a - b),
      changedModifiedPages: [...changedModified].sort((a, b) => a - b),
    },
  };
}
