import { describe, expect, it, vi } from "vitest";
import { executeTool, type AgentContext, type EditProposal } from "./aiTools";

const article =
  "\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\nText.\n\\end{document}";
const figure = [
  "\\begin{figure}[htbp]",
  "  \\centering",
  "  \\begin{tikzpicture}",
  "    \\node[draw] (a) {A};",
  "    \\node[draw, right=of a] (b) {B};",
  "    \\draw[-Stealth] (a) -- (b);",
  "  \\end{tikzpicture}",
  "  \\caption{Flow.}",
  "\\end{figure}",
].join("\n");

function figureContext() {
  const compiled = { ok: true, log: "", diagnostics: [] as string[] };
  return {
    projectName: () => "Paper",
    activeFilePath: () => "main.tex",
    listFiles: async () => ["main.tex"],
    readFile: vi.fn(async () => article),
    writeFile: vi.fn(async (_path: string, _content: string) => {}),
    documentText: () => article,
    selection: vi.fn(() => ({ text: "", hasSelection: false })),
    applyEdit: vi.fn(async () => {}),
    compile: vi.fn(async () => compiled),
    showFigure: vi.fn(async () => compiled),
    runChecks: async () => "",
    insertCitation: async () => "",
    recommendCitations: async () => "",
    requestApproval: vi.fn(async (_proposal: EditProposal) => true),
  } satisfies AgentContext;
}

describe("agent figures", () => {
  it("lists the preamble lines a figure adds, then compiles and previews it", async () => {
    const ctx = figureContext();
    const result = await executeTool("insert_at_cursor", { text: figure }, ctx, {
      autoApprove: false,
    });
    expect(ctx.requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "insert-at-cursor",
        newText: figure,
        preambleLines: [
          "\\usepackage{tikz}",
          "\\usetikzlibrary{arrows.meta,positioning}",
        ],
      }),
    );
    expect(ctx.applyEdit).toHaveBeenCalled();
    expect(ctx.showFigure).toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      content: expect.stringContaining("PDF preview now shows it"),
    });
  });

  it("strips a standalone wrapper the model sent", async () => {
    const ctx = figureContext();
    await executeTool(
      "insert_at_cursor",
      {
        text: `\\documentclass{standalone}\n\\usepackage{tikz}\n\\begin{document}\n${figure}\n\\end{document}`,
      },
      ctx,
      { autoApprove: false },
    );
    const proposal = ctx.requestApproval.mock.calls[0][0] as unknown as {
      newText: string;
    };
    expect(proposal.newText).not.toContain("documentclass");
    expect(proposal.newText).not.toContain("begin{document}");
    expect(proposal.newText).toContain("\\begin{tikzpicture}");
  });

  it("reports compile errors and points the model to update_figure", async () => {
    const ctx = figureContext();
    ctx.showFigure.mockResolvedValue({
      ok: false,
      log: "! Undefined control sequence.",
      diagnostics: ["error main.tex:9 — Undefined control sequence"],
    });
    const result = await executeTool("insert_at_cursor", { text: figure }, ctx, {
      autoApprove: false,
    });
    expect(result.content).toContain("does not compile");
    expect(result.content).toContain("Undefined control sequence");
    expect(result.content).toContain("update_figure");
  });

  it("replaces only a selected figure with update_figure", async () => {
    const ctx = figureContext();
    expect(
      (
        await executeTool("update_figure", { tikz: figure }, ctx, {
          autoApprove: false,
        })
      ).content,
    ).toContain("No figure is selected");
    ctx.selection.mockReturnValue({ text: figure, hasSelection: true });
    const result = await executeTool("update_figure", { tikz: figure }, ctx, {
      autoApprove: false,
    });
    expect(ctx.requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "replace-selection", oldText: figure }),
    );
    expect(result.content).toContain("compiled without errors");
  });

  it("leaves plain text inserts alone", async () => {
    const ctx = figureContext();
    const result = await executeTool("insert_at_cursor", { text: "A sentence." }, ctx, {
      autoApprove: false,
    });
    expect(ctx.showFigure).not.toHaveBeenCalled();
    expect(result.content).toBe("Inserted at cursor.");
  });

  it("adds the packages a whole-file write with a figure needs", async () => {
    const ctx = figureContext();
    await executeTool(
      "write_file",
      { path: "main.tex", content: article.replace("Text.", figure) },
      ctx,
      { autoApprove: false },
    );
    expect(ctx.writeFile.mock.calls[0][1]).toContain(
      "\\usepackage{amsmath}\n\\usepackage{tikz}\n\\usetikzlibrary{arrows.meta,positioning}",
    );
  });
});
