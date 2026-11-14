/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as monaco from "monaco-editor";
import { useAppGitNavigation } from "./useAppGitNavigation";
import type { AppCtx12 } from "./appContext";
import { hookContext } from "./__tests__/hookHarness";
import { editorHarness } from "./__tests__/editorHarness";
import { updateRecheckOnFocusMs } from "../features/pdf/updateFormatting";
const listeners: Record<string, any> = {};
const api: Record<string, any> = {};
function setup(overrides = {}) {
  const e = editorHarness();
  const entry = { ...e.document, type: "file" };
  const { ctx, state } = hookContext(
    {
      activeDocument: e.document,
      activePath: e.document.path,
      activePathRef: { current: e.document.path },
      activeSidebar: "sourceControl",
      documents: [e.document],
      documentsRef: { current: [e.document] },
      editorRef: { current: e.editor },
      allProjectEntries: [entry],
      projectEntries: [entry],
      projectEntriesRef: { current: [entry] },
      projectId: "p",
      projectIdRef: { current: "p" },
      rootFileRef: { current: "main.tex" },
      gitFileHistoryPathRef: { current: "" },
      gitRefreshTimerRef: { current: null },
      gitRowClickTimerRef: { current: null },
      editorPathBeforeWelcomeRef: { current: e.document.path },
      pendingSourceRef: { current: null },
      unstagedGitEntries: [{ path: "main.tex" }],
      previewShown: false,
      showWelcome: true,
      hideProjectEntries: false,
      compileProgress: 0,
      gitContextMenu: null,
      collaborationState: {
        enabled: true,
        users: [
          { clientId: "ada", name: "Ada", currentFile: "main.tex", lastSeen: 0 },
          { clientId: "bo", name: "Bo", currentFile: "other.tex", lastSeen: 0 },
          { clientId: "cy", name: "", currentFile: null, lastSeen: 0 },
        ],
      },
      collaboratorLines: { ada: 3 },
      ...overrides,
    },
    [
      "setActivePath",
      "setCollapsedGitGroups",
      "setCompileProgress",
      "setDocuments",
      "setGitActionBusy",
      "setGitCommitDetails",
      "setGitCommitParentHash",
      "setGitContextMenu",
      "setGitFileHistory",
      "setGitFileHistoryPath",
      "setGitPanelTab",
      "setPreviewVisible",
      "setSelectedGitCommitHash",
      "setStatusMessage",
      "setUpdateAttemptStatus",
      "setUpdateInfo",
      "setUpdateProgress",
      "setWelcomeOpen",
      "setWhatsNew",
      "setWhatsNewOpen",
    ],
    [
      "reloadOpenDocumentsFromDisk",
      "activateGitDiffSession",
      "checkForUpdates",
      "closeGitDiffSession",
      "openDocument",
      "openWhatsNewDialog",
      "refreshGitData",
      "refreshProject",
      "revealPendingSource",
      "scheduleGitRefresh",
      "revealCollaborator",
      "followCollaboratorOnOpen",
    ],
  );
  ctx.refreshProject.mockResolvedValue([entry]);
  return {
    ...renderHook(() => useAppGitNavigation(ctx as AppCtx12)),
    ctx,
    state,
    ...e,
    entry,
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  for (const name of [
    "discardAllGit",
    "getGitCommitDetails",
    "getGitCommitFileDiff",
    "getGitEditorDiff",
    "getGitPatch",
    "revealGitFile",
    "getGitHistory",
    "lastUpdateStatus",
    "getWhatsNew",
  ])
    api[name] = vi.fn().mockResolvedValue({});
  api.discardAllGit.mockResolvedValue({ discarded: true });
  api.getGitCommitDetails.mockResolvedValue({ parents: ["parent"] });
  api.getGitEditorDiff.mockResolvedValue({
    originalLabel: "Index",
    modifiedLabel: "Working Tree",
  });
  api.getWhatsNew.mockResolvedValue({ shouldPresent: true });
  for (const name of [
    "onGitChanged",
    "onUpdateProgress",
    "onWhatsNewOpen",
    "onCompileProgress",
  ])
    api[name] = vi.fn((fn: any) => {
      listeners[name] = fn;
      return vi.fn();
    });
  window.latexdo = api as typeof window.latexdo;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});
afterEach(() => {
  cleanup();
  for (const model of monaco.editor.getModels()) model.dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe("Git navigation", () => {
  it("discards only changed buffers and resets busy state on cancellation or error", async () => {
    const h = setup();
    await h.result.current.discardAllGitEntries();
    expect(h.ctx.reloadOpenDocumentsFromDisk).toHaveBeenCalledWith({
      paths: ["main.tex"],
      includeUnsaved: true,
    });
    expect(h.state.gitActionBusy).toBeNull();
    h.ctx.reloadOpenDocumentsFromDisk.mockClear();
    api.discardAllGit.mockResolvedValueOnce({ discarded: false });
    await h.result.current.discardAllGitEntries();
    expect(h.ctx.reloadOpenDocumentsFromDisk).not.toHaveBeenCalled();
    expect(h.state.statusMessage).toBe("Discard canceled.");
    api.discardAllGit.mockRejectedValue(new Error("denied"));
    await h.result.current.discardAllGitEntries();
    expect(h.state.statusMessage).toBe("denied");
  });
  it("opens commit details and revision diffs", async () => {
    const h = setup();
    await h.result.current.openGitCommitDetails("abcdef123");
    expect(h.state.gitCommitParentHash).toBe("parent");
    expect(h.state.gitPanelTab).toBe("history");
    await h.result.current.openGitCommitRevisionDiff("abcdef123", "main.tex", "parent");
    expect(api.getGitCommitFileDiff).toHaveBeenCalledWith(
      "p",
      "main.tex",
      "abcdef123",
      "parent",
    );
    expect(h.ctx.activateGitDiffSession).toHaveBeenCalled();
    expect(h.state.statusMessage).toContain("abcdef1");
    expect(h.state.gitActionBusy).toBeNull();
  });
  it("goes to a person from their emoji: their cursor here, or their file", async () => {
    const h = setup();
    h.ctx.revealCollaborator.mockReturnValue(true);
    await h.result.current.goToCollaborator("ada");
    expect(h.ctx.revealCollaborator).toHaveBeenCalledWith("ada");
    expect(h.ctx.setWelcomeOpen).toHaveBeenCalledWith(false);
    expect(h.state.statusMessage).toBe("Ada is here, on line 3 in main.tex.");
    expect(h.ctx.followCollaboratorOnOpen).not.toHaveBeenCalled();

    // Their cursor has not arrived yet: jump once it does, without reopening.
    h.ctx.revealCollaborator.mockReturnValue(false);
    await h.result.current.goToCollaborator("ada");
    expect(h.ctx.followCollaboratorOnOpen).toHaveBeenLastCalledWith("ada");
    expect(h.ctx.openDocument).not.toHaveBeenCalled();

    // In another file: open it, then jump to them there.
    await h.result.current.goToCollaborator("bo");
    expect(h.ctx.followCollaboratorOnOpen).toHaveBeenLastCalledWith("bo");
    expect(h.ctx.refreshProject).toHaveBeenCalled();

    await h.result.current.goToCollaborator("cy");
    expect(h.state.statusMessage).toBe("Guest doesn’t have a file open right now.");
    await h.result.current.goToCollaborator("gone");
    expect(h.state.statusMessage).toBe("Guest is no longer in this project.");
  });

  it("opens working-tree files, refreshes missing entries and reports deletions", async () => {
    const h = setup();
    await h.result.current.openGitFile("main.tex");
    expect(h.ctx.openDocument).toHaveBeenCalledWith(h.entry);
    await h.result.current.openGitFile("missing.tex");
    expect(h.ctx.refreshProject).toHaveBeenCalled();
    expect(h.state.statusMessage).toContain("not present");
    await h.result.current.openGitDiffEditor({ path: "main.tex" } as any, "changes");
    expect(api.getGitEditorDiff).toHaveBeenCalledWith("p", "main.tex", "changes");
    await h.result.current.openGitFileHistory("main.tex");
    expect(api.getGitHistory).toHaveBeenCalledWith("p", "main.tex");
  });
  it("reveals paths, copies paths and reports reveal failures", async () => {
    const h = setup();
    await h.result.current.revealGitFile("main.tex");
    expect(h.state.statusMessage).toContain("Revealed");
    await h.result.current.copyGitPath("main.tex");
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("main.tex");
    api.revealGitFile.mockRejectedValue("missing");
    await h.result.current.revealGitFile("main.tex");
    expect(h.state.statusMessage).toContain("missing");
  });
  it("reacts to native progress events and ignores events from other projects", async () => {
    const h = setup();
    await act(async () => {});
    expect(h.state.whatsNewOpen).toBe(true);
    h.ctx.scheduleGitRefresh.mockClear();
    listeners.onGitChanged({ projectId: "other" });
    expect(h.ctx.scheduleGitRefresh).not.toHaveBeenCalled();
    listeners.onGitChanged({ projectId: "p" });
    expect(h.ctx.scheduleGitRefresh).toHaveBeenCalledOnce();
    listeners.onCompileProgress({ projectId: "p", progress: 70 });
    listeners.onCompileProgress({ projectId: "p", progress: 30 });
    listeners.onCompileProgress({ projectId: "other", progress: 100 });
    expect(h.state.compileProgress).toBe(70);
    for (const status of ["restarting", "installing", "error", "confirmed"]) {
      listeners.onUpdateProgress({
        status,
        currentVersion: "1",
        latestVersion: "2",
        message: "Failure",
      });
      expect(h.state.updateProgress.status).toBe(status);
    }
    expect(h.state.updateInfo.updateAvailable).toBe(false);
    listeners.onWhatsNewOpen();
    expect(h.ctx.openWhatsNewDialog).toHaveBeenCalledOnce();
  });
  it("rechecks updates on focus only after the cooldown and cleans up listeners", async () => {
    const h = setup();
    expect(h.ctx.checkForUpdates).toHaveBeenCalledWith({ silent: true });
    h.ctx.checkForUpdates.mockClear();
    window.dispatchEvent(new Event("focus"));
    expect(h.ctx.checkForUpdates).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(updateRecheckOnFocusMs));
    window.dispatchEvent(new Event("focus"));
    expect(h.ctx.checkForUpdates).toHaveBeenCalled();
    h.unmount();
    for (const name of Object.keys(listeners))
      expect(api[name].mock.results[0].value).toHaveBeenCalled();
  });
  it("dismisses context menus on outside clicks and Escape", () => {
    const h = setup({ gitContextMenu: { x: 1, y: 1 } });
    const menu = document.createElement("div");
    menu.className = "scm-context-menu";
    document.body.append(menu);
    menu.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(h.ctx.setGitContextMenu).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(h.state.gitContextMenu).toBeNull();
    window.dispatchEvent(new Event("pointerdown"));
    expect(h.ctx.setGitContextMenu).toHaveBeenCalledTimes(2);
    menu.remove();
  });
  it("copies the requested patch and reports clipboard failures", async () => {
    const h = setup();
    api.getGitPatch.mockResolvedValue("diff --git a/main.tex b/main.tex\n");
    await h.result.current.copyGitPatch("main.tex", "staged");
    expect(api.getGitPatch).toHaveBeenCalledWith("p", "main.tex", "staged");
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "diff --git a/main.tex b/main.tex\n",
    );
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(
      new Error("Clipboard denied"),
    );
    await h.result.current.copyGitPatch("main.tex", "changes");
    expect(h.state.statusMessage).toContain("Clipboard denied");
  });
  it("opens the root document when showing preview and restores welcome navigation", async () => {
    const h = setup();
    await h.result.current.togglePreview();
    expect(h.state.previewVisible).toBe(true);
    expect(h.ctx.openDocument).toHaveBeenCalledWith(h.entry);
    h.ctx.previewShown = true;
    h.rerender();
    await h.result.current.togglePreview();
    expect(h.state.previewVisible).toBe(false);
    h.ctx.activePath = "";
    h.rerender();
    h.result.current.closeWelcomePage();
    expect(h.state.activePath).toBe(h.document.path);
    h.ctx.hideProjectEntries = true;
    h.rerender();
    h.result.current.closeWelcomePage();
    expect(h.state.activePath).toBe("");
  });
  it("opens diagnostic locations with safe positions and reports missing sources", async () => {
    const h = setup();
    await h.result.current.openDiagnostic({
      file: "main.tex",
      line: 0,
      column: -2,
      severity: "error",
      message: "bad",
    } as any);
    expect(h.ctx.pendingSourceRef.current).toMatchObject({
      path: h.document.path,
      line: 1,
      column: 1,
    });
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(h.ctx.revealPendingSource).toHaveBeenCalled();
    await h.result.current.openDiagnostic({
      file: "absent.tex",
      line: 1,
      column: 1,
    } as any);
    expect(h.state.statusMessage).toContain("Could not locate");
  });
});
describe("LaTeX toolbar edits", () => {
  it.each([
    "bold",
    "italic",
    "underline",
    "math",
    "section",
    "subsection",
    "equation",
    "itemize",
    "enumerate",
    "cite",
    "ref",
    "href",
  ])("inserts %s with a selection and with placeholder text", (command) => {
    const h = setup();
    h.result.current.applyLatexToolbarCommand(command as any);
    expect(h.model.getValue()).not.toBe(h.document.content);
    expect(h.editor.focus).toHaveBeenCalled();
    expect(h.state.statusMessage).toMatch(/Inserted/);
    h.editor.setPosition({ lineNumber: 1, column: 1 });
    h.result.current.applyLatexToolbarCommand(command as any);
    expect(h.editor.executeEdits).toHaveBeenCalledTimes(2);
  });
  it("inserts a table block and formats its columns", () => {
    const h = setup();
    h.result.current.insertLatexTable(2, 3);
    expect(h.model.getValue()).toContain("\\begin{tabular}");
    expect(h.state.statusMessage).toBe("Inserted a 2 × 3 table.");
    h.model.setValue("\\begin{tabular}{ll}\na & bb \\\\\nccc & d \\\\\n\\end{tabular}");
    h.editor.setPosition({ lineNumber: 2, column: 2 });
    h.result.current.applyLatexToolbarCommand("formatTable");
    expect(h.state.statusMessage).toBe("Formatted LaTeX table columns.");
    h.model.setValue("plain text");
    h.result.current.applyLatexToolbarCommand("formatTable");
    expect(h.state.statusMessage).toContain("Place the cursor inside");
  });
  it("formats the document and updates the open buffer", () => {
    const h = setup();
    h.model.setValue("\\begin{itemize}\n\\item one\n\\item two\n\\end{itemize}");
    h.result.current.applyLatexPrettier();
    expect(h.state.statusMessage).toContain("formatted");
    expect(h.state.documents[0].content).toBe(h.model.getValue());
    expect(h.editor.pushUndoStop).toHaveBeenCalledTimes(2);
    h.ctx.documentsRef.current = [];
    h.result.current.insertLatexTable(1, 1);
    expect(h.state.statusMessage).toContain("Open a TeX file");
    h.result.current.applyLatexToolbarCommand("bold");
    expect(h.state.statusMessage).toContain("Open a TeX file");
  });
});
