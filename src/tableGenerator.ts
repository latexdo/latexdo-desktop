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

export interface TableOptions {
  cells: string[][];
  align: ColumnAlign[];
  borders: TableBorderStyle;
  headerRow: boolean;
  escape: boolean;
  float: boolean;
  caption: string;
  label: string;
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

export function generateTableCode(options: TableOptions): string {
  const { cells, align, borders, headerRow, escape, float } = options;
  const cols = align.length;
  const spec = borders === "grid" ? `|${align.join("|")}|` : align.join("");
  const [top, mid, bottom] =
    borders === "booktabs"
      ? ["\\toprule", "\\midrule", "\\bottomrule"]
      : borders === "none"
        ? ["", "", ""]
        : ["\\hline", "\\hline", "\\hline"];

  const formatCell = (cell: string, isHeader: boolean) => {
    const text = escape ? escapeLatex(cell.trim()) : cell.trim();
    return isHeader && text ? `\\textbf{${text}}` : text;
  };

  const indent = float ? "    " : "  ";
  const lines: string[] = [];
  if (top) lines.push(indent + top);
  cells.forEach((row, r) => {
    const isHeader = headerRow && r === 0;
    const values = Array.from({ length: cols }, (_, c) =>
      formatCell(row[c] ?? "", isHeader),
    );
    lines.push(`${indent}${values.join(" & ")} \\\\`);
    const last = r === cells.length - 1;
    if (last) {
      if (bottom) lines.push(indent + bottom);
    } else if (borders === "grid" || (isHeader && mid)) {
      lines.push(indent + mid);
    }
  });

  const outer = float ? "  " : "";
  const tabular = [
    `${outer}\\begin{tabular}{${spec}}`,
    ...lines,
    `${outer}\\end{tabular}`,
  ];
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
