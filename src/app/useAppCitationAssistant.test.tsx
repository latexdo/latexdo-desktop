import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppCitationAssistant } from "./useAppCitationAssistant";
import type { AppCtx16 } from "./appContext";
import type { OpenDocument, ProjectEntry } from "../types";
import type { CitationEntry } from "../latex/latexIndex";
import type { ScholarlyPaper } from "../features/scholarly/scholarlyTypes";
const search = vi.hoisted(() => ({ searchCrossref: vi.fn(), searchOpenAlex: vi.fn() }));
vi.mock("../features/scholarly/scholarlyClient", async (original) => ({
  ...(await original<object>()),
  ...search,
}));
const entry = (name: string): ProjectEntry => ({
  name,
  path: `/p/${name}`,
  relativePath: name,
  type: "file",
});
const citation = (key = "smith"): CitationEntry => ({
  key,
  type: "article",
  sourceFile: "b.bib",
});
const paper: ScholarlyPaper = {
  id: "p",
  title: "Useful study",
  authors: ["Jane Smith"],
  year: 2020,
  doi: "10.1/test",
  provider: "Crossref",
} as ScholarlyPaper;
const bib = (key: string, title = key) => `@article{${key}, title={${title}}}`;
const api = { writeFile: vi.fn(), readFile: vi.fn() };
function setup(overrides: Record<string, unknown> = {}) {
  const documentsRef = { current: [] as OpenDocument[] };
  const ctx = {
    citationAnalysis: { entries: [] as CitationEntry[] },
    citationProjectFiles: [] as { path: string; content: string }[],
    documentsRef,
    editorRef: { current: null },
    setDocuments: vi.fn((update: (docs: OpenDocument[]) => OpenDocument[]) => {
      documentsRef.current = update(documentsRef.current);
    }),
    handleAppendBibEntry: vi.fn().mockResolvedValue(undefined),
    insertCitationFromSearch: vi.fn(),
    projectEntriesRef: { current: [] as ProjectEntry[] },
    projectIdRef: { current: "p" },
    refreshProject: vi.fn().mockResolvedValue([]),
    setStatusMessage: vi.fn(),
    ...overrides,
  };
  return {
    ...renderHook(() => useAppCitationAssistant(ctx as unknown as AppCtx16)),
    ctx,
  };
}
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  api.writeFile.mockReset().mockResolvedValue(undefined);
  api.readFile.mockReset().mockResolvedValue("");
  search.searchCrossref.mockReset().mockResolvedValue([]);
  search.searchOpenAlex.mockReset().mockResolvedValue([]);
  window.latexdo = api as unknown as typeof window.latexdo;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("citation history and online search", () => {
  it("remembers unique recent picks per project and caps history", () => {
    const { result, ctx } = setup();
    for (let i = 0; i < 14; i++) result.current.pickCitation(citation(`key${i}`));
    result.current.pickCitation(citation("key13"));
    expect(result.current.readCitationContext()).toEqual({
      recentKeys: Array.from({ length: 12 }, (_, i) => `key${13 - i}`),
      sentence: "",
    });
    expect(ctx.insertCitationFromSearch).toHaveBeenCalledTimes(15);
    ctx.projectIdRef.current = "other";
    expect(result.current.readCitationContext().recentKeys).toEqual([]);
    ctx.projectIdRef.current = "p";
    expect(result.current.readCitationContext().recentKeys[0]).toBe("key13");
  });
  it.each([
    "bad json",
    JSON.stringify({ p: ["good", 1, null] }),
    JSON.stringify({ p: 42 }),
  ])("tolerates invalid saved history %s", (value) => {
    localStorage.setItem("latexdo.citations.recent.v1", value);
    const { result, ctx } = setup();
    expect(result.current.readCitationContext().recentKeys).toEqual(
      value.includes("good") ? ["good"] : [],
    );
    expect(() => result.current.pickCitation(citation())).not.toThrow();
    ctx.projectIdRef.current = "";
    expect(result.current.readCitationContext().recentKeys).toEqual([]);
    result.current.pickCitation(citation());
  });
  it("reads the current citation query and surrounding prose", () => {
    const text = "A useful claim \\cite{smi";
    const { result } = setup({
      editorRef: {
        current: {
          getModel: () => ({
            getValue: () => text,
            getOffsetAt: () => text.length,
            getLineContent: () => text,
          }),
          getPosition: () => ({ lineNumber: 1, column: text.length + 1 }),
        },
      },
    });
    expect(result.current.readCitationContext()).toMatchObject({
      query: "smi",
      sentence: expect.stringContaining("useful claim"),
    });
  });
  it("uses surviving providers and reports total failure", async () => {
    const { result } = setup();
    search.searchCrossref.mockResolvedValue([paper]);
    search.searchOpenAlex.mockRejectedValue(new Error("offline"));
    const signal = new AbortController().signal;
    expect(await result.current.searchCitationsOnline("study", signal)).toHaveLength(1);
    expect(search.searchCrossref).toHaveBeenCalledWith("study", {
      signal,
      perProviderLimit: 8,
    });
    search.searchCrossref.mockRejectedValue(new Error("offline"));
    await expect(result.current.searchCitationsOnline("study", signal)).rejects.toThrow(
      "No scholarly index answered",
    );
  });
  it("creates a bibliography when absent, otherwise chooses the file with most entries", async () => {
    const { result, ctx } = setup();
    await result.current.addOnlineCitation(paper);
    expect(api.writeFile).toHaveBeenCalledWith(
      "p",
      "references.bib",
      expect.stringContaining("Useful study"),
    );
    expect(ctx.insertCitationFromSearch).toHaveBeenCalledWith(
      expect.objectContaining({ title: paper.title }),
    );
    ctx.projectEntriesRef.current = [entry("a.bib"), entry("b.bib")];
    ctx.citationAnalysis.entries.push(citation());
    await result.current.addOnlineCitation(paper);
    expect(ctx.handleAppendBibEntry).toHaveBeenCalledWith(
      "b.bib",
      expect.stringContaining("Useful study"),
    );
    expect(ctx.setStatusMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("b.bib and cited it"),
    );
  });
  it.each([new Error("read only"), "bad"])(
    "does not cite after a failed write",
    async (error) => {
      const { result, ctx } = setup();
      api.writeFile.mockRejectedValue(error);
      await result.current.addOnlineCitation(paper);
      expect(ctx.insertCitationFromSearch).not.toHaveBeenCalled();
      expect(ctx.setStatusMessage).toHaveBeenLastCalledWith(
        error instanceof Error ? error.message : "Could not add the reference.",
      );
      ctx.projectIdRef.current = "";
      await result.current.addOnlineCitation(paper);
      expect(ctx.setStatusMessage).toHaveBeenLastCalledWith(
        "Open a project before adding references.",
      );
    },
  );
});
const files = [
  { path: "a.bib", content: bib("a") },
  { path: "b.bib", content: bib("b") },
  { path: "main.tex", content: "\\bibliography{a,b} \\cite{a}" },
  { path: "other.tex", content: "unchanged" },
];
const document = (path: string, content: string): OpenDocument => ({
  ...entry(path),
  kind: "text",
  content,
  savedContent: "old",
});
describe("bibliography maintenance", () => {
  it("merges and retargets from unsaved editor contents, retaining other documents", async () => {
    const { result, ctx } = setup({ citationProjectFiles: files });
    const other = document("notes.txt", "notes");
    ctx.documentsRef.current = [
      document("a.bib", bib("a") + bib("extra")),
      document("main.tex", files[2].content),
      document("references.bib", "old"),
      other,
    ];
    await result.current.mergeBibliographyFiles();
    expect(api.writeFile).toHaveBeenCalledWith(
      "p",
      "references.bib",
      expect.stringContaining("extra"),
    );
    expect(api.writeFile).toHaveBeenCalledWith(
      "p",
      "main.tex",
      "\\bibliography{references} \\cite{a}",
    );
    expect(ctx.documentsRef.current[1].savedContent).toContain("references");
    expect(ctx.documentsRef.current[3]).toBe(other);
    expect(ctx.refreshProject).toHaveBeenCalledWith("p");
  });
  it("reports duplicate and conflicting keys before merging", async () => {
    const { result } = setup({
      citationProjectFiles: [
        { path: "a.bib", content: bib("a") + bib("b") },
        { path: "b.bib", content: bib("a") + bib("b", "different") },
      ],
    });
    vi.mocked(window.confirm).mockReturnValue(false);
    await result.current.mergeBibliographyFiles();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("duplicate"));
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("defined differently"),
    );
    expect(api.writeFile).not.toHaveBeenCalled();
  });
  it.each([new Error("full"), "bad"])("reports failed merges", async (error) => {
    const { result, ctx } = setup({ citationProjectFiles: files });
    api.writeFile.mockRejectedValue(error);
    await result.current.mergeBibliographyFiles();
    expect(ctx.setStatusMessage).toHaveBeenLastCalledWith(
      error instanceof Error ? "full" : "Could not merge the .bib files.",
    );
  });
  it("skips maintenance without a project or sufficient bibliographies", async () => {
    const { result, ctx } = setup();
    await result.current.mergeBibliographyFiles();
    expect(ctx.setStatusMessage).toHaveBeenCalledWith(
      expect.stringContaining("nothing to merge"),
    );
    ctx.projectIdRef.current = "";
    await result.current.mergeBibliographyFiles();
    await result.current.removeUnusedBibliographyEntries();
    expect(api.writeFile).not.toHaveBeenCalled();
  });
  it("backs up the original bibliography before removing unused entries", async () => {
    const { result, ctx } = setup({ citationProjectFiles: files });
    ctx.documentsRef.current = [
      document("b.bib", bib("unused")),
      document("notes.txt", "keep"),
    ];
    api.readFile.mockImplementation(
      async (_id, path) => files.find((file) => file.path === path)?.content ?? "",
    );
    await result.current.removeUnusedBibliographyEntries();
    expect(api.writeFile.mock.calls[0][1]).toMatch(
      /^\.latexdo\/recovery\/bibliography-/,
    );
    expect(JSON.parse(api.writeFile.mock.calls[0][2])).toEqual([
      { path: "b.bib", content: bib("unused") },
    ]);
    expect(ctx.documentsRef.current[0].content).not.toContain("@article");
    expect(ctx.documentsRef.current[1].content).toBe("keep");
    expect(ctx.refreshProject).toHaveBeenCalledWith("p");
  });
  it("does not remove protected entries or proceed after cancellation", async () => {
    const { result, ctx } = setup({ citationProjectFiles: files });
    api.readFile.mockImplementation(async (_id, path) =>
      path.endsWith("tex") ? "\\nocite{*}" : bib("a"),
    );
    await result.current.removeUnusedBibliographyEntries();
    expect(ctx.setStatusMessage).toHaveBeenCalledWith(
      expect.stringContaining("No unused entries"),
    );
    api.readFile.mockImplementation(async (_id, path) =>
      path.endsWith("bib") ? bib("a") : "",
    );
    vi.mocked(window.confirm).mockReturnValue(false);
    await result.current.removeUnusedBibliographyEntries();
    expect(api.writeFile).not.toHaveBeenCalled();
  });
  it.each([new Error("denied"), "bad"])(
    "reports cleanup read failures",
    async (error) => {
      const { result, ctx } = setup({ citationProjectFiles: files });
      api.readFile.mockRejectedValue(error);
      await result.current.removeUnusedBibliographyEntries();
      expect(ctx.setStatusMessage).toHaveBeenLastCalledWith(
        error instanceof Error ? "denied" : "Could not remove unused entries.",
      );
    },
  );
  it("abandons cleanup if the project changes during reads", async () => {
    const { result, ctx } = setup({ citationProjectFiles: files });
    api.readFile.mockImplementation(async () => {
      ctx.projectIdRef.current = "other";
      return bib("unused");
    });
    await result.current.removeUnusedBibliographyEntries();
    expect(api.writeFile).not.toHaveBeenCalled();
  });
});
