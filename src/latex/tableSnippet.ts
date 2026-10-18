// The LaTeX for a new table picked from the toolbar's size grid.

export interface LatexTableSnippet {
  text: string;
  /** Where the first header cell starts and ends, to select it after insert. */
  selectStart: number;
  selectEnd: number;
}

/**
 * A floating table of `rows` rows (the first one a header) and `columns`
 * left-aligned columns, with a caption and a label ready to fill in.
 */
export function latexTableSnippet(rows: number, columns: number): LatexTableSnippet {
  const rowCount = Math.max(1, Math.floor(rows));
  const columnCount = Math.max(1, Math.floor(columns));
  const header = Array.from(
    { length: columnCount },
    (_, index) => `Column ${index + 1}`,
  );
  // Blank cells padded to their header's width, so the `&`s line up.
  const empty = header.map((cell) => " ".repeat(cell.length));
  const row = (cells: string[]) => `    ${cells.join(" & ")} \\\\`;
  const before = [
    "\\begin{table}[htbp]",
    "  \\centering",
    `  \\begin{tabular}{${"l".repeat(columnCount)}}`,
    "    \\hline",
    "    ",
  ].join("\n");
  const lines = [
    `${before}${row(header).trimStart()}`,
    "    \\hline",
    ...Array.from({ length: rowCount - 1 }, () => row(empty)),
    ...(rowCount > 1 ? ["    \\hline"] : []),
    "  \\end{tabular}",
    "  \\caption{Caption}",
    "  \\label{tab:label}",
    "\\end{table}",
    "",
  ];
  return {
    text: lines.join("\n"),
    selectStart: before.length,
    selectEnd: before.length + header[0].length,
  };
}
