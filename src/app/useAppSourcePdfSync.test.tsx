import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as monaco from "monaco-editor";
import { useAppSourcePdfSync } from "./useAppSourcePdfSync";
import { setMonaco } from "./appShared";
import type { AppCtx04 } from "./appContext";
import type { OpenDocument, ProjectEntry } from "../types";
import { defaultSettings } from "../features/settings/settings";
const entry = (path = "main.tex", directory = false): ProjectEntry => ({
  name: path.split("/").at(-1)!,
  path: `/p/${path}`,
  relativePath: path,
  type: directory ? "directory" : "file",
});
const doc = (path = "main.tex", content = "hello world"): OpenDocument => ({
  ...entry(path),
  kind: "text",
  content,
  savedContent: content,
});
const api = {
  readFile: vi.fn(),
  moveEntry: vi.fn(),
  copyEntry: vi.fn(),
  trashEntry: vi.fn(),
  forwardSyncTex: vi.fn(),
  backwardSyncTex: vi.fn(),
};
function setup(overrides: Record<string, unknown> = {}) {
  const documentsRef = { current: [doc()] };
  const model = {
    uri: monaco.Uri.file("/p/main.tex"),
    getValue: () => "hello world",
    getLineCount: () => 1,
    getLineMaxColumn: () => 12,
    getLineContent: () => "hello world",
    getWordAtPosition: () => ({ word: "hello", startColumn: 1, endColumn: 6 }),
  };
  const editor = {
    getModel: () => model,
    getPosition: vi.fn(() => ({ lineNumber: 1, column: 2 })),
    getVisibleRanges: () => [{ startLineNumber: 1, endLineNumber: 1 }],
    setSelection: vi.fn(),
    revealRangeInCenter: vi.fn(),
    focus: vi.fn(),
    deltaDecorations: vi.fn(() => ["decoration"]),
  };
  const ctx = {
    activeDocument: doc(),
    activePathRef: { current: "/p/main.tex" },
    allProjectEntries: [entry()],
    assistantDiagnostics: [],
    backwardSyncRunIdRef: { current: 0 },
    compile: vi.fn().mockResolvedValue({ ok: true, pdfPath: "/p/main.pdf" }),
    compileResult: null,
    documentsRef,
    editorRef: { current: editor },
    editorScrollSyncRunIdRef: { current: 0 },
    editorScrollSyncTimerRef: { current: null as number | null },
    forwardSyncRef: { current: null },
    lastEditorScrollSyncKeyRef: { current: "" },
    lastPdfLocation: null,
    lastPdfScrollSyncKeyRef: { current: "" },
    openDocument: vi.fn().mockResolvedValue(undefined),
    pdfDataRef: { current: new Uint8Array([1]) },
    pdfPathRef: { current: "/p/main.pdf" },
    pdfScaleRef: { current: 100 },
    pdfScrollSyncRunIdRef: { current: 0 },
    pdfScrollSyncTimerRef: { current: null as number | null },
    pdfSurfaceRef: { current: null as HTMLDivElement | null },
    pdfTarget: null,
    pendingSourceRef: {
      current: null as {
        path: string;
        line: number;
        column: number;
        focus?: boolean;
      } | null,
    },
    projectEntries: [entry()],
    projectEntriesRef: { current: [entry()] },
    projectIdRef: { current: "p" },
    projectPathRef: { current: "/p" },
    refreshProject: vi.fn().mockResolvedValue([]),
    rootFile: "main.tex",
    rootFileRef: { current: "main.tex" },
    saveDocument: vi.fn().mockResolvedValue(undefined),
    setActivePath: vi.fn(),
    setAssistantDiagnostics: vi.fn(),
    setCompileResult: vi.fn(),
    setDocuments: vi.fn(),
    setErrorDoctorResult: vi.fn(),
    setLastPdfLocation: vi.fn(),
    setPdfComplianceDiagnostics: vi.fn(),
    setPdfData: vi.fn(),
    setPdfTarget: vi.fn(),
    setPreviewVisible: vi.fn(),
    setRootFile: vi.fn(),
    setStatusMessage: vi.fn(),
    setWelcomeOpen: vi.fn(),
    settings: { ...defaultSettings },
    sourceSyncClearTimerRef: { current: null as number | null },
    sourceSyncDecorationsRef: { current: [] as string[] },
    suppressEditorScrollSyncUntilRef: { current: 0 },
    suppressPdfScrollSyncUntilRef: { current: 0 },
    ...overrides,
  };
  return {
    ...renderHook(() => useAppSourcePdfSync(ctx as unknown as AppCtx04)),
    ctx,
    editor,
    model,
  };
}
beforeEach(() => {
  setMonaco(monaco);
  vi.useFakeTimers();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  api.readFile.mockReset().mockResolvedValue("");
  api.moveEntry.mockReset().mockImplementation(async (_p, _from, to) => to);
  api.copyEntry.mockReset().mockResolvedValue(undefined);
  api.trashEntry.mockReset().mockResolvedValue(undefined);
  api.forwardSyncTex.mockReset().mockResolvedValue({ page: 1, x: 10, y: 20 });
  api.backwardSyncTex
    .mockReset()
    .mockResolvedValue({ file: "main.tex", line: 1, column: 2 });
  window.latexdo = api as unknown as typeof window.latexdo;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("project entry operations", () => {
  it.each(["/p", "C:\\paper"])(
    "moves folders and updates tabs, root file, active file and PDF for %s",
    async (root) => {
      const h = setup();
      const folder = entry("chapters", true);
      const target = entry("appendix", true);
      const source = doc("chapters/main.tex");
      source.content = "dirty";
      const other = doc("other.tex");
      h.ctx.projectEntriesRef.current = [folder, target];
      h.ctx.documentsRef.current = [source, other];
      h.ctx.rootFileRef.current = "chapters/main.tex";
      h.ctx.activePathRef.current = source.path;
      h.ctx.projectPathRef.current = root;
      await h.result.current.moveEntry(folder.path, target);
      expect(h.ctx.saveDocument).toHaveBeenCalledWith(source);
      expect(api.moveEntry).toHaveBeenCalledWith("p", "chapters", "appendix/chapters");
      expect(h.ctx.documentsRef.current[0].relativePath).toBe(
        "appendix/chapters/main.tex",
      );
      expect(h.ctx.documentsRef.current[1]).toBe(other);
      expect(h.ctx.rootFileRef.current).toBe("appendix/chapters/main.tex");
      expect(h.ctx.activePathRef.current).toBe(
        root.startsWith("C:")
          ? "C:\\paper\\appendix\\chapters\\main.tex"
          : "/p/appendix/chapters/main.tex",
      );
      expect(h.ctx.setCompileResult).toHaveBeenCalledWith(null);
      expect(h.ctx.pdfPathRef.current).toBe("");
    },
  );
  it("renames files and rejects invalid or redundant moves", async () => {
    const h = setup();
    await h.result.current.moveEntry("/p/main.tex", null, "renamed.tex");
    expect(h.ctx.documentsRef.current[0].relativePath).toBe("renamed.tex");
    expect(h.ctx.setRootFile).toHaveBeenCalledWith("renamed.tex");
    for (const name of ["", "a/b", "a\\b"]) {
      await h.result.current.moveEntry("/p/main.tex", null, name);
      expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
        "Enter a name without slashes.",
      );
    }
    api.moveEntry.mockClear();
    await h.result.current.moveEntry("/p/main.tex", null, "main.tex");
    await h.result.current.moveEntry("/p/main.tex", null);
    expect(api.moveEntry).not.toHaveBeenCalled();
    await h.result.current.moveEntry("gone", null);
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "The dragged item could not be found.",
    );
    const folder = entry("dir", true);
    h.ctx.projectEntriesRef.current = [folder];
    await h.result.current.moveEntry(folder.path, entry("dir/sub", true));
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "A folder cannot be moved into itself.",
    );
  });
  it("copies without overwriting existing names and saves unsaved content first", async () => {
    const h = setup();
    h.ctx.projectEntriesRef.current = [entry(), entry("main copy.tex")];
    h.ctx.documentsRef.current[0].content = "dirty";
    await h.result.current.copyEntry("/p/main.tex", null);
    expect(api.copyEntry).toHaveBeenCalledWith("p", "main.tex", "main copy 2.tex");
    expect(h.ctx.saveDocument).toHaveBeenCalled();
    await h.result.current.copyEntry("gone", null);
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "The copied item no longer exists.",
    );
  });
  it("trashes a folder and closes only its tabs", async () => {
    const h = setup();
    h.ctx.documentsRef.current = [doc("dir/a.tex"), doc("other.tex")];
    h.ctx.activePathRef.current = "/p/dir/a.tex";
    await h.result.current.deleteEntry(entry("dir", true));
    expect(h.ctx.documentsRef.current.map((d) => d.relativePath)).toEqual([
      "other.tex",
    ]);
    expect(h.ctx.activePathRef.current).toBe("/p/other.tex");
    await h.result.current.deleteEntry(entry("other.tex"));
    expect(h.ctx.activePathRef.current).toBe("");
    vi.mocked(window.confirm).mockReturnValue(false);
    api.trashEntry.mockClear();
    await h.result.current.deleteEntry(entry());
    expect(api.trashEntry).not.toHaveBeenCalled();
  });
  it.each([new Error("denied"), "bad"])(
    "reports filesystem failures",
    async (error) => {
      const h = setup();
      api.moveEntry.mockRejectedValue(error);
      api.copyEntry.mockRejectedValue(error);
      api.trashEntry.mockRejectedValue(error);
      await h.result.current.moveEntry("/p/main.tex", null, "new.tex");
      expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
        error instanceof Error ? "denied" : "Could not rename the file",
      );
      await h.result.current.copyEntry("/p/main.tex", null);
      expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
        error instanceof Error ? "denied" : "Could not copy the file",
      );
      await h.result.current.deleteEntry(entry());
      expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
        error instanceof Error ? "denied" : "Could not delete the file",
      );
    },
  );
  it("does not change files without a project or with an invalid destination", async () => {
    const h = setup();
    await h.result.current.moveEntry("/p/main.tex", entry());
    await h.result.current.copyEntry("/p/main.tex", entry());
    h.ctx.projectIdRef.current = "";
    await h.result.current.moveEntry("/p/main.tex", null);
    await h.result.current.copyEntry("/p/main.tex", null);
    await h.result.current.deleteEntry(entry());
    expect(api.moveEntry).not.toHaveBeenCalled();
    expect(api.copyEntry).not.toHaveBeenCalled();
    expect(api.trashEntry).not.toHaveBeenCalled();
  });
});
describe("source and PDF navigation", () => {
  it("reveals and temporarily highlights the pending source range", async () => {
    const h = setup();
    expect(h.result.current.revealPendingSource()).toBe(false);
    h.ctx.pendingSourceRef.current = { path: "/p/other.tex", line: 1, column: 2 };
    expect(h.result.current.revealPendingSource()).toBe(false);
    h.ctx.pendingSourceRef.current.path = "/p/main.tex";
    expect(h.result.current.revealPendingSource()).toBe(true);
    expect(h.editor.setSelection).toHaveBeenCalledWith(
      expect.objectContaining({ startColumn: 1, endColumn: 6 }),
    );
    expect(h.editor.focus).toHaveBeenCalled();
    expect(h.ctx.pendingSourceRef.current).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1800));
    expect(h.editor.deltaDecorations).toHaveBeenLastCalledWith(["decoration"], []);
    h.ctx.pendingSourceRef.current = { path: "/p/main.tex", line: 1, column: 1 };
    h.editor.focus.mockClear();
    h.editor.setSelection.mockClear();
    h.result.current.revealPendingSource({
      focus: false,
      select: false,
      highlight: false,
    });
    expect(h.editor.focus).not.toHaveBeenCalled();
    expect(h.editor.setSelection).not.toHaveBeenCalled();
  });
  it("compiles dirty sources before forward synchronization", async () => {
    const h = setup();
    h.ctx.documentsRef.current[0].content = "dirty";
    await h.result.current.handleEditorCursorToPdf();
    expect(h.ctx.compile).toHaveBeenCalled();
    expect(api.forwardSyncTex).toHaveBeenCalledWith(
      "p",
      "/p/main.pdf",
      "main.tex",
      1,
      2,
    );
    expect(h.ctx.setPdfTarget).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, word: "hello" }),
    );
    expect(h.ctx.setPreviewVisible).toHaveBeenCalledWith(true);
    h.ctx.compile.mockResolvedValueOnce({ ok: false } as never);
    await h.result.current.handleEditorCursorToPdf();
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "Compile successfully before synchronizing the PDF",
    );
  });
  it("reports missing cursor, no match, and failed forward synchronization", async () => {
    const h = setup();
    api.forwardSyncTex.mockResolvedValue(null);
    await h.result.current.handleEditorCursorToPdf();
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("No PDF location"),
    );
    for (const error of [new Error("failed"), "bad"]) {
      api.forwardSyncTex.mockRejectedValue(error);
      await h.result.current.handleEditorCursorToPdf();
      expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
        error instanceof Error ? "failed" : "Could not synchronize PDF",
      );
    }
    h.editor.getPosition.mockReturnValue(null as never);
    await h.result.current.handleEditorCursorToPdf();
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("Place the cursor"),
    );
  });
  it("opens inverse-search results and warns when the editor has unsaved changes", async () => {
    const h = setup();
    h.ctx.documentsRef.current[0].content = "dirty";
    await h.result.current.handleBackwardSync({ page: 1, x: 2, y: 3 });
    expect(h.ctx.openDocument).toHaveBeenCalledWith(entry());
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("Compile if the jump looks stale"),
    );
    await act(() => vi.advanceTimersByTimeAsync(16));
    expect(h.editor.revealRangeInCenter).toHaveBeenCalled();
  });
  it("handles missing PDFs, stale matches and inverse-search failures", async () => {
    const h = setup();
    await h.result.current.handlePdfPointToSource();
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("click a PDF point"),
    );
    api.backwardSyncTex.mockResolvedValue(null);
    await h.result.current.handleBackwardSync({ page: 1, x: 0, y: 0 });
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("No source location"),
    );
    api.backwardSyncTex.mockResolvedValue({ file: "missing.tex", line: 1, column: 1 });
    await h.result.current.handleBackwardSync({ page: 1, x: 0, y: 0 });
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "Could not open missing.tex",
    );
    for (const error of [new Error("failed"), "bad"]) {
      api.backwardSyncTex.mockRejectedValue(error);
      await h.result.current.handleBackwardSync({ page: 1, x: 0, y: 0 });
      expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
        error instanceof Error ? "failed" : "Could not synchronize source",
      );
    }
    h.ctx.pdfPathRef.current = "";
    await h.result.current.handleBackwardSync({ page: 1, x: 0, y: 0 });
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("Compile successfully"),
    );
  });
  it("ignores an older inverse-search response", async () => {
    let resolve!: (value: unknown) => void;
    api.backwardSyncTex.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const h = setup();
    const first = h.result.current.handleBackwardSync({ page: 1, x: 0, y: 0 });
    await h.result.current.handleBackwardSync({ page: 1, x: 1, y: 1 });
    h.ctx.openDocument.mockClear();
    resolve({ file: "main.tex", line: 1, column: 1 });
    await first;
    expect(h.ctx.openDocument).not.toHaveBeenCalled();
  });
  it("opens project search matches and reports vanished files", async () => {
    const h = setup();
    const match = {
      path: "main.tex",
      line: 1,
      column: 2,
      endColumn: 4,
      id: "match",
      lineText: "hello",
      matchText: "ell",
      before: [],
      after: [],
    } satisfies Parameters<typeof h.result.current.handleOpenProjectSearchMatch>[0];
    await h.result.current.handleOpenProjectSearchMatch(match, { focus: false });
    expect(h.ctx.pendingSourceRef.current).toMatchObject({
      path: "/p/main.tex",
      endColumn: 4,
      focus: false,
    });
    await h.result.current.handleOpenProjectSearchMatch({ ...match, path: "gone" });
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "gone is no longer in this project.",
    );
  });
});
describe("scroll sync and paper checks", () => {
  it("debounces editor scrolling and skips repeated positions", async () => {
    const h = setup();
    h.result.current.scheduleEditorScrollSync();
    h.result.current.scheduleEditorScrollSync();
    await act(() => vi.advanceTimersByTimeAsync(160));
    expect(api.forwardSyncTex).toHaveBeenCalledTimes(1);
    h.result.current.scheduleEditorScrollSync();
    await act(() => vi.advanceTimersByTimeAsync(160));
    expect(api.forwardSyncTex).toHaveBeenCalledTimes(1);
    h.ctx.lastEditorScrollSyncKeyRef.current = "";
    api.forwardSyncTex.mockRejectedValue(new Error("no mapping"));
    h.result.current.scheduleEditorScrollSync();
    await act(() => vi.advanceTimersByTimeAsync(160));
    expect(h.ctx.setStatusMessage).not.toHaveBeenCalled();
  });
  it("syncs visible PDF pages without stealing editor focus", async () => {
    const h = setup();
    const surface = document.createElement("div");
    const page = document.createElement("div");
    page.className = "pdf-page";
    page.dataset.pageNumber = "1";
    surface.append(page);
    surface.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 600,
        height: 800,
        right: 600,
        bottom: 800,
      }) as DOMRect;
    page.getBoundingClientRect = surface.getBoundingClientRect;
    h.ctx.pdfSurfaceRef.current = surface;
    h.result.current.schedulePdfScrollSync();
    h.result.current.schedulePdfScrollSync();
    await act(() => vi.advanceTimersByTimeAsync(180));
    expect(api.backwardSyncTex).toHaveBeenCalledTimes(1);
    expect(h.ctx.openDocument).toHaveBeenCalledWith(entry(), "p", { announce: false });
    expect(h.editor.focus).not.toHaveBeenCalled();
    h.result.current.schedulePdfScrollSync();
    await act(() => vi.advanceTimersByTimeAsync(160));
    expect(api.backwardSyncTex).toHaveBeenCalledTimes(1);
  });
  it("runs enabled paper checks across the root and clears them without a project", async () => {
    const h = setup({
      settings: {
        ...defaultSettings,
        conferenceCheckerEnabled: true,
        citationAssistantEnabled: true,
        structureAssistantEnabled: true,
        reproducibilityEnabled: true,
        acronymManagerEnabled: true,
        notationManagerEnabled: true,
        pdfComplianceEnabled: true,
      },
    });
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(h.ctx.setAssistantDiagnostics).toHaveBeenCalled();
    expect(h.ctx.setPdfComplianceDiagnostics).toHaveBeenCalled();
    const empty = setup({ activeDocument: null, projectIdRef: { current: "" } });
    expect(empty.ctx.setAssistantDiagnostics).toHaveBeenCalledWith([]);
    expect(empty.ctx.setPdfComplianceDiagnostics).toHaveBeenCalledWith([]);
  });
});
