/*
 * The table being edited in the Table Generator, and every change to it as a
 * pure function: merging, formatting, inserting and deleting rows and columns
 * (which move merged blocks along), sorting and transposing.
 */

import type { CellMerge, CellStyle, ColumnAlign } from "./tableGenerator";
import { mergeAt } from "./tableGenerator";

export interface TableState {
  cells: string[][];
  align: ColumnAlign[];
  merges: CellMerge[];
  styles: (CellStyle | undefined)[][];
}

/** A rectangle of cells, inclusive on both ends. */
export interface CellRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export function emptyTable(rows: number, cols: number): TableState {
  return {
    cells: Array.from({ length: rows }, () => Array<string>(cols).fill("")),
    align: Array<ColumnAlign>(cols).fill("c"),
    merges: [],
    styles: Array.from({ length: rows }, () => Array<CellStyle | undefined>(cols)),
  };
}

export function rangeFrom(a: [number, number], b: [number, number] = a): CellRange {
  return {
    r1: Math.min(a[0], b[0]),
    c1: Math.min(a[1], b[1]),
    r2: Math.max(a[0], b[0]),
    c2: Math.max(a[1], b[1]),
  };
}

export function rangeSize(range: CellRange): number {
  return (range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1);
}

export function inRange(range: CellRange, r: number, c: number): boolean {
  return r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;
}

function overlaps(m: CellMerge, range: CellRange): boolean {
  return (
    m.r <= range.r2 &&
    m.r + m.rows - 1 >= range.r1 &&
    m.c <= range.c2 &&
    m.c + m.cols - 1 >= range.c1
  );
}

/**
 * Grows a range until it cuts through no merged block, as a spreadsheet does
 * when a selection touches part of a merge.
 */
export function expandToMerges(
  merges: readonly CellMerge[],
  range: CellRange,
): CellRange {
  let next = { ...range };
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of merges) {
      if (!overlaps(m, next)) continue;
      const grown = {
        r1: Math.min(next.r1, m.r),
        c1: Math.min(next.c1, m.c),
        r2: Math.max(next.r2, m.r + m.rows - 1),
        c2: Math.max(next.c2, m.c + m.cols - 1),
      };
      if (
        grown.r1 !== next.r1 ||
        grown.c1 !== next.c1 ||
        grown.r2 !== next.r2 ||
        grown.c2 !== next.c2
      ) {
        next = grown;
        changed = true;
      }
    }
  }
  return next;
}

/** True when the range is exactly one merged block. */
export function isSingleMerge(merges: readonly CellMerge[], range: CellRange): boolean {
  const m = mergeAt(merges, range.r1, range.c1);
  return Boolean(
    m &&
    m.r === range.r1 &&
    m.c === range.c1 &&
    m.r + m.rows - 1 === range.r2 &&
    m.c + m.cols - 1 === range.c2,
  );
}

/**
 * Merges a range into one cell. Nothing is lost: the texts of the merged
 * cells are joined, in reading order, into the top-left cell.
 */
export function mergeRange(table: TableState, range: CellRange): TableState {
  const area = expandToMerges(table.merges, range);
  if (rangeSize(area) < 2) return table;
  const texts: string[] = [];
  for (let r = area.r1; r <= area.r2; r++) {
    for (let c = area.c1; c <= area.c2; c++) {
      const text = table.cells[r]?.[c]?.trim();
      if (text) texts.push(text);
    }
  }
  const cells = table.cells.map((row, r) =>
    row.map((value, c) => {
      if (!inRange(area, r, c)) return value;
      return r === area.r1 && c === area.c1 ? texts.join(" ") : "";
    }),
  );
  return {
    ...table,
    cells,
    merges: [
      ...table.merges.filter((m) => !overlaps(m, area)),
      {
        r: area.r1,
        c: area.c1,
        rows: area.r2 - area.r1 + 1,
        cols: area.c2 - area.c1 + 1,
      },
    ],
  };
}

/** Splits every merged block that touches the range back into cells. */
export function unmergeRange(table: TableState, range: CellRange): TableState {
  return { ...table, merges: table.merges.filter((m) => !overlaps(m, range)) };
}

/**
 * Turns a style on for every cell of the range, or off when every cell
 * already has it (like a word processor's Bold button).
 */
export function toggleStyle(
  table: TableState,
  range: CellRange,
  key: keyof CellStyle,
): TableState {
  let allOn = true;
  for (let r = range.r1; r <= range.r2; r++) {
    for (let c = range.c1; c <= range.c2; c++) {
      if (!table.styles[r]?.[c]?.[key]) allOn = false;
    }
  }
  const styles = table.cells.map((row, r) =>
    row.map((_, c) => {
      const current = table.styles[r]?.[c];
      if (!inRange(range, r, c)) return current;
      const next = { ...current, [key]: !allOn };
      return next.bold || next.italic ? next : undefined;
    }),
  );
  return { ...table, styles };
}

export function styleOf(table: TableState, range: CellRange, key: keyof CellStyle) {
  for (let r = range.r1; r <= range.r2; r++) {
    for (let c = range.c1; c <= range.c2; c++) {
      if (!table.styles[r]?.[c]?.[key]) return false;
    }
  }
  return true;
}

export function clearRange(table: TableState, range: CellRange): TableState {
  return {
    ...table,
    cells: table.cells.map((row, r) =>
      row.map((value, c) => (inRange(range, r, c) ? "" : value)),
    ),
  };
}

/** The range as tab-separated text, ready to paste into a spreadsheet. */
export function rangeToTsv(table: TableState, range: CellRange): string {
  const lines: string[] = [];
  for (let r = range.r1; r <= range.r2; r++) {
    lines.push(table.cells[r]!.slice(range.c1, range.c2 + 1).join("\t"));
  }
  return lines.join("\n");
}

export function insertRow(table: TableState, at: number): TableState {
  const cols = table.align.length;
  return {
    ...table,
    cells: [
      ...table.cells.slice(0, at),
      Array<string>(cols).fill(""),
      ...table.cells.slice(at),
    ],
    styles: [
      ...table.styles.slice(0, at),
      Array<CellStyle | undefined>(cols),
      ...table.styles.slice(at),
    ],
    merges: table.merges.map((m) =>
      m.r >= at
        ? { ...m, r: m.r + 1 }
        : m.r + m.rows > at
          ? { ...m, rows: m.rows + 1 }
          : m,
    ),
  };
}

export function insertColumn(table: TableState, at: number): TableState {
  return {
    cells: table.cells.map((row) => [...row.slice(0, at), "", ...row.slice(at)]),
    styles: table.styles.map((row) => [
      ...row.slice(0, at),
      undefined,
      ...row.slice(at),
    ]),
    align: [...table.align.slice(0, at), "c", ...table.align.slice(at)],
    merges: table.merges.map((m) =>
      m.c >= at
        ? { ...m, c: m.c + 1 }
        : m.c + m.cols > at
          ? { ...m, cols: m.cols + 1 }
          : m,
    ),
  };
}

/** Keeps merges valid after a line is removed; blocks of one cell vanish. */
function shrinkMerges(
  merges: readonly CellMerge[],
  at: number,
  axis: "r" | "c",
): CellMerge[] {
  const size = axis === "r" ? "rows" : "cols";
  return merges
    .map((m) => {
      if (m[axis] > at) return { ...m, [axis]: m[axis] - 1 };
      if (m[axis] + m[size] - 1 >= at) return { ...m, [size]: m[size] - 1 };
      return m;
    })
    .filter((m) => m.rows > 0 && m.cols > 0 && m.rows * m.cols > 1);
}

/** The anchor's text moves to the next row or column when its line goes. */
function keepAnchorText(table: TableState, at: number, axis: "r" | "c"): string[][] {
  const cells = table.cells.map((row) => [...row]);
  for (const m of table.merges) {
    const size = axis === "r" ? m.rows : m.cols;
    if (m[axis] !== at || size < 2) continue;
    const text = cells[m.r]![m.c]!;
    if (axis === "r") cells[m.r + 1]![m.c] = text;
    else cells[m.r]![m.c + 1] = text;
  }
  return cells;
}

export function deleteRow(table: TableState, at: number): TableState {
  if (table.cells.length <= 1) return table;
  const cells = keepAnchorText(table, at, "r");
  return {
    ...table,
    cells: cells.filter((_, r) => r !== at),
    styles: table.styles.filter((_, r) => r !== at),
    merges: shrinkMerges(table.merges, at, "r"),
  };
}

export function deleteColumn(table: TableState, at: number): TableState {
  if (table.align.length <= 1) return table;
  const cells = keepAnchorText(table, at, "c");
  return {
    cells: cells.map((row) => row.filter((_, c) => c !== at)),
    styles: table.styles.map((row) => row.filter((_, c) => c !== at)),
    align: table.align.filter((_, c) => c !== at),
    merges: shrinkMerges(table.merges, at, "c"),
  };
}

/** Grows or shrinks the grid; merges that no longer fit are dropped. */
export function resizeTable(table: TableState, rows: number, cols: number): TableState {
  return {
    cells: Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => table.cells[r]?.[c] ?? ""),
    ),
    styles: Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => table.styles[r]?.[c]),
    ),
    align: Array.from({ length: cols }, (_, c) => table.align[c] ?? "c"),
    merges: table.merges.filter((m) => m.r + m.rows <= rows && m.c + m.cols <= cols),
  };
}

/** Why rows cannot be sorted right now, or null when they can. */
export function sortBlocker(table: TableState, headerRow: boolean): string | null {
  const first = headerRow ? 1 : 0;
  return table.merges.some((m) => m.r + m.rows > first)
    ? "Unmerge the cells below the header to sort the rows."
    : null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Sorts the rows below the header by one column. Numbers compare as numbers
 * ("9" before "10") and empty cells go last.
 */
export function sortByColumn(
  table: TableState,
  column: number,
  direction: "asc" | "desc",
  headerRow: boolean,
): TableState {
  if (sortBlocker(table, headerRow)) return table;
  const first = headerRow ? 1 : 0;
  const order = table.cells
    .map((row, r) => ({ row, style: table.styles[r]!, r }))
    .slice(first)
    .sort((a, b) => {
      const x = a.row[column]!.trim();
      const y = b.row[column]!.trim();
      if (!x || !y) return x ? -1 : y ? 1 : a.r - b.r;
      const result = collator.compare(x, y);
      return (direction === "asc" ? result : -result) || a.r - b.r;
    });
  return {
    ...table,
    cells: [...table.cells.slice(0, first), ...order.map((entry) => entry.row)],
    styles: [...table.styles.slice(0, first), ...order.map((entry) => entry.style)],
  };
}

/** Swaps rows and columns, merges and formatting included. */
export function transposeTable(table: TableState): TableState {
  const rows = table.cells.length;
  const cols = table.align.length;
  return {
    cells: Array.from({ length: cols }, (_, c) =>
      Array.from({ length: rows }, (_, r) => table.cells[r]![c]!),
    ),
    styles: Array.from({ length: cols }, (_, c) =>
      Array.from({ length: rows }, (_, r) => table.styles[r]?.[c]),
    ),
    align: Array<ColumnAlign>(rows).fill("c"),
    merges: table.merges.map((m) => ({ r: m.c, c: m.r, rows: m.cols, cols: m.rows })),
  };
}

/** Writes a pasted block at (r, c), growing the table as needed. */
export function pasteBlock(
  table: TableState,
  r: number,
  c: number,
  block: string[][],
  maxRows: number,
  maxCols: number,
): TableState {
  const width = Math.max(...block.map((line) => line.length));
  const rows = Math.min(Math.max(table.cells.length, r + block.length), maxRows);
  const cols = Math.min(Math.max(table.align.length, c + width), maxCols);
  const grown = resizeTable(table, rows, cols);
  return {
    ...grown,
    cells: grown.cells.map((row, i) =>
      row.map((value, j) => {
        const pasted = block[i - r]?.[j - c];
        return pasted !== undefined ? pasted.trim() : value;
      }),
    ),
  };
}
