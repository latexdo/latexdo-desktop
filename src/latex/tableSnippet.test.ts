import { describe, expect, it } from "vitest";
import { latexTableSnippet } from "./tableSnippet";

describe("latexTableSnippet", () => {
  it("builds a table with a header row, rules, a caption and a label", () => {
    const snippet = latexTableSnippet(3, 2);
    expect(snippet.text).toBe(
      [
        "\\begin{table}[htbp]",
        "  \\centering",
        "  \\begin{tabular}{ll}",
        "    \\hline",
        "    Column 1 & Column 2 \\\\",
        "    \\hline",
        "     &  \\\\",
        "     &  \\\\",
        "    \\hline",
        "  \\end{tabular}",
        "  \\caption{Caption}",
        "  \\label{tab:label}",
        "\\end{table}",
        "",
      ].join("\n"),
    );
    expect(snippet.text.slice(snippet.selectStart, snippet.selectEnd)).toBe("Column 1");
  });

  it("keeps a header-only table valid", () => {
    const snippet = latexTableSnippet(1, 1);
    expect(snippet.text).toContain("\\begin{tabular}{l}");
    expect(snippet.text.match(/\\hline/g)).toHaveLength(2);
  });
});
