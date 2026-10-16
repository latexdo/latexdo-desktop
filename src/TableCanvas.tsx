import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Copy,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { ColumnAlign, TableBorderStyle, generateTableCode } from "./tableGenerator";

export interface TableCanvasProps {
  onInsertCode?: (code: string) => void;
}

const MAX_ROWS = 100;
const MAX_COLS = 26;

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

const emptyGrid = (rows: number, cols: number) =>
  Array.from({ length: rows }, () => Array<string>(cols).fill(""));

const columnName = (index: number) => String.fromCharCode(65 + index);

export default function TableCanvas({ onInsertCode }: TableCanvasProps) {
  const [cells, setCells] = useState<string[][]>(() => emptyGrid(3, 3));
  const [align, setAlign] = useState<ColumnAlign[]>(["c", "c", "c"]);
  const [borders, setBorders] = useState<TableBorderStyle>("grid");
  const [headerRow, setHeaderRow] = useState(true);
  const [escape, setEscape] = useState(true);
  const [float, setFloat] = useState(false);
  const [caption, setCaption] = useState("");
  const [label, setLabel] = useState("tab:");
  const [copied, setCopied] = useState(false);
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const pendingFocus = useRef<[number, number] | null>(null);
  const gridRef = useRef<HTMLTableElement>(null);

  const rows = cells.length;
  const cols = align.length;

  const code = useMemo(
    () =>
      generateTableCode({
        cells,
        align,
        borders,
        headerRow,
        escape,
        float,
        caption,
        label,
      }),
    [cells, align, borders, headerRow, escape, float, caption, label],
  );

  // Focus a cell after the render that creates it (e.g. Enter on the last row).
  useEffect(() => {
    if (!pendingFocus.current) return;
    const [r, c] = pendingFocus.current;
    pendingFocus.current = null;
    gridRef.current
      ?.querySelector<HTMLInputElement>(`input[data-cell="${r}-${c}"]`)
      ?.focus();
  });

  const focusCell = (r: number, c: number) => {
    pendingFocus.current = [r, c];
    setFocus([r, c]);
  };

  const updateCell = (r: number, c: number, value: string) => {
    setCells((prev) =>
      prev.map((row, i) => (i === r ? row.map((v, j) => (j === c ? value : v)) : row)),
    );
  };

  const insertRow = useCallback(
    (at: number) => {
      if (rows >= MAX_ROWS) return;
      setCells((prev) => [
        ...prev.slice(0, at),
        Array<string>(cols).fill(""),
        ...prev.slice(at),
      ]);
    },
    [rows, cols],
  );

  const removeRow = (at: number) => {
    if (rows <= 1) return;
    setCells((prev) => prev.filter((_, i) => i !== at));
  };

  const insertCol = (at: number) => {
    if (cols >= MAX_COLS) return;
    setCells((prev) => prev.map((row) => [...row.slice(0, at), "", ...row.slice(at)]));
    setAlign((prev) => [...prev.slice(0, at), "c", ...prev.slice(at)]);
  };

  const removeCol = (at: number) => {
    if (cols <= 1) return;
    setCells((prev) => prev.map((row) => row.filter((_, j) => j !== at)));
    setAlign((prev) => prev.filter((_, j) => j !== at));
  };

  const resize = (nextRows: number, nextCols: number) => {
    const r = Math.min(Math.max(nextRows, 1), MAX_ROWS);
    const c = Math.min(Math.max(nextCols, 1), MAX_COLS);
    setCells((prev) =>
      Array.from({ length: r }, (_, i) =>
        Array.from({ length: c }, (_, j) => prev[i]?.[j] ?? ""),
      ),
    );
    setAlign((prev) => Array.from({ length: c }, (_, j) => prev[j] ?? "c"));
  };

  const reset = () => {
    setCells(emptyGrid(3, 3));
    setAlign(["c", "c", "c"]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const input = e.currentTarget;
    if (e.key === "Enter" || (e.key === "ArrowDown" && !e.altKey)) {
      e.preventDefault();
      const next = e.shiftKey ? r - 1 : r + 1;
      if (next >= rows && e.key === "Enter") insertRow(rows);
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
      c < cols - 1
    ) {
      e.preventDefault();
      focusCell(r, c + 1);
    } else if (e.key === "Tab" && !e.shiftKey && r === rows - 1 && c === cols - 1) {
      e.preventDefault();
      insertRow(rows);
      focusCell(rows, 0);
    }
  };

  // Paste a block from Excel / Sheets / CSV starting at the focused cell.
  const handlePaste = (e: ClipboardEvent<HTMLInputElement>, r: number, c: number) => {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
    const sep = lines.some((l) => l.includes("\t")) ? "\t" : ",";
    const block = lines.map((l) => l.split(sep));
    const width = Math.max(...block.map((l) => l.length));
    const nextRows = Math.min(Math.max(rows, r + block.length), MAX_ROWS);
    const nextCols = Math.min(Math.max(cols, c + width), MAX_COLS);
    setCells((prev) =>
      Array.from({ length: nextRows }, (_, i) =>
        Array.from({ length: nextCols }, (_, j) => {
          const pasted = block[i - r]?.[j - c];
          return pasted !== undefined ? pasted.trim() : (prev[i]?.[j] ?? "");
        }),
      ),
    );
    setAlign((prev) => Array.from({ length: nextCols }, (_, j) => prev[j] ?? "c"));
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
            {BORDER_STYLES.map((style) => (
              <button
                key={style.value}
                role="radio"
                aria-checked={borders === style.value}
                className={borders === style.value ? "active" : ""}
                title={style.title}
                onClick={() => setBorders(style.value)}
              >
                {style.label}
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
            >
              <RotateCcw size={14} />
            </button>
          </div>
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
                            setAlign((prev) =>
                              prev.map((v, j) => (j === c ? NEXT_ALIGN[v] : v)),
                            )
                          }
                          title={`Aligned ${ALIGN_NAMES[a]} — click to change`}
                        >
                          <Icon size={13} />
                        </button>
                        <button
                          className="table-head-btn"
                          onClick={() => insertCol(c + 1)}
                          title="Insert column to the right"
                          disabled={cols >= MAX_COLS}
                        >
                          <Plus size={12} />
                        </button>
                        <button
                          className="table-head-btn table-remove-btn"
                          onClick={() => removeCol(c)}
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
                    className={headerRow && r === 0 ? "table-header-row" : ""}
                  >
                    <th
                      className={`table-row-head ${focus?.[0] === r ? "focused" : ""}`}
                    >
                      <span className="table-row-num">{r + 1}</span>
                      <span className="table-row-actions">
                        <button
                          className="table-head-btn"
                          onClick={() => insertRow(r + 1)}
                          title="Insert row below"
                          disabled={rows >= MAX_ROWS}
                        >
                          <Plus size={12} />
                        </button>
                        <button
                          className="table-head-btn table-remove-btn"
                          onClick={() => removeRow(r)}
                          title="Delete row"
                          disabled={rows <= 1}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    </th>
                    {row.map((cell, c) => (
                      <td key={c}>
                        <input
                          data-cell={`${r}-${c}`}
                          value={cell}
                          style={{
                            textAlign:
                              align[c] === "l"
                                ? "left"
                                : align[c] === "r"
                                  ? "right"
                                  : "center",
                          }}
                          placeholder={headerRow && r === 0 ? `Header ${c + 1}` : ""}
                          onChange={(e) => updateCell(r, c, e.target.value)}
                          onFocus={() => setFocus([r, c])}
                          onBlur={() => setFocus(null)}
                          onKeyDown={(e) => handleKeyDown(e, r, c)}
                          onPaste={(e) => handlePaste(e, r, c)}
                          spellCheck={false}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              className="table-add-col"
              onClick={() => insertCol(cols)}
              disabled={cols >= MAX_COLS}
              title="Add column"
            >
              <Plus size={14} />
            </button>
          </div>
          <button
            className="table-add-row"
            onClick={() => insertRow(rows)}
            disabled={rows >= MAX_ROWS}
            title="Add row"
          >
            <Plus size={14} /> Add row
          </button>
          <p className="table-hint">
            Enter moves down (adds a row at the end) · Tab moves right · Paste cells
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
          {borders === "booktabs" && (
            <div className="table-code-note">
              Requires <code>\usepackage{"{booktabs}"}</code> in your preamble.
            </div>
          )}
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
