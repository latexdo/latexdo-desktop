import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppProjectFiles } from "./useAppProjectFiles";
import type { AppCtx02 } from "./appContext";
import type { OpenDocument, ProjectEntry } from "../types";
import { defaultSettings } from "../features/settings/settings";
import { reviewSnapshot } from "./appShared";

const entry = (name = "main.tex"): ProjectEntry => ({
  name,
  path: `/p/${name}`,
  relativePath: name,
  type: "file",
});
const doc = (name = "main.tex", content = "changed"): OpenDocument => ({
  ...entry(name),
  kind: "text",
  content,
  savedContent: "old",
});
const api = {
  readFile: vi.fn(),
  readAsset: vi.fn(),
  writeFile: vi.fn(),
  listProject: vi.fn(),
  fileExists: vi.fn(),
};
function setup(overrides: Record<string, unknown> = {}) {
  const documentsRef = { current: [] as OpenDocument[] };
  const ctx = {
    activePath: "",
    activePathRef: { current: "" },
    allProjectEntries: [] as ProjectEntry[],
    bookmarkStore: {},
    documents: documentsRef.current,
    documentsRef,
    engine: "pdflatex",
    engineRef: { current: "" },
    figurePreviewCacheRef: { current: new Map() },
    hideProjectEntries: false,
    hideProjectEntriesRef: { current: false },
    projectEntriesRef: { current: [] as ProjectEntry[] },
    projectId: "p",
    projectIdRef: { current: "p" },
    projectPath: "/p",
    projectPathRef: { current: "" },
    projectSearchRefreshNonce: 0,
    rebuttalItems: [],
    reviewChats: [],
    reviewDataReadyRef: { current: true },
    reviewSaveQueueRef: { current: Promise.resolve() },
    reviewSavedSnapshotRef: { current: reviewSnapshot([], []) },
    rootFile: "main.tex",
    rootFileRef: { current: "main.tex" },
    settings: defaultSettings,
    settingsRef: { current: defaultSettings },
    setActivePath: vi.fn(),
    setCitationLibraryError: vi.fn(),
    setCitationLibraryLoading: vi.fn(),
    setCitationProjectFiles: vi.fn(),
    setDocuments: vi.fn(
      (next: OpenDocument[] | ((docs: OpenDocument[]) => OpenDocument[])) => {
        documentsRef.current =
          typeof next === "function" ? next(documentsRef.current) : next;
      },
    ),
    setProjectEntries: vi.fn(),
    setProjectSearchError: vi.fn(),
    setProjectSearchFiles: vi.fn(),
    setProjectSearchLoading: vi.fn(),
    setRebuttalItems: vi.fn(),
    setReviewChats: vi.fn(),
    setStatusMessage: vi.fn(),
    ...overrides,
  };
  const hook = renderHook(() => useAppProjectFiles(ctx as unknown as AppCtx02));
  return { ...hook, ctx };
}
beforeEach(() => {
  vi.useFakeTimers();
  api.readFile.mockReset().mockResolvedValue("disk");
  api.readAsset.mockReset().mockResolvedValue(new Uint8Array([1, 2]));
  api.writeFile.mockReset().mockResolvedValue(undefined);
  api.listProject.mockReset().mockResolvedValue([]);
  api.fileExists.mockReset().mockResolvedValue(true);
  window.latexdo = api as unknown as typeof window.latexdo;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("project file lifecycle", () => {
  it("synchronizes refs and suppresses scans without a project", async () => {
    const { result, ctx } = setup({ projectId: "" });
    expect(ctx.projectPathRef.current).toBe("/p");
    expect(ctx.engineRef.current).toBe("pdflatex");
    expect(ctx.setCitationProjectFiles).toHaveBeenCalledWith([]);
    expect(ctx.setProjectSearchFiles).toHaveBeenCalledWith([]);
    expect(await result.current.refreshProject()).toEqual([]);
    expect(api.listProject).not.toHaveBeenCalled();
    expect(result.current.resolveProjectDataPath("/a\\b")).toBe("a/b");
  });
  it("reports truncated project listings", async () => {
    const entries = [{ ...entry(), limited: true }];
    api.listProject.mockResolvedValue(entries);
    const { result, ctx } = setup();
    expect(await result.current.refreshProject()).toEqual(entries);
    expect(ctx.setProjectEntries).toHaveBeenCalledWith(entries);
    expect(ctx.setStatusMessage).toHaveBeenCalledWith(
      expect.stringContaining("limited"),
    );
  });
  it.each(["main.tex", "plot.png", "paper.pdf"])(
    "opens %s once even when reads race",
    async (name) => {
      const { result, ctx } = setup();
      await act(async () => {
        await Promise.all([
          result.current.openDocument(entry(name)),
          result.current.openDocument(entry(name)),
        ]);
      });
      expect(ctx.documentsRef.current).toHaveLength(1);
      expect(ctx.documentsRef.current[0]).toMatchObject({
        name,
        kind: name.endsWith("tex") ? "text" : "asset",
      });
      const calls = api.readFile.mock.calls.length + api.readAsset.mock.calls.length;
      await result.current.openDocument(entry(name));
      expect(api.readFile.mock.calls.length + api.readAsset.mock.calls.length).toBe(
        calls,
      );
      expect(ctx.activePathRef.current).toBe(`/p/${name}`);
    },
  );
  it("ignores directories and can open silently", async () => {
    const { result, ctx } = setup();
    await result.current.openDocument({ ...entry(), type: "directory" });
    expect(api.readFile).not.toHaveBeenCalled();
    await result.current.openDocument(entry(), "other", { announce: false });
    expect(api.readFile).toHaveBeenCalledWith("other", "main.tex");
    expect(ctx.setStatusMessage).not.toHaveBeenCalled();
  });
  it.each(["main.tex", "plot.png"])(
    "reports %s read failures without opening a document",
    async (name) => {
      const { result, ctx } = setup();
      for (const error of [new Error("denied"), "failure"]) {
        api.readFile.mockRejectedValue(error);
        api.readAsset.mockRejectedValue(error);
        await result.current.openDocument(entry(name));
        expect(ctx.setStatusMessage).toHaveBeenLastCalledWith(
          error instanceof Error ? "denied" : `Could not open ${name}`,
        );
      }
      ctx.setStatusMessage.mockClear();
      await result.current.openDocument(entry(name), "p", { announce: false });
      expect(ctx.setStatusMessage).not.toHaveBeenCalled();
      expect(ctx.documentsRef.current).toEqual([]);
    },
  );
  it("indexes editor contents, skips unreadable files, and ignores assets", async () => {
    const { ctx } = setup({
      allProjectEntries: [
        entry(),
        entry("refs.bib"),
        entry("bad.tex"),
        entry("plot.png"),
      ],
    });
    ctx.documentsRef.current = [doc("main.tex", "editor")];
    api.readFile.mockImplementation(async (_id, path) => {
      if (path === "bad.tex") throw new Error("denied");
      return "bibliography";
    });
    await act(() => vi.advanceTimersByTimeAsync(250));
    const files = [
      { path: "main.tex", content: "editor" },
      { path: "refs.bib", content: "bibliography" },
    ];
    expect(ctx.setCitationProjectFiles).toHaveBeenLastCalledWith(files);
    expect(ctx.setProjectSearchFiles).toHaveBeenLastCalledWith(files);
    expect(ctx.setCitationLibraryError).toHaveBeenLastCalledWith(
      expect.stringContaining("bad.tex"),
    );
    expect(ctx.setProjectSearchError).toHaveBeenLastCalledWith(
      "Skipped 1 unreadable file.",
    );
    expect(ctx.setProjectSearchLoading).toHaveBeenLastCalledWith(false);
  });
  it("does not publish scans after unmount", async () => {
    let resolve!: (value: string) => void;
    api.readFile.mockReturnValue(
      new Promise<string>((done) => {
        resolve = done;
      }),
    );
    const { ctx, unmount } = setup({ allProjectEntries: [entry()] });
    await act(() => vi.advanceTimersByTimeAsync(250));
    unmount();
    resolve("late");
    await act(async () => {});
    expect(ctx.setCitationProjectFiles).not.toHaveBeenCalled();
    expect(ctx.setProjectSearchFiles).not.toHaveBeenCalled();
  });
});

describe("compile saves", () => {
  it("preserves dirty contents after a partial write failure and allows retry", async () => {
    const { result, ctx } = setup();
    const root = doc();
    const chapter = doc("chapter.tex", "chapter edits");
    ctx.documentsRef.current = [root, chapter];
    api.writeFile.mockImplementation(async (_id, path) => {
      if (path === "main.tex") throw new Error("disk full");
    });
    await expect(
      result.current.saveDocumentsForCompile("p", [root, chapter]),
    ).rejects.toThrow("disk full");
    expect(api.writeFile).toHaveBeenCalledWith("p", "chapter.tex", "chapter edits");
    expect(ctx.documentsRef.current).toEqual([root, chapter]);
    expect(ctx.setDocuments).not.toHaveBeenCalled();

    api.writeFile.mockResolvedValue(undefined);
    await result.current.saveDocumentsForCompile("p", ctx.documentsRef.current);
    expect(
      ctx.documentsRef.current.map(({ content, savedContent }) => ({
        content,
        savedContent,
      })),
    ).toEqual([
      { content: "changed", savedContent: "changed" },
      { content: "chapter edits", savedContent: "chapter edits" },
    ]);
  });
  it("keeps edits typed during a save dirty and ignores assets", async () => {
    const { result, ctx } = setup();
    const root = doc();
    const chapter = doc("chapter.tex");
    ctx.documentsRef.current = [root, chapter];
    api.writeFile.mockImplementation(async (_id, path) => {
      if (path === "main.tex")
        ctx.documentsRef.current = [{ ...root, content: "newer edit" }, chapter];
    });
    await result.current.saveDocumentsForCompile("p", [
      root,
      chapter,
      { ...doc("x.png"), kind: "asset" },
    ]);
    expect(api.writeFile).toHaveBeenCalledWith("p", "chapter.tex", "changed");
    expect(api.writeFile).toHaveBeenCalledWith("p", "main.tex", "changed");
    expect(ctx.documentsRef.current[0]).toMatchObject({
      content: "newer edit",
      savedContent: "changed",
    });
    expect(ctx.documentsRef.current[1].savedContent).toBe("changed");
    expect(api.writeFile).toHaveBeenCalledTimes(2);
  });
  it("leaves clean documents alone and skips unreadable closed TeX files", async () => {
    const { result, ctx } = setup();
    ctx.documentsRef.current = [{ ...doc(), content: "old" }];
    ctx.projectEntriesRef.current = [entry("bad.tex")];
    api.readFile.mockRejectedValue(new Error("not UTF-8"));
    await result.current.saveDocumentsForCompile("p", []);
    expect(api.writeFile).not.toHaveBeenCalled();
    expect(ctx.setDocuments).not.toHaveBeenCalled();
  });
  it.each([
    "",
    "\\begin{document}body",
    "% --- LatexDo Review & Rebuttal Macros ---\nold\n% ----------------------------------------\nbody",
  ])("installs a single preamble macro block", (content) => {
    const { result } = setup();
    const updated = result.current.ensurePreambleMacros(content);
    expect(updated).toContain("\\long\\def\\rebuttal");
    expect(result.current.ensurePreambleMacros(updated)).toBe(updated);
    if (content.includes("\\begin"))
      expect(updated.indexOf("\\long\\def")).toBeLessThan(
        updated.indexOf("\\begin{document}"),
      );
  });
  it("adds review macros to the root when a closed chapter uses them", async () => {
    const { result, ctx } = setup();
    ctx.projectEntriesRef.current = [entry(), entry("chapter.tex")];
    api.readFile.mockImplementation(async (_id, path) =>
      path === "main.tex"
        ? "\\begin{document}body"
        : "\\reviewercomment{text}{comment}",
    );
    await result.current.saveDocumentsForCompile("p", []);
    expect(api.writeFile).toHaveBeenCalledWith(
      "p",
      "main.tex",
      expect.stringContaining("\\long\\def\\reviewercomment"),
    );
  });
});

describe("review persistence", () => {
  it("loads absent, valid and malformed review data without overwriting failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, ctx } = setup();
    api.fileExists.mockResolvedValue(false);
    await result.current.loadReviewData("p");
    expect(ctx.reviewDataReadyRef.current).toBe(true);
    expect(ctx.setReviewChats).toHaveBeenLastCalledWith([]);
    api.fileExists.mockResolvedValue(true);
    api.readFile.mockResolvedValue(JSON.stringify({ chats: null, items: null }));
    await result.current.loadReviewData("p");
    expect(ctx.setRebuttalItems).toHaveBeenLastCalledWith([]);
    api.readFile.mockResolvedValue("invalid JSON");
    await result.current.loadReviewData("p");
    expect(ctx.reviewDataReadyRef.current).toBe(false);
    await result.current.saveReviewData([], []);
    expect(api.writeFile).not.toHaveBeenCalled();
    expect(ctx.setStatusMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("not being saved"),
    );
  });
  it("serializes saves and recovers after a failed write", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, ctx } = setup();
    api.writeFile.mockRejectedValueOnce(new Error("offline"));
    const first = result.current.saveReviewData([], []);
    const second = result.current.saveReviewData([], []);
    await Promise.all([first, second]);
    expect(api.writeFile).toHaveBeenCalledTimes(2);
    expect(api.writeFile).toHaveBeenLastCalledWith(
      "p",
      ".latexdo/review_data.json",
      JSON.stringify({ chats: [], items: [] }, null, 2),
    );
    expect(ctx.setStatusMessage).toHaveBeenCalledWith(
      expect.stringContaining("Could not save"),
    );
    ctx.projectIdRef.current = "";
    await result.current.saveReviewData([], []);
    expect(api.writeFile).toHaveBeenCalledTimes(2);
  });
});
