import { describe, it, expect, vi } from "vitest";
import { executeTool, type AgentContext } from "./aiTools";

export function context() {
  return {
    hasProject: vi.fn(() => true),
    projectName: () => "Paper",
    activeFilePath: vi.fn((): string | null => "main.tex"),
    listFiles: vi.fn(async () => ["main.tex", "refs.bib"]),
    readFile: vi.fn(async () => "original"),
    writeFile: vi.fn(async () => {}),
    documentText: () => "document",
    selection: vi.fn(() => ({ text: "selected", hasSelection: true })),
    applyEdit: vi.fn(async () => {}),
    compile: vi.fn(async () => ({ ok: true, log: "", diagnostics: [] as string[] })),
    runChecks: vi.fn(async () => "report"),
    insertCitation: vi.fn(async () => "smith2024"),
    recommendCitations: vi.fn(async () => "ranked references"),
    requestApproval: vi.fn(async () => true),
  } satisfies AgentContext;
}
describe("agent tool execution", () => {
  it.each([
    ["list_files", {}, "main.tex\nrefs.bib"],
    ["read_file", { path: "main.tex" }, "original"],
    ["get_selection", {}, "selected"],
    ["get_active_document", {}, "document"],
    ["compile", {}, "Compiled successfully. No errors."],
    ["run_checks", { kind: "citations" }, "report"],
    ["insert_citation", { query: "smith" }, "smith2024"],
    ["recommend_citations", { passage: "A claim" }, "ranked references"],
  ])("returns %s results", async (name, args, content) => {
    expect(
      await executeTool(name as string, args as Record<string, unknown>, context(), {
        autoApprove: false,
      }),
    ).toMatchObject({ ok: true, content });
  });
  it.each([
    "read_file",
    "write_file",
    "run_checks",
    "insert_citation",
    "recommend_citations",
  ])("rejects missing arguments for %s", async (name) => {
    expect(await executeTool(name, {}, context(), { autoApprove: true })).toMatchObject(
      { ok: false, content: expect.stringContaining("Missing") },
    );
  });
  it.each([
    ["edit_selection", { new_text: "new" }, "replace-selection"],
    ["insert_at_cursor", { text: "new" }, "insert-at-cursor"],
    ["write_file", { path: "main.tex", content: "new" }, "replace-file"],
  ])(
    "requires approval for %s even with autoApprove enabled",
    async (name, args, kind) => {
      const ctx = context();
      ctx.requestApproval.mockResolvedValue(false);
      const result = await executeTool(
        name as string,
        args as Record<string, unknown>,
        ctx,
        { autoApprove: true },
      );
      expect(result.content).toContain("declined");
      expect(ctx.requestApproval).toHaveBeenCalledWith(
        expect.objectContaining({ path: "main.tex", kind, newText: "new" }),
      );
      expect(ctx.applyEdit).not.toHaveBeenCalled();
      expect(ctx.writeFile).not.toHaveBeenCalled();
      ctx.requestApproval.mockResolvedValue(true);
      await executeTool(name as string, args as Record<string, unknown>, ctx, {
        autoApprove: false,
      });
      if (name === "write_file")
        expect(ctx.writeFile).toHaveBeenCalledWith("main.tex", "new");
      else
        expect(ctx.applyEdit).toHaveBeenCalledWith(
          expect.objectContaining({ kind, newText: "new" }),
        );
    },
  );
  it("can create a file while retaining an empty before-image", async () => {
    const ctx = context();
    ctx.readFile.mockRejectedValue(new Error("missing"));
    await executeTool("write_file", { path: "new.tex", content: "new" }, ctx, {
      autoApprove: false,
    });
    expect(ctx.requestApproval).toHaveBeenCalledWith({
      path: "new.tex",
      kind: "replace-file",
      oldText: "",
      newText: "new",
    });
  });
  it("handles absent selection, document, files and findings", async () => {
    const ctx = context();
    ctx.selection.mockReturnValue({ text: "", hasSelection: false });
    ctx.activeFilePath.mockReturnValue(null);
    ctx.listFiles.mockResolvedValue([]);
    ctx.runChecks.mockResolvedValue("");
    for (const name of ["edit_selection", "insert_at_cursor", "get_active_document"]) {
      expect(
        (await executeTool(name, {}, ctx, { autoApprove: false })).content,
      ).toMatch(/No (selection|document)/);
    }
    expect(
      (await executeTool("get_selection", {}, ctx, { autoApprove: false })).content,
    ).toBe("(nothing selected)");
    ctx.selection.mockReturnValue({ text: "selection", hasSelection: true });
    expect(
      (await executeTool("edit_selection", {}, ctx, { autoApprove: false })).content,
    ).toContain("No document");
    expect(
      (await executeTool("list_files", {}, ctx, { autoApprove: false })).content,
    ).toBe("(no files)");
    expect(
      (
        await executeTool("run_checks", { kind: "notation" }, ctx, {
          autoApprove: false,
        })
      ).content,
    ).toBe("No issues found.");
  });
  it("bounds failed compile output while retaining actionable diagnostics", async () => {
    const ctx = context();
    ctx.compile.mockResolvedValue({
      ok: false,
      log: "PREFIX" + "x".repeat(1500),
      diagnostics: Array.from({ length: 25 }, (_, i) => `error ${i}`),
    });
    const result = await executeTool("compile", {}, ctx, { autoApprove: false });
    expect(result.content).toContain("error 19");
    expect(result.content).not.toContain("error 20");
    expect(result.content).not.toContain("PREFIX");
    ctx.compile.mockResolvedValue({ ok: false, log: "failure", diagnostics: [] });
    expect(
      (await executeTool("compile", {}, ctx, { autoApprove: false })).content,
    ).toContain("(none parsed)");
  });
  it.each([
    ["No project open", "open or create"],
    ["Current editor access is disabled in AI settings.", "Current editor access"],
    ["No document is open", "open a document"],
    ["disk full", "disk full"],
  ])("explains tool failure: %s", async (message, expected) => {
    const ctx = context();
    ctx.readFile.mockRejectedValue(new Error(message));
    expect(
      await executeTool("read_file", { path: "main.tex" }, ctx, { autoApprove: false }),
    ).toMatchObject({ ok: false, content: expect.stringContaining(expected) });
  });
  it("rejects unknown tools", async () =>
    expect(
      await executeTool("shell", {}, context(), { autoApprove: true }),
    ).toMatchObject({ ok: false, content: "Unknown tool: shell" }));
});
