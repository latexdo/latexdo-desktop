import React from "react";
import { createPortal } from "react-dom";
import { Table2 } from "lucide-react";

/*
 * The toolbar's table button: a small grid to hover over and pick a size, as
 * in word processors. Arrow keys move the selection and Enter inserts.
 */

const maxRows = 8;
const maxColumns = 8;
// The grid (8 × 16px cells, 3px gaps) plus the popover's padding and border.
const popoverWidth = 172;

interface TableSizePickerProps {
  onInsert: (rows: number, columns: number) => void;
  onAlignColumns: () => void;
}

export const TableSizePicker: React.FC<TableSizePickerProps> = ({
  onInsert,
  onAlignColumns,
}) => {
  const [open, setOpen] = React.useState(false);
  const [size, setSize] = React.useState({ rows: 3, columns: 3 });
  const [position, setPosition] = React.useState({ top: 0, left: 0 });
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);
  const gridRef = React.useRef<HTMLDivElement>(null);

  const close = React.useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  React.useEffect(() => {
    if (!open) return;
    gridRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !popoverRef.current?.contains(target) &&
        !buttonRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const toggle = () => {
    // Fixed and portaled to the body: the toolbar's `contain: paint` would
    // otherwise both clip it and become its containing block, shifting it.
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      // Stay inside the window when the button sits near its right edge.
      const left = Math.max(
        8,
        Math.min(rect.left, window.innerWidth - popoverWidth - 8),
      );
      setPosition({ top: rect.bottom + 6, left });
    }
    setSize({ rows: 3, columns: 3 });
    setOpen((value) => !value);
  };

  const insert = (rows: number, columns: number) => {
    setOpen(false);
    onInsert(rows, columns);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setSize((current) => ({
        rows: Math.min(maxRows, Math.max(1, current.rows + move[0])),
        columns: Math.min(maxColumns, Math.max(1, current.columns + move[1])),
      }));
    } else if (event.key === "Enter") {
      event.preventDefault();
      insert(size.rows, size.columns);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`tex-format-button icon-only ${open ? "active" : ""}`}
        onClick={toggle}
        title="Insert table"
        aria-label="Insert table"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tour-id="formatting"
      >
        <Table2 size={14} />
      </button>
      {open
        ? createPortal(
            <div
              ref={popoverRef}
              className="table-size-picker"
              role="dialog"
              aria-label="Insert table"
              style={{ top: position.top, left: position.left }}
            >
              <div
                ref={gridRef}
                className="table-size-grid"
                role="grid"
                aria-label={`${size.rows} by ${size.columns} table`}
                tabIndex={0}
                onKeyDown={onKeyDown}
              >
                {Array.from({ length: maxRows }, (_, row) => (
                  <div key={row} role="row" className="table-size-row">
                    {Array.from({ length: maxColumns }, (_, column) => (
                      <button
                        key={column}
                        type="button"
                        role="gridcell"
                        tabIndex={-1}
                        aria-label={`${row + 1} by ${column + 1} table`}
                        className={
                          row < size.rows && column < size.columns ? "on" : undefined
                        }
                        onPointerEnter={() =>
                          setSize({ rows: row + 1, columns: column + 1 })
                        }
                        onClick={() => insert(row + 1, column + 1)}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div className="table-size-label">
                {size.rows} × {size.columns} table
              </div>
              <button
                type="button"
                className="table-size-action"
                onClick={() => {
                  setOpen(false);
                  onAlignColumns();
                }}
              >
                Align columns of the table at cursor
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
};
