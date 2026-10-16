import { describe, it, expect } from "vitest";
import { escapeLatex, generateTableCode } from "../tableGenerator";
import type { TableOptions } from "../tableGenerator";

const base: TableOptions = {
  cells: [
    ["Name", "Score"],
    ["A & B", "50%"],
  ],
  align: ["l", "r"],
  borders: "grid",
  headerRow: true,
  escape: true,
  float: false,
  caption: "",
  label: "",
};

describe("generateTableCode", () => {
  it("builds a fully ruled grid with a bold header", () => {
    expect(generateTableCode(base)).toBe(
      [
        "\\begin{tabular}{|l|r|}",
        "  \\hline",
        "  \\textbf{Name} & \\textbf{Score} \\\\",
        "  \\hline",
        "  A \\& B & 50\\% \\\\",
        "  \\hline",
        "\\end{tabular}",
      ].join("\n"),
    );
  });

  it("uses booktabs rules only around the header", () => {
    const code = generateTableCode({
      ...base,
      borders: "booktabs",
      cells: [...base.cells, ["c", "d"]],
    });
    expect(code).toContain("\\begin{tabular}{lr}");
    expect(code.match(/\\midrule/g)).toHaveLength(1);
    expect(code).toContain("\\toprule");
    expect(code).toContain("\\bottomrule");
  });

  it("emits no rules for the none style", () => {
    expect(generateTableCode({ ...base, borders: "none" })).not.toContain("\\hline");
  });

  it("keeps raw LaTeX when escaping is off", () => {
    const code = generateTableCode({ ...base, escape: false, cells: [["$x^2$", "y"]] });
    expect(code).toContain("$x^2$");
  });

  it("wraps in a table float with caption and label", () => {
    const code = generateTableCode({
      ...base,
      float: true,
      caption: "Results",
      label: "tab:res",
    });
    expect(
      code.startsWith(
        "\\begin{table}[htbp]\n  \\centering\n  \\caption{Results}\n  \\label{tab:res}",
      ),
    ).toBe(true);
    expect(code.endsWith("  \\end{tabular}\n\\end{table}")).toBe(true);
  });
});

describe("escapeLatex", () => {
  it("escapes every special character", () => {
    expect(escapeLatex("\\&%$#_{}~^")).toBe(
      "\\textbackslash{}\\&\\%\\$\\#\\_\\{\\}\\textasciitilde{}\\textasciicircum{}",
    );
  });
});
