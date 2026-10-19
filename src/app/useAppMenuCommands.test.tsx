import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { figureToTikzExtensionId } from "../extensions";
import { toolTabIds } from "../features/workspace/toolTabs";
import type { AppCtx19 } from "./appContext";
import { useAppMenuCommands } from "./useAppMenuCommands";

type Listener = (command: string) => void;

let listener: Listener | null = null;
const unsubscribe = vi.fn();
const latexdo = {
  onMenuCommand: vi.fn((callback: Listener) => {
    listener = callback;
    return unsubscribe;
  }),
  saveResearchSpaceAs: vi.fn(),
  addFolderToResearchSpace: vi.fn(),
};

function makeEditor(hasFocus = false) {
  const run = vi.fn();
  return {
    focus: vi.fn(),
    hasTextFocus: vi.fn(() => hasFocus),
    getAction: vi.fn((id: string) => (id === "missing" ? null : { run, id })),
    run,
  };
}

function makeCtx(overrides: Partial<Record<string, unknown>> = {}) {
  const editor = makeEditor();
  const ctx = {
    editorRef: { current: editor },
    setStatusMessage: vi.fn(),
    askQuickPick: vi.fn(),
    projectEntries: [] as unknown[],
    hideProjectEntries: false,
    openDocument: vi.fn(),
    workspaceTabs: [] as Array<{ active: boolean; onSelect: () => void }>,
    documentsRef: { current: [] as unknown[] },
    saveDocument: vi.fn(),
    projectId: "p1",
    projectName: "Paper",
    loadProject: vi.fn(),
    requireLegalAcceptance: vi.fn(() => false),
    openSidebar: vi.fn(),
    openPanel: vi.fn(),
    applyLayoutPreset: vi.fn(),
    applyLatexToolbarCommand: vi.fn(),
    extensionToolAvailability: { tikzConverter: true },
    extensionToolInstallation: { tikzConverter: false },
    openExtensionDetails: vi.fn(),
    openToolTab: vi.fn(),
    setSettingsOpen: vi.fn(),
    createProject: vi.fn(),
    createResearchSpace: vi.fn(),
    saveActiveAndCompile: vi.fn(),
    reloadOpenDocumentsFromDisk: vi.fn(),
    openShareDialog: vi.fn(),
    toggleSidebar: vi.fn(),
    togglePanel: vi.fn(),
    togglePreview: vi.fn(),
    setSettings: vi.fn(),
    handleEditorCursorToPdf: vi.fn(),
    compile: vi.fn(),
    cancelCompile: vi.fn(),
    downloadPdf: vi.fn(),
    reviewPaperWithAi: vi.fn(),
    reviewPaper: vi.fn(),
    runProofreading: vi.fn(),
    openAiSettings: vi.fn(),
    showWelcomePage: vi.fn(),
    ...overrides,
  };
  return { ctx, editor };
}

function mount(ctx: ReturnType<typeof makeCtx>["ctx"]) {
  return renderHook(({ c }) => useAppMenuCommands(c as unknown as AppCtx19), {
    initialProps: { c: ctx },
  });
}

async function send(command: string) {
  await act(async () => {
    listener?.(command);
    await Promise.resolve();
  });
}

beforeEach(() => {
  listener = null;
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

describe("useAppMenuCommands", () => {
  it("subscribes once and unsubscribes on unmount", () => {
    const { ctx } = makeCtx();
    const hook = mount(ctx);
    hook.rerender({ c: { ...ctx } });
    expect(latexdo.onMenuCommand).toHaveBeenCalledTimes(1);
    hook.unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("does nothing until the legal terms are accepted", async () => {
    const { ctx } = makeCtx({ requireLegalAcceptance: vi.fn(() => true) });
    mount(ctx);
    await send("build.compile");
    expect(ctx.compile).not.toHaveBeenCalled();
  });

  it("runs editor actions, or asks to open a file first", async () => {
    const { ctx, editor } = makeCtx();
    mount(ctx);
    await send("editor:editor.action.formatDocument");
    expect(editor.focus).toHaveBeenCalled();
    expect(editor.getAction).toHaveBeenCalledWith("editor.action.formatDocument");
    expect(editor.run).toHaveBeenCalled();
    await send("editor:missing");
    expect(editor.run).toHaveBeenCalledTimes(1);

    ctx.editorRef.current = null as never;
    await send("editor:anything");
    expect(ctx.setStatusMessage).toHaveBeenCalledWith("Open a file in the editor first.");
  });

  it.each([
    ["view.explorer", "openSidebar", "explorer"],
    ["view.sourceControl", "openSidebar", "sourceControl"],
    ["view.extensions", "openSidebar", "extensions"],
    ["view.ai", "openSidebar", "ai"],
    ["view.problems", "openPanel", "problems"],
    ["view.output", "openPanel", "output"],
    ["view.terminal", "openPanel", "terminal"],
    ["view.layout.focus", "applyLayoutPreset", "focus"],
    ["view.layout.balanced", "applyLayoutPreset", "balanced"],
    ["view.layout.power", "applyLayoutPreset", "power"],
    ["insert.section", "applyLatexToolbarCommand", "section"],
    ["insert.formatTable", "applyLatexToolbarCommand", "formatTable"],
    ["view.tool.tableGenerator", "openToolTab", toolTabIds.tableGenerator],
    ["view.tool.tikzConverter", "openToolTab", toolTabIds.tikzConverter],
  ])("routes %s to %s", async (command, method, argument) => {
    const { ctx } = makeCtx();
    mount(ctx);
    await send(command);
    expect(ctx[method as keyof typeof ctx]).toHaveBeenCalledWith(argument);
  });

  it("focuses the editor before inserting, and tolerates a missing editor", async () => {
    const { ctx, editor } = makeCtx();
    mount(ctx);
    await send("insert.math");
    expect(editor.focus).toHaveBeenCalled();
    ctx.editorRef.current = null as never;
    await send("insert.cite");
    expect(ctx.applyLatexToolbarCommand).toHaveBeenLastCalledWith("cite");
  });

  it("ignores unknown tool tabs and unknown commands", async () => {
    const { ctx } = makeCtx();
    mount(ctx);
    await send("view.tool.nope");
    await send("totally.unknown");
    expect(ctx.openToolTab).not.toHaveBeenCalled();
    expect(ctx.setStatusMessage).not.toHaveBeenCalled();
  });

  it("points to the TikZ converter extension when it is not available", async () => {
    const { ctx } = makeCtx({ extensionToolAvailability: { tikzConverter: false } });
    mount(ctx);
    await send("view.tool.tikzConverter");
    expect(ctx.openExtensionDetails).toHaveBeenCalledWith(figureToTikzExtensionId);
    expect(ctx.setStatusMessage).toHaveBeenCalledWith(
      "The Figure → TikZ Converter is an extension. Install it to use it.",
    );
    ctx.extensionToolInstallation = { tikzConverter: true };
    await send("view.tool.tikzConverter");
    expect(ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "Turn on the Figure → TikZ Converter in Settings to use it.",
    );
    expect(ctx.openToolTab).not.toHaveBeenCalled();
  });

  it.each([
    ["file.newProject", "createProject"],
    ["file.newResearchSpace", "createResearchSpace"],
    ["file.save", "saveActiveAndCompile"],
    ["file.share", "openShareDialog"],
    ["view.toggleSidebar", "toggleSidebar"],
    ["view.togglePanel", "togglePanel"],
    ["view.togglePreview", "togglePreview"],
    ["go.syncPdf", "handleEditorCursorToPdf"],
    ["build.compile", "compile"],
    ["build.stop", "cancelCompile"],
    ["build.downloadPdf", "downloadPdf"],
    ["tools.reviewPaper", "reviewPaperWithAi"],
    ["tools.reviewPdf", "reviewPaper"],
    ["tools.proofread", "runProofreading"],
    ["tools.aiSettings", "openAiSettings"],
    ["help.welcome", "showWelcomePage"],
  ])("runs %s", async (command, method) => {
    const { ctx } = makeCtx();
    mount(ctx);
    await send(command);
    expect(ctx[method as keyof typeof ctx]).toHaveBeenCalled();
  });

  it("opens settings, reloads from disk and opens the shortcuts dialog", async () => {
    const { ctx } = makeCtx();
    const hook = mount(ctx);
    await send("app.settings");
    expect(ctx.setSettingsOpen).toHaveBeenCalledWith(true);
    await send("file.reloadFromDisk");
    expect(ctx.reloadOpenDocumentsFromDisk).toHaveBeenCalledWith({ includeUnsaved: true });
    expect(hook.result.current.shortcutsOpen).toBe(false);
    await send("help.shortcuts");
    expect(hook.result.current.shortcutsOpen).toBe(true);
  });

  it("toggles word wrap and the minimap", async () => {
    const { ctx } = makeCtx();
    mount(ctx);
    await send("view.toggleWordWrap");
    await send("view.toggleMinimap");
    const [wrap, minimap] = ctx.setSettings.mock.calls.map(([update]) => update);
    expect(wrap({ wordWrap: false, minimap: true })).toEqual({
      wordWrap: true,
      minimap: true,
    });
    expect(minimap({ wordWrap: false, minimap: true })).toEqual({
      wordWrap: false,
      minimap: false,
    });
  });

  it("saves every dirty text document", async () => {
    const dirty = { kind: "text", content: "a", savedContent: "b" };
    const dirtyDefaultKind = { content: "x", savedContent: "y" };
    const clean = { kind: "text", content: "a", savedContent: "a" };
    const pdf = { kind: "pdf", content: "a", savedContent: "b" };
    const { ctx } = makeCtx({
      documentsRef: { current: [dirty, clean, pdf, dirtyDefaultKind] },
    });
    mount(ctx);
    await send("file.saveAll");
    await waitFor(() => expect(ctx.setStatusMessage).toHaveBeenCalledWith("Saved 2 files"));
    expect(ctx.saveDocument.mock.calls.map(([d]) => d)).toEqual([dirty, dirtyDefaultKind]);

    ctx.documentsRef.current = [dirty];
    await send("file.saveAll");
    await waitFor(() => expect(ctx.setStatusMessage).toHaveBeenCalledWith("Saved 1 file"));
    ctx.documentsRef.current = [clean];
    await send("file.saveAll");
    await waitFor(() =>
      expect(ctx.setStatusMessage).toHaveBeenCalledWith("All files are saved."),
    );
  });

  it("saves and extends a Research Space", async () => {
    const project = { id: "p2" };
    latexdo.saveResearchSpaceAs.mockResolvedValue(project);
    latexdo.addFolderToResearchSpace.mockResolvedValue(null);
    const { ctx } = makeCtx();
    mount(ctx);
    await send("file.saveResearchSpaceAs");
    await waitFor(() =>
      expect(ctx.setStatusMessage).toHaveBeenCalledWith("Research Space saved"),
    );
    expect(latexdo.saveResearchSpaceAs).toHaveBeenCalledWith("p1", "Paper");
    expect(ctx.loadProject).toHaveBeenCalledWith(project, false, false);

    await send("file.addFolderToResearchSpace");
    await waitFor(() => expect(latexdo.addFolderToResearchSpace).toHaveBeenCalled());
    expect(ctx.loadProject).toHaveBeenCalledTimes(1);
  });

  it("asks for a project before changing a Research Space", async () => {
    const { ctx } = makeCtx({ projectId: null });
    mount(ctx);
    await send("file.saveResearchSpaceAs");
    expect(ctx.setStatusMessage).toHaveBeenCalledWith("Open a project first.");
    ctx.projectId = "p1";
    ctx.hideProjectEntries = true;
    await send("file.addFolderToResearchSpace");
    expect(ctx.setStatusMessage).toHaveBeenCalledTimes(2);
    expect(latexdo.addFolderToResearchSpace).not.toHaveBeenCalled();
  });

  it("finds in the editor when it has focus, otherwise opens the find panel", async () => {
    const focused = makeEditor(true);
    const { ctx } = makeCtx();
    ctx.editorRef.current = focused;
    mount(ctx);
    await send("edit.find");
    expect(focused.getAction).toHaveBeenCalledWith("latexdo.find");
    await send("edit.findInFiles");
    expect(focused.getAction).toHaveBeenCalledWith("latexdo.findInFiles");

    const events: unknown[] = [];
    const record = (event: Event) => events.push((event as CustomEvent).detail);
    window.addEventListener("latexdo:open-find", record);
    ctx.editorRef.current = makeEditor(false);
    await send("edit.find");
    ctx.editorRef.current = null as never;
    await send("edit.findInFiles");
    window.removeEventListener("latexdo:open-find", record);
    expect(events).toEqual([{ scope: "file" }, { scope: "project" }]);
  });

  it("goes to a project file through the quick pick", async () => {
    const main = { type: "file", path: "/p/main.tex", name: "main.tex", relativePath: "main.tex" };
    const sub = { type: "file", path: "/p/s/a.tex", name: "a.tex", relativePath: "s/a.tex" };
    const folder = { type: "directory", path: "/p/s", name: "s", children: [sub] };
    const askQuickPick = vi.fn().mockResolvedValue({ item: { id: sub.path } });
    const { ctx } = makeCtx({ projectEntries: [main, folder], askQuickPick });
    mount(ctx);
    await send("go.file");
    await waitFor(() => expect(ctx.openDocument).toHaveBeenCalledWith(sub));
    const request = askQuickPick.mock.calls[0][0];
    expect(request.title).toBe("Go to File");
    expect(request.items.map((item: { id: string }) => item.id)).toEqual([main.path, sub.path]);

    askQuickPick.mockResolvedValue(null);
    await send("go.file");
    await waitFor(() => expect(askQuickPick).toHaveBeenCalledTimes(2));
    expect(ctx.openDocument).toHaveBeenCalledTimes(1);
  });

  it("asks for a project before going to a file", async () => {
    const { ctx } = makeCtx({
      projectEntries: [{ type: "file", path: "/a", name: "a", relativePath: "a" }],
      hideProjectEntries: true,
    });
    mount(ctx);
    await send("go.file");
    expect(ctx.setStatusMessage).toHaveBeenCalledWith("Open a project to go to its files.");
    expect(ctx.askQuickPick).not.toHaveBeenCalled();
  });

  it("steps through tabs in both directions, wrapping around", async () => {
    const select = [vi.fn(), vi.fn(), vi.fn()];
    const { ctx } = makeCtx({
      workspaceTabs: select.map((onSelect, index) => ({ active: index === 0, onSelect })),
    });
    mount(ctx);
    await send("go.nextTab");
    expect(select[1]).toHaveBeenCalled();
    await send("go.previousTab");
    expect(select[2]).toHaveBeenCalled();

    ctx.workspaceTabs = select.map((onSelect) => ({ active: false, onSelect }));
    await send("go.nextTab");
    expect(select[1]).toHaveBeenCalledTimes(2);

    ctx.workspaceTabs = [{ active: true, onSelect: select[0] }];
    await send("go.nextTab");
    expect(select[0]).not.toHaveBeenCalled();
  });

  it("reports a failed command in the status bar", async () => {
    const { ctx } = makeCtx({
      compile: vi.fn().mockRejectedValue(new Error("TeX missing")),
      downloadPdf: vi.fn().mockRejectedValue("nope"),
    });
    mount(ctx);
    await send("build.compile");
    await waitFor(() => expect(ctx.setStatusMessage).toHaveBeenCalledWith("TeX missing"));
    await send("build.downloadPdf");
    await waitFor(() =>
      expect(ctx.setStatusMessage).toHaveBeenCalledWith("That command did not complete."),
    );
  });
});
