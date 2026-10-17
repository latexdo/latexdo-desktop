export interface TableData {
  rows: number;
  cols: number;
  cells: string[][];
  alignment: string;
}

export function generateTabularCode(data: TableData): string {
  const align = data.alignment || Array(data.cols).fill("c").join("|");

  let code = `\\begin{tabular}{|${align}|}\n`;
  code += `  \\hline\n`;

  for (let r = 0; r < data.rows; r++) {
    const row = data.cells[r] || Array(data.cols).fill("");
    code += `  ${row.map((cell) => cell || " ").join(" & ")} \\\\\n`;
    code += `  \\hline\n`;
  }

  code += `\\end{tabular}`;
  return code;
}

export type ColumnAlign = "l" | "c" | "r";
export type TableBorderStyle = "grid" | "booktabs" | "header" | "none";

/** A block of merged cells, anchored at its top-left cell. */
export interface CellMerge {
  r: number;
  c: number;
  rows: number;
  cols: number;
}

export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
}

export interface TableOptions {
  cells: string[][];
  align: ColumnAlign[];
  borders: TableBorderStyle;
  headerRow: boolean;
  escape: boolean;
  float: boolean;
  caption: string;
  label: string;
  /** Merged blocks: \multicolumn across columns, \multirow down rows. */
  merges?: CellMerge[];
  /** Per-cell formatting, by row then column. */
  styles?: (CellStyle | undefined)[][];
  /** Alternate row shading (xcolor's \rowcolors). */
  striped?: boolean;
  /** Scale the table to the text width (graphicx's \resizebox). */
  fitWidth?: boolean;
}

const LATEX_ESCAPES: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};

export function escapeLatex(text: string): string {
  return text.replace(/[\\&%$#_{}~^]/g, (ch) => LATEX_ESCAPES[ch]);
}

/** The merge covering a cell, if any. */
export function mergeAt(
  merges: readonly CellMerge[],
  r: number,
  c: number,
): CellMerge | undefined {
  return merges.find(
    (m) => r >= m.r && r < m.r + m.rows && c >= m.c && c < m.c + m.cols,
  );
}

/** The \usepackage lines a generated table needs, in preamble order. */
export function requiredTablePackages(options: TableOptions): string[] {
  const packages: string[] = [];
  if (options.borders === "booktabs") packages.push("\\usepackage{booktabs}");
  if (options.merges?.some((m) => m.rows > 1)) packages.push("\\usepackage{multirow}");
  if (options.striped) packages.push("\\usepackage[table]{xcolor}");
  if (options.fitWidth) packages.push("\\usepackage{graphicx}");
  return packages;
}

export function generateTableCode(options: TableOptions): string {
  const { cells, align, borders, headerRow, escape, float } = options;
  const merges = options.merges ?? [];
  const cols = align.length;
  const spec = borders === "grid" ? `|${align.join("|")}|` : align.join("");
  const [top, mid, bottom] =
    borders === "booktabs"
      ? ["\\toprule", "\\midrule", "\\bottomrule"]
      : borders === "none"
        ? ["", "", ""]
        : ["\\hline", "\\hline", "\\hline"];

  const formatCell = (r: number, c: number, isHeader: boolean) => {
    const raw = (cells[r]?.[c] ?? "").trim();
    let text = escape ? escapeLatex(raw) : raw;
    if (!text) return text;
    const style = options.styles?.[r]?.[c];
    if (style?.italic) text = `\\textit{${text}}`;
    if (style?.bold || isHeader) text = `\\textbf{${text}}`;
    return text;
  };

  // Column spec for a \multicolumn starting at column c: keeps the grid's
  // vertical rules, which a \multicolumn otherwise drops.
  const multicolumnSpec = (c: number) =>
    borders === "grid" ? `${c === 0 ? "|" : ""}${align[c]}|` : align[c];

  // A rule under row r. Where a \multirow continues into the next row the
  // rule is drawn only across the other columns (\cline / \cmidrule).
  const ruleAfter = (r: number, rule: string) => {
    if (!rule) return "";
    const spanning = merges.filter(
      (m) => m.rows > 1 && r >= m.r && r < m.r + m.rows - 1,
    );
    if (!spanning.length) return rule;
    const open: [number, number][] = [];
    for (let c = 0; c < cols; c++) {
      if (spanning.some((m) => c >= m.c && c < m.c + m.cols)) continue;
      const last = open[open.length - 1];
      if (last && last[1] === c - 1) last[1] = c;
      else open.push([c, c]);
    }
    const partial = borders === "booktabs" ? "\\cmidrule" : "\\cline";
    return open.map(([a, b]) => `${partial}{${a + 1}-${b + 1}}`).join(" ");
  };

  const indent = float ? "    " : "  ";
  const lines: string[] = [];
  if (top) lines.push(indent + top);
  cells.forEach((_, r) => {
    const isHeader = headerRow && r === 0;
    const values: string[] = [];
    for (let c = 0; c < cols; c++) {
      const merge = mergeAt(merges, r, c);
      if (!merge) {
        values.push(formatCell(r, c, isHeader));
        continue;
      }
      if (merge.c !== c) continue; // inside a \multicolumn already written
      if (merge.r === r) {
        let text = formatCell(r, c, isHeader);
        if (merge.rows > 1) text = `\\multirow{${merge.rows}}{*}{${text}}`;
        if (merge.cols > 1) {
          text = `\\multicolumn{${merge.cols}}{${multicolumnSpec(c)}}{${text}}`;
        }
        values.push(text);
      } else {
        // Below the top of a \multirow: an empty cell of the same width.
        values.push(
          merge.cols > 1 ? `\\multicolumn{${merge.cols}}{${multicolumnSpec(c)}}{}` : "",
        );
      }
      c += merge.cols - 1;
    }
    lines.push(`${indent}${values.join(" & ")} \\\\`);
    const last = r === cells.length - 1;
    if (last) {
      if (bottom) lines.push(indent + bottom);
    } else if (borders === "grid" || (isHeader && mid)) {
      lines.push(indent + ruleAfter(r, mid));
    }
  });

  const outer = float ? "  " : "";
  const begin = `\\begin{tabular}{${spec}}`;
  const end = "\\end{tabular}";
  const stripes = options.striped
    ? [`${outer}\\rowcolors{${headerRow ? 2 : 1}}{gray!12}{white}`]
    : [];
  const tabular = options.fitWidth
    ? [
        ...stripes,
        `${outer}\\resizebox{\\linewidth}{!}{%`,
        `${outer}${begin}`,
        ...lines,
        `${outer}${end}%`,
        `${outer}}`,
      ]
    : [...stripes, `${outer}${begin}`, ...lines, `${outer}${end}`];
  if (!float) return tabular.join("\n");

  const caption = options.caption.trim();
  const label = options.label.trim();
  return [
    "\\begin{table}[htbp]",
    "  \\centering",
    ...(caption ? [`  \\caption{${escape ? escapeLatex(caption) : caption}}`] : []),
    ...(label ? [`  \\label{${label}}`] : []),
    ...tabular,
    "\\end{table}",
  ].join("\n");
}
