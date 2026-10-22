/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppWorkspaceLayout } from "./useAppWorkspaceLayout";
import type { AppCtx11 } from "./appContext";
import { hookContext, deferred } from "./__tests__/hookHarness";
vi.mock("./useAppScm", () => ({ useAppScm: () => ({}) }));
vi.mock("../components/AiSidebar", () => ({
  isAiConfigured: (config: any) => config.provider !== "off",
}));
const listeners: Record<string, (...args: any[]) => any> = {};
const api: Record<string, any> = {};
const doc = (path = "main.tex", content = "old", savedContent = content) => ({
  path: `/p/${path}`,
  relativePath: path,
  name: path,
  kind: "text",
  content,
  savedContent,
});
const session = (extra = {}) => ({
  id: "diff",
  relativePath: "main.tex",
  originalRef: { kind: "index" },
  modifiedRef: { kind: "working-tree" },
  originalContent: "old",
  modifiedContent: "new",
  originalLabel: "Index",
  modifiedLabel: "Working Tree",
  ...extra,
});
function setup(overrides = {}) {
  const { ctx, state } = hookContext(
    {
      activePathRef: { current: "/p/main.tex" },
      projectIdRef: { current: "p" },
      documentsRef: { current: [doc()] },
      editorRef: { current: null },
      gitDiffReturnPathRef: { current: "/p/main.tex" },
      gitDiffSessionRef: { current: null },
      gitDiffSessionIdRef: { current: "" },
      gitFileHistoryPathRef: { current: "" },
      gitRefreshTimerRef: { current: null },
      scheduleGitRefreshRef: { current: null },
      gitCommitMessage: "Fix",
      gitDiffSession: null,
      welcomeOpen: false,
      aiConfig: { provider: "local" },
      aiIsDesktop: true,
      spellCheckerSettings: {
        enabled: true,
        languages: ["en"],
        customWords: ["LaTeX"],
        usesSystemLanguage: false,
      },
      spellCheckerWordDraft: "newword",
      updateInfo: { currentVersion: "1", latestVersion: "2" },
      updateProgress: null,
      documents: [doc()],
      sidebarVisible: true,
      panelVisible: false,
      activationTourLaunchNonce: 0,
      ...overrides,
    },
    [
      "setDocuments",
      "setActivationTourLaunchNonce",
      "setActivePanel",
      "setActivePath",
      "setActiveSidebar",
      "setAiConfig",
      "setAiWizardOpen",
      "setCheckingUpdates",
      "setCreateDialog",
      "setCreateError",
      "setCreatePath",
      "setDismissedUpdateVersion",
      "setGitActionBusy",
      "setGitBlameLines",
      "setGitCommitMessage",
      "setGitDiffSession",
      "setGitFileHistory",
      "setGitLoading",
      "setGitRepoHistory",
      "setGitStatus",
      "setLatexEditorView",
      "setPanelVisible",
      "setPreviewVisible",
      "setProofreadingError",
      "setSettingsOpen",
      "setSidebarVisible",
      "setSpellCheckerError",
      "setSpellCheckerLanguageQuery",
      "setSpellCheckerSettings",
      "setSpellCheckerWordDraft",
      "setStatusMessage",
      "setTerminalStarted",
      "setUpdateAttemptStatus",
      "setUpdateInfo",
      "setUpdateProgress",
      "setUpdatingNow",
      "setWelcomeOpen",
      "setWhatsNew",
      "setWhatsNewOpen",
    ],
    [
      "closeDocument",
      "applyLayoutPreset",
      "askAiAboutSelection",
      "closeActiveTab",
      "compile",
      "defaultCreateRelativePath",
      "handleEditorCursorToPdf",
      "importDocx",
      "importMarkdown",
      "importPdf",
      "loadProofreadingSettings",
      "loadSpellCheckerSettings",
      "openProject",
      "refreshProject",
      "requireLegalAcceptance",
      "saveSpellCheckerSettings",
    ],
  );
  ctx.defaultCreateRelativePath.mockImplementation((kind: string) =>
    kind === "file" ? "new.tex" : "folder",
  );
  return { ...renderHook(() => useAppWorkspaceLayout(ctx as AppCtx11)), ctx, state };
}
beforeEach(() => {
  vi.useFakeTimers();
  for (const key of Object.keys(listeners)) delete listeners[key];
  for (const name of [
    "onSpellCheckerSettingsChanged",
    "onOpenSpellCheckerSettings",
    "onOpenProjectMenu",
    "onCreateFileMenu",
    "onCreateFolderMenu",
    "onImportDocxMenu",
    "onImportMarkdownMenu",
    "onImportPdfMenu",
    "onCloseTabMenu",
  ])
    api[name] = vi.fn((cb: any) => {
      listeners[name] = cb;
      return vi.fn();
    });
  for (const name of [
    "getGitStatus",
    "getGitHistory",
    "getGitEditorDiff",
    "getGitBlame",
    "checkForUpdates",
    "updateNow",
    "getWhatsNew",
    "markWhatsNewPresented",
    "openReleaseNotesPage",
    "stageGitFile",
    "unstageGitFile",
    "commitGit",
    "readFile",
    "fileExists",
    "discardGitFile",
    "stageAllGit",
    "unstageAllGit",
  ])
    api[name] = vi.fn().mockResolvedValue(null);
  api.getGitStatus.mockResolvedValue({ isRepo: true });
  api.getGitHistory.mockResolvedValue({ commits: [] });
  api.getGitBlame.mockResolvedValue(["blame"]);
  api.readFile.mockResolvedValue("disk");
  api.discardGitFile.mockResolvedValue({ discarded: true });
  window.latexdo = api as typeof window.latexdo;
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("workspace settings and menu integration", () => {
  it("loads settings, routes native menu events and honors legal acceptance", () => {
    const h = setup();
    expect(h.ctx.loadSpellCheckerSettings).toHaveBeenCalledOnce();
    expect(h.ctx.loadProofreadingSettings).toHaveBeenCalledOnce();
    listeners.onSpellCheckerSettingsChanged({ enabled: false });
    expect(h.state.spellCheckerSettings).toEqual({ enabled: false });
    for (const [event, callback] of [
      ["onOpenProjectMenu", "openProject"],
      ["onImportDocxMenu", "importDocx"],
      ["onImportMarkdownMenu", "importMarkdown"],
      ["onImportPdfMenu", "importPdf"],
      ["onCloseTabMenu", "closeActiveTab"],
    ]) {
      listeners[event]();
      expect(h.ctx[callback]).toHaveBeenCalledOnce();
    }
    listeners.onCreateFileMenu();
    expect(h.state.createPath).toBe("new.tex");
    expect(h.state.createDialog).toBe("file");
    listeners.onCreateFolderMenu();
    expect(h.state.createDialog).toBe("folder");
    listeners.onOpenSpellCheckerSettings();
    expect(h.state.settingsOpen).toBe(true);
    h.ctx.requireLegalAcceptance.mockReturnValue(true);
    for (const event of Object.keys(listeners).filter(
      (x) => !["onSpellCheckerSettingsChanged", "onOpenProjectMenu"].includes(x),
    ))
      listeners[event]();
    expect(h.ctx.importDocx).toHaveBeenCalledOnce();
    expect(h.ctx.loadSpellCheckerSettings).toHaveBeenCalledTimes(2);
    h.unmount();
    for (const name of Object.keys(listeners))
      expect(api[name].mock.results[0].value).toHaveBeenCalledOnce();
  });
  it("toggles languages and prevents removing the last one", () => {
    const h = setup();
    h.result.current.toggleSpellCheckerEnabled(false);
    expect(h.ctx.saveSpellCheckerSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
      "Spell checker disabled",
    );
    h.result.current.toggleSpellCheckerLanguage("en");
    expect(h.state.spellCheckerError).toMatch(/at least one/);
    h.result.current.toggleSpellCheckerLanguage("fr");
    expect(h.ctx.saveSpellCheckerSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ languages: ["en", "fr"] }),
      expect.any(String),
    );
    h.ctx.spellCheckerSettings.languages = ["en", "fr"];
    h.rerender();
    h.result.current.toggleSpellCheckerLanguage("fr");
    expect(h.ctx.saveSpellCheckerSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ languages: ["en"] }),
      expect.any(String),
    );
  });
  it("adds, removes and clears dictionary words with duplicate and cancellation handling", () => {
    const h = setup();
    const event = { preventDefault: vi.fn() } as any;
    h.result.current.addSpellCheckerWord(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(h.ctx.saveSpellCheckerSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ customWords: ["LaTeX", "newword"] }),
      expect.any(String),
      { clearWordDraft: true },
    );
    h.ctx.spellCheckerWordDraft = " LaTeX ";
    h.rerender();
    h.result.current.addSpellCheckerWord(event);
    expect(h.state.statusMessage).toMatch(/already/);
    h.ctx.spellCheckerWordDraft = " ";
    h.rerender();
    h.result.current.addSpellCheckerWord(event);
    expect(h.state.spellCheckerError).toMatch(/Enter a word/);
    h.result.current.removeSpellCheckerWord("LaTeX");
    expect(h.ctx.saveSpellCheckerSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ customWords: [] }),
      expect.any(String),
    );
    h.ctx.saveSpellCheckerSettings.mockClear();
    vi.mocked(window.confirm).mockReturnValue(false);
    h.result.current.clearSpellCheckerWords();
    expect(h.ctx.saveSpellCheckerSettings).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true);
    h.result.current.clearSpellCheckerWords();
    expect(h.ctx.saveSpellCheckerSettings).toHaveBeenCalledOnce();
  });
  it("opens panels and applies setup and tour choices", () => {
    const h = setup();
    h.result.current.toggleSidebar();
    expect(h.state.sidebarVisible).toBe(false);
    h.result.current.togglePanel();
    expect(h.state.panelVisible).toBe(true);
    h.result.current.openPanel("terminal");
    expect(h.state.terminalStarted).toBe(true);
    h.result.current.openPanel("problems");
    expect(h.state.activePanel).toBe("problems");
    h.result.current.chooseWorkspacePreset("focus");
    expect(h.state.aiConfig.layoutPreset).toBe("focus");
    expect(h.ctx.applyLayoutPreset).toHaveBeenCalledWith("focus");
    h.result.current.completeAiSetup({
      layoutPreset: "balanced",
      userName: "Ada",
    } as any);
    expect(h.state.activationTourLaunchNonce).toBe(1);
    expect(h.state.statusMessage).toContain("Ada");
    for (const id of ["editor", "ask-ai", "compile", "pdf-navigation"])
      h.result.current.revealActivationStep({ id } as any);
    expect(h.state.previewVisible).toBe(true);
    expect(h.state.activeSidebar).toBe("ai");
    h.result.current.showActivationStep({ id: "compile" } as any);
    expect(h.ctx.compile).toHaveBeenCalledOnce();
    h.ctx.pdfData = new Uint8Array([1]);
    h.rerender();
    h.result.current.showActivationStep({ id: "pdf-navigation" } as any);
    expect(h.ctx.handleEditorCursorToPdf).toHaveBeenCalledOnce();
  });
  it("selects prose for the AI tutorial without changing the document", () => {
    const lines = ["\\section{Title}", "A sentence about research."];
    const editor = {
      getModel: () => ({
        getLineCount: () => 2,
        getLineContent: (n: number) => lines[n - 1],
        getLineFirstNonWhitespaceColumn: () => 1,
        getLineMaxColumn: (n: number) => lines[n - 1].length + 1,
      }),
      getPosition: () => ({ lineNumber: 1 }),
      getSelection: () => ({ isEmpty: () => true }),
      setSelection: vi.fn(),
      revealLineInCenter: vi.fn(),
      focus: vi.fn(),
    };
    const h = setup({ editorRef: { current: editor } });
    h.result.current.showActivationStep({ id: "ask-ai" } as any);
    expect(editor.setSelection).toHaveBeenCalledWith(
      expect.objectContaining({ startLineNumber: 2 }),
    );
    expect(h.ctx.askAiAboutSelection).toHaveBeenCalledOnce();
  });
});
describe("updates and release notes", () => {
  it.each([
    { currentVersion: "1", updateAvailable: false },
    { currentVersion: "1", latestVersion: "2", updateAvailable: true },
    { currentVersion: "1", error: "offline" },
  ])("reports update checks %j", async (info) => {
    const h = setup();
    api.checkForUpdates.mockResolvedValue(info);
    await h.result.current.checkForUpdates();
    expect(h.state.updateInfo).toEqual(info);
    expect(h.state.checkingUpdates).toBe(false);
    expect(h.state.statusMessage).toContain(
      info.error ? "offline" : info.updateAvailable ? "2" : "up to date",
    );
  });
  it("records failed checks, keeping silent checks quiet", async () => {
    const h = setup();
    api.checkForUpdates.mockRejectedValue("offline");
    await h.result.current.checkForUpdates({ silent: true });
    expect(h.state.updateInfo.error).toBe("Could not check for updates.");
    expect(h.ctx.setStatusMessage).not.toHaveBeenCalled();
    api.checkForUpdates.mockRejectedValue(new Error("network"));
    await h.result.current.checkForUpdates();
    expect(h.state.statusMessage).toBe("network");
    expect(h.state.checkingUpdates).toBe(false);
  });
  it.each([
    [{ restartScheduled: true }, "restarting"],
    [{ quitScheduled: true }, "installing"],
    [{ manualDownload: true }, "done"],
    [{}, "opening"],
  ])("tracks installation outcome %j", async (extra, status) => {
    const h = setup();
    api.updateNow.mockResolvedValue({
      currentVersion: "1",
      latestVersion: "2",
      updateAvailable: true,
      opened: true,
      ...extra,
    });
    await h.result.current.updateNow();
    expect(h.state.updateProgress.status).toBe(status);
    expect(h.state.updatingNow).toBe(false);
  });
  it.each([
    [{ error: "failed" }, "error"],
    [{ updateAvailable: false }, "done"],
    [{ updateAvailable: true, opened: false }, "error"],
  ])("handles non-installation results %j", async (extra, status) => {
    const h = setup();
    api.updateNow.mockResolvedValue({
      currentVersion: "1",
      latestVersion: "2",
      ...extra,
    });
    await h.result.current.updateNow();
    expect(h.state.updateProgress.status).toBe(status);
    expect(h.state.updatingNow).toBe(false);
  });
  it("handles rejected installation and marks presented release notes", async () => {
    const h = setup();
    api.updateNow.mockRejectedValue(new Error("download failed"));
    await h.result.current.updateNow();
    expect(h.state.updateProgress.message).toBe("download failed");
    api.getWhatsNew.mockResolvedValue({ shouldPresent: true, toVersion: "2" });
    await h.result.current.openWhatsNewDialog();
    expect(h.state.whatsNewOpen).toBe(true);
    h.result.current.closeWhatsNewDialog();
    expect(api.markWhatsNewPresented).toHaveBeenCalledWith("2");
    expect(h.state.whatsNew.shouldPresent).toBe(false);
    expect(h.state.whatsNewOpen).toBe(false);
    h.result.current.viewFullReleaseNotes();
    expect(api.openReleaseNotesPage).toHaveBeenCalledOnce();
  });
});
describe("Git refresh and working buffers", () => {
  it("debounces refresh and loads status and histories", async () => {
    const h = setup();
    h.result.current.scheduleGitRefresh();
    await act(() => vi.advanceTimersByTimeAsync(100));
    h.result.current.scheduleGitRefresh();
    await act(() => vi.advanceTimersByTimeAsync(149));
    expect(api.getGitStatus).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(api.getGitStatus).toHaveBeenCalledWith("p");
    expect(api.getGitHistory).toHaveBeenCalledWith("p", "main.tex");
    expect(h.state.gitLoading).toBe(false);
  });
  it("refreshes diffs without remounting and ignores results after switching projects", async () => {
    const original = session();
    const h = setup({ gitDiffSessionRef: { current: original } });
    api.getGitEditorDiff.mockResolvedValue(
      session({ id: "new", modifiedContent: "edited" }),
    );
    await h.result.current.refreshGitData();
    expect(h.state.gitDiffSession).toMatchObject({
      id: "diff",
      modifiedContent: "edited",
    });
    expect(h.state.gitBlameLines).toEqual(["blame"]);
    const pending = deferred<any>();
    api.getGitEditorDiff.mockReturnValue(pending.promise);
    const refresh = h.result.current.refreshGitData();
    h.ctx.projectIdRef.current = "other";
    pending.resolve(session({ modifiedContent: "stale" }));
    await refresh;
    expect(h.state.gitDiffSession.modifiedContent).toBe("edited");
  });
  it("activates and closes diffs, restoring the previous editor", async () => {
    const h = setup();
    await h.result.current.activateGitDiffSession(session() as any);
    expect(h.state.activePath).toBe("");
    expect(h.state.gitBlameLines).toEqual(["blame"]);
    h.result.current.closeGitDiffSession();
    expect(h.state.activePath).toBe("/p/main.tex");
    expect(h.ctx.gitDiffSessionRef.current).toBeNull();
  });
  it("does not apply stale blame to a newly selected diff", async () => {
    const h = setup();
    const pending = deferred<any>();
    api.getGitBlame.mockReturnValue(pending.promise);
    const activation = h.result.current.activateGitDiffSession(session() as any);
    h.ctx.gitDiffSessionIdRef.current = "other";
    pending.resolve(["stale"]);
    await activation;
    expect(h.state.gitBlameLines).toEqual([]);
  });
  it("reloads clean buffers while preserving unsaved edits and closes missing files", async () => {
    const h = setup({
      documentsRef: {
        current: [doc(), doc("dirty.tex", "edited", "old"), doc("missing.tex")],
      },
      documents: [doc(), doc("dirty.tex", "edited", "old"), doc("missing.tex")],
    });
    api.readFile.mockImplementation((_p: string, path: string) =>
      path === "missing.tex"
        ? Promise.reject(new Error("missing"))
        : Promise.resolve("disk"),
    );
    api.fileExists.mockResolvedValue(false);
    await h.result.current.reloadOpenDocumentsFromDisk();
    expect(h.state.documents[0].content).toBe("disk");
    expect(h.state.documents[1].content).toBe("edited");
    expect(h.ctx.closeDocument).toHaveBeenCalledWith("/p/missing.tex");
    expect(api.readFile).not.toHaveBeenCalledWith("p", "dirty.tex");
    await h.result.current.reloadOpenDocumentsFromDisk({
      paths: ["dirty.tex"],
      includeUnsaved: true,
    });
    expect(h.state.documents[1]).toMatchObject({
      content: "disk",
      savedContent: "disk",
    });
  });
  it("ignores reload results after the project changes", async () => {
    const h = setup();
    const pending = deferred<string>();
    api.readFile.mockReturnValue(pending.promise);
    const reload = h.result.current.reloadOpenDocumentsFromDisk();
    h.ctx.projectIdRef.current = "other";
    pending.resolve("stale");
    await reload;
    expect(h.ctx.setDocuments).not.toHaveBeenCalled();
  });
  it.each([
    ["stageGitEntry", "stageGitFile"],
    ["unstageGitEntry", "unstageGitFile"],
    ["stageAllGitEntries", "stageAllGit"],
    ["unstageAllGitEntries", "unstageAllGit"],
  ] as const)("runs %s and releases busy state on failure", async (method, ipc) => {
    const h = setup();
    await h.result.current[method]("main.tex");
    expect(api[ipc]).toHaveBeenCalled();
    expect(h.state.gitActionBusy).toBeNull();
    api[ipc].mockRejectedValue(new Error("denied"));
    await h.result.current[method]("main.tex");
    expect(h.state.statusMessage).toBe("denied");
    expect(h.state.gitActionBusy).toBeNull();
  });
  it("commits successfully and preserves the message after failure", async () => {
    const h = setup();
    expect(await h.result.current.commitGitChanges()).toBe(true);
    expect(api.commitGit).toHaveBeenCalledWith("p", "Fix");
    expect(h.state.gitCommitMessage).toBe("");
    api.commitGit.mockRejectedValue(new Error("conflict"));
    expect(await h.result.current.commitGitChanges()).toBe(false);
    expect(h.state.statusMessage).toBe("conflict");
  });
  it("discards unsaved text from disk only after confirmation", async () => {
    const h = setup();
    api.discardGitFile.mockResolvedValueOnce({ discarded: false });
    await h.result.current.discardGitEntry("main.tex");
    expect(api.readFile).not.toHaveBeenCalled();
    await h.result.current.discardGitEntry("main.tex");
    expect(h.state.documents[0].content).toBe("disk");
    expect(h.ctx.refreshProject).toHaveBeenCalledWith("p");
  });
  it("refreshes after terminal commands and reports explicit refresh errors", async () => {
    const h = setup();
    await h.result.current.refreshSourceControl();
    expect(h.state.statusMessage).toBe("Source control refreshed");
    h.ctx.refreshProject.mockRejectedValue(new Error("offline"));
    await h.result.current.refreshSourceControl();
    expect(h.state.statusMessage).toBe("offline");
    await h.result.current.refreshAfterTerminalCommand();
    expect(h.ctx.gitRefreshTimerRef.current).not.toBeNull();
  });
});
