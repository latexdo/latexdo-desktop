import { describe, expect, it } from "vitest";
import { generateTableCode, requiredTablePackages } from "../tableGenerator";
import type { TableOptions } from "../tableGenerator";
import {
  deleteColumn,
  deleteRow,
  emptyTable,
  expandToMerges,
  insertColumn,
  insertRow,
  mergeRange,
  rangeFrom,
  rangeToTsv,
  sortBlocker,
  sortByColumn,
  toggleStyle,
  transposeTable,
  unmergeRange,
  type TableState,
} from "../tableModel";

function table(cells: string[][]): TableState {
  const base = emptyTable(cells.length, cells[0]!.length);
  return { ...base, cells: cells.map((row) => [...row]) };
}

function code(state: TableState, extra: Partial<TableOptions> = {}) {
  return generateTableCode({
    cells: state.cells,
    align: state.align,
    merges: state.merges,
    styles: state.styles,
    borders: "grid",
    headerRow: false,
    escape: true,
    float: false,
    caption: "",
    label: "",
    ...extra,
  });
}

describe("merging cells", () => {
  it("merges across columns into \\multicolumn, keeping the grid rules", () => {
    const merged = mergeRange(
      table([
        ["Results", "", ""],
        ["a", "b", "c"],
      ]),
      rangeFrom([0, 0], [0, 2]),
    );
    expect(merged.merges).toEqual([{ r: 0, c: 0, rows: 1, cols: 3 }]);
    expect(code(merged)).toContain("  \\multicolumn{3}{|c|}{Results} \\\\");
    expect(code(merged)).toContain("  a & b & c \\\\");
  });

  it("merges down rows into \\multirow, with \\cline under the open rows", () => {
    const merged = mergeRange(
      table([
        ["Model", "x"],
        ["", "y"],
        ["z", "w"],
      ]),
      rangeFrom([0, 0], [1, 0]),
    );
    const latex = code(merged);
    expect(latex).toContain("  \\multirow{2}{*}{Model} & x \\\\");
    expect(latex).toContain("  \\cline{2-2}");
    expect(latex).toContain("   & y \\\\");
    expect(requiredTablePackages({ ...baseOptions, merges: merged.merges })).toEqual([
      "\\usepackage{multirow}",
    ]);
  });

  it("merges a block in both directions and keeps every text", () => {
    const merged = mergeRange(
      table([
        ["a", "b", "x"],
        ["c", "", "y"],
      ]),
      rangeFrom([0, 0], [1, 1]),
    );
    expect(merged.cells[0]![0]).toBe("a b c");
    const latex = code(merged);
    expect(latex).toContain("\\multicolumn{2}{|c|}{\\multirow{2}{*}{a b c}} & x \\\\");
    expect(latex).toContain("\\multicolumn{2}{|c|}{} & y \\\\");
  });

  it("uses \\cmidrule with booktabs and grows selections to whole merges", () => {
    const merged = mergeRange(
      table([
        ["H", "I"],
        ["", "J"],
      ]),
      rangeFrom([0, 0], [1, 0]),
    );
    expect(code(merged, { borders: "booktabs", headerRow: true })).toContain(
      "\\cmidrule{2-2}",
    );
    expect(expandToMerges(merged.merges, rangeFrom([1, 0], [1, 1]))).toEqual(
      rangeFrom([0, 0], [1, 1]),
    );
    expect(unmergeRange(merged, rangeFrom([1, 0])).merges).toEqual([]);
  });

  it("moves and resizes merges when rows and columns change", () => {
    const merged = mergeRange(
      table([
        ["a", "b"],
        ["c", "d"],
        ["e", "f"],
      ]),
      rangeFrom([0, 0], [1, 0]),
    );
    expect(insertRow(merged, 1).merges).toEqual([{ r: 0, c: 0, rows: 3, cols: 1 }]);
    expect(insertRow(merged, 0).merges).toEqual([{ r: 1, c: 0, rows: 2, cols: 1 }]);
    expect(insertColumn(merged, 0).merges).toEqual([{ r: 0, c: 1, rows: 2, cols: 1 }]);
    // Removing the top row keeps the text and drops a merge of one cell.
    const shrunk = deleteRow(merged, 0);
    expect(shrunk.merges).toEqual([]);
    expect(shrunk.cells[0]![0]).toBe("a c");
    expect(deleteColumn(merged, 0).merges).toEqual([]);
  });
});

describe("formatting and tools", () => {
  it("toggles bold and italic like a word processor", () => {
    const start = table([["a", "b"]]);
    const bold = toggleStyle(start, rangeFrom([0, 0], [0, 1]), "bold");
    expect(code(toggleStyle(bold, rangeFrom([0, 1]), "italic"))).toContain(
      "\\textbf{a} & \\textbf{\\textit{b}}",
    );
    expect(toggleStyle(bold, rangeFrom([0, 0], [0, 1]), "bold").styles).toEqual([
      [undefined, undefined],
    ]);
  });

  it("sorts rows under the header, numbers as numbers and blanks last", () => {
    const start = table([
      ["Name", "N"],
      ["b", "10"],
      ["", "1"],
      ["a", "9"],
    ]);
    expect(sortByColumn(start, 1, "asc", true).cells.map((row) => row[1])).toEqual([
      "N",
      "1",
      "9",
      "10",
    ]);
    expect(sortByColumn(start, 0, "desc", true).cells.map((row) => row[0])).toEqual([
      "Name",
      "b",
      "a",
      "",
    ]);
    const merged = mergeRange(start, rangeFrom([1, 0], [2, 0]));
    expect(sortBlocker(merged, true)).toMatch(/Unmerge/);
  });

  it("transposes cells and merges, and copies a range for spreadsheets", () => {
    const merged = mergeRange(
      table([
        ["a", ""],
        ["b", "c"],
      ]),
      rangeFrom([0, 0], [0, 1]),
    );
    const flipped = transposeTable(merged);
    expect(flipped.cells).toEqual([
      ["a", "b"],
      ["", "c"],
    ]);
    expect(flipped.merges).toEqual([{ r: 0, c: 0, rows: 2, cols: 1 }]);
    expect(rangeToTsv(flipped, rangeFrom([0, 0], [1, 1]))).toBe("a\tb\n\tc");
  });

  it("adds striped rows and fits the table to the text width", () => {
    const latex = code(table([["a"]]), {
      striped: true,
      fitWidth: true,
      headerRow: true,
    });
    expect(latex.split("\n")).toEqual([
      "\\rowcolors{2}{gray!12}{white}",
      "\\resizebox{\\linewidth}{!}{%",
      "\\begin{tabular}{|c|}",
      "  \\hline",
      "  \\textbf{a} \\\\",
      "  \\hline",
      "\\end{tabular}%",
      "}",
    ]);
  });
});

const baseOptions: TableOptions = {
  cells: [],
  align: [],
  borders: "grid",
  headerRow: false,
  escape: true,
  float: false,
  caption: "",
  label: "",
};
