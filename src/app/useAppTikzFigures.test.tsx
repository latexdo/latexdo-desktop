import { act, renderHook, waitFor } from "@testing-library/react";
import * as monacoApi from "monaco-editor";
import type * as Monaco from "monaco-editor";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toolTabIds } from "../features/workspace/toolTabs";
import { setMonaco, type MonacoNamespace } from "./appShared";
import type { AppCtx10 } from "./appContext";
import { useAppTikzFigures } from "./useAppTikzFigures";

type Pos = { lineNumber: number; column: number };

/** A small text model with Monaco's offset and position arithmetic. */
function makeModel(path: string, initial: string) {
  let value = initial;
  const getPositionAt = (offset: number): Pos => {
    const clamped = Math.max(0, Math.min(offset, value.length));
    const before = value.slice(0, clamped).split("\n");
    return { lineNumber: before.length, column: before.at(-1)!.length + 1 };
  };
  const getOffsetAt = ({ lineNumber, column }: Pos) => {
    const lines = value.split("\n");
    let offset = 0;
    for (let i = 0; i < lineNumber - 1 && i < lines.length; i++) offset += lines[i].length + 1;
    return Math.min(offset + column - 1, value.length);
  };
  return {
    uri: monacoApi.Uri.file(path),
    getValue: () => value,
    setValue: (next: string) => {
      value = next;
    },
    getPositionAt,
    getOffsetAt,
    validatePosition: (position: Pos) => getPositionAt(getOffsetAt(position)),
  };
}

type FakeModel = ReturnType<typeof makeModel>;

function makeEditor(model: FakeModel | null) {
  let position: Pos | null = null;
  let selection: Monaco.Selection | null = null;
  const editor = {
    model,
    getModel: () => editor.model,
    getPosition: vi.fn(() => position),
    setPosition: vi.fn((next: Pos) => {
      position = next;
    }),
    getSelection: vi.fn(() => selection),
    setSelection: vi.fn((next: Monaco.Selection) => {
      selection = next;
    }),
    saveViewState: vi.fn(() => ({ saved: true })),
    restoreViewState: vi.fn(),
    pushUndoStop: vi.fn(),
    focus: vi.fn(),
    revealRangeInCenterIfOutsideViewport: vi.fn(),
    executeEdits: vi.fn(
      (_source: string, edits: Array<{ range: Monaco.IRange; text: string }>) => {
        const m = editor.model!;
        const resolved = edits
          .map((edit) => ({
            start: m.getOffsetAt({
              lineNumber: edit.range.startLineNumber,
              column: edit.range.startColumn,
            }),
            end: m.getOffsetAt({
              lineNumber: edit.range.endLineNumber,
              column: edit.range.endColumn,
            }),
            text: edit.text,
          }))
          .sort((a, b) => b.start - a.start);
        let text = m.getValue();
        for (const edit of resolved)
          text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
        m.setValue(text);
        return true;
      },
    ),
    setCursor(next: Pos | null) {
      position = next;
    },
    select(next: Monaco.Selection | null) {
      selection = next;
    },
  };
  return editor;
}

type FakeEditor = ReturnType<typeof makeEditor>;

const tex = (body = "") =>
  `\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n${body}\n\\end{document}\n`;

const figure = "\\begin{tikzpicture}\n\\draw[-Stealth] (0,0) -- (1,1);\n\\end{tikzpicture}";

function doc(path: string, relativePath: string, content: string, kind = "text") {
  return {
    path,
    relativePath,
    name: relativePath.split("/").at(-1)!,
    content,
    savedContent: content,
    kind,
  };
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  const ctx = {
    activePath: "",
    citationManagerOpen: false,
    extensionDetailsId: "",
    extensionToolAvailability: {
      tikzConverter: true,
      tableGenerator: true,
      notationManager: true,
      projectBibliography: true,
    },
    notationManagerOpen: false,
    tableCanvasOpen: false,
    tikzCanvasOpen: false,
    tikzConverterOpen: false,
    setActivePath: vi.fn(),
    activePathRef: { current: "" },
    documentsRef: { current: [] as ReturnType<typeof doc>[] },
    editorRef: { current: null as FakeEditor | null },
    setDocuments: vi.fn((update: (docs: ReturnType<typeof doc>[]) => unknown) =>
      update(ctx.documentsRef.current),
    ),
    rootFile: "main.tex",
    projectIdRef: { current: "proj" as string | null },
    setStatusMessage: vi.fn(),
    setCitationManagerOpen: vi.fn(),
    setExtensionDetailsId: vi.fn(),
    setNotationManagerOpen: vi.fn(),
    setTableCanvasOpen: vi.fn(),
    setTikzCanvasOpen: vi.fn(),
    setTikzConverterOpen: vi.fn(),
    activeCollaborationReadOnlyMessage: "",
    compile: vi.fn(async () => ({ ok: true })),
    handleEditorCursorToPdf: vi.fn(async () => undefined),
    setPreviewVisible: vi.fn(),
    ...overrides,
  };
  return ctx;
}

type Ctx = ReturnType<typeof makeCtx>;

function mount(ctx: Ctx) {
  return renderHook(({ c }) => useAppTikzFigures(c as unknown as AppCtx10), {
    initialProps: { c: ctx },
  });
}

const latexdo = { readFile: vi.fn(), writeFile: vi.fn() };

beforeAll(() => {
  setMonaco(monacoApi as unknown as MonacoNamespace);
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "latexdo", {
    configurable: true,
    writable: true,
    value: latexdo,
  });
});

afterEach(() => {
  delete (window as { latexdo?: unknown }).latexdo;
});

describe("tool tabs", () => {
  it("reports which tools are open, gated by extension availability", () => {
    const ctx = makeCtx({
      tikzCanvasOpen: true,
      tikzConverterOpen: true,
      tableCanvasOpen: true,
      notationManagerOpen: true,
      citationManagerOpen: true,
      extensionDetailsId: "x",
      extensionToolAvailability: {
        tikzConverter: false,
        tableGenerator: true,
        notationManager: false,
        projectBibliography: true,
      },
    });
    const { result } = mount(ctx);
    expect(result.current.toolTabOpen).toEqual({
      tikzCanvas: true,
      tikzConverter: false,
      tableGenerator: true,
      notationManager: false,
      citationManager: true,
      extensionDetails: true,
    });
  });

  it("opens a tool tab, remembering the live document's cursor, and goes back", () => {
    const main = doc("/p/main.tex", "main.tex", tex());
    const editor = makeEditor(makeModel("/p/main.tex", main.content));
    editor.setCursor({ lineNumber: 4, column: 1 });
    const ctx = makeCtx();
    ctx.activePathRef.current = main.path;
    ctx.documentsRef.current = [main];
    ctx.editorRef.current = editor;
    const { result } = mount(ctx);

    act(() => result.current.openToolTab(toolTabIds.tikzCanvas));
    expect(ctx.setTikzCanvasOpen).toHaveBeenCalledWith(true);
    expect(ctx.setActivePath).toHaveBeenLastCalledWith(toolTabIds.tikzCanvas);
    expect(ctx.activePathRef.current).toBe(toolTabIds.tikzCanvas);
    expect(result.current.toolReturnPath()).toBe(main.path);

    // Toggling the active tab goes back to the document.
    act(() => result.current.toggleToolTab(toolTabIds.tikzCanvas));
    expect(ctx.setActivePath).toHaveBeenLastCalledWith(main.path);

    // The editor mounts again: the view state comes back.
    act(() => result.current.applyPendingFigure(editor as never));
    expect(editor.restoreViewState).toHaveBeenCalledWith({ saved: true });

    // Toggling another tab opens it.
    act(() => result.current.toggleToolTab(toolTabIds.tableGenerator));
    expect(ctx.setTableCanvasOpen).toHaveBeenCalledWith(true);
  });

  it("restores only the position when there was no view state", () => {
    const main = doc("/p/main.tex", "main.tex", tex());
    const editor = makeEditor(makeModel("/p/main.tex", main.content));
    editor.saveViewState.mockReturnValue(null as never);
    editor.setCursor({ lineNumber: 2, column: 3 });
    const ctx = makeCtx();
    ctx.activePathRef.current = main.path;
    ctx.documentsRef.current = [main];
    ctx.editorRef.current = editor;
    const { result } = mount(ctx);
    act(() => result.current.openToolTab(toolTabIds.notationManager));
    act(() => result.current.applyPendingFigure(editor as never));
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 2, column: 3 });
    // Once restored, nothing is restored again.
    editor.setPosition.mockClear();
    act(() => result.current.applyPendingFigure(editor as never));
    expect(editor.setPosition).not.toHaveBeenCalled();
  });

  it("remembers a non-text document without a cursor", () => {
    const pdf = doc("/p/a.pdf", "a.pdf", "", "pdf");
    const ctx = makeCtx();
    ctx.activePathRef.current = pdf.path;
    ctx.documentsRef.current = [pdf];
    ctx.editorRef.current = makeEditor(makeModel("/p/other.tex", ""));
    const { result } = mount(ctx);
    act(() => result.current.openToolTab(toolTabIds.citationManager));
    expect(result.current.toolReturnPath()).toBe(pdf.path);
    expect(ctx.setCitationManagerOpen).toHaveBeenCalledWith(true);
  });

  it("does not remember a tool tab, nothing, or an unknown document", () => {
    const ctx = makeCtx();
    const { result } = mount(ctx);
    act(() => result.current.openToolTab(toolTabIds.tikzConverter));
    expect(result.current.toolReturnPath()).toBe("");
    ctx.activePathRef.current = toolTabIds.tikzConverter;
    act(() => result.current.openToolTab(toolTabIds.tikzCanvas));
    expect(result.current.toolReturnPath()).toBe("");
    ctx.activePathRef.current = "/gone.tex";
    act(() => result.current.openToolTab(toolTabIds.tikzCanvas));
    expect(result.current.toolReturnPath()).toBe("");
    expect(ctx.setTikzConverterOpen).toHaveBeenCalledWith(true);
  });

  it("ignores ids that are not tool tabs", () => {
    const ctx = makeCtx();
    const { result } = mount(ctx);
    act(() => result.current.openToolTab("/p/main.tex" as never));
    act(() => result.current.closeToolTab("/p/main.tex" as never));
    expect(ctx.setActivePath).not.toHaveBeenCalled();
  });

  it("closes tool tabs, leaving to the first document when the tab was active", () => {
    const a = doc("/p/a.tex", "a.tex", "a");
    const ctx = makeCtx();
    ctx.documentsRef.current = [a];
    const { result } = mount(ctx);
    act(() => result.current.closeToolTab(toolTabIds.tikzCanvas));
    expect(ctx.setTikzCanvasOpen).toHaveBeenCalledWith(false);
    expect(ctx.setActivePath).not.toHaveBeenCalled();

    ctx.activePathRef.current = toolTabIds.extensionDetails;
    act(() => result.current.closeToolTab(toolTabIds.extensionDetails));
    expect(ctx.setExtensionDetailsId).toHaveBeenCalledWith("");
    expect(ctx.setActivePath).toHaveBeenCalledWith(a.path);

    ctx.documentsRef.current = [];
    ctx.activePathRef.current = toolTabIds.tableGenerator;
    act(() => result.current.closeToolTab(toolTabIds.tableGenerator));
    expect(ctx.setActivePath).toHaveBeenLastCalledWith("");
  });

  it("opens extension details by id", () => {
    const ctx = makeCtx();
    const { result } = mount(ctx);
    act(() => result.current.openExtensionDetails("ext.id"));
    expect(ctx.setExtensionDetailsId).toHaveBeenCalledWith("ext.id");
    expect(ctx.setActivePath).toHaveBeenCalledWith(toolTabIds.extensionDetails);
    // extensionDetails' setter only closes.
    expect(ctx.setExtensionDetailsId).toHaveBeenCalledTimes(1);
  });

  it("leaves an active tab whose tool was closed elsewhere", () => {
    const a = doc("/p/a.tex", "a.tex", "a");
    const ctx = makeCtx({ activePath: toolTabIds.tikzCanvas, tikzCanvasOpen: false });
    ctx.documentsRef.current = [a];
    mount(ctx);
    expect(ctx.setActivePath).toHaveBeenCalledWith(a.path);
  });
});

describe("runInReturnDocument", () => {
  it("runs right away in the active .tex editor", () => {
    const main = doc("/p/main.tex", "main.tex", tex());
    const editor = makeEditor(makeModel(main.path, main.content));
    const ctx = makeCtx();
    ctx.activePathRef.current = main.path;
    ctx.documentsRef.current = [main];
    ctx.editorRef.current = editor;
    const { result } = mount(ctx);
    const run = vi.fn();
    expect(result.current.runInReturnDocument(run)).toBe(true);
    expect(run).toHaveBeenCalledWith(editor);
  });

  it("asks for a .tex file when there is none", () => {
    const ctx = makeCtx();
    ctx.documentsRef.current = [doc("/p/a.bib", "a.bib", "")];
    const { result } = mount(ctx);
    expect(result.current.runInReturnDocument(vi.fn())).toBe(false);
    expect(ctx.setStatusMessage).toHaveBeenCalledWith("Open a .tex file first.");
  });

  it("goes to the root file, then runs once its editor mounts", () => {
    const chapter = doc("/p/ch.tex", "ch.tex", "x");
    const main = doc("/p/main.tex", "./main.tex", tex());
    const ctx = makeCtx();
    ctx.activePathRef.current = toolTabIds.tikzCanvas;
    ctx.documentsRef.current = [chapter, main];
    const { result } = mount(ctx);
    const run = vi.fn();
    expect(result.current.runInReturnDocument(run)).toBe(true);
    expect(ctx.setActivePath).toHaveBeenCalledWith(main.path);
    expect(result.current.toolReturnPath()).toBe(main.path);

    // Another document's editor does not run it.
    result.current.applyPendingFigure(makeEditor(makeModel(chapter.path, "")) as never);
    expect(run).not.toHaveBeenCalled();
    const editor = makeEditor(makeModel(main.path, main.content));
    result.current.applyPendingFigure(editor as never);
    expect(run).toHaveBeenCalledWith(editor);
    // Only once.
    result.current.applyPendingFigure(editor as never);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("prefers the document the tab was opened from, else the first .tex", () => {
    const a = doc("/p/a.tex", "a.tex", "a");
    const b = doc("/p/b.tex", "b.tex", "b");
    const ctx = makeCtx({ rootFile: "missing.tex" });
    ctx.activePathRef.current = b.path;
    ctx.documentsRef.current = [a, b];
    const { result } = mount(ctx);
    act(() => result.current.openToolTab(toolTabIds.tikzCanvas));
    result.current.runInReturnDocument(vi.fn());
    expect(ctx.setActivePath).toHaveBeenLastCalledWith(b.path);

    const fresh = makeCtx({ rootFile: "missing.tex" });
    fresh.documentsRef.current = [a, b];
    const second = mount(fresh);
    second.result.current.runInReturnDocument(vi.fn());
    expect(fresh.setActivePath).toHaveBeenLastCalledWith(a.path);
  });
});

describe("insertFigureInEditor", () => {
  function setupEditor(content: string, path = "/p/main.tex", relativePath = "main.tex") {
    const document = doc(path, relativePath, content);
    const model = makeModel(path, content);
    const editor = makeEditor(model);
    const ctx = makeCtx();
    ctx.activePathRef.current = path;
    ctx.documentsRef.current = [document];
    ctx.editorRef.current = editor;
    const hook = mount(ctx);
    return { ctx, editor, model, hook, document };
  }

  it("refuses without a model, in read-only sessions, or with nothing to insert", async () => {
    const { hook, editor, ctx } = setupEditor(tex());
    expect(await hook.result.current.insertFigureInEditor(editor as never, "   ", "cursor")).toEqual({
      ok: false,
      message: "There is no figure to insert.",
      preambleLines: [],
    });
    ctx.activeCollaborationReadOnlyMessage = "Read only";
    expect(
      (await hook.result.current.insertFigureInEditor(editor as never, figure, "cursor")).message,
    ).toBe("Read only");
    editor.model = null;
    expect(
      (await hook.result.current.insertFigureInEditor(editor as never, figure, "cursor")).message,
    ).toBe("Open a .tex file first.");
  });

  it("inserts at the cursor in the body and adds the packages to the preamble", async () => {
    const { hook, editor, model, ctx } = setupEditor(tex("Hello"));
    editor.setCursor({ lineNumber: 4, column: 6 });
    const result = await hook.result.current.insertFigureInEditor(
      editor as never,
      figure,
      "cursor",
    );
    expect(result.ok).toBe(true);
    expect(result.preambleLines).toEqual(
      expect.arrayContaining(["\\usepackage{tikz}", "\\usetikzlibrary{arrows.meta}"]),
    );
    expect(result.message).toMatch(/^Figure inserted; added .*\\usepackage\{tikz\}/);
    const text = model.getValue();
    expect(text.indexOf("\\usepackage{tikz}")).toBeLessThan(text.indexOf("\\begin{document}"));
    expect(text).toContain(`Hello\n${figure}\n`);
    expect(editor.pushUndoStop).toHaveBeenCalledTimes(2);
    expect(editor.setSelection).toHaveBeenCalled();
    expect(editor.revealRangeInCenterIfOutsideViewport).toHaveBeenCalled();
    expect(ctx.setDocuments).toHaveBeenCalled();
    expect(ctx.documentsRef.current[0].content).toBe(text);
  });

  it("moves a cursor in the preamble into the body, and uses a given position", async () => {
    const { hook, editor, model } = setupEditor(tex("Body"));
    await hook.result.current.insertFigureInEditor(
      editor as never,
      "\\textbf{x}",
      "cursor",
      { lineNumber: 1, column: 1 },
    );
    expect(model.getValue()).toMatch(/Body\n\\textbf\{x\}\n\\end\{document\}/);
  });

  it("appends at the end when there is no cursor", async () => {
    const { hook, editor, model } = setupEditor("plain text");
    const result = await hook.result.current.insertFigureInEditor(
      editor as never,
      "\\textbf{y}",
      "cursor",
    );
    expect(model.getValue()).toBe("plain text\n\\textbf{y}\n");
    // No preamble in this file, the root is open and it is this file: nothing to load.
    expect(result.message).toBe("Figure inserted.");
  });

  it("replaces the selection", async () => {
    const content = tex("OLD");
    const { hook, editor, model } = setupEditor(content);
    const start = content.indexOf("OLD");
    const a = model.getPositionAt(start);
    const b = model.getPositionAt(start + 3);
    editor.select(new monacoApi.Selection(a.lineNumber, a.column, b.lineNumber, b.column));
    await hook.result.current.insertFigureInEditor(editor as never, "NEW", "selection");
    expect(model.getValue()).toBe(tex("NEW"));

    // An empty selection falls back to the cursor.
    editor.select(new monacoApi.Selection(4, 1, 4, 1));
    editor.setCursor({ lineNumber: 4, column: 4 });
    await hook.result.current.insertFigureInEditor(editor as never, "X", "selection");
    expect(model.getValue()).toBe(tex("NEW\nX"));
  });

  it("skips the preamble edit when it would land inside the selection", async () => {
    const content = tex("B");
    const { hook, editor, model } = setupEditor(content);
    const end = model.getPositionAt(content.indexOf("\\begin{document}"));
    editor.select(new monacoApi.Selection(1, 1, end.lineNumber, end.column));
    const result = await hook.result.current.insertFigureInEditor(
      editor as never,
      figure,
      "selection",
    );
    expect(model.getValue().startsWith(figure)).toBe(true);
    // The root file is this file and has its preamble replaced: nothing added there.
    expect(result.ok).toBe(true);
  });

  it("adds the packages to the open root file when inserting into a chapter", async () => {
    const chapter = doc("/p/ch.tex", "ch.tex", "Chapter");
    const main = doc("/p/main.tex", "main.tex", tex("\\input{ch}"));
    const model = makeModel(chapter.path, chapter.content);
    const editor = makeEditor(model);
    const ctx = makeCtx();
    ctx.activePathRef.current = chapter.path;
    ctx.documentsRef.current = [chapter, main];
    const { result } = mount(ctx);
    const inserted = await result.current.insertFigureInEditor(editor as never, figure, "cursor");
    expect(inserted.preambleLines).toContain("\\usepackage{tikz}");
    const root = ctx.documentsRef.current.find((d) => d.path === main.path)!;
    expect(root.content).toContain("\\usepackage{tikz}");

    // A second figure needs nothing new.
    const again = await result.current.insertFigureInEditor(editor as never, figure, "cursor");
    expect(again.preambleLines).toEqual([]);
    expect(again.message).toBe("Figure inserted.");
  });

  it("asks to load packages when the open root has no preamble", async () => {
    const chapter = doc("/p/ch.tex", "ch.tex", "Chapter");
    const main = doc("/p/main.tex", "main.tex", "no class here");
    const editor = makeEditor(makeModel(chapter.path, chapter.content));
    const ctx = makeCtx();
    ctx.activePathRef.current = chapter.path;
    ctx.documentsRef.current = [chapter, main];
    const { result } = mount(ctx);
    const inserted = await result.current.insertFigureInEditor(editor as never, figure, "cursor");
    expect(inserted.message).toBe(
      "Figure inserted. Load tikz in your main file's preamble.",
    );
  });

  it("patches the root file on disk when it is not open", async () => {
    latexdo.readFile.mockResolvedValue(tex());
    const chapter = doc("/p/ch.tex", "ch.tex", "Chapter");
    const editor = makeEditor(makeModel(chapter.path, chapter.content));
    const ctx = makeCtx();
    ctx.activePathRef.current = "/p/elsewhere.tex";
    ctx.documentsRef.current = [chapter];
    const { result } = mount(ctx);
    const inserted = await result.current.insertFigureInEditor(editor as never, figure, "cursor");
    expect(latexdo.readFile).toHaveBeenCalledWith("proj", "main.tex");
    expect(latexdo.writeFile).toHaveBeenCalledWith(
      "proj",
      "main.tex",
      expect.stringContaining("\\usepackage{tikz}"),
    );
    expect(inserted.preambleLines).toContain("\\usepackage{tikz}");
    // The editor was not the active document: the list is not touched.
    expect(ctx.setDocuments).not.toHaveBeenCalled();

    // Already loaded on disk: nothing written.
    latexdo.writeFile.mockClear();
    latexdo.readFile.mockResolvedValue(
      tex().replace("\\usepackage{amsmath}", "\\usepackage{tikz}\n\\usetikzlibrary{arrows.meta}"),
    );
    const again = await result.current.insertFigureInEditor(editor as never, figure, "cursor");
    expect(latexdo.writeFile).not.toHaveBeenCalled();
    expect(again.message).toBe("Figure inserted.");

    // No preamble on disk.
    latexdo.readFile.mockResolvedValue("nothing");
    expect(
      (await result.current.insertFigureInEditor(editor as never, figure, "cursor")).message,
    ).toMatch(/Load tikz/);

    // Unreadable.
    latexdo.readFile.mockRejectedValue(new Error("nope"));
    expect(
      (await result.current.insertFigureInEditor(editor as never, figure, "cursor")).message,
    ).toMatch(/Load tikz/);
  });

  it("cannot patch a root file without a project", async () => {
    const chapter = doc("/p/ch.tex", "ch.tex", "Chapter");
    const editor = makeEditor(makeModel(chapter.path, chapter.content));
    const ctx = makeCtx();
    ctx.projectIdRef.current = null;
    ctx.documentsRef.current = [chapter];
    const { result } = mount(ctx);
    const inserted = await result.current.insertFigureInEditor(editor as never, figure, "cursor");
    expect(inserted.message).toMatch(/Load tikz/);
    expect(latexdo.readFile).not.toHaveBeenCalled();
  });
});

describe("insertFigure and insertTextFromTool", () => {
  it("inserts a figure, reports it and shows it in the preview", async () => {
    const main = doc("/p/main.tex", "main.tex", tex("Hi"));
    const model = makeModel(main.path, main.content);
    const editor = makeEditor(model);
    const ctx = makeCtx();
    ctx.activePathRef.current = main.path;
    ctx.documentsRef.current = [main];
    ctx.editorRef.current = editor;
    const { result } = mount(ctx);
    expect(result.current.insertFigure(figure)).toBe(true);
    await waitFor(() => expect(ctx.handleEditorCursorToPdf).toHaveBeenCalled());
    expect(ctx.setPreviewVisible).toHaveBeenCalledWith(true);
    expect(ctx.setStatusMessage.mock.calls[0][0]).toMatch(/^Figure inserted/);
    expect(result.current.insertFigureFromTool).toBe(result.current.insertFigure);
  });

  it("does not compile after a refused figure, nor jump after a failed compile", async () => {
    const main = doc("/p/main.tex", "main.tex", tex());
    const editor = makeEditor(makeModel(main.path, main.content));
    const ctx = makeCtx({ compile: vi.fn(async () => ({ ok: false })) });
    ctx.activePathRef.current = main.path;
    ctx.documentsRef.current = [main];
    ctx.editorRef.current = editor;
    const { result } = mount(ctx);
    result.current.insertFigure("  ");
    await waitFor(() =>
      expect(ctx.setStatusMessage).toHaveBeenCalledWith("There is no figure to insert."),
    );
    expect(ctx.compile).not.toHaveBeenCalled();

    expect(await result.current.showFigureInPreview()).toEqual({ ok: false });
    expect(ctx.handleEditorCursorToPdf).not.toHaveBeenCalled();
  });

  it("inserts tool text on its own lines at the cursor", () => {
    const main = doc("/p/main.tex", "main.tex", tex("AB"));
    const model = makeModel(main.path, main.content);
    const editor = makeEditor(model);
    editor.setCursor({ lineNumber: 4, column: 2 });
    const ctx = makeCtx();
    ctx.activePathRef.current = main.path;
    ctx.documentsRef.current = [main];
    ctx.editorRef.current = editor;
    const { result } = mount(ctx);
    expect(result.current.insertTextFromTool("TABLE")).toBe(true);
    expect(model.getValue()).toBe(tex("A\nTABLE\nB"));
    expect(editor.focus).toHaveBeenCalled();
    expect(ctx.setStatusMessage).toHaveBeenCalledWith("Inserted.");

    // Without a cursor, at the end.
    editor.setCursor(null);
    result.current.insertTextFromTool("END");
    expect(model.getValue().endsWith("\nEND\n")).toBe(true);

    // A model that is gone by the time the edit runs: nothing happens.
    ctx.setStatusMessage.mockClear();
    const vanishing = makeEditor(null);
    vanishing.getModel = vi
      .fn()
      .mockReturnValueOnce({ uri: monacoApi.Uri.file(main.path) })
      .mockReturnValue(null);
    ctx.editorRef.current = vanishing;
    expect(result.current.insertTextFromTool("Z")).toBe(true);
    expect(ctx.setStatusMessage).not.toHaveBeenCalled();
  });
});
