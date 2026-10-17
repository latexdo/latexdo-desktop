import { useState, useMemo, useRef, useEffect } from "react";
import type { ClipboardEvent, KeyboardEvent, MouseEvent } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownAZ,
  ArrowUpAZ,
  Bold,
  Copy,
  Eraser,
  Italic,
  Plus,
  Redo2,
  RotateCcw,
  SquareSplitHorizontal,
  TableCellsMerge,
  Undo2,
  ArrowLeftRight,
  X,
} from "lucide-react";
import {
  ColumnAlign,
  TableBorderStyle,
  generateTableCode,
  mergeAt,
  requiredTablePackages,
} from "./tableGenerator";
import {
  type CellRange,
  type TableState,
  clearRange,
  deleteColumn,
  deleteRow,
  emptyTable,
  expandToMerges,
  inRange,
  insertColumn,
  insertRow,
  isSingleMerge,
  mergeRange,
  pasteBlock,
  rangeFrom,
  rangeSize,
  rangeToTsv,
  resizeTable,
  sortBlocker,
  sortByColumn,
  styleOf,
  toggleStyle,
  transposeTable,
  unmergeRange,
} from "./tableModel";

export interface TableCanvasProps {
  onInsertCode?: (code: string) => void;
}

const MAX_ROWS = 100;
const MAX_COLS = 26;
const MAX_HISTORY = 200;

const BORDER_STYLES: { value: TableBorderStyle; label: string; title: string }[] = [
  { value: "grid", label: "Grid", title: "Every cell boxed (\\hline + |)" },
  {
    value: "booktabs",
    label: "Booktabs",
    title: "Professional rules — needs \\usepackage{booktabs}",
  },
  { value: "header", label: "Rules", title: "Horizontal rules around the header only" },
  { value: "none", label: "None", title: "No rules at all" },
];

const ALIGN_ICONS = { l: AlignLeft, c: AlignCenter, r: AlignRight } as const;
const NEXT_ALIGN: Record<ColumnAlign, ColumnAlign> = { l: "c", c: "r", r: "l" };
const ALIGN_NAMES: Record<ColumnAlign, string> = { l: "left", c: "center", r: "right" };

const columnName = (index: number) => String.fromCharCode(65 + index);
const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl+";

export default function TableCanvas({ onInsertCode }: TableCanvasProps) {
  const [table, setTableState] = useState<TableState>(() => emptyTable(3, 3));
  const [borders, setBorders] = useState<TableBorderStyle>("grid");
  const [headerRow, setHeaderRow] = useState(true);
  const [escape, setEscape] = useState(true);
  const [float, setFloat] = useState(false);
  const [striped, setStriped] = useState(false);
  const [fitWidth, setFitWidth] = useState(false);
  const [caption, setCaption] = useState("");
  const [label, setLabel] = useState("tab:");
  const [copied, setCopied] = useState(false);
  const [focus, setFocus] = useState<[number, number] | null>(null);
  // The selected rectangle: its fixed corner and the corner that moves.
  const [anchor, setAnchor] = useState<[number, number] | null>(null);
  const [head, setHead] = useState<[number, number] | null>(null);
  const dragging = useRef(false);
  const pendingFocus = useRef<[number, number] | null>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  // Undo history. Typing in one cell is a single step.
  const past = useRef<TableState[]>([]);
  const future = useRef<TableState[]>([]);
  const lastEdit = useRef<string | null>(null);
  const [, setHistoryVersion] = useState(0);

  const { cells, align, merges } = table;
  const rows = cells.length;
  const cols = align.length;

  const selection: CellRange | null = useMemo(
    () => (anchor ? expandToMerges(merges, rangeFrom(anchor, head ?? anchor)) : null),
    [anchor, head, merges],
  );
  const multiSelected = selection !== null && rangeSize(selection) > 1;

  const options = {
    cells,
    align,
    borders,
    headerRow,
    escape,
    float,
    caption,
    label,
    merges,
    styles: table.styles,
    striped,
    fitWidth,
  };
  const code = useMemo(
    () => generateTableCode(options),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table, borders, headerRow, escape, float, caption, label, striped, fitWidth],
  );
  const packages = requiredTablePackages(options);

  /** Applies a change, recording it for undo. */
  const commit = (next: TableState, editKey: string | null = null) => {
    if (next === table) return;
    if (editKey === null || editKey !== lastEdit.current) {
      past.current = [...past.current.slice(-MAX_HISTORY + 1), table];
    }
    lastEdit.current = editKey;
    future.current = [];
    setTableState(next);
    setHistoryVersion((v) => v + 1);
  };

  const undo = () => {
    const previous = past.current.pop();
    if (!previous) return;
    future.current.push(table);
    lastEdit.current = null;
    setTableState(previous);
    setHistoryVersion((v) => v + 1);
  };

  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(table);
    lastEdit.current = null;
    setTableState(next);
    setHistoryVersion((v) => v + 1);
  };

  // Focus a cell after the render that creates it (e.g. Enter on the last row).
  useEffect(() => {
    if (!pendingFocus.current) return;
    const [r, c] = pendingFocus.current;
    pendingFocus.current = null;
    gridRef.current
      ?.querySelector<HTMLInputElement>(`input[data-cell="${r}-${c}"]`)
      ?.focus();
  });

  useEffect(() => {
    const stopDrag = () => {
      dragging.current = false;
    };
    window.addEventListener("mouseup", stopDrag);
    return () => window.removeEventListener("mouseup", stopDrag);
  }, []);

  const select = (r: number, c: number, extend = false) => {
    if (extend && anchor) {
      setHead([r, c]);
    } else {
      setAnchor([r, c]);
      setHead([r, c]);
    }
  };

  /** Moves to a cell, landing on the top-left of a merged block. */
  const focusCell = (r: number, c: number, extend = false) => {
    const m = mergeAt(merges, r, c);
    const target: [number, number] = m && !extend ? [m.r, m.c] : [r, c];
    pendingFocus.current = extend ? null : target;
    setFocus(target);
    select(target[0], target[1], extend);
  };

  const run = (next: TableState) => commit(next);

  const resize = (nextRows: number, nextCols: number) => {
    const r = Math.min(Math.max(nextRows, 1), MAX_ROWS);
    const c = Math.min(Math.max(nextCols, 1), MAX_COLS);
    run(resizeTable(table, r, c));
  };

  const reset = () => {
    run(emptyTable(3, 3));
    setAnchor(null);
    setHead(null);
  };

  const cellRange = selection ?? (focus ? rangeFrom(focus) : null);
  const merge = () => selection && run(mergeRange(table, selection));
  const unmerge = () => selection && run(unmergeRange(table, selection));
  const style = (key: "bold" | "italic") =>
    cellRange && run(toggleStyle(table, cellRange, key));
  const sortColumn = focus?.[1] ?? selection?.c1 ?? 0;
  const blocker = sortBlocker(table, headerRow);
  const sort = (direction: "asc" | "desc") =>
    run(sortByColumn(table, sortColumn, direction, headerRow));
  const transpose = () => {
    if (rows > MAX_COLS) return;
    run(transposeTable(table));
    setAnchor(null);
    setHead(null);
  };
  const hasMergeInSelection =
    selection !== null &&
    merges.some(
      (m) =>
        m.r <= selection.r2 &&
        m.r + m.rows - 1 >= selection.r1 &&
        m.c <= selection.c2 &&
        m.c + m.cols - 1 >= selection.c1,
    );

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const input = e.currentTarget;
    const command = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    if (command && key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (command && key === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (command && (key === "b" || key === "i")) {
      e.preventDefault();
      style(key === "b" ? "bold" : "italic");
      return;
    }
    if (multiSelected && command && (key === "c" || key === "x")) {
      e.preventDefault();
      void navigator.clipboard?.writeText(rangeToTsv(table, selection!));
      if (key === "x") run(clearRange(table, selection!));
      return;
    }
    if (multiSelected && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      run(clearRange(table, selection!));
      return;
    }

    const m = mergeAt(merges, r, c);
    const bottom = m ? m.r + m.rows - 1 : r;
    const right = m ? m.c + m.cols - 1 : c;
    const [hr, hc] = head ?? [r, c];

    if (e.shiftKey && e.key.startsWith("Arrow")) {
      // Shift+arrows grow the selection, like a spreadsheet.
      e.preventDefault();
      const next: [number, number] =
        e.key === "ArrowUp"
          ? [Math.max(hr - 1, 0), hc]
          : e.key === "ArrowDown"
            ? [Math.min(hr + 1, rows - 1), hc]
            : e.key === "ArrowLeft"
              ? [hr, Math.max(hc - 1, 0)]
              : [hr, Math.min(hc + 1, cols - 1)];
      if (!anchor) setAnchor([r, c]);
      setHead(next);
      return;
    }

    if (e.key === "Enter" || (e.key === "ArrowDown" && !e.altKey)) {
      e.preventDefault();
      const next = e.shiftKey ? r - 1 : bottom + 1;
      if (next >= rows && e.key === "Enter") {
        if (rows >= MAX_ROWS) return;
        run(insertRow(table, rows));
      }
      if (next >= 0 && (next < rows || e.key === "Enter")) focusCell(next, c);
    } else if (e.key === "ArrowUp" && r > 0) {
      e.preventDefault();
      focusCell(r - 1, c);
    } else if (
      e.key === "ArrowLeft" &&
      input.selectionStart === 0 &&
      input.selectionEnd === 0 &&
      c > 0
    ) {
      e.preventDefault();
      focusCell(r, c - 1);
    } else if (
      e.key === "ArrowRight" &&
      input.selectionStart === input.value.length &&
      right < cols - 1
    ) {
      e.preventDefault();
      focusCell(r, right + 1);
    } else if (
      e.key === "Tab" &&
      !e.shiftKey &&
      bottom === rows - 1 &&
      right === cols - 1
    ) {
      e.preventDefault();
      if (rows >= MAX_ROWS) return;
      run(insertRow(table, rows));
      focusCell(rows, 0);
    } else if (e.key === "Escape" && multiSelected) {
      e.preventDefault();
      select(r, c);
    }
  };

  // Paste a block from Excel / Sheets / CSV starting at the focused cell.
  const handlePaste = (e: ClipboardEvent<HTMLInputElement>, r: number, c: number) => {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
    const sep = lines.some((l) => l.includes("\t")) ? "\t" : ",";
    run(
      pasteBlock(
        table,
        r,
        c,
        lines.map((l) => l.split(sep)),
        MAX_ROWS,
        MAX_COLS,
      ),
    );
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const onCellMouseDown = (e: MouseEvent, r: number, c: number) => {
    if (e.button !== 0) return;
    dragging.current = true;
    if (e.shiftKey && anchor) {
      e.preventDefault();
      setHead([r, c]);
      return;
    }
    select(r, c);
  };

  const onCellMouseEnter = (r: number, c: number) => {
    if (dragging.current && anchor) setHead([r, c]);
  };

  const canUndo = past.current.length > 0;
  const canRedo = future.current.length > 0;
  const bold = cellRange ? styleOf(table, cellRange, "bold") : false;
  const italic = cellRange ? styleOf(table, cellRange, "italic") : false;
  const selectionLabel = selection
    ? rangeSize(selection) > 1
      ? `${columnName(selection.c1)}${selection.r1 + 1}:${columnName(selection.c2)}${selection.r2 + 1}`
      : `${columnName(selection.c1)}${selection.r1 + 1}`
    : "";

  return (
    <div className="tikz-canvas-root table-canvas">
      <div className="tikz-draw-area">
        <div className="tikz-toolbar table-toolbar">
          <div className="table-size">
            <label>
              Rows
              <input
                type="number"
                min={1}
                max={MAX_ROWS}
                value={rows}
                onChange={(e) => resize(Number(e.target.value) || 1, cols)}
              />
            </label>
            <span className="table-size-x">×</span>
            <label>
              Cols
              <input
                type="number"
                min={1}
                max={MAX_COLS}
                value={cols}
                onChange={(e) => resize(rows, Number(e.target.value) || 1)}
              />
            </label>
          </div>
          <div className="tikz-toolbar-divider" />
          <div className="table-segmented" role="radiogroup" aria-label="Borders">
            {BORDER_STYLES.map((s) => (
              <button
                key={s.value}
                role="radio"
                aria-checked={borders === s.value}
                className={borders === s.value ? "active" : ""}
                title={s.title}
                onClick={() => setBorders(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="tikz-toolbar-divider" />
          <label className="table-check" title="Bold first row, with a rule below it">
            <input
              type="checkbox"
              checked={headerRow}
              onChange={(e) => setHeaderRow(e.target.checked)}
            />
            Header row
          </label>
          <label
            className="table-check"
            title="Escape & % $ # _ { } ~ ^ \ — turn off to write raw LaTeX such as $x^2$"
          >
            <input
              type="checkbox"
              checked={escape}
              onChange={(e) => setEscape(e.target.checked)}
            />
            Escape text
          </label>
          <label
            className="table-check"
            title="Shade every other row — needs \usepackage[table]{xcolor}"
          >
            <input
              type="checkbox"
              checked={striped}
              onChange={(e) => setStriped(e.target.checked)}
            />
            Striped rows
          </label>
          <label
            className="table-check"
            title="Scale the table to the text width — needs \usepackage{graphicx}"
          >
            <input
              type="checkbox"
              checked={fitWidth}
              onChange={(e) => setFitWidth(e.target.checked)}
            />
            Fit to width
          </label>
          <label
            className="table-check"
            title="Wrap in a table float with caption and label"
          >
            <input
              type="checkbox"
              checked={float}
              onChange={(e) => setFloat(e.target.checked)}
            />
            Caption
          </label>
          <div className="tikz-toolbar-actions table-toolbar-end">
            <button
              className="tikz-action-btn tikz-clear-btn"
              onClick={reset}
              title="Reset table"
              aria-label="Reset table"
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>

        <div className="table-format-bar" role="toolbar" aria-label="Cell tools">
          <button
            className="table-tool"
            onClick={undo}
            disabled={!canUndo}
            title={`Undo (${mod}Z)`}
            aria-label="Undo"
          >
            <Undo2 size={14} />
          </button>
          <button
            className="table-tool"
            onClick={redo}
            disabled={!canRedo}
            title={`Redo (${isMac ? "⇧⌘Z" : "Ctrl+Y"})`}
            aria-label="Redo"
          >
            <Redo2 size={14} />
          </button>
          <span className="table-tool-divider" />
          <button
            className="table-tool labeled"
            onClick={merge}
            disabled={
              !multiSelected || (selection !== null && isSingleMerge(merges, selection))
            }
            title="Merge the selected cells into one (\multicolumn / \multirow)"
          >
            <TableCellsMerge size={14} /> Merge
          </button>
          <button
            className="table-tool labeled"
            onClick={unmerge}
            disabled={!hasMergeInSelection}
            title="Split merged cells back apart"
          >
            <SquareSplitHorizontal size={14} /> Unmerge
          </button>
          <span className="table-tool-divider" />
          <button
            className={`table-tool ${bold ? "active" : ""}`}
            onClick={() => style("bold")}
            disabled={!cellRange}
            aria-pressed={bold}
            title={`Bold (${mod}B)`}
            aria-label="Bold"
          >
            <Bold size={14} />
          </button>
          <button
            className={`table-tool ${italic ? "active" : ""}`}
            onClick={() => style("italic")}
            disabled={!cellRange}
            aria-pressed={italic}
            title={`Italic (${mod}I)`}
            aria-label="Italic"
          >
            <Italic size={14} />
          </button>
          <button
            className="table-tool"
            onClick={() => cellRange && run(clearRange(table, cellRange))}
            disabled={!cellRange}
            title="Clear the selected cells (Delete)"
            aria-label="Clear cells"
          >
            <Eraser size={14} />
          </button>
          <span className="table-tool-divider" />
          <button
            className="table-tool"
            onClick={() => sort("asc")}
            disabled={Boolean(blocker)}
            title={blocker ?? `Sort rows by column ${columnName(sortColumn)}, A to Z`}
            aria-label="Sort A to Z"
          >
            <ArrowDownAZ size={14} />
          </button>
          <button
            className="table-tool"
            onClick={() => sort("desc")}
            disabled={Boolean(blocker)}
            title={blocker ?? `Sort rows by column ${columnName(sortColumn)}, Z to A`}
            aria-label="Sort Z to A"
          >
            <ArrowUpAZ size={14} />
          </button>
          <button
            className="table-tool"
            onClick={transpose}
            disabled={rows > MAX_COLS}
            title="Swap rows and columns"
            aria-label="Transpose"
          >
            <ArrowLeftRight size={14} />
          </button>
          {selectionLabel ? (
            <span className="table-selection-label" aria-live="polite">
              {selectionLabel}
            </span>
          ) : null}
        </div>

        {float && (
          <div className="table-float-fields">
            <input
              placeholder="Caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
            <input
              className="table-label-input"
              placeholder="tab:label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
        )}

        <div className="table-grid-scroll">
          <div className="table-grid-wrap">
            <table ref={gridRef} className={`table-grid table-grid-${borders}`}>
              <thead>
                <tr>
                  <th className="table-corner" />
                  {align.map((a, c) => {
                    const Icon = ALIGN_ICONS[a];
                    return (
                      <th
                        key={c}
                        className={`table-col-head ${focus?.[1] === c ? "focused" : ""}`}
                      >
                        <span className="table-col-name">{columnName(c)}</span>
                        <button
                          className="table-align-btn"
                          onClick={() =>
                            run({
                              ...table,
                              align: align.map((v, j) => (j === c ? NEXT_ALIGN[v] : v)),
                            })
                          }
                          title={`Aligned ${ALIGN_NAMES[a]} — click to change`}
                        >
                          <Icon size={13} />
                        </button>
                        <button
                          className="table-head-btn"
                          onClick={() => run(insertColumn(table, c + 1))}
                          title="Insert column to the right"
                          disabled={cols >= MAX_COLS}
                        >
                          <Plus size={12} />
                        </button>
                        <button
                          className="table-head-btn table-remove-btn"
                          onClick={() => run(deleteColumn(table, c))}
                          title="Delete column"
                          disabled={cols <= 1}
                        >
                          <X size={12} />
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {cells.map((row, r) => (
                  <tr
                    key={r}
                    className={`${headerRow && r === 0 ? "table-header-row" : ""} ${
                      striped &&
                      r >= (headerRow ? 1 : 0) &&
                      (r - (headerRow ? 1 : 0)) % 2 === 1
                        ? "table-striped-row"
                        : ""
                    }`}
                  >
                    <th
                      className={`table-row-head ${focus?.[0] === r ? "focused" : ""}`}
                    >
                      <span className="table-row-num">{r + 1}</span>
                      <span className="table-row-actions">
                        <button
                          className="table-head-btn"
                          onClick={() =>
                            rows < MAX_ROWS && run(insertRow(table, r + 1))
                          }
                          title="Insert row below"
                          disabled={rows >= MAX_ROWS}
                        >
                          <Plus size={12} />
                        </button>
                        <button
                          className="table-head-btn table-remove-btn"
                          onClick={() => run(deleteRow(table, r))}
                          title="Delete row"
                          disabled={rows <= 1}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    </th>
                    {row.map((cell, c) => {
                      const m = mergeAt(merges, r, c);
                      if (m && (m.r !== r || m.c !== c)) return null;
                      const cellStyle = table.styles[r]?.[c];
                      const selected = selection !== null && inRange(selection, r, c);
                      return (
                        <td
                          key={c}
                          rowSpan={m?.rows}
                          colSpan={m?.cols}
                          className={`${selected && multiSelected ? "selected" : ""} ${
                            m ? "merged" : ""
                          }`}
                          onMouseDown={(e) => onCellMouseDown(e, r, c)}
                          onMouseEnter={() => onCellMouseEnter(r, c)}
                        >
                          <input
                            data-cell={`${r}-${c}`}
                            value={cell}
                            aria-label={`Cell ${columnName(c)}${r + 1}`}
                            style={{
                              textAlign:
                                align[c] === "l"
                                  ? "left"
                                  : align[c] === "r"
                                    ? "right"
                                    : "center",
                              fontWeight: cellStyle?.bold ? 700 : undefined,
                              fontStyle: cellStyle?.italic ? "italic" : undefined,
                            }}
                            placeholder={headerRow && r === 0 ? `Header ${c + 1}` : ""}
                            onChange={(e) =>
                              commit(
                                {
                                  ...table,
                                  cells: cells.map((rowValues, i) =>
                                    i === r
                                      ? rowValues.map((v, j) =>
                                          j === c ? e.target.value : v,
                                        )
                                      : rowValues,
                                  ),
                                },
                                `${r}-${c}`,
                              )
                            }
                            onFocus={() => {
                              setFocus([r, c]);
                              if (!dragging.current && !multiSelected) select(r, c);
                            }}
                            onBlur={() => setFocus(null)}
                            onKeyDown={(e) => handleKeyDown(e, r, c)}
                            onPaste={(e) => handlePaste(e, r, c)}
                            spellCheck={false}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              className="table-add-col"
              onClick={() => run(insertColumn(table, cols))}
              disabled={cols >= MAX_COLS}
              title="Add column"
            >
              <Plus size={14} />
            </button>
          </div>
          <button
            className="table-add-row"
            onClick={() => rows < MAX_ROWS && run(insertRow(table, rows))}
            disabled={rows >= MAX_ROWS}
            title="Add row"
          >
            <Plus size={14} /> Add row
          </button>
          <p className="table-hint">
            Drag or Shift+click to select cells, then Merge · {mod}B bold · {mod}I
            italic · {mod}Z undo · Enter moves down · Tab moves right · Paste cells
            straight from Excel, Sheets or CSV
          </p>
        </div>
      </div>

      <div className="tikz-code-panel">
        <div className="tikz-code-header">
          <div className="tikz-code-title">
            <span>Generated Code</span>
          </div>
          <div className="tikz-code-actions">
            <button
              className="tikz-code-action-btn"
              onClick={() => void handleCopy()}
              title="Copy to clipboard"
            >
              <Copy size={13} />
              {copied ? "Copied!" : "Copy"}
            </button>
            {onInsertCode && (
              <button
                className="tikz-code-action-btn tikz-insert-btn"
                onClick={() => onInsertCode(code)}
                title="Insert into editor"
              >
                <Plus size={13} />
                Insert
              </button>
            )}
          </div>
          {packages.length ? (
            <div className="table-code-note">
              Add to your preamble:{" "}
              {packages.map((line) => (
                <code key={line}>{line}</code>
              ))}
            </div>
          ) : null}
        </div>
        <div className="tikz-code-body">
          <pre className="tikz-code-pre">
            <code>{code}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
