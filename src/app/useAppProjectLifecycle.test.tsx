import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeProductEvents } from "../features/onboarding/core/ProductEvents";
import { toolTabIds } from "../features/workspace/toolTabs";
import type { CompileResult, OpenDocument, ProjectEntry } from "../types";
import type { AppCtx03 } from "./appContext";
import { useAppProjectLifecycle } from "./useAppProjectLifecycle";

type Setter = ReturnType<typeof vi.fn>;

function doc(relativePath: string, content = "x", savedContent = content, extra = {}) {
  return {
    path: `/p/${relativePath}`,
    relativePath,
    name: relativePath.split("/").pop()!,
    content,
    savedContent,
    ...extra,
  } as OpenDocument;
}

function file(relativePath: string): ProjectEntry {
  return {
    type: "file",
    path: `/p/${relativePath}`,
    relativePath,
    name: relativePath.split("/").pop()!,
  } as ProjectEntry;
}

const ref = <T,>(current: T) => ({ current });

/** Context with real refs; every `set*` records calls and applies updater functions. */
function makeCtx(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    documents: [],
    compileJobCount: 0,
    panelHeight: 100,
  };
  const base: Record<string, unknown> = {
    activeDocument: null,
    activePathRef: ref(""),
    allProjectEntries: [],
    autoCompileSignature: "sig",
    browserAutoOpenRef: ref(false),
    collaborationState: { enabled: false, token: "" },
    closedTabPathsRef: ref<string[]>([]),
    compileRunIdRef: ref(0),
    compiling: false,
    currentUserRole: "owner",
    documents: [],
    documentsRef: ref<OpenDocument[]>([]),
    editorPathBeforeWelcomeRef: ref(""),
    engineRef: ref("pdflatex"),
    ensurePreambleMacros: vi.fn((content: string) => `%macros\n${content}`),
    gitDiffReturnPathRef: ref(""),
    gitDiffSessionIdRef: ref("s"),
    gitDiffSessionRef: ref<unknown>(null),
    gitFileHistoryPathRef: ref("h"),
    hasVisibleProject: true,
    hideProjectEntriesRef: ref(false),
    lastAutoCompileSignatureRef: ref(""),
    legalAcceptanceRequired: true,
    loadReviewData: vi.fn(async () => undefined),
    reviewDataReadyRef: ref(false),
    openDocument: vi.fn(async () => undefined),
    pdfPathRef: ref(""),
    projectIdRef: ref(""),
    projectPathRef: ref(""),
    realtimeBlockedDocumentsRef: ref<Record<string, string>>({}),
    reopenClosedTabArmedRef: ref(false),
    realtimeReadyDocumentsRef: ref(new Set<string>()),
    refreshProject: vi.fn(async () => undefined),
    rootFile: "main.tex",
    rootFileExists: true,
    rootFileRef: ref("main.tex"),
    saveDocumentsForCompile: vi.fn(async () => undefined),
    scheduleGitRefreshRef: ref(vi.fn()),
    settings: { livePreview: false },
    settingsRef: ref({}),
    showBlankWorkspace: false,
    showWelcome: false,
    standalonePdfReviewActiveRef: ref(false),
    welcomeOpen: false,
    ...overrides,
  };
  const setters: Record<string, Setter> = {};
  const ctx = new Proxy(base, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key.startsWith("set")) {
        setters[key] ??= vi.fn((value: unknown) => {
          const name = key[3].toLowerCase() + key.slice(4);
          state[name] =
            typeof value === "function"
              ? (value as (previous: unknown) => unknown)(state[name])
              : value;
        });
        return setters[key];
      }
      return undefined;
    },
  });
  return {
    ctx: ctx as any,
    setters: new Proxy(setters, { get: (t, k: string) => (ctx as any)[k] }) as Record<
      string,
      Setter
    >,
    state,
  };
}

function mount(ctx: unknown) {
  return renderHook(({ c }) => useAppProjectLifecycle(c as AppCtx03), {
    initialProps: { c: ctx },
  });
}

function stubLatexdo(api: Record<string, unknown> = {}) {
  (window as any).latexdo = {
    readFile: vi.fn(async () => "file content"),
    writeFile: vi.fn(async () => undefined),
    listProject: vi.fn(async () => []),
    compile: vi.fn(),
    compileAsymptote: vi.fn(),
    readPdf: vi.fn(async () => new Uint8Array([1, 2]).buffer),
    cancelCompile: vi.fn(async () => true),
    openProject: vi.fn(async () => null),
    restoreCloudProject: vi.fn(async () => null),
    ...api,
  };
  return (window as any).latexdo;
}

const okResult = (extra: Partial<CompileResult> = {}): CompileResult =>
  ({
    ok: true,
    pdfPath: "/build/main.pdf",
    durationMs: 1500,
    output: "",
    diagnostics: [],
    ...extra,
  }) as CompileResult;

let events: string[];
let unsubscribe: () => void;
let originalLatexdo: unknown;

beforeEach(() => {
  originalLatexdo = (window as any).latexdo;
  events = [];
  unsubscribe = subscribeProductEvents((event) => events.push(event.type));
  stubLatexdo();
});

afterEach(() => {
  unsubscribe();
  (window as any).latexdo = originalLatexdo;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("loadProject", () => {
  it("resets workspace state and opens main.tex", async () => {
    const api = stubLatexdo({
      listProject: vi.fn(async () => [
        file("intro.tex"),
        {
          type: "directory",
          name: "sub",
          path: "/p/sub",
          relativePath: "sub",
          children: [file("sub/main.tex")],
        },
        file("main.tex"),
      ]),
    });
    const { ctx, setters } = makeCtx();
    const { result } = mount(ctx);
    await act(() =>
      result.current.loadProject(
        { id: "p1", rootPath: "/home/me/paper", name: "" } as any,
        true,
      ),
    );
    expect(ctx.projectIdRef.current).toBe("p1");
    expect(setters.setProjectDisplayName).toHaveBeenCalledWith("paper");
    expect(setters.setActiveResearchSpace).toHaveBeenCalledWith(null);
    expect(api.listProject).toHaveBeenCalledWith("p1", expect.any(Object));
    expect(ctx.loadReviewData).toHaveBeenCalledWith("p1");
    expect(ctx.rootFileRef.current).toBe("main.tex");
    expect(ctx.openDocument).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: "main.tex" }),
      "p1",
    );
    expect(setters.setStatusMessage).toHaveBeenLastCalledWith("Ready");
  });

  it("falls back to the first .tex file and reports limited trees", async () => {
    stubLatexdo({
      listProject: vi.fn(async () => [
        file("notes.md"),
        file("paper.tex"),
        {
          ...file("big"),
          type: "directory",
          children: [{ ...file("big/x"), limited: true }],
        },
      ]),
    });
    const { ctx, setters } = makeCtx();
    const { result } = mount(ctx);
    await act(() =>
      result.current.loadProject({
        id: "p",
        rootPath: "/",
        name: "",
        researchSpace: { id: "r" },
      } as any),
    );
    expect(setters.setProjectDisplayName).toHaveBeenCalledWith("Project");
    expect(setters.setActiveResearchSpace).toHaveBeenCalledWith({ id: "r" });
    expect(ctx.rootFileRef.current).toBe("paper.tex");
    expect(ctx.openDocument).not.toHaveBeenCalled();
    expect(setters.setStatusMessage).toHaveBeenLastCalledWith(
      "Project tree was limited. Adjust tree limits in Settings.",
    );
  });

  it("keeps the root file when the project has no TeX source", async () => {
    const { ctx, setters } = makeCtx();
    const { result } = mount(ctx);
    await act(() =>
      result.current.loadProject(
        { id: "p", rootPath: "/x/y", name: "Named" } as any,
        true,
        true,
      ),
    );
    expect(setters.setProjectDisplayName).toHaveBeenCalledWith("Named");
    expect(setters.setHideProjectEntries).toHaveBeenCalledWith(true);
    expect(setters.setRootFile).not.toHaveBeenCalled();
  });
});

describe("automatic project open", () => {
  it("does nothing until legal terms are accepted or on unknown runtimes", () => {
    const api = stubLatexdo({ runtime: "browser" });
    mount(makeCtx().ctx);
    stubLatexdo({ runtime: "other" });
    mount(makeCtx({ legalAcceptanceRequired: false }).ctx);
    expect(api.openProject).not.toHaveBeenCalled();
  });

  it("opens the browser workspace project once", async () => {
    const api = stubLatexdo({
      runtime: "browser",
      openProject: vi.fn(async () => ({ id: "b", rootPath: "/b", name: "B" })),
    });
    const { ctx } = makeCtx({ legalAcceptanceRequired: false });
    const { rerender } = mount(ctx);
    await waitFor(() => expect(ctx.projectIdRef.current).toBe("b"));
    rerender({ c: ctx });
    expect(api.openProject).toHaveBeenCalledTimes(1);
  });

  it("on desktop prefers a requested project, then cloud, then the last project", async () => {
    const reopenLastProject = vi.fn(async () => ({
      id: "last",
      rootPath: "/l",
      name: "L",
    }));
    stubLatexdo({
      runtime: "desktop",
      openRequestedProject: vi.fn(async () => null),
      restoreCloudProject: vi.fn(async () => null),
      reopenLastProject,
    });
    const { ctx } = makeCtx({ legalAcceptanceRequired: false });
    mount(ctx);
    await waitFor(() => expect(ctx.projectIdRef.current).toBe("last"));
  });

  it("starts an explicitly new desktop window without restoring another project", () => {
    const api = stubLatexdo({
      runtime: "desktop",
      startWithEmptyWorkspace: true,
      openRequestedProject: vi.fn(),
      reopenLastProject: vi.fn(),
    });
    const { ctx } = makeCtx({ legalAcceptanceRequired: false });
    mount(ctx);
    expect(api.openRequestedProject).not.toHaveBeenCalled();
    expect(api.restoreCloudProject).not.toHaveBeenCalled();
    expect(api.reopenLastProject).not.toHaveBeenCalled();
    expect(ctx.projectIdRef.current).toBe("");
  });

  it("handles desktops without optional open APIs and nothing to restore", async () => {
    const api = stubLatexdo({ runtime: "desktop" });
    const { ctx } = makeCtx({ legalAcceptanceRequired: false });
    mount(ctx);
    await waitFor(() => expect(api.restoreCloudProject).toHaveBeenCalled());
    expect(ctx.projectIdRef.current).toBe("");
  });

  it("skips loading while a standalone PDF review is active", async () => {
    const api = stubLatexdo({
      runtime: "cloud",
      openProject: vi.fn(async () => ({ id: "c", rootPath: "/c" })),
    });
    const { ctx } = makeCtx({
      legalAcceptanceRequired: false,
      standalonePdfReviewActiveRef: ref(true),
    });
    mount(ctx);
    await waitFor(() => expect(api.openProject).toHaveBeenCalled());
    expect(api.listProject).not.toHaveBeenCalled();
  });

  it("reports open failures", async () => {
    stubLatexdo({
      runtime: "browser",
      openProject: vi.fn(async () => Promise.reject(new Error("nope"))),
    });
    const first = makeCtx({ legalAcceptanceRequired: false });
    mount(first.ctx);
    await waitFor(() =>
      expect(first.setters.setStatusMessage).toHaveBeenCalledWith("nope"),
    );

    stubLatexdo({
      runtime: "browser",
      openProject: vi.fn(async () => Promise.reject("bad")),
    });
    const second = makeCtx({ legalAcceptanceRequired: false });
    mount(second.ctx);
    await waitFor(() =>
      expect(second.setters.setStatusMessage).toHaveBeenCalledWith(
        "Could not open the browser workspace.",
      ),
    );
  });
});

describe("hook API", () => {
  it("exposes the project lifecycle actions", () => {
    const { result } = mount(makeCtx().ctx);
    expect(Object.keys(result.current).sort()).toEqual([
      "cancelCompile",
      "closeActiveTab",
      "compile",
      "compileEntry",
      "downloadPdf",
      "loadProject",
      "saveActiveAndCompile",
      "saveDocument",
    ]);
  });
});

describe("saveDocument", () => {
  it("ignores calls without a project and preview documents", async () => {
    const api = stubLatexdo();
    const { ctx, setters } = makeCtx();
    const { result } = mount(ctx);
    await act(() => result.current.saveDocument(doc("a.tex")));
    ctx.projectIdRef.current = "p";
    await act(() =>
      result.current.saveDocument(doc("fig.png", "", "", { kind: "image" })),
    );
    expect(api.writeFile).not.toHaveBeenCalled();
    expect(setters.setStatusMessage).toHaveBeenCalledWith(
      "fig.png is a preview and does not need saving.",
    );
  });

  it("writes the document and marks only that content as saved", async () => {
    const api = stubLatexdo();
    const a = doc("a.tex", "new", "old");
    const b = doc("b.tex", "b2", "b1");
    const { ctx, setters, state } = makeCtx();
    ctx.projectIdRef.current = "p";
    state.documents = [a, b];
    const { result } = mount(ctx);
    await act(() => result.current.saveDocument(a));
    expect(api.writeFile).toHaveBeenCalledWith("p", "a.tex", "new");
    expect((state.documents as OpenDocument[]).map((d) => d.savedContent)).toEqual([
      "new",
      "b1",
    ]);
    expect(ctx.documentsRef.current).toBe(state.documents);
    expect(ctx.scheduleGitRefreshRef.current).toHaveBeenCalled();
    expect(setters.setStatusMessage).toHaveBeenCalledWith("Saved a.tex");
  });

  it("guards saves during collaboration", async () => {
    const api = stubLatexdo();
    const collab = { collaborationState: { enabled: true, token: "t" } };
    const viewer = makeCtx({ ...collab, currentUserRole: "viewer" });
    viewer.ctx.projectIdRef.current = "p";
    await expect(
      mount(viewer.ctx).result.current.saveDocument(doc("a.tex")),
    ).rejects.toThrow("Viewer access cannot save changes.");

    const blocked = makeCtx({
      ...collab,
      realtimeBlockedDocumentsRef: ref({ "a.tex": "Locked by X" }),
    });
    blocked.ctx.projectIdRef.current = "p";
    await expect(
      mount(blocked.ctx).result.current.saveDocument(doc("a.tex")),
    ).rejects.toThrow("Locked by X");

    const syncing = makeCtx(collab);
    syncing.ctx.projectIdRef.current = "p";
    await expect(
      mount(syncing.ctx).result.current.saveDocument(doc("a.tex")),
    ).rejects.toThrow("Wait for secure collaboration sync before saving.");

    const ready = makeCtx({
      ...collab,
      realtimeReadyDocumentsRef: ref(new Set(["a.tex"])),
    });
    ready.ctx.projectIdRef.current = "p";
    await mount(ready.ctx).result.current.saveDocument(doc("a.tex"));
    expect(api.writeFile).toHaveBeenCalledTimes(1);
  });
});

describe("compile", () => {
  it("refuses without a project or while entries are hidden", async () => {
    const { ctx, setters } = makeCtx();
    const { result } = mount(ctx);
    expect(await result.current.compile()).toBeNull();
    ctx.projectIdRef.current = "p";
    ctx.hideProjectEntriesRef.current = true;
    expect(await result.current.compile()).toBeNull();
    expect(setters.setStatusMessage).toHaveBeenCalledWith(
      "Create or open a project before compiling.",
    );
    expect(events).toEqual(["compile:failed", "compile:failed"]);
  });

  it("saves dirty documents, compiles and loads the PDF", async () => {
    const api = stubLatexdo({ compile: vi.fn(async () => okResult()) });
    const dirty = doc("main.tex", "new", "old");
    const clean = doc("b.tex");
    const { ctx, setters, state } = makeCtx();
    ctx.projectIdRef.current = "p";
    ctx.documentsRef.current = [dirty, clean];
    const { result } = mount(ctx);
    const compiled = await act(() => result.current.compile());
    expect(compiled?.ok).toBe(true);
    expect(ctx.saveDocumentsForCompile).toHaveBeenCalledWith("p", [dirty]);
    expect(api.compile).toHaveBeenCalledWith({
      projectId: "p",
      rootFile: "main.tex",
      engine: "pdflatex",
    });
    expect(ctx.lastAutoCompileSignatureRef.current).not.toBe("");
    expect(ctx.pdfPathRef.current).toBe("/build/main.pdf");
    expect(setters.setPdfData).toHaveBeenCalledWith(new Uint8Array([1, 2]));
    expect(setters.setPreviewVisible).toHaveBeenCalledWith(true);
    expect(setters.setCompileProgress).toHaveBeenLastCalledWith(100);
    expect(setters.setStatusMessage).toHaveBeenLastCalledWith(
      "Built successfully in 1.5 s",
    );
    expect(state.compileJobCount).toBe(0);
    expect(events).toEqual(["compile:succeeded"]);
  });

  it("compiles the active Asymptote file, saving it first when dirty", async () => {
    const api = stubLatexdo({
      compileAsymptote: vi.fn(async () =>
        okResult({ pdfPath: "/b/fig.pdf", durationMs: 20 }),
      ),
    });
    const asy = doc("fig.asy", "draw()", "old");
    const other = doc("main.tex");
    const { ctx, setters, state } = makeCtx();
    ctx.projectIdRef.current = "p";
    ctx.documentsRef.current = [asy, other];
    state.documents = [asy, other];
    ctx.activePathRef.current = asy.path;
    const { result } = mount(ctx);
    await act(() => result.current.compile());
    expect(api.writeFile).toHaveBeenCalledWith("p", "fig.asy", "draw()");
    expect((state.documents as OpenDocument[])[0].savedContent).toBe("draw()");
    expect(api.compileAsymptote).toHaveBeenCalledWith({
      projectId: "p",
      relativePath: "fig.asy",
    });
    expect(setters.setStatusMessage).toHaveBeenCalledWith(
      "Compiling fig.asy with Asymptote...",
    );
    expect(setters.setStatusMessage).toHaveBeenLastCalledWith(
      expect.stringMatching(/^Built fig\.asy in /),
    );

    api.writeFile.mockClear();
    ctx.documentsRef.current = [doc("fig.asy")];
    await act(() => result.current.compile());
    expect(api.writeFile).not.toHaveBeenCalled();
  });

  it("opens the problems or output panel on failure", async () => {
    const failing = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        durationMs: 1,
        output: "",
        diagnostics: [{ code: "missing-latex-toolchain" }],
        error: "no latexmk",
      })
      .mockResolvedValueOnce({ ok: false, durationMs: 1, output: "", diagnostics: [] })
      .mockResolvedValueOnce({ ok: true, durationMs: 1, output: "", diagnostics: [] });
    stubLatexdo({ compile: failing });
    const { ctx, setters, state } = makeCtx();
    ctx.projectIdRef.current = "p";
    ctx.pdfPathRef.current = "/old.pdf";
    const { result } = mount(ctx);
    await act(() => result.current.compile());
    expect(setters.setActivePanel).toHaveBeenLastCalledWith("problems");
    expect(state.panelHeight).toBe(300);
    expect(setters.setStatusMessage).toHaveBeenLastCalledWith("no latexmk");
    expect(ctx.pdfPathRef.current).toBe("");

    await act(() => result.current.compile());
    expect(setters.setActivePanel).toHaveBeenLastCalledWith("output");
    expect(setters.setStatusMessage).toHaveBeenLastCalledWith("Compilation failed");

    // ok without a PDF path is also treated as a failure for the preview.
    await act(() => result.current.compile());
    expect(setters.setPanelVisible).toHaveBeenCalledTimes(3);
    expect(events).toEqual(["compile:failed", "compile:failed", "compile:succeeded"]);
  });

  it("ignores stale results from an older compile", async () => {
    let finish!: (result: CompileResult) => void;
    stubLatexdo({ compile: vi.fn(() => new Promise((resolve) => (finish = resolve))) });
    const { ctx, setters } = makeCtx();
    ctx.projectIdRef.current = "p";
    const { result } = mount(ctx);
    const pending = result.current.compile();
    await waitFor(() => expect(finish).toBeDefined());
    ctx.compileRunIdRef.current += 1;
    finish(okResult());
    await pending;
    expect(setters.setCompileResult).not.toHaveBeenCalled();
    expect(ctx.pdfPathRef.current).toBe("");

    let fail!: (result: CompileResult) => void;
    (window as any).latexdo.compile = vi.fn(
      () => new Promise((resolve) => (fail = resolve)),
    );
    const second = result.current.compile();
    await waitFor(() => expect(fail).toBeDefined());
    ctx.compileRunIdRef.current += 1;
    fail({ ok: false, durationMs: 0, output: "", diagnostics: [] } as any);
    await second;
    expect(setters.setPanelVisible).not.toHaveBeenCalled();
  });

  it("reports thrown compile errors only for the latest run", async () => {
    stubLatexdo({ compile: vi.fn(async () => Promise.reject(new Error("crashed"))) });
    const { ctx, setters, state } = makeCtx();
    ctx.projectIdRef.current = "p";
    const { result } = mount(ctx);
    expect(await act(() => result.current.compile())).toBeNull();
    expect(setters.setStatusMessage).toHaveBeenLastCalledWith("crashed");
    expect(setters.setActivePanel).toHaveBeenLastCalledWith("output");

    (window as any).latexdo.compile = vi.fn(async () => Promise.reject("weird"));
    await act(() => result.current.compile());
    expect(setters.setStatusMessage).toHaveBeenLastCalledWith("Compilation failed");

    let reject!: (error: unknown) => void;
    (window as any).latexdo.compile = vi.fn(
      () => new Promise((_r, rj) => (reject = rj)),
    );
    setters.setStatusMessage.mockClear();
    const pending = result.current.compile();
    await waitFor(() => expect(reject).toBeDefined());
    ctx.compileRunIdRef.current += 1;
    reject(new Error("late"));
    await pending;
    expect(setters.setStatusMessage).not.toHaveBeenCalledWith("late");
    expect(state.compileJobCount).toBe(0);
  });
});

describe("cancelCompile", () => {
  it("only cancels a running compile", async () => {
    const api = stubLatexdo();
    const idle = makeCtx();
    idle.ctx.projectIdRef.current = "p";
    await mount(idle.ctx).result.current.cancelCompile();
    expect(api.cancelCompile).not.toHaveBeenCalled();

    const running = makeCtx({ compiling: true });
    await mount(running.ctx).result.current.cancelCompile();
    expect(api.cancelCompile).not.toHaveBeenCalled();
    running.ctx.projectIdRef.current = "p";
    const { result } = mount(running.ctx);
    await act(() => result.current.cancelCompile());
    expect(running.ctx.compileRunIdRef.current).toBe(1);
    expect(running.setters.setStatusMessage).toHaveBeenLastCalledWith(
      "Canceling compile...",
    );
    api.cancelCompile.mockResolvedValueOnce(false);
    await act(() => result.current.cancelCompile());
    expect(running.setters.setStatusMessage).toHaveBeenLastCalledWith(
      "No active compile to cancel.",
    );
    api.cancelCompile.mockRejectedValueOnce(new Error("ipc down"));
    await act(() => result.current.cancelCompile());
    expect(running.setters.setStatusMessage).toHaveBeenLastCalledWith("ipc down");
    api.cancelCompile.mockRejectedValueOnce(42);
    await act(() => result.current.cancelCompile());
    expect(running.setters.setStatusMessage).toHaveBeenLastCalledWith(
      "Could not cancel compile.",
    );
  });
});

describe("saveActiveAndCompile", () => {
  it("saves the active document before compiling", async () => {
    const api = stubLatexdo({
      compile: vi.fn(async () => okResult({ pdfPath: undefined })),
    });
    const active = doc("main.tex", "n", "o");
    const { ctx } = makeCtx();
    ctx.projectIdRef.current = "p";
    ctx.documentsRef.current = [active];
    const { result } = mount(ctx);
    await act(() => result.current.saveActiveAndCompile());
    expect(api.writeFile).not.toHaveBeenCalled();
    expect(api.compile).toHaveBeenCalledTimes(1);
    ctx.activePathRef.current = active.path;
    await act(() => result.current.saveActiveAndCompile());
    expect(api.writeFile).toHaveBeenCalledWith("p", "main.tex", "n");
    expect(api.compile).toHaveBeenCalledTimes(2);
  });
});

describe("closeActiveTab", () => {
  it.each([
    ["tikzCanvas", "setTikzCanvasOpen", false],
    ["tikzConverter", "setTikzConverterOpen", false],
    ["tableGenerator", "setTableCanvasOpen", false],
    ["notationManager", "setNotationManagerOpen", false],
    ["citationManager", "setCitationManagerOpen", false],
    ["extensionDetails", "setExtensionDetailsId", ""],
  ] as const)("closes the %s tool tab", (key, setter, value) => {
    const { ctx, setters } = makeCtx();
    ctx.activePathRef.current = toolTabIds[key];
    mount(ctx).result.current.closeActiveTab();
    expect(setters[setter]).toHaveBeenCalledWith(value);
    expect(setters.setDocuments).not.toHaveBeenCalled();
  });

  it("closes a document and activates its neighbour", () => {
    const [a, b, c] = [doc("a.tex"), doc("b.tex"), doc("c.tex")];
    const { ctx, setters } = makeCtx();
    ctx.documentsRef.current = [a, b, c];
    ctx.activePathRef.current = c.path;
    const { result } = mount(ctx);
    result.current.closeActiveTab();
    expect(ctx.documentsRef.current).toEqual([a, b]);
    expect(ctx.activePathRef.current).toBe(b.path);
    expect(ctx.closedTabPathsRef.current).toEqual([c.path]);
    expect(ctx.reopenClosedTabArmedRef.current).toBe(true);
    expect(setters.setStatusMessage).toHaveBeenLastCalledWith("Closed c.tex");

    // A path with no open document closes nothing and keeps the remaining tabs.
    ctx.documentsRef.current = [a];
    ctx.activePathRef.current = "/p/ghost.tex";
    result.current.closeActiveTab();
    expect(ctx.documentsRef.current).toEqual([a]);
    expect(ctx.activePathRef.current).toBe("");
    expect(setters.setStatusMessage).toHaveBeenLastCalledWith("Closed active tab");

    ctx.documentsRef.current = [];
    ctx.activePathRef.current = "/p/ghost.tex";
    result.current.closeActiveTab();
    expect(ctx.activePathRef.current).toBe("");
  });

  it("asks before closing unsaved documents", () => {
    const dirty = doc("a.tex", "new", "old");
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const { ctx } = makeCtx();
    ctx.documentsRef.current = [dirty];
    ctx.activePathRef.current = dirty.path;
    const { result } = mount(ctx);
    result.current.closeActiveTab();
    expect(confirm).toHaveBeenCalledWith("Close a.tex without saving?");
    expect(ctx.documentsRef.current).toEqual([dirty]);
    result.current.closeActiveTab();
    expect(ctx.documentsRef.current).toEqual([]);
  });

  it("closes a diff tab, returning to the previous document", () => {
    const [a, b] = [doc("a.tex"), doc("b.tex")];
    const { ctx, setters } = makeCtx();
    ctx.documentsRef.current = [a, b];
    ctx.gitDiffSessionRef.current = { id: "d" };
    ctx.gitDiffReturnPathRef.current = b.path;
    const { result } = mount(ctx);
    result.current.closeActiveTab();
    expect(ctx.gitDiffSessionRef.current).toBeNull();
    expect(ctx.gitDiffSessionIdRef.current).toBe("");
    expect(setters.setGitBlameLines).toHaveBeenCalledWith([]);
    expect(ctx.activePathRef.current).toBe(b.path);
    expect(setters.setStatusMessage).toHaveBeenLastCalledWith("Closed diff tab");

    ctx.activePathRef.current = "";
    ctx.gitDiffSessionRef.current = { id: "d" };
    ctx.gitDiffReturnPathRef.current = "/p/gone.tex";
    result.current.closeActiveTab();
    expect(ctx.activePathRef.current).toBe(a.path);

    ctx.activePathRef.current = "";
    ctx.documentsRef.current = [];
    ctx.gitDiffSessionRef.current = { id: "d" };
    result.current.closeActiveTab();
    expect(ctx.activePathRef.current).toBe("");
  });

  it("closes Welcome back to the previous editor, or an empty workspace", () => {
    const [a, b] = [doc("a.tex"), doc("b.tex")];
    const { ctx, setters } = makeCtx({ welcomeOpen: true });
    ctx.documentsRef.current = [a, b];
    ctx.gitDiffSessionRef.current = { id: "kept" };
    ctx.editorPathBeforeWelcomeRef.current = b.path;
    const { result } = mount(ctx);
    result.current.closeActiveTab();
    expect(setters.setWelcomeOpen).toHaveBeenCalledWith(false);
    expect(ctx.activePathRef.current).toBe(b.path);
    expect(ctx.gitDiffSessionRef.current).toEqual({ id: "kept" });

    ctx.activePathRef.current = "";
    ctx.editorPathBeforeWelcomeRef.current = "/p/gone";
    result.current.closeActiveTab();
    expect(ctx.activePathRef.current).toBe(a.path);

    ctx.activePathRef.current = "";
    ctx.documentsRef.current = [];
    result.current.closeActiveTab();
    expect(ctx.activePathRef.current).toBe("");

    ctx.hideProjectEntriesRef.current = true;
    result.current.closeActiveTab();
    expect(setters.setPreviewVisible).toHaveBeenCalledWith(false);
    expect(setters.setStatusMessage).toHaveBeenLastCalledWith("Closed Welcome");
  });

  it("does nothing with no tab, diff or Welcome", () => {
    const { ctx, setters } = makeCtx();
    mount(ctx).result.current.closeActiveTab();
    expect(setters.setStatusMessage).not.toHaveBeenCalled();
  });
});

describe("downloadPdf", () => {
  function captureDownloads() {
    const clicks: Array<{ href: string; download: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ href: this.href, download: this.download });
    });
    const revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:pdf"),
        revokeObjectURL: revoke,
      }),
    );
    return { clicks, revoke };
  }

  it("does nothing without a project or a root file", async () => {
    const api = stubLatexdo();
    const { result } = mount(makeCtx().ctx);
    await result.current.downloadPdf();
    const noRoot = makeCtx({ rootFileExists: false });
    noRoot.ctx.projectIdRef.current = "p";
    await mount(noRoot.ctx).result.current.downloadPdf();
    expect(api.readPdf).not.toHaveBeenCalled();
  });

  it("downloads the existing PDF of a clean project", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const api = stubLatexdo();
    const { clicks, revoke } = captureDownloads();
    const { ctx, setters } = makeCtx();
    ctx.projectIdRef.current = "p";
    ctx.pdfPathRef.current = "/b/main.pdf";
    ctx.rootFileRef.current = "chapters/Main.TEX";
    ctx.documentsRef.current = [doc("main.tex")];
    await mount(ctx).result.current.downloadPdf();
    expect(api.compile).not.toHaveBeenCalled();
    expect(api.readPdf).toHaveBeenCalledWith("p", "/b/main.pdf");
    expect(clicks).toEqual([{ href: "blob:pdf", download: "Main.pdf" }]);
    expect(document.querySelector("a[download]")).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith("blob:pdf");
    expect(setters.setStatusMessage).toHaveBeenLastCalledWith("Downloaded Main.pdf");
  });

  it("compiles first when the source is dirty or no PDF exists", async () => {
    const api = stubLatexdo({
      compile: vi.fn(async () => okResult({ pdfPath: "/b/new.pdf" })),
    });
    const { clicks } = captureDownloads();
    const { ctx } = makeCtx();
    ctx.projectIdRef.current = "p";
    ctx.pdfPathRef.current = "/b/old.pdf";
    ctx.documentsRef.current = [doc("main.tex", "a", "b")];
    const { result } = mount(ctx);
    await act(() => result.current.downloadPdf());
    expect(api.compile).toHaveBeenCalled();
    expect(api.readPdf).toHaveBeenLastCalledWith("p", "/b/new.pdf");
    expect(clicks).toHaveLength(1);
  });

  it("asks for a successful compile when there is no PDF", async () => {
    stubLatexdo({
      compile: vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          durationMs: 0,
          output: "",
          diagnostics: [],
        })
        .mockResolvedValueOnce(okResult({ pdfPath: undefined })),
    });
    const { ctx, setters } = makeCtx();
    ctx.projectIdRef.current = "p";
    const { result } = mount(ctx);
    await act(() => result.current.downloadPdf());
    expect(setters.setStatusMessage).toHaveBeenLastCalledWith(
      "Compile successfully before downloading the PDF",
    );
    await act(() => result.current.downloadPdf());
    expect(setters.setStatusMessage).toHaveBeenLastCalledWith(
      "Compile successfully before downloading the PDF",
    );
    ctx.hideProjectEntriesRef.current = true;
    await act(() => result.current.downloadPdf());
    expect(setters.setStatusMessage).toHaveBeenLastCalledWith(
      "Compile successfully before downloading the PDF",
    );
  });

  it("downloads an active Asymptote figure even without a root file", async () => {
    stubLatexdo();
    const { clicks } = captureDownloads();
    const asy = doc("figs/Plot.ASY".replace("ASY", "asy"));
    const { ctx } = makeCtx({ rootFileExists: false });
    ctx.projectIdRef.current = "p";
    ctx.pdfPathRef.current = "/b/plot.pdf";
    ctx.documentsRef.current = [asy];
    ctx.activePathRef.current = asy.path;
    await mount(ctx).result.current.downloadPdf();
    expect(clicks[0].download).toBe("Plot.pdf");
  });

  it("reports read failures", async () => {
    const api = stubLatexdo();
    const { ctx, setters } = makeCtx();
    ctx.projectIdRef.current = "p";
    ctx.pdfPathRef.current = "/b/main.pdf";
    api.readPdf.mockRejectedValueOnce(new Error("disk"));
    const { result } = mount(ctx);
    await result.current.downloadPdf();
    expect(setters.setStatusMessage).toHaveBeenLastCalledWith("disk");
    api.readPdf.mockRejectedValueOnce("??");
    await result.current.downloadPdf();
    expect(setters.setStatusMessage).toHaveBeenLastCalledWith(
      "Could not download the PDF",
    );
  });
});

describe("compileEntry", () => {
  it("compiles TeX files as the new main file", async () => {
    const api = stubLatexdo({ compile: vi.fn(async () => okResult()) });
    const { ctx, setters } = makeCtx();
    ctx.projectIdRef.current = "p";
    const { result } = mount(ctx);
    await act(() => result.current.compileEntry(file("notes.md")));
    await act(() =>
      result.current.compileEntry({
        ...file("dir.tex"),
        type: "directory",
      } as ProjectEntry),
    );
    expect(api.compile).not.toHaveBeenCalled();
    await act(() => result.current.compileEntry(file("ch/other.tex")));
    expect(ctx.rootFileRef.current).toBe("ch/other.tex");
    expect(setters.setWelcomeOpen).toHaveBeenCalledWith(false);
    expect(setters.setStatusMessage).toHaveBeenCalledWith(
      "Using ch/other.tex as the main file",
    );
    expect(api.compile).toHaveBeenCalledWith(
      expect.objectContaining({ rootFile: "ch/other.tex" }),
    );
  });
});

describe("live preview", () => {
  const live = (overrides: Record<string, unknown> = {}) =>
    makeCtx({
      settings: { livePreview: true },
      activeDocument: doc("main.tex"),
      documents: [doc("main.tex", "new", "old")],
      ...overrides,
    });

  it("compiles dirty documents after a short delay", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const api = stubLatexdo({
      compile: vi.fn(async () => okResult({ pdfPath: undefined })),
    });
    const { ctx } = live();
    ctx.projectIdRef.current = "p";
    const { rerender } = mount(ctx);
    expect(api.compile).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(api.compile).toHaveBeenCalledTimes(1);
    rerender({ c: ctx });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(api.compile).toHaveBeenCalledTimes(1);
  });

  it("cancels the pending compile when inputs change", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const api = stubLatexdo();
    const first = live();
    const { rerender } = mount(first.ctx);
    rerender({ c: live({ compiling: true }).ctx });
    vi.advanceTimersByTime(500);
    expect(api.compile).not.toHaveBeenCalled();
  });

  it.each([
    { hasVisibleProject: false },
    { settings: { livePreview: false } },
    { activeDocument: null },
    { rootFileExists: false },
    { documents: [doc("main.tex")] },
    { compiling: true },
    { showWelcome: true },
    { showBlankWorkspace: true },
    { lastAutoCompileSignatureRef: ref("sig") },
  ])("does not auto-compile when %o", (overrides) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const api = stubLatexdo();
    mount(live(overrides).ctx);
    vi.advanceTimersByTime(500);
    expect(api.compile).not.toHaveBeenCalled();
  });
});
