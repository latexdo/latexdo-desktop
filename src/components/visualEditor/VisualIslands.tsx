import {
  ArrowDownToLine,
  ArrowRightToLine,
  BookMarked,
  Code2,
  FileInput,
  ImageOff,
  ListOrdered,
  Minus,
  Pencil,
  Replace,
  Trash2,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  figureWidth,
  mathPreviewTex,
  mathSource,
  parseFigure,
  parseTable,
  readTitleParts,
  setFigureCaption,
  setFigureImage,
  setFigureWidth,
  setTableCaption,
  setTableRows,
  setTitlePart,
  splitMath,
  type TableRow,
} from "../../features/visualEditor/documentModel";
import {
  latexInlineToHtml,
  serializeInlineChildren,
  type InlineRenderOptions,
} from "../../features/visualEditor/inlineLatex";
import { TikzRenderedPreview } from "../TikzRenderedPreview";

export type LoadedImage =
  | { kind: "image"; url: string }
  | { kind: "pdf"; data: Uint8Array };

export interface IslandContext {
  readOnly: boolean;
  renderOptions: InlineRenderOptions;
  renderMath: (tex: string, display: boolean) => string | null;
  loadImage?: (path: string) => Promise<LoadedImage | null>;
  /** Copies image files into the project and returns their project paths. */
  importImages?: (files: File[]) => Promise<string[]>;
  head: string;
  setHead: (head: string) => void;
}

export interface IslandProps {
  element: HTMLElement;
  source: string;
  context: IslandContext;
  update: (source: string) => void;
  remove: () => void;
  /** Opens the editor at once (a block the writer just inserted). */
  startEditing?: boolean;
}

// ---------- shared pieces ----------

/** A one-line rich text field holding inline LaTeX (captions, cells, titles). */
export function InlineField({
  value,
  onChange,
  readOnly,
  options,
  className,
  label,
  placeholder,
  onFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  options: InlineRenderOptions;
  className?: string;
  label: string;
  placeholder?: string;
  onFocus?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || element.dataset.value === value) return;
    element.innerHTML = latexInlineToHtml(value, options);
    element.dataset.value = value;
  }, [options, value]);
  return (
    <div
      ref={ref}
      className={["vl-inline-field", className].filter(Boolean).join(" ")}
      role="textbox"
      aria-label={label}
      data-placeholder={placeholder}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      spellCheck
      onFocus={onFocus}
      onKeyDown={(event) => {
        // One line: Enter leaves the field instead of breaking the LaTeX.
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      onPaste={(event) => {
        event.preventDefault();
        const text = event.clipboardData.getData("text/plain").replace(/\s+/g, " ");
        document.execCommand("insertText", false, text);
      }}
      onInput={(event) => {
        const next = serializeInlineChildren(event.currentTarget).replace(/\n/g, " ");
        event.currentTarget.dataset.value = next;
        onChange(next);
      }}
    />
  );
}

function IslandTools({
  children,
  onRemove,
  readOnly,
  label,
}: {
  children?: React.ReactNode;
  onRemove: () => void;
  readOnly: boolean;
  label: string;
}) {
  if (readOnly) return null;
  return (
    <div className="vl-island-tools" role="toolbar" aria-label={`${label} tools`}>
      {children}
      <button
        type="button"
        onClick={onRemove}
        title={`Delete ${label.toLowerCase()}`}
        aria-label={`Delete ${label.toLowerCase()}`}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function CodeArea({
  value,
  onChange,
  readOnly,
  label,
  autoFocus,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  label: string;
  autoFocus?: boolean;
  onBlur?: () => void;
}) {
  return (
    <textarea
      className="vl-code-area"
      aria-label={label}
      value={value}
      readOnly={readOnly}
      autoFocus={autoFocus}
      spellCheck={false}
      rows={Math.max(1, value.split("\n").length)}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
    />
  );
}

// ---------- figure ----------

const widthChoices = [0.25, 0.33, 0.5, 0.66, 0.8, 1];

export function FigureIsland(props: IslandProps) {
  const { source, context, update, remove } = props;
  const parts = useMemo(() => parseFigure(source), [source]);
  const [image, setImage] = useState<LoadedImage | null | "loading">("loading");
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const imagePath = parts?.imagePath ?? "";
  const { loadImage } = context;

  useEffect(() => {
    let cancelled = false;
    setImage("loading");
    if (!loadImage || !imagePath) {
      setImage(null);
      return;
    }
    loadImage(imagePath)
      .then((loaded) => {
        if (!cancelled) setImage(loaded);
      })
      .catch(() => {
        if (!cancelled) setImage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [imagePath, loadImage]);

  if (!parts) return <CodeIsland {...props} />;
  const width = figureWidth(parts.options);
  const replaceWith = async (files: File[]) => {
    const [path] = (await context.importImages?.(files)) ?? [];
    if (path) update(setFigureImage(source, path));
  };

  return (
    <figure
      className={`vl-figure ${dropping ? "is-dropping" : ""}`}
      onDragOver={(event) => {
        if (context.readOnly || !Array.from(event.dataTransfer.types).includes("Files"))
          return;
        event.preventDefault();
        event.stopPropagation();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => {
        if (context.readOnly || !event.dataTransfer.files.length) return;
        event.preventDefault();
        event.stopPropagation();
        setDropping(false);
        void replaceWith(Array.from(event.dataTransfer.files));
      }}
    >
      <IslandTools onRemove={remove} readOnly={context.readOnly} label="Figure">
        <label className="vl-tool-select" title="Width">
          <span>Width</span>
          <select
            aria-label="Figure width"
            value={
              width === null
                ? ""
                : String(
                    widthChoices.reduce((best, choice) =>
                      Math.abs(choice - width) < Math.abs(best - width) ? choice : best,
                    ),
                  )
            }
            onChange={(event) =>
              update(setFigureWidth(source, Number(event.target.value)))
            }
          >
            {width === null ? <option value="">As set in LaTeX</option> : null}
            {widthChoices.map((choice) => (
              <option key={choice} value={choice}>
                {Math.round(choice * 100)}%
              </option>
            ))}
          </select>
        </label>
        {context.importImages ? (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            title="Replace image"
            aria-label="Replace image"
          >
            <Replace size={13} />
          </button>
        ) : null}
        <input
          ref={fileInput}
          type="file"
          accept="image/*,application/pdf"
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length) void replaceWith(files);
          }}
        />
      </IslandTools>
      <div
        className="vl-figure-frame"
        style={{ width: `${Math.round((width ?? 0.8) * 100)}%` }}
      >
        {image === "loading" ? (
          <div className="vl-figure-missing" role="status">
            Loading image…
          </div>
        ) : image?.kind === "image" ? (
          <img src={image.url} alt={parts.caption ?? imagePath} draggable={false} />
        ) : image?.kind === "pdf" ? (
          <TikzRenderedPreview data={image.data} />
        ) : (
          <div className="vl-figure-missing" role="status">
            <ImageOff size={18} aria-hidden="true" />
            <span>Image not found: {imagePath}</span>
          </div>
        )}
      </div>
      <figcaption>
        <span className="vl-caption-prefix">Figure:</span>
        <InlineField
          value={parts.caption ?? ""}
          onChange={(caption) => update(setFigureCaption(source, caption))}
          readOnly={context.readOnly}
          options={context.renderOptions}
          label="Figure caption"
          placeholder="Add a caption"
        />
        {parts.label ? <span className="vl-chip">{parts.label}</span> : null}
      </figcaption>
    </figure>
  );
}

// ---------- table ----------

export function TableIsland(props: IslandProps) {
  const { source, context, update, remove } = props;
  const parts = useMemo(() => parseTable(source), [source]);
  const [focus, setFocus] = useState<{ row: number; column: number }>({
    row: 0,
    column: 0,
  });
  if (!parts) return <CodeIsland {...props} />;
  const { rows, columns, trailingRules } = parts;
  const write = (nextRows: TableRow[], nextColumns = columns, rules = trailingRules) =>
    update(setTableRows(source, nextRows, rules, nextColumns));
  const setCell = (row: number, column: number, value: string) =>
    write(
      rows.map((entry, index) =>
        index === row
          ? {
              ...entry,
              cells: entry.cells.map((cell, cellIndex) =>
                cellIndex === column ? value : cell,
              ),
            }
          : entry,
      ),
    );
  const blankRow = (): TableRow => ({
    cells: Array.from({ length: columns }, () => ""),
    rulesBefore: [],
  });
  const row = Math.min(focus.row, rows.length - 1);
  const column = Math.min(focus.column, columns - 1);
  const floating = /\\begin\{table\*?\}/.test(source);

  return (
    <div className="vl-table">
      <IslandTools onRemove={remove} readOnly={context.readOnly} label="Table">
        <button
          type="button"
          title="Insert row below"
          aria-label="Insert row below"
          onClick={() =>
            write([...rows.slice(0, row + 1), blankRow(), ...rows.slice(row + 1)])
          }
        >
          <ArrowDownToLine size={13} />
        </button>
        <button
          type="button"
          title="Delete row"
          aria-label="Delete row"
          disabled={rows.length <= 1}
          onClick={() => write(rows.filter((_, index) => index !== row))}
        >
          <Minus size={13} />
          <span>Row</span>
        </button>
        {parts.simpleSpec ? (
          <>
            <button
              type="button"
              title="Insert column right"
              aria-label="Insert column right"
              onClick={() =>
                write(
                  rows.map((entry) => ({
                    ...entry,
                    cells: [
                      ...entry.cells.slice(0, column + 1),
                      "",
                      ...entry.cells.slice(column + 1),
                    ],
                  })),
                  columns + 1,
                )
              }
            >
              <ArrowRightToLine size={13} />
            </button>
            <button
              type="button"
              title="Delete column"
              aria-label="Delete column"
              disabled={columns <= 1}
              onClick={() =>
                write(
                  rows.map((entry) => ({
                    ...entry,
                    cells: entry.cells.filter((_, index) => index !== column),
                  })),
                  columns - 1,
                )
              }
            >
              <Minus size={13} />
              <span>Column</span>
            </button>
          </>
        ) : null}
      </IslandTools>
      <table>
        <tbody>
          {rows.map((entry, rowIndex) => (
            <tr
              key={rowIndex}
              className={entry.rulesBefore.length ? "has-rule" : undefined}
            >
              {entry.cells.map((cell, columnIndex) => (
                <td key={columnIndex}>
                  <InlineField
                    value={cell}
                    onChange={(value) => setCell(rowIndex, columnIndex, value)}
                    onFocus={() => setFocus({ row: rowIndex, column: columnIndex })}
                    readOnly={context.readOnly}
                    options={context.renderOptions}
                    label={`Row ${rowIndex + 1}, column ${columnIndex + 1}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {floating ? (
        <div className="vl-table-caption">
          <span className="vl-caption-prefix">Table:</span>
          <InlineField
            value={parts.caption ?? ""}
            onChange={(caption) => update(setTableCaption(source, caption))}
            readOnly={context.readOnly}
            options={context.renderOptions}
            label="Table caption"
            placeholder="Add a caption"
          />
        </div>
      ) : null}
    </div>
  );
}

// ---------- display math ----------

export function MathIsland(props: IslandProps) {
  const { source, context, update, remove, startEditing } = props;
  const parts = useMemo(() => splitMath(source), [source]);
  const [editing, setEditing] = useState(Boolean(startEditing));
  if (!parts) return <CodeIsland {...props} />;
  const image = parts.body.trim()
    ? context.renderMath(mathPreviewTex(parts), true)
    : null;
  const numbered = !parts.environment.endsWith("*") && parts.environment !== "display";
  return (
    <div className="vl-math">
      <IslandTools onRemove={remove} readOnly={context.readOnly} label="Equation">
        <button
          type="button"
          onClick={() => setEditing((value) => !value)}
          title="Edit equation"
          aria-label="Edit equation"
          aria-pressed={editing}
        >
          <Pencil size={13} />
        </button>
      </IslandTools>
      <button
        type="button"
        className="vl-math-view"
        onClick={() => !context.readOnly && setEditing(true)}
        aria-label="Equation"
        title={context.readOnly ? parts.body : "Click to edit the equation"}
      >
        {image ? (
          <img src={image} alt={parts.body} draggable={false} />
        ) : (
          <span className="vl-math-fallback">
            {parts.body.trim() || "Empty equation: click to write it"}
          </span>
        )}
        {numbered ? <span className="vl-math-number">(#)</span> : null}
      </button>
      {editing && !context.readOnly ? (
        <div className="vl-math-editor">
          <span className="vl-chip">
            {parts.environment === "display" ? "\\[ … \\]" : parts.environment}
          </span>
          <CodeArea
            value={parts.body}
            onChange={(body) => update(mathSource(parts, body))}
            readOnly={false}
            label="Equation source"
            autoFocus
            onBlur={() => setEditing(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

// ---------- LaTeX the editor shows as code ----------

export function CodeIsland({ source, context, update, remove }: IslandProps) {
  return (
    <div className="vl-code" aria-label="LaTeX code block">
      <div className="vl-code-header">
        <Code2 size={12} aria-hidden="true" />
        <span>LaTeX</span>
        <IslandTools onRemove={remove} readOnly={context.readOnly} label="Code block" />
      </div>
      <CodeArea
        value={source}
        onChange={update}
        readOnly={context.readOnly}
        label="LaTeX code"
      />
    </div>
  );
}

export function CommentIsland({ source, context, update }: IslandProps) {
  return (
    <div className="vl-comment" title="A comment: it does not appear in the PDF">
      <CodeArea
        value={source}
        onChange={update}
        readOnly={context.readOnly}
        label="Comment"
      />
    </div>
  );
}

const commandLabels: Record<string, { label: string; icon: React.ReactNode }> = {
  pagebreak: { label: "Page break", icon: null },
  toc: { label: "Table of contents", icon: <ListOrdered size={14} /> },
  lof: { label: "List of figures", icon: <ListOrdered size={14} /> },
  lot: { label: "List of tables", icon: <ListOrdered size={14} /> },
  bibliography: { label: "References", icon: <BookMarked size={14} /> },
  bibliographystyle: { label: "Reference style", icon: <BookMarked size={14} /> },
  appendix: { label: "Appendix", icon: null },
  include: { label: "Included file", icon: <FileInput size={14} /> },
};

export function CommandIsland({ source, context, remove, element }: IslandProps) {
  const command = element.dataset.command ?? "";
  const info = commandLabels[command] ?? { label: "LaTeX command", icon: null };
  const argument = /\{([^}]*)\}/.exec(source)?.[1];
  return (
    <div className={`vl-command vl-command-${command}`} title={source}>
      {info.icon}
      <span>{info.label}</span>
      {argument ? <span className="vl-chip">{argument}</span> : null}
      <IslandTools onRemove={remove} readOnly={context.readOnly} label={info.label} />
    </div>
  );
}

export function TitleIsland({ context }: IslandProps) {
  const parts = readTitleParts(context.head);
  const field = (
    name: "title" | "author" | "date",
    label: string,
    className: string,
  ) => (
    <InlineField
      value={parts[name] ?? ""}
      onChange={(value) => context.setHead(setTitlePart(context.head, name, value))}
      readOnly={context.readOnly}
      options={context.renderOptions}
      className={className}
      label={label}
      placeholder={label}
    />
  );
  return (
    <header className="vl-title">
      {field("title", "Title", "vl-title-main")}
      {field("author", "Author", "vl-title-author")}
      {parts.date !== null ? field("date", "Date", "vl-title-date") : null}
    </header>
  );
}

export const islandComponents: Record<
  string,
  (props: IslandProps) => React.ReactElement | null
> = {
  figure: FigureIsland,
  table: TableIsland,
  math: MathIsland,
  code: CodeIsland,
  comment: CommentIsland,
  command: CommandIsland,
  title: TitleIsland,
};
