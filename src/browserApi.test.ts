import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserApis } from "./browserApi";
import type { LatexDoApi } from "../electron/preload.cjs";

let api: LatexDoApi;
const key = "latexdo.browser.workspace.v1";
beforeEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(window, "latexdo");
  Reflect.deleteProperty(window, "terminalApi");
  vi.stubEnv("VITE_LATEXDO_RUNTIME", "browser");
  installBrowserApis();
  api = window.latexdo!;
  vi.spyOn(window, "open").mockReturnValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "latexdo");
  Reflect.deleteProperty(window, "terminalApi");
});

describe("browser workspace persistence", () => {
  it("initializes a workspace, restores it and never replaces the installed bridge", async () => {
    const project = await api.openProject();
    expect(project?.rootPath).toMatch(/^browser:/);
    expect(await api.readFile(project!.id, "main.tex")).toContain("\\documentclass");
    expect(await api.openProject()).toEqual(project);
    installBrowserApis();
    expect(window.latexdo).toBe(api);
    expect(await api.restoreCloudProject()).toBeNull();
    const second = await api.createProject({ folderName: "Second paper" });
    expect(second?.id).not.toBe(project?.id);
    expect(second?.name).toBe("Second paper");
    expect((await api.createResearchSpace())?.name).toBe("Research Space");
  });
  it.each([
    "not JSON",
    "null",
    JSON.stringify({ projects: [null, {}, 42], currentProjectId: 12 }),
    JSON.stringify({
      projects: [],
      proofreadingSettings: {},
      spellCheckerSettings: {},
    }),
  ])(
    "recovers invalid local storage without reusing invalid records",
    async (stored) => {
      localStorage.setItem(key, stored);
      const project = await api.openProject();
      expect(project?.id).toBeTruthy();
      expect((await api.getProofreadingSettings()).enabled).toBe(false);
      expect((await api.getSpellCheckerSettings()).enabled).toBe(true);
    },
  );
  it("creates nested files, normalizes paths and hides internal history from the tree", async () => {
    const { id } = (await api.openProject())!;
    await api.createFolder(id, "chapters");
    await api.createFolder(id, "chapters/sub");
    await api.createFile(id, "chapters/refs.bib");
    expect(await api.readFile(id, "chapters/refs.bib")).toContain("BibTeX");
    await api.writeFile(id, "chapters\\sub\\note.tex", "Saved");
    await api.createFile(id, "chapters/sub/note.tex");
    expect(await api.readFile(id, "chapters/sub/note.tex")).toBe("Saved");
    expect(await api.readAsset(id, "chapters/sub/note.tex")).toEqual(
      new TextEncoder().encode("Saved"),
    );
    expect(await api.fileExists(id, "chapters/sub")).toBe(true);
    expect(await api.fileExists(id, "absent")).toBe(false);
    await api.writeFile(id, ".latexdo/history/snapshot", "internal");
    const tree = await api.listProject(id);
    expect(tree[0].type).toBe("directory");
    expect(tree.some((entry) => entry.name === ".latexdo")).toBe(false);
    await expect(api.createFolder(id, "missing/nested")).rejects.toThrow(
      "parent folder",
    );
    await expect(api.readFile(id, "absent")).rejects.toThrow("does not exist");
    await expect(api.readAsset(id, "absent")).rejects.toThrow("does not exist");
    await expect(api.listProject("missing")).rejects.toThrow("not open");
  });
  it.each(["..", "../outside", "a/../secret", "", "."])(
    "rejects invalid paths %s",
    async (invalid) => {
      const { id } = (await api.openProject())!;
      await expect(api.writeFile(id, invalid, "bad")).rejects.toThrow("relative path");
    },
  );
  it("moves a folder subtree without losing contents or replacing another file", async () => {
    const { id } = (await api.openProject())!;
    await api.createFolder(id, "old");
    await api.createFolder(id, "old/sub");
    await api.writeFile(id, "old/sub/a.tex", "alpha");
    await api.moveEntry(id, "old", "new");
    expect(await api.readFile(id, "new/sub/a.tex")).toBe("alpha");
    expect(await api.fileExists(id, "old/sub/a.tex")).toBe(false);
    await expect(api.moveEntry(id, "new", "new/inside")).rejects.toThrow("into itself");
    await expect(api.moveEntry(id, "new/sub/a.tex", "main.tex")).rejects.toThrow(
      "already exists",
    );
    await expect(api.moveEntry(id, "missing", "target")).rejects.toThrow(
      "does not exist",
    );
    await api.moveEntry(id, "new/sub/a.tex", "renamed.tex");
    expect(await api.readFile(id, "renamed.tex")).toBe("alpha");
  });
  it("round-trips settings independently of project contents", async () => {
    const settings = {
      ...(await api.getSpellCheckerSettings()),
      enabled: false,
      customWords: ["LatexDo"],
    };
    expect(await api.updateSpellCheckerSettings(settings)).toEqual(settings);
    expect(await api.getSpellCheckerSettings()).toEqual(settings);
    const grammar = {
      ...(await api.getProofreadingSettings()),
      language: "fr",
      enabled: true,
    };
    await api.updateProofreadingSettings(grammar);
    expect(await api.getProofreadingSettings()).toEqual(grammar);
    expect(await api.proofreadDocument("main.tex", "hello")).toMatchObject({
      diagnostics: [],
      checkedTextLength: 5,
    });
  });
});

describe("browser capabilities are explicit", () => {
  it.each([
    "importOverleafProject",
    "importExternalFiles",
    "chooseImportExternalFiles",
    "importDocx",
    "importMarkdown",
    "importPdf",
    "createCollaborationLink",
    "rotateCollaborationLink",
    "joinCollaboration",
    "getCollaborationPermissions",
    "updateCollaborationPermission",
    "removeCollaborator",
    "stageGitFile",
    "unstageGitFile",
    "commitGit",
    "stageAllGit",
    "unstageAllGit",
    "revealGitFile",
    "collectGarbage",
  ] as const)("%s rejects desktop-only operations", async (method) => {
    await expect(
      (api[method] as (...args: unknown[]) => Promise<unknown>)("project", "main.tex"),
    ).rejects.toThrow("desktop app");
  });
  it("returns unavailable states for compilation, git, updates and collaboration", async () => {
    const { id } = (await api.openProject())!;
    expect(
      (await api.compile({ projectId: id, rootFile: "main.tex", engine: "pdflatex" }))
        .ok,
    ).toBe(false);
    expect(
      (await api.compileAsymptote({ projectId: id, relativePath: "a.asy" })).ok,
    ).toBe(false);
    expect(await api.cancelCompile(id)).toBe(false);
    expect(await api.readPdf(id, "main.pdf")).toHaveLength(0);
    expect(await api.forwardSyncTex(id, "main.pdf", "main.tex", 1, 1)).toBeNull();
    expect(await api.backwardSyncTex(id, "main.pdf", 1, 0, 0)).toBeNull();
    expect((await api.getGitStatus(id)).isRepo).toBe(false);
    expect((await api.getGitHistory(id)).commits).toEqual([]);
    expect(await api.discardGitFile(id, "main.tex")).toEqual({ discarded: false });
    expect(await api.discardAllGit(id)).toEqual({ discarded: false });
    expect((await api.getGitDiff(id, "main.tex")).path).toBe("main.tex");
    expect((await api.getGitEditorDiff(id, "main.tex", "staged")).originalLabel).toBe(
      "HEAD",
    );
    expect((await api.getGitEditorDiff(id, "main.tex")).originalLabel).toBe("Index");
    expect((await api.getGitCommitFileDiff(id, "main.tex", "abc")).modifiedLabel).toBe(
      "Commit",
    );
    expect((await api.getGitCommitDetails(id, "abc")).changedFiles).toEqual([]);
    expect(await api.getGitBlame(id, "main.tex", { kind: "empty" })).toEqual([]);
    expect((await api.getCollaborationState(id)).enabled).toBe(false);
    expect((await api.updateCollaborationPresence(id)).users).toEqual([]);
    expect(await api.isProjectAdmin(id)).toBe(false);
    expect((await api.checkForUpdates()).updateAvailable).toBe(false);
    expect((await api.lastUpdateStatus()).status).toBe("none");
    expect((await api.getWhatsNew()).shouldPresent).toBe(false);
    expect(await api.markWhatsNewPresented("0.3.0")).toEqual({ ok: true });
    expect((await api.updateNow()).opened).toBe(false);
    expect(await api.openReleaseNotesPage()).toEqual({ opened: true });
    expect(api.getDroppedFilePaths([])).toEqual([]);
  });
  it("opens external links without exposing window.opener and reports fetch errors", async () => {
    await api.openExternalUrl("https://example.org/");
    expect(window.open).toHaveBeenCalledWith(
      "https://example.org/",
      "_blank",
      "noopener,noreferrer",
    );
    await api.openReleasesPage();
    expect(window.open).toHaveBeenCalledWith(
      "https://latexdo.org/downloads/",
      "_blank",
      "noopener,noreferrer",
    );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"items":[]}'))
      .mockResolvedValueOnce(new Response('{"extensions":[]}'))
      .mockResolvedValue(new Response("error", { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await api.fetchScholarlyJson("https://api.crossref.org/works")).toEqual({
      items: [],
    });
    expect(await api.fetchExtensionCatalog()).toEqual({ extensions: [] });
    await expect(
      api.fetchScholarlyJson("https://api.crossref.org/works"),
    ).rejects.toThrow("503");
    await expect(api.fetchExtensionCatalog()).rejects.toThrow("503");
  });
  it("provides harmless subscription cleanup in browser mode", () => {
    for (const method of [
      "onGitChanged",
      "onWhatsNewOpen",
      "onUpdateProgress",
      "onCompileProgress",
      "onOpenSpellCheckerSettings",
      "onOpenProjectMenu",
      "onCreateFileMenu",
      "onCreateFolderMenu",
      "onImportDocxMenu",
      "onImportMarkdownMenu",
      "onImportPdfMenu",
      "onCloseTabMenu",
    ] as const) {
      const callback = vi.fn();
      api[method](callback)();
      expect(callback).not.toHaveBeenCalled();
    }
  });
  it("makes the terminal placeholder explicit and stops events after unsubscribe", async () => {
    vi.useFakeTimers();
    const terminal = window.terminalApi!;
    const data = vi.fn(),
      exit = vi.fn();
    const offData = terminal.onData(data),
      offExit = terminal.onExit(exit);
    const { id } = await terminal.create({ projectId: "browser" });
    await vi.advanceTimersByTimeAsync(50);
    expect(data).toHaveBeenCalledWith({
      id,
      data: expect.stringContaining("placeholder"),
    });
    terminal.write(id, "ls");
    expect(data).toHaveBeenLastCalledWith({
      id,
      data: expect.stringContaining("unavailable"),
    });
    const calls = data.mock.calls.length;
    terminal.write(id, " ");
    expect(data).toHaveBeenCalledTimes(calls);
    terminal.resize(id, 80, 24);
    terminal.dispose(id);
    expect(exit).toHaveBeenCalledWith({ id, exitCode: 0 });
    offData();
    offExit();
    terminal.write(id, "hello");
    terminal.dispose(id);
    expect(data).toHaveBeenCalledTimes(calls);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
