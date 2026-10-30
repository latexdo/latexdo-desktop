import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { LatexDoApi, AiApi, TerminalApi } from "./preload.cjs";

const bridge = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  invoke: vi.fn(),
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  getPathForFile: vi.fn(),
}));
vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => bridge.exposed.set(name, api),
  },
  ipcRenderer: bridge,
  webUtils: { getPathForFile: bridge.getPathForFile },
}));
let api: LatexDoApi;
let ai: AiApi;
let terminal: TerminalApi;
const fetchMock = vi.fn();
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  bridge.invoke.mockResolvedValue({ ok: true });
  // These suites cover a configured collaboration server; hosting from this
  // computer is covered separately below.
  vi.stubEnv("VITE_LATEXDO_API_BASE_URL", "https://collab.example.org");
  await import("./preload.cjs");
  api = bridge.exposed.get("latexdo") as LatexDoApi;
  ai = bridge.exposed.get("aiApi") as AiApi;
  terminal = bridge.exposed.get("terminalApi") as TerminalApi;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("isolated desktop bridge", () => {
  it("stops restoring an older cloud project after switching to a local folder", async () => {
    localStorage.setItem("latexdo.cloud.activeProject", "project_a");
    api.rememberActiveProject("local-project-id");
    expect(localStorage.getItem("latexdo.cloud.activeProject")).toBeNull();
    expect(await api.restoreCloudProject()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("exposes only the application, terminal and AI APIs", () => {
    expect([...bridge.exposed.keys()]).toEqual(["latexdo", "terminalApi", "aiApi"]);
    expect(api.runtime).toBe("desktop");
    expect(api).not.toHaveProperty("ipcRenderer");
  });

  it("passes the new-window startup flag through the isolated bridge", async () => {
    expect(api.startWithEmptyWorkspace).toBe(false);
    const originalArgv = process.argv;
    try {
      process.argv = [...originalArgv, "--latexdo-empty-workspace"];
      vi.resetModules();
      await import("./preload.cjs");
      expect(
        (bridge.exposed.get("latexdo") as LatexDoApi).startWithEmptyWorkspace,
      ).toBe(true);
    } finally {
      process.argv = originalArgv;
    }
  });

  const contracts: [keyof LatexDoApi, string, unknown[]][] = [
    ["openProject", "project:open", []],
    ["reopenLastProject", "project:reopen-last", []],
    ["createProject", "project:create", []],
    ["createProject", "project:create", [{ folderName: "paper" }]],
    ["createResearchSpace", "research-space:create", []],
    ["saveResearchSpaceAs", "research-space:save-as", ["local"]],
    ["addFolderToResearchSpace", "research-space:add-folder", ["local"]],
    ["getMenuShortcuts", "app:menu-shortcuts", []],
    [
      "importOverleafProject",
      "provider:import-overleaf-project",
      ["https://git.overleaf.com/paper"],
    ],
    ["listProject", "project:list", ["local"]],
    ["listProject", "project:list", ["local", { maxDepth: 2 }]],
    ["readFile", "file:read", ["local", "main.tex"]],
    ["readAsset", "asset:read", ["local", "image.PNG"]],
    ["writeFile", "file:write", ["local", "main.tex", "hello"]],
    ["fileExists", "file:exists", ["local", "main.tex"]],
    ["createFile", "file:create", ["local", "chapter.tex"]],
    ["createFolder", "folder:create", ["local", "chapters"]],
    ["moveEntry", "entry:move", ["local", "old.tex", "new.tex"]],
    [
      "importExternalFiles",
      "file:import-external",
      ["local", "images", ["/tmp/photo.png"]],
    ],
    ["chooseImportExternalFiles", "file:choose-import-external", ["local", "images"]],
    ["importDocx", "docx:import", ["local"]],
    ["importMarkdown", "markdown:import", ["local"]],
    ["importPdf", "pdf:import", ["local"]],
    ["getGitStatus", "git:status", ["local"]],
    ["stageGitFile", "git:stage", ["local", "main.tex"]],
    ["unstageGitFile", "git:unstage", ["local", "main.tex"]],
    ["commitGit", "git:commit", ["local", "Save paper"]],
    ["getGitDiff", "git:diff", ["local", "main.tex"]],
    ["getGitPatch", "git:patch", ["local", "main.tex", "staged"]],
    ["discardGitFile", "git:discard", ["local", "main.tex"]],
    ["stageAllGit", "git:stage-all", ["local"]],
    ["unstageAllGit", "git:unstage-all", ["local"]],
    ["discardAllGit", "git:discard-all", ["local"]],
    ["getGitEditorDiff", "git:editor-diff", ["local", "main.tex", "staged"]],
    ["getGitHistory", "git:history", ["local", "main.tex"]],
    ["getGitCommitDetails", "git:commit-details", ["local", "abc"]],
    ["getGitCommitFileDiff", "git:commit-file-diff", ["local", "main.tex", "abc"]],
    [
      "getGitCommitFileDiff",
      "git:commit-file-diff",
      ["local", "main.tex", "abc", "parent"],
    ],
    ["getGitBlame", "git:blame", ["local", "main.tex", { kind: "working" }]],
    ["revealGitFile", "git:reveal-file", ["local", "main.tex"]],
    ["checkForUpdates", "app:check-updates", []],
    ["updateNow", "app:update-now", []],
    ["lastUpdateStatus", "app:last-update-status", []],
    ["getWhatsNew", "app:whats-new", []],
    ["markWhatsNewPresented", "app:whats-new-mark-presented", ["0.3.0"]],
    ["openReleaseNotesPage", "app:whats-new-open-notes", []],
    ["openReleasesPage", "app:open-releases", ["https://latexdo.org/downloads/"]],
    ["openExternalUrl", "app:open-external", ["https://example.org/"]],
    ["fetchScholarlyJson", "scholarly:fetch-json", ["https://api.crossref.org/works"]],
    ["fetchOrcidProfile", "orcid:fetch-profile", ["0000-0001-2345-6789"]],
    ["fetchExtensionCatalog", "extensions:get-catalog", []],
    ["getSpellCheckerSettings", "spellchecker:get-settings", []],
    [
      "updateSpellCheckerSettings",
      "spellchecker:update-settings",
      [{ enabled: false }],
    ],
    ["getProofreadingSettings", "proofread:get-settings", []],
    ["updateProofreadingSettings", "proofread:update-settings", [{ enabled: false }]],
    ["proofreadDocument", "proofread:check", ["main.tex", "Text"]],
    [
      "proofreadDocument",
      "proofread:check",
      ["main.tex", "Text", { language: "en-US" }],
    ],
    [
      "compile",
      "latex:compile",
      [{ projectId: "local", rootFile: "main.tex", engine: "pdflatex" }],
    ],
    ["cancelCompile", "latex:compile-cancel", ["local"]],
    [
      "compileAsymptote",
      "asymptote:compile",
      [{ projectId: "local", relativePath: "plot.asy" }],
    ],
    ["readPdf", "pdf:read", ["local", "main.pdf"]],
    ["collectGarbage", "workspace:collect-garbage", ["local"]],
    ["collectGarbage", "workspace:collect-garbage", ["local", { maxBuildBytes: 100 }]],
    ["forwardSyncTex", "synctex:forward", ["local", "main.pdf", "main.tex", 2, 4]],
    ["backwardSyncTex", "synctex:backward", ["local", "main.pdf", 1, 20, 30]],
    ["reportRendererIssue", "app:renderer-diagnostic", [{ message: "broken view" }]],
  ];
  it.each(contracts)(
    "%s preserves the IPC contract for %s",
    async (method, channel, args) => {
      const result = await (api[method] as (...args: unknown[]) => unknown)(...args);
      expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith(channel, ...args);
      expect(result).toEqual({ ok: true });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    "",
    "/etc/passwd",
    "../secret",
    "a/../secret",
    "C:\\secret",
    "https://evil/a",
    ".git/config",
    "node_modules/pkg/a",
    "a\u0000b",
  ])("rejects unsafe desktop reads: %s", async (file) => {
    await expect(api.readFile("local", file)).rejects.toThrow(
      "Invalid desktop API input",
    );
    await expect(api.readAsset("local", file)).rejects.toThrow(
      "Invalid desktop API input",
    );
    expect(await api.fileExists("local", file)).toBe(false);
    expect(bridge.invoke).not.toHaveBeenCalled();
  });
  it.each(["", "bad\nproject"])("rejects malformed project identifiers", async (id) => {
    await expect(api.readFile(id, "main.tex")).rejects.toThrow();
    expect(await api.fileExists(id, "main.tex")).toBe(false);
  });
  it("restricts asset reads to supported formats and resolves dropped file paths", async () => {
    await expect(api.readAsset("local", "secret.txt")).rejects.toThrow();
    bridge.getPathForFile.mockReturnValueOnce("/tmp/a.pdf").mockReturnValueOnce("");
    expect(
      api.getDroppedFilePaths([new File([], "a.pdf"), new File([], "virtual")]),
    ).toEqual(["/tmp/a.pdf"]);
  });

  const events = [
    ["onGitChanged", "git:changed", true],
    ["onWhatsNewOpen", "app:open-whats-new", false],
    ["onUpdateProgress", "app:update-progress", true],
    ["onCompileProgress", "compile:progress", true],
    ["onOpenSpellCheckerSettings", "tools:open-spellchecker", false],
    ["onOpenProjectMenu", "file:open-project", false],
    ["onCreateFileMenu", "file:create-dialog", false],
    ["onCreateFolderMenu", "folder:create-dialog", false],
    ["onImportDocxMenu", "file:import-docx", false],
    ["onImportMarkdownMenu", "file:import-markdown", false],
    ["onImportPdfMenu", "file:import-pdf", false],
    ["onCloseTabMenu", "file:close-tab", false],
  ] as const;
  it("passes only a command id from the application menu", () => {
    const callback = vi.fn();
    const stop = api.onMenuCommand(callback);
    const listener = bridge.on.mock.calls[0][1];
    listener({ sender: "privileged" }, "go.file");
    listener({ sender: "privileged" }, { command: "go.file" });
    expect(callback.mock.calls).toEqual([["go.file"]]);
    stop();
    expect(bridge.removeListener).toHaveBeenCalledExactlyOnceWith(
      "menu:command",
      listener,
    );
  });
  it.each(events)(
    "%s strips privileged events and removes its listener",
    (method, channel, hasPayload) => {
      const callback = vi.fn();
      const stop = api[method](callback);
      const listener = bridge.on.mock.calls[0][1];
      const payload = { projectId: "local" };
      listener({ sender: "privileged" }, payload);
      expect(callback.mock.calls).toEqual([hasPayload ? [payload] : []]);
      stop();
      expect(bridge.removeListener).toHaveBeenCalledExactlyOnceWith(channel, listener);
    },
  );
});

describe("cloud routing and recovery", () => {
  it("uses authenticated HTTP for cloud files, with URL encoding and stable identities", async () => {
    localStorage.setItem("latexdo.cloud.clientName", " Ada ");
    fetchMock.mockResolvedValue(
      json({ content: "hello", exists: true, relativePath: "new.tex" }),
    );
    expect(await api.readFile("project_a", "dir/a b.tex")).toBe("hello");
    const first = fetchMock.mock.calls[0];
    expect(first[0]).toContain(
      "/api/projects/project_a/files/content?path=dir%2Fa%20b.tex",
    );
    expect(first[1].headers).toMatchObject({
      "x-latexdo-client-name": "Ada",
      "x-latexdo-session": expect.stringMatching(/^session-/),
    });
    fetchMock.mockImplementation(async () =>
      json({
        content: "hello",
        base64: btoa("hello"),
        exists: true,
        relativePath: "new.tex",
      }),
    );
    expect(await api.fileExists("project_a", "main.tex")).toBe(true);
    expect(await api.createFile("project_a", "new.tex")).toBe("new.tex");
    expect(await api.createFolder("project_a", "new")).toBe("new.tex");
    expect(await api.moveEntry("project_a", "old.tex", "new.tex")).toBe("new.tex");
    // Figures are read as files, not text.
    expect([...(await api.readAsset("project_a", "image.svg"))]).toEqual([
      ...new TextEncoder().encode("hello"),
    ]);
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
      "/api/projects/project_a/files/binary?path=image.svg",
    );
    await api.writeFile("project_a", "main.tex", "updated");
    expect(fetchMock.mock.calls.at(-1)?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ content: "updated" }),
    });
    expect(fetchMock.mock.calls.at(-1)?.[1].headers["x-latexdo-session"]).toBe(
      first[1].headers["x-latexdo-session"],
    );
    expect(bridge.invoke).not.toHaveBeenCalled();
  });
  it("joins a share URL, remembers the token and manages permissions", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        project: { id: "project_a", name: "Shared" },
        collaboration: { enabled: true, users: [] },
      }),
    );
    const opened = await api.joinCollaboration(
      "https://collab.example.org/#share=secret",
    );
    if (opened.pending) throw new Error("The share should open without approval.");
    expect(opened.collaboration.shareUrl).toContain("share=secret");
    expect(localStorage.getItem("latexdo.cloud.activeProject")).toBe("project_a");
    fetchMock.mockImplementation(async () =>
      json({
        enabled: true,
        users: [],
        permissions: [],
        isAdmin: true,
        currentUserRole: "admin",
      }),
    );
    expect((await api.getCollaborationState("project_a")).token).toBe("secret");
    expect((await api.updateCollaborationPresence("project_a", "main.tex")).token).toBe(
      "secret",
    );
    expect(await api.isProjectAdmin("project_a")).toBe(true);
    expect((await api.getCollaborationPermissions("project_a")).isAdmin).toBe(true);
    await api.updateCollaborationPermission("project_a", {
      clientId: "other",
      role: "viewer",
    });
    await api.removeCollaborator("project_a", "other/user");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("/collaborators/other%2Fuser");
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await api.isProjectAdmin("project_a")).toBe(false);
    expect((await api.getCollaborationPermissions("project_a")).currentUserRole).toBe(
      "viewer",
    );
  });
  it("fails closed for local projects without collaboration grants", async () => {
    expect(await api.getCollaborationState("local")).toEqual({
      enabled: false,
      users: [],
    });
    expect(await api.updateCollaborationPresence("local")).toEqual({
      enabled: false,
      users: [],
    });
    expect(await api.isProjectAdmin("local")).toBe(false);
    expect((await api.getCollaborationPermissions("local")).isAdmin).toBe(false);
    await expect(
      api.updateCollaborationPermission("local", { clientId: "x", role: "editor" }),
    ).rejects.toThrow("No share token");
    await expect(api.removeCollaborator("local", "x")).rejects.toThrow(
      "No share token",
    );
    await expect(api.rotateCollaborationLink("local")).rejects.toThrow(
      "not been shared",
    );
    await expect(api.joinCollaboration(" ")).rejects.toThrow("Paste");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("restores owned projects, and clears a deleted shared project", async () => {
    expect(await api.restoreCloudProject()).toBeNull();
    localStorage.setItem("latexdo.cloud.activeProject", "project_a");
    fetchMock.mockResolvedValueOnce(
      json({ projects: [{ id: "project_a", name: "Paper" }] }),
    );
    expect(await api.restoreCloudProject()).toEqual({
      id: "project_a",
      name: "Paper",
      rootPath: "",
    });
    fetchMock.mockResolvedValueOnce(json({ projects: [] }));
    expect(await api.restoreCloudProject()).toBeNull();
    expect(localStorage.getItem("latexdo.cloud.activeProject")).toBeNull();
    localStorage.setItem("latexdo.cloud.activeProject", "project_a");
    localStorage.setItem(
      "latexdo.cloud.shareTokens",
      JSON.stringify({ project_a: "old" }),
    );
    fetchMock
      .mockResolvedValueOnce(json({ projects: [] }))
      .mockResolvedValueOnce(json({ error: "gone" }, 404));
    expect(await api.restoreCloudProject()).toBeNull();
  });
  it.each([
    "stageGitFile",
    "unstageGitFile",
    "stageAllGit",
    "unstageAllGit",
    "commitGit",
    "getGitEditorDiff",
    "getGitCommitDetails",
    "getGitCommitFileDiff",
    "revealGitFile",
    "importDocx",
    "importMarkdown",
    "importPdf",
  ] as const)("rejects unsupported %s on cloud projects", async (method) => {
    await expect(
      (api[method] as (...args: unknown[]) => unknown)("project_a", "file.tex", "hash"),
    ).rejects.toThrow(/not available|Back to my folder/);
    expect(bridge.invoke).not.toHaveBeenCalled();
  });
  it("adds dropped files and folders to a shared project, text as text", async () => {
    bridge.invoke.mockResolvedValueOnce([
      { sourcePath: "/x/intro.tex", relativePath: "intro.tex", content: "Hi" },
      { sourcePath: "/x/figs/a.png", relativePath: "figs/a.png", base64: "iVBO" },
    ]);
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    const imported = await api.importExternalFiles("project_a", "chapters", [
      "/x/intro.tex",
      "/x/figs",
    ]);
    expect(bridge.invoke).toHaveBeenCalledWith("file:read-external-for-share", [
      "/x/intro.tex",
      "/x/figs",
    ]);
    expect(imported.map((entry) => entry.relativePath)).toEqual([
      "chapters/intro.tex",
      "chapters/figs/a.png",
    ]);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(
      urls.some((url) => url.includes("files/content?path=chapters%2Fintro.tex")),
    ).toBe(true);
    expect(
      urls.some((url) => url.includes("files/binary?path=chapters%2Ffigs%2Fa.png")),
    ).toBe(true);
  });
  it("returns explicit empty git state for cloud documents", async () => {
    expect((await api.getGitStatus("project_a")).isRepo).toBe(false);
    expect((await api.getGitDiff("project_a", "main.tex")).diff).toContain(
      "not available",
    );
    expect(await api.discardGitFile("project_a", "main.tex")).toEqual({
      discarded: false,
    });
    expect(await api.discardAllGit("project_a")).toEqual({ discarded: false });
    expect((await api.getGitHistory("project_a")).commits).toEqual([]);
    expect(
      await api.getGitBlame("project_a", "main.tex", { kind: "working" } as never),
    ).toEqual([]);
    expect(
      (
        await api.compileAsymptote({
          projectId: "project_a",
          relativePath: "plot.asy",
        } as never)
      ).ok,
    ).toBe(false);
  });
  it("materializes shared files before invoking the local compiler", async () => {
    // One request brings the whole project, figures included.
    fetchMock.mockResolvedValueOnce(
      json({
        files: [
          { relativePath: "chapters/main.tex", content: "document" },
          { relativePath: "figures/plot.png", base64: "iVBORw==" },
        ],
      }),
    );
    const request = {
      projectId: "project_a",
      rootFile: "chapters/main.tex",
      engine: "pdflatex" as const,
    };
    expect(await api.compile(request)).toEqual({ ok: true });
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
      "/api/projects/project_a/files/bundle",
    );
    expect(bridge.invoke).toHaveBeenCalledWith("latex:compile-cloud", {
      ...request,
      files: [
        { relativePath: "chapters/main.tex", content: "document" },
        { relativePath: "figures/plot.png", base64: "iVBORw==" },
      ],
    });
    // A server without bundles is read file by file.
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "nope" }), { status: 404 }),
      )
      .mockResolvedValueOnce(
        json([
          {
            type: "directory",
            relativePath: "chapters",
            children: [{ type: "file", relativePath: "chapters/main.tex" }],
          },
        ]),
      )
      .mockResolvedValueOnce(json({ content: "document" }));
    expect(await api.compile(request)).toEqual({ ok: true });
    expect(bridge.invoke).toHaveBeenLastCalledWith("latex:compile-cloud", {
      ...request,
      files: [{ relativePath: "chapters/main.tex", content: "document" }],
    });
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await api.compile(request)).toMatchObject({ ok: false, error: "offline" });
    bridge.invoke.mockRejectedValueOnce(new Error("no compile"));
    expect(await api.cancelCompile("project_a")).toBe(false);
  });
});

describe("terminal and AI bridges", () => {
  it("forwards terminal lifecycle and data without exposing IPC", async () => {
    expect(await terminal.create({ projectId: "local" })).toEqual({ ok: true });
    terminal.write(5, "ls\n");
    terminal.resize(5, 80, 24);
    terminal.dispose(5);
    expect(bridge.send.mock.calls).toEqual([
      ["terminal:write", { id: 5, data: "ls\n" }],
      ["terminal:resize", { id: 5, cols: 80, rows: 24 }],
      ["terminal:dispose", { id: 5 }],
    ]);
    for (const [method, channel] of [
      ["onData", "terminal:data"],
      ["onExit", "terminal:exit"],
    ] as const) {
      const cb = vi.fn();
      const stop = terminal[method](cb);
      const listener = bridge.on.mock.calls.at(-1)![1];
      listener({}, { id: 5, data: "ready" });
      expect(cb).toHaveBeenCalledWith({ id: 5, data: "ready" });
      stop();
      expect(bridge.removeListener).toHaveBeenCalledWith(channel, listener);
    }
  });
  it.each([
    ["generateStep", "ai:generate-step", [{ requestId: "r" }]],
    ["abort", "ai:abort", ["r"]],
    ["listModels", "ai:list-models", []],
    ["downloadModel", "ai:download-model", ["tier"]],
    ["cancelDownload", "ai:cancel-download", ["model"]],
    ["deleteModel", "ai:delete-model", ["model.gguf"]],
    ["importModel", "ai:import-model", []],
    ["inspectLocalModel", "ai:inspect-local-model", ["model.gguf"]],
    ["detectOllama", "ai:detect-ollama", ["http://localhost:11434"]],
    ["ensureSpeechServer", "ai:ensure-speech-server", [{}]],
    ["installSpeechRuntime", "ai:install-speech-runtime", []],
    ["getSpeechRuntimeStatus", "setup:speech-status", []],
    ["getTexRuntimeStatus", "setup:tex-status", []],
    ["installTexRuntime", "setup:install-tex", []],
    ["getSystemCapabilities", "ai:system-capabilities", []],
    ["getTierAvailability", "ai:tier-availability", ["tier"]],
    ["credentialsSupported", "ai:credentials-supported", []],
    ["setCredential", "ai:credential-set", ["provider", "secret"]],
    ["getCredential", "ai:credential-get", ["provider"]],
    ["hasCredential", "ai:credential-has", ["provider"]],
    ["deleteCredential", "ai:credential-delete", ["provider"]],
  ] as [keyof AiApi, string, unknown[]][])(
    "%s uses %s",
    async (method, channel, args) => {
      await (ai[method] as (...args: unknown[]) => unknown)(...args);
      expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith(channel, ...args);
      expect(localStorage.getItem("provider")).toBeNull();
    },
  );
  it.each([
    ["subscribeTokens", "ai:token"],
    ["subscribeDownload", "ai:download-progress"],
    ["subscribeSpeechInstall", "ai:speech-install-progress"],
    ["subscribeTexInstall", "setup:tex-install-progress"],
  ] as const)("cleans up %s", (method, channel) => {
    const cb = vi.fn();
    const stop = ai[method](cb);
    const listener = bridge.on.mock.calls[0][1];
    listener({ sender: true }, { requestId: "r", text: "token" });
    expect(cb).toHaveBeenCalledWith({ requestId: "r", text: "token" });
    stop();
    expect(bridge.removeListener).toHaveBeenCalledWith(channel, listener);
  });
});

describe("sharing from this computer", () => {
  const token = "t".repeat(43);
  const status = {
    active: true,
    mode: "internet",
    phase: "ready",
    addresses: ["https://calm-green-river.trycloudflare.com"],
  };
  // The main process answers every collaboration request in this mode.
  function hostBridge(overrides: Record<string, (...args: unknown[]) => unknown> = {}) {
    const requests: { origin: string; path: string; method: string }[] = [];
    bridge.invoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (overrides[channel]) return overrides[channel](...args);
      if (channel === "peer:host-status" || channel === "peer:host-start")
        return status;
      if (channel === "peer:host-invite") return `latexdo-invite:${String(args[0])}`;
      if (channel === "project:list") {
        return [{ type: "file", relativePath: "main.tex", name: "main.tex", path: "" }];
      }
      if (channel === "file:read") return "\\documentclass{article}";
      if (channel === "peer:request") {
        const request = args[0] as { origin: string; path: string; method: string };
        requests.push(request);
        const reply = (body: unknown, code = 200) => ({
          status: code,
          statusText: "",
          text: JSON.stringify(body),
        });
        if (request.path === "/api/projects") {
          return reply({ id: "project_hosted", name: "Thesis", rootPath: "" });
        }
        if (request.path.includes("/share") || request.path.includes("/presence")) {
          return reply({
            enabled: request.method !== "DELETE",
            token: request.method === "DELETE" ? undefined : token,
            projectId: "project_hosted",
            users: [],
          });
        }
        return reply({});
      }
      return undefined;
    });
    return requests;
  }

  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    bridge.exposed.clear();
    await import("./preload.cjs");
    api = bridge.exposed.get("latexdo") as LatexDoApi;
  });

  it("shares over the internet through the always-on server, figures included", async () => {
    const requests = hostBridge({
      "peer:cloud-invite": (value) => `latexdo-invite:cloud-${String(value)}`,
      "peer:has-folder": () => true,
      "project:list": () => [
        { type: "file", relativePath: "main.tex", name: "main.tex", path: "" },
        { type: "file", relativePath: "plot.png", name: "plot.png", path: "" },
      ],
      "file:read": (_project, relativePath) => {
        if (relativePath === "plot.png") throw new Error("not text");
        return "\\documentclass{article}";
      },
      "file:read-cloud-upload": () => ({ contentBase64: "iVBORw==", size: 6 }),
    });
    const state = await api.createCollaborationLink("local-id", {
      mode: "internet",
      projectName: "Thesis",
    });
    // This computer does not host anything: no tunnel is started.
    expect(bridge.invoke).not.toHaveBeenCalledWith("peer:host-start", "internet");
    expect(
      requests.every((request) => request.origin === "https://collab.latexdo.org"),
    ).toBe(true);
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "POST /api/projects",
      "PUT /api/projects/project_hosted/files/content?path=main.tex",
      "PUT /api/projects/project_hosted/files/binary?path=plot.png",
      "POST /api/projects/project_hosted/share",
    ]);
    // The owner's folder is remembered so the changes can come home.
    expect(bridge.invoke).toHaveBeenCalledWith(
      "peer:host-register-project",
      "project_hosted",
      "local-id",
      "Thesis",
    );
    expect(state).toMatchObject({
      enabled: true,
      hosted: true,
      apiBaseUrl: "https://collab.latexdo.org",
      inviteCode: `latexdo-invite:cloud-${token}`,
      host: { active: true, mode: "internet", phase: "ready" },
    });
  });

  it("hosts a local project on this network, uploads it and returns an invite instead of a web link", async () => {
    const requests = hostBridge();
    expect(api.hostsProjectsLocally).toBe(true);
    const state = await api.createCollaborationLink("local-id", {
      mode: "local",
      projectName: "Thesis",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(bridge.invoke).toHaveBeenCalledWith("peer:host-start", "local");
    expect(bridge.invoke).toHaveBeenCalledWith(
      "peer:host-register-project",
      "project_hosted",
      "local-id",
      "Thesis",
    );
    expect(requests.every((request) => request.origin === "latexdo-host://local")).toBe(
      true,
    );
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "POST /api/projects",
      "PUT /api/projects/project_hosted/files/content?path=main.tex",
      "POST /api/projects/project_hosted/share",
    ]);
    expect(state).toMatchObject({
      enabled: true,
      hosted: true,
      apiBaseUrl: "latexdo-host://local",
      inviteCode: `latexdo-invite:${token}`,
      host: status,
    });
    expect(state.shareUrl).toBeUndefined();
    expect(api.usesCollaborationBridge("latexdo-host://local")).toBe(true);

    // Stopping the only shared project also takes this computer offline.
    const stopped = await api.stopCollaboration("project_hosted");
    expect(stopped.enabled).toBe(false);
    expect(requests.at(-1)).toMatchObject({
      method: "DELETE",
      path: "/api/projects/project_hosted/share",
    });
    expect(bridge.invoke).toHaveBeenCalledWith("peer:host-stop");
  });

  it("joins through an invite and routes that project to its host", async () => {
    const requests = hostBridge({
      "peer:resolve-invite": () => ({ origin: "http://10.0.0.4:5000", token }),
      "peer:request": (request) => {
        const { path } = request as { path: string };
        requests.push(request as (typeof requests)[number]);
        return {
          status: 200,
          statusText: "",
          text: JSON.stringify(
            path.endsWith("/open")
              ? {
                  project: { id: "project_remote", name: "Theirs", rootPath: "" },
                  collaboration: { enabled: true, token, users: [] },
                }
              : { content: "shared text" },
          ),
        };
      },
    });
    const joined = await api.joinCollaboration("latexdo-invite:abc");
    if (joined.pending) throw new Error("The invite should open without approval.");
    expect(joined.project.id).toBe("project_remote");
    expect(joined.collaboration).toMatchObject({
      apiBaseUrl: "http://10.0.0.4:5000",
      hosted: false,
    });
    expect(joined.collaboration.inviteCode).toBeUndefined();
    expect(await api.readFile("project_remote", "main.tex")).toBe("shared text");
    expect(requests.at(-1)?.origin).toBe("http://10.0.0.4:5000");
    await expect(api.joinCollaboration("bare-token")).rejects.toThrow(
      "Paste the invite you were sent",
    );
  });

  it("reports a pending approval instead of failing, and surfaces host errors", async () => {
    hostBridge({
      "peer:resolve-invite": () => ({ origin: "http://10.0.0.4:5000", token }),
      "peer:request": () => ({
        status: 403,
        statusText: "Forbidden",
        text: JSON.stringify({
          error: "Waiting for the owner.",
          code: "approval-pending",
        }),
      }),
    });
    expect(await api.joinCollaboration("latexdo-invite:abc")).toEqual({
      pending: true,
      message: "Waiting for the owner.",
    });
    hostBridge({
      "peer:resolve-invite": () => {
        throw new Error(
          "Error invoking remote method 'peer:resolve-invite': Error: Could not reach the host.",
        );
      },
    });
    await expect(api.joinCollaboration("latexdo-invite:abc")).rejects.toThrow(
      /^Could not reach the host\.$/,
    );
  });

  it("does not hold startup for a host that has gone offline", async () => {
    hostBridge({
      "peer:resolve-invite": () => ({ origin: "http://10.0.0.4:5000", token }),
      "peer:request": () => ({
        status: 200,
        statusText: "",
        text: JSON.stringify({
          project: { id: "project_remote", name: "Theirs", rootPath: "" },
          collaboration: { enabled: true, token, users: [] },
        }),
      }),
    });
    await api.joinCollaboration("latexdo-invite:abc");
    hostBridge({
      "peer:request": () => {
        throw new Error("Could not reach the host.");
      },
    });
    expect(await api.restoreCloudProject()).toBeNull();
    expect(localStorage.getItem("latexdo.cloud.activeProject")).toBeNull();
  });

  it("carries a live document connection over the bridge", async () => {
    hostBridge();
    const handlers = {
      onOpen: vi.fn(),
      onMessage: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn(),
    };
    const socket = api.connectCollaborationSocket(
      "latexdo-host://local",
      "/api/projects/project_hosted/files/collaborate?path=main.tex",
      handlers,
    );
    const open = bridge.invoke.mock.calls.find(
      ([channel]) => channel === "peer:socket-open",
    );
    const socketId = open?.[1] as number;
    const emit = bridge.on.mock.calls.find(
      ([channel]) => channel === "peer:socket-event",
    )?.[1] as (event: unknown, payload: unknown) => void;
    emit({}, { id: socketId, type: "open" });
    emit({}, { id: socketId, type: "message", data: new Uint8Array([1, 2]) });
    expect(handlers.onOpen).toHaveBeenCalledOnce();
    expect(handlers.onMessage).toHaveBeenCalledWith(new Uint8Array([1, 2]));
    socket.send(new Uint8Array([3]));
    expect(bridge.send).toHaveBeenCalledWith(
      "peer:socket-send",
      socketId,
      new Uint8Array([3]),
    );
    socket.close(1000, "done");
    await vi.waitFor(() =>
      expect(bridge.send).toHaveBeenCalledWith(
        "peer:socket-close",
        socketId,
        1000,
        "done",
      ),
    );
    emit({}, { id: socketId, type: "close", code: 1008, reason: "Removed" });
    emit({}, { id: socketId, type: "close", code: 1000, reason: "again" });
    expect(handlers.onClose).toHaveBeenCalledExactlyOnceWith(1008, "Removed");
  });
});

describe("dropped folder routing", () => {
  it("passes local folders and the selected destination to the main process", async () => {
    await api.openDroppedFolders(["/papers"], "local", "space");
    expect(bridge.invoke).toHaveBeenCalledWith(
      "project:open-dropped-folders",
      ["/papers"],
      "local",
      "space",
    );
    await api.openDroppedFolders(["/papers"], null, "window");
    expect(bridge.invoke).toHaveBeenCalledWith(
      "project:open-dropped-folders",
      ["/papers"],
      null,
      "window",
    );
  });
  it("chooses a local research space instead of changing an online project", async () => {
    await api.openDroppedFolders(["/papers"], "project_online", "space");
    expect(bridge.invoke).toHaveBeenCalledWith(
      "project:open-dropped-folders",
      ["/papers"],
      null,
      "space",
    );
  });
});
